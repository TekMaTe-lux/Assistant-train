import requests
import json
import os
from google.transit import gtfs_realtime_pb2

# URL GTFS-RT alertes SNCF (service alerts)
url_alertes = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts"

def parse_alertes_gtfs_rt(url):
    response = requests.get(url)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    alertes_simplifiees = []

    for entity in feed.entity:
        if entity.HasField("alert"):
            alert = entity.alert
            alert_dict = {
                "header_text": alert.header_text.translation[0].text if alert.header_text.translation else "",
                "description_text": alert.description_text.translation[0].text if alert.description_text.translation else "",
                "cause": alert.cause if alert.HasField("cause") else "",
                "effect": alert.effect if alert.HasField("effect") else "",
                "active_period_start": alert.active_period[0].start if alert.active_period else None,
                "active_period_end": alert.active_period[0].end if alert.active_period else None,
                "informed_entities": []
            }

            for entity_info in alert.informed_entity:
                info = {}
                if entity_info.HasField("stop_id"):
                    info["stop_id"] = entity_info.stop_id
                if entity_info.HasField("route_id"):
                    info["route_id"] = entity_info.route_id
                if entity_info.HasField("direction_id"):
                    info["direction_id"] = entity_info.direction_id
                alert_dict["informed_entities"].append(info)

            alertes_simplifiees.append(alert_dict)

    return alertes_simplifiees

def sauvegarder_json(data, fichier="Assistant-train/alertes_sncftoutes.json"):
    os.makedirs("Assistant-train", exist_ok=True)  # 🔧 Crée le dossier si absent
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{len(data)} alertes enregistrées dans {fichier}")

if __name__ == "__main__":
    alertes = parse_alertes_gtfs_rt(url_alertes)
    sauvegarder_json(alertes)
