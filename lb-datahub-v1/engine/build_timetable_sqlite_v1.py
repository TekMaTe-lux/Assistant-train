#!/usr/bin/env python3
"""Compile SNCF + Luxembourg GTFS into an isolated read-only timetable SQLite.

This builder is for /opt/lb-rail-engine-v1 and never writes to La Bétaillère
production files. It keeps timetable/calendar separate from the existing geometry
engine (generated/trips.json + paths.json).

Mode policy v1:
- FR route_type=2 => rail
- FR route_type=0 => tram_train (kept, separately classed)
- FR route_type=3 => excluded (bus/coach)
- LU route_type=2 => rail
- LU route_type=0/3 => excluded (tram/bus)

GTFS times >24:00 are stored as seconds >86400 and keep their service_date.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

SCHEMA_VERSION = 1
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
    """Return dict service_id -> set(YYYYMMDD), respecting exceptions."""
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
    CREATE TABLE feeds(
      source TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      filename TEXT NOT NULL
    );
    CREATE TABLE routes(
      source TEXT NOT NULL,
      route_id TEXT NOT NULL,
      agency_id TEXT,
      short_name TEXT,
      long_name TEXT,
      route_type TEXT,
      mode TEXT NOT NULL,
      PRIMARY KEY(source, route_id)
    );
    CREATE TABLE stops(
      source TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      name TEXT,
      parent_station TEXT,
      lat REAL,
      lon REAL,
      PRIMARY KEY(source, stop_id)
    );
    CREATE TABLE trips(
      source TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      headsign TEXT,
      number TEXT,
      mode TEXT NOT NULL,
      first_sec INTEGER,
      last_sec INTEGER,
      stop_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(source, trip_id)
    );
    CREATE TABLE stop_times(
      source TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      stop_id TEXT NOT NULL,
      arrival_sec INTEGER,
      departure_sec INTEGER,
      PRIMARY KEY(source, trip_id, seq)
    );
    CREATE TABLE service_days(
      source TEXT NOT NULL,
      service_date TEXT NOT NULL,
      service_id TEXT NOT NULL,
      PRIMARY KEY(source, service_date, service_id)
    );
    CREATE TABLE day_trips(
      source TEXT NOT NULL,
      service_date TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      PRIMARY KEY(source, service_date, trip_id)
    );
    """)


def load_feed(db: sqlite3.Connection, zip_path: Path, source: str):
    print(f"[{source}] lecture {zip_path}", flush=True)
    with ZipFile(zip_path) as z:
        route_modes: dict[str, str] = {}
        route_types = Counter()
        route_batch = []
        for r in rows(z, "routes.txt"):
            rid = str(r.get("route_id") or "").strip()
            typ = str(r.get("route_type") or "").strip()
            mode = route_mode(source, typ)
            route_types[typ or "<vide>"] += 1
            if not rid or not mode:
                continue
            route_modes[rid] = mode
            route_batch.append((source, rid, r.get("agency_id") or "", r.get("route_short_name") or "", r.get("route_long_name") or "", typ, mode))
        db.executemany("INSERT INTO routes VALUES(?,?,?,?,?,?,?)", route_batch)

        stop_batch = []
        for r in rows(z, "stops.txt"):
            sid = str(r.get("stop_id") or "").strip()
            if not sid: continue
            try: lat = float(r.get("stop_lat") or "")
            except ValueError: lat = None
            try: lon = float(r.get("stop_lon") or "")
            except ValueError: lon = None
            stop_batch.append((source, sid, r.get("stop_name") or "", r.get("parent_station") or "", lat, lon))
        db.executemany("INSERT INTO stops VALUES(?,?,?,?,?,?)", stop_batch)

        trip_batch = []
        trip_ids = set()
        for r in rows(z, "trips.txt"):
            tid = str(r.get("trip_id") or "").strip()
            rid = str(r.get("route_id") or "").strip()
            sid = str(r.get("service_id") or "").strip()
            mode = route_modes.get(rid)
            if not tid or not sid or not mode:
                continue
            headsign = str(r.get("trip_headsign") or "").strip()
            number = str(r.get("trip_short_name") or "").strip() or headsign
            trip_batch.append((source, tid, rid, sid, headsign, number, mode, None, None, 0))
            trip_ids.add(tid)
        db.executemany("INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?)", trip_batch)

        # Keep only stop_times belonging to included trips.
        st_batch = []
        stats: dict[str, list[int | None]] = {tid: [None, None, 0] for tid in trip_ids}
        for r in rows(z, "stop_times.txt"):
            tid = str(r.get("trip_id") or "").strip()
            if tid not in trip_ids:
                continue
            try: seq = int(r.get("stop_sequence") or 0)
            except ValueError: seq = 0
            arr = parse_time(r.get("arrival_time") or "")
            dep = parse_time(r.get("departure_time") or "")
            stop_id = str(r.get("stop_id") or "").strip()
            st_batch.append((source, tid, seq, stop_id, arr, dep))
            vals = [x for x in (arr, dep) if x is not None]
            stat = stats[tid]
            if vals:
                lo, hi = min(vals), max(vals)
                stat[0] = lo if stat[0] is None else min(int(stat[0]), lo)
                stat[1] = hi if stat[1] is None else max(int(stat[1]), hi)
            stat[2] = int(stat[2]) + 1
            if len(st_batch) >= 50000:
                db.executemany("INSERT INTO stop_times VALUES(?,?,?,?,?,?)", st_batch)
                st_batch.clear()
        if st_batch:
            db.executemany("INSERT INTO stop_times VALUES(?,?,?,?,?,?)", st_batch)

        db.executemany(
            "UPDATE trips SET first_sec=?, last_sec=?, stop_count=? WHERE source=? AND trip_id=?",
            [(v[0], v[1], v[2], source, tid) for tid, v in stats.items()]
        )

        service_days = all_service_days(z)
        sd_batch = []
        for service_id, days in service_days.items():
            for day in days:
                sd_batch.append((source, day, service_id))
                if len(sd_batch) >= 50000:
                    db.executemany("INSERT OR IGNORE INTO service_days VALUES(?,?,?)", sd_batch)
                    sd_batch.clear()
        if sd_batch:
            db.executemany("INSERT OR IGNORE INTO service_days VALUES(?,?,?)", sd_batch)

        db.execute("""
          INSERT OR IGNORE INTO day_trips(source, service_date, trip_id)
          SELECT t.source, sd.service_date, t.trip_id
          FROM trips t
          JOIN service_days sd
            ON sd.source=t.source AND sd.service_id=t.service_id
          WHERE t.source=?
        """, (source,))

        db.execute("INSERT INTO feeds VALUES(?,?,?)", (source, sha256_file(zip_path), zip_path.name))
        db.commit()
        count = db.execute("SELECT COUNT(*) FROM trips WHERE source=?", (source,)).fetchone()[0]
        days = db.execute("SELECT COUNT(DISTINCT service_date) FROM day_trips WHERE source=?", (source,)).fetchone()[0]
        print(f"[{source}] trips={count} jours={days} route_types={dict(route_types)}", flush=True)


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
    try:
        db = sqlite3.connect(tmp)
        create_schema(db)
        built_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        db.executemany("INSERT INTO meta VALUES(?,?)", [
            ("schema_version", str(SCHEMA_VERSION)),
            ("built_at", built_at),
            ("policy", "FR:2=rail,0=tram_train,3=excluded;LU:2=rail,0/3=excluded"),
        ])
        load_feed(db, sncf, "FR")
        load_feed(db, lux, "LU")
        print("[index] création", flush=True)
        db.executescript("""
          CREATE INDEX idx_trips_service ON trips(source, service_id);
          CREATE INDEX idx_trips_number ON trips(source, number);
          CREATE INDEX idx_trips_mode ON trips(source, mode);
          CREATE INDEX idx_day_date ON day_trips(service_date, source);
          CREATE INDEX idx_stop_times_trip ON stop_times(source, trip_id, seq);
          CREATE INDEX idx_stops_name ON stops(source, name);
          ANALYZE;
        """)
        db.commit()
        db.execute("PRAGMA optimize")
        db.close()
        os.chmod(tmp, 0o644)
        os.replace(tmp, out)
        print(f"OK {out} {out.stat().st_size/1024/1024:.2f} MiB")
    except Exception:
        try: tmp.unlink()
        except FileNotFoundError: pass
        raise


if __name__ == "__main__":
    main()
