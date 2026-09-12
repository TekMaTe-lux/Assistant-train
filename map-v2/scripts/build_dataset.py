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


def properties_blob(properties: dict) -> str:
    return norm(" ".join(str(value) for value in (properties or {}).values()))


def is_lgv_properties(properties: dict) -> bool:
    value = properties_blob(properties)
    return "LGV" in value or "GRANDEVITESSE" in value


def is_connector_properties(properties: dict) -> bool:
    connector_type = norm(str((properties or {}).get("type_ligne", "")))
    return connector_type == "RAC" or connector_type.startswith("RACCORDEMENT") or "RACCORDEMENT" in properties_blob(properties)


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
        dense_coords = []
        for index, coord in enumerate(coords):
            if index == 0:
                dense_coords.append(coord)
                continue
            start = coords[index - 1]
            distance = haversine(start, coord)
            steps = max(1, math.ceil(distance / 150.0))
            for step in range(1, steps + 1):
                ratio = step / steps
                dense_coords.append([
                    float(start[0]) + (float(coord[0]) - float(start[0])) * ratio,
                    float(start[1]) + (float(coord[1]) - float(start[1])) * ratio,
                ])
        for coord in dense_coords:
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

    def nearest_candidates(self, coord, max_distance=8_000, limit=16):
        """Retourne des accroches proches mais appartenant à des tronçons différents.

        Une gare située à une bifurcation peut être légèrement plus proche d'une
        voie parallèle qui n'est pas celle du train. Garder une seule accroche
        géométrique produit alors des parcours impossibles ou des détours.
        """
        gx, gy = self.grid_key(coord)
        best_by_part = {}
        for x in range(gx - 9, gx + 10):
            for y in range(gy - 9, gy + 10):
                for node in self.grid.get((x, y), ()):
                    distance = haversine(coord, self.coords[node])
                    if distance > max_distance:
                        continue
                    parts = self.node_parts.get(node) or {-(node + 1)}
                    for part in parts:
                        current = best_by_part.get(part)
                        if current is None or distance < current[0]:
                            best_by_part[part] = (distance, node)
        candidates = sorted(set(best_by_part.values()))
        return candidates[:limit]

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
            # La vitesse nominale favorise déjà la LGV. Un bonus trop fort fait
            # dépasser le bon raccordement pour rester artificiellement plus
            # longtemps sur la LGV (cas Strasbourg -> Metz à Lucy).
            cost *= 0.95
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

    def route_between_coords(self, start_coord, end_coord, profile):
        """Calcule un parcours en testant plusieurs voies possibles autour des gares."""
        starts = self.nearest_candidates(start_coord)
        ends = self.nearest_candidates(end_coord)
        if not starts or not ends:
            return None
        end_snaps = {node: distance for distance, node in ends}
        direct_distance = haversine(start_coord, end_coord)
        corridor_limit = max(direct_distance * 2.5, direct_distance + 6_000.0)

        def inside_corridor(node):
            if direct_distance < 100.0:
                return True
            coord = self.coords[node]
            return haversine(start_coord, coord) + haversine(coord, end_coord) <= corridor_limit

        # Le coût d'accroche évite de choisir une voie éloignée, tout en laissant
        # le réseau et le profil du train départager deux voies voisines.
        distances, previous, roots, queue = {}, {}, set(), []
        for snap_distance, node in starts:
            initial = snap_distance / 11.0
            if initial < distances.get(node, float("inf")):
                distances[node] = initial
                roots.add(node)
                heapq.heappush(queue, (initial, node))
        best_end, best_total = None, float("inf")
        visited = set()
        while queue:
            distance, node = heapq.heappop(queue)
            if node in visited:
                continue
            visited.add(node)
            if distance >= best_total:
                continue
            if node in end_snaps:
                total = distance + end_snaps[node] / 11.0
                if total < best_total:
                    best_end, best_total = node, total
            for neighbour, attrs in self.edges.get(node, ()):
                if neighbour in visited or (neighbour not in end_snaps and not inside_corridor(neighbour)):
                    continue
                candidate = distance + self.edge_cost(attrs, profile)
                if candidate < distances.get(neighbour, float("inf")):
                    distances[neighbour] = candidate
                    previous[neighbour] = node
                    heapq.heappush(queue, (candidate, neighbour))
        if best_end is None:
            return None
        nodes = [best_end]
        while nodes[-1] not in roots:
            parent = previous.get(nodes[-1])
            if parent is None:
                return None
            nodes.append(parent)
        nodes.reverse()
        routed_length = sum(
            haversine(self.coords[nodes[index - 1]], self.coords[nodes[index]])
            for index in range(1, len(nodes))
        )
        return nodes if routed_length <= corridor_limit else None


def read_gtfs(zip_path, name):
    archive = zipfile.ZipFile(zip_path)
    candidates = {entry.lower(): entry for entry in archive.namelist()}
    actual = candidates.get(name.lower())
    if not actual:
        return []
    raw = archive.open(actual)
    text = (line.decode("utf-8-sig") for line in raw)
    return list(csv.DictReader(text))


def read_gtfs_feeds(primary_path, cfl_path, name):
    """Fusionne les flux en préfixant les identifiants CFL pour éviter les collisions."""
    id_fields = {
        "stops.txt": ("stop_id", "parent_station"),
        "routes.txt": ("route_id",),
        "trips.txt": ("route_id", "service_id", "trip_id"),
        "stop_times.txt": ("trip_id", "stop_id"),
        "calendar.txt": ("service_id",),
        "calendar_dates.txt": ("service_id",),
    }
    result = []
    for filename, source, prefix in ((primary_path, "sncf", ""), (cfl_path, "cfl", "cfl:")):
        if not filename:
            continue
        for original in read_gtfs(filename, name):
            row = dict(original)
            for field in id_fields.get(name, ()):
                if prefix and row.get(field):
                    row[field] = prefix + row[field]
            row["_feed"] = source
            result.append(row)
    return result


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


def route_profile(route, trip=None, sequence=None, stops=None):
    trip = trip or {}
    stop_labels = ""
    if sequence and stops:
        stop_labels = " ".join(stops[item[1]]["name"] for item in sequence if item[1] in stops)
    label = norm(
        f"{route.get('route_short_name', '')} {route.get('route_long_name', '')} "
        f"{trip.get('trip_short_name', '')} {trip.get('trip_headsign', '')} {stop_labels}"
    )
    if any(token in label for token in ("TGV", "OUIGO", "EUROSTAR", "LYRIA", "FRECCIAROSSA")):
        return "tgv"
    return "cfl" if trip.get("_feed") == "cfl" else "ter"


def trip_number(meta):
    for key in ("trip_short_name", "trip_headsign", "block_id"):
        value = str(meta.get(key) or "").strip()
        if re.fullmatch(r"\d{3,6}", value):
            return value
    return ""


def simplify_collinear(coords, epsilon=1e-11):
    if len(coords) < 3:
        return coords
    result = [coords[0]]
    for index in range(1, len(coords) - 1):
        a, b, c = result[-1], coords[index], coords[index + 1]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) <= epsilon:
            continue
        result.append(b)
    result.append(coords[-1])
    return result


def path_metrics(coords):
    cumulative, total = [0.0], 0.0
    for index in range(1, len(coords)):
        total += haversine(coords[index - 1], coords[index])
        cumulative.append(round(total, 2))
    return cumulative, round(total, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", required=True)
    parser.add_argument("--gtfs-cfl", help="GTFS national luxembourgeois (optionnel)")
    parser.add_argument("--network", required=True)
    parser.add_argument("--network-extra", help="réseau ferroviaire luxembourgeois GeoJSON")
    parser.add_argument("--lgv", required=True)
    parser.add_argument("--speed", required=True)
    parser.add_argument("--connections", help="géométries des raccordements ferroviaires")
    parser.add_argument("--output", required=True)
    parser.add_argument("--bbox", help="ouest,sud,est,nord")
    parser.add_argument(
        "--trip-bbox",
        help="ne garder que les trains touchant cette zone, tout en conservant leur parcours complet"
    )
    args = parser.parse_args()
    wanted_bbox = [float(value) for value in args.bbox.split(",")] if args.bbox else None
    trip_bbox = [float(value) for value in args.trip_bbox.split(",")] if args.trip_bbox else None
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    print("[1/6] Lecture des sources RFN")
    network_data = load_geojson(args.network)
    lgv_data = load_geojson(args.lgv)
    speed_data = load_geojson(args.speed)
    lgv_by_line = metadata_by_line(lgv_data, is_lgv_properties)
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
    if args.network_extra:
        extra_network = load_geojson(args.network_extra)
        for feature in extra_network.get("features", []):
            properties = feature.get("properties") or {}
            lines = list(iter_lines(feature.get("geometry")))
            bbox = geometry_bbox(lines)
            if not intersects(bbox, wanted_bbox):
                continue
            code = line_code(properties) or "CFL"
            for coords in lines:
                graph.add_line(coords, speed=120.0, is_lgv=False, status="EXPLOITE", code=code)
            public_features.append({
                "type": "Feature",
                "properties": {"line": code, "kind": "classic", "speed": 120.0, "bbox": bbox, "source": "CFL"},
                "geometry": feature.get("geometry")
            })
    if args.connections:
        connection_data = load_geojson(args.connections)
        for feature in connection_data.get("features", []):
            properties = feature.get("properties") or {}
            if not is_connector_properties(properties):
                continue
            lines = list(iter_lines(feature.get("geometry")))
            bbox = geometry_bbox(lines)
            if not intersects(bbox, wanted_bbox):
                continue
            code = line_code(properties)
            is_lgv = code in lgv_codes or is_lgv_properties(properties)
            speed = max_speeds.get(code, 220.0 if is_lgv else 100.0)
            for coords in lines:
                graph.add_line(coords, speed=speed, is_lgv=is_lgv, status="EXPLOITE", code=code)
            public_features.append({
                "type": "Feature",
                "properties": {"line": code, "kind": "connector", "speed": speed, "bbox": bbox},
                "geometry": feature.get("geometry")
            })
    connectors = graph.connect_nearby_endpoints()
    print(f"      {len(graph.coords):,} nœuds ; {len(public_features):,} tronçons ; {connectors:,} raccordements automatiques")

    print("[3/6] Lecture du GTFS")
    stops_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "stops.txt")
    trips_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "trips.txt")
    routes_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "routes.txt")
    stop_times_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "stop_times.txt")
    calendar_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "calendar.txt")
    exception_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "calendar_dates.txt")
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
        if trip_bbox and not any(
            trip_bbox[0] <= stops[item[1]]["coord"][0] <= trip_bbox[2]
            and trip_bbox[1] <= stops[item[1]]["coord"][1] <= trip_bbox[3]
            for item in sequence
        ):
            continue
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
        profile = route_profile(route, meta, sequence, stops)
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
                cache_key = (sequence[index][1], sequence[index + 1][1], profile)
                nodes = pair_cache.get(cache_key)
                if nodes is None:
                    nodes = graph.route_between_coords(stop_a["coord"], stop_b["coord"], profile)
                    pair_cache[cache_key] = nodes
                if not nodes:
                    ok = False; failures += 1; break
                segment = simplify_collinear([graph.coords[node] for node in nodes])
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
        raw_number = trip_number(meta)
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
            "category": profile, "source": "CFL" if meta.get("_feed") == "cfl" else "SNCF",
            "pathId": path_id, "times": [item[2] for item in sequence], "offsets": offsets,
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
        "manifest.json": {
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "nodes": len(graph.coords),
            "paths": len(path_store),
            "trips": len(trip_store),
            "bbox": wanted_bbox,
            "tripBbox": trip_bbox
        }
    }
    for filename, payload in payloads.items():
        with open(output / filename, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        print(f"      {output / filename}")


if __name__ == "__main__":
    main()
