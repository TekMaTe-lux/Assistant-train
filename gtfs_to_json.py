import requests
import json
import re
import csv
from google.transit import gtfs_realtime_pb2
import os

# Liste des trains que tu veux suivre
train_ids = ["88741", "88743", "88747", "88530", "88749", "88751", "88753", "88532", "88755",
             "88813", "88759", "88761", "88815", "88534", "88763", "88765", "88767", "88769"]

# Charger les noms des gares depuis stops.txt
stop_names = {}
with open("stops.txt", newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        stop_names[row["stop_id"]] = row["stop_name"]

# Récupération du flux GTFS-RT
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip = entity.trip_update.trip
        train_id_complet = trip.trip_id or trip.route_id
        match = re.match(r'^OCESN(\d+)', train_id_complet)
        if match:
            numero = match.group(1)
            if numero in train_ids:
                details = {
                    "train_id": numero,
                    "delays": []
                }
                for update in entity.trip_update.stop_time_update:
                    stop_id = update.stop_id
                    stop_name = stop_names.get(stop_id, stop_id)
                    arrival_delay = update.arrival.delay // 60 if update.HasField("arrival") else None
                    departure_delay = update.departure.delay // 60 if update.HasField("departure") else None

                    # Ajouter si au moins un des deux retards est présent
                    if arrival_delay or departure_delay:
                        details["delays"].append({
                            "stop_id": stop_id,
                            "stop_name": stop_name,
                            "arrival_delay": arrival_delay,
                            "departure_delay": departure_delay
                        })

                if details["delays"]:
                    retards.append(details)

print(f"{len(retards)} trains avec retards détectés")

# Création du dossier si besoin
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde du fichier JSON
with open("Assistant-train/retards.json", "w", encoding="utf-8") as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)
