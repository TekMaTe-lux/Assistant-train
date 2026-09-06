#!/usr/bin/env python3
"""Read-only localhost API for LB Rail Engine compact timetable SQLite v2.

Compatibility goal: preserve the V1 public JSON shapes for /day and /train while
reading the compact V2 schema (integer keys + service_days, no day_trips).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


def norm_date(value: str) -> str:
    return str(value or "").strip().replace("-", "")[:8]


def iso_date(value: str) -> str:
    d = norm_date(value)
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else value


def sec_to_gtfs(v):
    if v is None:
        return None
    try:
        v = int(v)
    except Exception:
        return None
    h, rem = divmod(v, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


class App:
    def __init__(self, db_path: Path):
        self.db_path = db_path.resolve()

    def connect(self):
        db = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        db.execute("PRAGMA query_only=ON")
        return db

    def status(self):
        with self.connect() as db:
            meta = dict(db.execute("SELECT key,value FROM meta"))
            sources = {}
            for source in ("FR", "LU"):
                rows = db.execute(
                    "SELECT mode,COUNT(*) FROM trips WHERE source=? GROUP BY mode ORDER BY mode",
                    (source,),
                ).fetchall()
                sources[source] = {mode: count for mode, count in rows}
            first_day, last_day = db.execute(
                "SELECT MIN(service_date),MAX(service_date) FROM service_days"
            ).fetchone()
            return {
                "ok": True,
                "engine": "lb-rail-engine-v2",
                "schemaVersion": int(meta.get("schema_version", "2")),
                "builtAt": meta.get("built_at"),
                "policy": meta.get("policy"),
                "dbBytes": self.db_path.stat().st_size,
                "sources": sources,
                "serviceDateRange": [iso_date(str(first_day or "")), iso_date(str(last_day or ""))],
            }

    def day(self, date: str, full: bool, source: str | None, mode: str | None, number: str | None, limit: int):
        d = norm_date(date)
        if len(d) != 8 or not d.isdigit():
            return {"serviceDate": iso_date(d), "tripCount": 0, "counts": []}
        di = int(d)
        where = ["sd.service_date=?"]
        args: list[object] = [di]
        if source:
            where.append("t.source=?")
            args.append(source.upper())
        if mode:
            where.append("t.mode=?")
            args.append(mode)
        if number:
            where.append("t.number=?")
            args.append(number)
        clause = " AND ".join(where)

        with self.connect() as db:
            total = db.execute(
                f"""SELECT COUNT(*)
                    FROM service_days sd
                    JOIN trips t ON t.service_pk=sd.service_pk
                    WHERE {clause}""",
                args,
            ).fetchone()[0]
            counts = db.execute(
                f"""SELECT t.source,t.mode,COUNT(*)
                    FROM service_days sd
                    JOIN trips t ON t.service_pk=sd.service_pk
                    WHERE {clause}
                    GROUP BY t.source,t.mode
                    ORDER BY t.source,t.mode""",
                args,
            ).fetchall()
            out = {
                "serviceDate": iso_date(d),
                "tripCount": total,
                "counts": [{"source": s, "mode": m, "count": c} for s, m, c in counts],
            }
            if full:
                lim = max(1, min(limit, 20000))
                rows = db.execute(
                    f"""
                    SELECT t.source,t.trip_id,t.number,t.headsign,r.route_id,t.mode,
                           t.first_sec,t.last_sec,t.stop_count
                    FROM service_days sd
                    JOIN trips t ON t.service_pk=sd.service_pk
                    JOIN routes r ON r.route_pk=t.route_pk
                    WHERE {clause}
                    ORDER BY COALESCE(t.first_sec,999999),t.number,t.trip_id
                    LIMIT ?
                    """,
                    [*args, lim],
                ).fetchall()
                out["returned"] = len(rows)
                out["trips"] = [
                    {
                        "canonicalId": f"{s}:{d}:{tid}",
                        "source": s,
                        "tripId": tid,
                        "number": num,
                        "headsign": head,
                        "routeId": rid,
                        "mode": m,
                        "first": sec_to_gtfs(first),
                        "last": sec_to_gtfs(last),
                        "stopCount": sc,
                    }
                    for s, tid, num, head, rid, m, first, last, sc in rows
                ]
            return out

    def train(self, number: str, date: str | None):
        number = unquote(number)
        d = norm_date(date or "") if date else None
        with self.connect() as db:
            if d:
                if len(d) != 8 or not d.isdigit():
                    trips = []
                else:
                    trips = db.execute(
                        """
                        SELECT t.trip_pk,t.source,t.trip_id,t.number,t.headsign,r.route_id,
                               t.mode,t.first_sec,t.last_sec,t.stop_count
                        FROM service_days sd
                        JOIN trips t ON t.service_pk=sd.service_pk
                        JOIN routes r ON r.route_pk=t.route_pk
                        WHERE sd.service_date=? AND t.number=?
                        ORDER BY COALESCE(t.first_sec,999999)
                        """,
                        (int(d), number),
                    ).fetchall()
            else:
                trips = db.execute(
                    """
                    SELECT t.trip_pk,t.source,t.trip_id,t.number,t.headsign,r.route_id,
                           t.mode,t.first_sec,t.last_sec,t.stop_count
                    FROM trips t
                    JOIN routes r ON r.route_pk=t.route_pk
                    WHERE t.number=?
                    ORDER BY t.source,COALESCE(t.first_sec,999999)
                    LIMIT 200
                    """,
                    (number,),
                ).fetchall()

            out = []
            for trip_pk, s, tid, num, head, rid, mode, first, last, sc in trips:
                stops = db.execute(
                    """
                    SELECT st.seq,sp.stop_id,sp.name,st.arrival_sec,st.departure_sec,sp.lat,sp.lon
                    FROM stop_times st
                    JOIN stops sp ON sp.stop_pk=st.stop_pk
                    WHERE st.trip_pk=?
                    ORDER BY st.seq
                    """,
                    (trip_pk,),
                ).fetchall()
                out.append(
                    {
                        "canonicalId": f"{s}:{d}:{tid}" if d else None,
                        "source": s,
                        "tripId": tid,
                        "number": num,
                        "headsign": head,
                        "routeId": rid,
                        "mode": mode,
                        "first": sec_to_gtfs(first),
                        "last": sec_to_gtfs(last),
                        "stopCount": sc,
                        "stops": [
                            {
                                "seq": seq,
                                "stopId": sid,
                                "name": name,
                                "arrival": sec_to_gtfs(arr),
                                "departure": sec_to_gtfs(dep),
                                "lat": lat,
                                "lon": lon,
                            }
                            for seq, sid, name, arr, dep, lat, lon in stops
                        ],
                    }
                )
            return {
                "number": number,
                "serviceDate": iso_date(d) if d else None,
                "matches": len(out),
                "trips": out,
            }


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LB-Rail-Engine-V2/1.0"

        def log_message(self, fmt, *args):
            print(f"{self.client_address[0]} - {fmt % args}")

        def send_json(self, status, obj):
            raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            use_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "").lower() and len(raw) > 1024
            if use_gzip:
                raw = gzip.compress(raw, compresslevel=5)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            if use_gzip:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            try:
                u = urlparse(self.path)
                q = parse_qs(u.query)
                path = u.path.rstrip("/") or "/"
                if path == "/status":
                    return self.send_json(200, app.status())
                if path.startswith("/day/"):
                    date = path.split("/", 2)[2]
                    full = q.get("full", ["0"])[0] == "1"
                    source = q.get("source", [None])[0]
                    mode = q.get("mode", [None])[0]
                    number = q.get("number", [None])[0]
                    try:
                        limit = int(q.get("limit", ["20000"])[0])
                    except ValueError:
                        limit = 20000
                    return self.send_json(200, app.day(date, full, source, mode, number, limit))
                if path.startswith("/train/"):
                    number = path.split("/", 2)[2]
                    date = q.get("date", [None])[0]
                    return self.send_json(200, app.train(number, date))
                return self.send_json(
                    404,
                    {
                        "error": "not_found",
                        "paths": ["/status", "/day/YYYY-MM-DD", "/train/NUMBER?date=YYYY-MM-DD"],
                    },
                )
            except Exception as exc:
                return self.send_json(500, {"error": "internal_error", "detail": str(exc)})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=3122)
    args = ap.parse_args()
    db = Path(args.db).resolve()
    if not db.exists():
        raise SystemExit(f"DB absente: {db}")
    app = App(db)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(app))
    print(f"LB Rail Engine v2 sur http://{args.host}:{args.port} db={db}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
