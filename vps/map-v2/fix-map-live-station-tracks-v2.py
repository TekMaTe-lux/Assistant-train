#!/usr/bin/env python3
"""La Bétaillère — V2 : recale automatiquement les trains sur leur voie en gare.

Dry-run par défaut. Avec --apply, ne modifie que carte-core-preview.html.
Réutilise strictement les timers/rendus existants : aucun polling, aucun appel réseau,
aucun rendu périodique supplémentaire.
"""
import argparse
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

MARK = 'BER_LIVE_STATION_TRACK_REFRESH_V2'

HELPER = r'''

  /* BER_LIVE_STATION_TRACK_REFRESH_V2
   * voies_by_train est déjà rechargé par le timer existant.
   * Si son contenu utile change, le prochain tick NORMAL peut déplacer une fois
   * un train actuellement en gare même si l'écart entre deux voies fait < 25-30 m.
   * Aucun nouveau timer, aucun nouvel appel réseau, aucun tick supplémentaire.
   */
  let berTrackAssignmentsSignature = null;
  let berStationTrackRefreshPending = false;

  function berTrackAssignmentsStableSignature(data){
    const trains = data && data.trains && typeof data.trains === 'object'
      ? data.trains
      : null;
    if (!trains) return null;

    const rows = [];
    for (const trainKey of Object.keys(trains).sort()){
      const perStop = trains[trainKey];
      if (!perStop || typeof perStop !== 'object') continue;
      for (const stopKey of Object.keys(perStop).sort()){
        rows.push(`${trainKey}\u0001${stopKey}\u0001${JSON.stringify(perStop[stopKey])}`);
      }
    }
    return rows.join('\u0002');
  }
'''

LOAD_HOOK = r'''
            if (source.label === 'voies_by_train'){
              const nextTrackSignature = berTrackAssignmentsStableSignature(data);
              if (
                berTrackAssignmentsSignature !== null
                && nextTrackSignature !== null
                && nextTrackSignature !== berTrackAssignmentsSignature
              ){
                berStationTrackRefreshPending = true;
              }
              if (nextTrackSignature !== null){
                berTrackAssignmentsSignature = nextTrackSignature;
              }
            }
'''


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'ERREUR: ancre {label} trouvée {n} fois; aucune écriture')
    return text.replace(old, new, 1)


def regex_replace_once(text, pattern, repl, label, flags=0):
    rx = re.compile(pattern, flags)
    matches = list(rx.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f'ERREUR: ancre {label} trouvée {len(matches)} fois; aucune écriture')
    return rx.sub(repl, text, count=1)


def check_js(html):
    if not shutil.which('node'):
        raise SystemExit('ERREUR: node absent; aucune écriture')
    parts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I)
    if not parts:
        raise SystemExit('ERREUR: aucun JavaScript inline trouvé')
    with tempfile.TemporaryDirectory(prefix='lb-track-refresh-v2-check-') as td:
        for i, code in enumerate(parts):
            f = Path(td) / f'{i}.js'
            f.write_text(code, encoding='utf-8')
            q = subprocess.run(
                ['node', '--check', str(f)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if q.returncode:
                raise SystemExit('ERREUR JS; aucune écriture:\n' + q.stderr)


def patch_load_track_assignments(s):
    a = s.find('async function loadTrackAssignments(){')
    if a < 0:
        raise SystemExit('ERREUR: loadTrackAssignments introuvable; aucune écriture')
    b = s.find('function shouldReplaceStationBoardRowByEquivalence', a)
    if b < 0:
        raise SystemExit('ERREUR: fin de loadTrackAssignments introuvable; aucune écriture')

    region = s[a:b]

    # Tolère les différences d'indentation / CRLF rencontrées sur la carte live.
    pattern = (
        r'(?P<indent>^[ \t]*)const data = await res\.json\(\);[ \t]*\r?\n'
        r'(?P=indent)registerTracksFromPayload\(data, source\.label\);'
    )
    rx = re.compile(pattern, re.M)
    matches = list(rx.finditer(region))
    if len(matches) != 1:
        raise SystemExit(
            f'ERREUR: couple lecture/enregistrement voies trouvé {len(matches)} fois; aucune écriture'
        )

    m = matches[0]
    indent = m.group('indent')
    replacement = (
        indent + 'const data = await res.json();\n'
        + ''.join(indent + line.lstrip() + '\n' if line.strip() else '\n'
                  for line in LOAD_HOOK.strip('\n').splitlines())
        + indent + 'registerTracksFromPayload(data, source.label);'
    )
    region = region[:m.start()] + replacement + region[m.end():]
    return s[:a] + region + s[b:]


def patch_should_move_marker(s):
    # Le 4e paramètre reste optionnel : tous les autres appels gardent exactement
    # le comportement historique et le seuil ~25-30 m.
    old = 'function shouldMoveMarker(oldLatLng, lat, lon){'
    new = (
        'function shouldMoveMarker(oldLatLng, lat, lon, force = false){\n'
        '    if (force) return true;'
    )
    return replace_once(s, old, new, 'fonction shouldMoveMarker')


def patch_render_train_call(s):
    a = s.find('function renderTrains(list){')
    if a < 0:
        raise SystemExit('ERREUR: renderTrains introuvable; aucune écriture')

    # Borne volontairement la recherche pour ne jamais toucher un autre appel
    # shouldMoveMarker situé ailleurs dans le fichier.
    candidates = [
        x for x in (
            s.find('// --- Perf: pause des refresh', a),
            s.find('// ---------- Boucle ----------', a),
            s.find('function applyTrainFilters', a),
        ) if x > a
    ]
    b = min(candidates) if candidates else min(len(s), a + 40000)
    region = s[a:b]

    pattern = r'shouldMoveMarker\(\s*old\s*,\s*t\.lat\s*,\s*t\.lon\s*\)'
    repl = (
        'shouldMoveMarker(\n'
        '            old,\n'
        '            t.lat,\n'
        '            t.lon,\n'
        '            berStationTrackRefreshPending === true\n'
        '              && Number(t.segmentProgress) === 0\n'
        '          )'
    )
    region = regex_replace_once(region, pattern, repl, 'appel déplacement marqueur en gare', re.S)
    return s[:a] + region + s[b:]


def patch_tick(s):
    # On ne crée PAS de nouveau rendu. Le tick déjà présent consomme simplement
    # le drapeau APRÈS avoir recalculé trainsAt() avec les nouvelles voies.
    pattern = (
        r'function tick\(\)\{\s*'
        r'renderTrains\(\s*trainsAt\(nowSecLocal\(\)\)\s*\);\s*'
        r'\}'
    )
    replacement = '''function tick(){
    const berConsumeTrackRefresh = berStationTrackRefreshPending === true;
    renderTrains(trainsAt(nowSecLocal()));
    if (berConsumeTrackRefresh){
      berStationTrackRefreshPending = false;
    }
  }'''
    return regex_replace_once(s, pattern, replacement, 'tick normal', re.S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='/opt/labetaillere-map-v2-src')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    path = Path(args.root) / 'map-v2/public/carte-core-preview.html'
    if not path.exists():
        raise SystemExit(f'ERREUR: {path} introuvable')

    before = path.read_bytes()
    s = before.decode('utf-8')

    if MARK in s:
        print('Correctif V2 déjà installé. Aucun changement.')
        return

    # V1 a échoué avant écriture chez l'utilisateur. Refus si une installation
    # partielle/imprévue était néanmoins présente.
    if 'BER_LIVE_STATION_TRACK_REFRESH_V1' in s:
        raise SystemExit('ERREUR: marqueur V1 présent de façon inattendue; aucune écriture')

    required = (
        'const TRACK_REFRESH_INTERVAL_MS = 120000;',
        'let trackRefreshTimer = null;',
        'async function loadTrackAssignments(){',
        'tracksByTrainNumber.clear();',
        "{ label:'voies_by_train', candidates: VOIES_BY_TRAIN_CANDIDATES }",
        'registerTracksFromPayload(data, source.label);',
        'function renderTrains(list){',
        'function shouldMoveMarker(oldLatLng, lat, lon){',
        'function tick()',
        'BER_STATION_TRACK_SNAP_V1',
        'BER_FALSE_DELAY_BADGES_FIX_V1',
        'BER_LUX_TERMINUS_DELAY_V9',
        'delayEstimated',
    )
    for token in required:
        if token not in s:
            raise SystemExit('ERREUR: invariant absent (' + token + '); aucune écriture')

    interval_count = s.count('const TRACK_REFRESH_INTERVAL_MS = 120000;')
    network_call_count = s.count('fetchWithTimeoutNoHeaders(withBuster(candidate), 8000)')
    setinterval_count = s.count('setInterval(')
    settimeout_count = s.count('setTimeout(')

    # Variables/helper à côté du timer voies déjà existant.
    s = regex_replace_once(
        s,
        r'(^[ \t]*let trackRefreshTimer = null;[ \t]*\r?\n)',
        lambda m: m.group(1) + HELPER,
        'variables voies',
        re.M,
    )

    s = patch_load_track_assignments(s)
    s = patch_should_move_marker(s)
    s = patch_render_train_call(s)
    s = patch_tick(s)

    # Garde-fous charge/perf : strictement le même nombre de timers et d'appels.
    if s.count('const TRACK_REFRESH_INTERVAL_MS = 120000;') != interval_count:
        raise SystemExit('ERREUR: intervalle voies modifié; aucune écriture')
    if s.count('fetchWithTimeoutNoHeaders(withBuster(candidate), 8000)') != network_call_count:
        raise SystemExit('ERREUR: nombre d’appels voies modifié; aucune écriture')
    if s.count('setInterval(') != setinterval_count:
        raise SystemExit('ERREUR: nombre de setInterval modifié; aucune écriture')
    if s.count('setTimeout(') != settimeout_count:
        raise SystemExit('ERREUR: nombre de setTimeout modifié; aucune écriture')

    for token in (
        MARK,
        'berTrackAssignmentsStableSignature',
        'berStationTrackRefreshPending',
        'force = false',
        'BER_STATION_TRACK_SNAP_V1',
        'BER_FALSE_DELAY_BADGES_FIX_V1',
        'BER_LUX_TERMINUS_DELAY_V9',
        'lb-community-traveler',
        'lb-lux-station-entry-v2',
    ):
        if token not in s:
            raise SystemExit('ERREUR: invariant perdu (' + token + '); aucune écriture')

    check_js(s)

    print('VÉRIFICATIONS OK')
    print('• voies SIRI : même source et même timer 120 s côté carte')
    print('• appels réseau supplémentaires : 0')
    print('• timers supplémentaires : 0')
    print('• rendus périodiques supplémentaires : 0')
    print('• changement de voie : consommé par le prochain tick NORMAL')
    print('• train en gare : petit déplacement entre voies autorisé une fois')
    print('• seuil ~25-30 m hors changement de voie : CONSERVÉ')
    print('• retards / terminus / trajets / communauté / votes : NON TOUCHÉS')

    if not args.apply:
        print('SIMULATION seulement — aucun fichier modifié. Ajouter --apply pour installer.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(args.root) / 'map-v2/backups' / ('live-station-tracks-v2-' + stamp)
    backup.mkdir(parents=True)
    backup_file = backup / path.name
    shutil.copy2(path, backup_file)

    if path.read_bytes() != before:
        raise SystemExit('ERREUR: carte modifiée pendant les contrôles; aucune écriture')

    tmp = path.with_name(path.name + '.tmp-live-station-tracks-v2')
    tmp.write_text(s, encoding='utf-8')
    os.chmod(tmp, path.stat().st_mode)
    os.replace(tmp, path)

    print('INSTALLÉ:', path)
    print('BACKUP:', backup_file)
    print('Aucun service redémarré. Aucun cache reconstruit.')


if __name__ == '__main__':
    main()
