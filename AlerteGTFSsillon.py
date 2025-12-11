import requests
import json
import os
import re
from datetime import datetime, timezone
from google.transit import gtfs_realtime_pb2

# URL GTFS-RT alertes SNCF (service alerts)
url_alertes = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts"

# 🚆 Trains Sillon Lorrain ciblés :
# - 83xxxx  (6 chiffres)
# - 86xxx   (5 chiffres)
# - 88xxx   (5 chiffres)
TRAIN_PATTERN = re.compile(r'(83\d{4}|86\d{3}|88\d{3})')

# 🛑 Stops du Sillon Lorrain (stop_id GTFS)
STOPS_SILLON = {
    # === Luxembourg ↔ Metz / Nancy ===
    "82001000",  # Luxembourg
    "82002501",  # Howald
    "82006030",  # Bettembourg
    "87191163",  # Hettange-Grande
    "87191007",  # Thionville
    "87191130",  # Uckange
    "87191114",  # Hagondange
    "87191098",  # Walygator parc
    "87191106",  # Maizières-lès-Metz
    "87192088",  # Woippy
    "87192070",  # Metz Nord
    "87192039",  # Metz
    "87192401",  # Ars-sur-Moselle
    "87192419",  # Ancy-sur-Moselle
    "87192427",  # Novéant-sur-Moselle
    "87192468",  # Pagny-sur-Moselle
    "87192476",  # Vandières
    "87141820",  # Pont-à-Mousson
    "87141812",  # Dieulouard
    "87141804",  # Belleville
    "87141796",  # Marbache
    "87141788",  # Pompey
    "87141077",  # Frouard
    "87141085",  # Champigneulles
    "87141002",  # Nancy
}

# (optionnel) Pour avoir les noms de gares dans la sortie JSON
STOP_NAMES = {
    "82001000": "Luxembourg",
    "82002501": "Howald",
    "82006030": "Bettembourg",
    "87191163": "Hettange-Grande",
    "87191007": "Thionville",
    "87191130": "Uckange",
    "87191114": "Hagondange",
    "87191098": "Walygator parc",
    "87191106": "Maizières-lès-Metz",
    "87192088": "Woippy",
    "87192070": "Metz Nord",
    "87192039": "Metz",
    "87192401": "Ars-sur-Moselle",
    "87192419": "Ancy-sur-Moselle",
    "87192427": "Novéant-sur-Moselle",
    "87192468": "Pagny-sur-Moselle",
    "87192476": "Vandières",
    "87141820": "Pont-à-Mousson",
    "87141812": "Dieulouard",
    "87141804": "Belleville",
    "87141796": "Marbache",
    "87141788": "Pompey",
    "87141077": "Frouard",
    "87141085": "Champigneulles",
    "87141002": "Nancy",
}


def unix_to_iso(ts: int | None) -> str | None:
    """Convertit un timestamp Unix en ISO 8601 (UTC)."""
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def effect_label_fr(effect_value: int | None) -> str:
    """Traduit l'enum GTFS Effect en texte FR lisible."""
    if effect_value is None:
        return ""

    try:
        name = gtfs_realtime_pb2.Alert.Effect.Name(effect_value)
    except ValueError:
        return "Impact inconnu"

    mapping = {
        "NO_SERVICE": "Suppression de la circulation",
        "REDUCED_SERVICE": "Service réduit",
        "SIGNIFICANT_DELAYS": "Retards importants",
        "DETOUR": "Itinéraire modifié",
        "ADDITIONAL_SERVICE": "Service supplémentaire",
        "MODIFIED_SERVICE": "Service modifié",
        "STOP_MOVED": "Arrêt déplacé",
        "OTHER_EFFECT": "Autre impact",
        "UNKNOWN_EFFECT": "Impact inconnu",
        "NO_EFFECT": "Pas d’impact sur la circulation",
        "ACCESSIBILITY_ISSUE": "Problème d’accessibilité",
    }
    return mapping.get(name, name)


def cause_label_fr(cause_value: int | None) -> str:
    """Traduit l'enum GTFS Cause en texte FR lisible."""
    if cause_value is None:
        return ""

    try:
        name = gtfs_realtime_pb2.Alert.Cause.Name(cause_value)
    except ValueError:
        return "Cause inconnue"

    mapping = {
        "UNKNOWN_CAUSE": "Cause inconnue",
        "OTHER_CAUSE": "Autre cause",
        "TECHNICAL_PROBLEM": "Problème technique",
        "STRIKE": "Grève",
        "DEMONSTRATION": "Manifestation",
        "ACCIDENT": "Accident",
        "HOLIDAY": "Jour férié",
        "WEATHER": "Intempéries",
        "MAINTENANCE": "Travaux / maintenance",
        "CONSTRUCTION": "Travaux",
        "POLICE_ACTIVITY": "Intervention des forces de l’ordre",
        "MEDICAL_EMERGENCY": "Incident voyageur",
    }
    return mapping.get(name, name)


def extraire_trains_sillon(trip_id: str | None) -> list[str]:
    """Retourne les numéros de trains Sillon (83xxxx / 86xxx / 88xxx) trouvés dans un trip_id."""
    if not trip_id:
        return []
    return [m.group(0) for m in TRAIN_PATTERN.finditer(trip_id)]


def parse_alertes_gtfs_rt_sillon(url: str) -> list[dict]:
    """
    Parse le flux GTFS-RT SNCF et renvoie une liste d'alertes filtrées Sillon Lorrain :
    - seulement trains 83xxxx / 86xxx / 88xxx
    - et/ou stops du Sillon Lorrain.
    """
    response = requests.get(url)
    response.raise_for_status()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    alertes_sillon: list[dict] = []

    for entity in feed.entity:
        if not entity.HasField("alert"):
            continue

        alert = entity.alert

        # Textes principaux (on prend la 1ère traduction)
        header = alert.header_text.translation[0].text if alert.header_text.translation else ""
        desc = alert.description_text.translation[0].text if alert.description_text.translation else ""
        url_more = alert.url.translation[0].text if alert.url.translation else ""

        # Période (on prend la 1ère pour simplifier)
        start = alert.active_period[0].start if alert.active_period else None
        end = alert.active_period[0].end if alert.active_period else None

        stops_concernes: set[str] = set()
        trains_concernes: set[str] = set()
        informed_entities_raw: list[dict] = []

        for entity_info in alert.informed_entity:
            info: dict = {}

            if entity_info.HasField("stop_id"):
                stop_id = entity_info.stop_id
                info["stop_id"] = stop_id
                stops_concernes.add(stop_id)

            if entity_info.HasField("route_id"):
                info["route_id"] = entity_info.route_id

            if entity_info.HasField("direction_id"):
                info["direction_id"] = entity_info.direction_id

            if entity_info.HasField("trip"):
                trip_id = entity_info.trip.trip_id
                info["trip_id"] = trip_id
                for num in extraire_trains_sillon(trip_id):
                    trains_concernes.add(num)

            informed_entities_raw.append(info)

        # 🔎 Filtre Sillon Lorrain :
        # 1) au moins une gare du Sillon
        has_sillon_stop = any(s in STOPS_SILLON for s in stops_concernes)
        # 2) ou au moins un train 83xxxx / 86xxx / 88xxx détecté
        has_sillon_train = len(trains_concernes) > 0

        if not (has_sillon_stop or has_sillon_train):
            # On ignore les alertes hors Sillon Lorrain
            continue

        # Gravité & cause lisibles
        cause_txt = cause_label_fr(alert.cause if alert.HasField("cause") else None)
        gravite_txt = effect_label_fr(alert.effect if alert.HasField("effect") else None)

        # Version déjà "propre" pour intégration dans la Bêtaillère
        alert_dict = {
            "id": entity.id,
            "titre": header,
            "details": desc,
            "url": url_more,
            "cause": cause_txt,
            "gravite": gravite_txt,      # gravité globale
            "consequence": gravite_txt,  # tu peux différencier plus tard si besoin
            "periode": {
                "debut": unix_to_iso(start),
                "fin": unix_to_iso(end),
            },
            "trains_concernes": sorted(trains_concernes),
            "stops_concernes": [
                {
                    "stop_id": sid,
                    "nom": STOP_NAMES.get(sid, sid),
                }
                for sid in sorted(stops_concernes)
                if sid in STOPS_SILLON  # on expose surtout les gares du Sillon
            ],
            # Brut pour debug / logs
            "informed_entities_raw": informed_entities_raw,
        }

        alertes_sillon.append(alert_dict)

    return alertes_sillon


def sauvegarder_json(data: list[dict], fichier: str = "Assistant-train/alertes_sillon_lorrain.json") -> None:
    os.makedirs(os.path.dirname(fichier), exist_ok=True)
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{len(data)} alertes (Sillon Lorrain) enregistrées dans", fichier)


if __name__ == "__main__":
    alertes = parse_alertes_gtfs_rt_sillon(url_alertes)
    sauvegarder_json(alertes)
