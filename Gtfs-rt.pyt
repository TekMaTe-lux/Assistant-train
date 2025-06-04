import requests
import json
import re
import csv
from collections import defaultdict
from google.transit import gtfs_realtime_pb2
import io

# --- Télécharger stops.txt depuis GitHub ---
stops_url = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stops.txt"
stops_response = requests.get(stops_url)
stops_text = stops_response.content.decode("utf-8")

# Lire stops.txt dans un dictionnaire basé sur l’ID numérique
stop_id_to_name = {}
reader = csv.DictReader(io.StringIO(stops_text))
for row in reader:
    stop_id_raw = row["stop_id"].strip()
    stop_name = row["stop_name"].strip()
    match = re.search(r"(\d{8})", stop_id_raw)
    if match:
        id_num = match.group(1)
        if id_num not in stop_id_to_name:
            stop_id_to_name[id_num] = stop_name

# Fonction pour extraire le vrai stop_id à 8 chiffres
def nettoyer_stop_id(stop_id):
    match = re.search(r"(\d{8})", stop_id)
    return match.group(1) if match else stop_id.strip()

# Charger le GTFS-RT
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Stockage des trains
trains_groupés = defaultdict(lambda: {
    "train_id": "",
    "train_number": "",
    "stops": []
})

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_update = entity.trip_update
        trip_id_complet = trip_update.trip.trip_id
        match = re.search(r"(\d{5})", trip_id_complet)
        train_number = match.group(1) if match else "?????"
        
        train_id = trip_update.trip.trip_id
        trains_groupés[train_id]["train_id"] = train_id
        trains_groupés[train_id]["train_number"] = train_number

        for stu in trip_update.stop_time_update:
            stop_id_clean = nettoyer_stop_id(stu.stop_id)
            stop_name = stop_id_to_name.get(stop_id_clean, "Inconnu")
            arrival = stu.arrival.time if stu.HasField("arrival") else None
            departure = stu.departure.time if stu.HasField("departure") else None
            
            trains_groupés[train_id]["stops"].append({
                "stop_id": stop_id_clean,
                "stop_name": stop_name,
                "arrival": arrival,
                "departure": departure
            })

# Exemple d'affichage
for train_id, train_data in list(trains_groupés.items())[:5]:  # affiche les 5 premiers trains
    print(f"Train {train_data['train_number']} ({train_id})")
    for stop in train_data["stops"]:
        print(f"  - {stop['stop_name']} ({stop['stop_id']}), arrivée: {stop['arrival']}, départ: {stop['departure']}")
    print()
