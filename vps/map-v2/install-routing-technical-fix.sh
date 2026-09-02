#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
BUILDER="$ROOT/scripts/build_dataset.py"
PREVIEW="$ROOT/public/carte-core-canonical-v4-preview.html"
GENERATED="$ROOT/data/generated"
TRIPS="$GENERATED/trips.json"
PATHS="$GENERATED/paths.json"
CFL_STATIC="/var/www/html/gtfs/static/CFL"
CFL_SHAPES="$ROOT/public/data/cfl-rail-shapes"
MANIFEST="$CFL_SHAPES/manifest.json"
SERVICE="labetaillere-map-v2.service"

AUDITED_BUILDER_SHA="1c82e065d5ca3296e39bcfeb780ddc4ba1396a5b62f0aa88c576a33b57b1b053"
AUDITED_PREVIEW_SHA="ddfeca4d55da02ec4bd8efe5340cf4d4501861259a3cc5bc6072b9ca36f1a857"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/routing-technical-fix-$STAMP"
TMP="$(mktemp -d /tmp/lb-routing-technical.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback des fichiers modifiés..."
  for item in build_dataset.py carte-core-canonical-v4-preview.html trips.json paths.json; do
    if [[ -f "$BACKUP/$item" ]]; then
      case "$item" in
        build_dataset.py) cp -a "$BACKUP/$item" "$BUILDER" ;;
        carte-core-canonical-v4-preview.html) cp -a "$BACKUP/$item" "$PREVIEW" ;;
        trips.json) cp -a "$BACKUP/$item" "$TRIPS" ;;
        paths.json) cp -a "$BACKUP/$item" "$PATHS" ;;
      esac
    fi
  done
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo/root" >&2
  exit 2
fi

for f in "$BUILDER" "$PREVIEW" "$TRIPS" "$PATHS" \
         "$CFL_STATIC/stops.txt" "$CFL_STATIC/stop_times.txt" "$MANIFEST"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier absent: $f" >&2; exit 3; }
done

mkdir -p "$BACKUP"
cp -a "$BUILDER" "$BACKUP/build_dataset.py"
cp -a "$PREVIEW" "$BACKUP/carte-core-canonical-v4-preview.html"
cp -a "$TRIPS" "$BACKUP/trips.json"
cp -a "$PATHS" "$BACKUP/paths.json"

BUILDER_SHA="$(sha256sum "$BUILDER" | awk '{print $1}')"
PREVIEW_SHA="$(sha256sum "$PREVIEW" | awk '{print $1}')"

if ! grep -q 'LB_CFL_OFFICIAL_SHAPES_V1' "$BUILDER"; then
  [[ "$BUILDER_SHA" == "$AUDITED_BUILDER_SHA" ]] || {
    echo "ERREUR: build_dataset.py a changé depuis l'audit ($BUILDER_SHA)." >&2
    echo "Aucune modification appliquée." >&2
    exit 4
  }
fi
if ! grep -q 'LB_TECHNICAL_STOPS_V1' "$PREVIEW"; then
  [[ "$PREVIEW_SHA" == "$AUDITED_PREVIEW_SHA" ]] || {
    echo "ERREUR: la preview canonique a changé depuis l'audit ($PREVIEW_SHA)." >&2
    echo "Aucune modification appliquée." >&2
    exit 5
  }
fi

echo "=== 1/5 Patch durable du builder ==="
python3 - "$BUILDER" <<'PY'
from pathlib import Path
import sys

path=Path(sys.argv[1])
text=path.read_text(encoding="utf-8")
if "LB_CFL_OFFICIAL_SHAPES_V1" in text:
    print("builder déjà corrigé")
    raise SystemExit(0)

def rep(old,new,label):
    global text
    n=text.count(old)
    if n != 1:
        raise SystemExit(f"ancre builder {label}: {n} occurrence(s)")
    text=text.replace(old,new,1)

rep(
    "import re\nimport zipfile",
    "import re\nimport unicodedata\nimport zipfile",
    "import unicodedata"
)

rep(
    '        "trips.txt": ("route_id", "service_id", "trip_id"),\n'
    '        "stop_times.txt": ("trip_id", "stop_id"),',
    '        "trips.txt": ("route_id", "service_id", "trip_id", "shape_id"),\n'
    '        "stop_times.txt": ("trip_id", "stop_id"),\n'
    '        "shapes.txt": ("shape_id",),',
    "préfixage shape_id"
)

helpers = r'''
# LB_CFL_OFFICIAL_SHAPES_V1
# Les points techniques restent des ancres de routage mais ne sont jamais des
# arrêts commerciaux. Pour CFL, la géométrie GTFS shapes.txt est autoritaire.
_TECHNICAL_RAIL_TOKEN_RE = re.compile(
    r"(?:^|[^A-Z0-9])(?:FRONTIERE|FRONTIER|DOUANE|GRENZ)(?:$|[^A-Z0-9])"
)
_TECHNICAL_GR_RE = re.compile(r"(?:^|[-\s])GR\.?$")


def technical_name(value) -> bool:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    token = "".join(ch for ch in raw if not unicodedata.combining(ch)).upper().strip()
    if _TECHNICAL_RAIL_TOKEN_RE.search(token):
        return True
    return bool(_TECHNICAL_GR_RE.search(token))


def technical_stop_item(item, stops) -> bool:
    meta = item[3] if len(item) > 3 and isinstance(item[3], dict) else {}
    pickup = str(meta.get("pickup_type") or "0").strip()
    dropoff = str(meta.get("drop_off_type") or "0").strip()
    if pickup == "1" and dropoff == "1":
        return True
    stop = stops.get(item[1]) or {}
    return technical_name(stop.get("name"))


def build_gtfs_shapes(rows):
    shapes = defaultdict(list)
    for row in rows:
        shape_id = row.get("shape_id")
        if not shape_id:
            continue
        try:
            seq = int(row.get("shape_pt_sequence") or 0)
            coord = (float(row["shape_pt_lon"]), float(row["shape_pt_lat"]))
        except (KeyError, TypeError, ValueError):
            continue
        shapes[shape_id].append((seq, coord))
    return {
        shape_id: [coord for _seq, coord in sorted(values)]
        for shape_id, values in shapes.items()
        if len(values) >= 2
    }


def orient_shape(coords, sequence, stops):
    if not coords or len(coords) < 2 or len(sequence) < 2:
        return None
    first = stops.get(sequence[0][1])
    last = stops.get(sequence[-1][1])
    if not first or not last:
        return None
    forward = haversine(coords[0], first["coord"]) + haversine(coords[-1], last["coord"])
    reverse = haversine(coords[-1], first["coord"]) + haversine(coords[0], last["coord"])
    oriented = list(reversed(coords)) if reverse < forward else list(coords)
    if haversine(oriented[0], first["coord"]) > 4_000:
        return None
    if haversine(oriented[-1], last["coord"]) > 4_000:
        return None
    return oriented


def project_stop_offsets(coords, sequence, stops, max_snap=2_000.0):
    if len(coords) < 2:
        return None
    cumulative, _length = path_metrics(coords)
    cursor = 0
    offsets = []
    for item in sequence:
        stop = stops.get(item[1])
        if not stop:
            return None
        best_index = None
        best_distance = float("inf")
        for index in range(cursor, len(coords)):
            distance = haversine(stop["coord"], coords[index])
            if distance < best_distance:
                best_index, best_distance = index, distance
        if best_index is None or best_distance > max_snap:
            return None
        cursor = best_index
        offsets.append(cumulative[best_index])
    return offsets


def official_cfl_shape(meta, routing_sequence, stops, shapes):
    if meta.get("_feed") != "cfl":
        return None
    shape_id = meta.get("shape_id")
    coords = shapes.get(shape_id)
    if not coords:
        return None
    oriented = orient_shape(coords, routing_sequence, stops)
    if not oriented:
        return None
    if project_stop_offsets(oriented, routing_sequence, stops) is None:
        return None
    return oriented

'''
anchor = "\ndef path_metrics(coords):\n"
if anchor not in text:
    raise SystemExit("ancre builder path_metrics introuvable")
text=text.replace(anchor, "\n"+helpers+anchor, 1)

rep(
    '    stop_times_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "stop_times.txt")\n'
    '    calendar_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "calendar.txt")',
    '    stop_times_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "stop_times.txt")\n'
    '    shapes_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "shapes.txt")\n'
    '    calendar_rows = read_gtfs_feeds(args.gtfs, args.gtfs_cfl, "calendar.txt")',
    "lecture shapes"
)

rep(
    '        by_trip[row["trip_id"]].append((int(row.get("stop_sequence") or 0), row["stop_id"], time))\n\n'
    '    print("[4/6] Calcul des parcours uniques")',
    '        by_trip[row["trip_id"]].append((\n'
    '            int(row.get("stop_sequence") or 0), row["stop_id"], time,\n'
    '            {"pickup_type": row.get("pickup_type"), "drop_off_type": row.get("drop_off_type")}\n'
    '        ))\n'
    '    shapes_by_id = build_gtfs_shapes(shapes_rows)\n\n'
    '    print("[4/6] Calcul des parcours uniques")',
    "métadonnées stop_times"
)

rep(
    '        if len(sequence) < 2:\n'
    '            continue\n'
    '        meta = trip_meta[trip_id]',
    '        if len(sequence) < 2:\n'
    '            continue\n'
    '        routing_sequence = sequence\n'
    '        commercial_sequence = [item for item in routing_sequence if not technical_stop_item(item, stops)]\n'
    '        if len(commercial_sequence) < 2:\n'
    '            continue\n'
    '        meta = trip_meta[trip_id]',
    "séquence commerciale"
)

old = '''        else:
            full_coords, offsets = [], [0.0]
            ok = True
            for index in range(len(sequence) - 1):
                stop_a, stop_b = stops[sequence[index][1]], stops[sequence[index + 1][1]]
                cache_key = (sequence[index][1], sequence[index + 1][1], profile)
                nodes = pair_cache.get(cache_key)
                if nodes is None:
                    nodes = graph.route_between_coords(stop_a["coord"], stop_b["coord"], profile)
                    pair_cache[cache_key] = nodes
                if not nodes:
                    ok = False; failures += 1; break
                segment = simplify_collinear([graph.coords[node] for node in nodes])
                if full_coords and segment and full_coords[-1] == segment[0]: segment = segment[1:]
                previous_length = path_metrics(full_coords)[1] if len(full_coords) > 1 else 0.0
                full_coords.extend(segment)
                offsets.append(path_metrics(full_coords)[1] if len(full_coords) > 1 else previous_length)
            if not ok or len(full_coords) < 2:
                continue
            digest = hashlib.sha1(signature.encode()).hexdigest()[:16]
            path_id = f"p-{digest}"
            cumulative, length = path_metrics(full_coords)
            path_store[path_id] = {"coordinates": full_coords, "cumulative": cumulative, "length": length, "stopOffsets": offsets, "profile": profile}
            pattern_cache[signature] = path_id
'''
new = '''        else:
            full_coords = official_cfl_shape(meta, routing_sequence, stops, shapes_by_id)
            offsets = None
            path_source = None
            if full_coords:
                offsets = project_stop_offsets(full_coords, commercial_sequence, stops)
                path_source = "CFL_GTFS_SHAPE"
            if not full_coords or offsets is None:
                full_coords, routing_offsets = [], [0.0]
                ok = True
                for index in range(len(routing_sequence) - 1):
                    stop_a, stop_b = stops[routing_sequence[index][1]], stops[routing_sequence[index + 1][1]]
                    cache_key = (routing_sequence[index][1], routing_sequence[index + 1][1], profile)
                    nodes = pair_cache.get(cache_key)
                    if nodes is None:
                        nodes = graph.route_between_coords(stop_a["coord"], stop_b["coord"], profile)
                        pair_cache[cache_key] = nodes
                    if not nodes:
                        ok = False; failures += 1; break
                    segment = simplify_collinear([graph.coords[node] for node in nodes])
                    if full_coords and segment and full_coords[-1] == segment[0]: segment = segment[1:]
                    previous_length = path_metrics(full_coords)[1] if len(full_coords) > 1 else 0.0
                    full_coords.extend(segment)
                    routing_offsets.append(path_metrics(full_coords)[1] if len(full_coords) > 1 else previous_length)
                if not ok or len(full_coords) < 2:
                    continue
                route_pos = {item[1]: idx for idx, item in enumerate(routing_sequence)}
                offsets = [routing_offsets[route_pos[item[1]]] for item in commercial_sequence]
                path_source = "RAIL_GRAPH"
            digest = hashlib.sha1(signature.encode()).hexdigest()[:16]
            path_id = f"p-{digest}"
            cumulative, length = path_metrics(full_coords)
            path_store[path_id] = {
                "coordinates": full_coords, "cumulative": cumulative, "length": length,
                "stopOffsets": offsets, "profile": profile, "source": path_source
            }
            pattern_cache[signature] = path_id
'''
rep(old,new,"géométrie officielle CFL")

rep(
    '        stop_payload = [{\n'
    '            "name": stops[item[1]]["name"],\n'
    '            "displayTime": display_time(item[2]),\n'
    '            "lon": stops[item[1]]["coord"][0],\n'
    '            "lat": stops[item[1]]["coord"][1]\n'
    '        } for item in sequence]',
    '        stop_payload = [{\n'
    '            "name": stops[item[1]]["name"],\n'
    '            "displayTime": display_time(item[2]),\n'
    '            "lon": stops[item[1]]["coord"][0],\n'
    '            "lat": stops[item[1]]["coord"][1]\n'
    '        } for item in commercial_sequence]',
    "stops commerciaux"
)
rep(
    '            "pathId": path_id, "times": [item[2] for item in sequence], "offsets": offsets,',
    '            "pathId": path_id, "times": [item[2] for item in commercial_sequence], "offsets": offsets,',
    "temps commerciaux"
)

path.write_text(text, encoding="utf-8")
print("builder patché")
PY

python3 -m py_compile "$BUILDER"

echo "=== 2/5 Neutralisation des points techniques dans la preview ==="
python3 - "$PREVIEW" <<'PY'
from pathlib import Path
import sys

path=Path(sys.argv[1])
text=path.read_text(encoding="utf-8")
if "LB_TECHNICAL_STOPS_V1" in text:
    print("preview déjà corrigée")
    raise SystemExit(0)

def rep(old,new,label):
    global text
    n=text.count(old)
    if n != 1:
        raise SystemExit(f"ancre preview {label}: {n} occurrence(s)")
    text=text.replace(old,new,1)

helper=r'''
  /* LB_TECHNICAL_STOPS_V1
   * Les points de frontière/douane et les pass-points GTFS ne sont pas des
   * arrêts voyageurs : ils ne doivent ni s'afficher, ni déclencher une
   * suppression. Ils peuvent rester dans les données de routage côté serveur.
   */
  function isTechnicalRailStopName(value){
    const token = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (/(^|[^A-Z0-9])(FRONTIERE|FRONTIER|DOUANE|GRENZ)(?=$|[^A-Z0-9])/.test(token)) return true;
    return /(?:^|[-\s])GR\.?$/.test(token);
  }

  function isTechnicalRailStopTime(stopTime, stopMeta){
    const pickup = String(stopTime?.pickup_type ?? stopTime?.pickupType ?? '0');
    const dropoff = String(stopTime?.drop_off_type ?? stopTime?.dropOffType ?? stopTime?.dropoff_type ?? '0');
    if (pickup === '1' && dropoff === '1') return true;
    return isTechnicalRailStopName(stopMeta?.name);
  }

  function sanitizeTechnicalRailStopTimes(){
    let removed = 0;
    for (const [tripId, seq] of stopTimesByTrip.entries()){
      if (!Array.isArray(seq) || !seq.length) continue;
      const filtered = seq.filter(stopTime => {
        const meta = stopsById.get(stopTime?.stop_id);
        const technical = isTechnicalRailStopTime(stopTime, meta);
        if (technical) removed++;
        return !technical;
      });
      if (filtered.length !== seq.length){
        stopTimesByTrip.set(tripId, filtered);
        realtimeStopDataByTrip.delete(tripId);
        tripMergeSignatureCache.delete(tripId);
      }
    }
    if (removed) console.info(`[BER TECH] ${removed} point(s) technique(s) exclus des arrêts voyageurs`);
    return removed;
  }

'''
anchor = "  // ---------- État données ----------\n"
if anchor not in text:
    raise SystemExit("ancre preview état données introuvable")
text=text.replace(anchor, helper+anchor, 1)

rep(
    "      rebuildStaticMergeData();\n      prepareStationMetadata();\n      renderAxisStations();",
    "      sanitizeTechnicalRailStopTimes();\n      rebuildStaticMergeData();\n      prepareStationMetadata();\n      renderAxisStations();",
    "cache statique"
)

rep(
    "      await integrateCflGtfs({ axisStopIds, axisTripIds, axisRouteIds, mergeActiveServices });\n"
    "      const cflStopsAdded = Math.max(0, stopsById.size - stopsBeforeCfl);",
    "      await integrateCflGtfs({ axisStopIds, axisTripIds, axisRouteIds, mergeActiveServices });\n"
    "      sanitizeTechnicalRailStopTimes();\n"
    "      const cflStopsAdded = Math.max(0, stopsById.size - stopsBeforeCfl);",
    "fallback CFL"
)

rep(
    "        if (!stop || !stop.name) continue;\n        if (stop?.delay?.fresh === false) continue;",
    "        if (!stop || !stop.name) continue;\n"
    "        if (isTechnicalRailStopName(stop.name)) continue;\n"
    "        if (stop?.delay?.fresh === false) continue;",
    "loader V4"
)

path.write_text(text,encoding="utf-8")
print("preview patchée")
PY

echo "=== 3/5 Remplacement immédiat des chemins CFL par les shapes officielles ==="
python3 - "$TRIPS" "$PATHS" "$CFL_STATIC" "$MANIFEST" "$CFL_SHAPES" <<'PY'
import csv,json,math,os,re,sys,unicodedata
from pathlib import Path

trips_path=Path(sys.argv[1])
paths_path=Path(sys.argv[2])
static=Path(sys.argv[3])
manifest_path=Path(sys.argv[4])
shape_root=Path(sys.argv[5])

trips=json.loads(trips_path.read_text(encoding="utf-8"))
paths=json.loads(paths_path.read_text(encoding="utf-8"))
manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
trip_shapes=manifest.get("trips") or {}
if not isinstance(trips,dict) or not isinstance(paths,dict) or not isinstance(trip_shapes,dict):
    raise SystemExit("formats JSON inattendus")

EARTH=6371000.0
def hav(a,b):
    lat1,lon1=a; lat2,lon2=b
    p1,p2=math.radians(lat1),math.radians(lat2)
    dlat=p2-p1; dlon=math.radians(lon2-lon1)
    h=math.sin(dlat/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    return 2*EARTH*math.asin(min(1,math.sqrt(h)))

def norm_name(value):
    s=unicodedata.normalize("NFKD",str(value or ""))
    return "".join(ch for ch in s if not unicodedata.combining(ch)).upper().strip()

tech_token=re.compile(r"(?:^|[^A-Z0-9])(?:FRONTIERE|FRONTIER|DOUANE|GRENZ)(?:$|[^A-Z0-9])")
tech_gr=re.compile(r"(?:^|[-\s])GR\.?$")
def technical(name,row):
    if str(row.get("pickup_type") or "0").strip()=="1" and str(row.get("drop_off_type") or "0").strip()=="1":
        return True
    token=norm_name(name)
    return bool(tech_token.search(token) or tech_gr.search(token))

def sec(value):
    try:
        h,m,s=map(int,str(value).split(":"))
        return h*3600+m*60+s
    except Exception:
        return None

def display(value):
    s=sec(value)
    if s is None:return ""
    return f"{(s//3600)%24:02d}:{(s%3600)//60:02d}"

stops={}
with (static/"stops.txt").open(encoding="utf-8-sig",newline="") as f:
    for r in csv.DictReader(f):
        try:
            stops[str(r.get("stop_id") or "")]={
                "name":str(r.get("stop_name") or ""),
                "lat":float(r["stop_lat"]),"lon":float(r["stop_lon"])
            }
        except Exception:
            pass

wanted={str(k).split(":",1)[-1] for k,v in trips.items() if str((v or {}).get("source") or "").upper()=="CFL"}
rows={tid:[] for tid in wanted}
with (static/"stop_times.txt").open(encoding="utf-8-sig",newline="") as f:
    for r in csv.DictReader(f):
        tid=str(r.get("trip_id") or "")
        if tid not in rows: continue
        sid=str(r.get("stop_id") or "")
        meta=stops.get(sid)
        if not meta: continue
        try: sequence=int(r.get("stop_sequence") or 0)
        except Exception: sequence=0
        departure=sec(r.get("departure_time"))
        arrival=sec(r.get("arrival_time"))
        t=departure if departure is not None else arrival
        if t is None: continue
        rows[tid].append((sequence,sid,t,r,meta))
for tid in rows: rows[tid].sort(key=lambda x:x[0])

shape_cache={}
def get_shape(shape_id):
    if shape_id in shape_cache:return shape_cache[shape_id]
    p=shape_root/f"shape-{shape_id}.json"
    if not p.exists():
        shape_cache[shape_id]=None; return None
    raw=json.loads(p.read_text(encoding="utf-8"))
    coords=[]
    for c in raw.get("coords") or []:
        if isinstance(c,list) and len(c)>=2:
            try: coords.append((float(c[0]),float(c[1])))
            except Exception: pass
    shape_cache[shape_id]=coords if len(coords)>=2 else None
    return shape_cache[shape_id]

def cumulative(latlon):
    out=[0.0]; total=0.0
    for a,b in zip(latlon,latlon[1:]):
        total+=hav(a,b); out.append(round(total,2))
    return out,total

def project(latlon, commercial):
    cum,total=cumulative(latlon)
    cursor=0; offsets=[]; indices=[]
    for _seq,_sid,_time,_row,meta in commercial:
        target=(meta["lat"],meta["lon"])
        best_i=None; best_d=float("inf")
        for i in range(cursor,len(latlon)):
            d=hav(target,latlon[i])
            if d<best_d:
                best_i,best_d=i,d
        if best_i is None or best_d>2000:
            return None
        cursor=best_i
        offsets.append(cum[best_i]); indices.append(best_i)
    return offsets,indices,cum,total

fixed=0
technical_removed=0
shape_paths={}
fixed_86563=[]
for trip_id,trip in trips.items():
    if not isinstance(trip,dict) or str(trip.get("source") or "").upper()!="CFL":
        continue
    raw_id=str(trip_id).split(":",1)[-1]
    seq=rows.get(raw_id) or []
    if len(seq)<2: continue
    commercial=[]
    for item in seq:
        if technical(item[4]["name"],item[3]):
            technical_removed+=1
        else:
            commercial.append(item)
    if len(commercial)<2: continue
    shape_id=str(trip_shapes.get(raw_id) or "")
    shape=get_shape(shape_id) if shape_id else None
    oriented=None
    indices=None
    offsets=None

    if shape:
        first=(commercial[0][4]["lat"],commercial[0][4]["lon"])
        last=(commercial[-1][4]["lat"],commercial[-1][4]["lon"])
        fwd=hav(shape[0],first)+hav(shape[-1],last)
        rev=hav(shape[-1],first)+hav(shape[0],last)
        reversed_shape=rev<fwd
        candidate=list(reversed(shape)) if reversed_shape else list(shape)
        if hav(candidate[0],first)<=4000 and hav(candidate[-1],last)<=4000:
            projection=project(candidate,commercial)
            if projection:
                offsets,indices,cum,total=projection
                oriented=candidate
                suffix="r" if reversed_shape else "f"
                new_path_id=f"cfl-official-{shape_id}-{suffix}"
                if new_path_id not in shape_paths:
                    shape_paths[new_path_id]={
                        "coordinates":[[lon,lat] for lat,lon in oriented],
                        "cumulative":cum,
                        "length":round(total,2),
                        "profile":"cfl",
                        "source":"CFL_GTFS_SHAPE"
                    }
                trip["pathId"]=new_path_id
                trip["pathSource"]="CFL_GTFS_SHAPE"
                fixed+=1

    if offsets is None:
        current_path=paths.get(trip.get("pathId")) or {}
        coords=current_path.get("coordinates") or []
        fallback_latlon=[]
        for c in coords:
            if isinstance(c,list) and len(c)>=2:
                try: fallback_latlon.append((float(c[1]),float(c[0])))
                except Exception: pass
        projection=project(fallback_latlon,commercial) if len(fallback_latlon)>=2 else None
        if projection:
            offsets,indices,_cum,_total=projection
            oriented=fallback_latlon
        else:
            old_stops=trip.get("stops") or []
            old_times=trip.get("times") or []
            old_offsets=trip.get("offsets") or []
            keep=[]
            for idx,s in enumerate(old_stops):
                name=str((s or {}).get("name") or "")
                if technical(name,{}): continue
                keep.append(idx)
            if len(keep)>=2 and len(old_times)==len(old_stops) and len(old_offsets)==len(old_stops):
                trip["stops"]=[old_stops[i] for i in keep]
                trip["times"]=[old_times[i] for i in keep]
                trip["offsets"]=[old_offsets[i] for i in keep]
                trip["technicalStopsExcluded"]=max(
                    int(trip.get("technicalStopsExcluded") or 0),
                    len(old_stops)-len(keep)
                )
                continue
            continue

    trip["times"]=[item[2] for item in commercial]
    trip["offsets"]=[round(float(v),2) for v in offsets]
    trip["stops"]=[{
        "name":item[4]["name"],
        "displayTime":display(item[3].get("departure_time") or item[3].get("arrival_time")),
        "lon":item[4]["lon"],"lat":item[4]["lat"]
    } for item in commercial]
    trip["technicalStopsExcluded"]=sum(1 for item in seq if technical(item[4]["name"],item[3]))

    number=str(trip.get("number") or trip.get("displayLabel") or "")
    if (re.sub(r"\D","",number)=="86563" or raw_id in ("24331941","24331953")) and trip.get("pathSource")=="CFL_GTFS_SHAPE":
        names=[item[4]["name"] for item in commercial]
        fixed_86563.append((raw_id,names,oriented,indices))

paths.update(shape_paths)

if not fixed_86563:
    raise SystemExit("validation: aucun trajet 86563 corrigé dans data/generated")
for raw_id,names,shape,indices in fixed_86563:
    if "Hollerich, Gare" not in names or "Luxembourg, Gare Centrale" not in names:
        raise SystemExit(f"validation 86563 {raw_id}: Hollerich/Luxembourg absents")
    for name in names:
        if tech_token.search(norm_name(name)) or tech_gr.search(norm_name(name)):
            raise SystemExit(f"validation 86563 {raw_id}: point technique visible: {name}")
    hi=names.index("Hollerich, Gare"); li=names.index("Luxembourg, Gare Centrale")
    a,b=sorted((indices[hi],indices[li]))
    howald=(49.58032,6.13232)
    min_howald=min(hav(p,howald) for p in shape[a:b+1])
    if min_howald < 900:
        raise SystemExit(f"validation 86563 {raw_id}: shape passe anormalement près de Howald ({min_howald:.0f} m)")
    print(f"86563 {raw_id}: OK · {len(names)} arrêts commerciaux · Howald min={min_howald:.0f}m")

def atomic_json(path,obj):
    tmp=path.with_name(path.name+".tmp-routing")
    tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    os.replace(tmp,path)

atomic_json(paths_path,paths)
atomic_json(trips_path,trips)
print(f"CFL: {fixed} trajets basculés sur shape officiel · {technical_removed} occurrences techniques retirées · {len(shape_paths)} paths officiels")
PY

python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys,re,unicodedata
trips=json.load(open(sys.argv[1],encoding="utf-8"))
paths=json.load(open(sys.argv[2],encoding="utf-8"))
bad=[]
found=[]
def norm(v):
    s=unicodedata.normalize("NFKD",str(v or ""))
    return "".join(ch for ch in s if not unicodedata.combining(ch)).upper()
rx=re.compile(r"(?:^|[^A-Z0-9])(FRONTIERE|FRONTIER|DOUANE|GRENZ)(?:$|[^A-Z0-9])|(?:^|[-\s])GR\.?$",re.I)
for tid,t in trips.items():
    if str((t or {}).get("source") or "").upper()!="CFL": continue
    for s in t.get("stops") or []:
        if rx.search(norm(s.get("name"))):
            bad.append((tid,s.get("name")))
    num=re.sub(r"\D","",str(t.get("number") or t.get("displayLabel") or ""))
    if num=="86563":
        found.append((tid,t))
assert not bad, bad[:20]
assert found, "86563 absent après correction"
assert any(str(t.get("pathSource"))=="CFL_GTFS_SHAPE" for _,t in found), found
for tid,t in found:
    if t.get("pathSource")=="CFL_GTFS_SHAPE":
        assert t.get("pathId") in paths, (tid,t.get("pathId"))
print("validation generated: OK")
PY

echo "=== 4/5 Vérifications preview + service ==="
grep -q 'LB_CANONICAL_MAP_PREVIEW_V1' "$PREVIEW"
grep -q 'LB_TECHNICAL_STOPS_V1' "$PREVIEW"
grep -q 'sanitizeTechnicalRailStopTimes();' "$PREVIEW"
grep -q 'CFL_GTFS_SHAPE' "$BUILDER"

systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 8 "http://127.0.0.1:3111/" >/dev/null

echo "=== 5/5 Contrôle final : production HTML inchangée ==="
PROD="$ROOT/public/carte-core-preview.html"
if [[ -f "$PROD" ]]; then
  PROD_SHA="$(sha256sum "$PROD" | awk '{print $1}')"
  echo "carte-core-preview.html: $PROD_SHA"
  [[ "$PROD_SHA" == "40fc7a535b0066fae263a003f21d0ff900783dcc3226ccce72a8524def59f535" ]] || {
    echo "ATTENTION: la production avait changé indépendamment; elle n'a pas été modifiée par ce script."
  }
fi

SUCCESS=1
echo
echo "============================================================"
echo "CORRECTION OK"
echo "- CFL : shapes GTFS officiels prioritaires dans data/generated"
echo "- 86563 : chemin validé Hollerich -> Luxembourg, pas Howald"
echo "- points frontière/douane/Gr. : exclus des arrêts voyageurs"
echo "- builder corrigé pour les prochains rebuilds"
echo "- preview canonique corrigée"
echo "- carte de production HTML non modifiée"
echo "Backup : $BACKUP"
echo "============================================================"
