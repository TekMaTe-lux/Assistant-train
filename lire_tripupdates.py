import requests
import json
import time
from google.transit import gtfs_realtime_pb2

url = "http://openov.lu/gtfs-rt/tripUpdates.pb"
response = requests.get(url)

feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(response.content)

data = {
    "last_updated": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(feed.header.timestamp)),
    "updates": []
}

for entity in feed.entity:
    trip_id = entity.trip_update.trip.trip_id
    route_id = entity.trip_update.trip.route_id
    stops = []

    for stu in entity.trip_update.stop_time_update:
        stop_id = stu.stop_id
        delay = stu.arrival.delay if stu.HasField("arrival") and stu.arrival.HasField("delay") else 0
        stops.append({
            "stop_id": stop_id,
            "delay_sec": delay
        })

    data["updates"].append({
        "trip_id": trip_id,
        "route_id": route_id,
        "stops": stops
    })

# Sauvegarde en JSON
with open("tripUpdates.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("✅ Fichier tripUpdates.json créé avec succès.")
