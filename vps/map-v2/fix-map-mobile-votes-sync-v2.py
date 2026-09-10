#!/usr/bin/env python3
"""Patch the installed map in place. Dry run by default; --apply writes backups.

No GTFS rebuild, service restart, route change or restoration of an old core.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser

MARK = 'LB_MAP_VOTES_SYNC_V2'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Version inattendue : ' + old[:100])
    return text.replace(old, new, 1)


def prepare(core, compact, votes):
    if 'LB_MAP_STARTUP_SAFE_V1' not in core:
        raise RuntimeError('Installer le correctif de démarrage V1 avant cette version.')
    # Publish the compact renderer's authoritative state and completion event.
    compact = replace_once(compact,
        "  const communitySnapshot = { trains:{}, canContribute:false };",
        "  const communitySnapshot = { trains:{}, canContribute:false };\n"
        "  window.lbCommunityMapViewState = () => communitySnapshot;")
    compact = replace_once(compact,
        '    renderPropagatedStopDelays(number);\n    decorateMarkerBadges();',
        '    renderPropagatedStopDelays(number);\n    decorateMarkerBadges();\n'
        "    document.dispatchEvent(new Event('lb:community:decorated'));")
    # Read the same state as the visible +N badge, even if the first message
    # arrived before the deferred voting module had finished downloading.
    votes = replace_once(votes,
        "    const number = currentTripNumber();\n    const item = itemForTrain(number);",
        "    const shared = window.lbCommunityMapViewState?.();\n"
        "    if (shared) { snapshot.trains = shared.trains; snapshot.canContribute = shared.canContribute; }\n"
        "    const number = currentTripNumber();\n    const item = itemForTrain(number);")
    votes = replace_once(votes, "    if (!(delay > 0) || !station) {", "    if (!(delay > 0)) {")
    votes = replace_once(votes,
        '    label.textContent = `Retard signalé par le bétail depuis ${station}`;',
        "    label.textContent = station ? `Signalé par le bétail · ${station}` : 'Retard signalé par le bétail';")
    votes = replace_once(votes,
        '    label.title = `Retard voyageur signalé par le bétail depuis ${station}`;',
        "    label.title = label.textContent;")
    votes = replace_once(votes, '  function start(){',
        "  document.addEventListener('lb:community:decorated', scheduleRender);\n\n  function start(){")
    # Keep the vote controls present while loading, but never submit without
    # a resolved report ID. Do not guess between ambiguous reports.
    votes = replace_once(votes, '    if (!signal) return;\n\n    const votes', '    const votes')
    votes = replace_once(votes, '    votes.dataset.signalId = signal.id;', "    votes.dataset.signalId = signal?.id || '';")
    votes = replace_once(votes, '    count.textContent = String(signal.upvotes - signal.downvotes);',
        "    count.textContent = signal ? String(signal.upvotes - signal.downvotes) : '…';")
    votes = replace_once(votes, '    count.title = `Score du signalement : ${signal.upvotes - signal.downvotes}`;',
        "    count.title = signal ? `Score du signalement : ${signal.upvotes - signal.downvotes}` : 'Signalement en cours de vérification';")
    votes = replace_once(votes, "    button.textContent = kind === 'up' ? '👍' : '👎';",
        "    button.textContent = kind === 'up' ? '👍' : '👎';\n"
        "    button.disabled = !signal?.id;\n"
        "    button.setAttribute('aria-busy', signal?.id ? 'false' : 'true');")
    # Source line always has a separate mobile row. Keep both thumbs on-screen.
    votes = replace_once(votes, 'width:21px!important;min-width:21px!important;height:21px!important;min-height:21px!important;',
        'width:28px!important;min-width:28px!important;height:28px!important;min-height:28px!important;')
    votes = replace_once(votes, 'height:22px!important;padding:0 2px!important;',
        'height:30px!important;padding:0 2px!important;')
    votes = replace_once(votes, 'width:20px!important;min-width:20px!important;height:20px!important;min-height:20px!important;',
        'width:28px!important;min-width:28px!important;height:28px!important;min-height:28px!important;')
    votes = replace_once(votes, '.lb-community-map-votes{height:21px!important;padding:0 1px!important}',
        '.lb-community-map-votes{height:30px!important;padding:0 1px!important}')
    core = replace_once(core,
        'lb-community-traveler-compact-v2.js?v=20260906-stack3',
        'lb-community-traveler-compact-v2.js?v=20260910-votes-sync-v2')
    core = replace_once(core,
        'lb-community-traveler-vote-v3.js?v=20260910-startup-safe-v1',
        'lb-community-traveler-vote-v3.js?v=20260910-votes-sync-v2')
    hints = '<!-- ' + MARK + ' -->\n'
    for url in ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
                'https://unpkg.com/papaparse@5.4.1/papaparse.min.js']:
        hints += '<link rel="preload" as="script" href="' + url + '">\n'
    core = replace_once(core, '<head>', '<head>\n' + hints)
    return core, compact, votes


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []
        self.current = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            attrs = dict(attrs)
            self.active = 'src' not in attrs and attrs.get('type', '') not in ('application/ld+json', 'application/json')
            self.current = []

    def handle_data(self, data):
        if self.active:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.active:
            self.parts.append(''.join(self.current))
            self.active = False


def validate(contents):
    if not shutil.which('node'):
        raise RuntimeError('Node est nécessaire pour vérifier JavaScript avant toute écriture.')
    with tempfile.TemporaryDirectory(prefix='lb-map-check-') as tmp:
        for index, text in enumerate(contents):
            if index == 0:
                parser = Scripts()
                parser.feed(text)
                parts = parser.parts
            else:
                parts = [text]
            for n, code in enumerate(parts):
                path = Path(tmp) / f'{index}-{n}.js'
                path.write_text(code, encoding='utf-8')
                result = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True, timeout=20)
                if result.returncode:
                    raise RuntimeError(f'JavaScript invalide {index}/{n}: {result.stderr}')


def atomic_write(path, data):
    stat = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.tmp-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temporary, stat.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=os.environ.get('LB_MAP_ROOT', '/opt/labetaillere-map-v2-src'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(args.root)
    public = root / 'map-v2/public'
    files = [public / 'carte-core-preview.html', public / 'assets/lb-community-traveler-compact-v2.js',
             public / 'assets/lb-community-traveler-vote-v3.js']
    original = [p.read_bytes() for p in files]
    if MARK in original[0].decode('utf-8'):
        print('Correctif déjà installé. Aucun changement.')
        return
    prepared = prepare(*(b.decode('utf-8') for b in original))
    validate(prepared)
    for token in ['lb-community-traveler-v1', 'lb-community-traveler-compact-v2',
                  'lb-community-traveler-vote-v3', 'lb-lux-station-entry-v2']:
        if token not in prepared[0]:
            raise RuntimeError('Fonction requise absente : ' + token)
    if "kind === 'up' ? '👍' : '👎'" not in prepared[2] or "method:'POST'" not in prepared[2]:
        raise RuntimeError('Votes non préservés')
    print('Vérifications OK : JavaScript, thème mobile, communauté et pouces.')
    print('Trains : préchargement des bibliothèques de carte.')
    print('Pouces : état partagé avec le badge, restauration après chaque rendu, taille mobile 28 px.')
    if not args.apply:
        print('SIMULATION : aucun fichier modifié. Ajouter --apply pour installer.')
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = root / 'map-v2/backups' / ('votes-sync-v2-' + stamp)
    backup.mkdir(parents=True)
    for p, before in zip(files, original):
        if p.read_bytes() != before:
            raise RuntimeError('Fichier modifié pendant la vérification : ' + str(p))
        shutil.copy2(p, backup / p.name)
    changed = []
    try:
        # Publish the asset before referencing its new cache version.
        for i in [1, 2, 0]:
            if files[i].read_bytes() != original[i]:
                raise RuntimeError('Modification concurrente : ' + str(files[i]))
            atomic_write(files[i], prepared[i].encode('utf-8'))
            changed.append(i)
        for p, after in zip(files, prepared):
            if p.read_bytes() != after.encode('utf-8'):
                raise RuntimeError('Vérification écriture échouée : ' + str(p))
    except BaseException:
        for i in reversed(changed):
            atomic_write(files[i], original[i])
        print('ERREUR : fichiers restaurés automatiquement.')
        raise
    print('INSTALLÉ — aucun service redémarré, aucun cache GTFS reconstruit.')
    print('Sauvegarde :', backup)
    for p in files:
        print(hashlib.sha256(p.read_bytes()).hexdigest(), p.name)
    print('Retour arrière :')
    import shlex
    for p in files:
        print('sudo cp -a', shlex.quote(str(backup / p.name)), shlex.quote(str(p)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('ARRÊT : ' + str(error))
