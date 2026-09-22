'use strict';

(() => {
  const BADGE_ID = 'lbHerdLiveBadge';
  const DIALOG_ID = 'lbHerdLiveDialog';
  const CLIENT_KEY = 'lb_herd_live_client_v1';
  const API_URL = 'https://vps.labetaillere.fr/api/community/presence';
  const HEARTBEAT_MS = 60 * 1000;
  const MIN_REFRESH_MS = 15 * 1000;

  let lastRefreshAt = 0;
  let lastActiveCount = null;
  let refreshTimer = null;
  let requestInFlight = null;

  function makeVisitorId() {
    try {
      const existing = localStorage.getItem(CLIENT_KEY);
      if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
    } catch (_) {}

    let value = '';
    try {
      if (crypto?.randomUUID) value = crypto.randomUUID();
    } catch (_) {}
    if (!value) {
      value = 'herd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14);
    }
    value = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

    try { localStorage.setItem(CLIENT_KEY, value); } catch (_) {}
    return value;
  }

  const visitorId = makeVisitorId();

  function ensureUi() {
    const title = document.querySelector('#home .live-wall-card--home .live-wall-title');
    if (!title) return false;

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('button');
      badge.id = BADGE_ID;
      badge.type = 'button';
      badge.className = 'lb-herd-live-badge';
      badge.hidden = true;
      badge.setAttribute('aria-label', 'Ouvrir Le troupeau en direct');
      badge.setAttribute('title', 'Le troupeau en direct');
      badge.innerHTML = '<span class="lb-herd-live-badge__cow" aria-hidden="true">🐄</span><span data-herd-badge-count>—</span>';
      badge.addEventListener('click', openDialog);
      title.appendChild(badge);
    }

    let dialog = document.getElementById(DIALOG_ID);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = DIALOG_ID;
      dialog.className = 'lb-herd-live-dialog';
      dialog.setAttribute('aria-labelledby', 'lbHerdLiveTitle');
      dialog.innerHTML = `
        <section class="lb-herd-live-sheet">
          <div class="lb-herd-live-head">
            <div class="lb-herd-live-heading">
              <h3 id="lbHerdLiveTitle">🐄 Le troupeau en direct</h3>
              <div class="lb-herd-live-kicker"><i aria-hidden="true"></i><span data-herd-window>Activité des 5 dernières min</span></div>
            </div>
            <button type="button" class="lb-herd-live-close" data-herd-close aria-label="Fermer">×</button>
          </div>
          <div class="lb-herd-live-grid">
            <div class="lb-herd-live-stat"><strong data-herd-active>—</strong><span>actifs sur le site</span></div>
            <div class="lb-herd-live-stat"><strong data-herd-aboard>—</strong><span>voyageurs déclarés à bord</span></div>
            <div class="lb-herd-live-stat"><strong data-herd-infos>—</strong><span>infos terrain · 30 min</span></div>
            <div class="lb-herd-live-stat"><strong data-herd-confirmed>—</strong><span>infos confirmées · 30 min</span></div>
          </div>
          <p class="lb-herd-live-foot">Présence anonyme et éphémère · actualisation automatique.</p>
        </section>`;
      document.body.appendChild(dialog);
      dialog.querySelector('[data-herd-close]')?.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    return true;
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = String(value);
  }

  function renderSnapshot(data) {
    if (!data || data.ok !== true) return;

    ensureUi();
    const active = Math.max(0, Number(data.active_count || 0));
    const badge = document.getElementById(BADGE_ID);
    const badgeCount = badge?.querySelector('[data-herd-badge-count]');

    if (badgeCount) badgeCount.textContent = String(active);
    if (badge) {
      badge.hidden = false;
      badge.setAttribute('aria-label', `Le troupeau en direct : ${active} actif${active > 1 ? 's' : ''} sur le site`);
      if (lastActiveCount !== null && active > lastActiveCount) {
        badge.classList.remove('is-pulsing');
        void badge.offsetWidth;
        badge.classList.add('is-pulsing');
        setTimeout(() => badge.classList.remove('is-pulsing'), 600);
      }
    }

    setText('[data-herd-active]', active);
    setText('[data-herd-aboard]', Math.max(0, Number(data.aboard_count || 0)));
    setText('[data-herd-infos]', Math.max(0, Number(data.field_infos_30m || 0)));
    setText('[data-herd-confirmed]', Math.max(0, Number(data.confirmed_infos_30m || 0)));
    setText('[data-herd-window]', `Activité des ${Number(data.active_window_minutes || 5)} dernières min`);

    lastActiveCount = active;
  }

  async function refresh(force = false) {
    if (document.hidden || !navigator.onLine || !visitorId) return null;
    const now = Date.now();
    if (!force && now - lastRefreshAt < MIN_REFRESH_MS) return requestInFlight;
    if (requestInFlight) return requestInFlight;

    lastRefreshAt = now;
    requestInFlight = fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Troupeau indisponible');
        return response.json();
      })
      .then((data) => {
        renderSnapshot(data);
        return data;
      })
      .catch(() => null)
      .finally(() => { requestInFlight = null; });

    return requestInFlight;
  }

  function openDialog() {
    if (!ensureUi()) return;
    const dialog = document.getElementById(DIALOG_ID);
    refresh(true);
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function schedule() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!document.hidden) refresh();
    }, HEARTBEAT_MS);
  }

  function init() {
    if (!ensureUi()) {
      setTimeout(init, 500);
      return;
    }
    refresh(true);
    schedule();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh(true);
    });
    window.addEventListener('focus', () => refresh(), { passive: true });
    window.addEventListener('online', () => refresh(true), { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();