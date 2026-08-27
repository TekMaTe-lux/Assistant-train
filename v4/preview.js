/* Preview autonome V4. Aucun appel vers index.html. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const demo = {
    apiVersion: 4,
    updatedAt: new Date().toISOString(),
    stale: false,
    sources: [
      { name: 'sncfRt', ok: true, stale: false },
      { name: 'cflRt', ok: true, stale: false },
      { name: 'cflArrivals', ok: true, stale: false },
      { name: 'traffic', ok: true, stale: false },
      { name: 'compositions', ok: true, stale: false }
    ],
    trains: [
      {
        number: '88530', status: 'delay', delayMinutes: 12, live: true,
        origin: { name: 'Luxembourg' }, destination: { name: 'Nancy', platform: '4' },
        composition: { code: 'UM', confidence: 'estimated' }, occupancy: { percent: 84 },
        stops: [
          { name: 'Luxembourg', delayMinutes: 12, platform: '4' },
          { name: 'Bettembourg', delayMinutes: 12 },
          { name: 'Thionville', delayMinutes: 12, platform: '1' },
          { name: 'Hagondange', delayMinutes: 11 },
          { name: 'Metz', delayMinutes: 10, platform: '3' },
          { name: 'Pont-à-Mousson', delayMinutes: 9 },
          { name: 'Nancy', delayMinutes: 8 }
        ],
        disruptions: [{ summary: 'Retard estimé : circulation dense sur le sillon.' }],
        provenance: [
          { source: 'sncf-gtfs-rt', stale: false },
          { source: 'cfl-arrivals', stale: false },
          { source: 'labetaillere-composition', stale: false }
        ]
      },
      {
        number: '88742', status: 'on-time', delayMinutes: 0, live: true,
        origin: { name: 'Metz' }, destination: { name: 'Luxembourg', platform: '8' },
        composition: { code: 'US5', confidence: 'estimated' }, occupancy: { percent: 63 },
        stops: [
          { name: 'Metz', delayMinutes: 0 },
          { name: 'Maizières-lès-Metz', delayMinutes: 0 },
          { name: 'Hagondange', delayMinutes: 0 },
          { name: 'Uckange', delayMinutes: 0 },
          { name: 'Thionville', delayMinutes: 0 },
          { name: 'Hettange-Grande', delayMinutes: 0 },
          { name: 'Bettembourg', delayMinutes: 0 },
          { name: 'Luxembourg', delayMinutes: 0, platform: '8' }
        ],
        disruptions: [],
        provenance: [{ source: 'sncf-gtfs-rt', stale: false }, { source: 'cfl-arrivals', stale: false }]
      },
      {
        number: '88769', status: 'partial', delayMinutes: 0, live: false,
        origin: { name: 'Luxembourg' }, destination: { name: 'Metz' },
        composition: { code: 'US5', confidence: 'estimated' }, occupancy: { percent: 92 },
        stops: [
          { name: 'Luxembourg', delayMinutes: 0 },
          { name: 'Bettembourg', delayMinutes: 0 },
          { name: 'Thionville', delayMinutes: 0 },
          { name: 'Metz', delayMinutes: 0 }
        ],
        disruptions: [{ summary: 'Service partiel affiché pour démontrer l’état visuel.' }],
        provenance: [{ source: 'sncf-gtfs-rt', stale: false }]
      },
      {
        number: '88770', status: 'cancelled', delayMinutes: 0, live: false,
        origin: { name: 'Nancy' }, destination: { name: 'Luxembourg' },
        composition: { code: 'US5', confidence: 'estimated' }, occupancy: null,
        stops: [
          { name: 'Nancy', delayMinutes: 0 }, { name: 'Metz', delayMinutes: 0 },
          { name: 'Thionville', delayMinutes: 0 }, { name: 'Luxembourg', delayMinutes: 0 }
        ],
        disruptions: [{ summary: 'Suppression de démonstration — aucune donnée réelle impactée.' }],
        provenance: [{ source: 'sncf-gtfs-rt', stale: false }]
      }
    ],
    traffic: [
      { id: 'demo-1', summary: 'Vigilance sur le sillon', description: 'Cette alerte est fictive et sert uniquement à montrer le rendu Command Center.' },
      { id: 'demo-2', summary: 'Gare de Luxembourg', description: 'Les voies et retournements seront restitués avec la même grammaire visuelle.' }
    ]
  };

  const sourceNames = {
    sncfRt: 'SNCF RT',
    cflRt: 'CFL / HAFAS',
    cflArrivals: 'Voies Luxembourg',
    traffic: 'SIRI SX',
    compositions: 'Compositions'
  };

  const withTimeout = async (promise, ms) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  async function loadSnapshot() {
    try {
      const response = await withTimeout(fetch('/api/v4/snapshot', { cache: 'no-store', headers: { accept: 'application/json' } }), 2500);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.trains)) throw new Error('payload invalide');
      return { payload, mode: payload.stale ? 'degraded' : 'live', label: payload.stale ? 'LIVE · données partielles' : 'LIVE · Data Engine V4' };
    } catch (error) {
      return { payload: demo, mode: 'demo', label: 'DEMO · moteur VPS non branché', error };
    }
  }

  function renderKpis(snapshot) {
    const trains = snapshot.trains || [];
    const delayed = trains.filter((t) => t.status === 'delay' || Number(t.delayMinutes) > 0).length;
    const cancelled = trains.filter((t) => t.status === 'cancelled').length;
    const live = trains.filter((t) => t.live).length;
    const values = {
      v4KpiTrains: trains.length,
      v4KpiDelay: delayed,
      v4KpiCancelled: cancelled,
      v4KpiLive: live
    };
    Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).textContent = String(value); });
  }

  function renderSources(snapshot, mode) {
    const root = $('v4Sources');
    if (!root) return;
    const list = Array.isArray(snapshot.sources) ? snapshot.sources : [];
    root.innerHTML = list.map((source) => {
      const state = !source.ok ? 'down' : source.stale ? 'stale' : 'ok';
      const status = state === 'down' ? 'HS' : state === 'stale' ? 'Ancienne' : 'OK';
      return `<div class="v4-source" data-state="${state}"><span class="v4-source__name">${esc(sourceNames[source.name] || source.name || 'Source')}</span><span class="v4-source__status">${esc(status)}</span></div>`;
    }).join('') || '<div class="v4-source" data-state="stale"><span class="v4-source__name">Sources</span><span class="v4-source__status">Indisponibles</span></div>';

    const badge = $('v4Mode');
    if (badge) badge.dataset.mode = mode;
  }

  function renderTrains(snapshot) {
    const root = $('v4TrainGrid');
    const favRoot = $('v4FavoriteGrid');
    if (!window.LBTrainUI || !root || !favRoot) return;
    const trains = (snapshot.trains || []).slice(0, 4);
    root.innerHTML = trains.map((train) => window.LBTrainUI.compact(train)).join('');
    favRoot.innerHTML = trains.slice(0, 2).map((train) => window.LBTrainUI.favorite(train, { allowRemove: false })).join('');
  }

  function renderTraffic(snapshot) {
    const root = $('v4Traffic');
    if (!root) return;
    const items = (snapshot.traffic || []).slice(0, 4);
    root.innerHTML = items.length ? items.map((item) => `
      <article class="v4-traffic-item">
        <span class="v4-traffic-item__icon" aria-hidden="true">⚠</span>
        <div><strong>${esc(item.summary || 'Information trafic')}</strong><p>${esc(item.description || '')}</p></div>
      </article>`).join('') : '<div class="lb-empty-state">Aucune perturbation majeure.</div>';
  }

  function renderConsole(snapshot, mode, error) {
    const root = $('v4Console');
    if (!root) return;
    const stamp = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const lines = [
      `<b>[V4]</b> Command Center initialisé`,
      `<span class="${mode === 'live' ? 'ok' : 'warn'}">[DATA]</span> mode=${esc(mode)} · mise à jour=${esc(stamp)}`,
      `[TRAIN] ${Number(snapshot.trains?.length || 0)} circulations normalisées`,
      `[SOURCES] ${Number(snapshot.sources?.length || 0)} connecteurs déclarés`,
      `[UI] composants Train = compact / favorite / full`,
      `[A11Y] focus visible · modale clavier · reduced-motion`,
      error ? `<span class="warn">[INFO]</span> /api/v4 indisponible → fallback DEMO activé` : `<span class="ok">[OK]</span> Data Engine V4 répond`,
      `<span class="ok">[SAFE]</span> index.html non chargé · production non modifiée`
    ];
    root.innerHTML = lines.join('<br>');
  }

  let currentSnapshot = demo;
  let lastTrigger = null;

  function openTrain(number, trigger) {
    if (!window.LBTrainUI) return;
    const train = (currentSnapshot.trains || []).find((item) => String(item.number) === String(number));
    if (!train) return;
    const modal = $('v4TrainModal');
    const body = $('v4TrainModalBody');
    if (!modal || !body) return;
    lastTrigger = trigger || document.activeElement;
    body.innerHTML = window.LBTrainUI.full(train);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    $('v4TrainModalClose')?.focus();
  }

  function closeTrain() {
    const modal = $('v4TrainModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
    if (lastTrigger instanceof HTMLElement) lastTrigger.focus();
  }

  function bindUi() {
    document.addEventListener('click', (event) => {
      const open = event.target.closest?.('[data-lb-open-train]');
      if (open) {
        event.preventDefault();
        openTrain(open.getAttribute('data-lb-open-train'), open);
        return;
      }
      if (event.target.id === 'v4TrainModal' || event.target.closest?.('#v4TrainModalClose')) closeTrain();
    });

    document.addEventListener('keydown', (event) => {
      const modal = $('v4TrainModal');
      if (!modal?.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTrain();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = qsa('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])', modal).filter((el) => !el.disabled && !el.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  async function init() {
    bindUi();
    const result = await loadSnapshot();
    currentSnapshot = result.payload;
    const mode = $('v4Mode');
    if (mode) { mode.textContent = result.label; mode.dataset.mode = result.mode; }
    renderKpis(result.payload);
    renderSources(result.payload, result.mode);
    renderTrains(result.payload);
    renderTraffic(result.payload);
    renderConsole(result.payload, result.mode, result.error);
    const updated = $('v4Updated');
    if (updated) updated.textContent = new Date(result.payload.updatedAt || Date.now()).toLocaleString('fr-FR');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
