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

MARK = 'LB_MAP_STARTUP_SAFE_V1'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Version inattendue : ' + old[:100])
    return text.replace(old, new, 1)


def prepare(core, wrapper, votes):
    if MARK in core:
        raise RuntimeError('Correctif déjà présent : aucune modification nécessaire.')
    match = re.search(r'const THEME=`([\s\S]*?)`;', wrapper)
    if not match:
        raise RuntimeError('Thème actuel du wrapper introuvable')
    # Use the installed theme, including the actual mobile rules, before first paint.
    theme = json.dumps(match.group(1), ensure_ascii=False).replace('</', '<\\/')
    early = ('<!-- ' + MARK + ' -->\n<script>\n'
             "if (new URLSearchParams(location.search).get('lbEmbedded') === '1') {\n"
             "  const style = document.createElement('style');\n"
             "  style.id = 'lb-v2-fixed-theme';\n"
             '  style.textContent = ' + theme + ';\n'
             '  document.head.appendChild(style);\n}\n</script>\n')
    core = replace_once(core, '</head>', early + '</head>')

    # Download the small timetable alongside routing data, but hydrate it only
    # after the routing overrides are ready: train routing order is preserved.
    helper = """  async function lbFetchStartupStaticCache(){
    const url = LB_CARTE_STATIC_CACHE_URL + '?v=' + new Date().toISOString().slice(0,10);
    const res = await fetch(url, { cache:'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function tryLoadCarteStaticCache(prefetchedCache = null){"""
    core = replace_once(core, '  async function tryLoadCarteStaticCache(){', helper)
    core = replace_once(core, """      const url = LB_CARTE_STATIC_CACHE_URL + '?v=' + new Date().toISOString().slice(0,10);
      const res = await fetch(url, { cache:'default' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();""", """      const payload = await (prefetchedCache || lbFetchStartupStaticCache());""")
    core = replace_once(core, """  async function loadGTFS(){
    try {
      await lbLoadMoorailOverrides();""", """  async function loadGTFS(){
    // Download only: hydration still follows the validated routing overrides.
    const startupStaticCache = lbFetchStartupStaticCache().catch(error => {
      console.warn('[Carte startup] cache léger indisponible', error);
      return null;
    });
    try {
      await lbLoadMoorailOverrides();""")
    core = replace_once(core, 'if (await tryLoadCarteStaticCache()) return;',
                        'if (await tryLoadCarteStaticCache(startupStaticCache)) return;')
    core = replace_once(core, """  async function lbLoadMoorailOverrides(){
    try{""", """  async function lbLoadMoorailOverrides(){
    const startupNetwork = lbLoadMoorailV8Network();
    try{""")
    core = replace_once(core, '      await lbLoadMoorailV8Network();',
                        '      await startupNetwork;')
    # Routine per-train messages allocate/log thousands of objects during ticks.
    for message in ['TERMINUS NON ESTIME', 'TERMINUS ESTIME DEPUIS ARRET PRECEDENT']:
        old = '          console.log(\n            "[BER V8.3] ' + message + '",'
        new = '          if (window.LB_MAP_DEBUG === true) console.log(\n            "[BER V8.3] ' + message + '",'
        core = replace_once(core, old, new)

    # The wrapper only enhances the trip panel; train marker DOM mutations must
    # not trigger a full panel traversal on every render.
    wrapper = replace_once(wrapper,
        '        obs.observe(doc.body,{childList:true,subtree:true});',
        "        const observedPanel=doc.querySelector('.trip-panel');\n"
        '        if(observedPanel) obs.observe(observedPanel,{childList:true,subtree:true});')
    wrapper = replace_once(wrapper,
        "  frame.addEventListener('load',()=>{install();setTimeout(install,150);setTimeout(install,700)});",
        "  frame.addEventListener('load',install);")

    # Failed requests previously requeued render -> fetch -> render immediately.
    votes = replace_once(votes, '  let lastFetchAt = 0;',
                         '  let lastFetchAt = 0;\n  let lastAttemptAt = 0;')
    votes = replace_once(votes,
        '    if (!force && lastFetchAt && Date.now() - lastFetchAt < 8000) return signals;',
        '    if (!force && lastAttemptAt && Date.now() - lastAttemptAt < 8000) return signals;\n'
        '    lastAttemptAt = Date.now();')
    votes = replace_once(votes, '    renderQueued = false;\n    const block',
        "    renderQueued = false;\n    const panel = document.getElementById('trip-panel');\n"
        "    if (!panel || panel.hidden || panel.classList.contains('hidden')) return;\n    const block")
    core = replace_once(core,
        '<script id="lb-community-traveler-vote-v3" src="./assets/lb-community-traveler-vote-v3.js?v=20260910-6"></script>',
        '<script defer id="lb-community-traveler-vote-v3" src="./assets/lb-community-traveler-vote-v3.js?v=20260910-startup-safe-v1"></script>')
    wrapper = replace_once(wrapper,
        'carte-core-preview.html?lbEmbedded=1&v=20260902-v4-canonical-prod',
        'carte-core-preview.html?lbEmbedded=1&v=20260910-startup-safe-v1')
    return core, wrapper, votes


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
            if index < 2:
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
    files = [public / 'carte-core-preview.html', public / 'carte-preview.html',
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
    print('Trains : téléchargements parallèles, ordre de calcul conservé.')
    print('Affichage : thème dès le début, observation limitée à la fiche.')
    if not args.apply:
        print('SIMULATION : aucun fichier modifié. Ajouter --apply pour installer.')
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = root / 'map-v2/backups' / ('startup-preserve-votes-v1-' + stamp)
    backup.mkdir(parents=True)
    for p, before in zip(files, original):
        if p.read_bytes() != before:
            raise RuntimeError('Fichier modifié pendant la vérification : ' + str(p))
        shutil.copy2(p, backup / p.name)
    changed = []
    try:
        # Publish the asset before referencing its new cache version.
        for i in [2, 0, 1]:
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
