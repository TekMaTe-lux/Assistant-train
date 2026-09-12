#!/usr/bin/env python3
"""La Bétaillère — correction ciblée Voix du Bétail -> carte V3.

Objectif : les retards voyageurs enregistrés dans /api/comments?scope=signals
alimentent aussi le snapshot envoyé à la carte, même s'ils ne sont pas encore
présents dans lbCommunityLive.getMapSnapshot().

Sécurité :
- dry-run par défaut ; --apply requis pour écrire ;
- ne touche ni GTFS, ni HAFAS, ni moteur/routage, ni service systemd ;
- refuse une version inattendue ;
- vérifie le JavaScript avec node --check avant écriture ;
- sauvegarde les fichiers originaux ;
- écriture atomique ;
- met seulement à jour le cache-bust du chargeur de ce module.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

MARK = "LB_COMMUNITY_VOICE_TO_MAP_V3"
NEW_CACHE = "20260912-voice-map-v3"
TARGET_NAME = "lb-community-map-votes-v2.js"
LOADER_NAME = "lb-community-map-bridge-v1.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouvé {count}. Version inattendue, arrêt sans modification.")
    return text.replace(old, new, 1)


def locate_site_root(explicit: str | None) -> Path:
    if explicit:
        root = Path(explicit).resolve()
        target = root / "assets" / TARGET_NAME
        loader = root / "assets" / LOADER_NAME
        if not target.is_file() or not loader.is_file():
            raise RuntimeError(f"--root invalide : fichiers communautaires absents dans {root}/assets")
        return root

    preferred = Path("/var/www/html")
    if (preferred / "assets" / TARGET_NAME).is_file() and (preferred / "assets" / LOADER_NAME).is_file():
        return preferred

    candidates: list[Path] = []
    for base in (Path("/var/www"), Path("/opt"), Path("/home/ubuntu")):
        if not base.exists():
            continue
        try:
            for target in base.rglob(TARGET_NAME):
                if target.parent.name != "assets":
                    continue
                root = target.parent.parent.resolve()
                if (root / "assets" / LOADER_NAME).is_file() and root not in candidates:
                    candidates.append(root)
        except PermissionError:
            continue

    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise RuntimeError("site introuvable automatiquement. Relancer avec --root /chemin/du/site")
    detail = "\n  - ".join(str(x) for x in candidates)
    raise RuntimeError(f"plusieurs sites possibles, refus de choisir automatiquement :\n  - {detail}\nUtiliser --root.")


def prepare_votes(source: str) -> str:
    if MARK in source:
        return source

    old_parse = """  const parseTs = (raw) => {
    const value = raw?.created_at || raw?.createdAt || raw?.ts || raw?.timestamp || raw?.date || '';
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
"""
    new_parse = """  // LB_COMMUNITY_VOICE_TO_MAP_V3
  const parseTs = (raw) => {
    const value = raw?.created_at ?? raw?.createdAt ?? raw?.ts ?? raw?.timestamp ?? raw?.date ?? '';
    if (typeof value === 'number' || /^\\d+(?:\\.\\d+)?$/.test(String(value || '').trim())) {
      let direct = Number(value);
      if (!Number.isFinite(direct) || direct <= 0) return 0;
      if (direct < 1e12) direct *= 1000; // timestamp Unix en secondes -> millisecondes
      return direct;
    }
    let text = String(value || '').trim();
    if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(text)) {
      text = text.replace(' ', 'T') + 'Z';
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  };
"""
    source = replace_once(source, old_parse, new_parse, "normalisation timestamp")

    old_signal = """    const trainNumber = normalizeTrain(raw.train_number || raw.trainNumber || raw.train || parsed?.[3] || '');
    const station = String(raw.station || raw.stop_name || raw.stopName || parsed?.[4] || '').trim();
    const signalType = String(raw.signal_type || raw.signalType || parsed?.[1] || '')
      .trim().toLowerCase().replace(/\\s+/g, '-');
    const parsedDelay = Number(String(parsed?.[5] || message).match(/\\+\\s*(\\d{1,3})\\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? parsedDelay ?? 0) || 0);
"""
    new_signal = """    const trainNumber = normalizeTrain(raw.train_number ?? raw.trainNumber ?? raw.train ?? parsed?.[3] ?? '');
    const station = String(raw.station ?? raw.stop_name ?? raw.stopName ?? parsed?.[4] ?? '').trim();
    let signalType = String(raw.signal_type ?? raw.signalType ?? raw.type ?? raw.kind ?? parsed?.[1] ?? '')
      .trim().toLowerCase();
    signalType = signalType.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[\\s_]+/g, '-');
    if (['delay','late','retard-train'].includes(signalType)) signalType = 'retard';
    const parsedDelay = Number(String(parsed?.[5] || message).match(/\\+\\s*(\\d{1,3})\\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? raw.delay ?? parsedDelay ?? 0) || 0);
"""
    source = replace_once(source, old_signal, new_signal, "normalisation signal")

    anchor = """    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  async function fetchSignalsPayload(){
"""
    replacement = """    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  function extractList(data){
    if (Array.isArray(data)) return data;
    for (const key of ['comments','signals','items','data','results']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  async function fetchSignalsPayload(){
"""
    source = replace_once(source, anchor, replacement, "extracteur API")

    source = replace_once(
        source,
        "        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);",
        "        const list = extractList(data);",
        "lecture liste API",
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

    // 1) On conserve intégralement le snapshot natif (présence + retards déjà connus).
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

    // 2) Puis on complète avec l'API des signalements. C'est le chaînon qui
    // manquait pour un retard créé depuis la Voix du Bétail (ex. 88507).
    // Aucun polling : cette fusion ne s'exécute que lors des refresh déjà prévus.
    const orderedSignals = voteSignals.slice().sort((a,b) => Number(a.ts || 0) - Number(b.ts || 0));
    orderedSignals.forEach((signal) => {
      const number = normalizeTrain(signal.trainNumber);
      if (!number || !(signal.delayMin > 0)) return;

      const previous = trains[number] && typeof trains[number] === 'object' ? trains[number] : {};
      const travelerStops = { ...(previous.travelerStops || {}) };
      const stopKey = signal.stopKey || normalizeStop(signal.station);
      const previousReport = stopKey && travelerStops[stopKey] && typeof travelerStops[stopKey] === 'object'
        ? travelerStops[stopKey]
        : null;
      const previousReportTs = Number(previousReport?.lastReportAt || 0);
      const signalTs = Number(signal.ts || 0);

      if (stopKey && (!previousReport || !previousReportTs || !signalTs || signalTs >= previousReportTs)) {
        const reports = Math.max(
          1,
          Math.round(Number(previousReport?.reports) || 0),
          voteSignals.filter((other) =>
            other.trainNumber === number &&
            other.stopKey === stopKey &&
            other.delayMin === signal.delayMin
          ).length
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
      const shouldPromote = !(Number(previous.travelerDelayMin) > 0)
        || !previousLast
        || !signalTs
        || signalTs >= previousLast;

      trains[number] = {
        ...previous,
        travelerStops,
        travelerDelayMin:shouldPromote ? signal.delayMin : previous.travelerDelayMin,
        delayReports:Math.max(1, Math.round(Number(previous.delayReports) || 0)),
        lastReportAt:Math.max(previousLast, signalTs)
      };
    });

    return { ...base, canContribute:canContribute(), trains, voteMetadata:true };
  }
"""
    source = replace_once(source, old_enriched, new_enriched, "fusion snapshot API -> carte")
    return source


def prepare_loader(source: str) -> str:
    pattern = re.compile(r"lb-community-map-votes-v2\\.js\\?v=[A-Za-z0-9._-]+")
    matches = pattern.findall(source)
    if len(matches) != 1:
        if f"lb-community-map-votes-v2.js?v={NEW_CACHE}" in source:
            return source
        raise RuntimeError(f"cache-bust chargeur : attendu 1 module V2, trouvé {len(matches)}")
    return pattern.sub(f"lb-community-map-votes-v2.js?v={NEW_CACHE}", source, count=1)


def node_check(text: str, label: str) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node est requis pour vérifier le JavaScript avant écriture")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as fh:
        fh.write(text)
        tmp = fh.name
    try:
        result = subprocess.run([node, "--check", tmp], capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError(f"JavaScript invalide ({label}) : {result.stderr.strip()}")
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temporary, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(temporary, st.st_uid, st.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="racine du site contenant assets/")
    parser.add_argument("--apply", action="store_true", help="appliquer réellement le correctif")
    args = parser.parse_args()

    root = locate_site_root(args.root)
    target = root / "assets" / TARGET_NAME
    loader = root / "assets" / LOADER_NAME

    before_target = target.read_bytes()
    before_loader = loader.read_bytes()
    text_target = before_target.decode("utf-8")
    text_loader = before_loader.decode("utf-8")

    patched_target = prepare_votes(text_target)
    patched_loader = prepare_loader(text_loader)

    node_check(patched_target, TARGET_NAME)
    node_check(patched_loader, LOADER_NAME)

    required = [
        MARK,
        "extractList(data)",
        "const orderedSignals = voteSignals.slice()",
        "travelerDelayMin:shouldPromote ? signal.delayMin : previous.travelerDelayMin",
        f"lb-community-map-votes-v2.js?v={NEW_CACHE}",
    ]
    combined = patched_target + "\n" + patched_loader
    missing = [token for token in required if token not in combined]
    if missing:
        raise RuntimeError("validation interne échouée, éléments absents : " + ", ".join(missing))

    print("============================================================")
    print(" VOIX DU BÉTAIL -> CARTE V3 — CORRECTIF CIBLÉ")
    print("============================================================")
    print("Site      :", root)
    print("Module    :", target)
    print("Chargeur  :", loader)
    print("✓ aucun GTFS/HAFAS/routage touché")
    print("✓ aucun service redémarré")
    print("✓ aucun polling ajouté")
    print("✓ timestamp API secondes/millisecondes normalisé")
    print("✓ formats comments/signals/items/data/results acceptés")
    print("✓ signalements API absents du snapshot natif ajoutés à la carte")
    print("✓ état natif/presence existant conservé")
    print("✓ JavaScript vérifié avec node --check")

    if patched_target == text_target and patched_loader == text_loader:
        print("Déjà installé — aucune modification nécessaire.")
        return

    if not args.apply:
        print("\nSIMULATION uniquement : aucun fichier modifié.")
        print("Relancer avec --apply après lecture de ce diagnostic.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = root / ".lb-backups" / f"community-voice-map-v3-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(target, backup / target.name)
    shutil.copy2(loader, backup / loader.name)

    if target.read_bytes() != before_target or loader.read_bytes() != before_loader:
        raise RuntimeError("un fichier a changé pendant la vérification : arrêt avant écriture")

    changed: list[tuple[Path, bytes]] = []
    try:
        if patched_target.encode("utf-8") != before_target:
            atomic_write(target, patched_target.encode("utf-8"))
            changed.append((target, before_target))
        if patched_loader.encode("utf-8") != before_loader:
            atomic_write(loader, patched_loader.encode("utf-8"))
            changed.append((loader, before_loader))

        if target.read_text(encoding="utf-8") != patched_target:
            raise RuntimeError("vérification post-écriture du module échouée")
        if loader.read_text(encoding="utf-8") != patched_loader:
            raise RuntimeError("vérification post-écriture du chargeur échouée")
    except BaseException:
        for path, original in reversed(changed):
            atomic_write(path, original)
        print("ERREUR : retour arrière automatique effectué.")
        raise

    print("\nINSTALLÉ.")
    print("Sauvegarde :", backup)
    print("SHA256 module   :", hashlib.sha256(target.read_bytes()).hexdigest())
    print("SHA256 chargeur :", hashlib.sha256(loader.read_bytes()).hexdigest())
    print("\nRetour arrière manuel :")
    print(f"sudo cp -a '{backup / target.name}' '{target}'")
    print(f"sudo cp -a '{backup / loader.name}' '{loader}'")
    print("\nTest conseillé : ouvrir la carte, vérifier 88507 (+45 min*) puis 88509 (+5 min*).")
    print("Un rechargement complet de la PWA peut être nécessaire une fois à cause du cache client.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT SÉCURISÉ : " + str(exc))
