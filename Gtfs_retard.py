import requests
import json
import re
from google.transit import gtfs_realtime_pb2
import os
import csv

# ---------- Étape 1 : Construire le mapping ID numérique → nom de gare ----------
stop_id_to_name = {}
with open("stops.txt", newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        stop_id = row["stop_id"]
        stop_name = row["stop_name"]

        # On extrait le code numérique (8 chiffres) du stop_id
        match = re.search(r'(\d{8})$', stop_id)
        if match:
            cleaned_id = match.group(1)
            # On garde le premier nom trouvé pour cet ID
            if cleaned_id not in stop_id_to_name:
                stop_id_to_name[cleaned_id] = stop_name

# ---------- Étape 2 : Fonction utilitaire pour nettoyer les stop_id ----------
def extraire_id_numerique(stop_id):
    match = re.search(r'(\d{8})$', stop_id)
    return match.group(1) if match else stop_id

# ---------- Étape 3 : Télécharger le flux GTFS-RT Trip Updates ----------
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# ---------- Étape 4 : Extraire les retards ----------
retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        retard_trip = []

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            cleaned_stop_id = extraire_id_numerique(raw_stop_id)
            stop_name = stop_id_to_name.get(cleaned_stop_id, raw_stop_id)

            data = {
                "train_id": trip_id_complet,
                "stop_id": cleaned_stop_id,
                "stop_name": stop_name
            }

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                data["arrival_delay_minutes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retard_trip.append(data)

        if retard_trip:
            retards.extend(retard_trip)

# ---------- Étape 5 : Sauvegarde du JSON ----------
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/retards_gtfs.json", "w", encoding='utf-8') as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)

print(f"Nombre total d'entrées avec retards : {len(retards)}")
