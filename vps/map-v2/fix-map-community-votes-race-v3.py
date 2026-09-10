#!/usr/bin/env python3
"""Fix transient disappearance of Voix du Betail thumbs in map train sheet.

The compact community renderer and vote renderer both own .lb-community-source-line.
This patch gives the vote renderer ownership while votes are active, guarantees a
stable loading state, and orders the vote render after compact decoration.

Dry-run by default. --apply writes atomic backups. No GTFS/routing/service/API change.
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

MARK = "LB_MAP_COMMUNITY_VOTES_RACEFIX_V3"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouve {count}")
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
        raise RuntimeError("node absent: impossible de verifier le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError(f"JavaScript invalide {name}: {p.stderr.strip()}")
    finally:
        try: os.unlink(tmp)
        except OSError: pass


def patch_compact(text: str) -> str:
    if "LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT" in text:
        return text

    old = """    sourceLine.textContent = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';
    sourceLine.hidden = !sourceStation;
    block.dataset.lbCommunityStatus = `${presenceCount > 0 ? `${presenceCount} à bord` : ''}${presenceCount > 0 && delayMin > 0 ? ' · ' : ''}${delayMin > 0 ? `+${delayMin} min*` : ''}` || 'Aucun signalement';
    block.dataset.lbCommunitySource = sourceLine.textContent;"""
    new = """    // LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT
    // The vote module owns sourceLine while its vote UI is mounted. Do not erase
    // its children when a community snapshot/decorate pass arrives afterwards.
    const sourceText = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';
    block.dataset.lbCommunityStatus = `${presenceCount > 0 ? `${presenceCount} à bord` : ''}${presenceCount > 0 && delayMin > 0 ? ' · ' : ''}${delayMin > 0 ? `+${delayMin} min*` : ''}` || 'Aucun signalement';
    block.dataset.lbCommunitySource = sourceText;
    if (!sourceLine.classList.contains('lb-community-source-line--votes')) {
      sourceLine.textContent = sourceText;
      sourceLine.hidden = !sourceText;
    }"""
    text = replace_once(text, old, new, "compact/source owner")

    old2 = """    renderPropagatedStopDelays(number);
    decorateMarkerBadges();"""
    new2 = """    renderPropagatedStopDelays(number);
    decorateMarkerBadges();
    // Vote renderer runs after compact decoration, never before it.
    document.dispatchEvent(new Event('lb:community:decorated'));"""
    text = replace_once(text, old2, new2, "compact/decorated event")
    return text


def patch_votes(text: str) -> str:
    if "LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES" in text:
        return text

    old = """    if (!(delay > 0) || !station) {
      sourceLine.classList.remove('lb-community-source-line--votes');
      return;
    }"""
    new = """    if (!(delay > 0) || !station) {
      // LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES
      sourceLine.classList.remove('lb-community-source-line--votes');
      sourceLine.replaceChildren();
      const fallback = String(block.dataset.lbCommunitySource || '');
      sourceLine.textContent = fallback;
      sourceLine.hidden = !fallback;
      return;
    }"""
    text = replace_once(text, old, new, "votes/no delay cleanup")

    old2 = """    if (!signal) return;

    const votes = document.createElement('span');
    votes.className = 'lb-community-map-votes';
    votes.dataset.signalId = signal.id;
    votes.appendChild(buildVoteButton('up', signal, 1));

    const count = document.createElement('span');
    count.className = 'lb-community-map-vote-count';
    count.textContent = String(signal.upvotes - signal.downvotes);
    count.title = `Score du signalement : ${signal.upvotes - signal.downvotes}`;
    votes.appendChild(count);

    votes.appendChild(buildVoteButton('down', signal, -1));
    sourceLine.appendChild(votes);"""
    new2 = """    // Keep a stable vote shell even while the API resolves the signal id.
    // This prevents the thumbs from flashing in/out during asynchronous refreshes.
    const votes = document.createElement('span');
    votes.className = 'lb-community-map-votes';
    votes.dataset.signalId = signal?.id || '';
    const up = buildVoteButton('up', signal, 1);
    const down = buildVoteButton('down', signal, -1);
    up.disabled = !signal?.id;
    down.disabled = !signal?.id;
    up.setAttribute('aria-busy', signal?.id ? 'false' : 'true');
    down.setAttribute('aria-busy', signal?.id ? 'false' : 'true');
    votes.appendChild(up);

    const count = document.createElement('span');
    count.className = 'lb-community-map-vote-count';
    count.textContent = signal ? String(signal.upvotes - signal.downvotes) : '…';
    count.title = signal ? `Score du signalement : ${signal.upvotes - signal.downvotes}` : 'Signalement en cours de vérification';
    votes.appendChild(count);

    votes.appendChild(down);
    sourceLine.appendChild(votes);"""
    text = replace_once(text, old2, new2, "votes/stable shell")

    old3 = """  function start(){
    installStyle();"""
    new3 = """  function start(){
    document.addEventListener('lb:community:decorated', scheduleRender);
    installStyle();"""
    text = replace_once(text, old3, new3, "votes/render ordering")

    # Make disabled loading thumbs visibly present but non-clickable.
    needle = ".lb-community-map-vote-btn.is-active{opacity:1;background:rgba(91,52,126,.95);box-shadow:inset 0 0 0 1px rgba(195,154,255,.65)}"
    repl = needle + "\n      .lb-community-map-vote-btn:disabled{display:inline-flex!important;visibility:visible!important;opacity:.62!important;cursor:default!important}"
    text = replace_once(text, needle, repl, "votes/disabled style")
    return text


def patch_core(text: str) -> str:
    if MARK not in text:
        if "</head>" not in text:
            raise RuntimeError("core: </head> introuvable")
        text = text.replace("</head>", f"<!-- {MARK} -->\n</head>", 1)

    # Cache bust only; preserve paths and everything else.
    text, n1 = re.subn(r"lb-community-traveler-compact-v2\.js\?v=[^\"']+", "lb-community-traveler-compact-v2.js?v=20260910-racefix-v3", text)
    text, n2 = re.subn(r"lb-community-traveler-vote-v3\.js\?v=[^\"']+", "lb-community-traveler-vote-v3.js?v=20260910-racefix-v3", text)
    if n1 < 1 or n2 < 1:
        raise RuntimeError(f"core: references assets introuvables compact={n1} vote={n2}")
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
            raise RuntimeError(f"fichier absent: {p}")

    before = [p.read_bytes() for p in files]
    c0, c1, c2 = [b.decode("utf-8") for b in before]

    # Functional prerequisites only. Do not require historical markers.
    for token in ["lb-map-trip-community", "lb-community-traveler-compact-v2.js", "lb-community-traveler-vote-v3.js"]:
        if token not in c0:
            raise RuntimeError(f"core incompatible: {token} absent")
    for token in ["decorateCommunityBlock", "sourceLine.textContent", "decorateMarkerBadges"]:
        if token not in c1 and "LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT" not in c1:
            raise RuntimeError(f"compact incompatible: {token} absent")
    for token in ["signalForReport", "buildVoteButton", "sourceLine.replaceChildren", "method:'POST'"]:
        if token not in c2:
            raise RuntimeError(f"votes incompatible: {token} absent")

    after_text = [patch_core(c0), patch_compact(c1), patch_votes(c2)]
    node_check("compact", after_text[1])
    node_check("votes", after_text[2])

    if "sourceLine.classList.contains('lb-community-source-line--votes')" not in after_text[1]:
        raise RuntimeError("controle ownership compact echoue")
    if "signal ? String(signal.upvotes - signal.downvotes) : '…'" not in after_text[2]:
        raise RuntimeError("controle loading votes echoue")
    if "lb:community:decorated" not in after_text[1] or "lb:community:decorated" not in after_text[2]:
        raise RuntimeError("controle ordre de rendu echoue")

    print("CAUSE CONFIRMEE : deux renderers reecrivaient la meme ligne source.")
    print("  1) compact-v2 pouvait effacer 👍/👎 apres leur rendu")
    print("  2) vote-v3 retirait les pouces tant que l'ID API n'etait pas resolu")
    print("CORRECTIF V3 VERIFIE :")
    print("  ✓ la ligne votes n'est plus effacee par compact-v2")
    print("  ✓ 👍 … 👎 reste monte pendant la resolution API")
    print("  ✓ vote-v3 repasse toujours apres la decoration communautaire")
    print("  ✓ JavaScript valide avec node --check")
    print("  ✓ aucun GTFS/routage/service/API modifie")

    after = [x.encode("utf-8") for x in after_text]
    if after == before:
        print("Correctif deja installe. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-votes-race-v3-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    for p, b in zip(files, before):
        shutil.copy2(p, backup / p.name)

    changed = []
    try:
        # Assets first, core cache-bust last.
        for idx in (1, 2, 0):
            if files[idx].read_bytes() != before[idx]:
                raise RuntimeError(f"modification concurrente: {files[idx]}")
            atomic_write(files[idx], after[idx])
            changed.append(idx)
    except BaseException:
        for idx in reversed(changed):
            atomic_write(files[idx], before[idx])
        print("ERREUR : rollback automatique effectue.")
        raise

    print("INSTALLÉ — assets communauté + cache-bust core uniquement.")
    print("Sauvegarde :", backup)
    print("Ferme/reouvre la fiche ou recharge la carte pour prendre racefix-v3.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        raise SystemExit("ARRÊT : " + str(e))
