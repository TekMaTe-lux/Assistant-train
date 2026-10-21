#!/usr/bin/env python3
"""MooRail: optional BE endpoints for proven same-day LU trains.

Only reads MooRail provider metadata and the existing LOCAL trip-detail API.
Never edits LU/CFL/HAFAS schedules, real-time, stops, status, platforms or stats.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from urllib.parse import urlencode
from urllib.request import urlopen

META = Path("/opt/labetaillere-map-v2-src/map-v2/public/data/france-v5-meta.json")
OUT = Path("/opt/labetaillere-map-v2-src/map-v2/public/data/moorail-be-lu-endpoints-v1.json")
DETAIL = "http://127.0.0.1:3124/path/trip.json"
BELGIAN_ENDS = re.compile(r"\b(?:arlon|athus|gouvy)\b", re.I)

def clean(x):
    t = unicodedata.normalize("NFKD", str(x or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"\((?:lu|belgium|be)\)", "", t)
    t = re.sub(r"\b(?:gare centrale|gare)\b", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    if t.startswith("arlon sterpenich"): t = t[6:]
    return " ".join(t.split())

def seconds(value):
    parts=re.match(r"^(\d{1,3}):(\d{2})(?::(\d{2}))?",str(value or ""))
    return None if not parts else int(parts[1])*3600 + int(parts[2])*60 + int(parts[3] or 0)

def nearest_time(a, b):
    aa, bb=seconds(a),seconds(b)
    if aa is None or bb is None:return False
    return min(abs(aa-bb),abs(aa-bb+86400),abs(aa-bb-86400))<=180

def stops_match(lu, be):
    matches=[]
    last=-1
    for lu_index,s in enumerate(lu):
        lu_key=clean(s.get("name"))
        if not lu_key:continue
        for j in range(last+1,len(be)):
            other=be[j]
            if clean(other.get("name"))!=lu_key:continue
            if not nearest_time(s.get("arrival") or s.get("departure"),
                                other.get("arrival") or other.get("departure")):
                continue
            matches.append((lu_index,j,lu_key))
            last=j
            break
    # Two independently scheduled common stations, in timetable order, must agree.
    return matches if len(set(k for i,j,k in matches))>=2 else []

def is_lu_border(row):
    # Only LU runs that actually reach a Belgian station, not an unrelated number.
    endpoints=str(row.get("originName",""))+" "+str(row.get("destinationName",""))
    return bool(BELGIAN_ENDS.search(endpoints))

def is_be_lux(row):
    origin=clean(row.get("originName"))
    dest=clean(row.get("destinationName"))
    # "Bruxelles-Luxembourg" must never be mistaken for Luxembourg country.
    return origin=="luxembourg" or dest=="luxembourg"

def query_trip(row):
    params=urlencode({"source":row["source"],"date":row["serviceDate"],
                      "trip_id":row["tripId"]})
    with urlopen(DETAIL+"?"+params, timeout=5) as response:
        data=json.load(response)
    if data.get("ok") is False or not isinstance(data.get("stops"),list):
        raise ValueError("Invalid provider detail")
    return data["stops"]

def endpoint(stop, mode):
    return {"name":str(stop.get("name") or "")[:120],
            "time":str(stop.get("departure") or stop.get("arrival") or "")[:12] if mode=="origin"
            else str(stop.get("arrival") or stop.get("departure") or "")[:12]}

def verified_pair(lu, be, lu_stops, be_stops):
    if not lu_stops or not be_stops: return None
    matches=stops_match(lu_stops,be_stops)
    if not matches:return None
    first_be,last_be=endpoint(be_stops[0],"origin"),endpoint(be_stops[-1],"destination")
    first_lu,last_lu=endpoint(lu_stops[0],"origin"),endpoint(lu_stops[-1],"destination")
    start_extended=clean(first_be["name"])!=clean(first_lu["name"])
    end_extended=clean(last_be["name"])!=clean(last_lu["name"])
    # The BE provider MUST extend the LU segment on one end only.
    # Every LU stop maps in order into the Belgian whole route.
    if not (start_extended or end_extended):return None
    if matches[0][0]!=0 or matches[-1][0]!=len(lu_stops)-1:
        return None
    if (start_extended and matches[0][1]==0) or (end_extended and matches[-1][1]>=len(be_stops)-1):
        return None
    if (start_extended and end_extended):return None
    if start_extended and not nearest_time(last_lu["time"],last_be["time"]):return None
    if end_extended and not nearest_time(first_lu["time"],first_be["time"]):return None
    return {
        "number":str(lu["number"]), "date":str(lu["serviceDate"]),
        "luTripId":str(lu["tripId"]),
        "origin":first_be if start_extended else None,
        "destination":last_be if end_extended else None,
        "luOrigin":first_lu["name"],
        "luDestination":last_lu["name"],
        "matchedStops":len(matches),
        "beTripId":str(be["tripId"]),
        "source":"MooRail BE static / validated LU overlap",
    }

def build(meta):
    lu_by=defaultdict(list)
    be_by=defaultdict(list)
    for raw in meta.values():
        if not isinstance(raw,dict):continue
        row={k:raw.get(k) for k in ("source","number","serviceDate","tripId","originName","destinationName")}
        if not all(row.values()):continue
        if not re.fullmatch(r"\d{2,6}",str(row["number"])):continue
        key=(row["serviceDate"],str(row["number"]))
        if row["source"]=="LU" and is_lu_border(row):lu_by[key].append(row)
        if row["source"]=="BE" and is_be_lux(row):be_by[key].append(row)
    matches={}
    checks=0
    trip_cache={}
    for key in sorted(lu_by.keys()&be_by.keys()):
        seen=set()
        belgian=[]
        for b in be_by[key]:
            if b["tripId"] not in seen:
                belgian.append(b);seen.add(b["tripId"])
        for lu in lu_by[key]:
            candidates=[]
            for b in belgian:
                checks+=1
                try:
                    if ("LU",lu["tripId"]) not in trip_cache:
                        trip_cache[("LU",lu["tripId"])]=query_trip(lu)
                    if ("BE",b["tripId"]) not in trip_cache:
                        trip_cache[("BE",b["tripId"])]=query_trip(b)
                    l_stop=trip_cache[("LU",lu["tripId"])]
                    b_stop=trip_cache[("BE",b["tripId"])]
                    pair=verified_pair(lu,b,l_stop,b_stop)
                    if pair:candidates.append(pair)
                except Exception as exc:
                    print("Skipping candidate",key,type(exc).__name__)
            # When two BE services are equally plausible, do not enrich.
            if len(candidates)==1:
                pair=candidates[0]
                index_key=pair["date"]+"|"+pair["luTripId"]
                if index_key not in matches:matches[index_key]=pair
    return {"schema":"moorail-be-lu-endpoints-v1",
            "builtAt":datetime.now().astimezone().isoformat(),
            "count":len(matches),"verifiedPairs":matches,
            "candidateChecks":checks}

def test():
    lu=[{"name":"Gouvy, Gare","departure":"07:24:00"},
        {"name":"Troisvierges, Gare","arrival":"07:35:00"},
        {"name":"Luxembourg, Gare Centrale","arrival":"08:46:00"}]
    be=[{"name":"Liège-Guillemins","departure":"06:07:00"},
        {"name":"Gouvy","departure":"07:24:00"},
        {"name":"Troisvierges (LU)","arrival":"07:35:00"},
        {"name":"Luxembourg (LU)","arrival":"08:46:00"}]
    l={"number":"5306","serviceDate":"2026-10-21","tripId":"lu"}
    b={"number":"5306","serviceDate":"2026-10-21","tripId":"be"}
    assert verified_pair(l,b,lu,be)["origin"]["name"]=="Liège-Guillemins"
    assert not verified_pair(l,b,lu,[{"name":"Genk","departure":"07:24:00"},*be[1:2]])
    wrong=[*be];wrong[1]={"name":"Gouvy","departure":"09:24:00"}
    assert not verified_pair(l,b,lu,wrong)
    assert not is_be_lux({"originName":"Bruxelles-Luxembourg","destinationName":"Alost"})
    assert clean("Luxembourg, Gare Centrale")==clean("Luxembourg (LU)")
    print("TESTS OK: endpoint extension, missing shared stations, timing collision, BE/LU aliases")

def save(data):
    OUT.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=OUT.parent,prefix=".be-lu-endpoints-")
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(data,f,ensure_ascii=False,separators=(",",":"))
            f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o644)
        os.replace(tmp,OUT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--test",action="store_true");ap.add_argument("--dry-run",action="store_true")
    opt=ap.parse_args()
    if opt.test:test();return
    payload=json.loads(META.read_text(encoding="utf-8"))
    if payload.get("schema") not in ("moorail-meta-v5","moorail-meta-v5-active"):
        raise ValueError("Unexpected meta schema")
    result=build(payload["trains"])
    print(json.dumps({"count":result["count"],"checked":result["candidateChecks"],
                      "examples":[{"train":v["number"],"from":(v["origin"] or {}).get("name"),
                                  "to":(v["destination"] or {}).get("name"),"anchors":v["matchedStops"]}
                                  for v in result["verifiedPairs"].values()][:10]},ensure_ascii=False))
    if not opt.dry_run:save(result)

if __name__=="__main__":main()
