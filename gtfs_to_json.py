import requests
import json
from google.transit import gtfs_realtime_pb2

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
        train_id = trip.train_id or trip.route_id  # fallback
        for update in entity.trip_update.stop_time_update:
            if update.HasField("arrival") and update.arrival.delay > 0:
                retards.append({
                    "train_id": train_id,
                    "delay_minutes": update.arrival.delay // 60
                })

# Ne garder que les trains d’intérêt
retards_filtres = [r for r in retards if any(r["train_id"].endswith(num) for num in trains_suivis)]

import os

# Création du dossier si besoin
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde dans le bon dossier
with open("Assistant-train/retards.json", "w") as f:
    json.dump(retards_filtres, f)

