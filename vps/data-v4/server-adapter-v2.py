#!/usr/bin/env python3
"""
Adapter de compatibilité SNCF pour le Data Engine V4 canonique.

Il ne décide d'aucune priorité territoriale. Son seul rôle est de rendre les
formats SNCF hétérogènes lisibles par server.py tout en conservant les
métadonnées par arrêt lorsqu'elles existent.
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

CORE = Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("lb_data_v4_core", CORE)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

TRAIN_FIELDS = ("train_number", "train", "number", "train_id", "trip_id", "vehicle_journey")
WRAPPER_KEYS = ("data", "trains", "journeys", "retards", "delays", "results", "items", "circulations", "services", "records")


def norm_train(value):
    matches = re.findall(r"\d{3,6}", str(value or ""))
    if not matches:
        return ""
    value = sorted(matches, key=lambda x: (-len(x), x))[0]
    return value.lstrip("0") or "0"


def station_name(entry):
    if not isinstance(entry, dict):
        return ""
    return str(
        entry.get("station") or entry.get("stop") or entry.get("stop_name")
        or entry.get("name") or entry.get("label") or entry.get("gare") or ""
    ).strip()


def delay_value(entry):
    if not isinstance(entry, dict):
        return entry
    for key in (
        "delayMinutes", "delay", "minutes", "rtDelay", "min", "value",
        "rt", "realtime", "rtMinutes", "delaySec", "delay_seconds",
    ):
        if key in entry:
            value = entry.get(key)
            if key in ("delaySec", "delay_seconds") and isinstance(value, (int, float)):
                return float(value) / 60.0
            return value
    if any(key in entry for key in ("status", "state", "rtStatus", "rtState")):
        return entry
    return None


def looks_like_train(key, raw):
    if not isinstance(raw, dict):
        return False
    if any(raw.get(field) not in (None, "") for field in TRAIN_FIELDS):
        return True
    if isinstance(raw.get("stops"), (dict, list)) and (norm_train(key) or raw.get("status") is not None):
        return True
    if isinstance(raw.get("delays"), (dict, list)) and (norm_train(key) or raw.get("status") is not None):
        return True
    return False


def records(container):
    out = []
    if isinstance(container, dict):
        for key, raw in container.items():
            if looks_like_train(key, raw):
                out.append((str(key), raw))
    elif isinstance(container, list):
        for i, raw in enumerate(container):
            if not isinstance(raw, dict):
                continue
            key = (
                raw.get("train_number") or raw.get("train") or raw.get("number")
                or raw.get("train_id") or str(i)
            )
            if looks_like_train(key, raw):
                out.append((str(key), raw))
    return out


def find_records(payload):
    direct = records(payload)
    if direct:
        return direct, "root"
    queue = [(payload, "root", 0)]
    seen = set()
    while queue:
        node, path, depth = queue.pop(0)
        if id(node) in seen or depth >= 4:
            continue
        seen.add(id(node))
        children = []
        if isinstance(node, dict):
            for key in WRAPPER_KEYS:
                value = node.get(key)
                if isinstance(value, (dict, list)):
                    children.append((value, f"{path}.{key}", depth + 1))
            for key, value in node.items():
                if key in WRAPPER_KEYS:
                    continue
                if isinstance(value, (dict, list)):
                    children.append((value, f"{path}.{key}", depth + 1))
        elif isinstance(node, list):
            for i, value in enumerate(node[:100]):
                if isinstance(value, (dict, list)):
                    children.append((value, f"{path}[{i}]", depth + 1))
        for child, cpath, cdepth in children:
            found = records(child)
            if found:
                return found, cpath
            queue.append((child, cpath, cdepth))
    return [], "unrecognized"


def normalize_stops(raw):
    source = raw.get("stops")
    if source is None:
        source = raw.get("delays")

    compact = {}
    rich = []

    if isinstance(source, dict):
        for name, value in source.items():
            compact[str(name)] = value
            if isinstance(value, dict):
                entry = dict(value)
                entry.setdefault("name", str(name))
            else:
                entry = {"name": str(name), "delayMinutes": value}
            rich.append(entry)
        return compact, rich

    if not isinstance(source, list):
        return {}, []

    for entry in source:
        if not isinstance(entry, dict):
            continue
        name = station_name(entry)
        if not name:
            continue
        compact[name] = delay_value(entry)
        rich.append(dict(entry, name=name))
    return compact, rich


def normalize_sncf_payload(payload):
    found, path = find_records(payload)
    normalized = {}
    for key, raw in found:
        number = norm_train(
            raw.get("train_number") or raw.get("train") or raw.get("number") or key
        )
        if not number:
            continue
        compact, rich = normalize_stops(raw)
        item = dict(raw)
        item["train_number"] = number
        item["stops"] = compact
        item["_canonicalStops"] = rich
        if not compact and not rich:
            continue
        current = normalized.get(number)
        current_len = len((current or {}).get("_canonicalStops") or (current or {}).get("stops") or {})
        if current is None or len(rich or compact) > current_len:
            normalized[number] = item
    return normalized, path, len(found)


_original_build = core.build_snapshot_from_payloads


def patched_build(payloads, source_meta=None):
    patched = dict(payloads or {})
    normalized, path, seen = normalize_sncf_payload(patched.get("sncfRt") or {})
    patched["sncfRt"] = normalized
    snapshot = _original_build(patched, source_meta)
    snapshot.setdefault("meta", {})["sncfFormat"] = path
    snapshot["meta"]["sncfRecordCount"] = seen
    snapshot["meta"]["sncfNormalizedCount"] = len(normalized)
    return snapshot


core.build_snapshot_from_payloads = patched_build


def adapter_fixture_test():
    direct = {
        "88742": {
            "train_number": "88742",
            "status": "ON_TIME",
            "stops": {"Metz": 0, "Thionville": 0, "Luxembourg": 0},
        }
    }
    wrapped = {
        "updatedAt": "now",
        "data": {
            "trains": [{
                "train_number": "88742",
                "status": "ON_TIME",
                "stops": [
                    {"station": "Metz", "delayMinutes": 0},
                    {"station": "Thionville", "delayMinutes": 0},
                    {"station": "Luxembourg", "delayMinutes": 0},
                ],
            }]
        },
    }
    cancelled = {
        "trains": [{
            "train_number": "88503",
            "status": "PARTIAL",
            "stops": [
                {"station": "Nancy", "status": "cancelled"},
                {"station": "Metz", "delayMinutes": 0},
            ],
        }]
    }

    for payload in (direct, wrapped, cancelled):
        n, path, seen = normalize_sncf_payload(payload)
        if not n:
            raise AssertionError(f"adapter SNCF invalide: {path} / {seen}")
        snap = patched_build(
            {
                "sncfRt": payload,
                "cflRt": {},
                "cflArrivals": {},
                "traffic": {},
                "compositions": {},
            },
            [{"name": "sncfRt", "ok": True, "stale": False, "observedAt": core.iso_utc()}],
        )
        if not snap.get("trains"):
            raise AssertionError("adapter: snapshot vide")

    n, _, _ = normalize_sncf_payload(cancelled)
    assert n["88503"]["_canonicalStops"][0]["status"] == "cancelled"
    print(json.dumps({"ok": True, "adapter": "sncf-v3-canonical"}))


if __name__ == "__main__":
    if "--adapter-fixture-test" in sys.argv:
        adapter_fixture_test()
        raise SystemExit(0)
    core.main()
