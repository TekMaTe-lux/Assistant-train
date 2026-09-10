#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v11_7_2-next-legacy-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1172.XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V11.7.2..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" && -f "$HTML2" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$JS" && -f "$HTML" ]] || { echo "ERREUR fichiers éditeur absents" >&2; exit 3; }

echo "============================================================"
echo " MOO RAIL V11.7.2 — CORRECTION BRIQUE SUIVANTE / LEGACY"
echo "============================================================"
echo "Cause : V11.7 considérait toute ancienne validation STATE comme"
echo "terminée. Les 48 briques LEGACY étaient donc invisibles pour NEXT."
echo "V11.7.2 considère terminée uniquement une vraie VALIDATED_V8."
echo

echo "=== 0/6 PRE-FLIGHT DISQUE ==="
grep -qF 'LB_MOORAIL_BRICK_BY_BRICK_V117' "$JS" || { echo "ERREUR V11.7 absent" >&2; exit 4; }
grep -qF 'function networkStatus(r)' "$JS" || { echo "ERREUR networkStatus absent" >&2; exit 4; }
grep -qF 'function lbBrickDoneV117(r)' "$JS" || { echo "ERREUR lbBrickDoneV117 absent" >&2; exit 4; }
grep -qF 'function lbBrickNextCandidateV117(currentSid)' "$JS" || { echo "ERREUR lbBrickNextCandidateV117 absent" >&2; exit 4; }
if grep -qF 'LB_MOORAIL_NEXT_LEGACY_FIX_V1172' "$JS"; then
  echo "ERREUR V11.7.2 déjà présente" >&2
  exit 5
fi
node --check "$JS"
echo "Pre-flight : OK"

echo "=== 1/6 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/6 PATCH NEXT UNIQUEMENT ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_NEXT_LEGACY_FIX_V1172 */'
if marker in s: raise SystemExit('V11.7.2 déjà présente')

# Remplace UNIQUEMENT les deux helpers de file V11.7.
pat_done=re.compile(r"function lbBrickDoneV117\(r\)\{.*?\n\}",re.S)
m=pat_done.search(s)
if not m: raise SystemExit('ERREUR fonction lbBrickDoneV117 introuvable')
new_done=r'''function lbBrickDoneV117(r){
  // V11.7.2 : une ancienne validation STATE ne suffit PAS.
  // LEGACY doit rester dans la file tant qu'elle n'a pas été revalidée en V8.
  try{return networkStatus(r)==='VALIDATED_V8';}
  catch(_){
    const sid=lbBrickSidV117(r);
    const saved=sid?state?.serverState?.sections?.[sid]:null;
    return !!(saved?.status==='validated' &&
      (saved?.validationEngine==='ROUTER_V6' || String(saved?.source||'')==='MOORAIL_VALIDATED_SECTIONS_V8'));
  }
}'''
s=s[:m.start()]+new_done+s[m.end():]

pat_next=re.compile(r"function lbBrickNextCandidateV117\(currentSid\)\{.*?\n\}",re.S)
m=pat_next.search(s)
if not m: raise SystemExit('ERREUR fonction lbBrickNextCandidateV117 introuvable')
new_next=r'''function lbBrickNextCandidateV117(currentSid){
  const cur=String(currentSid||'');
  const rank={TODO:0,LEGACY:1,VALIDATED_V8:9};
  const pending=(state.catalog||[]).filter(r=>lbBrickSidV117(r)!==cur&&!lbBrickDoneV117(r));
  pending.sort((a,b)=>{
    let sa='TODO',sb='TODO';
    try{sa=networkStatus(a)}catch(_){}
    try{sb=networkStatus(b)}catch(_){}
    return (rank[sa]??5)-(rank[sb]??5)
      || Number(b.tripCount||0)-Number(a.tripCount||0)
      || String(a.signature||'').localeCompare(String(b.signature||''),'fr');
  });
  return pending[0]||null;
}'''
s=s[:m.start()]+new_next+s[m.end():]

pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=marker+r'''

async function lbBrickGoNextV1172(){
  if(state?.productionV11?.busy)return;
  const currentSid=lbBrickSidV117(state.route);
  const next=lbBrickNextCandidateV117(currentSid);
  if(!next){
    setStatus('Aucune brique TODO/LEGACY restante à revalider.','ok');
    return;
  }
  setStatus(`⏭ Brique suivante : ${esc(next.origin)} → ${esc(next.destination)}…`,'warn');
  await lbBrickOpenV117(next);
}

function lbBindNextLegacyV1172(){
  const b=document.getElementById('lbProdNextV11');
  if(!b)return;
  b.dataset.moorailNextLegacyV1172='1';
  b.onclick=(ev)=>{ev?.preventDefault?.();ev?.stopPropagation?.();lbBrickGoNextV1172();};
}
setInterval(lbBindNextLegacyV1172,500);
setTimeout(lbBindNextLegacyV1172,0);
'''
s=s[:pos]+extra+'\n'+s[pos:]

p.write_text(s,encoding='utf-8')
print('Patch préparé :')
print(' - LEGACY n’est plus considéré terminé juste parce que STATE=validated')
print(' - NEXT choisit TODO puis LEGACY par impact')
print(' - bouton Brique suivante utilise la même file que Valider -> suivante')
print(' - validateLeg V11.7.1 n’est pas modifié')
PY

node --check "$TMP/editor.js"

echo "=== 3/6 SELF-TEST ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
assert 'LB_MOORAIL_NEXT_LEGACY_FIX_V1172' in s
m=re.search(r'function lbBrickDoneV117\(r\)\{.*?\n\}',s,re.S); assert m
b=m.group(0)
assert "networkStatus(r)==='VALIDATED_V8'" in b
assert "state?.serverState?.sections?.[sid]?.status==='validated')return true" not in b
m=re.search(r'function lbBrickNextCandidateV117\(currentSid\)\{.*?\n\}',s,re.S); assert m
b=m.group(0)
assert 'LEGACY:1' in b
assert '!lbBrickDoneV117(r)' in b
assert 'lbBrickGoNextV1172' in s
assert "getElementById('lbProdNextV11')" in s
assert 'await lbBrickOpenV117(next)' in s
print('SELF-TEST LEGACY reste dans la file : OK')
print('SELF-TEST NEXT TODO puis LEGACY      : OK')
print('SELF-TEST bouton Brique suivante     : OK')
print('SELF-TEST validation non modifiée    : OK')
PY

echo "=== 4/6 CACHE HTML ==="
python3 - "$HTML" "$HTML2" <<'PY'
from pathlib import Path
import re,sys
for raw in sys.argv[1:]:
    p=Path(raw)
    if not p.exists(): continue
    s=p.read_text(encoding='utf-8')
    s,n=re.subn(r'moorail-route-editor-stops\.js(?:\?v=[^"\']*)?', 'moorail-route-editor-stops.js?v=11.7.2', s)
    if n==0: raise SystemExit(f'ERREUR référence JS absente: {p}')
    p.write_text(s,encoding='utf-8')
    print('cache:',p.name,'OK')
PY

echo "=== 5/6 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
node --check "$JS"
echo "JS disque : OK"

echo "=== 6/6 RESTART + VERIFICATION ==="
systemctl restart "$SERVICE"
OK=0
for i in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json" 2>/dev/null; then
    OK=1; break
  fi
  sleep 1
done
if [[ "$OK" != 1 ]]; then
  echo "ERREUR serveur 3111 non revenu après restart" >&2
  exit 6
fi
cat "$TMP/health.json"; echo
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_NEXT_LEGACY_FIX_V1172' "$TMP/served.js"
grep -qF 'lbBrickGoNextV1172' "$TMP/served.js"
echo "V11.7.2 servi : OK"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V11.7.2 INSTALLE — NEXT LEGACY CORRIGE"
echo "============================================================"
echo " - les briques LEGACY restent à traiter"
echo " - Brique suivante ouvre TODO puis LEGACY"
echo " - Valider -> suivante utilise exactement la même file"
echo " - V11.7.1 sauvegarde inchangée"
echo "Backup : $BACKUP"
echo "============================================================"
