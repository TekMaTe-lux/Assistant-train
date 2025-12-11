import requests
import json
import os
import re
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
    "87141085", "87141002",
}

# ---------------------------------------------------------
#  FONCTIONS UTILES
# ---------------------------------------------------------

def pick_translation(ts, preferred=("fr", "fr-fr", "fr_fr")):
    """
    Choisit en priorité la traduction FR si disponible.
    Sinon : traduction sans langue, sinon la première.
    """
    if not ts or not ts.translation:
        return ""

    langs = [p.lower() for p in preferred]

    # 1) FR en priorité
    for tr in ts.translation:
        lang = (tr.language or "").lower()
        if lang in langs or any(lang.startswith(l) for l in langs):
            return tr.text

    # 2) Sans langue
    for tr in ts.translation:
        if not tr.language:
            return tr.text

    # 3) Fallback
    return ts.translation[0].text


def extraire_trains_sillon(trip_id: str | None) -> list[str]:
    """Retourne les numéros de trains Sillon détectés dans un trip_id."""
    if not trip_id:
        return []
    return [m.group(0) for m in TRAIN_PATTERN.finditer(trip_id)]


# ---------------------------------------------------------
#  PARSEUR PRINCIPAL (FORMAT ANCIEN JSON)
# ---------------------------------------------------------

def parse_alertes_gtfs_rt_sillon(url):
    response = requests.get(url)
    response.raise_for_status()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    alertes_simplifiees = []

    for entity in feed.entity:
        if not entity.HasField("alert"):
            continue

        alert = entity.alert

        # Textes (FR si possible, format identique: header_text / description_text)
        header_text = pick_translation(alert.header_text)
        description_text = pick_translation(alert.description_text)

        # cause / effect = enums bruts (entiers), comme avant
        cause_val = alert.cause if alert.HasField("cause") else ""
        effect_val = alert.effect if alert.HasField("effect") else ""

        # Période : timestamps Unix bruts
        active_start = alert.active_period[0].start if alert.active_period else None
        active_end = alert.active_period[0].end if alert.active_period else None

        # On parcourt les entités informées pour filtrer + remplir informed_entities
        informed_entities = []
        stops_concernes = set()
        trains_concernes = set()

        for ent in alert.informed_entity:
            info = {}

            if ent.HasField("stop_id"):
                stop_id = ent.stop_id
                info["stop_id"] = stop_id
                stops_concernes.add(stop_id)

            if ent.HasField("route_id"):
                info["route_id"] = ent.route_id

            if ent.HasField("direction_id"):
                info["direction_id"] = ent.direction_id

            if ent.HasField("trip"):
                trip_id = ent.trip.trip_id
                info["trip_id"] = trip_id
                for num in extraire_trains_sillon(trip_id):
                    trains_concernes.add(num)

            informed_entities.append(info)

        # 🔎 FILTRE SILLON LORRAIN
        has_sillon_stop = any(s in STOPS_SILLON for s in stops_concernes)
        has_sillon_train = len(trains_concernes) > 0

        if not (has_sillon_stop or has_sillon_train):
            continue  # on jette l’alerte, hors Sillon

        # 🧱 Même structure que ton ancien JSON
        alert_dict = {
            "header_text": header_text,
            "description_text": description_text,
            "cause": cause_val,
            "effect": effect_val,
            "active_period_start": active_start,
            "active_period_end": active_end,
            "informed_entities": informed_entities,
        }

        alertes_simplifiees.append(alert_dict)

    return alertes_simplifiees


# ---------------------------------------------------------
#  SAUVEGARDE
# ---------------------------------------------------------

def sauvegarder_json(data, fichier="Assistant-train/alertes_sillon_lorrain.json"):
    os.makedirs(os.path.dirname(fichier), exist_ok=True)
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{len(data)} alertes enregistrées dans {fichier}")


# ---------------------------------------------------------
#  MAIN
# ---------------------------------------------------------

if __name__ == "__main__":
    alertes = parse_alertes_gtfs_rt_sillon(url_alertes)
    sauvegarder_json(alertes)
