#!/usr/bin/env python3
"""Publish small, sanitized CFL per-stop snapshots derived from existing history.
No HAFAS calls. No SNCF code, data, statistics or sources modified.
"""
import json
import os
import re
import sqlite3
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DB = Path("/var/lib/labetaillere-cfl-history/observations.sqlite3")
ARRIVALS = Path("/var/www/gtfs/retards_cfl_arrivals.json")
OUTPUT = Path("/var/www/gtfs/cfl_live_stops.json")
ARRIVALS_MEMORY = Path("/var/lib/labetaillere-cfl-live/arrivals.json")
LOCAL_TZ = ZoneInfo("Europe/Luxembourg")
TRAIN_PATTERN = re.compile(r"^(IC|RE|RB|EC|ICE|TER|L|S)\s*(\d{3,6})$", re.I)


def atomic_json(path, payload):
    fd, tmp = tempfile.mkstemp(prefix=".cfl-live-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as writer:
            json.dump(payload, writer, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            writer.flush()
            os.fsync(writer.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def text(value, size=100):
    return str(value or "").strip()[:size]


def numeric(value, limit=360):
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
        return round(f, 1) if abs(f) <= limit else None
    except (ValueError, TypeError, OverflowError):
        return None


def build(now=None):
    now = now or datetime.now(timezone.utc)
    local_date = now.astimezone(LOCAL_TZ).date()
    dates = [(local_date + timedelta(days=offset)).isoformat() for offset in (-1, 0, 1)]
    groups = {}
    with sqlite3.connect("file:" + str(DB) + "?mode=ro", uri=True, timeout=10) as conn:
        for journey_id, service, train, station, scheduled, seen, delay, cancelled, platform in conn.execute(
            """SELECT journey_key, service_date, train_label, station, scheduled_time,
                      last_seen_epoch, delay_minutes, cancelled, platform
               FROM stop_latest WHERE service_date BETWEEN ? AND ?
               ORDER BY service_date, train_label, journey_key, scheduled_time""",
            (dates[0], dates[-1])
        ):
            train = text(train, 32)
            match = TRAIN_PATTERN.match(train)
            if not match or not station:
                continue
            # The historical collector writes "TER88533" (without a space).
            # Normalize its public key exactly like other CFL sheet consumers.
            train = f"{match.group(1).upper()} {match.group(2)}"
            key = (service, train, journey_id)
            if key not in groups:
                groups[key] = {"date": service, "train": train, "stops": [], "lastSeen": 0}
            group = groups[key]
            group["stops"].append({
                "name": text(station), "planned": text(scheduled, 16),
                "seenEpoch": int(seen),
                "delay": numeric(delay), "cancelled": bool(cancelled),
                "platform": text(platform, 24) or None,
            })
            group["lastSeen"] = max(group["lastSeen"], int(seen))
    result = defaultdict(list)
    for (_, train, _), journey in groups.items():
        # Key includes the train category; avoid same-number IC/RB collisions.
        result[train].append(journey)
    for journeys in result.values():
        journeys.sort(key=lambda j: j["lastSeen"], reverse=True)

    # The existing CFL arrivals collector provides the arrival platform and forecast
    # even when departureBoard has no entry for the terminus.
    # Retain the latest observation locally when an arrived train leaves its feed.
    arrival_data = {}
    try:
        previous = json.loads(ARRIVALS_MEMORY.read_text(encoding="utf-8"))
        if isinstance(previous, dict):
            arrival_data = {k:v for k,v in previous.items()
                            if isinstance(v,dict) and v.get("date") in dates}
    except (OSError, ValueError, TypeError):
        pass
    try:
        source = json.loads(ARRIVALS.read_text(encoding="utf-8"))
        observed = str(source.get("updatedAt") or "")
        # Reject stale arrivals from other calendar days.
        if observed[:10] == local_date.isoformat():
            for train, row in (source.get("data") or {}).items():
                if not isinstance(row, dict) or not TRAIN_PATTERN.match(str(train)):
                    continue
                planned = text(row.get("arrivalPlanned"), 16)
                forecast = text(row.get("arrivalRealtime"), 16)
                arrival_data[train] = {
                    "date": local_date.isoformat(),
                    "station": text(row.get("station") or row.get("destination") or "Luxembourg", 110),
                    "planned": planned,
                    "forecast": forecast or None,
                    "delay": numeric(row.get("arrivalDelayMin")),
                    "platform": text(row.get("arrivalPlatformRealtime") or row.get("arrivalPlatformPlanned"), 24) or None,
                    "cancelled": row.get("arrivalCancelled") is True,
                    "partialCancelled": row.get("partialCancelled") is True,
                    "source": "CFL_HAFAS_ARRIVALS",
                }
    except (OSError, ValueError, TypeError) as exc:
        print("CFL arrival supplement unavailable:", type(exc).__name__)

    return {
        "version": 1,
        "updatedAt": now.replace(microsecond=0).isoformat(),
        "source": "CFL/HAFAS observed stop memory; GTFS planned schedule handled by client",
        "trains": dict(result),
        "arrivals": arrival_data,
    }


def main():
    if not DB.is_file():
        raise RuntimeError("Existing CFL history database not found; refusing empty update")
    payload = build()
    ARRIVALS_MEMORY.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(ARRIVALS_MEMORY, payload["arrivals"])
    atomic_json(OUTPUT, payload)
    print(json.dumps({
        "ok": True, "trains": len(payload["trains"]),
        "journeys": sum(map(len, payload["trains"].values())),
        "arrivals": len(payload["arrivals"]),
        "bytes": OUTPUT.stat().st_size
    }))


if __name__ == "__main__":
    main()
