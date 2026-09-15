import csv
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]


class MapV2SmokeTest(unittest.TestCase):
    @staticmethod
    def builder_namespace():
        namespace = {}
        source = (ROOT / "scripts/build_dataset.py").read_text(encoding="utf-8")
        exec(compile(source.split("def main():", 1)[0], "build_dataset.py", "exec"), namespace)
        return namespace

    def test_lgv_and_raccordement_labels_are_recognized(self):
        namespace = self.builder_namespace()
        self.assertTrue(namespace["is_lgv_properties"]({"type": "Ligne à grande vitesse"}))
        self.assertTrue(namespace["is_connector_properties"]({"libelle": "Raccordement de Lucy"}))
        self.assertTrue(namespace["is_connector_properties"]({"type_ligne": "Rac", "code_ligne": "140370"}))

    def test_tgv_profile_can_be_inferred_from_a_tgv_station(self):
        namespace = self.builder_namespace()
        profile = namespace["route_profile"](
            {"route_short_name": "9898"},
            {"trip_short_name": "9898"},
            [(1, "A"), (2, "B")],
            {"A": {"name": "Montpellier Saint-Roch"}, "B": {"name": "Belfort - Montbéliard TGV"}},
        )
        self.assertEqual(profile, "tgv")

    def test_builder_creates_a_trip_and_path(self):
        with tempfile.TemporaryDirectory() as raw:
            tmp = pathlib.Path(raw)
            network = {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {"code_ligne": "001000", "libelle": "EXPLOITEE"},
                    "geometry": {"type": "LineString", "coordinates": [[6.0, 49.0], [6.1, 49.0], [6.2, 49.0]]}
                }]
            }
            lgv = {"type": "FeatureCollection", "features": []}
            speed = {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "properties": {"code_ligne": "001000", "v_max": 160}, "geometry": None}]
            }
            for name, payload in (("network.json", network), ("lgv.json", lgv), ("speed.json", speed)):
                (tmp / name).write_text(json.dumps(payload), encoding="utf-8")

            gtfs = tmp / "gtfs.zip"
            with zipfile.ZipFile(gtfs, "w") as archive:
                files = {
                    "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"], ["A", "Alpha", "49", "6"], ["B", "Bravo", "49", "6.2"]],
                    "routes.txt": [["route_id", "route_short_name", "route_long_name", "route_type"], ["R", "TER", "Alpha Bravo", "2"]],
                    "trips.txt": [["route_id", "service_id", "trip_id", "trip_short_name"], ["R", "S", "T1", "88704"]],
                    "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], ["T1", "10:00:00", "10:00:00", "A", "1"], ["T1", "11:00:00", "11:00:00", "B", "2"]],
                    "calendar.txt": [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["S", "1", "1", "1", "1", "1", "1", "1", "20260101", "20261231"]],
                    "calendar_dates.txt": [["service_id", "date", "exception_type"]]
                }
                for filename, rows in files.items():
                    content = "\n".join(",".join(row) for row in rows) + "\n"
                    archive.writestr(filename, content)

            output = tmp / "out"
            subprocess.run([
                sys.executable, str(ROOT / "scripts/build_dataset.py"),
                "--gtfs", str(gtfs), "--network", str(tmp / "network.json"),
                "--lgv", str(tmp / "lgv.json"), "--speed", str(tmp / "speed.json"),
                "--output", str(output)
            ], check=True, capture_output=True, text=True)
            trips = json.loads((output / "trips.json").read_text(encoding="utf-8"))
            paths = json.loads((output / "paths.json").read_text(encoding="utf-8"))
            self.assertIn("T1", trips)
            self.assertIn(trips["T1"]["pathId"], paths)
            self.assertGreater(paths[trips["T1"]["pathId"]]["length"], 10_000)

    def test_builder_connects_small_gaps_between_rfn_features(self):
        with tempfile.TemporaryDirectory() as raw:
            tmp = pathlib.Path(raw)
            network = {
                "type": "FeatureCollection",
                "features": [
                    {"type": "Feature", "properties": {"code_ligne": "1"},
                     "geometry": {"type": "LineString", "coordinates": [[6.0, 49.0], [6.0995, 49.0]]}},
                    {"type": "Feature", "properties": {"code_ligne": "2"},
                     "geometry": {"type": "LineString", "coordinates": [[6.1005, 49.0], [6.2, 49.0]]}}
                ]
            }
            for name, payload in (("network.json", network), ("lgv.json", {"type": "FeatureCollection", "features": []}),
                                  ("speed.json", {"type": "FeatureCollection", "features": []})):
                (tmp / name).write_text(json.dumps(payload), encoding="utf-8")
            with zipfile.ZipFile(tmp / "gtfs.zip", "w") as archive:
                files = {
                    "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"], ["A", "Alpha", "49", "6"], ["B", "Bravo", "49", "6.2"]],
                    "routes.txt": [["route_id", "route_short_name", "route_long_name", "route_type"], ["R", "TER", "Alpha Bravo", "2"]],
                    "trips.txt": [["route_id", "service_id", "trip_id", "trip_short_name"], ["R", "S", "T2", "INCONNU"]],
                    "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], ["T2", "10:00:00", "10:00:00", "A", "1"], ["T2", "11:00:00", "11:00:00", "B", "2"]],
                    "calendar.txt": [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["S", "1", "1", "1", "1", "1", "1", "1", "20260101", "20261231"]],
                    "calendar_dates.txt": [["service_id", "date", "exception_type"]]
                }
                for filename, rows in files.items():
                    archive.writestr(filename, "\n".join(",".join(row) for row in rows) + "\n")
            output = tmp / "out"
            subprocess.run([sys.executable, str(ROOT / "scripts/build_dataset.py"), "--gtfs", str(tmp / "gtfs.zip"),
                            "--network", str(tmp / "network.json"), "--lgv", str(tmp / "lgv.json"),
                            "--speed", str(tmp / "speed.json"), "--output", str(output)], check=True, capture_output=True, text=True)
            trips = json.loads((output / "trips.json").read_text(encoding="utf-8"))
            self.assertIn("T2", trips)
            self.assertEqual(trips["T2"]["displayLabel"], "TER")

    def test_router_rejects_a_fast_but_absurd_detour(self):
        namespace = self.builder_namespace()
        graph = namespace["RailGraph"]()
        graph.add_line([[6.0, 49.0], [6.2, 49.0]], speed=80, is_lgv=False, status="EXPLOITE", code="direct")
        graph.add_line([[6.0, 49.0], [6.0, 49.5], [6.2, 49.5], [6.2, 49.0]], speed=320, is_lgv=True, status="EXPLOITE", code="detour")
        start = graph.node_by_coord[(6.0, 49.0)]
        end = graph.node_by_coord[(6.2, 49.0)]
        nodes = graph.route(start, end, "tgv")
        coords = [graph.coords[node] for node in nodes]
        self.assertEqual(coords[0], (6.0, 49.0))
        self.assertEqual(coords[-1], (6.2, 49.0))
        self.assertTrue(all(abs(lat - 49.0) < 1e-9 for _lon, lat in coords))


if __name__ == "__main__":
    unittest.main()
