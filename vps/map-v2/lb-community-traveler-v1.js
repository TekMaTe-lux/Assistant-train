'use strict';

/* La Bétaillère — couche voyageurs facultative pour la carte V2. */
(() => {
  if (window.__LB_COMMUNITY_TRAVELER_MAP_V1__) return;
  window.__LB_COMMUNITY_TRAVELER_MAP_V1__ = true;

  const PREF_KEY = 'lb_map_traveler_layer_v1';
  const snapshot = { generatedAt:0, trains:{} };
  let travelerLayerEnabled = true;

  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === '0' || saved === '1') travelerLayerEnabled = saved === '1';
  } catch(_) {}

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  }[char]));

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  function trainNumberFromData(train){
    return normalizeTrain(
      train?.numberDigits || train?.numberKey || train?.numberRaw || train?.number || train?.headsign || train?.id
    );
  }

  function communityForTrain(trainNumber){
    if (!travelerLayerEnabled) return null;
    const key = normalizeTrain(trainNumber);
    const item = key ? snapshot.trains?.[key] : null;
    if (!item) return null;
    const presenceCount = Math.max(0, Math.round(Number(item.presenceCount) || 0));
    const delayMin = Number(item.travelerDelayMin);
    if (!presenceCount && !(delayMin > 0)) return null;
    return {
      presenceCount,
      delayMin:delayMin > 0 ? Math.round(delayMin) : null,
      delayReports:Math.max(0, Math.round(Number(item.delayReports) || 0)),
      lastReportAt:Number(item.lastReportAt || 0),
      travelerStops:item.travelerStops && typeof item.travelerStops === 'object' ? item.travelerStops : {},
      isCurrentUserAboard:!!item.isCurrentUserAboard
    };
  }

  function badgeText(item){
    if (!item) return '';
    const presence = item.presenceCount > 0 ? ` (${item.presenceCount})` : '';
    const delay = item.delayMin > 0 ? ` +${item.delayMin} min` : '';
    return `🐮${presence}${delay}`;
  }

  function markerCommunityHtml(train){
    const item = communityForTrain(trainNumberFromData(train));
    if (!item) return '';
    const presence = item.presenceCount > 0
      ? `<span class="lb-map-traveler-presence" title="${item.presenceCount} voyageur${item.presenceCount > 1 ? 's' : ''} déclaré${item.presenceCount > 1 ? 's' : ''} à bord" aria-label="${item.presenceCount} voyageur${item.presenceCount > 1 ? 's' : ''} déclaré${item.presenceCount > 1 ? 's' : ''} à bord">🐮 ${item.presenceCount}</span>`
      : '';
    const delay = item.delayMin > 0
      ? `<span class="lb-map-traveler-delay" title="Retard annoncé par les voyageurs : +${item.delayMin} min" aria-label="Retard voyageurs plus ${item.delayMin} minutes">(🐮 +${item.delayMin})</span>`
      : '';
    return presence + delay;
  }

  function appendBadge(html, train){
    const raw = String(html || '').replace(/<span[^>]*\blb-map-traveler-(?:badge|presence|delay)\b[^>]*>.*?<\/span>/g, '');
    const community = markerCommunityHtml(train);
    return community ? raw.replace(/<\/button>\s*$/, `${community}</button>`) : raw;
  }

  function installFunctionHooks(){
    if (typeof iconForTrain === 'function' && !iconForTrain.__lbTravelerWrapped){
      const originalIconForTrain = iconForTrain;
      const wrapped = function(train){
        const icon = originalIconForTrain(train);
        if (icon?.options) icon.options.html = appendBadge(icon.options.html, train);
        return icon;
      };
      wrapped.__lbTravelerWrapped = true;
      iconForTrain = wrapped;
    }

    if (typeof trainIconSignature === 'function' && !trainIconSignature.__lbTravelerWrapped){
      const originalSignature = trainIconSignature;
      const wrapped = function(train){
        const item = communityForTrain(trainNumberFromData(train));
        return `${originalSignature(train)}|traveler:${badgeText(item)}:${travelerLayerEnabled ? 1 : 0}`;
      };
      wrapped.__lbTravelerWrapped = true;
      trainIconSignature = wrapped;
    }

    if (typeof renderTripPanel === 'function' && !renderTripPanel.__lbTravelerWrapped){
      const originalRenderTripPanel = renderTripPanel;
      const wrapped = function(...args){
        const result = originalRenderTripPanel.apply(this, args);
        queueMicrotask(renderTripCommunityBlock);
        return result;
      };
      wrapped.__lbTravelerWrapped = true;
      renderTripPanel = wrapped;
    }
  }

  function refreshMarkerBadges(){
    document.querySelectorAll('.cow-marker').forEach((marker) => {
      marker.querySelectorAll('.lb-map-traveler-badge,.lb-map-traveler-presence,.lb-map-traveler-delay').forEach((badge) => badge.remove());
      if (!travelerLayerEnabled) return;
      const number = normalizeTrain(marker.getAttribute('data-train-number') || marker.textContent);
      const item = communityForTrain(number);
      if (!item) return;
      if (item.presenceCount > 0){
        const presence = document.createElement('span');
        presence.className = 'lb-map-traveler-presence';
        presence.textContent = `🐮 ${item.presenceCount}`;
        presence.title = `${item.presenceCount} voyageur(s) déclaré(s) à bord`;
        marker.appendChild(presence);
      }
      if (item.delayMin > 0){
        const delay = document.createElement('span');
        delay.className = 'lb-map-traveler-delay';
        delay.textContent = `(🐮 +${item.delayMin})`;
        delay.title = `Retard annoncé par les voyageurs : +${item.delayMin} min`;
        marker.appendChild(delay);
      }
    });
    renderTripCommunityBlock();
  }

  function currentTripNumber(){
    try {
      const train = typeof activeTripId !== 'undefined' && activeTripId
        ? (trainDataById.get(activeTripId) || buildStaticPanelTrainData(activeTripId))
        : null;
      return trainNumberFromData(train);
    } catch(_) {
      return normalizeTrain(document.querySelector('#trip-panel-train')?.textContent);
    }
  }

  function postToSite(payload){
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
    } catch(_) {}
  }

  function renderTripCommunityBlock(){
    const panel = document.getElementById('trip-panel');
    const summary = document.getElementById('trip-panel-summary');
    if (!panel || !summary || panel.classList.contains('station-board-mode')) return;
    let block = document.getElementById('lb-map-trip-community');
    if (!block){
      block = document.createElement('section');
      block.id = 'lb-map-trip-community';
      block.className = 'lb-map-trip-community';
      summary.insertAdjacentElement('afterend', block);
    }
    const number = currentTripNumber();
    if (!number || !travelerLayerEnabled){
      block.hidden = true;
      return;
    }
    const item = communityForTrain(number);
    const label = badgeText(item);
    block.hidden = false;
    block.dataset.trainNumber = number;
    block.innerHTML = `
      <button type="button" class="lb-map-trip-community-summary" data-lb-map-community-signal="${esc(number)}">
        <span class="lb-map-trip-community-title">🐮 Voix du Bétail</span>
        <strong>${esc(label || 'Aucun signalement')}</strong>
      </button>
      <div class="lb-map-trip-community-actions">
        <button type="button" data-lb-map-community-presence="${esc(number)}">${item?.isCurrentUserAboard ? 'À bord ✓' : 'Je suis à bord'}</button>
        <button type="button" data-lb-map-community-signal="${esc(number)}">⚠ Signaler</button>
      </div>`;
    renderTravelerStopDelays(number);
  }

  function renderTravelerStopDelays(trainNumber = currentTripNumber()){
    const stops = document.getElementById('trip-stops');
    if (!stops) return;
    stops.querySelectorAll('.lb-stop-traveler-delay-right').forEach((label) => label.remove());
    const item = communityForTrain(trainNumber);
    const travelerStops = item?.travelerStops || {};
    if (!travelerLayerEnabled || !Object.keys(travelerStops).length) return;
    stops.querySelectorAll(':scope > .trip-stop').forEach((row) => {
      const stopKey = normalizeStop(row.querySelector('.stop-name')?.textContent);
      const report = stopKey ? travelerStops[stopKey] : null;
      const delay = Math.round(Number(report?.delayMin) || 0);
      if (!(delay > 0)) return;
      const label = document.createElement('div');
      label.className = 'lb-stop-traveler-delay-right';
      label.textContent = `(🐮 +${delay} min)`;
      label.title = `${Math.max(1, Math.round(Number(report?.reports) || 1))} signalement(s) de La Voix du Bétail à ${report?.station || row.querySelector('.stop-name')?.textContent || 'cet arrêt'}`;
      row.appendChild(label);
    });
  }

  function installControlsToggle(){
    if (document.getElementById('toggle-travelers')) return;
    const grid = document.querySelector('#display-trains-title + .map-choice-row + .map-toggle-grid')
      || document.querySelector('#controls-panel .map-toggle-grid');
    if (!grid) return;
    const label = document.createElement('label');
    label.className = 'map-toggle';
    label.innerHTML = `<input id="toggle-travelers" type="checkbox"${travelerLayerEnabled ? ' checked' : ''}><span>🐮 Voyageurs</span>`;
    grid.appendChild(label);
    label.querySelector('input').addEventListener('change', (event) => {
      travelerLayerEnabled = !!event.target.checked;
      try { localStorage.setItem(PREF_KEY, travelerLayerEnabled ? '1' : '0'); } catch(_) {}
      document.documentElement.classList.toggle('lb-travelers-layer-off', !travelerLayerEnabled);
      refreshMarkerBadges();
    });
  }

  function installStyle(){
    if (document.getElementById('lb-community-traveler-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-traveler-v1-style';
    style.textContent = `
      .cow-marker{position:relative!important}
      .lb-map-traveler-presence{position:absolute;z-index:7;right:calc(100% + 2px);top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;min-height:12px;padding:1px 3px;border:0;border-radius:3px;background:rgba(3,18,31,.84);color:#dffcff;font-size:7.5px;font-weight:850;line-height:1;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none}
      .lb-map-traveler-delay{display:inline-flex;align-items:center;justify-content:center;min-height:12px;margin-left:2px;padding:0 2px;border:0;background:transparent;color:#75eefa;font-size:7.5px;font-weight:850;line-height:1;white-space:nowrap;text-shadow:none;pointer-events:none}
      html.ber-arrow-z-far .lb-map-traveler-presence,html.ber-arrow-z-wide .lb-map-traveler-presence,html.ber-arrow-z-far .lb-map-traveler-delay,html.ber-arrow-z-wide .lb-map-traveler-delay,html.lb-travelers-layer-off .lb-map-traveler-presence,html.lb-travelers-layer-off .lb-map-traveler-delay{display:none!important}
      .cow-marker.train-selected .lb-map-traveler-presence,.cow-marker.ber-focus-current .lb-map-traveler-presence,.cow-marker.train-selected .lb-map-traveler-delay,.cow-marker.ber-focus-current .lb-map-traveler-delay{display:inline-flex!important}
      .lb-map-trip-community{display:flex;align-items:stretch;gap:6px;padding:6px;border:1px solid rgba(0,234,255,.22);border-radius:10px;background:rgba(4,24,40,.74)}
      .lb-map-trip-community[hidden]{display:none!important}
      .lb-map-trip-community-summary{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;padding:2px 5px;border:0;background:transparent;color:#eefcff;cursor:pointer;text-align:left}
      .lb-map-trip-community-title{color:#8ef8ff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.035em}
      .lb-map-trip-community-summary strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .lb-map-trip-community-actions{display:flex;gap:5px;align-items:center}
      .lb-map-trip-community-actions button{min-height:30px;padding:5px 7px;border:1px solid rgba(0,234,255,.3);border-radius:8px;background:rgba(5,31,51,.95);color:#eefcff;font-size:9px;font-weight:800;cursor:pointer;white-space:nowrap}
      .lb-map-trip-community-actions button:hover,.lb-map-trip-community-actions button:focus-visible{border-color:#8ef8ff;color:#fff}
      .trip-stop .lb-stop-traveler-delay-right{position:absolute;z-index:2;right:8px;top:16px;color:#75eefa;font-size:7.5px;font-weight:850;line-height:1;white-space:nowrap;text-align:right;text-shadow:none}
      @media(max-width:520px){.lb-map-trip-community{gap:4px;padding:5px}.lb-map-trip-community-actions button{padding:5px 6px}.lb-map-trip-community-title{font-size:8px}.lb-map-trip-community-summary strong{font-size:10px}.trip-stop .lb-stop-traveler-delay-right{right:6px;top:15px;font-size:7px}}
    `;
    document.head.appendChild(style);
    document.documentElement.classList.toggle('lb-travelers-layer-off', !travelerLayerEnabled);
  }

  function parisSecondsNow(){
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone:'Europe/Paris', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date());
    const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return value('hour') * 3600 + value('minute') * 60 + value('second');
  }

  function closestClockToSchedule(nowSeconds, scheduledSeconds){
    return [nowSeconds - 86400, nowSeconds, nowSeconds + 86400]
      .sort((a,b) => Math.abs(a - scheduledSeconds) - Math.abs(b - scheduledSeconds))[0];
  }

  function projectOnSegment(point, a, b){
    const lat0 = point.lat * Math.PI / 180;
    const sx = 111320 * Math.cos(lat0);
    const sy = 110540;
    const ax = (a.lon - point.lon) * sx;
    const ay = (a.lat - point.lat) * sy;
    const bx = (b.lon - point.lon) * sx;
    const by = (b.lat - point.lat) * sy;
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const ratio = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
    const px = ax + ratio * dx;
    const py = ay + ratio * dy;
    return { ratio, distance:Math.hypot(px, py), segmentLength:Math.sqrt(length2) };
  }

  function estimateGpsDelay(data){
    const trainNumber = normalizeTrain(data?.trainNumber);
    if (!trainNumber) throw new Error('Train non reconnu.');
    if (Number(data?.accuracy || 0) > 2000) throw new Error('Précision GPS insuffisante. Réessayez près d\'une fenêtre.');

    let train = null;
    let trainId = '';
    for (const [id, candidate] of trainDataById.entries()){
      if (trainNumberFromData(candidate) === trainNumber){ train = candidate; trainId = id; break; }
    }
    if (!train) throw new Error('Ce train n\'est plus visible sur la carte.');
    const routeTripId = typeof tripIdForSelectedRoute === 'function' ? (tripIdForSelectedRoute(trainId) || trainId) : trainId;
    const seq = stopTimesByTrip.get(routeTripId) || stopTimesByTrip.get(trainId) || [];
    if (seq.length < 2) throw new Error('Horaires statiques insuffisants pour ce train.');

    const point = { lat:Number(data.latitude), lon:Number(data.longitude) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) throw new Error('Position GPS invalide.');
    const candidates = [];

    for (let index = 0; index < seq.length - 1; index += 1){
      const fromStop = stopsById.get(seq[index]?.stop_id);
      const toStop = stopsById.get(seq[index + 1]?.stop_id);
      if (!fromStop || !toStop) continue;
      const path = pathBetweenStops(fromStop, toStop);
      const coords = Array.isArray(path?.coords) ? path.coords : [];
      if (coords.length < 2) continue;
      const cumulative = Array.isArray(path?.cumDistances) && path.cumDistances.length === coords.length
        ? path.cumDistances
        : (()=>{
            const out = [0];
            for (let i=1;i<coords.length;i++) out.push(out[i-1] + distLL({lat:coords[i-1][0],lon:coords[i-1][1]}, {lat:coords[i][0],lon:coords[i][1]}));
            return out;
          })();
      const total = Number(path?.totalDist) > 0 ? Number(path.totalDist) : cumulative[cumulative.length - 1];
      if (!(total > 0)) continue;

      for (let segment = 0; segment < coords.length - 1; segment += 1){
        const a = { lat:Number(coords[segment][0]), lon:Number(coords[segment][1]) };
        const b = { lat:Number(coords[segment + 1][0]), lon:Number(coords[segment + 1][1]) };
        if (![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite)) continue;
        const projection = projectOnSegment(point, a, b);
        const along = Number(cumulative[segment] || 0) + projection.ratio * projection.segmentLength;
        const routeRatio = Math.max(0, Math.min(1, along / total));
        const start = Number(seq[index]?.departure ?? seq[index]?.arrival);
        let end = Number(seq[index + 1]?.arrival ?? seq[index + 1]?.departure);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        while (end < start) end += 86400;
        const scheduled = start + (end - start) * routeRatio;
        candidates.push({
          distance:projection.distance,
          scheduled,
          station:String(toStop.name || ''),
          segmentIndex:index
        });
      }
    }
    if (!candidates.length) throw new Error('Parcours ferroviaire indisponible pour ce calcul.');
    candidates.sort((a,b)=> a.distance - b.distance);
    const closestDistance = candidates[0].distance;
    const accuracy = Math.max(0, Number(data.accuracy || 0));
    const allowedDistance = Math.min(2500, Math.max(900, accuracy * 2.5));
    if (closestDistance > allowedDistance) throw new Error('Votre position est trop éloignée du parcours de ce train.');

    const near = candidates.filter((item)=> item.distance <= closestDistance + 80);
    const now = parisSecondsNow();
    near.forEach((item)=> { item.clock = closestClockToSchedule(now, item.scheduled); });
    near.sort((a,b)=> Math.abs(a.clock - a.scheduled) - Math.abs(b.clock - b.scheduled));
    const best = near[0];
    const rawDelay = (best.clock - best.scheduled) / 60;
    if (!Number.isFinite(rawDelay) || rawDelay < -8 || rawDelay > 240) {
      throw new Error('La position ne correspond pas à l\'horaire actuel de ce train.');
    }
    return {
      trainNumber,
      delayMin:Math.max(0, Math.round(rawDelay)),
      station:best.station,
      accuracy,
      railDistance:Math.round(closestDistance)
    };
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (window.parent !== window && event.source !== window.parent) return;
    if (data.type === 'lb:community:snapshot') {
      snapshot.generatedAt = Number(data.generatedAt || Date.now());
      snapshot.trains = data.trains && typeof data.trains === 'object' ? data.trains : {};
      refreshMarkerBadges();
      return;
    }
    if (data.type === 'lb:community:gps-position') {
      try {
        const estimate = estimateGpsDelay(data);
        postToSite({ type:'lb:community:gps-delay-result', ok:true, ...estimate });
      } catch(error) {
        postToSite({
          type:'lb:community:gps-delay-result',
          ok:false,
          trainNumber:normalizeTrain(data.trainNumber),
          message:`${error?.message || 'Estimation GPS impossible'} Saisissez le retard manuellement.`
        });
      }
    }
  });

  document.addEventListener('click', (event) => {
    const signal = event.target?.closest?.('[data-lb-map-community-signal]');
    if (signal){
      event.preventDefault();
      event.stopPropagation();
      postToSite({ type:'lb:community:open-signal', trainNumber:signal.getAttribute('data-lb-map-community-signal') });
      return;
    }
    const presence = event.target?.closest?.('[data-lb-map-community-presence]');
    if (presence){
      event.preventDefault();
      event.stopPropagation();
      postToSite({ type:'lb:community:toggle-presence', trainNumber:presence.getAttribute('data-lb-map-community-presence') });
    }
  }, true);

  function start(){
    installStyle();
    installControlsToggle();
    installFunctionHooks();
    refreshMarkerBadges();
    postToSite({ type:'lb:community:request' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
