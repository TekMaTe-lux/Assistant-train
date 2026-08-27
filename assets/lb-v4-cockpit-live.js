(() => {
  'use strict';
  if (window.__LB_V4_COCKPIT_LIVE__) return;
  window.__LB_V4_COCKPIT_LIVE__ = true;

  const LUX_URL = 'https://vps.labetaillere.fr/map-v2/tests/luxembourg-user-preview-v5-private-maplike-trainclick.html';
  const ENGINE_SOURCES = [
    'https://vps.labetaillere.fr/api/v4/snapshot',
    'https://vps.labetaillere.fr/map-v2/v4-preview/data/snapshot.json'
  ];
  const state = { engineTimer: null, observer: null, luxReturnFocus: null, engineUrl: null };

  const text = (el) => String(el?.textContent || '').replace(/\s+/g, ' ').trim();

  function findHomeCard(pattern) {
    return [...document.querySelectorAll('#home .home-dashboard > .home-card')].find(card => {
      const label = card.getAttribute('aria-label') || '';
      const heading = text(card.querySelector('h1,h2,h3,.live-wall-title'));
      return pattern.test(`${label} ${heading}`);
    }) || null;
  }

  function goToNav(pattern, fallbackHash) {
    const candidates = [...document.querySelectorAll('.bottom-nav__item[href], .bottom-nav a[href], nav a[href]')];
    const link = candidates.find(el => pattern.test(`${text(el)} ${el.getAttribute('aria-label') || ''}`));
    if (link) {
      link.click();
      return;
    }
    if (fallbackHash) location.hash = fallbackHash;
  }

  function triggerExisting(selector, fallback) {
    const el = document.querySelector(selector);
    if (el) el.click();
    else if (fallback) fallback();
  }

  function makeButton(label, action, tone = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lb4-command-btn';
    if (tone) button.dataset.tone = tone;
    button.innerHTML = label;
    button.addEventListener('click', action);
    return button;
  }

  function ensureCockpit() {
    const dashboard = document.querySelector('#home .home-dashboard');
    if (!dashboard) return;

    const traffic = findHomeCard(/info trafic/i);
    const live = findHomeCard(/voix du bétail|mur de commentaires/i);
    const quick = findHomeCard(/tableau dynamique|tableau rapide/i);
    const punctuality = findHomeCard(/ponctualité/i);
    const favorites = findHomeCard(/bétaillères favorites|favoris/i);

    traffic?.classList.add('lb4-zone-traffic');
    live?.classList.add('lb4-zone-live');
    quick?.classList.add('lb4-zone-quick');
    punctuality?.classList.add('lb4-zone-punct');
    favorites?.classList.add('lb4-zone-favs');

    if (!dashboard.querySelector('#lb4CommandDeck')) {
      const deck = document.createElement('article');
      deck.id = 'lb4CommandDeck';
      deck.className = 'home-card lb4-zone-actions';
      deck.setAttribute('aria-label', 'Commandes rapides');
      deck.innerHTML = `
        <div class="lb4-command-head">
          <div><span class="lb4-kicker">MON TRAJET · MAINTENANT</span><h2>Commandes</h2></div>
          <span id="lb4EnginePill" class="lb4-engine-pill" data-state="checking">V4 · vérification…</span>
        </div>
        <div class="lb4-command-grid" id="lb4CommandGrid"></div>
        <div class="lb4-engine-kpis" id="lb4EngineKpis" aria-live="polite">
          <div><b>—</b><span>trains</span></div><div><b>—</b><span>retards</span></div><div><b>—</b><span>suppr.</span></div><div><b>—</b><span>alertes</span></div>
        </div>`;
      dashboard.appendChild(deck);
      const grid = deck.querySelector('#lb4CommandGrid');
      grid.append(
        makeButton('<span>🚉</span><b>Gare Luxembourg</b><small>quais & mouvements</small>', openLuxStation, 'lux'),
        makeButton('<span>◎</span><b>Carte LIVE</b><small>voir le réseau</small>', () => goToNav(/carte/i, '#carte')),
        makeButton('<span>⚠</span><b>Signaler</b><small>aider le troupeau</small>', () => triggerExisting('#lbOpenSignalModal'), 'warn'),
        makeButton('<span>★</span><b>Mes favoris</b><small>matin & soir</small>', () => goToNav(/favoris|mes bêtes/i, '#favoris')),
        makeButton('<span>⌕</span><b>Rechercher</b><small>train ou trajet</small>', () => goToNav(/recherche/i, '#recherche')),
        makeButton('<span>▥</span><b>Statistiques</b><small>ponctualité réelle</small>', () => goToNav(/stats|statistiques/i, '#stats'))
      );
    }
  }

  function ensureLuxModal() {
    let modal = document.getElementById('lb4LuxStationModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'lb4LuxStationModal';
    modal.className = 'lb4-lux-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'lb4LuxStationTitle');
    modal.innerHTML = `
      <div class="lb4-lux-shell">
        <header class="lb4-lux-head">
          <div><span class="lb4-kicker">GARE DYNAMIQUE · LIVE</span><h2 id="lb4LuxStationTitle">Luxembourg</h2><p>Quais, mouvements et trains dans la gare.</p></div>
          <div class="lb4-lux-actions">
            <a href="${LUX_URL}" target="_blank" rel="noopener">Ouvrir ↗</a>
            <button type="button" class="lb4-lux-close" aria-label="Fermer la gare dynamique">×</button>
          </div>
        </header>
        <div class="lb4-lux-frame-wrap"><iframe title="Gare dynamique de Luxembourg" loading="eager" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.lb4-lux-close').addEventListener('click', closeLuxStation);
    modal.addEventListener('pointerdown', event => { if (event.target === modal) closeLuxStation(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeLuxStation(); });
    return modal;
  }

  function openLuxStation(event) {
    const modal = ensureLuxModal();
    state.luxReturnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
    const frame = modal.querySelector('iframe');
    if (!frame.src) frame.src = LUX_URL;
    modal.hidden = false;
    document.body.classList.add('lb4-lux-open');
    modal.querySelector('.lb4-lux-close')?.focus({ preventScroll: true });
  }

  function closeLuxStation() {
    const modal = document.getElementById('lb4LuxStationModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('lb4-lux-open');
    if (state.luxReturnFocus?.focus) state.luxReturnFocus.focus({ preventScroll: true });
  }

  function ensureMapLuxTrigger() {
    const carte = document.getElementById('carte');
    if (!carte || carte.querySelector('#lb4LuxMapTrigger')) return;
    const button = makeButton('<span>🚉</span><b>Gare Luxembourg</b><small>ouvrir la gare dynamique</small>', openLuxStation, 'lux');
    button.id = 'lb4LuxMapTrigger';
    button.classList.add('lb4-lux-map-trigger');
    carte.appendChild(button);
  }

  function decorateLuxTableHeaders() {
    document.querySelectorAll('table th').forEach(th => {
      if (!/luxembourg/i.test(text(th)) || th.querySelector('.lb4-lux-th-trigger')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lb4-lux-th-trigger';
      button.textContent = 'Gare ↗';
      button.title = 'Ouvrir la gare dynamique de Luxembourg';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openLuxStation(event);
      });
      th.appendChild(button);
    });
  }

  function improveFavorites() {
    const widget = document.getElementById('favTrainsWidget');
    if (!widget) return;
    widget.classList.add('lb4-favorites-page');
    ['AM', 'PM'].forEach(kind => {
      const card = document.getElementById(`favCard${kind}`);
      if (card) card.classList.add('lb4-favorite-card');
    });
    if (!widget.dataset.lb4InitialCollapse) {
      widget.dataset.lb4InitialCollapse = '1';
      setTimeout(() => {
        ['AM', 'PM'].forEach(kind => {
          const details = document.getElementById(`favStats${kind}`);
          if (!details) return;
          details.open = false;
          details.removeAttribute('data-user-opened');
        });
      }, 1100);
    }
  }

  async function fetchWithTimeout(url, timeout = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || payload.apiVersion !== 4 || !Array.isArray(payload.trains)) throw new Error('snapshot V4 invalide');
      return payload;
    } finally { clearTimeout(timer); }
  }

  async function getEngineSnapshot() {
    const candidates = state.engineUrl ? [state.engineUrl, ...ENGINE_SOURCES.filter(u => u !== state.engineUrl)] : ENGINE_SOURCES;
    let lastError;
    for (const url of candidates) {
      try {
        const snapshot = await fetchWithTimeout(url);
        state.engineUrl = url;
        return snapshot;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('moteur V4 indisponible');
  }

  function renderEngine(snapshot, error) {
    const pill = document.getElementById('lb4EnginePill');
    const kpis = document.getElementById('lb4EngineKpis');
    if (!pill || !kpis) return;
    if (error || !snapshot) {
      pill.dataset.state = 'fallback';
      pill.textContent = 'V4 · non exposé';
      pill.title = 'Le cockpit conserve les fonctions historiques tant que l’API V4 publique n’est pas joignable.';
      return;
    }
    const trains = snapshot.trains || [];
    const delayed = trains.filter(t => Number(t.delayMinutes) > 0 || t.status === 'delay').length;
    const cancelled = trains.filter(t => t.cancelled || t.status === 'cancelled').length;
    const traffic = Array.isArray(snapshot.traffic) ? snapshot.traffic.length : Number(snapshot.meta?.trafficCount || 0);
    pill.dataset.state = snapshot.stale ? 'stale' : 'ok';
    pill.textContent = snapshot.stale ? 'V4 · données anciennes' : 'V4 · connecté';
    pill.title = state.engineUrl || '';
    const values = [trains.length, delayed, cancelled, traffic];
    [...kpis.querySelectorAll('b')].forEach((el, i) => { el.textContent = String(values[i] ?? '—'); });
    window.__LB_V4_SNAPSHOT__ = snapshot;
  }

  async function refreshEngine() {
    try { renderEngine(await getEngineSnapshot(), null); }
    catch (error) { renderEngine(null, error); }
  }

  function decorate() {
    ensureCockpit();
    ensureMapLuxTrigger();
    decorateLuxTableHeaders();
    improveFavorites();
  }

  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; decorate(); });
  }

  function start() {
    decorate();
    refreshEngine();
    state.engineTimer = setInterval(() => { if (!document.hidden) refreshEngine(); }, 20000);
    state.observer = new MutationObserver(scheduleDecorate);
    state.observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', scheduleDecorate, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshEngine(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
