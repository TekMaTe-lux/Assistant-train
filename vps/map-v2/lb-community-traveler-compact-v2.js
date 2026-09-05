'use strict';

/*
 * La Bétaillère — présentation compacte de la Voix du Bétail sur la carte.
 *
 * Cette couche ne crée aucune règle métier : elle consomme uniquement le
 * snapshot communautaire déjà fourni par la Voix du Bétail. Un retard attaché
 * à une gare reste affiché sur les arrêts suivants jusqu'à ce qu'un autre
 * signalement de gare déjà présent dans travelerStops prenne le relais.
 */
(() => {
  if (window.__LB_COMMUNITY_TRAVELER_COMPACT_V2__) return;
  window.__LB_COMMUNITY_TRAVELER_COMPACT_V2__ = true;

  const communitySnapshot = { trains:{}, canContribute:false };
  let decorateQueued = false;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  function currentTripNumber(){
    const fromBlock = normalizeTrain(document.getElementById('lb-map-trip-community')?.dataset?.trainNumber);
    if (fromBlock) return fromBlock;
    return normalizeTrain(document.querySelector('#trip-panel-train')?.textContent);
  }

  function itemForTrain(trainNumber){
    const key = normalizeTrain(trainNumber);
    return key ? (communitySnapshot.trains?.[key] || null) : null;
  }

  function latestDelayReport(item){
    const reports = Object.values(item?.travelerStops || {})
      .filter((report) => report && Number(report.delayMin) > 0);
    if (!reports.length) return null;

    const wantedDelay = Math.round(Number(item?.travelerDelayMin) || 0);
    const matching = wantedDelay > 0
      ? reports.filter((report) => Math.round(Number(report.delayMin) || 0) === wantedDelay)
      : reports;
    const candidates = matching.length ? matching : reports;
    candidates.sort((a,b) => Number(b.lastReportAt || 0) - Number(a.lastReportAt || 0));
    return candidates[0] || null;
  }

  function decorateCommunityBlock(trainNumber = currentTripNumber()){
    const block = document.getElementById('lb-map-trip-community');
    if (!block) return;

    const number = normalizeTrain(trainNumber);
    const item = itemForTrain(number);
    const presenceCount = Math.max(0, Math.round(Number(item?.presenceCount) || 0));
    const delayMin = Math.max(0, Math.round(Number(item?.travelerDelayMin) || 0));
    const status = [];
    if (presenceCount > 0) status.push(`${presenceCount} à bord`);
    if (delayMin > 0) status.push(`+${delayMin} min`);

    const source = delayMin > 0 ? latestDelayReport(item) : null;
    const sourceStation = String(source?.station || '').trim();

    block.dataset.lbCommunityStatus = status.join(' · ') || 'Aucun signalement';
    block.dataset.lbCommunitySource = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';
    block.classList.toggle('lb-community-can-contribute', communitySnapshot.canContribute === true);
    block.classList.toggle('lb-community-read-only', communitySnapshot.canContribute !== true);
    block.classList.toggle('lb-current-user-aboard', !!item?.isCurrentUserAboard);
  }

  function renderPropagatedStopDelays(trainNumber = currentTripNumber()){
    const stops = document.getElementById('trip-stops');
    if (!stops) return;

    stops.querySelectorAll('.lb-stop-traveler-delay-propagated').forEach((label) => label.remove());

    const item = itemForTrain(trainNumber);
    const travelerStops = item?.travelerStops && typeof item.travelerStops === 'object'
      ? item.travelerStops
      : {};
    if (!Object.keys(travelerStops).length) return;

    let activeReport = null;
    stops.querySelectorAll(':scope > .trip-stop').forEach((row) => {
      const stopName = String(row.querySelector('.stop-name')?.textContent || '').trim();
      const stopKey = normalizeStop(stopName);
      const nextReport = stopKey ? travelerStops[stopKey] : null;
      const nextDelay = Math.round(Number(nextReport?.delayMin) || 0);

      // Même logique que la Voix du Bétail : une information plus loin dans le
      // parcours remplace la précédente à partir de cette gare.
      if (nextReport && nextDelay > 0) activeReport = nextReport;
      if (!activeReport) return;

      const delay = Math.round(Number(activeReport.delayMin) || 0);
      if (!(delay > 0)) return;

      const sourceStation = String(activeReport.station || '').trim() || stopName || 'la gare signalée';
      const reports = Math.max(1, Math.round(Number(activeReport.reports) || 1));
      const label = document.createElement('div');
      label.className = 'lb-stop-traveler-delay-propagated';
      label.textContent = `+${delay} min*`;
      label.title = `Retard signalé depuis ${sourceStation} par ${reports} voyageur${reports > 1 ? 's' : ''} — appliqué aux arrêts suivants jusqu’au prochain signalement.`;
      label.setAttribute('aria-label', `Retard communautaire de ${delay} minutes, signalé depuis ${sourceStation}`);
      row.appendChild(label);
    });
  }

  function decorateMarkerBadges(){
    document.querySelectorAll('.cow-marker').forEach((marker) => {
      const number = normalizeTrain(marker.getAttribute('data-train-number') || marker.textContent);
      const item = itemForTrain(number);
      const delay = Math.max(0, Math.round(Number(item?.travelerDelayMin) || 0));
      const badge = marker.querySelector('.lb-map-traveler-delay');
      if (!badge || !(delay > 0)) return;

      badge.textContent = `+${delay}min*`;
      badge.title = `Retard signalé par la communauté : +${delay} min`;
      badge.setAttribute('aria-label', `Retard communautaire de ${delay} minutes`);
      badge.classList.add('lb-map-traveler-delay-community');
    });
  }

  function decorateAll(){
    decorateQueued = false;
    const number = currentTripNumber();
    decorateCommunityBlock(number);
    renderPropagatedStopDelays(number);
    decorateMarkerBadges();
  }

  function scheduleDecorate(){
    if (decorateQueued) return;
    decorateQueued = true;
    queueMicrotask(decorateAll);
  }

  function installTripHook(){
    if (typeof renderTripPanel !== 'function' || renderTripPanel.__lbCommunityCompactV2) return;
    const originalRenderTripPanel = renderTripPanel;
    const wrapped = function(...args){
      const result = originalRenderTripPanel.apply(this, args);
      scheduleDecorate();
      return result;
    };
    wrapped.__lbCommunityCompactV2 = true;
    renderTripPanel = wrapped;
  }

  function installMarkerHook(){
    if (typeof iconForTrain !== 'function' || iconForTrain.__lbCommunityCompactV2Marker) return;
    const originalIconForTrain = iconForTrain;
    const wrapped = function(...args){
      const icon = originalIconForTrain.apply(this, args);
      // V1 programme sa reconstruction de badge en microtask/rAF. On programme
      // la finition juste après, sans polling ni observateur global.
      queueMicrotask(() => requestAnimationFrame(decorateMarkerBadges));
      return icon;
    };
    wrapped.__lbCommunityCompactV2Marker = true;
    if (originalIconForTrain.__lbTravelerWrapped) wrapped.__lbTravelerWrapped = true;
    iconForTrain = wrapped;
  }

  function installStyle(){
    if (document.getElementById('lb-community-traveler-compact-v2-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-traveler-compact-v2-style';
    style.textContent = `
      /* Retards communautaires : le * est le repère visuel, sans vache répétée. */
      .trip-stop .lb-stop-traveler-delay-right{display:none!important}
      .trip-stop .lb-stop-traveler-delay-propagated{position:absolute;z-index:3;right:8px;top:15px;display:inline-flex;align-items:center;justify-content:center;padding:1px 4px;border:1px solid rgba(117,238,250,.24);border-radius:4px;background:rgba(4,24,40,.72);color:#8ef8ff;font-size:7.5px;font-weight:900;line-height:1.1;white-space:nowrap;text-align:right;text-shadow:none;pointer-events:none}
      .lb-map-traveler-delay.lb-map-traveler-delay-community{min-height:13px!important;padding:1px 4px!important;border:1px solid rgba(117,238,250,.55)!important;border-radius:4px!important;background:rgba(3,18,31,.94)!important;color:#a8fbff!important;font-size:7.5px!important;font-weight:900!important;letter-spacing:.01em;box-shadow:0 0 5px rgba(71,225,239,.18)!important}

      /* Bloc compact : deux lignes maximum, même structure PC / mobile. */
      .lb-map-trip-community{box-sizing:border-box!important;width:100%;max-width:100%;overflow:hidden;display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:'title status actions' 'source source actions';align-items:center;column-gap:7px;row-gap:2px;padding:5px 7px!important;min-height:0;border:1px solid rgba(0,234,255,.24)!important;border-radius:10px!important;background:linear-gradient(90deg,rgba(4,24,40,.88),rgba(3,18,31,.78))!important;box-shadow:inset 0 0 0 1px rgba(117,238,250,.025)}
      .lb-map-trip-community-summary{grid-area:title;min-width:0!important;display:block!important;padding:0!important;align-self:center;border:0!important;background:transparent!important;box-shadow:none!important}
      .lb-map-trip-community-summary strong{display:none!important}
      .lb-map-trip-community-title{display:block;color:#8ef8ff!important;font-size:8.5px!important;font-weight:900!important;line-height:1.1;white-space:nowrap;letter-spacing:.035em}
      .lb-map-trip-community::before{content:attr(data-lb-community-status);grid-area:status;justify-self:start;min-width:0;max-width:100%;box-sizing:border-box;padding:2px 5px;border:1px solid rgba(117,238,250,.18);border-radius:999px;background:rgba(5,31,51,.62);color:#f3feff;font-size:9.5px;font-weight:900;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lb-map-trip-community::after{content:attr(data-lb-community-source);grid-area:source;min-width:0;color:#91aebb;font-size:7.8px;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lb-map-trip-community-actions{grid-area:actions;min-width:0;display:flex!important;gap:4px!important;align-items:center;justify-content:flex-end}
      .lb-map-trip-community-actions button{box-sizing:border-box;min-height:27px!important;padding:4px 7px!important;border:1px solid rgba(0,234,255,.32)!important;border-radius:7px!important;background:rgba(5,31,51,.94)!important;color:#eefcff!important;font-size:8.5px!important;font-weight:850!important;line-height:1!important;white-space:nowrap;box-shadow:none!important}
      .lb-map-trip-community-actions button:hover,.lb-map-trip-community-actions button:focus-visible{border-color:#8ef8ff!important;background:rgba(7,42,64,.98)!important;color:#fff!important}

      /* Non connecté : une seule invitation douce, sans double message. */
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions button:nth-child(2){display:none!important}
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]{font-size:0!important}
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'Participer';font-size:8.5px;font-weight:850}

      /* Connecté : aucune action parasite à gauche, les actions restent à droite. */
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-presence]{font-size:0!important}
      .lb-map-trip-community.lb-community-can-contribute:not(.lb-current-user-aboard) .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'À bord';font-size:8.5px;font-weight:850}
      .lb-map-trip-community.lb-community-can-contribute.lb-current-user-aboard .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'À bord ✓';font-size:8.5px;font-weight:850}
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]{font-size:0!important}
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]::after{content:'Signaler';font-size:8.5px;font-weight:850}

      @media(max-width:520px){
        .lb-map-trip-community{column-gap:5px;row-gap:1px;padding:4px 6px!important;border-radius:9px!important}
        .lb-map-trip-community-title{font-size:8px!important}
        .lb-map-trip-community::before{padding:2px 4px;font-size:9px}
        .lb-map-trip-community::after{font-size:7.4px}
        .lb-map-trip-community-actions{gap:3px!important}
        .lb-map-trip-community-actions button{min-height:25px!important;padding:3px 5px!important;font-size:8px!important}
        .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute:not(.lb-current-user-aboard) .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute.lb-current-user-aboard .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]::after{font-size:8px}
        .trip-stop .lb-stop-traveler-delay-propagated{right:6px;top:14px;padding:1px 3px;font-size:7px}
      }

      @media(max-width:380px){
        .lb-map-trip-community{column-gap:4px;padding-left:5px!important;padding-right:5px!important}
        .lb-map-trip-community-title{font-size:7.6px!important;letter-spacing:.02em}
        .lb-map-trip-community::before{font-size:8.5px}
        .lb-map-trip-community-actions button{padding-left:4px!important;padding-right:4px!important}
      }
    `;
    document.head.appendChild(style);
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || typeof data !== 'object' || data.type !== 'lb:community:snapshot') return;
    if (window.parent !== window && event.source !== window.parent) return;
    communitySnapshot.trains = data.trains && typeof data.trains === 'object' ? data.trains : {};
    communitySnapshot.canContribute = data.canContribute === true;
    scheduleDecorate();
  });

  function start(){
    installStyle();
    installTripHook();
    installMarkerHook();
    scheduleDecorate();
    // Un seul second passage couvre l'ordre d'initialisation V1/V2, sans
    // observateur global ni polling permanent.
    window.setTimeout(() => {
      installTripHook();
      installMarkerHook();
      scheduleDecorate();
    }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
