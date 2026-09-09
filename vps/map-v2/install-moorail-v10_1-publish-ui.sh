#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v10_1-publish-ui-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v101.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V10.1..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

echo "============================================================"
echo " MOO RAIL V10.1 — PUBLICATION DES VARIANTES IMPACTEES"
echo "============================================================"
echo "Cause confirmée par l'audit : les boutons existaient encore,"
echo "mais refreshPublishPreview() et publishReady() avaient disparu."
echo "La brique V8 est bien LIVE ; ce patch répare la publication"
echo "des vraies variantes GTFS r-* qui utilisent la brique."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h;print('Health :',h)
PY
grep -qF 'LB_MOORAIL_UNIFIED_EDITOR_V10' "$JS"
grep -qF "\$('publishCheck').onclick" "$JS"
grep -qF "\$('publishCurrent').onclick" "$JS"
grep -qF "\$('publishAll').onclick" "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_PUBLISH_V101' "$JS"; then echo "ERREUR: V10.1 déjà présente" >&2; exit 4; fi
if grep -qF 'async function refreshPublishPreview' "$JS" || grep -qF 'async function publishReady' "$JS"; then
  echo "ERREUR: fonctions publication déjà présentes, état inattendu" >&2; exit 5
fi

echo "Pre-flight : OK"

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH JS ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
pos=s.rfind('})();')
if pos<0: raise SystemExit('ERREUR fin IIFE absente')
extra=r'''
/* LB_MOORAIL_PUBLISH_V101 */
state.publishInfoV101=null;
state.publishCatalogV101=null;

async function lbCatalogV101(){
  const d=await fetch(`${API}/catalog?t=${Date.now()}`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(`catalog HTTP ${r.status}`);return r.json()});
  state.publishCatalogV101=Array.isArray(d?.routes)?d.routes:[];return state.publishCatalogV101;
}
function lbSameV101(a,b){return norm(a)===norm(b);}
function lbHasPairV101(r,a,b){
  const ss=Array.isArray(r?.stops)?r.stops:[];
  for(let i=0;i<ss.length-1;i++){
    const x=ss[i]?.name,y=ss[i+1]?.name;
    if((lbSameV101(x,a)&&lbSameV101(y,b))||(lbSameV101(x,b)&&lbSameV101(y,a)))return true;
  }
  return false;
}
function lbMissingV101(r){
  return (r?.sections||[]).filter(s=>s?.status!=='validated').map(s=>`${s?.from?.name||'?'} → ${s?.to?.name||'?'}`);
}
async function refreshPublishPreview(){
  const box=$('publishSummary'),result=$('publishResult'),link=$('publishLink');
  const pair=stopPair?.(),sec=leg?.();
  if(!box||!pair||!sec)return null;
  box.className='status';box.textContent='Analyse des variantes GTFS impactées…';if(result)result.innerHTML='';if(link)link.style.display='none';
  try{
    const [routes,live]=await Promise.all([
      lbCatalogV101(),
      fetch(`/map-v2/data/moorail-live-v1/sections.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():({pairs:[]})).catch(()=>({pairs:[]}))
    ]);
    const a=pair[0].name,b=pair[1].name;
    const impacted=routes.filter(r=>lbHasPairV101(r,a,b));
    const sectionLive=(live?.pairs||[]).some(x=>String(x?.sectionId||'')===String(sec.id));
    const details=[];const ready=[];
    for(const r of impacted){
      const missing=lbMissingV101(r);let compilerReady=false,compilerMissing=[];
      if(!missing.length){
        const p=await fetch(`${API}/publish-preview?routeId=${encodeURIComponent(r.id)}&t=${Date.now()}`,{cache:'no-store'}).then(x=>x.json());
        compilerReady=Number(p?.totals?.trips||0)>0;
        if(!compilerReady)compilerMissing=(p?.skipped?.[0]?.missing||[]).map(String);
      }
      if(compilerReady)ready.push(r);
      details.push({route:r,missing,compilerMissing,compilerReady});
    }
    state.publishInfoV101={sectionId:sec.id,from:a,to:b,sectionLive,impacted,details,ready};
    const validated=state.serverState?.sections?.[sec.id]?.status==='validated';
    box.className='status '+(sectionLive?'ok':validated?'warn':'bad');
    box.innerHTML=`${sectionLive?'✅ <b>BRIQUE V8 DÉJÀ LIVE</b>':validated?'✓ Brique V8 validée':'⚠️ Brique non validée'}<br>${esc(a)} ↔ ${esc(b)}<br><b>${impacted.length}</b> variante(s) GTFS impactée(s) · <b>${ready.length}</b> prête(s) à publier.`;
    if(result){
      result.innerHTML=details.slice(0,10).map(d=>{
        const nums=(d.route?.trainNumbers||[]).slice(0,8).join(', '),miss=d.missing.length?d.missing:d.compilerMissing;
        return `${d.compilerReady?'✅':'⏳'} ${esc(d.route?.origin||'?')} → ${esc(d.route?.destination||'?')}${nums?` · ${esc(nums)}`:''}${miss.length?`<br><span style="opacity:.8">manque : ${miss.slice(0,4).map(esc).join(' · ')}</span>`:''}`;
      }).join('<br><br>') || 'Aucune variante GTFS ne contient cette paire.';
    }
    return state.publishInfoV101;
  }catch(e){console.error('[V10.1 analyse]',e);box.className='status bad';box.textContent=`Analyse impossible : ${e.message}`;return null;}
}
async function lbWaitMapV101(){
  await new Promise(r=>setTimeout(r,2200));
  for(let i=0;i<40;i++){
    try{const r=await fetch(`/api/map-v2/health?t=${Date.now()}`,{cache:'no-store'});if(r.ok){const h=await r.json();if(h?.ok)return;}}catch(_){}
    await new Promise(r=>setTimeout(r,800));
  }
  throw new Error('Map V2 ne répond pas après publication');
}
async function publishReady(all){
  const box=$('publishSummary'),link=$('publishLink');if(!box)return;
  try{
    if(all){
      if(!window.confirm('Publier TOUTES les variantes actuellement prêtes sur France V3 Preview ?'))return;
      box.className='status warn';box.textContent='Publication globale en cours…';
      const r=await fetch(`${API}/publish`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:'FRANCE_V3_PREVIEW'})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
      await lbWaitMapV101();const t=d.report?.totals||{};box.className='status ok';box.innerHTML=`✅ Publication terminée : ${t.trips||0} circulation(s) · ${t.routes||0} variante(s).`;if(link)link.style.display='inline-block';return;
    }
    const info=await refreshPublishPreview();if(!info)return;
    if(!info.ready.length){box.className='status warn';box.innerHTML=`✅ <b>LA BRIQUE EST ${info.sectionLive?'DÉJÀ LIVE':'VALIDÉE'}</b><br>Aucune variante complète n’est encore publiable. Termine les briques indiquées ci-dessous.`;return;}
    const names=info.ready.map(r=>(r.trainNumbers||[]).slice(0,4).join(', ')||r.id).join(' / ');
    if(!window.confirm(`Publier ${info.ready.length} variante(s) impactée(s) prête(s) ?\n\n${names}`))return;
    let trips=0,routes=0;
    for(const vr of info.ready){
      box.className='status warn';box.textContent=`Publication ${vr.id}…`;
      const r=await fetch(`${API}/publish`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:'FRANCE_V3_PREVIEW',routeId:vr.id})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(`${vr.id}: ${d.error||r.status}`);
      trips+=Number(d.report?.totals?.trips||0);routes+=Number(d.report?.totals?.routes||0);
      await lbWaitMapV101();
    }
    box.className='status ok';box.innerHTML=`✅ <b>PUBLICATION TERMINÉE</b><br>${trips} circulation(s) · ${routes} variante(s) publiées.`;
    if(link){link.href=`/map-v2/france-v3-preview.html?moorail=${Date.now()}`;link.style.display='inline-block';}
    const sv=await fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json());state.serverState=sv||state.serverState;renderRoutes();renderLegs();await refreshPublishPreview();
  }catch(e){console.error('[V10.1 publish]',e);box.className='status bad';box.textContent=`Publication impossible : ${e.message}`;}
}
'''
s=s[:pos]+extra+'\n'+s[pos:]
p.write_text(s,encoding='utf-8')
PY
node --check "$TMP/editor.js"

echo "=== 3/8 PATCH HTML ==="
cp -a "$HTML" "$TMP/editor.html"
python3 - "$TMP/editor.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'(<button\s+id="publishCurrent"[^>]*>).*?(</button>)',r'\1🚀 Publier variantes impactées\2',s,count=1,flags=re.S)
s=re.sub(r'(<div\s+id="publishSummary"[^>]*>).*?(</div>)',r'\1Analyse des variantes GTFS impactées…\2',s,count=1,flags=re.S)
p.write_text(s,encoding='utf-8')
PY

echo "=== 4/8 CONTROLES ==="
for x in 'LB_MOORAIL_PUBLISH_V101' 'async function refreshPublishPreview' 'async function publishReady' 'lbHasPairV101'; do grep -qF "$x" "$TMP/editor.js" && echo "  $x : OK"; done
grep -qF 'Publier variantes impactées' "$TMP/editor.html" && echo "  HTML : OK"

echo "=== 5/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/editor.html" "$HTML"
[[ -f "$HTML2" ]] && install -o root -g root -m 0644 "$TMP/editor.html" "$HTML2" || true
for f in "$HTML" "$HTML2"; do
  [[ -f "$f" ]] || continue
  python3 - "$f" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=10.1', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 6/8 RESTART + SERVI ==="
systemctl restart "$SERVICE";RESTARTED=1
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-after.json" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$TMP/health-after.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h;print('Health :',h)
PY
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$STAMP" -o "$TMP/served.js"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?$STAMP" -o "$TMP/served.html"
grep -qF 'LB_MOORAIL_PUBLISH_V101' "$TMP/served.js"
grep -qF 'async function refreshPublishPreview' "$TMP/served.js"
grep -qF 'async function publishReady' "$TMP/served.js"
grep -qF 'Publier variantes impactées' "$TMP/served.html"
echo "Produit V10.1 servi : OK"

echo "=== 7/8 TEST MARNE ↔ LYON SANS ECRITURE ==="
curl -fsS --max-time 15 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog?t=$STAMP" -o "$TMP/catalog.json"
python3 - "$TMP/catalog.json" <<'PY'
import json,sys,unicodedata
cat=json.load(open(sys.argv[1]))
def n(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def hit(r):
 ss=r.get('stops') or []
 for a,b in zip(ss,ss[1:]):
  if {n(a.get('name')),n(b.get('name'))}=={n('Marne-la-Vallée Chessy'),n('Lyon Perrache')}:return True
 return False
hits=[r for r in cat.get('routes',[]) if hit(r)]
assert hits,'aucune variante Marne/Lyon'
for r in hits:
 miss=[f"{s.get('from',{}).get('name')} → {s.get('to',{}).get('name')}" for s in r.get('sections',[]) if s.get('status')!='validated']
 print(r.get('id'),'| trains',', '.join(r.get('trainNumbers') or []),'|',r.get('progress'),'| manque',miss or 'rien')
PY

echo "=== 8/8 VERDICT ==="
node --check "$JS"
SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V10.1 INSTALLE ET VALIDE"
echo "============================================================"
echo " - boutons de publication réparés"
echo " - analyse par vraie variante GTFS r-*"
echo " - affiche les briques manquantes"
echo " - publie seulement les variantes impactées qui sont complètes"
echo " - la brique V8 reste LIVE même si la variante complète ne l'est pas encore"
echo "Backup : $BACKUP"
echo "============================================================"