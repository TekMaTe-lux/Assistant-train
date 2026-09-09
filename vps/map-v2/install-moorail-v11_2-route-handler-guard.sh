#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
SERVER="$ROOT/server/server.mjs"
JS="$ROOT/public/moorail-route-editor-stops.js"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_2-handler-guard-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v112.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.2..." >&2
  [[ -f "$BACKUP/server.mjs" ]] && cp -a "$BACKUP/server.mjs" "$SERVER" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  if [[ "$RESTARTED" == 1 ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$SERVER" "$JS"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

echo "============================================================"
echo " MOO RAIL V11.2 — GARDE ROUTEUR / FIN DES DOUBLE-REPONSES"
echo "============================================================"
echo "Cause visée : ERR_HTTP_HEADERS_SENT après une requête route-editor."
echo "Le handler répond, puis server.mjs retombe encore sur sa réponse générique."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); assert h.get('ok') is True,h; print('Health :',h)
PY
grep -qF 'moorailRouteEditorHandler' "$SERVER" || { echo "ERREUR handler route-editor absent du serveur" >&2; exit 4; }
grep -qF 'LB_MOORAIL_PRODUCTION_V11' "$JS" || { echo "ERREUR V11 absente du JS" >&2; exit 4; }
grep -qF 'LB_MOORAIL_PRODUCTION_RECOVERY_V111' "$JS" || { echo "ERREUR V11.1 absente du JS" >&2; exit 4; }
if grep -qF 'LB_MOORAIL_ROUTE_HANDLER_GUARD_V112' "$SERVER"; then echo "ERREUR V11.2 déjà installée" >&2; exit 5; fi
node --check "$SERVER"
node --check "$JS"
echo "Pre-flight : OK"


echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$SERVER" "$BACKUP/server.mjs"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
echo "Backup : $BACKUP"


echo "=== 2/8 PATCH SERVER : RETOUR HANDLER + GARDE send() ==="
cp -a "$SERVER" "$TMP/server.mjs"
python3 - "$TMP/server.mjs" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='// LB_MOORAIL_ROUTE_HANDLER_GUARD_V112'
if marker in s: raise SystemExit('V11.2 déjà présente')

# 1) Le hook route-editor doit interrompre le routeur principal dès qu'il prend la requête.
# Accepte les différentes mises en forme accumulées par les anciennes versions.
pat_bare=re.compile(r'(?m)^(\s*)moorailRouteEditorHandler\(req,\s*res,\s*url\);\s*$')
if pat_bare.search(s):
    s=pat_bare.sub(lambda m:f"{m.group(1)}if (moorailRouteEditorHandler(req, res, url)) return;",s,1)

# Vérifie qu'un hook avec return existe réellement.
if not re.search(r'if\s*\(\s*moorailRouteEditorHandler\(req,\s*res,\s*url\)\s*\)\s*return\s*;',s):
    raise SystemExit('ERREUR: hook route-editor avec return introuvable')

# 2) Garde globale de sécurité dans send(): une seconde réponse ne doit JAMAIS tuer Node.
# On l'injecte dans la fonction send du serveur, sans toucher aux API individuelles.
m=re.search(r'(function\s+send\s*\([^)]*\)\s*\{)',s)
if not m: raise SystemExit('ERREUR: fonction send() introuvable')
insert=m.group(1)+"\n  "+marker+"\n  if (res.headersSent || res.writableEnded) return;"
s=s[:m.start()]+insert+s[m.end():]

# 3) Garde explicite avant le fallback 404 final du serveur.
# Le dernier send(res,404...) est le fallback générique du createServer.
idx=s.rfind('send(res, 404')
if idx<0: idx=s.rfind('send(res,404')
if idx<0: raise SystemExit('ERREUR: fallback 404 final introuvable')
line_start=s.rfind('\n',0,idx)+1
indent=s[line_start:idx]
if 'headersSent' not in s[max(0,line_start-180):idx]:
    guard=f"{indent}if (res.headersSent || res.writableEnded) return;\n"
    s=s[:line_start]+guard+s[line_start:]

p.write_text(s,encoding='utf-8')
print('Patch serveur préparé :')
print(' - hook route-editor => return confirmé')
print(' - send() ignore toute seconde réponse')
print(' - fallback 404 protégé')
PY
node --check "$TMP/server.mjs"
grep -qF 'LB_MOORAIL_ROUTE_HANDLER_GUARD_V112' "$TMP/server.mjs"
echo "Server patch : OK"


echo "=== 3/8 PATCH JS : WATCHDOG DU BOUTON PRODUCTION ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_PRODUCTION_WATCHDOG_V112 */'
if marker in s: raise SystemExit('watchdog V11.2 déjà présent')
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=marker+r'''

// V11.2 : aucun bouton ne doit rester éternellement sur "Validation / synchronisation".
setInterval(()=>{
  try{
    if(!state?.productionV11?.busy)return;
    const started=Number(state.productionV11.busySince||0);
    if(!started)return;
    if(Date.now()-started < 60000)return;
    console.error('[MOO RAIL V11.2] watchdog validation >60s');
    state.productionV11.busy=false;
    state.productionV11.busySince=0;
    lbProductionUpdateV11();
    setStatus('Validation interrompue après 60 s : bouton réactivé. Aucune section suivante chargée.','bad');
  }catch(_){ }
},2000);
'''
s=s[:pos]+extra+'\n'+s[pos:]
# Enregistre le début du cycle juste après busy=true.
old='state.productionV11.busy=true;lbProductionUpdateV11();'
new='state.productionV11.busy=true;state.productionV11.busySince=Date.now();lbProductionUpdateV11();'
if old not in s: raise SystemExit('ERREUR ancre busy=true V11 absente')
s=s.replace(old,new,1)
# Nettoie aussi le timestamp dans finally.
old2='state.productionV11.busy=false;lbProductionUpdateV11();'
new2='state.productionV11.busy=false;state.productionV11.busySince=0;lbProductionUpdateV11();'
# La première occurrence peut être celle du watchdog injecté ; remplace la dernière occurrence de l'ancien bloc existant.
idx=s.rfind(old2)
if idx<0: raise SystemExit('ERREUR ancre finally busy=false absente')
s=s[:idx]+new2+s[idx+len(old2):]
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_PRODUCTION_WATCHDOG_V112' "$TMP/editor.js"
echo "Watchdog JS : OK"


echo "=== 4/8 INSTALLATION + RESTART ==="
install -o root -g root -m 0644 "$TMP/server.mjs" "$SERVER"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
RESTARTED=1
systemctl restart "$SERVICE"
READY=0
for i in $(seq 1 60); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-start.json" 2>/dev/null; then READY=1; break; fi
  echo "  attente map $i/60..."; sleep 1
done
[[ "$READY" == 1 ]] || { echo "ERREUR service non revenu" >&2; journalctl -u "$SERVICE" -n 40 --no-pager || true; exit 7; }
cat "$TMP/health-start.json"; echo
PID0="$(systemctl show "$SERVICE" -p MainPID --value)"
echo "PID test : $PID0"


echo "=== 5/8 SELF-TEST ROUTE-EDITOR SANS ECRITURE ==="
# GET state doit être pris par le handler sans tomber dans le 404 générique.
HTTP="$(curl -sS -o "$TMP/state.json" -w '%{http_code}' --max-time 8 http://127.0.0.1:3111/api/map-v2/route-editor/state)"
echo "GET state HTTP : $HTTP"
[[ "$HTTP" == 200 ]]
python3 - "$TMP/state.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); assert isinstance(x.get('sections'),dict); print('GET state : OK')
PY
# POST save volontairement invalide : doit répondre 400 proprement, sans écrire ni tuer Node.
HTTP="$(curl -sS -o "$TMP/bad-save.json" -w '%{http_code}' --max-time 8 -X POST -H 'content-type: application/json' --data '{"routeId":"v112-selftest","sectionId":"v112-selftest","coordinates":[]}' http://127.0.0.1:3111/api/map-v2/route-editor/save)"
echo "POST save invalide HTTP : $HTTP"
cat "$TMP/bad-save.json"; echo
[[ "$HTTP" == 400 ]]
grep -q 'Géométrie invalide' "$TMP/bad-save.json"
sleep 1
systemctl is-active --quiet "$SERVICE"
PID1="$(systemctl show "$SERVICE" -p MainPID --value)"
[[ "$PID1" == "$PID0" ]] || { echo "ERREUR: Node a redémarré pendant le test save ($PID0 -> $PID1)" >&2; exit 8; }
echo "SAVE invalide sans crash : OK"


echo "=== 6/8 SELF-TEST PRODUCTION-REFRESH REEL ==="
HTTP="$(curl -sS -o "$TMP/refresh.json" -w '%{http_code}' --max-time 120 -X POST -H 'content-type: application/json' --data '{}' http://127.0.0.1:3111/api/map-v2/route-editor/production-refresh)"
echo "production-refresh HTTP : $HTTP"
[[ "$HTTP" == 200 ]]
python3 - "$TMP/refresh.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert x.get('ok') is True,x
print('Refresh : OK |',x.get('durationMs'),'ms | stats',x.get('stats'))
PY
sleep 2
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after-refresh.json"
PID2="$(systemctl show "$SERVICE" -p MainPID --value)"
[[ "$PID2" == "$PID0" ]] || { echo "ERREUR: Node a redémarré pendant production-refresh ($PID0 -> $PID2)" >&2; journalctl -u "$SERVICE" -n 50 --no-pager || true; exit 9; }
echo "PID inchangé après refresh : $PID2"
cat "$TMP/health-after-refresh.json"; echo


echo "=== 7/8 VERIFICATION MODANE (NE DOIT PAS ETRE INVENTEE) ==="
python3 - "$ROOT/public/data/moorail-network-v8/network.json" "$ROOT/data/route-editor/moorail-route-editor-state-v1.json" "$ROOT/public/data/moorail-live-v1/sections.json" <<'PY'
import json,sys,unicodedata
net=json.load(open(sys.argv[1]));st=json.load(open(sys.argv[2]));lv=json.load(open(sys.argv[3]))
def n(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
for t in net.get('tasks') or []:
 a=(t.get('from') or {}).get('name','');b=(t.get('to') or {}).get('name','')
 if {n(a),n(b)}=={n('Modane'),n('Saint-Jean-de-Maurienne Arvan')}:
  sid=t.get('sectionId');sec=(st.get('sections') or {}).get(sid);pairs=[x for x in lv.get('pairs') or [] if str(x.get('sectionId'))==str(sid)]
  print('sectionId:',sid);print('NETWORK:',t.get('status'));print('STATE:',sec.get('status') if sec else 'ABSENT');print('LIVE:',len(pairs))
  break
else: print('Brique Modane/St-Jean non trouvée')
PY

echo "=== 8/8 VERDICT ==="
grep -qF 'LB_MOORAIL_ROUTE_HANDLER_GUARD_V112' "$SERVER"
grep -qF 'LB_MOORAIL_PRODUCTION_WATCHDOG_V112' "$JS"
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.2 INSTALLE ET VALIDE"
echo "============================================================"
echo " - double-réponse HTTP neutralisée"
echo " - handler route-editor termine réellement la requête"
echo " - production-refresh testé sans restart de Node"
echo " - bouton production libéré automatiquement après 60 s max"
echo " - aucune validation Modane inventée par l'installateur"
echo "Backup : $BACKUP"
echo "============================================================"
