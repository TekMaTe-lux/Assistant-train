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

  function ensureCommunityStatusNodes(block){
    let statusLine = block.querySelector('.lb-community-status-line');
    let sourceLine = block.querySelector('.lb-community-source-line');
    const actions = block.querySelector('.lb-map-trip-community-actions');

    if (!statusLine){
      statusLine = document.createElement('div');
      statusLine.className = 'lb-community-status-line';
      block.insertBefore(statusLine, actions || null);
    }
    if (!sourceLine){
      sourceLine = document.createElement('div');
      sourceLine.className = 'lb-community-source-line';
      block.insertBefore(sourceLine, actions || null);
    }
    return { statusLine, sourceLine };
  }

  function appendStatusChip(parent, className, text){
    const chip = document.createElement('span');
    chip.className = className;
    chip.textContent = text;
    parent.appendChild(chip);
    return chip;
  }

  function decorateCommunityBlock(trainNumber = currentTripNumber()){
    const block = document.getElementById('lb-map-trip-community');
    if (!block) return;

    const number = normalizeTrain(trainNumber);
    const item = itemForTrain(number);
    const presenceCount = Math.max(0, Math.round(Number(item?.presenceCount) || 0));
    const delayMin = Math.max(0, Math.round(Number(item?.travelerDelayMin) || 0));
    const source = delayMin > 0 ? latestDelayReport(item) : null;
    const sourceStation = String(source?.station || '').trim();
    const { statusLine, sourceLine } = ensureCommunityStatusNodes(block);

    statusLine.replaceChildren();
    if (presenceCount > 0) appendStatusChip(statusLine, 'lb-community-presence-status', `${presenceCount} à bord`);
    if (delayMin > 0) {
      const delayChip = appendStatusChip(statusLine, 'lb-community-delay-status', `+${delayMin} min*`);
      delayChip.title = 'Retard signalé par la communauté';
      delayChip.setAttribute('aria-label', `Retard communautaire de ${delayMin} minutes`);
    }
    if (!statusLine.childElementCount) appendStatusChip(statusLine, 'lb-community-empty-status', 'Aucun signalement');

    sourceLine.textContent = sourceStation ? `Retard signalé depuis ${sourceStation}` : '';
    sourceLine.hidden = !sourceStation;
    block.dataset.lbCommunityStatus = `${presenceCount > 0 ? `${presenceCount} à bord` : ''}${presenceCount > 0 && delayMin > 0 ? ' · ' : ''}${delayMin > 0 ? `+${delayMin} min*` : ''}` || 'Aucun signalement';
    block.dataset.lbCommunitySource = sourceLine.textContent;
    block.classList.toggle('lb-community-has-delay', delayMin > 0);
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

  function alignCommunityMarkerDelay(marker, badge){
    if (!marker || !badge) return;
    const official = marker.querySelector('.train-delay-badge');
    const glyph = marker.querySelector('.cow-glyph');
    const anchor = official || glyph;
    if (!anchor) return;

    badge.style.right = 'auto';
    badge.style.bottom = 'auto';
    badge.style.transform = 'none';

    if (official){
      // Le retard communautaire est une information secondaire : même colonne
      // et même gabarit que le badge SNCF, exactement un pixel en dessous.
      badge.style.left = `${official.offsetLeft}px`;
      badge.style.top = `${official.offsetTop + official.offsetHeight + 1}px`;
    } else {
      badge.style.left = `${glyph.offsetLeft + glyph.offsetWidth + 2}px`;
      badge.style.top = `${glyph.offsetTop + Math.max(0, Math.round((glyph.offsetHeight - badge.offsetHeight) / 2))}px`;
    }
  }

  function decorateMarkerBadges(){
    document.querySelectorAll('.cow-marker').forEach((marker) => {
      const number = normalizeTrain(marker.getAttribute('data-train-number') || marker.textContent);
      const item = itemForTrain(number);
      const delay = Math.max(0, Math.round(Number(item?.travelerDelayMin) || 0));
      const badge = marker.querySelector('.lb-map-traveler-delay');
      if (!badge || !(delay > 0)) return;

      badge.textContent = `+${delay}min*`;
      badge.title = `Retard signalé par la communauté : +${delay} min (* = communauté)`;
      badge.setAttribute('aria-label', `Retard communautaire de ${delay} minutes`);
      badge.classList.add('lb-map-traveler-delay-community');
      alignCommunityMarkerDelay(marker, badge);
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
      // V1 reconstruit parfois le badge au prochain frame ; V2 ne fait qu'une
      // finition ciblée juste après, sans polling ni observateur global.
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
      /* Violet = information communautaire. Les couleurs SNCF restent intactes. */
      .trip-stop .lb-stop-traveler-delay-right{display:none!important}
      .trip-stop .lb-stop-traveler-delay-propagated{position:absolute;z-index:3;right:8px;top:15px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:10px;min-height:10px;padding:0 3px;border:0;border-radius:3px;background:rgba(91,54,132,.94);color:#f2eaff;font-size:6.25px;font-weight:900;line-height:10px;white-space:nowrap;text-align:right;text-shadow:none;box-shadow:none;pointer-events:none}
      .lb-map-traveler-delay.lb-map-traveler-delay-community{box-sizing:border-box!important;width:auto!important;min-width:0!important;max-width:none!important;height:10px!important;min-height:10px!important;padding:0 3px!important;margin:0!important;border:0!important;outline:0!important;border-radius:3px!important;background:rgba(91,54,132,.97)!important;color:#f5efff!important;font-size:6.25px!important;font-weight:900!important;line-height:10px!important;letter-spacing:0!important;white-space:nowrap!important;box-shadow:none!important}

      /* Bloc compact : identité cyan, retard communautaire violet. */
      .lb-map-trip-community{box-sizing:border-box!important;width:100%;max-width:100%;overflow:hidden;display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:'title status actions' 'source source actions';align-items:center;column-gap:7px;row-gap:2px;padding:5px 7px!important;min-height:0;border:1px solid rgba(0,234,255,.24)!important;border-radius:10px!important;background:linear-gradient(90deg,rgba(4,24,40,.88),rgba(3,18,31,.78))!important;box-shadow:inset 0 0 0 1px rgba(117,238,250,.025)}
      .lb-map-trip-community-summary{grid-area:title;min-width:0!important;display:block!important;padding:0!important;align-self:center;border:0!important;background:transparent!important;box-shadow:none!important}
      .lb-map-trip-community-summary strong{display:none!important}
      .lb-map-trip-community-title{display:block;color:#8ef8ff!important;font-size:8.5px!important;font-weight:900!important;line-height:1.1;white-space:nowrap;letter-spacing:.035em}
      .lb-community-status-line{grid-area:status;min-width:0;display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap}
      .lb-community-presence-status,.lb-community-empty-status{min-width:0;max-width:100%;box-sizing:border-box;padding:2px 5px;border:1px solid rgba(117,238,250,.16);border-radius:999px;background:rgba(5,31,51,.58);color:#f3feff;font-size:9.5px;font-weight:900;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-community-presence-status{flex:0 1 auto}
      .lb-community-empty-status{color:#a9bec8;font-weight:750}
      .lb-community-delay-status{flex:0 0 auto;box-sizing:border-box;padding:2px 5px;border:1px solid rgba(183,140,255,.48);border-radius:999px;background:rgba(77,43,113,.68);color:#f1e8ff;font-size:9px;font-weight:900;line-height:1.05;white-space:nowrap;box-shadow:none}
      .lb-community-source-line{grid-area:source;min-width:0;color:#c8b9dd;font-size:7.8px;font-weight:750;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lb-community-source-line[hidden]{display:none!important}
      .lb-map-trip-community-actions{grid-area:actions;min-width:0;display:flex!important;gap:4px!important;align-items:center;justify-content:flex-end}
      .lb-map-trip-community-actions button{box-sizing:border-box;min-height:27px!important;padding:4px 7px!important;border:1px solid rgba(0,234,255,.32)!important;border-radius:7px!important;background:rgba(5,31,51,.94)!important;color:#eefcff!important;font-size:8.5px!important;font-weight:850!important;line-height:1!important;white-space:nowrap;box-shadow:none!important}
      .lb-map-trip-community-actions button:hover,.lb-map-trip-community-actions button:focus-visible{border-color:#8ef8ff!important;background:rgba(7,42,64,.98)!important;color:#fff!important}

      /* Non connecté : une seule invitation douce. */
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions button:nth-child(2){display:none!important}
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]{font-size:0!important}
      .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'Participer';font-size:8.5px;font-weight:850}

      /* Connecté : les actions restent uniquement à droite. */
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-presence]{font-size:0!important}
      .lb-map-trip-community.lb-community-can-contribute:not(.lb-current-user-aboard) .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'À bord';font-size:8.5px;font-weight:850}
      .lb-map-trip-community.lb-community-can-contribute.lb-current-user-aboard .lb-map-trip-community-actions [data-lb-map-community-presence]::after{content:'À bord ✓';font-size:8.5px;font-weight:850}
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]{font-size:0!important}
      .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]::after{content:'Signaler';font-size:8.5px;font-weight:850}

      @media(max-width:720px){
        .lb-map-traveler-delay.lb-map-traveler-delay-community{height:9px!important;min-height:9px!important;padding:0 2px!important;font-size:5.75px!important;line-height:9px!important}
        .trip-stop .lb-stop-traveler-delay-propagated{height:9px;min-height:9px;padding:0 2px;font-size:5.75px;line-height:9px}
      }

      @media(max-width:520px){
        .lb-map-trip-community{column-gap:5px;row-gap:1px;padding:4px 6px!important;border-radius:9px!important}
        .lb-map-trip-community-title{font-size:8px!important}
        .lb-community-status-line{gap:3px}
        .lb-community-presence-status,.lb-community-empty-status{padding:2px 4px;font-size:9px}
        .lb-community-delay-status{padding:2px 4px;font-size:8.5px}
        .lb-community-source-line{font-size:7.4px}
        .lb-map-trip-community-actions{gap:3px!important}
        .lb-map-trip-community-actions button{min-height:25px!important;padding:3px 5px!important;font-size:8px!important}
        .lb-map-trip-community.lb-community-read-only .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute:not(.lb-current-user-aboard) .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute.lb-current-user-aboard .lb-map-trip-community-actions [data-lb-map-community-presence]::after,
        .lb-map-trip-community.lb-community-can-contribute .lb-map-trip-community-actions [data-lb-map-community-signal]::after{font-size:8px}
      }

      @media(max-width:380px){
        .lb-map-trip-community{column-gap:4px;padding-left:5px!important;padding-right:5px!important}
        .lb-map-trip-community-title{font-size:7.6px!important;letter-spacing:.02em}
        .lb-community-presence-status,.lb-community-empty-status{font-size:8.5px}
        .lb-community-delay-status{font-size:8px}
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
