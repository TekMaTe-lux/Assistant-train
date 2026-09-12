'use strict';

(function installSignalGpsDelaySuggestion(){
  const TRAIN_SELECT_ID = 'lbSignalTrainSelect';
  const DELAY_SELECT_ID = 'lbSignalDelaySelect';
  const DELAY_WRAP_ID = 'lbSignalDelayWrap';
  const SUGGESTION_ID = 'lbSignalGpsDelaySuggestion';
  const STYLE_ID = 'lbSignalGpsDelayStyle';
  const routeCache = new Map();
  let requestSerial = 0;

  const API_BASE = (() => {
    try {
      return String(window.__LB_BACKEND_BASE || window.__LB_API_BASE || 'https://vps.labetaillere.fr').replace(/\/+$/g, '');
    } catch (_) {
      return 'https://vps.labetaillere.fr';
    }
  })();

  const normalizeTrain = (value) => String(value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  const stationKey = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(gare centrale|gare sncf|gare)\b/g, ' ')
    .replace(/\bville\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Même axe que la carte Nancy ↔ Luxembourg. Les coordonnées ne servent
  // qu'à projeter localement le GPS ; les horaires restent ceux du GTFS statique.
  const AXIS = [
    { name:'Nancy', code:'87141002', lat:48.689857, lon:6.174579 },
    { name:'Champigneulles', code:'87141085', lat:48.735025, lon:6.168952 },
    { name:'Frouard', code:'87141077', lat:48.755428, lon:6.143927 },
    { name:'Pompey', code:'87141788', lat:48.773040, lon:6.130610 },
    { name:'Marbache', code:'87141796', lat:48.801156, lon:6.108779 },
    { name:'Belleville', code:'87141804', lat:48.819245, lon:6.101779 },
    { name:'Dieulouard', code:'87141812', lat:48.843826, lon:6.071505 },
    { name:'Pont-à-Mousson', code:'87141820', lat:48.900348, lon:6.051021 },
    { name:'Vandières', code:'87192476', lat:48.951493, lon:6.039047 },
    { name:'Pagny-sur-Moselle', code:'87192468', lat:48.985200, lon:6.025035 },
    { name:'Novéant-sur-Moselle', code:'87192427', lat:49.028717, lon:6.052051, aliases:['Novéant'] },
    { name:'Ancy-sur-Moselle', code:'87192419', lat:49.057714, lon:6.062342 },
    { name:'Ars-sur-Moselle', code:'87192401', lat:49.074475, lon:6.077646 },
    { name:'Metz', code:'87192039', lat:49.109466, lon:6.177052, aliases:['Metz-Ville', 'Metz-Ville, Gare'] },
    { name:'Metz Nord', code:'87192070', lat:49.136865, lon:6.167538, aliases:['Metz-Nord'] },
    { name:'Woippy', code:'87192088', lat:49.148797, lon:6.155621 },
    { name:'Maizières-lès-Metz', code:'87191106', lat:49.215536, lon:6.158727 },
    { name:'Walygator parc', code:'87191098', lat:49.224920, lon:6.159460 },
    { name:'Hagondange', code:'87191114', lat:49.253560, lon:6.164480 },
    { name:'Uckange', code:'87191130', lat:49.303459, lon:6.156600 },
    { name:'Thionville', code:'87191007', lat:49.353965, lon:6.168582, aliases:['Thionville, Gare'] },
    { name:'Hettange-Grande', code:'87191163', lat:49.407685, lon:6.156759, aliases:['Hettange-Grande, Gare SNCF'] },
    { name:'Bettembourg', code:'82006030', lat:49.516515, lon:6.101676, aliases:['Bettembourg, Gare'] },
    { name:'Howald', code:'82002501', lat:49.580320, lon:6.132320, aliases:['Howald, Gare'] },
    { name:'Luxembourg', code:'82001000', lat:49.599969, lon:6.134240, aliases:['Luxembourg, Gare Centrale'] }
  ];

  const axisByName = new Map();
  const axisByCode = new Map();
  AXIS.forEach((stop, index) => {
    [stop.name, ...(stop.aliases || [])].forEach((name) => {
      const key = stationKey(name);
      if (key) axisByName.set(key, index);
    });
    if (stop.code) axisByCode.set(String(stop.code), index);
  });

  const todayIso = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const selectedMeta = () => {
    const select = document.getElementById(TRAIN_SELECT_ID);
    const option = select?.selectedOptions?.[0] || null;
    const rawDate = String(option?.dataset?.date || option?.dataset?.serviceDate || todayIso());
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : /^\d{8}$/.test(rawDate)
        ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`
        : todayIso();
    const text = String(option?.textContent || '');
    const departure = text.match(/\((\d{1,2}:\d{2})\s*[-–—]/)?.[1] || '';
    return {
      train: normalizeTrain(select?.value),
      date,
      departure
    };
  };

  const parseGtfsMinutes = (value) => {
    const match = String(value || '').trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    const s = Number(match[3] || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59 || s > 59) return null;
    return (h * 60) + m + (s / 60);
  };

  const rowTimeMinutes = (row, preferArrival = false) => parseGtfsMinutes(
    preferArrival
      ? (row?.arrival_time || row?.departure_time || row?.time)
      : (row?.departure_time || row?.arrival_time || row?.time)
  );

  const rowAxisIndex = (row) => {
    const idText = [
      row?.parent_station,
      row?.stop_id,
      row?.stop_code,
      row?.stopPoint?.id
    ].filter(Boolean).join(' ');
    for (const code of idText.match(/\d{8}/g) || []) {
      if (axisByCode.has(code)) return axisByCode.get(code);
    }
    const name = row?.stop_name || row?.name || row?.station || row?.stopPoint?.name || '';
    return axisByName.get(stationKey(name));
  };

  const groupTrips = (rows) => {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const trip = String(row?.trip_id || row?.tripId || 'default');
      if (!groups.has(trip)) groups.set(trip, []);
      groups.get(trip).push(row);
    });
    return Array.from(groups.values()).map((group) => group.slice().sort((a, b) =>
      Number(a?.stop_sequence || a?.stopSequence || 0) - Number(b?.stop_sequence || b?.stopSequence || 0)
    ));
  };

  const minutesToClock = (minutes) => {
    if (!Number.isFinite(minutes)) return '';
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = ((total % 60) + 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const clockDistance = (a, b) => {
    const aa = parseGtfsMinutes(a);
    const bb = parseGtfsMinutes(b);
    if (!Number.isFinite(aa) || !Number.isFinite(bb)) return Infinity;
    const direct = Math.abs(aa - bb);
    return Math.min(direct, Math.abs(direct - 1440), Math.abs(direct + 1440));
  };

  const chooseTrip = (rows, wantedDeparture) => {
    const groups = groupTrips(rows).filter((group) => group.length);
    if (!groups.length) return [];
    return groups.sort((a, b) => {
      const aMinutes = rowTimeMinutes(a[0]);
      const bMinutes = rowTimeMinutes(b[0]);
      const ad = wantedDeparture ? clockDistance(minutesToClock(aMinutes), wantedDeparture) : Infinity;
      const bd = wantedDeparture ? clockDistance(minutesToClock(bMinutes), wantedDeparture) : Infinity;
      if (ad !== bd) return ad - bd;
      return b.length - a.length;
    })[0];
  };

  async function fetchTripRows(meta) {
    const key = `${meta.date}|${meta.train}`;
    if (routeCache.has(key)) return routeCache.get(key);
    const apiDate = meta.date.replace(/-/g, '');
    const url = `${API_BASE}/api/train-static?date=${encodeURIComponent(apiDate)}&train=${encodeURIComponent(meta.train)}`;
    const response = await fetch(url, { cache:'default', credentials:'omit' });
    if (!response.ok) throw new Error(`GTFS HTTP ${response.status}`);
    const data = await response.json();
    const trip = chooseTrip(data?.stop_times || data?.stops || [], meta.departure);
    if (!trip.length) throw new Error('Parcours statique introuvable');
    routeCache.set(key, trip);
    return trip;
  }

  const haversineMeters = (a, b) => {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const routeAnchors = (rows) => {
    const raw = [];
    rows.forEach((row, index) => {
      const axisIndex = rowAxisIndex(row);
      const time = rowTimeMinutes(row, index === rows.length - 1);
      if (!Number.isInteger(axisIndex) || !Number.isFinite(time)) return;
      raw.push({ axisIndex, time, row });
    });
    if (raw.length < 2) return [];

    const firstPair = raw.find((anchor, index) => index > 0 && anchor.axisIndex !== raw[index - 1].axisIndex);
    const firstPairIndex = firstPair ? raw.indexOf(firstPair) : -1;
    if (firstPairIndex < 1) return [];
    const direction = Math.sign(raw[firstPairIndex].axisIndex - raw[firstPairIndex - 1].axisIndex);
    if (!direction) return [];

    const anchors = [raw[0]];
    for (let i = 1; i < raw.length; i += 1) {
      const previous = anchors[anchors.length - 1];
      const current = raw[i];
      if ((current.axisIndex - previous.axisIndex) * direction < 0) continue;
      if (current.time < previous.time) {
        while (current.time < previous.time) current.time += 1440;
      }
      if (current.axisIndex === previous.axisIndex) {
        if (current.time > previous.time) previous.time = current.time;
        continue;
      }
      anchors.push(current);
    }
    return anchors.length >= 2 ? anchors : [];
  };

  const buildScheduledPath = (rows) => {
    const anchors = routeAnchors(rows);
    if (anchors.length < 2) return [];
    const path = [];

    for (let pairIndex = 0; pairIndex < anchors.length - 1; pairIndex += 1) {
      const from = anchors[pairIndex];
      const to = anchors[pairIndex + 1];
      const direction = Math.sign(to.axisIndex - from.axisIndex);
      if (!direction) continue;

      const indexes = [];
      for (let i = from.axisIndex; ; i += direction) {
        indexes.push(i);
        if (i === to.axisIndex) break;
      }

      const cumulative = [0];
      for (let i = 1; i < indexes.length; i += 1) {
        cumulative[i] = cumulative[i - 1] + haversineMeters(AXIS[indexes[i - 1]], AXIS[indexes[i]]);
      }
      const totalDistance = cumulative[cumulative.length - 1] || 1;

      indexes.forEach((axisIndex, i) => {
        if (pairIndex > 0 && i === 0) return;
        const fraction = cumulative[i] / totalDistance;
        const time = from.time + ((to.time - from.time) * fraction);
        const stop = AXIS[axisIndex];
        path.push({ lat:stop.lat, lon:stop.lon, time, axisIndex });
      });
    }
    return path;
  };

  const projectGpsToPath = (coords, path) => {
    if (!coords || path.length < 2) return null;
    const latScale = 110540;
    const lonScale = 111320 * Math.cos((Number(coords.latitude) || 0) * Math.PI / 180);
    let best = null;

    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const ax = (a.lon - coords.longitude) * lonScale;
      const ay = (a.lat - coords.latitude) * latScale;
      const bx = (b.lon - coords.longitude) * lonScale;
      const by = (b.lat - coords.latitude) * latScale;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = (dx * dx) + (dy * dy);
      if (length2 <= 0) continue;
      const t = Math.max(0, Math.min(1, -((ax * dx) + (ay * dy)) / length2));
      const px = ax + (t * dx);
      const py = ay + (t * dy);
      const distance = Math.hypot(px, py);
      if (!best || distance < best.distance) {
        best = {
          distance,
          time: a.time + ((b.time - a.time) * t),
          segment: i,
          fraction: t
        };
      }
    }
    return best;
  };

  const actualMinutesForDate = (dateIso, timestamp) => {
    const match = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const midnight = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
    return (Number(timestamp || Date.now()) - midnight.getTime()) / 60000;
  };

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SUGGESTION_ID}{
        display:none;
        margin-top:8px;
        padding:8px 10px;
        border:1px solid rgba(64,225,255,.28);
        border-radius:12px;
        background:rgba(4,25,39,.78);
        color:#bceef6;
        font:600 .78rem/1.25 "Rajdhani",system-ui,sans-serif;
        letter-spacing:.01em;
      }
      #${SUGGESTION_ID}.is-visible{display:block}
      #${SUGGESTION_ID}.is-success{
        border-color:rgba(79,236,196,.38);
        color:#d5fff3;
      }
      #${SUGGESTION_ID}.is-muted{
        border-color:rgba(151,181,194,.22);
        color:#9fb6c0;
      }
    `;
    document.head.appendChild(style);
  };

  const suggestionBox = () => {
    const wrap = document.getElementById(DELAY_WRAP_ID);
    if (!wrap) return null;
    ensureStyles();
    let box = document.getElementById(SUGGESTION_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = SUGGESTION_ID;
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      wrap.appendChild(box);
    }
    return box;
  };

  const renderSuggestion = (message, state = '') => {
    const box = suggestionBox();
    if (!box) return;
    box.className = `is-visible ${state ? `is-${state}` : ''}`.trim();
    box.textContent = message;
  };

  const hideSuggestion = () => {
    const box = document.getElementById(SUGGESTION_ID);
    if (!box) return;
    box.className = '';
    box.textContent = '';
  };

  const setDelaySelect = (delay) => {
    const select = document.getElementById(DELAY_SELECT_ID);
    if (!select || !Number.isFinite(delay) || delay <= 0) return false;
    const value = String(Math.max(1, Math.min(180, Math.round(delay))));
    select.querySelectorAll('option[data-lb-gps-delay="1"]').forEach((option) => option.remove());
    let option = Array.from(select.options).find((item) => item.value === value);
    if (!option) {
      option = document.createElement('option');
      option.value = value;
      option.textContent = `+${value} min (GPS)`;
      option.dataset.lbGpsDelay = '1';
      select.appendChild(option);
    }
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  };

  const getOnePosition = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(error || new Error('Position indisponible')),
      { enableHighAccuracy:true, timeout:8000, maximumAge:15000 }
    );
  });

  async function estimateDelayFromGps() {
    const token = ++requestSerial;
    const meta = selectedMeta();
    if (!meta.train) return;

    renderSuggestion('📍 Estimation du retard à partir de votre position…');
    try {
      // Le GPS reste dans le navigateur : aucune coordonnée n'est envoyée au VPS.
      const [position, rows] = await Promise.all([
        getOnePosition(),
        fetchTripRows(meta)
      ]);
      if (token !== requestSerial || selectedMeta().train !== meta.train) return;

      const accuracy = Number(position?.coords?.accuracy);
      if (!Number.isFinite(accuracy) || accuracy > 1200) {
        throw new Error('Précision GPS insuffisante');
      }

      const path = buildScheduledPath(rows);
      if (path.length < 2) {
        throw new Error('Parcours hors axe Nancy–Luxembourg');
      }

      const projected = projectGpsToPath(position.coords, path);
      if (!projected) throw new Error('Projection impossible');

      const maxDistance = Math.min(1400, Math.max(350, accuracy * 2.5));
      if (projected.distance > maxDistance) {
        throw new Error('Position trop éloignée du parcours');
      }

      let actual = actualMinutesForDate(meta.date, position.timestamp || Date.now());
      if (!Number.isFinite(actual)) throw new Error('Heure locale indisponible');
      while (actual < projected.time - 720) actual += 1440;
      while (actual > projected.time + 720) actual -= 1440;

      const estimated = Math.round(actual - projected.time);
      if (estimated < -5 || estimated > 180) {
        throw new Error('Estimation incohérente');
      }

      if (estimated <= 1) {
        renderSuggestion('📍 Votre position est compatible avec un train à l’heure.', 'success');
        return;
      }

      if (setDelaySelect(estimated)) {
        renderSuggestion(`📍 GPS : ≈ +${estimated} min prérempli · modifiable avant publication`, 'success');
      }
    } catch (error) {
      if (token !== requestSerial) return;
      const denied = Number(error?.code) === 1;
      renderSuggestion(
        denied
          ? 'GPS refusé · choisissez simplement le retard manuellement.'
          : 'GPS non exploitable · choisissez simplement le retard manuellement.',
        'muted'
      );
    }
  }

  document.addEventListener('click', (event) => {
    const delayButton = event.target?.closest?.('.lb-signal-type[data-signal-type="retard"]');
    if (!delayButton) return;
    // Laisse d'abord le code historique ouvrir la zone retard, puis estime.
    window.setTimeout(() => estimateDelayFromGps(), 0);
  }, false);

  document.addEventListener('change', (event) => {
    if (event.target?.id !== TRAIN_SELECT_ID) return;
    requestSerial += 1;
    hideSuggestion();
  }, true);

  // API de debug/test volontairement minimale ; aucune coordonnée n'est exposée.
  window.lbSignalGpsDelay = {
    estimate: estimateDelayFromGps
  };
})();
