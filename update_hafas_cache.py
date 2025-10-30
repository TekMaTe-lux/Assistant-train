#!/usr/bin/env python3
"""Fetch HAFAS departures and populate the shared cache file.

The resulting JSON snapshot is compatible with the client-side
`deserializeHafasCache` helper so browsers can ingest it without
additional transformations. Run this script from the repository root:

    python update_hafas_cache.py

It will write the aggregated data to ``api/hafas-cache.json`` so the
static hosting can expose a globally shared cache refreshed roughly
once per minute (for example via cron).
"""

from __future__ import annotations

import json
import math
import pathlib
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python <3.9 compatibility
    ZoneInfo = None  # type: ignore

import requests


HAFAS_BASE_URL = "https://cdt.hafas.de/opendata/apiserver/departureBoard"
HAFAS_ACCESS_ID = "58ef9a71-6837-4405-bd5d-23beaf92864c"
HAFAS_LOOKAHEAD_MINUTES = 120
HAFAS_MAX_JOURNEYS = 20
HAFAS_CACHE_FILE = pathlib.Path("api/hafas-cache.json")


@dataclass(frozen=True)
class Station:
    axis_id: str
    hafas_id: str
    label: str
    names: Tuple[str, ...]


LUX_TZ = ZoneInfo("Europe/Luxembourg") if ZoneInfo else None


STATIONS: Tuple[Station, ...] = (
    Station("rodange", "220903011", "Rodange", ("Rodange", "Rodange, Gare")),
    Station("petange", "220902007", "Pétange", ("Pétange", "Petange", "Pétange, Gare")),
    Station(
        "bascharage-sanem",
        "190101027",
        "Bascharage-Sanem",
        ("Bascharage-Sanem", "Bascharage/Sanem", "Bascharage/Sanem, Gare", "Bascharage, Gare"),
    ),
    Station("niederkorn", "220203006", "Niederkorn", ("Niederkorn", "Niederkorn, Gare")),
    Station("differdange", "220201021", "Differdange", ("Differdange", "Differdange, Gare")),
    Station("oberkorn", "220201032", "Oberkorn", ("Oberkorn", "Oberkorn, Gare")),
    Station(
        "belvaux-soleuvre",
        "221301010",
        "Belvaux-Soleuvre",
        ("Belvaux-Soleuvre", "Belvaux Soleuvre", "Belvaux-Soleuvre, Gare"),
    ),
    Station(
        "belval-redange",
        "221301002",
        "Belval-Rédange",
        ("Belval-Rédange", "Belval Redange", "Belval-Rédange, Gare"),
    ),
    Station("belval-lycee", "221301023", "Belval-Lycée", ("Belval-Lycée", "Belval Lycée", "Belval (Lycée), Gare")),
    Station(
        "belval-universite",
        "220401002",
        "Belval-Université",
        ("Belval-Université", "Belval Université", "Belval (Université), Gare"),
    ),
    Station(
        "esch",
        "220402046",
        "Esch-sur-Alzette",
        ("Esch-sur-Alzette", "Esch sur Alzette", "Esch-sur-Alzette, Gare"),
    ),
    Station("schifflange", "221401002", "Schifflange", ("Schifflange", "Schifflange, Gare")),
    Station("noertzange", "220105006", "Noertzange", ("Noertzange", "Noertzange, Gare")),
    Station("berchem", "221101001", "Berchem", ("Berchem", "Berchem, Gare")),
    Station("luxembourg", "200405060", "Luxembourg", ("Luxembourg", "Luxembourg, Gare Centrale")),
    Station("bettembourg", "220102018", "Bettembourg", ("Bettembourg", "Bettembourg, Gare")),
    Station("howald", "200304014", "Howald", ("Howald", "Howald, Gare")),
    Station("thionville", "400000098", "Thionville", ("Thionville", "Thionville, Gare")),
    Station("metz", "400000071", "Metz", ("Metz", "Metz-Ville", "Metz-Ville, Gare")),
)


def normalize_station_name(value: Optional[str]) -> str:
    if value is None:
        return ""
    raw = str(value)
    normalized = unicodedata.normalize("NFD", raw)
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = normalized.replace("\u2019", "'")
    normalized = normalized.lower()
    normalized = " ".join(normalized.split())
    return normalized.strip()


def extract_train_number_candidate(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    probes = []
    if ":" in raw:
        probes.append(raw.split(":", 1)[0])
    probes.append(raw)
    for probe in probes:
        if not probe:
            continue
        match = _match_digits(probe, minimum=4)
        if match:
            return match
    for probe in probes:
        if not probe:
            continue
        match = _match_digits(probe, minimum=3)
        if match:
            return match
    return None


def _match_digits(text: str, minimum: int) -> Optional[str]:
    digits = ""
    for ch in text:
        if ch.isdigit():
            digits += ch
            if len(digits) >= minimum:
                return digits
        else:
            digits = ""
    return None


def normalize_train_number_key(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    trimmed = raw.lstrip("0")
    if trimmed:
        return trimmed
    return "0" if raw else None


def normalize_hafas_date(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return raw


def normalize_hafas_time(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if len(raw) == 6 and raw.isdigit():
        return f"{raw[:2]}:{raw[2:4]}:{raw[4:]}"
    if len(raw) == 4 and raw.isdigit():
        return f"{raw[:2]}:{raw[2:]}:00"
    if len(raw) == 5 and raw.count(":") == 1:
        return f"{raw}:00"
    return raw


def parse_datetime(date_str: Optional[str], time_str: Optional[str]) -> Optional[datetime]:
    if not date_str or not time_str:
        return None
    try:
        dt = datetime.fromisoformat(f"{date_str}T{time_str}")
    except ValueError:
        return None
    if LUX_TZ:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=LUX_TZ)
        else:
            dt = dt.astimezone(LUX_TZ)
    return dt


def compute_hafas_delay(dep: Dict) -> Optional[Dict[str, Optional[float]]]:
    cancel_tokens = [
        dep.get("cancelled"),
        dep.get("status"),
        dep.get("rtStatus"),
        dep.get("rtState"),
    ]
    for token in cancel_tokens:
        if token is None:
            continue
        text = str(token).lower()
        if text in {"true", "yes", "cancelled", "canceled", "deleted"}:
            return {"cancelled": True, "minutes": None}

    planned_date = normalize_hafas_date(dep.get("date"))
    planned_time = normalize_hafas_time(dep.get("time"))
    rt_date = normalize_hafas_date(
        dep.get("rtDate")
        or dep.get("rtDateTime")
        or dep.get("rtDateTimeOut")
        or dep.get("date")
    )
    rt_time = normalize_hafas_time(
        dep.get("rtTime") or dep.get("rtTimeOut") or dep.get("rtDepartureTime")
    )

    if not (planned_date and planned_time and rt_time):
        return None

    scheduled = parse_datetime(planned_date, planned_time)
    realtime = parse_datetime(rt_date or planned_date, rt_time)
    if not (scheduled and realtime):
        return None

    diff_minutes = round((realtime - scheduled).total_seconds() / 60.0)
    return {"cancelled": False, "minutes": int(diff_minutes)}


def fetch_departures(station: Station, date_str: str, time_str: str, duration: int) -> List[Dict]:
    params = {
        "accessId": HAFAS_ACCESS_ID,
        "id": station.hafas_id,
        "date": date_str,
        "time": time_str,
        "duration": str(duration),
        "maxJourneys": str(HAFAS_MAX_JOURNEYS),
        "format": "json",
    }
    response = requests.get(HAFAS_BASE_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()
    departures = data.get("Departure")
    if isinstance(departures, list):
        return departures
    return []


def build_cache_snapshot(now: datetime, duration: int) -> Dict:
    per_train: Dict[str, Dict[str, Dict[str, Optional[float]]]] = {}
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")

    errors: List[Tuple[Station, Exception]] = []

    for station in STATIONS:
        try:
            departures = fetch_departures(station, date_str, time_str, duration)
        except Exception as exc:  # pragma: no cover - network failures
            errors.append((station, exc))
            continue

        if not departures:
            continue

        names = station.names or (station.label,)
        name_pairs = [(display_name, normalize_station_name(display_name)) for display_name in names]

        for dep in departures:
            number = extract_hafas_train_number(dep)
            if not number:
                continue
            delay = compute_hafas_delay(dep)
            if not delay:
                continue
            if not delay["cancelled"] and delay.get("minutes") is None:
                continue

            value: Optional[float]
            if delay["cancelled"]:
                value = None
            else:
                minutes = delay.get("minutes")
                value = int(minutes) if minutes is not None else None

            key_raw = str(number)
            key = normalize_train_number_key(key_raw) or key_raw
            per_station = per_train.setdefault(key, {})

            for display_name, norm in name_pairs:
                if not norm:
                    continue
                existing = per_station.get(norm)
                if existing:
                    existing_value = existing.get("value")
                    if existing_value is None:
                        continue
                    if value is None:
                        per_station[norm] = {"original": display_name, "value": value}
                        continue
                    if existing_value is not None and math.isfinite(existing_value) and math.isfinite(value):
                        if abs(value) >= abs(existing_value):
                            continue
                per_station[norm] = {"original": display_name, "value": value}

    fetched_at = int(time.time() * 1000)
    entries: List[Tuple[str, List[Tuple[str, Dict[str, Optional[float]]]]]] = []
    for train_key, stations in per_train.items():
        if not stations:
            continue
        station_entries = [
            (norm, {"original": entry.get("original"), "value": entry.get("value")})
            for norm, entry in stations.items()
        ]
        entries.append((train_key, station_entries))

    payload = {
        "version": 1,
        "fetchedAt": fetched_at,
        "generatedAtIso": now.isoformat(),
        "entries": entries,
        "stations": [station.axis_id for station in STATIONS],
        "errors": [station.axis_id for station, _ in errors] if errors else [],
        "duration": duration,
    }
    return payload


def extract_hafas_train_number(dep: Dict) -> Optional[str]:
    candidates: Iterable[Optional[str]] = (
        dep.get("trainNumber"),
        dep.get("name"),
        dep.get("number"),
        dep.get("line"),
        dep.get("Line"),
        dep.get("Product", {}).get("line") if isinstance(dep.get("Product"), dict) else None,
        dep.get("Product", {}).get("name") if isinstance(dep.get("Product"), dict) else None,
        dep.get("Product", {}).get("catOut") if isinstance(dep.get("Product"), dict) else None,
        dep.get("Product", {}).get("catIn") if isinstance(dep.get("Product"), dict) else None,
        dep.get("Product", {}).get("lineId") if isinstance(dep.get("Product"), dict) else None,
        dep.get("Product", {}).get("number") if isinstance(dep.get("Product"), dict) else None,
        dep.get("JourneyDetailRef", {}).get("ref") if isinstance(dep.get("JourneyDetailRef"), dict) else None,
        dep.get("id"),
    )
    for candidate in candidates:
        number = extract_train_number_candidate(candidate)
        if number:
            return number
    return None


def main() -> int:
    now = datetime.now(tz=LUX_TZ) if LUX_TZ else datetime.utcnow()
    payload = build_cache_snapshot(now, HAFAS_LOOKAHEAD_MINUTES)

    HAFAS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with HAFAS_CACHE_FILE.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {HAFAS_CACHE_FILE} with {len(payload['entries'])} trains", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
