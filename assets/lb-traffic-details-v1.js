/*
 * La Bétaillère — détail Info trafic v1
 *
 * Extension progressive de la carte existante « Info trafic ».
 * Aucune nouvelle source : les chiffres sont calculés à partir du même snapshot
 * GTFS-RT SNCF déjà chargé par index.html pour colorer Metz–Lux / Nancy–Metz.
 */
(function () {
  'use strict';

  const SEGMENTS = Object.freeze({
    north: {
      badgeId: 'homeTrafficBadgeNorth',
      label: 'Metz ↔ Luxembourg',
      shortLabel: 'Metz - Lux',
      stations: ['Hagondange', 'Uckange', 'Thionville', 'Hettange-Grande', 'Bettembourg', 'Luxembourg']
    },
    south: {
      badgeId: 'homeTrafficBadgeSouth',
      label: 'Nancy ↔ Metz',
      shortLabel: 'Nancy - Metz',
      stations: ['Nancy', 'Frouard', 'Pompey', 'Belleville', 'Dieulouard', 'Pont-à-Mousson', 'Vandières', 'Pagny-sur-Moselle', 'Novéant-sur-Moselle', 'Ancy-sur-Moselle', 'Ars-sur-Moselle']
    }
  });

  let modal = null;
  let previousFocus = null;
  let activeSegmentKey = '';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function stopName(value) {
    if (value && typeof value === 'object') {
      return value.name || value.stop_name || value.stopName || value.station || value.id || '';
    }
    return value || '';
  }

  function unwrapRaw(source) {
    if (!source || typeof source !== 'object') return null;
    const dataset = source['sncf-nml'] || source.sncfNml || source;
    return dataset?.raw || dataset || null;
  }

  function getCurrentRaw() {
    return unwrapRaw(window.retardsGTFS_RAW);
  }

  function getTrainsObject(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const wrapped = raw.trains || raw?.normalized?.trains || raw?.data?.trains;
    if (wrapped && typeof wrapped === 'object') return wrapped;

    // Secours pour un snapshot dont les trains seraient directement à la racine.
    const entries = Object.entries(raw);
    if (entries.length && entries.some(([, value]) => value && typeof value === 'object' && (value.stops || value.status))) {
      return raw;
    }
    return null;
  }

  function trainNumberFrom(entryKey, train) {
    const direct = train?.train_number || train?.trainNumber || train?.number || train?.trip_short_name || train?.tripShortName;
    if (direct) return String(direct);
    const match = String(entryKey || '').match(/\b\d{4,6}\b/);
    return match ? match[0] : String(entryKey || 'Train');
  }

  function isFullyCanceled(statusRaw) {
    if (statusRaw.includes('PARTIAL')) return false;
    return statusRaw.includes('CANCEL') || statusRaw.includes('SUPPR') || statusRaw.includes('DELETED');
  }

  function analyzeSegment(raw, segment) {
    const trainsObj = getTrainsObject(raw);
    if (!trainsObj) return null;

    const stationSet = new Set(segment.stations.map(normalize));
    const records = [];
    let canceledStopsInSegment = 0;

    for (const [entryKey, train] of Object.entries(trainsObj)) {
      if (!train || typeof train !== 'object') continue;

      const stops = train.stops && typeof train.stops === 'object' ? train.stops : {};
      const canceledStops = Array.isArray(train.canceled_stops)
        ? train.canceled_stops
        : (Array.isArray(train.canceledStops) ? train.canceledStops : []);
      const statusRaw = String(train.status || '').toUpperCase();

      let touchesSegment = false;
      let maxDelayMin = 0;
      let canceledHits = 0;

      for (const [name, delayValue] of Object.entries(stops)) {
        if (!stationSet.has(normalize(name))) continue;
        touchesSegment = true;
        const delay = Number(delayValue);
        if (Number.isFinite(delay) && delay > maxDelayMin) maxDelayMin = delay;
      }

      for (const canceledStop of canceledStops) {
        if (!stationSet.has(normalize(stopName(canceledStop)))) continue;
        touchesSegment = true;
        canceledHits += 1;
      }

      if (!touchesSegment) continue;

      const hasCanceledList = canceledStops.length > 0;
      const partial = statusRaw.includes('PARTIAL') && (canceledHits > 0 || !hasCanceledList);
      const canceled = isFullyCanceled(statusRaw);
      const delayed = !canceled && !partial && maxDelayMin > 0;
      const state = canceled ? 'canceled' : partial ? 'partial' : delayed ? 'delayed' : 'ontime';

      canceledStopsInSegment += canceledHits;
      records.push({
        trainNumber: trainNumberFrom(entryKey, train),
        state,
        maxDelayMin,
        canceledHits,
        statusRaw
      });
    }

    const totals = {
      total: records.length,
      onTime: records.filter((item) => item.state === 'ontime').length,
      delayed: records.filter((item) => item.state === 'delayed').length,
      partial: records.filter((item) => item.state === 'partial').length,
      canceled: records.filter((item) => item.state === 'canceled').length,
      maxDelayMin: records.reduce((max, item) => Math.max(max, item.maxDelayMin || 0), 0),
      canceledStopsInSegment
    };

    // Les statistiques de référence du badge sont réutilisées si la fonction
    // actuelle d'index.html est disponible : le panneau explique donc exactement
    // le même calcul que celui qui colore la ligne.
    try {
      if (typeof window.__lbBuildTrafficSegmentStats === 'function') {
        const base = window.__lbBuildTrafficSegmentStats(raw, segment.stations);
        if (base && Number(base.total) >= 0) {
          totals.badgeTotal = Number(base.total || 0);
          totals.badgeDelayed = Number(base.delayed || 0);
          totals.badgeMaxDelayMin = Number(base.maxDelayMin || 0);
          totals.badgePartial = Number(base.partialCount || 0);
          totals.badgeCanceledStops = Number(base.canceledStopsInSegment || 0);
        }
      }
    } catch (_) {}

    totals.records = records;
    return totals;
  }

  function getBadgeState(segment) {
    const badge = document.getElementById(segment.badgeId);
    const row = badge?.closest('.traffic-split-row');
    const level = row?.dataset?.trafficLevel ||
      ['red', 'orange', 'yellow', 'green', 'loading'].find((name) => badge?.classList.contains(`traffic-pill--${name}`)) ||
      'loading';
    return {
      level,
      label: String(badge?.textContent || 'Données indisponibles').trim()
    };
  }

  function formatTrainState(record) {
    if (record.state === 'canceled') return { label: 'Supprimé', className: 'is-canceled' };
    if (record.state === 'partial') return { label: 'Partiel', className: 'is-partial' };
    if (record.state === 'delayed') return { label: `+${Math.max(1, Math.round(record.maxDelayMin))} min`, className: 'is-delayed' };
    return { label: 'À l’heure', className: 'is-ontime' };
  }

  function affectedRecords(stats) {
    if (!stats?.records) return [];
    const priority = { canceled: 0, partial: 1, delayed: 2, ontime: 3 };
    return stats.records
      .filter((item) => item.state !== 'ontime')
      .sort((a, b) => (priority[a.state] - priority[b.state]) || ((b.maxDelayMin || 0) - (a.maxDelayMin || 0)))
      .slice(0, 8);
  }

  function explainBadge(stats, badgeState) {
    if (!stats) return 'Les données détaillées ne sont pas disponibles pour le moment.';

    const total = Number.isFinite(stats.badgeTotal) ? stats.badgeTotal : stats.total;
    const delayed = Number.isFinite(stats.badgeDelayed) ? stats.badgeDelayed : stats.delayed;
    const maxDelay = Number.isFinite(stats.badgeMaxDelayMin) ? stats.badgeMaxDelayMin : stats.maxDelayMin;
    const partial = Number.isFinite(stats.badgePartial) ? stats.badgePartial : stats.partial;
    const canceledStops = Number.isFinite(stats.badgeCanceledStops) ? stats.badgeCanceledStops : stats.canceledStopsInSegment;

    if (partial > 0) {
      const parts = [`${partial} suppression${partial > 1 ? 's' : ''} partielle${partial > 1 ? 's' : ''}`];
      if (canceledStops > 0) parts.push(`${canceledStops} arrêt${canceledStops > 1 ? 's' : ''} supprimé${canceledStops > 1 ? 's' : ''}`);
      return parts.join(' · ');
    }
    if (badgeState.level === 'green') return total ? `Aucun retard détecté sur ${total} train${total > 1 ? 's' : ''} suivi${total > 1 ? 's' : ''}.` : 'Aucun train exploitable dans le snapshot actuel.';
    if (badgeState.level === 'yellow') return `${delayed}/${total} train${total > 1 ? 's' : ''} retardé${delayed > 1 ? 's' : ''} · retard max +${Math.round(maxDelay)} min.`;
    if (delayed > 0) return `${delayed}/${total} train${total > 1 ? 's' : ''} retardé${delayed > 1 ? 's' : ''} · retard max +${Math.round(maxDelay)} min.`;
    return 'Le statut est issu du snapshot GTFS-RT actuellement chargé.';
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'lbTrafficDetailModal';
    modal.className = 'lb-traffic-detail-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="lb-traffic-detail-panel" role="dialog" aria-modal="true" aria-labelledby="lbTrafficDetailTitle">
        <div class="lb-traffic-detail-grab" aria-hidden="true"></div>
        <header class="lb-traffic-detail-head">
          <div>
            <div class="lb-traffic-detail-kicker">INFO TRAFIC · GTFS-RT</div>
            <h3 id="lbTrafficDetailTitle">Détail du trafic</h3>
          </div>
          <button type="button" class="lb-traffic-detail-close" data-lb-traffic-close aria-label="Fermer">×</button>
        </header>
        <div id="lbTrafficDetailBody" class="lb-traffic-detail-body"></div>
      </div>`;
    document.body.append(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-lb-traffic-close]')) closeModal();

      const live = event.target.closest('[data-lb-traffic-live]');
      if (live) {
        event.preventDefault();
        closeModal();
        window.setTimeout(() => {
          if (window.lbCommunityLive?.openLive) window.lbCommunityLive.openLive();
          else document.getElementById('lbOpenLiveModal')?.click();
        }, 30);
      }

      const map = event.target.closest('[data-lb-traffic-map]');
      if (map) {
        event.preventDefault();
        closeModal();
        window.setTimeout(() => {
          const mapNav = document.querySelector('.bottom-nav__item[href="#carte"], a[href="#carte"]');
          if (mapNav) mapNav.click();
          else window.location.hash = '#carte';
        }, 30);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!modal?.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = qsa('button:not([disabled]), a[href]', modal).filter((el) => !el.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    return modal;
  }

  function renderLoading(segment, badgeState) {
    const body = qs('#lbTrafficDetailBody', ensureModal());
    if (!body) return;
    qs('#lbTrafficDetailTitle', modal).textContent = segment.label;
    body.innerHTML = `
      <div class="lb-traffic-detail-status lb-level-${badgeState.level}">
        <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(badgeState.label)}</strong>
      </div>
      <div class="lb-traffic-detail-loading">Lecture du même flux GTFS-RT que l’indicateur de l’accueil…</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function metric(value, label, state) {
    return `<div class="lb-traffic-metric ${state ? `is-${state}` : ''}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function renderDetail(segment, stats, badgeState) {
    const body = qs('#lbTrafficDetailBody', ensureModal());
    if (!body) return;
    qs('#lbTrafficDetailTitle', modal).textContent = segment.label;

    if (!stats) {
      body.innerHTML = `
        <div class="lb-traffic-detail-status lb-level-${badgeState.level}">
          <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(badgeState.label)}</strong>
        </div>
        <div class="lb-traffic-detail-unavailable">
          <strong>Détail GTFS-RT momentanément indisponible.</strong>
          <span>L’indicateur de l’accueil reste affiché avec la dernière donnée disponible.</span>
        </div>
        ${renderActions()}`;
      return;
    }

    const affected = affectedRecords(stats);
    const totalLabel = stats.total > 1 ? 'trains suivis' : 'train suivi';
    const partialMetric = stats.partial > 0 ? metric(stats.partial, 'partiel' + (stats.partial > 1 ? 's' : ''), 'partial') : '';

    const affectedHtml = affected.length
      ? `<section class="lb-traffic-affected" aria-label="Trains perturbés">
          <div class="lb-traffic-section-title">À surveiller maintenant</div>
          <div class="lb-traffic-train-list">
            ${affected.map((record) => {
              const state = formatTrainState(record);
              return `<div class="lb-traffic-train-row">
                <span class="lb-traffic-train-number">TER ${escapeHtml(record.trainNumber)}</span>
                <span class="lb-traffic-train-state ${state.className}">${escapeHtml(state.label)}</span>
              </div>`;
            }).join('')}
          </div>
          ${stats.records.filter((item) => item.state !== 'ontime').length > affected.length ? `<div class="lb-traffic-more-count">+ ${stats.records.filter((item) => item.state !== 'ontime').length - affected.length} autre(s) train(s) perturbé(s)</div>` : ''}
        </section>`
      : `<div class="lb-traffic-all-good"><span aria-hidden="true">✓</span> Aucun train perturbé détecté sur ce tronçon dans le snapshot actuel.</div>`;

    body.innerHTML = `
      <div class="lb-traffic-detail-status lb-level-${badgeState.level}">
        <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(badgeState.label)}</strong>
      </div>

      <div class="lb-traffic-explainer">
        <span>Ce que voit l’indicateur</span>
        <strong>${escapeHtml(explainBadge(stats, badgeState))}</strong>
      </div>

      <div class="lb-traffic-metrics">
        ${metric(stats.total, totalLabel, 'total')}
        ${metric(stats.onTime, 'à l’heure', 'ontime')}
        ${metric(stats.delayed, 'en retard', 'delayed')}
        ${metric(stats.canceled, 'supprimé' + (stats.canceled > 1 ? 's' : ''), 'canceled')}
        ${partialMetric}
      </div>

      ${affectedHtml}

      <div class="lb-traffic-source-note">
        <strong>Source : GTFS-RT SNCF</strong> via le proxy La Bétaillère. Même snapshot que celui utilisé pour colorer ce tronçon. Metz reste hors des deux groupes de calcul afin d’éviter le double comptage, comme dans l’indicateur actuel.
      </div>

      ${renderActions()}`;
  }

  function renderActions() {
    return `
      <div class="lb-traffic-detail-actions">
        <button type="button" class="lb-traffic-action lb-traffic-action--live" data-lb-traffic-live>
          <span aria-hidden="true">●</span><span>Voir les trains LIVE</span>
        </button>
        <button type="button" class="lb-traffic-action lb-traffic-action--map" data-lb-traffic-map>
          <span aria-hidden="true">◎</span><span>Voir sur la carte</span>
        </button>
      </div>`;
  }

  async function refreshSourceIfNeeded() {
    if (getTrainsObject(getCurrentRaw())) return;

    try {
      if (typeof window.updateHomeTrafficStatus === 'function') {
        await Promise.race([
          Promise.resolve(window.updateHomeTrafficStatus()),
          new Promise((resolve) => window.setTimeout(resolve, 1800))
        ]);
      } else if (typeof window.loadGtfsRetards === 'function') {
        await Promise.race([
          Promise.resolve(window.loadGtfsRetards({ forceFresh: false, useCachedFirst: true })),
          new Promise((resolve) => window.setTimeout(resolve, 1800))
        ]);
      }
    } catch (_) {}
  }

  async function openSegment(segmentKey) {
    const segment = SEGMENTS[segmentKey];
    if (!segment) return;

    activeSegmentKey = segmentKey;
    previousFocus = document.activeElement;
    const currentModal = ensureModal();
    const badgeState = getBadgeState(segment);

    renderLoading(segment, badgeState);
    currentModal.classList.add('is-open');
    currentModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lb-traffic-detail-open');
    qs('[data-lb-traffic-close]', currentModal)?.focus({ preventScroll: true });

    await refreshSourceIfNeeded();
    if (activeSegmentKey !== segmentKey || !currentModal.classList.contains('is-open')) return;

    const raw = getCurrentRaw();
    const stats = analyzeSegment(raw, segment);
    renderDetail(segment, stats, getBadgeState(segment));
  }

  function closeModal() {
    if (!modal) return;
    activeSegmentKey = '';
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-traffic-detail-open');
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }

  function enhanceRow(segmentKey, segment) {
    const badge = document.getElementById(segment.badgeId);
    const row = badge?.closest('.traffic-split-row');
    if (!row || row.dataset.lbTrafficDetails === '1') return;

    row.dataset.lbTrafficDetails = '1';
    row.dataset.lbTrafficSegment = segmentKey;
    row.classList.add('lb-traffic-row-action');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-haspopup', 'dialog');
    row.setAttribute('title', `Voir le détail GTFS-RT : ${segment.shortLabel}`);

    const chevron = document.createElement('span');
    chevron.className = 'lb-traffic-row-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.append(chevron);

    row.addEventListener('click', () => openSegment(segmentKey));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openSegment(segmentKey);
    });
  }

  function enhanceRows() {
    Object.entries(SEGMENTS).forEach(([key, segment]) => enhanceRow(key, segment));
  }

  function init() {
    enhanceRows();
    ensureModal();

    const host = document.getElementById('homeTrafficRows');
    if (host) {
      new MutationObserver(enhanceRows).observe(host, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.lbTrafficDetails = Object.freeze({
    open: openSegment,
    close: closeModal,
    analyze: (segmentKey) => SEGMENTS[segmentKey] ? analyzeSegment(getCurrentRaw(), SEGMENTS[segmentKey]) : null
  });
})();
