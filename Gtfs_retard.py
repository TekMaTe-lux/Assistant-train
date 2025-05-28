import requests
import json
import re
import os
import csv
from google.transit import gtfs_realtime_pb2
from datetime import datetime

# ---------- Étape 1 : Mapping ID numérique → nom de gare ----------
stop_id_to_name = {}
with open("stops.txt", newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        stop_id = row["stop_id"]
        stop_name = row["stop_name"]
        match = re.search(r'(\d{8})$', stop_id)
        if match:
            cleaned_id = match.group(1)
            if cleaned_id not in stop_id_to_name:
                stop_id_to_name[cleaned_id] = stop_name

# ---------- Étape 2 : Mapping (trip_id, stop_id) → horaires statiques ----------
horaire_prevu = {}
with open("stop_times.txt", newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        trip_id = row["trip_id"]
        stop_id = row["stop_id"]
        arrival_time = row["arrival_time"]
        departure_time = row["departure_time"]
        key = (trip_id, stop_id)
        horaire_prevu[key] = {
            "scheduled_arrival_time": arrival_time,
            "scheduled_departure_time": departure_time
        }

# ---------- Étape 3 : Nettoyage d'ID ----------
def extraire_id_numerique(stop_id):
    match = re.search(r'(\d{8})$', stop_id)
    return match.group(1) if match else stop_id

def extraire_numero_train(trip_id):
    match = re.search(r'SN(\d{5})', trip_id)
    return match.group(1) if match else trip_id

# ---------- Étape 4 : Récupération des données GTFS-RT ----------
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# ---------- Étape 5 : Traitement ----------
retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        train_number = extraire_numero_train(trip_id_complet)
        retard_trip = []

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            cleaned_stop_id = extraire_id_numerique(raw_stop_id)
            stop_name = stop_id_to_name.get(cleaned_stop_id, raw_stop_id)

            stop_key = (trip_id_complet, raw_stop_id)
            horaire = horaire_prevu.get(stop_key, {})

            data = {
                "train_id": trip_id_complet,
                "train_number": train_number,
                "stop_id": cleaned_stop_id,
                "stop_name": stop_name
            }

            if "scheduled_arrival_time" in horaire:
                data["scheduled_arrival_time"] = horaire["scheduled_arrival_time"]
            if "scheduled_departure_time" in horaire:
                data["scheduled_departure_time"] = horaire["scheduled_departure_time"]

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                data["arrival_delay_minutes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retard_trip.append(data)

        if retard_trip:
            retards.extend(retard_trip)

# ---------- Étape 6 : Écriture JSON ----------
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/retards_gtfs.json", "w", encoding='utf-8') as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)

print(f"Nombre total d'entrées avec retards : {len(retards)}")
