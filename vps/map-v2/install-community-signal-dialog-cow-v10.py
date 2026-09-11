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

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V10"
ROOT_DEFAULT = "/opt/labetaillere-map-v2-src"
ASSET_NAME = "lb-community-cow-modal-v10.webp"
ASSET_B64_URL = "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-cow-modal-v10-small.webp.b64"
ASSET_SHA256 = "ccafa1d631854274143323d563b5f717c2789703f1894728927e44ab10fd1db1"
VERSION = "20260911-cow-exact-v10"


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
    req = urllib.request.Request(ASSET_B64_URL + "?v=" + VERSION, headers={"User-Agent":"LaBetaillere-VPS"})
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = r.read().strip()
    try:
        data = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise RuntimeError("asset vache: payload base64 invalide") from exc
    if sha256(data) != ASSET_SHA256:
        raise RuntimeError("asset vache téléchargé mais SHA256 inattendu")
    if len(data) < 30000:
        raise RuntimeError(f"asset vache anormalement petit: {len(data)} octets")
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise RuntimeError("asset vache invalide: WEBP attendu")
    return data


def node_check(text: str) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node absent : impossible de valider le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run([node, "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError("JavaScript invalide après patch: " + p.stderr.strip())
    finally:
        try: os.unlink(tmp)
        except OSError: pass


def strip_unwanted_header_text(text: str) -> tuple[str, int]:
    pat = re.compile(
        r'\s*<div\s+class="lb-signal-dialog-head-main">\s*'
        r'(?:<div\s+class="lb-signal-dialog-kicker">.*?</div>\s*)?'
        r'(?:<h2\s+class="lb-signal-dialog-title"[^>]*>.*?</h2>\s*)?'
        r'(?:<div\s+class="lb-signal-dialog-sub">.*?</div>\s*)?'
        r'</div>\s*',
        re.S | re.I,
    )
    return pat.subn("\n", text, count=1)


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    must = [
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
        "lb-signal-dialog-card",
        "lb-signal-dialog-body",
        "lb-signal-dialog-close",
        "Modifier mon signalement",
        "Supprimer",
        "Ces retards sont déclarés par des voyageurs",
    ]
    for token in must:
        if token not in text:
            raise RuntimeError(f"état du modal inattendu, ancre absente: {token}")

    if "lb-signal-dialog-mascot" in text or "LB_COMMUNITY_SIGNAL_DIALOG_COW_V7" in text or "LB_COMMUNITY_SIGNAL_DIALOG_COW_SIMPLE_V8" in text:
        raise RuntimeError("ancien habillage vache encore présent : revenez d'abord au modal simple avant V10")

    text, removed_head = strip_unwanted_header_text(text)

    text = re.sub(r'<header(\s+class="lb-signal-dialog-head"[^>]*)>', r'<div\1>', text, count=1, flags=re.I)
    if '<div class="lb-signal-dialog-head"' in text and '</header>' in text:
        pos = text.find('<div class="lb-signal-dialog-head"')
        end = text.find('</header>', pos)
        if end >= 0:
            text = text[:end] + '</div>' + text[end + len('</header>'):]

    section_re = re.compile(r'(<section\s+class="lb-signal-dialog-card"[^>]*>)', re.I)
    matches = list(section_re.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f"section modal attendue exactement 1 fois, trouvée {len(matches)}")
    m = matches[0]
    stage_open = (
        '<div class="lb-signal-dialog-stack">\n'
        f'        <!-- {MARK}: image décorative fournie, aucune logique métier -->\n'
        f'        <img class="lb-signal-dialog-cow-v10" src="./assets/{ASSET_NAME}?v={VERSION}" alt="" aria-hidden="true" draggable="false">\n'
        '        ' + m.group(1)
    )
    text = text[:m.start()] + stage_open + text[m.end():]

    start = text.find(stage_open)
    end = text.find('</section>', start)
    if end < 0:
        raise RuntimeError("fermeture </section> du modal introuvable")
    text = text[:end + len('</section>')] + '\n      </div>' + text[end + len('</section>'):]

    style_end = "    `;\n    document.head.appendChild(style);"
    if text.count(style_end) != 1:
        raise RuntimeError("fin du CSS du dialogue introuvable ou ambiguë")

    css = r'''
      /* LB_COMMUNITY_SIGNAL_DIALOG_COW_EXACT_V10 — décoration seulement. */
      .lb-signal-dialog-stack{
        --lb-cow-w:clamp(205px,25vw,285px);
        box-sizing:border-box;
        width:min(520px,calc(100vw - 28px));
        max-width:100%;
        max-height:calc(100vh - 24px);
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
      }
      .lb-signal-dialog-cow-v10{
        position:relative;
        z-index:2;
        flex:0 0 auto;
        display:block;
        width:var(--lb-cow-w);
        height:auto;
        max-height:38vh;
        object-fit:contain;
        margin:0 auto -44px;
        pointer-events:none;
        user-select:none;
        -webkit-user-drag:none;
        filter:drop-shadow(0 10px 16px rgba(0,0,0,.32));
      }
      .lb-signal-dialog-stack>.lb-signal-dialog-card{
        position:relative;
        z-index:3;
        width:100%!important;
        min-height:0;
        max-height:min(62vh,620px)!important;
      }
      @media(max-height:720px) and (min-width:701px){
        .lb-signal-dialog-stack{--lb-cow-w:clamp(170px,21vw,220px)}
        .lb-signal-dialog-cow-v10{margin-bottom:-34px;max-height:31vh}
        .lb-signal-dialog-stack>.lb-signal-dialog-card{max-height:58vh!important}
      }
      @media(max-width:700px),(pointer:coarse){
        .lb-signal-dialog-v1{align-items:flex-end!important}
        .lb-signal-dialog-stack{
          --lb-cow-w:clamp(155px,48vw,210px);
          width:100%;
          max-height:96vh;
          justify-content:flex-end;
        }
        .lb-signal-dialog-cow-v10{margin-bottom:-30px;max-height:28vh}
        .lb-signal-dialog-stack>.lb-signal-dialog-card{max-height:68vh!important}
      }
'''
    text = text.replace(style_end, css + style_end, 1)

    if text.count('class="lb-signal-dialog-cow-v10"') != 1:
        raise RuntimeError("image vache absente ou dupliquée")
    if text.count('class="lb-signal-dialog-stack"') != 1:
        raise RuntimeError("wrapper modal absent ou dupliqué")
    if text.count('lb-signal-dialog-close') < 1:
        raise RuntimeError("croix de fermeture perdue")
    if "Ces retards sont déclarés par des voyageurs" not in text:
        raise RuntimeError("bandeau d'information utile a disparu")
    if "Modifier mon signalement" not in text or "Supprimer" not in text:
        raise RuntimeError("actions métier perdues")

    template_start = text.find('root.innerHTML = `')
    template_end = text.find('`;', template_start)
    template = text[template_start:template_end] if template_start >= 0 and template_end >= 0 else text
    for forbidden in ["Signalement voyageur · NON OFFICIEL", "Retard communautaire", "Chaque signalement est noté séparément"]:
        if forbidden in template:
            raise RuntimeError(f"texte indésirable encore présent dans le modal: {forbidden}")

    return text


def patch_core(text: str) -> str:
    pat = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pat.subn(r'\g<1>' + VERSION, text)
    if n != 1:
        raise RuntimeError(f"core: référence du dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Ajoute uniquement la vache #BER fournie au-dessus du modal retard voyageur")
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

    cow_data = download_asset()
    print("ETAPE 1/5 — IMAGE")
    print(f"  ✓ WEBP valide, {len(cow_data)} octets")
    print(f"  ✓ SHA256 {sha256(cow_data)}")

    after_dialog = patch_dialog(before_dialog.decode("utf-8"))
    after_core = patch_core(before_core.decode("utf-8"))
    print("ETAPE 2/5 — PATCH EN MEMOIRE")
    print("  ✓ aucun fichier encore modifié")
    print("  ✓ uniquement image/wrapper/CSS décoratif + suppression des 3 textes du haut")

    node_check(after_dialog)
    print("ETAPE 3/5 — VALIDATION")
    print("  ✓ node --check OK")
    print("  ✓ croix conservée")
    print("  ✓ bandeau 'Ces retards...' conservé")
    print("  ✓ Modifier / Supprimer conservés")

    if not args.apply:
        print("ETAPE 4/5 — SIMULATION OK")
        print("  Aucun fichier n'a été écrit. Relancer avec --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-cow-exact-v10-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)
    if cow.exists():
        shutil.copy2(cow, backup / cow.name)
    print("ETAPE 4/5 — BACKUP")
    print("  ✓", backup)

    changed: list[tuple[Path, bytes | None]] = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée : aucun fichier écrit")
        atomic_write(cow, cow_data); changed.append((cow, before_cow))
        atomic_write(dialog, after_dialog.encode("utf-8")); changed.append((dialog, before_dialog))
        atomic_write(core, after_core.encode("utf-8")); changed.append((core, before_core))

        if sha256(cow.read_bytes()) != ASSET_SHA256:
            raise RuntimeError("contrôle après écriture: SHA256 image incorrect")
        installed_js = dialog.read_text(encoding="utf-8")
        node_check(installed_js)
        if MARK not in installed_js or 'class="lb-signal-dialog-cow-v10"' not in installed_js:
            raise RuntimeError("contrôle après écriture: marqueur/image absents")
        installed_core = core.read_text(encoding="utf-8")
        if f"lb-community-signal-dialog-v1.js?v={VERSION}" not in installed_core:
            raise RuntimeError("contrôle après écriture: cache-bust core absent")
    except BaseException:
        for path, data in reversed(changed):
            if data is None:
                try: path.unlink()
                except FileNotFoundError: pass
            else:
                atomic_write(path, data)
        print("ERREUR — rollback automatique effectué.")
        raise

    print("ETAPE 5/5 — INSTALLATION + RELECTURE")
    print("  ✓ image exacte installée")
    print("  ✓ JavaScript revalidé après écriture")
    print("  ✓ cache-bust installé")
    print("  ✓ aucune API / vote / backend / GTFS / routage modifiés")
    print("INSTALLATION OK")
    print("Recharge ensuite la carte avec Ctrl+F5 et ouvre un retard voyageur.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit("ARRÊT : " + str(exc))
