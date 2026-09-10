#!/usr/bin/env python3
"""Remove the cow icon from community delay badges after UX V3.

Presentation only:
- official operator delay stays untouched;
- community delay stays parenthesized and softly violet;
- cow icon is removed from delay badges because the herd/presence indicator already uses it;
- explicit NON OFFICIEL / Voyageur source line stays untouched;
- thumbs and racefix stay untouched;
- no GTFS, routing, service, API or vote logic change.

Dry-run by default; --apply writes atomic backups and cache-busts compact-v2 only.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

MARK = "LB_MAP_COMMUNITY_NONOFFICIAL_UX_V4_PARENS_NO_COW"


def once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouve {n}")
    return text.replace(old, new, 1)


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.tmp-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def node_check(text: str) -> None:
    if not shutil.which('node'):
        raise RuntimeError('node absent : impossible de verifier le JavaScript')
    with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run(['node', '--check', tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError('JavaScript invalide compact-v2 : ' + p.stderr.strip())
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch_compact(text: str) -> str:
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V4_PARENS_NO_COW_COMPACT' in text:
        return text
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V3_PARENS_COMPACT' not in text:
        raise RuntimeError('UX V3 parentheses absente du compact-v2 : version VPS inattendue')
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT' not in text:
        raise RuntimeError('racefix-v3 absent du compact-v2 : refus de continuer')

    text = once(
        text,
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `(🐮 +${delayMin} min)`); // LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT // LB_COMMUNITY_NONOFFICIAL_UX_V3_PARENS_COMPACT",
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `(+${delayMin} min)`); // LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT // LB_COMMUNITY_NONOFFICIAL_UX_V3_PARENS_COMPACT // LB_COMMUNITY_NONOFFICIAL_UX_V4_PARENS_NO_COW_COMPACT",
        'retard principal sans vache',
    )
    text = once(text, "label.textContent = `(🐮 +${delay} min)`;", "label.textContent = `(+${delay} min)`;", 'badge arret sans vache')
    text = once(text, "badge.textContent = `(🐮 +${delay}m)`;", "badge.textContent = `(+${delay}m)`;", 'badge carte sans vache')
    return text


def patch_core(text: str) -> str:
    if MARK not in text:
        if '</head>' not in text:
            raise RuntimeError('core : </head> introuvable')
        text = text.replace('</head>', f'<!-- {MARK} -->\n</head>', 1)

    text, n = re.subn(
        r'lb-community-traveler-compact-v2\.js\?v=[^\"\']+',
        'lb-community-traveler-compact-v2.js?v=20260910-nonofficial-v4-parens-no-cow',
        text,
    )
    if n < 1:
        raise RuntimeError('core : reference compact-v2 introuvable')
    return text


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', default=os.environ.get('LB_MAP_ROOT', '/opt/labetaillere-map-v2-src'))
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    public = Path(args.root) / 'map-v2/public'
    core = public / 'carte-core-preview.html'
    compact = public / 'assets/lb-community-traveler-compact-v2.js'
    votes = public / 'assets/lb-community-traveler-vote-v3.js'
    for p in (core, compact, votes):
        if not p.is_file():
            raise RuntimeError(f'fichier absent : {p}')

    before_core = core.read_bytes()
    before_compact = compact.read_bytes()
    current_votes = votes.read_text(encoding='utf-8')
    c0 = before_core.decode('utf-8')
    c1 = before_compact.decode('utf-8')

    if 'LB_COMMUNITY_NONOFFICIAL_UX_V2_VOTES' not in current_votes:
        raise RuntimeError('ligne NON OFFICIEL/Voyageur absente du module votes')
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES' not in current_votes:
        raise RuntimeError('racefix-v3 absent du module votes')
    if "NON OFFICIEL · Voyageur · ${station}" not in current_votes:
        raise RuntimeError('libelle NON OFFICIEL actuel introuvable')

    after_core = patch_core(c0)
    after_compact = patch_compact(c1)
    node_check(after_compact)

    for token, label in [
        ('(+${delayMin} min)', 'retard principal entre parentheses sans vache'),
        ('(+${delay} min)', 'retard arret sans vache'),
        ('(+${delay}m)', 'retard carte sans vache'),
        ('background:rgba(77,43,113,.24)', 'fond principal transparent conserve'),
        ('background:rgba(70,38,104,.28)', 'fond arret transparent conserve'),
        ('background:rgba(61,34,91,.52)', 'fond carte allege conserve'),
        ('LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT', 'racefix preserve'),
    ]:
        if token not in after_compact:
            raise RuntimeError('controle echoue : ' + label)

    if '(🐮 +${delayMin} min)' in after_compact or '(🐮 +${delay} min)' in after_compact or '(🐮 +${delay}m)' in after_compact:
        raise RuntimeError('controle echoue : une vache subsiste dans un badge de retard communautaire')

    print('PRESENTATION VOIX DU BETAIL V4 VERIFIEE :')
    print('  ✓ retard principal : (+N min), sans vache')
    print('  ✓ arrêts : (+N min), sans vache')
    print('  ✓ curseur carte : (+Nm), sans vache')
    print('  ✓ fonds violets transparents de V3 conservés')
    print('  ✓ “NON OFFICIEL · Voyageur · gare” conservé')
    print('  ✓ indicateur de présence / nombre de bétail non touché')
    print('  ✓ pouces + racefix-v3 intacts')
    print('  ✓ retard officiel orange totalement intact')
    print('  ✓ aucun GTFS / routage / service / API modifié')

    after_core_b = after_core.encode('utf-8')
    after_compact_b = after_compact.encode('utf-8')
    if after_core_b == before_core and after_compact_b == before_compact:
        print('Correctif deja installe. Aucun changement.')
        return
    if not args.apply:
        print('SIMULATION OK — ajouter --apply pour installer.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(args.root) / 'map-v2/backups' / ('community-nonofficial-v4-parens-no-cow-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(core, backup / core.name)
    shutil.copy2(compact, backup / compact.name)

    changed = []
    try:
        if compact.read_bytes() != before_compact:
            raise RuntimeError('modification concurrente compact-v2')
        atomic_write(compact, after_compact_b)
        changed.append(('compact', before_compact))
        if core.read_bytes() != before_core:
            raise RuntimeError('modification concurrente core')
        atomic_write(core, after_core_b)
        changed.append(('core', before_core))
    except BaseException:
        for name, data in reversed(changed):
            atomic_write(compact if name == 'compact' else core, data)
        print('ERREUR : rollback automatique effectue.')
        raise

    print('INSTALLÉ — suppression de la vache sur les retards communautaires uniquement.')
    print('Sauvegarde :', backup)
    print('Recharge la carte et ferme/reouvre la fiche train.')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        raise SystemExit('ARRÊT : ' + str(e))
