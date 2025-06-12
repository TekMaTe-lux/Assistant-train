import requests
import json
import os
import xml.etree.ElementTree as ET

# URL SIRI SX LITE SNCF
url_siri_sx = "https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-situation-exchange"

def parse_siri_sx(url):
    response = requests.get(url)
    xml_root = ET.fromstring(response.content)

    # SIRI namespace utilisé dans ce flux
    ns = {'siri': 'http://www.siri.org.uk/siri'}

    situations = []

    for situation in xml_root.findall('.//siri:PtSituationElement', ns):
        situation_dict = {
            "situation_number": situation.findtext('siri:SituationNumber', default="", namespaces=ns),
            "summary": situation.findtext('siri:Summary', default="", namespaces=ns),
            "description": situation.findtext('siri:Description', default="", namespaces=ns),
            "severity": situation.findtext('siri:Severity', default="", namespaces=ns),
            "affects": []
        }

        for affects in situation.findall('.//siri:Affects', ns):
            affects_dict = {}

            vehicle_journeys = affects.findall('.//siri:VehicleJourneyRef', ns)
            stop_points = affects.findall('.//siri:StopPointRef', ns)

            if vehicle_journeys:
                affects_dict["vehicle_journeys"] = [vj.text for vj in vehicle_journeys]
            if stop_points:
                affects_dict["stop_points"] = [sp.text for sp in stop_points]

            situation_dict["affects"].append(affects_dict)

        situations.append(situation_dict)

    return situations

def sauvegarder_json(data, fichier="Assistant-train/siri_sx_alertes.json"):
    os.makedirs("Assistant-train", exist_ok=True)
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{len(data)} situations enregistrées dans {fichier}")

if __name__ == "__main__":
    situations = parse_siri_sx(url_siri_sx)
    sauvegarder_json(situations)
