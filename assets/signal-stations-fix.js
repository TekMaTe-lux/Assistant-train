'use strict';

(function installSignalStationsFix(){
  const TRAIN_SELECT_ID = 'lbSignalTrainSelect';
  const STATION_SELECT_ID = 'lbSignalStationSelect';
  const routeCache = new Map();
  const inFlight = new Map();
  let observer = null;
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

  const applyStops = (trainKey, names) => {
    const trainSelect = document.getElementById(TRAIN_SELECT_ID);
    const stationSelect = document.getElementById(STATION_SELECT_ID);
    if (!trainSelect || !stationSelect) return false;
    if (normalizeTrain(trainSelect.value) !== trainKey) return false;

    const stops = uniqueNames(names);
    const existing = currentNames(stationSelect);
    // Ne jamais dégrader une liste déjà plus complète.
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
      stationSelect.removeAttribute('aria-busy');
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
    if (routeCache.has(trainKey)) return routeCache.get(trainKey);
    if (inFlight.has(trainKey)) return inFlight.get(trainKey);

    const promise = (async () => {
      let names = [];

      // Source prioritaire : le même parcours officiel que la fiche train.
      if (typeof window.lbGetOfficialServicePattern === 'function') {
        try {
          const official = await window.lbGetOfficialServicePattern(trainKey, todayIso());
          names = rowsToNames(official?.rows);
        } catch (error) {
          console.warn('[SIGNAL stations] parcours officiel indisponible', error?.message || error);
        }
      }

      // Secours léger : détail statique du train, sans stop_times.txt côté navigateur.
      if (names.length < 3) {
        try {
          const apiDate = todayIso().replace(/-/g, '');
          const url = `https://vps.labetaillere.fr/api/train-static?date=${encodeURIComponent(apiDate)}&train=${encodeURIComponent(trainKey)}`;
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok) {
            const data = await response.json();
            const trip = chooseLongestTrip(data?.stop_times || data?.stops || []);
            const apiNames = rowsToNames(trip);
            if (apiNames.length > names.length) names = apiNames;
          }
        } catch (error) {
          console.warn('[SIGNAL stations] détail statique indisponible', error?.message || error);
        }
      }

      // Ne met en cache que les parcours réellement plus riches que le simple OD.
      if (names.length > 2) routeCache.set(trainKey, names);
      return names;
    })().finally(() => inFlight.delete(trainKey));

    inFlight.set(trainKey, promise);
    return promise;
  }

  async function refreshSelectedTrain() {
    const trainSelect = document.getElementById(TRAIN_SELECT_ID);
    const stationSelect = document.getElementById(STATION_SELECT_ID);
    if (!trainSelect || !stationSelect) return;
    const trainKey = normalizeTrain(trainSelect.value);
    if (!trainKey) return;

    const cached = routeCache.get(trainKey);
    if (cached?.length) applyStops(trainKey, cached);

    const names = await fetchOfficialStops(trainKey);
    if (names.length) applyStops(trainKey, names);
  }

  const scheduleRefresh = (delay = 0) => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshSelectedTrain().catch(() => {}), delay);
  };

  document.addEventListener('change', (event) => {
    if (event.target?.id !== TRAIN_SELECT_ID) return;
    scheduleRefresh(0);
    // Le code historique hydrate aussi le select de façon asynchrone :
    // une deuxième passe empêche son fallback origine/destination de reprendre la main.
    window.setTimeout(() => scheduleRefresh(0), 450);
    window.setTimeout(() => scheduleRefresh(0), 1400);
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#lbOpenSignalModal,[data-lb-signal-train]')) {
      window.setTimeout(() => scheduleRefresh(0), 0);
      window.setTimeout(() => scheduleRefresh(0), 500);
    }
  }, true);

  const startObserver = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations) => {
      if (applying) return;
      const stationSelect = document.getElementById(STATION_SELECT_ID);
      const trainSelect = document.getElementById(TRAIN_SELECT_ID);
      if (!stationSelect || !trainSelect) return;
      const trainKey = normalizeTrain(trainSelect.value);
      const cached = routeCache.get(trainKey);
      if (!trainKey || !cached?.length) return;
      const existing = currentNames(stationSelect);
      if (existing.length >= cached.length) return;
      const touchedStationSelect = mutations.some((mutation) =>
        mutation.target === stationSelect || stationSelect.contains(mutation.target)
      );
      if (touchedStationSelect) applyStops(trainKey, cached);
    });
    observer.observe(document.body, { subtree: true, childList: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startObserver();
      scheduleRefresh(0);
    }, { once: true });
  } else {
    startObserver();
    scheduleRefresh(0);
  }
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
