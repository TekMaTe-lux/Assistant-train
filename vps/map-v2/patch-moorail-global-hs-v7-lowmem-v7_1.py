#!/usr/bin/env python3
"""Patch V7 -> V7.3 LOWMEM + UPSERT + transient snapshot restart.

V7.1 fixed the OOM. V7.2 fixed geometry-less HGV variants by inserting a
trip_geometry row when none existed. V7.3 fixes publication on this VPS:
`lb-rail-v3-france-hot-snapshot-preview` is a systemd *transient* unit. Stopping
it removes its transient definition, so a later `systemctl start` returns 5
(unit not found). V7.3 recreates that worker with systemd-run when necessary.

It only patches a candidate Python file passed as argv[1].
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-moorail-global-hs-v7-lowmem-v7_1.py ENGINE.py")

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")

MARK = "MOORAIL_GLOBAL_HS_V7_3_TRANSIENT_SNAPSHOT"
if MARK in s:
    print("V7.3 LOWMEM/UPSERT/TRANSIENT déjà présente")
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
    '''VERSION = "MOORAIL_GLOBAL_HS_V7_3_TRANSIENT_SNAPSHOT"\nPATH_PREFIX = "p-global-hs-v7-"\n\n# V7.3: stable RAM + geometry UPSERT + transient systemd snapshot recovery.\nGRAPH_CACHE_MAX_ITEMS = 32\nSQLITE_CACHE_KIB = 16_384\nCHECKPOINT_EVERY = 250\n\n\nclass NoRetentionCache:\n    """Dict-like API used by V7 pattern_cache, but deliberately retains nothing."""\n    def get(self, _key, default=None):\n        return default\n    def __setitem__(self, _key, _value):\n        return None\n    def __len__(self):\n        return 0\n\n\nclass BoundedCache(dict):\n    """Tiny FIFO cache for expensive graph routes; values may contain long polylines."""\n    def __init__(self, max_items):\n        super().__init__()\n        self.max_items = max(1, int(max_items))\n    def __setitem__(self, key, value):\n        if key not in self and len(self) >= self.max_items:\n            try:\n                self.pop(next(iter(self)))\n            except StopIteration:\n                pass\n        super().__setitem__(key, value)\n\n\ndef rss_mib():\n    try:\n        for line in Path("/proc/self/status").read_text().splitlines():\n            if line.startswith("VmRSS:"):\n                return round(int(line.split()[1]) / 1024.0, 1)\n    except Exception:\n        pass\n    return None'''
)

rep(
    '    db = sqlite3.connect(str(candidate))\n    db.execute("PRAGMA foreign_keys=ON")',
    '''    db = sqlite3.connect(str(candidate))\n    db.execute("PRAGMA foreign_keys=ON")\n    # Keep SQLite page/temp memory predictable on the VPS. Candidate DB only.\n    db.execute(f"PRAGMA cache_size=-{SQLITE_CACHE_KIB}")\n    db.execute("PRAGMA temp_store=FILE")'''
)

rep(
    '    graph_cache = {}\n    stats = Counter()\n    changed = []\n    witnesses = []\n    unresolved = []\n    pattern_cache = {}',
    '''    graph_cache = BoundedCache(GRAPH_CACHE_MAX_ITEMS)\n    stats = Counter()\n    changed = []\n    witnesses = []\n    unresolved = []\n    pattern_cache = NoRetentionCache()'''
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
    """UPDATE existing geometry or INSERT it for previously geometry-less trips."""
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
    '''        for pos, tr in enumerate(trips, 1):\n            if pos > 1 and (pos - 1) % CHECKPOINT_EVERY == 0:\n                db.commit()\n                db.execute("BEGIN IMMEDIATE")\n                gc.collect()\n                say(\n                    f"checkpoint {pos-1}/{len(trips)} | "\n                    f"changed={stats['trip_changed']} preserved={stats['trip_preserved']} "\n                    f"unresolved={stats['unresolved_trip']} | "\n                    f"graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )\n\n            pk = int(tr["trip_pk"])'''
)

rep(
    '            if pos % 500 == 0:\n                say(f"{pos}/{len(trips)} | changed={stats[\'trip_changed\']} preserved={stats[\'trip_preserved\']} unresolved={stats[\'unresolved_trip\']}")',
    '''            if pos % 500 == 0:\n                gc.collect()\n                say(\n                    f"{pos}/{len(trips)} | changed={stats['trip_changed']} "\n                    f"preserved={stats['trip_preserved']} unresolved={stats['unresolved_trip']} "\n                    f"| graph_cache={len(graph_cache)}/{GRAPH_CACHE_MAX_ITEMS} | RSS={rss_mib()} MiB"\n                )'''
)

rep(
    '        "version": VERSION,\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),',
    '''        "version": VERSION,\n        "lowmem": {\n            "graph_cache_max_items": GRAPH_CACHE_MAX_ITEMS,\n            "pattern_cache_retained": 0,\n            "sqlite_cache_kib": SQLITE_CACHE_KIB,\n            "checkpoint_every": CHECKPOINT_EVERY,\n            "final_rss_mib": rss_mib(),\n            "geometry_writer": "UPDATE_OR_INSERT",\n            "snapshot_restart": "SYSTEMCTL_OR_SYSTEMD_RUN_TRANSIENT",\n        },\n        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),'''
)

# The France worker was originally launched with systemd-run and is transient.
# After `stop`, its /run/systemd/transient definition disappears. Recreate it.
rep(
    '''def systemctl(*args, check=True):
    return subprocess.run(["systemctl", *args], check=check, capture_output=True, text=True, timeout=60)
''',
    '''def systemctl(*args, check=True):
    return subprocess.run(["systemctl", *args], check=check, capture_output=True, text=True, timeout=60)


def start_hot_snapshot():
    """Start persistent unit if present, otherwise recreate the known transient worker."""
    first = systemctl("start", HOT_UNIT, check=False)
    if first.returncode == 0:
        return "systemctl"

    msg = ((first.stderr or "") + " " + (first.stdout or "")).lower()
    not_found = first.returncode == 5 or "not found" in msg or "not loaded" in msg
    if not not_found:
        raise RuntimeError(
            f"Impossible de démarrer {HOT_UNIT}: rc={first.returncode} "
            f"stderr={(first.stderr or '').strip()}"
        )

    script = APP / "hot_snapshot_v3_france_preview.py"
    if not script.exists():
        raise RuntimeError(f"Worker snapshot France absent: {script}")

    # V7.3: exact recreation of the transient service used by this preview.
    cmd = [
        "systemd-run",
        f"--unit={HOT_UNIT}",
        "--description=La Betaillere France V3 Hot Snapshot Preview",
        "--property=Restart=always",
        "--property=RestartSec=1s",
        "--property=MemoryMax=768M",
        "/usr/bin/python3",
        str(script),
    ]
    run = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=60)
    if run.returncode != 0:
        raise RuntimeError(
            f"systemd-run {HOT_UNIT} rc={run.returncode}: "
            f"{(run.stderr or run.stdout or '').strip()}"
        )

    deadline = time.time() + 12
    while time.time() < deadline:
        if systemctl("is-active", "--quiet", HOT_UNIT, check=False).returncode == 0:
            return "systemd-run"
        time.sleep(0.5)
    raise RuntimeError(f"{HOT_UNIT} recréé mais non actif après 12 s")
'''
)

rep(
    '''    hot_active = systemctl("is-active", "--quiet", HOT_UNIT, check=False).returncode == 0
    if not hot_active:
        raise RuntimeError(f"{HOT_UNIT} non actif : publication refusée avant swap")
''',
    '''    hot_active = systemctl("is-active", "--quiet", HOT_UNIT, check=False).returncode == 0
    if not hot_active:
        mode = start_hot_snapshot()
        say(f"Snapshot France remis en route avant publication ({mode}).")
        hot_active = systemctl("is-active", "--quiet", HOT_UNIT, check=False).returncode == 0
    if not hot_active:
        raise RuntimeError(f"{HOT_UNIT} non actif même après tentative de recréation")
'''
)

rep(
    '''        systemctl("stop", HOT_UNIT)
        atomic_replace_from(candidate, live)
        published = True
        systemctl("start", HOT_UNIT)
''',
    '''        systemctl("stop", HOT_UNIT)
        atomic_replace_from(candidate, live)
        published = True
        mode = start_hot_snapshot()
        say(f"Snapshot France relancé après swap ({mode}).")
'''
)

rep(
    '''        systemctl("start", HOT_UNIT, check=False)
        write_health("rolled_back", backup=str(backup_dir), report=str(report_path))
''',
    '''        try:
            mode = start_hot_snapshot()
            say(f"Snapshot France relancé après rollback ({mode}).")
        except Exception as restart_exc:
            say("ATTENTION: rollback DB effectué mais snapshot non relancé:", restart_exc)
        write_health("rolled_back", backup=str(backup_dir), report=str(report_path))
'''
)

rep(
    ' MOO RAIL — GLOBAL HIGH-SPEED V7")',
    ' MOO RAIL — GLOBAL HIGH-SPEED V7.3 LOWMEM UPSERT TRANSIENT")',
)

p.write_text(s, encoding="utf-8")
print(f"PATCH V7.3 LOWMEM/UPSERT/TRANSIENT OK : {p}")
print("Modifications :", len(repls))
