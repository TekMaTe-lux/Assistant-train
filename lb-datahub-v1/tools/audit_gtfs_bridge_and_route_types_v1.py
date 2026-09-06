#!/usr/bin/env python3
"""Read-only audit for LB Rail Engine.

Goals:
- explain which current lite-cache trips are SNCF/CFL/other and why raw GTFS matching misses some;
- inspect SNCF route_type 0/2/3 before treating the whole SNCF feed as rail;
- never modify production data.
"""
from __future__ import annotations

import csv
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

ROOT = Path('/opt/labetaillere-map-v2-src/map-v2')
SNCF = ROOT/'data/sources/sncf-gtfs.zip'
LUX = ROOT/'data/sources/lux-gtfs.zip'
LITE = ROOT/'public/data/carte_static_lite_today.json'


def rows(z: ZipFile, name: str):
    member = next((n for n in z.namelist() if n.rsplit('/',1)[-1].lower()==name.lower()), None)
    if not member:
        return []
    return csv.DictReader(io.TextIOWrapper(z.open(member), encoding='utf-8-sig', newline=''))


def load_feed(path: Path):
    with ZipFile(path) as z:
        routes = {}
        route_types = Counter()
        type_samples = defaultdict(list)
        for r in rows(z, 'routes.txt'):
            rid = str(r.get('route_id') or '').strip()
            typ = str(r.get('route_type') or '').strip()
            routes[rid] = r
            route_types[typ or '<vide>'] += 1
            if len(type_samples[typ or '<vide>']) < 12:
                type_samples[typ or '<vide>'].append({
                    'route_id': rid,
                    'short': r.get('route_short_name') or '',
                    'long': r.get('route_long_name') or '',
                    'agency_id': r.get('agency_id') or '',
                })
        trips = {}
        for t in rows(z, 'trips.txt'):
            tid = str(t.get('trip_id') or '').strip()
            if tid:
                trips[tid] = {
                    'route_id': str(t.get('route_id') or '').strip(),
                    'service_id': str(t.get('service_id') or '').strip(),
                    'headsign': str(t.get('trip_headsign') or '').strip(),
                    'short_name': str(t.get('trip_short_name') or '').strip(),
                }
        return routes, route_types, type_samples, trips


sncf_routes, sncf_types, sncf_samples, sncf_trips = load_feed(SNCF)
lu_routes, lu_types, lu_samples, lu_trips = load_feed(LUX)

payload = json.loads(LITE.read_text(encoding='utf-8'))
data = payload.get('data') or {}
lite = {
    str(p[0]): (p[1] if isinstance(p[1], dict) else {})
    for p in (data.get('tripsById') or [])
    if isinstance(p, list) and len(p) == 2
}

print('========================================')
print(' AUDIT GTFS BRIDGE + ROUTE TYPES')
print('========================================')
print('date cache :', payload.get('date'))
print('lite trips :', len(lite))

print('\n=== SOURCE FIELD DANS LE CACHE LITE ===')
source_counts = Counter(str(v.get('source') or '<absent>') for v in lite.values())
for k,n in source_counts.most_common():
    print(f'{k!r}: {n}')

sncf_exact = {tid for tid in lite if tid in sncf_trips}
lu_exact = {tid for tid in lite if tid in lu_trips}
lu_prefixed = {
    tid for tid in lite
    if (tid.lower().startswith('cfl:') and tid.split(':',1)[1] in lu_trips)
}

print('\n=== MATCH IDS BRUTS ===')
print('SNCF exact        :', len(sncf_exact))
print('LU exact          :', len(lu_exact))
print('LU préfixe cfl:   :', len(lu_prefixed))

missing = set(lite) - sncf_exact - lu_exact - lu_prefixed
print('non couverts      :', len(missing))

missing_sources = Counter(str(lite[tid].get('source') or '<absent>') for tid in missing)
print('\nnon couverts par source:')
for k,n in missing_sources.most_common():
    print(f'  {k!r}: {n}')

print('\n=== EXEMPLES NON COUVERTS ===')
for tid in sorted(missing)[:30]:
    o = lite[tid]
    print('ID=', tid)
    print('   source=', repr(o.get('source')), 'headsign=', repr(o.get('headsign')), 'short=', repr(o.get('trip_short_name')), 'service=', repr(o.get('service_id')))

print('\n=== SNCF ROUTE TYPES ===')
print(dict(sncf_types))
for typ in sorted(sncf_samples):
    print(f'\nroute_type={typ!r} exemples:')
    for x in sncf_samples[typ]:
        print(' ', x)

print('\n=== LU ROUTE TYPES ===')
print(dict(lu_types))
for typ in sorted(lu_samples):
    if typ in {'0','2','3','100','101','102','103','104','105','106','107','108','109','110','111','112','113','114','115','116','117'}:
        print(f'\nroute_type={typ!r} exemples:')
        for x in lu_samples[typ][:8]:
            print(' ', x)

print('\n=== SNCF LITE NON MATCHES MAIS SANS SOURCE CFL ===')
likely_fr_missing = [tid for tid in missing if str(lite[tid].get('source') or '').lower() not in {'cfl','lu','luxembourg'}]
print('nombre :', len(likely_fr_missing))
for tid in sorted(likely_fr_missing)[:30]:
    o=lite[tid]
    print(' ', tid, '|', o.get('headsign'), '|', o.get('trip_short_name'), '|', o.get('service_id'))

print('\nAUDIT TERMINE — AUCUNE MODIFICATION')
