(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (v) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  const state = {
    mode: 'loading',
    trains: [],
    traffic: [],
    meta: {},
    sources: [],
    updatedAt: null,
    filteredTrains: null
  };

  async function getJson(url, timeout = 5000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {cache:'no-store', signal:ctrl.signal, headers:{accept:'application/json'}});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function normalizeLegacy(payload) {
    let root = payload;
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      for (const key of ['trains','data','retards','items','results']) {
        if (root[key] && (Array.isArray(root[key]) || typeof root[key] === 'object')) { root = root[key]; break; }
      }
    }
    const entries = Array.isArray(root) ? root.map((x,i)=>[String(i),x]) : Object.entries(root || {});
    return entries.map(([key, raw]) => {
      if (!raw || typeof raw !== 'object') return null;
      const number = String(raw.train_number || raw.train || raw.number || key).match(/\d{3,6}/)?.[0] || '';
      if (!number) return null;
      let stops = [];
      if (raw.stops && typeof raw.stops === 'object' && !Array.isArray(raw.stops)) {
        stops = Object.entries(raw.stops).map(([name, delay]) => ({name, delayMinutes:Number(delay)||0, platform:null, delaySource:'SNCF'}));
      } else if (Array.isArray(raw.stops)) {
        stops = raw.stops.map(s => ({name:s.name || s.stop || s.station || '', delayMinutes:Number(s.delayMinutes ?? s.delay ?? 0)||0, platform:s.platform || s.track || null, delaySource:s.delaySource || 'SNCF'})).filter(s=>s.name);
      }
      const delayMinutes = Math.max(0, ...stops.map(s=>Number(s.delayMinutes)||0));
      let status = String(raw.status || '').toLowerCase();
      if (/cancel|suppr|annul/.test(status)) status='cancelled';
      else if (/partial|partiel/.test(status)) status='partial';
      else if (delayMinutes > 0) status='delay';
      else status='on-time';
      return {number,status,delayMinutes,live:Boolean(raw.live),origin:stops[0]?{name:stops[0].name}:null,destination:stops.at(-1)?{name:stops.at(-1).name,platform:stops.at(-1).platform}:null,composition:raw.composition||null,occupancy:raw.occupancy||null,stops,provenance:[{source:'legacy-sncf'}]};
    }).filter(Boolean);
  }

  async function loadData() {
    const attempts = [
      ['./data/snapshot.json', 'v4'],
      ['/api/v4/snapshot', 'v4']
    ];
    for (const [url, mode] of attempts) {
      try {
        const snap = await getJson(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`, 3500);
        if (snap?.apiVersion === 4 && Array.isArray(snap.trains) && snap.trains.length) {
          state.mode = mode;
          state.trains = snap.trains;
          state.traffic = Array.isArray(snap.traffic) ? snap.traffic : [];
          state.meta = snap.meta || {};
          state.sources = Array.isArray(snap.sources) ? snap.sources : [];
          state.updatedAt = snap.updatedAt || null;
          return;
        }
      } catch (_) {}
    }

    try {
      const legacy = await getJson(`/gtfs/retards_nancymetzlux.json?t=${Date.now()}`, 4500);
      const trains = normalizeLegacy(legacy);
      if (trains.length) {
        state.mode='legacy-live';
        state.trains=trains;
        state.updatedAt=new Date().toISOString();
        try {
          const traffic=await getJson(`/gtfs/siri_sx_alertes.json?t=${Date.now()}`,3500);
          state.traffic=Array.isArray(traffic?.situations)?traffic.situations:[];
        } catch (_) {}
        return;
      }
    } catch (_) {}

    state.mode='error';
    state.trains=[];
  }

  function setText(id, value) { const el=document.getElementById(id); if (el) el.textContent=value; }
  function displayTrains(){ return state.filteredTrains || state.trains; }

  function statusHtml(t) {
    if (t.status === 'cancelled' || t.cancelled) return '<span class="lb-cell-cancelled">Supprimé</span>';
    if (t.status === 'partial' || t.partial) return '<span class="lb-cell-delay">Partiel</span>';
    const d = Math.round(Number(t.delayMinutes)||0);
    if (d > 0) return `<span class="lb-cell-delay">+${d} min</span>`;
    return '<span class="lb-cell-live">À l’heure</span>';
  }

  function stationCell(train, name) {
    const target=norm(name);
    const stop=(train.stops||[]).find(s=>norm(s.name).includes(target));
    if (!stop) return '—';
    if (stop.cancelled) return '<span class="lb-cell-cancelled">Non desservi</span>';
    const d=Math.round(Number(stop.delayMinutes)||0);
    const platform=stop.platform ? `<small> · V${esc(stop.platform)}</small>` : '';
    return d>0 ? `<span class="lb-cell-delay">+${d} min${platform}</span>` : `✓${platform}`;
  }

  function renderMode() {
    const badge=$('#modeBadge');
    if (!badge) return;
    badge.classList.remove('lb-chip--demo');
    if (state.mode==='v4') badge.textContent='LIVE · DATA ENGINE V4';
    else if (state.mode==='legacy-live') badge.textContent='LIVE · SOURCE SNCF';
    else { badge.textContent='ERREUR · AUCUNE DONNÉE'; badge.classList.add('lb-chip--demo'); }

    const stamp=state.updatedAt ? new Date(state.updatedAt) : null;
    const summary=state.mode==='v4'
      ? `${state.trains.length} trains agrégés${stamp&&!isNaN(stamp)?` · ${stamp.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:''}`
      : `${state.trains.length} trains`;
    setText('networkSummary',summary);
  }

  function renderKpis() {
    const trains=state.trains;
    setText('kpiTrains',trains.length);
    setText('kpiDelay',trains.filter(t=>Number(t.delayMinutes)>0 || t.status==='delay').length);
    setText('kpiCancelled',trains.filter(t=>t.cancelled || t.status==='cancelled').length);
    setText('kpiLive',trains.filter(t=>t.live || t.position).length);
    const impacted=trains.filter(t=>Number(t.delayMinutes)>0 || ['delay','cancelled','partial'].includes(t.status)).length;
    setText('networkState', impacted ? '#BER SOUS SURVEILLANCE' : '#BER LIVE');
  }

  function activeTraffic(list) {
    const now=Date.now();
    const cleaned=list.filter(x=>x && (x.summary || x.title || x.description || x.detail));
    const withValidity=cleaned.filter(x=>Array.isArray(x.validity) && x.validity.length);
    if (!withValidity.length) return cleaned.slice(0,6);
    const active=withValidity.filter(x=>x.validity.some(v=>{
      const b=Date.parse(v.begin || v.start || v.start_date || v.from || '');
      const e=Date.parse(v.end || v.stop || v.end_date || v.to || '');
      return (!Number.isFinite(b)||b<=now) && (!Number.isFinite(e)||e>=now);
    }));
    return (active.length?active:cleaned).slice(0,6);
  }

  function renderTraffic() {
    const list=activeTraffic(state.traffic);
    setText('trafficCount',`${list.length} INFO${list.length>1?'S':''}`);
    const title=$('#trafficTitle');
    const signal=$('.lb-status-line .lb-signal');
    if (!list.length) {
      if (title) title.textContent='Aucune information trafic active remontée';
      signal?.classList.remove('is-warn','is-bad'); signal?.classList.add('is-ok');
      $('#trafficCards').innerHTML='<div class="lb-alert-card"><strong>Rien d’actif dans le snapshot V4</strong><small>Aucune donnée fictive n’est affichée.</small></div>';
      return;
    }
    if (title) title.textContent=`${list.length} information${list.length>1?'s':''} trafic remontée${list.length>1?'s':''}`;
    signal?.classList.remove('is-ok','is-bad'); signal?.classList.add('is-warn');
    $('#trafficCards').innerHTML=list.map(item=>`<div class="lb-alert-card"><strong>${esc(item.summary || item.title || 'Information trafic')}</strong><small>${esc(item.description || item.detail || item.participant || 'SIRI SX')}</small></div>`).join('');
  }

  function renderBoard() {
    const body=$('#boardBody');
    if (!body) return;
    const trains=displayTrains();
    body.innerHTML=trains.map(t=>`<tr data-train="${esc(t.number)}"><td><button class="lb-board-train" type="button" data-open-train="${esc(t.number)}">${esc(t.number)}</button></td><td>${stationCell(t,'Nancy')}</td><td>${stationCell(t,'Metz')}</td><td>${stationCell(t,'Thionville')}</td><td>${stationCell(t,'Luxembourg')}</td><td>${statusHtml(t)}</td></tr>`).join('');
    const head=$('#tableau .lb-section-head');
    if (head) {
      const old=head.querySelector('.lb-segmented');
      if (old) old.outerHTML=`<span class="lb-chip">${trains.length} / ${state.trains.length} CIRCULATIONS</span>`;
    }
  }

  function bestSelection() {
    return [...state.trains].sort((a,b)=>{
      const ia=(a.status==='cancelled'?10000:a.status==='partial'?8000:0)+(Number(a.delayMinutes)||0)*10;
      const ib=(b.status==='cancelled'?10000:b.status==='partial'?8000:0)+(Number(b.delayMinutes)||0)*10;
      return ib-ia;
    }).slice(0,4);
  }

  function renderSelection() {
    const section=$('#favoris');
    const grid=$('#favoriteGrid');
    if (!section || !grid) return;
    const h2=section.querySelector('h2'); if (h2) h2.textContent='Bétaillères à surveiller maintenant';
    const p=section.querySelector('.lb-section-head p'); if (p) p.textContent='Sélection issue uniquement du snapshot réel V4. Les favoris personnels restent sur labetaillere.fr tant que les comptes ne sont pas reliés à la preview.';
    const chip=section.querySelector('.lb-section-head > .lb-chip'); if (chip) chip.textContent='SÉLECTION LIVE';
    const trains=bestSelection();
    grid.innerHTML=trains.length ? trains.map(t=>window.LBTrainUI?window.LBTrainUI.favorite(t,{allowRemove:false}):`<article class="lb-panel"><b>${esc(t.number)}</b></article>`).join('') : '<article class="lb-panel">Aucune circulation dans le snapshot.</article>';
  }

  function renderCrowding() {
    const section=$('#affluence');
    const grid=section?.querySelector('.lb-crowd-grid');
    if (!grid) return;
    const trains=state.trains.filter(t=>t.occupancy && Number.isFinite(Number(t.occupancy.percent))).slice(0,6);
    if (!trains.length) {
      grid.innerHTML='<article class="lb-panel"><span>DONNÉE NON PRÉSENTE</span><strong>—</strong><small>Le snapshot V4 actuel ne contient pas encore l’affluence. Aucun pourcentage inventé.</small></article>';
      return;
    }
    grid.innerHTML=trains.map(t=>{const p=Math.max(0,Math.min(100,Number(t.occupancy.percent)));return `<article class="lb-panel"><span>${esc(t.number)}</span><strong>${Math.round(p)}%</strong><div class="lb-meter"><i style="width:${p}%"></i></div><small>Affluence issue du moteur V4</small></article>`;}).join('');
  }

  function renderStatsPlaceholder() {
    const section=$('#stats');
    const primary=section?.querySelector('.lb-stat-primary');
    if (!primary) return;
    primary.innerHTML='<span>STATISTIQUES</span><strong>—</strong><small>API statistiques non encore injectée dans le snapshot V4. Aucun ancien chiffre de démonstration affiché.</small><div class="lb-stat-bar"><i style="width:0%"></i></div>';
    const facts=section.querySelector('.lb-fact-list');
    if (facts) facts.innerHTML='<li><span>État du branchement</span><b>À connecter au service stats 3099</b></li>';
  }

  function findTrain(number) {
    const n=String(number||'').match(/\d{3,6}/)?.[0] || '';
    return state.trains.find(t=>String(t.number)===n) || null;
  }

  function openTrain(number) {
    const train=findTrain(number); if (!train) return false;
    setText('trainDialogTitle',`TER ${train.number}`);
    const body=$('#trainDialogBody');
    if (body) body.innerHTML=window.LBTrainUI?window.LBTrainUI.full(train):`<p>Train ${esc(train.number)}</p>`;
    $('#trainDialog')?.showModal();
    return true;
  }

  function setupSearch() {
    const btn=$('#trainSearchBtn');
    const input=$('#trainSearch');
    if (btn && input) {
      const go=()=>{
        const ok=openTrain(input.value.trim());
        input.setCustomValidity(ok?'':'Train absent du snapshot réel actuel');
        if (!ok) input.reportValidity();
        setTimeout(()=>input.setCustomValidity(''),1200);
      };
      btn.onclick=go;
      input.onkeydown=(e)=>{if(e.key==='Enter')go();};
    }

    const routeArticle=$('#recherche .lb-search-grid article:nth-child(2)');
    if (!routeArticle) return;
    const inputs=$$('input',routeArticle);
    const invert=routeArticle.querySelector('.lb-icon-button');
    const routeBtn=routeArticle.querySelector('.lb-button:not(.lb-icon-button)');
    if (routeBtn) {
      routeBtn.disabled=false;
      routeBtn.textContent='Chercher dans le snapshot';
      routeBtn.onclick=()=>{
        const from=norm(inputs[0]?.value), to=norm(inputs[1]?.value);
        state.filteredTrains=state.trains.filter(t=>{
          const names=(t.stops||[]).map(s=>norm(s.name));
          const a=names.findIndex(n=>n.includes(from));
          const b=names.findIndex(n=>n.includes(to));
          return from && to && a>=0 && b>a;
        });
        renderBoard();
        document.getElementById('tableau')?.scrollIntoView({behavior:'smooth',block:'start'});
      };
    }
    if (invert && inputs.length>=2) invert.onclick=()=>{const x=inputs[0].value;inputs[0].value=inputs[1].value;inputs[1].value=x;};
  }

  function wireGlobal() {
    document.addEventListener('click',e=>{
      const open=e.target.closest('[data-lb-open-train],[data-open-train]');
      if (open) { e.preventDefault(); openTrain(open.getAttribute('data-lb-open-train')||open.getAttribute('data-open-train')); return; }
      if (e.target.closest('[data-close-dialog]')) $('#trainDialog')?.close();
    });
    $('#trainDialog')?.addEventListener('click',e=>{if(e.target===$('#trainDialog')) $('#trainDialog').close();});
  }

  function renderError() {
    renderMode();
    setText('networkState','#BER HORS LECTURE');
    setText('networkSummary','snapshot V4 introuvable');
    setText('kpiTrains','0'); setText('kpiDelay','—'); setText('kpiCancelled','—'); setText('kpiLive','—');
    const body=$('#boardBody'); if(body) body.innerHTML='<tr><td colspan="6">Aucune donnée réelle chargée. La preview n’affiche volontairement aucune donnée de démonstration.</td></tr>';
  }

  async function init() {
    wireGlobal();
    await loadData();
    if (state.mode==='error') { renderError(); return; }
    renderMode(); renderKpis(); renderTraffic(); renderSelection(); renderBoard(); renderCrowding(); renderStatsPlaceholder(); setupSearch();
    console.info('[LB V4] snapshot réel chargé', {mode:state.mode,trains:state.trains.length,meta:state.meta,sources:state.sources});
  }

  init().catch(err=>{console.error('[LB V4 site-v2]',err);state.mode='error';renderError();});
})();
