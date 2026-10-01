'use strict';

(function installSignalStationsFix(){
  const TRAIN_SELECT_ID = 'lbSignalTrainSelect';
  const STATION_SELECT_ID = 'lbSignalStationSelect';
  const MODAL_ID = 'lbSignalModal';
  const routeCache = new Map();
  const inFlight = new Map();
  let modalObserver = null;
  let stationObserver = null;
  let applying = false;
  let refreshTimer = 0;

  const normalizeTrain = (value) => String(value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  const stationKey = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const todayIso = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const cacheKeyFor = (trainKey) => `${todayIso()}|${trainKey}`;

  const uniqueNames = (values) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const name = String(value || '').trim();
      const key = stationKey(name);
      if (!name || !key || seen.has(key)) return;
      seen.add(key);
      out.push(name);
    });
    return out;
  };

  const currentNames = (select) => Array.from(select?.options || [])
    .map((option) => String(option.value || '').trim())
    .filter(Boolean);

  const cachedStops = (trainKey) => routeCache.get(cacheKeyFor(trainKey)) || null;

  const applyStops = (trainKey, names) => {
    const trainSelect = document.getElementById(TRAIN_SELECT_ID);
    const stationSelect = document.getElementById(STATION_SELECT_ID);
    if (!trainSelect || !stationSelect) return false;
    if (normalizeTrain(trainSelect.value) !== trainKey) return false;

    const stops = uniqueNames(names);
    const existing = currentNames(stationSelect);
    // Ne jamais remplacer une liste plus riche par une liste plus pauvre.
    if (stops.length < 2 || stops.length < existing.length) return false;
    const same = stops.length === existing.length
      && stops.every((name, index) => stationKey(name) === stationKey(existing[index]));
    if (same) return false;

    const previous = String(stationSelect.value || '').trim();
    applying = true;
    try {
      stationSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choisir la gare concernée';
      stationSelect.appendChild(placeholder);
      stops.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        stationSelect.appendChild(option);
      });
      if (previous) {
        const previousKey = stationKey(previous);
        const match = stops.find((name) => stationKey(name) === previousKey);
        if (match) stationSelect.value = match;
      }
      stationSelect.dataset.lbFullRouteTrain = trainKey;
      return true;
    } finally {
      applying = false;
    }
  };

  const rowsToNames = (rows) => uniqueNames((Array.isArray(rows) ? rows : []).map((row) =>
    row?.name || row?.stop_name || row?.station || row?.stopPoint?.name || ''
  ));

  const chooseLongestTrip = (rows) => {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const trip = String(row?.trip_id || row?.tripId || 'default');
      if (!groups.has(trip)) groups.set(trip, []);
      groups.get(trip).push(row);
    });
    return Array.from(groups.values())
      .map((group) => group.slice().sort((a, b) => Number(a?.stop_sequence || a?.stopSequence || 0) - Number(b?.stop_sequence || b?.stopSequence || 0)))
      .sort((a, b) => b.length - a.length)[0] || [];
  };

  async function fetchOfficialStops(trainKey) {
    const key = cacheKeyFor(trainKey);
    if (routeCache.has(key)) return routeCache.get(key);
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      let names = [];

      // 1) Parcours officiel déjà utilisé par la fiche train.
      if (typeof window.lbGetOfficialServicePattern === 'function') {
        try {
          const official = await window.lbGetOfficialServicePattern(trainKey, todayIso());
          names = rowsToNames(official?.rows);
        } catch (error) {
          console.warn('[SIGNAL stations] parcours officiel indisponible', error?.message || error);
        }
      }

      // 2) Détail statique léger du train. On le compare systématiquement au
      // parcours officiel et on conserve la liste la plus complète.
      try {
        const url = `https://vps.labetaillere.fr/api/train-static?date=${encodeURIComponent(todayIso())}&train=${encodeURIComponent(trainKey)}`;
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          const trip = chooseLongestTrip(data?.stop_times || data?.stops || []);
          const apiNames = rowsToNames(trip);
          if (apiNames.length > names.length) names = apiNames;
        }
      } catch (error) {
        console.warn('[SIGNAL stations] détail statique indisponible', error?.message || error);
      }

      // Deux arrêts peuvent être légitimes pour certains trains ; on garde donc
      // toute liste officielle non vide, sans jamais inventer d'arrêt.
      if (names.length >= 2) routeCache.set(key, names);
      return names;
    })().finally(() => inFlight.delete(key));

    inFlight.set(key, promise);
    return promise;
  }

  async function refreshSelectedTrain() {
    const trainSelect = document.getElementById(TRAIN_SELECT_ID);
    const stationSelect = document.getElementById(STATION_SELECT_ID);
    if (!trainSelect || !stationSelect) return;
    const trainKey = normalizeTrain(trainSelect.value);
    if (!trainKey) return;

    stationSelect.setAttribute('aria-busy', 'true');
    const cached = cachedStops(trainKey);
    if (cached?.length) applyStops(trainKey, cached);

    try {
      const names = await fetchOfficialStops(trainKey);
      if (names.length) applyStops(trainKey, names);
    } finally {
      if (normalizeTrain(trainSelect.value) === trainKey) stationSelect.removeAttribute('aria-busy');
    }
  }

  const scheduleRefresh = (delay = 0) => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshSelectedTrain().catch(() => {}), delay);
  };

  document.addEventListener('change', (event) => {
    if (event.target?.id !== TRAIN_SELECT_ID) return;
    scheduleRefresh(0);
    // Le code historique hydrate lui aussi la liste : les passes courtes
    // garantissent que le parcours complet reste prioritaire après son retour.
    window.setTimeout(() => scheduleRefresh(0), 350);
    window.setTimeout(() => scheduleRefresh(0), 1100);
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#lbOpenSignalModal,[data-lb-signal-train]')) {
      window.setTimeout(() => scheduleRefresh(0), 0);
      window.setTimeout(() => scheduleRefresh(0), 450);
    }
  }, true);

  function startTargetedObservers(){
    const modal = document.getElementById(MODAL_ID);
    const stationSelect = document.getElementById(STATION_SELECT_ID);

    // Important pour la carte : openSignalForTrain() ouvre le modal par JS,
    // sans clic DOM ni événement change. Observer uniquement CE modal permet
    // de déclencher l'hydratation au bon moment sans observer toute la page.
    if (modal && !modalObserver) {
      modalObserver = new MutationObserver(() => {
        const open = modal.classList.contains('is-open') || modal.getAttribute('aria-hidden') === 'false';
        if (!open) return;
        scheduleRefresh(0);
        window.setTimeout(() => scheduleRefresh(0), 450);
      });
      modalObserver.observe(modal, { attributes:true, attributeFilter:['class', 'aria-hidden'] });
    }

    // Protection ciblée : si le code historique remet seulement origine/
    // destination après notre chargement, on réapplique le parcours complet.
    if (stationSelect && !stationObserver) {
      stationObserver = new MutationObserver(() => {
        if (applying) return;
        const trainSelect = document.getElementById(TRAIN_SELECT_ID);
        const trainKey = normalizeTrain(trainSelect?.value);
        const cached = trainKey ? cachedStops(trainKey) : null;
        if (!trainKey || !cached?.length) return;
        if (currentNames(stationSelect).length >= cached.length) return;
        applyStops(trainKey, cached);
      });
      stationObserver.observe(stationSelect, { childList:true });
    }
  }

  const start = () => {
    startTargetedObservers();
    scheduleRefresh(0);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();

(function installTrainDetailCommunityStyle(){
  if (window.__LB_TRAIN_DETAIL_COMMUNITY_V1__) return;
  window.__LB_TRAIN_DETAIL_COMMUNITY_V1__ = true;

  const ROOT_ID = 'lbTrainDetailStops';
  let detailObserver = null;
  let decorateQueued = false;

  const compactText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function decorateDetail(){
    decorateQueued = false;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    root.querySelectorAll('.lb-train-stop-signals .lb-stop-chip--retard').forEach((chip) => {
      if (chip.getAttribute('title') === 'Donnée officielle SNCF') return;

      const raw = compactText(chip.textContent);
      const match = raw.match(/Retard\s*\+\s*(\d+)\s*min(?:\s*(?:·|-)\s*depuis\s+(.+))?/i);
      if (!match) return;

      const delayMin = Math.max(0, Number(match[1]) || 0);
      if (!delayMin) return;
      const source = compactText(match[2]);

      chip.classList.add('lb-stop-chip--community-delay');
      chip.textContent = `+${delayMin} min*`;
      chip.title = 'Retard signalé par la communauté (* = Voix du Bétail)';
      chip.setAttribute('aria-label', `Retard communautaire de ${delayMin} minutes`);

      const signalWrap = chip.closest('.lb-stop-chip-wrap');
      if (signalWrap) signalWrap.classList.add('lb-community-detail-source-stop');

      if (!source) return;
      let group = chip.closest('.lb-community-detail-propagated');
      if (!group) {
        group = document.createElement('span');
        group.className = 'lb-community-detail-propagated';
        chip.replaceWith(group);
        group.appendChild(chip);
      }
      let sourceLabel = group.querySelector('.lb-community-detail-source');
      if (!sourceLabel) {
        sourceLabel = document.createElement('span');
        sourceLabel.className = 'lb-community-detail-source';
        group.appendChild(sourceLabel);
      }
      sourceLabel.textContent = `depuis ${source}`;
    });
  }

  function scheduleDecorate(){
    if (decorateQueued) return;
    decorateQueued = true;
    window.requestAnimationFrame(decorateDetail);
  }

  function installStyle(){
    if (document.getElementById('lb-community-train-detail-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-train-detail-style';
    style.textContent = `
      #lbTrainDetailModal #lbTrainDetailStops .lb-stop-chip--community-delay{
        box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
        width:auto!important;min-width:0!important;min-height:20px!important;height:20px!important;padding:0 7px!important;
        border:1px solid rgba(183,140,255,.52)!important;border-radius:999px!important;
        background:rgba(77,43,113,.72)!important;color:#f1e8ff!important;
        font-weight:900!important;line-height:1!important;box-shadow:none!important;white-space:nowrap!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-stop-chip--community-delay::before{display:none!important;content:none!important}
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-propagated{
        display:inline-flex!important;align-items:center!important;gap:5px!important;flex-wrap:wrap!important;max-width:100%!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source{
        color:#bbaece!important;font-size:.68rem!important;font-weight:700!important;line-height:1.1!important;white-space:nowrap!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source-stop{
        display:inline-flex!important;align-items:center!important;gap:3px!important;flex-wrap:wrap!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source-stop .lb-signal-vote{
        display:inline-flex!important;align-items:center!important;gap:1px!important;padding:0 1px!important;background:transparent!important;border:0!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source-stop .lb-signal-vote-btn{
        width:17px!important;min-width:17px!important;height:17px!important;min-height:17px!important;padding:0!important;
        border:0!important;border-radius:50%!important;background:rgba(8,27,38,.62)!important;font-size:9px!important;line-height:17px!important;box-shadow:none!important;
      }
      #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source-stop .lb-signal-vote-count{
        min-width:9px!important;color:#9fb4bc!important;font-size:.55rem!important;font-weight:800!important;text-align:center!important;
      }
      @media(max-width:620px){
        #lbTrainDetailModal #lbTrainDetailStops .lb-stop-chip--community-delay{height:18px!important;min-height:18px!important;padding:0 6px!important}
        #lbTrainDetailModal #lbTrainDetailStops .lb-community-detail-source{font-size:.62rem!important}
      }
    `;
    document.head.appendChild(style);
  }

  function bindObserver(){
    const root = document.getElementById(ROOT_ID);
    if (!root || detailObserver) return;
    detailObserver = new MutationObserver(scheduleDecorate);
    detailObserver.observe(root, { childList:true, subtree:true });
    scheduleDecorate();
  }

  const start = () => {
    installStyle();
    bindObserver();
    scheduleDecorate();
  };

  window.addEventListener('lb:community-data-changed', scheduleDecorate);
  window.addEventListener('lb:community-presence-changed', scheduleDecorate);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();


// Estimation GPS du retard : module séparé pour garder le correctif de gares stable.
(function loadSignalGpsDelayModule(){
  const id = 'lb-signal-gps-delay-script';
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.src = './assets/signal-gps-delay.js?v=20260905-1';
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
