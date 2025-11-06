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
            stop_id_to_name[id_num] = stop_name  # Ne garde que le premier nom trouvé

# Fonction pour extraire le vrai stop_id à 8 chiffres
def nettoyer_stop_id(stop_id):
    match = re.search(r"(\d{8})", stop_id or "")
    return match.group(1) if match else (stop_id or "").strip()

# Liste des gares d'intérêt (Nancy / Metz / Luxembourg / Paris-Est)
gares_nancy_metz_lux = {"87141002", "87192039", "87191007", "82001000"}

# Charger le GTFS-RT Trip Updates
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url, timeout=20)
response.raise_for_status()

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Enums lisibles
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
STOP_SR = {
    StopSchRel.SCHEDULED: "SCHEDULED",
    StopSchRel.SKIPPED: "SKIPPED",
    StopSchRel.NO_DATA: "NO_DATA",
    StopSchRel.UNSCHEDULED: "UNSCHEDULED",
}

prefixes_autorises = ("885", "887", "888")

# Dictionnaire principal : un seul fichier final
trains_sortie = {}

def compute_status(trip_sr_name, stops_out):
    if trip_sr_name == "CANCELED":
        return "CANCELED"
    if any(s.get("schedule_relationship") == "SKIPPED" for s in stops_out):
        return "PARTIAL_CANCELLATION"
    if any(((s.get("arrival_delay_minutes") or 0) > 0) or ((s.get("departure_delay_minutes") or 0) > 0) for s in stops_out):
        return "DELAYED"
    return "ON_TIME"

# Parcours du flux GTFS-RT
for entity in feed.entity:
    if not entity.HasField("trip_update"):
        continue

    tu = entity.trip_update
    trip = tu.trip

    trip_id_complet = trip.trip_id or ""
    match = re.search(r"(\d{5})", trip_id_complet)
    train_number = match.group(1) if match else "?????"

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

        arrival_delay_minutes = stu.arrival.delay // 60 if (stu.HasField("arrival") and stu.arrival.HasField("delay")) else 0
        departure_delay_minutes = stu.departure.delay // 60 if (stu.HasField("departure") and stu.departure.HasField("delay")) else 0

        stu_sr_name = STOP_SR.get(stu.schedule_relationship, "SCHEDULED")

        stops_out.append({
            "stop_id": stop_id_clean,
            "stop_name": stop_name,
            "arrival_delay_minutes": arrival_delay_minutes,
            "departure_delay_minutes": departure_delay_minutes,
            "schedule_relationship": stu_sr_name
        })

    include_train = False
    if stops_out:
        include_train = touches_region
    else:
        include_train = (trip_sr_name == "CANCELED")

    if not include_train:
        continue

    # Déterminer le statut global
    status = compute_status(trip_sr_name, stops_out)

    # Préparer sous-structure des retards
    stops_delays = {}
    for s in stops_out:
        delay = max(s.get("arrival_delay_minutes", 0), s.get("departure_delay_minutes", 0))
        if delay > 0 and s["stop_id"] in gares_nancy_metz_lux:
            stops_delays[s["stop_name"]] = delay

    # Ajout à la sortie
    trains_sortie[train_number] = {
        "status": status,
        "touches_region": touches_region,
        "stops": stops_delays
    }

# Enregistrement
os.makedirs("Assistant-train", exist_ok=True)
output_path = "Assistant-train/retards_nancymetzlux.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(trains_sortie, f, ensure_ascii=False, indent=2)

# Récap console
counts = {"CANCELED":0, "PARTIAL_CANCELLATION":0, "DELAYED":0, "ON_TIME":0}
for v in trains_sortie.values():
    counts[v["status"]] = counts.get(v["status"], 0) + 1

print(f"{len(trains_sortie)} trains inclus (préfixes {prefixes_autorises})")
print(" - CANCELED:", counts.get("CANCELED", 0))
print(" - PARTIAL_CANCELLATION:", counts.get("PARTIAL_CANCELLATION", 0))
print(" - DELAYED:", counts.get("DELAYED", 0))
print(" - ON_TIME:", counts.get("ON_TIME", 0))
print(f"Fichier complet exporté dans {output_path}") 
