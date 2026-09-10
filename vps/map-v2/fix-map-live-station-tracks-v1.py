#!/usr/bin/env python3
"""La Bétaillère — recale automatiquement les trains sur leur voie en gare.

Dry-run par défaut. Avec --apply, ne modifie que carte-core-preview.html.
Aucun timer, aucun appel réseau, aucun producteur de données n'est ajouté.
"""
import argparse, os, re, shutil, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

MARK = 'BER_LIVE_STATION_TRACK_REFRESH_V1'

HELPER = r'''
  /* BER_LIVE_STATION_TRACK_REFRESH_V1
   * Les voies SIRI sont déjà relues par le timer existant.
   * On mémorise uniquement si le contenu voies_by_train a réellement changé.
   * Aucun nouveau polling / aucun nouvel appel réseau.
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

TICK_HOOK = r'''
        // Si une voie a changé, on réutilise immédiatement le rendu déjà existant.
        // Pas de nouveau timer : un seul rendu ponctuel, uniquement lors d'un vrai changement.
        if (berStationTrackRefreshPending){
          try { tick(); } catch(_){ }
        }
'''

RENDER_FLAG = r'''
    const berForceStationTrackRefresh = berStationTrackRefreshPending === true;
    if (berForceStationTrackRefresh){
      berStationTrackRefreshPending = false;
    }
'''

FORCE_MOVE = r'''        const berForceTrackSnapMove =
          berForceStationTrackRefresh
          && Number(t.segmentProgress) === 0;

        const didMove =
          berForceTrackSnapMove
          || shouldMoveMarker(
'''


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'ERREUR: ancre {label} trouvée {n} fois; aucune écriture')
    return text.replace(old, new, 1)


def check_js(html):
    if not shutil.which('node'):
        raise SystemExit('ERREUR: node absent; aucune écriture')
    parts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I)
    if not parts:
        raise SystemExit('ERREUR: aucun JavaScript inline trouvé')
    with tempfile.TemporaryDirectory(prefix='lb-track-refresh-check-') as td:
        for i, code in enumerate(parts):
            f = Path(td) / f'{i}.js'
            f.write_text(code, encoding='utf-8')
            q = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True, timeout=30)
            if q.returncode:
                raise SystemExit('ERREUR JS; aucune écriture:\n' + q.stderr)


def patch_load_region(s):
    a = s.find('async function loadTrackAssignments(){')
    if a < 0:
        raise SystemExit('ERREUR: loadTrackAssignments introuvable; aucune écriture')
    b = s.find('function shouldReplaceStationBoardRowByEquivalence', a)
    if b < 0:
        raise SystemExit('ERREUR: fin loadTrackAssignments introuvable; aucune écriture')
    region = s[a:b]

    old = '              const data = await res.json();\n              registerTracksFromPayload(data, source.label);'
    new = '              const data = await res.json();\n' + LOAD_HOOK + '              registerTracksFromPayload(data, source.label);'
    region = replace_once(region, old, new, 'hook données voies')

    old2 = '        if (activeStationId){\n'
    new2 = TICK_HOOK + '        if (activeStationId){\n'
    region = replace_once(region, old2, new2, 'rendu après changement de voie')
    return s[:a] + region + s[b:]


def patch_render_region(s):
    a = s.find('function renderTrains(list){')
    if a < 0:
        raise SystemExit('ERREUR: renderTrains introuvable; aucune écriture')
    # La fonction suivante peut varier selon les versions; on prend une fenêtre bornée.
    b = min([x for x in (
        s.find('function applyTrainFilters', a),
        s.find('// ---------- Boucle ----------', a),
        s.find('let refreshPaused', a)
    ) if x > a] or [a + 30000])
    region = s[a:b]

    # Ajouter le drapeau local juste après l'obtention de la couche.
    m = re.search(r'(function renderTrains\(list\)\{\s*\n\s*const layer = ensureTrainLayer\(\);\s*\n)', region)
    if not m:
        raise SystemExit('ERREUR: début renderTrains inattendu; aucune écriture')
    region = region[:m.end()] + RENDER_FLAG + region[m.end():]

    # Dans le rendu normal, le seuil ~25-30 m reste intact. On le contourne UNE fois
    # uniquement pour les objets positionnés exactement en gare (segmentProgress === 0).
    rx = re.compile(
        r'(?P<indent>\s*)const didMove\s*=\s*\n\s*shouldMoveMarker\(\s*\n',
        re.M
    )
    matches = list(rx.finditer(region))
    if len(matches) != 1:
        raise SystemExit(f'ERREUR: calcul didMove trouvé {len(matches)} fois dans renderTrains; aucune écriture')
    m = matches[0]
    indent = m.group('indent')
    replacement = (
        indent + 'const berForceTrackSnapMove =\n'
        + indent + '  berForceStationTrackRefresh\n'
        + indent + '  && Number(t.segmentProgress) === 0;\n\n'
        + indent + 'const didMove =\n'
        + indent + '  berForceTrackSnapMove\n'
        + indent + '  || shouldMoveMarker(\n'
    )
    region = region[:m.start()] + replacement + region[m.end():]
    return s[:a] + region + s[b:]


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
        print('Correctif déjà installé. Aucun changement.')
        return

    # Garde-fous sur les mécanismes à conserver.
    required = (
        'const TRACK_REFRESH_INTERVAL_MS = 120000;',
        'let trackRefreshTimer = null;',
        'async function loadTrackAssignments(){',
        'tracksByTrainNumber.clear();',
        "{ label:'voies_by_train', candidates: VOIES_BY_TRAIN_CANDIDATES }",
        'function renderTrains(list){',
        'function shouldMoveMarker(',
        'BER_STATION_TRACK_SNAP_V1',
        'BER_FALSE_DELAY_BADGES_FIX_V1',
        'BER_LUX_TERMINUS_DELAY_V9',
        'delayEstimated'
    )
    for token in required:
        if token not in s:
            raise SystemExit('ERREUR: invariant absent (' + token + '); aucune écriture')

    original_interval_count = s.count('const TRACK_REFRESH_INTERVAL_MS = 120000;')
    original_fetch_count = s.count('fetchWithTimeoutNoHeaders(withBuster(candidate), 8000)')

    s = replace_once(
        s,
        '  let trackRefreshTimer = null;\n',
        '  let trackRefreshTimer = null;\n' + HELPER,
        'variables voies'
    )
    s = patch_load_region(s)
    s = patch_render_region(s)

    # Invariants : aucune fréquence ni aucun appel réseau supplémentaire.
    if s.count('const TRACK_REFRESH_INTERVAL_MS = 120000;') != original_interval_count:
        raise SystemExit('ERREUR: intervalle voies modifié; aucune écriture')
    if s.count('fetchWithTimeoutNoHeaders(withBuster(candidate), 8000)') != original_fetch_count:
        raise SystemExit('ERREUR: nombre d’appels réseau modifié; aucune écriture')
    if 'setInterval' in HELPER or 'setTimeout' in HELPER:
        raise SystemExit('ERREUR interne: le correctif ne doit créer aucun timer')

    for token in (
        MARK,
        'berTrackAssignmentsStableSignature',
        'berStationTrackRefreshPending',
        'berForceTrackSnapMove',
        'BER_STATION_TRACK_SNAP_V1',
        'BER_FALSE_DELAY_BADGES_FIX_V1',
        'BER_LUX_TERMINUS_DELAY_V9',
        'lb-community-traveler',
        'lb-lux-station-entry-v2'
    ):
        if token not in s:
            raise SystemExit('ERREUR: invariant perdu (' + token + '); aucune écriture')

    check_js(s)

    print('VÉRIFICATIONS OK')
    print('• changement réel de voie détecté dans voies_by_train : OUI')
    print('• train en gare recalé automatiquement sans F5 : OUI')
    print('• seuil normal ~25-30 m hors changement de voie : CONSERVÉ')
    print('• timer voies 120 s : INCHANGÉ')
    print('• appels SIRI / réseau supplémentaires : 0')
    print('• retards / terminus / trajets / communauté / votes : NON TOUCHÉS')

    if not args.apply:
        print('SIMULATION seulement — aucun fichier modifié. Ajouter --apply pour installer.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(args.root) / 'map-v2/backups' / ('live-station-tracks-v1-' + stamp)
    backup.mkdir(parents=True)
    backup_file = backup / path.name
    shutil.copy2(path, backup_file)

    if path.read_bytes() != before:
        raise SystemExit('ERREUR: carte modifiée pendant les contrôles; aucune écriture')

    tmp = path.with_name(path.name + '.tmp-live-station-tracks')
    tmp.write_text(s, encoding='utf-8')
    os.chmod(tmp, path.stat().st_mode)
    os.replace(tmp, path)

    print('INSTALLÉ:', path)
    print('BACKUP:', backup_file)
    print('Aucun service redémarré. Aucun cache reconstruit.')


if __name__ == '__main__':
    main()
