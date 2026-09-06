#!/usr/bin/env python3
"""Construit le cache groupé des trains du jour et de leur prochaine circulation."""

import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

GTFS_DIR = os.environ.get("LB_GTFS_DIR", "/var/www/html/gtfs/static")
OUT = os.environ.get("LB_TRAIN_STATIC_OUT", "/var/www/gtfs/train_static_today.json")
TZ = ZoneInfo("Europe/Paris")
HORIZON_DAYS = int(os.environ.get("LB_NEXT_SERVICE_HORIZON_DAYS", "14"))


def read_rows(filename):
    path = os.path.join(GTFS_DIR, filename)
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def hhmm(value):
    if not value:
        return ""
    hour, minute, *_ = value.split(":")
    return f"{int(hour) % 24:02d}:{minute}"


def time_seconds(value):
    try:
        hour, minute, second = (value or "0:0:0").split(":")[:3]
        return int(hour) * 3600 + int(minute) * 60 + int(second)
    except (TypeError, ValueError):
        return 10**9


def active_services(day, calendars, exceptions):
    compact = day.strftime("%Y%m%d")
    weekday = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[day.weekday()]
    active = set()
    for row in calendars:
        if row.get("start_date", "") <= compact <= row.get("end_date", "") and row.get(weekday) == "1":
            active.add(row.get("service_id", ""))
    for row in exceptions.get(compact, []):
        service_id = row.get("service_id", "")
        if row.get("exception_type") == "1":
            active.add(service_id)
        elif row.get("exception_type") == "2":
            active.discard(service_id)
    active.discard("")
    return active


def main(now=None):
    forced_now = os.environ.get("LB_BUILD_NOW", "").strip()
    now = now or (datetime.fromisoformat(forced_now).replace(tzinfo=TZ) if forced_now else datetime.now(TZ))
    today = now.date()
    dates = [today + timedelta(days=offset) for offset in range(HORIZON_DAYS + 1)]

    exceptions = defaultdict(list)
    for row in read_rows("calendar_dates.txt"):
        exceptions[row.get("date", "")].append(row)
    calendars = read_rows("calendar.txt")
    active_by_date = {day.strftime("%Y%m%d"): active_services(day, calendars, exceptions) for day in dates}
    useful_services = set().union(*active_by_date.values()) if active_by_date else set()

    trips = {}
    for row in read_rows("trips.txt"):
        service_id = row.get("service_id", "")
        if service_id not in useful_services:
            continue
        label = (row.get("trip_short_name") or row.get("trip_headsign") or "").strip()
        train = "".join(char for char in label if char.isdigit())
        trip_id = row.get("trip_id", "")
        if train and trip_id:
            trips[trip_id] = {
                "train": train,
                "service_id": service_id,
                "route_id": row.get("route_id", ""),
            }

    stops = {row.get("stop_id", ""): row.get("stop_name", "") for row in read_rows("stops.txt")}
    by_trip = defaultdict(list)
    for row in read_rows("stop_times.txt"):
        trip_id = row.get("trip_id", "")
        if trip_id not in trips:
            continue
        try:
            sequence = int(row.get("stop_sequence") or 0)
        except ValueError:
            sequence = 0
        by_trip[trip_id].append({
            "seq": sequence,
            "stop_id": row.get("stop_id", ""),
            "dep": row.get("departure_time") or row.get("arrival_time") or "",
            "arr": row.get("arrival_time") or row.get("departure_time") or "",
        })

    occurrences = []
    for trip_id, rows in by_trip.items():
        rows.sort(key=lambda item: item["seq"])
        if len(rows) < 2:
            continue
        meta = trips[trip_id]
        first, last = rows[0], rows[-1]
        occurrences.append({
            "train": meta["train"],
            "trip_id": trip_id,
            "service_id": meta["service_id"],
            "origin": stops.get(first["stop_id"], first["stop_id"]),
            "destination": stops.get(last["stop_id"], last["stop_id"]),
            "departure": hhmm(first["dep"]),
            "arrival": hhmm(last["arr"]),
            "route_id": meta["route_id"],
            "_rank": (-len(rows), time_seconds(first["dep"]), trip_id),
        })

    by_date = {}
    for compact, services in active_by_date.items():
        selected = {}
        for row in occurrences:
            if row["service_id"] not in services:
                continue
            current = selected.get(row["train"])
            if current is None or row["_rank"] < current["_rank"]:
                selected[row["train"]] = row
        by_date[compact] = selected

    today_key = today.strftime("%Y%m%d")
    trains = {}
    for train, row in by_date.get(today_key, {}).items():
        trains[train] = {key: value for key, value in row.items() if key not in {"service_id", "_rank"}}

    next_trains = {}
    for day in dates[1:]:
        compact = day.strftime("%Y%m%d")
        for train, row in by_date.get(compact, {}).items():
            if train in next_trains:
                continue
            clean = {key: value for key, value in row.items() if key not in {"service_id", "_rank"}}
            clean["service_date"] = compact
            next_trains[train] = clean

    data = {
        "generated_at": now.isoformat(),
        "date": today_key,
        "count": len(trains),
        "trains": trains,
        "next_trains": next_trains,
        "next_horizon_days": HORIZON_DAYS,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    temporary = OUT + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, OUT)
    print(f"OK {OUT} {len(trains)} trains aujourd'hui, {len(next_trains)} prochaines circulations")


if __name__ == "__main__":
    main()
