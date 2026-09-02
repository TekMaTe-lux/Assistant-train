#!/usr/bin/env python3
"""
Adapter de compatibilité + registre territorial pour le Data Engine V4 canonique.

Rôles :
- normaliser les formats SNCF hétérogènes sans perdre les métadonnées d'arrêt ;
- enrichir le registre des gares à partir des GTFS statiques ;
- ne jamais déduire le pays d'une gare depuis le seul fournisseur temps réel ;
- conserver la politique FR=SNCF / LU=CFL arrêt par arrêt ;
- rattacher les horaires planifiés GTFS au même objet canonique, sans changer
  l'autorité temps réel ni transformer une absence de RT en « à l'heure ».
"""

import concurrent.futures
import csv
import importlib.util
import io
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

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

# ---------- date réelle de circulation + état final ----------
# Les trip_id SNCF contiennent parfois une date de calendrier statique future :
# elle ne doit jamais devenir la date de circulation du flux temps réel courant.
RAIL_TZ = ZoneInfo(os.getenv("LB_RAIL_TIMEZONE", "Europe/Paris"))
HISTORY_PUBLIC_MAX = max(10, int(os.getenv("LB_HISTORY_PUBLIC_MAX", "80")))
HISTORY_PUBLIC_MAX_AGE = max(3600, int(os.getenv("LB_HISTORY_PUBLIC_MAX_AGE_SEC", str(18 * 3600))))


def observed_service_date(source_meta, source_name):
    meta = core.source_meta_by_name(source_meta).get(source_name, {})
    observed = meta.get("observedAt")
    ts = core.parse_iso_ts(observed)
    if ts is not None:
        return core.datetime.fromtimestamp(ts, core.timezone.utc).astimezone(RAIL_TZ).strftime("%Y-%m-%d")
    return core.datetime.now(RAIL_TZ).strftime("%Y-%m-%d")


_original_build_train_from_sncf = core.build_train_from_sncf


def dated_build_train_from_sncf(num, raw, cfl_idx, arr_idx, comps, source_meta):
    train = _original_build_train_from_sncf(num, raw, cfl_idx, arr_idx, comps, source_meta)
    train["serviceDate"] = observed_service_date(source_meta, "sncfRt")
    return train


core.build_train_from_sncf = dated_build_train_from_sncf

_original_build_train_from_cfl = core.build_train_from_cfl


def dated_build_train_from_cfl(num, stations, arr_idx, comps, source_meta):
    train = _original_build_train_from_cfl(num, stations, arr_idx, comps, source_meta)
    service_date = observed_service_date(source_meta, "cflRt")
    train["serviceDate"] = service_date
    train["id"] = f"CFL:{norm_train(num)}:{service_date}"
    return train


core.build_train_from_cfl = dated_build_train_from_cfl


def canonical_history_key(train):
    num = norm_train((train or {}).get("number"))
    service_date = str((train or {}).get("serviceDate") or "unknown")
    if num:
        return f"{num}:{service_date}"
    return str((train or {}).get("id") or f"unknown:{service_date}")


core.history_key = canonical_history_key


def recent_completed_trains():
    now = time.time()
    rows = []
    for item in core._history.values():
        if not isinstance(item, dict) or not item.get("completedAt"):
            continue
        completed_ts = core.parse_iso_ts(item.get("completedAt"))
        if completed_ts is None or (now - completed_ts) > HISTORY_PUBLIC_MAX_AGE:
            continue
        observation = item.get("lastObservation")
        if not isinstance(observation, dict):
            continue
        rows.append((float(completed_ts), item))

    rows.sort(key=lambda pair: pair[0], reverse=True)
    out = []
    for _, item in rows[:HISTORY_PUBLIC_MAX]:
        observation = core.copy.deepcopy(item.get("lastObservation") or {})
        observation["lifecycle"] = "completed"
        observation["realtimePresence"] = False
        observation["realtimePresenceFresh"] = False
        observation["_history"] = {
            key: value
            for key, value in item.items()
            if key != "lastObservation"
        }
        out.append(observation)
    return out


_original_commit_snapshot = core.commit_snapshot


def commit_snapshot_with_completed(snap):
    with core._lock:
        previous = core._snapshot

    core.update_history(previous, snap)
    completed = recent_completed_trains()
    snap["completedTrains"] = completed
    meta = snap.setdefault("meta", {})
    meta["historyPolicy"] = "number-service-date-v1"
    meta["completedTrainCount"] = len(completed)

    with core._lock:
        core._snapshot = snap
        core._last_error = None
    core.write_snapshot(snap)


core.commit_snapshot = commit_snapshot_with_completed

# ---------- horaires planifiés GTFS SNCF ----------
# On réutilise l'API statique déjà employée par les fiches/signalements. Elle ne
# devient jamais une source temps réel : elle ne fournit que le planifié. Le
# cache évite de refaire une requête pour chaque snapshot de 15 s.
STATIC_TRAIN_BASE = os.getenv(
    "LB_STATIC_TRAIN_BASE",
    "https://vps.labetaillere.fr/api/train-static",
).strip()
STATIC_TIMETABLE_TTL = max(300, int(os.getenv("LB_STATIC_TIMETABLE_TTL_SEC", str(6 * 3600))))
STATIC_TIMETABLE_ERROR_TTL = max(30, int(os.getenv("LB_STATIC_TIMETABLE_ERROR_TTL_SEC", "120")))
STATIC_TIMETABLE_TIMEOUT = max(1.0, float(os.getenv("LB_STATIC_TIMETABLE_TIMEOUT_SEC", "5")))
STATIC_TIMETABLE_WORKERS = max(1, min(8, int(os.getenv("LB_STATIC_TIMETABLE_WORKERS", "6"))))
_static_timetable_cache = {}
_static_timetable_lock = threading.Lock()


def static_row_name(row):
    name = station_name(row)
    if name:
        return name
    if not isinstance(row, dict):
        return ""
    for key in ("stop_point", "stopPoint", "stationInfo"):
        child = row.get(key)
        if isinstance(child, dict):
            name = str(child.get("name") or child.get("stop_name") or "").strip()
            if name:
                return name
    return ""


def static_row_sequence(row):
    if not isinstance(row, dict):
        return 0
    for key in ("stop_sequence", "stopSequence", "sequence", "order"):
        try:
            return int(row.get(key))
        except (TypeError, ValueError):
            pass
    return 0


def static_time_value(row, kind):
    if not isinstance(row, dict):
        return None
    keys = (
        ("arrival_time", "arrival", "arrivalPlanned", "plannedArrival", "scheduledArrival", "base_arrival_time")
        if kind == "arrival"
        else ("departure_time", "departure", "departurePlanned", "plannedDeparture", "scheduledDeparture", "base_departure_time")
    )
    for key in keys:
        value = row.get(key)
        if isinstance(value, dict):
            value = (
                value.get("planned") or value.get("scheduled") or value.get("base")
                or value.get("time") or value.get("value")
            )
        value = core.normalize_time_text(value)
        if value:
            return value
    return None


def add_delay_to_gtfs_clock(value, delay_minutes):
    match = re.match(r"^(\d{1,3}):(\d{2})(?::(\d{2}))?", str(value or "").strip())
    delay = core.safe_num(delay_minutes)
    if not match or delay is None:
        return None
    total = int(match.group(1)) * 60 + int(match.group(2)) + int(round(delay))
    if total < 0:
        return None
    return f"{total // 60:02d}:{total % 60:02d}"


def static_candidates(payload):
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("stop_times") or payload.get("stops")
        if not isinstance(rows, list):
            match = payload.get("match")
            rows = match.get("stops") if isinstance(match, dict) else None
        if not isinstance(rows, list):
            data = payload.get("data")
            if isinstance(data, dict):
                rows = data.get("stop_times") or data.get("stops")
    else:
        rows = None

    if not isinstance(rows, list):
        return []

    groups = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        trip_id = str(
            row.get("trip_id") or row.get("tripId") or row.get("vehicle_journey")
            or row.get("journey_id") or "default"
        )
        groups.setdefault(trip_id, []).append(row)

    out = []
    for trip_id, group in groups.items():
        ordered = sorted(group, key=static_row_sequence)
        if any(static_row_name(row) for row in ordered):
            out.append({"tripId": trip_id, "rows": ordered})
    return out


def choose_static_candidate(train, payload):
    candidates = static_candidates(payload)
    target_stops = [
        core.canonical_station(stop.get("name"))
        for stop in (train.get("stops") or [])
        if stop.get("name")
    ]
    target_stops = [key for key in target_stops if key]
    if not target_stops:
        return None
    target_set = set(target_stops)
    train_id = str(train.get("id") or "")

    best = None
    best_score = -10**9
    best_overlap = 0
    for candidate in candidates:
        rows = candidate["rows"]
        keys = [core.canonical_station(static_row_name(row)) for row in rows]
        keys = [key for key in keys if key]
        if not keys:
            continue
        overlap = sum(1 for key in keys if key in target_set)
        score = overlap * 20 - abs(len(keys) - len(target_stops)) * 2
        if keys[0] == target_stops[0]:
            score += 35
        if keys[-1] == target_stops[-1]:
            score += 35
        if train_id and candidate["tripId"] == train_id:
            score += 150
        if score > best_score:
            best_score = score
            best_overlap = overlap
            best = candidate

    minimum = 1 if len(target_stops) == 1 else 2
    return best if best is not None and best_overlap >= minimum else None


def fetch_static_train(number, service_date):
    number = norm_train(number)
    service_date = str(service_date or "")
    if not STATIC_TRAIN_BASE or not number or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", service_date):
        return None, "configuration statique incomplète", False

    cache_key = f"{service_date}:{number}"
    now = time.time()
    with _static_timetable_lock:
        cached = _static_timetable_cache.get(cache_key)
        if cached:
            ttl = STATIC_TIMETABLE_TTL if cached.get("payload") is not None else STATIC_TIMETABLE_ERROR_TTL
            if now - float(cached.get("storedAt") or 0) < ttl:
                return cached.get("payload"), cached.get("error"), True

    query = urllib.parse.urlencode({
        "date": service_date.replace("-", ""),
        "train": number,
    })
    separator = "&" if "?" in STATIC_TRAIN_BASE else "?"
    url = f"{STATIC_TRAIN_BASE}{separator}{query}"
    try:
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "labetaillere-data-v4-static/1.0"},
        )
        with urllib.request.urlopen(req, timeout=STATIC_TIMETABLE_TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
        error = None
    except Exception as exc:
        payload = None
        error = str(exc)

    with _static_timetable_lock:
        _static_timetable_cache[cache_key] = {
            "storedAt": now,
            "payload": payload,
            "error": error,
        }
    return payload, error, False


def enrich_train_static(train, payload):
    candidate = choose_static_candidate(train, payload)
    if not candidate:
        return {"matched": False, "enrichedStops": 0, "derivedRealtimeFields": 0}

    rows_by_station = {}
    for row in candidate["rows"]:
        key = core.canonical_station(static_row_name(row))
        if key and key not in rows_by_station:
            rows_by_station[key] = row

    enriched_stops = 0
    derived_fields = 0
    for stop in train.get("stops") or []:
        key = core.canonical_station(stop.get("name"))
        row = rows_by_station.get(key)
        if not row:
            continue
        planned_arrival = static_time_value(row, "arrival")
        planned_departure = static_time_value(row, "departure")
        touched = False

        arrival = stop.get("arrival") if isinstance(stop.get("arrival"), dict) else {}
        departure = stop.get("departure") if isinstance(stop.get("departure"), dict) else {}
        stop["arrival"] = arrival
        stop["departure"] = departure

        if planned_arrival:
            arrival["planned"] = planned_arrival
            arrival["plannedSource"] = "SNCF_GTFS_STATIC"
            arrival["plannedQuality"] = "scheduled"
            touched = True
        if planned_departure:
            departure["planned"] = planned_departure
            departure["plannedSource"] = "SNCF_GTFS_STATIC"
            departure["plannedQuality"] = "scheduled"
            touched = True

        # Une heure réelle dérivée n'existe que si le RT de l'arrêt est réellement
        # connu et frais. On n'interprète donc jamais « pas de RT » comme +0.
        delay = core.safe_num(stop.get("delayMinutes"))
        rt_known = bool(stop.get("realtimeKnown")) and stop.get("cancelled") is not True
        rt_fresh = (stop.get("delay") or {}).get("fresh") is not False
        if rt_known and rt_fresh and delay is not None:
            if not arrival.get("realtime") and planned_arrival:
                derived = add_delay_to_gtfs_clock(planned_arrival, delay)
                if derived:
                    arrival["realtime"] = derived
                    arrival["realtimeDerived"] = True
                    arrival["realtimeDerivation"] = "planned+canonical-delay"
                    derived_fields += 1
            if not departure.get("realtime") and planned_departure:
                derived = add_delay_to_gtfs_clock(planned_departure, delay)
                if derived:
                    departure["realtime"] = derived
                    departure["realtimeDerived"] = True
                    departure["realtimeDerivation"] = "planned+canonical-delay"
                    derived_fields += 1

        if touched:
            enriched_stops += 1

    if enriched_stops:
        train["timetable"] = {
            "source": "SNCF_GTFS_STATIC",
            "quality": "scheduled",
            "tripId": candidate.get("tripId"),
            "matched": True,
        }
    return {
        "matched": enriched_stops > 0,
        "enrichedStops": enriched_stops,
        "derivedRealtimeFields": derived_fields,
    }


def enrich_snapshot_static_timetables(snapshot):
    trains = [
        train for train in (snapshot.get("trains") or [])
        if str(train.get("operator") or "").upper() == "SNCF"
        and norm_train(train.get("number"))
        and train.get("serviceDate")
        and train.get("stops")
    ]
    stats = {
        "source": "SNCF_GTFS_STATIC",
        "endpoint": STATIC_TRAIN_BASE,
        "requestedTrains": len(trains),
        "matchedTrains": 0,
        "enrichedStops": 0,
        "derivedRealtimeFields": 0,
        "cacheHits": 0,
        "errors": [],
    }
    if not trains or not STATIC_TRAIN_BASE:
        return stats

    def load(train):
        payload, error, cache_hit = fetch_static_train(train.get("number"), train.get("serviceDate"))
        return train, payload, error, cache_hit

    with concurrent.futures.ThreadPoolExecutor(max_workers=STATIC_TIMETABLE_WORKERS) as pool:
        futures = [pool.submit(load, train) for train in trains]
        for future in concurrent.futures.as_completed(futures):
            try:
                train, payload, error, cache_hit = future.result()
            except Exception as exc:
                stats["errors"].append(str(exc))
                continue
            if cache_hit:
                stats["cacheHits"] += 1
            if error:
                if len(stats["errors"]) < 12:
                    stats["errors"].append(f"{train.get('number')}: {error}")
                continue
            result = enrich_train_static(train, payload)
            if result["matched"]:
                stats["matchedTrains"] += 1
            stats["enrichedStops"] += result["enrichedStops"]
            stats["derivedRealtimeFields"] += result["derivedRealtimeFields"]

    stats["ok"] = stats["matchedTrains"] > 0 or stats["requestedTrains"] == 0
    return stats


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

# On enrichit uniquement les vrais snapshots du moteur. Les fixtures unitaires
# restent 100 % locales et ne dépendent donc jamais de l'API statique.
_original_build_snapshot = core.build_snapshot


def build_snapshot_with_static_timetable():
    snapshot = _original_build_snapshot()
    static_stats = enrich_snapshot_static_timetables(snapshot)
    meta = snapshot.setdefault("meta", {})
    meta["staticTimetablePolicy"] = "sncf-train-static-cache-v1"
    meta["staticTimetable"] = static_stats
    meta["plannedStopCount"] = sum(
        1
        for train in snapshot.get("trains") or []
        for stop in train.get("stops") or []
        if (stop.get("arrival") or {}).get("planned")
        or (stop.get("departure") or {}).get("planned")
    )
    return snapshot


core.build_snapshot = build_snapshot_with_static_timetable


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
    assert t["serviceDate"] == observed_service_date(
        [{"name": "sncfRt", "ok": True, "stale": False, "observedAt": core.iso_utc()}],
        "sncfRt",
    )

    fixture_static = {
        "stop_times": [
            {"trip_id": "fixture", "stop_sequence": 1, "stop_name": "Metz", "arrival_time": "09:00:00", "departure_time": "09:03:00"},
            {"trip_id": "fixture", "stop_sequence": 2, "stop_name": "Thionville", "arrival_time": "09:30:00", "departure_time": "09:32:00"},
            {"trip_id": "fixture", "stop_sequence": 3, "stop_name": "Luxembourg", "arrival_time": "10:00:00", "departure_time": "10:00:00"},
        ]
    }
    enriched = enrich_train_static(t, fixture_static)
    assert enriched["matched"] is True
    assert metz["departure"]["planned"] == "09:03:00"
    assert metz["departure"]["realtime"] == "09:03"
    assert metz["departure"]["realtimeDerived"] is True
    assert lux["arrival"]["planned"] == "10:00:00"

    print(json.dumps({
        "ok": True,
        "adapter": "sncf-v7-static-timetable-history",
        "stationRegistryCount": len(GTFS_STATION_REGISTRY),
        "registryErrors": GTFS_REGISTRY_META.get("errors") or [],
        "staticFixture": enriched,
    }, ensure_ascii=False))


if __name__ == "__main__":
    if "--adapter-fixture-test" in sys.argv:
        adapter_fixture_test()
        raise SystemExit(0)
    core.main()
