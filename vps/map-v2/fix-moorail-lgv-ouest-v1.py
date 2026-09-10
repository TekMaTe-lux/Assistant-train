#!/usr/bin/env python3
"""
MOO RAIL — FIX LGV OUEST V1

Corrige uniquement les TGV/OUIGO du corridor Ouest qui utilisent encore
l'ancienne ligne classique Paris–Chartres–Nogent-le-Rotrou–Le Mans.

Le calcul de remplacement réutilise le routeur AUTO LGV V4.1/V3 déjà validé
sur le VPS. Aucun HTML n'est modifié : la carte lit la géométrie depuis SQLite.

Sécurité : travail sur copies SQLite, contrôles, sauvegardes, swap atomique,
rollback si le snapshot France ne repart pas. Le mode --post-update est prévu
pour l'ExecStartPost du rafraîchissement GTFS et évite de manipuler systemd.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time
import traceback
import unicodedata
import zlib

ROOT = Path("/opt/lb-rail-engine-v1")
MAPROOT = Path("/opt/labetaillere-map-v2-src/map-v2")
DATA = ROOT / "data"
STATE = ROOT / "state"
TMPROOT = ROOT / "tmp"
BACKUPS = DATA / "backups"
DB_NAMES = ("timetable-v3-preview.sqlite", "timetable-v3-france-preview.sqlite")
FRANCE_DB = "timetable-v3-france-preview.sqlite"
SNAPSHOT = MAPROOT / "public/data/france-v3-active-now.json"
UNITS = ("lb-rail-v3-hot-snapshot", "lb-rail-v3-france-hot-snapshot-preview")

COMPILER_CANDIDATES = (
    ROOT / "app/compiler_moorail_auto_lgv_v4_1.py",
    Path("/home/ubuntu/compiler-moorail-auto-lgv-v4.1.py"),
)

# La mauvaise ligne visible sur la capture : Paris–Chartres–Nogent–Le Mans.
# Un TGV normal vers Bretagne/Pays de la Loire ne doit pas suivre CES DEUX zones.
WRONG_WAYPOINTS = {
    "Chartres": (1.4810, 48.4485),
    "Nogent-le-Rotrou": (0.8210, 48.3212),
}
WRONG_RADIUS_M = 25_000.0

# Filtre géographique du corridor Ouest : Bretagne/Pays de la Loire/Le Mans
# d'un côté, Paris/IDF ou au-delà de l'autre. Cela exclut Bordeaux/SEA.
WEST_MAX_LON = 0.50
WEST_MIN_LAT = 47.00
EAST_MIN_LON = 1.50
EAST_MIN_LAT = 47.00

# Un parcours Ouest corrigé doit réellement reprendre une quantité significative
# de LGV. Paris–Le Mans V4.1 donne ~181 km de LGV (plus ~20 km validés).
MIN_NEW_LGV_M = 100_000.0


def say(*x):
    print(*x, flush=True)


def norm(s: object) -> str:
    t = unicodedata.normalize("NFD", str(s or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return "".join(c for c in t.upper() if c.isalnum())


def hav(a, b) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def min_distance(coords, point) -> float:
    if not coords:
        return float("inf")
    step = max(1, len(coords) // 4000)
    return min(hav((float(p[0]), float(p[1])), point) for p in coords[::step])


def wrong_corridor_metrics(coords):
    distances = {name: min_distance(coords, xy) for name, xy in WRONG_WAYPOINTS.items()}
    wrong = all(v <= WRONG_RADIUS_M for v in distances.values())
    return wrong, distances


def decode_coords(blob):
    obj = json.loads(zlib.decompress(blob))
    coords = obj.get("coordinates") if isinstance(obj, dict) else obj
    if not isinstance(coords, list) or len(coords) < 2:
        raise RuntimeError("payload rail_paths sans coordinates valides")
    return [(float(p[0]), float(p[1])) for p in coords]


def choose_compiler() -> Path:
    for p in COMPILER_CANDIDATES:
        if p.exists():
            return p
    raise RuntimeError(
        "Compilateur V4.1 absent (attendu dans /opt/lb-rail-engine-v1/app ou /home/ubuntu)."
    )


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if not spec or not spec.loader:
        raise RuntimeError(f"Import impossible : {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def west_crossing(stops) -> bool:
    west = any(lon <= WEST_MAX_LON and lat >= WEST_MIN_LAT for _name, lon, lat in stops)
    east = any(lon >= EAST_MIN_LON and lat >= EAST_MIN_LAT for _name, lon, lat in stops)
    return west and east


def sqlite_backup(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def db_signature(path: Path):
    st = path.stat()
    return (st.st_size, st.st_mtime_ns)


def atomic_replace_from(source: Path, target: Path):
    st = target.stat() if target.exists() else None
    fd, tmp = tempfile.mkstemp(prefix=".lgv-ouest-v1-", dir=str(target.parent))
    os.close(fd)
    try:
        shutil.copyfile(source, tmp)
        if st is not None:
            os.chmod(tmp, st.st_mode & 0o777)
            if os.geteuid() == 0:
                os.chown(tmp, st.st_uid, st.st_gid)
        else:
            os.chmod(tmp, 0o644)
        with open(tmp, "rb") as fh:
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def systemctl(*args, check=True):
    return subprocess.run(
        ["systemctl", *args],
        check=check,
        text=True,
        capture_output=True,
        timeout=60,
    )


def current_active_units():
    out = []
    for u in UNITS:
        r = systemctl("is-active", "--quiet", u, check=False)
        if r.returncode == 0:
            out.append(u)
    return out


def path_row(db, pk):
    return db.execute(
        """
        SELECT g.path_id,p.length_m,p.payload_zlib,g.offsets_json
        FROM trip_geometry g
        JOIN rail_paths p ON p.path_id=g.path_id
        WHERE g.trip_pk=?
        """,
        (pk,),
    ).fetchone()


def update_trip_geometry(db, pk, trip_id, pid, offsets):
    cols = {r[1] for r in db.execute("PRAGMA table_info(trip_geometry)")}
    fields = ["path_id=?", "offsets_json=?"]
    values = [pid, json.dumps([round(float(x), 3) for x in offsets], separators=(",", ":"))]

    optional = {
        "geometry_trip_id": str(trip_id),
        "source": "MOORAIL_LGV_OUEST_V1",
        "geometry_source": "MOORAIL_LGV_OUEST_V1",
        "geometrySource": "MOORAIL_LGV_OUEST_V1",
        "repair_detail": "MOORAIL_LGV_OUEST_V1",
        "repairDetail": "MOORAIL_LGV_OUEST_V1",
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    for c, v in optional.items():
        if c in cols:
            fields.append(f'"{c}"=?')
            values.append(v)
    values.append(pk)
    db.execute(f"UPDATE trip_geometry SET {','.join(fields)} WHERE trip_pk=?", values)


def route_trip(db, compiler, router, graph, ebins, ecell, stops, pair_cache):
    parts = []
    lgv_m = 0.0
    validated_m = 0.0
    rfn_m = 0.0
    stitch_m = 0.0
    pair_details = []

    for (a, _alon, _alat), (b, _blon, _blat) in zip(stops, stops[1:]):
        key = (a, b)
        if key not in pair_cache:
            pair_cache[key] = compiler.attach_route(router, graph, ebins, ecell, db, a, b)
        r = pair_cache[key]
        if not r.get("ok"):
            raise RuntimeError(f"{a} -> {b}: {r.get('reason')}")
        meters = r.get("meters") or {}
        lgv_m += float(meters.get("lgv", 0.0))
        validated_m += float(meters.get("validated", 0.0))
        rfn_m += float(meters.get("rfn", 0.0))
        stitch_m += float(meters.get("stitch", 0.0))
        pair_details.append({
            "from": a,
            "to": b,
            "km": round(float(r["length_m"]) / 1000, 3),
            "lgv_km": round(float(meters.get("lgv", 0.0)) / 1000, 3),
        })
        parts.append((r["coords"], r["length_m"]))

    coords, offsets, total = compiler.merge_coords(parts, router)
    if len(coords) < 2:
        raise RuntimeError("route finale vide")
    return coords, offsets, total, {
        "lgv_m": lgv_m,
        "validated_m": validated_m,
        "rfn_m": rfn_m,
        "stitch_m": stitch_m,
        "pairs": pair_details,
    }


def repair_candidate(db_path: Path, compiler, router, graph, ebins, ecell, pair_cache):
    db = sqlite3.connect(str(db_path))
    db.execute("PRAGMA foreign_keys=ON")
    compiler.require_schema(db)
    trip_rows, _textcols = compiler.get_trip_rows(db)
    existing_paths = {r[0] for r in db.execute("SELECT path_id FROM rail_paths")}

    scanned = 0
    west = 0
    wrong = 0
    changed = []
    skipped_correct = 0
    failures = []
    witness = []

    try:
        db.execute("BEGIN IMMEDIATE")
        for tr in trip_rows:
            pk = tr["trip_pk"]
            num = str(tr.get("number") or "").strip()
            stops = compiler.trip_stops(db, pk)
            if len(stops) < 2:
                continue
            scanned += 1
            if not west_crossing(stops):
                continue
            west += 1

            old = path_row(db, pk)
            if not old:
                continue
            old_pid, old_len, old_blob, _old_offsets = old
            old_coords = decode_coords(old_blob)
            old_is_wrong, old_d = wrong_corridor_metrics(old_coords)

            if num == "8790":
                witness.append({
                    "trip_pk": pk,
                    "old_path_id": old_pid,
                    "chartres_km": round(old_d["Chartres"] / 1000, 2),
                    "nogent_km": round(old_d["Nogent-le-Rotrou"] / 1000, 2),
                    "wrong": old_is_wrong,
                    "stops": [s[0] for s in stops],
                })

            if not old_is_wrong:
                skipped_correct += 1
                continue
            wrong += 1

            try:
                coords, offsets, total, usage = route_trip(
                    db, compiler, router, graph, ebins, ecell, stops, pair_cache
                )
                new_wrong, new_d = wrong_corridor_metrics(coords)
                if new_wrong:
                    raise RuntimeError(
                        "le nouveau calcul reste sur Chartres/Nogent : publication refusée"
                    )
                if usage["lgv_m"] < MIN_NEW_LGV_M:
                    raise RuntimeError(
                        f"LGV insuffisante : {usage['lgv_m']/1000:.1f} km (< {MIN_NEW_LGV_M/1000:.0f} km)"
                    )

                pid = compiler.deterministic_path_id(coords)
                if pid not in existing_paths:
                    compiler.insert_rail_path(db, pid, coords, total)
                    existing_paths.add(pid)
                trip_id = str(tr.get("trip_id") or "")
                if not trip_id:
                    raise RuntimeError("trip_id vide")
                update_trip_geometry(db, pk, trip_id, pid, offsets)

                changed.append({
                    "trip_pk": pk,
                    "number": num,
                    "old_path_id": old_pid,
                    "new_path_id": pid,
                    "old_km": round(float(old_len) / 1000, 3),
                    "new_km": round(float(total) / 1000, 3),
                    "lgv_km": round(usage["lgv_m"] / 1000, 3),
                    "validated_km": round(usage["validated_m"] / 1000, 3),
                    "rfn_km": round(usage["rfn_m"] / 1000, 3),
                    "old_chartres_km": round(old_d["Chartres"] / 1000, 2),
                    "old_nogent_km": round(old_d["Nogent-le-Rotrou"] / 1000, 2),
                    "new_chartres_km": round(new_d["Chartres"] / 1000, 2),
                    "new_nogent_km": round(new_d["Nogent-le-Rotrou"] / 1000, 2),
                    "stops": [s[0] for s in stops],
                    "pairs": usage["pairs"],
                })
            except Exception as exc:
                failures.append({"trip_pk": pk, "number": num, "error": str(exc)})

        if failures:
            raise RuntimeError(
                f"{len(failures)} TGV Ouest n'ont pas pu être recalculés ; transaction annulée. "
                + " | ".join(f"{x['number']}: {x['error']}" for x in failures[:5])
            )

        for c in changed:
            row = path_row(db, c["trip_pk"])
            if not row or row[0] != c["new_path_id"]:
                raise RuntimeError(f"trip_pk {c['trip_pk']} n'utilise pas le nouveau path")
            coords = decode_coords(row[2])
            bad, _dist = wrong_corridor_metrics(coords)
            if bad:
                raise RuntimeError(f"trip {c['number']} encore sur la ligne classique")
            offsets = json.loads(row[3])
            nstops = db.execute("SELECT COUNT(*) FROM stop_times WHERE trip_pk=?", (c["trip_pk"],)).fetchone()[0]
            if len(offsets) != nstops:
                raise RuntimeError(f"trip {c['number']} offsets={len(offsets)} stops={nstops}")
            if any(float(offsets[i]) > float(offsets[i + 1]) + 1e-6 for i in range(len(offsets) - 1)):
                raise RuntimeError(f"trip {c['number']} offsets non monotones")
            if offsets and abs(float(offsets[-1]) - float(row[1])) > 150.0:
                raise RuntimeError(f"trip {c['number']} offset final incohérent")

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"PRAGMA integrity_check={integrity}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    return {
        "db": str(db_path),
        "highspeed_scanned": scanned,
        "west_crossing": west,
        "wrong_before": wrong,
        "skipped_already_correct": skipped_correct,
        "changed": changed,
        "changed_count": len(changed),
        "failures": failures,
        "witness_8790": witness,
    }


def wait_snapshot(after_ts: float, expected_by_number: dict[str, set[str]], timeout=45):
    deadline = time.time() + timeout
    last_error = "snapshot absent"
    while time.time() < deadline:
        try:
            if SNAPSHOT.exists() and SNAPSHOT.stat().st_mtime >= after_ts:
                data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
                if not data.get("ok") or int(data.get("count") or 0) <= 0:
                    last_error = "snapshot présent mais non sain"
                else:
                    bad = []
                    seen = 0
                    trains = data.get("trains") or []
                    if isinstance(trains, dict):
                        trains = list(trains.values())
                    for t in trains:
                        num = str(t.get("number") or t.get("trainNumber") or "")
                        if num in expected_by_number:
                            seen += 1
                            pid = str(t.get("pathId") or t.get("path_id") or "")
                            if pid and pid not in expected_by_number[num]:
                                bad.append((num, pid))
                    if bad:
                        last_error = f"snapshot garde un ancien path : {bad[:5]}"
                    else:
                        return True, f"snapshot OK ({data.get('count')} trains, {seen} corrigé(s) visible(s))"
        except Exception as exc:
            last_error = repr(exc)
        time.sleep(1)
    return False, last_error


def prune_backups(keep=3):
    dirs = sorted(
        [p for p in BACKUPS.glob("lgv-ouest-v1-*") if p.is_dir()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for p in dirs[keep:]:
        shutil.rmtree(p, ignore_errors=True)


def health_write(status, **extra):
    STATE.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        **extra,
    }
    tmp = STATE / ".lgv-ouest-v1-health.tmp"
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE / "lgv-ouest-v1-health.json")


def main():
    ap = argparse.ArgumentParser(description="Corrige les TGV Ouest qui passent encore par Chartres/Nogent au lieu de la LGV.")
    ap.add_argument("--apply", action="store_true", help="Publie les candidats validés.")
    ap.add_argument("--post-update", action="store_true", help="Mode automatique après mise à jour GTFS (pas de stop/restart systemd).")
    args = ap.parse_args()

    say("=" * 120)
    say(" MOO RAIL — FIX LGV OUEST V1")
    say(" MODE :", "POST-UPDATE" if args.post_update else ("APPLY" if args.apply else "DIAGNOSTIC"))
    say(" CIBLE : TGV/OUIGO Ouest utilisant Paris–Chartres–Nogent–Le Mans")
    say("=" * 120)

    compiler_path = choose_compiler()
    say("Compilateur :", compiler_path)
    compiler = load_module(compiler_path, "moorail_compiler_v41_for_west_fix")
    router = compiler.load_router()

    STATE.mkdir(parents=True, exist_ok=True)
    lock_path = STATE / "gtfs-update.lock"
    lock_fh = lock_path.open("a+")
    try:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("Mise à jour GTFS en cours : rien n'est modifié, relancer après sa fin.")

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    work = TMPROOT / f"lgv-ouest-v1-{stamp}"
    work.mkdir(parents=True, exist_ok=False)
    report_path = work / "report.json"

    sources = []
    signatures = {}
    for name in DB_NAMES:
        live = DATA / name
        if not live.exists():
            if name == FRANCE_DB:
                raise RuntimeError(f"DB France absente : {live}")
            continue
        candidate = work / name
        signatures[name] = db_signature(live)
        sqlite_backup(live, candidate)
        sources.append((name, live, candidate))

    say("Construction du graphe V4.1 (une seule fois)…")
    graph, ebins, ecell = compiler.build_graph(router)
    pair_cache = {}
    reports = {}
    total_changes = 0

    for name, _live, candidate in sources:
        say("\nAnalyse :", name)
        rep = repair_candidate(candidate, compiler, router, graph, ebins, ecell, pair_cache)
        reports[name] = rep
        total_changes += rep["changed_count"]
        say(
            "  TGV Ouest:", rep["west_crossing"],
            "| mauvaise ligne:", rep["wrong_before"],
            "| corrigés:", rep["changed_count"],
            "| déjà corrects:", rep["skipped_already_correct"],
        )
        for w in rep["witness_8790"][:8]:
            say(
                "  8790 :", w["old_path_id"],
                "| Chartres", w["chartres_km"], "km",
                "| Nogent", w["nogent_km"], "km",
                "|", "MAUVAIS" if w["wrong"] else "déjà hors ligne classique",
            )

    report = {
        "version": "MOORAIL_LGV_OUEST_V1",
        "created_at": dt.datetime.now().isoformat(),
        "compiler": str(compiler_path),
        "wrong_radius_km": WRONG_RADIUS_M / 1000,
        "reports": reports,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    say("\nRapport :", report_path)

    france_rep = reports.get(FRANCE_DB, {})
    if france_rep.get("witness_8790"):
        if not any(x.get("wrong") for x in france_rep["witness_8790"]):
            say("INFO : les variantes 8790 présentes dans la DB ne passent plus dans les 25 km de Chartres ET Nogent.")

    if total_changes == 0:
        say("\nFIN OK — aucun TGV Ouest n'utilise actuellement la mauvaise ligne détectée.")
        health_write("ok_no_change", report=str(report_path))
        return 0

    say("\nExemples de corrections France :")
    for c in france_rep.get("changed", [])[:25]:
        say(
            f"  {c['number']:>6} | {c['old_km']:.1f} -> {c['new_km']:.1f} km",
            f"| LGV {c['lgv_km']:.1f} km",
            f"| Chartres {c['old_chartres_km']:.1f}->{c['new_chartres_km']:.1f} km",
            f"| {c['old_path_id']} -> {c['new_path_id']}",
        )

    if not args.apply:
        say("\nDIAGNOSTIC OK — candidats validés, AUCUN FICHIER ACTIF MODIFIÉ.")
        say("Relancer avec --apply pour publier.")
        health_write("diagnostic_ok", changes=total_changes, report=str(report_path))
        return 0

    for name, live, _candidate in sources:
        if db_signature(live) != signatures[name]:
            raise RuntimeError(f"{name} a changé pendant le calcul : publication annulée.")

    backup_dir = BACKUPS / f"lgv-ouest-v1-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    for name, live, _candidate in sources:
        sqlite_backup(live, backup_dir / name)
    shutil.copy2(report_path, backup_dir / "report.json")
    say("Backup :", backup_dir)

    active_units = [] if args.post_update else current_active_units()
    if not args.post_update and "lb-rail-v3-france-hot-snapshot-preview" not in active_units:
        raise RuntimeError("Snapshot France non actif : publication annulée avant swap.")

    published = []
    swap_ts = time.time()
    try:
        if active_units:
            for u in active_units:
                systemctl("stop", u)

        for name, live, candidate in sources:
            if reports[name]["changed_count"] <= 0:
                continue
            atomic_replace_from(candidate, live)
            published.append((name, live))

        if active_units:
            for u in active_units:
                systemctl("start", u)

            expected = {}
            for c in france_rep.get("changed", []):
                expected.setdefault(str(c["number"]), set()).add(str(c["new_path_id"]))
            ok, msg = wait_snapshot(swap_ts, expected)
            say("Snapshot :", msg)
            if not ok:
                raise RuntimeError("Nouveau snapshot France non validé : " + msg)

        for name, live in published:
            db = sqlite3.connect(f"file:{live}?mode=ro", uri=True)
            try:
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError(f"{name} invalide après publication")
            finally:
                db.close()

    except BaseException:
        say("ERREUR APRES SWAP — ROLLBACK automatique…")
        for u in active_units:
            systemctl("stop", u, check=False)
        for name, live in published:
            atomic_replace_from(backup_dir / name, live)
        for u in active_units:
            systemctl("start", u, check=False)
        health_write("rolled_back", backup=str(backup_dir), report=str(report_path))
        raise

    prune_backups(keep=3)
    health_write(
        "ok",
        changes=total_changes,
        france_changes=france_rep.get("changed_count", 0),
        backup=str(backup_dir),
        report=str(report_path),
        post_update=bool(args.post_update),
    )

    say("\n" + "=" * 120)
    say(" APPLY OK — LGV OUEST CORRIGÉE")
    say("=" * 120)
    say("Corrections totales :", total_changes)
    say("Corrections France  :", france_rep.get("changed_count", 0))
    say("La page france-v3-preview.html n'a pas été touchée : elle prendra les nouveaux pathId dans le snapshot.")
    say("Backup              :", backup_dir)
    say("Health              :", STATE / "lgv-ouest-v1-health.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        say("\nCRITICAL — AUCUNE PUBLICATION NON VALIDÉE NE DOIT RESTER ACTIVE")
        say(type(exc).__name__ + ":", exc)
        traceback.print_exc()
        try:
            health_write("critical", error=str(exc))
        except Exception:
            pass
        raise SystemExit(2)
