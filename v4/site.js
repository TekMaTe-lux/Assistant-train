(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const demoTrains = [
    {number:'88530',status:'delay',delayMinutes:12,live:true,origin:{name:'Luxembourg'},destination:{name:'Nancy',platform:'4'},composition:{code:'UM',confidence:'estimated'},occupancy:{percent:78},stops:[{name:'Luxembourg',delayMinutes:12,platform:'4'},{name:'Bettembourg',delayMinutes:12},{name:'Thionville',delayMinutes:12},{name:'Metz',delayMinutes:11},{name:'Nancy',delayMinutes:10}],provenance:[{source:'preview-demo'}]},
    {number:'88742',status:'on-time',delayMinutes:0,live:true,origin:{name:'Metz'},destination:{name:'Luxembourg',platform:'8'},composition:{code:'US5',confidence:'estimated'},occupancy:{percent:46},stops:[{name:'Metz',delayMinutes:0},{name:'Hagondange',delayMinutes:0},{name:'Uckange',delayMinutes:0},{name:'Thionville',delayMinutes:0},{name:'Bettembourg',delayMinutes:0},{name:'Luxembourg',delayMinutes:0,platform:'8'}],provenance:[{source:'preview-demo'}]},
    {number:'88769',status:'partial',delayMinutes:0,live:false,origin:{name:'Luxembourg'},destination:{name:'Metz'},composition:{code:'US5',confidence:'estimated'},occupancy:{percent:66},stops:[{name:'Luxembourg',delayMinutes:0},{name:'Bettembourg',delayMinutes:0},{name:'Thionville',delayMinutes:0},{name:'Metz',delayMinutes:0}],provenance:[{source:'preview-demo'}]},
    {number:'88770',status:'cancelled',delayMinutes:0,live:false,origin:{name:'Nancy'},destination:{name:'Luxembourg'},composition:{code:'US5',confidence:'estimated'},occupancy:null,stops:[{name:'Nancy',delayMinutes:0},{name:'Metz',delayMinutes:0},{name:'Thionville',delayMinutes:0},{name:'Luxembourg',delayMinutes:0}],provenance:[{source:'preview-demo'}]}
  ];

  const state = { mode:'demo', trains:demoTrains, traffic:[], updatedAt:new Date().toISOString() };

  async function getJson(url, timeout = 4500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {cache:'no-store',signal:ctrl.signal,headers:{accept:'application/json'}});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function normalizeLegacyTrains(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    return Object.entries(payload).map(([key, raw]) => {
      if (!raw || typeof raw !== 'object') return null;
      const number = String(raw.train_number || raw.train || key).match(/\d{3,6}/)?.[0] || '';
      if (!number) return null;
      const stops = raw.stops && typeof raw.stops === 'object' && !Array.isArray(raw.stops)
        ? Object.entries(raw.stops).map(([name, delay]) => ({name,delayMinutes:Number(delay)||0})) : [];
      const delayMinutes = stops.length ? Math.max(...stops.map(s => s.delayMinutes || 0),0) : 0;
      let status = String(raw.status || '').toUpperCase();
      if (/CANCEL|SUPPR/.test(status)) status = 'cancelled';
      else if (/PARTIAL|PARTIEL/.test(status)) status = 'partial';
      else status = delayMinutes > 0 ? 'delay' : 'on-time';
      return {
        number, status, delayMinutes, live:Boolean(raw.live),
        origin:stops[0] ? {name:stops[0].name} : null,
        destination:stops.at(-1) ? {name:stops.at(-1).name} : null,
        composition:null, occupancy:null, stops,
        provenance:[{source:'sncf-gtfs-rt',stale:false}]
      };
    }).filter(Boolean);
  }

  function normalizeTraffic(payload) {
    const list = Array.isArray(payload?.situations) ? payload.situations : Array.isArray(payload) ? payload : [];
    return list.slice(0,6).map((item, i) => ({
      id:item?.situation_number || item?.id || `traffic-${i}`,
      summary:item?.summary || item?.title || 'Perturbation en cours',
      description:item?.detail || item?.description || '',
      participant:item?.participant_ref || ''
    }));
  }

  async function loadReadOnlyData() {
    try {
      const snap = await getJson('/api/v4/snapshot', 3000);
      if (snap?.apiVersion === 4 && Array.isArray(snap.trains)) {
        state.mode = 'v4'; state.trains = snap.trains; state.traffic = Array.isArray(snap.traffic) ? snap.traffic : []; state.updatedAt = snap.updatedAt || new Date().toISOString();
        return;
      }
    } catch (_) {}

    const [legacy, traffic] = await Promise.allSettled([
      getJson('/gtfs/retards_nancymetzlux.json', 4500),
      getJson('/gtfs/siri_sx_alertes.json', 4500)
    ]);
    const trains = legacy.status === 'fulfilled' ? normalizeLegacyTrains(legacy.value) : [];
    if (trains.length) {
      state.mode = 'legacy-live';
      state.trains = trains;
      state.updatedAt = new Date().toISOString();
    }
    if (traffic.status === 'fulfilled') state.traffic = normalizeTraffic(traffic.value);
  }

  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

  function renderHeaderMode() {
    const badge = $('#modeBadge');
    if (!badge) return;
    if (state.mode === 'v4') { badge.textContent='LIVE · DATA ENGINE V4'; badge.classList.remove('lb-chip--demo'); }
    else if (state.mode === 'legacy-live') { badge.textContent='LIVE · SOURCES ACTUELLES'; badge.classList.remove('lb-chip--demo'); }
    else badge.textContent='DEMO · AUCUNE ÉCRITURE';
  }

  function renderKpis() {
    const trains = state.trains;
    setText('kpiTrains', trains.length);
    setText('kpiDelay', trains.filter(t => t.status === 'delay' || Number(t.delayMinutes)>0).length);
    setText('kpiCancelled', trains.filter(t => t.status === 'cancelled').length);
    setText('kpiLive', trains.filter(t => t.live).length);
    const bad = trains.filter(t => ['delay','cancelled','partial'].includes(t.status)).length;
    setText('networkState', bad ? '#BER SOUS SURVEILLANCE' : '#BER LIVE');
    setText('networkSummary', `${trains.length} trains · ${bad} impacté${bad>1?'s':''}`);
  }

  function renderTraffic() {
    const list = state.traffic;
    setText('trafficCount', `${list.length} ALERTE${list.length>1?'S':''}`);
    const title = $('#trafficTitle');
    const signal = $('.lb-status-line .lb-signal');
    if (!list.length) {
      if (title) title.textContent = 'Pas de perturbation majeure remontée';
      signal?.classList.remove('is-warn','is-bad'); signal?.classList.add('is-ok');
      $('#trafficCards').innerHTML = '<div class="lb-alert-card"><strong>Rien de majeur dans la lecture actuelle</strong><small>La preview reste en lecture seule.</small></div>';
      return;
    }
    if (title) title.textContent = `${list.length} perturbation${list.length>1?'s':''} à surveiller`;
    signal?.classList.remove('is-ok','is-bad'); signal?.classList.add('is-warn');
    $('#trafficCards').innerHTML = list.slice(0,3).map(item => `<div class="lb-alert-card"><strong>${esc(item.summary)}</strong><small>${esc(item.description || item.participant || 'Information trafic')}</small></div>`).join('');
  }

  function pickDisplayTrains() {
    const preferred = ['88530','88742','88769','88770'];
    const byNumber = new Map(state.trains.map(t => [String(t.number),t]));
    const chosen = preferred.map(n => byNumber.get(n)).filter(Boolean);
    for (const t of state.trains) { if (chosen.length >= 4) break; if (!chosen.includes(t)) chosen.push(t); }
    return chosen.length ? chosen : demoTrains;
  }

  function renderFavorites() {
    const trains = pickDisplayTrains().slice(0,2);
    const grid = $('#favoriteGrid');
    grid.innerHTML = trains.map(t => window.LBTrainUI ? window.LBTrainUI.favorite(t,{allowRemove:false}) : `<article class="lb-panel"><b>${esc(t.number)}</b></article>`).join('');
  }

  const stationCell = (train, name) => {
    const stop = (train.stops || []).find(s => String(s.name||'').toLowerCase().includes(name.toLowerCase()));
    if (!stop) return '—';
    const d = Number(stop.delayMinutes)||0;
    return d > 0 ? `<span class="lb-cell-delay">+${d} min</span>` : '✓';
  };

  function renderBoard() {
    const body = $('#boardBody');
    body.innerHTML = pickDisplayTrains().map(t => {
      let status = '<span class="lb-cell-live">À l’heure</span>';
      if (t.status === 'cancelled') status = '<span class="lb-cell-cancelled">Supprimé</span>';
      else if (t.status === 'partial') status = '<span class="lb-cell-delay">Partiel</span>';
      else if (Number(t.delayMinutes)>0) status = `<span class="lb-cell-delay">+${Number(t.delayMinutes)} min</span>`;
      return `<tr data-train="${esc(t.number)}"><td><button class="lb-board-train" type="button" data-open-train="${esc(t.number)}">${esc(t.number)}</button></td><td>${stationCell(t,'Nancy')}</td><td>${stationCell(t,'Metz')}</td><td>${stationCell(t,'Thionville')}</td><td>${stationCell(t,'Luxembourg')}</td><td>${status}</td></tr>`;
    }).join('');
  }

  function findTrain(number) { return state.trains.find(t => String(t.number) === String(number)) || demoTrains.find(t => String(t.number) === String(number)); }

  function openTrain(number) {
    const train = findTrain(number);
    if (!train) return;
    setText('trainDialogTitle', `TER ${train.number}`);
    $('#trainDialogBody').innerHTML = window.LBTrainUI ? window.LBTrainUI.full(train) : `<p>Train ${esc(train.number)}</p>`;
    $('#trainDialog')?.showModal();
  }

  function wire() {
    document.addEventListener('click', e => {
      const open = e.target.closest('[data-lb-open-train],[data-open-train]');
      if (open) { openTrain(open.getAttribute('data-lb-open-train') || open.getAttribute('data-open-train')); return; }
      if (e.target.closest('[data-close-dialog]')) $('#trainDialog')?.close();
    });
    $('#trainDialog')?.addEventListener('click', e => { if (e.target === $('#trainDialog')) $('#trainDialog').close(); });
    $('#trainSearchBtn')?.addEventListener('click', () => {
      const number = $('#trainSearch').value.trim();
      const train = findTrain(number);
      if (train) openTrain(number); else { $('#trainSearch').setCustomValidity('Train absent de la preview actuelle'); $('#trainSearch').reportValidity(); setTimeout(()=>$('#trainSearch').setCustomValidity(''),1000); }
    });
    $('#trainSearch')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#trainSearchBtn').click(); });
    $$('.lb-segmented button').forEach(btn => btn.addEventListener('click', () => { $$('.lb-segmented button').forEach(b=>b.classList.remove('is-active')); btn.classList.add('is-active'); }));
  }

  async function init() {
    wire();
    await loadReadOnlyData();
    renderHeaderMode(); renderKpis(); renderTraffic(); renderFavorites(); renderBoard();
  }

  init().catch(err => { console.error('[LB V4 preview]',err); renderHeaderMode(); renderKpis(); renderTraffic(); renderFavorites(); renderBoard(); });
})();
