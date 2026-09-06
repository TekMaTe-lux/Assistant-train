#!/usr/bin/env python3
"""Prototype lecture seule du futur LB Rail Engine.

Compile des index J/J+1 directement depuis les GTFS bruts SNCF + Luxembourg,
sans modifier la carte ni les fichiers de production.

- SNCF: le feed est considéré ferroviaire.
- Luxembourg: on ne garde que les route_type ferroviaires GTFS (2 ou 100..117).
- calendar.txt + calendar_dates.txt sont normalisés.
- Les heures > 24:00 restent attachées à leur service_date.
- Produit uniquement des fichiers de preview dans --out.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile

RAIL_ROUTE_TYPES = {"2", *{str(x) for x in range(100, 118)}}
WEEKDAY_FIELDS = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
]


def norm_date(value: str) -> str:
    return str(value or "").strip().replace("-", "")[:8]


def parse_time(value: str):
    value = str(value or "").strip()
    if not value:
        return None
    parts = value.split(":")
    if len(parts) < 2:
        return None
    try:
        h = int(parts[0]); m = int(parts[1]); s = int(parts[2]) if len(parts) > 2 else 0
        return h * 3600 + m * 60 + s
    except ValueError:
        return None


def member_name(z: ZipFile, basename: str):
    for n in z.namelist():
        if n.rsplit("/", 1)[-1].lower() == basename.lower():
            return n
    return None


def rows_from_zip(z: ZipFile, basename: str) -> Iterable[dict[str, str]]:
    name = member_name(z, basename)
    if not name:
        return []
    f = z.open(name, "r")
    import io
    text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
    return csv.DictReader(text)


def active_services(z: ZipFile, dates: list[str]):
    wanted = {norm_date(d) for d in dates}
    active = {d: set() for d in wanted}

    cal_name = member_name(z, "calendar.txt")
    if cal_name:
        for row in rows_from_zip(z, "calendar.txt"):
            sid = str(row.get("service_id") or "").strip()
            start = norm_date(row.get("start_date") or "")
            end = norm_date(row.get("end_date") or "")
            if not sid or not start or not end:
                continue
            for d in wanted:
                if start <= d <= end:
                    dt = datetime.strptime(d, "%Y%m%d")
                    field = WEEKDAY_FIELDS[dt.weekday()]
                    if str(row.get(field) or "0").strip() == "1":
                        active[d].add(sid)

    exc_name = member_name(z, "calendar_dates.txt")
    if exc_name:
        for row in rows_from_zip(z, "calendar_dates.txt"):
            d = norm_date(row.get("date") or "")
            if d not in wanted:
                continue
            sid = str(row.get("service_id") or "").strip()
            typ = str(row.get("exception_type") or "").strip()
            if not sid:
                continue
            if typ == "1":
                active[d].add(sid)
            elif typ == "2":
                active[d].discard(sid)

    return active


def load_feed(path: Path, source: str, dates: list[str], lux_filter=False):
    with ZipFile(path) as z:
        services = active_services(z, dates)

        route_types = Counter()
        allowed_routes = set()
        route_rows = {}
        for row in rows_from_zip(z, "routes.txt"):
            rid = str(row.get("route_id") or "").strip()
            typ = str(row.get("route_type") or "").strip()
            route_types[typ or "<vide>"] += 1
            route_rows[rid] = row
            if not lux_filter or typ in RAIL_ROUTE_TYPES:
                allowed_routes.add(rid)

        trips = {}
        for row in rows_from_zip(z, "trips.txt"):
            tid = str(row.get("trip_id") or "").strip()
            rid = str(row.get("route_id") or "").strip()
            sid = str(row.get("service_id") or "").strip()
            if not tid or not sid:
                continue
            if lux_filter and rid not in allowed_routes:
                continue
            trips[tid] = {
                "trip_id": tid,
                "route_id": rid,
                "service_id": sid,
                "headsign": row.get("trip_headsign") or "",
                "short_name": row.get("trip_short_name") or "",
                "first": None,
                "last": None,
                "stop_count": 0,
            }

        # Un seul passage séquentiel dans stop_times.txt: pas de gros dictionnaire de lignes.
        for row in rows_from_zip(z, "stop_times.txt"):
            tid = str(row.get("trip_id") or "").strip()
            meta = trips.get(tid)
            if meta is None:
                continue
            arr = parse_time(row.get("arrival_time") or "")
            dep = parse_time(row.get("departure_time") or "")
            vals = [x for x in (arr, dep) if x is not None]
            if vals:
                lo, hi = min(vals), max(vals)
                meta["first"] = lo if meta["first"] is None else min(meta["first"], lo)
                meta["last"] = hi if meta["last"] is None else max(meta["last"], hi)
            meta["stop_count"] += 1

        by_date = {}
        for d in dates:
            ds = norm_date(d)
            service_ids = services.get(ds, set())
            rows = [m for m in trips.values() if m["service_id"] in service_ids]
            rows.sort(key=lambda m: (m["first"] is None, m["first"] or 0, m["trip_id"]))
            by_date[ds] = rows

        return {
            "source": source,
            "route_types": dict(route_types),
            "route_count": len(route_rows),
            "rail_route_count": len(allowed_routes) if lux_filter else len(route_rows),
            "trip_catalog_count": len(trips),
            "active_services": {d: len(v) for d, v in services.items()},
            "by_date": by_date,
        }


def load_lite(path: Path):
    if not path or not path.exists():
        return {}, set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    data = payload.get("data") or {}
    trips = {}
    for pair in data.get("tripsById") or []:
        if isinstance(pair, list) and len(pair) == 2:
            trips[str(pair[0])] = pair[1] if isinstance(pair[1], dict) else {}
    return trips, set(trips)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sncf", required=True)
    ap.add_argument("--lux", required=True)
    ap.add_argument("--date", action="append", required=True)
    ap.add_argument("--compare-lite")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    dates = [norm_date(d) for d in args.date]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    fr = load_feed(Path(args.sncf), "FR", dates, lux_filter=False)
    lu = load_feed(Path(args.lux), "LU", dates, lux_filter=True)
    lite_trips, lite_ids = load_lite(Path(args.compare_lite)) if args.compare_lite else ({}, set())

    print("========================================")
    print(" LB RAIL ENGINE — RAW GTFS DAY PREVIEW")
    print("========================================")
    print("SNCF catalogue trips :", fr["trip_catalog_count"])
    print("LU rail catalogue     :", lu["trip_catalog_count"])
    print("LU route_type         :", lu["route_types"])
    print("LU routes rail/total  :", lu["rail_route_count"], "/", lu["route_count"])

    summary = {
        "schema": 1,
        "dates": dates,
        "fr": {k: v for k, v in fr.items() if k != "by_date"},
        "lu": {k: v for k, v in lu.items() if k != "by_date"},
        "days": {},
    }

    for d in dates:
        fr_rows = fr["by_date"].get(d, [])
        lu_rows = lu["by_date"].get(d, [])
        fr_ids = {x["trip_id"] for x in fr_rows}
        lu_ids = {x["trip_id"] for x in lu_rows}
        cross_fr = sum(1 for x in fr_rows if (x["last"] or 0) >= 86400)
        cross_lu = sum(1 for x in lu_rows if (x["last"] or 0) >= 86400)

        # Le fichier J/J+1 reste volontairement un index compact: pas de stop_times recopiés.
        payload = {
            "schema": 1,
            "serviceDate": d,
            "sources": {
                "FR": {
                    "tripCount": len(fr_rows),
                    "crossMidnight": cross_fr,
                    "trips": [x["trip_id"] for x in fr_rows],
                },
                "LU": {
                    "tripCount": len(lu_rows),
                    "crossMidnight": cross_lu,
                    "trips": [x["trip_id"] for x in lu_rows],
                },
            },
        }
        target = out / f"day-{d}.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        print()
        print("===", d, "===")
        print("FR actifs             :", len(fr_rows), "dont >24h:", cross_fr)
        print("LU rail actifs        :", len(lu_rows), "dont >24h:", cross_lu)
        print("TOTAL                 :", len(fr_rows) + len(lu_rows))
        print("day-index             :", round(target.stat().st_size / 1024, 1), "Ko")

        comparison = None
        if lite_ids and d == norm_date(json.loads(Path(args.compare_lite).read_text(encoding="utf-8")).get("date") or ""):
            # SNCF est normalement direct. Pour LU on teste les conventions rencontrées dans l'existant.
            lu_candidates = set(lu_ids) | {"cfl:" + x for x in lu_ids} | {"CFL:" + x for x in lu_ids}
            union_candidates = fr_ids | lu_candidates
            comparison = {
                "liteCount": len(lite_ids),
                "exactFrOverlap": len(lite_ids & fr_ids),
                "luCandidateOverlap": len(lite_ids & lu_candidates),
                "coveredByRawFeeds": len(lite_ids & union_candidates),
                "liteNotCovered": len(lite_ids - union_candidates),
                "rawNotInLite": len(union_candidates - lite_ids),
            }
            print("cache lite actuel     :", comparison["liteCount"])
            print("match FR exact        :", comparison["exactFrOverlap"])
            print("match LU convention   :", comparison["luCandidateOverlap"])
            print("cache couvert brut    :", comparison["coveredByRawFeeds"])
            print("cache non couvert     :", comparison["liteNotCovered"])

        summary["days"][d] = {
            "fr": len(fr_rows), "lu": len(lu_rows), "total": len(fr_rows) + len(lu_rows),
            "crossMidnightFr": cross_fr, "crossMidnightLu": cross_lu,
            "fileBytes": target.stat().st_size,
            "comparison": comparison,
        }

    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print()
    print("Preview uniquement :", out)
    print("AUCUNE MODIFICATION DE PRODUCTION")


if __name__ == "__main__":
    main()
