#!/usr/bin/env python3
"""Make Voix du Betail delay unmistakably non-official in the map train sheet.

Presentation-only patch. It changes community wording/badges in the installed map assets,
keeps the existing vote racefix, and does not touch GTFS, routing, train delay logic,
services, or the vote API.

Dry-run by default. --apply writes atomic backups and cache-busts the two community assets.
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

MARK = "LB_MAP_COMMUNITY_NONOFFICIAL_UX_V1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouve {n}")
    return text.replace(old, new, 1)


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
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


def node_check(name: str, text: str) -> None:
    if not shutil.which("node"):
        raise RuntimeError("node absent : impossible de verifier le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError(f"JavaScript invalide {name}: {p.stderr.strip()}")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch_compact(text: str) -> str:
    if "LB_COMMUNITY_NONOFFICIAL_UX_V1_COMPACT" in text:
        return text
    if "LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT" not in text:
        raise RuntimeError("compact-v2 : racefix-v3 absent, refus d'empiler sur une version inconnue")

    text = replace_once(
        text,
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `+${delayMin} min*`);",
        "const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `🐮 +${delayMin} min`); // LB_COMMUNITY_NONOFFICIAL_UX_V1_COMPACT",
        "compact/status chip",
    )
    text = replace_once(
        text,
        "delayChip.title = 'Retard signalé par la communauté';",
        "delayChip.title = 'Signalement voyageur — information non officielle';",
        "compact/status title",
    )
    text = replace_once(
        text,
        "delayChip.setAttribute('aria-label', `Retard communautaire de ${delayMin} minutes`);",
        "delayChip.setAttribute('aria-label', `Signalement voyageur non officiel : ${delayMin} minutes de retard`);",
        "compact/status aria",
    )

    # racefix-v3 source fallback text
    text = replace_once(
        text,
        "const sourceText = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';",
        "const sourceText = sourceStation ? `NON OFFICIEL · signalé par un voyageur depuis ${sourceStation}` : '';",
        "compact/source wording",
    )

    # Internal status text: remove the ambiguous asterisk too.
    text = replace_once(
        text,
        "${delayMin > 0 ? `+${delayMin} min*` : ''}",
        "${delayMin > 0 ? `signalement voyageur +${delayMin} min` : ''}",
        "compact/dataset wording",
    )

    # Stop timeline propagated community badge.
    text = replace_once(
        text,
        "label.textContent = `+${delay} min*`;",
        "label.textContent = `🐮 +${delay} min`;",
        "compact/stop badge",
    )
    text = replace_once(
        text,
        "label.title = `Retard signalé depuis ${sourceStation} par ${reports} voyageur${reports > 1 ? 's' : ''} — appliqué aux arrêts suivants jusqu’au prochain signalement.`;",
        "label.title = `Signalement voyageur NON OFFICIEL depuis ${sourceStation} par ${reports} voyageur${reports > 1 ? 's' : ''} — appliqué aux arrêts suivants jusqu’au prochain signalement.`;",
        "compact/stop title",
    )
    text = replace_once(
        text,
        "label.setAttribute('aria-label', `Retard communautaire de ${delay} minutes, signalé depuis ${sourceStation}`);",
        "label.setAttribute('aria-label', `Signalement voyageur non officiel : ${delay} minutes de retard, depuis ${sourceStation}`);",
        "compact/stop aria",
    )

    # Train marker badge.
    text = replace_once(
        text,
        "badge.textContent = `+${delay}min*`;",
        "badge.textContent = `🐮 +${delay}m`;",
        "compact/marker badge",
    )
    text = replace_once(
        text,
        "badge.title = `Retard signalé par la communauté : +${delay} min (* = communauté)`;",
        "badge.title = `Signalement voyageur — NON OFFICIEL : +${delay} min`;",
        "compact/marker title",
    )
    text = replace_once(
        text,
        "badge.setAttribute('aria-label', `Retard communautaire de ${delay} minutes`);",
        "badge.setAttribute('aria-label', `Signalement voyageur non officiel : ${delay} minutes de retard`);",
        "compact/marker aria",
    )
    return text


def patch_votes(text: str) -> str:
    if "LB_COMMUNITY_NONOFFICIAL_UX_V1_VOTES" in text:
        return text
    if "LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES" not in text:
        raise RuntimeError("vote-v3 : racefix-v3 absent, refus d'empiler sur une version inconnue")

    old = """    const label = document.createElement('span');
    label.className = 'lb-community-source-label';
    label.textContent = `Retard signalé par le bétail depuis ${station}`;
    label.title = `Retard voyageur signalé par le bétail depuis ${station}`;
    sourceLine.appendChild(label);"""
    new = """    // LB_COMMUNITY_NONOFFICIAL_UX_V1_VOTES
    const unofficial = document.createElement('span');
    unofficial.className = 'lb-community-unofficial-pill';
    unofficial.textContent = 'NON OFFICIEL';
    unofficial.title = 'Information issue d’un signalement voyageur, distincte du retard officiel opérateur';
    sourceLine.appendChild(unofficial);

    const label = document.createElement('span');
    label.className = 'lb-community-source-label';
    label.textContent = `Signalé par un voyageur · ${station}`;
    label.title = `Signalement voyageur non officiel depuis ${station}`;
    sourceLine.appendChild(label);"""
    text = replace_once(text, old, new, "votes/source wording")

    # Make the distinction visually strong but compact. Violet remains the community color.
    needle = ".lb-community-source-label{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8b9dd}"
    repl = needle + "\n      .lb-community-unofficial-pill{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;padding:2px 5px;border:1px solid rgba(207,168,255,.72);border-radius:999px;background:rgba(91,52,126,.92);color:#fff4ff;font-size:7px;font-weight:950;line-height:1;letter-spacing:.055em;white-space:nowrap}"
    text = replace_once(text, needle, repl, "votes/unofficial style")

    # Desktop source line now has 3 children: pill + text + votes.
    text = replace_once(
        text,
        ".lb-community-source-line.lb-community-source-line--votes{display:flex!important;align-items:center!important;gap:5px!important;min-width:0!important;overflow:hidden!important}",
        ".lb-community-source-line.lb-community-source-line--votes{display:flex!important;align-items:center!important;gap:5px!important;min-width:0!important;overflow:hidden!important}",
        "votes/source line anchor",
    )

    # Mobile grid: pill | text | votes. It remains one compact row under the title/actions.
    text = replace_once(
        text,
        ".lb-community-source-line.lb-community-source-line--votes{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;column-gap:5px!important;width:100%!important;max-width:100%!important;overflow:visible!important;padding-top:1px!important}",
        ".lb-community-source-line.lb-community-source-line--votes{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important;column-gap:5px!important;width:100%!important;max-width:100%!important;overflow:visible!important;padding-top:1px!important}",
        "votes/mobile grid",
    )

    return text


def patch_core(text: str) -> str:
    if MARK not in text:
        if "</head>" not in text:
            raise RuntimeError("core : </head> introuvable")
        text = text.replace("</head>", f"<!-- {MARK} -->\n</head>", 1)

    text, n1 = re.subn(
        r"lb-community-traveler-compact-v2\.js\?v=[^\"']+",
        "lb-community-traveler-compact-v2.js?v=20260910-nonofficial-v1",
        text,
    )
    text, n2 = re.subn(
        r"lb-community-traveler-vote-v3\.js\?v=[^\"']+",
        "lb-community-traveler-vote-v3.js?v=20260910-nonofficial-v1",
        text,
    )
    if n1 < 1 or n2 < 1:
        raise RuntimeError(f"core : references assets introuvables compact={n1} vote={n2}")
    return text


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", "/opt/labetaillere-map-v2-src"))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    core = public / "carte-core-preview.html"
    compact = public / "assets/lb-community-traveler-compact-v2.js"
    votes = public / "assets/lb-community-traveler-vote-v3.js"
    files = [core, compact, votes]
    for p in files:
        if not p.is_file():
            raise RuntimeError(f"fichier absent : {p}")

    before = [p.read_bytes() for p in files]
    c0, c1, c2 = [b.decode("utf-8") for b in before]

    after_text = [patch_core(c0), patch_compact(c1), patch_votes(c2)]
    node_check("compact", after_text[1])
    node_check("votes", after_text[2])

    checks = [
        ("NON OFFICIEL", after_text[2], "mention NON OFFICIEL"),
        ("Signalé par un voyageur", after_text[2], "source voyageur"),
        ("🐮 +${delay}m", after_text[1], "badge carte communautaire"),
        ("🐮 +${delay} min", after_text[1], "badge arret communautaire"),
        ("LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT", after_text[1], "racefix compact preserve"),
        ("LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES", after_text[2], "racefix votes preserve"),
    ]
    for token, text, label in checks:
        if token not in text:
            raise RuntimeError(f"controle echoue : {label}")

    print("PRESENTATION COMMUNAUTAIRE V1 VERIFIEE :")
    print("  ✓ retard officiel reste inchangé (orange)")
    print("  ✓ retard Voix du Bétail devient explicitement un SIGNALEMENT VOYAGEUR")
    print("  ✓ mention NON OFFICIEL visible dans la ligne source")
    print("  ✓ badges communauté : 🐮 +N min, sans astérisque ambigu")
    print("  ✓ pouces/racefix-v3 conservés")
    print("  ✓ JavaScript valide avec node --check")
    print("  ✓ aucun GTFS/routage/service/API modifié")

    after = [x.encode("utf-8") for x in after_text]
    if after == before:
        print("Correctif deja installe. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-nonofficial-ux-v1-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    for p in files:
        shutil.copy2(p, backup / p.name)

    changed = []
    try:
        for idx in (1, 2, 0):
            if files[idx].read_bytes() != before[idx]:
                raise RuntimeError(f"modification concurrente : {files[idx]}")
            atomic_write(files[idx], after[idx])
            changed.append(idx)
    except BaseException:
        for idx in reversed(changed):
            atomic_write(files[idx], before[idx])
        print("ERREUR : rollback automatique effectue.")
        raise

    print("INSTALLÉ — présentation communauté + cache-bust uniquement.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis ferme/reouvre la fiche train.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("ARRÊT : " + str(error))
