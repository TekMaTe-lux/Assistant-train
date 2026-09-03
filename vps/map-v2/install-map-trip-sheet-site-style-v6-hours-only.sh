#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-trip-sheet-v6-hours-only-${STAMP}"
EMBEDDED_JS="/tmp/lb-trip-sheet-v6-${STAMP}.js"
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
for needle in 'function renderTripPanel' 'resolveStationBoardTrack' 'tripStopsEl' 'LB_MARKER_BADGE_FIX_V2 START'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== 2. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 3. RESTAURATION DU RENDU V4 + CORRECTION HORAIRES UNIQUEMENT ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re, sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

# Retirer toutes les variantes précédentes de fiche ajoutées par nos correctifs.
for ver in ('V1','V2','V3','V4','V5','V6'):
    for kind in ('CSS','JS'):
        start=f'<!-- LB_TRIP_SHEET_SITE_STYLE_{ver}_{kind} START -->'
        end=f'<!-- LB_TRIP_SHEET_SITE_STYLE_{ver}_{kind} END -->'
        text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)

css_start='<!-- LB_TRIP_SHEET_SITE_STYLE_V6_CSS START -->'
css_end='<!-- LB_TRIP_SHEET_SITE_STYLE_V6_CSS END -->'
js_start='<!-- LB_TRIP_SHEET_SITE_STYLE_V6_JS START -->'
js_end='<!-- LB_TRIP_SHEET_SITE_STYLE_V6_JS END -->'

# IMPORTANT : géométrie, hauteurs, axe et typographie repris STRICTEMENT de la V4 jugée correcte.
css=r'''
html body .cow-marker .train-partial-badge{display:none!important}
html body .trip-stops.lb-site-train-sheet-v6{display:flex!important;flex-direction:column!important;gap:0!important;padding:0 3px 0 0!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop{--lb-axis-x:78px;position:relative!important;display:grid!important;grid-template-columns:62px minmax(0,1fr)!important;column-gap:34px!important;align-items:start!important;min-height:52px!important;padding:2px 0 7px 0!important;border:0!important}
html body .trip-stops.lb-site-train-sheet-v6 .lb-stop-axis,html body .trip-stops.lb-site-train-sheet-v6 .lb-stop-dot,html body .trip-stops.lb-site-train-sheet-v6 .lb-stop-delay{display:none!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop::before{content:''!important;position:absolute!important;left:calc(var(--lb-axis-x) - 6px)!important;top:9px!important;width:12px!important;height:12px!important;border-radius:50%!important;box-sizing:border-box!important;border:2px solid #48dbe5!important;background:#0b2633!important;box-shadow:0 0 0 3px rgba(7,20,31,.96)!important;opacity:1!important;transform:none!important;z-index:2!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop:not(:last-child)::after{content:''!important;position:absolute!important;left:calc(var(--lb-axis-x) - 1px)!important;top:21px!important;bottom:-9px!important;width:2px!important;background:#2c7585!important;opacity:.82!important;z-index:1!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop:last-child::after{display:none!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.passed::before,html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.done::before,html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.completed::before{background:#48dbe5!important;border-color:#48dbe5!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.current::before,html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.live::before,html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.active::before{left:calc(var(--lb-axis-x) - 8px)!important;top:7px!important;width:16px!important;height:16px!important;background:#7ff4f0!important;border:3px solid #19c9d3!important;box-shadow:0 0 0 3px rgba(7,20,31,.96),0 0 10px rgba(64,226,232,.42)!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop.cancelled::before{background:#0b2633!important;border-color:#738d99!important}
html body .trip-stops.lb-site-train-sheet-v6 .stop-time{grid-column:1!important;width:62px!important;min-width:62px!important;max-width:62px!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important;gap:0!important;padding:1px 0 0!important;font-variant-numeric:tabular-nums!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry{display:block!important;width:auto!important;margin:0!important;padding:0!important;line-height:1!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry::before,html body .trip-stops.lb-site-train-sheet-v6 .time-entry::after{display:none!important;content:none!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry-plan,html body .trip-stops.lb-site-train-sheet-v6 .time-entry-rt{display:block!important;margin:0!important;padding:0!important;white-space:nowrap!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry-plan{color:#eaf8fb!important;font-size:11px!important;line-height:1.08!important;font-weight:800!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry-plan.lb-plan-changed{color:#6f8590!important;font-size:9px!important;font-weight:650!important;text-decoration:line-through!important;text-decoration-thickness:1px!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry-rt{margin-top:2px!important;color:#ffb23d!important;font-size:11.5px!important;line-height:1.03!important;font-weight:900!important}
html body .trip-stops.lb-site-train-sheet-v6 .time-entry-rt.lb-rt-advance{color:#69de9a!important}
html body .trip-stops.lb-site-train-sheet-v6 .stop-main{grid-column:2!important;min-width:0!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:1px!important;padding:0!important}
html body .trip-stops.lb-site-train-sheet-v6 .stop-name{margin:0!important;color:#eefbff!important;font-size:12.5px!important;line-height:1.06!important;font-weight:850!important;white-space:normal!important;overflow:visible!important}
html body .trip-stops.lb-site-train-sheet-v6 .lb-stop-track{color:#a8bec7!important;font-size:8.5px!important;line-height:1.08!important;font-weight:560!important}
html body .trip-stops.lb-site-train-sheet-v6 .stop-note{margin-top:1px!important;color:#73cfd8!important;font-size:8px!important;line-height:1.05!important;font-weight:800!important;letter-spacing:.025em!important;text-transform:uppercase!important}
html body .trip-stops.lb-site-train-sheet-v6 .trip-stop:not(.current):not(.live):not(.active) .stop-note{color:#7895a1!important}
@media(max-width:700px){html body .trip-stops.lb-site-train-sheet-v6 .trip-stop{--lb-axis-x:70px;grid-template-columns:55px minmax(0,1fr)!important;column-gap:31px!important;min-height:50px!important}html body .trip-stops.lb-site-train-sheet-v6 .stop-time{width:55px!important;min-width:55px!important;max-width:55px!important}html body .trip-stops.lb-site-train-sheet-v6 .stop-name{font-size:12px!important}}
'''

js=r'''
(()=>{
  'use strict';
  if(window.__LB_TRIP_SHEET_SITE_STYLE_V6__)return;
  window.__LB_TRIP_SHEET_SITE_STYLE_V6__=true;

  function findStation(stopName){
    const name=String(stopName||'').trim();if(!name)return{name:''};
    let norm='';try{norm=normalizeStationName(name)}catch(_){norm=name.toLowerCase()}
    try{for(const station of axisStationsById.values()){
      const label=station?.label||station?.name||station?.stationLabel||'';let candidate='';
      try{candidate=normalizeStationName(label)}catch(_){candidate=String(label).toLowerCase()}
      if(candidate&&(candidate===norm||candidate.startsWith(norm)||norm.startsWith(candidate)))return station;
    }}catch(_){}
    return{name};
  }

  function trackFor(trainData,stopName,isLast){
    if(!trainData||typeof resolveStationBoardTrack!=='function')return null;
    const eventRow={stationBoardCanonicalNumber:trainData.stationBoardCanonicalNumber||trainData.numberKey||trainData.number||null,number:trainData.number||null,numberDigits:trainData.numberDigits||null,numberRaw:trainData.numberRaw||trainData.number||null,trainId:trainData.id||activeTripId||null,delayNumberKeys:Array.isArray(trainData.delayNumberKeys)?trainData.delayNumberKeys:[],numberList:Array.isArray(trainData.numberList)?trainData.numberList:[],stationLabel:stopName};
    try{return resolveStationBoardTrack(eventRow,isLast?'arr':'dep',findStation(stopName))||null}catch(_){return null}
  }

  function clock(text){const m=String(text||'').match(/\b([0-2]?\d:\d{2})\b/);return m?m[1]:null}

  function chooseTime(row,isLast){
    const entries=Array.from(row.querySelectorAll('.stop-time .time-entry'));if(!entries.length)return null;
    return isLast?(entries.find(e=>e.classList.contains('time-arr'))||entries[entries.length-1]):(entries.find(e=>e.classList.contains('time-dep'))||entries.find(e=>e.classList.contains('time-neutral'))||entries[entries.length-1]);
  }

  /* Seule modification fonctionnelle de la V4 : reconstruire le contenu horaire.
     Cela supprime A/D et toute flèche/prefixe, sans toucher à la géométrie de la fiche. */
  function normalizeTime(row,isLast){
    const box=row.querySelector('.stop-time');const keep=chooseTime(row,isLast);if(!box||!keep)return;
    const plan=clock(keep.querySelector('.time-entry-plan')?.textContent||'');
    const rtNode=keep.querySelector('.time-entry-rt');
    const realtime=clock(rtNode?.textContent||'');
    const changed=!!(plan&&realtime&&plan!==realtime);
    const advance=!!rtNode?.classList?.contains('time-entry-rt--advance');

    box.innerHTML='';
    const entry=document.createElement('div');entry.className='time-entry';
    const planned=document.createElement('span');planned.className='time-entry-plan';planned.textContent=plan||realtime||'—';
    if(changed){planned.classList.add('lb-plan-changed')}
    entry.appendChild(planned);
    if(changed){
      const rt=document.createElement('span');rt.className='time-entry-rt'+(advance?' lb-rt-advance':'');rt.textContent=realtime;entry.appendChild(rt);
    }
    box.appendChild(entry);
  }

  function cleanNote(row){
    const note=row.querySelector('.stop-note');if(!note)return;
    const parts=String(note.textContent||'').split('·').map(v=>v.trim()).filter(Boolean).filter(v=>!/^départ$/i.test(v)&&!/^terminus$/i.test(v));
    if(!parts.length){note.remove();return}note.textContent=parts.join(' · ');
  }

  function apply(){
    if(!activeTripId||!tripStopsEl||tripPanelEl?.classList?.contains('station-board-mode'))return;
    const data=(typeof trainDataById?.get==='function'?trainDataById.get(activeTripId):null)||(typeof buildStaticPanelTrainData==='function'?buildStaticPanelTrainData(activeTripId):null);if(!data)return;
    const rows=Array.from(tripStopsEl.querySelectorAll(':scope > .trip-stop')).filter(r=>r.querySelector('.stop-name')&&r.querySelector('.stop-time'));if(!rows.length)return;
    tripStopsEl.classList.remove('lb-site-train-sheet','lb-site-train-sheet-v2','lb-site-train-sheet-v3','lb-site-train-sheet-v4','lb-site-train-sheet-v5');
    tripStopsEl.classList.add('lb-site-train-sheet-v6');
    rows.forEach((row,idx)=>{
      const isLast=idx===rows.length-1;const nameEl=row.querySelector('.stop-name');const main=row.querySelector('.stop-main');const stopName=String(nameEl?.textContent||'').trim();if(!nameEl||!main||!stopName)return;
      row.querySelectorAll('.lb-stop-axis,.lb-stop-dot,.lb-stop-delay,.lb-stop-track').forEach(el=>el.remove());
      normalizeTime(row,isLast);cleanNote(row);
      const track=trackFor(data,stopName,isLast);
      if(track){const el=document.createElement('div');el.className='lb-stop-track';el.textContent=`Voie ${track}`;nameEl.insertAdjacentElement('afterend',el)}
    });
  }

  const original=renderTripPanel;
  renderTripPanel=function(...args){const result=original.apply(this,args);try{apply()}catch(err){console.warn('[LB trip sheet v6]',err)}setTimeout(()=>{try{apply()}catch(_){}},0);requestAnimationFrame(()=>{try{apply()}catch(_){} });return result;};
})();
'''

def put(source,start,end,block,closing):
    p=re.compile(re.escape(start)+r'.*?'+re.escape(end),re.S)
    if p.search(source):return p.sub(block,source,count=1)
    if closing not in source:raise SystemExit(f'ERREUR: {closing} introuvable')
    return source.replace(closing,block+'\n'+closing,1)

css_block=f'{css_start}\n<style id="lb-trip-sheet-site-style-v6-css">\n{css}\n</style>\n{css_end}'
js_block=f'{js_start}\n<script id="lb-trip-sheet-site-style-v6-js">\n{js}\n</script>\n{js_end}'
text=put(text,css_start,css_end,css_block,'</head>')
text=put(text,js_start,js_end,js_block,'</body>')
for marker in(css_start,css_end,js_start,js_end):
    if text.count(marker)!=1:raise SystemExit(f'ERREUR marqueur: {marker}')
path.write_text(text,encoding='utf-8')
print('✅ rendu V4 restauré + correction limitée aux horaires/voies')
PY

echo
echo "=== 4. CONTRÔLES ==="
grep -q 'LB_TRIP_SHEET_SITE_STYLE_V6_CSS START' "$FILE"
grep -q 'LB_TRIP_SHEET_SITE_STYLE_V6_JS START' "$FILE"
grep -q -- '--lb-axis-x:78px' "$FILE"
grep -q 'box.innerHTML' "$FILE"
grep -q 'if(track)' "$FILE"
echo "✅ géométrie V4 restaurée"
echo "✅ A/D et flèche supprimés uniquement dans la zone horaires"
echo "✅ Voie non communiquée supprimée"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_TRIP_SHEET_SITE_STYLE_V6_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_TRIP_SHEET_SITE_STYLE_V6_JS END -->',text,re.S)
if not m:raise SystemExit('ERREUR: JS V6 introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY
if command -v node >/dev/null 2>&1;then node --check "$EMBEDDED_JS" >/dev/null && echo "✅ JavaScript valide";fi

echo
echo "=== 5. EMPREINTE LOCALE ==="
AFTER="$(sha256sum "$FILE"|awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 6. VERSION SERVIE ==="
SERVED=""
for try in 1 2 3;do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$try"|sha256sum|awk '{print $1}')"||true
  echo "Essai $try : $SERVED"
  [[ "$SERVED" == "$AFTER" ]]&&break
  sleep 1
done
[[ "$SERVED" == "$AFTER" ]]&&echo "✅ La version servie correspond au fichier local"||echo "⚠️ Version HTTP différente pour l'instant"

SUCCESS=1
trap - EXIT

echo
echo "✅ CORRECTIF V6 INSTALLÉ — RENDU V4 CONSERVÉ"
echo "Sauvegarde : $BACKUP"
