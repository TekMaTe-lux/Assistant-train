#!/usr/bin/env python3
"""Exact read-only parity audit between timetable SQLite V1 and compact V2.

Compares normalized logical content, not physical schema:
- routes
- stops
- trips
- stop_times
- service_days
- active trips by service date (V1 day_trips vs V2 derived join)

The script streams ordered rows, so memory use stays small even for >1M rows.
It never writes to either database.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def ro(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    db.execute("PRAGMA query_only=ON")
    return db


def compare_stream(label: str, c1: sqlite3.Cursor, c2: sqlite3.Cursor, progress_every: int = 250_000) -> tuple[bool, int]:
    n = 0
    while True:
        a = c1.fetchone()
        b = c2.fetchone()
        if a is None and b is None:
            print(f"OK {label}: {n:,} lignes identiques")
            return True, n
        if a != b:
            print(f"ERREUR {label} à la ligne logique {n+1:,}")
            print("  V1:", a)
            print("  V2:", b)
            return False, n
        n += 1
        if progress_every and n % progress_every == 0:
            print(f"  {label}: {n:,} lignes vérifiées...", flush=True)


def scalar(db: sqlite3.Connection, sql: str):
    return db.execute(sql).fetchone()[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--v1", required=True)
    ap.add_argument("--v2", required=True)
    args = ap.parse_args()

    p1 = Path(args.v1)
    p2 = Path(args.v2)
    for p in (p1, p2):
        if not p.is_file():
            print(f"ERREUR: base absente: {p}", file=sys.stderr)
            return 2

    d1 = ro(p1)
    d2 = ro(p2)

    print("========================================")
    print(" PARITE EXACTE TIMETABLE V1 -> V2")
    print(" LECTURE SEULE")
    print("========================================")
    print(f"V1: {p1}  {p1.stat().st_size/1024/1024:.2f} MiB")
    print(f"V2: {p2}  {p2.stat().st_size/1024/1024:.2f} MiB")
    print()

    i1 = scalar(d1, "PRAGMA integrity_check")
    i2 = scalar(d2, "PRAGMA integrity_check")
    print("integrity V1:", i1)
    print("integrity V2:", i2)
    if i1 != "ok" or i2 != "ok":
        return 3

    f1 = d1.execute("SELECT source,sha256,filename FROM feeds ORDER BY source").fetchall()
    f2 = d2.execute("SELECT source,sha256,filename FROM feeds ORDER BY source").fetchall()
    print("feeds identiques:", f1 == f2)
    if f1 != f2:
        print("V1:", f1)
        print("V2:", f2)
        return 4
    print()

    checks = [
        (
            "routes",
            """SELECT source,route_id,agency_id,short_name,long_name,route_type,mode
                 FROM routes ORDER BY source,route_id""",
            """SELECT source,route_id,agency_id,short_name,long_name,route_type,mode
                 FROM routes ORDER BY source,route_id""",
            0,
        ),
        (
            "stops",
            """SELECT source,stop_id,name,parent_station,lat,lon
                 FROM stops ORDER BY source,stop_id""",
            """SELECT source,stop_id,name,parent_station,lat,lon
                 FROM stops ORDER BY source,stop_id""",
            0,
        ),
        (
            "trips",
            """SELECT t.source,t.trip_id,t.route_id,t.service_id,t.headsign,t.number,t.mode,
                       t.first_sec,t.last_sec,t.stop_count
                 FROM trips t ORDER BY t.source,t.trip_id""",
            """SELECT t.source,t.trip_id,r.route_id,s.service_id,t.headsign,t.number,t.mode,
                       t.first_sec,t.last_sec,t.stop_count
                 FROM trips t
                 JOIN routes r ON r.route_pk=t.route_pk
                 JOIN services s ON s.service_pk=t.service_pk
                 ORDER BY t.source,t.trip_id""",
            0,
        ),
        (
            "stop_times",
            """SELECT st.source,st.trip_id,st.seq,st.stop_id,st.arrival_sec,st.departure_sec
                 FROM stop_times st ORDER BY st.source,st.trip_id,st.seq""",
            """SELECT t.source,t.trip_id,st.seq,s.stop_id,st.arrival_sec,st.departure_sec
                 FROM stop_times st
                 JOIN trips t ON t.trip_pk=st.trip_pk
                 JOIN stops s ON s.stop_pk=st.stop_pk
                 ORDER BY t.source,t.trip_id,st.seq""",
            100_000,
        ),
        (
            "service_days",
            """SELECT source,service_date,service_id
                 FROM service_days ORDER BY source,service_date,service_id""",
            """SELECT s.source,printf('%08d',sd.service_date),s.service_id
                 FROM service_days sd
                 JOIN services s ON s.service_pk=sd.service_pk
                 ORDER BY s.source,sd.service_date,s.service_id""",
            100_000,
        ),
        (
            "active_trips_by_day",
            """SELECT source,service_date,trip_id
                 FROM day_trips ORDER BY source,service_date,trip_id""",
            """SELECT t.source,printf('%08d',sd.service_date),t.trip_id
                 FROM service_days sd
                 JOIN trips t ON t.service_pk=sd.service_pk
                 ORDER BY t.source,sd.service_date,t.trip_id""",
            250_000,
        ),
    ]

    total = 0
    for label, q1, q2, progress in checks:
        print(f"=== {label} ===")
        ok, n = compare_stream(label, d1.execute(q1), d2.execute(q2), progress)
        total += n
        if not ok:
            return 10
        print()

    # Critical regression assertions from the 88501 J/J+1 bug.
    v1_0609 = scalar(d1, """SELECT COUNT(*) FROM day_trips dt JOIN trips t
                               ON t.source=dt.source AND t.trip_id=dt.trip_id
                               WHERE dt.service_date='20260906' AND t.number='88501'""")
    v1_0709 = scalar(d1, """SELECT COUNT(*) FROM day_trips dt JOIN trips t
                               ON t.source=dt.source AND t.trip_id=dt.trip_id
                               WHERE dt.service_date='20260907' AND t.number='88501'""")
    v2_0609 = scalar(d2, """SELECT COUNT(*) FROM service_days sd JOIN trips t
                               ON t.service_pk=sd.service_pk
                               WHERE sd.service_date=20260906 AND t.number='88501'""")
    v2_0709 = scalar(d2, """SELECT COUNT(*) FROM service_days sd JOIN trips t
                               ON t.service_pk=sd.service_pk
                               WHERE sd.service_date=20260907 AND t.number='88501'""")
    print("88501 2026-09-06 V1/V2:", v1_0609, v2_0609)
    print("88501 2026-09-07 V1/V2:", v1_0709, v2_0709)
    if (v1_0609, v1_0709, v2_0609, v2_0709) != (0, 1, 0, 1):
        print("ERREUR: régression 88501 J/J+1")
        return 11

    reduction = 100.0 * (1.0 - p2.stat().st_size / p1.stat().st_size)
    print()
    print("========================================")
    print(" PARITE EXACTE OK")
    print(f" Réduction disque: {reduction:.2f}%")
    print(f" Lignes logiques vérifiées: {total:,}")
    print(" AUCUNE MODIFICATION EFFECTUEE")
    print("========================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
