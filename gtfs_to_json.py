import requests
import json
import re
from google.transit import gtfs_realtime_pb2
import os

# Liste des trains que tu veux suivre
train_ids = ["88741", "88743", "88747", "88530", "88749", "88751", "88753", "88532", "88755", "88813", "88759", "88761", "88815", "88534", "88763", "88765", "88767", "88769"]

# Récupération du flux GTFS-RT (trip updates)
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Extraction des infos utiles
retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip = entity.trip_update.trip
        train_id = trip.trip_id or trip.route_id  # fallback
        for update in entity.trip_update.stop_time_update:
            if update.HasField("arrival") and update.arrival.delay > 0:
                retards.append({
                    "train_id": train_id,
                    "delay_minutes": update.arrival.delay // 60
                })

print(f"Nombre total retards détectés : {len(retards)}")

# Filtrage sur les trip_id SNCF (ex: OCESN88745...)
retards_filtres = []
for r in retards:
    match = re.match(r'^OCESN(\d+)', r["train_id"])
    if match and match.group(1) in train_ids:
        retards_filtres.append(r)

print(f"Nombre retards après filtrage : {len(retards_filtres)}")

# Création du dossier si besoin
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde dans le bon dossier
with open("Assistant-train/retards.json", "w") as f:
    json.dump(retards_filtres, f, indent=2)
