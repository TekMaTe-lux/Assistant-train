#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
JS="$ROOT/public/moorail-route-editor-stops.js"
HTML="$ROOT/public/moorail-route-editor.html"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_4-turbo-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v114.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.4..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers éditeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.4 — VALIDATION TURBO / SUIVANTE IMMEDIATE"
echo "============================================================"
echo "But : supprimer les ~8 s de rebuild network à CHAQUE brique."
echo "STATE + LIVE restent la validation réelle. network.json est"
echo "marqué localement dans l'UI puis le timer V8 le resynchronise."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 LB_MOORAIL_PRODUCTION_WATCHDOG_V112 LB_MOORAIL_PRODUCTION_FINALIZER_V113; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
if grep -qF 'LB_MOORAIL_TURBO_VALIDATION_V114' "$JS"; then echo "ERREUR V11.4 déjà installée" >&2; exit 5; fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH VALIDATION : PLUS DE REBUILD BLOQUANT ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_TURBO_VALIDATION_V114 */'
if marker in s: raise SystemExit('V11.4 déjà présente')

start=s.find('validateLeg=async function(){')
if start<0: raise SystemExit('ERREUR wrapper validateLeg V11 absent')
end=s.find('\n};',start)
if end<0: raise SystemExit('ERREUR fin wrapper validateLeg V11 absente')
end+=3
block=s[start:end]

rr=block.find('const rr=await fetch(`${API}/production-refresh`')
if rr<0: raise SystemExit('ERREUR appel production-refresh V11 absent')
# on remonte au setStatus de synchronisation
b0=block.rfind('\n',0,block.rfind('setStatus(',0,rr))+1
if b0<0: b0=0
nxt=block.find('await lbProductionNextV11(sid);',rr)
if nxt<0: raise SystemExit('ERREUR appel suivante V11 absent')
line_end=block.find('\n',nxt)
if line_end<0: line_end=len(block)
else: line_end+=1

replacement=r'''    /* LB_MOORAIL_TURBO_VALIDATION_V114 */
    // STATE + LIVE ont déjà été confirmés juste au-dessus : la brique est réellement validée.
    // On ne bloque plus Node ~8 s avec build-moorail-network-v8.py à chaque clic.
    // Le timer V8 resynchronise network.json en arrière-plan ; pour la file courante,
    // on marque immédiatement cette brique VALIDATED_V8 en mémoire.
    state.productionV11.lastValidated=sid;
    state.productionV11.lastRefreshMs=0;
    const local=(state.catalog||[]).find(r=>String(r?.sections?.[0]?.id||'')===String(sid));
    if(local){
      local.networkStatus='VALIDATED_V8';
      if(local.sections?.[0]) local.sections[0].networkStatus='VALIDATED_V8';
    }
    if(state.route && String(state.route?.sections?.[0]?.id||'')===String(sid)){
      state.route.networkStatus='VALIDATED_V8';
      if(state.route.sections?.[0]) state.route.sections[0].networkStatus='VALIDATED_V8';
    }
    state.productionV11.busy=false;
    state.productionV11.busySince=0;
    state.productionV11.activeSidV113=null;
    lbProductionUpdateV11();
    setStatus(`✅ LIVE : ${esc(pairBefore?.[0]?.name||'?')} → ${esc(pairBefore?.[1]?.name||'?')}. Passage immédiat à la suivante…`,'ok');
    await new Promise(r=>setTimeout(r,120));
    await lbProductionNextV11(sid);
'''
block2=block[:b0]+replacement+block[line_end:]
s=s[:start]+block2+s[end:]

p.write_text(s,encoding='utf-8')
print('Patch V11.4 préparé :')
print(' - suppression du production-refresh synchrone par validation')
print(' - STATE + LIVE restent obligatoires')
print(' - statut local VALIDATED_V8 immédiat')
print(' - passage suivante après 120 ms')
PY
node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_TURBO_VALIDATION_V114' "$TMP/editor.js"

echo "=== 3/8 SELF-TEST : LE CYCLE NE BLOQUE PLUS SUR NETWORK ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
start=s.find('validateLeg=async function(){');end=s.find('\n};',start)
blk=s[start:end]
assert 'LB_MOORAIL_TURBO_VALIDATION_V114' in blk
assert 'production-refresh' not in blk, 'production-refresh encore présent dans validateLeg V11'
assert "local.networkStatus='VALIDATED_V8'" in blk
assert 'state.productionV11.busy=false;' in blk
assert 'await lbProductionNextV11(sid);' in blk
assert 'setTimeout(r,120)' in blk
print('SELF-TEST sans rebuild bloquant : OK')
print('SELF-TEST suivante immédiate     : OK')
PY

echo "=== 4/8 CACHE HTML V11.4 ==="
python3 - "$HTML" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.4', s)
if n==0: raise SystemExit('ERREUR référence JS HTML absente')
p.write_text(s,encoding='utf-8')
print('HTML cache V11.4 : OK')
PY

echo "=== 5/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
node --check "$JS"

echo "=== 6/8 RESTART + HEALTH ==="
RESTARTED=1
systemctl restart "$SERVICE"
READY=0
for i in $(seq 1 60); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json" 2>/dev/null; then READY=1; break; fi
  echo "  attente map $i/60..."; sleep 1
done
[[ "$READY" == 1 ]] || { echo "ERREUR service non revenu" >&2; journalctl -u "$SERVICE" -n 50 --no-pager || true; exit 7; }
cat "$TMP/health-after.json"; echo

echo "=== 7/8 PRODUIT SERVI ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_TURBO_VALIDATION_V114' "$TMP/served.js"
python3 - "$TMP/served.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
a=s.find('validateLeg=async function(){');b=s.find('\n};',a);blk=s[a:b]
assert 'production-refresh' not in blk
assert 'setTimeout(r,120)' in blk
print('V11.4 servi : validation sans rebuild réseau bloquant = OK')
PY

echo "=== 8/8 VERDICT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.4 INSTALLE — MODE TURBO ACTIF"
echo "============================================================"
echo " - validation réelle = STATE + LIVE"
echo " - plus de rebuild network ~8 s à chaque brique"
echo " - compteur/file mis à jour immédiatement dans le navigateur"
echo " - passage à la suivante après ~120 ms"
echo " - network.json reste resynchronisé par le timer V8"
echo "Backup : $BACKUP"
echo "============================================================"
