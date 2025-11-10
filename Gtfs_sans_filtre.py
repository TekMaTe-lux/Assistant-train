import requests
import json
import re
import csv
from collections import defaultdict
from google.transit import gtfs_realtime_pb2
import io
import os

# --- Télécharger stops.txt depuis GitHub ---
stops_url = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stops.txt"
stops_response = requests.get(stops_url, timeout=20)
stops_response.raise_for_status()
stops_text = stops_response.content.decode("utf-8", errors="replace")

# Lire stops.txt dans un dictionnaire basé sur l’ID numérique (ex: 87192039)
stop_id_to_name = {}
reader = csv.DictReader(io.StringIO(stops_text))
for row in reader:
    stop_id_raw = (row.get("stop_id") or "").strip()
    stop_name = (row.get("stop_name") or "").strip()
    match = re.search(r"(\d{8})", stop_id_raw)
    if match:
        id_num = match.group(1)
        if id_num not in stop_id_to_name:
            stop_id_to_name[id_num] = stop_name  # premier nom rencontré

def nettoyer_stop_id(stop_id):
    match = re.search(r"(\d{8})", stop_id or "")
    return match.group(1) if match else (stop_id or "").strip()

# Gares d'intérêt (Nancy / Metz / Luxembourg / Paris-Est)
gares_nancy_metz_lux = {"87141002", "87192039", "87191007", "82001000"}

# Charger GTFS-RT Trip Updates
url = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates"
response = requests.get(url, timeout=20)
response.raise_for_status()

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Enums lisibles, compatibles toutes versions
TripSchRel = gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship
StopSchRel = gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship

TRIP_SR = {
    TripSchRel.SCHEDULED: "SCHEDULED",
    TripSchRel.ADDED: "ADDED",
    TripSchRel.UNSCHEDULED: "UNSCHEDULED",
    TripSchRel.CANCELED: "CANCELED",
    TripSchRel.REPLACEMENT: "REPLACEMENT",
    TripSchRel.DUPLICATED: "DUPLICATED",
}
if hasattr(TripSchRel, "MODIFIED"):
    TRIP_SR[TripSchRel.MODIFIED] = "MODIFIED"

STOP_SR = {
    StopSchRel.SCHEDULED: "SCHEDULED",
    StopSchRel.SKIPPED: "SKIPPED",
    StopSchRel.NO_DATA: "NO_DATA",
    StopSchRel.UNSCHEDULED: "UNSCHEDULED",
}

prefixes_autorises = ("885", "887", "888")

def compute_status(trip_sr_name, stops_out):
    if trip_sr_name == "CANCELED":
        return "CANCELED"
    if any(s.get("schedule_relationship") == "SKIPPED" for s in stops_out):
        return "PARTIAL_CANCELLATION"
    if any(((s.get("arr_delay_min") or 0) > 0) or ((s.get("dep_delay_min") or 0) > 0) for s in stops_out):
        return "DELAYED"
    return "ON_TIME"

# Sortie
trains_out = {}

for entity in feed.entity:
    if not entity.HasField("trip_update"):
        continue

    tu = entity.trip_update
    trip = tu.trip

    trip_id = trip.trip_id or ""
    m = re.search(r"(\d{5})", trip_id)
    train_number = m.group(1) if m else "?????"
    if not train_number.startswith(prefixes_autorises):
        continue

    trip_sr_name = TRIP_SR.get(trip.schedule_relationship, "SCHEDULED")

    stops_out = []
    touches_region = False

    for stu in tu.stop_time_update:
        stop_id_clean = nettoyer_stop_id(stu.stop_id)
        stop_name = stop_id_to_name.get(stop_id_clean, f"StopPoint {stop_id_clean}")

        if stop_id_clean in gares_nancy_metz_lux:
            touches_region = True

        arr_min = stu.arrival.delay // 60 if (stu.HasField("arrival") and stu.arrival.HasField("delay")) else 0
        dep_min = stu.departure.delay // 60 if (stu.HasField("departure") and stu.departure.HasField("delay")) else 0
        stu_sr_name = STOP_SR.get(stu.schedule_relationship, "SCHEDULED")

        stops_out.append({
            "stop_id": stop_id_clean,
            "stop_name": stop_name,
            "arr_delay_min": arr_min,
            "dep_delay_min": dep_min,
            "schedule_relationship": stu_sr_name
        })

    include = False
    if stops_out:
        include = touches_region
    else:
        include = (trip_sr_name == "CANCELED")
    if not include:
        continue

    status = compute_status(trip_sr_name, stops_out)

    # Tous les arrêts : retard >0 en minutes, sinon 0
    stops_map = {}
    for s in stops_out:
        best = max(s.get("arr_delay_min", 0), s.get("dep_delay_min", 0))
        stops_map[s["stop_name"]] = (best if best > 0 else 0)

    trains_out[train_number] = {
        "train_id": trip_id,
        "train_number": train_number,
        "status": status,
        "stops": stops_map
    }

os.makedirs("Assistant-train", exist_ok=True)
output_path = "Assistant-train/retards_nancymetzlux.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(trains_out, f, ensure_ascii=False, indent=2)

counts = {"CANCELED":0, "PARTIAL_CANCELLATION":0, "DELAYED":0, "ON_TIME":0}
for v in trains_out.values():
    counts[v["status"]] = counts.get(v["status"], 0) + 1

print(f"{len(trains_out)} trains inclus (préfixes {prefixes_autorises})")
print(" - CANCELED:", counts.get("CANCELED", 0))
print(" - PARTIAL_CANCELLATION:", counts.get("PARTIAL_CANCELLATION", 0))
print(" - DELAYED:", counts.get("DELAYED", 0))
print(" - ON_TIME:", counts.get("ON_TIME", 0))
print(f"Export JSON: {output_path}")
