/* La Bétaillère — détail Info trafic v4 : fenêtre réellement actuelle */
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

  const STATIC_SUMMARY_URL = 'https://vps.labetaillere.fr/api/train-static-summary';
  const CURRENT_LOOKAHEAD_MIN = 90;
  const CURRENT_GRACE_MIN = 30;
  const timetableCache = new Map();
  let timetablePromise = null;
  let badgeRefreshPromise = null;
  let badgeRefreshTimer = 0;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function normalize(value) {
    return clean(value)
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

    const entries = Object.entries(raw);
    if (entries.some(([, value]) => value && typeof value === 'object' && (value.stops || value.status))) {
      return raw;
    }
    return null;
  }

  function trainNumberFrom(key, train) {
    const direct = train?.train_number || train?.trainNumber || train?.number || train?.trip_short_name || train?.tripShortName;
    if (direct) return String(direct);
    const match = String(key || '').match(/\b\d{4,6}\b/);
    return match ? match[0] : String(key || 'Train');
  }

  function isFullyCanceled(status) {
    if (status.includes('PARTIAL')) return false;
    return status.includes('CANCEL') || status.includes('SUPPR') || status.includes('DELETED');
  }

  function analyzeSegment(raw, segment) {
    const trains = getTrainsObject(raw);
    if (!trains) return null;

    const stationSet = new Set(segment.stations.map(normalize));
    const records = [];

    for (const [key, train] of Object.entries(trains)) {
      if (!train || typeof train !== 'object') continue;

      const stops = train.stops && typeof train.stops === 'object' ? train.stops : {};
      const canceledStops = Array.isArray(train.canceled_stops)
        ? train.canceled_stops
        : (Array.isArray(train.canceledStops) ? train.canceledStops : []);
      const status = String(train.status || '').toUpperCase();

      let touches = false;
      let maxDelayMin = 0;
      let canceledHits = 0;

      for (const [name, delayValue] of Object.entries(stops)) {
        if (!stationSet.has(normalize(name))) continue;
        touches = true;
        const delay = Number(delayValue);
        if (Number.isFinite(delay) && delay > maxDelayMin) maxDelayMin = delay;
      }

      for (const canceledStop of canceledStops) {
        if (!stationSet.has(normalize(stopName(canceledStop)))) continue;
        touches = true;
        canceledHits += 1;
      }

      if (!touches) continue;

      const partial = status.includes('PARTIAL') && (canceledHits > 0 || canceledStops.length === 0);
      const canceled = isFullyCanceled(status);
      const delayed = !canceled && !partial && maxDelayMin > 0;
      const state = canceled ? 'canceled' : partial ? 'partial' : delayed ? 'delayed' : 'ontime';
      const routeStops = Object.keys(stops || {}).filter(Boolean);
      const origin = clean(train.origin || train.from || routeStops[0] || '');
      const destination = clean(train.destination || train.to || routeStops[routeStops.length - 1] || '');

      records.push({
        trainNumber: trainNumberFrom(key, train),
        state,
        maxDelayMin,
        origin,
        destination
      });
    }

    return {
      total: records.length,
      onTime: records.filter((item) => item.state === 'ontime').length,
      delayed: records.filter((item) => item.state === 'delayed').length,
      canceled: records.filter((item) => item.state === 'canceled').length,
      partial: records.filter((item) => item.state === 'partial').length,
      records
    };
  }

  function getBadgeState(segment) {
    const badge = document.getElementById(segment.badgeId);
    const row = badge?.closest('.traffic-split-row');
    const level = row?.dataset?.trafficLevel ||
      ['red', 'orange', 'yellow', 'green', 'loading'].find((name) => badge?.classList.contains(`traffic-pill--${name}`)) ||
      'loading';
    return { level, label: clean(badge?.textContent || 'Situation en cours') };
  }

  function formatTrainState(record) {
    if (record.state === 'canceled') return { label: 'Supprimé', className: 'is-canceled' };
    if (record.state === 'partial') return { label: 'Supprimé partiel', className: 'is-partial' };
    if (record.state === 'delayed') return { label: `+${Math.max(1, Math.round(record.maxDelayMin))} min`, className: 'is-delayed' };
    return { label: 'À l’heure', className: 'is-ontime' };
  }

  function affectedRecords(stats) {
    const priority = { canceled: 0, partial: 1, delayed: 2, ontime: 3 };
    return (stats?.records || [])
      .filter((item) => item.state !== 'ontime')
      .sort((a, b) => (priority[a.state] - priority[b.state]) || ((b.maxDelayMin || 0) - (a.maxDelayMin || 0)));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatClock(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : '';
  }

  function clockToMinutes(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 47 || minute < 0 || minute > 59) return null;
    return (hour * 60) + minute;
  }

  function luxNowMinutes(date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Luxembourg',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(date);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
      return (hour * 60) + minute;
    } catch (_) {
      return (date.getHours() * 60) + date.getMinutes();
    }
  }

  function scheduleInCurrentWindow(schedule, nowMin = luxNowMinutes()) {
    if (!schedule || typeof schedule !== 'object') return true;

    let departure = clockToMinutes(schedule.departure);
    let arrival = clockToMinutes(schedule.arrival);
    if (departure == null && arrival == null) return true;
    if (departure == null) departure = arrival;
    if (arrival == null) arrival = departure;
    if (arrival < departure) arrival += 24 * 60;

    // « Situation actuelle » = trains en parcours, arrivés depuis moins de 30 min,
    // ou dont le départ est prévu dans les 90 prochaines minutes.
    return departure <= (nowMin + CURRENT_LOOKAHEAD_MIN) &&
      arrival >= (nowMin - CURRENT_GRACE_MIN);
  }

  function summarizeRecords(records) {
    const list = Array.isArray(records) ? records : [];
    return {
      total: list.length,
      onTime: list.filter((item) => item.state === 'ontime').length,
      delayed: list.filter((item) => item.state === 'delayed').length,
      canceled: list.filter((item) => item.state === 'canceled').length,
      partial: list.filter((item) => item.state === 'partial').length,
      maxDelayMin: list.reduce((max, item) => Math.max(max, Number(item?.maxDelayMin || 0)), 0),
      records: list
    };
  }

  function currentWindowStats(stats, nowMin = luxNowMinutes()) {
    if (!stats) return null;
    const records = (stats.records || []).filter((record) => {
      const schedule = timetableCache.get(String(record?.trainNumber || ''));
      return scheduleInCurrentWindow(schedule, nowMin);
    });
    return summarizeRecords(records);
  }

  function pickCurrentBadgeState(stats) {
    if (!stats) return { level: 'loading', label: 'Données indisponibles' };
    if (!stats.total) return { level: 'green', label: 'Aucun train actuellement' };

    if (typeof window.__lbPickTrafficLevel === 'function') {
      try {
        return window.__lbPickTrafficLevel({
          total: stats.total,
          delayed: stats.delayed,
          maxDelayMin: stats.maxDelayMin,
          partialCount: stats.partial,
          canceledCount: stats.canceled
        });
      } catch (_) {}
    }

    const impacted = stats.delayed + stats.partial + stats.canceled;
    if (!impacted) return { level: 'green', label: 'Trafic fluide' };
    if (stats.partial + stats.canceled >= 2 || impacted >= 3) return { level: 'orange', label: 'Trafic perturbé' };
    return { level: 'yellow', label: 'Trafic ralenti' };
  }

  function applyCurrentBadgeState(segment, state) {
    const badge = document.getElementById(segment.badgeId);
    if (!badge) return;

    if (typeof window.__lbSetTrafficBadge === 'function') {
      try {
        window.__lbSetTrafficBadge(badge, state);
        return;
      } catch (_) {}
    }

    const level = state?.level || 'loading';
    badge.classList.remove('traffic-pill--loading', 'traffic-pill--green', 'traffic-pill--yellow', 'traffic-pill--orange', 'traffic-pill--red');
    badge.classList.add(`traffic-pill--${level}`);
    badge.textContent = state?.label || 'Données indisponibles';
    const row = badge.closest('.traffic-split-row');
    if (row) {
      row.dataset.trafficLevel = level;
      row.classList.remove('traffic-row--loading', 'traffic-row--green', 'traffic-row--yellow', 'traffic-row--orange', 'traffic-row--red');
      row.classList.add(`traffic-row--${level}`);
    }
  }

  async function refreshCurrentTrafficBadges() {
    if (badgeRefreshPromise) return badgeRefreshPromise;

    badgeRefreshPromise = (async () => {
      const raw = getCurrentRaw();
      if (!getTrainsObject(raw)) return;

      const analyses = Object.entries(SEGMENTS).map(([key, segment]) => ({
        key,
        segment,
        stats: analyzeSegment(raw, segment)
      }));
      const allRecords = analyses.flatMap((entry) => entry.stats?.records || []);
      await loadTimetableFor(allRecords);
      const nowMin = luxNowMinutes();

      analyses.forEach((entry) => {
        const currentStats = currentWindowStats(entry.stats, nowMin);
        applyCurrentBadgeState(entry.segment, pickCurrentBadgeState(currentStats));
      });
    })().finally(() => {
      badgeRefreshPromise = null;
    });

    return badgeRefreshPromise;
  }

  function queueCurrentTrafficBadgeRefresh(delay = 0) {
    window.clearTimeout(badgeRefreshTimer);
    badgeRefreshTimer = window.setTimeout(() => {
      refreshCurrentTrafficBadges().catch(() => {});
    }, Math.max(0, Number(delay || 0)));
  }

  function routeHtml(record, schedule = null) {
    const origin = clean(schedule?.origin || record?.origin || '');
    const destination = clean(schedule?.destination || record?.destination || '');
    if (!origin || !destination) return '';

    const departure = formatClock(schedule?.departure);
    const arrival = formatClock(schedule?.arrival);

    return `
      <span class="lb-traffic-route-origin">${escapeHtml(origin)}</span>
      ${departure ? `<time class="lb-traffic-route-time" datetime="${escapeHtml(departure)}">${escapeHtml(departure)}</time>` : ''}
      <span class="lb-traffic-route-arrow" aria-hidden="true">→</span>
      <span class="lb-traffic-route-destination">${escapeHtml(destination)}</span>
      ${arrival ? `<time class="lb-traffic-route-time" datetime="${escapeHtml(arrival)}">${escapeHtml(arrival)}</time>` : ''}
    `;
  }

  async function loadTimetableFor(records) {
    const numbers = (records || [])
      .map((record) => String(record?.trainNumber || '').replace(/\D/g, ''))
      .filter((number, index, array) => /^\d{4,6}$/.test(number) && array.indexOf(number) === index);

    const missing = numbers.filter((number) => !timetableCache.has(number));
    if (!missing.length) return timetableCache;

    const requestNumbers = missing.slice(0, 50);
    const url = `${STATIC_SUMMARY_URL}?trains=${encodeURIComponent(requestNumbers.join(','))}`;

    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      Object.entries(payload?.trains || {}).forEach(([number, row]) => {
        if (!row || typeof row !== 'object') return;
        timetableCache.set(String(number), {
          origin: clean(row.origin),
          destination: clean(row.destination),
          departure: formatClock(row.departure),
          arrival: formatClock(row.arrival)
        });
      });
      requestNumbers.forEach((number) => {
        if (!timetableCache.has(number)) timetableCache.set(number, null);
      });
    } catch (_) {
      // La modale reste immédiatement utilisable avec origine/terminus temps réel.
    }

    return timetableCache;
  }

  async function hydrateAffectedRoutes(segmentKey, records) {
    if (!records?.length) return;
    if (timetablePromise) {
      try { await timetablePromise; } catch (_) {}
    }

    timetablePromise = loadTimetableFor(records);
    try {
      await timetablePromise;
    } finally {
      timetablePromise = null;
    }

    if (activeSegmentKey !== segmentKey || !modal?.classList.contains('is-open')) return;

    records.forEach((record) => {
      const number = String(record?.trainNumber || '');
      const route = modal.querySelector(`[data-lb-traffic-route="${CSS.escape(number)}"]`);
      if (!route) return;
      const html = routeHtml(record, timetableCache.get(number));
      if (html) route.innerHTML = html;
    });
  }

  /*
   * Le point important de cette version : on ne recrée plus les composants.
   * On clone ceux du vrai modal « Mes préférences » et on copie leur style calculé.
   */
  function preferencesRoot() {
    return document.getElementById('profilePrefsModal');
  }

  function findExactText(root, selector, regexp) {
    if (!root) return null;
    return qsa(selector, root).find((el) => regexp.test(clean(el.textContent))) || null;
  }

  function templates() {
    const root = preferencesRoot();
    if (!root) return {};

    const title = findExactText(root, 'h1,h2,h3,h4', /^Mes préférences$/i);
    const subtitle = findExactText(
      root,
      'p,small,.modal-subtitle,.auth-subtitle',
      /^Organise tes préférences par rubrique\.?$/i
    );
    const close = root.querySelector(
      '.tron-close-button, .auth-close, button[aria-label*="Fermer" i], button[title*="Fermer" i]'
    ) || qsa('button', root).find((button) => /^[×✕x]$/i.test(clean(button.textContent)));
    const action = qsa('button', root).find((button) => /^Gérer mes listes de trains$/i.test(clean(button.textContent).replace(/^🚇\s*/, ''))) ||
      qsa('button', root).find((button) => /Gérer mes favoris|Notifications \(bêta\)|Mon profil/i.test(clean(button.textContent)));
    const panel = title?.closest('.lb-auth-card, .lb-auth-modal, [role="dialog"]') ||
      root.querySelector('.lb-auth-card, .lb-auth-modal, [role="dialog"]');

    return { title, subtitle, close, action, panel };
  }

  function scrubClone(node) {
    if (!(node instanceof Element)) return node;
    [node, ...qsa('*', node)].forEach((el) => {
      el.removeAttribute('id');
      el.removeAttribute('onclick');
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-expanded');
      Array.from(el.attributes || []).forEach((attr) => {
        if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
      });
    });
    node.hidden = false;
    node.removeAttribute('hidden');
    node.removeAttribute('disabled');
    return node;
  }

  function copyComputed(source, target, properties) {
    if (!source || !target || !window.getComputedStyle) return;
    const style = window.getComputedStyle(source);
    properties.forEach((property) => {
      const value = style.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    });
  }

  const TEXT_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-transform', 'color', 'text-shadow', 'margin'
  ];

  const BUTTON_PROPS = [
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'color', 'background', 'background-color', 'border', 'border-radius',
    'box-shadow', 'min-height', 'height', 'padding', 'display', 'align-items',
    'justify-content', 'gap', 'text-align', 'cursor'
  ];

  function makeTitle(text) {
    const source = templates().title;
    const title = source ? scrubClone(source.cloneNode(true)) : document.createElement('h2');
    if (source) copyComputed(source, title, TEXT_PROPS);
    else title.className = 'lb-traffic-fallback-title';
    title.id = 'lbTrafficDetailTitle';
    title.textContent = text;
    return title;
  }

  function makeSubtitle() {
    const source = templates().subtitle;
    const subtitle = source ? scrubClone(source.cloneNode(true)) : document.createElement('p');
    if (source) copyComputed(source, subtitle, TEXT_PROPS);
    else subtitle.className = 'lb-traffic-fallback-subtitle';
    subtitle.textContent = 'Situation actuelle sur ce tronçon.';
    subtitle.classList.add('lb-traffic-detail-subtitle');
    return subtitle;
  }

  function makeClose() {
    const source = templates().close;
    let button = source ? scrubClone(source.cloneNode(true)) : document.createElement('button');

    if (!(button instanceof HTMLButtonElement)) {
      const replacement = document.createElement('button');
      replacement.className = button.className;
      replacement.innerHTML = button.innerHTML || '×';
      button = replacement;
    }

    if (source) {
      copyComputed(source, button, [
        ...BUTTON_PROPS, 'width', 'min-width', 'max-width', 'aspect-ratio'
      ]);
    } else {
      button.className = 'tron-close-button auth-close';
      button.textContent = '×';
    }

    button.type = 'button';
    button.setAttribute('aria-label', 'Fermer');
    button.setAttribute('data-lb-traffic-close', '');
    button.classList.add('lb-traffic-pref-close');
    return button;
  }

  function makeAction(label, dataAttribute) {
    const source = templates().action;
    let button = source ? scrubClone(source.cloneNode(true)) : document.createElement('button');

    if (!(button instanceof HTMLButtonElement)) {
      const replacement = document.createElement('button');
      replacement.className = button.className;
      button = replacement;
    }

    if (source) copyComputed(source, button, BUTTON_PROPS);
    else button.className = 'lb-traffic-fallback-action';

    button.type = 'button';
    button.textContent = label;
    button.setAttribute(dataAttribute, '');
    button.classList.add('lb-traffic-pref-action');
    return button;
  }

  function applyPanelLook(panel) {
    const source = templates().panel;
    if (!source) return;
    copyComputed(source, panel, [
      'font-family', 'color', 'background', 'background-color',
      'border', 'border-radius', 'box-shadow'
    ]);
  }

  function rebuildChrome() {
    if (!modal) return;
    const panel = qs('.lb-traffic-detail-panel', modal);
    const head = qs('.lb-traffic-detail-head', modal);
    if (!panel || !head) return;

    applyPanelLook(panel);
    const titleText = clean(qs('#lbTrafficDetailTitle', head)?.textContent || 'Info trafic');

    const copy = document.createElement('div');
    copy.className = 'lb-traffic-detail-head-copy';
    copy.append(makeTitle(titleText), makeSubtitle());
    head.replaceChildren(copy, makeClose());
  }

  function ensureModal() {
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'lbTrafficDetailModal';
    modal.className = 'auth-overlay lb-traffic-detail-modal';
    modal.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'lb-auth-modal lb-auth-card lb-traffic-detail-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'lbTrafficDetailTitle');

    const head = document.createElement('header');
    head.className = 'lb-traffic-detail-head';

    const body = document.createElement('div');
    body.id = 'lbTrafficDetailBody';
    body.className = 'lb-traffic-detail-body';

    panel.append(head, body);
    modal.append(panel);
    document.body.append(modal);
    rebuildChrome();

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-lb-traffic-close]')) {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }

      const trainButton = event.target.closest('[data-lb-traffic-train]');
      if (trainButton) {
        event.preventDefault();
        event.stopPropagation();
        const number = clean(trainButton.getAttribute('data-lb-traffic-train'));
        if (!number) return;
        closeModal();
        window.setTimeout(() => {
          if (typeof window.lbOpenTrainProfile === 'function') {
            Promise.resolve(window.lbOpenTrainProfile(number)).catch(() => {});
          } else if (typeof window.lbOpenTrainDetail === 'function') {
            Promise.resolve(window.lbOpenTrainDetail(number)).catch(() => {});
          }
        }, 30);
        return;
      }

      if (event.target.closest('[data-lb-traffic-live]')) {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        window.setTimeout(() => {
          if (window.lbCommunityLive?.openLive) window.lbCommunityLive.openLive();
          else document.getElementById('lbOpenLiveModal')?.click();
        }, 30);
        return;
      }

      if (event.target.closest('[data-lb-traffic-map]')) {
        event.preventDefault();
        event.stopPropagation();
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

  function setTitle(segment) {
    const title = qs('#lbTrafficDetailTitle', modal);
    if (title) title.textContent = `Info trafic · ${segment.shortLabel}`;
  }

  function appendActions(body) {
    const actions = document.createElement('div');
    actions.className = 'lb-traffic-detail-actions';
    actions.append(
      makeAction('👥  LIVE voyageurs', 'data-lb-traffic-live'),
      makeAction('🗺️  Voir sur la carte', 'data-lb-traffic-map')
    );
    body.append(actions);
  }

  function metric(value, label, state) {
    return `<div class="lb-traffic-metric is-${state}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function renderLoading(segment, badgeState) {
    const body = qs('#lbTrafficDetailBody', ensureModal());
    setTitle(segment);
    body.innerHTML = `
      <div class="lb-traffic-summary-card lb-level-${badgeState.level}">
        <div class="lb-traffic-summary-top">
          <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(badgeState.label)}</strong>
        </div>
        <p class="lb-traffic-detail-loading">Actualisation de la situation…</p>
      </div>`;
  }

  function renderDetail(segment, stats, badgeState) {
    const body = qs('#lbTrafficDetailBody', ensureModal());
    setTitle(segment);

    if (!stats) {
      body.innerHTML = `
        <div class="lb-traffic-summary-card lb-level-${badgeState.level}">
          <div class="lb-traffic-summary-top">
            <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(badgeState.label)}</strong>
          </div>
          <p>Les détails sont momentanément indisponibles. Réessaie dans quelques instants.</p>
        </div>`;
      appendActions(body);
      return;
    }

    const affected = affectedRecords(stats);
    const affectedHtml = affected.length
      ? `<section class="lb-traffic-affected" aria-label="Trains impactés">
          <div class="lb-traffic-section-title">Trains impactés</div>
          <div class="lb-traffic-train-list">
            ${affected.map((record) => {
              const state = formatTrainState(record);
              const initialRoute = routeHtml(record, timetableCache.get(String(record.trainNumber)));
              return `<button type="button" class="lb-traffic-train-row" data-lb-traffic-train="${escapeHtml(record.trainNumber)}" aria-label="Ouvrir la fiche du TER ${escapeHtml(record.trainNumber)}">
                <span class="lb-traffic-train-copy">
                  <span class="lb-traffic-train-number">TER ${escapeHtml(record.trainNumber)}</span>
                  ${initialRoute ? `<span class="lb-traffic-train-route" data-lb-traffic-route="${escapeHtml(record.trainNumber)}">${initialRoute}</span>` : ''}
                </span>
                <span class="lb-traffic-train-state ${state.className}">${escapeHtml(state.label)}</span>
              </button>`;
            }).join('')}
          </div>
        </section>`
      : `<div class="lb-traffic-all-good"><strong>✓ Aucun train impacté actuellement.</strong></div>`;

    body.innerHTML = `
      <div class="lb-traffic-summary-card lb-level-${badgeState.level}">
        <div class="lb-traffic-summary-top">
          <span class="lb-traffic-detail-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(badgeState.label)}</strong>
        </div>
        <div class="lb-traffic-summary-count"><strong>${stats.total}</strong> train${stats.total > 1 ? 's' : ''} suivi${stats.total > 1 ? 's' : ''} sur ce tronçon</div>
      </div>

      <div class="lb-traffic-metrics" aria-label="État des trains">
        ${metric(stats.onTime, 'À l’heure', 'ontime')}
        ${metric(stats.delayed, 'En retard', 'delayed')}
        ${metric(stats.canceled, 'Supprimé' + (stats.canceled > 1 ? 's' : ''), 'canceled')}
        ${metric(stats.partial, 'Suppr. partielle' + (stats.partial > 1 ? 's' : ''), 'partial')}
      </div>

      ${affectedHtml}`;

    appendActions(body);
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
    rebuildChrome();

    const badgeState = getBadgeState(segment);
    renderLoading(segment, badgeState);
    currentModal.classList.add('is-open');
    currentModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lb-traffic-detail-open');
    qs('[data-lb-traffic-close]', currentModal)?.focus({ preventScroll: true });

    await refreshSourceIfNeeded();
    if (activeSegmentKey !== segmentKey || !currentModal.classList.contains('is-open')) return;

    const allStats = analyzeSegment(getCurrentRaw(), segment);

    // Affichage immédiat avec les données déjà présentes en mémoire.
    let stats = currentWindowStats(allStats);
    let currentBadgeState = pickCurrentBadgeState(stats);
    applyCurrentBadgeState(segment, currentBadgeState);
    renderDetail(segment, stats, currentBadgeState);

    // Les horaires origine/terminus affinent ensuite la fenêtre actuelle sans
    // bloquer l'ouverture du panneau sur « Actualisation… ».
    if (allStats?.records?.length) {
      try { await loadTimetableFor(allStats.records); } catch (_) {}
      if (activeSegmentKey !== segmentKey || !currentModal.classList.contains('is-open')) return;
      stats = currentWindowStats(allStats);
      currentBadgeState = pickCurrentBadgeState(stats);
      applyCurrentBadgeState(segment, currentBadgeState);
      renderDetail(segment, stats, currentBadgeState);
    }

    const affected = affectedRecords(stats);
    if (affected.length) hydrateAffectedRoutes(segmentKey, affected);
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
    row.classList.add('lb-traffic-row-action');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-haspopup', 'dialog');
    row.setAttribute('aria-label', `${segment.shortLabel} : ouvrir le détail du trafic`);

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
    if (host) new MutationObserver(enhanceRows).observe(host, { childList: true, subtree: true });

    queueCurrentTrafficBadgeRefresh(120);
    window.addEventListener('gtfsrt:loaded', () => queueCurrentTrafficBadgeRefresh(30));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queueCurrentTrafficBadgeRefresh(50);
    });
    window.setInterval(() => {
      if (!document.hidden) queueCurrentTrafficBadgeRefresh(0);
    }, 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.lbTrafficDetails = Object.freeze({
    open: openSegment,
    close: closeModal,
    analyze: (segmentKey) => SEGMENTS[segmentKey]
      ? currentWindowStats(analyzeSegment(getCurrentRaw(), SEGMENTS[segmentKey]))
      : null,
    refreshCurrentTrafficBadges,
    scheduleInCurrentWindow,
    currentWindowStats,
    currentWindow: Object.freeze({ lookaheadMin: CURRENT_LOOKAHEAD_MIN, graceMin: CURRENT_GRACE_MIN })
  });
})();