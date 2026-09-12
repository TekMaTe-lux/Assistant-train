#!/usr/bin/env python3
"""La Bétaillère — Voix du Bétail -> carte V4, correctif ciblé et testé.

Dry-run par défaut. Ne touche qu'au module parent qui fabrique le snapshot
communautaire envoyé à l'iframe carte et à son cache-bust.
Aucun GTFS, HAFAS, tracé, moteur carte ou service systemd n'est modifié.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

MARK = "LB_COMMUNITY_VOICE_TO_MAP_V4"
CACHE_TAG = "20260912-voice-map-v4"
TARGET_NAME = "lb-community-map-votes-v2.js"
LOADER_NAME = "lb-community-map-bridge-v1.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouvé {n}; version inattendue, aucun changement")
    return text.replace(old, new, 1)


def locate_root(explicit: str | None) -> Path:
    if explicit:
        root = Path(explicit).resolve()
        if not (root / "assets" / TARGET_NAME).is_file() or not (root / "assets" / LOADER_NAME).is_file():
            raise RuntimeError(f"racine invalide: {root} (assets communautaires absents)")
        return root

    preferred = Path("/var/www/html")
    if (preferred / "assets" / TARGET_NAME).is_file() and (preferred / "assets" / LOADER_NAME).is_file():
        return preferred

    found: list[Path] = []
    for base in (Path("/var/www"), Path("/opt"), Path("/home/ubuntu")):
        if not base.exists():
            continue
        try:
            for p in base.rglob(TARGET_NAME):
                if p.parent.name != "assets":
                    continue
                root = p.parent.parent.resolve()
                if (root / "assets" / LOADER_NAME).is_file() and root not in found:
                    found.append(root)
        except PermissionError:
            pass
    if len(found) == 1:
        return found[0]
    if not found:
        raise RuntimeError("site non trouvé; utiliser --root /chemin/du/site")
    raise RuntimeError("plusieurs sites possibles; refus de choisir automatiquement:\n  - " + "\n  - ".join(map(str, found)))


def patch_votes(source: str) -> str:
    if MARK in source:
        return source
    if "LB_COMMUNITY_VOICE_TO_MAP_V3" in source:
        raise RuntimeError("une V3 expérimentale est déjà présente dans le fichier live; ne pas empiler, revenir au backup avant V4")

    old_parse = """  const parseTs = (raw) => {
    const value = raw?.created_at || raw?.createdAt || raw?.ts || raw?.timestamp || raw?.date || '';
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
"""
    new_parse = """  // LB_COMMUNITY_VOICE_TO_MAP_V4
  const parseTs = (raw) => {
    const value = raw?.created_at ?? raw?.createdAt ?? raw?.ts ?? raw?.timestamp ?? raw?.date ?? '';
    if (typeof value === 'number' || /^\\d+(?:\\.\\d+)?$/.test(String(value || '').trim())) {
      let direct = Number(value);
      if (!Number.isFinite(direct) || direct <= 0) return 0;
      if (direct < 1e12) direct *= 1000;
      return direct;
    }
    let text = String(value || '').trim();
    if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(text)) text = text.replace(' ', 'T') + 'Z';
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  };
"""
    source = replace_once(source, old_parse, new_parse, "parseTs")

    old_fields = """    const trainNumber = normalizeTrain(raw.train_number || raw.trainNumber || raw.train || parsed?.[3] || '');
    const station = String(raw.station || raw.stop_name || raw.stopName || parsed?.[4] || '').trim();
    const signalType = String(raw.signal_type || raw.signalType || parsed?.[1] || '')
      .trim().toLowerCase().replace(/\\s+/g, '-');
    const parsedDelay = Number(String(parsed?.[5] || message).match(/\\+\\s*(\\d{1,3})\\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? parsedDelay ?? 0) || 0);
"""
    new_fields = """    const trainNumber = normalizeTrain(raw.train_number ?? raw.trainNumber ?? raw.train ?? parsed?.[3] ?? '');
    const station = String(raw.station ?? raw.stop_name ?? raw.stopName ?? parsed?.[4] ?? '').trim();
    let signalType = String(raw.signal_type ?? raw.signalType ?? raw.type ?? raw.kind ?? parsed?.[1] ?? '').trim().toLowerCase();
    signalType = signalType.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[\\s_]+/g, '-');
    if (['delay','late','retard-train'].includes(signalType)) signalType = 'retard';
    const parsedDelay = Number(String(parsed?.[5] || message).match(/\\+\\s*(\\d{1,3})\\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? raw.delay ?? parsedDelay ?? 0) || 0);
"""
    source = replace_once(source, old_fields, new_fields, "champs signal")

    anchor = """    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  async function fetchSignalsPayload(){
"""
    source = replace_once(source, anchor, """    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  function extractList(data){
    if (Array.isArray(data)) return data;
    for (const key of ['comments','signals','items','data','results']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  async function fetchSignalsPayload(){
""", "extractList")

    source = replace_once(
        source,
        "        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);",
        "        const list = extractList(data);",
        "liste API",
    )

    old_enriched = """  function enrichedSnapshot(){
    let base = null;
    try { base = window.lbCommunityLive?.getMapSnapshot?.() || null; } catch(_) { base = null; }
    if (!base || typeof base !== 'object') return null;

    const trains = {};
    Object.entries(base.trains || {}).forEach(([number, rawItem]) => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const travelerStops = {};
      Object.entries(item.travelerStops || {}).forEach(([stopKey, rawReport]) => {
        const report = rawReport && typeof rawReport === 'object' ? rawReport : {};
        const signal = signalForStop(number, report.station || stopKey, report.delayMin);
        travelerStops[stopKey] = {
          ...report,
          vote: signal ? {
            signalId:signal.id,
            score:signal.upvotes - signal.downvotes,
            upvotes:signal.upvotes,
            downvotes:signal.downvotes,
            myVote:signal.myVote
          } : null
        };
      });
      trains[number] = { ...item, travelerStops };
    });

    return { ...base, canContribute:canContribute(), trains, voteMetadata:true };
  }
"""

    new_enriched = """  function voteMeta(signal){
    return signal ? {
      signalId:signal.id,
      score:signal.upvotes - signal.downvotes,
      upvotes:signal.upvotes,
      downvotes:signal.downvotes,
      myVote:signal.myVote
    } : null;
  }

  function enrichedSnapshot(){
    let base = null;
    try { base = window.lbCommunityLive?.getMapSnapshot?.() || null; } catch(_) { base = null; }
    if (!base || typeof base !== 'object') base = { generatedAt:Date.now(), trains:{} };

    const trains = {};

    // Conserver d'abord l'état natif: présences + retards déjà connus.
    Object.entries(base.trains || {}).forEach(([number, rawItem]) => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const travelerStops = {};
      Object.entries(item.travelerStops || {}).forEach(([stopKey, rawReport]) => {
        const report = rawReport && typeof rawReport === 'object' ? rawReport : {};
        const signal = signalForStop(number, report.station || stopKey, report.delayMin);
        travelerStops[stopKey] = { ...report, vote:voteMeta(signal) };
      });
      trains[number] = { ...item, travelerStops };
    });

    // Compléter ensuite avec les vrais signalements de l'API. C'est ce qui
    // rend symétriques Voix -> carte et carte -> Voix, sans polling nouveau.
    const orderedSignals = voteSignals.slice().sort((a,b) => Number(a.ts || 0) - Number(b.ts || 0));
    orderedSignals.forEach((signal) => {
      const number = normalizeTrain(signal.trainNumber);
      if (!number || !(signal.delayMin > 0)) return;

      const previous = trains[number] && typeof trains[number] === 'object' ? trains[number] : {};
      const travelerStops = { ...(previous.travelerStops || {}) };
      const stopKey = signal.stopKey || normalizeStop(signal.station);
      const previousReport = stopKey && travelerStops[stopKey] && typeof travelerStops[stopKey] === 'object'
        ? travelerStops[stopKey] : null;
      const previousReportTs = Number(previousReport?.lastReportAt || 0);
      const signalTs = Number(signal.ts || 0);

      if (stopKey && (!previousReport || !previousReportTs || !signalTs || signalTs >= previousReportTs)) {
        const reports = Math.max(
          1,
          Math.round(Number(previousReport?.reports) || 0),
          voteSignals.filter((other) => other.trainNumber === number && other.stopKey === stopKey && other.delayMin === signal.delayMin).length
        );
        travelerStops[stopKey] = {
          ...(previousReport || {}),
          station:signal.station || previousReport?.station || stopKey,
          delayMin:signal.delayMin,
          reports,
          lastReportAt:Math.max(previousReportTs, signalTs),
          vote:voteMeta(signal)
        };
      }

      const previousLast = Number(previous.lastReportAt || 0);
      const promote = !(Number(previous.travelerDelayMin) > 0) || !previousLast || !signalTs || signalTs >= previousLast;
      trains[number] = {
        ...previous,
        travelerStops,
        travelerDelayMin:promote ? signal.delayMin : previous.travelerDelayMin,
        delayReports:Math.max(1, Math.round(Number(previous.delayReports) || 0)),
        lastReportAt:Math.max(previousLast, signalTs)
      };
    });

    return { ...base, canContribute:canContribute(), trains, voteMetadata:true };
  }
"""
    return replace_once(source, old_enriched, new_enriched, "fusion API -> snapshot carte")


def patch_loader(source: str) -> str:
    pattern = re.compile(r"lb-community-map-votes-v2\.js\?v=[A-Za-z0-9._-]+")
    hits = pattern.findall(source)
    wanted = f"lb-community-map-votes-v2.js?v={CACHE_TAG}"
    if not hits and wanted in source:
        return source
    if len(hits) != 1:
        raise RuntimeError(f"chargeur inattendu: {len(hits)} référence(s) V2 trouvée(s)")
    return pattern.sub(wanted, source, count=1)


def node_check(source: str, label: str) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node absent: impossible de valider le JavaScript en sécurité")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as fh:
        fh.write(source)
        name = fh.name
    try:
        p = subprocess.run([node, "--check", name], text=True, capture_output=True, timeout=20)
        if p.returncode:
            raise RuntimeError(f"JavaScript invalide ({label}): {p.stderr.strip()}")
    finally:
        try: os.unlink(name)
        except FileNotFoundError: pass


def behavior_check(source: str) -> None:
    """Test synthétique: 88507 vient seulement de l'API, 88509 existe déjà côté snapshot."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node absent")
    with tempfile.TemporaryDirectory(prefix="lb-voice-map-v4-") as td:
        js_path = Path(td) / "module.js"
        harness = Path(td) / "test.js"
        js_path.write_text(source, encoding="utf-8")
        harness.write_text(r"""
const assert = require('assert');
global.window = globalThis;
window.lbIsAuthed = true;
const now = Date.now();
const sent = [];
const frameWindow = { postMessage: (payload) => sent.push(payload) };
const frame = { contentWindow: frameWindow, addEventListener: () => {} };
global.document = {
  readyState:'loading',
  querySelectorAll:(sel) => sel === '#carte iframe' ? [frame] : [],
  addEventListener:() => {},
  getElementById:() => null,
  createElement:() => ({ hidden:false, tabIndex:0, setAttribute(){}, click(){}, remove(){} }),
  body:{ appendChild(){} }
};
window.addEventListener = () => {};
window.clearTimeout = clearTimeout;
window.lbCommunityLive = { getMapSnapshot: () => ({
  generatedAt:now,
  trains:{
    '88509':{
      travelerDelayMin:5,
      delayReports:1,
      lastReportAt:now - 1000,
      travelerStops:{ metz:{ station:'Metz', delayMin:5, reports:1, lastReportAt:now - 1000 } }
    }
  }
})};
global.fetch = async () => ({ ok:true, json:async () => ({ comments:[
  {id:'voice-88507', train_number:'88507', station:'Metz', signal_type:'retard', delay_min:45, created_at:Math.floor(now/1000), upvotes:1, downvotes:0},
  {id:'map-88509', train_number:'88509', station:'Metz', signal_type:'retard', delay_min:5, created_at:now, upvotes:1, downvotes:0}
] }) });
require(process.argv[2]);
(async () => {
  await window.lbCommunityMapVotesV2.refresh();
  const payload = sent[sent.length - 1];
  assert(payload, 'aucun snapshot envoyé');
  assert.strictEqual(payload.trains['88507'].travelerDelayMin, 45, '88507 absent du snapshot');
  assert.strictEqual(payload.trains['88507'].travelerStops.metz.delayMin, 45, '88507 absent de travelerStops');
  assert.strictEqual(payload.trains['88509'].travelerDelayMin, 5, '88509 existant cassé');
  assert.strictEqual(payload.trains['88509'].travelerStops.metz.delayMin, 5, '88509 travelerStops cassé');
  console.log('SMOKE_OK 88507=45 88509=5');
})().catch((e) => { console.error(e); process.exit(1); });
""", encoding="utf-8")
        p = subprocess.run([node, str(harness), str(js_path)], text=True, capture_output=True, timeout=20)
        if p.returncode or "SMOKE_OK" not in p.stdout:
            raise RuntimeError("test comportemental échoué: " + (p.stderr.strip() or p.stdout.strip()))


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data); fh.flush(); os.fsync(fh.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0: os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    root = locate_root(args.root)
    target = root / "assets" / TARGET_NAME
    loader = root / "assets" / LOADER_NAME
    before_target = target.read_bytes()
    before_loader = loader.read_bytes()
    patched_target = patch_votes(before_target.decode("utf-8"))
    patched_loader = patch_loader(before_loader.decode("utf-8"))

    node_check(patched_target, TARGET_NAME)
    node_check(patched_loader, LOADER_NAME)
    behavior_check(patched_target)

    required = [MARK, "extractList(data)", "orderedSignals", "travelerDelayMin:promote ? signal.delayMin", f"?v={CACHE_TAG}"]
    merged = patched_target + "\n" + patched_loader
    missing = [x for x in required if x not in merged]
    if missing:
        raise RuntimeError("validation interne incomplète: " + ", ".join(missing))

    print("============================================================")
    print(" VOIX DU BÉTAIL -> CARTE V4")
    print("============================================================")
    print("Racine :", root)
    print("✓ production détectée sans ambiguïté")
    print("✓ aucun GTFS / HAFAS / tracé / moteur modifié")
    print("✓ aucun polling ajouté")
    print("✓ aucun service redémarré")
    print("✓ JavaScript valide")
    print("✓ test synthétique OK: Voix 88507 +45 -> carte; 88509 +5 préservé")

    if patched_target.encode() == before_target and patched_loader.encode() == before_loader:
        print("Déjà installé, rien à faire.")
        return
    if not args.apply:
        print("SIMULATION: aucun fichier modifié. Relancer avec --apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = root / ".lb-backups" / f"community-voice-map-v4-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(target, backup / target.name)
    shutil.copy2(loader, backup / loader.name)

    if target.read_bytes() != before_target or loader.read_bytes() != before_loader:
        raise RuntimeError("fichiers modifiés pendant le contrôle; arrêt avant écriture")

    changed: list[tuple[Path, bytes]] = []
    try:
        if patched_target.encode() != before_target:
            atomic_write(target, patched_target.encode()); changed.append((target, before_target))
        if patched_loader.encode() != before_loader:
            atomic_write(loader, patched_loader.encode()); changed.append((loader, before_loader))
        node_check(target.read_text(encoding="utf-8"), "live target")
        behavior_check(target.read_text(encoding="utf-8"))
    except BaseException:
        for path, original in reversed(changed): atomic_write(path, original)
        print("ERREUR: restauration automatique effectuée.")
        raise

    print("INSTALLÉ.")
    print("Backup :", backup)
    print("SHA256 module   :", hashlib.sha256(target.read_bytes()).hexdigest())
    print("SHA256 chargeur :", hashlib.sha256(loader.read_bytes()).hexdigest())
    print("Retour arrière:")
    print(f"sudo cp -a '{backup / target.name}' '{target}'")
    print(f"sudo cp -a '{backup / loader.name}' '{loader}'")
    print("Recharge ensuite la PWA une fois puis teste un signalement depuis la Voix du Bétail.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT SÉCURISÉ: " + str(exc))
