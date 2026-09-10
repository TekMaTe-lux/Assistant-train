#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_7_3-no-auto-publish-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1173.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.7.3..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers éditeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.7.3 — VALIDATION RAPIDE / PAS D'ANALYSE AUTO"
echo "============================================================"
echo "Cause du timeout 15 s : l'analyse automatique Publication France V3"
echo "appelait /publish-preview, qui lance encore un compilateur synchrone"
echo "dans le serveur Node. Pendant ce calcul, /save et /health attendent."
echo "V11.7.3 retire UNIQUEMENT les appels automatiques à cette analyse."
echo "Les boutons de publication restent disponibles manuellement."
echo

echo "=== 0/6 PRE-FLIGHT DISQUE ==="
for marker in LB_MOORAIL_PUBLISH_V101 LB_MOORAIL_BRICK_BY_BRICK_V117 LB_MOORAIL_NEXT_LEGACY_FIX_V1172; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
grep -qF 'async function refreshPublishPreview' "$JS" || { echo "ERREUR refreshPublishPreview absente" >&2; exit 4; }
if grep -qF 'LB_MOORAIL_NO_AUTO_PUBLISH_V1173' "$JS"; then echo "ERREUR V11.7.3 déjà installée" >&2; exit 5; fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/6 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/6 PATCH JS ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_NO_AUTO_PUBLISH_V1173 */'
if marker in s: raise SystemExit('V11.7.3 déjà présente')

# 1) Retire l'analyse lourde automatique ajoutée historiquement à selectRoute().
m=re.search(r'async function selectRoute\(r\)\{.*?\n\}',s,re.S)
if not m: raise SystemExit('ERREUR selectRoute introuvable')
blk=m.group(0)
newblk=blk
newblk=newblk.replace('await activateLeg(0);await refreshPublishPreview();','await activateLeg(0);lbPublishIdleV1173();')
newblk=newblk.replace('await activateLeg(0); await refreshPublishPreview();','await activateLeg(0); lbPublishIdleV1173();')
newblk=re.sub(r'await\s+refreshPublishPreview\(\);', 'lbPublishIdleV1173();', newblk)
if 'refreshPublishPreview()' in newblk:
    raise SystemExit('ERREUR appel auto refreshPublishPreview encore présent dans selectRoute')
s=s[:m.start()]+newblk+s[m.end():]

# 2) Ancien mode production V11 pouvait aussi relancer l'analyse en arrière-plan.
s=s.replace("try{if(typeof refreshPublishPreview==='function')refreshPublishPreview();}catch(_){ }",
            "try{lbPublishIdleV1173();}catch(_){ }",1)

# 3) Quand V11.7 ouvre directement la suivante, remettre le panneau en état neutre.
m=re.search(r'async function lbBrickOpenV117\(r\)\{.*?\n\}',s,re.S)
if not m: raise SystemExit('ERREUR lbBrickOpenV117 introuvable')
blk=m.group(0)
if 'lbPublishIdleV1173();' not in blk:
    blk=blk.replace('try{lbProductionUpdateV11();}catch(_){}','try{lbProductionUpdateV11();}catch(_){}\n  lbPublishIdleV1173();')
    s=s[:m.start()]+blk+s[m.end():]

# 4) Helper UI. Il ne remplace PAS refreshPublishPreview(): le bouton Analyser reste manuel.
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=marker+r'''

function lbPublishIdleV1173(){
  try{
    const box=document.getElementById('publishSummary');
    const result=document.getElementById('publishResult');
    const link=document.getElementById('publishLink');
    if(box){
      box.className='status';
      box.innerHTML='⚡ <b>Validation rapide active</b><br>Analyse France V3 uniquement sur clic « Analyser ».';
    }
    if(result)result.innerHTML='';
    if(link)link.style.display='none';
  }catch(_){}
}
setTimeout(lbPublishIdleV1173,0);
'''
s=s[:pos]+extra+'\n'+s[pos:]

p.write_text(s,encoding='utf-8')
print('Patch V11.7.3 préparé :')
print(' - selectRoute ne lance plus refreshPublishPreview automatiquement')
print(' - ancien callback production ne lance plus l’analyse lourde')
print(' - passage à la brique suivante remet Publication en mode neutre')
print(' - bouton Analyser reste disponible manuellement')
PY
node --check "$TMP/editor.js"

echo "=== 3/6 SELF-TEST ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
assert 'LB_MOORAIL_NO_AUTO_PUBLISH_V1173' in s
sel=re.search(r'async function selectRoute\(r\)\{.*?\n\}',s,re.S); assert sel
assert 'refreshPublishPreview()' not in sel.group(0)
br=re.search(r'async function lbBrickOpenV117\(r\)\{.*?\n\}',s,re.S); assert br
assert 'lbPublishIdleV1173();' in br.group(0)
assert "$('publishCheck').onclick=()=>refreshPublishPreview();" in s
assert 'async function refreshPublishPreview' in s
print('SELF-TEST aucune analyse auto selectRoute : OK')
print('SELF-TEST suivante sans analyse lourde      : OK')
print('SELF-TEST bouton Analyser conservé          : OK')
print('SELF-TEST validation V11.7 conservée        : OK')
PY

echo "=== 4/6 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
    p=Path(raw)
    if not p.exists(): continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.7.3', s)
    if n==0: raise SystemExit(f'ERREUR référence JS absente: {p}')
    s=s.replace('Analyse des variantes GTFS impactées…','Analyse manuelle uniquement — bouton Analyser')
    p.write_text(s,encoding='utf-8')
    print('cache:',p.name,'OK')
PY

echo "=== 5/6 INSTALLATION + RESTART ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
node --check "$JS"
systemctl restart "$SERVICE"

OK=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json" 2>/dev/null; then OK=1; break; fi
  echo "  attente health $i/30..."
  sleep 1
done
[[ "$OK" == 1 ]] || { echo "ERREUR serveur 3111 non revenu" >&2; exit 6; }
cat "$TMP/health.json"; echo

echo "=== 6/6 VERIFICATION SERVIE ==="
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
node --check "$TMP/served.js"
grep -qF 'LB_MOORAIL_NO_AUTO_PUBLISH_V1173' "$TMP/served.js"
python3 - "$TMP/served.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
sel=re.search(r'async function selectRoute\(r\)\{.*?\n\}',s,re.S); assert sel
assert 'refreshPublishPreview()' not in sel.group(0)
print('Produit servi : selectRoute sans analyse auto : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.7.3 INSTALLE — VALIDATION RAPIDE ISOLEE"
echo "============================================================"
echo " - /save n'est plus mis en attente par l'analyse auto France V3"
echo " - Brique suivante n'appelle aucune compilation"
echo " - Analyser/Publier restent manuels"
echo "Backup : $BACKUP"
echo "============================================================"
