#!/usr/bin/env python3
"""Daily, all-service Belgian timetable index for La Bétaillère.

Read-only to MooRail's EXISTING official-SNCB GTFS SQLite. No SNCB, CFL
or HAFAS network requests, and no modifications to SNCF statistics.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from zoneinfo import ZoneInfo

DB=Path("/opt/lb-rail-engine-v1/data/be/timetable-be-v1.sqlite")
OUT=Path("/opt/labetaillere-map-v2-src/map-v2/public/data/lb-be-international-ends-v1.json")
STOP_NAMES={"Arlon","Gouvy","Athus","Luxembourg (LU)","Luxembourg"}
KINDS=("IC","RE","RB","EC","L","P","S","ICE")
LUX={"Luxembourg (LU)","Luxembourg"}

def clock(sec):
    if sec is None:return ""
    sec=int(sec)
    return f"{sec//3600:02}:{(sec%3600)//60:02}:{sec%60:02}"

def endpoint(row,kind):
    return {"name":row["name"],
            "time":clock(row["dep"] if kind=="start" else row["arr"])
                    or clock(row["arr"] if kind=="start" else row["dep"])}

def compile_day_index(database,service_days):
    by_trip=defaultdict(list)
    qmarks=",".join("?" for _ in service_days)
    query=f"""SELECT d.service_date,t.trip_id,t.number,t.product,
                    st.seq,st.arrival_sec,st.departure_sec,s.name
           FROM day_trips d JOIN trips t ON d.trip_id=t.trip_id
                JOIN stop_times st ON st.trip_id=t.trip_id
                JOIN stops s ON s.stop_id=st.stop_id
           WHERE d.service_date IN ({qmarks}) AND t.product IN
                 ({','.join('?' for _ in KINDS)})
             AND EXISTS (SELECT 1 FROM stop_times st2 JOIN stops s2 ON s2.stop_id=st2.stop_id
                         WHERE st2.trip_id=t.trip_id AND s2.name IN
                         ('Arlon','Gouvy','Athus','Luxembourg (LU)','Luxembourg'))
           ORDER BY d.service_date,t.trip_id,st.seq"""
    with sqlite3.connect(f"file:{database}?mode=ro",uri=True,timeout=6) as con:
        for service,trip,number,product,seq,arr,dep,name in con.execute(query,(*service_days,*KINDS)):
            by_trip[(service,trip,str(number or ""),str(product or ""))].append(
                {"name":str(name or "").strip(),"arr":arr,"dep":dep})
    expected_ic=defaultdict(set)
    for (service,trip,num,kind),stops in by_trip.items():
        if kind=="IC" and re.fullmatch(r"\d{2,6}",num) and len(stops)>=2:
            expected_ic[service].add(num)
    result=defaultdict(dict)
    audits=defaultdict(set)
    rejected=0
    for (service,trip,num,kind),stops in by_trip.items():
        if len(stops)<2 or not re.fullmatch(r"\d{2,6}",num):
            rejected+=1;continue
        if not any(s["name"] in STOP_NAMES for s in stops):continue
        # All IC touching Arlon/Gouvy/Luxembourg; retain non-IC only when
        # the service really serves Luxembourg to avoid BE-only train bloat.
        if kind!="IC" and (
            not any(s["name"] in LUX for s in stops) or
            (stops[0]["name"] in STOP_NAMES and stops[-1]["name"] in STOP_NAMES)
        ):continue
        anchor=[]
        for st in stops:
            arr,dep=clock(st["arr"]),clock(st["dep"])
            if not(arr or dep):continue
            anchor.append({"name":st["name"][:110],"time":dep or arr,
                           "arrival":arr,"departure":dep})
        if len(anchor)<2:rejected+=1;continue
        first,last=endpoint(stops[0],"start"),endpoint(stops[-1],"end")
        if not(first["time"] and last["time"]):rejected+=1;continue
        # Different GTFS aliases can exist for one run: same date, train,
        # endpoints, times -> one authoritative planned journey.
        signature=(first["name"],first["time"],last["name"],last["time"])
        iso=f"{service[:4]}-{service[4:6]}-{service[6:]}"
        result[iso+"|"+num][signature]={
            "type":kind,"number":num,
            "date":f"{service[:4]}-{service[4:6]}-{service[6:]}",
            "origin":first,"destination":last,"anchors":anchor}
        audits[service].add(num)
    indexed_ic=defaultdict(set)
    for key,candidates in result.items():
        service,number=key.split("|",1)
        ymd=service.replace("-","")
        if any(c["type"]=="IC" for c in candidates.values()):
            indexed_ic[ymd].add(number)
    for service,expected in expected_ic.items():
        missing=expected-indexed_ic[service]
        if missing:
            raise RuntimeError("Incomplete SNCB IC indexing on "+service+
                               ": "+",".join(sorted(missing))[:350])
    return {key:list(v.values()) for key,v in sorted(result.items())},{
        "candidateTrips":len(by_trip),"rejectedTrips":rejected,
        "numbersByDate":{day:len(nums) for day,nums in audits.items()},
        "expectedICByDate":{day:len(v) for day,v in expected_ic.items()},
        "indexedICByDate":{day:len(indexed_ic[day]) for day in expected_ic}}

def build(path=DB,day=None):
    today=day or datetime.now(ZoneInfo("Europe/Luxembourg")).date()
    requested=[(today+timedelta(days=i)).strftime("%Y%m%d") for i in (-1,0,1,2)]
    with sqlite3.connect(f"file:{path}?mode=ro",uri=True,timeout=6) as con:
        available={row[0] for row in con.execute("SELECT DISTINCT service_date FROM day_trips")}
    if requested[1] not in available:
        raise RuntimeError("SNCB timetable is stale: current service date not in GTFS DB")
    service_days=[day for day in requested if day in available]
    trips,audit=compile_day_index(path,service_days)
    if not trips:raise RuntimeError("No Belgian journeys: refusing to replace valid index")
    return {"schema":"lb-be-international-ends-v1",
            "generatedAt":datetime.now(timezone.utc).isoformat(),
            "source":"SNCB official GTFS daily timetable through MooRail local SQLite",
            "dates":[f"{x[:4]}-{x[4:6]}-{x[6:]}" for x in service_days],
            "trains":trips,"trainCount":len(trips),
            "failedCandidates":audit["rejectedTrips"],
            "coverage":audit}

def atomic_write(payload):
    OUT.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".lb-be-ends-",dir=OUT.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(payload,f,ensure_ascii=False,separators=(",",":"))
            f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o644)
        os.replace(tmp,OUT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--dry-run",action="store_true")
    parser.add_argument("--date",help="Explicit local service date for read-only audits")
    args=parser.parse_args()
    day=None
    if args.date:
        from datetime import date
        day=date.fromisoformat(args.date)
    output=build(day=day)
    local_date=day or datetime.now(ZoneInfo("Europe/Luxembourg")).date()
    for key in ("2111","2134","2135","2137","5311","5334","5914"):
        entries=output["trains"].get(local_date.isoformat()+"|"+key,[])
        print(key,[(x["origin"]["name"],x["destination"]["name"]) for x in entries])
    print("TOTAL",output["trainCount"],"BY_DATE",output["coverage"]["numbersByDate"])
    if not args.dry_run:atomic_write(output)

if __name__=="__main__":main()
