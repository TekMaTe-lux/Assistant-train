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

# Fonction pour extraire l'ID numérique à la fin du stop_id GTFS-RT
def extraire_id_numerique(stop_id):
    match = re.search(r'(\d{8})$', stop_id)
    return match.group(1) if match else stop_id  # Retourne tel quel si pas trouvé

# Liste des codes stop_id des gares à surveiller
gares_nancy_metz_lux = {"87141002", "87192039", "87191007", "82001000"}

# Récupération du flux GTFS-RT (trip updates)
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Extraction des retards filtrés
retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        retard_trip = []
        contient_gare_region = False

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            cleaned_stop_id = extraire_id_numerique(raw_stop_id)
            stop_name = stop_id_to_name.get(cleaned_stop_id, raw_stop_id)

            data = {
                "train_id": trip_id_complet,
                "stop_id": raw_stop_id,
                "stop_name": stop_name
            }

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                data["arrival_delay_minutes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retard_trip.append(data)
                if cleaned_stop_id in gares_nancy_metz_lux:
                    contient_gare_region = True

        if contient_gare_region and retard_trip:
            retards.extend(retard_trip)

print(f"Nombre total de retards dans la région Nancy-Metz-Lux : {len(retards)}")

# Création du dossier si besoin
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde dans un fichier JSON
with open("Assistant-train/retards_nancymetzlux.json", "w", encoding='utf-8') as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)
