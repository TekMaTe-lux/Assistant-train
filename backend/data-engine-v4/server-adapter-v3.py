#!/usr/bin/env python3
"""La Bétaillère Data Engine V4 — adapter v3.

- conserve l'adaptation SNCF v2 ;
- ajoute les routes /api/v4/stations, /api/v4/stations/<gare> et /api/v4/map ;
- ne modifie aucune règle métier de retard/plateforme/composition du core.
"""
import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

V2 = Path(__file__).with_name('server-adapter-v2.py')
spec = importlib.util.spec_from_file_location('lb_data_v4_adapter_v2', V2)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
core = v2.core

_original_do_get = core.Handler.do_GET


def station_rows(snapshot, station_id):
    wanted = core.canonical_station(urllib.parse.unquote(str(station_id or '')))
    rows = []
    for train in (snapshot or {}).get('trains', []):
        for stop in train.get('stops') or []:
            if core.canonical_station(stop.get('name')) != wanted:
                continue
            rows.append({
                'number': train.get('number'),
                'operator': train.get('operator'),
                'line': train.get('line'),
                'origin': train.get('origin'),
                'destination': train.get('destination'),
                'status': train.get('status'),
                'delayMinutes': stop.get('delayMinutes'),
                'cancelled': bool(stop.get('cancelled') or train.get('cancelled')),
                'partial': bool(train.get('partial')),
                'platform': stop.get('platform'),
                'delaySource': stop.get('delaySource'),
                'composition': train.get('composition'),
                'occupancy': train.get('occupancy'),
                'live': train.get('live'),
                'position': train.get('position'),
                'stop': stop,
                'updatedAt': train.get('updatedAt'),
            })
            break
    rows.sort(key=lambda row: (str(row.get('number') or '')))
    return rows


def station_catalog(snapshot):
    catalog = {}
    for train in (snapshot or {}).get('trains', []):
        for stop in train.get('stops') or []:
            name = str(stop.get('name') or '').strip()
            key = core.canonical_station(name)
            if not key:
                continue
            entry = catalog.setdefault(key, {'id': key, 'name': name, 'trainCount': 0})
            entry['trainCount'] += 1
    return sorted(catalog.values(), key=lambda item: item['name'].casefold())


def map_payload(snapshot):
    trains = []
    for train in (snapshot or {}).get('trains', []):
        trains.append({
            'id': train.get('id'),
            'number': train.get('number'),
            'operator': train.get('operator'),
            'line': train.get('line'),
            'origin': train.get('origin'),
            'destination': train.get('destination'),
            'status': train.get('status'),
            'delayMinutes': train.get('delayMinutes'),
            'cancelled': train.get('cancelled'),
            'partial': train.get('partial'),
            'live': train.get('live'),
            'position': train.get('position'),
            'composition': train.get('composition'),
            'occupancy': train.get('occupancy'),
            'provenance': train.get('provenance'),
            'updatedAt': train.get('updatedAt'),
        })
    return {
        'apiVersion': 4,
        'updatedAt': (snapshot or {}).get('updatedAt'),
        'stale': bool((snapshot or {}).get('stale')),
        'trains': trains,
        'meta': {
            'trainCount': len(trains),
            'positionCount': sum(1 for train in trains if train.get('position')),
        },
    }


def patched_do_get(self):
    parsed = urllib.parse.urlsplit(self.path)
    path = parsed.path.rstrip('/') or '/'
    try:
        if path == '/api/v4/stations' or path.startswith('/api/v4/stations/') or path == '/api/v4/map':
            snapshot, error = core.get_snapshot()
            snapshot = snapshot or {'apiVersion': 4, 'trains': []}
            if path == '/api/v4/stations':
                self.send_json(200, {
                    'apiVersion': 4,
                    'updatedAt': snapshot.get('updatedAt'),
                    'stations': station_catalog(snapshot),
                })
                return
            if path.startswith('/api/v4/stations/'):
                station_id = path.split('/api/v4/stations/', 1)[1]
                rows = station_rows(snapshot, station_id)
                self.send_json(200, {
                    'apiVersion': 4,
                    'updatedAt': snapshot.get('updatedAt'),
                    'station': urllib.parse.unquote(station_id),
                    'trains': rows,
                    'meta': {'trainCount': len(rows), 'error': error},
                })
                return
            self.send_json(200, map_payload(snapshot))
            return
        return _original_do_get(self)
    except Exception as exc:
        self.send_json(500, {'apiVersion': 4, 'error': str(exc)})


core.Handler.do_GET = patched_do_get


def adapter_v3_fixture_test():
    snapshot = v2.patched_build({
        'sncfRt': {
            '88742': {
                'train_number': '88742',
                'status': 'ON_TIME',
                'position': {'lat': 49.6, 'lon': 6.1},
                'stops': {'Metz': 0, 'Thionville': 2, 'Luxembourg': 3},
            }
        },
        'cflRt': {}, 'cflArrivals': {}, 'traffic': {}, 'compositions': {}
    }, [])
    stations = station_catalog(snapshot)
    lux = station_rows(snapshot, 'Luxembourg')
    mapped = map_payload(snapshot)
    assert any(item['id'] == 'luxembourg' for item in stations)
    assert len(lux) == 1 and lux[0]['number'] == '88742'
    assert mapped['meta']['trainCount'] == 1
    assert mapped['meta']['positionCount'] == 1
    print(json.dumps({'ok': True, 'adapter': 'v3', 'stations': len(stations)}, ensure_ascii=False))


if __name__ == '__main__':
    if '--adapter-v3-fixture-test' in sys.argv:
        adapter_v3_fixture_test()
        raise SystemExit(0)
    if '--adapter-fixture-test' in sys.argv:
        v2.adapter_fixture_test()
        raise SystemExit(0)
    core.main()
