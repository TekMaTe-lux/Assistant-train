#!/usr/bin/env python3
"""Patch V7 -> V7.1 LOWMEM.

The first V7 retained whole route geometries in two unbounded caches while
processing ~6.6k high-speed trip variants. On a small VPS this can grow until
the Linux OOM killer sends SIGKILL. This patch makes those caches bounded/non-
retaining, checkpoints the candidate SQLite in chunks, and logs RSS.

It only patches a candidate Python file passed as argv[1].
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-moorail-global-hs-v7-lowmem-v7_1.py ENGINE.py")

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")

MARK = "MOORAIL_GLOBAL_HS_V7_1_LOWMEM"
if MARK in s:
    print("V7.1 LOWMEM déjà présente")
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
    '''VERSION = "MOORAIL_GLOBAL_HS_V7_1_LOWMEM"\nPATH_PREFIX = "p-global-hs-v7-"\n\n# V7.1 LOWMEM: never retain thousands of full national polylines in RAM.\nGRAPH_CACHE_MAX_ITEMS = 32\nSQLITE_CACHE_KIB = 16_384\nCHECKPOINT_EVERY = 250\n\n\nclass NoRetentionCache:\n    """Dict-like API used by V7 pattern_cache, but deliberately retains nothing."""\n    def get(self, _key, default=None):\n        return default\n    def __setitem__(self, _key, _value):\n        return None\n    def __len__(self):\n        return 0\n\n\nclass BoundedCache(dict):\n    """Tiny FIFO cache for expensive graph routes; values may contain long polylines."""\n    def __init__(self, max_items):\n        super().__init__()\n        self.max_items = max(1, int(max_items))\n    def __setitem__(self, key, value):\n        if key not in self and len(self) >= self.max_items:\n            try:\n                self.pop(next(iter(self)))\n            except StopIteration:\n                pass\n        super().__setitem__(key, value)\n\n\ndef rss_mib():\n    try:\n        for line in Path("/proc/self/status").read_text().splitlines():\n            if line.startswith("VmRSS:"):\n                return round(int(line.split()[1]) / 1024.0, 1)\n    except Exception:\n        pass\n    return None'''
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
    '        for pos, tr in enumerate(trips, 1):\n            pk = int(tr["trip_pk"])',
    '''        for pos, tr in enumerate(trips, 1):\n            # Candidate DB is disposable until final validation, therefore chunk\n            # commits are safe and prevent one 6.6k-trip SQLite transaction from\n            # accumulating pages/journal state in process memory.\n            if pos > 1 and (pos - 1) % CHECKPOINT_EVERY == 0:\n                db.commit()\n                db.execute("BEGIN IMMEDIATE")\n                gc.collect()\n                say(\n                    f"checkpoint {pos-1}/{len(trips)} | "\n                    f"changed={stats['trip_changed']} preserved={stats['trip_preserved']} "\n                    f"unresolved={stats['unresolved_trip']} | "\n                    f"graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )\n\n            pk = int(tr["trip_pk"])'''
)

rep(
    '            if pos % 500 == 0:\n                say(f"{pos}/{len(trips)} | changed={stats[\'trip_changed\']} preserved={stats[\'trip_preserved\']} unresolved={stats[\'unresolved_trip\']}")',
    '''            if pos % 500 == 0:\n                gc.collect()\n                say(\n                    f"{pos}/{len(trips)} | changed={stats['trip_changed']} "\n                    f"preserved={stats['trip_preserved']} unresolved={stats['unresolved_trip']} "\n                    f"| graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )'''
)

rep(
    '        "version": VERSION,\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),',
    '''        "version": VERSION,\n        "lowmem": {\n            "graph_cache_max_items": GRAPH_CACHE_MAX_ITEMS,\n            "pattern_cache_retained": 0,\n            "sqlite_cache_kib": SQLITE_CACHE_KIB,\n            "checkpoint_every": CHECKPOINT_EVERY,\n            "final_rss_mib": rss_mib(),\n        },\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),'''
)

# Banner only; routing semantics and witness logic remain unchanged.
rep(
    ' MOO RAIL — GLOBAL HIGH-SPEED V7")',
    ' MOO RAIL — GLOBAL HIGH-SPEED V7.1 LOWMEM")',
)

p.write_text(s, encoding="utf-8")
print(f"PATCH V7.1 LOWMEM OK : {p}")
print("Modifications :", len(repls))
