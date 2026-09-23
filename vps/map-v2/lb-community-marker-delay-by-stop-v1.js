'use strict';

/*
 * La Bétaillère — retard communautaire contextualisé par la position du train.
 *
 * Règle métier :
 * - avant la première gare signalée : aucun retard communautaire affiché ;
 * - à partir de la gare signalée : sa valeur exacte s'applique ;
 * - une mesure plus loin remplace la précédente à partir de cette nouvelle gare ;
 * - aucune moyenne/médiane n'est affichée sur le train.
 */
(() => {
  if (window.__LB_COMMUNITY_DELAY_BY_STOP_V1__) return;
  window.__LB_COMMUNITY_DELAY_BY_STOP_V1__ = true;

  let frame = 0;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  function installStyle(){
    if (document.getElementById('lb-community-delay-by-stop-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-delay-by-stop-v1-style';
    style.textContent = `
      /* Tant que la position n'a pas validé la gare source, on masque la valeur globale de compatibilité. */
      .lb-map-traveler-delay.lb-map-traveler-delay-community:not([data-lb-community-position-ok="1"]),
      .lb-community-delay-status:not([data-lb-community-position-ok="1"]){visibility:hidden!important}
    `;
    document.head.appendChild(style);
  }

  function snapshotItem(trainNumber){
    const key = normalizeTrain(trainNumber);
    if (!key) return null;
    let snapshot = null;
    try { snapshot = window.lbCommunityMapViewState?.() || null; } catch(_) {}
    const trains = snapshot?.trains && typeof snapshot.trains === 'object' ? snapshot.trains : {};
    return trains[key] || Object.entries(trains).find(([number]) => normalizeTrain(number) === key)?.[1] || null;
  }

  function trainForMarker(marker){
    const id = String(marker?.getAttribute?.('data-train-id') || '').trim();
    if (!id) return null;
    try {
      if (typeof trainDataById !== 'undefined' && trainDataById?.get) return trainDataById.get(id) || null;
    } catch(_) {}
    return null;
  }

  function currentPanelTrain(){
    try {
      if (typeof activeTripId !== 'undefined' && activeTripId && typeof trainDataById !== 'undefined' && trainDataById?.get) {
        return trainDataById.get(activeTripId) || null;
      }
    } catch(_) {}
    return null;
  }

  function reportForTrainPosition(train, item){
    if (!train || !item) return null;
    const travelerStops = item.travelerStops && typeof item.travelerStops === 'object'
      ? item.travelerStops
      : {};
    if (!Object.keys(travelerStops).length) return null;

    let seq = null;
    try {
      if (typeof stopTimesByTrip !== 'undefined' && stopTimesByTrip?.get) seq = stopTimesByTrip.get(train.id) || null;
    } catch(_) {}
    if (!Array.isArray(seq) || !seq.length) return null;

    const rawIndex = Number(train.segmentIndex);
    if (!Number.isFinite(rawIndex)) return null;
    const currentIndex = Math.max(0, Math.min(seq.length - 1, Math.floor(rawIndex)));

    const reportsByStop = new Map();
    Object.entries(travelerStops).forEach(([rawKey, report]) => {
      if (!report || !(Number(report.delayMin) > 0)) return;
      const key = normalizeStop(rawKey);
      const stationKey = normalizeStop(report.station || '');
      if (key) reportsByStop.set(key, report);
      if (stationKey) reportsByStop.set(stationKey, report);
    });

    let active = null;
    for (let index = 0; index <= currentIndex; index += 1) {
      const stopTime = seq[index];
      let meta = null;
      try {
        if (typeof stopsById !== 'undefined' && stopsById?.get) meta = stopsById.get(stopTime?.stop_id) || null;
      } catch(_) {}
      const station = String(meta?.name || meta?.stop_name || meta?.stop_desc || '').trim();
      const key = normalizeStop(station);
      if (!key) continue;
      const report = reportsByStop.get(key) || null;
      if (!report || !(Number(report.delayMin) > 0)) continue;
      active = {
        ...report,
        station:String(report.station || station).trim() || station,
        delayMin:Math.round(Number(report.delayMin) || 0),
        stopIndex:index
      };
    }
    return active;
  }

  function positionBadge(marker, badge){
    if (!marker || !badge) return;
    const markerRect = marker.getBoundingClientRect?.();
    if (!markerRect || !(markerRect.width > 0) || !(markerRect.height > 0)) return;
    const official = marker.querySelector('.train-delay-badge');
    const apply = (left, top, minWidth = 0) => {
      badge.style.setProperty('position', 'absolute', 'important');
      badge.style.setProperty('left', `${Math.round(left)}px`, 'important');
      badge.style.setProperty('top', `${Math.round(top)}px`, 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');
      badge.style.setProperty('transform', 'none', 'important');
      badge.style.setProperty('min-width', minWidth > 0 ? `${Math.round(minWidth)}px` : '0', 'important');
      badge.style.setProperty('z-index', '9', 'important');
    };
    if (official) {
      const rect = official.getBoundingClientRect?.();
      if (rect?.width > 0 && rect?.height > 0) {
        apply(rect.left - markerRect.left, rect.bottom - markerRect.top + 2, rect.width);
        return;
      }
    }
    const width = Math.max(1, Number(badge.getBoundingClientRect?.().width || badge.offsetWidth || 1));
    apply((markerRect.width - width) / 2, markerRect.height + 3, 0);
  }

  function decorateMarker(marker){
    const number = normalizeTrain(marker?.getAttribute?.('data-train-number') || marker?.textContent || '');
    const item = snapshotItem(number);
    const train = trainForMarker(marker);
    const report = reportForTrainPosition(train, item);
    let badge = marker?.querySelector?.('.lb-map-traveler-delay') || null;

    if (!report) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'lb-map-traveler-delay lb-map-traveler-delay-community';
      marker.appendChild(badge);
    }

    const delay = Math.round(Number(report.delayMin) || 0);
    const station = String(report.station || '').trim();
    badge.textContent = `(+${delay}m)`;
    badge.title = `Signalement voyageur NON OFFICIEL depuis ${station || 'la dernière gare signalée'} : +${delay} min`;
    badge.setAttribute('aria-label', `Signalement voyageur non officiel : ${delay} minutes de retard depuis ${station || 'la dernière gare signalée'}`);
    badge.dataset.lbCommunityDelay = String(delay);
    badge.dataset.lbCommunityPositionOk = '1';
    badge.dataset.lbSourceStation = station;
    badge.dataset.lbStopStation = station;
    badge.classList.add('lb-map-traveler-delay-community');
    positionBadge(marker, badge);
  }

  function decoratePanel(){
    const block = document.getElementById('lb-map-trip-community');
    if (!block || block.hidden) return;
    const number = normalizeTrain(block.dataset.trainNumber || document.querySelector('#trip-panel-train')?.textContent || '');
    const item = snapshotItem(number);
    const train = currentPanelTrain();
    const report = reportForTrainPosition(train, item);
    const statusLine = block.querySelector('.lb-community-status-line');
    const sourceLine = block.querySelector('.lb-community-source-line');

    const oldDelay = statusLine?.querySelector('.lb-community-delay-status');
    if (!report) {
      oldDelay?.remove();
      block.classList.remove('lb-community-has-delay');
      if (sourceLine && !sourceLine.classList.contains('lb-community-source-line--votes')) {
        sourceLine.textContent = '';
        sourceLine.hidden = true;
      }
      return;
    }

    const delay = Math.round(Number(report.delayMin) || 0);
    const station = String(report.station || '').trim();
    let chip = oldDelay;
    if (!chip && statusLine) {
      chip = document.createElement('span');
      chip.className = 'lb-community-delay-status';
      statusLine.appendChild(chip);
    }
    if (chip) {
      chip.textContent = `(+${delay} min)`;
      chip.title = `Signalement voyageur depuis ${station}`;
      chip.dataset.lbCommunityDelay = String(delay);
      chip.dataset.lbCommunityPositionOk = '1';
      chip.dataset.lbSourceStation = station;
    }
    block.classList.add('lb-community-has-delay');
    block.dataset.lbCommunitySource = station ? `NON OFFICIEL · signalé par un voyageur · ${station}` : '';
    if (sourceLine && !sourceLine.classList.contains('lb-community-source-line--votes')) {
      sourceLine.textContent = block.dataset.lbCommunitySource;
      sourceLine.hidden = !block.dataset.lbCommunitySource;
    }
  }

  function decorate(){
    frame = 0;
    document.querySelectorAll('.cow-marker').forEach(decorateMarker);
    decoratePanel();
  }

  function schedule(){
    if (frame) return;
    frame = requestAnimationFrame(decorate);
  }

  function installHooks(){
    try {
      if (typeof renderTrains === 'function' && !renderTrains.__lbCommunityDelayByStopV1) {
        const original = renderTrains;
        const wrapped = function(...args){
          const result = original.apply(this, args);
          schedule();
          return result;
        };
        wrapped.__lbCommunityDelayByStopV1 = true;
        renderTrains = wrapped;
      }
    } catch(_) {}

    try {
      if (typeof renderTripPanel === 'function' && !renderTripPanel.__lbCommunityDelayByStopV1) {
        const original = renderTripPanel;
        const wrapped = function(...args){
          const result = original.apply(this, args);
          schedule();
          return result;
        };
        wrapped.__lbCommunityDelayByStopV1 = true;
        renderTripPanel = wrapped;
      }
    } catch(_) {}
  }

  document.addEventListener('lb:community:decorated', schedule);
  window.addEventListener('message', (event) => {
    if (event?.data?.type === 'lb:community:snapshot') schedule();
  });

  window.lbCommunityDelayByStopV1 = { reportForTrainPosition, refresh:schedule };

  function start(){
    installStyle();
    installHooks();
    schedule();
    setTimeout(() => { installHooks(); schedule(); }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
