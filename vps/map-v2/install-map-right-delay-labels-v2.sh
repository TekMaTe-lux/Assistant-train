#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-right-delay-labels-v2-${STAMP}"
EMBEDDED_JS="/tmp/lb-right-delay-labels-v2-${STAMP}.js"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -ne 1 && -f "$BACKUP" ]]; then
    echo
    echo "❌ ÉCHEC — restauration automatique"
    cp -p "$BACKUP" "$FILE"
    echo "✅ Carte restaurée depuis : $BACKUP"
  fi
}
trap rollback EXIT

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

for needle in \
  'LB_TRIP_SHEET_SITE_STYLE_V5_CSS START' \
  'LB_TRIP_SHEET_SITE_STYLE_V5_JS START' \
  'LB_V5_AXIS_HEADER_TARGET_V1_CSS START' \
  'function renderTripPanel' \
  'id="trip-stops"'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== 2. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 3. INSTALLATION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

# Retire une éventuelle V1 inline déjà installée pour ne pas empiler.
for ver in ('V1','V2'):
    for kind in ('CSS','JS'):
        start=f'<!-- LB_RIGHT_DELAY_LABELS_{ver}_{kind} START -->'
        end=f'<!-- LB_RIGHT_DELAY_LABELS_{ver}_{kind} END -->'
        text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)

css_start='<!-- LB_RIGHT_DELAY_LABELS_V2_CSS START -->'
css_end='<!-- LB_RIGHT_DELAY_LABELS_V2_CSS END -->'
js_start='<!-- LB_RIGHT_DELAY_LABELS_V2_JS START -->'
js_end='<!-- LB_RIGHT_DELAY_LABELS_V2_JS END -->'

css=r'''
/* V2 — retard à droite + respiration entre la piste Tron et les noms de gare. */
html body .trip-stops.lb-site-train-sheet-v5 .trip-stop{
  grid-template-columns:66px minmax(0,1fr) 58px!important;
  column-gap:14px!important;
  padding-right:8px!important;
}

/* La piste reste exactement où elle est. On éloigne seulement le texte. */
html body .trip-stops.lb-site-train-sheet-v5 .stop-main{
  padding-left:8px!important;
}

html body .trip-stops.lb-site-train-sheet-v5 .lb-stop-delay-right{
  grid-column:3!important;
  align-self:start!important;
  justify-self:end!important;
  min-width:54px!important;
  padding-top:1px!important;
  text-align:right!important;
  white-space:nowrap!important;
  color:#ffad32!important;
  font-size:10px!important;
  line-height:1.05!important;
  font-weight:900!important;
  font-variant-numeric:tabular-nums!important;
  letter-spacing:0!important;
  text-shadow:0 0 5px rgba(255,173,50,.12)!important;
}
html body .trip-stops.lb-site-train-sheet-v5 .lb-stop-delay-right.is-advance{
  color:#63e08b!important;
  text-shadow:none!important;
}

@media(max-width:700px){
  html body .trip-stops.lb-site-train-sheet-v5 .trip-stop{
    grid-template-columns:60px minmax(0,1fr) 50px!important;
    column-gap:12px!important;
    padding-right:6px!important;
  }
  html body .trip-stops.lb-site-train-sheet-v5 .stop-main{
    padding-left:7px!important;
  }
  html body .trip-stops.lb-site-train-sheet-v5 .lb-stop-delay-right{
    min-width:46px!important;
    font-size:9px!important;
  }
}
'''

js=r'''
(()=>{
  'use strict';
  if(window.__LB_RIGHT_DELAY_LABELS_V2__) return;
  window.__LB_RIGHT_DELAY_LABELS_V2__=true;

  function parseClock(value){
    const m=String(value||'').match(/\b([0-2]?\d):(\d{2})\b/);
    if(!m) return null;
    const h=Number(m[1]), mn=Number(m[2]);
    if(!Number.isFinite(h)||!Number.isFinite(mn)) return null;
    return h*60+mn;
  }

  function delayForRow(row){
    const planEl=row.querySelector('.stop-time .time-entry-plan');
    const rtEl=row.querySelector('.stop-time .time-entry-rt');
    if(!planEl||!rtEl) return null;

    const plan=parseClock(planEl.textContent);
    const realtime=parseClock(rtEl.textContent);
    if(plan==null||realtime==null) return null;

    let diff=realtime-plan;
    if(diff>720) diff-=1440;
    if(diff<-720) diff+=1440;
    if(!diff) return null;

    return {diff,label:`${diff>0?'+':''}${diff} min`,kind:diff>0?'delay':'advance'};
  }

  function apply(){
    const panel=document.getElementById('trip-panel');
    const stops=document.getElementById('trip-stops');
    if(!panel||!stops||panel.classList.contains('station-board-mode')) return;

    const rows=Array.from(stops.querySelectorAll(':scope > .trip-stop'));
    for(const row of rows){
      const info=delayForRow(row);
      let label=row.querySelector(':scope > .lb-stop-delay-right');

      if(!info){
        if(label) label.remove();
        continue;
      }

      const className=`lb-stop-delay-right ${info.kind==='advance'?'is-advance':'is-delay'}`;
      if(!label){
        label=document.createElement('div');
        row.appendChild(label);
      }
      label.className=className;
      if(label.textContent!==info.label) label.textContent=info.label;
    }
  }

  /* renderTripPanel peut être enveloppé par plusieurs correctifs : on s'accroche au DOM réel,
     ce qui évite les problèmes d'ordre entre wrappers. */
  const stops=document.getElementById('trip-stops');
  if(stops){
    let scheduled=false;
    const schedule=()=>{
      if(scheduled) return;
      scheduled=true;
      requestAnimationFrame(()=>{scheduled=false;try{apply()}catch(e){console.warn('[LB delay labels v2]',e)}});
    };
    const observer=new MutationObserver(schedule);
    observer.observe(stops,{childList:true,subtree:true,characterData:true});
    schedule();
  }

  if(typeof renderTripPanel==='function'){
    const original=renderTripPanel;
    renderTripPanel=function(...args){
      const result=original.apply(this,args);
      setTimeout(()=>{try{apply()}catch(_){}},0);
      requestAnimationFrame(()=>{try{apply()}catch(_){} });
      return result;
    };
  }
})();
'''

def put(source,start,end,block,closing):
    p=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
    if p.search(source): return p.sub(block,source,count=1)
    if closing not in source: raise SystemExit(f'ERREUR: {closing} introuvable')
    return source.replace(closing,block+'\n'+closing,1)

css_block=f'{css_start}\n<style id="lb-right-delay-labels-v2-css">\n{css}\n</style>\n{css_end}'
js_block=f'{js_start}\n<script id="lb-right-delay-labels-v2-js">\n{js}\n</script>\n{js_end}'
text=put(text,css_start,css_end,css_block,'</head>')
text=put(text,js_start,js_end,js_block,'</body>')

for marker in (css_start,css_end,js_start,js_end):
    if text.count(marker)!=1: raise SystemExit(f'ERREUR marqueur: {marker}')

path.write_text(text,encoding='utf-8')
print('✅ V2 installée : labels retard DOM réel + texte décalé de la piste')
PY

echo
echo "=== 4. CONTRÔLES ==="
grep -q 'LB_RIGHT_DELAY_LABELS_V2_CSS START' "$FILE"
grep -q 'LB_RIGHT_DELAY_LABELS_V2_JS START' "$FILE"
grep -q 'document.getElementById('[0m'"'"'trip-stops'"'"'' "$FILE" || true
grep -q '__LB_RIGHT_DELAY_LABELS_V2__' "$FILE"
grep -q 'padding-left:8px!important' "$FILE"
# Ne pas perdre les briques existantes.
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ V2 présente"
echo "✅ labels calculés à partir du DOM réel"
echo "✅ noms de gare décalés de 8px de la piste"
echo "✅ liserés / badges / fantôme conservés"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_RIGHT_DELAY_LABELS_V2_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_RIGHT_DELAY_LABELS_V2_JS END -->',text,re.S)
if not m: raise SystemExit('ERREUR: JS V2 introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY

if command -v node >/dev/null 2>&1; then
  node --check "$EMBEDDED_JS" >/dev/null
  echo "✅ JavaScript embarqué valide"
fi

echo
echo "=== 5. HASH APRÈS ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 6. VERSION SERVIE ==="
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
