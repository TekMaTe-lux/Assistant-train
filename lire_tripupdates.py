import requests
import time
from google.transit import gtfs_realtime_pb2

URL = "http://openov.lu/gtfs-rt/tripUpdates.pb"

# Charger le fichier .pb
response = requests.get(URL)
feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

# Lire le timestamp global
timestamp = feed.header.timestamp
print("📅 Données générées le :", time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(timestamp)))

# Afficher quelques infos utiles
for entity in feed.entity[:5]:  # afficher les 5 premiers
    trip_update = entity.trip_update
    trip_id = trip_update.trip.trip_id
    print(f"\n🟢 Trip ID : {trip_id}")
    for stop_time_update in trip_update.stop_time_update:
        stop_id = stop_time_update.stop_id
        if stop_time_update.arrival.delay:
            delay = stop_time_update.arrival.delay
            print(f"  ⏰ Retard à {stop_id} : {delay} sec")
