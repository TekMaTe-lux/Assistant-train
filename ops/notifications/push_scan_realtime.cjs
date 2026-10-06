const fs = require("fs");
const Database = require("better-sqlite3");
const webpush = require("web-push");

const {enabled,deliver} = require("./push-routes.cjs");
const db = new Database(process.env.PUSH_DB_PATH || "./data.sqlite");

const RT_PATH = process.env.PUSH_RT_PATH || "/var/www/html/gtfs/retards_nancymetzlux.json";
const STATIC_PATH = process.env.PUSH_STATIC_PATH || "/var/www/gtfs/train_static_today.json";
const {favoritePayload} = require("./push-personalization.cjs");
const MIN_DELAY = 10;
const ONLY_USER_ID = null;
const DRY_RUN = process.env.DRY_RUN !== "false";

if (!DRY_RUN) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error("STOP: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes");
    process.exit(1);
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:celestiafireber@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function parisNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function normalizeStation(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitTrainValues(value) {
  return String(value || "")
    .split(/[;, ]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function getPrefs(prefsJson) {
  const prefs = JSON.parse(prefsJson || "{}");
  return {
    trains: [
      ...splitTrainValues(prefs.favoriteMorningTrain),
      ...splitTrainValues(prefs.favoriteEveningTrain)
    ],
    from: String(prefs.favoriteFromStation || "").trim(),
    to: String(prefs.favoriteToStation || "").trim()
  };
}

function parseTodayTimeHHMM(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = parisNow();
  d.setHours(h, m, 0, 0);
  return d;
}

function addMinutes(date, min) {
  return new Date(date.getTime() + min * 60000);
}

function getTrainWindow(trainNumber) {
  const data = readJson(STATIC_PATH);
  const t = data.trains?.[trainNumber];
  if (!t) return { ok: false, reason: "train absent du statique" };

  const dep = parseTodayTimeHHMM(t.departure);
  let arr = parseTodayTimeHHMM(t.arrival);
  if (!dep || !arr) return { ok: false, reason: "horaires invalides" };

  if (arr < dep) arr = addMinutes(arr, 24 * 60);

  const start = addMinutes(dep, -60);
  const end = addMinutes(arr, 20);
  const now = parisNow();

  return {
    ok: true,
    origin: t.origin,
    destination: t.destination,
    departure: t.departure,
    arrival: t.arrival,
    start,
    end,
    now,
    useful: now >= start && now <= end
  };
}

function getCanceledStops(train) {
  const fields = [
    train.canceled_stops,
    train.cancelled_stops,
    train.canceledStops,
    train.cancelledStops,
    train.deleted_stops,
    train.deletedStops,
    train.skipped_stops,
    train.skippedStops
  ];
  for (const f of fields) {
    if (Array.isArray(f) && f.length) return f.map(String);
  }
  return [];
}

function isStatusPartialCanceled(status) {
  const s = String(status || "").toUpperCase();
  return s.includes("PARTIAL");
}

function isStatusCanceled(status) {
  const s = String(status || "").toUpperCase();
  if (isStatusPartialCanceled(s)) return false;
  return s.includes("CANCEL") || s.includes("CANCELED") || s.includes("CANCELLED") || s.includes("SUPPR") || s.includes("DELETED");
}

function indexOfStop(stops, station) {
  const names = Object.keys(stops || {});
  const norm = names.map(normalizeStation);
  return norm.indexOf(normalizeStation(station));
}

function segmentFromIndexes(stops, a, b) {
  const names = Object.keys(stops || {});
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return { from: names[min], to: names[max], min, max };
}

function canceledSegment(stops, canceledStops) {
  const names = Object.keys(stops || {});
  const indexes = canceledStops
    .map(s => indexOfStop(stops, s))
    .filter(i => i >= 0)
    .sort((a,b) => a-b);

  if (!indexes.length) return null;
  return segmentFromIndexes(stops, indexes[0], indexes[indexes.length - 1]);
}

function delayedSegment(stops) {
  const entries = Object.entries(stops || {});
  const delayed = entries.filter(([, v]) => Number(v) >= MIN_DELAY);
  if (!delayed.length) return null;

  const names = Object.keys(stops || {});
  const first = names.indexOf(delayed[0][0]);
  const last = names.indexOf(delayed[delayed.length - 1][0]);

  return {
    ...segmentFromIndexes(stops, first, last),
    delay: Math.max(...delayed.map(([, v]) => Number(v)))
  };
}

function userSegmentInTrainOrder(stops, userFrom, userTo) {
  const iFrom = indexOfStop(stops, userFrom);
  const iTo = indexOfStop(stops, userTo);
  if (iFrom < 0 || iTo < 0) return null;
  return segmentFromIndexes(stops, iFrom, iTo);
}

function overlapSegment(a, b) {
  if (!a || !b) return null;
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  if (min > max) return null;
  return { min, max };
}

function segmentTouchesUserTrip(eventSeg, userSeg) {
  if (!eventSeg || !userSeg) return true;
  return !!overlapSegment(eventSeg, userSeg);
}

async function sendPushToUser(userId, payload, prefs) {
  const subs = db.prepare("SELECT id, endpoint, p256dh, auth, settings_json FROM push_subscriptions WHERE user_id=?").all(userId);
  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    if (!enabled(sub,"favorites",prefs)) continue;
    if (DRY_RUN) {
      sent++;
      continue;
    }

    try {
      await deliver(webpush, sub, payload, 120);
      sent++;
    } catch (err) {
      failed++;
      console.error("   PUSH FAILED", err.statusCode, err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(sub.id);
      }
    }
  }

  return { sent, failed };
}

function buildEvent(train, stops) {
  const canceledStops = getCanceledStops(train);
  const statusPartialCanceled = isStatusPartialCanceled(train.status);
  const statusCanceled = isStatusCanceled(train.status);
  const cancelSeg = canceledSegment(stops, canceledStops);
  const totalStops = Object.keys(stops || {}).length;
  const allStopsCanceled = canceledStops.length > 0 && totalStops > 0 && canceledStops.length >= totalStops;

  // PRIORITÉ ABSOLUE : suppression partielle explicite
  if ((statusPartialCanceled || cancelSeg) && !allStopsCanceled) {
    return {
      type: "partial_cancel",
      title: "❌ Alerte Bétaillère",
      segment: cancelSeg,
      status: train.status
    };
  }

  // PRIORITÉ 2 : suppression totale
  if (statusCanceled || allStopsCanceled) {
    return {
      type: "cancel",
      title: "❌ Alerte Bétaillère",
      segment: cancelSeg,
      status: train.status
    };
  }

  // PRIORITÉ 3 : retard
  const delaySeg = delayedSegment(stops);
  if (delaySeg) {
    return {
      type: "delay",
      title: "⏱️ Alerte Bétaillère",
      segment: delaySeg,
      delay: delaySeg.delay,
      status: train.status
    };
  }

  return null;
}


async function main() {
  const rt = readJson(RT_PATH);
  if (!Number.isFinite(Date.parse(rt.generated_at)) || Math.abs(Date.now()-Date.parse(rt.generated_at))>15*60000) throw new Error("Temps réel absent ou périmé : envoi suspendu");
  const trains = rt.trains || {};

  console.log("SCAN PUSH FIABLE");
  console.log("----------------");
  console.log("source:", RT_PATH);
  console.log("generated_at:", rt.generated_at);
  console.log("user test:", ONLY_USER_ID);
  console.log("mode:", DRY_RUN ? "DRY_RUN simulation" : "ENVOI RÉEL");
  console.log("");

  const users = ONLY_USER_ID
    ? db.prepare("SELECT user_id, prefs_json FROM user_prefs WHERE user_id=?").all(ONLY_USER_ID)
    : db.prepare("SELECT user_id, prefs_json FROM user_prefs").all();

  for (const [num, train] of Object.entries(trains)) {
    const stops = train.stops || {};
    const event = buildEvent(train, stops);
    if (!event) continue;

    const win = getTrainWindow(num);
    if (!win.ok) {
      console.log(`⛔ ${num} ignoré: ${win.reason}`);
      continue;
    }

    const eventSeg = event.segment || {
      from: win.origin,
      to: win.destination,
      min: 0,
      max: Math.max(0, Object.keys(stops || {}).length - 1)
    };

    if (event.type === "cancel") {
      console.log(`❌ Détection ${num}: suppression totale · status=${train.status}`);
    } else if (event.type === "partial_cancel") {
      console.log(`❌ Détection ${num}: suppression partielle entre ${eventSeg.from} et ${eventSeg.to} · status=${train.status}`);
    } else {
      console.log(`⏱️ Détection ${num}: +${event.delay} min entre ${eventSeg.from} et ${eventSeg.to} · status=${train.status}`);
    }

    console.log(`   train réel: ${win.origin} → ${win.destination} (${win.departure} → ${win.arrival})`);
    console.log(`   fenêtre: ${win.start.toLocaleTimeString("fr-FR")} → ${win.end.toLocaleTimeString("fr-FR")}`);
    console.log(`   maintenant: ${win.now.toLocaleTimeString("fr-FR")} · utile: ${win.useful ? "OUI" : "NON"}`);

    if (!win.useful) {
      console.log("   STOP: hors fenêtre utile");
      continue;
    }

    for (const u of users) {
      const prefs = getPrefs(u.prefs_json);
      if (!prefs.trains.includes(String(num))) continue;

      const userSeg = userSegmentInTrainOrder(stops, prefs.from, prefs.to);
      if (!segmentTouchesUserTrip(eventSeg, userSeg)) {
        console.log(`   user ${u.user_id} ignoré: trajet ${prefs.from} → ${prefs.to} non touché`);
        continue;
      }

      const visibleSeg = userSeg && overlapSegment(eventSeg, userSeg)
        ? segmentFromIndexes(stops, overlapSegment(eventSeg, userSeg).min, overlapSegment(eventSeg, userSeg).max)
        : (userSeg || eventSeg);

      const msgFrom = visibleSeg.from || win.origin;
      const msgTo = visibleSeg.to || win.destination;

      const recent = db.prepare(`
        SELECT sent_at FROM push_history
        WHERE user_id=?
          AND train_number=?
          AND event_type=?
          AND sent_at >= datetime('now', '-20 minutes')
        ORDER BY sent_at DESC
        LIMIT 1
      `).get(u.user_id, num, event.type);

      if (recent) {
        console.log(`   user ${u.user_id} ⛔ anti-spam ${event.type} (${recent.sent_at})`);
        continue;
      }

      const devices = db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?").get(u.user_id).n;
      if (!devices) continue;

      const payload = favoritePayload(num,event,stops,prefs,win,visibleSeg);
      if (!payload) continue;
      const body = payload.body;

      console.log(`   user ${u.user_id} ✅ ${devices} appareil(s)`);
      console.log(`   MESSAGE: ${payload.title}`);
      console.log("   " + body.replace(/\n/g, "\n   "));


      const result = await sendPushToUser(u.user_id, payload, JSON.parse(u.prefs_json || "{}"));
      console.log(`   PUSH: ${result.sent} envoyé(s), ${result.failed} échec(s)`);

      if (!DRY_RUN && result.sent > 0) {
        db.prepare(`
          INSERT INTO push_history(user_id, train_number, event_type, event_key, sent_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(u.user_id, num, event.type, `${num}:${event.type}:${msgFrom}:${msgTo}`);
      }
    }

    console.log("");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
