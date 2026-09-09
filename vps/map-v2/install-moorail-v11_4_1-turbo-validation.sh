#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
JS="$ROOT/public/moorail-route-editor-stops.js"
HTML="$ROOT/public/moorail-route-editor.html"
HTML2="$ROOT/public/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
TIMER="moorail-network-v8-refresh.timer"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_4_1-turbo-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1141.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.4.1..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers éditeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.4.1 — TURBO SANS CASSER TRY/CATCH"
echo "============================================================"
echo "V11.4 supprimait un bloc allant du refresh jusqu'à la suivante ;"
echo "or la suivante est APRES catch/finally. Il supprimait donc aussi"
echo "catch/finally => SyntaxError. V11.4.1 remplace uniquement le bloc"
echo "NETWORK situé DANS le try et conserve toute la structure JS."
echo

echo "=== 0/7 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
cat "$TMP/health.json"; echo
for marker in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 LB_MOORAIL_PRODUCTION_WATCHDOG_V112 LB_MOORAIL_PRODUCTION_FINALIZER_V113; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
if grep -qF 'LB_MOORAIL_TURBO_VALIDATION_V1141' "$JS"; then echo "ERREUR V11.4.1 déjà installée" >&2; exit 5; fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/7 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/7 PATCH CIBLE : NETWORK BLOQUANT UNIQUEMENT ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_TURBO_VALIDATION_V1141 */'
if marker in s: raise SystemExit('V11.4.1 déjà présente')

f0=s.find('validateLeg=async function(){')
f1=s.find('\nfunction lbInitProductionV11()',f0)
if f0<0 or f1<0: raise SystemExit('ERREUR wrapper validateLeg V11 introuvable')
blk=s[f0:f1]

# On remplace SEULEMENT la partie située dans le try :
# setStatus sync -> production-refresh -> reload network -> contrôle network.
a=blk.find('    setStatus(`✓ LIVE. Synchronisation réseau de ')
if a<0:
    a=blk.find('    setStatus(`✔ LIVE. Synchronisation réseau de ')
if a<0: raise SystemExit('ERREUR ancre Synchronisation réseau absente')

b=blk.find('    // L’analyse publication est informative',a)
if b<0:
    b=blk.find("    // L'analyse publication est informative",a)
if b<0: raise SystemExit('ERREUR ancre analyse publication absente')

old=blk[a:b]
if 'production-refresh' not in old: raise SystemExit('ERREUR production-refresh absent du bloc ciblé')
if 'const check=' not in old: raise SystemExit('ERREUR contrôle network absent du bloc ciblé')

new=r'''    /* LB_MOORAIL_TURBO_VALIDATION_V1141 */
    // STATE + LIVE viennent d'être confirmés : c'est la validation persistante réelle.
    // Ne pas reconstruire les 318 briques synchroniquement à chaque clic.
    // Le timer V8 fera la consolidation network.json ; la session retire immédiatement
    // cette brique de la file afin de passer à la suivante sans attendre ~8 secondes.
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
    setStatus(`✅ LIVE : ${esc(pairBefore?.[0]?.name||'?')} → ${esc(pairBefore?.[1]?.name||'?')}. Suivante…`,'ok');

'''
blk=blk[:a]+new+blk[b:]

# Le finally existant garde la responsabilité de libérer busy.
if '}catch(e){' not in blk or '}finally{' not in blk:
    raise SystemExit('ERREUR structure catch/finally perdue')

# Accélère uniquement la petite temporisation finale, sans déplacer le finally.
if 'setTimeout(r,350)' in blk:
    blk=blk.replace('setTimeout(r,350)','setTimeout(r,120)',1)
elif 'setTimeout(r,120)' not in blk:
    raise SystemExit('ERREUR temporisation finale introuvable')

# Le passage suivant doit toujours être présent APRÈS le finally.
if 'await lbProductionNextV11(sid);' not in blk:
    raise SystemExit('ERREUR passage suivante absent')

s=s[:f0]+blk+s[f1:]
p.write_text(s,encoding='utf-8')
print('Patch V11.4.1 préparé :')
print(' - SAVE/STATE/LIVE inchangés')
print(' - production-refresh retiré uniquement du try')
print(' - catch/finally conservés')
print(' - suivante après 120 ms')
PY

node --check "$TMP/editor.js"
grep -qF 'LB_MOORAIL_TURBO_VALIDATION_V1141' "$TMP/editor.js"

echo "=== 3/7 SELF-TEST STRUCTUREL ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
a=s.find('validateLeg=async function(){');b=s.find('\nfunction lbInitProductionV11()',a)
assert a>=0 and b>a
blk=s[a:b]
assert 'LB_MOORAIL_TURBO_VALIDATION_V1141' in blk
assert 'production-refresh' not in blk
assert 'lbProductionWaitSavedV11(sid)' in blk
assert 'lbProductionWaitLiveV11(sid)' in blk
assert '}catch(e){' in blk
assert '}finally{' in blk
assert 'state.productionV11.busy=false' in blk
assert 'await lbProductionNextV11(sid);' in blk
assert 'setTimeout(r,120)' in blk
print('SELF-TEST syntaxe try/catch/finally : OK')
print('SELF-TEST STATE + LIVE obligatoires : OK')
print('SELF-TEST aucun rebuild bloquant    : OK')
print('SELF-TEST suivante 120 ms           : OK')
PY

echo "=== 4/7 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for fn in sys.argv[1:]:
    p=Path(fn)
    if not p.exists(): continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.4.1', s)
    if n==0: raise SystemExit(f'ERREUR référence JS absente: {p}')
    p.write_text(s,encoding='utf-8')
    print('cache:',p.name,'OK')
PY

echo "=== 5/7 INSTALLATION ==="
cp -a "$TMP/editor.js" "$JS"
chmod 0644 "$JS"
node --check "$JS"
echo "JS disque : OK"

echo "=== 6/7 PRODUIT SERVI SANS RESTART ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
node --check "$TMP/served.js"
python3 - "$TMP/served.js" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
a=s.find('validateLeg=async function(){');b=s.find('\nfunction lbInitProductionV11()',a);blk=s[a:b]
assert 'LB_MOORAIL_TURBO_VALIDATION_V1141' in blk
assert 'production-refresh' not in blk
assert '}catch(e){' in blk and '}finally{' in blk
assert 'setTimeout(r,120)' in blk
assert 'await lbProductionNextV11(sid);' in blk
print('V11.4.1 servi : OK')
PY

echo "=== 7/7 HEALTH / VERDICT ==="
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet "$TIMER"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health
printf '\n'
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.4.1 INSTALLE — TURBO ACTIF"
echo "============================================================"
echo " - aucune modification serveur"
echo " - aucune reconstruction network bloquante par clic"
echo " - validation persistante toujours STATE + LIVE"
echo " - catch/finally V11 conservés"
echo " - passage à la suivante après ~120 ms"
echo " - network.json reste consolidé par le timer V8"
echo "Backup : $BACKUP"
echo "============================================================"
