#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PAGE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-route-editor-ui-v1b-$STAMP"

[[ -f "$PAGE" ]] || { echo "ERREUR: page absente: $PAGE" >&2; exit 2; }
mkdir -p "$BACKUP"
cp -a "$PAGE" "$BACKUP/moorail-route-editor.html"

python3 - "$PAGE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')

old="function renderEditor(){if(!state.route){$('editor').style.display='none';return}$('editor').style.display='block';"
new="function renderEditor(){if(!state.route){$('editor').style.display='none';$('catalogView').style.display='block';return}$('catalogView').style.display='none';$('editor').style.display='block';"
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ERREUR: ancre renderEditor introuvable')

old2="$('back').onclick=()=>{state.route=null;state.section=null;$('editor').style.display='none';renderCatalog();clearLayers()};"
new2="$('back').onclick=()=>{state.route=null;state.section=null;state.anchors=[];state.pieces=[];renderEditor();renderCatalog();clearLayers()};"
if old2 in s:
    s=s.replace(old2,new2,1)
elif new2 not in s:
    raise SystemExit('ERREUR: ancre bouton retour introuvable')

p.write_text(s,encoding='utf-8')
print('Patch UI appliqué')
PY

# Vérification syntaxique du JavaScript inline
python3 - "$PAGE" <<'PY'
from pathlib import Path
import re,sys,tempfile,subprocess
s=Path(sys.argv[1]).read_text(encoding='utf-8')
blocks=re.findall(r'<script>(.*?)</script>',s,re.S)
if not blocks:
    raise SystemExit('ERREUR: aucun script inline trouvé')
with tempfile.NamedTemporaryFile('w',suffix='.js',delete=False,encoding='utf-8') as f:
    f.write('\n'.join(blocks)); name=f.name
subprocess.run(['node','--check',name],check=True)
print('JavaScript OK')
PY

chmod 0644 "$PAGE"

curl -fsS http://127.0.0.1:3111/moorail-route-editor.html >/dev/null

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR — UI V1B OK"
echo "============================================================"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo
echo "Après ouverture :"
echo "1. choisir un trajet"
echo "2. le catalogue disparaît et laisse place aux sections"
echo "3. choisir une section"
echo "4. cliquer sur une voie pour ajouter un point imposé"
echo "5. comparer rouge=ancien / cyan=nouveau"
echo "6. Valider section pour enregistrer hors production"
