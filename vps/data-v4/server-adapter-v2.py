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

import csv
import importlib.util
import io
import json
import os
import pickle
import re
import sys
import threading
import time
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


def station_match_key(name):
    """Clé inter-sources sans altérer le libellé affiché.

    Les GTFS CFL publient notamment « Luxembourg, Gare Centrale »,
    « Bettembourg, Gare » ou « Belval (Université), Gare », alors que HAFAS
    renvoie « Luxembourg », « Bettembourg » et « Belval-Université ».
    Cette clé ne sert qu'aux appariements/alias ; elle ne renomme jamais la gare.
    """
    key = core.canonical_station(name)
    if not key:
        return ""
    key = re.sub(r",\s*gare(?:\s+centrale)?\s*$", "", key, flags=re.I)
    key = re.sub(r"\s*\(([^)]+)\)", r"-\1", key)
    key = key.replace(",", " ")
    key = re.sub(r"[^a-z0-9' -]+", " ", key)
    key = re.sub(r"\s*-\s*", "-", key)
    key = re.sub(r"\s+", " ", key)
    return key.strip(" -")


def registry_from_csv(text, provider):
    out = {}
    conflicts = set()
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

        keys = {
            core.canonical_station(name),
            station_match_key(name),
        }
        for key in {k for k in keys if k}:
            if key in conflicts:
                continue
            existing = out.get(key)
            if existing and existing.get("country") != policy.get("country"):
                out.pop(key, None)
                conflicts.add(key)
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

    alias = station_match_key(name)
    if alias:
        policy = core.STATION_AUTHORITIES.get(alias)
        if policy:
            return {
                "country": policy.get("country"),
                "network": policy.get("network"),
                "realtimeAuthority": policy.get("realtimeAuthority"),
            }

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

# ---------- horaires planifiés GTFS locaux ----------
# Le planifié ne repasse plus par /api/train-static : les fichiers GTFS présents
# sur le VPS sont lus une seule fois, filtrés sur les services du jour puis mis
# en cache. Ajouter un fournisseur revient à ajouter une entrée à cette table.
STATIC_GTFS_CACHE = Path(os.getenv(
    "LB_STATIC_GTFS_CACHE",
    "/opt/labetaillere-data-v4/state/static-gtfs-current.pkl",
))
STATIC_GTFS_RECHECK_SEC = max(60, int(os.getenv("LB_STATIC_GTFS_RECHECK_SEC", "300")))
STATIC_GTFS_PROVIDERS = {
    "sncf": {
        "operator": "SNCF",
        "source": "SNCF_GTFS_STATIC",
        "root": Path(os.getenv("LB_STATIC_GTFS_SNCF_DIR", "/var/www/html/gtfs/static")),
    },
    "cfl": {
        "operator": "CFL",
        "source": "CFL_GTFS_STATIC",
        "root": Path(os.getenv("LB_STATIC_GTFS_CFL_DIR", "/var/www/html/gtfs/static/CFL")),
    },
}
_static_gtfs_lock = threading.Lock()
_static_gtfs_index = None
_static_gtfs_checked_at = 0.0


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


def gtfs_clock_minutes(value):
    match = re.match(r"^(\d{1,3}):(\d{2})(?::(\d{2}))?", str(value or "").strip())
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def clock_distance_minutes(a, b):
    left = gtfs_clock_minutes(a)
    right = gtfs_clock_minutes(b)
    if left is None or right is None:
        return None
    left %= 1440
    right %= 1440
    diff = abs(left - right)
    return min(diff, 1440 - diff)


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


def candidate_time_score(train, rows):
    rows_by_station = {}
    for row in rows:
        key = station_match_key(static_row_name(row))
        if key and key not in rows_by_station:
            rows_by_station[key] = row

    score = 0
    anchors = 0
    for stop in train.get("stops") or []:
        key = station_match_key(stop.get("name"))
        row = rows_by_station.get(key)
        if not row:
            continue
        arrival = stop.get("arrival") if isinstance(stop.get("arrival"), dict) else {}
        departure = stop.get("departure") if isinstance(stop.get("departure"), dict) else {}
        pairs = (
            (arrival.get("planned"), static_time_value(row, "arrival")),
            (departure.get("planned"), static_time_value(row, "departure")),
        )
        for observed, scheduled in pairs:
            distance = clock_distance_minutes(observed, scheduled)
            if distance is None:
                continue
            anchors += 1
            if distance <= 1:
                score += 45
            elif distance <= 3:
                score += 30
            elif distance <= 7:
                score += 12
            elif distance >= 20:
                score -= 25
    return score, anchors


def choose_static_candidate(train, payload):
    candidates = static_candidates(payload)
    target_stops = [
        station_match_key(stop.get("name"))
        for stop in (train.get("stops") or [])
        if stop.get("name")
    ]
    target_stops = [key for key in target_stops if key]
    if not target_stops:
        return None
    target_set = set(target_stops)
    train_id = str(train.get("id") or "")
    ordered_route = str(train.get("operator") or "").upper() != "CFL"

    best = None
    best_score = -10**9
    best_overlap = 0
    for candidate in candidates:
        rows = candidate["rows"]
        keys = [station_match_key(static_row_name(row)) for row in rows]
        keys = [key for key in keys if key]
        if not keys:
            continue
        overlap = sum(1 for key in keys if key in target_set)
        score = overlap * 20 - abs(len(keys) - len(target_stops)) * 2
        if ordered_route and keys[0] == target_stops[0]:
            score += 35
        if ordered_route and keys[-1] == target_stops[-1]:
            score += 35
        if train_id and candidate["tripId"] == train_id:
            score += 150
        time_score, time_anchors = candidate_time_score(train, rows)
        score += time_score
        if time_anchors:
            candidate = dict(candidate, timeAnchors=time_anchors)
        if score > best_score:
            best_score = score
            best_overlap = overlap
            best = candidate

    minimum = 1 if len(target_stops) == 1 else 2
    return best if best is not None and best_overlap >= minimum else None


def enrich_train_static(train, payload, source_label="SNCF_GTFS_STATIC"):
    candidate = choose_static_candidate(train, payload)
    if not candidate:
        return {"matched": False, "enrichedStops": 0, "derivedRealtimeFields": 0}

    rows_by_station = {}
    for row in candidate["rows"]:
        key = station_match_key(static_row_name(row))
        if key and key not in rows_by_station:
            rows_by_station[key] = row

    enriched_stops = 0
    derived_fields = 0
    for stop in train.get("stops") or []:
        key = station_match_key(stop.get("name"))
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
            arrival["plannedSource"] = source_label
            arrival["plannedQuality"] = "scheduled"
            touched = True
        if planned_departure:
            departure["planned"] = planned_departure
            departure["plannedSource"] = source_label
            departure["plannedQuality"] = "scheduled"
            touched = True

        # Une heure réelle dérivée n'existe que si le RT de l'arrêt est réellement
        # connu et frais. Une absence de RT ne devient donc jamais artificiellement +0.
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
            "source": source_label,
            "quality": "scheduled",
            "tripId": candidate.get("tripId"),
            "matched": True,
            "matchPolicy": "station-alias+time-v1",
        }
    return {
        "matched": enriched_stops > 0,
        "enrichedStops": enriched_stops,
        "derivedRealtimeFields": derived_fields,
    }


def train_number_from_trip(provider, row):
    if not isinstance(row, dict):
        return ""
    if provider == "cfl":
        number = norm_train(row.get("trip_short_name"))
        if number:
            return number
    trip_id = str(row.get("trip_id") or "")
    match = re.search(r"OCESN(\d{3,6})F", trip_id)
    if match:
        return match.group(1).lstrip("0") or "0"
    match = re.search(r"(?<!\d)(\d{4,6})(?!\d)", trip_id)
    return (match.group(1).lstrip("0") or "0") if match else ""


def provider_paths(provider):
    cfg = STATIC_GTFS_PROVIDERS[provider]
    root = Path(cfg["root"])
    return {
        "root": root,
        "trips": root / "trips.txt",
        "stop_times": root / "stop_times.txt",
        "stops": root / "stops.txt",
        "calendar": root / "calendar.txt",
        "calendar_dates": root / "calendar_dates.txt",
    }


def active_services_for_date(paths, service_date):
    compact = service_date.replace("-", "")
    try:
        target = core.datetime.strptime(compact, "%Y%m%d")
    except Exception:
        return None
    weekday = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[target.weekday()]
    active = set()
    calendar_seen = False
    exceptions_seen = False

    if paths["calendar"].exists():
        calendar_seen = True
        with paths["calendar"].open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                service_id = str(row.get("service_id") or "").strip()
                if not service_id:
                    continue
                start = str(row.get("start_date") or "")
                end = str(row.get("end_date") or "")
                if start <= compact <= end and str(row.get(weekday) or "0") == "1":
                    active.add(service_id)

    if paths["calendar_dates"].exists():
        with paths["calendar_dates"].open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if str(row.get("date") or "").strip() != compact:
                    continue
                exceptions_seen = True
                service_id = str(row.get("service_id") or "").strip()
                try:
                    exception_type = int(row.get("exception_type") or 0)
                except (TypeError, ValueError):
                    exception_type = 0
                if exception_type == 1:
                    active.add(service_id)
                elif exception_type == 2:
                    active.discard(service_id)

    if not calendar_seen and not exceptions_seen:
        return None
    return active


def static_gtfs_fingerprint(service_date):
    pieces = [service_date]
    for provider in sorted(STATIC_GTFS_PROVIDERS):
        paths = provider_paths(provider)
        for key in ("trips", "stop_times", "stops", "calendar", "calendar_dates"):
            path = paths[key]
            if key in ("trips", "stop_times", "stops") and not path.exists():
                raise FileNotFoundError(f"{provider}: {path}")
            if path.exists():
                st = path.stat()
                pieces.append(f"{provider}:{key}:{st.st_size}:{st.st_mtime_ns}")
    return "|".join(pieces)


def build_provider_static_index(provider, service_date):
    cfg = STATIC_GTFS_PROVIDERS[provider]
    paths = provider_paths(provider)
    active_services = active_services_for_date(paths, service_date)
    if active_services is None:
        raise RuntimeError(f"{provider}: calendrier actif introuvable pour {service_date}")

    stops = {}
    with paths["stops"].open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            stop_id = str(row.get("stop_id") or "").strip()
            stop_name = str(row.get("stop_name") or "").strip()
            if stop_id and stop_name and stop_id not in stops:
                stops[stop_id] = stop_name

    trip_ids = set()
    by_train = {}
    with paths["trips"].open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            service_id = str(row.get("service_id") or "").strip()
            if service_id not in active_services:
                continue
            trip_id = str(row.get("trip_id") or "").strip()
            number = train_number_from_trip(provider, row)
            if not trip_id or not number:
                continue
            trip_ids.add(trip_id)
            by_train.setdefault(number, []).append(trip_id)

    by_trip = {trip_id: [] for trip_id in trip_ids}
    with paths["stop_times"].open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            trip_id = str(row.get("trip_id") or "").strip()
            if trip_id not in by_trip:
                continue
            stop_id = str(row.get("stop_id") or "").strip()
            try:
                sequence = int(row.get("stop_sequence") or 0)
            except (TypeError, ValueError):
                sequence = 0
            by_trip[trip_id].append({
                "trip_id": trip_id,
                "stop_sequence": sequence,
                "stop_id": stop_id,
                "stop_name": stops.get(stop_id, stop_id),
                "arrival_time": str(row.get("arrival_time") or "").strip(),
                "departure_time": str(row.get("departure_time") or "").strip(),
            })

    empty = [trip_id for trip_id, rows in by_trip.items() if not rows]
    for trip_id in empty:
        by_trip.pop(trip_id, None)
    if empty:
        for number, ids in list(by_train.items()):
            kept = [trip_id for trip_id in ids if trip_id in by_trip]
            if kept:
                by_train[number] = kept
            else:
                by_train.pop(number, None)

    stop_time_count = sum(len(rows) for rows in by_trip.values())
    return {
        "operator": cfg["operator"],
        "source": cfg["source"],
        "root": str(paths["root"]),
        "activeServiceCount": len(active_services),
        "trainNumberCount": len(by_train),
        "tripCount": len(by_trip),
        "stopTimeCount": stop_time_count,
        "byTrain": by_train,
        "byTrip": by_trip,
    }


def load_static_gtfs_cache(fingerprint, service_date):
    try:
        if not STATIC_GTFS_CACHE.exists():
            return None
        with STATIC_GTFS_CACHE.open("rb") as f:
            payload = pickle.load(f)
        if not isinstance(payload, dict):
            return None
        if payload.get("fingerprint") != fingerprint or payload.get("serviceDate") != service_date:
            return None
        if not isinstance(payload.get("providers"), dict):
            return None
        payload["cacheReused"] = True
        return payload
    except Exception:
        return None


def write_static_gtfs_cache(payload):
    try:
        STATIC_GTFS_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATIC_GTFS_CACHE.with_name(STATIC_GTFS_CACHE.name + ".tmp")
        with tmp.open("wb") as f:
            pickle.dump(payload, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, STATIC_GTFS_CACHE)
    except Exception:
        pass


def ensure_static_gtfs_index(service_date, force=False):
    global _static_gtfs_index, _static_gtfs_checked_at
    now = time.time()
    with _static_gtfs_lock:
        if (
            not force
            and isinstance(_static_gtfs_index, dict)
            and _static_gtfs_index.get("serviceDate") == service_date
            and (now - _static_gtfs_checked_at) < STATIC_GTFS_RECHECK_SEC
        ):
            return _static_gtfs_index

        fingerprint = static_gtfs_fingerprint(service_date)
        cached = load_static_gtfs_cache(fingerprint, service_date)
        if cached:
            _static_gtfs_index = cached
            _static_gtfs_checked_at = now
            return cached

        started = time.perf_counter()
        providers = {}
        errors = []
        for provider in STATIC_GTFS_PROVIDERS:
            try:
                providers[provider] = build_provider_static_index(provider, service_date)
            except Exception as exc:
                errors.append(f"{provider}: {exc}")

        payload = {
            "version": "local-current-day-v3",
            "serviceDate": service_date,
            "fingerprint": fingerprint,
            "generatedAt": core.iso_utc(),
            "buildMs": round((time.perf_counter() - started) * 1000),
            "cacheReused": False,
            "providers": providers,
            "errors": errors,
        }
        if providers:
            write_static_gtfs_cache(payload)
        _static_gtfs_index = payload
        _static_gtfs_checked_at = now
        return payload


def local_static_payload(train, static_index):
    operator = str(train.get("operator") or "").upper()
    provider = "sncf" if operator == "SNCF" else "cfl" if operator == "CFL" else None
    if not provider:
        return None, None, "fournisseur GTFS statique inconnu"
    provider_index = (static_index.get("providers") or {}).get(provider)
    if not isinstance(provider_index, dict):
        return None, None, f"index {provider} indisponible"

    number = norm_train(train.get("number"))
    candidate_ids = []
    exact = str(train.get("id") or "")
    by_trip = provider_index.get("byTrip") or {}
    by_train = provider_index.get("byTrain") or {}
    if exact in by_trip:
        candidate_ids.append(exact)
    for trip_id in by_train.get(number, []):
        if trip_id not in candidate_ids:
            candidate_ids.append(trip_id)
    candidate_ids = candidate_ids[:40]
    rows = []
    for trip_id in candidate_ids:
        rows.extend(by_trip.get(trip_id) or [])
    if not rows:
        return None, provider_index.get("source"), "aucun trajet statique candidat"
    return {"stop_times": rows}, provider_index.get("source"), None


def enrich_snapshot_static_timetables(snapshot):
    trains = [
        train for train in (snapshot.get("trains") or [])
        if str(train.get("operator") or "").upper() in ("SNCF", "CFL")
        and norm_train(train.get("number"))
        and train.get("serviceDate")
        and train.get("stops")
    ]
    service_dates = sorted({str(train.get("serviceDate")) for train in trains if train.get("serviceDate")})
    stats = {
        "source": "LOCAL_GTFS_STATIC",
        "mode": "memory-index-current-day",
        "requestedTrains": len(trains),
        "matchedTrains": 0,
        "enrichedStops": 0,
        "derivedRealtimeFields": 0,
        "errors": [],
        "providers": {},
    }
    if not trains:
        stats["ok"] = True
        return stats
    if len(service_dates) != 1:
        stats["errors"].append(f"dates de service multiples: {service_dates}")
        stats["ok"] = False
        return stats

    service_date = service_dates[0]
    try:
        static_index = ensure_static_gtfs_index(service_date)
    except Exception as exc:
        stats["errors"].append(str(exc))
        stats["ok"] = False
        return stats

    stats["serviceDate"] = service_date
    stats["indexVersion"] = static_index.get("version")
    stats["indexBuildMs"] = static_index.get("buildMs")
    stats["cacheReused"] = bool(static_index.get("cacheReused"))
    stats["indexErrors"] = static_index.get("errors") or []
    for provider, info in (static_index.get("providers") or {}).items():
        stats["providers"][provider] = {
            "root": info.get("root"),
            "source": info.get("source"),
            "activeServiceCount": info.get("activeServiceCount"),
            "trainNumberCount": info.get("trainNumberCount"),
            "tripCount": info.get("tripCount"),
            "stopTimeCount": info.get("stopTimeCount"),
            "requestedTrains": 0,
            "matchedTrains": 0,
            "enrichedStops": 0,
        }

    for train in trains:
        provider = "sncf" if str(train.get("operator") or "").upper() == "SNCF" else "cfl"
        provider_stats = stats["providers"].setdefault(provider, {
            "requestedTrains": 0, "matchedTrains": 0, "enrichedStops": 0
        })
        provider_stats["requestedTrains"] = int(provider_stats.get("requestedTrains") or 0) + 1
        payload, source_label, error = local_static_payload(train, static_index)
        if error:
            if len(stats["errors"]) < 20:
                stats["errors"].append(f"{train.get('number')}: {error}")
            continue
        result = enrich_train_static(train, payload, source_label or "GTFS_STATIC")
        if result["matched"]:
            stats["matchedTrains"] += 1
            provider_stats["matchedTrains"] = int(provider_stats.get("matchedTrains") or 0) + 1
        stats["enrichedStops"] += result["enrichedStops"]
        provider_stats["enrichedStops"] = int(provider_stats.get("enrichedStops") or 0) + result["enrichedStops"]
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
    meta["territoryPolicy"] = "gtfs-static-uic-registry-alias-v3"
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
# restent 100 % locales et ne dépendent jamais d'un endpoint HTTP.
_original_build_snapshot = core.build_snapshot


def build_snapshot_with_static_timetable():
    snapshot = _original_build_snapshot()
    static_stats = enrich_snapshot_static_timetables(snapshot)
    meta = snapshot.setdefault("meta", {})
    meta["staticTimetablePolicy"] = "local-gtfs-memory-index-v3"
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
    assert train_number_from_trip("sncf", {"trip_id": "OCESN88742F1187"}) == "88742"
    assert train_number_from_trip("cfl", {"trip_short_name": "RE 411", "trip_id": "x"}) == "411"
    assert station_match_key("Luxembourg, Gare Centrale") == station_match_key("Luxembourg") == "luxembourg"
    assert station_match_key("Bettembourg, Gare") == station_match_key("Bettembourg") == "bettembourg"
    assert station_match_key("Belval (Université), Gare") == station_match_key("Belval-Université") == "belval-universite"

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
    enriched = enrich_train_static(t, fixture_static, "SNCF_GTFS_STATIC")
    assert enriched["matched"] is True
    assert metz["departure"]["planned"] == "09:03:00"
    assert metz["departure"]["realtime"] == "09:03"
    assert metz["departure"]["realtimeDerived"] is True
    assert lux["arrival"]["planned"] == "10:00:00"

    cfl_fixture_train = {
        "id": "CFL:6839:fixture",
        "number": "6839",
        "operator": "CFL",
        "stops": [
            {"name": "Pétange", "arrival": {}, "departure": {}, "delay": {"fresh": True}, "delayMinutes": 0, "realtimeKnown": True, "cancelled": False},
            {"name": "Belval-Lycée", "arrival": {}, "departure": {}, "delay": {"fresh": True}, "delayMinutes": 0, "realtimeKnown": True, "cancelled": False},
            {"name": "Luxembourg", "arrival": {"planned": "14:00"}, "departure": {}, "delay": {"fresh": True}, "delayMinutes": 0, "realtimeKnown": True, "cancelled": False},
        ],
    }
    cfl_fixture_static = {
        "stop_times": [
            {"trip_id": "24332025", "stop_sequence": 1, "stop_name": "Pétange, Gare", "arrival_time": "13:07:00", "departure_time": "13:07:00"},
            {"trip_id": "24332025", "stop_sequence": 2, "stop_name": "Belval (Lycée), Gare", "arrival_time": "13:24:00", "departure_time": "13:24:00"},
            {"trip_id": "24332025", "stop_sequence": 3, "stop_name": "Luxembourg, Gare Centrale", "arrival_time": "14:00:00", "departure_time": "14:06:00"},
        ]
    }
    cfl_enriched = enrich_train_static(cfl_fixture_train, cfl_fixture_static, "CFL_GTFS_STATIC")
    assert cfl_enriched["matched"] is True
    assert cfl_enriched["enrichedStops"] == 3
    assert cfl_fixture_train["stops"][2]["arrival"]["planned"] == "14:00:00"
    assert cfl_fixture_train["timetable"]["tripId"] == "24332025"

    print(json.dumps({
        "ok": True,
        "adapter": "sncf-v9-cfl-station-aliases-local-gtfs-history",
        "stationRegistryCount": len(GTFS_STATION_REGISTRY),
        "registryErrors": GTFS_REGISTRY_META.get("errors") or [],
        "staticFixture": enriched,
        "cflStaticFixture": cfl_enriched,
    }, ensure_ascii=False))


if __name__ == "__main__":
    if "--adapter-fixture-test" in sys.argv:
        adapter_fixture_test()
        raise SystemExit(0)
    core.main()
