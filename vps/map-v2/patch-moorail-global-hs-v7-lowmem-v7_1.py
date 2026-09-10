#!/usr/bin/env python3
"""Patch V7 -> V7.2 LOWMEM + missing-geometry UPSERT.

V7.1 fixed the OOM by bounding route caches, but exposed a second bug:
`update_geometry()` only executed UPDATE. High-speed variants which had no
trip_geometry row yet (notably some Lyria/international variants) therefore
computed a valid path but never got a trip_geometry reference, and the final
guard correctly rejected them as `path reference`.

V7.2 keeps the LOWMEM behaviour and changes geometry writing to UPDATE-or-INSERT.
It only patches a candidate Python file passed as argv[1].
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-moorail-global-hs-v7-lowmem-v7_1.py ENGINE.py")

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")

MARK = "MOORAIL_GLOBAL_HS_V7_2_LOWMEM_UPSERT"
if MARK in s:
    print("V7.2 LOWMEM UPSERT déjà présente")
    raise SystemExit(0)

repls = []

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n < count:
        raise SystemExit(f"ANCRE ABSENTE ({n} < {count}): {old[:120]!r}")
    s = s.replace(old, new, count)
    repls.append(old[:80])

rep(
    "import fcntl\nimport hashlib",
    "import fcntl\nimport gc\nimport hashlib",
)

rep(
    'VERSION = "MOORAIL_GLOBAL_HS_V7"\nPATH_PREFIX = "p-global-hs-v7-"',
    '''VERSION = "MOORAIL_GLOBAL_HS_V7_2_LOWMEM_UPSERT"\nPATH_PREFIX = "p-global-hs-v7-"\n\n# V7.2 LOWMEM: never retain thousands of full national polylines in RAM.\nGRAPH_CACHE_MAX_ITEMS = 32\nSQLITE_CACHE_KIB = 16_384\nCHECKPOINT_EVERY = 250\n\n\nclass NoRetentionCache:\n    """Dict-like API used by V7 pattern_cache, but deliberately retains nothing."""\n    def get(self, _key, default=None):\n        return default\n    def __setitem__(self, _key, _value):\n        return None\n    def __len__(self):\n        return 0\n\n\nclass BoundedCache(dict):\n    """Tiny FIFO cache for expensive graph routes; values may contain long polylines."""\n    def __init__(self, max_items):\n        super().__init__()\n        self.max_items = max(1, int(max_items))\n    def __setitem__(self, key, value):\n        if key not in self and len(self) >= self.max_items:\n            try:\n                self.pop(next(iter(self)))\n            except StopIteration:\n                pass\n        super().__setitem__(key, value)\n\n\ndef rss_mib():\n    try:\n        for line in Path("/proc/self/status").read_text().splitlines():\n            if line.startswith("VmRSS:"):\n                return round(int(line.split()[1]) / 1024.0, 1)\n    except Exception:\n        pass\n    return None'''
)

rep(
    '    db = sqlite3.connect(str(candidate))\n    db.execute("PRAGMA foreign_keys=ON")',
    '''    db = sqlite3.connect(str(candidate))\n    db.execute("PRAGMA foreign_keys=ON")\n    # Keep SQLite page/temp memory predictable on the VPS. Candidate DB only.\n    db.execute(f"PRAGMA cache_size=-{SQLITE_CACHE_KIB}")\n    db.execute("PRAGMA temp_store=FILE")'''
)

rep(
    '    graph_cache = {}\n    stats = Counter()\n    changed = []\n    witnesses = []\n    unresolved = []\n    pattern_cache = {}',
    '''    # Full graph routes contain thousands of coordinate tuples: V7 used two\n    # unbounded caches here and RSS grew linearly until SIGKILL.\n    graph_cache = BoundedCache(GRAPH_CACHE_MAX_ITEMS)\n    stats = Counter()\n    changed = []\n    witnesses = []\n    unresolved = []\n    # cache_key included the old path id, so it was almost one giant geometry per\n    # trip variant. Segment graph_cache already provides the useful reuse.\n    pattern_cache = NoRetentionCache()'''
)

rep(
    '''def update_geometry(db, pk, trip_id, pid, offsets):
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
''',
    '''def update_geometry(db, pk, trip_id, pid, offsets):
    """Write the path reference for BOTH existing and geometry-less trips.

    V7/V7.1 only did UPDATE, so a perfectly routed trip with no previous
    trip_geometry row stayed geometry-less and failed the final `path reference`
    guard. The canonical schema is trip_pk/path_id/offsets_json/geometry_trip_id.
    """
    cols = set(table_columns(db, "trip_geometry"))
    offsets_json = json.dumps([round(float(x), 3) for x in offsets], separators=(",", ":"))
    optional = {
        "geometry_trip_id": str(trip_id),
        "source": VERSION,
        "geometry_source": VERSION,
        "geometrySource": VERSION,
        "repair_detail": VERSION,
        "repairDetail": VERSION,
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }

    exists = db.execute("SELECT 1 FROM trip_geometry WHERE trip_pk=?", (pk,)).fetchone()
    if exists:
        fields = ["path_id=?", "offsets_json=?"]
        vals = [pid, offsets_json]
        for c, v in optional.items():
            if c in cols:
                fields.append(f'"{c}"=?')
                vals.append(v)
        vals.append(pk)
        cur = db.execute(f"UPDATE trip_geometry SET {','.join(fields)} WHERE trip_pk=?", vals)
        if cur.rowcount not in (-1, 1):
            raise RuntimeError(f"trip_geometry UPDATE inattendu trip_pk={pk}: rowcount={cur.rowcount}")
        return "updated"

    insert_cols = ["trip_pk", "path_id", "offsets_json"]
    insert_vals = [pk, pid, offsets_json]
    # geometry_trip_id is part of the production schema and is required by the
    # downstream guards; include it whenever the column exists.
    if "geometry_trip_id" in cols:
        insert_cols.append("geometry_trip_id")
        insert_vals.append(str(trip_id))
    for c in ("source", "geometry_source", "geometrySource", "repair_detail", "repairDetail", "updated_at"):
        if c in cols:
            insert_cols.append(c)
            insert_vals.append(optional[c])
    marks = ",".join("?" for _ in insert_cols)
    db.execute(
        f"INSERT INTO trip_geometry({','.join(chr(34)+c+chr(34) for c in insert_cols)}) VALUES({marks})",
        insert_vals,
    )
    return "inserted"
'''
)

rep(
    '        for pos, tr in enumerate(trips, 1):\n            pk = int(tr["trip_pk"])',
    '''        for pos, tr in enumerate(trips, 1):\n            # Candidate DB is disposable until final validation, therefore chunk\n            # commits are safe and prevent one 6.6k-trip SQLite transaction from\n            # accumulating pages/journal state in process memory.\n            if pos > 1 and (pos - 1) % CHECKPOINT_EVERY == 0:\n                db.commit()\n                db.execute("BEGIN IMMEDIATE")\n                gc.collect()\n                say(\n                    f"checkpoint {pos-1}/{len(trips)} | "\n                    f"changed={stats['trip_changed']} preserved={stats['trip_preserved']} "\n                    f"unresolved={stats['unresolved_trip']} | "\n                    f"graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )\n\n            pk = int(tr["trip_pk"])'''
)

rep(
    '            if pos % 500 == 0:\n                say(f"{pos}/{len(trips)} | changed={stats[\'trip_changed\']} preserved={stats[\'trip_preserved\']} unresolved={stats[\'unresolved_trip\']}")',
    '''            if pos % 500 == 0:\n                gc.collect()\n                say(\n                    f"{pos}/{len(trips)} | changed={stats['trip_changed']} "\n                    f"preserved={stats['trip_preserved']} unresolved={stats['unresolved_trip']} "\n                    f"| graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )'''
)

rep(
    '        "version": VERSION,\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),',
    '''        "version": VERSION,\n        "lowmem": {\n            "graph_cache_max_items": GRAPH_CACHE_MAX_ITEMS,\n            "pattern_cache_retained": 0,\n            "sqlite_cache_kib": SQLITE_CACHE_KIB,\n            "checkpoint_every": CHECKPOINT_EVERY,\n            "final_rss_mib": rss_mib(),\n            "geometry_writer": "UPDATE_OR_INSERT",\n        },\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),'''
)

rep(
    ' MOO RAIL — GLOBAL HIGH-SPEED V7")',
    ' MOO RAIL — GLOBAL HIGH-SPEED V7.2 LOWMEM UPSERT")',
)

p.write_text(s, encoding="utf-8")
print(f"PATCH V7.2 LOWMEM UPSERT OK : {p}")
print("Modifications :", len(repls))
