'use strict';

/*
 * La Bétaillère — correctif visuel ciblé carte.
 * 1) Conserve le header V2 validé, y compris pour les trains passant minuit (+1j).
 * 2) Aligne exactement le retard communautaire violet sous le badge SNCF.
 *
 * Ne modifie aucune donnée, aucun calcul de retard, aucun signalement et aucun arrêt.
 */
(() => {
  if (window.__LB_MAP_VISUAL_STABILITY_V1__) return;
  window.__LB_MAP_VISUAL_STABILITY_V1__ = true;

  let alignQueued = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function clockOnly(value){
    const match = String(value || '').match(/\b(\d{1,2}:\d{2})\b/);
    return match ? match[1] : '';
  }

  function daySuffix(value){
    const match = String(value || '').match(/\(\+\d+j\)/i);
    return match ? match[0] : '';
  }

  function clockMin(value){
    const match = clockOnly(value).match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function parseRealtime(summary){
    const rows = Array.from(summary.querySelectorAll('.trip-panel-realtime'));
    const row = rows.find((el) => /^Temps\s+r[ée]el\s*:/i.test(String(el.textContent || '').trim()));
    if (!row) return null;

    const rawTimes = Array.from(row.querySelectorAll('strong'))
      .map((el) => String(el.textContent || '').trim())
      .filter(Boolean);
    const diffs = Array.from(row.querySelectorAll('.trip-panel-realtime-diff'))
      .map((el) => String(el.textContent || '').trim());
    if (rawTimes.length < 2) return null;

    return {
      row,
      start: clockOnly(rawTimes[0]),
      end: clockOnly(rawTimes[1]),
      startRaw: rawTimes[0],
      endRaw: rawTimes[1],
      startDiff: diffs[0] || '',
      endDiff: diffs[1] || diffs[0] || ''
    };
  }

  function timeHtml(plan, real, diff, rawReal){
    const changed = !!(plan && real && plan !== real);
    const title = rawReal && rawReal !== real ? ` title="${esc(rawReal)}"` : '';
    if (!changed) return `<span class="lb-route-plan-v2"${title}>${esc(plan || real || '—')}</span>`;
    const advance = /^-/.test(String(diff || '').trim());
    return `<span class="lb-route-plan-v2 is-delayed">${esc(plan)}</span><span class="lb-route-real-v2${advance ? ' is-advance' : ''}"${title}>${esc(real)}</span>`;
  }

  function restoreValidatedHeader(){
    const panel = document.getElementById('trip-panel');
    const summary = document.getElementById('trip-panel-summary');
    if (!panel || !summary || panel.classList.contains('station-board-mode')) return;
    if (summary.querySelector('.lb-trip-route-card-v2')) return;

    // Le rendu natif place le trajet avant le premier DIV du résumé.
    const nodes = Array.from(summary.childNodes);
    const routeNodes = [];
    for (const node of nodes){
      if (node.nodeType === 1 && node.tagName === 'DIV') break;
      routeNodes.push(node);
    }

    const routeText = routeNodes
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Même format que le header V2 historique, mais accepte désormais (+1j), (+2j)…
    const routeMatch = routeText.match(
      /^(.*?)\s+(\d{1,2}:\d{2})(?:\s*\(\+\d+j\))?\s*(?:→|->)\s*(.*?)\s+(\d{1,2}:\d{2})(?:\s*\(\+\d+j\))?$/i
    );
    if (!routeMatch) return;

    const depName = routeMatch[1].trim();
    const depPlan = routeMatch[2];
    const arrName = routeMatch[3].trim();
    const arrPlan = routeMatch[4];
    const realtime = parseRealtime(summary);
    const depReal = realtime?.start || depPlan;
    const arrReal = realtime?.end || arrPlan;

    let duration = '';
    const depMinutes = clockMin(depPlan);
    const arrMinutes = clockMin(arrPlan);
    if (depMinutes != null && arrMinutes != null){
      let value = arrMinutes - depMinutes;
      if (value < 0) value += 1440;
      if (value >= 0 && value < 1440) duration = `${value} min`;
    }

    routeNodes.forEach((node) => node.remove());
    if (realtime?.row) realtime.row.classList.add('lb-consumed-realtime-v2');

    const card = document.createElement('div');
    card.className = 'lb-trip-route-card-v2';
    card.innerHTML = `
      <div class="lb-route-side-v2 is-dep">
        <span class="lb-route-label-v2">Départ</span>
        <span class="lb-route-times-v2">${timeHtml(depPlan, depReal, realtime?.startDiff, realtime?.startRaw)}</span>
        <span class="lb-route-name-v2">${esc(depName)}</span>
      </div>
      <div class="lb-route-mid-v2">${duration ? `<span class="lb-route-duration-v2">${esc(duration)}</span>` : ''}<span class="lb-route-link-v2"></span></div>
      <div class="lb-route-side-v2 is-arr">
        <span class="lb-route-label-v2">Arrivée</span>
        <span class="lb-route-times-v2">${timeHtml(arrPlan, arrReal, realtime?.endDiff, realtime?.endRaw)}</span>
        <span class="lb-route-name-v2">${esc(arrName)}</span>
      </div>`;
    summary.insertAdjacentElement('afterbegin', card);
  }

  function alignCommunityBadge(marker){
    const badge = marker?.querySelector?.('.lb-map-traveler-delay-community');
    const official = marker?.querySelector?.('.train-delay-badge');
    if (!badge || !official) return;

    const markerRect = marker.getBoundingClientRect();
    const officialRect = official.getBoundingClientRect();
    if (!(officialRect.width > 0) || !(officialRect.height > 0)) return;

    // getBoundingClientRect tient compte des transforms CSS du badge SNCF,
    // contrairement à offsetLeft/offsetTop. Les deux bords sont donc réellement alignés.
    const left = officialRect.left - markerRect.left;
    const top = officialRect.bottom - markerRect.top + 1;
    const width = officialRect.width;
    const height = officialRect.height;
    const officialStyle = getComputedStyle(official);

    badge.style.setProperty('left', `${left}px`, 'important');
    badge.style.setProperty('top', `${top}px`, 'important');
    badge.style.setProperty('right', 'auto', 'important');
    badge.style.setProperty('bottom', 'auto', 'important');
    badge.style.setProperty('transform', 'none', 'important');
    badge.style.setProperty('box-sizing', 'border-box', 'important');
    badge.style.setProperty('width', `${width}px`, 'important');
    badge.style.setProperty('min-width', `${width}px`, 'important');
    badge.style.setProperty('max-width', `${width}px`, 'important');
    badge.style.setProperty('height', `${height}px`, 'important');
    badge.style.setProperty('min-height', `${height}px`, 'important');
    badge.style.setProperty('padding', '0', 'important');
    badge.style.setProperty('font-size', officialStyle.fontSize, 'important');
    badge.style.setProperty('line-height', `${height}px`, 'important');
    badge.style.setProperty('border-radius', officialStyle.borderRadius || '3px', 'important');
  }

  function alignAllCommunityBadges(){
    alignQueued = false;
    document.querySelectorAll('.cow-marker').forEach(alignCommunityBadge);
  }

  function queueAlign(){
    if (alignQueued) return;
    alignQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(alignAllCommunityBadges));
  }

  function finishVisuals(){
    try { restoreValidatedHeader(); } catch (error) { console.warn('[LB visual/header]', error); }
    queueAlign();
  }

  function installHooks(){
    if (typeof renderTripPanel === 'function' && !renderTripPanel.__lbVisualStabilityV1){
      const originalRenderTripPanel = renderTripPanel;
      const wrapped = function(...args){
        const result = originalRenderTripPanel.apply(this, args);
        queueMicrotask(finishVisuals);
        return result;
      };
      wrapped.__lbVisualStabilityV1 = true;
      renderTripPanel = wrapped;
    }

    if (typeof iconForTrain === 'function' && !iconForTrain.__lbVisualStabilityV1){
      const originalIconForTrain = iconForTrain;
      const wrapped = function(...args){
        const result = originalIconForTrain.apply(this, args);
        queueAlign();
        return result;
      };
      wrapped.__lbVisualStabilityV1 = true;
      if (originalIconForTrain.__lbTravelerWrapped) wrapped.__lbTravelerWrapped = true;
      iconForTrain = wrapped;
    }
  }

  window.addEventListener('message', (event) => {
    if (event?.data?.type === 'lb:community:snapshot') queueAlign();
  });
  window.addEventListener('resize', queueAlign, { passive:true });

  function start(){
    installHooks();
    finishVisuals();
    // Couvre uniquement l'ordre d'initialisation des wrappers existants.
    setTimeout(() => {
      installHooks();
      finishVisuals();
    }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
