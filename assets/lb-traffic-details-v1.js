/*
 * La Bétaillère — détail Info trafic v3
 *
 * Extension progressive de la carte « Info trafic » existante.
 * Le modal réutilise volontairement le langage visuel du modal
 * « Mes préférences » : titre, sous-titre, boutons et croix sont clonés
 * depuis les composants déjà présents dans index.html quand ils existent.
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

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

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

      records.push({
        trainNumber: trainNumberFrom(entryKey, train),
        state,
        maxDelayMin,
        canceledHits,
        statusRaw
      });
    }

    return {
      total: records.length,
      onTime: records.filter((item) => item.state === 'ontime').length,
      delayed: records.filter((item) => item.state === 'delayed').length,
      partial: records.filter((item) => item.state === 'partial').length,
      canceled: records.filter((item) => item.state === 'canceled').length,
      maxDelayMin: records.reduce((max, item) => Math.max(max, item.maxDelayMin || 0), 0),
      records
    };
  }

  function getBadgeState(segment) {
    const badge = document.getElementById(segment.badgeId);
    const row = badge?.closest('.traffic-split-row');
    const level = row?.dataset?.trafficLevel ||
      ['red', 'orange', 'yellow', 'green', 'loading'].find((name) => badge?.classList.contains(`traffic-pill--${name}`)) ||
      'loading';

    return {
      level,
      label: clean(badge?.textContent || 'Situation en cours')
    };
  }

  function formatTrainState(record) {
    if (record.state === 'canceled') return { label: 'Supprimé', className: 'is-canceled' };
    if (record.state === 'partial') return { label: 'Supprimé partiel', className: 'is-partial' };
    if (record.state === 'delayed') return { label: `+${Math.max(1, Math.round(record.maxDelayMin))} min`, className: 'is-delayed' };
    return { label: 'À l’heure', className: 'is-ontime' };
  }

  function affectedRecords(stats) {
    if (!stats?.records) return [];
    const priority = { canceled: 0, partial: 1, delayed: 2, ontime: 3 };
    return stats.records
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

  /* ===== Réutilisation réelle des composants de « Mes préférences » ===== */

  function preferencesModal() {
    return document.getElementById('profilePrefsModal');
  }

  function findTextElement(root, selector, regexp) {
    if (!root) return null;
    return qsa(selector, root).find((el) => regexp.test(clean(el.textContent))) || null;
  }

  function scrubClone(node) {
    if (!(node instanceof Element)) return node;
    const all = [node, ...qsa('*', node)];
    all.forEach((el) => {
      el.removeAttribute('id');
      el.removeAttribute('onclick');
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-expanded');
      for (const attr of Array.from(el.attributes || [])) {
        if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
      }
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

  const CLOSE_PROPS = [
    ...BUTTON_PROPS, 'width', 'min-width', 'max-width', 'aspect-ratio'
  ];

  function getPreferenceTemplates() {
    const root = preferencesModal();
    if (!root) return {};

    const title = findTextElement(root, 'h1,h2,h3,h4,.modal-title,.auth-title', /^Mes préférences$/i);
    const subtitle = findTextElement(root, 'p,.modal-subtitle,.auth-subtitle,div', /Organise tes préférences par rubrique/i);
    const close = root.querySelector('.tron-close-button, .auth-close, button[aria-label*="Fermer" i], button[title*="Fermer" i]') ||
      qsa('button', root).find((button) => /^[×✕x]$/i.test(clean(button.textContent)));

    const action = qsa('button', root).find((button) => /Gérer mes listes de trains/i.test(clean(button.textContent))) ||
      qsa('button', root).find((button) => /Gérer mes favoris|Notifications \(bêta\)|Mon profil/i.test(clean(button.textContent)));

    const panel = title?.closest('.lb-auth-card, .lb-auth-modal, [role="dialog"]') ||
      root.querySelector('.lb-auth-card, .lb-auth-modal, [role="dialog"]');

    return { root, title, subtitle, close, action, panel };
  }

  function makeTitle(text) {
    const templates = getPreferenceTemplates();
    let title;

    if (templates.title) {
      title = scrubClone(templates.title.cloneNode(true));
      copyComputed(templates.title, title, TEXT_PROPS);
    } else {
      title = document.createElement('h2');
      title.className = 'lb-traffic-fallback-title';
    }

    title.id = 'lbTrafficDetailTitle';
    title.textContent = text;
    return title;
  }

  function makeSubtitle() {
    const templates = getPreferenceTemplates();
    let subtitle;

    if (templates.subtitle) {
      subtitle = scrubClone(templates.subtitle.cloneNode(true));
      copyComputed(templates.subtitle, subtitle, TEXT_PROPS);
    } else {
      subtitle = document.createElement('p');
      subtitle.className = 'lb-traffic-fallback-subtitle';
    }

    subtitle.textContent = 'Situation actuelle sur ce tronçon.';
    subtitle.classList.add('lb-traffic-detail-subtitle');
    return subtitle;
  }

  function makeCloseButton() {
    const templates = getPreferenceTemplates();
    let button;

    if (templates.close) {
      button = scrubClone(templates.close.cloneNode(true));
      copyComputed(templates.close, button, CLOSE_PROPS);
    } else {
      button = document.createElement('button');
      button.className = 'tron-close-button auth-close';
      button.textContent = '×';
    }

    if (!(button instanceof HTMLButtonElement)) {
      const replacement = document.createElement('button');
      replacement.className = button.className;
      replacement.innerHTML = button.innerHTML || '×';
      button = replacement;
    }

    button.type = 'button';
    button.setAttribute('aria-label', 'Fermer');
    button.setAttribute('data-lb-traffic-close', '');
    button.classList.add('lb-traffic-pref-close');
    return button;
  }

  function makePreferenceAction(label, dataAttribute) {
    const templates = getPreferenceTemplates();
    let button;

    if (templates.action) {
      button = scrubClone(templates.action.cloneNode(true));
      copyComputed(templates.action, button, BUTTON_PROPS);
    } else {
      button = document.createElement('button');
      button.className = 'lb-traffic-fallback-action';
    }

    if (!(button instanceof HTMLButtonElement)) {
      const replacement = document.createElement('button');
      replacement.className = button.className;
      button = replacement;
    }

    button.type = 'button';
    button.textContent = label;
    button.classList.add('lb-traffic-pref-action');
    button.setAttribute(dataAttribute, '');
    button.removeAttribute('disabled');
    return button;
  }

  function applyPreferencePanelStyle(panel) {
    const templates = getPreferenceTemplates();
    if (!templates.panel) return;
    copyComputed(templates.panel, panel, [
      'font-family', 'color', 'background', 'background-color', 'border',
      'border-radius', 'box-shadow'
    ]);
  }

  function rebuildChrome() {
    if (!modal) return;
    const panel = qs('.lb-traffic-detail-panel', modal);
    const head = qs('.lb-traffic-detail-head', modal);
    if (!panel || !head) return;

    applyPreferencePanelStyle(panel);

    const currentTitle = qs('#lbTrafficDetailTitle', head);
    const currentText = clean(currentTitle?.textContent || 'Info trafic');

    head.replaceChildren();
    const copy = document.createElement('div');
    copy.className = 'lb-traffic-detail-head-copy';
    copy.append(makeTitle(currentText), makeSubtitle());
    head.append(copy, makeCloseButton());
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
      makePreferenceAction('👥  LIVE voyageurs', 'data-lb-traffic-live'),
      makePreferenceAction('🗺️  Voir sur la carte', 'data-lb-traffic-map')
    );
    body.append(actions);
  }

  function metric(value, label, state) {
    return `
      <div class="lb-traffic-metric is-${state}">
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>`;
  }

  function renderLoading(segment, badgeState) {
    const body = qs('#lbTrafficDetailBody', ensureModal());
    if (!body) return;

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
    if (!body) return;

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
              return `<div class="lb-traffic-train-row">
                <span class="lb-traffic-train-number">TER ${escapeHtml(record.trainNumber)}</span>
                <span class="lb-traffic-train-state ${state.className}">${escapeHtml(state.label)}</span>
              </div>`;
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

    /* Le modal « Mes préférences » est parfois initialisé après le shell :
       on resynchronise donc les vrais composants à chaque ouverture. */
    rebuildChrome();

    const badgeState = getBadgeState(segment);
    renderLoading(segment, badgeState);
    currentModal.classList.add('is-open');
    currentModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lb-traffic-detail-open');
    qs('[data-lb-traffic-close]', currentModal)?.focus({ preventScroll: true });

    await refreshSourceIfNeeded();
    if (activeSegmentKey !== segmentKey || !currentModal.classList.contains('is-open')) return;

    renderDetail(segment, analyzeSegment(getCurrentRaw(), segment), getBadgeState(segment));
  }

  function closeModal() {
    if (!modal) return;
    activeSegmentKey = '';
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-traffic-detail-open');

    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus({ preventScroll: true });
    }
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
    row.setAttribute('aria-label', `${segment.shortLabel} : ouvrir le détail du trafic`);
    row.setAttribute('title', `Voir le détail du trafic : ${segment.shortLabel}`);

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.lbTrafficDetails = Object.freeze({
    open: openSegment,
    close: closeModal,
    analyze: (segmentKey) => SEGMENTS[segmentKey]
      ? analyzeSegment(getCurrentRaw(), SEGMENTS[segmentKey])
      : null
  });
})();
