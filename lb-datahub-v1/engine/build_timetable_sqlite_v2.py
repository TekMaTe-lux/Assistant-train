#!/usr/bin/env python3
"""Compact SQLite timetable builder for LB Rail Engine.

V2 goals:
- preserve the V1 timetable semantics;
- keep GTFS source IDs only once in catalog tables;
- use integer surrogate keys for joins;
- remove materialized day_trips (derive active trips from service_days + trips);
- use WITHOUT ROWID for dense relation tables;
- avoid duplicate stop_times indexes;
- print progress during long imports.

This builder is isolated and writes only to --out.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import os
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

SCHEMA_VERSION = 2
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def norm_date(value: str) -> str:
    return str(value or "").strip().replace("-", "")[:8]


def parse_time(value: str):
    value = str(value or "").strip()
    if not value:
        return None
    parts = value.split(":")
    if len(parts) < 2:
        return None
    try:
        h = int(parts[0]); m = int(parts[1]); s = int(parts[2]) if len(parts) > 2 else 0
        return h * 3600 + m * 60 + s
    except ValueError:
        return None


def member(z: ZipFile, basename: str):
    for name in z.namelist():
        if name.rsplit("/", 1)[-1].lower() == basename.lower():
            return name
    return None


def rows(z: ZipFile, basename: str):
    name = member(z, basename)
    if not name:
        return iter(())
    raw = z.open(name, "r")
    text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
    return csv.DictReader(text)


def route_mode(source: str, route_type: str):
    typ = str(route_type or "").strip()
    if source == "FR":
        if typ == "2": return "rail"
        if typ == "0": return "tram_train"
        return None
    if source == "LU":
        return "rail" if typ == "2" else None
    return None


def all_service_days(z: ZipFile):
    out: dict[str, set[str]] = {}
    if member(z, "calendar.txt"):
        for r in rows(z, "calendar.txt"):
            sid = str(r.get("service_id") or "").strip()
            start = norm_date(r.get("start_date") or "")
            end = norm_date(r.get("end_date") or "")
            if not sid or len(start) != 8 or len(end) != 8:
                continue
            try:
                cur = dt.datetime.strptime(start, "%Y%m%d").date()
                last = dt.datetime.strptime(end, "%Y%m%d").date()
            except ValueError:
                continue
            active = out.setdefault(sid, set())
            while cur <= last:
                if str(r.get(WEEKDAYS[cur.weekday()]) or "0").strip() == "1":
                    active.add(cur.strftime("%Y%m%d"))
                cur += dt.timedelta(days=1)
    if member(z, "calendar_dates.txt"):
        for r in rows(z, "calendar_dates.txt"):
            sid = str(r.get("service_id") or "").strip()
            day = norm_date(r.get("date") or "")
            typ = str(r.get("exception_type") or "").strip()
            if not sid or len(day) != 8:
                continue
            active = out.setdefault(sid, set())
            if typ == "1": active.add(day)
            elif typ == "2": active.discard(day)
    return out


def create_schema(db: sqlite3.Connection):
    db.executescript("""
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    PRAGMA temp_store=MEMORY;
    PRAGMA foreign_keys=OFF;

    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE feeds(source TEXT PRIMARY KEY, sha256 TEXT NOT NULL, filename TEXT NOT NULL);

    CREATE TABLE routes(
      route_pk INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      route_id TEXT NOT NULL,
      agency_id TEXT,
      short_name TEXT,
      long_name TEXT,
      route_type TEXT,
      mode TEXT NOT NULL,
      UNIQUE(source, route_id)
    );

    CREATE TABLE stops(
      stop_pk INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      name TEXT,
      parent_station TEXT,
      lat REAL,
      lon REAL,
      UNIQUE(source, stop_id)
    );

    CREATE TABLE services(
      service_pk INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      service_id TEXT NOT NULL,
      UNIQUE(source, service_id)
    );

    CREATE TABLE trips(
      trip_pk INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      route_pk INTEGER NOT NULL,
      service_pk INTEGER NOT NULL,
      headsign TEXT,
      number TEXT,
      mode TEXT NOT NULL,
      first_sec INTEGER,
      last_sec INTEGER,
      stop_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(source, trip_id)
    );

    CREATE TABLE stop_times(
      trip_pk INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      stop_pk INTEGER NOT NULL,
      arrival_sec INTEGER,
      departure_sec INTEGER,
      PRIMARY KEY(trip_pk, seq)
    ) WITHOUT ROWID;

    CREATE TABLE service_days(
      service_date INTEGER NOT NULL,
      service_pk INTEGER NOT NULL,
      PRIMARY KEY(service_date, service_pk)
    ) WITHOUT ROWID;
    """)


def load_feed(db: sqlite3.Connection, zip_path: Path, source: str, counters: dict[str, int]):
    print(f"[{source}] lecture {zip_path}", flush=True)
    with ZipFile(zip_path) as z:
        route_types = Counter()
        route_mode_by_id: dict[str, str] = {}
        route_pk_by_id: dict[str, int] = {}

        for r in rows(z, "routes.txt"):
            rid = str(r.get("route_id") or "").strip()
            typ = str(r.get("route_type") or "").strip()
            mode = route_mode(source, typ)
            route_types[typ or "<vide>"] += 1
            if not rid or not mode:
                continue
            counters["route"] += 1
            pk = counters["route"]
            route_mode_by_id[rid] = mode
            route_pk_by_id[rid] = pk
            db.execute(
                "INSERT INTO routes VALUES(?,?,?,?,?,?,?,?)",
                (pk, source, rid, r.get("agency_id") or "", r.get("route_short_name") or "", r.get("route_long_name") or "", typ, mode),
            )

        stop_pk_by_id: dict[str, int] = {}
        stop_batch = []
        for r in rows(z, "stops.txt"):
            sid = str(r.get("stop_id") or "").strip()
            if not sid:
                continue
            counters["stop"] += 1
            pk = counters["stop"]
            stop_pk_by_id[sid] = pk
            try: lat = float(r.get("stop_lat") or "")
            except ValueError: lat = None
            try: lon = float(r.get("stop_lon") or "")
            except ValueError: lon = None
            stop_batch.append((pk, source, sid, r.get("stop_name") or "", r.get("parent_station") or "", lat, lon))
        db.executemany("INSERT INTO stops VALUES(?,?,?,?,?,?,?)", stop_batch)

        # Collect included trips first so only their services are materialized.
        trip_raw = []
        used_service_ids = set()
        for r in rows(z, "trips.txt"):
            tid = str(r.get("trip_id") or "").strip()
            rid = str(r.get("route_id") or "").strip()
            sid = str(r.get("service_id") or "").strip()
            mode = route_mode_by_id.get(rid)
            if not tid or not sid or not mode:
                continue
            used_service_ids.add(sid)
            trip_raw.append((tid, rid, sid, str(r.get("trip_headsign") or "").strip(), str(r.get("trip_short_name") or "").strip(), mode))

        service_pk_by_id: dict[str, int] = {}
        for sid in sorted(used_service_ids):
            counters["service"] += 1
            pk = counters["service"]
            service_pk_by_id[sid] = pk
            db.execute("INSERT INTO services VALUES(?,?,?)", (pk, source, sid))

        trip_pk_by_id: dict[str, int] = {}
        trip_batch = []
        for tid, rid, sid, headsign, short_name, mode in trip_raw:
            counters["trip"] += 1
            pk = counters["trip"]
            trip_pk_by_id[tid] = pk
            number = short_name or headsign
            trip_batch.append((pk, source, tid, route_pk_by_id[rid], service_pk_by_id[sid], headsign, number, mode, None, None, 0))
        db.executemany("INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?)", trip_batch)

        stats: dict[int, list[int | None]] = {pk: [None, None, 0] for pk in trip_pk_by_id.values()}
        st_batch = []
        included_rows = 0
        scanned_rows = 0
        for r in rows(z, "stop_times.txt"):
            scanned_rows += 1
            tid = str(r.get("trip_id") or "").strip()
            trip_pk = trip_pk_by_id.get(tid)
            if trip_pk is None:
                continue
            stop_id = str(r.get("stop_id") or "").strip()
            stop_pk = stop_pk_by_id.get(stop_id)
            if stop_pk is None:
                continue
            try: seq = int(r.get("stop_sequence") or 0)
            except ValueError: seq = 0
            arr = parse_time(r.get("arrival_time") or "")
            dep = parse_time(r.get("departure_time") or "")
            st_batch.append((trip_pk, seq, stop_pk, arr, dep))
            included_rows += 1
            vals = [x for x in (arr, dep) if x is not None]
            stat = stats[trip_pk]
            if vals:
                lo, hi = min(vals), max(vals)
                stat[0] = lo if stat[0] is None else min(int(stat[0]), lo)
                stat[1] = hi if stat[1] is None else max(int(stat[1]), hi)
            stat[2] = int(stat[2]) + 1
            if len(st_batch) >= 50000:
                db.executemany("INSERT INTO stop_times VALUES(?,?,?,?,?)", st_batch)
                st_batch.clear()
            if included_rows and included_rows % 100000 == 0:
                print(f"[{source}] stop_times inclus={included_rows:,} scannes={scanned_rows:,}", flush=True)
        if st_batch:
            db.executemany("INSERT INTO stop_times VALUES(?,?,?,?,?)", st_batch)

        db.executemany(
            "UPDATE trips SET first_sec=?,last_sec=?,stop_count=? WHERE trip_pk=?",
            [(v[0], v[1], v[2], pk) for pk, v in stats.items()],
        )

        service_days = all_service_days(z)
        sd_batch = []
        day_rows = 0
        for sid, service_pk in service_pk_by_id.items():
            for day in service_days.get(sid, set()):
                sd_batch.append((int(day), service_pk))
                day_rows += 1
                if len(sd_batch) >= 50000:
                    db.executemany("INSERT OR IGNORE INTO service_days VALUES(?,?)", sd_batch)
                    sd_batch.clear()
        if sd_batch:
            db.executemany("INSERT OR IGNORE INTO service_days VALUES(?,?)", sd_batch)

        db.execute("INSERT INTO feeds VALUES(?,?,?)", (source, sha256_file(zip_path), zip_path.name))
        db.commit()
        print(f"[{source}] trips={len(trip_pk_by_id)} stop_times={included_rows} service_days={day_rows} route_types={dict(route_types)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sncf", required=True)
    ap.add_argument("--lux", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    sncf = Path(args.sncf).resolve(); lux = Path(args.lux).resolve(); out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=out.name + ".", suffix=".tmp", dir=str(out.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    counters = {"route": 0, "stop": 0, "service": 0, "trip": 0}
    try:
        db = sqlite3.connect(tmp)
        create_schema(db)
        built_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        db.executemany("INSERT INTO meta VALUES(?,?)", [
            ("schema_version", str(SCHEMA_VERSION)),
            ("built_at", built_at),
            ("policy", "FR:2=rail,0=tram_train,3=excluded;LU:2=rail,0/3=excluded"),
            ("day_model", "service_days join trips; no materialized day_trips"),
        ])
        load_feed(db, sncf, "FR", counters)
        load_feed(db, lux, "LU", counters)

        print("[index] création", flush=True)
        db.executescript("""
          CREATE INDEX idx_trips_service ON trips(service_pk);
          CREATE INDEX idx_trips_number ON trips(number);
          CREATE INDEX idx_service_days_service ON service_days(service_pk, service_date);
          CREATE INDEX idx_stops_name ON stops(name);
          ANALYZE;
        """)
        db.commit()
        db.execute("PRAGMA optimize")
        db.close()
        os.chmod(tmp, 0o644)
        os.replace(tmp, out)
        print(f"OK {out} {out.stat().st_size/1024/1024:.2f} MiB", flush=True)
    except Exception:
        try: tmp.unlink()
        except FileNotFoundError: pass
        raise


if __name__ == "__main__":
    main()
