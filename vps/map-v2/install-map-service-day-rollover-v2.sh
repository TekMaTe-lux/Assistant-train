#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
BUILDER="$ROOT/map-v2/scripts/build-map-lite-cache.py"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"

[[ -f "$CORE" ]] || { echo "ERREUR: carte absente: $CORE" >&2; exit 2; }
[[ -f "$BUILDER" ]] || { echo "ERREUR: générateur absent: $BUILDER" >&2; exit 2; }

cp -a "$CORE" "$CORE.bak-service-day-rollover-v2-$STAMP"
cp -a "$BUILDER" "$BUILDER.bak-service-day-rollover-v2-$STAMP"

python3 - "$BUILDER" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
if 'LB_SERVICE_DAY_CACHE_WINDOW_V2' in s:
    print('Générateur V2 déjà installé.')
    raise SystemExit(0)

s = s.replace('from datetime import datetime, timezone', 'from datetime import date, datetime, timedelta, timezone')

anchor = '\n\ndef main():\n'
helper = r'''

# LB_SERVICE_DAY_CACHE_WINDOW_V2
WEEKDAY_FIELDS = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
GTFS_ROOT = Path('/var/www/html/gtfs/static')
CFL_ROOT = GTFS_ROOT / 'CFL'

def parse_csv_rows(path):
    import csv
    if not path.exists():
        return []
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))

def active_for_day(root, service_day, cfl=False):
    calendar_name = 'calendarcfl.txt' if cfl else 'calendar.txt'
    dates_name = 'calendar_datescfl.txt' if cfl else 'calendar_dates.txt'
    calendar = parse_csv_rows(root / calendar_name)
    exceptions = parse_csv_rows(root / dates_name)
    if cfl and not calendar:
        calendar = parse_csv_rows(root / 'calendar.txt')
    if cfl and not exceptions:
        exceptions = parse_csv_rows(root / 'calendar_dates.txt')
    compact = service_day.strftime('%Y%m%d')
    weekday = WEEKDAY_FIELDS[service_day.weekday()]
    active = set()
    for row in calendar:
        svc = row.get('service_id')
        if not svc or (row.get('start_date') and row['start_date'] > compact) or (row.get('end_date') and row['end_date'] < compact):
            continue
        if str(row.get(weekday)) == '1':
            active.add(svc)
    for row in exceptions:
        if row.get('date') != compact or not row.get('service_id'):
            continue
        if str(row.get('exception_type')) == '1':
            active.add(row['service_id'])
        elif str(row.get('exception_type')) == '2':
            active.discard(row['service_id'])
    if cfl:
        active = {f'CFL:{svc}' for svc in active}
    return active

def service_window(payload_date):
    center = date.fromisoformat(payload_date)
    result = {}
    for delta in (-1, 0, 1):
        day = center + timedelta(days=delta)
        result[day.isoformat()] = active_for_day(GTFS_ROOT, day) | active_for_day(CFL_ROOT, day, True)
    return result
'''
if anchor not in s:
    raise SystemExit('ERREUR: point main() introuvable')
s = s.replace(anchor, helper + anchor, 1)

old = '''    active_services = set(
        str(value)
        for value in (
            data.get("activeServiceIds") or []
        )
    )'''
new = '''    current_services = set(str(value) for value in (data.get("activeServiceIds") or []))
    payload_date = str(payload.get("date") or datetime.now(timezone.utc).date().isoformat())
    service_days = service_window(payload_date)
    if current_services:
        service_days[payload_date] = current_services
    active_services = set().union(*service_days.values())'''
if s.count(old) != 1:
    raise SystemExit('ERREUR: filtre services attendu absent')
s = s.replace(old, new, 1)

old_result = '''        "date": payload.get("date"),
        "counters": {'''
new_result = '''        "date": payload_date,
        "service_days": [
            {"date": day, "activeServiceIds": sorted(services)}
            for day, services in sorted(service_days.items())
        ],
        "counters": {'''
if s.count(old_result) != 1:
    raise SystemExit('ERREUR: résultat attendu absent')
s = s.replace(old_result, new_result, 1)
p.write_text(s, encoding='utf-8')
PY

python3 - "$CORE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
if 'LB_SERVICE_DAY_ROLLOVER_V2' in s:
    print('Carte V2 déjà installée.')
    raise SystemExit(0)

# Retire le correctif V1 lorsqu'il est présent : V2 calcule le temps par trajet.
start = s.find('  // LB_SERVICE_DAY_ROLLOVER_V1')
if start >= 0:
    end = s.find('\n\n  function lbHydrateMapFromEntries', start)
    if end < 0: raise SystemExit('ERREUR: fin V1 introuvable')
    s = s[:start] + s[end+2:]

old_now_start = s.find('function nowSecLocal(){')
old_now_end = s.find('\n  function fmtMinSec', old_now_start)
if old_now_start < 0 or old_now_end < 0:
    raise SystemExit('ERREUR: nowSecLocal introuvable')
s = s[:old_now_start] + """function nowSecLocal(){
    const d = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone:'Europe/Luxembourg', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
      }).formatToParts(d).reduce((out, part) => (out[part.type] = part.value, out), {});
      const hour = Number(parts.hour) % 24;
      return hour*3600 + Number(parts.minute)*60 + Number(parts.second);
    } catch(_) {
      return d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds();
    }
  }""" + s[old_now_end:]

anchor = '''  function lbHydrateMapFromEntries(targetMap, entries, mapName){'''
helper = r'''  // LB_SERVICE_DAY_ROLLOVER_V2
  function lbServiceDayDiff(fromDate, toDate){
    const from = Date.parse(String(fromDate) + 'T12:00:00Z');
    const to = Date.parse(String(toDate) + 'T12:00:00Z');
    return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to-from)/86400000) : 0;
  }
  function lbNowForServiceDate(civilNowSec, serviceDate){
    return civilNowSec + lbServiceDayDiff(serviceDate, lbCarteTodayIso()) * 86400;
  }
  function lbRuntimeTripId(serviceDate, tripId){ return `${serviceDate}::${tripId}`; }
  function lbOriginalTripId(runtimeTripId, trip){
    return String(trip?.original_trip_id || runtimeTripId).replace(/^\d{4}-\d{2}-\d{2}::/, '');
  }

'''
if s.count(anchor) != 1: raise SystemExit('ERREUR: helper hydratation introuvable')
s = s.replace(anchor, helper + anchor, 1)

old_hydrate = '''      lbHydrateMapFromEntries(stopTimesByTrip, d.stopTimesByTrip, 'stopTimesByTrip');
      lbHydrateMapFromEntries(tripsById, d.tripsById, 'tripsById');'''
new_hydrate = '''      const lbTripMeta = new Map(d.tripsById);
      const lbServiceDays = Array.isArray(payload.service_days) && payload.service_days.length
        ? payload.service_days
        : [{ date:String(payload.date || today), activeServiceIds:d.activeServiceIds || [] }];
      for (const day of lbServiceDays){
        const serviceDate = String(day.date || '');
        const services = new Set(day.activeServiceIds || []);
        for (const pair of d.stopTimesByTrip){
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const originalTripId = pair[0];
          const meta = lbTripMeta.get(originalTripId) || {};
          if (services.size && !services.has(String(meta.service_id || ''))) continue;
          const runtimeTripId = lbRuntimeTripId(serviceDate, originalTripId);
          stopTimesByTrip.set(runtimeTripId, pair[1]);
          tripsById.set(runtimeTripId, { ...meta, service_date:serviceDate, original_trip_id:originalTripId });
        }
      }'''
if s.count(old_hydrate) != 1: raise SystemExit('ERREUR: hydratation trips inattendue')
s = s.replace(old_hydrate, new_hydrate, 1)

old_active = '''      activeServiceIds = Array.isArray(d.activeServiceIds) && d.activeServiceIds.length
        ? new Set(d.activeServiceIds)
        : null;'''
if s.count(old_active) != 1: raise SystemExit('ERREUR: activeServiceIds inattendu')
s = s.replace(old_active, '''      // Les trajets sont déjà filtrés et datés lors de l'hydratation.
      activeServiceIds = null;''', 1)

loop_anchor = '''      const trip = tripsById.get(trip_id) || {};
      const route = routesById.get(trip.route_id) || {};'''
loop_new = '''      const trip = tripsById.get(trip_id) || {};
      const nowSec = lbNowForServiceDate(lbCivilNowSec, trip.service_date || lbCarteTodayIso());
      const originalTripId = lbOriginalTripId(trip_id, trip);
      const route = routesById.get(trip.route_id) || {};'''
if s.count(loop_anchor) < 1: raise SystemExit('ERREUR: boucle trainsAt introuvable')
# Seulement la première occurrence après trainsAt.
pos = s.find('  function trainsAt(nowSec)')
brace = s.find('{', pos)
if brace < 0: raise SystemExit('ERREUR: ouverture trainsAt introuvable')
s = s[:brace+1] + '\n    const lbCivilNowSec = nowSec;' + s[brace+1:]
pos = s.find('  function trainsAt(nowSec)')
hit = s.find(loop_anchor, pos)
if hit < 0: raise SystemExit('ERREUR: trip trainsAt introuvable')
s = s[:hit] + loop_new + s[hit+len(loop_anchor):]

rt_old = '''        trip_id,
        seq,
        numberKey,'''
rt_new = '''        originalTripId,
        seq,
        numberKey,'''
hit = s.find(rt_old, pos)
if hit < 0: raise SystemExit('ERREUR: appel temps réel introuvable')
s = s[:hit] + rt_new + s[hit+len(rt_old):]

# Le manifest CFL doit recevoir l'identifiant GTFS d'origine.
cfl_old = "      const rawTripId = id.replace(/^CFL:/i, '');"
cfl_new = "      const rawTripId = lbOriginalTripId(routeTripId, tripsById.get(routeTripId)).replace(/^CFL:/i, '');"
if cfl_old in s: s = s.replace(cfl_old, cfl_new, 1)

p.write_text(s, encoding='utf-8')
PY

python3 -m py_compile "$BUILDER"
python3 - "$CORE" <<'PY'
import re, subprocess, sys, tempfile
text=open(sys.argv[1], encoding='utf-8').read()
scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script\s*>', text, flags=re.I|re.S)
for index, source in enumerate(scripts, 1):
    if not source.strip():
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8') as stream:
        stream.write(source)
        stream.flush()
        result=subprocess.run(['node','--check',stream.name], text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(f'ERREUR syntaxe script HTML #{index}:\n{result.stderr}')
print(f'Syntaxe JavaScript OK: {len(scripts)} blocs contrôlés')
PY
if [[ "${LB_SKIP_BUILD:-0}" != "1" ]]; then
  python3 "$BUILDER"
fi

if [[ "${LB_SKIP_BUILD:-0}" != "1" ]]; then
python3 - "$ROOT/map-v2/public/data/carte_static_lite_today.json" <<'PY'
import json, sys
p=json.load(open(sys.argv[1], encoding='utf-8'))
days=p.get('service_days') or []
assert len(days) == 3, days
assert p.get('date') in {d.get('date') for d in days}
assert all(isinstance(d.get('activeServiceIds'), list) for d in days)
print('Cache J-1/J/J+1 OK:', [(d['date'], len(d['activeServiceIds'])) for d in days])
PY
fi

grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE"
grep -q 'service_date::trip_id' "$CORE" || true
! grep -q 'sec += 86400' "$CORE"

echo "Installation LB_SERVICE_DAY_ROLLOVER_V2 terminée."
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "Aucun timer frontend, aucun reload, aucun fetch à minuit."
