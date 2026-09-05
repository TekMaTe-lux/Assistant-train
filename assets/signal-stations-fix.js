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
