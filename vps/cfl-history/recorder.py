#!/usr/bin/env python3
"""Archive CFL/HAFAS stop observations without touching SNCF statistics.

Input: the existing cfl-stop-state-v2.json (8-hour rolling memory).
Output: independent SQLite database and an indicative, non-official CFL summary.

Read-only against every existing SNCF/GTFS-RT/statistics file.
One execution is safe to repeat: observation timestamps make ingestion idempotent.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

SOURCE = Path(os.environ.get(
    "LB_CFL_MEMORY_SOURCE", "/var/lib/labetaillere-hafas/cfl-stop-state-v2.json"))
BASE = Path(os.environ.get("LB_CFL_HISTORY_DIR", "/var/lib/labetaillere-cfl-history"))
DB = BASE / "observations.sqlite3"
SUMMARY = BASE / "summary.json"
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def create_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS stop_latest (
            journey_key TEXT NOT NULL,
            service_date TEXT NOT NULL,
            train_label TEXT NOT NULL,
            station TEXT NOT NULL,
            scheduled_time TEXT,
            first_seen_epoch INTEGER NOT NULL,
            last_seen_epoch INTEGER NOT NULL,
            delay_minutes REAL,
            cancelled INTEGER NOT NULL DEFAULT 0,
            platform TEXT,
            source TEXT NOT NULL DEFAULT 'CFL_HAFAS',
            PRIMARY KEY (journey_key, station)
        );
        CREATE INDEX IF NOT EXISTS idx_cfl_latest_date ON stop_latest(service_date);
        CREATE INDEX IF NOT EXISTS idx_cfl_latest_train ON stop_latest(train_label, service_date);
        CREATE TABLE IF NOT EXISTS stop_events (
            journey_key TEXT NOT NULL,
            service_date TEXT NOT NULL,
            train_label TEXT NOT NULL,
            station TEXT NOT NULL,
            observed_epoch INTEGER NOT NULL,
            delay_minutes REAL,
            cancelled INTEGER NOT NULL,
            platform TEXT,
            PRIMARY KEY (journey_key, station, observed_epoch)
        );
        CREATE INDEX IF NOT EXISTS idx_cfl_events_date ON stop_events(service_date);
    """)


def safe_text(value, max_len=180):
    return str(value or "").strip()[:max_len]


def valid_date(value):
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def parse_delay(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
        if not -360 <= n <= 360:
            return None
        return n
    except (ValueError, TypeError, OverflowError):
        return None


def load_state(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "cfl-stop-state-v2":
        raise ValueError("Unexpected source schema (requires cfl-stop-state-v2)")
    journeys = payload.get("journeys")
    if not isinstance(journeys, dict):
        raise ValueError("CFL journey memory is missing")
    return journeys


def ingest(conn, journeys):
    examined = inserted = updated = events = 0
    with conn:
        for ref, journey in journeys.items():
            if not isinstance(journey, dict):
                continue
            date = journey.get("serviceDate")
            if not valid_date(date):
                continue
            train = safe_text(journey.get("train"), 40)
            if not train or not str(ref).strip():
                continue
            key = hashlib.sha256((date + "\x00" + str(ref)).encode("utf-8")).hexdigest()
            for station_name, obs in (journey.get("stationStates") or {}).items():
                if not isinstance(obs, dict):
                    continue
                station = safe_text(station_name)
                if not station:
                    continue
                try:
                    seen = int(obs.get("seenEpoch") or 0)
                except (TypeError, ValueError):
                    continue
                if seen < 1600000000:
                    continue
                examined += 1
                cancelled = int(obs.get("cancelled") is True)
                delay = None if cancelled else parse_delay(obs.get("delay"))
                platform = safe_text(obs.get("platform"), 60) or None
                scheduled = safe_text(obs.get("scheduledTime"), 24) or None

                prior = conn.execute(
                    "SELECT last_seen_epoch, delay_minutes, cancelled, platform "
                    "FROM stop_latest WHERE journey_key=? AND station=?",
                    (key, station)
                ).fetchone()
                if prior is not None and seen <= prior[0]:
                    continue

                conn.execute("""
                    INSERT INTO stop_latest
                      (journey_key, service_date, train_label, station, scheduled_time,
                       first_seen_epoch, last_seen_epoch, delay_minutes, cancelled, platform)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(journey_key, station) DO UPDATE SET
                      train_label=excluded.train_label,
                      scheduled_time=COALESCE(excluded.scheduled_time, stop_latest.scheduled_time),
                      last_seen_epoch=excluded.last_seen_epoch,
                      delay_minutes=excluded.delay_minutes,
                      cancelled=excluded.cancelled,
                      platform=COALESCE(excluded.platform, stop_latest.platform)
                """, (key, date, train, station, scheduled, seen, seen, delay, cancelled, platform))
                if prior is None:
                    inserted += 1
                else:
                    updated += 1
                # Store transitions only, rather than an event every poll.
                if prior is None or (prior[1], prior[2], prior[3]) != (delay, cancelled, platform):
                    conn.execute("""
                        INSERT OR IGNORE INTO stop_events
                          (journey_key,service_date,train_label,station,observed_epoch,
                           delay_minutes,cancelled,platform)
                        VALUES (?,?,?,?,?,?,?,?)
                    """, (key, date, train, station, seen, delay, cancelled, platform))
                    events += 1
    return {"readStops": examined, "newStops": inserted, "refreshedStops": updated, "transitions": events}


def new_group():
    return {"observations": 0, "delayKnown": 0, "delay6OrMore": 0,
            "cancelled": 0, "sumDelayMinutes": 0.0, "journeys": set()}


def observe(group, key, delay, cancelled):
    group["observations"] += 1
    group["journeys"].add(key)
    group["cancelled"] += bool(cancelled)
    if delay is not None and not cancelled:
        group["delayKnown"] += 1
        group["sumDelayMinutes"] += delay
        group["delay6OrMore"] += delay >= 6


def finalized(group):
    known = group["delayKnown"]
    return {
        "observedJourneys": len(group["journeys"]),
        "observedStops": group["observations"],
        "knownDelayStops": known,
        "delay6OrMoreStops": group["delay6OrMore"],
        "cancelledStops": group["cancelled"],
        "delay6RateOnKnownStopsPct": round(100 * group["delay6OrMore"] / known, 1) if known else None,
        "averageLastObservedDelayMinutes": round(group["sumDelayMinutes"] / known, 2) if known else None,
    }


def make_summary(conn, days=30, now=None):
    now = now or datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).date().isoformat()
    overall = new_group()
    daily, stations, trains = defaultdict(new_group), defaultdict(new_group), defaultdict(new_group)
    oldest = newest = None
    for date, key, train, station, delay, cancelled in conn.execute(
        "SELECT service_date,journey_key,train_label,station,delay_minutes,cancelled "
        "FROM stop_latest WHERE service_date>=? ORDER BY service_date", (start,)
    ):
        oldest = date if oldest is None or date < oldest else oldest
        newest = date if newest is None or date > newest else newest
        for group in (overall, daily[date], stations[station], trains[train]):
            observe(group, key, delay, cancelled)
    return {
        "version": 1,
        "generatedAt": now.isoformat(),
        "source": "CFL/HAFAS departureBoard via cfl-stop-state-v2",
        "methodology": "Last observed prediction per stop, not certified actual arrival; not official CFL punctuality.",
        "daysRequested": days,
        "coverageStart": oldest,
        "coverageEnd": newest,
        "coverageIncompleteBeforeFirstCollection": True,
        "overall": finalized(overall),
        "daily": {name: finalized(g) for name, g in sorted(daily.items())},
        "stations": {name: finalized(g) for name, g in sorted(stations.items())},
        "trains": {name: finalized(g) for name, g in sorted(trains.items())},
    }


def write_summary(path, summary):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".cfl-summary-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(summary, out, ensure_ascii=False, separators=(",", ":"))
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        with sqlite3.connect(Path(tmp) / "test.sqlite") as db:
            create_schema(db)
            ref = "test-reference"
            base = {"train": "RE 1234", "serviceDate": "2026-10-21",
                    "stationStates": {"Bettembourg": {
                        "scheduledTime": "08:20:00", "seenEpoch": 1792560000,
                        "cancelled": False, "delay": 7, "platform": "2"}}}
            a = ingest(db, {ref: base})
            assert a["newStops"] == 1 and a["transitions"] == 1
            assert ingest(db, {ref: base})["transitions"] == 0
            b = {**base, "stationStates": {**base["stationStates"],
                 "Luxembourg": {"seenEpoch": 1792560100, "cancelled": False, "delay": 10}}}
            ingest(db, {ref: b})
            assert db.execute("SELECT COUNT(*) FROM stop_latest").fetchone()[0] == 2
            # The previous station persists even when absent from a subsequent update.
            later = {**base, "stationStates": {"Luxembourg": {
                "seenEpoch": 1792560200, "cancelled": False, "delay": 12}}}
            ingest(db, {ref: later})
            assert db.execute(
                "SELECT delay_minutes FROM stop_latest WHERE station='Bettembourg'"
            ).fetchone()[0] == 7
            assert db.execute("SELECT COUNT(*) FROM stop_events").fetchone()[0] == 3
            assert make_summary(db, 30, datetime(2026, 10, 21, tzinfo=timezone.utc))["overall"]["observedStops"] == 2
            another_date = {**base, "serviceDate": "2026-10-22"}
            ingest(db, {ref: another_date})
            assert db.execute("SELECT COUNT(*) FROM stop_latest").fetchone()[0] == 3
            assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    print("SELF-TEST OK: idempotency, past stops, transitions, service dates, sqlite integrity")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--summary-only", action="store_true")
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return
    if not 1 <= args.days <= 365:
        ap.error("--days must be in [1, 365]")
    BASE.mkdir(parents=True, exist_ok=True)
    # Do not create a database or publish an empty archive if input is unreadable.
    journeys = None if args.summary_only else load_state(SOURCE)
    with sqlite3.connect(DB, timeout=15) as conn:
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        create_schema(conn)
        result = ingest(conn, journeys) if journeys is not None else {}
        summary = make_summary(conn, args.days)
        write_summary(SUMMARY, summary)
        totals = conn.execute(
            "SELECT (SELECT COUNT(*) FROM stop_latest),(SELECT COUNT(*) FROM stop_events)"
        ).fetchone()
    print(json.dumps({"ok": True, **result, "storedStops": totals[0],
                      "storedTransitions": totals[1],
                      "summaryCoverageStart": summary["coverageStart"],
                      "summaryCoverageEnd": summary["coverageEnd"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("CFL history error: " + str(exc), file=sys.stderr)
        sys.exit(1)
