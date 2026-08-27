/* La Bétaillère V4 — aperçu réseau accueil */
(function () {
  'use strict';
  if (window.__LB_CC_HOME_V4__) return;
  window.__LB_CC_HOME_V4__ = true;

  const SOURCE_LABELS = {
    sncfRt: 'SNCF RT',
    cflRt: 'CFL',
    cflArrivals: 'Voies Lux',
    traffic: 'SIRI SX',
    compositions: 'Compositions'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function host() {
    const home = document.getElementById('home');
    if (!home) return null;
    let root = document.getElementById('lbCommandCenterOverview');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'lbCommandCenterOverview';
    root.className = 'lb-cc-overview';
    root.setAttribute('aria-label', 'Tableau de commande du réseau');
    const h1 = home.querySelector('h1');
    if (h1?.nextSibling) home.insertBefore(root, h1.nextSibling);
    else home.prepend(root);
    return root;
  }

  function formatTime(value) {
    const date = new Date(value || Date.now());
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris'
    }).format(date);
  }

  function render(snapshot) {
    const root = host();
    if (!root) return;
    const trains = Array.isArray(snapshot?.trains) ? snapshot.trains : [];
    const traffic = Array.isArray(snapshot?.traffic) ? snapshot.traffic : [];
    const delayed = trains.filter((train) => train.status === 'delay' || Number(train.delayMinutes) > 0).length;
    const cancelled = trains.filter((train) => train.status === 'cancelled' || train.cancelled).length;
    const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];

    root.innerHTML = `
      <div class="lb-cc-overview__head">
        <div>
          <div class="lb-section-kicker">COMMAND CENTER · NANCY → LUXEMBOURG</div>
          <h2 class="lb-cc-overview__title">État du troupeau</h2>
        </div>
        <div class="lb-cc-overview__stamp">MAJ ${escapeHtml(formatTime(snapshot?.updatedAt))}</div>
      </div>
      <div class="lb-cc-overview__kpis">
        <div class="lb-kpi" data-tone="ok"><div class="lb-kpi__label">Bétaillères suivies</div><div class="lb-kpi__value">${trains.length}</div><div class="lb-kpi__meta">circulations dans le moteur</div></div>
        <div class="lb-kpi" data-tone="delay"><div class="lb-kpi__label">En retard</div><div class="lb-kpi__value">${delayed}</div><div class="lb-kpi__meta">retard détecté</div></div>
        <div class="lb-kpi" data-tone="cancel"><div class="lb-kpi__label">Supprimées</div><div class="lb-kpi__value">${cancelled}</div><div class="lb-kpi__meta">circulations supprimées</div></div>
        <div class="lb-kpi" data-tone="traffic"><div class="lb-kpi__label">Infos trafic</div><div class="lb-kpi__value">${traffic.length}</div><div class="lb-kpi__meta">situations remontées</div></div>
      </div>
      <div class="lb-cc-overview__systems">
        <div class="lb-system-strip" aria-label="Santé des sources">
          ${sources.map((source) => {
            const state = !source.ok ? 'down' : source.stale ? 'warn' : 'ok';
            const label = SOURCE_LABELS[source.name] || source.name || 'Source';
            const suffix = !source.ok ? 'indisponible' : source.stale ? 'ancienne' : 'à jour';
            return `<span class="lb-system-light" data-state="${state}" aria-label="${escapeHtml(label)} : ${escapeHtml(suffix)}">${escapeHtml(label)}</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderUnavailable(error) {
    const root = host();
    if (!root) return;
    root.innerHTML = `
      <div class="lb-cc-overview__head"><div><div class="lb-section-kicker">COMMAND CENTER</div><h2 class="lb-cc-overview__title">État du troupeau</h2></div></div>
      <div class="lb-cc-overview__offline">Moteur V4 non connecté sur cet environnement. Le site historique continue de fonctionner normalement.${error?.message ? ` <span class="visually-hidden">${escapeHtml(error.message)}</span>` : ''}</div>
    `;
  }

  let timer = null;
  async function refresh() {
    if (!window.LBData?.snapshot) return renderUnavailable();
    try {
      render(await window.LBData.snapshot({ force: true }));
    } catch (error) {
      renderUnavailable(error);
    }
  }

  function start() {
    refresh();
    if (!timer) {
      timer = setInterval(() => {
        if (!document.hidden) refresh();
      }, 30000);
    }
  }

  document.addEventListener('lb:data-ready', start, { once: true });
  if (window.LBData) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0), { once: true });
  else setTimeout(start, 0);
})();
