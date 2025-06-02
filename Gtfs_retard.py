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
stops_response = requests.get(stops_url)
stops_text = stops_response.content.decode("utf-8")

# Lire stops.txt dans un dictionnaire basé sur l’ID numérique (ex: 87192039)
stop_id_to_name = {}
reader = csv.DictReader(io.StringIO(stops_text))
for row in reader:
    stop_id_raw = row["stop_id"].strip()
    stop_name = row["stop_name"].strip()
    match = re.search(r"(\d{8})", stop_id_raw)
    if match:
        id_num = match.group(1)
        if id_num not in stop_id_to_name:
            stop_id_to_name[id_num] = stop_name  # Ne garde que le premier nom trouvé

# Fonction pour extraire le vrai stop_id à 8 chiffres
def nettoyer_stop_id(stop_id):
    match = re.search(r"(\d{8})", stop_id)
    return match.group(1) if match else stop_id.strip()

# Liste des gares d'intérêt
gares_nancy_metz_lux = {"87141002", "87192039", "87191007", "82001000"}

# Charger le GTFS-RT
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Structure des trains filtrés
trains_filtrés_groupés = defaultdict(lambda: {
    "train_id": "",
    "train_number": "",
    "stops": []
})

prefixes_autorisés = ("885", "887", "888")

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        match = re.search(r"(\d{5})", trip_id_complet)
        train_number = match.group(1) if match else "?????"

        if not train_number.startswith(prefixes_autorisés):
            continue

        retard_trip = []
        contient_gare_region = False

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            stop_id_clean = nettoyer_stop_id(raw_stop_id)
            stop_name = stop_id_to_name.get(stop_id_clean, f"StopPoint {stop_id_clean}")

            data = {
                "stop_id": stop_id_clean,
                "stop_name": stop_name
            }

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                data["arrival_delay_minutes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retard_trip.append(data)
                if stop_id_clean in gares_nancy_metz_lux:
                    contient_gare_region = True

        if contient_gare_region and retard_trip:
            trains_filtrés_groupés[train_number]["train_id"] = trip_id_complet
            trains_filtrés_groupés[train_number]["train_number"] = train_number
            trains_filtrés_groupés[train_number]["stops"].extend(retard_trip)

# Enregistrement dans un seul fichier
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/retards_nancymetzlux.json", "w", encoding="utf-8") as f:
    json.dump(list(trains_filtrés_groupés.values()), f, indent=2, ensure_ascii=False)

print(f"{len(trains_filtrés_groupés)} trains enregistrés dans retards_nancymetzlux.json avec noms de gares lisibles")
