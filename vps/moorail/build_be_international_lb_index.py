#!/usr/bin/env python3
"""Small, read-only index of Belgian international train termini for La Bétaillère.
The consumer validates common stops/times with CFL before displaying an endpoint.
Uses existing MooRail metadata + LOCAL detail endpoint; no new SNCB/HAFAS requests.
"""
from collections import defaultdict
from datetime import datetime, timezone
import argparse
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlencode
from urllib.request import urlopen

META=Path("/opt/labetaillere-map-v2-src/map-v2/public/data/france-v5-meta.json")
OUT=Path("/opt/labetaillere-map-v2-src/map-v2/public/data/lb-be-international-ends-v1.json")
DETAIL="http://127.0.0.1:3124/path/trip.json"

def normalize(s):
    return str(s or "").strip()

def country_lux(s):
    # Exact railway endpoint, not Bruxelles-Luxembourg or any name mentioning Luxembourg.
    return normalize(s).casefold() in ("luxembourg (lu)","luxembourg")

def clock(s):
    match=re.match(r"^\d{1,3}:\d{2}(?::\d{2})?",normalize(s))
    return match.group(0) if match else ""

def trim_end(row,edge):
    return {"name":normalize(row.get("name"))[:120],
            "time":clock(row.get("departure") or row.get("arrival")) if edge=="start"
                   else clock(row.get("arrival") or row.get("departure"))}

def build(meta):
    rows=defaultdict(dict)
    for row in meta.values():
        if not isinstance(row,dict) or row.get("source")!="BE":continue
        num=normalize(row.get("number"))
        service=normalize(row.get("serviceDate"))
        trip=normalize(row.get("tripId"))
        kind=normalize(row.get("typeLabel")).upper()
        if not re.fullmatch(r"\d{2,6}",num) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",service):continue
        if not trip or not (country_lux(row.get("originName")) or country_lux(row.get("destinationName"))):continue
        if kind not in ("IC","RE","RB","EC","L","P","S","ICE"):continue
        rows[(service,num)][trip]=row

    result={}
    rejected=0
    for (service,num),trips in sorted(rows.items()):
        candidates=[]
        for trip,row in trips.items():
            query=urlencode({"source":"BE","date":service,"trip_id":trip})
            try:
                with urlopen(DETAIL+"?"+query, timeout=4) as response:
                    detail=json.load(response)
                stops=detail.get("stops") or []
                if detail.get("ok") is False or len(stops)<3:continue
                a,b=trim_end(stops[0],"start"),trim_end(stops[-1],"end")
                if not (country_lux(a["name"]) or country_lux(b["name"])):continue
                anchors=[]
                for stop in stops:
                    t=clock(stop.get("departure") or stop.get("arrival"))
                    if not t:continue
                    anchors.append({"name":normalize(stop.get("name"))[:110], "time":t})
                if len(anchors)<3:continue
                candidates.append({"type":row["typeLabel"],"number":num,"date":service,
                                   "origin":a,"destination":b,"anchors":anchors})
            except Exception:
                rejected+=1
        if candidates:
            # dedup schedule aliases, reject ambiguities in consumer when present.
            unique={}
            for c in candidates:
                signature=(c["origin"]["name"],c["origin"]["time"],
                           c["destination"]["name"],c["destination"]["time"])
                unique[signature]=c
            result[service+"|"+num]=list(unique.values())
    return {"schema":"lb-be-international-ends-v1",
            "generatedAt":datetime.now(timezone.utc).isoformat(),
            "trains":result,"trainCount":len(result),"failedCandidates":rejected}

def atomic_write(payload):
    OUT.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".lb-be-ends-",dir=OUT.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as out:
            json.dump(payload,out,ensure_ascii=False,separators=(",",":"))
            out.flush();os.fsync(out.fileno())
        os.chmod(tmp,0o644);os.replace(tmp,OUT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    source=json.loads(META.read_text(encoding="utf8"))
    if source.get("schema")!="moorail-meta-v5":raise ValueError("Unexpected MooRail metadata format")
    output=build(source["trains"])
    ic=output["trains"].get("2026-10-21|2134",[])
    print(json.dumps({"count":output["trainCount"],"failed":output["failedCandidates"],
                      "2134": [{key:value for key,value in r.items() if key!="anchors"} for r in ic]},
                     ensure_ascii=False))
    if not args.dry_run:atomic_write(output)

if __name__=="__main__":main()
