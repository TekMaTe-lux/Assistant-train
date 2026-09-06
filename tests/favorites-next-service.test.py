#!/usr/bin/env python3
import csv
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "vps/home/build_train_static_today.py"


def write_csv(path, fields, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    out = base / "result.json"
    write_csv(base / "calendar.txt",
              ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
              [
                  {"service_id": "WEEK", "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1", "friday": "1", "saturday": "0", "sunday": "0", "start_date": "20200101", "end_date": "20991231"},
                  {"service_id": "DAILY", "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1", "friday": "1", "saturday": "1", "sunday": "1", "start_date": "20200101", "end_date": "20991231"},
                  {"service_id": "EXTRA", "monday": "0", "tuesday": "0", "wednesday": "0", "thursday": "0", "friday": "0", "saturday": "0", "sunday": "0", "start_date": "20200101", "end_date": "20991231"},
              ])
    write_csv(base / "calendar_dates.txt", ["service_id", "date", "exception_type"], [
        {"service_id": "DAILY", "date": "20260906", "exception_type": "2"},
        {"service_id": "EXTRA", "date": "20260907", "exception_type": "1"},
    ])
    write_csv(base / "trips.txt", ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"], [
        {"route_id": "R1", "service_id": "WEEK", "trip_id": "T88501", "trip_headsign": "", "trip_short_name": "88501"},
        {"route_id": "R2", "service_id": "DAILY", "trip_id": "T88532", "trip_headsign": "", "trip_short_name": "88532"},
        {"route_id": "R3", "service_id": "EXTRA", "trip_id": "T99999", "trip_headsign": "", "trip_short_name": "99999"},
    ])
    write_csv(base / "stops.txt", ["stop_id", "stop_name"], [
        {"stop_id": "A", "stop_name": "Luxembourg"}, {"stop_id": "B", "stop_name": "Nancy"}
    ])
    write_csv(base / "stop_times.txt", ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], [
        {"trip_id": trip, "arrival_time": start, "departure_time": start, "stop_id": "A", "stop_sequence": "1"}
        for trip, start in [("T88501", "07:01:00"), ("T88532", "17:39:00"), ("T99999", "08:00:00")]
    ] + [
        {"trip_id": trip, "arrival_time": end, "departure_time": end, "stop_id": "B", "stop_sequence": "2"}
        for trip, end in [("T88501", "08:10:00"), ("T88532", "19:10:00"), ("T99999", "09:00:00")]
    ])

    env = os.environ.copy()
    env.update({"LB_GTFS_DIR": str(base), "LB_TRAIN_STATIC_OUT": str(out), "LB_NEXT_SERVICE_HORIZON_DAYS": "14", "LB_BUILD_NOW": "2026-09-06T12:00:00", "TZ": "Europe/Paris"})
    subprocess.run(["python3", str(BUILDER)], env=env, check=True, capture_output=True, text=True)
    data = json.loads(out.read_text(encoding="utf-8"))

    assert "88501" not in data["trains"]
    assert data["next_trains"]["88501"]["service_date"] == "20260907"
    assert data["next_trains"]["88501"]["departure"] == "07:01"
    assert data["next_trains"]["88501"]["origin"] == "Luxembourg"
    assert "88532" not in data["trains"]  # exception_type=2
    assert data["next_trains"]["99999"]["service_date"] == "20260907"  # exception_type=1
    assert data["next_horizon_days"] == 14

source = (ROOT / "index.html").read_text(encoding="utf-8")
assert "LB_TRAIN_STATIC_NEXT" in source
assert "getTrainStaticNextPayload" in source
assert "data-service-date" in source
assert "FAV_NEXT_SERVICE_CACHE" not in source
assert "fetchNextFavoriteService" not in source
print("favorites-next-service: OK (cache groupé, aucun fetch journalier frontend)")
