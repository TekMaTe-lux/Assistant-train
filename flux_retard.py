import requests
import json
import re
from google.transit import gtfs_realtime_pb2
import csv
import io
import os
from datetime import timedelta

# 🔗 URLs GitHub (raw)
url_stops = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stops.txt"
url_stop_times = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/stop_times.txt"

# 📥 Chargement de stops.txt
stop_id_to_name = {}
response = requests.get(url_stops)
response.encoding = 'utf-8'
csvfile = io.StringIO(response.text)
reader = csv.DictReader(csvfile)
for row in reader:
    stop_id_to_name[row["stop_id"]] = row["stop_name"]

# 📥 Chargement de stop_times.txt
trip_stop_times = {}
response = requests.get(url_stop_times)
response.encoding = 'utf-8'
csvfile = io.StringIO(response.text)
reader = csv.DictReader(csvfile)
for row in reader:
    trip_id = row["trip_id"]
    stop_id = row["stop_id"]
    arrival_time = row["arrival_time"]
    departure_time = row["departure_time"]

    if trip_id not in trip_stop_times:
        trip_stop_times[trip_id] = []

    trip_stop_times[trip_id].append({
        "stop_id": stop_id,
        "arrival_time": arrival_time,
        "departure_time": departure_time
    })

# 🔍 Fonction pour extraire l'ID numérique d’un stop_id (utile pour comparaison)
def extraire_id_numerique(stop_id):
    match = re.search(r'(\d{8})$', stop_id)
    return match.group(1) if match else stop_id

# 🔄 Chargement des données GTFS-RT
url_rt = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url_rt)
feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# 📊 Comparaison statique / temps réel
comparaison = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip_id_complet = entity.trip_update.trip.trip_id
        trip_static = trip_stop_times.get(trip_id_complet, [])

        for stu in entity.trip_update.stop_time_update:
            raw_stop_id = stu.stop_id
            cleaned_stop_id = extraire_id_numerique(raw_stop_id)
            stop_name = stop_id_to_name.get(cleaned_stop_id, raw_stop_id)

            comparaison_entry = {
                "train_id": trip_id_complet,
                "stop_id": raw_stop_id,
                "stop_name": stop_name,
                "static_arrival": None,
                "realtime_arrival": None,
                "arrival_delay_minutes": None,
                "static_departure": None,
                "realtime_departure": None,
                "departure_delay_minutes": None
            }

            for static_stop in trip_static:
                if extraire_id_numerique(static_stop["stop_id"]) == cleaned_stop_id:
                    comparaison_entry["static_arrival"] = static_stop["arrival_time"]
                    comparaison_entry["static_departure"] = static_stop["departure_time"]
                    break

            if stu.HasField("arrival") and stu.arrival.HasField("delay"):
                comparaison_entry["arrival_delay_minutes"] = stu.arrival.delay // 60
                if comparaison_entry["static_arrival"]:
                    h, m, s = map(int, comparaison_entry["static_arrival"].split(":"))
                    heure_prevue = timedelta(hours=h, minutes=m, seconds=s)
                    heure_reelle = heure_prevue + timedelta(seconds=stu.arrival.delay)
                    comparaison_entry["realtime_arrival"] = str(heure_reelle)

            if stu.HasField("departure") and stu.departure.HasField("delay"):
                comparaison_entry["departure_delay_minutes"] = stu.departure.delay // 60
                if comparaison_entry["static_departure"]:
                    h, m, s = map(int, comparaison_entry["static_departure"].split(":"))
                    heure_prevue = timedelta(hours=h, minutes=m, seconds=s)
                    heure_reelle = heure_prevue + timedelta(seconds=stu.departure.delay)
                    comparaison_entry["realtime_departure"] = str(heure_reelle)

            comparaison.append(comparaison_entry)

# 💾 Sauvegarde dans un fichier
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/comparaison_horaires.json", "w", encoding='utf-8') as f:
    json.dump(comparaison, f, indent=2, ensure_ascii=False)

print("✅ Fichier comparaison_horaires.json généré avec succès.")
