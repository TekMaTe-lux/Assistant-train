import requests
import json
import re
import csv
from collections import defaultdict
from google.transit import gtfs_realtime_pb2
import os

# --- Télécharger stops.txt depuis GitHub ---
stops_url = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stops.txt"
stops_response = requests.get(stops_url)
stops_content = stops_response.content.decode("utf-8").splitlines()

# Charger les noms de gares dans un dictionnaire
stop_id_to_name = {}
reader = csv.DictReader(stops_content)
for row in reader:
    stop_id_to_name[row["stop_id"]] = row["stop_name"]

# Fonction pour extraire un stop_id numérique de 8 chiffres à partir du format GTFS-RT
def extraire_id_numerique(stop_id):
    match = re.search(r'(\d{8})$', stop_id)
    return match.group(1) if match else stop_id

# Gares surveillées (peut être élargi si besoin)
gares_nancy_metz_lux = {"87141002", "87192039", "87191007", "82001000"}

# Télécharger le flux GTFS-RT
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Liste des retards utiles
retards = []

# --- Parcourir les trip updates ---
for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        trip_short_name = entity.trip_update.trip.route_id or ""
        retard_trip = []
        contient_gare_region = False

        # Extraire le numéro de train (présent dans l'ID)
        match = re.search(r'(\d{5})', trip_id_complet)
        train_number = match.group(1) if match else "?????"

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            cleaned_stop_id = extraire_id_numerique(raw_stop_id)
            stop_name = stop_id_to_name.get(cleaned_stop_id, raw_stop_id)

            data = {
                "train_id": trip_id_complet,
                "train_number": train_number,
                "stop_id": cleaned_stop_id,
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

print(f"{len(retards)} enregistrements bruts trouvés pour Nancy-Metz-Lux.")

# --- Filtrer les trains par numéro ---
prefixes_autorisés = ("885", "887", "888")
retards_filtrés = [
    item for item in retards if item["train_number"].startswith(prefixes_autorisés)
]

# --- Regrouper les arrêts par train_number ---
trains_regroupés = defaultdict(lambda: {
    "train_id": "",
    "train_number": "",
    "stops": []
})

for item in retards_filtrés:
    tn = item["train_number"]
    trains_regroupés[tn]["train_id"] = item["train_id"]
    trains_regroupés[tn]["train_number"] = tn
    trains_regroupés[tn]["stops"].append({
        "stop_id": item["stop_id"],
        "stop_name": item["stop_name"],
        "arrival_delay_minutes": item.get("arrival_delay_minutes"),
        "departure_delay_minutes": item.get("departure_delay_minutes")
    })

résultat_final = list(trains_regroupés.values())

# --- Sauvegarde ---
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/trains_filtrés_groupés.json", "w", encoding="utf-8") as f:
    json.dump(résultat_final, f, indent=2, ensure_ascii=False)

print(f"{len(résultat_final)} trains filtrés regroupés sauvegardés dans trains_filtrés_groupés.json")
