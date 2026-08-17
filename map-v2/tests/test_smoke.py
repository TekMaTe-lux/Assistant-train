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


if __name__ == "__main__":
    unittest.main()
