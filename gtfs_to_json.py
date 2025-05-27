import requests
import json
import re
import os
from google.transit import gtfs_realtime_pb2

# Liste des trains à suivre (numéros sans préfixe OCESN)
train_ids = [
    "88741", "88743", "88747", "88530", "88749", "88751", "88753", "88532", "88755",
    "88813", "88759", "88761", "88815", "88534", "88763", "88765", "88767", "88769"
]

# Dictionnaire des gares avec leurs codes officiels GTFS-RT et noms
station_codes = {
    "StopPoint:OCETrain TER-82001000": "Luxembourg",
    "StopPoint:OCETrain TER-82002501": "Bettembourg",
    "StopPoint:OCETrain TER-87191130": "Hettange-Grande",
    "StopPoint:OCETrain TER-87191007": "Thionville",
    "StopPoint:OCETrain TER-87191016": "Uckange",
    "StopPoint:OCETrain TER-87191023": "Hagondange",
    "StopPoint:OCETrain TER-87192022": "Maizières-lès-Metz",
    "StopPoint:OCETrain TER-87192013": "Metz Nord",
    "StopPoint:OCETrain TER-87192021": "Woippy",
    "StopPoint:OCETrain TER-87192039": "Metz",
    "StopPoint:OCETrain TER-87192468": "Pagny-sur-Moselle",
    "StopPoint:OCETrain TER-87192188": "Pont-à-Mousson",
    "StopPoint:OCETrain TER-87141002": "Nancy"
}

# URL du flux GTFS-RT trip updates
url = "https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

retards = []

for entity in feed.entity:
    if entity.HasField("trip_update"):
        trip = entity.trip_update.trip
        train_id_complet = trip.trip_id or trip.route_id
        # Extraire le numéro de train OCESNxxxxxx
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
                    stop_name = station_codes.get(stop_id, stop_id)  # Nom lisible ou stop_id si non trouvé
                    arrival_delay = update.arrival.delay // 60 if update.HasField("arrival") else None
                    departure_delay = update.departure.delay // 60 if update.HasField("departure") else None

                    # Ajouter uniquement si au moins un retard existe
                    if arrival_delay or departure_delay:
                        details["delays"].append({
                            "stop_id": stop_id,
                            "stop_name": stop_name,
                            "arrival_delay_minutes": arrival_delay,
                            "departure_delay_minutes": departure_delay
                        })

                if details["delays"]:
                    retards.append(details)

print(f"{len(retards)} trains avec retards détectés")

# Création du dossier s'il n'existe pas
os.makedirs("Assistant-train", exist_ok=True)

# Sauvegarde dans un fichier JSON
with open("Assistant-train/retards.json", "w", encoding="utf-8") as f:
    json.dump(retards, f, indent=2, ensure_ascii=False)
