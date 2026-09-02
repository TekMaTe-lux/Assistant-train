#!/usr/bin/env python3
"""
La Bétaillère Data Engine V4 — moteur canonique transfrontalier.

Objectifs:
- une seule vérité normalisée consommable par LIVE / fiches / carte / tableaux;
- autorité par arrêt ET par champ, pas par train;
- aucune donnée CFL/HAFAS ne contamine les arrêts français;
- absence de valeur != suppression;
- provenance + fraîcheur explicites;
- ajout futur de fournisseurs (SNCB, DB, GPS...) sans réécrire les écrans;
- compatibilité descendante avec les champs V4 déjà exposés.
"""

import argparse
import copy
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.getenv("LB_DATA_HOST", "127.0.0.1")
PORT = int(os.getenv("LB_DATA_PORT", "3120"))
SNAPSHOT_INTERVAL = max(5, int(os.getenv("LB_SNAPSHOT_INTERVAL_SEC", "15")))
SNAPSHOT_FILE = os.getenv("LB_SNAPSHOT_FILE", "")
HISTORY_FILE = os.getenv(
    "LB_HISTORY_FILE",
    "/opt/labetaillere-data-v4/state/history.json",
)
HISTORY_MAX = max(100, int(os.getenv("LB_HISTORY_MAX_TRAINS", "5000")))
STATS_BASE = os.getenv("LB_STATS_BASE", "http://127.0.0.1:3099").rstrip("/")
TIMEOUT = float(os.getenv("LB_SOURCE_TIMEOUT_SEC", "7"))

SOURCES = {
    "sncfRt": os.getenv("LB_SOURCE_SNCF_RT", ""),
    "cflRt": os.getenv("LB_SOURCE_CFL_RT", ""),
    "cflArrivals": os.getenv("LB_SOURCE_CFL_ARRIVALS", ""),
    "traffic": os.getenv("LB_SOURCE_TRAFFIC", ""),
    "compositions": os.getenv("LB_SOURCE_COMPOSITIONS", ""),
}

SOURCE_TTLS = {
    "sncfRt": max(60, int(os.getenv("LB_TTL_SNCF_RT_SEC", "600"))),
    "cflRt": max(60, int(os.getenv("LB_TTL_CFL_RT_SEC", "600"))),
    "cflArrivals": max(60, int(os.getenv("LB_TTL_CFL_ARRIVALS_SEC", "600"))),
    "traffic": max(60, int(os.getenv("LB_TTL_TRAFFIC_SEC", "1800"))),
    "compositions": max(300, int(os.getenv("LB_TTL_COMPOSITIONS_SEC", "86400"))),
}

ALIAS_GROUPS = [
    ["2870", "2871"], ["2864", "2865"], ["2806", "2807"], ["2872", "2873"], ["2816", "2817"],
    ["88504", "88505"], ["88502", "88503"], ["88500", "88501"], ["88529", "88530"], ["88531", "88530"],
    ["88533", "88532"], ["88535", "88534"], ["88520", "88521"], ["88522", "88523"], ["88524", "88525"],
    ["88526", "88527"], ["88528", "88529"], ["88510", "88511"],
]

ADJ = {}


def norm_train(value):
    matches = re.findall(r"\d{3,6}", str(value or ""))
    if not matches:
        return ""
    value = sorted(matches, key=lambda x: (-len(x), x))[0]
    return value.lstrip("0") or "0"


for group in ALIAS_GROUPS:
    vals = [norm_train(x) for x in group if norm_train(x)]
    for a in vals:
        ADJ.setdefault(a, set()).update(v for v in vals if v != a)


def aliases_for(number):
    root = norm_train(number)
    if not root:
        return []
    seen, stack = {root}, [root]
    while stack:
        cur = stack.pop()
        for nxt in ADJ.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return [root] + sorted(seen - {root})


def canonical_station(name):
    s = str(name or "").strip().lower()
    repl = {
        "é": "e", "è": "e", "ê": "e", "ë": "e",
        "à": "a", "â": "a", "ä": "a",
        "î": "i", "ï": "i",
        "ô": "o", "ö": "o",
        "ü": "u", "ù": "u", "û": "u",
        "ç": "c",
        "’": "'", "–": "-", "—": "-",
    }
    for a, b in repl.items():
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


DEFAULT_STATION_AUTHORITIES = {
    "nancy": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "pont-a-mousson": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "pagny-sur-moselle": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "metz": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "metz ville": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "hagondange": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "uckange": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "thionville": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "hettange-grande": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "hettange grande": {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"},
    "bettembourg": {"country": "LU", "network": "CFL", "realtimeAuthority": "cfl"},
    "howald": {"country": "LU", "network": "CFL", "realtimeAuthority": "cfl"},
    "luxembourg": {"country": "LU", "network": "CFL", "realtimeAuthority": "cfl"},
}


def load_station_authorities():
    out = copy.deepcopy(DEFAULT_STATION_AUTHORITIES)
    raw = os.getenv("LB_STATION_AUTHORITIES_JSON", "").strip()
    if not raw:
        return out
    try:
        extra = json.loads(raw)
    except Exception:
        return out
    if isinstance(extra, dict):
        for key, value in extra.items():
            if isinstance(value, dict):
                out[canonical_station(key)] = dict(value)
    return out


STATION_AUTHORITIES = load_station_authorities()


def station_policy(name, source_hint=None):
    key = canonical_station(name)
    policy = STATION_AUTHORITIES.get(key)
    if policy:
        return {
            "country": policy.get("country"),
            "network": policy.get("network"),
            "realtimeAuthority": policy.get("realtimeAuthority"),
        }
    if source_hint == "cfl":
        return {"country": "LU", "network": "CFL", "realtimeAuthority": "cfl"}
    if source_hint == "sncf":
        return {"country": "FR", "network": "SNCF", "realtimeAuthority": "sncf"}
    return {"country": None, "network": None, "realtimeAuthority": None}


def read_json(target):
    if not target:
        raise RuntimeError("source non configurée")
    if re.match(r"^https?://", target):
        req = urllib.request.Request(
            target,
            headers={"Accept": "application/json", "User-Agent": "labetaillere-data-v4/2.0"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    path = Path(target)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def safe_num(value):
    try:
        if value is None or isinstance(value, bool):
            return None
        x = float(value)
        if x != x or x in (float("inf"), float("-inf")):
            return None
        return x
    except (TypeError, ValueError):
        return None


def parse_iso_ts(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        x = float(value)
        if x > 10_000_000_000:
            x /= 1000.0
        return x
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return parse_iso_ts(float(text))
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


TIMESTAMP_KEYS = (
    "generated_at", "generatedAt", "updated_at", "updatedAt",
    "last_updated", "lastUpdated", "timestamp", "feed_timestamp",
)


def payload_timestamp(payload):
    if not isinstance(payload, dict):
        return None
    for key in TIMESTAMP_KEYS:
        ts = parse_iso_ts(payload.get(key))
        if ts:
            return ts
    for wrapper in ("meta", "header", "data"):
        child = payload.get(wrapper)
        if isinstance(child, dict):
            for key in TIMESTAMP_KEYS:
                ts = parse_iso_ts(child.get(key))
                if ts:
                    return ts
    return None


def iso_utc(ts=None):
    ts = time.time() if ts is None else float(ts)
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_freshness(name, payload, read_at=None):
    read_at = time.time() if read_at is None else float(read_at)
    observed = payload_timestamp(payload)
    if observed is None:
        observed = read_at
    age = max(0.0, read_at - observed)
    ttl = SOURCE_TTLS.get(name, 600)
    return {
        "observedAt": iso_utc(observed),
        "ageSec": round(age, 3),
        "ttlSec": ttl,
        "stale": age > ttl,
    }


def parse_delay(value):
    if value is None:
        return {"cancelled": False, "minutes": None, "known": False}
    if isinstance(value, bool):
        return {"cancelled": False, "minutes": None, "known": False}
    if isinstance(value, (int, float)):
        x = safe_num(value)
        return {"cancelled": False, "minutes": x, "known": x is not None}
    if isinstance(value, str):
        txt = value.strip()
        if not txt:
            return {"cancelled": False, "minutes": None, "known": False}
        if re.search(r"\b(cancel(?:led|ed)?|suppr(?:ime|imé|ession)?|annul(?:e|é|ation)?|deleted|removed)\b", txt, re.I):
            return {"cancelled": True, "minutes": None, "known": True}
        m = re.search(r"[-+]?\d+(?:[.,]\d+)?", txt)
        return {
            "cancelled": False,
            "minutes": float(m.group(0).replace(",", ".")) if m else None,
            "known": bool(m),
        }
    if isinstance(value, (list, tuple)):
        cancelled = False
        best = None
        known = False
        for item in value:
            p = parse_delay(item)
            known = known or p["known"]
            cancelled = cancelled or p["cancelled"]
            if p["minutes"] is not None and (best is None or abs(p["minutes"]) > abs(best)):
                best = p["minutes"]
        return {"cancelled": cancelled, "minutes": best, "known": known}
    if isinstance(value, dict):
        status = (
            value.get("status") or value.get("state") or value.get("rtStatus")
            or value.get("rtState") or value.get("note")
        )
        cancelled = bool(
            status and re.search(r"cancel|suppr|annul|delete|removed", str(status), re.I)
        )
        best = None
        known = cancelled
        for key in (
            "delay", "minutes", "value", "rtDelay", "delayMinutes", "min",
            "rt", "realtime", "rtMinutes", "arrival_delay", "departure_delay",
            "delaySec", "delay_seconds",
        ):
            if key not in value:
                continue
            p = parse_delay(value.get(key))
            known = known or p["known"]
            cancelled = cancelled or p["cancelled"]
            val = p["minutes"]
            if key in ("delaySec", "delay_seconds") and val is not None:
                val /= 60.0
            if val is not None and (best is None or abs(val) > abs(best)):
                best = val
        return {"cancelled": cancelled, "minutes": best, "known": known}
    return {"cancelled": False, "minutes": None, "known": False}


def normalize_platform(value):
    if value is None:
        return None
    s = re.sub(r"^(voie|track)\s*", "", str(value).strip(), flags=re.I)
    if not s or re.match(r"^(?:n/?a|nc|null|undefined|-+)$", s, re.I):
        return None
    return s


def station_name_from_entry(entry):
    if not isinstance(entry, dict):
        return ""
    return str(
        entry.get("station") or entry.get("stop") or entry.get("stop_name")
        or entry.get("name") or entry.get("label") or entry.get("gare") or ""
    ).strip()


def pick(entry, *keys):
    if not isinstance(entry, dict):
        return None
    for key in keys:
        if entry.get(key) not in (None, ""):
            return entry.get(key)
    return None


def normalize_time_text(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def parse_cfl(payload):
    root = payload
    if isinstance(payload, dict):
        for key in ("data", "trains", "journeys"):
            val = payload.get(key)
            if isinstance(val, dict):
                root = val
                break
    out = {}
    if not isinstance(root, dict):
        return out

    for label, raw in root.items():
        num = norm_train(label)
        if isinstance(raw, dict):
            num = norm_train(raw.get("train") or raw.get("train_number") or raw.get("number") or label)
        if not num:
            continue
        stations = []
        entries = raw if isinstance(raw, list) else list(raw.items()) if isinstance(raw, dict) else []
        if isinstance(raw, list):
            iterable = []
            for entry in entries:
                if isinstance(entry, (list, tuple)) and entry:
                    name = str(entry[0])
                    value = entry[1] if len(entry) > 1 else None
                    meta = value if isinstance(value, dict) else {}
                elif isinstance(entry, dict):
                    name = station_name_from_entry(entry)
                    value = pick(entry, "delay", "minutes", "value", "rtDelay", "delayMinutes", "min", "rt", "realtime")
                    if value is None:
                        value = entry
                    meta = entry
                else:
                    continue
                iterable.append((name, value, meta))
        else:
            iterable = []
            for name, value in entries:
                if name in (
                    "train", "train_number", "number", "status", "updatedAt",
                    "updated_at", "generatedAt", "generated_at", "timestamp",
                ):
                    continue
                iterable.append((str(name), value, value if isinstance(value, dict) else {}))

        for name, value, meta in iterable:
            if not name:
                continue
            p = parse_delay(value)
            stations.append({
                "name": name,
                "delayMinutes": p["minutes"],
                "cancelled": p["cancelled"],
                "known": p["known"],
                "platform": normalize_platform(pick(meta, "platform", "voie", "track", "quai")),
                "arrivalPlanned": normalize_time_text(pick(meta, "arrivalPlanned", "plannedArrival", "arrival_planned")),
                "arrivalRealtime": normalize_time_text(pick(meta, "arrivalRealtime", "realtimeArrival", "arrival_realtime")),
                "departurePlanned": normalize_time_text(pick(meta, "departurePlanned", "plannedDeparture", "departure_planned")),
                "departureRealtime": normalize_time_text(pick(meta, "departureRealtime", "realtimeDeparture", "departure_realtime")),
            })
        if stations:
            out.setdefault(num, []).extend(stations)
    return out


def parse_arrivals(payload):
    root = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
    out = {}
    if not isinstance(root, dict):
        return out
    for label, raw in root.items():
        if not isinstance(raw, dict):
            continue
        num = norm_train(raw.get("train") or raw.get("train_number") or raw.get("number") or label)
        if not num:
            continue
        platform = normalize_platform(
            raw.get("arrivalPlatformRealtime")
            or raw.get("arrivalPlatformPlanned")
            or raw.get("platform")
            or raw.get("track")
        )
        out.setdefault(num, []).append({
            "platform": platform,
            "arrivalPlanned": normalize_time_text(raw.get("arrivalPlanned")),
            "arrivalRealtime": normalize_time_text(raw.get("arrivalRealtime")),
        })
    return out


def flatten_compositions(payload):
    out = {}
    if not isinstance(payload, dict):
        return out
    for group in payload.values():
        if not isinstance(group, dict):
            continue
        for n, code in group.items():
            num = norm_train(n)
            if num and code:
                out[num] = str(code)
    return out


def normalize_traffic(payload):
    if isinstance(payload, dict) and isinstance(payload.get("situations"), list):
        items = payload["situations"]
    elif isinstance(payload, dict) and isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("situations"), list):
        items = payload["data"]["situations"]
    elif isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = [v for v in payload.values() if isinstance(v, dict)]
    else:
        items = []
    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        out.append({
            "id": str(item.get("situation_number") or item.get("id") or f"traffic-{i}"),
            "summary": str(item.get("summary") or item.get("title") or ""),
            "description": str(item.get("detail") or item.get("description") or ""),
            "participant": item.get("participant_ref"),
            "scope": item.get("scope_type"),
            "validity": item.get("validity_periods") if isinstance(item.get("validity_periods"), list) else [],
            "affects": item.get("affects") if isinstance(item.get("affects"), list) else [],
        })
    return out


def lookup_alias(index, number):
    exact = norm_train(number)
    if exact in index:
        return exact, index[exact]
    for alias in aliases_for(exact)[1:]:
        if alias in index:
            return alias, index[alias]
    return None, None


def cfl_by_station(stations):
    return {canonical_station(x.get("name")): x for x in stations if x.get("name")}


def sncf_stop_entries(raw):
    rich = raw.get("_canonicalStops") or raw.get("canonicalStops")
    if isinstance(rich, list):
        return [x for x in rich if isinstance(x, dict) and station_name_from_entry(x)]

    source = raw.get("stops")
    out = []
    if isinstance(source, dict):
        for name, value in source.items():
            meta = value if isinstance(value, dict) else {}
            p = parse_delay(value)
            out.append({
                "name": str(name),
                "delayMinutes": p["minutes"],
                "cancelled": p["cancelled"],
                "known": p["known"],
                "platform": normalize_platform(pick(meta, "platform", "voie", "track", "quai")),
                "arrivalPlanned": normalize_time_text(pick(meta, "arrivalPlanned", "plannedArrival", "arrival_planned")),
                "arrivalRealtime": normalize_time_text(pick(meta, "arrivalRealtime", "realtimeArrival", "arrival_realtime")),
                "departurePlanned": normalize_time_text(pick(meta, "departurePlanned", "plannedDeparture", "departure_planned")),
                "departureRealtime": normalize_time_text(pick(meta, "departureRealtime", "realtimeDeparture", "departure_realtime")),
            })
    elif isinstance(source, list):
        for entry in source:
            if not isinstance(entry, dict):
                continue
            name = station_name_from_entry(entry)
            if not name:
                continue
            p = parse_delay(entry)
            out.append({
                "name": name,
                "delayMinutes": p["minutes"],
                "cancelled": p["cancelled"],
                "known": p["known"],
                "platform": normalize_platform(pick(entry, "platform", "voie", "track", "quai")),
                "arrivalPlanned": normalize_time_text(pick(entry, "arrivalPlanned", "plannedArrival", "arrival_planned")),
                "arrivalRealtime": normalize_time_text(pick(entry, "arrivalRealtime", "realtimeArrival", "arrival_realtime")),
                "departurePlanned": normalize_time_text(pick(entry, "departurePlanned", "plannedDeparture", "departure_planned")),
                "departureRealtime": normalize_time_text(pick(entry, "departureRealtime", "realtimeDeparture", "departure_realtime")),
            })
    return out


def field(value=None, source=None, authority=None, quality=None, observed_at=None, fresh=None):
    return {
        "value": value,
        "source": source,
        "authority": authority,
        "quality": quality,
        "observedAt": observed_at,
        "fresh": fresh,
    }


def source_meta_by_name(source_meta):
    return {
        x.get("name"): x
        for x in (source_meta or [])
        if isinstance(x, dict) and x.get("name")
    }


def source_state(source_meta, name):
    meta = source_meta_by_name(source_meta).get(name, {})
    return meta.get("observedAt"), not bool(meta.get("stale"))


def choose_stop_realtime(name, sncf_stop, cfl_stop, source_meta):
    policy = station_policy(name, "sncf" if sncf_stop else "cfl" if cfl_stop else None)
    authority = policy.get("realtimeAuthority")

    sncf_observed, sncf_fresh = source_state(source_meta, "sncfRt")
    cfl_observed, cfl_fresh = source_state(source_meta, "cflRt")

    sncf_known = bool(sncf_stop and (sncf_stop.get("known") or sncf_stop.get("cancelled")))
    cfl_known = bool(cfl_stop and (cfl_stop.get("known") or cfl_stop.get("cancelled")))

    if authority == "sncf":
        if sncf_known:
            return sncf_stop, "SNCF_GTFS_RT", "SNCF", "realtime", sncf_observed, sncf_fresh
        return None, None, "SNCF", "unknown", sncf_observed, sncf_fresh

    if authority == "cfl":
        if cfl_known:
            return cfl_stop, "CFL_HAFAS", "CFL", "realtime", cfl_observed, cfl_fresh
        if sncf_known:
            return sncf_stop, "SNCF_GTFS_RT", "CFL", "fallback_official", sncf_observed, sncf_fresh
        return None, None, "CFL", "unknown", cfl_observed, cfl_fresh

    if sncf_known:
        return sncf_stop, "SNCF_GTFS_RT", None, "realtime", sncf_observed, sncf_fresh
    if cfl_known:
        return cfl_stop, "CFL_HAFAS", None, "realtime", cfl_observed, cfl_fresh
    return None, None, None, "unknown", None, None


def normalize_status_token(value):
    return str(value or "").upper().replace("-", "_").replace(" ", "_")


def raw_status_flags(raw):
    txt = normalize_status_token(raw)
    full = bool(re.search(r"(?:^|_)(CANCELLED|CANCELED|DELETED|SUPPRIME|SUPPRIMEE|ANNULE|ANNULEE)(?:_|$)", txt))
    partial = bool(re.search(r"PARTIAL|PARTIEL|PARTIELLE|REDUCED", txt))
    return full, partial


def status_from(raw_status, stops):
    full_raw, partial_raw = raw_status_flags(raw_status)
    cancelled_count = sum(1 for s in stops if s.get("cancelled") is True)
    served_or_known = sum(
        1 for s in stops
        if s.get("cancelled") is False and (
            s.get("realtimeKnown") or s.get("delayMinutes") is not None
        )
    )

    if full_raw or (stops and cancelled_count == len(stops)):
        return "cancelled"
    if partial_raw or (cancelled_count > 0 and served_or_known > 0):
        return "partial"
    if any((s.get("delayMinutes") or 0) > 0 for s in stops):
        return "delay"
    if any(s.get("realtimeKnown") for s in stops):
        return "on-time"
    return "unknown"


def make_canonical_stop(name, sncf_stop, cfl_stop, arrivals, source_meta):
    policy = station_policy(name, "sncf" if sncf_stop else "cfl" if cfl_stop else None)
    selected, source, authority, quality, observed_at, fresh = choose_stop_realtime(
        name, sncf_stop, cfl_stop, source_meta
    )

    delay = selected.get("delayMinutes") if selected else None
    cancelled = bool(selected.get("cancelled")) if selected else False
    known = bool(selected and (selected.get("known") or cancelled))

    planned_arrival = (
        (selected or {}).get("arrivalPlanned")
        or (sncf_stop or {}).get("arrivalPlanned")
        or (cfl_stop or {}).get("arrivalPlanned")
    )
    realtime_arrival = (
        (selected or {}).get("arrivalRealtime")
        or (sncf_stop or {}).get("arrivalRealtime")
        or (cfl_stop or {}).get("arrivalRealtime")
    )
    planned_departure = (
        (selected or {}).get("departurePlanned")
        or (sncf_stop or {}).get("departurePlanned")
        or (cfl_stop or {}).get("departurePlanned")
    )
    realtime_departure = (
        (selected or {}).get("departureRealtime")
        or (sncf_stop or {}).get("departureRealtime")
        or (cfl_stop or {}).get("departureRealtime")
    )

    platform_value = None
    platform_source = None
    platform_quality = None
    platform_observed = None
    platform_fresh = None

    if policy.get("network") == "CFL" and canonical_station(name) == "luxembourg" and arrivals:
        arr = arrivals[0] if arrivals else None
        if arr and arr.get("platform"):
            platform_value = arr.get("platform")
            platform_source = "CFL_ARRIVALS"
            platform_quality = "realtime"
            platform_observed, platform_fresh = source_state(source_meta, "cflArrivals")
            planned_arrival = arr.get("arrivalPlanned") or planned_arrival
            realtime_arrival = arr.get("arrivalRealtime") or realtime_arrival

    if platform_value is None and cfl_stop and cfl_stop.get("platform") and policy.get("network") == "CFL":
        platform_value = cfl_stop.get("platform")
        platform_source = "CFL_HAFAS"
        platform_quality = "realtime"
        platform_observed, platform_fresh = source_state(source_meta, "cflRt")
    if platform_value is None and sncf_stop and sncf_stop.get("platform"):
        platform_value = sncf_stop.get("platform")
        platform_source = "SNCF_GTFS_RT"
        platform_quality = "realtime"
        platform_observed, platform_fresh = source_state(source_meta, "sncfRt")

    delay_obj = field(delay, source, authority, quality, observed_at, fresh)
    arrival_obj = {
        "planned": planned_arrival,
        "realtime": realtime_arrival,
        "delayMinutes": delay,
        "status": "cancelled" if cancelled else "served" if known else "unknown",
        "source": source,
        "authority": authority,
        "quality": quality,
        "observedAt": observed_at,
        "fresh": fresh,
    }
    departure_obj = {
        "planned": planned_departure,
        "realtime": realtime_departure,
        "delayMinutes": delay,
        "status": "cancelled" if cancelled else "served" if known else "unknown",
        "source": source,
        "authority": authority,
        "quality": quality,
        "observedAt": observed_at,
        "fresh": fresh,
    }
    platform_obj = field(
        platform_value, platform_source, policy.get("network"),
        platform_quality, platform_observed, platform_fresh,
    )

    legacy_source = (
        "CFL/HAFAS" if source == "CFL_HAFAS"
        else "SNCF" if source == "SNCF_GTFS_RT"
        else None
    )

    return {
        "name": str(name),
        "stationKey": canonical_station(name),
        "country": policy.get("country"),
        "network": policy.get("network"),
        "realtimeAuthority": authority,
        "delayMinutes": delay,
        "delay": delay_obj,
        "cancelled": cancelled,
        "realtimeKnown": known,
        "platform": platform_value,
        "platformInfo": platform_obj,
        "arrival": arrival_obj,
        "departure": departure_obj,
        "delaySource": legacy_source,
        "sourceQuality": quality,
    }


def service_date_from_raw(raw):
    for key in ("service_date", "serviceDate", "date"):
        value = raw.get(key) if isinstance(raw, dict) else None
        if value:
            m = re.search(r"(20\d{2})[-/]?(\d{2})[-/]?(\d{2})", str(value))
            if m:
                return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    raw_id = str((raw or {}).get("train_id") or (raw or {}).get("trip_id") or "")
    matches = re.findall(r"20\d{6}", raw_id)
    if matches:
        token = matches[-1]
        return f"{token[:4]}-{token[4:6]}-{token[6:8]}"
    return None


def build_train_from_sncf(num, raw, cfl_idx, arr_idx, comps, source_meta):
    sncf_stops = sncf_stop_entries(raw)
    cfl_match, cfl_stations = lookup_alias(cfl_idx, num)
    arr_match, arrivals = lookup_alias(arr_idx, num)
    cfl_map = cfl_by_station(cfl_stations or [])
    seen = set()
    stops = []

    for sncf_stop in sncf_stops:
        name = sncf_stop.get("name")
        if not name:
            continue
        key = canonical_station(name)
        seen.add(key)
        stops.append(make_canonical_stop(
            name, sncf_stop, cfl_map.get(key), arrivals if key == "luxembourg" else None, source_meta
        ))

    for cfl_stop in cfl_stations or []:
        name = cfl_stop.get("name")
        key = canonical_station(name)
        if not name or key in seen:
            continue
        if station_policy(name, "cfl").get("network") != "CFL":
            continue
        stops.append(make_canonical_stop(name, None, cfl_stop, arrivals if key == "luxembourg" else None, source_meta))
        seen.add(key)

    status = status_from(raw.get("status"), stops)
    numeric_delays = [s["delayMinutes"] for s in stops if s.get("delayMinutes") is not None]
    max_delay = max([0.0] + [float(x) for x in numeric_delays])
    comp = comps.get(num)
    service_date = service_date_from_raw(raw)

    sncf_meta = source_meta_by_name(source_meta).get("sncfRt", {})
    realtime_presence = True
    realtime_fresh = bool(sncf_meta.get("ok")) and not bool(sncf_meta.get("stale"))

    return {
        "id": raw.get("train_id") or raw.get("trip_id") or f"{num}:{service_date or 'current'}",
        "number": num,
        "serviceDate": service_date,
        "operator": "SNCF",
        "line": raw.get("line") or "L90",
        "origin": {"name": stops[0]["name"]} if stops else None,
        "destination": {
            "name": stops[-1]["name"],
            "platform": stops[-1].get("platform"),
        } if stops else None,
        "status": status,
        "delayMinutes": max_delay,
        "cancelled": status == "cancelled",
        "partial": status == "partial",
        "live": bool(raw.get("live")),
        "lifecycle": "cancelled" if status == "cancelled" else "realtime",
        "realtimePresence": realtime_presence,
        "realtimePresenceFresh": realtime_fresh,
        "position": raw.get("position"),
        "composition": {
            "code": comp,
            "source": "labetaillere-composition",
            "confidence": "estimated",
        } if comp else None,
        "occupancy": raw.get("occupancy") if isinstance(raw.get("occupancy"), dict) else None,
        "stops": stops,
        "disruptions": raw.get("disruptions") if isinstance(raw.get("disruptions"), list) else [],
        "provenance": [
            {
                "source": "sncf-gtfs-rt",
                "role": "circulation-base",
                "stale": bool(sncf_meta.get("stale")),
                "observedAt": sncf_meta.get("observedAt"),
            },
            *([{
                "source": "cfl-hafas",
                "role": "territorial-enrichment",
                "matchedTrain": cfl_match,
                "alias": cfl_match != num,
                "stale": bool(source_meta_by_name(source_meta).get("cflRt", {}).get("stale")),
            }] if cfl_match else []),
            *([{
                "source": "cfl-arrivals",
                "role": "platform",
                "matchedTrain": arr_match,
                "alias": arr_match != num,
                "stale": bool(source_meta_by_name(source_meta).get("cflArrivals", {}).get("stale")),
            }] if arr_match else []),
            *([{
                "source": "labetaillere-composition",
                "role": "composition",
                "stale": bool(source_meta_by_name(source_meta).get("compositions", {}).get("stale")),
            }] if comp else []),
        ],
        "updatedAt": iso_utc(),
    }


def build_train_from_cfl(num, stations, arr_idx, comps, source_meta):
    arr_match, arrivals = lookup_alias(arr_idx, num)
    stops = []
    for cfl_stop in stations or []:
        name = cfl_stop.get("name")
        if not name:
            continue
        stops.append(make_canonical_stop(
            name, None, cfl_stop,
            arrivals if canonical_station(name) == "luxembourg" else None,
            source_meta,
        ))
    status = status_from(None, stops)
    numeric_delays = [s["delayMinutes"] for s in stops if s.get("delayMinutes") is not None]
    max_delay = max([0.0] + [float(x) for x in numeric_delays])
    comp = comps.get(num)
    cfl_meta = source_meta_by_name(source_meta).get("cflRt", {})
    return {
        "id": f"CFL:{num}:current",
        "number": num,
        "serviceDate": None,
        "operator": "CFL",
        "line": None,
        "origin": {"name": stops[0]["name"]} if stops else None,
        "destination": {
            "name": stops[-1]["name"],
            "platform": stops[-1].get("platform"),
        } if stops else None,
        "status": status,
        "delayMinutes": max_delay,
        "cancelled": status == "cancelled",
        "partial": status == "partial",
        "live": False,
        "lifecycle": "realtime",
        "realtimePresence": True,
        "realtimePresenceFresh": bool(cfl_meta.get("ok")) and not bool(cfl_meta.get("stale")),
        "position": None,
        "composition": {
            "code": comp,
            "source": "labetaillere-composition",
            "confidence": "estimated",
        } if comp else None,
        "occupancy": None,
        "stops": stops,
        "disruptions": [],
        "provenance": [{
            "source": "cfl-hafas",
            "role": "circulation-base",
            "stale": bool(cfl_meta.get("stale")),
            "observedAt": cfl_meta.get("observedAt"),
        }],
        "updatedAt": iso_utc(),
    }


def build_snapshot_from_payloads(payloads, source_meta=None):
    sncf = payloads.get("sncfRt") or {}
    cfl_idx = parse_cfl(payloads.get("cflRt") or {})
    arr_idx = parse_arrivals(payloads.get("cflArrivals") or {})
    comps = flatten_compositions(payloads.get("compositions") or {})
    traffic = normalize_traffic(payloads.get("traffic") or {})
    now = iso_utc()
    source_meta = source_meta or []
    trains = []
    matched_cfl = set()

    if isinstance(sncf, dict):
        for key, raw in sncf.items():
            if not isinstance(raw, dict):
                continue
            num = norm_train(raw.get("train_number") or raw.get("train") or raw.get("number") or key)
            if not num:
                continue
            cfl_match, _ = lookup_alias(cfl_idx, num)
            if cfl_match:
                matched_cfl.add(cfl_match)
            train = build_train_from_sncf(num, raw, cfl_idx, arr_idx, comps, source_meta)
            if train.get("stops"):
                trains.append(train)

    for cfl_num, stations in cfl_idx.items():
        if cfl_num in matched_cfl:
            continue
        if any(alias in matched_cfl for alias in aliases_for(cfl_num)):
            continue
        train = build_train_from_cfl(cfl_num, stations, arr_idx, comps, source_meta)
        if train.get("stops"):
            trains.append(train)

    stale = any(
        x.get("stale")
        for x in source_meta
        if isinstance(x, dict) and x.get("name") in ("sncfRt", "cflRt")
    )
    return {
        "apiVersion": 4,
        "schemaVersion": "4.1-canonical",
        "updatedAt": now,
        "stale": bool(stale),
        "sources": source_meta,
        "trains": trains,
        "traffic": traffic,
        "meta": {
            "trainCount": len(trains),
            "delayedCount": sum(1 for t in trains if t["status"] == "delay"),
            "cancelledCount": sum(1 for t in trains if t["status"] == "cancelled"),
            "partialCount": sum(1 for t in trains if t["status"] == "partial"),
            "liveCount": sum(1 for t in trains if t.get("realtimePresence") and t.get("realtimePresenceFresh")),
            "cflTrainCount": len(cfl_idx),
            "arrivalTrainCount": len(arr_idx),
            "compositionCount": len(comps),
        },
    }


_lock = threading.Lock()
_snapshot = None
_last_error = None
_source_cache = {}
_history = {}


def load_history():
    global _history
    path = Path(HISTORY_FILE)
    try:
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                _history = raw
    except Exception as exc:
        print(f"[data-v4] historique illisible: {exc}", file=sys.stderr)


def write_history():
    if not HISTORY_FILE:
        return
    path = Path(HISTORY_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    items = sorted(
        _history.items(),
        key=lambda kv: str((kv[1] or {}).get("lastSeenAt") or ""),
        reverse=True,
    )[:HISTORY_MAX]
    data = dict(items)
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def history_key(train):
    return str(train.get("id") or f"{train.get('number')}:{train.get('serviceDate') or 'unknown'}")


def update_history(previous_snapshot, current_snapshot):
    now = iso_utc()
    current_ids = set()
    for train in current_snapshot.get("trains", []):
        key = history_key(train)
        current_ids.add(key)
        old = _history.get(key) or {}
        _history[key] = {
            "number": train.get("number"),
            "serviceDate": train.get("serviceDate"),
            "firstSeenAt": old.get("firstSeenAt") or now,
            "lastSeenAt": now,
            "completedAt": None,
            "lastObservation": train,
        }

    if previous_snapshot:
        for train in previous_snapshot.get("trains", []):
            key = history_key(train)
            if key in current_ids:
                continue
            old = _history.get(key) or {}
            if old:
                old["completedAt"] = old.get("completedAt") or now
                last = old.get("lastObservation")
                if isinstance(last, dict):
                    last = copy.deepcopy(last)
                    last["lifecycle"] = "completed"
                    last["realtimePresence"] = False
                    old["lastObservation"] = last
                _history[key] = old
    try:
        write_history()
    except Exception as exc:
        print(f"[data-v4] historique écriture: {exc}", file=sys.stderr)


def build_snapshot():
    payloads = {}
    meta = []
    for name, target in SOURCES.items():
        started = time.time()
        read_at = time.time()
        try:
            data = read_json(target)
            freshness = source_freshness(name, data, read_at)
            payloads[name] = data
            _source_cache[name] = {"data": data, "readAt": read_at}
            meta.append({
                "name": name,
                "ok": True,
                "target": target,
                "readMs": round((time.time() - started) * 1000),
                **freshness,
            })
        except Exception as exc:
            cached = _source_cache.get(name)
            if cached:
                data = cached["data"]
                payloads[name] = data
                freshness = source_freshness(name, data, read_at)
                meta.append({
                    "name": name,
                    "ok": False,
                    "stale": True,
                    "reusedLastGood": True,
                    "target": target,
                    "error": str(exc),
                    "readMs": round((time.time() - started) * 1000),
                    **{k: v for k, v in freshness.items() if k != "stale"},
                })
            else:
                payloads[name] = {}
                meta.append({
                    "name": name,
                    "ok": False,
                    "stale": True,
                    "reusedLastGood": False,
                    "target": target,
                    "error": str(exc),
                    "readMs": round((time.time() - started) * 1000),
                    "observedAt": None,
                    "ageSec": None,
                    "ttlSec": SOURCE_TTLS.get(name),
                })

    snap = build_snapshot_from_payloads(payloads, meta)
    snap["buildMs"] = sum(int(x.get("readMs", 0)) for x in meta)
    return snap


def write_snapshot(snapshot):
    if not SNAPSHOT_FILE:
        return
    path = Path(SNAPSHOT_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def commit_snapshot(snap):
    global _snapshot, _last_error
    with _lock:
        previous = _snapshot
        _snapshot = snap
        _last_error = None
    update_history(previous, snap)
    write_snapshot(snap)


def refresh_loop():
    global _last_error
    while True:
        try:
            snap = build_snapshot()
            commit_snapshot(snap)
        except Exception as exc:
            with _lock:
                _last_error = str(exc)
        time.sleep(SNAPSHOT_INTERVAL)


def get_snapshot(force=False):
    global _snapshot, _last_error
    if force or _snapshot is None:
        try:
            snap = build_snapshot()
            commit_snapshot(snap)
        except Exception as exc:
            with _lock:
                _last_error = str(exc)
    with _lock:
        return _snapshot, _last_error


def history_for_number(number):
    num = norm_train(number)
    rows = []
    for item in _history.values():
        if norm_train(item.get("number")) == num:
            rows.append(item)
    rows.sort(key=lambda x: str(x.get("lastSeenAt") or ""), reverse=True)
    return rows


def stats_proxy(path, query):
    mapping = {
        "overview": "/beta/overview", "daily": "/beta/daily", "causes": "/beta/causes",
        "hourly": "/beta/hourly", "compare": "/beta/compare", "train": "/gtfs/train",
        "day": "/gtfs/day",
    }
    endpoint = mapping.get(path)
    if not endpoint:
        raise RuntimeError("stats endpoint inconnu")
    return read_json(STATS_BASE + endpoint + ("?" + query if query else ""))


class Handler(BaseHTTPRequestHandler):
    server_version = "LBDataV4/2.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[data-v4] " + fmt % args + "\n")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            snap, err = get_snapshot()
            if path == "/api/v4/health":
                sources = (snap or {}).get("sources", [])
                critical = [x for x in sources if x.get("name") in ("sncfRt", "cflRt")]
                ok = bool(snap and snap.get("trains"))
                degraded = any((not x.get("ok")) or x.get("stale") for x in critical)
                self.send_json(200 if ok else 503, {
                    "apiVersion": 4,
                    "schemaVersion": (snap or {}).get("schemaVersion"),
                    "status": "degraded" if ok and degraded else "ok" if ok else "down",
                    "trainCount": len((snap or {}).get("trains", [])),
                    "updatedAt": (snap or {}).get("updatedAt"),
                    "snapshotFile": SNAPSHOT_FILE or None,
                    "historyFile": HISTORY_FILE or None,
                    "error": err,
                    "sources": sources,
                })
                return
            if path == "/api/v4/snapshot":
                self.send_json(200, snap or {"apiVersion": 4, "trains": [], "error": err})
                return
            if path == "/api/v4/trains":
                self.send_json(200, {
                    "apiVersion": 4,
                    "schemaVersion": snap.get("schemaVersion"),
                    "updatedAt": snap.get("updatedAt"),
                    "trains": snap.get("trains", []),
                })
                return
            if path.startswith("/api/v4/trains/"):
                num = norm_train(path.split("/")[-1])
                train = next((t for t in snap.get("trains", []) if t.get("number") == num), None)
                if train:
                    self.send_json(200, train)
                    return
                history = history_for_number(num)
                if history:
                    payload = copy.deepcopy(history[0].get("lastObservation") or {})
                    payload["_history"] = {
                        k: v for k, v in history[0].items() if k != "lastObservation"
                    }
                    self.send_json(200, payload)
                    return
                self.send_json(404, {"error": "train not found"})
                return
            if path.startswith("/api/v4/history/trains/"):
                num = norm_train(path.split("/")[-1])
                self.send_json(200, {
                    "apiVersion": 4,
                    "number": num,
                    "history": history_for_number(num),
                })
                return
            if path == "/api/v4/traffic":
                self.send_json(200, {
                    "apiVersion": 4,
                    "updatedAt": snap.get("updatedAt"),
                    "traffic": snap.get("traffic", []),
                })
                return
            if path.startswith("/api/v4/stats/"):
                name = path.split("/")[-1]
                self.send_json(200, stats_proxy(name, parsed.query))
                return
            self.send_json(404, {"error": "not found"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


def fixture_self_test():
    payloads = {
        "sncfRt": {
            "88530": {
                "train_id": "x",
                "train_number": "88530",
                "status": "ON_TIME",
                "stops": {
                    "Luxembourg": 10, "Howald": 10, "Bettembourg": 10,
                    "Thionville": 8, "Metz": 8, "Nancy": 7,
                },
            },
            "88742": {
                "train_id": "y",
                "train_number": "88742",
                "status": "ON_TIME",
                "stops": {
                    "Metz": 0, "Hagondange": 0, "Uckange": 0,
                    "Thionville": 0, "Hettange-Grande": 0,
                    "Bettembourg": 0, "Luxembourg": 0,
                },
            },
            "88503": {
                "train_id": "z",
                "train_number": "88503",
                "status": "PARTIAL",
                "stops": {
                    "Nancy": {"status": "cancelled"},
                    "Pont-à-Mousson": {"status": "cancelled"},
                    "Pagny-sur-Moselle": {"status": "cancelled"},
                    "Metz": 0,
                    "Thionville": 0,
                },
            },
        },
        "cflRt": {
            "updatedAt": iso_utc(),
            "data": {
                "88529": {"Luxembourg": {"delay": 12, "platform": "4"}, "Howald": 12, "Bettembourg": 11},
                "88742": {"Bettembourg": 1, "Luxembourg": 2, "Thionville": 99},
                "4600": {"Luxembourg": 3, "Howald": 3, "Bettembourg": 2},
            },
        },
        "cflArrivals": {
            "updatedAt": iso_utc(),
            "data": {
                "TER 88529": {"train": "88529", "arrivalPlatformRealtime": "4"},
                "TER 88742": {"train": "88742", "arrivalPlatformRealtime": "8"},
            },
        },
        "traffic": {"situations": [{"situation_number": "S1", "summary": "Test"}]},
        "compositions": {"NancyMetzLux": {"88742": "US5"}, "LuxMetzNancy": {"88530": "UM"}},
    }
    meta = [
        {"name": "sncfRt", "ok": True, "stale": False, "observedAt": iso_utc()},
        {"name": "cflRt", "ok": True, "stale": False, "observedAt": iso_utc()},
        {"name": "cflArrivals", "ok": True, "stale": False, "observedAt": iso_utc()},
        {"name": "traffic", "ok": True, "stale": False, "observedAt": iso_utc()},
        {"name": "compositions", "ok": True, "stale": False, "observedAt": iso_utc()},
    ]
    snap = build_snapshot_from_payloads(payloads, meta)
    a = next(t for t in snap["trains"] if t["number"] == "88530")
    b = next(t for t in snap["trains"] if t["number"] == "88742")
    p = next(t for t in snap["trains"] if t["number"] == "88503")
    cfl_pure = next(t for t in snap["trains"] if t["number"] == "4600")

    assert next(s for s in a["stops"] if s["name"] == "Luxembourg")["delayMinutes"] == 12
    assert next(s for s in a["stops"] if s["name"] == "Thionville")["delayMinutes"] == 8
    assert next(s for s in b["stops"] if s["name"] == "Thionville")["delayMinutes"] == 0
    assert next(s for s in b["stops"] if s["name"] == "Bettembourg")["delayMinutes"] == 1
    assert next(s for s in b["stops"] if s["name"] == "Luxembourg")["platform"] == "8"
    assert b["composition"]["code"] == "US5"
    assert p["status"] == "partial"
    assert [s["cancelled"] for s in p["stops"][:3]] == [True, True, True]
    assert cfl_pure["operator"] == "CFL"
    assert parse_delay(None) == {"cancelled": False, "minutes": None, "known": False}
    return snap


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--fixture-test", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()

    if args.fixture_test:
        snap = fixture_self_test()
        print(json.dumps({"ok": True, "meta": snap["meta"]}, ensure_ascii=False))
        return

    if args.self_test:
        snap = build_snapshot()
        critical = {"sncfRt", "cflRt", "cflArrivals", "traffic"}
        bad = [s for s in snap["sources"] if s["name"] in critical and (not s.get("ok") or s.get("stale"))]
        ok = not bad and len(snap["trains"]) > 0
        print(json.dumps({"ok": ok, "meta": snap["meta"], "sources": snap["sources"]}, ensure_ascii=False, indent=2))
        raise SystemExit(0 if ok else 2)

    fixture_self_test()
    load_history()
    snap, err = get_snapshot(force=True)
    if not snap or not snap.get("trains"):
        raise SystemExit("Data Engine V4: aucun train au démarrage; refus de servir")
    threading.Thread(target=refresh_loop, daemon=True).start()
    print(
        f'Data Engine V4 canonical listening on http://{HOST}:{PORT} | '
        f'trains={len(snap["trains"])} | snapshot={SNAPSHOT_FILE or "off"}',
        flush=True,
    )
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
