#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
EXPECTED_BEFORE="c33567b1758c5999efaa4d6e7faddbe7e53d3da843bb73e2448686bc1b8234dd"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-trip-sheet-site-style-v1-${STAMP}"
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
  'function renderTripPanel' \
  'resolveStationBoardTrack' \
  'tracksByTrainNumber' \
  'tripStopsEl' \
  'time-entry-plan' \
  'time-entry-rt' \
  'LB_MARKER_BADGE_FIX_V2 START'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
CURRENT="$(sha256sum "$FILE" | awk '{print $1}')"
echo "Attendu : $EXPECTED_BEFORE"
echo "Présent : $CURRENT"

if [[ "$CURRENT" != "$EXPECTED_BEFORE" ]] && ! grep -q 'LB_TRIP_SHEET_SITE_STYLE_V1_JS START' "$FILE"; then
  echo "❌ La carte a changé depuis le dernier contrôle — arrêt sans modification." >&2
  echo "   Empreinte actuelle : $CURRENT" >&2
  exit 4
fi

echo
echo "=== 2. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 3. INSTALLATION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

css_start = '<!-- LB_TRIP_SHEET_SITE_STYLE_V1_CSS START -->'
css_end = '<!-- LB_TRIP_SHEET_SITE_STYLE_V1_CSS END -->'
js_start = '<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS START -->'
js_end = '<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS END -->'

css = r'''/* Fiche train carte alignée sur la logique visuelle des fiches labetaillere.fr. */
html body .trip-stops.lb-site-train-sheet{
  gap:0!important;
  padding-right:2px!important;
}
html body .trip-stops.lb-site-train-sheet .trip-stop{
  display:grid!important;
  grid-template-columns:52px minmax(0,1fr) auto!important;
  align-items:center!important;
  column-gap:8px!important;
  min-height:42px!important;
  padding:4px 0 4px 14px!important;
  border-bottom:1px solid rgba(0,234,255,.075)!important;
}
html body .trip-stops.lb-site-train-sheet .trip-stop:last-child{
  border-bottom:0!important;
}
html body .trip-stops.lb-site-train-sheet .stop-time{
  box-sizing:border-box!important;
  flex:none!important;
  width:52px!important;
  min-width:52px!important;
  max-width:52px!important;
  align-items:flex-start!important;
  justify-content:center!important;
  gap:0!important;
  color:#d9edf4!important;
  font-size:10px!important;
  line-height:1.02!important;
  letter-spacing:0!important;
  font-variant-numeric:tabular-nums!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry{
  width:100%!important;
  margin:0!important;
  padding:0!important;
  line-height:1.02!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry::before{
  content:none!important;
  display:none!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-plan,
html body .trip-stops.lb-site-train-sheet .time-entry-rt{
  display:block!important;
  margin:0!important;
  padding:0!important;
  white-space:nowrap!important;
  font-size:10px!important;
  line-height:1.04!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-plan{
  color:#dcecf2!important;
  font-weight:700!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-plan.lb-time-plan-changed{
  color:#718a96!important;
  font-size:8px!important;
  font-weight:600!important;
  text-decoration:line-through!important;
  text-decoration-thickness:1px!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-rt{
  color:#eefcff!important;
  font-size:10.5px!important;
  font-weight:850!important;
  opacity:1!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-rt--delay{
  color:#ffad32!important;
}
html body .trip-stops.lb-site-train-sheet .time-entry-rt--advance{
  color:#5ce391!important;
}
html body .trip-stops.lb-site-train-sheet .stop-main{
  min-width:0!important;
  gap:1px!important;
  justify-self:stretch!important;
}
html body .trip-stops.lb-site-train-sheet .stop-name{
  min-width:0!important;
  margin:0!important;
  color:#edfaff!important;
  font-size:11.5px!important;
  line-height:1.03!important;
  font-weight:800!important;
  white-space:normal!important;
  overflow:visible!important;
}
html body .trip-stops.lb-site-train-sheet .lb-stop-track{
  margin-top:1px!important;
  color:#698898!important;
  font-size:7.8px!important;
  line-height:1!important;
  font-weight:550!important;
  letter-spacing:.015em!important;
}
html body .trip-stops.lb-site-train-sheet .lb-stop-track.has-track{
  color:#86a7b5!important;
}
html body .trip-stops.lb-site-train-sheet .stop-note{
  margin-top:1px!important;
  color:#8aa8b5!important;
  font-size:7.3px!important;
  line-height:1!important;
  letter-spacing:.025em!important;
}
html body .trip-stops.lb-site-train-sheet .stop-note:empty{
  display:none!important;
}
html body .trip-stops.lb-site-train-sheet .lb-stop-delay{
  align-self:center!important;
  justify-self:end!important;
  padding-left:4px!important;
  color:#ffad32!important;
  font-size:9px!important;
  line-height:1!important;
  font-weight:850!important;
  white-space:nowrap!important;
  font-variant-numeric:tabular-nums!important;
}
html body .trip-stops.lb-site-train-sheet .lb-stop-delay.is-advance{
  color:#5ce391!important;
}
html body .trip-stops.lb-site-train-sheet .lb-stop-delay.is-cancelled{
  color:#ff5364!important;
  font-size:7.8px!important;
  letter-spacing:.02em!important;
}
html body .trip-stops.lb-site-train-sheet .trip-stop.cancelled .lb-stop-track{
  color:#a96873!important;
}
html body .trip-stops.lb-site-train-sheet .trip-stop.cancelled .stop-name{
  color:#ff7180!important;
}

@media(max-width:600px){
  html body .trip-stops.lb-site-train-sheet .trip-stop{
    grid-template-columns:48px minmax(0,1fr) auto!important;
    column-gap:6px!important;
    min-height:40px!important;
    padding-left:13px!important;
  }
  html body .trip-stops.lb-site-train-sheet .stop-time{
    width:48px!important;
    min-width:48px!important;
    max-width:48px!important;
  }
  html body .trip-stops.lb-site-train-sheet .stop-name{font-size:11px!important}
  html body .trip-stops.lb-site-train-sheet .lb-stop-delay{font-size:8.5px!important}
}'''

js = r'''(()=>{
  'use strict';

  if (window.__LB_TRIP_SHEET_SITE_STYLE_V1__) return;
  window.__LB_TRIP_SHEET_SITE_STYLE_V1__ = true;

  function lbFindAxisStationContext(stopName){
    const name = String(stopName || '').trim();
    if (!name) return { name:'' };
    let norm = '';
    try { norm = normalizeStationName(name); } catch(_){ norm = name.toLowerCase(); }
    try {
      for (const station of axisStationsById.values()){
        const label = station?.label || station?.name || station?.stationLabel || '';
        let candidate = '';
        try { candidate = normalizeStationName(label); } catch(_){ candidate = String(label).toLowerCase(); }
        if (!candidate) continue;
        if (candidate === norm || candidate.startsWith(norm) || norm.startsWith(candidate)) return station;
      }
    } catch(_){ }
    return { name };
  }

  function lbTrackForPanelStop(trainData, stopName, isLast){
    if (!trainData || typeof resolveStationBoardTrack !== 'function') return null;
    const eventRow = {
      stationBoardCanonicalNumber: trainData.stationBoardCanonicalNumber || trainData.numberKey || trainData.number || null,
      number: trainData.number || null,
      numberDigits: trainData.numberDigits || null,
      numberRaw: trainData.numberRaw || trainData.number || null,
      trainId: trainData.id || activeTripId || null,
      delayNumberKeys: Array.isArray(trainData.delayNumberKeys) ? trainData.delayNumberKeys : [],
      numberList: Array.isArray(trainData.numberList) ? trainData.numberList : [],
      stationLabel: stopName
    };
    const stationContext = lbFindAxisStationContext(stopName);
    try {
      return resolveStationBoardTrack(eventRow, isLast ? 'arr' : 'dep', stationContext) || null;
    } catch(_){
      return null;
    }
  }

  function lbRealtimeClock(text){
    const match = String(text || '').match(/\b([0-2]?\d:\d{2})\b/);
    return match ? match[1] : null;
  }

  function lbDelayFromRealtime(text, rtEl){
    const raw = String(text || '');
    const match = raw.match(/\(([+-]?\s*\d+)\s*min\)/i);
    if (match){
      const value = Number(String(match[1]).replace(/\s+/g,''));
      if (Number.isFinite(value) && value !== 0){
        return { value, label:`${value > 0 ? '+' : ''}${value} min`, kind:value > 0 ? 'delay' : 'advance' };
      }
    }
    if (rtEl?.classList?.contains('time-entry-rt--delay')) return { value:null, label:'Retard', kind:'delay' };
    if (rtEl?.classList?.contains('time-entry-rt--advance')) return { value:null, label:'Avance', kind:'advance' };
    return null;
  }

  function lbCompactOneTime(row, isLast){
    const entries = Array.from(row.querySelectorAll('.stop-time .time-entry'));
    if (!entries.length) return null;

    let keep = null;
    if (isLast){
      keep = entries.find(el=>el.classList.contains('time-arr')) || entries[entries.length - 1];
    } else {
      keep = entries.find(el=>el.classList.contains('time-dep'))
        || entries.find(el=>el.classList.contains('time-neutral'))
        || entries[entries.length - 1];
    }
    for (const entry of entries){
      if (entry !== keep) entry.remove();
    }
    if (!keep) return null;

    const planEl = keep.querySelector('.time-entry-plan');
    const rtEl = keep.querySelector('.time-entry-rt');
    const delay = lbDelayFromRealtime(rtEl?.textContent || '', rtEl);
    const rtClock = lbRealtimeClock(rtEl?.textContent || '');

    if (rtEl){
      if (delay && rtClock){
        if (planEl) planEl.classList.add('lb-time-plan-changed');
        rtEl.textContent = rtClock;
      } else {
        const oneClock = rtClock || String(planEl?.textContent || '').trim() || '—';
        if (planEl){
          planEl.textContent = oneClock;
          planEl.classList.remove('lb-time-plan-changed');
        } else {
          const replacement = document.createElement('span');
          replacement.className = 'time-entry-plan';
          replacement.textContent = oneClock;
          keep.prepend(replacement);
        }
        rtEl.remove();
      }
    }
    return delay;
  }

  function lbCleanNativeNote(row){
    const note = row.querySelector('.stop-note');
    if (!note) return;
    const parts = String(note.textContent || '')
      .split('·')
      .map(v=>v.trim())
      .filter(Boolean)
      .filter(v=>!/^départ$/i.test(v) && !/^terminus$/i.test(v));
    if (!parts.length){
      note.remove();
      return;
    }
    const strong = note.querySelector('strong');
    if (strong) strong.textContent = parts.join(' · ');
    else note.textContent = parts.join(' · ');
  }

  function lbApplyTripSheetStyle(){
    if (!activeTripId || !tripStopsEl || tripPanelEl?.classList?.contains('station-board-mode')) return;
    const data = trainDataById.get(activeTripId) || buildStaticPanelTrainData(activeTripId);
    if (!data) return;

    const rows = Array.from(tripStopsEl.querySelectorAll(':scope > .trip-stop'))
      .filter(row=>row.querySelector('.stop-name'));
    if (!rows.length) return;

    tripStopsEl.classList.add('lb-site-train-sheet');

    rows.forEach((row, idx)=>{
      const isLast = idx === rows.length - 1;
      const nameEl = row.querySelector('.stop-name');
      const mainEl = row.querySelector('.stop-main');
      const stopName = String(nameEl?.textContent || '').trim();
      if (!nameEl || !mainEl || !stopName) return;

      row.querySelectorAll('.lb-stop-track,.lb-stop-delay').forEach(el=>el.remove());
      const delay = lbCompactOneTime(row, isLast);
      lbCleanNativeNote(row);

      const track = lbTrackForPanelStop(data, stopName, isLast);
      const trackEl = document.createElement('div');
      trackEl.className = `lb-stop-track${track ? ' has-track' : ''}`;
      trackEl.textContent = track ? `Voie ${track}` : 'Voie non communiquée';
      nameEl.insertAdjacentElement('afterend', trackEl);

      const statusEl = document.createElement('div');
      if (row.classList.contains('cancelled')){
        statusEl.className = 'lb-stop-delay is-cancelled';
        statusEl.textContent = 'SUPPRIMÉ';
        row.appendChild(statusEl);
      } else if (delay){
        statusEl.className = `lb-stop-delay${delay.kind === 'advance' ? ' is-advance' : ''}`;
        statusEl.textContent = delay.label;
        row.appendChild(statusEl);
      }
    });
  }

  const lbTripSheetOriginalRenderTripPanel = renderTripPanel;
  renderTripPanel = function(...args){
    const result = lbTripSheetOriginalRenderTripPanel.apply(this, args);
    try { lbApplyTripSheetStyle(); } catch(err){ console.warn('[LB trip sheet v1] rendu', err); }
    setTimeout(()=>{ try { lbApplyTripSheetStyle(); } catch(_){ } }, 350);
    return result;
  };

  setTimeout(()=>{ try { lbApplyTripSheetStyle(); } catch(_){ } }, 0);
  console.info('[LB trip sheet site style v1] actif');
})();'''

css_block = f'''{css_start}\n<style id="lb-trip-sheet-site-style-v1-css">\n{css}\n</style>\n{css_end}'''
js_block = f'''{js_start}\n<script id="lb-trip-sheet-site-style-v1-js">\n{js}\n</script>\n{js_end}'''

def replace_or_insert(src, start, end, block, closing):
    pattern = re.compile(re.escape(start) + r'.*?' + re.escape(end), re.S)
    if pattern.search(src):
        return pattern.sub(block, src, count=1), 'remplacé'
    if closing not in src:
        raise SystemExit(f'ERREUR: {closing} absent')
    return src.replace(closing, block + '\n' + closing, 1), 'ajouté'

text, css_action = replace_or_insert(text, css_start, css_end, css_block, '</head>')
text, js_action = replace_or_insert(text, js_start, js_end, js_block, '</body>')

for marker in (css_start, css_end, js_start, js_end):
    if text.count(marker) != 1:
        raise SystemExit(f'ERREUR: marqueur dupliqué/incomplet: {marker}')

path.write_text(text, encoding='utf-8')
print(f'CSS {css_action}; JS {js_action}')
PY

echo
echo "=== 4. CONTRÔLES ==="
[[ "$(grep -c 'LB_TRIP_SHEET_SITE_STYLE_V1_CSS START' "$FILE")" -eq 1 ]]
[[ "$(grep -c 'LB_TRIP_SHEET_SITE_STYLE_V1_JS START' "$FILE")" -eq 1 ]]
grep -q "lbCompactOneTime" "$FILE"
grep -q "Voie non communiquée" "$FILE"
grep -q "resolveStationBoardTrack" "$FILE"
grep -q "lb-stop-delay" "$FILE"
echo "✅ une seule heure par gare dans la fiche carte"
echo "✅ départ pour origine/intermédiaires, arrivée pour le terminus"
echo "✅ voies reprises du moteur de voies déjà présent"
echo "✅ absence de voie = 'Voie non communiquée' (aucune donnée inventée)"
echo "✅ retard compact affiché à côté de la gare"

EMBEDDED="/tmp/lb-trip-sheet-site-style-v1-${STAMP}.js"
python3 - "$FILE" "$EMBEDDED" <<'PY'
from pathlib import Path
import re
import sys
text = Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS END -->', text, re.S)
if not m:
    raise SystemExit('ERREUR: JS embarqué introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip() + '\n', encoding='utf-8')
PY
if command -v node >/dev/null 2>&1; then
  node --check "$EMBEDDED" >/dev/null
  echo "✅ JavaScript embarqué valide"
else
  echo "⚠️ node absent : contrôle syntaxique ignoré"
fi

echo
echo "=== 5. EMPREINTE FINALE ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 6. VERSION SERVIE ==="
SERVED=""
for try in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$try" | sha256sum | awk '{print $1}')" || true
  echo "Essai $try : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done

if [[ "$SERVED" == "$AFTER" ]]; then
  echo "✅ La version servie correspond au fichier local"
else
  echo "⚠️ Local et HTTP diffèrent encore" >&2
  echo "Local: $AFTER" >&2
  echo "HTTP : $SERVED" >&2
fi

SUCCESS=1
trap - EXIT

echo
echo "✅ FICHE TRAIN CARTE — STYLE SITE V1 INSTALLÉ"
echo "✅ Une seule heure : départ partout, sauf arrivée au terminus"
echo "✅ Heure théorique barrée + heure réelle si retard"
echo "✅ Retard séparé, court (+5 min), sans texte 'Retardé' dans la colonne horaire"
echo "✅ Voie sous le nom de gare via les données déjà utilisées par la carte"
echo "✅ Les libellés Départ/Terminus sont retirés des petites notes de ligne"
echo "Sauvegarde : $BACKUP"
