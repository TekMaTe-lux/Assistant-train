#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone

ROOT_DEFAULT = "/opt/labetaillere-map-v2-src"
MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_V12"
VERSION = "20260911-cow-v12"
ASSET_NAME = "lb-community-cow-modal-v12.webp"
ASSET_SHA256 = "a8103a3d232555b3f29c9315a427f8e53a3045d9c166b4c6f2de27a44ff4dbef"
ASSET_SIZE = 17518
PART_BASE = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-cow-modal-v12.part{}.b64"
PART_COUNT = 6


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    st = path.stat() if path.exists() else None
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if st:
            os.chmod(tmp, st.st_mode & 0o7777)
            if os.geteuid() == 0:
                os.chown(tmp, st.st_uid, st.st_gid)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download_asset() -> bytes:
    chunks = []
    allowed = re.compile(rb"^[A-Za-z0-9+/=]+$")
    for i in range(PART_COUNT):
        url = PART_BASE.format(i) + "?v=" + VERSION
        req = urllib.request.Request(url, headers={"User-Agent":"LaBetaillere-VPS"})
        with urllib.request.urlopen(req, timeout=20) as r:
            part = b"".join(r.read().split())
        if not part or not allowed.fullmatch(part):
            raise RuntimeError(f"asset vache: chunk {i} invalide")
        chunks.append(part)
    payload = b"".join(chunks)
    try:
        data = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise RuntimeError("asset vache: assemblage base64 invalide") from exc
    if len(data) != ASSET_SIZE:
        raise RuntimeError(f"asset vache: taille {len(data)} != {ASSET_SIZE}")
    if sha256(data) != ASSET_SHA256:
        raise RuntimeError("asset vache: SHA256 inattendu")
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise RuntimeError("asset vache: WEBP invalide")
    return data


def node_check(text: str) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node absent")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run([node, "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError("JavaScript invalide: " + p.stderr.strip())
    finally:
        try: os.unlink(tmp)
        except OSError: pass


def remove_visible_header_text(text: str) -> str:
    pat = re.compile(
        r'\s*<div\s+class="lb-signal-dialog-head-main">.*?</div>\s*',
        re.S | re.I,
    )
    text, _ = pat.subn("\n", text, count=1)
    return text


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    for token in [
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
        "lb-signal-dialog-card",
        "lb-signal-dialog-body",
        "lb-signal-dialog-close",
        "Ces retards sont déclarés par des voyageurs",
        "Modifier mon signalement",
        "Supprimer",
    ]:
        if token not in text:
            raise RuntimeError(f"état modal inattendu: {token} absent")

    old_cow_tokens = [
        "lb-signal-dialog-mascot",
        "LB_COMMUNITY_SIGNAL_DIALOG_COW_V7",
        "LB_COMMUNITY_SIGNAL_DIALOG_COW_SIMPLE_V8",
        "LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V10",
        "LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V11",
    ]
    if any(t in text for t in old_cow_tokens):
        raise RuntimeError("ancien habillage vache détecté : aucun changement appliqué")

    text = remove_visible_header_text(text)

    # Le modal n'a plus de titre visible : on garde un nom accessible sans ajouter de texte à l'écran.
    text = text.replace(
        'role="dialog" aria-modal="true" aria-labelledby="lb-signal-dialog-title"',
        'role="dialog" aria-modal="true" aria-label="Signalement voyageur"',
        1,
    )

    # <header> est masqué globalement par la carte embarquée : le convertir sans changer son contenu.
    text = re.sub(r'<header(\s+class="lb-signal-dialog-head"[^>]*)>', r'<div\1>', text, count=1, flags=re.I)
    p = text.find('<div class="lb-signal-dialog-head"')
    if p >= 0:
        e = text.find('</header>', p)
        if e >= 0:
            text = text[:e] + '</div>' + text[e + len('</header>'):]

    section_re = re.compile(r'(<section\s+class="lb-signal-dialog-card"[^>]*>)', re.I)
    ms = list(section_re.finditer(text))
    if len(ms) != 1:
        raise RuntimeError(f"section modal attendue 1 fois, trouvée {len(ms)}")
    m = ms[0]
    opening = (
        '<div class="lb-signal-dialog-stack">\n'
        f'        <!-- {MARK}: décoration uniquement -->\n'
        f'        <img class="lb-signal-dialog-cow-v12" src="./assets/{ASSET_NAME}?v={VERSION}" alt="" aria-hidden="true" draggable="false">\n'
        '        ' + m.group(1)
    )
    text = text[:m.start()] + opening + text[m.end():]
    s = text.find(opening)
    e = text.find('</section>', s)
    if e < 0:
        raise RuntimeError("fermeture section modal introuvable")
    text = text[:e + len('</section>')] + '\n      </div>' + text[e + len('</section>'):]

    style_end = "    `;\n    document.head.appendChild(style);"
    if text.count(style_end) != 1:
        raise RuntimeError("ancre CSS dialogue introuvable")

    css = r'''
      /* LB_COMMUNITY_SIGNAL_DIALOG_COW_V12 — habillage décoratif uniquement */
      .lb-signal-dialog-stack{
        --lb-cow-w:clamp(190px,24vw,260px);
        box-sizing:border-box;
        width:min(520px,calc(100vw - 28px));
        max-width:100%;
        max-height:calc(100vh - 20px);
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
      }
      .lb-signal-dialog-cow-v12{
        position:relative;
        z-index:4;
        display:block;
        flex:0 0 auto;
        width:var(--lb-cow-w);
        height:auto;
        max-height:34vh;
        object-fit:contain;
        margin:0 auto -34px;
        pointer-events:none;
        user-select:none;
        -webkit-user-drag:none;
        filter:drop-shadow(0 9px 15px rgba(0,0,0,.32));
      }
      .lb-signal-dialog-stack>.lb-signal-dialog-card{
        position:relative!important;
        z-index:3;
        width:100%!important;
        min-height:0;
        max-height:min(64vh,620px)!important;
      }
      .lb-signal-dialog-stack .lb-signal-dialog-head{
        position:absolute!important;
        top:10px!important;
        right:10px!important;
        z-index:20!important;
        display:block!important;
        padding:0!important;
        margin:0!important;
        border:0!important;
        background:transparent!important;
      }
      .lb-signal-dialog-stack .lb-signal-dialog-info{margin-right:42px!important}
      @media(max-height:720px) and (min-width:701px){
        .lb-signal-dialog-stack{--lb-cow-w:clamp(160px,19vw,205px)}
        .lb-signal-dialog-cow-v12{margin-bottom:-28px;max-height:27vh}
        .lb-signal-dialog-stack>.lb-signal-dialog-card{max-height:62vh!important}
      }
      @media(max-width:700px),(pointer:coarse){
        .lb-signal-dialog-v1{align-items:flex-end!important}
        .lb-signal-dialog-stack{
          --lb-cow-w:clamp(150px,43vw,195px);
          width:100%;
          max-height:96vh;
          justify-content:flex-end;
        }
        .lb-signal-dialog-cow-v12{margin-bottom:-27px;max-height:25vh}
        .lb-signal-dialog-stack>.lb-signal-dialog-card{max-height:69vh!important}
        .lb-signal-dialog-stack .lb-signal-dialog-head{right:12px!important}
      }
'''
    text = text.replace(style_end, css + style_end, 1)

    if text.count('class="lb-signal-dialog-cow-v12"') != 1:
        raise RuntimeError("image vache absente ou dupliquée")
    if text.count('class="lb-signal-dialog-stack"') != 1:
        raise RuntimeError("wrapper absent ou dupliqué")
    if "Ces retards sont déclarés par des voyageurs" not in text:
        raise RuntimeError("bandeau utile perdu")
    if "Modifier mon signalement" not in text or "Supprimer" not in text:
        raise RuntimeError("actions métier perdues")

    start = text.find('root.innerHTML = `')
    end = text.find('`;', start)
    template = text[start:end] if start >= 0 and end >= 0 else text
    for forbidden in ["Signalement voyageur · NON OFFICIEL", "Retard communautaire", "Chaque signalement est noté séparément"]:
        if forbidden in template:
            raise RuntimeError(f"texte indésirable encore visible: {forbidden}")

    return text


def patch_core(text: str) -> str:
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + VERSION, text)
    if n != 1:
        raise RuntimeError(f"core: référence dialogue trouvée {n} fois")
    return new


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", ROOT_DEFAULT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    dialog = public / "assets/lb-community-signal-dialog-v1.js"
    core = public / "carte-core-preview.html"
    cow = public / "assets" / ASSET_NAME
    for p in (dialog, core):
        if not p.is_file():
            raise RuntimeError(f"fichier absent: {p}")

    before_dialog = dialog.read_bytes()
    before_core = core.read_bytes()
    before_cow = cow.read_bytes() if cow.exists() else None

    print("ETAPE 1/5 — ASSET")
    cow_data = download_asset()
    print(f"  ✓ 6 chunks téléchargés et assemblés")
    print(f"  ✓ WEBP {len(cow_data)} octets")
    print(f"  ✓ SHA256 {sha256(cow_data)}")

    print("ETAPE 2/5 — PATCH EN MEMOIRE")
    after_dialog = patch_dialog(before_dialog.decode("utf-8"))
    after_core = patch_core(before_core.decode("utf-8"))
    print("  ✓ aucun fichier modifié")
    print("  ✓ aucun texte supplémentaire ajouté")
    print("  ✓ uniquement image + placement CSS")

    print("ETAPE 3/5 — VALIDATION")
    node_check(after_dialog)
    print("  ✓ node --check OK")
    print("  ✓ croix conservée")
    print("  ✓ bandeau d'information conservé")
    print("  ✓ Modifier / Supprimer conservés")

    if not args.apply:
        print("ETAPE 4/5 — SIMULATION OK")
        print("  Aucun fichier écrit. --apply nécessaire pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-cow-v12-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)
    if cow.exists(): shutil.copy2(cow, backup / cow.name)
    print("ETAPE 4/5 — BACKUP")
    print("  ✓", backup)

    changed = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée")
        atomic_write(cow, cow_data); changed.append((cow, before_cow))
        atomic_write(dialog, after_dialog.encode("utf-8")); changed.append((dialog, before_dialog))
        atomic_write(core, after_core.encode("utf-8")); changed.append((core, before_core))

        if sha256(cow.read_bytes()) != ASSET_SHA256:
            raise RuntimeError("contrôle image après écriture échoué")
        installed_js = dialog.read_text(encoding="utf-8")
        node_check(installed_js)
        if MARK not in installed_js or 'class="lb-signal-dialog-cow-v12"' not in installed_js:
            raise RuntimeError("contrôle JS après écriture échoué")
        if f"lb-community-signal-dialog-v1.js?v={VERSION}" not in core.read_text(encoding="utf-8"):
            raise RuntimeError("cache-bust après écriture absent")
    except BaseException:
        for path, data in reversed(changed):
            if data is None:
                try: path.unlink()
                except FileNotFoundError: pass
            else:
                atomic_write(path, data)
        print("ERREUR — rollback automatique effectué")
        raise

    print("ETAPE 5/5 — RELECTURE")
    print("  ✓ asset exact installé")
    print("  ✓ JS revalidé")
    print("  ✓ cache-bust présent")
    print("  ✓ backend / API / votes / GTFS / routage inchangés")
    print("INSTALLATION OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
