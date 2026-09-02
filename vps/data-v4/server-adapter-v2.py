#!/usr/bin/env python3
"""
Adapter de compatibilité + registre territorial pour le Data Engine V4 canonique.

Rôles :
- normaliser les formats SNCF hétérogènes sans perdre les métadonnées d'arrêt ;
- enrichir le registre des gares à partir des GTFS statiques ;
- ne jamais déduire le pays d'une gare depuis le seul fournisseur temps réel ;
- conserver la politique FR=SNCF / LU=CFL arrêt par arrêt.
"""

import csv
import importlib.util
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

CORE = Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("lb_data_v4_core", CORE)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

TRAIN_FIELDS = ("train_number", "train", "number", "train_id", "trip_id", "vehicle_journey")
WRAPPER_KEYS = ("data", "trains", "journeys", "retards", "delays", "results", "items", "circulations", "services", "records")

REGISTRY_CACHE = Path(os.getenv(
    "LB_STATION_REGISTRY_CACHE",
    "/opt/labetaillere-data-v4/state/station-registry.json",
))
REGISTRY_TTL = max(3600, int(os.getenv("LB_STATION_REGISTRY_TTL_SEC", "86400")))
GTFS_STOPS_SOURCES = {
    "sncf": os.getenv(
        "LB_GTFS_STOPS_SNCF",
        "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/data/stops.txt",
    ),
    "cfl": os.getenv(
        "LB_GTFS_STOPS_CFL",
        "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/CFL/stopscfl.txt",
    ),
}

UIC_COUNTRIES = {
    "80": ("DE", "DB"),
    "81": ("AT", "OBB"),
    "82": ("LU", "CFL"),
    "83": ("IT", "RFI"),
    "84": ("NL", "NS"),
    "85": ("CH", "SBB"),
    "87": ("FR", "SNCF"),
    "88": ("BE", "SNCB"),
    "71": ("ES", "ADIF"),
}


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
    compact, rich = {}, []

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


# ---------- registre territorial GTFS ----------

def read_text(target):
    if re.match(r"^https?://", str(target or "")):
        req = urllib.request.Request(
            target,
            headers={"User-Agent": "labetaillere-data-v4-registry/1.0", "Accept": "text/csv,text/plain,*/*"},
        )
        with urllib.request.urlopen(req, timeout=max(10, core.TIMEOUT)) as r:
            return r.read().decode("utf-8-sig", errors="replace")
    return Path(target).read_text(encoding="utf-8-sig")


def country_from_ids(*values):
    for value in values:
        text = str(value or "")
        for token in re.findall(r"(?<!\d)(\d{8})(?!\d)", text):
            item = UIC_COUNTRIES.get(token[:2])
            if item:
                return item
    return None


def policy_for_country(country_network):
    if not country_network:
        return None
    country, network = country_network
    authority = "sncf" if country == "FR" else "cfl" if country == "LU" else None
    return {
        "country": country,
        "network": network,
        "realtimeAuthority": authority,
    }


def registry_from_csv(text, provider):
    out = {}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        if not isinstance(row, dict):
            continue
        name = str(row.get("stop_name") or row.get("name") or "").strip()
        if not name:
            continue

        country_network = country_from_ids(
            row.get("stop_id"),
            row.get("parent_station"),
            row.get("stop_code"),
        )

        if country_network is None and provider == "cfl":
            sid = str(row.get("stop_id") or "")
            parent = str(row.get("parent_station") or "")
            if sid.startswith("0002") or parent.startswith("0002"):
                country_network = ("LU", "CFL")

        policy = policy_for_country(country_network)
        if not policy:
            continue

        key = core.canonical_station(name)
        existing = out.get(key)
        if existing and existing.get("country") != policy.get("country"):
            out.pop(key, None)
            continue
        out[key] = policy
    return out


def load_registry_cache():
    try:
        if not REGISTRY_CACHE.exists():
            return None
        age = time.time() - REGISTRY_CACHE.stat().st_mtime
        raw = json.loads(REGISTRY_CACHE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not isinstance(raw.get("stations"), dict):
            return None
        if age <= REGISTRY_TTL:
            return raw
    except Exception:
        return None
    return None


def write_registry_cache(payload):
    try:
        REGISTRY_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = REGISTRY_CACHE.with_name(REGISTRY_CACHE.name + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, REGISTRY_CACHE)
    except Exception:
        pass


def build_station_registry():
    cached = load_registry_cache()
    if cached:
        return cached.get("stations") or {}, cached.get("meta") or {}

    merged = {}
    meta = {"sources": {}, "errors": []}
    for provider, target in GTFS_STOPS_SOURCES.items():
        try:
            rows = registry_from_csv(read_text(target), provider)
            for key, policy in rows.items():
                current = merged.get(key)
                if current and current.get("country") != policy.get("country"):
                    merged.pop(key, None)
                    continue
                merged[key] = policy
            meta["sources"][provider] = {"ok": True, "count": len(rows), "target": target}
        except Exception as exc:
            meta["sources"][provider] = {"ok": False, "target": target, "error": str(exc)}
            meta["errors"].append(f"{provider}: {exc}")

    payload = {
        "generatedAt": core.iso_utc(),
        "stations": merged,
        "meta": meta,
    }
    if merged:
        write_registry_cache(payload)
    return merged, meta


GTFS_STATION_REGISTRY, GTFS_REGISTRY_META = build_station_registry()

for key, policy in GTFS_STATION_REGISTRY.items():
    core.STATION_AUTHORITIES.setdefault(key, policy)

_original_station_policy = core.station_policy


def safe_station_policy(name, source_hint=None):
    registered = _original_station_policy(name, None)
    if any(registered.get(k) is not None for k in ("country", "network", "realtimeAuthority")):
        return registered

    if source_hint == "cfl":
        return {"country": None, "network": "CFL", "realtimeAuthority": "cfl"}
    if source_hint == "sncf":
        return {"country": None, "network": "SNCF", "realtimeAuthority": "sncf"}
    return {"country": None, "network": None, "realtimeAuthority": None}


core.station_policy = safe_station_policy

_original_make_canonical_stop = core.make_canonical_stop


def safe_make_canonical_stop(name, sncf_stop, cfl_stop, arrivals, source_meta):
    stop = _original_make_canonical_stop(name, sncf_stop, cfl_stop, arrivals, source_meta)
    hint = "sncf" if sncf_stop else "cfl" if cfl_stop else None
    policy = safe_station_policy(name, hint)
    stop["country"] = policy.get("country")
    stop["network"] = policy.get("network")
    stop["realtimeAuthority"] = policy.get("realtimeAuthority")
    stop["territoryKnown"] = bool(policy.get("country"))
    return stop


core.make_canonical_stop = safe_make_canonical_stop

_original_build = core.build_snapshot_from_payloads


def patched_build(payloads, source_meta=None):
    patched = dict(payloads or {})
    normalized, path, seen = normalize_sncf_payload(patched.get("sncfRt") or {})
    patched["sncfRt"] = normalized
    snapshot = _original_build(patched, source_meta)

    meta = snapshot.setdefault("meta", {})
    meta["sncfFormat"] = path
    meta["sncfRecordCount"] = seen
    meta["sncfNormalizedCount"] = len(normalized)
    meta["territoryPolicy"] = "gtfs-static-uic-registry-v2"
    meta["stationRegistryCount"] = len(GTFS_STATION_REGISTRY)
    meta["stationRegistry"] = GTFS_REGISTRY_META
    meta["unknownTerritoryStopCount"] = sum(
        1
        for train in snapshot.get("trains") or []
        for stop in train.get("stops") or []
        if not stop.get("country")
    )
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

    for payload in (direct, cancelled):
        n, path, seen = normalize_sncf_payload(payload)
        if not n:
            raise AssertionError(f"adapter SNCF invalide: {path} / {seen}")
        snap = patched_build(
            {"sncfRt": payload, "cflRt": {}, "cflArrivals": {}, "traffic": {}, "compositions": {}},
            [{"name": "sncfRt", "ok": True, "stale": False, "observedAt": core.iso_utc()}],
        )
        if not snap.get("trains"):
            raise AssertionError("adapter: snapshot vide")

    n, _, _ = normalize_sncf_payload(cancelled)
    assert n["88503"]["_canonicalStops"][0]["status"] == "cancelled"

    assert country_from_ids("StopArea:OCE87191007") == ("FR", "SNCF")
    assert country_from_ids("StopArea:OCE82006030") == ("LU", "CFL")
    assert country_from_ids("StopArea:OCE80253914") == ("DE", "DB")

    snap = patched_build(
        {"sncfRt": direct, "cflRt": {}, "cflArrivals": {}, "traffic": {}, "compositions": {}},
        [{"name": "sncfRt", "ok": True, "stale": False, "observedAt": core.iso_utc()}],
    )
    t = next(t for t in snap["trains"] if t["number"] == "88742")
    metz = next(s for s in t["stops"] if s["name"] == "Metz")
    lux = next(s for s in t["stops"] if s["name"] == "Luxembourg")
    assert metz["country"] == "FR" and metz["realtimeAuthority"] == "sncf"
    assert lux["country"] == "LU" and lux["realtimeAuthority"] == "cfl"

    print(json.dumps({
        "ok": True,
        "adapter": "sncf-v5-gtfs-station-registry",
        "stationRegistryCount": len(GTFS_STATION_REGISTRY),
        "registryErrors": GTFS_REGISTRY_META.get("errors") or [],
    }, ensure_ascii=False))


if __name__ == "__main__":
    if "--adapter-fixture-test" in sys.argv:
        adapter_fixture_test()
        raise SystemExit(0)
    core.main()
