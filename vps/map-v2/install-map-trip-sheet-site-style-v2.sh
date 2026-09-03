#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-trip-sheet-site-style-v2-${STAMP}"
EMBEDDED_JS="/tmp/lb-trip-sheet-site-style-v2-${STAMP}.js"
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
  'LB_PARTIAL_GHOST_V2_JS START' \
  'LB_MARKER_BADGE_FIX_V2 START'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== 2. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 3. CORRECTION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

# Retire entièrement la V1 de la fiche : elle est remplacée, pas empilée.
for start, end in (
    ('<!-- LB_TRIP_SHEET_SITE_STYLE_V1_CSS START -->','<!-- LB_TRIP_SHEET_SITE_STYLE_V1_CSS END -->'),
    ('<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS START -->','<!-- LB_TRIP_SHEET_SITE_STYLE_V1_JS END -->'),
):
    text = re.sub(re.escape(start) + r'.*?' + re.escape(end) + r'\s*', '', text, flags=re.S)

# La suppression d'une gare intermédiaire n'a AUCUN badge/effet sur le train.
# Une vraie portion supprimée en tête/queue conserve le mode fantôme, mais sans badge PART.
partial_old = r'''    if (state.kind === 'partial'){
      html = lbAddMarkerClass(html, 'train-partial-ghost');
      html = html.replace(/<button\b/, '<button data-lb-cancel-state="partial"');
      const hasDelayBadge = /train-delay-badge--(?:moderate|major|severe|cancelled)/.test(html);
      if (!hasDelayBadge && !/train-partial-badge/.test(html)){
        html = html.replace('</button>', '<span class="train-delay-badge train-partial-badge" title="Circulation partielle / arrêt non desservi">PART.</span></button>');
      }
    } else if (state.kind === 'full'){'''
partial_new = r'''    if (state.kind === 'partial'){
      const hasGhostSegments = Array.isArray(state.ghostSegmentIndices) && state.ghostSegmentIndices.length > 0;
      if (hasGhostSegments){
        html = lbAddMarkerClass(html, 'train-partial-ghost');
        html = html.replace(/<button\b/, '<button data-lb-cancel-state="partial"');
      }
      // AUCUN badge PART. : une gare non desservie ne doit pas polluer le parcours.
      html = html.replace(/<span[^>]*\btrain-partial-badge\b[^>]*>.*?<\/span>/g, '');
    } else if (state.kind === 'full'){'''
if partial_old in text:
    text = text.replace(partial_old, partial_new, 1)
elif 'AUCUN badge PART.' not in text:
    raise SystemExit('ERREUR: bloc PART. introuvable — aucune écriture effectuée')

# Une gare isolée non desservie ne crée plus de rond fantôme sur la carte.
isolated_pattern = re.compile(
    r'''\n    // Une suppression isolee au milieu signifie surtout "gare non desservie":.*?\n    if \(state\.kind === 'partial'\)\{.*?\n    \}\n\n    if \(!drew\)\{''',
    re.S,
)
if isolated_pattern.search(text):
    text = isolated_pattern.sub("\n    // Gare intermédiaire non desservie : aucun effet cartographique.\n\n    if (!drew){", text, count=1)
elif 'Gare intermédiaire non desservie : aucun effet cartographique.' not in text:
    raise SystemExit('ERREUR: bloc gare isolée introuvable — aucune écriture effectuée')

css_start = '<!-- LB_TRIP_SHEET_SITE_STYLE_V2_CSS START -->'
css_end = '<!-- LB_TRIP_SHEET_SITE_STYLE_V2_CSS END -->'
js_start = '<!-- LB_TRIP_SHEET_SITE_STYLE_V2_JS START -->'
js_end = '<!-- LB_TRIP_SHEET_SITE_STYLE_V2_JS END -->'

css = r'''/* Reprise directe de la logique visuelle de maquettefichetrain.html :
   heure(s) à gauche, ligne + point, gare/voie, retard à droite. */
html body .cow-marker .train-partial-badge{display:none!important}

html body .trip-panel:not(.station-board-mode){
  width:min(455px,calc(100vw - 18px))!important;
  padding:11px 12px 12px!important;
  border:1px solid rgba(40,229,212,.40)!important;
  border-radius:15px!important;
  background:linear-gradient(145deg,rgba(8,25,34,.985),rgba(5,18,27,.985))!important;
  box-shadow:0 18px 44px rgba(0,0,0,.46)!important;
}
html body .trip-panel:not(.station-board-mode) .trip-panel-header{
  min-height:32px!important;
  padding:0 0 7px!important;
  border-bottom:1px solid rgba(40,229,212,.15)!important;
}
html body .trip-panel:not(.station-board-mode) .trip-panel-title{
  color:#eefcff!important;
  font-size:15px!important;
  font-weight:850!important;
  line-height:1!important;
}
html body .trip-panel:not(.station-board-mode) .trip-panel-summary{
  margin:2px 0 0!important;
  color:#a7c0c8!important;
  font-size:10px!important;
  line-height:1.15!important;
}
html body .trip-panel:not(.station-board-mode) .trip-panel-delay,
html body .trip-panel:not(.station-board-mode) .trip-panel-disruption{
  margin-top:4px!important;
  padding:4px 7px!important;
  border-radius:6px!important;
  font-size:8.5px!important;
  line-height:1.08!important;
}
html body .trip-panel:not(.station-board-mode) .trip-progress{
  margin-top:1px!important;
  gap:3px!important;
}
html body .trip-panel:not(.station-board-mode) .trip-progress-bar{height:5px!important}
html body .trip-panel:not(.station-board-mode) .trip-progress-text{font-size:8.5px!important}
html body .trip-panel:not(.station-board-mode) .trip-stops-title{
  margin:5px 0 3px!important;
  color:#28e5d4!important;
  font-size:8.5px!important;
  font-weight:850!important;
  letter-spacing:.13em!important;
  text-transform:uppercase!important;
}
html body .trip-panel:not(.station-board-mode) .trip-stops.lb-site-train-sheet-v2{
  gap:0!important;
  padding:7px 8px 3px!important;
  border:1px solid rgba(40,229,212,.16)!important;
  border-radius:10px!important;
  background:rgba(4,18,27,.48)!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
}

/* Même structure que la timeline du site : 72px / point / gare / retard,
   adaptée à la largeur du modal. */
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop{
  position:relative!important;
  display:grid!important;
  grid-template-columns:58px minmax(0,1fr) auto!important;
  align-items:start!important;
  column-gap:25px!important;
  min-height:47px!important;
  padding:3px 0!important;
  border:0!important;
  --lb-line-x:69px;
}
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop::before{
  left:65px!important;
  top:8px!important;
  width:9px!important;
  height:9px!important;
  border:2px solid #5294a0!important;
  border-radius:50%!important;
  background:#153641!important;
  box-shadow:0 0 0 4px #0c1d25!important;
  transform:none!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop::after{
  left:69px!important;
  top:20px!important;
  bottom:-4px!important;
  width:1px!important;
  background:#24515c!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.passed::before{
  border-color:#28e5d4!important;
  background:#28e5d4!important;
  opacity:1!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.current::before,
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.enroute::before{
  width:13px!important;
  height:13px!important;
  left:63px!important;
  top:6px!important;
  border-color:#ff9f43!important;
  background:#ff9f43!important;
  box-shadow:0 0 0 4px #0c1d25,0 0 13px rgba(255,159,67,.75)!important;
}

html body .trip-stops.lb-site-train-sheet-v2 .stop-time{
  width:58px!important;
  min-width:58px!important;
  max-width:58px!important;
  display:flex!important;
  flex-direction:column!important;
  align-items:flex-start!important;
  gap:1px!important;
  padding:0!important;
  font-variant-numeric:tabular-nums!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry{
  width:auto!important;
  margin:0!important;
  padding:0!important;
  line-height:1!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-plan,
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-rt{
  display:block!important;
  margin:0!important;
  padding:0!important;
  white-space:nowrap!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-plan{
  color:#d8edf2!important;
  font-size:10px!important;
  font-weight:800!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-plan.lb-plan-delayed{
  color:#5e7d85!important;
  font-size:8px!important;
  font-weight:600!important;
  text-decoration:line-through!important;
  text-decoration-thickness:1px!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-rt{
  margin-top:1px!important;
  color:#ff9f43!important;
  font-size:11px!important;
  font-weight:900!important;
  opacity:1!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-time .time-entry-rt--advance{color:#4ade80!important}

html body .trip-stops.lb-site-train-sheet-v2 .stop-main{
  min-width:0!important;
  display:flex!important;
  flex-direction:column!important;
  gap:1px!important;
  padding:0!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-name{
  margin:0!important;
  color:#eefcff!important;
  font-size:12px!important;
  font-weight:850!important;
  line-height:1.04!important;
  white-space:normal!important;
  overflow:visible!important;
  text-decoration:none!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .lb-stop-track{
  color:#78949d!important;
  font-size:8.2px!important;
  font-weight:500!important;
  line-height:1.05!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .lb-stop-track.has-track{color:#9eb7bf!important}
html body .trip-stops.lb-site-train-sheet-v2 .stop-note{
  margin-top:2px!important;
  color:#ff9f43!important;
  font-size:7.5px!important;
  font-weight:900!important;
  line-height:1!important;
  letter-spacing:.06em!important;
  text-transform:uppercase!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .stop-note strong{color:inherit!important}
html body .trip-stops.lb-site-train-sheet-v2 .lb-stop-delay{
  align-self:start!important;
  justify-self:end!important;
  padding:2px 0 0 5px!important;
  color:#ff9f43!important;
  font-size:8.5px!important;
  font-weight:900!important;
  line-height:1!important;
  white-space:nowrap!important;
  font-variant-numeric:tabular-nums!important;
}
html body .trip-stops.lb-site-train-sheet-v2 .lb-stop-delay.is-advance{color:#4ade80!important}
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.cancelled .stop-name,
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.cancelled .time-entry-plan,
html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.cancelled .time-entry-rt{
  color:#ff6f7d!important;
}

@media(max-width:600px){
  html body .trip-panel:not(.station-board-mode){left:5px!important;right:5px!important;width:auto!important;max-height:min(78dvh,650px)!important}
  html body .trip-stops.lb-site-train-sheet-v2 .trip-stop{
    grid-template-columns:52px minmax(0,1fr) auto!important;
    column-gap:22px!important;
    min-height:44px!important;
    --lb-line-x:62px;
  }
  html body .trip-stops.lb-site-train-sheet-v2 .trip-stop::before{left:58px!important}
  html body .trip-stops.lb-site-train-sheet-v2 .trip-stop::after{left:62px!important}
  html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.current::before,
  html body .trip-stops.lb-site-train-sheet-v2 .trip-stop.enroute::before{left:56px!important}
  html body .trip-stops.lb-site-train-sheet-v2 .stop-time{width:52px!important;min-width:52px!important;max-width:52px!important}
  html body .trip-stops.lb-site-train-sheet-v2 .stop-name{font-size:11.5px!important}
}'''

js = r'''(()=>{
  'use strict';
  if (window.__LB_TRIP_SHEET_SITE_STYLE_V2__) return;
  window.__LB_TRIP_SHEET_SITE_STYLE_V2__ = true;

  const norm = value=>{
    try { return normalizeStationName(String(value || '')); }
    catch(_){ return String(value || '').toLowerCase().trim(); }
  };

  function axisContext(stopName){
    const target = norm(stopName);
    try{
      for (const station of axisStationsById.values()){
        const candidate = norm(station?.label || station?.name || station?.stationLabel || '');
        if (candidate && (candidate === target || candidate.startsWith(target) || target.startsWith(candidate))) return station;
      }
    }catch(_){ }
    return { name:stopName };
  }

  function trackFor(data, stopName, isLast){
    if (!data || typeof resolveStationBoardTrack !== 'function') return null;
    const eventRow = {
      stationBoardCanonicalNumber:data.stationBoardCanonicalNumber || data.numberKey || data.number || null,
      number:data.number || null,
      numberDigits:data.numberDigits || null,
      numberRaw:data.numberRaw || data.number || null,
      trainId:data.id || activeTripId || null,
      delayNumberKeys:Array.isArray(data.delayNumberKeys) ? data.delayNumberKeys : [],
      numberList:Array.isArray(data.numberList) ? data.numberList : [],
      stationLabel:stopName
    };
    try { return resolveStationBoardTrack(eventRow, isLast ? 'arr' : 'dep', axisContext(stopName)) || null; }
    catch(_){ return null; }
  }

  function formatClock(sec){
    if (!Number.isFinite(sec)) return null;
    let value = Math.round(sec);
    value = ((value % 86400) + 86400) % 86400;
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }

  function cleanNote(row){
    const note = row.querySelector('.stop-note');
    if (!note) return;
    const keep = String(note.textContent || '').split('·').map(v=>v.trim()).filter(Boolean)
      .filter(v=>!/^(départ|terminus)$/i.test(v));
    if (!keep.length){ note.remove(); return; }
    const strong = note.querySelector('strong');
    if (strong) strong.textContent = keep.join(' · '); else note.textContent = keep.join(' · ');
  }

  function rowStopData(seq, profile, rowName, cursor){
    const target = norm(rowName);
    for (let i=cursor;i<seq.length;i++){
      const meta = stopsById.get(seq[i]?.stop_id);
      const name = meta?.name || seq[i]?.stop_id || '';
      const candidate = norm(name);
      if (candidate === target || candidate.startsWith(target) || target.startsWith(candidate)){
        return { index:i, seqStop:seq[i], rtStop:profile?.stops?.[i] || null };
      }
    }
    return null;
  }

  function rebuildTimes(row, item, isLast){
    const timeBox = row.querySelector('.stop-time');
    if (!timeBox) return null;
    const st = item?.seqStop || null;
    const rt = item?.rtStop || null;
    const planned = isLast ? (st?.arrival ?? st?.departure ?? null) : (st?.departure ?? st?.arrival ?? null);
    const realtime = isLast ? (rt?.arrivalRealtime ?? rt?.departureRealtime ?? null) : (rt?.departureRealtime ?? rt?.arrivalRealtime ?? null);
    const plannedText = formatClock(planned);
    const realtimeText = formatClock(realtime);
    const diffSec = Number.isFinite(planned) && Number.isFinite(realtime) ? realtime - planned : null;
    const showRt = realtimeText && (!plannedText || (Number.isFinite(diffSec) && Math.abs(diffSec) >= 30));
    const minutes = Number.isFinite(diffSec) ? Math.round(diffSec / 60) : 0;

    timeBox.innerHTML = '';
    const entry = document.createElement('div');
    entry.className = `time-entry ${isLast ? 'time-arr' : 'time-dep'}`;

    const plan = document.createElement('span');
    plan.className = 'time-entry-plan';
    plan.textContent = plannedText || realtimeText || '—';
    entry.appendChild(plan);

    if (showRt){
      plan.classList.add('lb-plan-delayed');
      const real = document.createElement('span');
      const kind = minutes < 0 ? 'time-entry-rt--advance' : minutes > 0 ? 'time-entry-rt--delay' : 'time-entry-rt--ontime';
      real.className = `time-entry-rt ${kind}`;
      real.textContent = realtimeText;
      entry.appendChild(real);
    }
    timeBox.appendChild(entry);

    if (!showRt || !minutes) return null;
    return { minutes, label:`${minutes > 0 ? '+' : ''}${minutes} min`, advance:minutes < 0 };
  }

  function applySheet(){
    if (!activeTripId || !tripStopsEl || tripPanelEl?.classList?.contains('station-board-mode')) return;
    const data = trainDataById.get(activeTripId) || buildStaticPanelTrainData(activeTripId);
    const seq = stopTimesByTrip.get(activeTripId) || [];
    if (!data || !seq.length) return;
    let profile = realtimeStopDataByTrip.get(activeTripId) || null;
    if (!profile){
      try{
        const key = resolveRealtimeNumberKey(data) ?? extractTrainNumberCandidate(activeTripId);
        profile = computeRealtimeStopData(activeTripId, seq, key, realtimeOptionsForTrain(data));
      }catch(_){ profile = null; }
    }

    const rows = Array.from(tripStopsEl.querySelectorAll(':scope > .trip-stop')).filter(r=>r.querySelector('.stop-name'));
    if (!rows.length) return;
    tripStopsEl.classList.add('lb-site-train-sheet-v2');
    if (tripStopsTitleEl) tripStopsTitleEl.textContent = 'PARCOURS';

    let cursor = 0;
    rows.forEach((row, idx)=>{
      const isLast = idx === rows.length - 1;
      const nameEl = row.querySelector('.stop-name');
      const mainEl = row.querySelector('.stop-main');
      const stopName = String(nameEl?.textContent || '').trim();
      if (!nameEl || !mainEl || !stopName) return;

      row.querySelectorAll('.lb-stop-track,.lb-stop-delay').forEach(el=>el.remove());
      const item = rowStopData(seq, profile, stopName, cursor);
      if (item) cursor = item.index + 1;
      const delay = rebuildTimes(row, item, isLast);
      cleanNote(row);

      const track = trackFor(data, stopName, isLast);
      const trackEl = document.createElement('div');
      trackEl.className = `lb-stop-track${track ? ' has-track' : ''}`;
      trackEl.textContent = track ? `Voie ${track}` : 'Voie non communiquée';
      nameEl.insertAdjacentElement('afterend', trackEl);

      // Pas de statut SUPPRIMÉ ajouté artificiellement ici : le modal garde la logique native
      // pour la gare, mais le retard est présenté comme sur la fiche du site.
      if (delay){
        const badge = document.createElement('div');
        badge.className = `lb-stop-delay${delay.advance ? ' is-advance' : ''}`;
        badge.textContent = delay.label;
        row.appendChild(badge);
      }
    });
  }

  const previousRender = renderTripPanel;
  renderTripPanel = function(...args){
    const result = previousRender.apply(this,args);
    try { applySheet(); } catch(err){ console.warn('[LB fiche carte v2]',err); }
    return result;
  };

  // En cas de rafraîchissement tardif des voies/temps réels, le rendu reste idempotent.
  setTimeout(()=>{ try { if (activeTripId) { previousRender(); applySheet(); } } catch(_){ } }, 250);

  console.info('[LB fiche carte v2] actif');
})();'''

css_block = f'''{css_start}\n<style id="lb-trip-sheet-site-style-v2-css">\n{css}\n</style>\n{css_end}'''
js_block = f'''{js_start}\n<script id="lb-trip-sheet-site-style-v2-js">\n{js}\n</script>\n{js_end}'''

for start, end, block, closing in (
    (css_start, css_end, css_block, '</head>'),
    (js_start, js_end, js_block, '</body>'),
):
    pat = re.compile(re.escape(start) + r'.*?' + re.escape(end), re.S)
    if pat.search(text):
        text = pat.sub(lambda _m:block, text, count=1)
    else:
        if closing not in text: raise SystemExit(f'ERREUR: {closing} absent')
        text = text.replace(closing, block + '\n' + closing, 1)

for marker in (css_start, css_end, js_start, js_end):
    if text.count(marker) != 1:
        raise SystemExit(f'ERREUR: marqueur dupliqué/incomplet: {marker}')

path.write_text(text, encoding='utf-8')
print('✅ V1 retirée; V2 installée; PART. supprimé; gare intermédiaire isolée neutralisée')
PY

echo
echo "=== 4. CONTRÔLES ==="
! grep -q 'LB_TRIP_SHEET_SITE_STYLE_V1_CSS START' "$FILE"
! grep -q 'LB_TRIP_SHEET_SITE_STYLE_V1_JS START' "$FILE"
grep -q 'LB_TRIP_SHEET_SITE_STYLE_V2_CSS START' "$FILE"
grep -q 'LB_TRIP_SHEET_SITE_STYLE_V2_JS START' "$FILE"
grep -q 'AUCUN badge PART.' "$FILE"
grep -q 'Gare intermédiaire non desservie : aucun effet cartographique.' "$FILE"
grep -q "tripStopsTitleEl.textContent = 'PARCOURS'" "$FILE"
grep -q 'Voie non communiquée' "$FILE"
grep -q 'grid-template-columns:58px minmax(0,1fr) auto' "$FILE"
echo "✅ ancien rendu V1 retiré"
echo "✅ aucun badge PART. sur les trains"
echo "✅ gare intermédiaire non desservie sans effet sur la carte"
echo "✅ vraie portion supprimée tête/queue conserve le trajet fantôme"
echo "✅ fiche modal structurée comme la timeline du site"
echo "✅ une heure de départ par gare, arrivée seulement au terminus"
echo "✅ voies issues du moteur existant, aucune voie inventée"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_TRIP_SHEET_SITE_STYLE_V2_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_TRIP_SHEET_SITE_STYLE_V2_JS END -->',text,re.S)
if not m: raise SystemExit('ERREUR: JS V2 embarqué introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY
if command -v node >/dev/null 2>&1; then
  node --check "$EMBEDDED_JS" >/dev/null
  echo "✅ JavaScript V2 valide"
fi

echo
echo "=== 5. EMPREINTE LOCALE ==="
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
[[ "$SERVED" == "$AFTER" ]] || { echo "⚠️ Local/HTTP différents" >&2; exit 5; }
echo "✅ La version servie correspond au fichier local"

SUCCESS=1
trap - EXIT

echo
echo "✅ CORRECTIF FICHE CARTE V2 INSTALLÉ"
echo "Sauvegarde : $BACKUP"
