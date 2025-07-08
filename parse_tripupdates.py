import requests
import json
import time
from google.transit import gtfs_realtime_pb2

def fetch_and_parse_gtfs_rt(url):
    response = requests.get(url)
    response.raise_for_status()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)
    return feed

def convert_feed_to_json(feed):
    data = {
        "header": {
            "gtfs_realtime_version": feed.header.gtfs_realtime_version,
            "incrementality": feed.header.incrementality,
            "timestamp": feed.header.timestamp,
            "last_updated": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(feed.header.timestamp))
        },
        "entities": []
    }

    for entity in feed.entity:
        e = {"id": entity.id}
        if entity.HasField('trip_update'):
            tu = entity.trip_update
            trip = {
                "trip_id": tu.trip.trip_id if tu.trip.HasField('trip_id') else None,
                "route_id": tu.trip.route_id if tu.trip.HasField('route_id') else None,
                "start_time": tu.trip.start_time if tu.trip.HasField('start_time') else None,
                "start_date": tu.trip.start_date if tu.trip.HasField('start_date') else None,
                "schedule_relationship": gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship.Name(tu.trip.schedule_relationship) if tu.trip.HasField('schedule_relationship') else None,
                "delay": tu.delay if tu.HasField('delay') else None,
                "timestamp": tu.timestamp if tu.HasField('timestamp') else None,
                "stop_time_updates": []
            }

            for stu in tu.stop_time_update:
                stop_update = {
                    "stop_sequence": stu.stop_sequence if stu.HasField('stop_sequence') else None,
                    "stop_id": stu.stop_id if stu.HasField('stop_id') else None,
                    "schedule_relationship": gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship.Name(stu.schedule_relationship) if stu.HasField('schedule_relationship') else None,
                    "arrival": None,
                    "departure": None,
                }
                if stu.HasField('arrival'):
                    arrival = stu.arrival
                    stop_update["arrival"] = {
                        "delay": arrival.delay if arrival.HasField('delay') else None,
                        "time": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(arrival.time)) if arrival.HasField('time') else None,
                        "uncertainty": arrival.uncertainty if arrival.HasField('uncertainty') else None
                    }
                if stu.HasField('departure'):
                    departure = stu.departure
                    stop_update["departure"] = {
                        "delay": departure.delay if departure.HasField('delay') else None,
                        "time": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(departure.time)) if departure.HasField('time') else None,
                        "uncertainty": departure.uncertainty if departure.HasField('uncertainty') else None
                    }
                trip["stop_time_updates"].append(stop_update)
            e["trip_update"] = trip

        if entity.HasField('vehicle'):
            v = entity.vehicle
            vehicle = {
                "trip": {
                    "trip_id": v.trip.trip_id if v.trip.HasField('trip_id') else None,
                    "route_id": v.trip.route_id if v.trip.HasField('route_id') else None,
                    "start_time": v.trip.start_time if v.trip.HasField('start_time') else None,
                    "start_date": v.trip.start_date if v.trip.HasField('start_date') else None,
                    "schedule_relationship": gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship.Name(v.trip.schedule_relationship) if v.trip.HasField('schedule_relationship') else None,
                },
                "vehicle": {
                    "id": v.vehicle.id if v.vehicle.HasField('id') else None,
                    "label": v.vehicle.label if v.vehicle.HasField('label') else None,
                    "license_plate": v.vehicle.license_plate if v.vehicle.HasField('license_plate') else None,
                },
                "position": {
                    "latitude": v.position.latitude if v.HasField('position') else None,
                    "longitude": v.position.longitude if v.HasField('position') else None,
                    "bearing": v.position.bearing if v.position.HasField('bearing') else None,
                    "odometer": v.position.odometer if v.position.HasField('odometer') else None,
                    "speed": v.position.speed if v.position.HasField('speed') else None,
                },
                "current_stop_sequence": v.current_stop_sequence if v.HasField('current_stop_sequence') else None,
                "stop_id": v.stop_id if v.HasField('stop_id') else None,
                "timestamp": v.timestamp if v.HasField('timestamp') else None,
                "congestion_level": v.congestion_level if v.HasField('congestion_level') else None,
                "occupancy_status": v.occupancy_status if v.HasField('occupancy_status') else None
            }
            e["vehicle"] = vehicle

        if entity.HasField('alert'):
            alert = entity.alert
            alert_info = {
                "active_period": [],
                "informed_entities": [],
                "cause": alert.cause,
                "effect": alert.effect,
                "header_text": alert.header_text.translations[0].text if alert.header_text.translations else None,
                "description_text": alert.description_text.translations[0].text if alert.description_text.translations else None
            }
            for period in alert.active_period:
                alert_info["active_period"].append({
                    "start": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(period.start)) if period.start else None,
                    "end": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(period.end)) if period.end else None
                })
            for entity in alert.informed_entity:
                informed = {}
                if entity.HasField('agency_id'):
                    informed["agency_id"] = entity.agency_id
                if entity.HasField('route_id'):
                    informed["route_id"] = entity.route_id
                if entity.HasField('route_type'):
                    informed["route_type"] = entity.route_type
                if entity.HasField('trip'):
                    informed["trip"] = {
                        "trip_id": entity.trip.trip_id if entity.trip.HasField('trip_id') else None,
                        "route_id": entity.trip.route_id if entity.trip.HasField('route_id') else None,
                    }
                if entity.HasField('stop_id'):
                    informed["stop_id"] = entity.stop_id
                alert_info["informed_entities"].append(informed)
            e["alert"] = alert_info

        data["entities"].append(e)

    return data

if __name__ == "__main__":
    url = "http://openov.lu/gtfs-rt/tripUpdates.pb"
    feed = fetch_and_parse_gtfs_rt(url)
    data_json = convert_feed_to_json(feed)

    with open("tripUpdates_full.json", "w", encoding="utf-8") as f:
        json.dump(data_json, f, ensure_ascii=False, indent=2)

    print("Fichier tripUpdates_full.json généré avec toutes les données.")
