#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
EXPECTED="69751c26bb087f5482c587f88f158bb7b1e80b90813eff5105ec30b09f6e8c02"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-v5-axis-header-target-v1-${STAMP}"
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
BEFORE="$(sha256sum "$FILE" | awk '{print $1}')"
echo "=== VERSION AVANT ==="
echo "$BEFORE  $FILE"
[[ "$BEFORE" == "$EXPECTED" ]] || { echo "ERREUR: hash inattendu. Aucun changement appliqué." >&2; exit 3; }

for needle in \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_PARTIAL_GHOST_V2_CSS START' \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_CSS START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_JS START' \
  'id="trip-panel-summary"' \
  'id="trip-progress"'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: élément attendu absent: $needle" >&2; exit 4; }
done

cp -p "$FILE" "$BACKUP"
echo "=== SAUVEGARDE ==="
echo "$BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

css_start='<!-- LB_V5_AXIS_HEADER_TARGET_V1_CSS START -->'
css_end='<!-- LB_V5_AXIS_HEADER_TARGET_V1_CSS END -->'
js_start='<!-- LB_V5_AXIS_HEADER_TARGET_V1_JS START -->'
js_end='<!-- LB_V5_AXIS_HEADER_TARGET_V1_JS END -->'

css=r'''
/* CIBLE VALIDÉE : HEURE | AXE+ROND | GARE. Aucun changement de hauteur/typo de la liste. */
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop::before{
  left:84px!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop:not(:last-child)::after{
  left:89px!important;
}

/* Haut du train : même information, hiérarchie plus propre façon La Bétaillère / Tron. */
html body .trip-panel:not(.station-board-mode) .lb-trip-route-card-v1{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)!important;
  grid-template-areas:"dep mid arr" "depn mid arrn"!important;
  align-items:center!important;
  gap:2px 10px!important;
  margin:1px 0 4px!important;
  padding:7px 9px!important;
  border:1px solid rgba(0,234,255,.18)!important;
  border-radius:10px!important;
  background:linear-gradient(135deg,rgba(7,25,40,.72),rgba(3,13,27,.56))!important;
}
html body .trip-panel:not(.station-board-mode) .lb-route-side-v1{min-width:0!important}
html body .trip-panel:not(.station-board-mode) .lb-route-side-v1.is-dep{grid-area:dep!important}
html body .trip-panel:not(.station-board-mode) .lb-route-side-v1.is-arr{grid-area:arr!important;text-align:right!important}
html body .trip-panel:not(.station-board-mode) .lb-route-label-v1{
  display:block!important;color:#6eaaba!important;font-size:7.5px!important;line-height:1!important;
  font-weight:800!important;letter-spacing:.08em!important;text-transform:uppercase!important
}
html body .trip-panel:not(.station-board-mode) .lb-route-time-v1{
  display:block!important;margin-top:2px!important;color:#f2fcff!important;font-size:15px!important;
  line-height:1!important;font-weight:900!important;font-variant-numeric:tabular-nums!important
}
html body .trip-panel:not(.station-board-mode) .lb-route-name-v1{
  display:block!important;margin-top:3px!important;color:#d9eef5!important;font-size:9.5px!important;
  line-height:1.05!important;font-weight:750!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important
}
html body .trip-panel:not(.station-board-mode) .lb-route-mid-v1{
  grid-area:mid!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;
  min-width:58px!important;color:#35dbe7!important
}
html body .trip-panel:not(.station-board-mode) .lb-route-duration-v1{
  padding:2px 6px!important;border-radius:999px!important;border:1px solid rgba(0,234,255,.18)!important;
  background:rgba(8,34,48,.75)!important;color:#b9dce5!important;font-size:8px!important;font-weight:800!important;white-space:nowrap!important
}
html body .trip-panel:not(.station-board-mode) .lb-route-link-v1{
  width:100%!important;height:1px!important;margin-top:5px!important;background:linear-gradient(90deg,#22bcd0,#35dbe7,#22bcd0)!important;opacity:.72!important
}
html body .trip-panel:not(.station-board-mode) .trip-panel-summary{
  margin:0!important;color:#9fb7c4!important;font-size:9px!important;line-height:1.08!important
}
html body .trip-panel:not(.station-board-mode) .trip-panel-realtime{
  margin:2px 0 0!important;padding:0!important;border:0!important;background:none!important;
  color:#8da7b4!important;font-size:8.5px!important;line-height:1.05!important;gap:3px!important
}
html body .trip-panel:not(.station-board-mode) .trip-panel-realtime strong{
  color:#dff7fb!important;font-size:9px!important;font-weight:850!important
}
html body .trip-panel:not(.station-board-mode) .trip-panel-realtime-diff{
  color:#ffad32!important;font-size:8px!important;font-weight:850!important
}
html body .trip-panel:not(.station-board-mode) .trip-progress{margin-top:1px!important}
html body .trip-panel:not(.station-board-mode) .trip-progress-text{font-size:8px!important;color:#7894a2!important}
html body .trip-panel:not(.station-board-mode) .trip-stops-title{margin-top:1px!important}

@media(max-width:700px){
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop::before{left:78px!important}
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop:not(:last-child)::after{left:83px!important}
  html body .trip-panel:not(.station-board-mode) .lb-route-time-v1{font-size:14px!important}
  html body .trip-panel:not(.station-board-mode) .lb-route-name-v1{font-size:9px!important}
}
'''

js=r'''
(()=>{
  'use strict';
  if(window.__LB_V5_AXIS_HEADER_TARGET_V1__) return;
  window.__LB_V5_AXIS_HEADER_TARGET_V1__=true;

  function clockToMin(s){
    const m=String(s||'').match(/^(\d{1,2}):(\d{2})$/); if(!m)return null;
    return Number(m[1])*60+Number(m[2]);
  }
  function enhance(){
    const panel=document.getElementById('trip-panel');
    const summary=document.getElementById('trip-panel-summary');
    if(!panel||!summary||panel.classList.contains('station-board-mode')) return;
    if(summary.querySelector('.lb-trip-route-card-v1')) return;

    const nodes=Array.from(summary.childNodes);
    const routeNodes=[];
    for(const n of nodes){
      if(n.nodeType===1 && n.tagName==='DIV') break;
      routeNodes.push(n);
    }
    const routeText=routeNodes.map(n=>n.textContent||'').join(' ').replace(/\s+/g,' ').trim();
    const m=routeText.match(/^(.*?)\s+(\d{1,2}:\d{2})\s*(?:→|->)\s*(.*?)\s+(\d{1,2}:\d{2})$/);
    if(!m) return;

    const depName=m[1].trim(), depTime=m[2], arrName=m[3].trim(), arrTime=m[4];
    let dur='';
    const a=clockToMin(depTime), b=clockToMin(arrTime);
    if(a!=null&&b!=null){ let d=b-a; if(d<0)d+=1440; if(d>=0&&d<1440)dur=`${d} min`; }

    routeNodes.forEach(n=>n.remove());
    const card=document.createElement('div');
    card.className='lb-trip-route-card-v1';
    card.innerHTML=`
      <div class="lb-route-side-v1 is-dep"><span class="lb-route-label-v1">Départ</span><span class="lb-route-time-v1">${depTime}</span><span class="lb-route-name-v1"></span></div>
      <div class="lb-route-mid-v1">${dur?`<span class="lb-route-duration-v1">${dur}</span>`:''}<span class="lb-route-link-v1"></span></div>
      <div class="lb-route-side-v1 is-arr"><span class="lb-route-label-v1">Arrivée</span><span class="lb-route-time-v1">${arrTime}</span><span class="lb-route-name-v1"></span></div>`;
    card.querySelector('.is-dep .lb-route-name-v1').textContent=depName;
    card.querySelector('.is-arr .lb-route-name-v1').textContent=arrName;
    summary.insertAdjacentElement('afterbegin',card);
  }

  if(typeof renderTripPanel==='function'){
    const original=renderTripPanel;
    renderTripPanel=function(...args){
      const result=original.apply(this,args);
      try{enhance()}catch(e){console.warn('[LB header v1]',e)}
      setTimeout(()=>{try{enhance()}catch(_){}},0);
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

css_block=f'{css_start}\n<style id="lb-v5-axis-header-target-v1-css">\n{css}\n</style>\n{css_end}'
js_block=f'{js_start}\n<script id="lb-v5-axis-header-target-v1-js">\n{js}\n</script>\n{js_end}'
text=put(text,css_start,css_end,css_block,'</head>')
text=put(text,js_start,js_end,js_block,'</body>')

for marker in (css_start,css_end,js_start,js_end):
    if text.count(marker)!=1: raise SystemExit(f'ERREUR marqueur: {marker}')

path.write_text(text,encoding='utf-8')
print('✅ axe déplacé entre horaires et gare + haut harmonisé')
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' "$FILE"
grep -q 'LB_V5_AXIS_HEADER_TARGET_V1_JS START' "$FILE"
grep -q 'left:84px!important' "$FILE"
grep -q 'left:89px!important' "$FILE"
grep -q '__LB_V5_AXIS_HEADER_TARGET_V1__' "$FILE"
# Les briques de retards/liserés doivent toujours être là.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ axe desktop : rond x=84 / barre x=89"
echo "✅ header Tron installé"
echo "✅ liserés / badges / fantôme toujours présents"

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
echo "✅ INSTALLATION TERMINÉE"
echo "Sauvegarde : $BACKUP"
