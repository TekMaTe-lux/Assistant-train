#!/usr/bin/env python3
"""Soften Voix du Betail delay presentation after nonofficial UX V2.

Presentation-only experiment:
- official operator delay stays untouched;
- community delay becomes parenthesized: (🐮 +N min);
- violet fills are made substantially more transparent;
- explicit NON OFFICIEL / Voyageur source line and vote racefix stay untouched;
- no GTFS, routing, service, API or vote logic change.

Dry-run by default; --apply writes an atomic backup and cache-busts compact-v2 only.
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

MARK = "LB_MAP_COMMUNITY_NONOFFICIAL_UX_V3_PARENS"


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
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V3_PARENS_COMPACT' in text:
        return text

    # Require exactly the version the user just installed. This prevents broad
    # CSS replacements on an unknown community renderer.
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT' not in text:
        raise RuntimeError('nonofficial UX V2 absent du compact-v2 : version VPS inattendue')
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT' not in text:
        raise RuntimeError('racefix-v3 absent du compact-v2 : refus de continuer')

    # Main community delay chip: quieter and explicitly secondary by typography.
    text = once(
        text,
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `🐮 Signalé +${delayMin} min`); // LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT",
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `(🐮 +${delayMin} min)`); // LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT // LB_COMMUNITY_NONOFFICIAL_UX_V3_PARENS_COMPACT",
        'texte chip principal',
    )

    # Same convention along the stop timeline and on the train marker.
    text = once(text, "label.textContent = `🐮 +${delay} min`;", "label.textContent = `(🐮 +${delay} min)`;", 'texte badge arret')
    text = once(text, "badge.textContent = `🐮 +${delay}m`;", "badge.textContent = `(🐮 +${delay}m)`;", 'texte badge carte')

    # Main status pill: retain violet identity but make it a faint wash rather
    # than a second strong operational status badge.
    text = once(
        text,
        ".lb-community-delay-status{flex:0 0 auto;box-sizing:border-box;padding:2px 5px;border:1px solid rgba(183,140,255,.64);border-radius:999px;background:rgba(77,43,113,.74);color:#f1e8ff;font-size:9.5px;font-weight:950;line-height:1.05;white-space:nowrap;box-shadow:0 0 6px rgba(183,140,255,.16)}",
        ".lb-community-delay-status{flex:0 0 auto;box-sizing:border-box;padding:2px 5px;border:1px solid rgba(183,140,255,.38);border-radius:999px;background:rgba(77,43,113,.24);color:#e5d9f3;font-size:9.5px;font-weight:850;line-height:1.05;white-space:nowrap;box-shadow:none}",
        'style chip principal',
    )

    # Stop badges: much lighter fill, still readable over the dark train sheet.
    text = once(
        text,
        ".trip-stop .lb-stop-traveler-delay-propagated{position:absolute;z-index:3;right:8px;top:15px;display:inline-flex;align-items:center;justify-content:center;padding:1px 4px;border:1px solid rgba(183,140,255,.52);border-radius:4px;background:rgba(70,38,104,.82);color:#f1e8ff;font-size:7.5px;font-weight:900;line-height:1.1;white-space:nowrap;text-align:right;text-shadow:none;box-shadow:0 0 5px rgba(183,140,255,.13);pointer-events:none}",
        ".trip-stop .lb-stop-traveler-delay-propagated{position:absolute;z-index:3;right:8px;top:15px;display:inline-flex;align-items:center;justify-content:center;padding:1px 4px;border:1px solid rgba(183,140,255,.34);border-radius:4px;background:rgba(70,38,104,.28);color:#dfd2ed;font-size:7.5px;font-weight:850;line-height:1.1;white-space:nowrap;text-align:right;text-shadow:none;box-shadow:none;pointer-events:none}",
        'style badge arret',
    )

    # Map marker needs a little more opacity than the sheet because the map can
    # be bright, but is still clearly softer than the former 0.95 fill.
    text = once(
        text,
        ".lb-map-traveler-delay.lb-map-traveler-delay-community{min-height:13px!important;padding:1px 4px!important;border:1px solid rgba(183,140,255,.72)!important;border-radius:4px!important;background:rgba(61,34,91,.95)!important;color:#f3ebff!important;font-size:7.5px!important;font-weight:900!important;letter-spacing:.01em;box-shadow:0 0 6px rgba(183,140,255,.22)!important}",
        ".lb-map-traveler-delay.lb-map-traveler-delay-community{min-height:13px!important;padding:1px 4px!important;border:1px solid rgba(183,140,255,.48)!important;border-radius:4px!important;background:rgba(61,34,91,.52)!important;color:#eee4f7!important;font-size:7.5px!important;font-weight:850!important;letter-spacing:.01em;box-shadow:none!important}",
        'style badge carte',
    )
    return text


def patch_core(text: str) -> str:
    if MARK not in text:
        if '</head>' not in text:
            raise RuntimeError('core : </head> introuvable')
        text = text.replace('</head>', f'<!-- {MARK} -->\n</head>', 1)

    text, n = re.subn(
        r'lb-community-traveler-compact-v2\.js\?v=[^\"\']+',
        'lb-community-traveler-compact-v2.js?v=20260910-nonofficial-v3-parens',
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

    # Preserve the explicit distinction and the stable thumbs installed before.
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V2_VOTES' not in current_votes:
        raise RuntimeError('nonofficial UX V2 absent du module votes')
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES' not in current_votes:
        raise RuntimeError('racefix-v3 absent du module votes')
    if "NON OFFICIEL · Voyageur · ${station}" not in current_votes:
        raise RuntimeError('libelle NON OFFICIEL actuel introuvable')

    after_core = patch_core(c0)
    after_compact = patch_compact(c1)
    node_check(after_compact)

    for token, label in [
        ('(🐮 +${delayMin} min)', 'retard principal entre parentheses'),
        ('(🐮 +${delay} min)', 'retard arret entre parentheses'),
        ('(🐮 +${delay}m)', 'retard carte entre parentheses'),
        ('background:rgba(77,43,113,.24)', 'fond principal allege'),
        ('background:rgba(70,38,104,.28)', 'fond arret allege'),
        ('background:rgba(61,34,91,.52)', 'fond carte allege'),
        ('LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT', 'racefix preserve'),
    ]:
        if token not in after_compact:
            raise RuntimeError('controle echoue : ' + label)

    print('TEST PRESENTATION VOIX DU BETAIL V3 VERIFIE :')
    print('  ✓ principal : (🐮 +N min), visuellement secondaire')
    print('  ✓ fond violet principal : opacite 0.24 au lieu de 0.74')
    print('  ✓ arrêts : (🐮 +N min), fond 0.28 au lieu de 0.82')
    print('  ✓ curseur carte : (🐮 +Nm), fond 0.52 au lieu de 0.95')
    print('  ✓ ligne “NON OFFICIEL · Voyageur · gare” conservee')
    print('  ✓ pouces + racefix-v3 intacts')
    print('  ✓ retard officiel orange totalement intact')
    print('  ✓ aucun GTFS / routage / service / API modifie')

    after_core_b = after_core.encode('utf-8')
    after_compact_b = after_compact.encode('utf-8')
    if after_core_b == before_core and after_compact_b == before_compact:
        print('Correctif deja installe. Aucun changement.')
        return
    if not args.apply:
        print('SIMULATION OK — ajouter --apply pour installer.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(args.root) / 'map-v2/backups' / ('community-nonofficial-v3-parens-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(core, backup / core.name)
    shutil.copy2(compact, backup / compact.name)

    changed = []
    try:
        # Asset first, cache-bust core last.
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

    print('INSTALLÉ — présentation communautaire uniquement.')
    print('Sauvegarde :', backup)
    print('Recharge la carte et ferme/reouvre la fiche train.')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        raise SystemExit('ARRÊT : ' + str(e))
