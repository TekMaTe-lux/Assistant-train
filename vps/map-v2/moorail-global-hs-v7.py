#!/usr/bin/env python3
"""MooRail Global High-Speed Geometry V7.

Generic national repair layer. It does NOT target train numbers.

Architecture:
  * detects every high-speed family present in SNCF GTFS (INOUI/OUIGO HGV,
    Lyria, ICE, Eurostar/Thalys and explicit high-speed branding);
  * resolves every adjacent stop pair independently, so one missing local
    segment no longer invalidates an entire Brest/Paris or international trip;
  * prioritises an exact validated/editor section, then the physical RFN/LGV
    graph, then a short composition of validated sections, then a plausible
    previous segment;
  * if no rail source exists for a short unresolved cross-border/local gap,
    uses a clearly tagged synthetic continuity segment instead of sending the
    train onto an unrelated railway;
  * writes one coherent path + stop offsets and atomically publishes a
    validated SQLite candidate, with rollback if the France snapshot fails.

The graph itself lives in moorail_router_global_v7.py. It includes the
provisional Pasilly-Aisy topology bridge (RFN 768300 missing from the current
source extract), so Paris <-> Dijon/BFC/Mulhouse/Switzerland can rejoin the LGV.
"""
from __future__ import annotations

import argparse
import bisect
import datetime as dt
import fcntl
import hashlib
import heapq
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import traceback
import unicodedata
import zlib
from collections import Counter, defaultdict

ROOT = Path(os.environ.get("MOORAIL_ROOT", "/opt/lb-rail-engine-v1"))
MAPROOT = Path(os.environ.get("MOORAIL_MAPROOT", "/opt/labetaillere-map-v2-src/map-v2"))
APP = ROOT / "app"
DATA = ROOT / "data"
STATE = ROOT / "state"
BACKUPS = DATA / "backups"
DB = DATA / "timetable-v3-france-preview.sqlite"
SNAPSHOT = MAPROOT / "public/data/france-v3-active-now.json"
ROUTER_PATH = APP / "moorail_router_global_v7.py"
EDITOR = MAPROOT / "public/data/moorail-live-v1/sections.json"
CODE = MAPROOT / "public/data/moorail-code-v1/sections.json"
HOT_UNIT = "lb-rail-v3-france-hot-snapshot-preview"
LOCK = STATE / "moorail-global-hs-v7.lock"

VERSION = "MOORAIL_GLOBAL_HS_V7"
PATH_PREFIX = "p-global-hs-v7-"
MAX_SEGMENT_DETOUR_RATIO = 1.82
MAX_SYNTHETIC_DIRECT_M = 190_000.0
MAX_STATION_ENDPOINT_ERROR_M = 3500.0
MAX_HS_AVG_KMH = 345.0
GRAPH_LGV_TRIGGER_M = 25_000.0

# TRN is intentionally absent: in this project it is OUIGO Train Classique.
HS_CODES = {
    "OUI", "OGO", "LYR", "ICE", "EUR", "EUS", "EST", "THA", "TGV",
}
HS_WORDS = (
    "TGV", "OUIGO", "LYRIA", "EUROSTAR", "THALYS", "ICE",
    "FRECCIAROSSA", "TRENITALIA",
)
CLASSIC_WORDS = ("TRAIN CLASSIQUE", "OUIGO CLASSIQUE", "OUIGO TRAIN CLASSIQUE")
WITNESS_NUMBERS = {"8602", "9713", "6702", "9203", "9264"}  # logging only


def say(*x):
    print(*x, flush=True)


def strip_accents(s: object) -> str:
    t = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def station_key(s: object) -> str:
    t = strip_accents(s).upper()
    t = re.sub(r"[^A-Z0-9]+", " ", t).strip()
    t = re.sub(r"^PARIS GARE DE LYON HALL [0-9 ]+$", "PARIS GARE DE LYON", t)
    t = re.sub(r"^PARIS GARE DE LYON HALL$", "PARIS GARE DE LYON", t)
    return re.sub(r"\s+", " ", t)


def hav(a, b) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def cumulative(coords):
    cu = [0.0]
    total = 0.0
    for a, b in zip(coords, coords[1:]):
        total += hav(a, b)
        cu.append(total)
    return cu, total


def merge_coords(parts):
    out = []
    offsets = [0.0]
    total = 0.0
    for pts in parts:
        if len(pts) < 2:
            raise RuntimeError("segment vide")
        for p in pts:
            q = (round(float(p[0]), 6), round(float(p[1]), 6))
            if out and q == out[-1]:
                continue
            if out:
                total += hav(out[-1], q)
            out.append(q)
        offsets.append(total)
    cu, total2 = cumulative(out)
    offsets[-1] = total2
    return out, cu, offsets, total2


def interpolate_on_path(coords, cu, d):
    if not coords:
        return None
    if d <= 0:
        return tuple(coords[0])
    if d >= cu[-1]:
        return tuple(coords[-1])
    i = max(0, min(len(coords) - 2, bisect.bisect_right(cu, d) - 1))
    span = cu[i + 1] - cu[i]
    r = (d - cu[i]) / span if span > 0 else 0.0
    return (
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * r,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * r,
    )


def slice_path(coords, cu, d0, d1):
    if d1 < d0:
        d0, d1 = d1, d0
    d0 = max(0.0, min(float(d0), cu[-1]))
    d1 = max(0.0, min(float(d1), cu[-1]))
    if d1 <= d0 + 0.01:
        return []
    out = [interpolate_on_path(coords, cu, d0)]
    lo = bisect.bisect_right(cu, d0)
    hi = bisect.bisect_left(cu, d1)
    for i in range(lo, hi + 1):
        if 0 <= i < len(coords) and d0 < cu[i] < d1:
            out.append(tuple(coords[i]))
    out.append(interpolate_on_path(coords, cu, d1))
    dedup = []
    for p in out:
        if p is not None and (not dedup or hav(dedup[-1], p) > 0.05):
            dedup.append(p)
    return dedup


def decode_payload(blob):
    obj = json.loads(zlib.decompress(blob))
    if isinstance(obj, dict):
        coords = obj.get("coordinates")
        cu = obj.get("cumulative")
    else:
        coords = obj
        cu = None
    if not isinstance(coords, list) or len(coords) < 2:
        raise ValueError("coordinates absentes")
    clean = [(float(p[0]), float(p[1])) for p in coords]
    if not isinstance(cu, list) or len(cu) != len(clean):
        cu, _ = cumulative(clean)
    else:
        cu = [float(x) for x in cu]
    if not cu or cu[-1] <= 0:
        cu, _ = cumulative(clean)
    return clean, cu, obj


def densified_direct(a, b, spacing=5000.0):
    d = hav(a, b)
    steps = max(1, int(math.ceil(d / spacing)))
    return [
        (
            a[0] + (b[0] - a[0]) * i / steps,
            a[1] + (b[1] - a[1]) * i / steps,
        )
        for i in range(steps + 1)
    ]


def route_code(trip_id: str) -> str:
    parts = str(trip_id or "").split(":")
    return parts[1].upper() if len(parts) > 1 else ""


def is_high_speed(rec, textcols) -> bool:
    blob = " | ".join(str(rec.get(c) or "") for c in textcols).upper()
    if any(w in blob for w in CLASSIC_WORDS):
        return False
    code = route_code(str(rec.get("trip_id") or ""))
    if code in HS_CODES:
        return True
    if code == "TRN":
        return "FRECCIAROSSA" in blob or "TRENITALIA" in blob
    return any(re.search(r"(^|[^A-Z0-9])" + re.escape(w) + r"([^A-Z0-9]|$)", blob) for w in HS_WORDS)


def table_columns(db, table):
    return [r[1] for r in db.execute(f"PRAGMA table_info({table})")]


def high_speed_trips(db):
    cols = table_columns(db, "trips")
    textcols = []
    for r in db.execute("PRAGMA table_info(trips)"):
        typ = str(r[2] or "").upper()
        if "CHAR" in typ or "TEXT" in typ or typ == "":
            textcols.append(r[1])
    wanted = ["trip_pk", "trip_id", "number"] + [c for c in textcols if c not in ("trip_pk", "trip_id", "number")]
    wanted = [c for c in wanted if c in cols]
    rows = []
    for row in db.execute("SELECT " + ",".join(f'"{c}"' for c in wanted) + " FROM trips"):
        rec = dict(zip(wanted, row))
        if is_high_speed(rec, textcols):
            rows.append(rec)
    return rows, textcols


def stop_rows(db, pk):
    return db.execute(
        """
        SELECT st.seq,st.arrival_sec,st.departure_sec,s.stop_id,s.name,s.lon,s.lat
        FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk
        WHERE st.trip_pk=? ORDER BY st.seq
        """,
        (pk,),
    ).fetchall()


def scheduled_duration(sa, sb):
    dep = sa[2] if sa[2] is not None else sa[1]
    arr = sb[1] if sb[1] is not None else sb[2]
    if dep is None or arr is None:
        return None
    d = float(arr) - float(dep)
    while d < 0:
        d += 86400
    return d


def segment_bound(direct):
    return max(direct * MAX_SEGMENT_DETOUR_RATIO, direct + 18_000.0)


def time_plausible(length_m, duration_s):
    if duration_s is None or duration_s <= 0 or length_m < 1000:
        return True
    return length_m / (MAX_HS_AVG_KMH / 3.6) <= duration_s + 90.0


def segment_plausible(length_m, direct_m, duration_s, endpoint_error=0.0):
    if length_m <= 0 or direct_m <= 0:
        return False
    if length_m > segment_bound(direct_m):
        return False
    if endpoint_error > MAX_STATION_ENDPOINT_ERROR_M:
        return False
    if not time_plausible(length_m, duration_s):
        return False
    return True


class SectionCatalog:
    def __init__(self):
        self.direct = defaultdict(list)
        self.adj = defaultdict(list)
        self.labels = {}
        self._load()

    @staticmethod
    def _coords(row):
        out = []
        for p in row.get("coords") or []:
            if not isinstance(p, (list, tuple)) or len(p) < 2:
                continue
            lat, lon = float(p[0]), float(p[1])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                out.append((round(lon, 6), round(lat, 6)))
        return out

    def _load(self):
        seen = set()
        for source, path in (("validated", EDITOR), ("code", CODE)):
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for row in data.get("pairs") or []:
                a, b = str(row.get("from") or ""), str(row.get("to") or "")
                ka, kb = station_key(a), station_key(b)
                coords = self._coords(row)
                if not ka or not kb or len(coords) < 2:
                    continue
                cu, length = cumulative(coords)
                direct = hav(coords[0], coords[-1])
                if length < 20 or length > 1_500_000 or (direct > 5000 and length / direct > 2.8):
                    continue
                sig = (ka, kb, row.get("sectionId"), round(length))
                if sig in seen:
                    continue
                seen.add(sig)
                e = {
                    "from": a, "to": b, "ka": ka, "kb": kb,
                    "coords": coords, "length_m": length,
                    "section_id": str(row.get("sectionId") or ""), "source": source,
                }
                self.labels.setdefault(ka, a)
                self.labels.setdefault(kb, b)
                self.direct[(ka, kb)].append(e)
                self.adj[ka].append(e)

    def exact(self, a_name, b_name, pa, pb, duration):
        ka, kb = station_key(a_name), station_key(b_name)
        rows = []
        for e in self.direct.get((ka, kb), []):
            err = max(hav(pa, e["coords"][0]), hav(pb, e["coords"][-1]))
            direct = hav(pa, pb)
            if segment_plausible(e["length_m"], direct, duration, err):
                rows.append((err, e["length_m"], e))
        return min(rows, default=(None, None, None), key=lambda x: (x[0], x[1]))[2]

    def composed(self, a_name, b_name, pa, pb, duration, max_hops=6):
        start, goal = station_key(a_name), station_key(b_name)
        if start == goal:
            return None
        pq = [(0.0, 0, start, [])]
        best = {(start, 0): 0.0}
        winner = None
        while pq:
            dist, hops, node, path = heapq.heappop(pq)
            if node == goal:
                winner = (dist, path)
                break
            if hops >= max_hops:
                continue
            for e in self.adj.get(node, ()):
                nd = dist + e["length_m"]
                state = (e["kb"], hops + 1)
                if nd < best.get(state, float("inf")):
                    best[state] = nd
                    heapq.heappush(pq, (nd, hops + 1, e["kb"], path + [e]))
        if not winner:
            return None
        _dist, path = winner
        coords = []
        ids = []
        for e in path:
            ids.append(e["section_id"])
            for p in e["coords"]:
                if not coords or hav(coords[-1], p) > 0.05:
                    coords.append(p)
        _cu, length = cumulative(coords)
        endpoint_error = max(hav(pa, coords[0]), hav(pb, coords[-1]))
        direct = hav(pa, pb)
        if direct > 10_000 and length > max(1.55 * direct, direct + 22_000):
            return None
        if not segment_plausible(length, direct, duration, endpoint_error):
            return None
        return {"coords": coords, "length_m": length, "section_ids": ids}


def load_router():
    if not ROUTER_PATH.exists():
        raise RuntimeError(f"routeur global absent : {ROUTER_PATH}")
    spec = importlib.util.spec_from_file_location("moorail_router_global_v7", str(ROUTER_PATH))
    if not spec or not spec.loader:
        raise RuntimeError("import routeur global impossible")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def old_trip_path(db, pk):
    row = db.execute(
        """
        SELECT g.path_id,g.offsets_json,g.geometry_trip_id,p.length_m,p.payload_zlib
        FROM trip_geometry g JOIN rail_paths p ON p.path_id=g.path_id
        WHERE g.trip_pk=?
        """,
        (pk,),
    ).fetchone()
    if not row:
        return None
    try:
        coords, cu, obj = decode_payload(row[4])
        offsets = [float(x) for x in json.loads(row[1])]
    except Exception:
        return {"path_id": row[0], "invalid": True}
    return {
        "path_id": str(row[0]), "offsets": offsets, "geometry_trip_id": row[2],
        "length_m": float(row[3]), "coords": coords, "cumulative": cu, "payload": obj,
    }


def old_segment(old, index, pa, pb, duration):
    if not old or old.get("invalid") or len(old.get("offsets") or []) <= index + 1:
        return None
    pts = slice_path(old["coords"], old["cumulative"], old["offsets"][index], old["offsets"][index + 1])
    if len(pts) < 2:
        return None
    _cu, length = cumulative(pts)
    err = max(hav(pa, pts[0]), hav(pb, pts[-1]))
    direct = hav(pa, pb)
    return {
        "coords": pts, "length_m": length, "endpoint_error_m": err,
        "plausible": segment_plausible(length, direct, duration, err),
        "source": "old",
    }


def graph_candidate(router, g, eb, ec, pa, pb, duration, cache):
    key = (round(pa[0], 6), round(pa[1], 6), round(pb[0], 6), round(pb[1], 6))
    if key not in cache:
        fast = router.route_coords(g, eb, ec, pa, pb, distance_mode=False)
        shortest = router.route_coords(g, eb, ec, pa, pb, distance_mode=True)
        cache[key] = (fast, shortest)
    fast, shortest = cache[key]
    direct = hav(pa, pb)

    def usable(r):
        if not r:
            return False
        return segment_plausible(float(r["length_m"]), direct, duration, max(float(r.get("snap_a_m", 0)), float(r.get("snap_b_m", 0))))

    f_ok, d_ok = usable(fast), usable(shortest)
    if not f_ok and not d_ok:
        return None
    chosen = fast if f_ok else shortest
    if f_ok and d_ok and fast["length_m"] > shortest["length_m"] * 1.28 + 5000:
        chosen = shortest
    meters = {str(k): float(v) for k, v in dict(chosen.get("meters") or {}).items()}
    return {
        "coords": chosen["coords"], "length_m": float(chosen["length_m"]),
        "meters": meters, "source": "graph",
        "lgv_like_m": meters.get("lgv", 0.0) + meters.get("provisional", 0.0),
    }


def choose_segment(catalog, router, g, eb, ec, graph_cache, sa, sb, old, idx):
    a_name, b_name = str(sa[4]), str(sb[4])
    pa, pb = (float(sa[5]), float(sa[6])), (float(sb[5]), float(sb[6]))
    direct = hav(pa, pb)
    duration = scheduled_duration(sa, sb)
    oldc = old_segment(old, idx, pa, pb, duration)
    exact = catalog.exact(a_name, b_name, pa, pb, duration)
    graph = graph_candidate(router, g, eb, ec, pa, pb, duration, graph_cache)
    composed = catalog.composed(a_name, b_name, pa, pb, duration)

    if exact:
        return {
            "coords": exact["coords"], "length_m": exact["length_m"],
            "source": "validated_exact", "detail": exact["section_id"],
        }

    if graph:
        old_bad = not oldc or not oldc["plausible"]
        materially_better = oldc and graph["length_m"] + 5000 < oldc["length_m"] * 0.90
        uses_hgv = graph.get("lgv_like_m", 0.0) >= min(GRAPH_LGV_TRIGGER_M, max(6000.0, direct * 0.18))
        if old_bad or materially_better or uses_hgv:
            return {**graph, "detail": dict(graph.get("meters") or {})}

    if composed:
        old_bad = not oldc or not oldc["plausible"]
        materially_better = oldc and composed["length_m"] + 5000 < oldc["length_m"] * 0.90
        if old_bad or materially_better:
            return {
                "coords": composed["coords"], "length_m": composed["length_m"],
                "source": "validated_composed", "detail": composed["section_ids"],
            }

    if oldc and oldc["plausible"]:
        return oldc

    if graph:
        return {**graph, "detail": dict(graph.get("meters") or {})}
    if composed:
        return {
            "coords": composed["coords"], "length_m": composed["length_m"],
            "source": "validated_composed", "detail": composed["section_ids"],
        }

    if direct <= MAX_SYNTHETIC_DIRECT_M and time_plausible(direct, duration):
        pts = densified_direct(pa, pb)
        return {
            "coords": pts, "length_m": cumulative(pts)[1],
            "source": "synthetic_fallback", "detail": "NO_RAIL_SOURCE_SHORT_GAP",
        }

    return None


def update_geometry(db, pk, trip_id, pid, offsets):
    cols = set(table_columns(db, "trip_geometry"))
    fields = ["path_id=?", "offsets_json=?"]
    vals = [pid, json.dumps([round(float(x), 3) for x in offsets], separators=(",", ":"))]
    optional = {
        "geometry_trip_id": str(trip_id),
        "source": VERSION,
        "geometry_source": VERSION,
        "geometrySource": VERSION,
        "repair_detail": VERSION,
        "repairDetail": VERSION,
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    for c, v in optional.items():
        if c in cols:
            fields.append(f'"{c}"=?')
            vals.append(v)
    vals.append(pk)
    db.execute(f"UPDATE trip_geometry SET {','.join(fields)} WHERE trip_pk=?", vals)


def insert_path(db, pid, coords, cu, length, segment_meta):
    payload = {
        "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords],
        "cumulative": [round(float(x), 3) for x in cu],
        "length": round(float(length), 3),
        "profile": "tgv",
        "repairVersion": VERSION,
        "segmentSources": segment_meta,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    blob = zlib.compress(raw, 9)
    db.execute(
        "INSERT OR IGNORE INTO rail_paths(path_id,length_m,coord_count,payload_zlib) VALUES(?,?,?,?)",
        (pid, float(length), len(coords), sqlite3.Binary(blob)),
    )


def path_id(coords, segment_meta):
    sig = json.dumps(
        {"c": [[round(x, 6), round(y, 6)] for x, y in coords], "s": segment_meta},
        separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")
    return PATH_PREFIX + hashlib.sha256(sig).hexdigest()[:22]


def build_candidate(candidate: Path, report_path: Path):
    router = load_router()
    say("Construction graphe national V7…")
    g, eb, ec, graph_meta = router.build_graph()
    say("Graphe :", graph_meta)
    catalog = SectionCatalog()
    say("Sections validées dirigées :", sum(len(v) for v in catalog.direct.values()))

    db = sqlite3.connect(str(candidate))
    db.execute("PRAGMA foreign_keys=ON")
    trips, _textcols = high_speed_trips(db)
    say("Trains grande vitesse détectés :", len(trips))

    graph_cache = {}
    stats = Counter()
    changed = []
    witnesses = []
    unresolved = []
    pattern_cache = {}

    try:
        db.execute("BEGIN IMMEDIATE")
        for pos, tr in enumerate(trips, 1):
            pk = int(tr["trip_pk"])
            tid = str(tr.get("trip_id") or "")
            num = str(tr.get("number") or "")
            stops = stop_rows(db, pk)
            if len(stops) < 2 or any(s[5] is None or s[6] is None for s in stops):
                stats["bad_stops"] += 1
                continue

            old = old_trip_path(db, pk)
            sig = tuple(
                (
                    station_key(s[4]), round(float(s[5]), 6), round(float(s[6]), 6),
                    scheduled_duration(s, stops[i + 1]) if i + 1 < len(stops) else None,
                )
                for i, s in enumerate(stops)
            )
            cache_key = (sig, old.get("path_id") if old else None)
            cached = pattern_cache.get(cache_key)

            if cached is None:
                parts = []
                segmeta = []
                non_old = False
                failure = None
                for i, (sa, sb) in enumerate(zip(stops, stops[1:])):
                    chosen = choose_segment(catalog, router, g, eb, ec, graph_cache, sa, sb, old, i)
                    if not chosen:
                        failure = f"{sa[4]} -> {sb[4]}"
                        break
                    src = chosen["source"]
                    stats["segment_" + src] += 1
                    non_old = non_old or src != "old"
                    parts.append(chosen["coords"])
                    segmeta.append({
                        "from": str(sa[4]), "to": str(sb[4]), "source": src,
                        "km": round(float(chosen["length_m"]) / 1000, 3),
                        "detail": chosen.get("detail"),
                    })
                if failure:
                    cached = {"failure": failure}
                else:
                    coords, cu, offsets, length = merge_coords(parts)
                    pid = path_id(coords, segmeta)
                    cached = {
                        "coords": coords, "cu": cu, "offsets": offsets, "length": length,
                        "pid": pid, "segmeta": segmeta, "non_old": non_old,
                    }
                pattern_cache[cache_key] = cached

            if cached.get("failure"):
                unresolved.append({"number": num, "trip_id": tid, "reason": cached["failure"]})
                stats["unresolved_trip"] += 1
                continue

            if not cached["non_old"] and old and not old.get("invalid"):
                stats["trip_preserved"] += 1
                continue

            pid = cached["pid"]
            if not db.execute("SELECT 1 FROM rail_paths WHERE path_id=?", (pid,)).fetchone():
                insert_path(db, pid, cached["coords"], cached["cu"], cached["length"], cached["segmeta"])
            update_geometry(db, pk, tid, pid, cached["offsets"])
            stats["trip_changed"] += 1

            sources = Counter(x["source"] for x in cached["segmeta"])
            row = {
                "trip_pk": pk, "number": num, "trip_id": tid,
                "old_path_id": old.get("path_id") if old else None, "new_path_id": pid,
                "old_km": round(float(old.get("length_m", 0.0)) / 1000, 3) if old else None,
                "new_km": round(float(cached["length"]) / 1000, 3),
                "sources": dict(sources),
                "stops": [s[4] for s in stops],
                "segments": cached["segmeta"],
            }
            changed.append(row)
            if num in WITNESS_NUMBERS:
                witnesses.append(row)

            if pos % 500 == 0:
                say(f"{pos}/{len(trips)} | changed={stats['trip_changed']} preserved={stats['trip_preserved']} unresolved={stats['unresolved_trip']}")

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity_check={integrity}")

        bad = []
        for row in changed:
            pk = row["trip_pk"]
            r = db.execute(
                """
                SELECT g.path_id,g.offsets_json,p.length_m,p.coord_count,p.payload_zlib
                FROM trip_geometry g JOIN rail_paths p ON p.path_id=g.path_id
                WHERE g.trip_pk=?
                """,
                (pk,),
            ).fetchone()
            if not r or r[0] != row["new_path_id"]:
                bad.append((row["number"], "path reference")); continue
            try:
                co, cu, obj = decode_payload(r[4])
                off = [float(x) for x in json.loads(r[1])]
                stops = stop_rows(db, pk)
                if len(off) != len(stops):
                    raise ValueError("offset count")
                if any(off[i] > off[i + 1] + 0.01 for i in range(len(off) - 1)):
                    raise ValueError("offset monotonic")
                if abs(off[-1] - float(r[2])) > 180:
                    raise ValueError("final offset")
                if len(co) != int(r[3]):
                    raise ValueError("coord_count")
                errors = [hav((float(s[5]), float(s[6])), interpolate_on_path(co, cu, d)) for s, d in zip(stops, off)]
                if max(errors, default=0) > 5000:
                    raise ValueError(f"station alignment {max(errors):.0f}m")
                if isinstance(obj, dict) and obj.get("repairVersion") != VERSION:
                    raise ValueError("repairVersion")
            except Exception as exc:
                bad.append((row["number"], str(exc)))
        if bad:
            raise RuntimeError("candidate paths invalides: " + repr(bad[:10]))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    report = {
        "version": VERSION,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "db": str(candidate),
        "graph": graph_meta,
        "high_speed_trips": len(trips),
        "stats": dict(stats),
        "changed_count": len(changed),
        "unresolved_count": len(unresolved),
        "unresolved": unresolved[:500],
        "witnesses": witnesses,
        "changed": changed,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def sqlite_backup(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close(); src.close()


def atomic_replace_from(source: Path, target: Path):
    st = target.stat() if target.exists() else None
    fd, tmp = tempfile.mkstemp(prefix=".global-hs-v7-", dir=str(target.parent))
    os.close(fd)
    try:
        shutil.copyfile(source, tmp)
        if st:
            os.chmod(tmp, st.st_mode & 0o777)
            if os.geteuid() == 0:
                os.chown(tmp, st.st_uid, st.st_gid)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def systemctl(*args, check=True):
    return subprocess.run(["systemctl", *args], check=check, capture_output=True, text=True, timeout=60)


def snapshot_stamp():
    if not SNAPSHOT.exists():
        return (0, 0)
    s = SNAPSHOT.stat()
    return (s.st_mtime_ns, s.st_size)


def wait_snapshot(old_stamp, timeout=45):
    deadline = time.time() + timeout
    last = "pas encore renouvelé"
    while time.time() < deadline:
        try:
            st = snapshot_stamp()
            if st != old_stamp and st[1] > 1000:
                data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
                count = int(data.get("count") or len(data.get("trains") or []))
                if data.get("ok") and count > 0:
                    return True, f"OK count={count}"
                last = f"snapshot non sain: ok={data.get('ok')} count={count}"
        except Exception as exc:
            last = repr(exc)
        time.sleep(1)
    return False, last


def write_health(status, **extra):
    STATE.mkdir(parents=True, exist_ok=True)
    obj = {"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "status": status, **extra}
    tmp = STATE / ".moorail-global-hs-v7-health.tmp"
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE / "moorail-global-hs-v7-health.json")


def prune_backups(keep=3):
    dirs = sorted([p for p in BACKUPS.glob("global-hs-v7-*") if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True)
    for p in dirs[keep:]:
        shutil.rmtree(p, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Generic high-speed geometry repair for MooRail national V3.")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--post-update", action="store_true", help="Called after GTFS refresh; same safe candidate pipeline.")
    ap.add_argument("--db", default=str(DB))
    args = ap.parse_args()
    live = Path(args.db).resolve()

    say("=" * 120)
    say(" MOO RAIL — GLOBAL HIGH-SPEED V7")
    say(" LOGIQUE GENERIQUE : INOUI / OUIGO HGV / LYRIA / ICE / EUROSTAR / INTERNATIONAL")
    say(" MODE :", "APPLY POST-UPDATE" if args.post_update else ("APPLY" if args.apply else "DIAGNOSTIC"))
    say(" DB :", live)
    say("=" * 120)

    if not live.exists():
        raise RuntimeError(f"DB absente: {live}")
    if not ROUTER_PATH.exists():
        raise RuntimeError(f"routeur absent: {ROUTER_PATH}")

    STATE.mkdir(parents=True, exist_ok=True)
    BACKUPS.mkdir(parents=True, exist_ok=True)
    lock_fh = LOCK.open("a+")
    try:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        say("Un GLOBAL HS V7 est déjà en cours : sortie propre.")
        return 0

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    work = ROOT / "tmp" / f"global-hs-v7-{stamp}"
    work.mkdir(parents=True, exist_ok=False)
    candidate = work / live.name
    report_path = work / "report.json"
    sqlite_backup(live, candidate)
    before_stat = (live.stat().st_size, live.stat().st_mtime_ns)

    report = build_candidate(candidate, report_path)
    say("\nRESULTAT CANDIDAT")
    say(" HGV détectés :", report["high_speed_trips"])
    say(" Trips modifiés:", report["changed_count"])
    say(" Non résolus   :", report["unresolved_count"])
    say(" Segments      :", report["stats"])
    say(" Rapport       :", report_path)

    if report["witnesses"]:
        say("\nCAS TEMOINS (aucune règle basée sur leur numéro) :")
        for w in report["witnesses"][:30]:
            say(
                f" {w['number']:>5} | {w.get('old_km')} -> {w['new_km']} km |",
                w["sources"], "|", " -> ".join(w["stops"]),
            )

    if not args.apply:
        write_health("diagnostic_ok", report=str(report_path), changed=report["changed_count"], unresolved=report["unresolved_count"])
        say("\nDIAGNOSTIC OK — aucun fichier actif modifié. Ajouter --apply pour publier.")
        return 0

    if (live.stat().st_size, live.stat().st_mtime_ns) != before_stat:
        raise RuntimeError("DB live modifiée pendant la préparation : publication annulée")

    backup_dir = BACKUPS / f"global-hs-v7-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    sqlite_backup(live, backup_dir / live.name)
    shutil.copy2(report_path, backup_dir / "report.json")

    old_snapshot = snapshot_stamp()
    hot_active = systemctl("is-active", "--quiet", HOT_UNIT, check=False).returncode == 0
    if not hot_active:
        raise RuntimeError(f"{HOT_UNIT} non actif : publication refusée avant swap")

    published = False
    try:
        systemctl("stop", HOT_UNIT)
        atomic_replace_from(candidate, live)
        published = True
        systemctl("start", HOT_UNIT)
        ok, msg = wait_snapshot(old_snapshot)
        say("Snapshot France :", msg)
        if not ok:
            raise RuntimeError("snapshot France non validé: " + msg)
        check = sqlite3.connect(f"file:{live}?mode=ro", uri=True)
        try:
            if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("SQLite live invalide après swap")
        finally:
            check.close()
    except BaseException:
        say("ECHEC APRES SWAP — ROLLBACK AUTOMATIQUE")
        systemctl("stop", HOT_UNIT, check=False)
        if published:
            atomic_replace_from(backup_dir / live.name, live)
        systemctl("start", HOT_UNIT, check=False)
        write_health("rolled_back", backup=str(backup_dir), report=str(report_path))
        raise

    prune_backups(3)
    write_health(
        "ok", report=str(report_path), backup=str(backup_dir),
        changed=report["changed_count"], unresolved=report["unresolved_count"],
        stats=report["stats"], post_update=bool(args.post_update),
    )
    say("\n" + "=" * 120)
    say(" APPLY OK — GLOBAL HIGH-SPEED V7")
    say(" Aucun numéro de train n'est forcé : la logique est segment/corridor/source.")
    say(" Backup :", backup_dir)
    say(" Health :", STATE / "moorail-global-hs-v7-health.json")
    say("=" * 120)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        say("\nCRITICAL:", type(exc).__name__, exc)
        traceback.print_exc()
        try:
            write_health("critical", error=str(exc))
        except Exception:
            pass
        raise SystemExit(2)
