#!/usr/bin/env python3
import argparse, copy, hashlib, json, math, os, re, shutil, sys, tempfile, unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get('MOORAIL_ROOT', '/opt/labetaillere-map-v2-src/map-v2'))
STATE = ROOT / 'data/route-editor/moorail-route-editor-state-v1.json'
TRIPS = ROOT / 'data/generated/trips.json'
PATHS = ROOT / 'data/generated/paths.json'
SERVICE = 'labetaillere-map-v2.service'
SOURCE = 'MOORAIL_VALIDATED_V4'
REPORT = ROOT / 'data/route-editor/moorail-compile-preview-v2.json'


def load(path):
    with path.open(encoding='utf-8') as f:
        return json.load(f)


def atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=str(path.parent))
    os.close(fd)
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass


def norm(s):
    s = unicodedata.normalize('NFKD', str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()


def pair_key(a, b):
    return norm(a) + '\0' + norm(b)


def fnv1a(text):
    h = 0x811c9dc5
    for ch in str(text):
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}'


def high_speed_trip(t):
    dump = ' '.join(str(t.get(k) or '') for k in ('category','routeName','routeShortName','id')).upper()
    return bool(re.search(r'(^|[^A-Z])(TGV|OUIGO|LYRIA|ICE|AVR|TRENITALIA|FRECCIAROSSA|OUI|OGO|TRN)([^A-Z]|$)', dump))


def signature_of_trip(t):
    return ' → '.join(str(s.get('name') or 'Gare') for s in (t.get('stops') or []))


def route_id_for_signature(sig):
    return 'r-' + fnv1a(sig)


def dist_m(a, b):
    lon1, lat1 = map(float, a[:2]); lon2, lat2 = map(float, b[:2])
    R = 6371000.0
    p1 = math.radians(lat1); p2 = math.radians(lat2)
    dp = math.radians(lat2-lat1); dl = math.radians(lon2-lon1)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.atan2(math.sqrt(x), math.sqrt(max(0.0, 1-x)))


def metrics(coords):
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + dist_m(coords[i-1], coords[i]))
    return cum, (cum[-1] if cum else 0.0)


def clean_coords(raw):
    out = []
    for c in raw or []:
        if not isinstance(c, (list, tuple)) or len(c) < 2: continue
        try: p = [float(c[0]), float(c[1])]
        except Exception: continue
        if not all(math.isfinite(x) for x in p): continue
        if not out or dist_m(out[-1], p) > 0.05: out.append(p)
    return out


def latest(a, b):
    if a is None: return b
    if b is None: return a
    return b if str(b.get('updatedAt') or '') >= str(a.get('updatedAt') or '') else a


def build_shared_library(state_sections):
    lib = {}
    for sid, sec in (state_sections or {}).items():
        if not sec or sec.get('status') != 'validated': continue
        frm = (sec.get('stopFrom') or {}).get('name')
        to = (sec.get('stopTo') or {}).get('name')
        coords = clean_coords(sec.get('coordinates'))
        if not frm or not to or len(coords) < 2: continue
        base = {
            'sectionId': sid,
            'updatedAt': sec.get('updatedAt'),
            'from': frm,
            'to': to,
            'coords': coords,
            'waypoints': sec.get('waypoints') or [],
            'distanceKm': sec.get('distanceKm'),
            'reversed': False,
        }
        k = pair_key(frm, to)
        lib[k] = latest(lib.get(k), base)
        rev = dict(base)
        rev['coords'] = list(reversed(coords))
        rev['waypoints'] = list(reversed(base['waypoints']))
        rev['reversed'] = True
        rk = pair_key(to, frm)
        lib[rk] = latest(lib.get(rk), rev)
    return lib


def assemble_stops(stops, lib):
    if len(stops) < 2: return None, ['moins de deux arrêts']
    full = []
    offsets = [0.0]
    meta = []
    missing = []
    for i in range(len(stops)-1):
        a = str(stops[i].get('name') or 'Gare')
        b = str(stops[i+1].get('name') or 'Gare')
        item = lib.get(pair_key(a, b))
        if not item:
            missing.append(f'{a} → {b}')
            continue
        c = list(item['coords'])
        if full:
            gap = dist_m(full[-1], c[0])
            if gap > 400:
                missing.append(f'{a} → {b} (jointure {gap:.0f} m)')
                continue
            if gap <= 5: c = c[1:]
        if not c:
            missing.append(f'{a} → {b} (vide)')
            continue
        full.extend(c)
        _, length = metrics(full)
        offsets.append(length)
        meta.append({
            'from': a, 'to': b,
            'sectionId': item['sectionId'],
            'reusedReverse': bool(item['reversed']),
            'waypoints': len(item['waypoints']),
            'distanceKm': item.get('distanceKm')
        })
    if missing: return None, missing
    cumulative, length = metrics(full)
    return {
        'coordinates': full,
        'cumulative': cumulative,
        'length': length,
        'stopOffsets': offsets,
        'sections': meta,
    }, []


def build_plan(state, trips, route_id=None):
    lib = build_shared_library(state.get('sections') or {})
    groups = {}
    for tid, t in trips.items():
        if not high_speed_trip(t): continue
        stops = t.get('stops') or []
        if len(stops) < 2: continue
        sig = signature_of_trip(t)
        rid = route_id_for_signature(sig)
        if route_id and rid != route_id: continue
        g = groups.setdefault(rid, {'routeId': rid, 'signature': sig, 'stops': stops, 'trips': []})
        g['trips'].append((tid, t))

    candidates = []
    skipped = []
    for rid, g in sorted(groups.items()):
        built, missing = assemble_stops(g['stops'], lib)
        nums = sorted({str(t.get('number') or '') for _, t in g['trips'] if str(t.get('number') or '')})
        if not built:
            skipped.append({
                'routeId': rid, 'signature': g['signature'], 'trips': len(g['trips']),
                'numbers': nums, 'missing': missing
            })
            continue
        payload = json.dumps(built['coordinates'], separators=(',', ':'))
        pid = 'p-moorail-v4-' + hashlib.sha1((rid + '|' + payload).encode()).hexdigest()[:16]
        candidates.append({
            'routeId': rid, 'signature': g['signature'], 'tripIds': [tid for tid, _ in g['trips']],
            'trips': len(g['trips']), 'numbers': nums, 'pathId': pid,
            'km': built['length']/1000.0, 'sections': len(built['sections']), 'built': built
        })
    return candidates, skipped, len(lib)


def report_public(candidates, skipped, shared_pairs, apply_requested, route_id):
    return {
        'ok': True,
        'version': 2,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'applyRequested': bool(apply_requested),
        'routeIdFilter': route_id,
        'sharedPairs': shared_pairs,
        'candidates': [
            {k: v for k, v in c.items() if k not in ('built', 'tripIds')} |
            {'tripIds': c['tripIds'][:200]}
            for c in candidates
        ],
        'skipped': skipped,
        'totals': {
            'routes': len(candidates),
            'trips': sum(c['trips'] for c in candidates),
            'skippedRoutes': len(skipped)
        }
    }


def main():
    ap = argparse.ArgumentParser(description='Compile MooRail shared stop-pair validations into France V3 preview')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--route-id')
    ap.add_argument('--no-restart', action='store_true')
    ap.add_argument('--json', action='store_true', help='print only JSON report to stdout')
    args = ap.parse_args()

    for p in (STATE, TRIPS, PATHS):
        if not p.exists(): raise SystemExit(f'ERREUR: fichier absent: {p}')

    state = load(STATE); trips = load(TRIPS); paths = load(PATHS)
    candidates, skipped, shared_pairs = build_plan(state, trips, args.route_id)
    report = report_public(candidates, skipped, shared_pairs, args.apply, args.route_id)
    atomic(REPORT, report)

    if not args.json:
        print('============================================================')
        print(' MOO RAIL V4 — SECTIONS PARTAGÉES -> FRANCE V3 PREVIEW')
        print(' Mode :', 'APPLY' if args.apply else 'DIAGNOSTIC')
        print('============================================================')
        print('Sections orientées réutilisables :', shared_pairs)
        print('\nPARCOURS PRÊTS :', len(candidates))
        for c in candidates:
            print(f"  {c['routeId']} | {c['signature']} | {c['sections']} étapes | {c['km']:.1f} km | {c['trips']} circulations")
            if c['numbers']: print('    trains:', ', '.join(c['numbers'][:40]))
        print('\nINCOMPLETS :', len(skipped))
        for s in skipped[:25]:
            print(f"  {s['routeId']} | {s['signature']} | manque: {', '.join(s['missing'][:4])}")
        if len(skipped) > 25: print('  ...')

    if not args.apply or not candidates:
        if args.json: print(json.dumps(report, ensure_ascii=False, separators=(',', ':')))
        elif not candidates: print('\nAucun parcours prêt. Rien modifié.')
        else: print('\nDIAGNOSTIC UNIQUEMENT — aucun fichier France V3 modifié.')
        return 0

    new_trips = copy.deepcopy(trips); new_paths = copy.deepcopy(paths)
    now = datetime.now(timezone.utc).isoformat()
    for c in candidates:
        b = c['built']; pid = c['pathId']
        new_paths[pid] = {
            'coordinates': b['coordinates'], 'cumulative': b['cumulative'], 'length': b['length'],
            'stopOffsets': b['stopOffsets'], 'profile': 'tgv', 'pathSource': SOURCE,
            'routeId': c['routeId'], 'signature': c['signature'], 'compiledAt': now,
            'validatedSections': b['sections'], 'sharedStopPairMode': True
        }
        for tid in c['tripIds']:
            nt = new_trips[tid]
            nt['pathId'] = pid
            nt['offsets'] = b['stopOffsets']
            nt['pathSource'] = SOURCE

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = ROOT / f'backups/moorail-compile-v2-{stamp}'
    backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(TRIPS, backup/'trips.json')
    shutil.copy2(PATHS, backup/'paths.json')
    shutil.copy2(STATE, backup/'moorail-route-editor-state-v1.json')
    atomic(TRIPS, new_trips); atomic(PATHS, new_paths)

    # Vérification disque avant tout redémarrage.
    chk_t = load(TRIPS); chk_p = load(PATHS)
    for c in candidates:
        if c['pathId'] not in chk_p:
            raise SystemExit(f"ERREUR vérification path absent: {c['pathId']}")
        for tid in c['tripIds']:
            if (chk_t.get(tid) or {}).get('pathId') != c['pathId']:
                raise SystemExit(f'ERREUR vérification trip non publié: {tid}')
    report['appliedAt'] = now
    report['backup'] = str(backup)
    report['verifiedOnDisk'] = True
    atomic(REPORT, report)

    if not args.no_restart:
        import subprocess, time
        try:
            subprocess.run(['systemctl', 'restart', SERVICE], check=True)
            ok = False
            for _ in range(30):
                p = subprocess.run(['curl','-fsS','--max-time','2','http://127.0.0.1:3111/api/map-v2/health'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                if p.returncode == 0:
                    try:
                        h = json.loads(p.stdout)
                        if h.get('ok') is True: ok = True; break
                    except Exception: pass
                time.sleep(1)
            if not ok: raise RuntimeError('health Map V2 indisponible')
        except Exception as e:
            shutil.copy2(backup/'trips.json', TRIPS); shutil.copy2(backup/'paths.json', PATHS)
            subprocess.run(['systemctl','restart',SERVICE], check=False)
            raise SystemExit(f'ERREUR publication + rollback: {e}')

    if args.json:
        print(json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    else:
        print('\nPUBLICATION OK')
        print('Routes :', report['totals']['routes'], 'Circulations :', report['totals']['trips'])
        print('Backup :', backup)
        if args.no_restart: print('Redémarrage non effectué (--no-restart).')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
