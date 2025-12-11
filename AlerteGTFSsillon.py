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
TRAIN_PATTERN = re.compile(r"(83\d{4}|86\d{3}|88\d{3})")

# 🛑 Stops du Sillon Lorrain (stop_id GTFS)
STOPS_SILLON = {
    "82001000", "82002501", "82006030",
    "87191163", "87191007", "87191130", "87191114",
    "87191098", "87191106", "87192088", "87192070",
    "87192039", "87192401", "87192419", "87192427",
    "87192468", "87192476", "87141820", "87141812",
    "87141804", "87141796", "87141788", "87141077",
    "87141085", "87141002"
}

# Version lisible pour le JSON
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

# ---------------------------------------------------------
# 🎯  FONCTIONS UTILES
# ---------------------------------------------------------

def unix_to_iso(ts):
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def pick_translation(ts, preferred=("fr", "fr-fr", "fr_fr")):
    """
    Sélectionne la traduction FR si disponible.
    Sinon : sans langue -> sinon première traduction.
    """
    if not ts or not ts.translation:
        return ""

    # normaliser
    langs = [p.lower() for p in preferred]

    # 1) priorité FR
    for tr in ts.translation:
        lang = (tr.language or "").lower()
        if lang in langs or any(lang.startswith(l) for l in langs):
            return tr.text

    # 2) traduction sans langue (souvent la FR par défaut)
    for tr in ts.translation:
        if not tr.language:
            return tr.text

    # 3) fallback = première traduction
    return ts.translation[0].text


def effect_label_fr(effect_value):
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
        "NO_EFFECT": "Pas d’impact",
        "ACCESSIBILITY_ISSUE": "Problème d’accessibilité",
    }
    return mapping.get(name, name)


def cause_label_fr(cause_value):
    if cause_value is None:
        return ""

    try:
        name = gtfs_realtime_pb2.Alert.Cause.Name(cause_value)
    except ValueError:
        return "Cause inconnue"

    mapping = {
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
        "OTHER_CAUSE": "Autre cause",
        "UNKNOWN_CAUSE": "Cause inconnue",
    }
    return mapping.get(name, name)


def extraire_trains_sillon(trip_id):
    if not trip_id:
        return []
    return [m.group(0) for m in TRAIN_PATTERN.finditer(trip_id)]


# ---------------------------------------------------------
# 🧠  PARSEUR PRINCIPAL
# ---------------------------------------------------------

def parse_alertes_gtfs_rt_sillon(url):
    response = requests.get(url)
    response.raise_for_status()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    alertes_sillon = []

    for entity in feed.entity:
        if not entity.HasField("alert"):
            continue

        alert = entity.alert

        # Sélection FR
        titre = pick_translation(alert.header_text)
        details = pick_translation(alert.description_text)
        url_more = pick_translation(alert.url)

        # période
        start = alert.active_period[0].start if alert.active_period else None
        end = alert.active_period[0].end if alert.active_period else None

        stops_concernes = set()
        trains_concernes = set()
        informed_entities = []

        for ent in alert.informed_entity:
            info = {}

            if ent.HasField("stop_id"):
                sid = ent.stop_id
                stops_concernes.add(sid)
                info["stop_id"] = sid

            if ent.HasField("trip"):
                trip_id = ent.trip.trip_id
                info["trip_id"] = trip_id
                for t in extraire_trains_sillon(trip_id):
                    trains_concernes.add(t)

            if ent.HasField("route_id"):
                info["route_id"] = ent.route_id

            if ent.HasField("direction_id"):
                info["direction_id"] = ent.direction_id

            informed_entities.append(info)

        # FILTRE SILLON LORRAIN
        has_stop = any(s in STOPS_SILLON for s in stops_concernes)
        has_train = len(trains_concernes) > 0

        if not (has_stop or has_train):
            continue

        alertes_sillon.append({
            "id": entity.id,
            "titre": titre,
            "details": details,
            "url": url_more,
            "cause": cause_label_fr(alert.cause if alert.HasField("cause") else None),
            "gravite": effect_label_fr(alert.effect if alert.HasField("effect") else None),
            "consequence": effect_label_fr(alert.effect if alert.HasField("effect") else None),
            "periode": {
                "debut": unix_to_iso(start),
                "fin": unix_to_iso(end),
            },
            "trains_concernes": sorted(trains_concernes),
            "stops_concernes": [
                {"stop_id": sid, "nom": STOP_NAMES.get(sid, sid)}
                for sid in sorted(stops_concernes)
                if sid in STOPS_SILLON
            ],
            "informed_entities_raw": informed_entities
        })

    return alertes_sillon


# ---------------------------------------------------------
# 💾  SAUVEGARDE JSON
# ---------------------------------------------------------

def sauvegarder_json(data, fichier="Assistant-train/alertes_sillon_lorrain.json"):
    os.makedirs(os.path.dirname(fichier), exist_ok=True)
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{len(data)} alertes écrites dans {fichier}")


# ---------------------------------------------------------
# 🚀  MAIN
# ---------------------------------------------------------

if __name__ == "__main__":
    alertes = parse_alertes_gtfs_rt_sillon(url_alertes)
    sauvegarder_json(alertes)
