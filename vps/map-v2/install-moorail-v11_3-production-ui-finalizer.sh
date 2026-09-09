#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
JS="$ROOT/public/moorail-route-editor-stops.js"
HTML="$ROOT/public/moorail-route-editor.html"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_3-production-ui-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v113.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.3..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" ]] || { echo "ERREUR JS absent: $JS" >&2; exit 3; }
[[ -f "$HTML" ]] || { echo "ERREUR HTML absent: $HTML" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.3 — FIN DU SPINNER / SUIVANTE AUTOMATIQUE"
echo "============================================================"
echo "Cause confirmée dans V11 : validateLeg() appelle lbProductionNextV11(sid)"
echo "alors que busy=true, et lbProductionNextV11() refusait toute exécution"
echo "quand busy=true. Le passage automatique était donc auto-bloqué."
echo "V11.3 libère busy AVANT la suivante et ajoute un auto-reload de secours"
echo "uniquement si STATE + LIVE + NETWORK sont déjà confirmés mais l'UI reste bloquée."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$TIMER"
READY=0
for i in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json" 2>/dev/null; then READY=1; break; fi
  echo "  attente map $i/30..."; sleep 1
done
[[ "$READY" == 1 ]] || { echo "ERREUR Map V2 indisponible" >&2; exit 4; }
cat "$TMP/health-before.json"; echo
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 LB_MOORAIL_ROUTE_HANDLER_GUARD_V112 LB_MOORAIL_PRODUCTION_WATCHDOG_V112; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
if grep -qF 'LB_MOORAIL_PRODUCTION_FINALIZER_V113' "$JS"; then echo "ERREUR V11.3 déjà installée" >&2; exit 5; fi
node --check "$JS"
echo "Pre-flight : OK"


echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
echo "Backup : $BACKUP"


echo "=== 2/8 PATCH : CORRECTION DU VERROU busy ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_PRODUCTION_FINALIZER_V113 */'
if marker in s: raise SystemExit('V11.3 déjà présente')

# 1) Le bouton manuel "suivante" reste interdit pendant une validation,
# mais l'appel INTERNE lbProductionNextV11(sid) doit être autorisé.
old='''async function lbProductionNextV11(excludeSid=null){\n  if(state.productionV11.busy)return;'''
new='''async function lbProductionNextV11(excludeSid=null){\n  // LB_MOORAIL_PRODUCTION_FINALIZER_V113\n  // Appel manuel pendant busy => bloqué. Appel interne avec excludeSid => autorisé.\n  if(state.productionV11.busy && !excludeSid)return;'''
if old not in s:
    raise SystemExit('ERREUR ancre lbProductionNextV11/busy absente')
s=s.replace(old,new,1)

# 2) Une fois STATE/LIVE/NETWORK confirmés, on libère le verrou AVANT de
# sélectionner la suivante. Avant V11.3 le finally arrivait trop tard.
pat=re.compile(r'''(setStatus\(`✅[^\n]*?`,'ok'\);\n\s*await new Promise\(r=>setTimeout\(r,350\)\);\n)(\s*await lbProductionNextV11\(sid\);)''')
m=pat.search(s)
if not m:
    # Tolérance si le texte de statut a évolué : on s'ancre uniquement sur le délai + next.
    pat=re.compile(r'''(\s*await new Promise\(r=>setTimeout\(r,350\)\);\n)(\s*await lbProductionNextV11\(sid\);)''')
    m=pat.search(s)
if not m:
    raise SystemExit('ERREUR ancre passage suivante V11 absente')
release=m.group(1)+'''    state.productionV11.busy=false;\n    state.productionV11.busySince=0;\n    lbProductionUpdateV11();\n'''+m.group(2)
s=s[:m.start()]+release+s[m.end():]

# 3) Mémorise le SID actif au démarrage du cycle, pour le watchdog de secours.
old_busy='state.productionV11.busy=true;state.productionV11.busySince=Date.now();lbProductionUpdateV11();'
new_busy='state.productionV11.busy=true;state.productionV11.busySince=Date.now();state.productionV11.activeSidV113=sid;lbProductionUpdateV11();'
if old_busy not in s:
    # V11 sans V11.2 watchdog (filet de compatibilité)
    old_busy='state.productionV11.busy=true;lbProductionUpdateV11();'
    new_busy='state.productionV11.busy=true;state.productionV11.busySince=Date.now();state.productionV11.activeSidV113=sid;lbProductionUpdateV11();'
if old_busy not in s: raise SystemExit('ERREUR ancre busy start absente')
s=s.replace(old_busy,new_busy,1)

# 4) Secours : si backend confirmé mais UI encore busy > 15s, recharge la page.
# C'est exactement l'équivalent automatique du Ctrl+F5 qui fonctionne aujourd'hui.
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=r'''

// V11.3 — secours anti-spinner : jamais de refresh manuel nécessaire.
let lbV113ProbeRunning=false;
setInterval(async()=>{
  try{
    if(lbV113ProbeRunning||!state?.productionV11?.busy)return;
    const sid=String(state.productionV11.activeSidV113||'');
    const started=Number(state.productionV11.busySince||0);
    if(!sid||!started||Date.now()-started<15000)return;
    lbV113ProbeRunning=true;
    const [sv,lv,nw]=await Promise.all([
      fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null),
      fetch(`/map-v2/data/moorail-live-v1/sections.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null),
      fetch(`/map-v2/data/moorail-network-v8/network.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null)
    ]);
    const saved=sv?.sections?.[sid]?.status==='validated';
    const live=(lv?.pairs||[]).some(x=>String(x?.sectionId||'')===sid);
    const task=(nw?.tasks||[]).find(x=>String(x?.sectionId||'')===sid);
    const network=task?.status==='VALIDATED_V8';
    if(saved&&live&&network){
      console.warn('[MOO RAIL V11.3] backend validé, UI encore busy : reload automatique',sid);
      try{sessionStorage.setItem('moorail-v113-last',JSON.stringify({sid,at:Date.now()}));}catch(_){ }
      setStatus('✓ Validation confirmée. Actualisation automatique…','ok');
      setTimeout(()=>location.reload(),250);
    }
  }catch(e){console.warn('[MOO RAIL V11.3 probe]',e)}
  finally{lbV113ProbeRunning=false;}
},1000);
'''
s=s[:pos]+extra+'\n'+s[pos:]

p.write_text(s,encoding='utf-8')
print('Patch V11.3 préparé :')
print(' - appel interne suivante autorisé pendant le cycle')
print(' - busy libéré avant sélection de la suivante')
print(' - SID actif mémorisé')
print(' - reload automatique de secours après confirmation backend')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_PRODUCTION_FINALIZER_V113' "$TMP/editor.js"
grep -qF 'activeSidV113' "$TMP/editor.js"
grep -qF 'location.reload()' "$TMP/editor.js"
echo "Patch structurel : OK"


echo "=== 3/8 SELF-TEST STATIQUE DU DEADLOCK ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
assert 'if(state.productionV11.busy && !excludeSid)return;' in s
idx=s.find('await lbProductionNextV11(sid);')
assert idx>=0
pre=s[max(0,idx-260):idx]
assert 'state.productionV11.busy=false;' in pre,pre
assert 'activeSidV113=sid' in s
assert 'backend validé, UI encore busy' in s
print('SELF-TEST DEADLOCK busy -> suivante : OK')
print('SELF-TEST AUTO-RELOAD DE SECOURS   : OK')
PY


echo "=== 4/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
# Cache explicite : le navigateur doit récupérer le nouveau JS.
python3 - "$HTML" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.3', s)
if n==0: raise SystemExit('ERREUR référence JS HTML absente')
p.write_text(s,encoding='utf-8')
print('HTML cache V11.3 : OK')
PY
node --check "$JS"


echo "=== 5/8 RESTART + HEALTH ==="
RESTARTED=1
systemctl restart "$SERVICE"
READY=0
for i in $(seq 1 60); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json" 2>/dev/null; then READY=1; break; fi
  echo "  attente map $i/60..."; sleep 1
done
[[ "$READY" == 1 ]] || { echo "ERREUR service non revenu" >&2; journalctl -u "$SERVICE" -n 50 --no-pager || true; exit 7; }
cat "$TMP/health-after.json"; echo


echo "=== 6/8 PRODUIT SERVI ==="
SERVED="$TMP/served.js"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$SERVED"
grep -qF 'LB_MOORAIL_PRODUCTION_FINALIZER_V113' "$SERVED"
grep -qF 'if(state.productionV11.busy && !excludeSid)return;' "$SERVED"
grep -qF 'location.reload()' "$SERVED"
echo "V11.3 servi : OK"


echo "=== 7/8 NON-REGRESSION SERVER V11.2 ==="
PID0="$(systemctl show "$SERVICE" -p MainPID --value)"
HTTP="$(curl -sS -o "$TMP/state.json" -w '%{http_code}' --max-time 8 http://127.0.0.1:3111/api/map-v2/route-editor/state)"
[[ "$HTTP" == 200 ]]
sleep 1
PID1="$(systemctl show "$SERVICE" -p MainPID --value)"
[[ "$PID1" == "$PID0" ]] || { echo "ERREUR Node a redémarré $PID0 -> $PID1" >&2; exit 8; }
echo "Route editor GET sans restart : OK | PID $PID1"


echo "=== 8/8 VERDICT ==="
node --check "$JS"
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.3 INSTALLE ET VALIDE"
echo "============================================================"
echo " - deadlock busy -> suivante corrigé"
echo " - le verrou est libéré avant la sélection suivante"
echo " - si l'UI reste bloquée malgré backend confirmé : reload automatique"
echo " - plus besoin de Ctrl+F5 après chaque validation"
echo " - V11.2 garde serveur conservée"
echo "Backup : $BACKUP"
echo "============================================================"
