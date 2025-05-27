import requests
import io
import csv
from google.transit import gtfs_realtime_pb2
import datetime

# URLs raw GitHub de ta branche gtfs
TRIPS_URL = 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/gtfs/trips.txt'
STOPS_URL = 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/gtfs/stops.txt'
STOP_TIMES_URL = 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/gtfs/stop_times.txt'

train_ids = ["88741", "88743", "88747", "88530", "88749", "88751", "88753", "88532", "88755", "88813", "88759", "88761", "88815", "88534", "88763", "88765", "88767", "88769"]  # ta liste de trains à filtrer

def load_csv_from_url(url):
    response = requests.get(url)
    response.raise_for_status()
    content = response.content.decode('utf-8')
    f = io.StringIO(content)
    return list(csv.DictReader(f))

def format_time(unix_time):
    if not unix_time:
        return "N/A"
    return datetime.datetime.utcfromtimestamp(unix_time).strftime('%H:%M:%S')

def main():
    import re
    # 1. Charger les fichiers statiques depuis GitHub
    trips = load_csv_from_url(TRIPS_URL)
    stops = load_csv_from_url(STOPS_URL)
    stop_times = load_csv_from_url(STOP_TIMES_URL)

    # 2. Filtrer les trip_id correspondant aux trains avec regex
    filtered_trip_ids = []
    for trip in trips:
        trip_id = trip['trip_id']
        match = re.match(r'^OCESN(\d+)', trip_id)
        if not match:
            continue
        train_num = match.group(1)
        if train_num in train_ids:
            filtered_trip_ids.append(trip_id)

    if not filtered_trip_ids:
        print("Aucun trip_id trouvé pour ces numéros de trains.")
        return

    # 3. Récupérer le flux GTFS-RT temps réel
    url_rt = 'https://proxy.transport.data.gouv.fr/resource/sncf-all-gtfs-rt-trip-updates'
    response = requests.get(url_rt)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    # 4. Pour chaque trip_id filtré, afficher les horaires statiques + temps réel
    for trip_id in filtered_trip_ids:
        print(f"\nTrain trip_id : {trip_id}")

        train_stop_times = [st for st in stop_times if st['trip_id'] == trip_id]
        if not train_stop_times:
            print("Pas de données stop_times pour ce trip_id.")
            continue

        trip_update = None
        for entity in feed.entity:
            if entity.HasField('trip_update') and entity.trip_update.trip.trip_id == trip_id:
                trip_update = entity.trip_update
                break

        for st in train_stop_times:
            stop_info = next((s for s in stops if s['stop_id'] == st['stop_id']), None)
            stop_name = stop_info['stop_name'] if stop_info else 'Inconnu'

            arrival_scheduled = st.get('arrival_time', 'N/A')
            departure_scheduled = st.get('departure_time', 'N/A')
            arrival_real = arrival_scheduled
            departure_real = departure_scheduled

            if trip_update:
                stop_time_update = next((u for u in trip_update.stop_time_update if u.stop_id == st['stop_id']), None)
                if stop_time_update:
                    if stop_time_update.HasField('arrival') and stop_time_update.arrival.time:
                        arrival_real = format_time(stop_time_update.arrival.time)
                    if stop_time_update.HasField('departure') and stop_time_update.departure.time:
                        departure_real = format_time(stop_time_update.departure.time)

            print(f"- {stop_name} | Arrivée prévue: {arrival_scheduled} | Arrivée réelle: {arrival_real} | Départ prévu: {departure_scheduled} | Départ réel: {departure_real}")

if __name__ == "__main__":
    main()
