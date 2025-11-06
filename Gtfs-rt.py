import requests
import re
import csv
import json
import os
import io
from collections import defaultdict
from google.transit import gtfs_realtime_pb2

# --- Télécharger stops.txt depuis GitHub ---
stops_url = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stops.txt"
stops_response = requests.get(stops_url, timeout=20)
stops_response.raise_for_status()
stops_text = stops_response.content.decode("utf-8", errors="replace")

# Lire stops.txt dans un dictionnaire basé sur l’ID numérique (8 chiffres)
stop_id_to_name = {}
reader = csv.DictReader(io.StringIO(stops_text))
for row in reader:
    stop_id_raw = (row.get("stop_id") or "").strip()
    stop_name = (row.get("stop_name") or "").strip()
    match = re.search(r"(\d{8})", stop_id_raw)
    if match:
        id_num = match.group(1)
        stop_id_to_name.setdefault(id_num, stop_name or stop_id_raw)

def nettoyer_stop_id(stop_id: str) -> str:
    match = re.search(r"(\d{8})", stop_id or "")
    return match.group(1) if match else (stop_id or "").strip()

# --- Charger le GTFS-RT Trip Updates ---
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url, timeout=20)
response.raise_for_status()

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Map des enums -> noms lisibles
TripSchRel = gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship
StopSchRel = gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship
TRIP_SCHEDULE_RELATIONSHIP_NAME = {
    TripSchRel.SCHEDULED: "SCHEDULED",
    TripSchRel.ADDED: "ADDED",
    TripSchRel.UNSCHEDULED: "UNSCHEDULED",
    TripSchRel.CANCELED: "CANCELED",
    TripSchRel.REPLACEMENT: "REPLACEMENT",
    TripSchRel.DUPLICATED: "DUPLICATED",
    TripSchRel.MODIFIED: "MODIFIED",
}
STOP_SCHEDULE_RELATIONSHIP_NAME = {
    StopSchRel.SCHEDULED: "SCHEDULED",
    StopSchRel.SKIPPED: "SKIPPED",
    StopSchRel.NO_DATA: "NO_DATA",
    StopSchRel.UNSCHEDULED: "UNSCHEDULED",
}

# Stockage des trains regroupés par trip_id
trains_groupes = defaultdict(lambda: {
    "train_id": "",
    "train_number": "",
    "trip_schedule_relationship": "SCHEDULED",  # CANCELED/ADDED/MODIFIED/...
    "status": "UNKNOWN",                        # synthèse: CANCELED / PARTIAL_CANCELLATION / DELAYED / SCHEDULED / ADDED / MODIFIED
    "stops": [],                                # liste d'arrêts
})

def compute_status(trip_sr_name: str, stops: list) -> str:
    # Priorités: CANCELED > PARTIAL_CANCELLATION > ADDED/MODIFIED > DELAYED > SCHEDULED
    if trip_sr_name == "CANCELED":
        return "CANCELED"
    if any(s.get("schedule_relationship") == "SKIPPED" for s in stops):
        return "PARTIAL_CANCELLATION"
    if trip_sr_name in ("ADDED", "MODIFIED"):
        return trip_sr_name
    # Si pas annulé/partiel, regarder le délai
    if any((s.get("arrival_delay") or 0) != 0 or (s.get("departure_delay") or 0) != 0 for s in stops):
        return "DELAYED"
    return "SCHEDULED"

# Traiter chaque trip_update
for entity in feed.entity:
    if not entity.HasField("trip_update"):
        continue

    trip_update = entity.trip_update
    trip = trip_update.trip

    trip_id = trip.trip_id or ""
    match_num = re.search(r"(\d{5})", trip_id)
    train_number = match_num.group(1) if match_num else "?????"

    # Trip-level schedule relationship (peut signaler une suppression totale)
    trip_sr_val = trip.schedule_relationship
    trip_sr_name = TRIP_SCHEDULE_RELATIONSHIP_NAME.get(trip_sr_val, "SCHEDULED")

    tg = trains_groupes[trip_id]
    tg["train_id"] = trip_id
    tg["train_number"] = train_number
    tg["trip_schedule_relationship"] = trip_sr_name

    stops_out = []

    # IMPORTANT: Même si le trip est CANCELED, certains producteurs n'envoient pas de stop_time_update.
    # On garde quand même l'entité pour l'export, avec stops Out vide + status = CANCELED.
    for stu in trip_update.stop_time_update:
        stop_id_clean = nettoyer_stop_id(stu.stop_id)
        stop_name = stop_id_to_name.get(stop_id_clean, stu.stop_id or stop_id_clean)

        # Delays (en secondes) si fournis
        arrival_delay = stu.arrival.delay if (stu.HasField("arrival") and stu.arrival.HasField("delay")) else None
        departure_delay = stu.departure.delay if (stu.HasField("departure") and stu.departure.HasField("delay")) else None

        # Timestamps estimés si fournis (epoch)
        arrival_time = stu.arrival.time if (stu.HasField("arrival") and stu.arrival.HasField("time")) else None
        departure_time = stu.departure.time if (stu.HasField("departure") and stu.departure.HasField("time")) else None

        # Stop-level schedule relationship (peut signaler une suppression partielle)
        stu_sr_val = stu.schedule_relationship
        stu_sr_name = STOP_SCHEDULE_RELATIONSHIP_NAME.get(stu_sr_val, "SCHEDULED")

        stops_out.append({
            "stop_id": stop_id_clean,
            "stop_name": stop_name,
            "arrival": arrival_time,
            "departure": departure_time,
            "arrival_delay": arrival_delay,
            "departure_delay": departure_delay,
            "schedule_relationship": stu_sr_name,  # SCHEDULED / SKIPPED / NO_DATA / UNSCHEDULED
            "skipped": (stu_sr_name == "SKIPPED"),
        })

    tg["stops"] = stops_out
    tg["status"] = compute_status(trip_sr_name, stops_out)

# -- Sortie
os.makedirs("Assistant-train", exist_ok=True)
output_path = "Assistant-train/gtfs_rt_trains_complets.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(list(trains_groupes.values()), f, ensure_ascii=False, indent=2)

# Petit récap console utile
total = len(trains_groupes)
count_canceled = sum(1 for t in trains_groupes.values() if t["status"] == "CANCELED")
count_partial = sum(1 for t in trains_groupes.values() if t["status"] == "PARTIAL_CANCELLATION")
count_delayed = sum(1 for t in trains_groupes.values() if t["status"] == "DELAYED")

print(f"{total} trains exportés dans {output_path}")
print(f" - CANCELED: {count_canceled}")
print(f" - PARTIAL_CANCELLATION: {count_partial}")
print(f" - DELAYED: {count_delayed}")
