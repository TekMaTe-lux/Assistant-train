import requests
import json
import re
from google.transit import gtfs_realtime_pb2
import os
import csv

# Chargement des noms de gares depuis stops.txt
stop_id_to_name = {}
with open("stops.txt", newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        stop_id_to_name[row["stop_id"]] = row["stop_name"]

# Récupération du flux GTFS-RT (trip updates)
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Extraction des retards
retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip = entity.trip_update.trip
        trip_id_complet = trip.trip_id or ""

        # Filtrage : uniquement les TER Grand Est (OCESN)
        if not trip_id_complet.startswith("OCESN"):
            continue

        for stu in entity.trip_update.stop_time_update:
            stop_id = stu.stop_id
            stop_name = stop_id_to_name.get(stop_id, stop_id)

            data = {
                "train_id": trip_id_complet,
                "stop_id": stop_id,
                "stop_name": stop_name
            }

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                data["arrival_delay_minutes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retards.append(data)

print(f"Nombre total de retards trouvés (TER Grand Est uniquement) : {len(retards)}")

# Création du dossier si besoin
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde dans le fichier JSON filtré
with open("Assistant-train/retardssansfiltre.json", "w", encoding='utf-8') as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)
