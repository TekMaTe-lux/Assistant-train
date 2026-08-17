#!/usr/bin/env python3
"""Construit un jeu cartographique dynamique à partir du RFN et du GTFS SNCF.

Le script reste volontairement sans dépendance Python externe afin de pouvoir être
testé facilement sur le VPS. Il produit un graphe simplifié : une évolution future
pourra utiliser PostGIS/pgRouting sans modifier le contrat de l'API V2.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import heapq
import json
import math
import pathlib
import re
import zipfile
from collections import defaultdict

EARTH_RADIUS_M = 6_371_000.0
LINE_CODE_KEYS = (
    "code_ligne", "code_ligne_rfn", "code_ligne_uic", "numero_ligne",
    "numero_de_ligne", "num_ligne", "ligne", "line_code", "code"
)
SPEED_KEYS = ("v_max", "vitesse", "vitesse_maximale", "vitesse_max", "vit_max", "speed")
STATUS_KEYS = ("mnemo", "statut", "libelle", "status")
TYPE_KEYS = ("type", "libelle", "categorie", "category", "ecartement")


def norm(value) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def pick(properties: dict, keys, default=None):
    lowered = {str(k).lower(): v for k, v in (properties or {}).items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value not in (None, ""):
            return value
    return default


def line_code(properties: dict) -> str:
    value = pick(properties, LINE_CODE_KEYS, "")
    digits = re.findall(r"\d+", str(value))
    return digits[0].lstrip("0") or "0" if digits else norm(value)


def parse_speed(properties: dict, default=120.0) -> float:
    raw = pick(properties, SPEED_KEYS, default)
    match = re.search(r"\d+(?:[.,]\d+)?", str(raw))
    if not match:
        return default
    return max(5.0, min(350.0, float(match.group(0).replace(",", "."))))


def iter_lines(geometry):
    if not geometry:
        return
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "LineString":
        yield coords
    elif kind == "MultiLineString":
        yield from coords


def haversine(a, b) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def geometry_bbox(lines):
    xs, ys = [], []
    for coords in lines:
        for coord in coords:
            if len(coord) >= 2:
                xs.append(float(coord[0])); ys.append(float(coord[1]))
    return [min(xs), min(ys), max(xs), max(ys)] if xs else None


def intersects(bbox, wanted):
    return not wanted or not bbox or not (
        bbox[2] < wanted[0] or bbox[0] > wanted[2] or bbox[3] < wanted[1] or bbox[1] > wanted[3]
    )


def load_geojson(filename):
    with open(filename, encoding="utf-8") as handle:
        return json.load(handle)


def metadata_by_line(geojson, value_builder):
    result = defaultdict(list)
    for feature in geojson.get("features", []):
        code = line_code(feature.get("properties") or {})
        if code:
            result[code].append(value_builder(feature.get("properties") or {}))
    return result


class RailGraph:
    def __init__(self):
        self.coords = []
        self.node_by_coord = {}
        self.edges = defaultdict(list)
        self.grid = defaultdict(list)
        self.node_parts = defaultdict(set)
        self.endpoints = set()
        self.part_counter = 0

    @staticmethod
    def coord_key(coord):
        return round(float(coord[0]), 6), round(float(coord[1]), 6)

    @staticmethod
    def grid_key(coord):
        return int(float(coord[0]) * 100), int(float(coord[1]) * 100)

    def node(self, coord):
        key = self.coord_key(coord)
        node = self.node_by_coord.get(key)
        if node is not None:
            return node
        node = len(self.coords)
        clean = (float(coord[0]), float(coord[1]))
        self.coords.append(clean)
        self.node_by_coord[key] = node
        self.grid[self.grid_key(clean)].append(node)
        return node

    def add_line(self, coords, *, speed, is_lgv, status, code):
        self.part_counter += 1
        part_id = self.part_counter
        previous = None
        line_nodes = []
        for coord in coords:
            if not isinstance(coord, list) or len(coord) < 2:
                continue
            current = self.node(coord)
            self.node_parts[current].add(part_id)
            line_nodes.append(current)
            if previous is not None and current != previous:
                length = haversine(self.coords[previous], self.coords[current])
                if 0.2 <= length <= 20_000:
                    attrs = {"length": length, "speed": speed, "lgv": is_lgv, "status": status, "line": code}
                    self.edges[previous].append((current, attrs))
                    self.edges[current].append((previous, attrs))
            previous = current
        if line_nodes:
            self.endpoints.add(line_nodes[0])
            self.endpoints.add(line_nodes[-1])

    def connect_nearby_endpoints(self, max_distance=120.0):
        """Raccorde les extrémités RFN presque jointives sans relier deux voies parallèles.

        Les jeux SNCF contiennent parfois deux géométries qui s'arrêtent à quelques
        mètres l'une de l'autre. Visuellement elles se touchent, mais le graphe les
        considère séparées. On relie uniquement une extrémité à un nœud appartenant
        à une autre géométrie, dans un rayon volontairement limité.
        """
        added = 0
        for endpoint in sorted(self.endpoints):
            coord = self.coords[endpoint]
            gx, gy = self.grid_key(coord)
            neighbours = {node for node, _attrs in self.edges.get(endpoint, ())}
            best = None
            best_distance = max_distance
            for x in range(gx - 1, gx + 2):
                for y in range(gy - 1, gy + 2):
                    for candidate in self.grid.get((x, y), ()):
                        if candidate == endpoint or candidate in neighbours:
                            continue
                        if self.node_parts[endpoint] & self.node_parts[candidate]:
                            continue
                        distance = haversine(coord, self.coords[candidate])
                        if distance < best_distance:
                            best, best_distance = candidate, distance
            if best is None:
                continue
            attrs = {
                "length": best_distance,
                "speed": 40.0,
                "lgv": False,
                "status": "AUTO_CONNECTOR",
                "line": "connector"
            }
            self.edges[endpoint].append((best, attrs))
            self.edges[best].append((endpoint, attrs))
            added += 1
        return added

    def nearest(self, coord, max_distance=8_000):
        gx, gy = self.grid_key(coord)
        best, best_distance = None, float("inf")
        # Recherche progressive ; une cellule vaut approximativement un degré / 100.
        for radius in range(0, 9):
            for x in range(gx - radius, gx + radius + 1):
                for y in range(gy - radius, gy + radius + 1):
                    for node in self.grid.get((x, y), ()):
                        distance = haversine(coord, self.coords[node])
                        if distance < best_distance:
                            best, best_distance = node, distance
            if best is not None and best_distance < max(80, radius * 700):
                break
        return best if best_distance <= max_distance else None

    @staticmethod
    def edge_cost(attrs, profile):
        speed = max(5.0, float(attrs["speed"]))
        cost = attrs["length"] / (speed / 3.6)
        status = norm(attrs.get("status"))
        if any(word in status for word in ("FERME", "NEUT", "RETRANCHE", "DECLASSE")):
            cost *= 50
        if profile == "ter" and attrs.get("lgv"):
            cost *= 14
        elif profile == "tgv" and attrs.get("lgv"):
            cost *= 0.55
        elif profile == "tgv" and speed < 160:
            cost *= 1.7
        return cost

    def route(self, start, end, profile):
        if start is None or end is None:
            return None
        if start == end:
            return [start]
        direct_distance = haversine(self.coords[start], self.coords[end])
        # Deux gares consécutives encadrent fortement le parcours. Cette ellipse
        # empêche un Metz -> Ars-sur-Moselle de remonter vers Thionville/Jarny
        # simplement parce que ces tronçons ont une vitesse nominale supérieure.
        corridor_limit = max(direct_distance * 2.5, direct_distance + 6_000.0)

        def inside_corridor(node):
            if direct_distance < 100.0:
                return True
            coord = self.coords[node]
            return (
                haversine(self.coords[start], coord)
                + haversine(coord, self.coords[end])
                <= corridor_limit
            )

        distances = {start: 0.0}
        previous = {}
        queue = [(0.0, start)]
        visited = set()
        while queue:
            distance, node = heapq.heappop(queue)
            if node in visited:
                continue
            visited.add(node)
            if node == end:
                break
            for neighbour, attrs in self.edges.get(node, ()):
                if neighbour in visited:
                    continue
                if neighbour != end and not inside_corridor(neighbour):
                    continue
                candidate = distance + self.edge_cost(attrs, profile)
                if candidate < distances.get(neighbour, float("inf")):
                    distances[neighbour] = candidate
                    previous[neighbour] = node
                    heapq.heappush(queue, (candidate, neighbour))
        if end not in distances:
            return None
        nodes = [end]
        while nodes[-1] != start:
            parent = previous.get(nodes[-1])
            if parent is None:
                return None
            nodes.append(parent)
        nodes.reverse()
        routed_length = sum(
            haversine(self.coords[nodes[index - 1]], self.coords[nodes[index]])
            for index in range(1, len(nodes))
        )
        if routed_length > corridor_limit:
            return None
        return nodes


def read_gtfs(zip_path, name):
    archive = zipfile.ZipFile(zip_path)
    candidates = {entry.lower(): entry for entry in archive.namelist()}
    actual = candidates.get(name.lower())
    if not actual:
        return []
    raw = archive.open(actual)
    text = (line.decode("utf-8-sig") for line in raw)
    return list(csv.DictReader(text))


def parse_time(value):
    try:
        hours, minutes, seconds = map(int, str(value).split(":"))
        return hours * 3600 + minutes * 60 + seconds
    except (TypeError, ValueError):
        return None


def display_time(seconds):
    if seconds is None:
        return ""
    return f"{(seconds // 3600) % 24:02d}:{(seconds % 3600) // 60:02d}"


def daterange(start, end):
    current = start
    while current <= end:
        yield current
        current += dt.timedelta(days=1)


def build_services(calendar_rows, exception_rows):
    result = defaultdict(set)
    weekday_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for row in calendar_rows:
        try:
            start = dt.datetime.strptime(row["start_date"], "%Y%m%d").date()
            end = dt.datetime.strptime(row["end_date"], "%Y%m%d").date()
        except (KeyError, ValueError):
            continue
        for day in daterange(start, end):
            if row.get(weekday_names[day.weekday()]) == "1":
                result[row["service_id"]].add(day.strftime("%Y%m%d"))
    for row in exception_rows:
        service_id, date, kind = row.get("service_id"), row.get("date"), row.get("exception_type")
        if not service_id or not date:
            continue
        if kind == "1": result[service_id].add(date)
        elif kind == "2": result[service_id].discard(date)
    return {key: sorted(values) for key, values in result.items()}


def route_profile(route):
    label = norm(f"{route.get('route_short_name', '')} {route.get('route_long_name', '')}")
    return "tgv" if any(token in label for token in ("TGV", "OUIGO", "EUROSTAR", "LYRIA", "FRECCIAROSSA")) else "ter"


def path_metrics(coords):
    cumulative, total = [0.0], 0.0
    for index in range(1, len(coords)):
        total += haversine(coords[index - 1], coords[index])
        cumulative.append(round(total, 2))
    return cumulative, round(total, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", required=True)
    parser.add_argument("--network", required=True)
    parser.add_argument("--lgv", required=True)
    parser.add_argument("--speed", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--bbox", help="ouest,sud,est,nord")
    args = parser.parse_args()
    wanted_bbox = [float(value) for value in args.bbox.split(",")] if args.bbox else None
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    print("[1/6] Lecture des sources RFN")
    network_data = load_geojson(args.network)
    lgv_data = load_geojson(args.lgv)
    speed_data = load_geojson(args.speed)
    lgv_by_line = metadata_by_line(lgv_data, lambda props: "LGV" in norm(pick(props, TYPE_KEYS, "")))
    speed_by_line = metadata_by_line(speed_data, lambda props: parse_speed(props))
    lgv_codes = {code for code, values in lgv_by_line.items() if any(values)}
    max_speeds = {code: max(values) for code, values in speed_by_line.items() if values}

    print("[2/6] Construction du graphe ferroviaire")
    graph = RailGraph()
    public_features = []
    for feature in network_data.get("features", []):
        properties = feature.get("properties") or {}
        lines = list(iter_lines(feature.get("geometry")))
        bbox = geometry_bbox(lines)
        if not intersects(bbox, wanted_bbox):
            continue
        code = line_code(properties)
        status = str(pick(properties, STATUS_KEYS, "EXPLOITE"))
        is_lgv = code in lgv_codes
        speed = max_speeds.get(code, 300.0 if is_lgv else 120.0)
        for coords in lines:
            graph.add_line(coords, speed=speed, is_lgv=is_lgv, status=status, code=code)
        closed = any(token in norm(status) for token in ("FERME", "NEUT", "RETRANCHE", "DECLASSE"))
        public_features.append({
            "type": "Feature",
            "properties": {"line": code, "kind": "closed" if closed else "lgv" if is_lgv else "classic", "speed": speed, "bbox": bbox},
            "geometry": feature.get("geometry")
        })
    connectors = graph.connect_nearby_endpoints()
    print(f"      {len(graph.coords):,} nœuds ; {len(public_features):,} tronçons ; {connectors:,} raccordements automatiques")

    print("[3/6] Lecture du GTFS")
    stops_rows = read_gtfs(args.gtfs, "stops.txt")
    trips_rows = read_gtfs(args.gtfs, "trips.txt")
    routes_rows = read_gtfs(args.gtfs, "routes.txt")
    stop_times_rows = read_gtfs(args.gtfs, "stop_times.txt")
    calendar_rows = read_gtfs(args.gtfs, "calendar.txt")
    exception_rows = read_gtfs(args.gtfs, "calendar_dates.txt")
    stops = {}
    for row in stops_rows:
        try:
            coord = (float(row["stop_lon"]), float(row["stop_lat"]))
        except (KeyError, ValueError):
            continue
        stops[row["stop_id"]] = {"name": row.get("stop_name") or row["stop_id"], "coord": coord}
    routes = {row.get("route_id"): row for row in routes_rows if row.get("route_id")}
    trip_meta = {row.get("trip_id"): row for row in trips_rows if row.get("trip_id")}
    by_trip = defaultdict(list)
    for row in stop_times_rows:
        stop = stops.get(row.get("stop_id"))
        if not stop or row.get("trip_id") not in trip_meta:
            continue
        time = parse_time(row.get("departure_time"))
        if time is None: time = parse_time(row.get("arrival_time"))
        if time is None: continue
        by_trip[row["trip_id"]].append((int(row.get("stop_sequence") or 0), row["stop_id"], time))

    print("[4/6] Calcul des parcours uniques")
    path_store, trip_store = {}, {}
    pair_cache = {}
    pattern_cache = {}
    failures = 0
    for trip_id, sequence in by_trip.items():
        sequence.sort()
        if wanted_bbox:
            sequence = [item for item in sequence if (
                wanted_bbox[0] <= stops[item[1]]["coord"][0] <= wanted_bbox[2]
                and wanted_bbox[1] <= stops[item[1]]["coord"][1] <= wanted_bbox[3]
            )]
        if len(sequence) < 2:
            continue
        meta = trip_meta[trip_id]
        route = routes.get(meta.get("route_id"), {})
        # route_type=2 correspond au rail. Les flux SNCF ne le renseignent pas toujours.
        if route.get("route_type") not in (None, "", "2", 2):
            continue
        profile = route_profile(route)
        signature = profile + ":" + "|".join(item[1] for item in sequence)
        path_id = pattern_cache.get(signature)
        offsets = None
        if path_id:
            offsets = path_store[path_id]["stopOffsets"]
        else:
            full_coords, offsets = [], [0.0]
            ok = True
            for index in range(len(sequence) - 1):
                stop_a, stop_b = stops[sequence[index][1]], stops[sequence[index + 1][1]]
                node_a, node_b = graph.nearest(stop_a["coord"]), graph.nearest(stop_b["coord"])
                cache_key = (node_a, node_b, profile)
                nodes = pair_cache.get(cache_key)
                if nodes is None:
                    nodes = graph.route(node_a, node_b, profile)
                    pair_cache[cache_key] = nodes
                if not nodes:
                    ok = False; failures += 1; break
                segment = [graph.coords[node] for node in nodes]
                if full_coords and segment and full_coords[-1] == segment[0]: segment = segment[1:]
                previous_length = path_metrics(full_coords)[1] if len(full_coords) > 1 else 0.0
                full_coords.extend(segment)
                offsets.append(path_metrics(full_coords)[1] if len(full_coords) > 1 else previous_length)
            if not ok or len(full_coords) < 2:
                continue
            digest = hashlib.sha1(signature.encode()).hexdigest()[:16]
            path_id = f"p-{digest}"
            cumulative, length = path_metrics(full_coords)
            path_store[path_id] = {"coordinates": full_coords, "cumulative": cumulative, "length": length, "stopOffsets": offsets, "profile": profile}
            pattern_cache[signature] = path_id
        raw_number = str(meta.get("trip_short_name") or "").strip()
        if norm(raw_number) in ("", "INCONNU", "UNKNOWN", "TRAIN"):
            raw_number = ""
        route_short_name = str(route.get("route_short_name") or "").strip()
        display_label = raw_number or route_short_name or profile.upper()
        stop_payload = [{
            "name": stops[item[1]]["name"],
            "displayTime": display_time(item[2]),
            "lon": stops[item[1]]["coord"][0],
            "lat": stops[item[1]]["coord"][1]
        } for item in sequence]
        trip_store[trip_id] = {
            "id": trip_id, "number": raw_number, "displayLabel": display_label,
            "serviceId": meta.get("service_id"), "routeName": route.get("route_long_name", ""),
            "routeShortName": route_short_name, "headsign": meta.get("trip_headsign", ""),
            "category": profile, "pathId": path_id, "times": [item[2] for item in sequence], "offsets": offsets,
            "stops": stop_payload
        }
    for item in path_store.values():
        item.pop("stopOffsets", None)
    print(f"      {len(path_store):,} parcours ; {len(trip_store):,} circulations ; {failures:,} segments sans chemin")

    print("[5/6] Construction des jours de circulation")
    services = build_services(calendar_rows, exception_rows)

    print("[6/6] Écriture")
    payloads = {
        "network.geojson": {"type": "FeatureCollection", "features": public_features},
        "paths.json": path_store,
        "trips.json": trip_store,
        "services.json": services,
        "manifest.json": {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "nodes": len(graph.coords), "paths": len(path_store), "trips": len(trip_store), "bbox": wanted_bbox}
    }
    for filename, payload in payloads.items():
        with open(output / filename, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        print(f"      {output / filename}")


if __name__ == "__main__":
    main()
