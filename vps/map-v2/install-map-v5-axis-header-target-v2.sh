#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-v5-axis-header-target-v2-${STAMP}"
EMBEDDED_JS="/tmp/lb-v5-axis-header-target-v2-${STAMP}.js"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -ne 1 && -f "$BACKUP" ]]; then
    echo
    echo "❌ ÉCHEC — restauration automatique"
    cp -p "$BACKUP" "$FILE"
    echo "✅ Restauré : $BACKUP"
  fi
}
trap rollback EXIT

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

for needle in \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_PARTIAL_GHOST_V2_CSS START' \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_CSS START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_JS START' \
  'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' \
  'LB_V5_AXIS_HEADER_TARGET_V1_JS START'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: élément attendu absent: $needle" >&2; exit 3; }
done

echo "=== VERSION AVANT ==="
sha256sum "$FILE"

cp -p "$FILE" "$BACKUP"
echo
echo "=== SAUVEGARDE ==="
echo "$BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

# Retirer le correctif V1 : on le REMPLACE, on ne l'empile pas.
for kind in ('CSS','JS'):
    start=f'<!-- LB_V5_AXIS_HEADER_TARGET_V1_{kind} START -->'
    end=f'<!-- LB_V5_AXIS_HEADER_TARGET_V1_{kind} END -->'
    text, n = re.subn(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)
    if n != 1:
        raise SystemExit(f'ERREUR: bloc V1 {kind} attendu une fois, trouvé {n}')

css_start='<!-- LB_V5_AXIS_HEADER_TARGET_V2_CSS START -->'
css_end='<!-- LB_V5_AXIS_HEADER_TARGET_V2_CSS END -->'
js_start='<!-- LB_V5_AXIS_HEADER_TARGET_V2_JS START -->'
js_end='<!-- LB_V5_AXIS_HEADER_TARGET_V2_JS END -->'

css=r'''
/* =========================================================
   V2 — même position validée, finition Tron plus fine.
   Aucun changement des marqueurs/liserés/badges de la carte.
   ========================================================= */

/* ---------- TIMELINE : centre inchangé (x=90), mais piste fine ---------- */
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop::before{
  left:86px!important;
  top:12px!important;
  width:8px!important;
  height:8px!important;
  box-sizing:border-box!important;
  border:1.4px solid rgba(64,229,239,.96)!important;
  background:rgba(4,24,37,.96)!important;
  box-shadow:0 0 0 1px rgba(6,21,32,.88),0 0 5px rgba(45,226,238,.35)!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop:not(:last-child)::after{
  left:89.5px!important;
  top:20px!important;
  bottom:-10px!important;
  width:1px!important;
  background:linear-gradient(180deg,rgba(47,218,230,.82),rgba(32,179,194,.50))!important;
  box-shadow:0 0 4px rgba(40,222,234,.28)!important;
  opacity:.9!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.passed::before,
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.done::before,
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.completed::before{
  background:#37dce7!important;
  border-color:#76f4f3!important;
  box-shadow:0 0 5px rgba(55,220,231,.40)!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.current::before,
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.live::before,
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.active::before{
  left:84px!important;
  top:10px!important;
  width:12px!important;
  height:12px!important;
  border:1.5px solid #8af8f5!important;
  background:#35dce7!important;
  box-shadow:0 0 0 2px rgba(5,23,35,.94),0 0 8px rgba(50,226,236,.48)!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.upcoming::before,
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.approaching::before{
  background:rgba(4,22,34,.96)!important;
  border-color:#42dce7!important;
}

/* ---------- HEADER : carte propre, sans ligne Temps réel en dessous ---------- */
html body .trip-panel:not(.station-board-mode) .lb-trip-route-card-v2{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) 70px minmax(0,1fr)!important;
  align-items:center!important;
  gap:8px!important;
  margin:1px 0 5px!important;
  padding:8px 10px!important;
  border:1px solid rgba(48,218,231,.22)!important;
  border-radius:11px!important;
  background:linear-gradient(135deg,rgba(5,25,39,.78),rgba(3,14,28,.64))!important;
  box-shadow:inset 0 0 18px rgba(0,220,235,.025)!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-side-v2{min-width:0!important}
html body .trip-panel:not(.station-board-mode) .lb-route-side-v2.is-arr{text-align:right!important}
html body .trip-panel:not(.station-board-mode) .lb-route-label-v2{
  display:block!important;
  color:#70aeba!important;
  font-size:7.5px!important;
  line-height:1!important;
  font-weight:800!important;
  letter-spacing:.09em!important;
  text-transform:uppercase!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-times-v2{
  display:flex!important;
  align-items:baseline!important;
  gap:5px!important;
  margin-top:3px!important;
  min-height:16px!important;
  font-variant-numeric:tabular-nums!important;
}
html body .trip-panel:not(.station-board-mode) .is-arr .lb-route-times-v2{justify-content:flex-end!important}
html body .trip-panel:not(.station-board-mode) .lb-route-plan-v2{
  color:#f3fdff!important;
  font-size:15px!important;
  line-height:1!important;
  font-weight:900!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-plan-v2.is-delayed{
  color:#78909c!important;
  font-size:10px!important;
  font-weight:700!important;
  text-decoration:line-through!important;
  text-decoration-thickness:1px!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-real-v2{
  color:#ffad32!important;
  font-size:15px!important;
  line-height:1!important;
  font-weight:900!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-real-v2.is-advance{color:#69df9b!important}
html body .trip-panel:not(.station-board-mode) .lb-route-name-v2{
  display:block!important;
  margin-top:3px!important;
  color:#d8edf4!important;
  font-size:9px!important;
  line-height:1.05!important;
  font-weight:750!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-mid-v2{
  display:flex!important;
  flex-direction:column!important;
  align-items:center!important;
  justify-content:center!important;
  min-width:0!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-duration-v2{
  padding:2px 6px!important;
  border:1px solid rgba(51,219,231,.20)!important;
  border-radius:999px!important;
  background:rgba(7,34,47,.72)!important;
  color:#b8dbe4!important;
  font-size:7.8px!important;
  line-height:1!important;
  font-weight:800!important;
  white-space:nowrap!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-link-v2{
  position:relative!important;
  display:block!important;
  width:100%!important;
  height:1px!important;
  margin-top:7px!important;
  background:linear-gradient(90deg,rgba(37,190,204,.18),#34dce7 25%,#34dce7 75%,rgba(37,190,204,.18))!important;
  box-shadow:0 0 4px rgba(48,220,232,.24)!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-link-v2::before,
html body .trip-panel:not(.station-board-mode) .lb-route-link-v2::after{
  content:''!important;
  position:absolute!important;
  top:50%!important;
  width:5px!important;
  height:5px!important;
  border-radius:50%!important;
  border:1px solid #45e2eb!important;
  background:#061925!important;
  transform:translateY(-50%)!important;
  box-shadow:0 0 4px rgba(55,225,235,.35)!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-link-v2::before{left:-1px!important}
html body .trip-panel:not(.station-board-mode) .lb-route-link-v2::after{right:-1px!important}

/* La ligne Temps réel source reste dans le DOM (données intactes), mais n'est plus affichée. */
html body .trip-panel:not(.station-board-mode) .trip-panel-realtime.lb-consumed-realtime-v2{display:none!important}

/* Respiration sous la carte pour empêcher toute superposition avec perturbation/progression. */
html body .trip-panel:not(.station-board-mode) .trip-panel-summary{margin:0 0 2px!important}
html body .trip-panel:not(.station-board-mode) .trip-panel-delay,
html body .trip-panel:not(.station-board-mode) .trip-panel-disruption{margin-top:3px!important}
html body .trip-panel:not(.station-board-mode) .trip-progress{margin-top:2px!important}

@media(max-width:700px){
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop::before{left:80px!important}
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop:not(:last-child)::after{left:83.5px!important}
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.current::before,
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.live::before,
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop.active::before{left:78px!important}
  html body .trip-panel:not(.station-board-mode) .lb-trip-route-card-v2{grid-template-columns:minmax(0,1fr) 58px minmax(0,1fr)!important;padding:7px 8px!important}
  html body .trip-panel:not(.station-board-mode) .lb-route-plan-v2,
  html body .trip-panel:not(.station-board-mode) .lb-route-real-v2{font-size:14px!important}
}
'''

js=r'''
(()=>{
  'use strict';
  if(window.__LB_V5_AXIS_HEADER_TARGET_V2__) return;
  window.__LB_V5_AXIS_HEADER_TARGET_V2__=true;

  const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function clockMin(s){const m=String(s||'').match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
  function parseRealtime(summary){
    const rows=Array.from(summary.querySelectorAll('.trip-panel-realtime'));
    const row=rows.find(el=>/^Temps\s+r[ée]el\s*:/i.test((el.textContent||'').trim()));
    if(!row) return null;
    const times=Array.from(row.querySelectorAll('strong')).map(el=>(el.textContent||'').trim()).filter(Boolean);
    const diffs=Array.from(row.querySelectorAll('.trip-panel-realtime-diff')).map(el=>(el.textContent||'').trim());
    if(times.length<2) return null;
    return {row,start:times[0],end:times[1],startDiff:diffs[0]||'',endDiff:diffs[1]||diffs[0]||''};
  }
  function timeHtml(plan,real,diff){
    const changed=!!(plan&&real&&plan!==real);
    if(!changed) return `<span class="lb-route-plan-v2">${esc(plan||real||'—')}</span>`;
    const advance=/^-/.test(String(diff||'').trim());
    return `<span class="lb-route-plan-v2 is-delayed">${esc(plan)}</span><span class="lb-route-real-v2${advance?' is-advance':''}">${esc(real)}</span>`;
  }
  function enhance(){
    const panel=document.getElementById('trip-panel');
    const summary=document.getElementById('trip-panel-summary');
    if(!panel||!summary||panel.classList.contains('station-board-mode')) return;

    // Original renderTripPanel remet le summary à neuf à chaque rendu.
    if(summary.querySelector('.lb-trip-route-card-v2')) return;

    const nodes=Array.from(summary.childNodes);
    const routeNodes=[];
    for(const n of nodes){
      if(n.nodeType===1 && n.tagName==='DIV') break;
      routeNodes.push(n);
    }
    const routeText=routeNodes.map(n=>n.textContent||'').join(' ').replace(/\s+/g,' ').trim();
    const m=routeText.match(/^(.*?)\s+(\d{1,2}:\d{2})\s*(?:→|->)\s*(.*?)\s+(\d{1,2}:\d{2})$/);
    if(!m) return;

    const depName=m[1].trim(), depPlan=m[2], arrName=m[3].trim(), arrPlan=m[4];
    const rt=parseRealtime(summary);
    const depReal=rt?.start||depPlan, arrReal=rt?.end||arrPlan;

    let dur='';
    const a=clockMin(depPlan),b=clockMin(arrPlan);
    if(a!=null&&b!=null){let d=b-a;if(d<0)d+=1440;if(d>=0&&d<1440)dur=`${d} min`;}

    routeNodes.forEach(n=>n.remove());
    if(rt?.row) rt.row.classList.add('lb-consumed-realtime-v2');

    const card=document.createElement('div');
    card.className='lb-trip-route-card-v2';
    card.innerHTML=`
      <div class="lb-route-side-v2 is-dep">
        <span class="lb-route-label-v2">Départ</span>
        <span class="lb-route-times-v2">${timeHtml(depPlan,depReal,rt?.startDiff)}</span>
        <span class="lb-route-name-v2">${esc(depName)}</span>
      </div>
      <div class="lb-route-mid-v2">${dur?`<span class="lb-route-duration-v2">${esc(dur)}</span>`:''}<span class="lb-route-link-v2"></span></div>
      <div class="lb-route-side-v2 is-arr">
        <span class="lb-route-label-v2">Arrivée</span>
        <span class="lb-route-times-v2">${timeHtml(arrPlan,arrReal,rt?.endDiff)}</span>
        <span class="lb-route-name-v2">${esc(arrName)}</span>
      </div>`;
    summary.insertAdjacentElement('afterbegin',card);
  }

  if(typeof renderTripPanel==='function'){
    const original=renderTripPanel;
    renderTripPanel=function(...args){
      const result=original.apply(this,args);
      try{enhance()}catch(e){console.warn('[LB header v2]',e)}
      setTimeout(()=>{try{enhance()}catch(_){}},0);
      requestAnimationFrame(()=>{try{enhance()}catch(_){} });
      return result;
    };
  }
  setTimeout(()=>{try{enhance()}catch(_){}},250);
})();
'''

def put(source,start,end,block,closing):
    p=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
    if p.search(source): return p.sub(block,source,count=1)
    if closing not in source: raise SystemExit(f'ERREUR: {closing} introuvable')
    return source.replace(closing,block+'\n'+closing,1)

css_block=f'{css_start}\n<style id="lb-v5-axis-header-target-v2-css">\n{css}\n</style>\n{css_end}'
js_block=f'{js_start}\n<script id="lb-v5-axis-header-target-v2-js">\n{js}\n</script>\n{js_end}'
text=put(text,css_start,css_end,css_block,'</head>')
text=put(text,js_start,js_end,js_block,'</body>')
for marker in (css_start,css_end,js_start,js_end):
    if text.count(marker)!=1: raise SystemExit(f'ERREUR marqueur: {marker}')
path.write_text(text,encoding='utf-8')
print('✅ V1 remplacée par V2 : header sans chevauchement + piste Tron affinée')
PY

echo
echo "=== CONTRÔLES ==="
! grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' "$FILE"
! grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_JS START' "$FILE"
grep -q 'LB_V5_AXIS_HEADER_TARGET_V2_CSS START' "$FILE"
grep -q 'LB_V5_AXIS_HEADER_TARGET_V2_JS START' "$FILE"
grep -q 'lb-consumed-realtime-v2' "$FILE"
grep -q 'left:89.5px!important' "$FILE"
# Ne surtout pas perdre les correctifs carte existants.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ V1 supprimée / V2 installée"
echo "✅ Temps réel intégré au header puis masqué sous le header"
echo "✅ piste Tron affinée, centre géométrique inchangé"
echo "✅ liserés / badges / fantôme conservés"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_V5_AXIS_HEADER_TARGET_V2_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_V5_AXIS_HEADER_TARGET_V2_JS END -->',text,re.S)
if not m: raise SystemExit('ERREUR: JS V2 embarqué introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY
if command -v node >/dev/null 2>&1; then node --check "$EMBEDDED_JS" >/dev/null && echo "✅ JavaScript valide"; fi

AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo
echo "=== HASH APRÈS ==="
echo "$AFTER  $FILE"

echo
echo "=== VERSION SERVIE ==="
SERVED=""
for i in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$i" | sha256sum | awk '{print $1}')" || true
  echo "Essai $i : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done
[[ "$SERVED" == "$AFTER" ]] && echo "✅ HTTP = local" || echo "⚠️ HTTP pas encore synchronisé"

SUCCESS=1
trap - EXIT

echo
echo "✅ INSTALLATION V2 TERMINÉE"
echo "Sauvegarde : $BACKUP"
