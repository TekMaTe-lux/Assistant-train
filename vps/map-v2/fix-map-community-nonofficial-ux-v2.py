#!/usr/bin/env python3
"""Clarify Voix du Betail delays as non-official, without changing layout width.

Requires the currently installed community racefix-v3. Presentation only:
- official operator delays are untouched;
- community delay wording/badges become explicitly traveler-reported/non-official;
- thumbs and racefix stay intact;
- no GTFS, routing, service or API change.

Dry-run by default; --apply writes atomic backups and cache-busts assets.
"""
from __future__ import annotations
import argparse, os, re, shutil, subprocess, tempfile
from pathlib import Path
from datetime import datetime, timezone

MARK = "LB_MAP_COMMUNITY_NONOFFICIAL_UX_V2"


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouve {n}")
    return text.replace(old, new, 1)


def atomic_write(path, data):
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.tmp-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def node_check(name, text):
    if not shutil.which('node'):
        raise RuntimeError('node absent : impossible de verifier le JavaScript')
    with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as f:
        f.write(text); tmp = f.name
    try:
        p = subprocess.run(['node','--check',tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError(f'JavaScript invalide {name}: {p.stderr.strip()}')
    finally:
        try: os.unlink(tmp)
        except OSError: pass


def patch_compact(text):
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT' in text:
        return text
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT' not in text:
        raise RuntimeError('compact-v2 : racefix-v3 absent, version inattendue')

    text = once(text,
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `+${delayMin} min*`);",
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `🐮 Signalé +${delayMin} min`); // LB_COMMUNITY_NONOFFICIAL_UX_V2_COMPACT",
        'chip principal')
    text = once(text,
        "delayChip.title = 'Retard signalé par la communauté';",
        "delayChip.title = 'Signalement voyageur — information non officielle';",
        'titre chip')
    text = once(text,
        "delayChip.setAttribute('aria-label', `Retard communautaire de ${delayMin} minutes`);",
        "delayChip.setAttribute('aria-label', `Signalement voyageur non officiel : ${delayMin} minutes de retard`);",
        'aria chip')

    text = once(text,
        "const sourceText = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';",
        "const sourceText = sourceStation ? `NON OFFICIEL · signalé par un voyageur · ${sourceStation}` : '';",
        'source compact')

    text = once(text,
        "${delayMin > 0 ? `+${delayMin} min*` : ''}",
        "${delayMin > 0 ? `signalement voyageur +${delayMin} min` : ''}",
        'dataset status')

    text = once(text,
        "label.textContent = `+${delay} min*`;",
        "label.textContent = `🐮 +${delay} min`;",
        'badge arret')
    text = once(text,
        "label.title = `Retard signalé depuis ${sourceStation} par ${reports} voyageur${reports > 1 ? 's' : ''} — appliqué aux arrêts suivants jusqu’au prochain signalement.`;",
        "label.title = `Signalement voyageur NON OFFICIEL depuis ${sourceStation} par ${reports} voyageur${reports > 1 ? 's' : ''} — appliqué aux arrêts suivants jusqu’au prochain signalement.`;",
        'titre badge arret')
    text = once(text,
        "label.setAttribute('aria-label', `Retard communautaire de ${delay} minutes, signalé depuis ${sourceStation}`);",
        "label.setAttribute('aria-label', `Signalement voyageur non officiel : ${delay} minutes de retard, depuis ${sourceStation}`);",
        'aria badge arret')

    text = once(text,
        "badge.textContent = `+${delay}min*`;",
        "badge.textContent = `🐮 +${delay}m`;",
        'badge carte')
    text = once(text,
        "badge.title = `Retard signalé par la communauté : +${delay} min (* = communauté)`;",
        "badge.title = `Signalement voyageur — NON OFFICIEL : +${delay} min`;",
        'titre badge carte')
    text = once(text,
        "badge.setAttribute('aria-label', `Retard communautaire de ${delay} minutes`);",
        "badge.setAttribute('aria-label', `Signalement voyageur non officiel : ${delay} minutes de retard`);",
        'aria badge carte')
    return text


def patch_votes(text):
    if 'LB_COMMUNITY_NONOFFICIAL_UX_V2_VOTES' in text:
        return text
    if 'LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES' not in text:
        raise RuntimeError('vote-v3 : racefix-v3 absent, version inattendue')

    old = """    const label = document.createElement('span');
    label.className = 'lb-community-source-label';
    label.textContent = `Retard signalé par le bétail depuis ${station}`;
    label.title = `Retard voyageur signalé par le bétail depuis ${station}`;
    sourceLine.appendChild(label);"""
    new = """    const label = document.createElement('span');
    label.className = 'lb-community-source-label'; // LB_COMMUNITY_NONOFFICIAL_UX_V2_VOTES
    label.textContent = `NON OFFICIEL · Voyageur · ${station}`;
    label.title = `Signalement voyageur non officiel depuis ${station} — distinct du retard officiel opérateur`;
    sourceLine.appendChild(label);"""
    text = once(text, old, new, 'libelle votes')

    text = once(text,
        '.lb-community-source-label{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8b9dd}',
        '.lb-community-source-label{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eadcff;font-weight:900;letter-spacing:.015em}',
        'style source')
    return text


def patch_core(text):
    if MARK not in text:
        if '</head>' not in text:
            raise RuntimeError('core : </head> introuvable')
        text = text.replace('</head>', f'<!-- {MARK} -->\n</head>', 1)
    text, n1 = re.subn(r'lb-community-traveler-compact-v2\.js\?v=[^\"\']+', 'lb-community-traveler-compact-v2.js?v=20260910-nonofficial-v2', text)
    text, n2 = re.subn(r'lb-community-traveler-vote-v3\.js\?v=[^\"\']+', 'lb-community-traveler-vote-v3.js?v=20260910-nonofficial-v2', text)
    if n1 < 1 or n2 < 1:
        raise RuntimeError(f'core : references assets introuvables compact={n1} vote={n2}')
    return text


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', default=os.environ.get('LB_MAP_ROOT','/opt/labetaillere-map-v2-src'))
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    public = Path(args.root) / 'map-v2/public'
    core = public / 'carte-core-preview.html'
    compact = public / 'assets/lb-community-traveler-compact-v2.js'
    votes = public / 'assets/lb-community-traveler-vote-v3.js'
    files = [core, compact, votes]
    for p in files:
        if not p.is_file(): raise RuntimeError(f'fichier absent : {p}')

    before = [p.read_bytes() for p in files]
    c0,c1,c2 = [b.decode('utf-8') for b in before]
    after_text = [patch_core(c0), patch_compact(c1), patch_votes(c2)]
    node_check('compact', after_text[1]); node_check('votes', after_text[2])

    for token, where, label in [
        ('🐮 Signalé +${delayMin} min', after_text[1], 'chip signalé'),
        ('NON OFFICIEL · signalé par un voyageur', after_text[1], 'fallback non officiel'),
        ('NON OFFICIEL · Voyageur · ${station}', after_text[2], 'ligne source non officielle'),
        ('🐮 +${delay} min', after_text[1], 'badge arret'),
        ('🐮 +${delay}m', after_text[1], 'badge carte'),
        ('LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT', after_text[1], 'racefix compact'),
        ('LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES', after_text[2], 'racefix votes'),
    ]:
        if token not in where: raise RuntimeError(f'controle echoue : {label}')

    print('PRESENTATION VOIX DU BETAIL V2 VERIFIEE :')
    print('  ✓ officiel opérateur : inchangé, reste en orange')
    print('  ✓ communauté : “🐮 Signalé +N min” au lieu de “+N min*”')
    print('  ✓ ligne explicite : “NON OFFICIEL · Voyageur · gare”')
    print('  ✓ arrêts et curseur : badge 🐮 violet, sans astérisque ambigu')
    print('  ✓ pouces + racefix-v3 conservés')
    print('  ✓ aucune grille mobile élargie : pas de nouveau risque de débordement')
    print('  ✓ aucun GTFS / routage / service / API modifié')

    after = [x.encode('utf-8') for x in after_text]
    if after == before:
        print('Correctif deja installe. Aucun changement.'); return
    if not args.apply:
        print('SIMULATION OK — ajouter --apply pour installer.'); return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(args.root) / 'map-v2/backups' / ('community-nonofficial-ux-v2-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    for p in files: shutil.copy2(p, backup / p.name)

    changed=[]
    try:
        for idx in (1,2,0):
            if files[idx].read_bytes() != before[idx]:
                raise RuntimeError(f'modification concurrente : {files[idx]}')
            atomic_write(files[idx], after[idx]); changed.append(idx)
    except BaseException:
        for idx in reversed(changed): atomic_write(files[idx], before[idx])
        print('ERREUR : rollback automatique effectue.'); raise

    print('INSTALLÉ — présentation uniquement + cache-bust assets.')
    print('Sauvegarde :', backup)
    print('Recharge la carte puis ferme/reouvre la fiche train.')

if __name__ == '__main__':
    try: main()
    except Exception as e: raise SystemExit('ARRÊT : ' + str(e))
