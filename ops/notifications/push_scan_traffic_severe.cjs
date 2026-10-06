const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const webpush = require("web-push");

const {enabled,deliver} = require("./push-routes.cjs");
const {classifyActive} = require("./push-major-classifier.cjs");
const db = new Database(process.env.PUSH_DB_PATH || "./data.sqlite");

const RT_PATH = process.env.PUSH_RT_PATH || "/var/www/html/gtfs/retards_nancymetzlux.json";
const SIRI_PATH = process.env.PUSH_SIRI_PATH || "/var/www/gtfs/siri_sx_alertes.json";
const DRY_RUN = process.env.DRY_RUN !== "false";
const COOLDOWN_MIN = 90;
const CALM_RESET_MIN = 20;

if (!DRY_RUN) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:celestiafireber@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function nowIso() {
  return new Date().toISOString();
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function isCanceled(t) {
  const s = String(t.status || "").toUpperCase();
  return s.includes("CANCELED") || s.includes("CANCELLED") || s.includes("SUPPR");
}

function isPartial(t) {
  const s = String(t.status || "").toUpperCase();
  return s.includes("PARTIAL") || (Array.isArray(t.canceled_stops) && t.canceled_stops.length > 0 && !isCanceled(t));
}

function maxDelay(t) {
  return Math.max(0, ...Object.values(t.stops || {}).map(v => Number(v) || 0));
}

function hasInfra(text) {
  const s = String(text || "").toLowerCase();
  return [
    "signalisation",
    "caténaire",
    "catenaire",
    "panne électrique",
    "panne electrique",
    "aiguillage",
    "obstacle voie",
    "accident personne",
    "infrastructure"
  ].some(k => s.includes(k));
}

function trainText(t) {
  return [
    t.status,
    t.cause,
    t.reason,
    t.message,
    t.description,
    t.disruption_reason
  ].filter(Boolean).join(" ");
}

function analyze(data) {
  const trains = Object.values(data.trains || {});
  const visible = trains.length;

  let delayed = 0;
  let canceled = 0;
  let partial = 0;
  let impacted = 0;
  let infra = false;

  for (const t of trains) {
    const cancel = isCanceled(t);
    const part = isPartial(t);
    const delay = maxDelay(t) >= 10;

    if (cancel) canceled++;
    if (part) partial++;
    if (delay) delayed++;
    if (cancel || part || delay) impacted++;
    if (hasInfra(trainText(t))) infra = true;
  }

  const ratio = visible ? impacted / visible : 0;

  let severe = false;
  let reason = "";

  if (visible >= 4 && visible <= 7) {
    severe = ratio >= 0.60 || canceled >= 3;
    reason = "faible trafic";
  } else if (visible >= 8 && visible <= 15) {
    severe = ratio >= 0.50 || canceled >= 4 || (infra && ratio >= 0.35);
    reason = "trafic moyen";
  } else if (visible >= 16) {
    severe =
      (ratio >= 0.40 && impacted >= 7) ||
      canceled >= 5 ||
      (infra && ratio >= 0.30 && impacted >= 5);
    reason = "heure de pointe / trafic dense";
  }

  const episodeRaw = `${visible}|${impacted}|${canceled}|${partial}|${delayed}|${infra}`;
  const episodeId = crypto.createHash("sha1").update(episodeRaw).digest("hex").slice(0, 12);

  return { visible, impacted, delayed, canceled, partial, ratio, infra, severe, reason, episodeId };
}

async function sendPush(payload, episodeId, recovery = false) {
  const users = db.prepare("SELECT user_id,prefs_json FROM user_prefs").all();

  let usersSent = 0;
  let devicesSent = 0;
  let failed = 0;

  for (const u of users) {
    const subs = db.prepare("SELECT id,endpoint,p256dh,auth,settings_json FROM push_subscriptions WHERE user_id=?").all(u.user_id);
    if (!subs.length) continue;

    const eligible=subs.filter(sub=>enabled(sub,"trafficSevere",JSON.parse(u.prefs_json || "{}")) && (!recovery || db.prepare("SELECT 1 FROM push_traffic_deliveries WHERE subscription_id=? AND user_id=? AND endpoint_hash=? AND recovery_sent_at IS NULL").get(sub.id,u.user_id,crypto.createHash("sha256").update(sub.endpoint).digest("hex"))));
    if (!eligible.length) continue;
    usersSent++;

    for (const sub of eligible) {
      if (DRY_RUN) {
        devicesSent++;
        continue;
      }

      try {
        await deliver(webpush, sub, payload, 180);
        devicesSent++;
        if (recovery) db.prepare("UPDATE push_traffic_deliveries SET recovery_sent_at=? WHERE subscription_id=? AND user_id=?").run(nowIso(),sub.id,u.user_id);
        else db.prepare(`INSERT INTO push_traffic_deliveries(subscription_id,user_id,episode_id,sent_at,recovery_sent_at,endpoint_hash)
          VALUES(?,?,?,?,NULL,?) ON CONFLICT(subscription_id,user_id) DO UPDATE SET episode_id=excluded.episode_id,sent_at=excluded.sent_at,recovery_sent_at=NULL,endpoint_hash=excluded.endpoint_hash`).run(sub.id,u.user_id,episodeId,nowIso(),crypto.createHash("sha256").update(sub.endpoint).digest("hex"));
      } catch (err) {
        if (![404,410].includes(err.statusCode)) failed++;
        console.error("PUSH trafic échec",err.statusCode || "transport");
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(sub.id);
        }
      }
    }
  }

  return { usersSent, devicesSent, failed };
}

async function main() {
  const data = readJson(RT_PATH);
  const fresh = value => Number.isFinite(Date.parse(value.generated_at)) && Math.abs(Date.now()-Date.parse(value.generated_at))<=15*60000;
  if (!fresh(data)) throw new Error("Temps réel absent ou périmé : envoi suspendu");
  const a = analyze(data);
  let official=[], siriFresh=false;
  try {const siri=readJson(SIRI_PATH);siriFresh=fresh(siri);if(siriFresh)official=classifyActive(siri);} catch(err) {console.warn("Source SIRI indisponible",err.code || "analyse");}
  a.severe = a.severe || official.length>0;
  a.episodeId=crypto.createHash("sha1").update(official.length ? official.map(x=>x.fingerprint).sort().join("|") : "corridor-severe").digest("hex").slice(0,12);
  a.official=official;
  const state = db.prepare("SELECT * FROM push_traffic_state WHERE id=1").get();

  console.log("SCAN TRAFIC TRÈS PERTURBÉ");
  console.log("--------------------------");
  console.log("mode:", DRY_RUN ? "DRY_RUN simulation" : "ENVOI RÉEL");
  console.log("generated_at:", data.generated_at);
  console.log(`visibles=${a.visible} impactés=${a.impacted} ratio=${Math.round(a.ratio * 100)}% retard=${a.delayed} supprimés=${a.canceled} partiels=${a.partial} infra=${a.infra}`);
  console.log("severe:", a.severe ? "OUI" : "NON", "-", a.reason);

  if (!a.severe) {
    if (!siriFresh) {
      if (!DRY_RUN && state.status === 'calming') db.prepare('UPDATE push_traffic_state SET calm_since=?,last_seen_at=? WHERE id=1').run(nowIso(),nowIso());
      console.log('Fin d’alerte suspendue : source SIRI absente ou périmée');return;
    }
    if (state.status === 'calming' && minutesSince(state.last_seen_at) >= 5) {
      if (!DRY_RUN) db.prepare('UPDATE push_traffic_state SET calm_since=?,last_seen_at=? WHERE id=1').run(nowIso(),nowIso());
      console.log('Confirmation du calme reprise après interruption du scanner');return;
    }
    if (state.status === "severe" && !state.calm_since) {
      if (!DRY_RUN) db.prepare("UPDATE push_traffic_state SET status='calming', calm_since=?, last_seen_at=? WHERE id=1")
        .run(nowIso(), nowIso());
      console.log("retour au calme détecté, début timer 20 min");
      return;
    }

    if (state.status === "calming" && minutesSince(state.calm_since) >= CALM_RESET_MIN) {
      const recovery=await sendPush({title:'✅ Fin de l’alerte majeure · La Bétaillère',
        body:'La situation s’est améliorée depuis 20 minutes sur Nancy ↔ Metz ↔ Luxembourg. Des retards ou suppressions peuvent subsister : vérifie tes trains favoris avant de partir.',
        tag:'lb-major-recovery',url:'/#home'},state.notified_episode_id,true);
      console.log(`SUIVI FIN ALERTE: ${recovery.devicesSent} appareil(s), ${recovery.failed} échec(s)`);
      if (recovery.failed) {if (!DRY_RUN) db.prepare('UPDATE push_traffic_state SET last_seen_at=? WHERE id=1').run(nowIso());return;}
      if (!DRY_RUN) db.prepare('DELETE FROM push_traffic_deliveries').run();
      if (!DRY_RUN) db.prepare("UPDATE push_traffic_state SET status='calm', confirmed_count=0, episode_id=NULL, notified_episode_id=NULL, calm_since=NULL, last_seen_at=? WHERE id=1")
        .run(nowIso());
      console.log("retour au calme confirmé, épisode reset");
      return;
    }

    if (!DRY_RUN && state.status === "calming") db.prepare("UPDATE push_traffic_state SET last_seen_at=? WHERE id=1").run(nowIso());
    console.log("pas de notif");
    return;
  }

  const confirmed = state.status === "severe" && minutesSince(state.last_seen_at) < 5
    ? Number(state.confirmed_count || 0) + 1
    : 1;

  if (!DRY_RUN) db.prepare(`
    UPDATE push_traffic_state
    SET status='severe', confirmed_count=?, episode_id=?, calm_since=NULL, last_seen_at=?
    WHERE id=1
  `).run(confirmed, a.episodeId, nowIso());

  console.log("confirmation:", confirmed, "/ 2");

  if (confirmed < 2) {
    console.log("STOP: attente 2 scans consécutifs");
    return;
  }

  if (state.notified_episode_id === a.episodeId && state.last_sent_at) {
    console.log("STOP: même épisode déjà notifié");
    return;
  }

  if (minutesSince(state.last_sent_at) < COOLDOWN_MIN) {
    console.log("STOP: cooldown 90 min");
    return;
  }

  const payload = {
    tag:"lb-major-traffic",
    title: "🚨 Info Trafic Bétaillère",
    body: `Le trafic Nancy ↔ Metz ↔ Luxembourg est actuellement très perturbé.\n\n${a.impacted}/${a.visible} trains visibles sont impactés.\n\nVérifie l’évolution sur labetaillere.fr`,
    url: "/#home"
  };

  if (official.length) {
    payload.title="🚨 Perturbation majeure · La Bétaillère";
    payload.body=String(official[0].situation.description || official[0].situation.summary || official[0].severity.label).replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,240);
  }
  const r = await sendPush(payload,a.episodeId);
  console.log(`PUSH GLOBAL: ${r.usersSent} utilisateur(s), ${r.devicesSent} appareil(s)`);

  if (!DRY_RUN && r.devicesSent > 0) {
    db.prepare("UPDATE push_traffic_state SET last_sent_at=?, notified_episode_id=? WHERE id=1").run(nowIso(), a.episodeId);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
