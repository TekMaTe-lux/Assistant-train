#!/usr/bin/env python3
from __future__ import annotations

import argparse, os, re, shutil, subprocess, tempfile
from pathlib import Path
from datetime import datetime, timezone

ROOT_DEFAULT = "/opt/labetaillere-map-v2-src"
MARK = "LB_COMMUNITY_SIGNAL_DIALOG_HEADER_CLOSE_V4"


def atomic_write(path: Path, data: bytes):
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name+".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def node_check(text: str):
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text); tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError(p.stderr.strip())
    finally:
        try: os.unlink(tmp)
        except OSError: pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", ROOT_DEFAULT))
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    public = Path(a.root)/"map-v2/public"
    dialog = public/"assets/lb-community-signal-dialog-v1.js"
    core = public/"carte-core-preview.html"
    for p in (dialog, core):
        if not p.is_file(): raise RuntimeError(f"fichier absent: {p}")

    before_d = dialog.read_bytes(); before_c = core.read_bytes()
    d = before_d.decode("utf-8"); c = before_c.decode("utf-8")

    if "__LB_COMMUNITY_SIGNAL_DIALOG_V1__" not in d:
        raise RuntimeError("dialogue signal V1 absent")

    # Cause réelle : la carte intégrée applique `header{display:none!important}`.
    # Notre modal utilisait un élément HTML <header>, donc TOUT l'en-tête du modal
    # (titre + croix) était masqué. On remplace seulement la balise sémantique par <div>.
    if MARK not in d:
        open_old = '<header class="lb-signal-dialog-head">'
        if d.count(open_old) != 1:
            raise RuntimeError(f"balise <header> dialogue attendue 1 fois, trouvée {d.count(open_old)}")
        d = d.replace(open_old, f'<div class="lb-signal-dialog-head" data-lb-fix="{MARK}">', 1)

        close_pat = re.compile(r'(\s*</div>\s*\n\s*)</header>(\s*\n\s*<div class="lb-signal-dialog-body">)')
        d2, n = close_pat.subn(r'\1</div>\2', d, count=1)
        if n != 1:
            # fallback très ciblé sur le fragment connu
            old = '          </div>\n          <button type="button" class="lb-signal-dialog-close" aria-label="Fermer">×</button>\n        </header>\n        <div class="lb-signal-dialog-body">'
            if old not in d:
                raise RuntimeError("fermeture </header> du dialogue introuvable")
            d2 = d.replace(old, '          </div>\n          <button type="button" class="trip-panel-close lb-signal-dialog-close" aria-label="Fermer">×</button>\n        </div>\n        <div class="lb-signal-dialog-body">', 1)
        d = d2

    # Réutiliser EXACTEMENT la classe visuelle de fermeture déjà utilisée par les fiches train.
    btn_pat = re.compile(r'<button type="button" class="([^"]*\blb-signal-dialog-close\b[^"]*)" aria-label="Fermer">×</button>')
    m = btn_pat.search(d)
    if not m:
        raise RuntimeError("bouton de fermeture du dialogue introuvable")
    classes = m.group(1).split()
    if "trip-panel-close" not in classes:
        classes.insert(0, "trip-panel-close")
        d = d[:m.start(1)] + " ".join(classes) + d[m.end(1):]

    # Ne pas redéfinir son apparence : on laisse .trip-panel-close du site faire le rendu.
    d = re.sub(
        r'\n\s*\.lb-signal-dialog-close\{[^}]*\}\n?',
        '\n      .lb-signal-dialog-close{flex:0 0 auto}\n',
        d,
        count=1,
    )

    # Le div doit rester visible même si une règle générale vise les headers.
    if f'data-lb-fix="{MARK}"' not in d:
        raise RuntimeError("marqueur V4 absent après patch")
    if '<header class="lb-signal-dialog-head">' in d:
        raise RuntimeError("ancien <header> encore présent")
    if 'class="trip-panel-close lb-signal-dialog-close"' not in d and 'class="lb-signal-dialog-close trip-panel-close"' not in d:
        raise RuntimeError("classe trip-panel-close non appliquée")

    # Cache-bust uniquement l'asset dialogue.
    ver = "20260910-signal-dialog-header-close-v4"
    c2, n = re.subn(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+', r'\g<1>'+ver, c)
    if n != 1:
        raise RuntimeError(f"référence dialogue dans core attendue 1 fois, trouvée {n}")
    c = c2

    node_check(d)

    print("CAUSE IDENTIFIÉE :")
    print("  - la carte intégrée masque globalement les éléments <header>")
    print("  - le modal communautaire utilisait <header class=lb-signal-dialog-head>")
    print("  - titre ET croix étaient donc invisibles")
    print("CORRECTIF V4 VÉRIFIÉ :")
    print("  ✓ <header> du modal remplacé par <div> — même structure visuelle")
    print("  ✓ croix = classe .trip-panel-close déjà utilisée sur les fiches train")
    print("  ✓ même glyphe × et aria-label Fermer")
    print("  ✓ aucun nouveau style de croix inventé")
    print("  ✓ clic de fermeture existant conservé")
    print("  ✓ modification/suppression/votes inchangés")
    print("  ✓ aucun backend / GTFS / routage / service modifié")

    after_d = d.encode(); after_c = c.encode()
    if after_d == before_d and after_c == before_c:
        print("Déjà installé."); return
    if not a.apply:
        print("SIMULATION OK — ajouter --apply"); return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(a.root)/"map-v2/backups"/f"community-signal-dialog-header-close-v4-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup/dialog.name); shutil.copy2(core, backup/core.name)

    changed=[]
    try:
        if dialog.read_bytes()!=before_d or core.read_bytes()!=before_c:
            raise RuntimeError("modification concurrente détectée")
        atomic_write(dialog, after_d); changed.append((dialog,before_d))
        atomic_write(core, after_c); changed.append((core,before_c))
    except BaseException:
        for p,data in reversed(changed): atomic_write(p,data)
        print("ERREUR — rollback automatique effectué")
        raise

    print("INSTALLÉ — en-tête/croix du modal uniquement.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis rouvre le retard voyageur.")

if __name__ == "__main__":
    try: main()
    except Exception as e: raise SystemExit("ARRÊT : "+str(e))
