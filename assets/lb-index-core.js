window.__IS_IOS__ = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- VISIBILITÉ DU BLOC PERTURBATIONS ---------- */
const container = document.getElementById('disruptionsSummary');
if (container && !container.querySelector('.disruption-box')) {
  container.style.display = 'none';
} else if (container) {
  container.style.display = 'block';
}

 let mainTableRendered = false;

/* ---------- PHRASES BINGO (source unique) ---------- */
window.phrasesBingo = [
    "Le retard du train ? Le conducteur a fait une pause café... trop longue ! ☕️😄",
    "Pourquoi le train est en retard ? Il a pris le temps de saluer les vaches au bord des rails 🐄🚂",
    "La cause du retard : un troupeau de canards traverse la voie. Coin coin ! 🦆🛤️",
    "Aujourd'hui, le train a préféré faire une sieste avant de partir. Zzz... 💤",
    "Blague du jour : Pourquoi le train ne va-t-il jamais au bureau ? Parce qu'il est toujours en retard ! 😂",
    "Le train aurait dû partir à l'heure, mais il a eu un crush sur un TER et ils sont partis discuter 💘🚆",
    "Panne de réveil du chef de gare. Le train attend qu’il arrive… en train. ⏰➡️🚉",
    "Le train était à l'heure, mais il a oublié ses clés. Retour dépôt. 🔑😂",
    "Le train a pris le temps de finir sa saison Netflix avant de partir 📺🚄",
    "Retard inexpliqué : la SNCF mène l'enquête. 🔍👮‍♂️",
    "Le train joue à cache-cache avec les horaires. Il gagne souvent. ⏱️🫣",
    "Raison du retard : le contrôleur essayait de capturer un Pikachu sur les voies ⚡️🎮",
    "Le train voulait juste éviter un radar SNCF. Trop rde pour être flashé ! 📸😆",
    "Problème technique : le train a confondu 'aller' et 'revenir'. 🤯🔁",
    "Le conducteur a vu un chat noir traverser les rails. Superstition oblige. 🐈‍⬛🚫",
    "Arrêt prolongé : la locomotive s’est mise en grève pour une pause chocolat chaud 🍫☕",
    "Retard mystique : le train a traversé un tunnel temporel. Il est revenu... avant-hier. 🌀🕰️",
    "Les Luxembourgeois ? Ils attendent leur train... avec un verre de Riesling à la main. 🍷🚆😄",
    "Pourquoi les trains luxembourgeois sont toujours calmes ? Parce que tout le monde est zen ici ! 🧘‍♂️🚄",
    "Le train luxembourgeois est si ponctuel que même les horloges se mettent à l'heure. ⏰🇱🇺",
    "Les contrôleurs luxembourgeois ? Des amateurs de frites, ils distribuent des sourires en plus des billets ! 🍟😁",
    "Le train a attendu le client qui voulait finir sa partie de cartes avant de partir. 🃏🚆",
    "Le train est en retard, il a pris un détour pour admirer la vallée de la Moselle. 🍇🚞",
    "Un Luxembourgeois a demandé au train de ralentir, il voulait profiter du paysage. 🌳😎",
    "Le conducteur du train a confondu la pause cigarette avec la pause déjeuner. 🚬🍔",
    "Le train est en retard, un troupeau de moutons bloque les voies. 🐑🚧",
    "Pourquoi le train est en retard ? Il a dû changer sa playlist musicale ! 🎵🎧",
    "Le train est en grève, mais il continue à rouler... doucement. 🐢🚆",
    "La SNCF teste un nouveau mode : le train tortue. Lent mais sûr ! 🐢🚄",
    "Le train a refusé de démarrer sans son café du matin. ☕️🚂",
    "Le conducteur a fait un détour pour acheter des croissants. 🥐😋",
    "Le train s'est arrêté pour une selfie avec des fans. 🤳🚆",
    "Les Luxembourgeois sont tellement polis que le train attend que tout le monde soit prêt. 🙇‍♂️🚄",
    "Le train était prêt, mais les passagers étaient en retard. Retour à la case départ ! 🕰️🙄",
    "Le train est en retard, car le contrôleur a perdu son badge... encore ! 🎫🤦‍♂️",
    "Une famille de hérissons a traversé la voie, le train a attendu patiemment. 🦔🛤️",
    "Le train est en pause technique... pour une petite sieste du conducteur. 😴🚆",
    "Le train a été arrêté par une manifestation de fans de football. ⚽️🚫",
    "Le conducteur s'est trompé de train et doit revenir en arrière. 🔄🚆",
    "Le train a rencontré un embouteillage ferroviaire. 🚧🚂",
    "Le train est tombé amoureux d'une locomotive voisine. 💘🚄",
    "Le train a décidé de faire une pause pour admirer un arc-en-ciel. 🌈🚆",
    "Les Luxembourgeois attendent le train avec patience et humour... surtout l'humour ! 😂🇱🇺",
    "Le conducteur a oublié ses lunettes, le train roule au ralenti. 🤓🚂",
    "Le train est en retard, le chat du contrôleur s’est caché sous les sièges. 🐱🛤️",
    "Le train a fait un arrêt non prévu... pour un pique-nique improvisé ! 🧺🚄",
    "Le conducteur a voulu tester un nouveau chemin, ça a pris un peu plus de temps. 🗺️🚆",
    "Le train attendait un passager VIP... qui a pris son temps ! 👑🚂"
];

// ===== Numéro de train : 5 ou 6 chiffres =====
function extractTrainNumber(s){
  const m = String(s||'').match(/\b\d{5,6}\b/);
  return m ? m[0] : null;
}

/* ---------- DONNÉES COMPO + GTFS-RT (unifiée) ---------- */
if (typeof window.retardsGTFS === 'undefined') window.retardsGTFS = null;
if (typeof window.retardsGTFS_RAW === 'undefined') window.retardsGTFS_RAW = null;
if (typeof window.retardsGTFS_SOURCE === 'undefined') window.retardsGTFS_SOURCE = null;
if (typeof window.compoData === 'undefined') window.compoData = {};
if (typeof window.voiesByTrainMap === 'undefined') window.voiesByTrainMap = new Map();
if (typeof window.cflVoiesByTrainMap === 'undefined') window.cflVoiesByTrainMap = new Map();

let voiesByTrainPromise = null;
let cflVoiesByTrainPromise = null;

function normalizeVoiesTrainKey(raw){
  return String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeVoiesStopKey(rawKey){
  if (!rawKey) return null;
  const [cityRaw, timeRaw] = String(rawKey).split('|');
  const city = normalizeVoiesTrainKey(cityRaw);
  const time = (() => {
    if (!timeRaw) return null;
    let t = String(timeRaw).trim();
    t = t.replace(/h/ig, ':');
    t = t.replace(/[^0-9:]/g, '');
    if (/^\d{4}$/.test(t)) t = `${t.slice(0, 2)}:${t.slice(2)}`;
    if (!/^\d{2}:\d{2}$/.test(t)) return null;
    return t;
  })();
  if (!city || !time) return null;
  return `${city}|${time}`;
}

function normalizeVoiesBaseTime(raw){
  const digits = String(raw || '')
    .trim()
    .replace(/[^0-9]/g, '');
  if (digits.length >= 4) {
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    if (/^\d{2}$/.test(hh) && /^\d{2}$/.test(mm)) return `${hh}:${mm}`;
  }
  return null;
}

function normalizeVoieValue(raw){
  if (raw == null) return null;
  const txt = String(raw).trim();
  if (!txt || /^(-+|n\/?a|nc|null|undefined)$/i.test(txt)) return null;
  return txt.replace(/^voie\s*/i, '').replace(/^track\s*/i, '').trim() || null;
}

function pickVoieFromEntry(entry, mode = 'dep'){
  if (!entry) return null;
  if (typeof entry === 'string') return normalizeVoieValue(entry);
  if (typeof entry !== 'object') return null;
  const dep = normalizeVoieValue(entry.depTrack ?? entry.departure_track ?? entry.dep ?? entry.voie_depart);
  const arr = normalizeVoieValue(entry.arrTrack ?? entry.arrival_track ?? entry.arr ?? entry.voie_arrivee);
  const generic = normalizeVoieValue(entry.genericTrack ?? entry.track ?? entry.platform ?? entry.voie ?? entry.quai);
  return mode === 'arr'
    ? (arr || generic || dep)
    : (dep || generic || arr);
}

function resolveVoieByStopOnlyLikeCarte({ voiesMap, stopName, mode = 'dep' }){
  if (!(voiesMap instanceof Map) || !stopName) return null;
  const stopNorm = normalizeVoiesTrainKey(stopName);
  if (!stopNorm) return null;

  // Priorité aux entrées explicites dep/arr, puis fallback générique.
  let genericCandidate = null;
  for (const [k, entry] of voiesMap.entries()){
    if (typeof k !== 'string' || !k.startsWith(stopNorm + '|')) continue;
    if (!entry || typeof entry !== 'object') {
      const asText = pickVoieFromEntry(entry, mode);
      if (!genericCandidate && asText) genericCandidate = asText;
      continue;
    }
    const dep = normalizeVoieValue(entry.depTrack ?? entry.departure_track ?? entry.dep ?? entry.voie_depart);
    const arr = normalizeVoieValue(entry.arrTrack ?? entry.arrival_track ?? entry.arr ?? entry.voie_arrivee);
    const generic = normalizeVoieValue(entry.genericTrack ?? entry.track ?? entry.platform ?? entry.voie ?? entry.quai);
    if (mode === 'arr'){
      if (arr) return arr;
      if (!genericCandidate && generic) genericCandidate = generic;
      if (!genericCandidate && dep) genericCandidate = dep;
    } else {
      if (dep) return dep;
      if (!genericCandidate && generic) genericCandidate = generic;
      if (!genericCandidate && arr) genericCandidate = arr;
    }
  }
  return genericCandidate;
}

const LB_ENDPOINTS = Object.freeze({
  voiesByTrain: 'https://vps.labetaillere.fr/gtfs/voies_by_train.json',
  retardsCfl: 'https://vps.labetaillere.fr/gtfs/retards_cfl.json',
  compotrains: 'https://vps.labetaillere.fr/gtfs/Compotrains.json',
  hafasDepartureBoard: 'https://vps.labetaillere.fr/hafas/departureBoard',
  cflStaticBase: 'https://vps.labetaillere.fr/gtfs/static/CFL/',
  // FIX 2026-05-02 : les fichiers GTFS SNCF sont servis par le VPS, pas par GitHub/www.
  gtfsBase: 'https://vps.labetaillere.fr/gtfs/static/'
});

function normalizeVoiesPayload(data){
  const out = new Map();
  if (!data || typeof data !== 'object') return out;

  // Certains flux encapsulent les trains dans { trains: { ... } }
  const trainsData = (data.trains && typeof data.trains === 'object') ? data.trains : data;

  Object.entries(trainsData).forEach(([trainKey, rawEntries]) => {
    const normalizedTrain = normalizeVoiesTrainKey(trainKey);
    // On ignore les entrées qui ne semblent pas être des trains (ex: generated_at)
    if (!normalizedTrain || !/\d/.test(normalizedTrain)) return;

    const entriesMap = new Map();
    if (rawEntries && typeof rawEntries === 'object') {
      Object.entries(rawEntries).forEach(([k, v]) => {
        const normKey = normalizeVoiesStopKey(k);
        if (!normKey) return;
        if (v && typeof v === 'object') {
          const depTrack = normalizeVoieValue(v.depTrack ?? v.departure_track ?? v.dep_track ?? v.dep_platform ?? v.dep_voie ?? v.voie_depart ?? v.voie_dep);
          const arrTrack = normalizeVoieValue(v.arrTrack ?? v.arrival_track ?? v.arr_track ?? v.arr_platform ?? v.arr_voie ?? v.voie_arrivee ?? v.voie_arr);
          const genericTrack = normalizeVoieValue(v.genericTrack ?? v.track ?? v.platform ?? v.voie ?? v.quai ?? v.value ?? v.label);
          if (!depTrack && !arrTrack && !genericTrack) return;
          const prev = entriesMap.get(normKey);
          const merged = (prev && typeof prev === 'object')
            ? {
                depTrack: prev.depTrack || depTrack || null,
                arrTrack: prev.arrTrack || arrTrack || null,
                genericTrack: prev.genericTrack || genericTrack || null
              }
            : { depTrack, arrTrack, genericTrack };
          entriesMap.set(normKey, merged);
          return;
        }
        const voie = normalizeVoieValue(v);
        if (voie) entriesMap.set(normKey, voie);
      });
    }
    if (entriesMap.size) out.set(normalizedTrain, entriesMap);
  });
  return out;
}

async function loadVoiesByTrain({ forceFresh = false, onlyIfChanged = false } = {}){
  // onlyIfChanged: si true, on ne rebuild la Map que si le contenu a changé (ETag/hash)
  if (forceFresh) voiesByTrainPromise = null;
  if (voiesByTrainPromise) return voiesByTrainPromise;

  if (!forceFresh && (!(window.voiesByTrainMap instanceof Map) || !window.voiesByTrainMap.size)) {
    const cached = lbCacheRead('voiesByTrainMap', 90 * 1000);
    if (Array.isArray(cached)) {
      try { window.voiesByTrainMap = new Map(cached.map(([k,v]) => [k, new Map(v)])); } catch(_) {}
    }
  }

  voiesByTrainPromise = (async () => {
    let prevFirstColMinWidths = [];
    try {
      let text = null;
      let loadedFrom = null;

      for (const baseUrl of VOIES_BY_TRAIN_CANDIDATES){
        if (!baseUrl) continue;
        const url = baseUrl + (forceFresh ? `?t=${Date.now()}` : '');
        try {
          const res = await fetch(url, {
            cache: forceFresh ? 'no-store' : 'default',
            headers: (window.__voiesEtag && onlyIfChanged && !forceFresh && baseUrl === VOIES_BY_TRAIN_CANDIDATES[0])
              ? { 'If-None-Match': window.__voiesEtag }
              : {}
          });

          if (res.status === 304 && baseUrl === VOIES_BY_TRAIN_CANDIDATES[0]) {
            window.__voiesLastChanged = false;
            return (window.voiesByTrainMap instanceof Map) ? window.voiesByTrainMap : new Map();
          }

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const etag = res.headers.get('etag');
          if (etag && baseUrl === VOIES_BY_TRAIN_CANDIDATES[0]) window.__voiesEtag = etag;

          text = await res.text();
          loadedFrom = baseUrl;
          break;
        } catch (candidateErr){
          console.warn('[Voies] Source indisponible', baseUrl, candidateErr?.message || candidateErr);
        }
      }

      if (text == null) throw new Error('Aucune source voies_by_train disponible');
      // Signature légère (djb2) pour éviter de reparser si identique
      let sig = 5381;
      for (let i = 0; i < text.length; i++) {
        sig = ((sig << 5) + sig) + text.charCodeAt(i);
        sig = sig >>> 0;
      }
      sig = String(sig);

      if (onlyIfChanged && !forceFresh && window.__voiesSig && window.__voiesSig == sig) {
        window.__voiesLastChanged = false;
        // Ne rebuild pas la Map
        return (window.voiesByTrainMap instanceof Map) ? window.voiesByTrainMap : new Map();
      }

      window.__voiesSig = sig;
      const json = JSON.parse(text);
      window.voiesByTrainMap = normalizeVoiesPayload(json);
      window.__voiesSource = loadedFrom;
      window.__voiesLastChanged = true;
      try {
        const serial = Array.from(window.voiesByTrainMap.entries()).map(([k,m]) => [k, Array.from(m.entries())]);
        lbCacheWrite('voiesByTrainMap', serial);
      } catch(_) {}
      return window.voiesByTrainMap;

    } catch (err) {
      console.warn('[Voies] Chargement échoué', err?.message || err);
      window.__voiesLastChanged = false;
      if (window.voiesByTrainMap instanceof Map && window.voiesByTrainMap.size) return window.voiesByTrainMap;
      window.voiesByTrainMap = new Map();
      return window.voiesByTrainMap;
	} finally {
      voiesByTrainPromise = null;
    }
  })();

  return voiesByTrainPromise;
}

function getVoiesForTrain(num){
  if (!num) return null;
  const map = (window.voiesByTrainMap instanceof Map) ? window.voiesByTrainMap : null;
  if (!map || !map.size) return null;
  const trainKey = normalizeVoiesTrainKey(`Train ${num}`);
  return map.get(trainKey) || map.get(normalizeVoiesTrainKey(num)) || null;
}

function normalizeCflVoiesTrainKey(raw){
  const digits = String(raw || '').match(/(\d{2,6})/g);
  if (digits && digits.length){
    const last = digits[digits.length - 1];
    return normalizeVoiesTrainKey(last);
  }
  return normalizeVoiesTrainKey(raw);
}

function normalizeCflVoiesPayload(data){
  const out = new Map();
  if (!data || typeof data !== 'object') return out;

  const trainsData = (() => {
    if (data.data && typeof data.data === 'object') return data.data; // structure { updatedAt, data: { ... } }
    if (data.trains && typeof data.trains === 'object') return data.trains;
    return data;
  })();

  Object.entries(trainsData).forEach(([trainKey, stops]) => {
    const normalizedTrain = normalizeCflVoiesTrainKey(trainKey);
    if (!normalizedTrain) return;

    const stopMap = new Map();
    if (stops && typeof stops === 'object') {
      Object.entries(stops).forEach(([stopName, meta]) => {
        const voie = (meta && typeof meta === 'object') ? (meta.platform || meta.voie || meta.track) : null;
        const cleaned = String(voie || '').trim();
        const normalizedStop = normalizeVoiesTrainKey(stopName);
        if (normalizedStop && cleaned) stopMap.set(normalizedStop, cleaned);
      });
    }

    if (stopMap.size) out.set(normalizedTrain, stopMap);
  });

  return out;
}

function normalizeCflByStationPayload(data){
  const out = new Map();
  if (!data || typeof data !== 'object' || !data.stations || typeof data.stations !== 'object') return out;

  for (const [stationName, stationInfo] of Object.entries(data.stations)){
    const stopKey = normalizeVoiesTrainKey(stationName);
    if (!stopKey) continue;
    const departures = Array.isArray(stationInfo?.departures) ? stationInfo.departures : [];
    for (const dep of departures){
      if (!dep || typeof dep !== 'object') continue;
      const trainRaw = dep.train ?? dep.name ?? dep.number ?? dep.trainNumber ?? dep.line;
      const trainKey = normalizeCflVoiesTrainKey(trainRaw);
      if (!trainKey) continue;
      const voieRaw = dep.platform ?? dep.track ?? dep.voie ?? dep.quai;
      const voie = String(voieRaw || '').trim();
      if (!voie) continue;
      if (!out.has(trainKey)) out.set(trainKey, new Map());
      out.get(trainKey).set(stopKey, voie);
    }
  }

  return out;
}

function mergeCflVoiesMaps(primary, secondary){
  const merged = new Map();
  const sources = [primary, secondary];
  for (const src of sources){
    if (!(src instanceof Map)) continue;
    for (const [trainKey, stopMap] of src.entries()){
      if (!(stopMap instanceof Map) || !stopMap.size) continue;
      if (!merged.has(trainKey)) merged.set(trainKey, new Map());
      const target = merged.get(trainKey);
      for (const [stopKey, voie] of stopMap.entries()){
        if (!stopKey || !voie) continue;
        if (!target.has(stopKey)) target.set(stopKey, voie);
      }
    }
  }
  return merged;
}

async function loadCflVoiesByTrain({ forceFresh = false, onlyIfChanged = false } = {}){
  if (forceFresh) cflVoiesByTrainPromise = null;
  if (cflVoiesByTrainPromise) return cflVoiesByTrainPromise;

  cflVoiesByTrainPromise = (async () => {
    try {
      let lastErr = null;
	  let mapFromRetards = new Map();
      let mapFromByStation = new Map();
      let sourceRetards = null;
      let sourceByStation = null;

      for (const candidate of HAFAS_PROXY_CANDIDATES){
        if (!candidate) continue;
        const url = candidate + (forceFresh ? `?t=${Date.now()}` : '');
        try {
          const res = await fetch(url, { cache: forceFresh ? 'no-store' : 'default' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          mapFromRetards = normalizeCflVoiesPayload(json);
          sourceRetards = candidate;
          break;
        } catch (errCandidate){
          lastErr = errCandidate;
          console.warn('[CFL][Voies] Source indisponible', candidate, errCandidate?.message || errCandidate);
        }
      }

	  for (const candidate of HAFAS_BY_STATION_CANDIDATES){
        if (!candidate) continue;
        const url = candidate + (forceFresh ? `?t=${Date.now()}` : '');
        try {
          const res = await fetch(url, { cache: forceFresh ? 'no-store' : 'default' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          mapFromByStation = normalizeCflByStationPayload(json);
          sourceByStation = candidate;
          break;
        } catch (errCandidate){
          console.warn('[CFL][Voies by station] Source indisponible', candidate, errCandidate?.message || errCandidate);
        }
      }

      const merged = mergeCflVoiesMaps(mapFromByStation, mapFromRetards);
      if (merged.size){
        window.cflVoiesByTrainMap = merged;
        window.__cflVoiesSource = sourceByStation || sourceRetards || '';
        return window.cflVoiesByTrainMap;
      }

      if (lastErr) throw lastErr;
      throw new Error('Aucune source retards_cfl / retards_cfl_by_station disponible');
    } catch (err) {
      console.warn('[CFL][Voies] Chargement échoué', err?.message || err);
	  if (window.cflVoiesByTrainMap instanceof Map && window.cflVoiesByTrainMap.size) return window.cflVoiesByTrainMap;
      window.cflVoiesByTrainMap = new Map();
      return window.cflVoiesByTrainMap;
	} finally {
      cflVoiesByTrainPromise = null;
    }
  })();

  return cflVoiesByTrainPromise;
}

function getCflVoiesForTrain(num){
  if (!num) return null;
  const map = (window.cflVoiesByTrainMap instanceof Map) ? window.cflVoiesByTrainMap : null;
  if (!map || !map.size) return null;

  const candidates = [];
  const pushCandidate = (value) => {
    const norm = normalizeCflVoiesTrainKey(value);
    if (!norm) return;
    if (!candidates.includes(norm)) candidates.push(norm);
    for (const alt of getEquivalentCflNumeros(norm)){
      const altNorm = normalizeCflVoiesTrainKey(alt);
      if (altNorm && !candidates.includes(altNorm)) candidates.push(altNorm);
    }
  };

  pushCandidate(num);
  pushCandidate(canonicalizeCflNumero(num));

  const digits = String(num || '').match(/(\d{4,6})/g);
  if (digits && digits.length){
    digits.forEach(d => {
      pushCandidate(d);
      pushCandidate(canonicalizeCflNumero(d));
    });
  }

  for (const key of candidates){
    if (map.has(key)) return map.get(key);
  }
  return null;
}

function resolveCflVoieForStop({ voiesMap, stopName }){
  if (!(voiesMap instanceof Map) || !stopName) return null;
  const stopKeys = getEquivalentCflStopKeys(stopName);
  if (!stopKeys.length) return null;

  for (const stopKey of stopKeys){
    const exact = voiesMap.get(stopKey);
    if (exact) return exact;
  }

  for (const [knownStopKey, voie] of voiesMap.entries()){
    if (!knownStopKey || !voie) continue;
    if (stopKeys.some(stopKey => knownStopKey === stopKey || knownStopKey.startsWith(stopKey) || stopKey.startsWith(knownStopKey))){
      return voie;
    }
  }
  return null;
}

function resolveVoieForStop({ voiesMap, stopName, baseTimeRaw, timeCandidates, mode = 'dep', preferStationResolver = false }){
  if (!(voiesMap instanceof Map) || !stopName) return null;
  const candidates = Array.isArray(timeCandidates) ? timeCandidates : [baseTimeRaw];
  const parseMinFromRaw = (raw) => {
    const hhmm = normalizeVoiesBaseTime(raw);
    if (!hhmm) return null;
    const m = /^([0-2]\d):([0-5]\d)$/.exec(hhmm);
    if (!m) return null;
    return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
  };
  let refMin = null;
  for (const raw of candidates){
    const mm = parseMinFromRaw(raw);
    if (mm != null) { refMin = mm; break; }
  }

  // Même logique que la carte: pas de voie "parasite" projetée trop loin dans le futur.
  // Si on est en mode station-first (gares FR), on n'affiche une voie que proche de l'horaire courant.
  if (preferStationResolver && refMin != null){
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const delta = Math.min(Math.abs(refMin - nowMin), 1440 - Math.abs(refMin - nowMin));
    if (delta > 40) return null;
  }

  const stopOnlyVoie = preferStationResolver
    ? resolveVoieByStopOnlyLikeCarte({ voiesMap, stopName, mode })
    : null;
  if (preferStationResolver && stopOnlyVoie) return stopOnlyVoie;

  // (1) Match strict: stop + heure (comportement actuel)
  for (const raw of candidates) {
    if (!raw) continue;
    const timeHHMM = normalizeVoiesBaseTime(raw);
    if (!timeHHMM) continue;
    const key = normalizeVoiesStopKey(`${stopName}|${timeHHMM}`);
    if (!key) continue;
    const voie = pickVoieFromEntry(voiesMap.get(key), mode);
    if (voie) return voie;
  }

  if (stopOnlyVoie) return stopOnlyVoie;

  // (2) Fallback "secours": même logique prudente que la carte.
  // On ne prend une voie du même arrêt que si l'heure est proche,
  // pour éviter les mauvais quais/voies (ex: Thionville voie 1 alors que B/C).
  const stopNorm = normalizeVoiesTrainKey(stopName);
  if (!stopNorm) return null;

  const parseMin = (hhmm) => {
    const m = /^([0-2]\d):([0-5]\d)$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
  };

  // heure "référence" pour choisir la voie la plus proche si plusieurs entrées pour le même stop

  let bestVoie = null;
  let bestDiff = Infinity;
  const MAX_FALLBACK_DIFF_MIN = 7;

  for (const [k, v] of voiesMap.entries()){
    // k est du type "pagnysurmoselle|14:06"
    if (typeof k !== 'string') continue;
    if (!k.startsWith(stopNorm + '|')) continue;

    if (refMin == null) continue;

    const hhmm = k.slice((stopNorm + '|').length);
    const km = parseMin(hhmm);
    if (km == null) continue;

    const diff = Math.abs(km - refMin);
    if (diff < bestDiff){
      bestDiff = diff;
      bestVoie = pickVoieFromEntry(v, mode);
    }
  }

  if (bestDiff <= MAX_FALLBACK_DIFF_MIN) return bestVoie;
  return null;
}

function formatVoieLabel(raw){
  const val = String(raw || '').trim();
  if (!val) return '';
  const cleaned = val.replace(/\s+/g, ' ');
  if (/^(voie|quai)\s/i.test(cleaned)) return cleaned;
  if (/^[A-Za-z0-9]+$/.test(cleaned)) return `Voie ${cleaned}`;
  return cleaned;
}

function formatClockWithVoie(clock, voie){
  if (!clock || !voie) return clock;
  const label = formatVoieLabel(voie);
  if (!label) return clock;
  return `<span class="voie-info">${clock}<span class="voie-badge">${escapeHtml(label)}</span></span>`;
}

const LB_DATA_CACHE_VERSION = 'v1';

function lbCacheRead(key, maxAgeMs){
  try{
    const raw = localStorage.getItem(`${LB_DATA_CACHE_VERSION}:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const ts = Number(parsed.ts || 0);
    if (!ts) return null;
    if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && (Date.now() - ts) > maxAgeMs) return null;
    return parsed.data ?? null;
  }catch(_){ return null; }
}

function lbCacheWrite(key, data){
  try{
    localStorage.setItem(`${LB_DATA_CACHE_VERSION}:${key}`, JSON.stringify({ ts: Date.now(), data }));
  }catch(_){ }
}

function lbRunInBackground(fn){
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 1200 });
  } else {
    setTimeout(() => fn(), 0);
  }
}

async function loadCompoData({ forceFresh = false, background = false } = {}) {
  const COMPO_CACHE_MAX_AGE = 6 * 60 * 1000;
  try {
    if (!forceFresh) {
      const cached = lbCacheRead('compoData', COMPO_CACHE_MAX_AGE);
      if (cached && typeof cached === 'object') {
        window.compoData = cached;
        updateCompoHeaderColors();
        if (typeof lbRenderHomeFavPreview === 'function') lbRenderHomeFavPreview();
        // En arrière-plan, on réutilise le cache pour l'affichage immédiat,
        // mais on continue quand même pour récupérer les éventuelles mises à jour distantes.
        if (!background) return cached;
      }
    }

    const COMPO_PRIMARY_URL = LB_ENDPOINTS.compotrains;
    const COMPO_FALLBACK_URL = 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Compotrains.json';

    const tryFetchJson = async (url) => {
      const r = await fetch(url, { cache: forceFresh ? 'no-store' : 'default' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    };

    let json;
    try {
      json = await tryFetchJson(COMPO_PRIMARY_URL);
    } catch (e1) {
      console.warn('[COMPO] VPS indisponible, fallback GitHub…', e1);
      json = await tryFetchJson(COMPO_FALLBACK_URL);
    }
    window.compoData = { ...(json.NancyMetzLux||{}), ...(json.LuxMetzNancy||{}) };
    lbCacheWrite('compoData', window.compoData);
    updateCompoHeaderColors();
    if (typeof lbRenderHomeFavPreview === 'function') lbRenderHomeFavPreview();
    return window.compoData;
  } catch (error) {
    console.error("Erreur lors du chargement des compositions :", error);
    return window.compoData || null;
  }
}


// Mapping composition → classe CSS (couleur du numéro de train)
function compoClassFromValue(comp){
  const c = String(comp || '').trim().toUpperCase().replace(/[\s_-]+/g,'');
  if (c === 'US') return 'us-train';
  if (c === 'US5') return 'us5-train';
  if (c === 'UM3' || c === 'UMX3' || c === 'UM-3') return 'um3-train';
  if (c === 'UMMIXTE' || c === 'UMMIX') return 'um-train';
  if (c.startsWith('UM')) return 'um-train';
  return 'no-compo-text'; // compo inconnue -> texte blanc uniquement
}

// Met à jour en live la couleur des en-têtes (sans régénérer le tableau)
function updateCompoHeaderColors(){
  try {
    const tableHost = document.getElementById('trainInfo');
    const table = tableHost ? tableHost.querySelector('table') : document.querySelector('#trainInfo table');
    if (!table) return;

    const comp = window.compoData || {};
    const CLASS_LIST = ['us-train','us5-train','um-train','um3-train','no-compo-text'];

    table.querySelectorAll('th.train-header[data-train-number]').forEach(th => {
      const num = th.getAttribute('data-train-number') || '';
      // On ne touche pas aux trains CFL
      if (String(num).startsWith('CFL-')) return;

      const next = compoClassFromValue(comp[num] || '');
      CLASS_LIST.forEach(c => th.classList.remove(c));
      th.classList.add(next);
    });
  } catch(e) {}
}

/* ---------- LIGNE : GARES + OUTILS D’ORDRE/SÉLECTEUR ---------- */
const garesParLigne = [
  { code: "82001000", nom: "Luxembourg", principal: true },
  { code: "82002501", nom: "Howald", principal: false },
  { code: "82006030", nom: "Bettembourg", principal: true },
  { code: "87191163", nom: "Hettange-Grande", principal: false },
  { code: "87191007", nom: "Thionville", principal: true },
  { code: "87191130", nom: "Uckange", principal: false },
  { code: "87191114", nom: "Hagondange", principal: false },
  { code: "87191098", nom: "Walygator parc", principal: false },
  { code: "87191106", nom: "Maizières-lès-Metz", principal: false },
  { code: "87192088", nom: "Woippy", principal: false },
  { code: "87192070", nom: "Metz Nord", principal: false },
  { code: "87192039", nom: "Metz", principal: true },
  { code: "87192401", nom: "Ars-sur-Moselle", principal: false },
  { code: "87192419", nom: "Ancy-sur-Moselle", principal: false },
  { code: "87192427", nom: "Novéant-sur-Moselle", principal: false },
  { code: "87192468", nom: "Pagny-sur-Moselle", principal: false },
  { code: "87192476", nom: "Vandières", principal: false },
  { code: "87141820", nom: "Pont-à-Mousson", principal: false },
  { code: "87141812", nom: "Dieulouard", principal: false },
  { code: "87141804", nom: "Belleville", principal: false },
  { code: "87141796", nom: "Marbache", principal: false },
  { code: "87141788", nom: "Pompey", principal: false },
  { code: "87141077", nom: "Frouard", principal: false },
  { code: "87141085", nom: "Champigneulles", principal: false },
  { code: "87141002", nom: "Nancy", principal: true }
];

const LINE_STOP_NAMES = new Set(garesParLigne.map(g => g.nom));

function computeRelevantStopIds(stops){
  const idToStop = new Map();
  const childrenByParent = new Map();
  stops.forEach(s => {
    if (!s || !s.stop_id) return;
    idToStop.set(s.stop_id, s);
    const parent = s.parent_station;
    if (parent){
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(s);
    }
  });

  const relevant = new Set();
  const queue = [];

  stops.forEach(s => {
    const name = (s.stop_name || '').trim();
    if (name && LINE_STOP_NAMES.has(name)){
      if (!relevant.has(s.stop_id)){
        relevant.add(s.stop_id);
        queue.push(s.stop_id);
      }
      if (s.parent_station && !relevant.has(s.parent_station)){
        relevant.add(s.parent_station);
        queue.push(s.parent_station);
      }
    }
  });

  while (queue.length){
    const id = queue.pop();
    const stop = idToStop.get(id);
    if (!stop) continue;

    const parent = stop.parent_station;
    if (parent && !relevant.has(parent)){
      relevant.add(parent);
      queue.push(parent);
    }

    const children = childrenByParent.get(id);
    if (children){
      for (const child of children){
        if (!relevant.has(child.stop_id)){
          relevant.add(child.stop_id);
          queue.push(child.stop_id);
        }
      }
    }
  }

  return relevant;
}

// Ordre selon le sens
function getStopsForDirection(sensInverse) {
  const noms = garesParLigne.map(g => g.nom);
  return sensInverse ? [...noms].reverse() : noms;
}

// Remplit le select #gareDropdown si présent
function buildGareDropdown() {
  const select = document.getElementById('gareDropdown');
  if (!select) return;
  select.innerHTML = '<option value="">— Aller à une gare —</option>';

  const principals = garesParLigne.filter(g => g.principal);
  const others = garesParLigne.filter(g => !g.principal);

  const opt1 = document.createElement('optgroup');
  opt1.label = 'Gares principales';
  principals.forEach(g => {
    const o = document.createElement('option');
    o.value = g.nom; o.textContent = g.nom;
    opt1.appendChild(o);
  });

  const opt2 = document.createElement('optgroup');
  opt2.label = 'Autres gares';
  others.forEach(g => {
    const o = document.createElement('option');
    o.value = g.nom; o.textContent = g.nom;
    opt2.appendChild(o);
  });

  select.appendChild(opt1);
  select.appendChild(opt2);
}
function normalizeStationName(str) {
  const base = (str || '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
  if (!base) return '';
  return base
    .replace(/&/g, ' et ')
    .replace(/[-–—]/g, ' ')
    .replace(/['’`´]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findStationMatch($select, query) {
  const normalized = normalizeStationName(query);
  if (!normalized) return null;

  let exact = null;
  let begins = null;
  let contains = null;

  $select.find('option').each((_, option) => {
    const value = option.value;
    if (!value) return;
    const label = normalizeStationName(option.textContent || value);
    if (label === normalized) {
      exact = value;
      return false;
    }
    if (!begins && label.startsWith(normalized)) {
      begins = value;
    }
    if (!contains && label.includes(normalized)) {
      contains = value;
    }
  });

  return exact || begins || contains;
}

function refreshStationSearchList(names) {
  const datalist = document.getElementById('stationNamesList');
  if (!datalist) return;
  datalist.innerHTML = '';
  names.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  });
}

function syncStationSearchInput(selectSelector, inputSelector) {
  const select = document.querySelector(selectSelector);
  const input = document.querySelector(inputSelector);
  if (!select || !input) return;

  const value = select.value;
  if (!value) {
    input.value = '';
    return;
  }

  const option = Array.from(select.options).find((opt) => opt.value === value);
  input.value = option ? option.textContent : value;
}

function syncStationSearchInputs() {
  syncStationSearchInput('#startStation', '#startStationSearch');
  syncStationSearchInput('#endStation', '#endStationSearch');
}

function applyStationSearchValue(inputSelector, selectSelector) {
  const input = document.querySelector(inputSelector);
  const select = document.querySelector(selectSelector);
  if (!input || !select) return false;

  const match = findStationMatch($(select), input.value);
  if (match) {
    $(select).val(match);
    syncStationSearchInput(selectSelector, inputSelector);
    updateItineraryPreview();
    return true;
  }

  input.classList.add('input-error');
  setTimeout(() => input.classList.remove('input-error'), 450);
  return false;
}

function attachStationSearch(inputSelector, selectSelector) {
  const input = document.querySelector(inputSelector);
  const select = document.querySelector(selectSelector);
  if (!input || !select) return;

  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      applyStationSearchValue(inputSelector, selectSelector);
    }
  });

  input.addEventListener('change', () => {
    if (!input.value) return;
    applyStationSearchValue(inputSelector, selectSelector);
  });

  input.addEventListener('blur', () => {
    if (!input.value) return;
    applyStationSearchValue(inputSelector, selectSelector);
  });
}

function formatDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDateFancy(dateStr) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const text = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pulseField(el) {
  if (!el) return;
  el.classList.add('field-pulse');
  setTimeout(() => el.classList.remove('field-pulse'), 450);
}

function markActiveQuickButton(button) {
  if (!button) return;
  const group = button.closest('.quick-button-group');
  if (!group) return;
  group.querySelectorAll('button').forEach((btn) => btn.classList.remove('is-active'));
  button.classList.add('is-active');
}

function clearActiveQuickButtons(group) {
  document
    .querySelectorAll(`.quick-button-group[data-group="${group}"] button`)
    .forEach((btn) => btn.classList.remove('is-active'));
}
function setActiveDateQuickButtons(preset){
  if (!preset) return;
  document
    .querySelectorAll('.quick-button-group[data-group="date"] .quick-day')
    .forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.day === preset);
    });
}
function hhmmToMin(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function minToHHMM(totalMinutes) {
  const minutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function luxNowMinutes() {
  const txt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Luxembourg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h, m] = txt.split(':').map(Number);
  return h * 60 + m;
}

function roundUpToStep(value, step) {
  if (!step) return value;
  const max = Math.floor(1439 / step) * step;
  return Math.min(max, Math.ceil(value / step) * step);
}

function updateItineraryPreview() {
  const preview = document.getElementById('itineraryPreview');
  const lineEl = document.getElementById('itineraryLine');
  const subtitleEl = document.getElementById('itinerarySubtitle');
  if (!preview || !lineEl || !subtitleEl) return;

  const start = $('#startStation').val() || '';
  const end = $('#endStation').val() || '';
  const date = $('#trainDate').val() || '';
  const from = $('#timeFrom').val() || '';
  const to = $('#timeTo').val() || '';

  let main = 'Prêt à embarquer ?';
  let sub = "Choisis ta gare de départ et ta gare d'arrivée pour lancer la magie.";

  preview.classList.remove('is-ready');

  if (start && end) {
    main = `${start} → ${end}`;
    const dateText = date ? formatDateFancy(date) : 'date libre';
    const windowText = from && to ? `${from} → ${to}` : 'horaires libres';
    sub = `🗓️ ${dateText} • 🕒 ${windowText} • @BERNancyMetzLux tient la porte`;
    preview.classList.add('is-ready');
  } else if (start) {
    main = `Départ : ${start}`;
    sub = "Choisis la gare d'arrivée et @BERNancyMetzLux s'occupe du reste.";
  } else if (end) {
    main = `Arrivée : ${end}`;
    sub = "Ajoute ta gare de départ, on fait chauffer la motrice !";
  }

  lineEl.textContent = main;
  subtitleEl.textContent = sub;
}

function applyDatePreset(preset, button) {
  const input = document.getElementById('trainDate');
  if (!input) return;

  const now = new Date();
  const target = new Date(now);

  if (preset === 'tomorrow') {
    target.setDate(target.getDate() + 1);
  } else if (preset === 'weekend') {
    const day = target.getDay();
    let offset = (6 - day + 7) % 7;
    if (offset === 0) offset = 7;
    target.setDate(target.getDate() + offset);
  }

  input.dataset.presetActive = '2';
  input.value = formatDateInputValue(target);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  markActiveQuickButton(button);
  setActiveDateQuickButtons(preset);
  pulseField(input);
}

function applyTimePreset(preset, button) {
  const slider = document.getElementById('timeSlider');
  if (!slider || !slider.noUiSlider) return;

  let start;
  let end;

  if (preset === 'rush-am') {
    start = hhmmToMin('06:00');
    end = hhmmToMin('09:30');
  } else if (preset === 'rush-pm') {
    start = hhmmToMin('16:00');
    end = hhmmToMin('19:30');
  } else if (preset === 'late') {
    start = hhmmToMin('20:00');
    end = hhmmToMin('23:30');
  } else {
    start = roundUpToStep(luxNowMinutes(), 5);
    end = Math.min(1439, start + 180);
    if (end - start < 45) {
      end = Math.min(1439, start + 45);
      start = Math.max(0, Math.min(start, end - 45));
    }
    if (end - start < 30) {
      start = Math.max(0, end - 30);
    }
  }

  slider.dataset.presetApplying = '1';
  slider.noUiSlider.set([start, end]);
  setTimeout(() => { delete slider.dataset.presetApplying; }, 0);
  markActiveQuickButton(button);
  pulseField(slider.closest('.time-range'));
}

function clearActiveTimeButtons() {
  clearActiveQuickButtons('time');
}

// Remplit #startStation et #endStation si présents (filtres De/À)
function buildStationSelects() {
  const startSel = document.getElementById('startStation');
  const endSel   = document.getElementById('endStation');
  if (!startSel || !endSel) return;

  const sensInverse = $('#directionToggle').is(':checked');
  const rawNames = getStopsForDirection(sensInverse);

  const orderedNames = Array.isArray(rawNames) ? rawNames.slice() : [];

  if (!orderedNames.length) {
    startSel.innerHTML = '<option value="">— Toute la ligne —</option>';
    endSel.innerHTML   = '<option value="">— Toute la ligne —</option>';
    refreshStationSearchList([]);
    syncStationSearchInputs();
    updateItineraryPreview();
    return;
  }

  const principalsSet = new Set(garesParLigne.filter(g => g.principal).map(g => g.nom));
  const principals = orderedNames.filter(n => principalsSet.has(n));
  const others     = orderedNames.filter(n => !principalsSet.has(n));

  const fill = (sel, placeholder) => {
    const previous = sel.value; // on tente de préserver la sélection
    sel.innerHTML = '';

    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = `— ${placeholder} —`;
    sel.appendChild(ph);

    const og1 = document.createElement('optgroup');
    og1.label = 'Gares principales';
    principals.forEach(nom => {
      const o = document.createElement('option');
      o.value = nom; o.textContent = nom;
      og1.appendChild(o);
    });

    const og2 = document.createElement('optgroup');
    og2.label = 'Autres gares';
    others.forEach(nom => {
      const o = document.createElement('option');
      o.value = nom; o.textContent = nom;
      og2.appendChild(o);
    });

    sel.appendChild(og1);
    sel.appendChild(og2);

    // si l’ancienne valeur existe encore, on la remet
    if (previous && $(sel).find(`option[value="${previous}"]`).length) {
      sel.value = previous;
    }
  };

  fill(startSel, 'Toute la ligne');
  fill(endSel,   'Toute la ligne');

  refreshStationSearchList(orderedNames);
  syncStationSearchInputs();
  updateItineraryPreview();
}

/* Rendu progressif d’un tableau HTML: parse en mémoire, clone THEAD, insère TBODY par lots */
function injectTableChunkedIntoTrainInfo(html, {chunk=200} = {}){
  const host = document.getElementById('trainInfo');
  if (!host) return;

  if (host.__scrollHintCleanup) {
    try { host.__scrollHintCleanup(); } catch (e) {}
    host.__scrollHintCleanup = null;
  }

  // parse hors DOM
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const tableSrc = tmp.querySelector('table');
  if (!tableSrc) { host.innerHTML = html; return; }

  // conteneur scrollable + horodatage
  host.innerHTML = '<div class="lb-table-swipe-hint" aria-hidden="true">← Glisser pour voir les autres trains →</div><div class="table-scroll" tabindex="0" aria-label="Tableau des trains, défilement horizontal et vertical"></div><div id="lastUpdated" class="last-updated" aria-live="polite"></div>';
  const scroller = host.querySelector('.table-scroll');

  // table cible
  const tableDst = document.createElement('table');
  const headerCells = tableSrc.querySelectorAll('thead tr:first-child th');
  const trainColumns = Math.max(0, headerCells.length - 1);

  // Objectif mobile : afficher ~4 colonnes trains "à l'écran".
  // Au-delà -> scroll horizontal (colonne "Gare" reste figée).
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

/* Cibles : ~4 trains visibles sur mobile, ~10 sur desktop */
const visibleCols = isMobile ? 4 : Math.min(trainColumns || 0, 10);

/* On calcule avec la largeur réelle du conteneur (pas window.innerWidth),
   sinon sur PC la colonne "Gare" devient énorme et on ne voit pas assez de trains. */
const containerW = Math.max(360, Math.floor((scroller && scroller.getBoundingClientRect().width) || host.getBoundingClientRect().width || window.innerWidth || 360));

/* Largeur colonne gares :
   - mobile : clamp(150..210) autour de ~36% (lisible, 1–2 lignes)
   - desktop : clamp(210..260) autour de ~22% (évite une colonne énorme)
*/
const firstColPx = isMobile
  ? Math.max(150, Math.min(210, Math.round(containerW * 0.36)))
  : Math.max(210, Math.min(260, Math.round(containerW * 0.22)));

const usable = Math.max(240, containerW - firstColPx);

/* largeur colonne train : compacte pour en voir N */
const colPx = isMobile
  ? Math.max(52, Math.floor(usable / Math.max(1, visibleCols)))
  : Math.max(60, Math.floor(usable / Math.max(1, visibleCols)));

/* Min-width total : viewport, ou (gare + toutes colonnes trains) pour activer le scroll si besoin */
const minWidth = Math.max(containerW, firstColPx + (colPx * trainColumns));

tableDst.style.width = '100%';
tableDst.style.minWidth = minWidth + 'px';

/* Expose des variables CSS pour caler exactement les largeurs */
tableDst.style.setProperty('--lb-first-col-px', firstColPx + 'px');
tableDst.style.setProperty('--lb-train-col-px', colPx + 'px');

  // clone THEAD immédiatement
  const thead = tableSrc.querySelector('thead');
  if (thead) tableDst.appendChild(thead.cloneNode(true));
  scroller.appendChild(tableDst);

  const srcBody = tableSrc.querySelector('tbody');
  if (!srcBody){ setLastUpdated?.(); return; }

  const rows = Array.from(srcBody.children);
  const dstBody = document.createElement('tbody');
  tableDst.appendChild(dstBody);

  const onResize = () => { adjustTrainTableRowHeights?.(); };
  window.addEventListener('resize', onResize);
  host.__scrollHintCleanup = () => window.removeEventListener('resize', onResize);

  let idx = 0;
  function pump(){
    const end = Math.min(idx + chunk, rows.length);
    for (; idx < end; idx++){
      dstBody.appendChild(rows[idx].cloneNode(true));
    }
    if (idx < rows.length){
      requestAnimationFrame(pump);
    } else {
      // fin : hooks post-rendu
      updateCompoHeaderColors?.();
      setLastUpdated?.();
      adjustTrainTableRowHeights?.();
      // GTFS-RT (non bloquant)
      setTimeout(()=> {
        if (window.retardsGTFS && (typeof isSelectedDateToday !== 'function' || isSelectedDateToday())){
          tryApplyGtfsToCurrentTable?.();
        }
      }, 0);
      // météo & dropdown & alertes
      updateWeatherBadges?.();
      if (window.__IS_IOS__) startWeatherAutorefresh?.(10 * 60 * 1000); else startWeatherAutorefresh?.();
      hookGareDropdownBehavior?.();
      setTimeout(()=> { try { chargerEtAfficherAlertes?.(); } catch(e){} }, 0);
    }
  }
  requestAnimationFrame(pump);
}


/* Ajuste la hauteur des lignes du tableau pour que tout reste lisible sur mobile,
   sans que les lignes deviennent énormes quand il y a peu d'arrêts (ex: Lux→Thionville). */
function adjustTrainTableRowHeights(){
  const host = document.getElementById('trainInfo');
  if (!host) return;
  const scroller = host.querySelector('.table-scroll');
  const table = scroller?.querySelector('table');
  if (!scroller || !table) return;

  // uniquement mobile: sur desktop on laisse le comportement normal
  if (window.matchMedia && !window.matchMedia('(max-width: 768px)').matches) return;

  const rows = table.querySelectorAll('tbody tr');
  const n = Math.max(1, rows.length);

  const thead = table.querySelector('thead');
  const headerH = thead ? Math.ceil(thead.getBoundingClientRect().height) : 0;
  const avail = Math.max(80, scroller.clientHeight - headerH - 6); // 6px marge
  let rowH = Math.floor(avail / n);

  // bornes: priorité absolue à voir tout le trajet sans scroll vertical interne
  // (même avec beaucoup de gares), quitte à compacter fortement.
  rowH = Math.max(7, Math.min(54, rowH));

  // padding ultra-compact pour les gros tableaux
  const padY = Math.max(0, Math.min(8, Math.floor((rowH - 12) / 2)));

  // typographie adaptative pour tenir toutes les lignes
  const rowFont = rowH <= 9  ? '0.48rem'
                : rowH <= 11 ? '0.52rem'
                : rowH <= 13 ? '0.56rem'
                : rowH <= 15 ? '0.60rem'
                : rowH <= 18 ? '0.66rem'
                : rowH <= 22 ? '0.72rem'
                : '0.78rem';

  host.style.setProperty('--lb-row-h', rowH + 'px');
  host.style.setProperty('--lb-cell-pad-y', padY + 'px');
  host.style.setProperty('--lb-row-font-size', rowFont);
}

/* Scroll vers le tableau généré pour le mettre immédiatement en vue */
function scrollTrainTableIntoView(){
  const host = document.getElementById('trainInfo');
  if (!host) return;

  const scroller = host.querySelector('.table-scroll');
  const target = scroller || host;

  // IMPORTANT: la top-bar est en position:fixed -> scrollIntoView colle sous la barre
  // et masque la ligne des numéros de train. On scroll donc avec un offset.
  const cssVar = (name) => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch(e){ return ''; }
  };
  const topBarPx = (() => {
    const v = cssVar('--top-bar-height');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 72;
  })();
  const extra = 12; // petit padding visuel sous la barre
  const y = target.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0) - topBarPx - extra;

  requestAnimationFrame(() => {
    // recentre la vue en haut du tableau (et remet le scroll interne à 0)
    try { if (scroller) scroller.scrollTop = 0; } catch(e){}
    window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: 'smooth' });
  });
}
// — Helper: fixe le sens d’affichage ET force toujours De/À pour AM/PM
function setDirectionForPreset(kind, config){
  const conf = config || RAPID_PRESET_CONFIG?.[kind] || null;
  // AM = France → Luxembourg ; PM = Luxembourg → France
  const sensInverse = (kind === 'PM');

  // 1) Met à jour le toggle + reconstruit les listes dans le bon ordre
  if ($('#directionToggle').length){
    $('#directionToggle').prop('checked', sensInverse);
    buildStationSelects();
  }

  const $start = $('#startStation');
  const $end   = $('#endStation');
  if (!$start.length || !$end.length) return;

  const pickCandidate = ($sel, prefs) => {
    if (!$sel.length || !Array.isArray(prefs)) return null;
    for (const candidate of prefs){
      if (!candidate) continue;
      if ($sel.find(`option[value="${candidate}"]`).length > 0) return candidate;
    }
    return null;
  };

 const applyIfFound = ($sel, value) => {
    if (!value) return false;
    $sel.val(value);
    return true;
  };

  const startApplied = applyIfFound($start, pickCandidate($start, conf?.displayStart));
  const endApplied   = applyIfFound($end, pickCandidate($end, conf?.displayEnd));

  if (startApplied && endApplied) return;

  const hasOpt = ($sel, v) => $sel.find(`option[value="${v}"]`).length > 0;
  const FR = hasOpt($start, 'Nancy') ? 'Nancy'
           : hasOpt($start, 'Metz')  ? 'Metz'
           : null;

  const LUX = hasOpt($start, 'Luxembourg') ? 'Luxembourg' : null;

  if (!startApplied || !endApplied){
    if (FR && LUX){
      if (!startApplied) $start.val(kind === 'PM' ? LUX : FR);
      if (!endApplied)   $end.val(kind === 'PM' ? FR : LUX);
      return;
    }
  }

  // Fallback ultra robuste : premier ↔ dernier de la liste (hors option vide)
  const opts = $start.find('option').map((_,o)=>o.value).get().filter(v=>v!=='');
  if (opts.length >= 2){
    if (!startApplied){
      if (kind === 'AM') $start.val(opts[0]);
      else $start.val(opts[opts.length-1]);
    }
    if (!endApplied){
      if (kind === 'AM') $end.val(opts[opts.length-1]);
      else $end.val(opts[0]);
    }
  }
}
// Filtre la portion entre la gare de départ et d’arrivée
function filterByOD(orderedStops, startName, endName) {
  if (!startName && !endName) return orderedStops;

  const s = startName ? orderedStops.indexOf(startName) : -1;
  const e = endName   ? orderedStops.indexOf(endName)   : -1;

  // si aucun des deux n'est trouvé, on ne touche pas à l'ordre
  if (s === -1 && e === -1) return orderedStops;

  // si les deux sont trouvés, on renvoie la tranche dans le sens De -> À
  if (s !== -1 && e !== -1) {
    if (s <= e) {
      // De avant À : tranche directe
      return orderedStops.slice(s, e + 1);
    } else {
      // De après À : on prend la tranche et on la renverse pour garder le sens De -> À
      const slice = orderedStops.slice(e, s + 1);
      return slice.reverse();
    }
  }

  // Un seul des deux est renseigné : on garde l'ordre actuel de la ligne
  const iMin = Math.min(s === -1 ? 0 : s, e === -1 ? orderedStops.length - 1 : e);
  const iMax = Math.max(s === -1 ? 0 : s, e === -1 ? orderedStops.length - 1 : e);
  return orderedStops.slice(iMin, iMax + 1);
}

// Surlignage/scroll de la gare choisie après rendu du tableau
function hookGareDropdownBehavior() {
  const select = document.getElementById('gareDropdown');
  if (!select) return;
  select.onchange = () => {
    const nom = select.value;
    if (!nom) return;
    const rows = document.querySelectorAll('#trainInfo table tbody tr');
    rows.forEach(tr => tr.classList.remove('row-focus'));
    for (const tr of rows) {
      const first = tr.querySelector('td:first-child');
      if (first && first.textContent.trim() === nom) {
        tr.classList.add('row-focus');
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  };
}

// CSS pour le focus de ligne
if (!document.getElementById('css-row-focus')) {
  const st = document.createElement('style');
  st.id = 'css-row-focus';
  st.textContent = `.row-focus{outline:2px solid #00ffff;box-shadow:0 0 0 2px #00ffff inset}`;
  document.head.appendChild(st);
}
// CSS rail horizontal + styles Sortable
(function(){
  const css = `
    #selectionChips{
      display:flex;
      flex-wrap:nowrap;          /* une seule ligne -> pas de yoyo */
      overflow-x:auto;           /* rail scrollable */
      gap:8px;
      padding-bottom:6px;
      -webkit-overflow-scrolling:touch;
      overscroll-behavior:contain;
      align-items:flex-start;
    }
    #selectionChips::-webkit-scrollbar{ height:6px }

    #selectionChips .chip-tag{
      flex:0 0 auto;             /* largeur auto mais pas de wrap */
      cursor:grab;
      user-select:none;
      touch-action:none;         /* pas de scroll pendant drag */
      transition: transform 150ms ease, opacity 150ms ease;
    }

    /* classes natives SortableJS */
    #selectionChips .sortable-chosen { opacity:.9 }
    #selectionChips .sortable-ghost  {
      opacity:.6;
      background:rgba(0,255,255,.08);
      border-radius:16px;
    }
    #selectionChips .sortable-drag   {
      z-index:5;
      box-shadow:0 8px 24px rgba(0,0,0,.18);
    }
  `;
  const el = document.getElementById('css-dnd-chips');
  if (el) el.textContent = css;
  else { const st=document.createElement('style'); st.id='css-dnd-chips'; st.textContent=css; document.head.appendChild(st); }
})();

// Gestion de la modale "vue globale" du tableau
(function(){
  const modal = document.getElementById('tableModal');
  const modalInner = document.getElementById('tableModalInner');
  const status = document.getElementById('tableModalStatus');
  const closeBtn = document.getElementById('closeTableModal');
  if (!modal || !modalInner || !status || !closeBtn) return;

  const closeModal = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    status.textContent = '';
    modalInner.innerHTML = '';
  };

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', evt => { if (evt.target === modal) closeModal(); });
  document.addEventListener('keydown', evt => { if (evt.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal(); });

  window.__openTrainTableSnapshot = async (table, trigger) => {
    if (!table) return;

    const tableEl = table instanceof HTMLElement ? table : null;
    let snapshotAttrApplied = false;
    let bodyAttrApplied = false;
    const bodyEl = document.body;
    if (tableEl && !tableEl.hasAttribute('data-snapshotting')) {
      tableEl.setAttribute('data-snapshotting', 'true');
      snapshotAttrApplied = true;
    }
    if (bodyEl && !bodyEl.hasAttribute('data-snapshotting')) {
      bodyEl.setAttribute('data-snapshotting', 'true');
      bodyAttrApplied = true;
    }

    if (modal.getAttribute('aria-hidden') === 'false') closeModal();

    const btn = (trigger instanceof HTMLElement) ? trigger : null;
    const original = btn ? btn.innerHTML : null;

    if (btn) {
      btn.disabled = true;
      btn.dataset.loading = 'true';
      btn.innerHTML = '⏳ Capture…';
    }

    status.textContent = 'Préparation de la capture…';

    try {
      await window.lbLoadScriptOnce(
        'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
        () => typeof window.html2canvas === 'function'
      );

      const tableRect = table.getBoundingClientRect();
      const firstColCells = Array.from(table.querySelectorAll('tr > *:first-child'));
      prevFirstColMinWidths = firstColCells.map((el) => el instanceof HTMLElement ? el.style.minWidth : '');
      // Mesure "réelle": on prend l'emprise visuelle max (gare + météo + badges) et on applique partout
      let computedFirstColWidth = 260;
      const measureVisualWidth = (cell) => {
        if (!(cell instanceof HTMLElement)) return 0;
        const cellRect = cell.getBoundingClientRect();
        let maxRight = cellRect.left + (cell.scrollWidth || cellRect.width || 0);
        const descendants = cell.querySelectorAll('*');
        descendants.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const st = window.getComputedStyle(node);
          if (st.display === 'none' || st.visibility === 'hidden') return;
          const r = node.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const mr = parseFloat(st.marginRight || '0') || 0;
          maxRight = Math.max(maxRight, r.right + mr);
        });
        const pr = parseFloat(window.getComputedStyle(cell).paddingRight || '0') || 0;
        return Math.ceil(maxRight - cellRect.left + pr);
      };
      for (const cell of firstColCells) {
        if (!(cell instanceof HTMLElement)) continue;
        const w = measureVisualWidth(cell);
        if (w > computedFirstColWidth) computedFirstColWidth = w;
      }
      computedFirstColWidth = Math.min(680, Math.max(260, computedFirstColWidth + 18));
      for (const cell of firstColCells) {
        if (!(cell instanceof HTMLElement)) continue;
        cell.style.minWidth = `${computedFirstColWidth}px`;
        cell.style.width = `${computedFirstColWidth}px`;
        cell.style.maxWidth = `${computedFirstColWidth}px`;
      }
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const canvas = await html2canvas(table, {
        backgroundColor: '#0b0f1a',
        scale,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        windowWidth: Math.max(document.documentElement.clientWidth, Math.ceil(tableRect.width + tableRect.left + 16)),
        windowHeight: Math.max(document.documentElement.clientHeight, Math.ceil(tableRect.height + tableRect.top + 16)),
        useCORS: true,
        onclone: (doc) => {
          const cloneBody = doc.body;
          if (cloneBody) {
            cloneBody.style.setProperty('background', '#0b0f1a', 'important');
          }
          const cloneTable = doc.querySelector('table[data-snapshotting="true"]');
          if (cloneTable instanceof HTMLElement) {
            cloneTable.style.setProperty('background', '#0b0f1a', 'important');
            cloneTable.style.setProperty('background-image', 'none', 'important');
            cloneTable.style.setProperty('box-shadow', 'none', 'important');
            cloneTable.style.setProperty('filter', 'none', 'important');
          }
          const cloneFirstCol = Array.from(doc.querySelectorAll('table[data-snapshotting="true"] tr > *:first-child'));
          cloneFirstCol.forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            el.style.setProperty('min-width', `${computedFirstColWidth}px`, 'important');
            el.style.setProperty('width', `${computedFirstColWidth}px`, 'important');
            el.style.setProperty('max-width', `${computedFirstColWidth}px`, 'important');
          });
        }
      });

      // Bandeau titre + date/heure (au-dessus du tableau)
      const titlePadding = 82;
      const titledCanvas = document.createElement('canvas');
      titledCanvas.width = canvas.width;
      titledCanvas.height = canvas.height + titlePadding;
      const tctx = titledCanvas.getContext('2d');
      if (tctx) {
        tctx.fillStyle = '#0b0f1a';
        tctx.fillRect(0, 0, titledCanvas.width, titledCanvas.height);
        tctx.fillStyle = 'rgba(0,240,255,0.20)';
        tctx.fillRect(0, titlePadding - 2, titledCanvas.width, 2);
        tctx.drawImage(canvas, 0, titlePadding);
        const dt = new Date();
        const generatedAt = dt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
        const titleText = 'Tableau des circulations';
        const dateText = `Généré le ${generatedAt}`;
        let titleFont = Math.max(18, Math.round(titledCanvas.width * 0.028));
        const maxTitleWidth = titledCanvas.width - 28;
        while (titleFont > 16) {
          tctx.font = `700 ${titleFont}px Arial, sans-serif`;
          if (tctx.measureText(titleText).width <= maxTitleWidth) break;
          titleFont -= 1;
        }
        tctx.fillStyle = '#00f0ff';
        tctx.font = `700 ${titleFont}px Arial, sans-serif`;
        tctx.textBaseline = 'top';
		tctx.textAlign = 'left';
        tctx.fillText(titleText, 14, 10);
        tctx.fillStyle = '#bfefff';
        let dateFont = Math.max(12, Math.round(titledCanvas.width * 0.017));
        while (dateFont > 11) {
          tctx.font = `500 ${dateFont}px Arial, sans-serif`;
          if (tctx.measureText(dateText).width <= maxTitleWidth) break;
          dateFont -= 1;
        }
        tctx.font = `500 ${dateFont}px Arial, sans-serif`;
        tctx.textAlign = 'right';
        tctx.fillText(dateText, titledCanvas.width - 14, 12);
      }

      // Filigrane léger "labetaillere.fr" sur la capture finale
      try {
        const ctx = titledCanvas.getContext('2d');
        if (ctx) {
          const w = titledCanvas.width;
          const h = titledCanvas.height;
          ctx.save();
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = '#8cf6ff';
          const fontSize = Math.max(18, Math.round(Math.min(w, h) * 0.035));
          ctx.font = `700 ${fontSize}px Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-Math.PI / 7);
          const stepX = Math.max(220, fontSize * 7.6);
          const stepY = Math.max(130, fontSize * 2.8);
          for (let y = -h; y <= h; y += stepY) {
            for (let x = -w; x <= w; x += stepX) {
              ctx.fillText('labetaillere.fr', x, y);
            }
          }
          ctx.restore();
        }
      } catch (_) {}

      const dataUrl = titledCanvas.toDataURL('image/png', 0.92);
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Capture du tableau des trains';

      modalInner.innerHTML = '';
      modalInner.appendChild(img);
      status.textContent = 'Capture générée – pincez pour zoomer';
    } catch (error) {
      console.error('[table snapshot]', error);
      modalInner.innerHTML = '<p class="table-modal-error">Impossible de créer la capture automatiquement. Réessayez plus tard ou effectuez une capture d’écran manuelle.</p>';
      status.textContent = 'Erreur de capture';
    } finally {
      // restauration largeur colonne gare
      const firstColCellsAfter = Array.from(table.querySelectorAll('tr > *:first-child'));
      firstColCellsAfter.forEach((el, idx) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.minWidth = prevFirstColMinWidths[idx] || '';
        el.style.width = '';
        el.style.maxWidth = '';
      });
      if (snapshotAttrApplied && tableEl) {
        tableEl.removeAttribute('data-snapshotting');
      }
       if (bodyAttrApplied && bodyEl) {
        bodyEl.removeAttribute('data-snapshotting');
      }
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('data-loading');
        if (original != null) btn.innerHTML = original;
      }
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }
  };

  window.__closeTrainTableModal = closeModal;
})();

// Détection iOS (y compris iPadOS "Desktop mode")
if (typeof window.__IS_IOS__ === 'undefined') {
  window.__IS_IOS__ =
    /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* ---------- LIENS GARES ---------- */
const gareLiensLux = {
  "Luxembourg": "https://www.cfl.lu/fr-fr/network/station/gare-de-luxembourg#nextDeparture",
  "Bettembourg": "https://www.cfl.lu/fr-fr/network/station/gare-de-bettembourg#nextDeparture",
  "Howald": "https://www.cfl.lu/fr-fr/network/station/gare-de-howald#nextDeparture",
  "Pfaffenthal-Kirchberg": "https://www.cfl.lu/fr-fr/network/station/gare-de-pfaffenthal-kirchberg#nextDeparture"
};
const gareLiensManuelles = {
  "Nancy": "https://www.garesetconnexions.sncf/fr/gares-services/nancy/horaires",
  "Pont-à-Mousson": "https://www.garesetconnexions.sncf/fr/gares-services/pont-mousson/horaires",
  "Pagny-sur-Moselle": "https://www.garesetconnexions.sncf/fr/gares-services/pagny-moselle/horaires",
  "Metz": "https://www.garesetconnexions.sncf/fr/gares-services/metz/horaires",
  "Metz Nord": "https://www.garesetconnexions.sncf/fr/gares-services/metz-nord/horaires",
  "Woippy": "https://www.garesetconnexions.sncf/fr/gares-services/woippy/horaires",
  "Maizières-lès-Metz": "https://www.garesetconnexions.sncf/fr/gares-services/maizieres-metz/horaires",
  "Walygator parc": "https://www.garesetconnexions.sncf/fr/gares-services/waligator-parc/horaires",
  "Hagondange": "https://www.garesetconnexions.sncf/fr/gares-services/hagondange/horaires",
  "Uckange": "https://www.garesetconnexions.sncf/fr/gares-services/uckange/horaires",
  "Thionville": "https://www.garesetconnexions.sncf/fr/gares-services/thionville/horaires",
  "Hettange-Grande": "https://www.garesetconnexions.sncf/fr/gares-services/hettange-grande/horaires"
};
function cleanGareName(nom) {
  let s = nom.toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
       .replace(/['’]/g, '')
       .replace(/[^a-z0-9]+/g, '-')
       .replace(/^-+|-+$/g, '');
  return s;
}
function getGareURL(nomGare) {
  if (gareLiensLux[nomGare]) return gareLiensLux[nomGare];
  if (gareLiensManuelles[nomGare]) return gareLiensManuelles[nomGare];
  const cleanName = cleanGareName(nomGare);
  if (!cleanName) return nomGare;
  return `https://www.garesetconnexions.sncf/fr/gares-services/${cleanName}/horaires`;
}

/************  CONFIG COURTE  ************/
const FORCE_VIA_METZ = false;                // correspondances à Metz uniquement
const KEEP_ONLY_EARLIEST_TRANSFER = true;   // n’afficher que la 1ʳᵉ correspondance la plus proche
const STRICT_CALENDAR = false;              // 🔴 ne PAS filtrer avec calendar_dates seul

    const $allow = $('#allowTransfer');
if ($allow.length) $allow.prop('checked', false);

/************  HELPERS TEMPS & TEXTE  ************/
const ft = t => t ? t.slice(0,2)+':'+t.slice(2,4) : '-';
function dl(b, a){
  const toMin = s => (parseInt(s.slice(0,2))*60 + parseInt(s.slice(2,4)));
  return toMin(a) - toMin(b);
}
function rawHHMMToMinutes(raw){
  if (!raw || !/^\d{4,}$/.test(raw)) return null;
  const h = Number.parseInt(raw.slice(0, 2), 10);
  const m = Number.parseInt(raw.slice(2, 4), 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
}
function minutesToClock(mins){
  if (!Number.isFinite(mins)) return null;
  const rounded = Math.round(mins);
  const total = ((rounded % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}
function minutesToRawHHMM(mins){
  const clock = minutesToClock(mins);
  return clock ? clock.replace(':', '') : null;
}
function computeRetardedTime(raw, delay){
  if (!Number.isFinite(delay)) return null;
  const baseMinutes = rawHHMMToMinutes(raw);
  if (baseMinutes == null) return null;
  return minutesToClock(baseMinutes + delay);
}
function hhmmInputToMin(hhmm){ if(!hhmm||!/^\d{2}:\d{2}$/.test(hhmm)) return null; const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function dateInputToYMD(str){ if(!str||!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null; const [y,m,d]=str.split('-'); return `${y}${m}${d}`; }
function extractTrainNumber(str){ const m = String(str||'').match(/(\d{5,6})/); return m ? m[1] : null; }
function toSec(hms){ if(!hms) return null; const [H,M,S]=hms.split(':').map(Number); return H*3600+M*60+(S||0); }
function toHHMM(sec){ const s=Math.max(0,sec|0); const h=Math.floor(s/3600)%24,m=Math.floor((s%3600)/60); return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function uniqDirects(list){
  const bestByKey = new Map(); // clé: source|num|dep
  for (const t of list){
    const src = t.source || 'SNCF';
    const key = `${src}|${(t.selectionKey || t.numero || '').trim()}|${t.dep}`;
    const prev = bestByKey.get(key);
    // si on a deux entrées identiques, on garde celle avec une arrivée connue
    if (!prev || (!prev.arr && t.arr)) bestByKey.set(key, t);
  }
  return Array.from(bestByKey.values());
}

function keepFirstTransferPerFirstLeg(list){
  // garde une seule correspondance (la plus proche) par 1er train (num1|dep1)
  const best = new Map();
  for (const t of list){
    const key = `${t.num1}|${t.dep1}`;
    const prev = best.get(key);
    if (!prev || t.dep2 < prev.dep2) best.set(key, t); // la 1ère dispo à Metz
  }
  return Array.from(best.values());
}

function uniqTransfers(list){
  const map = new Map();
  for (const t of list){
    const key = `${t.num1}|${t.dep1}|${t.viaName}|${t.num2}|${t.dep2}|${t.arr2}`;
    if (!map.has(key)) map.set(key, t);
  }
  return Array.from(map.values());
}

function stationLineIndex(name){
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(MAINLINE_STATION_ORDER, normalized)){
    return MAINLINE_STATION_ORDER[normalized];
  }
  return null;
}

function isPivotDirectionallyValid(startName, viaName, endName){
  const sIdx = stationLineIndex(startName);
  const vIdx = stationLineIndex(viaName);
  const eIdx = stationLineIndex(endName);
  if (sIdx == null || vIdx == null || eIdx == null) return true;
  if (sIdx === eIdx) return false;
  if (sIdx < eIdx) return vIdx > sIdx && vIdx < eIdx;
  if (sIdx > eIdx) return vIdx < sIdx && vIdx > eIdx;
  return true;
}

/************ CHARGEMENT GTFS (stops/stop_times/trips/calendar_dates only) ************/

const CFL_ALLOWED_ROUTE_IDS = new Set(['300','299','297']);
const CFL_ALLOWED_ROUTE_SHORT_NAMES = new Set(['RB','RE','IC']);

function cflIsAllowedTrainType(shortName){
  const upper = String(shortName || '').trim().toUpperCase();
  return upper && CFL_ALLOWED_ROUTE_SHORT_NAMES.has(upper);
}
    const CFL_TRAIN_TYPE_REGISTRY = new Map();

function normalizeCflTrainType(trainType){
  const upper = String(trainType || '').trim().toUpperCase();
  return upper && CFL_ALLOWED_ROUTE_SHORT_NAMES.has(upper) ? upper : '';
}

function canonicalizeCflNumero(value){
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^0+/, '');
  return stripped || raw;
}

const CFL_NUMERO_EQUIVALENCE_GROUPS = [
  ['2870','2871'],
  ['2864','2865'],
  ['2806','2807'],
  ['2872','2873'],
  ['2816','2817'],
  ['88504','88505'],
  ['88502','88503'],
  ['88500','88501'],
  ['88529','88530'],
  ['88531','88530'],
  ['88533','88532'],
  ['88535','88534'],
  ['88520','88521'],
  ['88522','88523'],
  ['88524','88525'],
  ['88526','88527'],
  ['88528','88529']
];

const CFL_NUMERO_EQUIVALENTS = (() => {
  const map = new Map();
  for (const group of CFL_NUMERO_EQUIVALENCE_GROUPS){
    if (!Array.isArray(group) || group.length < 2) continue;
    const normalized = Array.from(new Set(
      group
        .map(v => canonicalizeCflNumero(v))
        .filter(Boolean)
        .map(v => String(v))
    ));
    if (normalized.length < 2) continue;
    for (const key of normalized){
      map.set(key, normalized);
    }
  }
  return map;
})();

function getEquivalentCflNumeros(value){
  const key = canonicalizeCflNumero(value);
  if (!key) return [];
  const group = CFL_NUMERO_EQUIVALENTS.get(String(key));
  return Array.isArray(group) ? group.slice() : [];
}

const CFL_STOP_ALIAS_GROUPS = [
  ['Luxembourg', 'Luxembourg, Gare Centrale'],
  ['Bettembourg', 'Bettembourg, Gare'],
  ['Howald', 'Howald, Gare'],
  ['Pfaffenthal-Kirchberg', 'Pfaffenthal-Kirchberg, Gare'],
  ['Dommeldange', 'Dommeldange, Gare'],
  ['Walferdange', 'Walferdange, Gare'],
  ['Heisdorf', 'Heisdorf, Gare'],
  ['Lorentzweiler', 'Lorentzweiler, Gare'],
  ['Lintgen', 'Lintgen, Gare'],
  ['Mersch', 'Mersch, Gare'],
  ['Wasserbillig', 'Wasserbillig, Gare'],
  ['Pétange', 'Pétange, Gare'],
  ['Rodange', 'Rodange, Gare'],
  ['Esch-sur-Alzette', 'Esch-sur-Alzette, Gare'],
  ['Differdange', 'Differdange, Gare'],
  ['Dudelange-Usines', 'Dudelange (Usines), Gare'],
  ['Dudelange-Ville', 'Dudelange (Ville), Gare'],
  ['Dudelange-Centre', 'Dudelange-Centre, Gare'],
  ['Volmerange-les-Mines', 'Volmerange-les-Mines, Gare']
];

const CFL_STOP_ALIAS_INDEX = (() => {
  const map = new Map();
  for (const group of CFL_STOP_ALIAS_GROUPS){
    if (!Array.isArray(group) || !group.length) continue;
    const normalized = Array.from(new Set(group.map(normalizeVoiesTrainKey).filter(Boolean)));
    for (const key of normalized){
      map.set(key, normalized);
    }
  }
  return map;
})();

function getEquivalentCflStopKeys(stopName){
  const norm = normalizeVoiesTrainKey(stopName);
  if (!norm) return [];
  const seen = new Set([norm]);
  const out = [norm];
  const group = CFL_STOP_ALIAS_INDEX.get(norm);
  if (Array.isArray(group)){
    for (const key of group){
      if (key && !seen.has(key)){
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

function isLikelyCflStopName(stopName){
  return getEquivalentCflStopKeys(stopName).length > 0;
}

const FRENCH_BORDER_STOPS = new Set([
  'thionville',
  'uckange',
  'hagondange',
  'maiziereslesmetz',
  'woippy',
  'metznord',
  'metz',
  'pagnysurmoselle',
  'pontamousson',
  'nancy',
  'hettangegrande'
]);

function isLikelyFrenchStopContext({ stopName, stopPointId } = {}){
  const stopNorm = normalizeVoiesTrainKey(stopName);
  const rawId = String(stopPointId || '').trim();

  // Navitia SNCF ids: stop_area / stop_point OCE* (réseau France)
  if (/^stop(area|point):oce/i.test(rawId) || /:OCE/i.test(rawId) || /^OCE/i.test(rawId)) return true;

  // Arrêts frontaliers/côté France fréquemment présents dans le tableau.
  if (stopNorm){
    if (FRENCH_BORDER_STOPS.has(stopNorm)) return true;
    for (const frKey of FRENCH_BORDER_STOPS){
      if (stopNorm.startsWith(frKey) || frKey.startsWith(stopNorm)) return true;
    }
  }

  return false;
}

function stripLeadingZerosForDisplay(value){
  const raw = String(value ?? '').trim();
  const stripped = raw.replace(/^0+/, '');
  return stripped || '0';
}

function registerCflTrainType(selectionKey, trainType){
  if (!selectionKey || !selectionKey.startsWith('CFL-')) return;
  const normalized = normalizeCflTrainType(trainType);
  if (normalized) CFL_TRAIN_TYPE_REGISTRY.set(selectionKey, normalized);
}

function lookupRegisteredCflTrainType(selectionKey){
  const stored = selectionKey ? CFL_TRAIN_TYPE_REGISTRY.get(selectionKey) : '';
  return normalizeCflTrainType(stored);
}

function buildCflDisplayLabel(trainType, numero){
  const prefix = normalizeCflTrainType(trainType) || 'CFL';
  return `${prefix}${stripLeadingZerosForDisplay(numero)}`;
}
  function extractTrainNumberCandidate(value){
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const probes = [raw.split(':')[0], raw];
  for (const probe of probes){
    if (!probe) continue;
    const big = probe.match(/\d{4,}/);
    if (big) return big[0];
  }
  for (const probe of probes){
    if (!probe) continue;
    const mid = probe.match(/\d{3,}/);
    if (mid) return mid[0];
  }
  return null;
}

function normalizeTrainNumberKey(value){
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '');
  if (!cleaned) return null;
  if (/^[0-9]+$/.test(cleaned)){
    const trimmed = cleaned.replace(/^0+/, '');
    return trimmed || '0';
  }
  return cleaned.toUpperCase();
}
const CFL_STATION_ALIASES = {
  'luxembourg': ['Luxembourg, Gare Centrale'],
  'luxembourg gare': ['Luxembourg, Gare Centrale'],
  'luxembourg gare centrale': ['Luxembourg, Gare Centrale'],
  'gare de luxembourg': ['Luxembourg, Gare Centrale'],
  'howald': ['Howald, Gare'],
  'howald gare': ['Howald, Gare'],
  'gare de howald': ['Howald, Gare'],
  'bettembourg': ['Bettembourg, Gare'],
  'bettembourg gare': ['Bettembourg, Gare'],
  'gare de bettembourg': ['Bettembourg, Gare']
};
 const CFL_STOP_DISPLAY_OVERRIDES = {
  'Luxembourg, Gare Centrale': 'Luxembourg',
  'Howald, Gare': 'Howald',
  'Bettembourg, Gare': 'Bettembourg'
 };
   const MAINLINE_STATION_ORDER = {
  'nancy': 0,
  'garedenancy': 0,
  'pontamousson': 1,
  'garedepontamousson': 1,
  'pagnysurmoselle': 2,
  'garedepagnysurmoselle': 2,
  'metz': 3,
  'metzville': 3,
  'metzgare': 3,
  'garedemetz': 3,
  'garedemetzville': 3,
  'metznord': 4,
  'garedemetznord': 4,
  'woippy': 5,
  'garedewoippy': 5,
  'maiziereslesmetz': 6,
  'garedemaiziereslesmetz': 6,
  'walygatorparc': 7,
  'waligatorparc': 7,
  'hagondange': 8,
  'garedehagondange': 8,
  'uckange': 9,
  'garedeuckange': 9,
  'thionville': 10,
  'thionvillegare': 10,
  'garedeithionville': 10,
  'hettangegrande': 11,
  'garedehettangegrande': 11,
  'bettembourg': 12,
  'bettembourggare': 12,
  'garedebettembourg': 12,
  'howald': 13,
  'howaldgare': 13,
  'garedehowald': 13,
  'luxembourg': 14,
  'garedeluxembourg': 14,
  'luxembourggare': 14,
  'luxembourggarecentrale': 14,
  'luxembourrgarecentrale': 14
};
const CFL_BASES = [
  LB_ENDPOINTS.cflStaticBase,
  new URL('CFL/', location.href).href
];
const CFL_HAFAS_CACHE = new Map();

const HAFAS_PROXY_SAME_ORIGIN = (()=>{
  const base = location.origin + location.pathname.replace(/\/[^\/]*$/, '/');
  return base + 'retards_cfl.json';
})();

const HAFAS_PROXY_CANDIDATES = [
  LB_ENDPOINTS.retardsCfl,
  HAFAS_PROXY_SAME_ORIGIN,
  'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Assistant-train/retards_cfl.json',
  'https://cdn.jsdelivr.net/gh/TekMaTe-lux/Assistant-train@main/Assistant-train/retards_cfl.json'
];

const VOIES_BY_TRAIN_CANDIDATES = [
  LB_ENDPOINTS.voiesByTrain,
  location.origin + location.pathname.replace(/\/[^\/]*$/, '/') + 'voies_by_train.json',
  'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Assistant-train/voies_by_train.json',
  'https://cdn.jsdelivr.net/gh/TekMaTe-lux/Assistant-train@main/Assistant-train/voies_by_train.json'
];

const HAFAS_BY_STATION_CANDIDATES = [
  'https://vps.labetaillere.fr/gtfs/retards_cfl_by_station.json',
  location.origin + location.pathname.replace(/\/[^\/]*$/, '/') + 'retards_cfl_by_station.json',
  'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Assistant-train/retards_cfl_by_station.json',
  'https://cdn.jsdelivr.net/gh/TekMaTe-lux/Assistant-train@main/Assistant-train/retards_cfl_by_station.json'
];

const HAFAS_PROXY_TTL_MS = 110000;
let HAFAS_PROXY_CACHE = { map:null, updatedAt:null, fetchedAt:0, source:null };
let HAFAS_PROXY_PROMISE = null;


let CFL_GTFS = {
  ready: false,
  routes: new Map(),
  stopsById: new Map(),
  stopsByName: new Map(),
  tripsById: new Map(),
  tripsStops: new Map(),
  calendar: new Map(),
  tripsByNumber: new Map()
};
let CFL_LOADING_PROMISE = null;

function parseHafasProxyTimestamp(value){
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)){
    if (value > 1e12) return Math.round(value);
    if (value > 1e5) return Math.round(value * 1000);
    return Math.round(value * 1000);
  }
  const str = String(value).trim();
  if (!str) return null;
  let parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) return parsed;
  parsed = Date.parse(`${str}Z`);
  if (!Number.isNaN(parsed)) return parsed;
  return null;
}

function parseHafasProxyDelayValue(raw){
  if (raw == null) return { cancellation:true, minutes:null, hasMinutes:false };
  if (typeof raw === 'number'){
    if (Number.isFinite(raw)) return { cancellation:false, minutes: raw, hasMinutes:true };
    return { cancellation:false, minutes:null, hasMinutes:false };
  }
  if (typeof raw === 'string'){
    const trimmed = raw.trim();
    if (!trimmed) return { cancellation:false, minutes:null, hasMinutes:false };
    const cancellation = /cancel|suppr|delete|annul/i.test(trimmed);
    const numeric = Number(trimmed.replace(',', '.'));
    if (!Number.isNaN(numeric)){
      return { cancellation, minutes:numeric, hasMinutes:true };
    }
    return { cancellation, minutes:null, hasMinutes:false };
  }
  if (Array.isArray(raw)){
    let cancellation = false;
    let minutes = null;
    let hasMinutes = false;
    if (raw.length === 2 && typeof raw[0] === 'string'){
      const nested = parseHafasProxyDelayValue(raw[1]);
      const cancellationHint = /cancel|suppr|delete|annul/i.test(raw[0]);
      return {
        cancellation: nested.cancellation || cancellationHint,
        minutes: nested.minutes,
        hasMinutes: nested.hasMinutes
      };
    }
    for (const item of raw){
      const nested = parseHafasProxyDelayValue(item);
      if (nested.cancellation) cancellation = true;
      if (nested.hasMinutes && (!hasMinutes || Math.abs(nested.minutes) > Math.abs(minutes ?? 0))){
        minutes = nested.minutes;
        hasMinutes = true;
      }
    }
    return { cancellation, minutes, hasMinutes };
  }
  if (typeof raw === 'object'){
    let cancellation = false;
    let minutes = null;
    let hasMinutes = false;
    if (raw.cancelled != null) cancellation = cancellation || Boolean(raw.cancelled);
    const status = raw.status || raw.state || raw.rtStatus || raw.rtState || raw.note;
    if (status && /cancel|suppr|delete|annul/i.test(String(status))) cancellation = true;
    const keys = ['delay','minutes','value','rtDelay','delayMinutes','min','rt','realtime','rtMinutes'];
    for (const key of keys){
      if (raw[key] == null) continue;
      const nested = parseHafasProxyDelayValue(raw[key]);
      if (nested.cancellation) cancellation = true;
      if (nested.hasMinutes && (!hasMinutes || Math.abs(nested.minutes) > Math.abs(minutes ?? 0))){
        minutes = nested.minutes;
        hasMinutes = true;
      }
    }
    return { cancellation, minutes, hasMinutes };
  }
  return { cancellation:false, minutes:null, hasMinutes:false };
}

function appendHafasProxyStationEntry(map, stationName, rawValue){
  if (!stationName) return;
  const norm = normalizeStationName(stationName);
  if (!norm) return;
  const { cancellation, minutes, hasMinutes } = parseHafasProxyDelayValue(rawValue);
  if (cancellation){
    map.set(norm, { original: stationName, value: null, source: 'HAFAS', sourceKey: 'hafas' });
    return;
  }
  if (!hasMinutes) return;
  const value = Number(minutes);
  if (!Number.isFinite(value)) return;
  const existing = map.get(norm);
  if (existing && existing.value != null){
    const existingVal = Number(existing.value);
    if (Number.isFinite(existingVal) && Math.abs(existingVal) >= Math.abs(value)) return;
  }
  map.set(norm, { original: stationName, value, source: 'HAFAS', sourceKey: 'hafas' });
}

function buildHafasProxyStationMap(raw){
  const perStation = new Map();
  if (!raw) return perStation;
  if (Array.isArray(raw)){
    for (const entry of raw){
      if (entry == null) continue;
      if (Array.isArray(entry)){
        if (!entry.length) continue;
        const stationName = entry[0];
        const value = entry.length > 1 ? entry[1] : null;
        appendHafasProxyStationEntry(perStation, stationName, value);
        continue;
      }
      if (typeof entry === 'object'){
        const stationName = entry.station || entry.stop || entry.name || entry.label;
        if (stationName){
          const value = entry.delay ?? entry.minutes ?? entry.value ?? entry.rtDelay ?? entry.delayMinutes ?? entry.min ?? entry.rt ?? entry.realtime;
          appendHafasProxyStationEntry(perStation, stationName, value ?? entry);
          continue;
        }
        const keys = Object.keys(entry);
        if (keys.length === 1){
          const key = keys[0];
          appendHafasProxyStationEntry(perStation, key, entry[key]);
        }
        continue;
      }
    }
    return perStation;
  }
  if (typeof raw === 'object'){
    for (const [stationName, value] of Object.entries(raw)){
      appendHafasProxyStationEntry(perStation, stationName, value);
    }
  }
  return perStation;
}

function parseHafasProxyData(data){
  const perTrain = new Map();
  if (!data || typeof data !== 'object'){
    return { perTrain, updatedAt: null };
  }
  let container = null;
  for (const candidate of [data.data, data.trains, data.journeys, data]){
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)){
      container = candidate;
      break;
    }
  }
  if (container){
    for (const [trainKey, raw] of Object.entries(container)){
      if (!trainKey) continue;
      const stationMap = buildHafasProxyStationMap(raw);
      if (!stationMap.size) continue;
      const candidate = extractTrainNumberCandidate(trainKey);
      const rawKey = candidate != null ? String(candidate) : String(trainKey);
      const normalizedKey = normalizeTrainNumberKey(rawKey) || rawKey;
      perTrain.set(normalizedKey, stationMap);
    }
  }
  const updatedAt = parseHafasProxyTimestamp(
    data.updatedAt || data.updated_at || data.generatedAt || data.generated_at || data.lastUpdated || data.timestamp
  );
  return { perTrain, updatedAt };
}

async function loadHafasProxyData({ forceFresh = false } = {}){
  const now = Date.now();
  if (!forceFresh && HAFAS_PROXY_CACHE.map instanceof Map){
    if (!HAFAS_PROXY_CACHE.fetchedAt || (now - HAFAS_PROXY_CACHE.fetchedAt) < HAFAS_PROXY_TTL_MS){
      return HAFAS_PROXY_CACHE;
    }
  }
  if (HAFAS_PROXY_PROMISE) return HAFAS_PROXY_PROMISE;

  HAFAS_PROXY_PROMISE = (async()=>{
    let lastErr = null;
    for (const candidate of HAFAS_PROXY_CANDIDATES){
      if (!candidate) continue;
      const url = candidate + (candidate.includes('?') ? '&' : '?') + 't=' + Date.now();
      try {
        console.log('[HAFAS proxy] tentative:', url);
        const res = await fetchWithTimeoutNoHeaders(url, 8000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        let data;
        if (ct.includes('application/json')){
          data = await res.json();
        } else {
          data = JSON.parse(await res.text());
        }
        const parsed = parseHafasProxyData(data);
        HAFAS_PROXY_CACHE = {
          map: parsed.perTrain,
          updatedAt: parsed.updatedAt || Date.now(),
          fetchedAt: Date.now(),
          source: candidate
        };
        return HAFAS_PROXY_CACHE;
      } catch (err){
        lastErr = err;
        console.warn('[HAFAS proxy] échec sur', candidate, err);
      }
    }
    if (HAFAS_PROXY_CACHE.map instanceof Map && HAFAS_PROXY_CACHE.map.size){
      return HAFAS_PROXY_CACHE;
    }
    if (lastErr) throw lastErr;
    throw new Error('Proxy HAFAS indisponible');
  })();

  try {
    return await HAFAS_PROXY_PROMISE;
  } finally {
    HAFAS_PROXY_PROMISE = null;
  }
}

async function lookupHafasProxyDelay({ trainCandidates, stationNorm }){
  if (!stationNorm) return null;
  if (!Array.isArray(trainCandidates) || !trainCandidates.length) return null;
  let snapshot;
  try {
    snapshot = await loadHafasProxyData();
  } catch (err){
    console.warn('[CFL][HAFAS] proxy indisponible', err);
    return null;
  }
  const map = snapshot?.map;
  if (!(map instanceof Map) || map.size === 0) return null;
  const normalizedStation = stationNorm;
  let fallbackEntry = null;
  for (const candidate of trainCandidates){
    const normalizedKey = normalizeTrainNumberKey(candidate);
    if (!normalizedKey) continue;
    const perStation = map.get(normalizedKey);
    if (!(perStation instanceof Map) || perStation.size === 0) continue;
    const direct = perStation.get(normalizedStation);
    if (direct){
      const delayMinutes = direct.value == null ? null : Number(direct.value);
      return {
        delayMinutes: Number.isFinite(delayMinutes) ? delayMinutes : null,
        cancelled: direct.value == null,
        stationOriginal: direct.original,
        source: snapshot.source || '',
        fetchedAt: snapshot.updatedAt || snapshot.fetchedAt || Date.now()
      };
    }
    if (!fallbackEntry){
      for (const entry of perStation.values()){
        if (!entry) continue;
        fallbackEntry = entry;
        break;
      }
    }
  }
  if (fallbackEntry){
    const delayMinutes = fallbackEntry.value == null ? null : Number(fallbackEntry.value);
    return {
      delayMinutes: Number.isFinite(delayMinutes) ? delayMinutes : null,
      cancelled: fallbackEntry.value == null,
      stationOriginal: fallbackEntry.original,
      source: snapshot.source || '',
      fetchedAt: snapshot.updatedAt || snapshot.fetchedAt || Date.now()
    };
  }
  return null;
}

function buildHafasTrainKeyCandidates({ numeroRaw, canonicalNumero, effectiveNumero, normalizedType, selectionKey }){
  const set = new Set();
  const push = value => {
    if (value == null) return;
    const str = String(value).trim();
    if (!str) return;
    set.add(str);
  };
  push(numeroRaw);
  push(canonicalNumero);
  push(effectiveNumero);
  if (selectionKey){
    const trimmed = String(selectionKey).replace(/^CFL-/, '');
    push(trimmed);
  }
  const digitsOnly = String(canonicalNumero || numeroRaw || '').replace(/[^0-9]/g, '');
  push(digitsOnly);
  const displayNumero = stripLeadingZerosForDisplay(canonicalNumero || numeroRaw);
  push(displayNumero);
  if (normalizedType){
    push(`${normalizedType}${displayNumero}`);
    push(`${normalizedType} ${displayNumero}`);
    if (digitsOnly){
      push(`${normalizedType}${digitsOnly}`);
      push(`${normalizedType} ${digitsOnly}`);
    }
  }
  return Array.from(set);
}

function cflIsRealStation(name){
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower.includes('routière') || lower.includes('routiere')) return false;
  if (lower.includes('rocade')) return false;
  if (lower.includes('(tram')) return false;
  if (lower.includes(' tram')) return false;
  if (lower.includes('rue de la gare')) return false;
  if (lower.includes('op der gare')) return false;
  if (lower.includes('bus')) return false;
  if (name === 'Luxembourg, Gare Centrale') return true;
  if (name === 'Howald, Gare') return true;
  if (/, Gare\b/.test(name)) return true;
  return false;
}

function cflTimeToMinutes(hms){
  if (!hms || typeof hms !== 'string' || !hms.includes(':')) return null;
  const parts = hms.split(':');
  const H = Number(parts[0]);
  const M = Number(parts[1]);
  if (!Number.isFinite(H) || !Number.isFinite(M)) return null;
  return (H * 60) + M;
}

function cflWeekdayIdxFromYMD(ymd){
  if (!ymd || ymd.length !== 8) return null;
  const y = Number(ymd.slice(0,4));
  const m = Number(ymd.slice(4,6)) - 1;
  const d = Number(ymd.slice(6,8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const jsDate = new Date(y, m, d);
  const jsDay = jsDate.getDay(); // 0=dimanche
  const map = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 0:6 };
  return map[jsDay];
}

async function fetchAndParseCFLCSV(filename, opt = {}){
  let lastErr;
  for (const base of CFL_BASES){
    const url = base + filename;
    try {
      const resp = await fetch(url, { cache: 'default' });
      if (!resp.ok) throw new Error('HTTP '+resp.status+' on '+url);
      if (resp.body && typeof resp.body.getReader === 'function' && typeof TextDecoder === 'function'){
        return await parseCSVFromStream(resp.body, opt);
      }
      const txt = await resp.text();
      return parseCSV(txt, opt);
    } catch (e){
      lastErr = e;
    }
  }
  throw lastErr || new Error('Impossible de charger '+filename);
}

function cflServiceRunsOnDate(service_id, yyyymmdd, weekdayIdx){
  if (!service_id || !yyyymmdd) return false;
  const svc = CFL_GTFS.calendar.get(service_id);
  if (!svc) return false;
  if (svc.exceptions && svc.exceptions.has(yyyymmdd)){
    return svc.exceptions.get(yyyymmdd) === 1;
  }
  if (svc.startDate && yyyymmdd < svc.startDate) return false;
  if (svc.endDate && yyyymmdd > svc.endDate) return false;
  if (!svc.days) return false;
  const key = String((weekdayIdx ?? 0) + 1);
  return !!svc.days[key];
}

function mapToCflStationNames(name){
  const normalized = (name || '').trim();
  if (!normalized) return [];
  const lower = normalized.toLowerCase();
  const candidates = new Set();
  if (CFL_GTFS.stopsByName.has(normalized)) candidates.add(normalized);
  const aliases = CFL_STATION_ALIASES[lower];
  if (Array.isArray(aliases)){
    aliases.forEach(n => {
      if (CFL_GTFS.stopsByName.has(n)) candidates.add(n);
    });
  }
  return Array.from(candidates);
}

function isCflDisplayStation(name){
  const lower = (name || '').trim().toLowerCase();
  if (!lower) return false;
  if (CFL_STATION_ALIASES[lower]) return true;
  return CFL_GTFS.stopsByName.has(name || '');
}

async function ensureCFLGTFSLoaded(){
  if (CFL_GTFS.ready) return;
  if (CFL_LOADING_PROMISE){
    await CFL_LOADING_PROMISE;
    return;
  }
  CFL_LOADING_PROMISE = (async () => {
    const [routesRows, stopsRows, tripsRows, stopTimesRows, calRows, calDatesRows] = await Promise.all([
      fetchAndParseCFLCSV('routescfl.txt'),
      fetchAndParseCFLCSV('stopscfl.txt'),
      fetchAndParseCFLCSV('tripscfl.txt'),
      fetchAndParseCFLCSV('stop_timescfl.txt'),
      fetchAndParseCFLCSV('calendarcfl.txt'),
      fetchAndParseCFLCSV('calendar_datescfl.txt')
    ]);

    CFL_GTFS = {
      ready: false,
      routes: new Map(),
      stopsById: new Map(),
      stopsByName: new Map(),
      tripsById: new Map(),
      tripsStops: new Map(),
      calendar: new Map(),
      tripsByNumber: new Map()
    };

    for (const r of routesRows){
      const route_id = (r.route_id || '').trim();
      const agency_id = (r.agency_id || '').trim();
      if (!route_id || !CFL_ALLOWED_ROUTE_IDS.has(route_id)) continue;
      if (agency_id !== '11') continue;
      const shortName = (r.route_short_name || '').trim();
      if (!cflIsAllowedTrainType(shortName)) continue;
      CFL_GTFS.routes.set(route_id, {
        route_id,
        shortName,
        longName: (r.route_long_name || '').trim(),
        type: (r.route_type || '').trim()
      });
    }

    for (const s of stopsRows){
      const stop_id = (s.stop_id || '').trim();
      const stop_name = (s.stop_name || '').trim();
      if (!stop_id || !stop_name) continue;
      if (!cflIsRealStation(stop_name)) continue;
      CFL_GTFS.stopsById.set(stop_id, {
        name: stop_name,
        lat: Number(s.stop_lat || '0'),
        lon: Number(s.stop_lon || '0')
      });
      if (!CFL_GTFS.stopsByName.has(stop_name)) CFL_GTFS.stopsByName.set(stop_name, new Set());
      CFL_GTFS.stopsByName.get(stop_name).add(stop_id);
    }

    for (const t of tripsRows){
      const trip_id = (t.trip_id || '').trim();
      const route_id = (t.route_id || '').trim();
      const service_id = (t.service_id || '').trim();
      if (!trip_id || !route_id || !service_id) continue;
      const headsign = (t.trip_headsign || '').trim();
      const shortName = (t.trip_short_name || '').trim();
      CFL_GTFS.tripsById.set(trip_id, {
        route_id,
        service_id,
        headsign,
        shortName
      });
      const numeroRaw =
        (shortName && extractTrainNumber(shortName)) ||
        (headsign && extractTrainNumber(headsign)) ||
        extractTrainNumber(trip_id);
      if (numeroRaw){
        const numeroStr = String(numeroRaw).trim();
        if (numeroStr){
          const canonical = canonicalizeCflNumero(numeroStr);
          const keys = new Set([numeroStr]);
          if (canonical && canonical !== numeroStr) keys.add(canonical);
          keys.forEach(key => {
            if (!CFL_GTFS.tripsByNumber.has(key)) CFL_GTFS.tripsByNumber.set(key, new Set());
            CFL_GTFS.tripsByNumber.get(key).add(trip_id);
          });
        }
      }
    }

    for (const c of calRows){
      const service_id = (c.service_id || '').trim();
      if (!service_id) continue;
      CFL_GTFS.calendar.set(service_id, {
        startDate: (c.start_date || '').trim(),
        endDate: (c.end_date || '').trim(),
        days: {
          '1': c.monday === '1',
          '2': c.tuesday === '1',
          '3': c.wednesday === '1',
          '4': c.thursday === '1',
          '5': c.friday === '1',
          '6': c.saturday === '1',
          '7': c.sunday === '1'
        },
        exceptions: new Map()
      });
    }

    for (const ce of calDatesRows){
      const service_id = (ce.service_id || '').trim();
      const date = (ce.date || '').trim();
      const exc = Number((ce.exception_type || '').trim());
      if (!service_id || !date || !Number.isFinite(exc)) continue;
      if (!CFL_GTFS.calendar.has(service_id)){
        CFL_GTFS.calendar.set(service_id, {
          startDate: '',
          endDate: '',
          days: {},
          exceptions: new Map()
        });
      }
      CFL_GTFS.calendar.get(service_id).exceptions.set(date, exc);
    }

    for (const st of stopTimesRows){
      const trip_id = (st.trip_id || '').trim();
      const stop_id = (st.stop_id || '').trim();
      if (!trip_id || !stop_id) continue;
      if (!CFL_GTFS.tripsById.has(trip_id)) continue;
      if (!CFL_GTFS.stopsById.has(stop_id)) continue;
      if (!CFL_GTFS.tripsStops.has(trip_id)) CFL_GTFS.tripsStops.set(trip_id, []);
      CFL_GTFS.tripsStops.get(trip_id).push({
        stop_id,
        dep: cflTimeToMinutes(st.departure_time),
        arr: cflTimeToMinutes(st.arrival_time),
        seq: Number(st.stop_sequence || '0')
      });
    }

    const removedTripIds = new Set();
    CFL_GTFS.tripsStops.forEach((arrs, tripId) => {
      arrs.sort((a,b) => a.seq - b.seq);
      if (arrs.length < 2){
        CFL_GTFS.tripsStops.delete(tripId);
        CFL_GTFS.tripsById.delete(tripId);
        removedTripIds.add(tripId);
      }
    });

    if (removedTripIds.size && CFL_GTFS.tripsByNumber){
      CFL_GTFS.tripsByNumber.forEach((set, numero) => {
        removedTripIds.forEach(id => set.delete(id));
        if (!set.size) CFL_GTFS.tripsByNumber.delete(numero);
      });
    }

    CFL_GTFS.ready = true;
  })();

  try {
    await CFL_LOADING_PROMISE;
  } finally {
    CFL_LOADING_PROMISE = null;
  }
}

function cflFindDirectTrainsBetween({ fromNames = [], toNames = [], minDepartureMinutes = 0, maxDepartureMinutes = 1439, ymd }){
  if (!CFL_GTFS.ready) return [];
  const weekdayIdx = cflWeekdayIdxFromYMD(ymd);
  const fromIds = new Set();
  const toIds = new Set();
  for (const name of fromNames){
    const ids = CFL_GTFS.stopsByName.get(name);
    if (ids) ids.forEach(id => fromIds.add(id));
  }
  for (const name of toNames){
    const ids = CFL_GTFS.stopsByName.get(name);
    if (ids) ids.forEach(id => toIds.add(id));
  }
  if (!fromIds.size || !toIds.size) return [];
  const results = [];
  const seen = new Set();
  CFL_GTFS.tripsStops.forEach((stopSeq, tripId) => {
    const tripMeta = CFL_GTFS.tripsById.get(tripId);
    if (!tripMeta) return;
    if (!cflServiceRunsOnDate(tripMeta.service_id, ymd, weekdayIdx)) return;

    let depStop = null;
    let arrStop = null;
    for (const s of stopSeq){
      if (!depStop && fromIds.has(s.stop_id)) depStop = s;
      if (depStop && toIds.has(s.stop_id) && s.seq > depStop.seq){
        arrStop = s;
        break;
      }
    }
    if (!depStop || !arrStop) return;
    if (depStop.dep == null || depStop.dep < minDepartureMinutes) return;
    if (depStop.dep > maxDepartureMinutes) return;

    const routeMeta = CFL_GTFS.routes.get(tripMeta.route_id) || {};
    const trainType = routeMeta.shortName || '';
    if (!cflIsAllowedTrainType(trainType)) return;
    const normalizedType = normalizeCflTrainType(trainType);
    const numeroRaw = (tripMeta.shortName && tripMeta.shortName.trim()) || extractTrainNumber(tripMeta.headsign) || null;
    if (!numeroRaw) return;

    const key = `${tripId}|${depStop.seq}|${arrStop.seq}`;
    if (seen.has(key)) return;
    seen.add(key);

    const numeroStr = String(numeroRaw).trim();
    if (!numeroStr) return;
    const selectionKey = `CFL-${numeroStr}`;
    registerCflTrainType(selectionKey, normalizedType);

    results.push({
      numero: numeroStr,
      selectionKey,
      displayLabel: buildCflDisplayLabel(normalizedType, numeroStr),
      dep: minutesToClock(depStop.dep),
      arr: arrStop.arr != null ? minutesToClock(arrStop.arr) : null,
      depMin: depStop.dep,
      arrMin: arrStop.arr,
      source: 'CFL',
      trainType: normalizedType,
      viaStart: depStop.stop_id,
      viaEnd: arrStop.stop_id,
      tripId
    });
  });
  results.sort((a,b) => (a.depMin - b.depMin) || a.numero.localeCompare(b.numero));
  return results;
}

function hhmmssToMinutes(hms){
  if (!hms || typeof hms !== 'string') return null;
  const [H, M, S] = hms.split(':').map(Number);
  if (!Number.isFinite(H) || !Number.isFinite(M)) return null;
  const totalSeconds = (H * 3600) + (M * 60) + (Number.isFinite(S) ? S : 0);
  return Math.floor(totalSeconds / 60);
}

function extractMainlineNumero(source){
  const txt = String(source || '');
  if (!txt) return null;
  const match = txt.match(/(?:^|[^0-9])(8\d{4,5})(?!\d)/);
  return match ? match[1] : null;
}

function gtfsFindDirectTrainsBetween({ startName, endName, fromMin, toMin, ymd }){
  const originIds = getIdsForName(startName);
  const destIds = getIdsForName(endName);
  if (!originIds.size || !destIds.size) return [];
  ensureStopTimesByTripIndex();
  const results = [];
  GTFS._stopTimesByTrip.forEach((stops, tripId) => {
    if (!serviceActiveForDate(tripId, ymd)) return;
    let depRow = null;
    let arrRow = null;
    for (const row of stops){
      if (!depRow && originIds.has(row.stop_id)) depRow = row;
      if (depRow && destIds.has(row.stop_id) && Number(row.stop_sequence) > Number(depRow.stop_sequence)){
        arrRow = row;
        break;
      }
    }
    if (!depRow || !arrRow) return;
    const depMin = hhmmssToMinutes(depRow.departure_time);
    if (depMin == null || depMin < fromMin || depMin > toMin) return;
    const arrMin = hhmmssToMinutes(arrRow.arrival_time);
    const tripMeta = GTFS.tripById?.get(tripId);
    let numero = null;
    if (tripMeta){
      numero = extractMainlineNumero(tripMeta.trip_short_name)
        || extractMainlineNumero(tripMeta.trip_headsign);
    }
    if (!numero) numero = extractMainlineNumero(tripId);
    if (!numero) return;

    results.push({
      numero,
      selectionKey: numero,
      displayLabel: `${numero}`,
      dep: minutesToClock(depMin),
      arr: arrMin != null ? minutesToClock(arrMin) : null,
      depMin,
      arrMin,
      source: 'SNCF',
      tripId
    });
  });
  results.sort((a,b) => (a.depMin - b.depMin) || a.numero.localeCompare(b.numero));
  return results;
}

async function computeCflHybridTransfers({
  startName,
  endName,
  fromMin,
  toMin,
  ymd,
  minTransferMin,
  maxTransferMin
}){
  const results = [];
  const startIsCfl = isCflDisplayStation(startName);
  const endIsCfl = isCflDisplayStation(endName);
  if (!startIsCfl && !endIsCfl) return results;

  const vias = ['Bettembourg', 'Luxembourg'];
  const maxSecondDeparture = Math.min(1439, toMin + maxTransferMin);

  if (!startIsCfl && endIsCfl){
    const cflEndCandidates = mapToCflStationNames(endName);
    if (cflEndCandidates.length){
      for (const via of vias){
        if (!isPivotDirectionallyValid(startName, via, endName)) continue;
        const leg1List = gtfsFindDirectTrainsBetween({ startName, endName: via, fromMin, toMin, ymd });
        if (!leg1List.length) continue;
        const cflViaCandidates = mapToCflStationNames(via);
        if (!cflViaCandidates.length) continue;
        const leg2List = cflFindDirectTrainsBetween({
          fromNames: cflViaCandidates,
          toNames: cflEndCandidates,
          minDepartureMinutes: 0,
          maxDepartureMinutes: maxSecondDeparture,
          ymd
        });
        if (!leg2List.length) continue;
        for (const leg1 of leg1List){
          if (leg1.arrMin == null) continue;
          const earliest = leg1.arrMin + minTransferMin;
          const latest = leg1.arrMin + maxTransferMin;
          const match = leg2List.find(l2 => l2.depMin != null && l2.depMin >= earliest && l2.depMin <= latest);
          if (!match) continue;
          const waitMin = Math.max(0, Math.round(match.depMin - leg1.arrMin));
          const durMin = (match.arrMin != null && leg1.depMin != null)
            ? Math.max(0, Math.round(match.arrMin - leg1.depMin))
            : waitMin;
          results.push({
            viaName: via,
            num1: leg1.selectionKey,
            num2: match.selectionKey,
            label1: leg1.displayLabel,
            label2: match.displayLabel,
            source1: 'SNCF',
            source2: 'CFL',
            dep1: leg1.dep,
            arr1: leg1.arr,
            dep2: match.dep,
            arr2: match.arr,
            waitMin,
            durMin,
            trip1: leg1.tripId || null,
            trip2: match.tripId || null
          });
        }
      }
    }
  }

  if (startIsCfl && !endIsCfl){
    const cflStartCandidates = mapToCflStationNames(startName);
    if (cflStartCandidates.length){
      for (const via of vias){
        if (!isPivotDirectionallyValid(startName, via, endName)) continue;
        const cflViaCandidates = mapToCflStationNames(via);
        if (!cflViaCandidates.length) continue;
        const leg1List = cflFindDirectTrainsBetween({
          fromNames: cflStartCandidates,
          toNames: cflViaCandidates,
          minDepartureMinutes: fromMin,
          maxDepartureMinutes: toMin,
          ymd
        });
        if (!leg1List.length) continue;
        const leg2List = gtfsFindDirectTrainsBetween({
          startName: via,
          endName,
          fromMin,
          toMin: maxSecondDeparture,
          ymd
        });
        if (!leg2List.length) continue;
        for (const leg1 of leg1List){
          if (leg1.arrMin == null) continue;
          const earliest = leg1.arrMin + minTransferMin;
          const latest = leg1.arrMin + maxTransferMin;
          const match = leg2List.find(l2 => l2.depMin != null && l2.depMin >= earliest && l2.depMin <= latest);
          if (!match) continue;
          const waitMin = Math.max(0, Math.round(match.depMin - leg1.arrMin));
          const durMin = (match.arrMin != null && leg1.depMin != null)
            ? Math.max(0, Math.round(match.arrMin - leg1.depMin))
            : waitMin;
          results.push({
            viaName: via,
            num1: leg1.selectionKey,
            num2: match.selectionKey,
            label1: leg1.displayLabel,
            label2: match.displayLabel,
            source1: 'CFL',
            source2: 'SNCF',
            dep1: leg1.dep,
            arr1: leg1.arr,
            dep2: match.dep,
            arr2: match.arr,
            waitMin,
            durMin,
            trip1: leg1.tripId || null,
            trip2: match.tripId || null
          });
        }
      }
    }
  }

  return results;
}

function cflStopIdToHafas(stopId){
  if (!stopId) return null;
  const str = String(stopId).trim();
  if (!str) return null;
  const numeric = Number(str);
  if (Number.isFinite(numeric)) return String(numeric);
  const withoutZeros = str.replace(/^0+/, '');
  return withoutZeros || str;
}

function cflFormatStopDisplayName(name){
  const raw = (name || '').trim();
  if (!raw) return '';
  if (CFL_STOP_DISPLAY_OVERRIDES[raw]) return CFL_STOP_DISPLAY_OVERRIDES[raw];
  if (/[,\s]Gare Centrale$/i.test(raw)) return raw.replace(/[,\s]Gare Centrale$/i, '');
  if (/[,\s]Gare$/i.test(raw)) return raw.replace(/[,\s]Gare$/i, '');
  return raw;
}

function parseHafasRealtimeTime(value){
  if (!value) return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length >= 4) return digits.slice(0, 4);
  return null;
}

function extractHafasCause(dep){
  const pool = [];
  if (Array.isArray(dep?.messages)){
    dep.messages.forEach(msg => {
      const txt = typeof msg?.text === 'string' ? msg.text.trim() : '';
      if (txt) pool.push(txt);
    });
  }
  [dep?.rtReason, dep?.infoText, dep?.Product?.note].forEach(val => {
    const txt = typeof val === 'string' ? val.trim() : '';
    if (txt) pool.push(txt);
  });
  const filtered = pool.find(t => t && t.toLowerCase() !== 'à l\'heure' && t.toLowerCase() !== "on time");
  return filtered || null;
}

function normalizeCflMatchToken(value){
  return String(value ?? '').trim().replace(/[^0-9A-Z]/gi, '').toUpperCase();
}

function hafasMatchesCflNumber(dep, info = {}){
  if (!dep) return false;
  const numeroRaw = String(info.numeroRaw ?? '').trim();
  const canonicalNumero = String(info.canonicalNumero ?? '').trim() || canonicalizeCflNumero(numeroRaw);
  const trainType = normalizeCflTrainType(info.trainType);
  const tokens = new Set();
  if (numeroRaw) tokens.add(numeroRaw);
  if (canonicalNumero && canonicalNumero !== numeroRaw) tokens.add(canonicalNumero);
  const displayNumero = stripLeadingZerosForDisplay(numeroRaw || canonicalNumero);
  if (displayNumero) tokens.add(displayNumero);
  if (trainType){
    const combos = new Set([displayNumero, canonicalNumero, numeroRaw]);
    combos.forEach(num => {
      const clean = String(num || '').trim();
      if (!clean) return;
      tokens.add(`${trainType}${clean}`);
      tokens.add(`${trainType} ${clean}`);
    });
  }
  const normalizedTargets = Array.from(tokens)
    .map(normalizeCflMatchToken)
    .filter(Boolean);
  if (!normalizedTargets.length) return false;
  const candidates = [
    dep?.Product?.number,
    dep?.Product?.name,
    dep?.Product?.line,
    dep?.journeyNumber,
    dep?.name,
    dep?.line,
    dep?.direction
  ];
  return candidates.some(val => {
    if (typeof val !== 'string') return false;
    const normalized = normalizeCflMatchToken(val);
    if (!normalized) return false;
    return normalizedTargets.some(target => normalized.includes(target));
  });
}

async function fetchCflHafasDepartures({ stopId, dateYmd, baseTimeHHMM, durationMinutes = 180 }){
  const hafasId = cflStopIdToHafas(stopId);
  if (!hafasId || !dateYmd) return null;
  if (!/^\d{8}$/.test(dateYmd)) return null;
  const dateStr = `${dateYmd.slice(0,4)}-${dateYmd.slice(4,6)}-${dateYmd.slice(6,8)}`;
  const baseMinutes = rawHHMMToMinutes(baseTimeHHMM);
  const startMinutes = baseMinutes == null ? null : Math.max(0, baseMinutes - 15);
  const startClock = startMinutes == null ? '00:00' : minutesToClock(startMinutes) || '00:00';
  const timeParam = `${startClock}:00`;
  const duration = Number.isFinite(durationMinutes) ? Math.max(30, durationMinutes) : 180;
  const cacheKey = `${hafasId}|${dateStr}|${startClock}|${duration}`;

  if (!CFL_HAFAS_CACHE.has(cacheKey)){
    try {
      const params = new URLSearchParams({ id: hafasId, date: dateStr, time: timeParam, duration: String(duration), maxJourneys: '50', format: 'json' });
      const url = `${LB_ENDPOINTS.hafasDepartureBoard}?${params.toString()}`;
      const resp = await fetch(url, { cache: 'default' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const departures = Array.isArray(data?.Departure) ? data.Departure : [];
      CFL_HAFAS_CACHE.set(cacheKey, { departures });
    } catch (err){
      console.warn('[CFL][HAFAS]', err);
      CFL_HAFAS_CACHE.set(cacheKey, { departures: [], error: err });
    }
  }

  return CFL_HAFAS_CACHE.get(cacheKey) || null;
}

async function buildCflResult(selectionKey, { ymd } = {}){
  const numeroRaw = String(selectionKey || '').replace(/^CFL-/, '').trim();
  if (!numeroRaw) return { error: 'Non trouvé' };
  const canonicalNumero = canonicalizeCflNumero(numeroRaw);
  const lookupKeys = [];
  if (numeroRaw) lookupKeys.push(numeroRaw);
  if (canonicalNumero && canonicalNumero !== numeroRaw) lookupKeys.push(canonicalNumero);
  const effectiveNumero = canonicalNumero || numeroRaw;

  try {
    await ensureCFLGTFSLoaded();
  } catch (err){
    console.warn('[CFL] Chargement GTFS impossible', err);
    return { error: 'Données CFL indisponibles' };
  }

  if (!CFL_GTFS.ready) return { error: 'Données CFL indisponibles' };
  let set = null;
  for (const key of lookupKeys){
    const candidate = CFL_GTFS.tripsByNumber?.get(key);
    if (candidate && candidate.size){
      set = candidate;
      break;
    }
  }
  if (!set || !set.size) return { error: 'Non trouvé' };

  const ymdDate = (ymd && /^\d{8}$/.test(ymd)) ? ymd : null;
  const weekdayIdx = ymdDate ? cflWeekdayIdxFromYMD(ymdDate) : null;
  const candidates = Array.from(set);
  let chosenTripId = null;
  if (ymdDate){
    for (const tripId of candidates){
      const meta = CFL_GTFS.tripsById.get(tripId);
      if (meta && cflServiceRunsOnDate(meta.service_id, ymdDate, weekdayIdx)){
        chosenTripId = tripId;
        break;
      }
    }
  }
  if (!chosenTripId) chosenTripId = candidates[0];
  const tripMeta = CFL_GTFS.tripsById.get(chosenTripId);
  const stopSeq = CFL_GTFS.tripsStops.get(chosenTripId);
  if (!tripMeta || !stopSeq || !stopSeq.length) return { error: 'Non trouvé' };

  const stop_times = stopSeq.map(row => {
    const stopMeta = CFL_GTFS.stopsById.get(row.stop_id) || {};
    const displayName = cflFormatStopDisplayName(stopMeta.name || row.stop_id);
    return {
      stop_point: {
        id: row.stop_id,
        name: displayName
      },
      arrival_time: minutesToRawHHMM(row.arr),
      departure_time: minutesToRawHHMM(row.dep)
    };
  });

  const routeMeta = CFL_GTFS.routes.get(tripMeta.route_id) || {};
  const trainType = (routeMeta.shortName || '').trim();
  if (!cflIsAllowedTrainType(trainType)){
    return { error: 'Train CFL non pris en charge' };
  }
  const normalizedType = normalizeCflTrainType(trainType);
  const canonicalKey = (selectionKey && selectionKey.startsWith('CFL-'))
    ? selectionKey
    : `CFL-${numeroRaw}`;
  registerCflTrainType(canonicalKey, normalizedType);

  const displayLabel = buildCflDisplayLabel(normalizedType, numeroRaw);
  const impacted = {};
  const disruptions = [];
  const disruptionCauses = [];

  let hafasRealtime = null;

  if (ymdDate){
    const firstDeparture = stopSeq.find(s => Number.isFinite(s.dep));
    if (firstDeparture){
    const baseDepartureRaw = minutesToRawHHMM(firstDeparture.dep);
      const baseArrivalRaw = minutesToRawHHMM(firstDeparture.arr);
      const stopMeta = CFL_GTFS.stopsById.get(firstDeparture.stop_id) || {};
      const stopName = cflFormatStopDisplayName(stopMeta.name || '');
      const stationNorm = normalizeStationName(stopName || stopMeta.name || '');
      const trainKeyCandidates = buildHafasTrainKeyCandidates({
        numeroRaw,
      canonicalNumero,
        effectiveNumero,
        normalizedType,
        selectionKey: canonicalKey
      });

      if (stationNorm){
        try {
          const proxyInfo = await lookupHafasProxyDelay({ trainCandidates: trainKeyCandidates, stationNorm });
          if (proxyInfo){
            const delayMinutes = Number.isFinite(proxyInfo.delayMinutes) ? proxyInfo.delayMinutes : null;
            let amendedRaw = null;
            if (Number.isFinite(delayMinutes) && delayMinutes > 0 && baseDepartureRaw){
              const fallbackClock = computeRetardedTime(baseDepartureRaw, delayMinutes);
              if (fallbackClock) amendedRaw = fallbackClock.replace(':', '');
            }
            hafasRealtime = {
              source: 'proxy',
              delayMinutes,
              isCancelled: proxyInfo.cancelled === true,
              amendedDepartureRaw: amendedRaw,
              baseDepartureRaw,
              baseArrivalRaw,
              stopId: firstDeparture.stop_id,
              stopName,
              cause: null
            };
          }
         } catch (err){
          console.warn('[CFL][HAFAS] proxy lookup', err);
        }
      }

      if (!hafasRealtime){
        const hafasRecord = await fetchCflHafasDepartures({
          stopId: firstDeparture.stop_id,
          dateYmd: ymdDate,
          baseTimeHHMM: minutesToRawHHMM(firstDeparture.dep)
        });
        const departures = hafasRecord?.departures || [];
        const match = departures.find(dep => hafasMatchesCflNumber(dep, {
          numeroRaw,
          canonicalNumero: effectiveNumero,
          trainType: normalizedType
        }));
        if (match){
          const realtimeRaw = parseHafasRealtimeTime(match.rtTime || match.rtDepTime || match.rtDepartureTime);
          let delayFromField = null;
          if (typeof match.rtDelay !== 'undefined' && match.rtDelay !== null && match.rtDelay !== ''){
            const parsed = Number(match.rtDelay);
            if (Number.isFinite(parsed)) delayFromField = parsed;
          }
          if (Number.isFinite(delayFromField) && Math.abs(delayFromField) > 600){
            delayFromField = Math.round(delayFromField / 60);
          }
          let delayFromRealtime = null;
          if (realtimeRaw && baseDepartureRaw){
            const diff = dl(baseDepartureRaw, realtimeRaw);
            if (Number.isFinite(diff)) delayFromRealtime = diff;
          }
          let effectiveDelay = null;
          if (Number.isFinite(delayFromRealtime)){
            effectiveDelay = delayFromRealtime;
          } else if (Number.isFinite(delayFromField)){
            effectiveDelay = delayFromField;
          }
          if (Number.isFinite(effectiveDelay) && Math.abs(effectiveDelay) > 600){
            effectiveDelay = Math.round(effectiveDelay / 60);
          }
          let amendedRaw = realtimeRaw && realtimeRaw.length >= 4 ? realtimeRaw.slice(0, 4) : null;
          if (amendedRaw && baseDepartureRaw){
            const diff = dl(baseDepartureRaw, amendedRaw);
            if (!Number.isFinite(diff) || diff <= 0){
              amendedRaw = null;
            } else if (!Number.isFinite(effectiveDelay)){
              effectiveDelay = diff;
            }
          }
          if (!amendedRaw && Number.isFinite(effectiveDelay) && effectiveDelay > 0 && baseDepartureRaw){
            const fallbackClock = computeRetardedTime(baseDepartureRaw, effectiveDelay);
            if (fallbackClock) amendedRaw = fallbackClock.replace(':', '');
          }
          const status = String(match.status || '').toLowerCase();
          const isCancelled = match.cancelled === true || status === 'cancelled' || status === 'canceled' || status === 'deleted';
          const cause = extractHafasCause(match);
          hafasRealtime = {
            source: 'api',
            delayMinutes: Number.isFinite(effectiveDelay) ? effectiveDelay : null,
            isCancelled,
            amendedDepartureRaw: amendedRaw,
            baseDepartureRaw,
            baseArrivalRaw,
            stopId: firstDeparture.stop_id,
            stopName,
            cause: cause || null
          };
        }
      }
    }
  }
        if (hafasRealtime){
    const delayMinutes = Number.isFinite(hafasRealtime.delayMinutes) ? hafasRealtime.delayMinutes : null;
    const hasPositiveDelay = Number.isFinite(delayMinutes) && delayMinutes > 0;
    const isCancelled = hafasRealtime.isCancelled === true;
    const impactedEntry = {
      stop_point: { id: hafasRealtime.stopId, name: hafasRealtime.stopName },
      base_departure_time: hafasRealtime.baseDepartureRaw,
      base_arrival_time: hafasRealtime.baseArrivalRaw
    };
    if (isCancelled){
      impactedEntry.departure_status = 'deleted';
      impactedEntry.arrival_status = 'deleted';
      impactedEntry.stop_time_effect = 'deleted';
    } else if (hasPositiveDelay && hafasRealtime.amendedDepartureRaw){
      impactedEntry.amended_departure_time = hafasRealtime.amendedDepartureRaw;
      impactedEntry.delay_minutes = delayMinutes;
    } else if (hasPositiveDelay){
      impactedEntry.delay_minutes = delayMinutes;
    }
    impacted[hafasRealtime.stopId] = impactedEntry;

    if (isCancelled || hasPositiveDelay){
      for (const row of stopSeq){
        const stopId = row.stop_id;
        if (!stopId) continue;
        const stopMeta = CFL_GTFS.stopsById.get(stopId) || {};
        const displayName = cflFormatStopDisplayName(stopMeta.name || '');
        const baseDepRawAll = minutesToRawHHMM(row.dep);
        const baseArrRawAll = minutesToRawHHMM(row.arr);
        const existing = impacted[stopId] || {};
        if (!existing.stop_point){
          existing.stop_point = { id: stopId, name: displayName };
        }
        if (!existing.base_departure_time && baseDepRawAll){
          existing.base_departure_time = baseDepRawAll;
        }
        if (!existing.base_arrival_time && baseArrRawAll){
          existing.base_arrival_time = baseArrRawAll;
        }
        if (isCancelled){
         if (!existing.departure_status) existing.departure_status = 'deleted';
          if (!existing.arrival_status) existing.arrival_status = 'deleted';
          if (!existing.stop_time_effect) existing.stop_time_effect = 'deleted';
        } else if (hasPositiveDelay && Number.isFinite(delayMinutes) && delayMinutes > 0){
          existing.delay_minutes = delayMinutes;
          if (!existing.amended_departure_time && baseDepRawAll){
            const amendedDep = computeRetardedTime(baseDepRawAll, delayMinutes);
            if (amendedDep) existing.amended_departure_time = amendedDep.replace(':', '');
          }
          if (!existing.amended_arrival_time && baseArrRawAll){
            const amendedArr = computeRetardedTime(baseArrRawAll, delayMinutes);
            if (amendedArr) existing.amended_arrival_time = amendedArr.replace(':', '');
          }
        }
        impacted[stopId] = existing;
      }
    }
     const cause = hafasRealtime.cause;
    if (cause) disruptionCauses.push(cause);
    if (isCancelled){
      disruptions.push({
        severity: { effect: 'NO_SERVICE' },
        messages: cause ? [{ text: cause }] : []
      });
    } else if (hasPositiveDelay){
      disruptions.push({
        severity: { effect: 'SIGNIFICANT_DELAYS' },
        messages: cause ? [{ text: cause }] : []
      });
    }
  }

  return {
    train: {
      stop_times,
      display_informations: {
        commercial_mode: trainType ? `CFL ${trainType}` : 'CFL',
        physical_mode: 'CFL'
      }
    },
    impacted,
    newStart: null,
    newEnd: null,
    disruptions,
    disruptionCauses,
    tripId: chosenTripId,
    source: 'CFL',
    trainType: normalizedType,
    cflMeta: {
      trainType: normalizedType,
      routeId: tripMeta.route_id,
      numero: stripLeadingZerosForDisplay(numeroRaw),
      numeroRaw
    },
    displayLabel,
    selectionKey: canonicalKey
  };
}

let GTFS = {
  stops:null,
  stopTimes:null,
  trips:null,
  tripById:null,
  stopNameToId:null,
  allowedByDate:null,
  removedByDate:null
};

let GTFS_LOADING_PROMISE = null;
let GTFS_LOADED_ONCE = false;

const __yieldToBrowser = () => (typeof setTimeout === 'function')
  ? new Promise(resolve => setTimeout(resolve, 0))
  : Promise.resolve();

const GTFSLoadingUI = (() => {
  const overlayId = 'gtfsLoadingOverlay';
  let overlay = null;
  let textNode = null;
  let requests = 0;

  const ensureOverlay = () => {
    if (!overlay) {
      overlay = document.getElementById(overlayId);
      if (overlay) textNode = overlay.querySelector('.gtfs-loading-text');
    }
    return overlay;
  };

  const setVisible = visible => {
    const el = ensureOverlay();
    if (!el) return;
    el.classList.toggle('is-hidden', !visible);
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  };

  return {
    show(message) {
      if (!ensureOverlay()) return;
      requests++;
      if (message && textNode) textNode.textContent = message;
      setVisible(true);
    },
    hide() {
      if (!ensureOverlay()) return;
      requests = Math.max(0, requests - 1);
      if (requests === 0) setVisible(false);
    },
    message(message) {
      if (!ensureOverlay() || !message || !textNode) return;
      textNode.textContent = message;
    }
  };
})();

// Bases candidates (testées dans l’ordre)
const GTFS_BASES = [
  // Priorité au VPS : évite que index99 cherche stop_times.txt sur www.labetaillere.fr / GitHub.
  LB_ENDPOINTS.gtfsBase,
  'https://vps.labetaillere.fr/gtfs/static/',
  new URL('data/', location.href).href,
  new URL('Assistant-train/data/', location.href).href
];

function createCSVCollector(opt = {}){
  const keepColumns = Array.isArray(opt.keepColumns) && opt.keepColumns.length ? opt.keepColumns : null;
  const keptNames = keepColumns ? keepColumns.slice() : null;
  const filterRow = typeof opt.filterRow === 'function' ? opt.filterRow : null;
  const rows = [];
  let headers = null;
  let row = [];
  let field = '';
  let inQuotes = false;
  let pendingQuote = false;
  let lastCharCR = false;
  let firstChunk = true;
  let keptIndices = null;
  let newRows = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const initKeep = () => {
    if (!keptNames) return;
    keptIndices = keptNames.map(name => headers.indexOf(name));
  };

  const isMeaningfulRow = vals => {
    if (!vals.length) return false;
    if (vals.length === 1 && vals[0] === '') return false;
    for (let i = 0; i < vals.length; i++){
      if (vals[i] !== '') return true;
    }
    return false;
  };

  const pushRow = () => {
    const current = row;
    row = [];
    if (!current.length && !headers) return;
    if (!headers){
      if (!isMeaningfulRow(current)) return;
      headers = current.slice();
      if (headers[0] && headers[0].charCodeAt && headers[0].charCodeAt(0) === 0xFEFF){
        headers[0] = headers[0].slice(1);
      }
      initKeep();
      return;
    }
    if (!isMeaningfulRow(current)) return;
    const obj = {};
    if (keptNames){
      for (let i = 0; i < keptNames.length; i++){
        const idx = keptIndices ? keptIndices[i] : -1;
        if (idx >= 0){
          obj[keptNames[i]] = current[idx] ?? '';
        }
      }
    } else {
      for (let i = 0; i < headers.length; i++){
        obj[headers[i]] = current[i] ?? '';
      }
    }
    if (filterRow && !filterRow(obj)) return;
    rows.push(obj);
    newRows++;
  };

  const processChunk = chunk => {
    if (!chunk) return;
    if (firstChunk){
      firstChunk = false;
      if (chunk.charCodeAt && chunk.charCodeAt(0) === 0xFEFF){
        chunk = chunk.slice(1);
      }
    }
    for (let idx = 0; idx < chunk.length; idx++){
      let ch = chunk[idx];
      if (lastCharCR){
        lastCharCR = false;
        if (ch === '\n') continue;
      }
      if (pendingQuote){
        pendingQuote = false;
        if (ch === '"'){
          field += '"';
          continue;
        }
        inQuotes = false;
        idx--;
        continue;
      }
      if (inQuotes){
        if (ch === '"'){
          if (idx + 1 < chunk.length){
            if (chunk[idx + 1] === '"'){
              field += '"';
              idx++;
              continue;
            }
            inQuotes = false;
            continue;
          }
          pendingQuote = true;
          continue;
        }
        field += ch;
        continue;
      }
      if (ch === '"'){
        inQuotes = true;
        continue;
      }
      if (ch === ','){
        pushField();
        continue;
      }
      if (ch === '\r' || ch === '\n'){
        pushField();
        pushRow();
        if (ch === '\r') lastCharCR = true;
        continue;
      }
      field += ch;
    }
  };

  const finish = () => {
    if (pendingQuote){
      pendingQuote = false;
      inQuotes = false;
    }
    if (field.length || row.length){
      pushField();
    }
    if (row.length) pushRow();
    return rows;
  };
  return {
    processChunk,
    finish,
    drainNewRows(){ const v = newRows; newRows = 0; return v; }
  };
}

function parseCSV(text, opt = {}){
  const collector = createCSVCollector(opt);
  collector.processChunk(typeof text === 'string' ? text : String(text ?? ''));
  return collector.finish();
}

async function parseCSVFromStream(stream, opt = {}){
  const collector = createCSVCollector(opt);
  if (!stream || typeof stream.getReader !== 'function'){
    return collector.finish();
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let rowsSinceYield = 0;
  try {
    while (true){
      const { value, done } = await reader.read();
      if (value){
        const chunk = decoder.decode(value, { stream: !done });
        collector.processChunk(chunk);
        rowsSinceYield += collector.drainNewRows();
        if (rowsSinceYield >= 6000){
          rowsSinceYield = 0;
          await __yieldToBrowser();
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock?.();
  }
  const tail = decoder.decode();
  if (tail) collector.processChunk(tail);
  return collector.finish();
}

async function fetchAndParseCSV(filename, opt = {}){
  let lastErr;
  for (const base of GTFS_BASES){
    const url = base + filename;
    try {
      const resp = await fetch(url, { cache: 'default' });
      if (!resp.ok) throw new Error('HTTP '+resp.status+' on '+url);
      window.GTFS_STATIC_SOURCE = base; // debug
      if (resp.body && typeof resp.body.getReader === 'function' && typeof TextDecoder === 'function'){
        return await parseCSVFromStream(resp.body, opt);
      }
      const txt = await resp.text();
      return parseCSV(txt, opt);
    } catch(e){
      lastErr = e;
// essaie la base suivante
    }
  }
  throw lastErr || new Error('Impossible de charger '+filename);
}

async function ensureGTFSLoaded({ silent = false, allowHeavy = false } = {}){
  const liveModalOpen = !!document.getElementById('lbLiveModal')?.classList.contains('is-open');
  const manualAllowed = window.LB_ALLOW_HEAVY_GTFS === true;
  if (!allowHeavy && !manualAllowed && !liveModalOpen) {
    console.warn('[GTFS lourd] Chargement stop_times.txt bloqué au démarrage.');
    return;
  }
  if (GTFS.stops && GTFS.stopTimes && GTFS.trips && GTFS.tripById && GTFS.stopNameToId && GTFS.allowedByDate) return;
    if (GTFS_LOADING_PROMISE) {
    try {
      await GTFS_LOADING_PROMISE;
    } catch {
      // previous tentative failed; let the new caller retry below
    }
    if (GTFS.stops && GTFS.stopTimes && GTFS.trips && GTFS.tripById && GTFS.stopNameToId && GTFS.allowedByDate) return;
  }
 GTFS_LOADING_PROMISE = (async () => {
    const showOverlay = !silent && !GTFS_LOADED_ONCE;
    if (showOverlay) GTFSLoadingUI.show('Chargement des arrêts SNCF…');
    try {
      await __yieldToBrowser();

      let stops = await fetchAndParseCSV('stops.txt', {
        keepColumns: ['stop_id','stop_name','parent_station','stop_lat','stop_lon']
      });
      const relevantStopIds = computeRelevantStopIds(stops);
      stops = stops.filter(s => relevantStopIds.has(s.stop_id));
      await __yieldToBrowser();

      if (showOverlay) GTFSLoadingUI.message('Chargement des horaires détaillés…');
      const relevantTripIds = new Set();
      const stopTimes = await fetchAndParseCSV('stop_times.txt', {
        keepColumns: ['trip_id','arrival_time','departure_time','stop_id','stop_sequence'],
        filterRow: row => {
          if (!relevantStopIds.has(row.stop_id)) return false;
          if (row.trip_id) relevantTripIds.add(row.trip_id);
          return true;
        }
      });
      await __yieldToBrowser();

      if (showOverlay) GTFSLoadingUI.message('Chargement des trajets…');
      const relevantServiceIds = new Set();
      const trips = await fetchAndParseCSV('trips.txt', {
        keepColumns: ['trip_id','service_id','route_id','trip_short_name','trip_headsign'],
        filterRow: row => {
          if (!relevantTripIds.has(row.trip_id)) return false;
          if (row.service_id) relevantServiceIds.add(row.service_id);
          return true;
        }
      });
      await __yieldToBrowser();

      if (showOverlay) GTFSLoadingUI.message('Chargement du calendrier…');
      const calendarDates = await fetchAndParseCSV('calendar_dates.txt', {
        keepColumns: ['service_id','date','exception_type'],
        filterRow: row => !row.service_id || relevantServiceIds.has(row.service_id)
      });
      await __yieldToBrowser();

      if (showOverlay) GTFSLoadingUI.message('Organisation des données…');
      await __yieldToBrowser();

      const stopNameToId = new Map();
      stops.forEach(s => {
        if (s.stop_name && s.stop_id)
          if(!stopNameToId.has(s.stop_name)) stopNameToId.set(s.stop_name, s.stop_id);
      });

      const tripById = new Map();
      trips.forEach(t => {
        if (t.trip_id) tripById.set(t.trip_id, t);
      });

      // yyyymmdd -> Set(service_id) ajoutés ; et yyyymmdd -> Set(service_id) supprimés
      const allowedByDate = new Map();
      const removedByDate = new Map();
      calendarDates.forEach(row => {
        const ymd = row.date, serviceId = row.service_id, exc = Number(row.exception_type);
        if (!ymd || !serviceId) return;
        if (exc === 1) {
          if (!allowedByDate.has(ymd)) allowedByDate.set(ymd, new Set());
          allowedByDate.get(ymd).add(serviceId);
        } else if (exc === 2) {
          if (!removedByDate.has(ymd)) removedByDate.set(ymd, new Set());
          removedByDate.get(ymd).add(serviceId);
        }
      });

      GTFS = {
        stops,
        stopTimes,
        trips,
        tripById,
        stopNameToId,
        allowedByDate,
        removedByDate,
        relevantStopIds,
        relevantTripIds,
        relevantServiceIds
      };
      GTFS_LOADED_ONCE = true;
    } finally {
      if (showOverlay) GTFSLoadingUI.hide();
      }
  })();

  try {
    await GTFS_LOADING_PROMISE;
  } finally {
    GTFS_LOADING_PROMISE = null;
  }
}

/************  GROUPES DE STOPS PAR GARE (stop_name/parent_station)  ************/
function buildStationGroups(){
  if (GTFS.nameToIds && GTFS.idToName) return;
  // Protection anti-null si ça n'a pas fini de charger
  if (!Array.isArray(GTFS.stops)) return;

  const idToStop = new Map(GTFS.stops.map(s => [s.stop_id, s]));
  const nameToIds = new Map();
  const parentToIds = new Map();
  const idToName = new Map();

  for (const s of GTFS.stops){
    const name=(s.stop_name||'').trim(); if(!name) continue;
    if(!nameToIds.has(name)) nameToIds.set(name,new Set());
    nameToIds.get(name).add(s.stop_id);
    idToName.set(s.stop_id, name);
    if (s.parent_station){
      if(!parentToIds.has(s.parent_station)) parentToIds.set(s.parent_station,new Set());
      parentToIds.get(s.parent_station).add(s.stop_id);
    }
  }

  const nameToIdsMerged = new Map();
  for (const [name, ids] of nameToIds.entries()){
    const anyId=[...ids][0]; const parent=idToStop.get(anyId)?.parent_station;
    if (parent && parentToIds.has(parent)) nameToIdsMerged.set(name, new Set(parentToIds.get(parent)));
    else nameToIdsMerged.set(name, ids);
  }

  GTFS.nameToIds = nameToIdsMerged;
  GTFS.idToName  = idToName;
  GTFS.idToStop  = idToStop;
}

function getIdsForName(name){
  buildStationGroups();
  const ids = GTFS.nameToIds?.get(name);
  if (ids && ids.size) return ids;
  const lone = GTFS.stopNameToId?.get(name);
  return lone ? new Set([lone]) : new Set();
}

/************  INDEXES POUR RECHERCHE DE CORRESPONDANCES  ************/
function ensureTransferIndexesBuilt(){
  if (GTFS._stopTimesByTripSec && GTFS._depsByStop) return;
  if (!Array.isArray(GTFS.stopTimes)) return; // protection

  const byTripSec = new Map();
  for (const st of GTFS.stopTimes){
    if(!byTripSec.has(st.trip_id)) byTripSec.set(st.trip_id, []);
    byTripSec.get(st.trip_id).push({
      stop_id: st.stop_id,
      arrS: toSec(st.arrival_time),
      depS: toSec(st.departure_time),
      seq: Number(st.stop_sequence)
    });
  }
  for (const arr of byTripSec.values()) arr.sort((a,b)=>a.seq-b.seq);

  const depsByStop = new Map();
  byTripSec.forEach((sts, trip_id)=>{
    for (const r of sts){
      if (r.depS==null) continue;
      if (!depsByStop.has(r.stop_id)) depsByStop.set(r.stop_id, []);
      depsByStop.get(r.stop_id).push({ trip_id, depS: r.depS, seq: r.seq });
    }
  });
  for (const list of depsByStop.values()) list.sort((a,b)=>a.depS-b.depS);

  GTFS._stopTimesByTripSec = byTripSec;
  GTFS._depsByStop = depsByStop;
  GTFS._tripById = GTFS.tripById;
}

function mergeDeparturesForIds(idsSet){
  const arr=[]; idsSet.forEach(id=>{ const l=GTFS._depsByStop.get(id); if(l&&l.length) arr.push(...l); });
  arr.sort((a,b)=>a.depS-b.depS); return arr;
}

/************  CALENDRIER (calendar_dates)  ************/
function serviceActiveForDate(trip_id, ymd){
  if (!trip_id || !ymd) return false; // exige une date
  const t = GTFS.tripById?.get(trip_id); if(!t) return false;
  const svc = t.service_id; if(!svc) return false;

  // Si on a des données de dates : on est STRICT
  if (GTFS.allowedByDate && GTFS.allowedByDate.size > 0) {
    const allowedSet = GTFS.allowedByDate.get(ymd);
    if (allowedSet) return allowedSet.has(svc); // présent ce jour
    return false; // pas listé ce jour => on N'AFFICHE PAS
  }

  // Fallback ultra-rare si calendar_dates est vide: on laisse passer pour ne pas tout cacher
  return true;
}

function ensureStopTimesByTripIndex(){
  if (GTFS._stopTimesByTrip) return;
  if (!Array.isArray(GTFS.stopTimes)) return;
  const map = new Map();
  for (const row of GTFS.stopTimes){
    if (!row || !row.trip_id) continue;
    if (!map.has(row.trip_id)) map.set(row.trip_id, []);
    map.get(row.trip_id).push(row);
  }
  map.forEach(list => list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)));
  GTFS._stopTimesByTrip = map;
}

function ensureTripsByNumberIndex(){
  if (GTFS._tripsByNumber) return;
  if (!Array.isArray(GTFS.trips)) return;
  const index = new Map();
  for (const trip of GTFS.trips){
    if (!trip) continue;
    const numbers = new Set();
    const headsign = extractTrainNumber(trip.trip_headsign || '');
    const shortName = extractTrainNumber(trip.trip_short_name || '');
    const fromId = extractTrainNumber(trip.trip_id || '');
    if (headsign) numbers.add(headsign);
    if (shortName) numbers.add(shortName);
    if (fromId) numbers.add(fromId);
    numbers.forEach(num => {
      if (!index.has(num)) index.set(num, new Set());
      index.get(num).add(trip.trip_id);
    });
  }
  const normalized = new Map();
  index.forEach((set, num) => normalized.set(num, Array.from(set)));
  GTFS._tripsByNumber = normalized;
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch] || ch);
}

async function buildGtfsFallbackResult(number, { ymd } = {}){
  const normalized = extractTrainNumber(number);
  if (!normalized) return null;
  const targetYmd = (ymd && /^\d{8}$/.test(ymd)) ? ymd : null;
  try {
    await ensureGTFSLoaded({ silent: true });
  } catch (err) {
    console.error('[GTFS] Impossible de charger les données statiques pour le fallback', err);
    return null;
  }

  ensureTripsByNumberIndex();
  ensureStopTimesByTripIndex();
  buildStationGroups();

  const index = GTFS._tripsByNumber;
  if (!index) return null;
  const tripIds = index.get(normalized);
  if (!tripIds || !tripIds.length) return null;
  const uniqueTripIds = Array.from(new Set(tripIds));

  let chosenTripId = null;
  if (targetYmd) {
    chosenTripId = uniqueTripIds.find(id => serviceActiveForDate(id, targetYmd));
  }
  if (!chosenTripId) {
    chosenTripId = uniqueTripIds[0];
  }
  if (!chosenTripId) return null;

  const tripData = GTFS.tripById?.get(chosenTripId);
  const stopRows = GTFS._stopTimesByTrip?.get(chosenTripId);
  if (!tripData || !stopRows || !stopRows.length) return null;

  const idToStop = GTFS.idToStop || new Map((GTFS.stops || []).map(s => [s.stop_id, s]));
  const toHHMMRaw = value => value ? String(value).replace(/:/g, '') : null;
  const stopTimes = stopRows.map(st => {
    const stop = idToStop.get(st.stop_id) || {};
    return {
      stop_point: {
        id: st.stop_id,
        name: stop.stop_name || st.stop_id
      },
      arrival_time: toHHMMRaw(st.arrival_time),
      departure_time: toHHMMRaw(st.departure_time)
    };
  });

  if (!stopTimes.length) return null;

  return {
    train: {
      stop_times: stopTimes,
      display_informations: {
        commercial_mode: 'GTFS statique',
        physical_mode: 'GTFS statique'
      },
      _gtfsFallback: true
    },
    impacted: {},
    newStart: null,
    newEnd: null,
    disruptions: [],
    disruptionCauses: [],
    gtfsFallback: true,
    tripId: chosenTripId
  };
}

function formatSncfError(err){
  if (!err) return ' SNCF indisponible';
  const status = Number(err.status);
  const statusText = typeof err.statusText === 'string' ? err.statusText.trim() : '';
  if (status === 429) return 'Limite de requêtes  SNCF atteinte (HTTP 429)';
  if (status === 503) return 'Service  SNCF indisponible (HTTP 503)';
  if (status === 502) return 'Passerelle  SNCF en erreur (HTTP 502)';
  if (status === 500) return 'Erreur interne côté  SNCF (HTTP 500)';
  if (status && statusText) return `Réponse  SNCF inattendue (HTTP ${status} ${statusText})`;
  if (status) return `Réponse API SNCF inattendue (HTTP ${status})`;
  const apiMessage = err?.responseJSON?.message || err?.responseText;
  if (typeof apiMessage === 'string' && apiMessage.trim()) {
    return `API SNCF indisponible (${apiMessage.trim()})`;
  }
  if (err.message) return `API SNCF indisponible (${err.message})`;
  return 'API SNCF indisponible';
}

/************  RECHERCHE ITINÉRAIRES 1 CORRESPONDANCE (jamais dans le même train)  ************/
function findOneTransferItineraries({
  originIds, destIds,
  t0Min, t1Min,
  minTransferMin = 5,
  maxTransferMin = 45,
  ymd,
  allowedInterchanges = null,
  maxResults = 40
}){
  ensureTransferIndexesBuilt(); buildStationGroups();

  const depStart = t0Min * 60;
  const depEnd   = t1Min * 60;
  const minWait  = minTransferMin * 60;
  const maxWait  = Math.max(minTransferMin, maxTransferMin) * 60; // borne haute
  const out = [];

  // si on force une gare d’échange (ex: Metz)
  let interIds = allowedInterchanges;
  if (!interIds && FORCE_VIA_METZ){
    interIds = getIdsForName('Metz');
  }
  const depsFromInter = (interIds && interIds.size)
    ? dedupTripSeq(mergeDeparturesForIds(interIds))
    : null;

  const depList = dedupTripSeq(mergeDeparturesForIds(originIds));

  // binaire: 1er départ >= fenêtre
  let lo=0, hi=depList.length-1, startIdx=depList.length;
  while (lo<=hi){
    const mid=(lo+hi)>>1;
    if (depList[mid].depS >= depStart){ startIdx=mid; hi=mid-1; }
    else lo=mid+1;
  }

  const processedFirstLeg = new Set(); // une seule correspondance par premier train

  for (let i=startIdx; i<depList.length; i++){
    const d1 = depList[i];
    if (d1.depS > depEnd) break;

    const trip1 = d1.trip_id;
    if (!serviceActiveForDate(trip1, ymd)) continue;

    const st1 = GTFS._stopTimesByTripSec.get(trip1); if (!st1) continue;
    const idxOrigin = st1.findIndex(r => r.seq === d1.seq); if (idxOrigin < 0) continue;

    const dep1S = st1[idxOrigin].depS;
    if (dep1S < depStart || dep1S > depEnd) continue;

    // 🚫 0) Si ce premier train va déjà jusqu'à la destination -> pas de correspondance
    const reachesDestDirect = st1.slice(idxOrigin+1).some(r => destIds.has(r.stop_id));
    if (reachesDestDirect) continue;

    const firstKey = `${trip1}|${dep1S}`;
    if (processedFirstLeg.has(firstKey)) continue;

    // numéro lisible du 1er train
    const num1 = extractMainlineNumero(GTFS._tripById.get(trip1)?.trip_short_name)
      || extractMainlineNumero(GTFS._tripById.get(trip1)?.trip_headsign)
      || extractMainlineNumero(trip1);
    if (!num1) continue;

    let best = null;

    if (depsFromInter && interIds && interIds.size){
      // 1) on cherche une arrivée à l’inter (ex: Metz)
      let inter = null;
      for (let j = idxOrigin+1; j < st1.length; j++){
        const r = st1[j];
        if (interIds.has(r.stop_id) && r.arrS != null){ inter = r; break; }
      }
      if (!inter) continue;

      const earliest = inter.arrS + minWait;
      const latest   = inter.arrS + maxWait;

      // binaire: 2e départ >= earliest
      let lo2=0, hi2=depsFromInter.length-1, start2=depsFromInter.length;
      while (lo2<=hi2){
        const mid=(lo2+hi2)>>1;
        if (depsFromInter[mid].depS >= earliest){ start2=mid; hi2=mid-1; }
        else lo2=mid+1;
      }

      for (let k = start2; k < depsFromInter.length; k++){
        const d2 = depsFromInter[k];
        if (d2.depS > latest) break;               // ❗ respecte délai max

        const trip2 = d2.trip_id;

        // 🚫 1) pas de correspondance sur le même voyage (trip_id)
        if (trip2 === trip1) continue;
        if (!serviceActiveForDate(trip2, ymd)) continue;

        const st2 = GTFS._stopTimesByTripSec.get(trip2); if (!st2) continue;
        const idxInter2 = st2.findIndex(r => r.seq === d2.seq); if (idxInter2 < 0) continue;

        const toDest = st2.slice(idxInter2+1).find(r => destIds.has(r.stop_id));
        if (!toDest) continue;

        // 🚫 2) pas le même numéro commercial
        const num2 = extractMainlineNumero(GTFS._tripById.get(trip2)?.trip_short_name)
          || extractMainlineNumero(GTFS._tripById.get(trip2)?.trip_headsign)
          || extractMainlineNumero(trip2);
        if (!num2 || num1 === num2) continue;

        best = {
          viaId:   inter.stop_id,
          viaName: GTFS.idToName.get(inter.stop_id) || 'Metz',
          num1, num2,
          dep1:    toHHMM(dep1S),
          arr1:    toHHMM(inter.arrS),
          dep2:    toHHMM(st2[idxInter2].depS),
          arr2:    toHHMM(toDest.arrS),
          waitMin: Math.max(0, Math.round((st2[idxInter2].depS - inter.arrS)/60)),
          durMin:  Math.max(0, Math.round((toDest.arrS - dep1S)/60)),
          trip1,
          trip2,
          dep1S,
          arr2S: toDest.arrS
        };
        break; // on ne garde que la plus proche
      }
    } else {
      // 2) fallback "toutes gares" (mêmes garde-fous + fenêtre min/max)
      for (let j=idxOrigin+1; j<st1.length && !best; j++){
        const interJ = st1[j]; if (interJ.arrS == null) continue;

        const interGroup = getIdsForName(GTFS.idToName.get(interJ.stop_id) || '');
        const deps2 = dedupTripSeq(mergeDeparturesForIds(interGroup));

        const earliest = interJ.arrS + minWait;
        const latest   = interJ.arrS + maxWait;

        // binaire: départ2 >= earliest
        let lo2=0, hi2=deps2.length-1, start2=deps2.length;
        while (lo2<=hi2){
          const mid=(lo2+hi2)>>1;
          if (deps2[mid].depS >= earliest){ start2=mid; hi2=mid-1; }
          else lo2=mid+1;
        }

        for (let k=start2; k<deps2.length; k++){
          const d2 = deps2[k];
          if (d2.depS > latest) break;             // ❗ respecte délai max

          const trip2 = d2.trip_id;

          // 🚫 pas le même voyage
          if (trip2 === trip1) continue;
          if (!serviceActiveForDate(trip2, ymd)) continue;

          const st2 = GTFS._stopTimesByTripSec.get(trip2); if (!st2) continue;
          const idxInter2 = st2.findIndex(r => r.seq === d2.seq); if (idxInter2 < 0) continue;

          const toDest = st2.slice(idxInter2+1).find(r => destIds.has(r.stop_id));
          if (!toDest) continue;

          // 🚫 pas le même numéro commercial
          const num2 = extractMainlineNumero(GTFS._tripById.get(trip2)?.trip_short_name)
            || extractMainlineNumero(GTFS._tripById.get(trip2)?.trip_headsign)
            || extractMainlineNumero(trip2);
          if (!num2 || num1 === num2) continue;

          best = {
            viaId:   interJ.stop_id,
            viaName: GTFS.idToName.get(interJ.stop_id) || '',
            num1, num2,
            dep1:    toHHMM(dep1S),
            arr1:    toHHMM(interJ.arrS),
            dep2:    toHHMM(st2[idxInter2].depS),
            arr2:    toHHMM(toDest.arrS),
            waitMin: Math.max(0, Math.round((st2[idxInter2].depS - interJ.arrS)/60)),
            durMin:  Math.max(0, Math.round((toDest.arrS - dep1S)/60)),
            trip1,
            trip2,
            dep1S,
            arr2S: toDest.arrS
          };
          break;
        }
      }
    }

    if (best){
      processedFirstLeg.add(firstKey);
      out.push(best);
      if (out.length >= maxResults) break;
    }
  }

  // dédoublonnage final + tri
  const cleaned = uniqTransfers(out);
  cleaned.sort((a,b)=> a.arr2.localeCompare(b.arr2) || (a.durMin - b.durMin));
  return cleaned;
}


/************  RENDU DES CARTES (DIRECTS + TRANSFERS)  ************/
function renderTransferCards(transfers, startName, endName){
  if (!transfers || !transfers.length) return '';
  transfers = transfers.filter(t => t.num1 && t.num2 && t.num1 !== t.num2);
  if (!transfers.length) return '';
  return `
  <div class="chips-panel" style="margin-top:12px">
    <div class="chips-header">
      <div style="font-weight:700">Itinéraires avec 1 correspondance</div>
      <div class="chips-count">${transfers.length}</div>
    </div>
    <div class="chips-wrap">
      ${transfers.map(t=>{
        const label1 = t.label1 || `${t.num1}`;
        const label2 = t.label2 || `${t.num2}`;
        TRAIN_LABEL_REGISTRY.set(t.num1, label1);
        TRAIN_LABEL_REGISTRY.set(t.num2, label2);
        const cls = ['chip','transfer'];
        if (t.source1 === 'CFL' || t.source2 === 'CFL') cls.push('cfl-train');
        const label1Class = `train-label${t.source1 === 'CFL' ? ' cfl' : ''}`;
        const label2Class = `train-label${t.source2 === 'CFL' ? ' cfl' : ''}`;
        const waitTxt = Number.isFinite(t.waitMin) ? `${t.waitMin} min` : '—';
        const durTxt = Number.isFinite(t.durMin) ? `${t.durMin} min` : '—';
        return `
        <div class="${cls.join(' ')}" data-num1="${escapeHtml(t.num1)}" data-num2="${escapeHtml(t.num2)}">
          <div style="display:flex;flex-direction:column;gap:2px">
            <div><b>${escapeHtml(startName)}</b> ${escapeHtml(t.dep1 || '?')} → <b>${escapeHtml(t.viaName || '')}</b> ${escapeHtml(t.arr1 || '?')} — <span class="${label1Class}">${escapeHtml(label1)}</span></div>
            <div>Attente: ${escapeHtml(waitTxt)}</div>
            <div><b>${escapeHtml(t.viaName || '')}</b> ${escapeHtml(t.dep2 || '?')} → <b>${escapeHtml(endName)}</b> ${escapeHtml(t.arr2 || '?')} — <span class="${label2Class}">${escapeHtml(label2)}</span></div>
            <div style="opacity:.8">Durée totale: ${escapeHtml(durTxt)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="chips-footer">
      <small>Cliquer une carte “correspondance” ajoute/retire ses 2 trains à la sélection.</small>
    </div>
  </div>`;
}

/************  RECHERCHE OD (DIRECTS + CORRESPONDANCES)  ************/

/************  API VPS RECHERCHE STATIQUE (remplace le calcul GTFS lourd côté navigateur)  ************/
const LB_SEARCH_STATIC_API_URL = 'https://vps.labetaillere.fr/api/search-static/';

function lbVpsSource(row){
  const src = String(row?.sourceLabel || row?.source || '').trim().toUpperCase();
  return src === 'CFL' ? 'CFL' : 'SNCF';
}

function lbNormPlaceForMerge(value){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(gare|ville|centrale|station)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function lbSamePlaceForMerge(a, b){
  const x = lbNormPlaceForMerge(a);
  const y = lbNormPlaceForMerge(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function lbTrainMergeKey(value){
  const raw0 = String(value || '').trim().replace(/^CFL\s+/i, '');
  const raw = (typeof canonicalizeCflNumero === 'function') ? canonicalizeCflNumero(raw0) : raw0.replace(/^0+/, '');
  if (!raw) return '';

  // Cas des numéros CFL/SNCF inversés sur les TER 885xx :
  // 88502≈88503, 88512≈88513, 88514≈88515, 88530≈88531, etc.
  // On groupe seulement pour détecter les doublons ; l'affichage garde ensuite le numéro SNCF prioritaire.
  if (/^885\d{2}$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return `885PAIR-${Math.floor(n / 2)}`;
  }

  const equiv = (typeof getEquivalentCflNumeros === 'function') ? getEquivalentCflNumeros(raw) : [];
  if (equiv && equiv.length) {
    return equiv.map(v => canonicalizeCflNumero(v)).filter(Boolean).sort()[0] || raw;
  }
  return raw;
}

function lbArrBucket(min){
  const n = Number(min);
  return Number.isFinite(n) ? Math.round(n / 5) * 5 : '';
}

function lbStationPriority(name){
  const k = lbNormPlaceForMerge(name);
  if (k.includes('metz')) return 0;
  if (k.includes('thionville')) return 1;
  if (k.includes('bettembourg')) return 2;
  if (k.includes('luxembourg')) return 3;
  if (k.includes('howald')) return 4;
  if (k.includes('hagondange')) return 5;
  if (k.includes('uckange')) return 6;
  if (k.includes('pagny')) return 7;
  if (k.includes('pont a mousson')) return 8;
  return 99;
}

function lbCflCommercialPrefix(row){
  const probes = [
    row?.trainType,
    row?.routeShortName,
    row?.route_short_name,
    row?.routeLabel,
    row?.line,
    row?.product,
    row?.category,
    row?.displayLabel,
    row?.headsign
  ];
  for (const v of probes){
    const m = String(v || '').trim().match(/\b(RB|RE|IC)\b/i);
    if (m) return m[1].toUpperCase();
  }
  return '';
}

function lbVpsCflNumero(row){
  const raw = [
    row?.numero,
    row?.selectionKey,
    row?.displayLabel,
    row?.train,
    row?.tripShortName,
    row?.trip_short_name
  ].map(v => String(v || '').trim()).find(Boolean) || '';
  const match = raw.match(/(?:RB|RE|IC)?\s*0*(\d{3,6})/i);
  return match ? match[1] : canonicalizeCflNumero(raw.replace(/^(RB|RE|IC|CFL)[\s-]*/i, ''));
}

function lbVpsSelectionKey(row, source){
  if (source === 'CFL') {
    const numero = lbVpsCflNumero(row);
    return numero ? `CFL-${numero}` : '';
  }
  return canonicalizeCflNumero(row?.selectionKey || row?.numero || row?.train || '');
}

function lbCleanDisplayLabel(label, numero, source, row){
  const raw = String(label || '').trim();
  const num = String(numero || '').trim().replace(/^CFL-/, '');

  // VPS CFL : affichage public = RB6890 / RE6816 / ICxxxx, mais clé interne = CFL-6890.
  const commercialPrefix = source === 'CFL' ? lbCflCommercialPrefix({ ...(row || {}), displayLabel: raw }) : '';
  if (source === 'CFL') {
    const typedRaw = raw.match(/^(RB|RE|IC)\s*0*(\d{3,6})$/i);
    if (typedRaw) return `${typedRaw[1].toUpperCase()}${typedRaw[2]}`;
    if (commercialPrefix && num) return `${commercialPrefix}${stripLeadingZerosForDisplay(num)}`;
    if (/^CFL\s*\d+$/i.test(raw)) return stripLeadingZerosForDisplay(num || raw.replace(/^CFL\s*/i, ''));
    if (/^\d+$/.test(raw)) return commercialPrefix ? `${commercialPrefix}${stripLeadingZerosForDisplay(raw)}` : stripLeadingZerosForDisplay(raw);
  }

  return raw || num;
}

function lbVpsDirectToProposal(row){
  const source = lbVpsSource(row);
  const numero = source === 'CFL'
    ? lbVpsCflNumero(row)
    : canonicalizeCflNumero(row?.numero || row?.train || row?.selectionKey || '');
  const selectionKey = lbVpsSelectionKey(row, source) || numero;
  const label = lbCleanDisplayLabel(row?.displayLabel, numero, source, row);
  if (source === 'CFL') {
    registerCflTrainType(selectionKey, row?.trainType || row?.routeShortName || row?.route_short_name || lbCflCommercialPrefix(row));
  }
  return {
    ...row,
    source,
    sourceLabel: source,
    numero,
    train: numero,
    selectionKey,
    displayLabel: label,
    dep: row?.dep || '',
    arr: row?.arr || '',
    depMin: row?.depMin,
    arrMin: row?.arrMin
  };
}

function lbDedupeVpsDirects(rows){
  const out = [];
  for (const r of rows || []){
    const idx = out.findIndex(x =>
      lbSamePlaceForMerge(x.from, r.from) &&
      lbSamePlaceForMerge(x.to, r.to) &&
      Number(x.depMin) === Number(r.depMin) &&
      Math.abs(Number(x.arrMin ?? 0) - Number(r.arrMin ?? 0)) <= 5 &&
      lbTrainMergeKey(x.numero || x.train) === lbTrainMergeKey(r.numero || r.train)
    );
    if (idx === -1){
      out.push(r);
      continue;
    }
    const old = out[idx];
    // Priorité SNCF : on masque le doublon CFL mais on garde l'info en interne.
    if (old.source !== 'SNCF' && r.source === 'SNCF') {
      r.hiddenEquivalentTrain = old.numero || old.train || '';
      r.mergedFrom = Array.from(new Set([old.source, r.source].filter(Boolean)));
      out[idx] = r;
    } else {
      old.hiddenEquivalentTrain = r.numero || r.train || old.hiddenEquivalentTrain || '';
      old.mergedFrom = Array.from(new Set([...(old.mergedFrom || [old.source]), r.source].filter(Boolean)));
    }
  }
  return out.sort((a,b)=>{
    if (a.depMin != null && b.depMin != null && a.depMin !== b.depMin) return a.depMin - b.depMin;
    return (a.displayLabel || a.numero || '').localeCompare(b.displayLabel || b.numero || '');
  });
}

function lbVpsTransferToProposal(row){
  const first = row?.first || {};
  const second = row?.second || {};
  const source1 = lbVpsSource(first);
  const source2 = lbVpsSource(second);
  const firstNumero = source1 === 'CFL' ? lbVpsCflNumero(first) : canonicalizeCflNumero(first.numero || first.train || '');
  const secondNumero = source2 === 'CFL' ? lbVpsCflNumero(second) : canonicalizeCflNumero(second.numero || second.train || '');
  const num1 = source1 === 'CFL' ? lbVpsSelectionKey(first, source1) : firstNumero;
  const num2 = source2 === 'CFL' ? lbVpsSelectionKey(second, source2) : secondNumero;
  const label1 = lbCleanDisplayLabel(first.displayLabel, firstNumero, source1, first);
  const label2 = lbCleanDisplayLabel(second.displayLabel, secondNumero, source2, second);
  if (source1 === 'CFL') registerCflTrainType(num1, first.trainType || first.routeShortName || first.route_short_name || lbCflCommercialPrefix(first));
  if (source2 === 'CFL') registerCflTrainType(num2, second.trainType || second.routeShortName || second.route_short_name || lbCflCommercialPrefix(second));
  return {
    viaName: row?.transferStation || first.to || second.from || '',
    num1,
    num2,
    label1,
    label2,
    source1,
    source2,
    from1: first.from || '',
    to1: first.to || '',
    from2: second.from || '',
    to2: second.to || '',
    dep1: first.dep || row?.dep || '',
    arr1: first.arr || '',
    dep2: second.dep || '',
    arr2: second.arr || row?.arr || '',
    waitMin: Number.isFinite(Number(row?.waitMin)) ? Number(row.waitMin) : null,
    durMin: Number.isFinite(Number(row?.durationMin ?? row?.totalDurationMin)) ? Number(row.durationMin ?? row.totalDurationMin) : null,
    trip1: first.tripId || '',
    trip2: second.tripId || '',
    dep1Min: row?.depMin ?? first.depMin,
    arr1Min: first.arrMin,
    dep2Min: second.depMin,
    arr2Min: row?.arrMin ?? second.arrMin,
    _stationPriority: lbStationPriority(row?.transferStation || first.to || second.from || '')
  };
}

function lbTransferSourceRank(t){
  let rank = 0;
  if (t.source1 === 'SNCF') rank -= 2;
  if (t.source2 === 'SNCF') rank -= 1;
  return rank;
}

function lbDedupeVpsTransfers(rows){
  const out = [];
  for (const t of rows || []){
    if (!t.num1 || !t.num2 || t.num1 === t.num2) continue;

    const key1 = lbTrainMergeKey(t.num1);
    const key2 = lbTrainMergeKey(t.num2);

    // Anti-correspondance idiote : le second train partait déjà de la gare de départ avant le pivot.
    // Exemple Thionville -> Bettembourg puis le même train Bettembourg -> Howald.
    if (lbSamePlaceForMerge(t.from1, t.from2) && Number(t.dep2Min) <= Number(t.arr1Min ?? t.dep2Min)) continue;

    const idx = out.findIndex(x =>
      lbTrainMergeKey(x.num1) === key1 &&
      lbTrainMergeKey(x.num2) === key2 &&
      String(x.dep1 || '') === String(t.dep1 || '') &&
      String(x.arr2 || '') === String(t.arr2 || '') &&
      Math.abs(Number(x.arr1Min ?? 0) - Number(t.arr1Min ?? 0)) <= 5 &&
      Math.abs(Number(x.dep2Min ?? 0) - Number(t.dep2Min ?? 0)) <= 5
    );
    if (idx === -1){
      out.push(t);
      continue;
    }

    const old = out[idx];
    const oldScore = (old._stationPriority ?? 99) * 10 + lbTransferSourceRank(old);
    const newScore = (t._stationPriority ?? 99) * 10 + lbTransferSourceRank(t);
    if (newScore < oldScore) out[idx] = t;
  }
  return out.sort((a,b)=>{
    const depCmp = String(a.dep1 || '').localeCompare(String(b.dep1 || ''));
    if (depCmp) return depCmp;
    const durCmp = (a.durMin ?? 99999) - (b.durMin ?? 99999);
    if (durCmp) return durCmp;
    return (a.waitMin ?? 99999) - (b.waitMin ?? 99999);
  });
}

async function computeItineraryProposals({
  startName,
  endName,
  fromHHMM,
  toHHMM,
  allowTransfers = true,
  ymd,
  includeCfl = false
} = {}){
  const start = (startName || '').trim();
  const end   = (endName || '').trim();
  if (!start || !end) throw new Error('missing-stations');

  const fromMin = hhmmInputToMin(fromHHMM);
  const toMin   = hhmmInputToMin(toHHMM);
  if (fromMin == null || toMin == null) throw new Error('invalid-range');

  const targetYMD = ymd || dateInputToYMD($('#trainDate').val()) || todayYMDLux().replace(/-/g,'');
  const minTransferMin = Math.max(1, Number(document.getElementById('minTransfer')?.value || 5));
  const maxTransferMin = Math.max(minTransferMin, Number(document.getElementById('maxTransfer')?.value || 45));

  const params = new URLSearchParams({
    from: start,
    to: end,
    date: targetYMD,
    start: fromHHMM,
    end: toHHMM,
    includeCfl: includeCfl ? '1' : '0',
    allowTransfers: allowTransfers ? '1' : '0',
    minTransfer: String(minTransferMin),
    maxTransfer: String(maxTransferMin),
    transferLimit: '40'
  });

  const response = await fetch(`${LB_SEARCH_STATIC_API_URL}?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`vps-search-${response.status}`);
  const payload = await response.json();
  if (!payload || payload.ok === false) throw new Error(payload?.error || 'vps-search-error');

  const rawDirects = (payload.directs || payload.results || []).map(lbVpsDirectToProposal);
  const rawTransfers = (payload.transfers || []).map(lbVpsTransferToProposal);

  const directs = lbDedupeVpsDirects(rawDirects);
  const transfers = lbDedupeVpsTransfers(rawTransfers);
  return { directs, transfers };
}

async function proposerTrainsOD(eventOrOptions){
  let evt = null;
  let opts = {};
  if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
    eventOrOptions.preventDefault();
    evt = eventOrOptions;
  } else if (eventOrOptions && typeof eventOrOptions === 'object') {
    opts = eventOrOptions;
  }

  const cont = document.getElementById('propositions');
  const section = document.getElementById('proposalSection');
  if (!cont) return;

  const trigger = opts.trigger || evt?.currentTarget || evt?.target || document.getElementById('btnProposer');

  if (section) {
    section.hidden = false;
    section.classList.remove('is-empty');
  }
  cont.innerHTML = '<div class="chips-panel"><p>Recherche…</p></div>';

  const shouldOpenModal = opts.openModal != null ? opts.openModal : true;
  if (typeof openSelectionModal === 'function' && shouldOpenModal) {
    openSelectionModal({ trigger, focus: opts.focus ?? false });
  }

  if (typeof selectedTrains !== 'undefined') {
    selectedTrains.clear();
    updateSelectionUI?.();
  }
  TRAIN_LABEL_REGISTRY.clear();

  const startName = opts.startName ?? ($('#startStation').val() || '');
  const endName   = opts.endName   ?? ($('#endStation').val()   || '');
  const fromHHMM  = opts.fromHHMM  ?? $('#timeFrom').val();
  const toHHMM    = opts.toHHMM    ?? $('#timeTo').val();
  const allowTransfers = opts.allowTransfers != null
    ? opts.allowTransfers
    : (document.getElementById('allowTransfer')?.checked ?? true);
  const includeCfl = opts.includeCfl != null
    ? opts.includeCfl
    : (document.getElementById('includeCFLStatic')?.checked ?? false);

  if (!startName || !endName) {
    cont.innerHTML = '<div class="chips-panel">Choisis <b>De</b> et <b>À</b>.</div>';
    if (section) section.classList.add('is-empty');
    proposerTrainsOD.lastRequest = null;
    return;
  }
  if (hhmmInputToMin(fromHHMM) == null || hhmmInputToMin(toHHMM) == null) {
    cont.innerHTML = '<div class="chips-panel">Plage horaire invalide.</div>';
    if (section) section.classList.add('is-empty');
    proposerTrainsOD.lastRequest = null;
    return;
  }

  let proposals;
  try {
    proposals = await computeItineraryProposals({
      startName,
      endName,
      fromHHMM,
      toHHMM,
      allowTransfers,
      includeCfl
    });
  } catch (err) {
    if (err && (err.message === 'missing-stations' || err.message === 'invalid-range')) {
      cont.innerHTML = '<div class="chips-panel">Paramètres incomplets.</div>';
    } else {
      console.error(err);
      cont.innerHTML = '<div class="chips-panel">Erreur GTFS.</div>';
    }
    if (section) section.classList.add('is-empty');
    proposerTrainsOD.lastRequest = null;
    return;
  }

  const directsList = (proposals?.directs || []).slice();
  const transfers = proposals?.transfers || [];

  const directsHTML = (function(){
    if (!directsList.length) {
      return `<div class="chips-panel"><p>Aucun train direct ${escapeHtml(startName)} → ${escapeHtml(endName)} dans cette plage.</p></div>`;
    }
    const cards = directsList.map(t => {
      const classes = ['chip'];
      if (t.source === 'CFL') classes.push('cfl-train');
      const dataNum = t.selectionKey || t.numero || '';
      const label = t.displayLabel || (t.numero ? `${t.numero}` : 'Train');
      TRAIN_LABEL_REGISTRY.set(dataNum, label);
      const safeLabel = escapeHtml(label);
      const safeNum = escapeHtml(dataNum);
      const safeDep = escapeHtml(t.dep || '?');
      const safeArr = escapeHtml(t.arr || '?');
      return `
            <div class="${classes.join(' ')}" data-num="${safeNum}" data-source="${escapeHtml(t.source || 'SNCF')}" data-label="${safeLabel}">
              <span class="t-num">${safeLabel}</span>
              <span class="t-time">(${escapeHtml(startName)} ${safeDep} → ${escapeHtml(endName)} ${safeArr})</span>
            </div>`;
    }).join('');
    return `
      <div class="chips-panel">
        <div class="chips-header">
          <div style="font-weight:700">Propositions directes ${escapeHtml(startName)} → ${escapeHtml(endName)}</div>
          <div class="chips-count"><span id="chipsCount">0</span> sélection(s)</div>
        </div>
        <div class="chips-wrap">
          ${cards}
        </div>
      </div>`;
  })();

  const transfersHTML = renderTransferCards(transfers, startName, endName);
  cont.innerHTML = directsHTML + transfersHTML;
  if (section) {
    const hasChip = !!cont.querySelector('.chip');
    section.classList.toggle('is-empty', !hasChip);
  }

  document.querySelectorAll('#propositions .chip').forEach(chip => {
    const t = chip.querySelector('.t-num');
    if (!t) return;
    const label = chip.dataset.label || TRAIN_LABEL_REGISTRY.get(chip.dataset.num);
    if (label) {
      t.textContent = label;
    } else if (chip.dataset.num) {
      t.textContent = chip.dataset.num.startsWith('CFL-')
        ? formatTrainDisplayLabel(chip.dataset.num)
        : chip.dataset.num;
    }
  });

  cont.querySelectorAll('.chip[data-num]').forEach((chip)=>{
    chip.addEventListener('click', ()=>{
      const prevSize = selectedTrains ? selectedTrains.size : 0;
      const num = chip.dataset.num; if (!num) return;
      const willSelect = !chip.classList.contains('is-selected');
      chip.classList.toggle('is-selected', willSelect);
      if (willSelect) selectedTrains?.add(num); else selectedTrains?.delete(num);
      chipsUpdateCount?.(); updateSelectionUI?.();
      if (selectedTrains && prevSize === 0 && selectedTrains.size > 0 && typeof openSelectionModal === 'function' && !isSelectionModalOpen()){
        openSelectionModal({ focus: false, trigger: document.getElementById('openSelectionModal') || chip });
      }
    });
  });

  cont.querySelectorAll('.chip.transfer').forEach((chip)=>{
    chip.addEventListener('click', ()=>{
      const prevSize = selectedTrains ? selectedTrains.size : 0;
      const n1=chip.dataset.num1, n2=chip.dataset.num2;
      const isOn = chip.classList.contains('is-selected');
      chip.classList.toggle('is-selected', !isOn);
      if (!isOn){ selectedTrains?.add(n1); selectedTrains?.add(n2); }
      else { selectedTrains?.delete(n1); selectedTrains?.delete(n2); }
      cont.querySelectorAll(`.chip[data-num="${n1}"], .chip[data-num="${n2}"]`).forEach(c=> c.classList.toggle('is-selected', selectedTrains?.has(c.dataset.num)));
      chipsUpdateCount?.(); updateSelectionUI?.();
      if (selectedTrains && prevSize === 0 && selectedTrains.size > 0 && typeof openSelectionModal === 'function' && !isSelectionModalOpen()){
        openSelectionModal({ focus: false, trigger: document.getElementById('openSelectionModal') || chip });
      }
    });
  });

  chipsUpdateCount?.();

  proposerTrainsOD.lastRequest = {
    startName,
    endName,
    fromHHMM,
    toHHMM,
    allowTransfers,
    includeCfl
  };
}

  proposerTrainsOD.lastRequest = null;

/* ====================== PRESETS (listes) ====================== */
const PRESET_AM = "88704,88706,88708,88710,88802,88712,88501,88804,88714,88503,88806,88716,88505,88718,88571,88722".split(',');
const PRESET_PM = "88741,88743,88745,88747,88530,88749,88751,88753,88532,88755,88813,88759,88761,88815,88534,88763,88765,88767,88769".split(',');
const DEFAULT_PRESET_LABELS = { AM: "Matin", PM: "Soir", L3: "Liste 3", L4: "Liste 4" };
const customRapidPresets = { AM: null, PM: null, L3: null, L4: null };

// BER FIX — Routes des listes personnalisées : une liste créée via Mes préférences
// garde aussi son tronçon De → À, afin que le tableau n'affiche que ces gares.
const lbPresetRouteMeta = { AM: null, PM: null, L3: null, L4: null };
function lbNormalizePresetRoute(route){
  if (!route || typeof route !== 'object') return null;
  const from = String(route.from || route.startName || route.start || '').trim();
  const to = String(route.to || route.endName || route.end || '').trim();
  return (from && to) ? { from, to } : null;
}
function lbSetTableRoute(from, to){
  const start = String(from || '').trim();
  const end = String(to || '').trim();
  if (!start || !end) return false;
  const $start = $('#startStation');
  const $end = $('#endStation');
  let ok = true;
  if ($start && $start.length) {
    if ($start.find(`option[value="${start.replace(/"/g, '\\"')}"]`).length) $start.val(start);
    else { $start.val(start); ok = false; }
  }
  if ($end && $end.length) {
    if ($end.find(`option[value="${end.replace(/"/g, '\\"')}"]`).length) $end.val(end);
    else { $end.val(end); ok = false; }
  }
  if (typeof syncStationSearchInputs === 'function') syncStationSearchInputs();
  if (typeof updateItineraryPreview === 'function') updateItineraryPreview();
  return ok;
}
function lbRememberPresetRoute(kind, from, to){
  if (!kind) return;
  const route = lbNormalizePresetRoute({ from, to });
  if (route) lbPresetRouteMeta[kind] = route;
}

function normalizePresetLabel(label, fallback){
  const trimmed = String(label || '').trim();
  return trimmed ? trimmed : fallback;
}

function setPresetButtonLabel(kind, label){
  const node = document.querySelector(`[data-preset-label="${kind}"]`);
  if (node) node.textContent = label;
  const btn = document.querySelector(`.preset-btn[data-preset-kind="${kind}"]`);
  if (btn) btn.setAttribute('title', label);
}

function applyRapidPresetLabels(){
  const amLabel = normalizePresetLabel(customRapidPresets.AM?.label, DEFAULT_PRESET_LABELS.AM);
  const pmLabel = normalizePresetLabel(customRapidPresets.PM?.label, DEFAULT_PRESET_LABELS.PM);
  const l3Label = normalizePresetLabel(customRapidPresets.L3?.label, DEFAULT_PRESET_LABELS.L3);
  const l4Label = normalizePresetLabel(customRapidPresets.L4?.label, DEFAULT_PRESET_LABELS.L4);
  setPresetButtonLabel('AM', amLabel);
  setPresetButtonLabel('PM', pmLabel);
  setPresetButtonLabel('L3', l3Label);
  setPresetButtonLabel('L4', l4Label);
  renderHomeQuickPresetButtons();
}

function presetHasContent(preset){
  if (!preset) return false;
  const label = String(preset.label || '').trim();
  const trains = Array.isArray(preset.trains) ? preset.trains : [];
  return Boolean(label || trains.length);
}

function updateRapidPresetVisibility(){
  const kinds = ['L3', 'L4'];
  kinds.forEach((kind) => {
    const btn = document.querySelector(`.preset-btn[data-preset-kind="${kind}"]`);
    if (!btn) return;
    const isVisible = presetHasContent(customRapidPresets[kind]);
    btn.style.display = isVisible ? 'inline-flex' : 'none';
  });
  renderHomeQuickPresetButtons();
}

function renderHomeQuickPresetButtons(){
  const host = document.getElementById('homeQuickPresets');
  if (!host) return;
  const esc = (v)=> String(v ?? '').replace(/[&<>"']/g, (m)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const artwork = {
    AM: { src: './assets/icons/tableau/tableau-matin.webp', width: 196, height: 160 },
    PM: { src: './assets/icons/tableau/tableau-soir.webp', width: 166, height: 170 },
    L3: { src: './assets/icons/tableau/tableau-nancy-metz.webp', width: 260, height: 74 },
    L4: { src: './assets/icons/tableau/tableau-metz-nancy.webp', width: 260, height: 84 }
  };
  const visibleKinds = ['AM', 'PM', 'L3', 'L4'].filter((kind) => {
    if (kind === 'AM' || kind === 'PM') return true;
    return presetHasContent(customRapidPresets[kind]);
  });
  const html = visibleKinds.map((kind) => {
    const fallback = DEFAULT_PRESET_LABELS[kind] || kind;
    const label = normalizePresetLabel(customRapidPresets[kind]?.label, fallback);
    const art = artwork[kind];
    return `<button type="button" class="home-quick-presets__btn" data-home-preset-kind="${kind}" aria-label="Ouvrir le tableau ${esc(label)}"><span class="home-quick-presets__art" aria-hidden="true"><img src="${art.src}" alt="" width="${art.width}" height="${art.height}" decoding="async"></span><span class="home-quick-presets__text">${esc(label)}</span></button>`;
  }).join('');
  host.innerHTML = html;
}

function getRapidPresetNumbers(kind){
  const custom = customRapidPresets[kind];
  const list = custom?.trains?.length ? custom.trains : (kind === 'PM' ? PRESET_PM : (kind === 'AM' ? PRESET_AM : []));
  return Array.isArray(list) ? list.slice() : [];
}

function parseTrainList(raw, limit = 10){
  const numbers = String(raw || '').match(/\b\d{5,6}\b/g) || [];
  const unique = [];
  numbers.forEach(num => {
    if (!unique.includes(num)) unique.push(num);
  });
  return unique.slice(0, limit);
}

function areListsEqual(a, b){
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((val, idx) => b[idx] === val);
}

function normalizeTrainList(list){
  if (!Array.isArray(list)) return [];
  return list
    .map((num) => String(num || '').trim())
    .filter((num) => num.length > 0);
}

function applyCustomRapidPresets(prefs){
  const raw = prefs?.rapidPresets || {};
  const am = raw.AM || raw.am || null;
  const pm = raw.PM || raw.pm || null;
  const l3 = raw.L3 || raw.l3 || null;
  const l4 = raw.L4 || raw.l4 || null;
  customRapidPresets.AM = am ? { label: String(am.label || ''), trains: normalizeTrainList(am.trains), route: lbNormalizePresetRoute(am.route) } : null;
  customRapidPresets.PM = pm ? { label: String(pm.label || ''), trains: normalizeTrainList(pm.trains), route: lbNormalizePresetRoute(pm.route) } : null;
  customRapidPresets.L3 = l3 ? { label: String(l3.label || ''), trains: normalizeTrainList(l3.trains), route: lbNormalizePresetRoute(l3.route) } : null;
  customRapidPresets.L4 = l4 ? { label: String(l4.label || ''), trains: normalizeTrainList(l4.trains), route: lbNormalizePresetRoute(l4.route) } : null;
  ['AM','PM','L3','L4'].forEach((k)=>{ lbPresetRouteMeta[k] = customRapidPresets[k]?.route || null; });
  applyRapidPresetLabels();
  updateRapidPresetVisibility();
}
function detectPresetMatch(list){
  if (!Array.isArray(list) || list.length === 0) return null;
  const sameNumbers = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((val, idx) => b[idx] === val);
  if (sameNumbers(list, getRapidPresetNumbers('AM'))) return 'AM';
  if (sameNumbers(list, getRapidPresetNumbers('PM'))) return 'PM';
  if (sameNumbers(list, getRapidPresetNumbers('L3'))) return 'L3';
  if (sameNumbers(list, getRapidPresetNumbers('L4'))) return 'L4';
  return null;
}

function updatePresetHighlights(kind){
  const active = kind || '';
  document.querySelectorAll('.preset-btn[data-preset-kind]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.presetKind === active);
  });
}

  const RAPID_PRESET_CONFIG = {
  AM: {
    label: 'Matin',
    from: '06:00',
    to: '10:00',
    displayStart: ['Nancy', 'Metz', 'Thionville'],
    displayEnd: ['Luxembourg'],
    queryStart: ['Thionville', 'Metz', 'Nancy'],
    queryEnd: ['Luxembourg']
  },
  PM: {
    label: 'Soir',
    from: '16:00',
    to: '20:00',
    displayStart: ['Luxembourg'],
    displayEnd: ['Nancy', 'Metz', 'Thionville'],
    queryStart: ['Luxembourg'],
    queryEnd: ['Thionville', 'Metz', 'Nancy']
  }
};

/* ====================== ÉTAT CENTRAL ====================== */
const selectedTrains = new Set();
const TRAIN_LABEL_REGISTRY = new Map();

function extractCflTrainTypeFromResult(result){
  if (!result || typeof result !== 'object') return '';
  if (result.trainType){
    const direct = normalizeCflTrainType(result.trainType);
    if (direct) return direct;
  }
  if (result.cflMeta && result.cflMeta.trainType){
    const metaType = normalizeCflTrainType(result.cflMeta.trainType);
    if (metaType) return metaType;
  }
  const mode = result.train?.display_informations?.commercial_mode || '';
  if (mode){
    const match = mode.match(/\b(RB|RE|IC)\b/i);
    if (match) {
      const inferred = normalizeCflTrainType(match[1]);
      if (inferred) return inferred;
    }
  }
  return '';
}

function formatTrainDisplayLabel(selectionKey, { result, trainType } = {}){
  if (!selectionKey || !selectionKey.startsWith('CFL-')) return selectionKey;
  const rawNumero = String(selectionKey).replace(/^CFL-/, '');
  let prefix = normalizeCflTrainType(trainType);
  if (!prefix && result){
    prefix = extractCflTrainTypeFromResult(result);
  }
  if (!prefix){
    prefix = lookupRegisteredCflTrainType(selectionKey);
  }
  return buildCflDisplayLabel(prefix, rawNumero);
}

let lastRapidPreset = null;
let rapidPresetRefreshTimer = null;
let rapidPresetRefreshInFlight = false;
let customProposalRefreshTimer = null;
let customProposalRefreshInFlight = false;

/* ====================== HELPERS GÉNÉRAUX ====================== */

function ymdBetween(ymd, start, end){ return ymd >= start && ymd <= end; }
function weekdayStrFromYMD(ymd){
  // 0=Sun..6=Sat -> 'sunday'..'saturday'
  const y = +ymd.slice(0,4), m = +ymd.slice(4,6)-1, d = +ymd.slice(6,8);
  const dt = new Date(Date.UTC(y,m,d));
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dt.getUTCDay()];
}
    // Déduplique des listes de départs (même voyage: trip_id + stop_sequence)
function dedupTripSeq(list){
  const seen = new Set(), out = [];
  for (const d of list){
    const k = `${d.trip_id}|${d.seq}`;
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  return out;
}

/* ====================== UI SÉLECTION (input + tags) ====================== */

    let lastSelectionModalTrigger = null;

function isSelectionModalOpen(){
  const modal = document.getElementById('selectionModal');
  return !!(modal && !modal.hasAttribute('hidden'));
}
function scheduleDateSensitiveRefresh(){
  scheduleRapidPresetRefresh();
  scheduleCustomProposalRefresh();
}

function scheduleRapidPresetRefresh(){
  if (!lastRapidPreset) return;
  clearTimeout(rapidPresetRefreshTimer);
  rapidPresetRefreshTimer = setTimeout(runRapidPresetRefresh, 120);
}

async function runRapidPresetRefresh(){
  if (!lastRapidPreset) return;
  if (rapidPresetRefreshInFlight) {
    clearTimeout(rapidPresetRefreshTimer);
    rapidPresetRefreshTimer = setTimeout(runRapidPresetRefresh, 160);
    return;
  }
  rapidPresetRefreshInFlight = true;
  try {
    await applyRapidPreset(lastRapidPreset.kind, {
      auto: true,
      openModal: isSelectionModalOpen(),
      focus: false
    });
  } catch (err) {
    console.error('Impossible de rafraîchir le preset rapide', err);
  } finally {
    rapidPresetRefreshInFlight = false;
  }
}

function scheduleCustomProposalRefresh(){
  if (!proposerTrainsOD.lastRequest) return;
  clearTimeout(customProposalRefreshTimer);
  customProposalRefreshTimer = setTimeout(runCustomProposalRefresh, 150);
}

async function runCustomProposalRefresh(){
  if (!proposerTrainsOD.lastRequest) return;
  if (customProposalRefreshInFlight) {
    clearTimeout(customProposalRefreshTimer);
    customProposalRefreshTimer = setTimeout(runCustomProposalRefresh, 200);
    return;
  }
  customProposalRefreshInFlight = true;
  try {
    const req = Object.assign({}, proposerTrainsOD.lastRequest, {
      trigger: document.getElementById('btnProposer'),
      autoRefresh: true,
      openModal: isSelectionModalOpen(),
      focus: false
    });
    await proposerTrainsOD(req);
  } catch (err) {
    console.error('Impossible de rafraîchir les propositions personnalisées', err);
  } finally {
    customProposalRefreshInFlight = false;
  }
}
  function syncSelectionDateFromMain(){
  const main = document.getElementById('trainDate');
  const alt = document.getElementById('selectionDate');
  if (!main || !alt) return;
  const value = main.value || '';
  if (alt.value !== value){
    alt.value = value;
  }
}
function openSelectionModal(options = {}){
  const { trigger = null, focus = true } = options;
  const modal = document.getElementById('selectionModal');
  const backdrop = document.getElementById('selectionModalBackdrop');
  if (!modal || !backdrop) return;

  lastSelectionModalTrigger = trigger || document.activeElement || null;

  syncSelectionDateFromMain();

  backdrop.hidden = false;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  if (typeof window.updateSelectionApplyButton === 'function') {
    window.updateSelectionApplyButton();
  } else {
    const btn = document.getElementById('applySelectionToPreset');
    if (btn) {
      btn.hidden = true;
      btn.style.display = 'none';
    }
  }

  if (focus === false) return;

  const size = typeof selectedTrains !== 'undefined' ? selectedTrains.size : 0;
  let target = null;
  if (size > 0){
    const candidate = modal.querySelector('#loadTrains');
    if (candidate && candidate.offsetParent !== null) target = candidate;
  }
  if (!target){
    const manual = modal.querySelector('#manualTrainInput');
    if (manual && manual.offsetParent !== null) target = manual;
  }
  if (!target){
    target = modal.querySelector('[data-modal-autofocus], button, [href], input:not([type="hidden"]), select, textarea, [tabindex="0"]');
  }
  if (target){
    requestAnimationFrame(()=>{
      try{ target.focus({ preventScroll:true }); }
      catch(e){ target.focus(); }
    });
  }
}

function closeSelectionModal(options = {}){
  const { restoreFocus = true } = options;
  const modal = document.getElementById('selectionModal');
  const backdrop = document.getElementById('selectionModalBackdrop');
  if (!modal || !backdrop) return;

  modal.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove('modal-open');

  if (restoreFocus && lastSelectionModalTrigger && typeof lastSelectionModalTrigger.focus === 'function'){
    try{ lastSelectionModalTrigger.focus({ preventScroll:true }); }
    catch(e){ lastSelectionModalTrigger.focus(); }
  }
}

function clearProposals(){
  const host = document.getElementById('propositions');
  if (host) host.replaceChildren();
  const section = document.getElementById('proposalSection');
  if (section){
    section.hidden = true;
    section.classList.remove('is-empty');
  }
  TRAIN_LABEL_REGISTRY.clear();
}

function chipsUpdateCount(){
  const el = document.querySelector('#propositions #chipsCount');
  if (el) el.textContent = selectedTrains.size;
}

function updateSelectionUI(){
  const arr = Array.from(selectedTrains || []);

  const matchedPreset = detectPresetMatch(arr);
  if (arr.length === 0) updatePresetHighlights(null);
  else if (matchedPreset) updatePresetHighlights(matchedPreset);

  // 1) compat input CSV
  const input = document.getElementById('trainNumbers');
  if (input) {
    const numericOnly = arr.filter(num => /^\d{5,6}$/.test(num));
    input.value = numericOnly.join(',');
  }
  // 2) rendu des chips sélection
  const zone = document.getElementById('selectionChips');
  if (zone){
    // (ré)génère le HTML des chips
    zone.innerHTML = arr.map(num => {
      const label = TRAIN_LABEL_REGISTRY.get(num)
        || (num.startsWith('CFL-') ? formatTrainDisplayLabel(num) : num);
      const safeNum = escapeHtml(num);
      const safeLabel = escapeHtml(label);
      const classes = ['chip-tag'];
      if (num.startsWith('CFL-')) classes.push('cfl-train');
      const safeTitle = escapeHtml(label);
      return `
      <span class="${classes.join(' ')}" data-num="${safeNum}" role="button" tabindex="0" title="Retirer ${safeTitle}">
        <span class="t-num">${safeLabel}</span>
      </span>`;
    }).join('');

    // remove au clic / clavier (désactivé si on est en train de drag)
    zone.querySelectorAll('.chip-tag').forEach(tag=>{
      const remove = () => {
        const num = tag.dataset.num;
        if (!num) return;
        selectedTrains.delete(num);
        const card = document.querySelector(`#propositions .chip[data-num="${num}"]`);
        if (card) card.classList.remove('is-selected');
        chipsUpdateCount?.();
        updatePresetHighlights(null);
        updateSelectionUI();
      };
      tag.addEventListener('click', ()=>{
        const t = Number(zone.dataset.justDroppedAt || 0);
  if (t && Date.now() - t < 250) return;

  remove();
});
      tag.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); remove(); }
      });
    });

    // rail visible uniquement si on a des chips (sauf si #selectionBlock gère l’affichage)
    if (!document.getElementById('selectionBlock')) {
      zone.hidden = (arr.length === 0);
    }

    // (ré)initialise le DnD APRÈS insertion DOM
    requestAnimationFrame(()=>{
      if (window.Sortable) {
        initSelectionSortable();
      } else if (typeof window.lbEnsureSortable === 'function') {
        window.lbEnsureSortable().then((SortableCtor)=>{
          if (SortableCtor) initSelectionSortable();
        }).catch(()=>{});
      }
    });
  }

  // 3) barre d’actions + bloc
  const actions = document.getElementById('selectionActions');
  if (actions) actions.hidden = (arr.length === 0);

  const block = document.getElementById('selectionBlock');
  if (block) block.hidden = (arr.length === 0);

  const selCount = document.getElementById('selCount');
  if (selCount) selCount.textContent = arr.length;

  const footer = document.getElementById('selectionFooter');
  if (footer) footer.hidden = (arr.length === 0);

  const emptyMsg = document.getElementById('selectionEmptyMessage');
  if (emptyMsg) emptyMsg.hidden = (arr.length !== 0);

  const inlineCount = document.getElementById('inlineSelCount');
  if (inlineCount) inlineCount.textContent = arr.length;

  const openBtn = document.getElementById('openSelectionModal');
  if (openBtn){
    openBtn.textContent = arr.length > 0 ? `Ouvrir (${arr.length})` : 'Ouvrir';
    openBtn.setAttribute('aria-label', arr.length > 0
      ? `Ouvrir la sélection des bétaillères (${arr.length})`
      : 'Ouvrir la sélection des bétaillères');
  }
  const inlineWrapper = document.querySelector('.filters-row.filters-selection');
  if (inlineWrapper) inlineWrapper.hidden = (arr.length === 0);

  const inlineBox = document.getElementById('selectionInline');
  if (inlineBox) {
    inlineBox.classList.toggle('has-selection', arr.length > 0);
    inlineBox.hidden = (arr.length === 0);
  }

  // compteur en-tête “Propositions”
  chipsUpdateCount?.();
}

// Montre/cache la barre d'actions selon la sélection
function toggleSelectionActions(){
  const has = (window.selectedTrains && selectedTrains.size > 0);
  const el = document.getElementById('selectionActions');
  if (el) el.hidden = !has;
}

// Appelé à chaque MAJ des chips ET au chargement
function afterSelectionRender(){
  toggleSelectionActions();
}

/* Applique une sélection complète aux cartes visibles (si présentes) + met à jour l'état global */
function chipsSetSelection(list){
  selectedTrains.clear();
  list.forEach(n => selectedTrains.add(n));
  document.querySelectorAll('#propositions .chip').forEach(c=>{
    c.classList.toggle('is-selected', selectedTrains.has(c.dataset.num));
  });
  chipsUpdateCount();
  updateSelectionUI();
}
function usePresetEverywhere(list){
  const arr = Array.isArray(list) ? list : [];
  if (document.querySelector('#propositions .chip')) {
    chipsSetSelection(arr);
  } else {
    selectedTrains.clear();
    arr.forEach(n => selectedTrains.add(n));
    updateSelectionUI();
  }
  if (typeof chipsUpdateCount === 'function') chipsUpdateCount();
}

async function applyRapidPreset(kind, options = {}){
  const opts = options || {};
  const config = RAPID_PRESET_CONFIG[kind] || null;
  const fallback = getRapidPresetNumbers(kind);

  if (!opts.auto) {
    clearProposals();
    if (typeof proposerTrainsOD === 'function') {
      proposerTrainsOD.lastRequest = null;
    }
  }

  const shouldAlignStations = !opts.auto || opts.forceDirection;
  if (shouldAlignStations) {
    const customRoute = lbNormalizePresetRoute(customRapidPresets[kind]?.route || lbPresetRouteMeta[kind]);
    if (customRoute) {
      lbSetTableRoute(customRoute.from, customRoute.to);
    } else {
      setDirectionForPreset(kind, config);
    }
  }
  if (typeof syncStationSearchInputs === 'function') syncStationSearchInputs();
  if (typeof updateItineraryPreview === 'function') updateItineraryPreview();
  if (selectedTrains && selectedTrains.size > 0){
    usePresetEverywhere([]);
  }

  const numbers = fallback.slice();
  if (config && !opts.auto){
    try {
      const $start = $('#startStation');
      const $end = $('#endStation');
      const pickQueryEndpoint = ($sel, prefs, fallbackValue) => {
        if ($sel && $sel.length && Array.isArray(prefs)){
          for (const candidate of prefs){
            if (!candidate) continue;
            if ($sel.find(`option[value="${candidate}"]`).length > 0) return candidate;
          }
        }
        return fallbackValue;
      };
      const startName = pickQueryEndpoint($start, config.queryStart, $start.val() || '');
      const endName = pickQueryEndpoint($end, config.queryEnd, $end.val() || '');
      const ymd = dateInputToYMD($('#trainDate').val()) || todayYMDLux().replace(/-/g,'');
      await computeItineraryProposals({
        startName,
        endName,
        fromHHMM: config.from,
        toHHMM: config.to,
        allowTransfers: false,
        ymd
      });
    } catch (err) {
      console.error('Impossible de calculer le preset rapide', err);
    }
  }

  usePresetEverywhere(numbers);

  lastRapidPreset = { kind };
  updatePresetHighlights(kind);

  if (opts.openModal && typeof openSelectionModal === 'function'){
    openSelectionModal({
      trigger: opts.trigger || document.getElementById('openSelectionModal'),
      focus: opts.focus ?? true
    });
  }

  return numbers;
}
// === SortableJS pour #selectionChips (rail horizontal) ===
let selectionSortable = null;

function initSelectionSortable(){
  const zone = document.getElementById('selectionChips');
  if (!zone || !window.Sortable) return;

  if (selectionSortable) { selectionSortable.destroy(); selectionSortable = null; }

  selectionSortable = Sortable.create(zone, {
    animation: 150,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 5,
    scroll: true,
    bubbleScroll: true,
    scrollSensitivity: 40,
    scrollSpeed: 14,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',

    onStart(){ zone.dataset.dragging = '1'; },
    onEnd(){
  zone.dataset.justDroppedAt = String(Date.now());
  delete zone.dataset.dragging;
},

    onSort(){
      // MAJ ordre -> Set + input (sans re-render complet)
      const order = Array.from(zone.querySelectorAll('.chip-tag')).map(el => el.dataset.num);
      selectedTrains.clear();
      order.forEach(n => selectedTrains.add(n));
      const input = document.getElementById('trainNumbers');
      if (input) input.value = order.join(',');
      chipsUpdateCount?.();
    }
  });
}

/* ====================== DOC READY ====================== */
$(function () {
  applyRapidPresetLabels();
  renderHomeQuickPresetButtons();

// === PROXY SNCF (VPS) ===
const VPS_BASE = 'https://vps.labetaillere.fr';

// Accepte "YYYY-MM-DD" ou "YYYYMMDD".
// IMPORTANT : cette fonction renvoie désormais le HUB central, jamais l'ancien endpoint /sncf/vehicle_journey.
function vpsVehicleJourneyUrl(date, num) {
  const d = /^\d{8}$/.test(String(date || ''))
    ? String(date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
    : String(date || '').trim();
  const n = String(num || '').trim();
  return `${VPS_BASE}/sncf/hub?date=${encodeURIComponent(d)}&nums=${encodeURIComponent(n)}`;
}

// Fetch JSON + lecture du header X-Cache (HIT/MISS/REFRESH) pour debug
// Cache frontal unique pour éviter que Favoris/Tableau redemandent le même train en boucle
const SNCF_FRONT_CACHE = new Map();
const SNCF_FRONT_INFLIGHT = new Map();
const SNCF_FRONT_TTL_MS = 60 * 1000;

function parseVpsVehicleJourneyUrl(url) {
  try {
    const absolute = new URL(String(url || '').trim(), window.location.origin);
    const m = absolute.pathname.match(/^\/sncf\/vehicle_journey\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_.:-]+)\/?$/);
    if (!m || absolute.hostname !== 'vps.labetaillere.fr') return null;
    return { date: m[1], num: m[2], absolute };
  } catch (_) {
    return null;
  }
}

function parseVpsHubSingleTrainUrl(url) {
  try {
    const absolute = new URL(String(url || '').trim(), window.location.origin);
    if (absolute.hostname !== 'vps.labetaillere.fr' || absolute.pathname !== '/sncf/hub') return null;
    const date = absolute.searchParams.get('date');
    const nums = String(absolute.searchParams.get('nums') || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
    if (!date || nums.length !== 1) return null;
    return { date, num: nums[0], absolute };
  } catch (_) {
    return null;
  }
}

async function fetchVehicleJourneyViaHub(date, num, { client = 'front-central', timeoutMs = 15000 } = {}) {
  const safeDate = String(date || '').trim();
  const safeNum = String(num || '').trim();
  const safeClient = String(client || 'front-central').trim() || 'front-central';
  const key = `${safeDate}:${safeNum}`;
  const now = Date.now();

  const cached = SNCF_FRONT_CACHE.get(key);
  if (cached && cached.data && (now - cached.t) < SNCF_FRONT_TTL_MS) {
    return { ok: true, status: 200, data: cached.data, cache: 'FRONT-HIT' };
  }

  if (SNCF_FRONT_INFLIGHT.has(key)) {
    return SNCF_FRONT_INFLIGHT.get(key);
  }

  const hubUrl = `${VPS_BASE}/sncf/hub?date=${encodeURIComponent(safeDate)}&nums=${encodeURIComponent(safeNum)}&client=${encodeURIComponent(safeClient)}`;

  const promise = (async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Client transmis dans l'URL (?client=...), pas de header custom côté navigateur
      // => évite les pré-vérifications CORS et reste compatible avec toutes les versions.
      const r = await fetch(hubUrl, {
        credentials: 'omit',
        signal: controller.signal
      });

      const hub = await r.json().catch(() => null);
      const item = hub?.trains?.[safeNum];

      if (!r.ok || !item) {
        throw new Error(`hub_error_${r.status}`);
      }

      if (item.ok && item.data) {
        SNCF_FRONT_CACHE.set(key, { t: Date.now(), data: item.data });
      }

      if (item.cache) console.debug('[SNCF HUB]', safeClient, safeNum, item.cache, hub?.quota || '');
      return { ok: !!item.ok, status: item.status || r.status, data: item.data, cache: item.cache || null, hub };
    } finally {
      clearTimeout(t);
      SNCF_FRONT_INFLIGHT.delete(key);
    }
  })();

  SNCF_FRONT_INFLIGHT.set(key, promise);
  return promise;
}

async function fetchVehicleJourneysBatchViaHub(date, numbers, { client = 'front-tableau-batch', timeoutMs = 15000 } = {}) {
  const safeDate = String(date || '').trim();
  const safeClient = String(client || 'front-tableau-batch').trim() || 'front-tableau-batch';
  const list = Array.from(new Set((numbers || []).map(v => String(v || '').trim()).filter(Boolean)));
  const results = {};
  const pending = [];
  const now = Date.now();

  list.forEach((num) => {
    const key = `${safeDate}:${num}`;
    const cached = SNCF_FRONT_CACHE.get(key);
    if (cached?.data && (now - cached.t) < SNCF_FRONT_TTL_MS) {
      results[num] = { ok: true, status: 200, data: cached.data, cache: 'FRONT-HIT' };
    } else {
      pending.push(num);
    }
  });

  if (!pending.length) return results;

  const hubUrl = `${VPS_BASE}/sncf/hub?date=${encodeURIComponent(safeDate)}&nums=${encodeURIComponent(pending.join(','))}&client=${encodeURIComponent(safeClient)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(hubUrl, { credentials: 'omit', signal: controller.signal });
    const hub = await response.json().catch(() => null);
    if (!response.ok || !hub?.trains) throw new Error(`hub_batch_error_${response.status}`);

    pending.forEach((num) => {
      const item = hub.trains[num];
      if (!item) return;
      results[num] = {
        ok: !!item.ok,
        status: item.status || response.status,
        data: item.data,
        cache: item.cache || null,
        hub
      };
      if (item.ok && item.data) {
        SNCF_FRONT_CACHE.set(`${safeDate}:${num}`, { t: Date.now(), data: item.data });
      }
    });
    console.debug('[SNCF HUB BATCH]', safeClient, pending.length, hub.summary || '', hub.quota || '');
    return results;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch JSON générique avec garde stricte SNCF :
// - aucun appel direct api.sncf.com / data.gouv côté navigateur
// - aucun fallback navigateur vers /sncf/vehicle_journey
// - les trains SNCF passent par /sncf/hub, puis le VPS décide cache/quota/API réelle
async function fetchJSON(url, { timeoutMs = 15000, client = 'front-central' } = {}) {
  let absolute;
  try {
    const u = String(url || '').trim();
    absolute = new URL(u, window.location.origin);
    const href = absolute.href;

    const isForbiddenDirectSncf =
      /(^|\.)api\.sncf\.com$/i.test(absolute.hostname) ||
      /(^|\.)ressources\.data\.sncf\.com$/i.test(absolute.hostname) ||
      /(^|\.)transport\.data\.gouv\.fr$/i.test(absolute.hostname) ||
      /(^|\.)proxy\.transport\.data\.gouv\.fr$/i.test(absolute.hostname);

    if (isForbiddenDirectSncf) {
      throw new Error('Appel direct SNCF/data.gouv interdit côté front: ' + href);
    }

    const parsedHub = parseVpsHubSingleTrainUrl(href);
    if (parsedHub) {
      return await fetchVehicleJourneyViaHub(parsedHub.date, parsedHub.num, { client, timeoutMs });
    }

    const parsedVj = parseVpsVehicleJourneyUrl(href);
    if (parsedVj) {
      return await fetchVehicleJourneyViaHub(parsedVj.date, parsedVj.num, { client, timeoutMs });
    }

    const isVehicleJourney = /\/vehicle_journey\//.test(absolute.pathname) || /\/vehicle_journeys\//.test(absolute.pathname);
    if (isVehicleJourney) {
      throw new Error('vehicle_journey interdit côté navigateur: utiliser /sncf/hub');
    }
  } catch(e) {
    console.warn('[fetchJSON] Guard proxy SNCF:', e.message || e);
    return { ok:false, status:0, data:null, cache:null, error: String(e.message||e) };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(absolute.href, {
      credentials: 'omit',
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
  }
  const data = await r.json().catch(() => null);
  const cache = r.headers.get('x-cache');
  if (cache) console.debug('[Proxy]', cache, absolute.href);
  return { ok: r.ok, status: r.status, data, cache };
}

	// Expose au scope global (utilisé par le widget Favoris)
	window.vpsVehicleJourneyUrl = vpsVehicleJourneyUrl;
	window.fetchJSON = fetchJSON;
	window.fetchVehicleJourneyViaHub = fetchVehicleJourneyViaHub;

  // Date par défaut + menus
  $('#trainDate').val(formatDateInputValue(new Date()));
  buildGareDropdown();
  buildStationSelects();

  attachStationSearch('#startStationSearch', '#startStation');
  attachStationSearch('#endStationSearch', '#endStation');

  $('#startStation, #endStation').off('change.syncPreview').on('change.syncPreview', function(){
    syncStationSearchInputs();
    updateItineraryPreview();
  });

  $('#directionToggle').off('change').on('change', function(){
    const a = $('#startStation').val();
    const b = $('#endStation').val();
    buildStationSelects();   // reconstruit les options dans le nouveau sens
    if (a && b){             // si les deux sont renseignés, on les échange
      $('#startStation').val(b);
      $('#endStation').val(a);
    }
syncStationSearchInputs();
    updateItineraryPreview();
  });

  $('#swapStations').off('click').on('click', function(){
    const $start = $('#startStation');
    const $end = $('#endStation');
    const tmp = $start.val();
    $start.val($end.val());
    $end.val(tmp);
    syncStationSearchInputs();
    updateItineraryPreview();
    const host = this.closest('.station-swap') || this;
    pulseField(host);
  });

  const handleDateManual = function(){
    if (this.dataset.presetActive){
      const remaining = Number(this.dataset.presetActive) - 1;
      if (remaining <= 0){
        delete this.dataset.presetActive;
      } else {
        this.dataset.presetActive = String(remaining);
      }
    } else {
      clearActiveQuickButtons('date');
    }
    updateItineraryPreview();
    scheduleDateSensitiveRefresh();
  };
  $('#trainDate').off('input.preview change.preview').on('input.preview change.preview', handleDateManual);

  $('.quick-day').off('click').on('click', function(){
    applyDatePreset(this.dataset.day, this);
  });

syncSelectionDateFromMain();

  $('#trainDate').off('input.selectionMirror change.selectionMirror').on('input.selectionMirror change.selectionMirror', syncSelectionDateFromMain);

  $('#selectionDate').off('input.selectionControl change.selectionControl').on('input.selectionControl change.selectionControl', function(){
    const main = document.getElementById('trainDate');
    if (!main) return;
    const value = this.value || '';
    if ((main.value || '') === value) return;
    main.value = value;
    main.dispatchEvent(new Event('input', { bubbles: true }));
    main.dispatchEvent(new Event('change', { bubbles: true }));
  });

  $('.quick-time').off('click').on('click', function(){
    applyTimePreset(this.dataset.range, this);
  });

  syncStationSearchInputs();
  updateItineraryPreview();

  // cache la sélection au départ
  updateSelectionUI();

  $('#openSelectionModal').off('click').on('click', function(){
    openSelectionModal({ trigger: this });
  });
  $('#closeSelectionModal').off('click').on('click', ()=> closeSelectionModal());
  $('#selectionModalBackdrop').off('click').on('click', ()=> closeSelectionModal());
  $('#selectionModal').off('click.dismiss').on('click.dismiss', function(e){
    if (e.target === this) closeSelectionModal();
  });
  $(document).off('keydown.selectionModal').on('keydown.selectionModal', function(e){
    if (e.key === 'Escape' && isSelectionModalOpen()){
      e.preventDefault();
      closeSelectionModal();
    }
  });

  // Bouton “Proposer” -> lance la recherche

(function setupTableauModeSwitch(){
  const root = document.getElementById('tableauSelector');
  const select = document.getElementById('tableauModeSelect');
  if (!root || !select) return;

  const applyMode = (mode) => {
    const safe = ['quick', 'train', 'advanced'].includes(mode) ? mode : 'quick';
    root.dataset.searchMode = safe;
    try { localStorage.setItem('lb_tableau_mode', safe); } catch(_e) {}
  };

  // Un nouveau chargement commence toujours par les tableaux prédéfinis.
  // Le choix reste libre ensuite tant que l'application reste ouverte.
  const initial = 'quick';
  select.value = initial;
  applyMode(initial);

  select.addEventListener('change', (e) => applyMode(e.target.value));

  const trainForm = document.getElementById('tableauTrainSearchForm');
  const trainInput = document.getElementById('tableauTrainNumber');
  const trainDate = document.getElementById('tableauTrainDate');
  const trainStatus = document.getElementById('tableauTrainSearchStatus');
  const luxDate = () => {
    try {
      if (typeof luxTodayYMD === 'function') return luxTodayYMD();
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Luxembourg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch(_e) {
      return new Date().toISOString().slice(0, 10);
    }
  };
  const setTrainStatus = (message, state = '') => {
    if (!trainStatus) return;
    trainStatus.textContent = message;
    trainStatus.classList.remove('is-error', 'is-loading', 'is-success');
    if (state) trainStatus.classList.add(`is-${state}`);
  };
  if (trainDate && !trainDate.value) trainDate.value = luxDate();
  trainInput?.addEventListener('input', () => {
    const digits = trainInput.value.replace(/\D/g, '').slice(0, 6);
    if (trainInput.value !== digits) trainInput.value = digits;
    if (!digits) setTrainStatus('Entre le numéro de ta bétaillère pour ouvrir sa fiche complète.');
  });
  trainForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const number = String(trainInput?.value || '').match(/\d{5,6}/)?.[0] || '';
    if (!number) {
      setTrainStatus('Entre un numéro de train valide (5 ou 6 chiffres).', 'error');
      trainInput?.focus();
      return;
    }
    if (typeof window.lbOpenTrainProfile !== 'function') {
      setTrainStatus('La recherche par train est encore en cours de chargement.', 'loading');
      return;
    }
    setTrainStatus(`Chargement de la bétaillère ${number}…`, 'loading');
    try {
      await window.lbOpenTrainProfile(number, trainDate?.value || luxDate());
      const sourceState = document.getElementById('trainDetailSourceState');
      if (sourceState?.classList.contains('is-error')) {
        const detailMessage = document.getElementById('trainDetailMessage')?.textContent?.trim();
        throw new Error(detailMessage || `Aucune circulation ${number} trouvée pour cette date.`);
      }
      setTrainStatus(`Fiche ${number} ouverte.`, 'success');
    } catch(error) {
      setTrainStatus(error?.message || `Impossible d’ouvrir la fiche ${number}.`, 'error');
    }
  });
})();

$('#btnProposer').off('click').on('click', proposerTrainsOD);

  // Raccourcis presets rapides
  $(document).off('click.preset', '.preset-btn[data-preset-kind]').on('click.preset', '.preset-btn[data-preset-kind]', function(){
    const kind = this.dataset.presetKind;
    if (!kind) return;
    applyRapidPreset(kind, { trigger: this, openModal: true });
  });
  $(document).off('click.homePreset', '.home-quick-presets__btn[data-home-preset-kind]').on('click.homePreset', '.home-quick-presets__btn[data-home-preset-kind]', function(){
    const kind = this.dataset.homePresetKind;
    if (!kind) return;
    try{
      const modeSelect = document.getElementById('tableauModeSelect');
      if (modeSelect){
        modeSelect.value = 'quick';
        modeSelect.dispatchEvent(new Event('change', { bubbles:true }));
      }
      location.hash = '#search';
      applyRapidPreset(kind, { trigger: this, openModal: true });
    }catch(e){
      console.warn('Preset accueil impossible à ouvrir', e);
    }
  });

  (function($){
  const initFrom = $('#timeFrom').val() || '06:00';
  const initTo   = $('#timeTo').val()   || '10:00';

  const sliderEl = document.getElementById('timeSlider');
  if (!sliderEl || typeof noUiSlider === 'undefined') {
    console.warn('noUiSlider non chargé ou #timeSlider introuvable.');
    return;
  }

  // Range inchangé: 00:00 → 23:59
  noUiSlider.create(sliderEl, {
    start: [ hhmmToMin(initFrom), hhmmToMin(initTo) ],
    connect: true,
    step: 5,
    range: { min: 0, max: 1439 },
    tooltips: [{ to: v => minToHHMM(v) }, { to: v => minToHHMM(v) }],
  });

  // Sync labels + inputs
  sliderEl.noUiSlider.on('update', function(values){
    const a = minToHHMM(values[0]), b = minToHHMM(values[1]);
    $('#timeFromLabel').text(a); $('#timeToLabel').text(b);
    $('#timeFrom').val(a);       $('#timeTo').val(b);
    updateItineraryPreview();
  });

  sliderEl.noUiSlider.on('start', () => {
    if (sliderEl.dataset.presetApplying) return;
    clearActiveTimeButtons();
  });

  // Fenêtre par défaut: aujourd’hui => maintenant → +3h ; sinon => tes valeurs init
  function setDefaultWindow(){
    const isToday = (typeof isSelectedDateToday === 'function') ? isSelectedDateToday() : true;
    sliderEl.dataset.presetApplying = '1';
    if (isToday){
      const now = roundUpToStep(luxNowMinutes(), 5);
      const end = Math.min(1439, now + 180); // +3h
      sliderEl.noUiSlider.set([now, end]);
    } else {
      sliderEl.noUiSlider.set([hhmmToMin(initFrom), hhmmToMin(initTo)]);
    }
    setTimeout(() => { delete sliderEl.dataset.presetApplying; }, 0);
  }

  // au chargement
  setDefaultWindow();
  // si on change la date, on recalcule la fenêtre par défaut
  $('#trainDate').off('change._defaultWindow').on('change._defaultWindow', setDefaultWindow);
})(jQuery);

  // Bouton “Vider” (sous la sélection)
  $('#btnClearSelection').off('click').on('click', ()=>{
    selectedTrains.clear();
    // décocher visuellement les cartes si visibles
    document.querySelectorAll('#propositions .chip.is-selected').forEach(c=>c.classList.remove('is-selected'));
    if (typeof chipsUpdateCount === 'function') chipsUpdateCount();
    updatePresetHighlights(null);
    updateSelectionUI(); // -> masque la zone et les boutons
  });

  // Saisie manuelle (si tu gardes l’input CSV masqué pour compat)
  $('#trainNumbers').off('input').on('input', () => {
  const raw = $('#trainNumbers').val();
  const tokens = String(raw || '')
    .split(/[,\s]+/)
    .map(s => (String(s).match(/\b\d{5,6}\b/) || [])[0])
    .filter(Boolean);
  selectedTrains.clear();
  tokens.forEach(num => selectedTrains.add(num));
  document.querySelectorAll('#propositions .chip').forEach(c=>{
    c.classList.toggle('is-selected', selectedTrains.has(c.dataset.num));
  });
  if (typeof chipsUpdateCount === 'function') chipsUpdateCount();
  updatePresetHighlights(null);
  updateSelectionUI();
});
function addManualTrain(){
  const $inp = $('#manualTrainInput');
  const raw = String($inp.val() || '').trim();
  const num = (raw.match(/\b\d{5,6}\b/) || [])[0];
  if (!num){
    $inp.addClass('input-error'); setTimeout(()=> $inp.removeClass('input-error'), 400);
    return;
  }
  const wasEmpty = selectedTrains.size === 0;
  selectedTrains.add(num);
  updatePresetHighlights(null);
  updateSelectionUI();
  const card = document.querySelector(`#propositions .chip[data-num="${num}"]`);
  if (card) card.classList.add('is-selected');
  $inp.val('');
  if (wasEmpty && selectedTrains.size > 0 && !isSelectionModalOpen()){
    openSelectionModal({ trigger: document.getElementById('openSelectionModal') || $inp.get(0) });
  }
}
  $(document).on('click', '#btnAddTrain', addManualTrain);
  $(document).on('keydown', '#manualTrainInput', function(e){
    if (e.key === 'Enter') addManualTrain();
  });

async function loadFastStaticBatch(date, numbers){
  const list = Array.from(new Set((numbers || []).map(v => String(v || '').trim()).filter(v => /^\d{4,6}$/.test(v))));
  if (!date || !list.length) return null;
  const params = new URLSearchParams({ date, trains: list.join(',') });
  const response = await fetch('https://vps.labetaillere.fr/api/train-static-batch?' + params.toString(), {
    cache: 'default'
  });
  if (!response.ok) throw new Error('static_batch_' + response.status);
  return response.json();
}

function renderFastStaticPreview(payload, numbers, fixedStops, startName, endName){
  const host = document.getElementById('trainInfo');
  const trains = payload?.trains || {};
  if (!host || !numbers?.length || !Object.keys(trains).length) return false;

  const names = new Set();
  const extras = [];
  numbers.forEach((num) => {
    const stopTimes = trains[num]?.stop_times || [];
    stopTimes.forEach((stop) => {
      const name = stop?.stop_point?.name;
      if (!name || names.has(name)) return;
      names.add(name);
      if (!fixedStops.includes(name)) extras.push(name);
    });
  });

  let displayStops = fixedStops.filter(name => names.has(name)).concat(extras);
  displayStops = filterByOD(displayStops, startName || '', endName || '');
  if (!displayStops.length) return false;

  let html = '<table data-lb-fast-static="1"><thead><tr><th class="gare-head"><span>Gare</span></th>';
  numbers.forEach((num) => {
    const safe = escapeHtml(num);
    html += '<th class="train-header status-head" data-train-number="' + safe + '" data-train-label="' + safe + '"><span class="train-num">' + safe + '</span><span class="train-state icon" title="Horaire statique, mise à jour temps réel en cours"></span></th>';
  });
  html += '</tr></thead><tbody>';

  displayStops.forEach((stopName) => {
    html += '<tr data-gare="' + escapeHtml(stopName) + '"><td><span class="gare-label">' + escapeHtml(stopName) + '</span><span class="wx" aria-live="polite"></span></td>';
    numbers.forEach((num) => {
      const stopTimes = trains[num]?.stop_times || [];
      const stop = stopTimes.find((row) => row?.stop_point?.name === stopName);
      const raw = stop ? (stop.departure_time || stop.arrival_time || '') : '';
      html += raw
        ? '<td data-base-time="' + escapeHtml(raw) + '"><span>' + escapeHtml(ft(raw)) + '</span></td>'
        : '<td>-</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  injectTableChunkedIntoTrainInfo(html, { chunk: 200 });
  host.dataset.lbFastStatic = '1';
  return true;
}

  // Bouton “Générer le tableau”
  $('#loadTrains').off('click').on('click', async function () {
    // Empêche les doubles générations (clics rapides + auto-refresh)
    if (window.__mainTableBusy) return;
    window.__mainTableBusy = true;
    window.__lastMainTableAction = Date.now();

    try {

    closeSelectionModal({ restoreFocus:false });
    if (typeof cancelWeatherFetch === 'function') cancelWeatherFetch();
    mainTableRendered = true;
    clearProposals();

    // s’assure que l’input CSV reflète la sélection courante
    updateSelectionUI();

    const sensInverse = $('#directionToggle').is(':checked');
    const fixedStops = getStopsForDirection(sensInverse);

    const date = $('#trainDate').val();
    const rawSelection = (typeof selectedTrains !== 'undefined' && selectedTrains.size > 0)
      ? Array.from(selectedTrains)
      : $('#trainNumbers').val().split(',').map(s => s.trim()).filter(Boolean);

    const numbers = [];
    const sncfNumbers = [];
    const cflKeys = [];
    const ignoredSelections = [];
    rawSelection.forEach(val => {
      const token = String(val || '').trim();
      if (!token) return;
      if (/^CFL-\d+$/.test(token)) {
        numbers.push(token);
        cflKeys.push(token);
      } else if (/^\d{5,6}$/.test(token)) {
        numbers.push(token);
        sncfNumbers.push(token);
      } else {
        ignoredSelections.push(token);
      }
    });
    const ymdDate = dateInputToYMD(date);

    if (!numbers.length || !date) {
      $('#trainInfo').html('<p class="deleted">Veuillez indiquer au moins un numéro de train et une date.</p>');
      return;
    }

    if (ignoredSelections.length) {
      console.warn('[Sélection] Ignoré(s):', ignoredSelections.join(', '));
    }

   GTFSLoadingUI.show('Chargement des Bétaillères…');

    $('#trainInfo').html('<p>Chargement de vos bétaillères…</p>');

    // Fast path : affiche immédiatement les horaires statiques depuis le VPS.
    // Le moteur historique continue ensuite et remplace ce preview par le rendu
    // enrichi (suppressions, voies, causes, compositions) sans bloquer l'usager.
    let fastStaticVisible = false;
    if (!cflKeys.length && sncfNumbers.length === numbers.length) {
      try {
        const fastPayload = await loadFastStaticBatch(date, sncfNumbers);
        if (fastPayload?.count === sncfNumbers.length) {
          fastStaticVisible = renderFastStaticPreview(
            fastPayload,
            sncfNumbers,
            fixedStops,
            $('#startStation').val() || '',
            $('#endStation').val() || ''
          );
          if (fastStaticVisible) {
            GTFSLoadingUI.hide();
            if (typeof isSelectedDateToday !== 'function' || isSelectedDateToday()) {
              setTimeout(() => {
                loadGtfsRetards({ forceFresh: false, useCachedFirst: true })
                  .catch((err) => console.warn('[Tableau fast] temps réel indisponible', err?.message || err));
              }, 0);
            }
          }
        }
      } catch (err) {
        console.warn('[Tableau fast] batch statique indisponible, moteur historique conservé', err?.message || err);
      }
    }

    try {
      await Promise.all([
        loadCompoData(),
        loadVoiesByTrain().catch(() => null),
        loadCflVoiesByTrain().catch(() => null)
      ]);


      /* ===== Helper compo (US / UM / UM3) ===== */
      function getCompoClass(comp){
        return compoClassFromValue(comp);
      }

      /* On va (re)générer un tableau */
      mainTableRendered = true;
      /* On supprime totalement le panneau de propositions */
      document.getElementById('propositions')?.replaceChildren();

     const sncfFallback = {
        used: false,
        numbers: new Set(),
        reasons: new Set(),
        details: new Map()
      };
      const results = {};

      /* 1) Enrichissement SNCF : un seul HUB batch pour tous les trains.
         Le tableau statique est déjà visible pendant cet enrichissement. */
      let sncfBatchResponses = {};
      if (sncfNumbers.length) {
        try {
          sncfBatchResponses = await fetchVehicleJourneysBatchViaHub(date, sncfNumbers, {
            client: 'front-tableau-batch'
          });
        } catch (err) {
          console.warn('[SNCF HUB BATCH] indisponible, fallback unitaire conservé', err?.message || err);
        }
      }

    for (const num of sncfNumbers) {

  const url = vpsVehicleJourneyUrl(date, num);

  // 🔎 LOG 1 — voir l’URL exacte appelée
  console.log('[Proxy SNCF] URL appelée :', url);

  try {

    const response = sncfBatchResponses[num] || await fetchJSON(url, { client: 'front-tableau' });

    // 🔎 LOG 2 — voir le statut HTTP exact
    if (!response.ok) {
      console.warn('[Proxy SNCF] HTTP', response.status, 'pour', url);

      if (response.status === 429) {
        console.warn('[Proxy SNCF] Quota atteint – données non rafraîchies (cache requis).');
      }

      if (response.status === 404) {
        throw new Error('sncf_proxy_error_404');
      }

      throw new Error('sncf_proxy_error_' + response.status);
    }
  const res = response.data;

  const train = res?.vehicle_journeys?.[0];
  if (!train) {
    results[num] = { error: 'Non prévu' };
    continue;
  }

        const disruptions = res?.disruptions || [];
        const impacted = {};
        let newStart = null, newEnd = null;

        let disruptionCauses = [];
        for (const d of disruptions) {
          if (d.cause && !disruptionCauses.includes(d.cause)) disruptionCauses.push(d.cause);
          for (const o of d.impacted_objects || []) {
            for (const s of o.impacted_stops || []) {
              impacted[s.stop_point.id] = s; // index par stop_point.id
            }
          }
        }

        // nouveau départ = premier stop non "deleted" côté départ
        for (let s of train.stop_times) {
          const id = s.stop_point.id;
          const imp = impacted[id];
          if (imp && imp.departure_status !== 'deleted') { newStart = id; break; }
        }
        // nouveau terminus = dernier stop non "deleted" côté arrivée
        for (let i = train.stop_times.length - 1; i >= 0; i--) {
          const s = train.stop_times[i];
          const id = s.stop_point.id;
          const imp = impacted[id];
          if (imp && imp.arrival_status !== 'deleted') { newEnd = id; break; }
        }
if (!newStart) {
          for (let i = 0; i < train.stop_times.length; i++) {
            const s = train.stop_times[i];
            const id = s.stop_point.id;
            const imp = impacted[id];
            const departureDeleted = imp?.departure_status === 'deleted' || imp?.stop_time_effect === 'deleted' || (!!imp && !imp.amended_departure_time && !!(imp.base_departure_time || s.departure_time));
            const hasDeparture = !!s.departure_time;
            if (hasDeparture && !departureDeleted) { newStart = id; break; }
          }
        }

        if (!newEnd) {
          for (let i = 0; i < train.stop_times.length; i++) {
            const s = train.stop_times[i];
            const id = s.stop_point.id;
            const imp = impacted[id];
            const arrivalDeleted = imp?.arrival_status === 'deleted' || imp?.stop_time_effect === 'deleted' || (!!imp && !imp.amended_arrival_time && !!(imp.base_arrival_time || s.arrival_time));
            const departureDeleted = imp?.departure_status === 'deleted' || imp?.stop_time_effect === 'deleted' || (!!imp && !imp.amended_departure_time && !!(imp.base_departure_time || s.departure_time));
            const hasArrival = !!s.arrival_time;
            const hasDeparture = !!s.departure_time;
            const served = (hasArrival && !arrivalDeleted) || (hasDeparture && !departureDeleted) || (!imp && (hasArrival || hasDeparture));
            if (served) { newEnd = id; }
          }
        }

        const voies = getVoiesForTrain(num);
        const cflVoies = getCflVoiesForTrain(num);
        results[num] = { train, impacted, newStart, newEnd, disruptions, disruptionCauses, voies, cflVoies };
      } catch (e) {
        console.error("Erreur lors de la requête API:", e);
        results[num] = { error: 'Non prévu' };
      }
    }

    for (const key of cflKeys) {
      try {
        const cflResult = await buildCflResult(key, { ymd: ymdDate });
        const voies = getCflVoiesForTrain(key);
        results[key] = { ...cflResult, voies, cflVoies: voies };
      } catch (err) {
        console.warn('[CFL] Erreur', err);
        results[key] = { error: 'Erreur CFL' };
      }
    }

    /* (1.5) Recenser les gares ajoutées (stop_time_effect = added) */
    const addedStopsNames = new Set();
    numbers.forEach(num => {
      const result = results[num];
      if (!result || !result.impacted) return;
      Object.values(result.impacted).forEach(imp => {
        const isAdded =
          imp?.stop_time_effect === 'added' ||
          imp?.departure_status === 'added' ||
          imp?.arrival_status === 'added';
        if (isAdded && imp?.stop_point?.name) {
          addedStopsNames.add(imp.stop_point.name);
        }
      });
    });

    /* 2) Gares présentes dans les trains */
    const stopsInTrains = new Set();
    numbers.forEach(num => {
      const train = results[num]?.train;
      if (!train) return;
      train.stop_times.forEach(s => stopsInTrains.add(s.stop_point.name));
    });

    /* 3) Ordre de ligne + ajouts "added" */
    const mergedStopsOrdered = fixedStops.filter(
      name => stopsInTrains.has(name) || addedStopsNames.has(name)
    );
    // si un arrêt ajouté n’existe pas dans fixedStops, on le met à la fin
    const extrasNotInFixed = [...addedStopsNames].filter(n => !fixedStops.includes(n));
    const mergedStops = mergedStopsOrdered.concat(extrasNotInFixed);

    /* Filtre De/À pour l’affichage */
    const startName = $('#startStation').val() || '';
    const endName   = $('#endStation').val() || '';
    let displayStops = filterByOD(mergedStops, startName, endName);

    /* 3bis) Forcer l'affichage de toute la ligne pour les presets rapides */
    const presetKind = detectPresetMatch(numbers) || (lastRapidPreset?.kind ?? null);
    if (presetKind) {
      const forcedStops = filterByOD(fixedStops, startName, endName);
      const forcedExtras = extrasNotInFixed.filter(n => !forcedStops.includes(n));
      const combinedStops = forcedStops.concat(forcedExtras);
      if (!displayStops.length || combinedStops.length > displayStops.length) {
        displayStops = combinedStops;
      }
    }
const stopHasSchedule = (result, stopName) => {
      if (!result || result.error || !result.train || !Array.isArray(result.train.stop_times)) {
        return false;
      }

      const stopTimes = result.train.stop_times;
      let stop = stopTimes.find(s => s.stop_point?.name === stopName) || null;
      let impactedEntry = null;

      if (stop && stop.stop_point?.id && result.impacted) {
        impactedEntry = result.impacted[stop.stop_point.id] || null;
      }

      if (!impactedEntry && result.impacted) {
        impactedEntry = Object.values(result.impacted).find(imp => imp?.stop_point?.name === stopName) || null;
      }

      const amendedTime = impactedEntry?.amended_departure_time
        || impactedEntry?.amended_arrival_time
        || null;

      const baseTime = impactedEntry?.base_departure_time
        || impactedEntry?.base_arrival_time
        || (stop ? (stop.departure_time || stop.arrival_time || null) : null);

      const isAddedStop = Boolean(
        impactedEntry && (
          impactedEntry.stop_time_effect === 'added'
          || impactedEntry.departure_status === 'added'
          || impactedEntry.arrival_status === 'added'
        )
      );

      if (isAddedStop) {
        return Boolean(amendedTime);
      }

      if (!baseTime) {
        return false;
      }

      // SNCF peut mettre stop_time_effect='deleted' sur un arrêt où seule la montée/départ est supprimée.
      // Exemple 88501 à Thionville : arrival_status='unchanged' + departure_status='deleted'.
      // On respecte donc d'abord les statuts précis arrivée/départ ; stop_time_effect ne sert que si les deux statuts manquent.
      const departureDeleted = impactedEntry && (
        impactedEntry.departure_status === 'deleted'
        || (!impactedEntry.departure_status && impactedEntry.stop_time_effect === 'deleted')
      );
      const arrivalDeleted = impactedEntry && (
        impactedEntry.arrival_status === 'deleted'
        || (!impactedEntry.arrival_status && impactedEntry.stop_time_effect === 'deleted')
      );
      if (departureDeleted && arrivalDeleted) {
        return false;
      }

      if (stop) {
        const index = stopTimes.findIndex(s => s.stop_point?.id === stop.stop_point?.id);
        if (index >= 0) {
          const newStartIndex = result.newStart
            ? stopTimes.findIndex(s => s.stop_point?.id === result.newStart)
            : -1;
          if (newStartIndex >= 0 && index < newStartIndex) {
            return false;
          }

          const newEndIndex = result.newEnd
            ? stopTimes.findIndex(s => s.stop_point?.id === result.newEnd)
            : -1;
          if (newEndIndex >= 0 && index > newEndIndex) {
            return false;
          }
        }
      }

      return true;
    };

    displayStops = displayStops.filter(stopName =>
      numbers.some(num => stopHasSchedule(results[num], stopName))
    );

    /* 4) Construction du tableau */
	const getFavoriteNumbers = () => {
      const prefs = window.lbPrefsCache || {};
      const favAM = prefs.favoriteMorningTrain || document.getElementById('lbFavMorning')?.value || '';
      const favPM = prefs.favoriteEveningTrain || document.getElementById('lbFavEvening')?.value || '';
      return new Set([extractTrainNumber(favAM), extractTrainNumber(favPM)].filter(Boolean));
    };
    const favNumbers = getFavoriteNumbers();
    let html = '<table><thead><tr><th class="gare-head"><span>Gare</span><button type="button" id="tableLegendBtn" class="table-legend-btn" aria-label="Ouvrir la légende du tableau">ⓘ</button></th>';
    numbers.forEach(num => {
      const composition = (typeof compoData !== 'undefined' && compoData) ? compoData[num] : '';
      const compClass   = compoClassFromValue(composition);
      const result = results[num];
      const isCfl = num.startsWith('CFL-');
      const cflLabel = isCfl
        ? (result?.displayLabel || TRAIN_LABEL_REGISTRY.get(num) || formatTrainDisplayLabel(num, { result }))
        : null;
      const headerLabel = isCfl ? (cflLabel || num) : num;
      const classes = ['train-header', compClass, 'status-head'];
      if (isCfl) classes.push('cfl-train');
      const fallbackAttr = (!isCfl && result?.gtfsFallback) ? ' data-gtfs-fallback="1"' : '';
      const isFavorite = favNumbers.has(extractTrainNumber(num));
      const favAttr = isFavorite ? ' data-favorite="1"' : '';
      const safeNumber = escapeHtml(num);
      const safeLabel = escapeHtml(headerLabel);
      TRAIN_LABEL_REGISTRY.set(num, headerLabel);

      let icon = '', title = '';
      if (!result || result.error) {
        icon = '❌'; title = result?.error || 'Erreur';
      } else if (result.gtfsFallback) {
        icon = 'ℹ️'; title = result.fallbackDetails?.tooltip || 'Horaires théoriques (GTFS)';
      } else {
        const disruptions = result.disruptions || [];
        const impacted = result.impacted || {};
        const hasDelay = Object.values(impacted).some(st => {
          const amended = st.amended_departure_time || st.amended_arrival_time;
          const baseTime = st.base_departure_time || st.base_arrival_time;
          const hasAmendedDelay = amended && baseTime && dl(baseTime, amended) > 0;
          const delayMinutes = (typeof st.delay_minutes !== 'undefined' && st.delay_minutes !== null)
            ? Number(st.delay_minutes)
            : null;
          const hasDelayFlag = Number.isFinite(delayMinutes) && delayMinutes > 0;
          return hasAmendedDelay || hasDelayFlag;
        });
        const newStartId = result.newStart;
        const originalStartId = result.train.stop_times[0].stop_point.id;
        const isPartial = newStartId && newStartId !== originalStartId;
        const isFull = disruptions.some(d => ['NO_SERVICE','CANCELLATION'].includes(d.severity?.effect));
        const newEndId = result.newEnd;
        const originalEndId = result.train.stop_times[result.train.stop_times.length - 1].stop_point.id;
        const isPartialEnd = newEndId && newEndId !== originalEndId;
        const partialStartName = isPartial
          ? (result.train.stop_times.find((s) => s.stop_point?.id === newStartId)?.stop_point?.name || '')
          : '';
        const partialEndName = isPartialEnd
          ? (result.train.stop_times.find((s) => s.stop_point?.id === newEndId)?.stop_point?.name || '')
          : '';
        const tableMaxDelay = Object.values(impacted).reduce((maxDelay, st) => {
          const amended = st?.amended_departure_time || st?.amended_arrival_time;
          const baseTime = st?.base_departure_time || st?.base_arrival_time;
          const computed = amended && baseTime ? Number(dl(baseTime, amended)) : 0;
          const explicit = Number(st?.delay_minutes);
          return Math.max(
            maxDelay,
            Number.isFinite(computed) && computed > 0 ? computed : 0,
            Number.isFinite(explicit) && explicit > 0 ? explicit : 0
          );
        }, 0);

        if (isFull) {
          icon = '❌'; title = 'Train supprimé';
        } else if (isPartial || isPartialEnd) {
          icon = '⚠️';
          const partialParts = ['Suppression partielle'];
          if (isPartial && partialStartName) partialParts.push(`Départ exceptionnel ${partialStartName}`);
          if (isPartialEnd && partialEndName) partialParts.push(`Terminus exceptionnel ${partialEndName}`);
          if (tableMaxDelay > 0) partialParts.push(`+${Math.round(tableMaxDelay)} min`);
          title = partialParts.join(' · ');
        } else if (hasDelay) {
          icon = '⏰'; title = 'Retard';
        } else {
          icon = ''; title = 'Sans perturbation';
        }
        if (result.disruptionCauses?.length && title !== 'Sans perturbation') {
          title += ' : ' + result.disruptionCauses.join(', ');
        }
      }

      html += `<th class="${classes.join(' ')}" data-train-number="${safeNumber}" data-train-label="${safeLabel}"${fallbackAttr}${favAttr}><span class="train-num">${safeLabel}</span><span class="train-state icon" title="${title}">${icon}</span></th>`;
    });

    html += '</tr></thead><tbody>';

/* 5) Lignes (gares) */
    for (const stopName of displayStops) {
      html += `<tr data-gare="${stopName}">
  <td>
    <span class="gare-label">${stopName}</span>
    <span class="wx" aria-live="polite"></span>
  </td>`;

      for (const num of numbers) {
        const result = results[num];
        if (!result || result.error) {
          html += `<td class="deleted">${result?.error || 'Erreur'}</td>`;
          continue;
        }

        const cellClasses = [];
        if (result.gtfsFallback) cellClasses.push('gtfs-fallback-cell');
        const classAttr = cellClasses.length ? ` class="${cellClasses.join(' ')}"` : '';

        // (a) stop théorique (dans le trip de base)
        let stop = result.train.stop_times.find(s => s.stop_point.name === stopName);

        // (b) impact : par id si on a un stop, sinon par nom (cas "added")
        let imp = null;
        if (stop) {
          imp = result.impacted[stop.stop_point.id] || null;
        } else {
          imp = Object.values(result.impacted).find(x => x.stop_point?.name === stopName) || null;
        }

        // (c) heures base/amended
        const base =
          (imp && (imp.base_departure_time || imp.base_arrival_time)) ||
          (stop && (stop.departure_time || stop.arrival_time)) ||
          null;

        const amended =
          (imp && (imp.amended_departure_time || imp.amended_arrival_time)) ||
          null;

        const delayFromImpactRaw =
          (imp && typeof imp.delay_minutes !== 'undefined' && imp.delay_minutes !== null)
            ? Number(imp.delay_minutes)
            : null;
        const hasDelayFromImpact = Number.isFinite(delayFromImpactRaw) && delayFromImpactRaw > 0;

        // voie
        const voieTimeCandidates = [
          imp?.base_departure_time,
          imp?.base_arrival_time,
          imp?.amended_departure_time,
          imp?.amended_arrival_time,
          stop?.departure_time,
          stop?.arrival_time,
          base
        ];
        const stopPointId = stop?.stop_point?.id || imp?.stop_point?.id || '';
        const allowCflFallback = !isLikelyFrenchStopContext({ stopName, stopPointId });
        const preferCflVoie = allowCflFallback && !!result.cflVoies && isLikelyCflStopName(stopName);
        const voieMode = (imp?.base_departure_time || imp?.amended_departure_time || stop?.departure_time) ? 'dep' : 'arr';
        let voieLabel = null;
        if (!preferCflVoie) {
          voieLabel = resolveVoieForStop({
            voiesMap: result.voies,
            stopName,
            baseTimeRaw: base,
            timeCandidates: voieTimeCandidates,
            mode: voieMode,
            preferStationResolver: !allowCflFallback
          });
        }
        if (!voieLabel && allowCflFallback) {
          voieLabel = resolveCflVoieForStop({ voiesMap: result.cflVoies || result.voies, stopName });
        }
        if (!voieLabel && preferCflVoie) {
          voieLabel = resolveVoieForStop({
            voiesMap: result.voies,
            stopName,
            baseTimeRaw: base,
            timeCandidates: voieTimeCandidates,
            mode: voieMode,
            preferStationResolver: !allowCflFallback
          });
        }
        const baseClock = ft(base);
        const baseWithVoie = base ? formatClockWithVoie(baseClock, voieLabel) : '';
        const voieBadgeHtml = voieLabel
          ? `<span class="voie-badge">${escapeHtml(typeof formatVoieLabel === 'function' ? formatVoieLabel(voieLabel) : voieLabel)}</span>`
          : '';
        const delayVoieHtml = voieBadgeHtml ? `<span class="delay-voie">${voieBadgeHtml}</span>` : '';

        // statuts
        const departureDeleted = imp?.departure_status === 'deleted';
        const arrivalDeleted   = imp?.arrival_status === 'deleted';
        const isStopDeleted    = departureDeleted && arrivalDeleted;

        const index = stop
          ? result.train.stop_times.findIndex(s => s.stop_point.id === stop.stop_point.id)
          : -1;
        const newStartIndex = result.train.stop_times.findIndex(s => s.stop_point.id === result.newStart);
        const newEndIndex   = result.train.stop_times.findIndex(s => s.stop_point.id === result.newEnd);
        const originalEndId = result.train.stop_times[result.train.stop_times.length - 1]?.stop_point?.id;
        const lastIndex     = result.train.stop_times.length - 1;

        const isNewStartStop =
          !!result.newStart &&
          result.newStart !== result.train.stop_times[0]?.stop_point?.id &&
          ((stop && stop.stop_point?.id === result.newStart) || (imp?.stop_point?.id === result.newStart));

        // La limite du parcours réellement assuré est prioritaire sur les statuts
        // d'une seule jambe. À la gare d'origine théorique, SNCF peut conserver une
        // "arrivée" technique tout en supprimant le départ. Si un nouveau départ est
        // identifié plus loin, cette gare est supprimée : ce n'est pas un terminus.
        // Cas réel 88503 : Nancy, Pont-à-Mousson et Pagny supprimés, départ Metz.
        const isOutsideEffectiveService =
          (newStartIndex >= 0 && index >= 0 && index < newStartIndex) ||
          (newEndIndex >= 0 && index >= 0 && index > newEndIndex);

        // === ARRÊT AJOUTÉ ===
        const isAddedStop =
          !!amended &&
          (!base || !stop) &&
          (imp?.stop_time_effect === 'added' || imp?.departure_status === 'added' || imp?.arrival_status === 'added');

        if (isAddedStop) {
          html += `<td${classAttr}><span class="added-stop" title="Arrêt exceptionnel">${ft(amended)}</span></td>`;
          continue;
        }

        // === cas normal ===
        if (!base) {
          html += `<td${classAttr}>-</td>`;
          continue;
        }

        let content = baseWithVoie || baseClock;

        const isFirstStop = stopName === result.train.stop_times[0]?.stop_point?.name;
        const isLastStop  = stopName === result.train.stop_times[result.train.stop_times.length - 1]?.stop_point?.name;

        // Nouveau terminus en cas de suppression partielle.
        // V47: on ne se contente plus uniquement de result.newEnd, car selon le flux SNCF
        // la gare qui devient terminus (ex: Thionville pour 88501) n'est pas toujours
        // explicitement marquée dans impacted_stops. On détecte donc aussi le dernier arrêt
        // encore desservi juste avant une queue d'arrêts supprimés.
        const hasStopDeletedStatus = (entry) => {
          if (!entry) return false;
          // Ne jamais transformer une suppression d'un seul mouvement en suppression de la gare.
          // Ex. 88501 à Thionville : arrivée maintenue, départ supprimé = terminus exceptionnel.
          const hasPreciseStatuses = !!entry.arrival_status || !!entry.departure_status;
          if (hasPreciseStatuses) {
            return entry.arrival_status === 'deleted' && entry.departure_status === 'deleted';
          }
          return entry.stop_time_effect === 'deleted';
        };
        const isArrivalReallyDeleted = (entry, scheduledStop = null) => !!entry && (
          entry.arrival_status === 'deleted' ||
          (!entry.arrival_status && entry.stop_time_effect === 'deleted') ||
          (!entry.amended_arrival_time && !!(entry.base_arrival_time || scheduledStop?.arrival_time))
        );
        const isDepartureReallyDeleted = (entry, scheduledStop = null) => !!entry && (
          entry.departure_status === 'deleted' ||
          (!entry.departure_status && entry.stop_time_effect === 'deleted') ||
          (!entry.amended_departure_time && !!(entry.base_departure_time || scheduledStop?.departure_time))
        );
        const stopAtIndex = index >= 0 ? result.train.stop_times[index] : null;
        const currentIsDeletedByImpact = hasStopDeletedStatus(imp);
        const hasDeletedAfterCurrent = index >= 0 && result.train.stop_times
          .slice(index + 1)
          .some((s) => hasStopDeletedStatus(result.impacted?.[s.stop_point?.id]));
        const hasServedAfterCurrent = index >= 0 && result.train.stop_times
          .slice(index + 1)
          .some((s) => {
            const nextImp = result.impacted?.[s.stop_point?.id];
            return !hasStopDeletedStatus(nextImp) && (!!s.arrival_time || !!s.departure_time);
          });
        const isTailPartialNewEndStop =
          index >= 0 && index < lastIndex && !currentIsDeletedByImpact &&
          hasDeletedAfterCurrent && !hasServedAfterCurrent;

        const isNewEndStop =
          (
            !!result.newEnd &&
            result.newEnd !== originalEndId &&
            ((stop && stop.stop_point?.id === result.newEnd) || (imp?.stop_point?.id === result.newEnd))
          ) || isTailPartialNewEndStop;

        // CAS SNCF IMPORTANT : arrêt marqué stop_time_effect='deleted', mais arrivée conservée.
        // Exemple 88501 à Thionville : arrival_status='unchanged', departure_status='deleted'.
        // Dans ce cas la gare devient terminus : on affiche l'heure d'ARRIVÉE (07:27), pas le départ supprimé (07:28),
        // et on utilise le style normal de nouvelle gare de départ/arrivée (.new-start), sans patch visuel additionnel.
        const hasDeletedArrivalAfterCurrent = index >= 0 && result.train.stop_times
          .slice(index + 1)
          .some((s) => isArrivalReallyDeleted(result.impacted?.[s.stop_point?.id], s));
        const hasServedArrivalAfterCurrent = index >= 0 && result.train.stop_times
          .slice(index + 1)
          .some((s) => {
            const nextImp = result.impacted?.[s.stop_point?.id];
            if (nextImp) return !isArrivalReallyDeleted(nextImp, s) && !!(nextImp.amended_arrival_time || nextImp.base_arrival_time || s.arrival_time);
            return !!s.arrival_time;
          });
        const hasDeletedDepartureBeforeCurrent = index > 0 && result.train.stop_times
          .slice(0, index)
          .some((s) => isDepartureReallyDeleted(result.impacted?.[s.stop_point?.id], s));
        const hasServedDepartureBeforeCurrent = index > 0 && result.train.stop_times
          .slice(0, index)
          .some((s) => {
            const prevImp = result.impacted?.[s.stop_point?.id];
            if (prevImp) return !isDepartureReallyDeleted(prevImp, s) && !!(prevImp.amended_departure_time || prevImp.base_departure_time || s.departure_time);
            return !!s.departure_time;
          });
        const isDepartureKeptArrivalDeletedNewStart = !!imp
          && !isOutsideEffectiveService
          && !isDepartureReallyDeleted(imp, stop)
          && isArrivalReallyDeleted(imp, stop)
          && !!(imp.amended_departure_time || imp.base_departure_time || stop?.departure_time)
          && index > 0
          && hasDeletedDepartureBeforeCurrent
          && !hasServedDepartureBeforeCurrent;

        if (isDepartureKeptArrivalDeletedNewStart) {
          const terminalScheduledRaw = imp.base_departure_time || stop?.departure_time || imp.amended_departure_time;
          const terminalDepartureRaw = imp.amended_departure_time || terminalScheduledRaw;
          const terminalDepartureClock = ft(terminalDepartureRaw);
          const terminalHasDelay = !!terminalScheduledRaw && !!terminalDepartureRaw && dl(terminalScheduledRaw, terminalDepartureRaw) > 0;
          const terminalScheduledHtml = terminalHasDelay
            ? `<span class="terminal-partial-base" style="color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;text-decoration-line:line-through!important;text-decoration-color:#fff!important;text-shadow:none!important;">${ft(terminalScheduledRaw)}</span>`
            : '';
          const terminalBaseAttr = terminalScheduledRaw ? ` data-base-time="${terminalScheduledRaw}" data-terminal-start="1"` : ' data-terminal-start="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-start-cell"`
            : ' class="terminal-start-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="terminal-partial-stack">${terminalScheduledHtml}<span class="new-start terminal-start-time terminal-partial-new" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalDepartureClock}</span></span><span class="partial-service-label partial-service-label--start">DÉPART EXCEPTIONNEL</span></td>`;
          continue;
        }

        // SNCF : une arrivée maintenue/amendée avec un départ supprimé à un arrêt
        // intermédiaire signifie explicitement que cet arrêt devient le terminus réel.
        // Exemple : une arrivée maintenue à la dernière gare réellement desservie,
        // suivie d'un départ supprimé et d'une queue d'arrêts supprimés.
        const isSncfExplicitPartialTerminal = !!imp
          && !isOutsideEffectiveService
          && imp.arrival_status !== 'deleted'
          && imp.departure_status === 'deleted'
          && !!imp.amended_arrival_time
          && index >= 0
          && index < lastIndex;

        const isArrivalKeptDepartureDeletedTerminal = isSncfExplicitPartialTerminal || (
          !!imp
          && !isOutsideEffectiveService
          && !isArrivalReallyDeleted(imp, stop)
          && isDepartureReallyDeleted(imp, stop)
          && !!(imp.amended_arrival_time || imp.base_arrival_time || stop?.arrival_time)
          && index >= 0
          && index < lastIndex
          && hasDeletedArrivalAfterCurrent
          && !hasServedArrivalAfterCurrent
        );

        if (isArrivalKeptDepartureDeletedTerminal) {
          const terminalScheduledRaw = imp.base_arrival_time || stop?.arrival_time || imp.amended_arrival_time;
          const terminalArrivalRaw = imp.amended_arrival_time || terminalScheduledRaw;
          const terminalArrivalClock = ft(terminalArrivalRaw);
          const terminalHasDelay = !!terminalScheduledRaw && !!terminalArrivalRaw && dl(terminalScheduledRaw, terminalArrivalRaw) > 0;
          const terminalScheduledHtml = terminalHasDelay
            ? `<span class="terminal-partial-base" style="color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;text-decoration-line:line-through!important;text-decoration-color:#fff!important;text-shadow:none!important;">${ft(terminalScheduledRaw)}</span>`
            : '';
          const terminalBaseAttr = terminalScheduledRaw ? ` data-base-time="${terminalScheduledRaw}" data-terminal-arrival="1"` : ' data-terminal-arrival="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-arrival-cell"`
            : ' class="terminal-arrival-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="terminal-partial-stack">${terminalScheduledHtml}<span class="new-start terminal-arrival-time terminal-partial-new" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalArrivalClock}</span></span><span class="partial-service-label partial-service-label--terminus">TERMINUS EXCEPTIONNEL</span></td>`;
          continue;
        }

        const isFull = result.disruptions.some(d => ['NO_SERVICE','CANCELLATION'].includes(d.severity?.effect));
        if (isFull) {
          content = `<span class="deleted">${content}</span>`;
         } else if (isNewStartStop || isNewEndStop) {
          const hasAmended = !!amended;
          const hasBase = !!base;
          const diffMinutes = (hasAmended && hasBase) ? dl(base, amended) : null;
          const mainTimeRaw = hasAmended && (!hasBase || diffMinutes !== 0) ? ft(amended) : (baseWithVoie || baseClock);
          const baseStrike = (hasAmended && hasBase && diffMinutes > 0)
            ? `<span class="delay-strike">${baseWithVoie || baseClock}</span><br>`
            : '';
          content = `${baseStrike}<span class="new-start">${mainTimeRaw}</span>`;
        } else if (
          isStopDeleted ||
          isOutsideEffectiveService
        ) {
          content = `<span class="deleted">${content}</span>`;
        } else if (amended && dl(base, amended) > 0) {
          content = `<span class="delay-stack"><span class="delay-strike">${baseClock}</span><span class="delayed">${ft(amended)}</span>${delayVoieHtml}</span>`;
          } else if (hasDelayFromImpact) {
          const roundedDelay = Math.round(delayFromImpactRaw);
          const fallbackClock = base ? computeRetardedTime(base, delayFromImpactRaw) : null;
          const delayLabel = fallbackClock ? fallbackClock : `+${roundedDelay} min`;
          const baseStrike = base ? `<span class="delay-strike">${baseClock}</span>` : '';
          content = `<span class="delay-stack">${baseStrike}<span class="delayed">${delayLabel}</span>${delayVoieHtml}</span>`;
        } else if (isFirstStop || isLastStop) {
          content = `<strong>${content}</strong>`;
        }

       const baseAttr = base ? ` data-base-time="${base}"` : '';
        html += `<td${classAttr}${baseAttr}>${content}</td>`;
      }

      html += '</tr>';
    }

    html += '</tbody></table>';

    // 6) Injection + hooks + liens (NOUVEL ORDRE)
    injectTableChunkedIntoTrainInfo(html, { chunk: 180 });
    requestAnimationFrame(() => {
      adjustTrainTableRowHeights();
      scrollTrainTableIntoView();
    });

    if (sncfFallback.used) {
      const host = document.getElementById('trainInfo');
      if (host) {
        const table = host.querySelector('table');
        if (table) {
          sncfFallback.details.forEach((reason, num) => {
            const th = table.querySelector(`th[data-train-number="${num}"]`);
            if (th) {
              th.dataset.gtfsFallback = '1';
              if (reason) th.dataset.gtfsFallbackReason = reason;
            }
          });
        }

        const banner = document.createElement('div');
        banner.className = 'sncf-fallback-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'polite');
        const fallbackNumbers = Array.from(sncfFallback.numbers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        let trainsLabel = 'certains trains demandés';
        if (fallbackNumbers.length === sncfNumbers.length && sncfNumbers.length > 0) {
          trainsLabel = 'tous les trains demandés';
        } else if (fallbackNumbers.length === 1) {
          trainsLabel = `le train ${fallbackNumbers[0]}`;
        } else if (fallbackNumbers.length > 1) {
          trainsLabel = `les trains ${fallbackNumbers.join(', ')}`;
        }
        const reasonItems = Array.from(sncfFallback.reasons).map(r => `<li>${escapeHtml(r)}</li>`).join('');
        banner.innerHTML = `
          <strong>⚠️ Données temps réel SNCF indisponibles.</strong>
          Horaires théoriques (GTFS statique) affichés pour ${trainsLabel}.
          ${reasonItems ? `<ul>${reasonItems}</ul>` : ''}
        `;
        host.insertBefore(banner, host.firstChild);
      }
    }


// 6.1 — Liens (idempotent, compatible injection par paquets)
function linkifyGaresAndTrains(root){
  const scope = root || document;
  const applyFavStar = (th) => {
    if (!th || th.dataset.favorite !== '1') return;
    if (th.querySelector('.fav-star')) return;
    const star = document.createElement('span');
    star.className = 'fav-star';
    star.title = 'Favori';
    star.textContent = '★';
    th.appendChild(star);
  };

  // Nettoie les title parasites sur th
  scope.querySelectorAll('th[data-train-number]').forEach(h => h.removeAttribute('title'));

  // Liens colonnes gares (préserve .wx car on ne modifie QUE .gare-label)
  scope.querySelectorAll('#trainInfo table tbody tr td:first-child .gare-label').forEach(label => {
    if (!label || label.querySelector('a.gare-link')) return; // déjà fait
    const nomGare = (label.textContent || '').trim();
    if (!nomGare) return;
    const url = getGareURL(nomGare);
    if (url) {
      label.innerHTML = `<a href="${url}" target="_blank" rel="noopener" class="gare-link">${nomGare}</a>`;
    }
  });

  // Liens entêtes trains (une seule fois suffit, mais idempotent)
  const dateCirculation = $('#trainDate').val();
  scope.querySelectorAll('#trainInfo th[data-train-number]').forEach(th => {
    const numero = th.dataset.trainNumber;
    if (numero.startsWith('CFL-')) {
      const label = th.dataset.trainLabel || formatTrainDisplayLabel(numero);
      const safeLabel = escapeHtml(label);
      const href = 'https://www.cfl.lu/fr-fr';
      const numWrap = th.querySelector('.train-num');
      if (numWrap) {
        const existingLink = numWrap.querySelector('.train-link-cfl');
        if (existingLink) {
          existingLink.textContent = label;
          existingLink.setAttribute('href', href);
        } else {
          numWrap.innerHTML = `<a href="${href}" target="_blank" rel="noopener" class="train-link train-link-cfl">${safeLabel}</a>`;
        }
      } else {
        th.innerHTML = `<span class="train-num"><a href="${href}" target="_blank" rel="noopener" class="train-link train-link-cfl">${safeLabel}</a></span><span class="train-state icon">🚉</span>`;
      }
      applyFavStar(th);
      return;
    }

    const internalHref = `#train-detail-${numero}`;
    const numWrap = th.querySelector('.train-num');
    if (numWrap) {
      const current = numWrap.querySelector('a.train-link');
      if (current) {
        current.href = internalHref;
        current.textContent = numero;
        current.removeAttribute('target');
        current.removeAttribute('rel');
        current.dataset.trainNumber = numero;
        current.dataset.trainDate = dateCirculation || '';
      } else {
        numWrap.innerHTML = `<a href="${internalHref}" class="train-link" data-train-number="${numero}" data-train-date="${dateCirculation || ''}">${numero}</a>`;
      }
    } else {
      th.innerHTML = `<span class="train-num"><a href="${internalHref}" class="train-link" data-train-number="${numero}" data-train-date="${dateCirculation || ''}">${numero}</a></span><span class="train-state icon">🚉</span>`;
    }

    applyFavStar(th);
    if (th.dataset.gtfsFallback === '1' && !th.querySelector('.fallback-pill')) {
      const pill = document.createElement('span');
      pill.className = 'fallback-pill';
      pill.textContent = 'GTFS';
      const reason = th.dataset.gtfsFallbackReason;
      pill.title = reason ? `${reason} — horaires théoriques (GTFS)` : 'Horaires théoriques (GTFS)';
      th.appendChild(pill);
    }
  });
}

// ➜ 1) premier passage immédiat (agit sur les lignes déjà injectées)
linkifyGaresAndTrains(document);

// ➜ 2) observe les paquets qui arrivent puis s’auto-désactive après inactivité
(function observeChunkedRowsOnce(){
  const tbody = document.querySelector('#trainInfo table tbody');
  if (!tbody) return;

  let lastChange = Date.now();
  const obs = new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1) { // élément
          // on linkifie seulement ce qui vient d’arriver
          if (n.matches && n.matches('tr')) linkifyGaresAndTrains(n);
          else linkifyGaresAndTrains(n);
        }
      });
    });
    lastChange = Date.now();
  });

  obs.observe(tbody, { childList: true, subtree: true });

  // petit “kill switch” pour iOS : coupe l’observer après 600 ms sans nouvelles lignes
  const killer = setInterval(() => {
    if (Date.now() - lastChange > 600) {
      clearInterval(killer);
      obs.disconnect();
    }
  }, 250);
})();

// horodatage visible sans attendre
setLastUpdated();

// afficher le bouton refresh tout de suite
// 6.2 — Laisser le rendu respirer, puis lancer les tâches lourdes en parallèle
requestAnimationFrame(() => {
  // GTFS-RT (petit délai pour éviter un “coup de massue”)
  setTimeout(() => {
    if (window.retardsGTFS && (typeof isSelectedDateToday !== 'function' || isSelectedDateToday())) {
      const table = document.querySelector('#trainInfo table');
      if (table) resetGtfsRetards(table);
      if (typeof applyRetardsFromGTFS === 'function') applyRetardsFromGTFS(window.retardsGTFS);
    }
  }, 0);

// météo (iOS-safe, observe le tableau puis démarre tout seul)
scheduleWeatherAfterTableSettled();

  // menu “Aller à une gare”
  hookGareDropdownBehavior();

  // alertes (asynchrone : surtout ne pas "await")
  setTimeout(() => { try { chargerEtAfficherAlertes(); } catch(e){ console.warn('alertes:', e); } }, 0);
});

    function extractTrainNumber(name) {
      if (!name) return '';
      const match = name.match(/\b\d{5,6}\b/);
      return match ? match[0] : '';
    }

    let groupedDisruptions = {};
    LB_TABLE_DISRUPTIONS_BY_TRAIN.clear();
    numbers.forEach(num => {
      const result = results[num];
      if (result && result.disruptions && result.disruptions.length > 0) {
        result.disruptions.forEach(disruption => {
          const effect = disruption.severity?.effect || 'Inconnu';

          // message cause propre
          let causeMessage = disruption.messages?.[0]?.text?.trim();
          if (!causeMessage) {
            causeMessage = (effect === 'MODIFIED_SERVICE')
              ? 'Arrêt exceptionnel en gare'
              : 'Pas de cause renseignée';
          }

          const key = effect + '||' + causeMessage;

          if (!groupedDisruptions[key]) {
            // valeurs par défaut
            let box = 'orange', icon = '⚠️', txt = effect, blink = false;

            if (effect === 'NO_SERVICE' || effect === 'CANCELLATION') {
              box = 'red'; icon = '❌'; txt = 'Bétaillère supprimée'; blink = true;
            } else if (effect === 'REDUCED_SERVICE') {
              box = 'red'; icon = '⚠️'; txt = 'Suppression partielle';
            } else if (effect === 'SIGNIFICANT_DELAYS') {
              box = 'orange'; icon = '⏰'; txt = 'Retard';
            } else if (effect === 'MODIFIED_SERVICE') {
              box = 'orange'; icon = '➕'; txt = 'Parcours modifié';
            }

            groupedDisruptions[key] = {
              effect,
              cause: causeMessage,
              trains: new Set(),
              box,
              icon,
              txt,
              blink
            };
          }

          const displayNum = num.startsWith('CFL-')
            ? formatTrainDisplayLabel(num, { result })
            : num;
          groupedDisruptions[key].trains.add(displayNum);

          // attrape aussi les n° dans impacted_objects
          if (disruption.impacted_objects) {
            disruption.impacted_objects.forEach(obj => {
              if (obj.pt_object?.name) {
                const trainNum = extractTrainNumber(obj.pt_object.name);
                if (trainNum) groupedDisruptions[key].trains.add(trainNum);
              }
            });
          }
        });
      }
    });

    // --- Rendu perturbations ---
    (function(){
      let disruptionsHtml = '';
      const weight = eff => {
        if (eff === 'NO_SERVICE' || eff === 'CANCELLATION') return 1;
        if (eff === 'REDUCED_SERVICE' || eff === 'MODIFIED_SERVICE') return 2;
        if (eff === 'SIGNIFICANT_DELAYS') return 3;
        return 4;
      };
      const sortedGroups = Object.values(groupedDisruptions).sort((a, b) => {
        const wa = weight(a.effect || '');
        const wb = weight(b.effect || '');
        if (wa !== wb) return wa - wb;
        return (b.trains?.size || 0) - (a.trains?.size || 0);
      });
      sortedGroups.forEach(disr => {
        const trainsList = Array.from(disr.trains).sort((a,b) => a.localeCompare(b));
        const detailEntry = {
          key: `d_${++LB_ALERT_SEQ}`,
          level: disr.box === 'red' ? 'red' : (disr.box === 'orange' ? 'orange' : 'info'),
          icon: disr.icon || 'ℹ️',
          title: disr.txt || 'Perturbation',
          description: disr.cause || 'Cause non précisée',
          trains: trainsList.slice()
        };
        LB_ALERTS_BY_KEY.set(detailEntry.key, detailEntry);

        trainsList.forEach((tn) => {
          const key = String((tn || '').replace(/^CFL-/, '')).trim();
          if (!key) return;
          if (!LB_TABLE_DISRUPTIONS_BY_TRAIN.has(key)) LB_TABLE_DISRUPTIONS_BY_TRAIN.set(key, []);
          LB_TABLE_DISRUPTIONS_BY_TRAIN.get(key).push(detailEntry);
          const header = Array.from(document.querySelectorAll('th[data-train-number]')).find(th => extractTrainNumber(th.dataset.trainNumber || '') === extractTrainNumber(key));
          if (header && !header.dataset.alertKeyMain) header.dataset.alertKeyMain = detailEntry.key;
        });

        const trainsHtml = trainsList.length
          ? `<div class="disruption-trains">${trainsList.map(t => `<span class="disruption-train-pill">${t}</span>`).join('')}</div>`
          : '<div class="disruption-empty">Aucun train impacté listé</div>';
        disruptionsHtml += `
          <div class="disruption-box ${disr.box}">
            <div class="disruption-title-row">
              <div class="disruption-icon ${disr.blink ? 'icon-blink' : ''}">${disr.icon}</div>
              <div class="disruption-title-text">${disr.txt}</div>
            </div>
            <div class="disruption-cause">${disr.cause || 'Cause non précisée'}</div>
            ${trainsHtml}
          </div>
        `;
      });

      $('#disruptionsContent').html(`<div class="disruption-grid">${disruptionsHtml}</div>`);
      if (disruptionsHtml.trim() === '') {
        $('#disruptionsContent').html('<p>Aucune perturbation dans vos bétaillères 🦄.</p>');
      }
    })();

    // Nettoie les tooltips train
    document.querySelectorAll('th[data-train-number]').forEach(header => {
      header.removeAttribute('title');
    });

    // Liens gares sur 1ère colonne (préserve .wx)
    document.querySelectorAll('#trainInfo table tr td:first-child').forEach(td => {
      const label = td.querySelector('.gare-label');
      if (!label) return;
      const nomGare = label.textContent.trim();
      const url = getGareURL(nomGare);
      if (url && url !== nomGare) {
        label.innerHTML = `<a href="${url}" target="_blank" class="gare-link">${nomGare}</a>`;
      }
    });

    // Liens vers fiches trains (SNCF & CFL)
    linkifyGaresAndTrains(document);

    // Bouton Actualiser : désormais intégré à droite du "Généré le…" (icône)

    // Résumé perturbations + infos : afficher/masquer
    updateDisruptionsSummaryVisibility();

    // GTFS-RT (si déjà chargés)
    if (window.retardsGTFS) {
      const table = document.querySelector('#trainInfo table');
      if (table) resetGtfsRetards(table);
      if (typeof isSelectedDateToday !== 'function' || isSelectedDateToday()) {
        applyRetardsFromGTFS(window.retardsGTFS);
      }
    } else {
      console.log("Les retards GTFS ne sont pas encore chargés");
    }

    setLastUpdated();

  // *** Appliquer GTFS-RT juste après l'injection (sécurisé DOM) ***
    setTimeout(tryApplyGtfsToCurrentTable, 0);
      } finally {
      GTFSLoadingUI.hide();

    }
    // ===== FIN handler "#loadTrains"

    } finally {
      window.__mainTableBusy = false;
    }
  });

  // Bouton "Actualiser" (icône à droite du "Généré le…") : refetch FRESH puis régénère
const __lbDoRefresh = async () => {
  const statusEl = document.getElementById('lastUpdated');
  const btn = document.getElementById('refreshInline') || document.getElementById('refreshButton');
  if (btn){
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">🔄</span>';
  }
  if (statusEl) statusEl.querySelector?.('.last-updated-text')
    ? (statusEl.querySelector('.last-updated-text').textContent = 'Actualisation en cours…')
    : (statusEl.textContent = 'Actualisation en cours…');

  try {
    await Promise.all([
      loadGtfsRetards({ forceFresh: true }),
      loadVoiesByTrain({ forceFresh: true }).catch(err => {
        console.warn('[Voies] Actualisation échouée', err?.message || err);
        return null;
      }),
      loadCflVoiesByTrain({ forceFresh: true }).catch(err => {
        console.warn('[CFL][Voies] Actualisation échouée', err?.message || err);
        return null;
      })
    ]);
  } catch (e) {
    console.error('[GTFS-RT] Actualiser ->', e);
    alert("Échec de l'actualisation GTFS-RT.\n" + (e && e.message ? e.message : ''));
    if (btn){
      btn.disabled = false;
      btn.textContent = '🔄';
    }
    return; // on ne régénère pas avec des données inchangées
  }

  $('#loadTrains').click();
  setLastUpdated();
  // le bouton inline est recréé par setLastUpdated(), donc rien d'autre à faire
};

// Ancien bouton (si un jour tu le réactives) + nouveau bouton inline
$('#refreshButton').off('click').on('click', __lbDoRefresh);
$(document).off('click', '#refreshInline').on('click', '#refreshInline', (e) => {
  e.preventDefault();
  __lbDoRefresh();
});

});

/* ---------- GTFS-RT : loader centralisé + auto-apply ---------- */
const SAME_ORIGIN_JSON = (()=>{
  // /labetaillere.html -> /retards_cfl.json (si tu le seras un jour en local)
  const base = location.origin + location.pathname.replace(/\/[^\/]*$/, '/');
  return base + 'retards_cfl.json';
})();

// Ordre : proxy toutes les 2 min -> même origine (si jamais tu le copies localement) -> anciens miroirs -> RAW GitHub -> jsDelivr -> API GitHub
const GTFS_RT_DATASETS = [
  {
    id: 'sncf-nml',
    label: 'GTFS-RT Nancy/Metz/Lux',
    filename: 'retards_nancymetzlux.json',
    sources: [
      'https://vps.labetaillere.fr/gtfs/retards_nancymetzlux.json',
      new URL('retards_nancymetzlux.json', location.href).href
    ]
  },
  {
    id: 'sncf-carte',
    label: 'GTFS-RT Carte SNCF (causes)',
    filename: 'retards_carte.json',
    sources: [
      'https://vps.labetaillere.fr/gtfs/retards_carte.json',
      new URL('retards_carte.json', location.href).href
    ]
  },
  {
    id: 'cfl-hafas',
    label: 'GTFS-RT CFL / HAFAS',
    filename: 'retards_cfl.json',
    sources: HAFAS_PROXY_CANDIDATES.slice()
  }
];
    const appendGtfsCacheBuster = (url, forceFresh) =>
  url + (url.includes('?') ? '&' : '?') + 't=' + (forceFresh ? Date.now() : 'soft');

const GTFS_RT_CACHE_KEY = 'gtfsRtMerged';
const GTFS_RT_CACHE_MAX_AGE = 90 * 1000;
const GTFS_RT_USE_CACHED_FIRST = false;

function hydrateGtfsRetardsFromCache(){
  const cached = lbCacheRead(GTFS_RT_CACHE_KEY, GTFS_RT_CACHE_MAX_AGE);
  if (!cached || typeof cached !== 'object') return false;
  if (!cached.normalized || typeof cached.normalized !== 'object') return false;
  window.retardsGTFS_RAW = cached.raw || null;
  window.retardsGTFS = cached.normalized;
  window.retardsGTFS_SOURCE = cached.source || 'cache-local';
  tryApplyGtfsToCurrentTable();
  return true;
}

function persistGtfsRetardsCache(){
  if (!window.retardsGTFS || typeof window.retardsGTFS !== 'object') return;
  lbCacheWrite(GTFS_RT_CACHE_KEY, {
    raw: window.retardsGTFS_RAW || null,
    normalized: window.retardsGTFS,
    source: window.retardsGTFS_SOURCE || 'network'
  });
}

    const GTFS_NORMALIZED_STATION_MAP_KEY = '__gtfsNormalizedStationMap';
const GTFS_TRAIN_META_KEY = '__gtfsTrainMeta';

function getOrInitGtfsNormalizedMap(bucket) {
  let map = bucket[GTFS_NORMALIZED_STATION_MAP_KEY];
  if (!(map instanceof Map)) {
    map = new Map();
    Object.defineProperty(bucket, GTFS_NORMALIZED_STATION_MAP_KEY, {
      value: map,
      enumerable: false,
      configurable: true,
      writable: false
    });
  }
  return map;
}

    function coerceDelayNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickGtfsDelay(existing, candidate) {
  const next = coerceDelayNumber(candidate);
  if (next == null) return coerceDelayNumber(existing);

  const current = coerceDelayNumber(existing);
  if (current == null) return next;

  if (next === current) return current;

  const currentAbs = Math.abs(current);
  const nextAbs = Math.abs(next);

  if (nextAbs > currentAbs) return next;
  if (nextAbs < currentAbs) return current;

  return next > current ? next : current;
}

function storeGtfsDelay(bucket, stopName, delay) {
  const finalValue = pickGtfsDelay(bucket[stopName], delay);
  if (finalValue == null) return;

  bucket[stopName] = finalValue;

  if (typeof normalizeStationName !== 'function') return;

  const norm = normalizeStationName(stopName);
  if (!norm) return;

  const map = getOrInitGtfsNormalizedMap(bucket);
  map.set(norm, finalValue);
}

function setGtfsTrainMeta(bucket, meta) {
  if (!bucket || !meta || typeof meta !== 'object') return;
  const current = bucket[GTFS_TRAIN_META_KEY] || {};
  const next = { ...current, ...meta };
  Object.defineProperty(bucket, GTFS_TRAIN_META_KEY, {
    value: next,
    enumerable: false,
    configurable: true,
    writable: true
  });
}

function getGtfsTrainMeta(bucket) {
  return (bucket && bucket[GTFS_TRAIN_META_KEY]) || {};
}

function isGtfsTrainClearlyRunning(bucket) {
  const meta = getGtfsTrainMeta(bucket);
  const status = String(meta.status || '').toUpperCase();
  const src = String(meta.data_source || meta.source || '').toLowerCase();
  if (['DELAYED','ON_TIME','SCHEDULED','NO_DELAY'].includes(status)) return true;
  if (src.includes('siri') && !['CANCELED','CANCELLED','NO_SERVICE','PARTIAL_CANCELLATION'].includes(status)) return true;
  return false;
}

function mergeGtfsNormalizedPayloads(payloads) {
  const merged = {};
  if (!Array.isArray(payloads)) return merged;

  payloads.forEach(payload => {
    if (!payload || typeof payload !== 'object') return;
    Object.entries(payload).forEach(([trainNumber, stops]) => {
      if (!stops || typeof stops !== 'object') return;
      if (!merged[trainNumber]) merged[trainNumber] = {};
      setGtfsTrainMeta(merged[trainNumber], getGtfsTrainMeta(stops));
      Object.entries(stops).forEach(([stopName, delayValue]) => {
        if (!stopName) return;
        storeGtfsDelay(merged[trainNumber], stopName, delayValue);
      });
    });
  });

  return merged;
}

function parseGtfsDelayValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(',', '.');
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const maybeNumber = Number(normalized);
    return Number.isFinite(maybeNumber) ? maybeNumber : null;
  }
  if (typeof raw === 'object') {
    const candidateKeys = ['delay', 'delay_minutes', 'minutes', 'value', 'retard', 'min', 'delta', 'delayMin', 'rt_delay'];
    for (const key of candidateKeys) {
      if (key in raw) {
        const nested = parseGtfsDelayValue(raw[key]);
        if (nested != null) return nested;
      }
    }
  }
  return null;
}

function normalizeGtfsStops(trainNumber, stops, out) {
  if (!stops) return;

  const ensureTrainBucket = (num) => {
    if (!out[num]) out[num] = {};
    return out[num];
  };

  if (Array.isArray(stops)) {
    const bucket = ensureTrainBucket(trainNumber);
    stops.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const name = entry.stop || entry.stop_name || entry.name || entry.station || entry.gare || entry.label;
      if (!name) return;
      const delay = parseGtfsDelayValue(entry.delay ?? entry.delayMinutes ?? entry.delay_minutes ?? entry.retard ?? entry.minutes ?? entry.value ?? entry.min ?? entry.delta ?? entry);
      if (delay == null) return;
      storeGtfsDelay(bucket, name, delay);
    });
    return;
  }

  if (typeof stops === 'object') {
    const bucket = ensureTrainBucket(trainNumber);
    Object.entries(stops).forEach(([stopName, rawDelay]) => {
      if (!stopName) return;
      const delay = parseGtfsDelayValue(rawDelay);
      if (delay == null) return;
      storeGtfsDelay(bucket, stopName, delay);
    });
  }
}

function normalizeGtfsRetardsPayload(raw) {
  const normalized = {};
  if (!raw) return normalized;

  const AGGREGATOR_KEYS = new Set(['trains', 'services', 'entries', 'results', 'data', 'payload']);
  const TRAIN_PAYLOAD_KEYS = ['train_number', 'train', 'number', 'stops', 'delays', 'points', 'data'];

  const looksLikeTrainPayload = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return TRAIN_PAYLOAD_KEYS.some(key => key in value);
  };

  const ingestTrain = (trainKey, payload) => {
    if (!payload) return;
    const trainNum = String(payload.train_number || payload.train || payload.number || trainKey || '').trim();
    if (!trainNum) return;
    const bucket = normalized[trainNum] || (normalized[trainNum] = {});
    setGtfsTrainMeta(bucket, {
      status: payload.status || payload.trip_status || payload.state || payload.effect || null,
      data_source: payload.data_source || payload.source || null,
      train_id: payload.train_id || payload.trip_id || null,
      updated_at: payload.updated_at || payload.timestamp || payload.generated_at || null
    });

    const candidates = [];
    if (payload.stops !== undefined) candidates.push(payload.stops);
    if (payload.delays !== undefined) candidates.push(payload.delays);
    if (payload.data !== undefined) candidates.push(payload.data);
    if (payload.points !== undefined) candidates.push(payload.points);

    if (candidates.length === 0) {
      candidates.push(payload);
    }

    candidates.forEach(candidate => normalizeGtfsStops(trainNum, candidate, normalized));
  };

  const ingestNested = (value, keyHint) => {
    if (!value) return;

  if (Array.isArray(value)) {
      value.forEach((entry, idx) => {
        if (looksLikeTrainPayload(entry)) {
          ingestTrain(idx, entry);
        } else {
          ingestNested(entry, null);
        }
      });
      return;
    }

    if (typeof value === 'object') {
      if (keyHint && AGGREGATOR_KEYS.has(String(keyHint))) {
        Object.entries(value).forEach(([innerKey, innerPayload]) => {
          if (looksLikeTrainPayload(innerPayload)) {
            ingestTrain(innerKey, innerPayload);
          } else {
            const num = String(innerKey || '').trim();
            if (!num) return;
            normalizeGtfsStops(num, innerPayload, normalized);
          }
        });
        return;
      }

Object.entries(value).forEach(([trainKey, payload]) => {
        if (AGGREGATOR_KEYS.has(trainKey)) {
          ingestNested(payload, trainKey);
          return;
        }

        if (looksLikeTrainPayload(payload)) {
          ingestTrain(trainKey, payload);
        } else {
          const num = String(trainKey || '').trim();
          if (!num) return;
          normalizeGtfsStops(num, payload, normalized);
        }
      });
    }
  };

  ingestNested(raw, null);

  return normalized;
}

async function fetchWithTimeoutNoHeaders(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      // pas de headers custom pour éviter le préflight CORS
      signal: ctrl.signal
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFromGitHubAPI(filename) {
  if (!filename) throw new Error('GitHub API nécessite un nom de fichier.');
  // Dernier fallback : API GitHub Contents (CORS OK), on décode le Base64
  const bases = [
    'https://api.github.com/repos/TekMaTe-lux/Assistant-train/contents/Assistant-train/',
    'https://api.github.com/repos/TekMaTe-lux/Assistant-train/contents/'
  ];
  for (const base of bases) {
    const apiUrl = base + filename;
    try {
      const r = await fetch(apiUrl, {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!r.ok) continue;
      const meta = await r.json();
      if (meta && meta.content) {
        const text = atob(String(meta.content).replace(/\n/g, ''));
        return JSON.parse(text);
      }
    } catch {}
  }
  throw new Error(`GitHub API fallback indisponible pour ${filename}.`);
}

async function fetchGtfsDataset(dataset, { forceFresh = false } = {}) {
  if (!dataset) return null;
  const { sources = [], filename, id, label } = dataset;
  let lastErr = null;

for (const base of sources) {
    const url = appendGtfsCacheBuster(base, forceFresh);
    try {
      console.log(`[GTFS-RT][${label}] tentative:`, url);
      const res = await fetchWithTimeoutNoHeaders(url, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      let data;
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const txt = await res.text();
        data = JSON.parse(txt);
      }

      const normalized = normalizeGtfsRetardsPayload(data);
      return { id, label, source: base, raw: data, normalized };
    } catch (err) {
      lastErr = err;
      console.warn(`[GTFS-RT][${label}] échec sur`, base, err);
    }
  }

  if (filename) {
    try {
      const data = await fetchFromGitHubAPI(filename);
      const normalized = normalizeGtfsRetardsPayload(data);
      return { id, label, source: 'GitHub API', raw: data, normalized };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error(`[GTFS-RT] ${label || id || 'dataset'} indisponible.`);
}

async function loadGtfsRetards({ forceFresh = false, useCachedFirst = false } = {}) {
  if (GTFS_RT_USE_CACHED_FIRST && useCachedFirst && !forceFresh) hydrateGtfsRetardsFromCache();
  const datasetResults = [];
  const rawByDataset = {};
  let lastErr = null;

  for (const dataset of GTFS_RT_DATASETS) {
    try {
      const result = await fetchGtfsDataset(dataset, { forceFresh });
      if (result && result.normalized) {
        datasetResults.push(result);
        rawByDataset[dataset.id] = result.raw;
      }
} catch (err) {
      lastErr = err;
      console.warn(`[GTFS-RT] Source indisponible (${dataset.label}):`, err);
    }
  }

  if (!datasetResults.length) {
    window.retardsGTFS_RAW = null;
    window.retardsGTFS = null;
    window.retardsGTFS_SOURCE = null;
    window.dispatchEvent(new CustomEvent('gtfsrt:error', { detail: { error: String(lastErr) } }));
    throw lastErr || new Error('Impossible de charger GTFS-RT depuis les miroirs.');
  }

const normalized = mergeGtfsNormalizedPayloads(datasetResults.map(r => r.normalized));
  const rawPayload = datasetResults.length === 1 ? datasetResults[0].raw : rawByDataset;
  const sourceLabel = datasetResults.length === 1
    ? datasetResults[0].source
    : datasetResults.map(r => `${r.id}:${r.source}`).join(', ');

  window.retardsGTFS_RAW = rawPayload;
  window.retardsGTFS = normalized;
  window.retardsGTFS_SOURCE = sourceLabel;
  persistGtfsRetardsCache();

  if (normalized && Object.keys(normalized).length === 0) {
    console.warn('[GTFS-RT] Données chargées mais aucun arrêt exploitable trouvé.');
  }

  window.dispatchEvent(new CustomEvent('gtfsrt:loaded', {
    detail: {
      source: window.retardsGTFS_SOURCE,
      data: window.retardsGTFS_RAW,
      normalized,
      datasets: datasetResults,
      rawByDataset
    }
  }));
  console.log('✅ GTFS-RT chargés via', window.retardsGTFS_SOURCE, 'à', new Date().toISOString());
  tryApplyGtfsToCurrentTable();
}

// 1er chargement + rafraîchissement intelligent en arrière-plan
// Composition des favoris : démarrage anticipé. Le preload du <head>
// a déjà lancé le téléchargement pendant le parsing de la page.
const LB_COMPO_EARLY_PROMISE = loadCompoData({ forceFresh: false, background: true })
  .catch((err) => {
    console.warn('[COMPO] Préchargement anticipé échoué', err?.message || err);
    return null;
  });

const LB_BG_REFRESH_STATE = { timer: null, inFlight: false };

async function refreshLiveDataInBackground({ forceFresh = false } = {}){
  if (!navigator.onLine || document.hidden) return;
  if (LB_BG_REFRESH_STATE.inFlight) return;
  LB_BG_REFRESH_STATE.inFlight = true;
  try {
    await Promise.allSettled([
      loadCompoData({ forceFresh, background: true }),
      loadVoiesByTrain({ forceFresh, onlyIfChanged: true }),
      (typeof loadCflVoiesByTrain === 'function' ? loadCflVoiesByTrain({ forceFresh, onlyIfChanged: true }) : Promise.resolve())
      // Pas de loadGtfsRetards() ici : évite les déclenchements lourds au démarrage.
    ]);
  } finally {
    LB_BG_REFRESH_STATE.inFlight = false;
  }
}

function scheduleBackgroundRefresh(immediate = false){
  if (LB_BG_REFRESH_STATE.timer) clearTimeout(LB_BG_REFRESH_STATE.timer);
  LB_BG_REFRESH_STATE.timer = null;
  if (document.hidden || !navigator.onLine) return;
  const delay = immediate ? 1500 : 75 * 1000;
  LB_BG_REFRESH_STATE.timer = setTimeout(async () => {
    await refreshLiveDataInBackground({ forceFresh: false });
    scheduleBackgroundRefresh(false);
  }, delay);
}

window.addEventListener('load', () => {
  // Charge d'abord le strict nécessaire puis échelonne le reste pour éviter un pic CPU/réseau au démarrage.
  // Compotrains est déjà préchargé avant window.load.
  setTimeout(() => {
    lbRunInBackground(() => {
      loadVoiesByTrain({ forceFresh: false, onlyIfChanged: false })
        .catch(err => console.warn('[Voies] Préchargement échoué', err?.message || err));
    });
  }, 180);

  // Pas de loadGtfsRetards() au démarrage : évite le chargement de stop_times.txt.

  lbRunInBackground(() => {
    // Pas de second téléchargement Compotrains immédiat : le prochain contrôle
    // normal est planifié à 75 s lorsque la page est visible.
    scheduleBackgroundRefresh(false);
  });
});

window.addEventListener('online', () => scheduleBackgroundRefresh(true), { passive:true });
window.addEventListener('offline', () => scheduleBackgroundRefresh(false), { passive:true });
document.addEventListener('visibilitychange', () => {
  scheduleBackgroundRefresh(!document.hidden);
}, { passive:true });

// GTFS lourd désactivé au démarrage : ne pas lancer ensureGTFSLoaded() automatiquement.
// Le chargement statique complet reste possible uniquement à la demande (ex: LIVE ouvert).

// applique si tableau présent + date = aujourd’hui
function tryApplyGtfsToCurrentTable() {
  if (typeof isSelectedDateToday === 'function' && !isSelectedDateToday()) return;
  if (!window.retardsGTFS) return;
  const table = document.querySelector('#trainInfo table');
  if (!table) return;
  resetGtfsRetards(table);
  if (typeof applyRetardsFromGTFS === 'function') applyRetardsFromGTFS(window.retardsGTFS);
}

/* ---------- TIMESTAMP ---------- */
function setLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  const nowTxt = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Luxembourg',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).replace(',', ' à');
  const d = document.getElementById('trainDate')?.value || '';
  let validTxt = '—';
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-');
    validTxt = `${day}/${m}/${y}`;
  }
  el.innerHTML = `<span class="last-updated-text">Généré le ${nowTxt} — Données valables le <strong>${validTxt}</strong></span>` + ` <button id="refreshInline" class="refresh-inline-btn" type="button" title="Actualiser les données" aria-label="Actualiser les données">🔄</button>`;
}
function todayYMDLux(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Luxembourg',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p=>p.type==='year').value;
  const m = parts.find(p=>p.type==='month').value;
  const d = parts.find(p=>p.type==='day').value;
  return `${y}-${m}-${d}`; // "YYYY-MM-DD"
}

function selectedDateYMD(){
  const inp = document.getElementById('trainDate');
  const v = inp?.value || '';
  return (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
}

function isSelectedDateToday(){
  const sel = selectedDateYMD();
  if (!sel) return true;           // pas de date => on considère aujourd’hui
  return sel === todayYMDLux();
}

/* ---------- APPLICATION DES RETARDS GTFS-RT DANS LE TABLEAU (robuste iOS) ---------- */
function resetGtfsRetards(scope) {
  const root = scope && typeof scope.querySelectorAll === 'function'
    ? scope
    : document.querySelector('#trainInfo');
  if (!root) return;

  const cells = root.matches && root.matches('td')
    ? [root]
    : Array.from(root.querySelectorAll ? root.querySelectorAll('td') : []);

  cells.forEach(cell => {
    if (!cell) return;
    if (cell.__gtfsOriginalContent != null) {
      cell.innerHTML = cell.__gtfsOriginalContent;
      cell.__gtfsOriginalContent = null;
    }
    if (cell.dataset && 'gtfsDelayMinutes' in cell.dataset) {
      delete cell.dataset.gtfsDelayMinutes;
    }
    const badge = cell.querySelector && cell.querySelector('.gtfs-retard');
    if (badge && badge.parentNode === cell && cell.__gtfsOriginalContent == null) {
      badge.remove();
    }
  });
}function applyRetardsFromGTFS(data) {
  const table = document.querySelector("#trainInfo table");
  if (!table) { console.log("⛔ Le tableau n'est pas encore généré !"); return; }

  const headRow = table.querySelector('thead tr:first-child');
  if (!headRow) { console.log("[GTFS-RT] Pas d'en-tête."); return; }

  const headerThs = Array.from(headRow.querySelectorAll('th[data-train-number]'));
  if (!headerThs.length) { console.log("[GTFS-RT] Aucun th[data-train-number]."); return; }

  const headerNumbers = headerThs.map(th => (th.dataset.trainNumber || '').trim()).filter(Boolean);
  const tbody = table.tBodies && table.tBodies[0];
  const bodyRows = tbody ? Array.from(tbody.rows) : Array.from(table.querySelectorAll('tbody tr'));
  if (!bodyRows.length) { console.log("[GTFS-RT] Aucun body row — rien à appliquer."); return; }

  for (const row of bodyRows) {
    if (!row) continue;
    const gare = row.dataset.gare || row.querySelector('.gare-label')?.textContent?.trim() || row.cells?.[0]?.textContent?.trim() || '';
    if (!gare) continue;

    for (let i = 0; i < headerNumbers.length; i++) {
      const trainNumber = headerNumbers[i];
      const cell = row.cells?.[i + 1];
      if (!trainNumber || !cell) continue;

      const perTrain = data?.[trainNumber];
      if (!perTrain) { resetGtfsRetards(cell); continue; }

      let retardMinutesValue = perTrain[gare];
      if (retardMinutesValue == null && typeof normalizeStationName === 'function') {
        const targetNorm = normalizeStationName(gare);
        if (targetNorm) {
          const normalizedLookup = perTrain[GTFS_NORMALIZED_STATION_MAP_KEY];
          if (normalizedLookup instanceof Map && normalizedLookup.has(targetNorm)) {
            retardMinutesValue = normalizedLookup.get(targetNorm);
          }
          if (retardMinutesValue == null) {
            for (const [stopName, value] of Object.entries(perTrain)) {
              if (normalizeStationName(stopName) === targetNorm) {
                retardMinutesValue = value;
                if (normalizedLookup instanceof Map) normalizedLookup.set(targetNorm, value);
                break;
              }
            }
          }
        }
      }

      const retardMinutes = retardMinutesValue == null ? null : Number(retardMinutesValue);
      const gtfsSaysRunning = (typeof isGtfsTrainClearlyRunning === 'function') && isGtfsTrainClearlyRunning(perTrain);

      // IMPORTANT #BER : si GTFS-RT/SIRI dit que le train circule, on écrase les suppressions SNCF/HUB périmées.
      // C'est le cas typique 88505 : API SNCF restée bloquée en suppression partielle, GTFS-RT revenu en DELAYED.
      const hasSuppression = cell.querySelector('.deleted, .delay-strike, .strike, .cancelled');
      const storedSncfHtml = cell.__gtfsOriginalContent || '';
      const hasExplicitSncfRealtime =
        cell.dataset.terminalArrival === '1' ||
        cell.dataset.terminalStart === '1' ||
        !!cell.querySelector('.delay-stack') ||
        (typeof storedSncfHtml === 'string' && storedSncfHtml.includes('delay-stack'));

      if (hasExplicitSncfRealtime) {
        // Le rendu SNCF contient déjà l'heure théorique + l'heure amendée.
        // Ne pas laisser GTFS-RT recolorer/remplacer ces données explicites.
        if (cell.__gtfsOriginalContent != null) resetGtfsRetards(cell);
        continue;
      }

      const baseTimeRaw = cell.dataset.baseTime || null;
      const canOverrideStaleSncfSuppression = gtfsSaysRunning && Number.isFinite(retardMinutes) && baseTimeRaw;
      const hasDelay = Number.isFinite(retardMinutes) && retardMinutes > 0 && (!hasSuppression || canOverrideStaleSncfSuppression);

      if (gtfsSaysRunning && Number.isFinite(retardMinutes) && retardMinutes <= 0 && hasSuppression && baseTimeRaw) {
        if (cell.__gtfsOriginalContent == null) cell.__gtfsOriginalContent = cell.innerHTML;
        cell.innerHTML = `<span class="gtfs-restored">${escapeHtml(ft(baseTimeRaw))}</span>`;
        cell.dataset.gtfsDelayMinutes = '0';
        continue;
      }

      if (hasDelay) {
        const originalHtml = cell.__gtfsOriginalContent != null ? cell.__gtfsOriginalContent : cell.innerHTML;
        if (cell.__gtfsOriginalContent == null) cell.__gtfsOriginalContent = originalHtml;

        const delayedClock = computeRetardedTime(baseTimeRaw, retardMinutes);
        const roundedDelay = Math.round(retardMinutes);
        const displayValue = delayedClock || `+${roundedDelay} min`;
        const isTerminalPartial = cell.dataset.terminalArrival === '1' || cell.dataset.terminalStart === '1';

        let wrapper = cell.querySelector('.gtfs-retard');
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.className = 'gtfs-retard';
        }
        if (canOverrideStaleSncfSuppression) wrapper.classList.add('gtfs-retard--restored');

        const originalVoie = cell.querySelector('.voie-badge');
        const voieLabelRaw = originalVoie ? (originalVoie.textContent || '').trim() : '';
        const baseSpan = document.createElement('span');
        baseSpan.className = isTerminalPartial ? 'gtfs-retard-base terminal-partial-base' : 'gtfs-retard-base';
        baseSpan.textContent = baseTimeRaw ? ft(baseTimeRaw) : (cell.textContent || '').trim();

        const newSpan = document.createElement('span');
        newSpan.className = isTerminalPartial ? 'gtfs-retard-new terminal-partial-new' : 'gtfs-retard-new';
        newSpan.textContent = displayValue;

        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        wrapper.appendChild(baseSpan);
        wrapper.appendChild(newSpan);
        if (voieLabelRaw) {
          const voieWrap = document.createElement('span');
          voieWrap.className = 'delay-voie';
          voieWrap.innerHTML = `<span class="voie-badge">${escapeHtml(voieLabelRaw)}</span>`;
          wrapper.appendChild(voieWrap);
        }
        wrapper.dataset.delayMinutes = String(retardMinutes);

        const baseClock = baseTimeRaw ? ft(baseTimeRaw) : null;
        if (baseClock && Number.isFinite(roundedDelay)) {
          let tooltip = `Heure théorique ${baseClock} – retard GTFS-RT ${roundedDelay} min`;
          if (delayedClock) tooltip += ` → passage attendu ${delayedClock}`;
          if (canOverrideStaleSncfSuppression) tooltip += ' · suppression SNCF ignorée car GTFS-RT indique que le train circule';
          wrapper.setAttribute('title', tooltip);
        } else if (Number.isFinite(roundedDelay)) {
          wrapper.setAttribute('title', `Retard GTFS-RT estimé ${roundedDelay} min`);
        } else {
          wrapper.removeAttribute('title');
        }

        while (cell.firstChild) cell.removeChild(cell.firstChild);
        cell.appendChild(wrapper);
        if (isTerminalPartial) {
          const terminalLabel = document.createElement('span');
          const isArrivalTerminal = cell.dataset.terminalArrival === '1';
          terminalLabel.className = isArrivalTerminal
            ? 'partial-service-label partial-service-label--terminus'
            : 'partial-service-label partial-service-label--start';
          terminalLabel.textContent = isArrivalTerminal ? 'TERMINUS EXCEPTIONNEL' : 'DÉPART EXCEPTIONNEL';
          cell.appendChild(terminalLabel);
        }
        cell.dataset.gtfsDelayMinutes = String(retardMinutes);
      } else {
        resetGtfsRetards(cell);
      }
    }
  }
}
/* ---------- ALERTES ---------- */
const urlAlertes = 'https://vps.labetaillere.fr/gtfs/alertes_sillon_lorrain.json';
const urlSiriAlertes = 'https://vps.labetaillere.fr/gtfs/siri_sx_alertes.json';
const LB_ALERTS_BY_TRAIN = new Map();
const LB_ALERTS_BY_KEY = new Map();
const LB_TABLE_DISRUPTIONS_BY_TRAIN = new Map();
let LB_ALERT_SEQ = 0;
const motsCles = Array.from(new Set([
  ...garesParLigne.map(g => g.nom),
  'CFL','Moselle','Meurthe-et-Moselle','Luxembourg','Lorraine'
]));

const causesMap = {
  1: {prio: 1, couleur: '#dc3545', icone: '❌', label: 'Suppression (NO_SERVICE)'},
  2: {prio: 2, couleur: '#ffc107', icone: '⚠️', label: 'Service réduit (REDUCED_SERVICE)'},
  3: {prio: 3, couleur: '#ffc107', icone: '⚠️', label: 'Service modifié (MODIFIED_SERVICE)'},
  6: {prio: 4, couleur: '#fd7e14', icone: '⏰', label: 'Retards importants (SIGNIFICANT_DELAYS)'},
  5: {prio: 5, couleur: '#17a2b8', icone: '🔄', label: 'Détournement (DETOUR)'},
  8: {prio: 6, couleur: '#a7a728', icone: '🚌', label: 'Service additionnel (ADDITIONAL_SERVICE)'},
  9: {prio: 7, couleur: '#a7a728', icone: '🔧', label: 'Travaux (OTHER_EFFECT)'},
  10:{prio: 8, couleur: '#a7a728', icone: '🔧', label: 'Travaux (OTHER_EFFECT)'}
};
function getStyleParCauseCode(code) {
  return causesMap[code] || {prio: 999, couleur: '#6c757d', icone: 'ℹ️', label: 'Cause inconnue'};
}
function contientMotCle(texte, mots) {
  if (!texte) return false;
  const texteMin = texte.toLowerCase();
  return mots.some(mot => texteMin.includes(mot.toLowerCase()));
}
function formatDate(d) {
  if (!d) return 'N/A';
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function extraireNumeroTrainDepuisTripId(tripId){ return extractTrainNumber(tripId); }
function nettoyerNumeroTrain(numero){ return extractTrainNumber(numero); }
function getDisplayedTrainNumbers() {
  const headers = document.querySelectorAll("table tr th[data-train-number]");
  return Array.from(headers)
    .map(th => nettoyerNumeroTrain(th.dataset.trainNumber.trim()))
    .filter(n => n !== null);
}
/* ====== Filtres DYNAMIQUES basés sur les trains affichés ====== */

// Récupère vite les arrêts d'un trip
function getStopsForTripQuick(trip_id){
  if (GTFS?._stopTimesByTripSec && GTFS._stopTimesByTripSec.get(trip_id)) {
    return GTFS._stopTimesByTripSec.get(trip_id).map(r=>r.stop_id);
  }
  // fallback si l'index n'est pas prêt — sécurisé si le GTFS lourd n'est pas chargé côté navigateur
  const stopTimes = Array.isArray(GTFS?.stopTimes) ? GTFS.stopTimes : [];
  return stopTimes.filter(st=>st.trip_id===trip_id).map(st=>st.stop_id);
}

// Construit les sets à partir des colonnes du tableau (trains affichés)
function buildDisplayedFilters(ymd){
  const displayedNums = new Set(getDisplayedTrainNumbers()); // ex: ["88753","88532",...]
  const tripIds = new Set();
  const routeIds = new Set();
  const stopIds = new Set();

  // V31: le tableau peut venir du VPS sans que le GTFS lourd soit chargé dans le navigateur.
  // Dans ce cas on garde au minimum displayedNums, et entityTargetsDisplayed()
  // saura matcher les alertes SNCF via le numéro dans trip_id (ex: OCESN88534F).
  const trips = Array.isArray(GTFS?.trips) ? GTFS.trips : [];
  for (const t of trips){
    if (typeof serviceActiveForDate === 'function' && !serviceActiveForDate(t.trip_id, ymd)) continue;
    const n = extractTrainNumber(t.trip_short_name || t.trip_id || '');
    if (!n || !displayedNums.has(n)) continue;

    tripIds.add(t.trip_id);
    if (t.route_id) routeIds.add(t.route_id);
    for (const sid of getStopsForTripQuick(t.trip_id)) stopIds.add(sid);
  }
  return { displayedNums, tripIds, routeIds, stopIds };
}

// Une entité touche nos trains/ligne affichés ?
function entityTargetsDisplayed(ent, sets){
  // trip direct
  const entTrip = ent.trip_id || ent.vehicle_journey_id || null;
  if (entTrip && sets.tripIds.has(entTrip)) return true;

  // route de nos trains
  if (ent.route_id && sets.routeIds.has(ent.route_id)) return true;

  // arrêt parcouru par nos trains
  if (ent.stop_id && sets.stopIds.has(ent.stop_id)) return true;

  // n° de train dans le texte libre de l'entité
  const blob = [ent.name, ent.trip_id, ent.vehicle_journey_id, ent.route_id].filter(Boolean).join(' ');
  const num = extractTrainNumber(blob);
  if (num && sets.displayedNums.has(num)) return true;

  return false;
}

// Une alerte touche nos trains/ligne affichés ?
function alertTargetsDisplayed(alert, sets){
  const ents = alert.informed_entities || [];
  if (ents.length === 0) return false;
  return ents.some(ent => entityTargetsDisplayed(ent, sets));
}

// Fallback mots-clés (uniquement si AUCUNE entité structurée)
function keywordStrictCorridor(text, desc){
  const s = (text||'') + ' ' + (desc||'');
  const sl = s.toLowerCase();
  const hasMetzOrNancy = /(?:\b|_)(metz|nancy)(?:\b|_)/.test(sl);
  const hasNorth = /(?:\b|_)(thionville|luxembourg|bettembourg|hettange|rodange|esch|dudelange|volmerange)(?:\b|_)/.test(sl);
  const hasOurStations = garesParLigne.some(g => sl.includes(g.nom.toLowerCase()));
  // on exige au moins un pôle sud (Metz/Nancy) ET un pôle nord (Thionville/Lux/etc.) ET une gare de la ligne
  return hasMetzOrNancy && hasNorth && hasOurStations;
}

function updateDisruptionsSummaryVisibility(){
  const panel = document.getElementById('disruptionsSummary');
  const content = document.getElementById('disruptionsContent');
  if (!panel || !content) return;

  const hasContent = String(content.textContent || '').trim().length > 0;
  panel.dataset.hasContent = hasContent ? '1' : '0';

  if (!hasContent) {
    panel.style.display = 'none';
    return;
  }

  const activeTab = document.querySelector('#tableauViewNav [data-tableau-view].is-active');
  const activeView = activeTab ? activeTab.getAttribute('data-tableau-view') : '';
  const hasTable = !!document.querySelector('#trainInfo table');

  if (!hasTable || activeView === 'perturbations') {
    panel.style.display = 'flex';
  } else {
    panel.style.display = 'none';
  }
}

async function chargerEtAfficherAlertes() {
  const container = document.getElementById('disruptionsContent');
  if (!container) return;

  LB_ALERTS_BY_TRAIN.clear();
  LB_ALERTS_BY_KEY.clear();

  const selectedDateInput = document.getElementById('trainDate');
  let selectedDate = new Date();
  if (selectedDateInput && selectedDateInput.value) {
    const parts = selectedDateInput.value.split('-');
    selectedDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  } else {
    selectedDate = new Date();
    selectedDate.setHours(12, 0, 0, 0);
  }

  const ymd = `${selectedDate.getFullYear()}${String(selectedDate.getMonth()+1).padStart(2,'0')}${String(selectedDate.getDate()).padStart(2,'0')}`;

  try { if (typeof ensureGTFSLoaded === 'function') await ensureGTFSLoaded({ silent: true }); } catch(e){ console.warn('GTFS non chargé pour alertes:', e); }
  try { if (typeof ensureTransferIndexesBuilt === 'function') ensureTransferIndexesBuilt(); } catch(e){ console.warn('Index alertes non construit:', e); }   // accélère getStopsForTripQuick
  try { if (typeof buildStationGroups === 'function') buildStationGroups(); } catch(e){ console.warn('Groupes gares alertes non construits:', e); }

  // Utilitaires locaux : texte brut pour les recherches + HTML nettoyé pour l'affichage.
  const stripHtml = (s) => {
    const doc = new DOMParser().parseFromString(String(s || ''), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const normalizeAlertText = (s) => stripHtml(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const ALERT_CORRIDOR_PLACE_GROUPS = [
    ['nancy'], ['champigneulles'], ['frouard'], ['pompey'], ['dieulouard'],
    ['pont-a-mousson', 'pont a mousson'], ['pagny-sur-moselle', 'pagny'],
    ['noveant'], ['ars-sur-moselle'], ['metz'], ['woippy'], ['maizieres-les-metz'],
    ['hagondange'], ['uckange'], ['thionville'], ['hettange-grande', 'hettange'],
    ['zoufftgen'], ['bettembourg'], ['luxembourg']
  ];
  const ALERT_OUTSIDE_CORRIDOR_PLACES = [
    'varangeville', 'luneville', 'saint-nicolas-de-port', 'saint nicolas de port',
    'dombasle', 'blainville', 'epinal', 'remiremont', 'saint-die', 'saint die',
    'sarrebourg', 'saverne', 'strasbourg', 'bar-le-duc', 'bar le duc',
    'toul', 'longwy', 'verdun'
  ];
  const alertIsOutsideCorridorOnly = (value) => {
    const text = normalizeAlertText(value);
    if (!ALERT_OUTSIDE_CORRIDOR_PLACES.some((place) => text.includes(place))) return false;
    const corridorHits = ALERT_CORRIDOR_PLACE_GROUPS
      .filter((aliases) => aliases.some((place) => text.includes(place)));
    return corridorHits.length < 2;
  };

  function sanitizeAlertHtml(rawHtml, titleText = '') {
    const doc = new DOMParser().parseFromString(String(rawHtml || ''), 'text/html');
    const allowedTags = new Set(['P','BR','A','STRONG','B','EM','I','UL','OL','LI','SPAN']);

    doc.body.querySelectorAll('*').forEach((el) => {
      if (!allowedTags.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        return;
      }

      // Conserver href avant le nettoyage des attributs, sinon tous les liens disparaissent.
      const originalHref = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';
      Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));

      if (el.tagName === 'A') {
        let safeHref = '';
        try {
          const url = new URL(originalHref, window.location.href);
          if (url.protocol === 'https:' || url.protocol === 'http:') safeHref = url.href;
        } catch (_) {}

        if (!safeHref) {
          el.replaceWith(...el.childNodes);
          return;
        }
        el.setAttribute('href', safeHref);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // Supprime seulement le premier paragraphe lorsqu'il répète exactement le titre.
    const titleNorm = normalizeAlertText(titleText);
    const firstBlock = Array.from(doc.body.children).find((el) => normalizeAlertText(el.textContent));
    if (firstBlock && titleNorm && normalizeAlertText(firstBlock.textContent) === titleNorm) {
      firstBlock.remove();
    }

    doc.body.querySelectorAll('p, span, li').forEach((el) => {
      if (!normalizeAlertText(el.textContent) && !el.querySelector('a, br')) el.remove();
    });

    return doc.body.innerHTML.trim();
  }

  function alertActiveForDate(alert, dateObj) {
    const startMs = (alert.active_period_start != null) ? alert.active_period_start * 1000 : -Infinity;
    const endMs   = (alert.active_period_end   != null) ? alert.active_period_end   * 1000 :  Infinity;
    const dayStart = new Date(dateObj.getTime()); dayStart.setHours(0,0,0,0);
    const dayEnd   = new Date(dateObj.getTime()); dayEnd.setHours(23,59,59,999);
    // active si l’intervalle d’alerte recouvre au moins une partie de la journée choisie
    return Math.max(startMs, dayStart.getTime()) <= Math.min(endMs, dayEnd.getTime());
  }

  const existingInfo = document.getElementById('alertesInline');
  if (existingInfo) existingInfo.remove();
  updateDisruptionsSummaryVisibility();

  const cacheBust = "?t=" + new Date().getTime();
  Promise.all([
    fetch(urlAlertes + cacheBust).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} sur ${urlAlertes}`);
      return response.json();
    }),
    fetch(urlSiriAlertes + cacheBust).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} sur ${urlSiriAlertes}`);
      return response.json();
    }).catch((error) => {
      // Une panne SIRI ne doit jamais empêcher l'affichage des alertes GTFS.
      console.warn('[alertes] SIRI indisponible, GTFS conservé :', error);
      return { situations: [] };
    })
  ])
    .then(([alertesRaw, siriRaw]) => {
      const alertes = Array.isArray(alertesRaw) ? alertesRaw.slice() : [];
      const siriSituations = Array.isArray(siriRaw?.situations) ? siriRaw.situations : [];

      let infoWrapper = document.getElementById('alertesInline');
      if (!infoWrapper) {
        infoWrapper = document.createElement('div');
        infoWrapper.id = 'alertesInline';
        infoWrapper.className = 'disruption-grid';
        container.appendChild(infoWrapper);
      }
      infoWrapper.innerHTML = '';

      // ⚙️ sets construits à partir des trains AFFICHÉS
      const sets = buildDisplayedFilters(ymd);

      /*
       * Normalisation SIRI -> modèle déjà utilisé par le rendu GTFS.
       * La pertinence repose sur les trains affectés et la période, jamais sur un mot isolé.
       * Les doublons SIRI portant le même texte sont fusionnés avant affichage.
       */
      const escapeAlertHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));

      const siriGroups = new Map();
      siriSituations.forEach((situation) => {
        if (!situation || typeof situation !== 'object') return;
        const fullText = String(situation.detail || situation.description || '').trim();
        const dedupeKey = normalizeAlertText(fullText || situation.summary || situation.situation_number || '');
        if (!dedupeKey) return;

        if (!siriGroups.has(dedupeKey)) {
          siriGroups.set(dedupeKey, {
            ...situation,
            affects: Array.isArray(situation.affects) ? situation.affects.slice() : [],
            links: Array.isArray(situation.links) ? situation.links.slice() : []
          });
          return;
        }

        const current = siriGroups.get(dedupeKey);
        current.affects.push(...(Array.isArray(situation.affects) ? situation.affects : []));
        const knownUrls = new Set(current.links.map((link) => String(link?.url || '')));
        (Array.isArray(situation.links) ? situation.links : []).forEach((link) => {
          const url = String(link?.url || '');
          if (url && !knownUrls.has(url)) {
            current.links.push(link);
            knownUrls.add(url);
          }
        });
      });

      siriGroups.forEach((situation) => {
        const entities = [];
        (Array.isArray(situation.affects) ? situation.affects : []).forEach((affected) => {
          (Array.isArray(affected?.vehicle_journeys) ? affected.vehicle_journeys : [])
            .forEach((ref) => entities.push({ vehicle_journey_id: String(ref) }));
          (Array.isArray(affected?.stop_points) ? affected.stop_points : [])
            .forEach((ref) => entities.push({ stop_id: String(ref) }));
        });

        // Une situation sans aucun périmètre structuré ne doit pas créer une carte globale.
        if (!entities.length) return;

        const periods = Array.isArray(situation.validity_periods)
          ? situation.validity_periods
          : [];
        const starts = periods.map((p) => Date.parse(p?.start || '')).filter(Number.isFinite);
        const ends = periods.map((p) => Date.parse(p?.end || '')).filter(Number.isFinite);
        let shortDescription = String(situation.description || situation.detail || '').trim();
        const fullDescription = String(situation.detail || situation.description || '').trim();

        // Le flux multilingue SNCF place souvent DE avant FR. Tant que le collecteur
        // n'a pas fourni la langue, on privilégie le détail français et on masque
        // une situation exclusivement allemande.
        const looksGerman = (value) => /\b(weitere|informationen|aufgrund|zug(?:es)?|züge|verkehr|sicherheitsgründen|wird|werden|zwischen)\b/i.test(String(value || ''));
        const looksFrench = (value) => /\b(circulation|train|trains|travaux|retard|information|sécurité|supprimé|remplacé|votre|entre|les|des)\b/i.test(String(value || ''));
        if (looksGerman(shortDescription) && looksFrench(fullDescription)) {
          shortDescription = fullDescription;
        }
        if (looksGerman(fullDescription) && !looksFrench(fullDescription)
            && looksGerman(shortDescription) && !looksFrench(shortDescription)) {
          return;
        }

        const searchable = normalizeAlertText(`${shortDescription} ${fullDescription}`);

        let title = String(situation.summary || '').trim();
        if (/^(weitere informationen|more info|más información|maggiori informazioni|meer informatie)\s*:?$/i.test(title)) {
          title = 'Information trafic';
        }
        if (!title && /thionville/.test(searchable) && /luxembourg/.test(searchable)
            && /(travaux|supprim|remplac|cars?)/.test(searchable)) {
          title = 'Travaux Thionville–Luxembourg';
        }
        if (!title) {
          const firstSentence = shortDescription.split(/(?<=[.!?])\s+/)[0] || 'Information trafic';
          title = firstSentence.length > 92 ? `${firstSentence.slice(0, 89)}…` : firstSentence;
        }

        const detailBody = escapeAlertHtml(fullDescription).replace(/\n/g, '<br>');
        const linksHtml = (Array.isArray(situation.links) ? situation.links : [])
          .filter((link) => /^https?:\/\//i.test(String(link?.url || '')))
          .map((link) => {
            const rawLabel = String(link?.label || '').trim();
            const label = normalizeAlertText(rawLabel) === 'ici'
              ? 'Fiche informative'
              : (rawLabel || 'En savoir plus');
            return `<a href="${escapeAlertHtml(link.url)}">${escapeAlertHtml(label)}</a>`;
          })
          .join(' · ');

        alertes.push({
          header_text: title,
          description_text: `<p>${escapeAlertHtml(shortDescription)}</p>`,
          detail_html: `<p>${detailBody}</p>${linksHtml ? `<p class="alert-source-links">${linksHtml}</p>` : ''}`,
          cause: '',
          effect: 9,
          active_period_start: starts.length ? Math.floor(Math.min(...starts) / 1000) : null,
          active_period_end: ends.length ? Math.floor(Math.max(...ends) / 1000) : null,
          informed_entities: entities,
          source: 'SIRI-SX',
          source_id: String(situation.situation_number || '')
        });
      });

      // Nettoyage des états visuels d'alertes du tableau.
      // Important : on vide aussi le Set global, sinon les favoris peuvent rester en "réduit"
      // après une nouvelle recherche alors que l'alerte n'est plus pertinente.
      try { if (window.lbReducedSeats) window.lbReducedSeats.clear(); } catch(e) {}
      document.querySelectorAll('th[data-train-number]').forEach((header) => {
        header.classList.remove('reduced-seats');
        header.removeAttribute('data-alert-key-main');
        header.querySelectorAll('.reduced-seat-icon, .train-alert-icon').forEach((node) => node.remove());
      });

      // 1) Filtrage strict : actif + touche nos trips/routes/stops affichés
      let alertesFiltres = alertes.filter((a) => {
        if (!a || typeof a !== 'object') return false;

        const activeNow = alertActiveForDate(a, selectedDate);
        if (!activeNow) return false;

        const geographicText = [
          a.header_text,
          a.description_text,
          a.detail_html
        ].filter(Boolean).join(' ');
        if (alertIsOutsideCorridorOnly(geographicText)) return false;

        // 1) entités structurées
        if (alertTargetsDisplayed(a, sets)) return true;

        // 2) fallback mots-clés strict SEULEMENT si pas d’entités
        const ents = Array.isArray(a.informed_entities) ? a.informed_entities : [];
        if (ents.length === 0) {
          const titre = a.header_text || '';
          const desc  = stripHtml(a.description_text || '');
          return keywordStrictCorridor(titre, desc);
        }

        return false;
      });

      /*
       * Déduplication croisée GTFS/SIRI.
       * Une description suffisamment précise identique ne doit produire qu'une carte.
       * On conserve la version la plus riche (détail/liens SIRI) et on fusionne les cibles.
       */
      const alertesUniques = new Map();
      alertesFiltres.forEach((alert) => {
        const titleKey = normalizeAlertText(alert.header_text || '');
        const descriptionKey = normalizeAlertText(alert.description_text || '');
        const targetKey = (Array.isArray(alert.informed_entities) ? alert.informed_entities : [])
          .map((ent) => extractTrainNumber([
            ent?.trip_id, ent?.vehicle_journey_id, ent?.name
          ].filter(Boolean).join(' ')))
          .filter(Boolean)
          .sort()
          .join(',');
        const fingerprint = descriptionKey.length >= 24
          ? `${titleKey}|${descriptionKey}`
          : `${titleKey}|${descriptionKey}|${targetKey}`;

        if (!alertesUniques.has(fingerprint)) {
          alertesUniques.set(fingerprint, alert);
          return;
        }

        const current = alertesUniques.get(fingerprint);
        const incomingIsRicher = Boolean(alert.detail_html)
          && String(alert.detail_html).length > String(current.detail_html || '').length;
        const preferred = incomingIsRicher ? alert : current;
        const secondary = incomingIsRicher ? current : alert;
        preferred.informed_entities = [
          ...(Array.isArray(preferred.informed_entities) ? preferred.informed_entities : []),
          ...(Array.isArray(secondary.informed_entities) ? secondary.informed_entities : [])
        ];
        preferred.source = Array.from(new Set([
          ...String(preferred.source || '').split(' + '),
          ...String(secondary.source || '').split(' + ')
        ].filter(Boolean))).join(' + ');
        alertesUniques.set(fingerprint, preferred);
      });
      alertesFiltres = Array.from(alertesUniques.values());

      // 2) Tri par priorité (effect)
      alertesFiltres.sort((A, B) => {
        const pa = getStyleParCauseCode(A.effect).prio;
        const pb = getStyleParCauseCode(B.effect).prio;
        return pa - pb;
      });

      if (alertesFiltres.length === 0) {
		updateDisruptionsSummaryVisibility();
        return;
      }

      // 3) Rendu : titre + “trains concernés” (uniquement nos trains affichés)
      alertesFiltres.forEach((alerte) => {
        if (!alerte || typeof alerte !== 'object') return;
        const effetCode = Number.parseInt(alerte.effect, 10);
        const causeCode = Number.parseInt(alerte.cause, 10);
        const code = Number.isFinite(effetCode) ? effetCode : causeCode;
        const styleMeta = getStyleParCauseCode(code);

        const titre = String(alerte.header_text ?? styleMeta.label ?? '').trim();
        const descriptionRaw = String(alerte.description_text ?? '');
        const description = stripHtml(descriptionRaw);
        const descriptionHtml = sanitizeAlertHtml(descriptionRaw, titre);
        const detailRaw = String(alerte.detail_html ?? descriptionRaw);
        const detailHtml = sanitizeAlertHtml(detailRaw, titre);
        const hasExtendedDetail = normalizeAlertText(detailRaw) !== normalizeAlertText(descriptionRaw);
        // Ne PAS se baser uniquement sur code === 2 : certaines alertes SNCF de retard global
        // remontent avec ce code et provoquent à tort une "composition réduite" sur tous les trains.
        // On marque réduit seulement si le libellé parle explicitement de capacité / places assises / composition courte.
        const reductionKeywords = /réduction\s+du\s+nombre\s+de\s+places\s+assises|reduction\s+du\s+nombre\s+de\s+places\s+assises|capacit[ée]\s+r[ée]duite|composition\s+(?:plus\s+)?courte|rame\s+(?:plus\s+)?courte|nombre\s+de\s+places/i;
        const isReducedSeats = reductionKeywords.test(titre) || reductionKeywords.test(description);

        const trainsFromEntities = (Array.isArray(alerte.informed_entities) ? alerte.informed_entities : []).map((ent) => {
            // 1) trip structuré → on cherche le n° de train depuis GTFS
            if (!ent || typeof ent !== 'object') return null;
            const tripId = ent.trip_id || ent.vehicle_journey_id || null;
            if (tripId && sets.tripIds.has(tripId)) {
              const t = GTFS.tripById?.get(tripId);
              const num = t?.trip_short_name ? extractTrainNumber(t.trip_short_name) : null;
              if (num && sets.displayedNums.has(num)) return num;
            }
            // 2) sinon on tente d’extraire un n° dans le texte
            const blob = [ent.name, ent.trip_id, ent.vehicle_journey_id, ent.route_id].filter(Boolean).join(' ');
            const num2 = extractTrainNumber(blob);
            return (num2 && sets.displayedNums.has(num2)) ? num2 : null;
          }).filter(Boolean);

        const trainsFromText = [];
        if (!trainsFromEntities.length) {
          const textBlob = `${titre} ${description}`;
          const numFromText = extractTrainNumber(textBlob);
          if (numFromText && sets.displayedNums.has(numFromText)) {
            trainsFromText.push(numFromText);
          }
        }

        const trainsCibles = Array.from(new Set([...trainsFromEntities, ...trainsFromText]));
        const detailEntry = {
          key: `a_${++LB_ALERT_SEQ}`,
          level: (styleMeta.prio === 1) ? 'red' : ((styleMeta.prio === 2 || styleMeta.prio === 3 || isReducedSeats) ? 'orange' : 'info'),
          icon: styleMeta.icone || 'ℹ️',
          title: titre || styleMeta.label || 'Information',
          description: stripHtml(detailRaw) || description || '',
          descriptionHtml: detailHtml || descriptionHtml || '',
          trains: trainsCibles.slice(),
          source: alerte.source || 'GTFS-RT'
        };
        LB_ALERTS_BY_KEY.set(detailEntry.key, detailEntry);
        trainsCibles.forEach((tn) => {
          const key = String(tn || '').trim();
          if (!key) return;
          if (!LB_ALERTS_BY_TRAIN.has(key)) LB_ALERTS_BY_TRAIN.set(key, []);
          LB_ALERTS_BY_TRAIN.get(key).push(detailEntry);
        });

        // hint visuel “US” si effect=2 et si train affiché
        const targetsDisplayed = trainsCibles.filter(n => sets.displayedNums.has(n));
        const findHeaderByNumber = (numeroTrain) => {
          const normalized = extractTrainNumber(numeroTrain);
          if (!normalized) return null;
          return Array.from(document.querySelectorAll('th[data-train-number]'))
            .find(th => extractTrainNumber(th.dataset.trainNumber || '') === normalized) || null;
        };
        targetsDisplayed.forEach((numeroTrain) => {
          const header = findHeaderByNumber(numeroTrain);
          if (!header) return;

          if (!header.dataset.alertKeyMain) header.dataset.alertKeyMain = detailEntry.key;

          const iconHost = header.querySelector('.train-state') || header;
          if (!iconHost.querySelector('.train-alert-icon')) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon train-alert-icon';
            iconSpan.textContent = styleMeta.icone || '⚠️';
            iconSpan.title = titre || styleMeta.label || 'Information';
            iconSpan.dataset.alertKey = detailEntry.key;
            iconHost.appendChild(iconSpan);
          }

          if (isReducedSeats) {
            header.classList.add('reduced-seats');
            try { if (window.lbReducedSeats) window.lbReducedSeats.add(String(numeroTrain)); } catch(e) {}
            header.title = "Service réduit : réduction du nombre de places (UM ➜ US)";
          }
        });

        let classeCouleur = 'disruption-box info';
        if (styleMeta.prio === 1) classeCouleur = 'disruption-box red';
        else if (styleMeta.prio === 2 || styleMeta.prio === 3 || isReducedSeats) classeCouleur = 'disruption-box orange';

        targetsDisplayed.forEach(numeroTrain => {
          const header = findHeaderByNumber(numeroTrain);
          if (header && !header.dataset.alertKeyMain) header.dataset.alertKeyMain = detailEntry.key;
        });

        const trainsHtml = trainsCibles.length
          ? `<div class="disruption-trains">${trainsCibles.map(t => `<span class="disruption-train-pill">${t}</span>`).join('')}</div>`
          : '<div class="disruption-empty">Aucun train impacté listé</div>';

        const div = document.createElement('div');
        div.className = classeCouleur;
        div.innerHTML = `
          <div class="disruption-title-row">
            <span class="disruption-icon">${styleMeta.icone || 'ℹ️'}</span>
            <span class="disruption-title-text">${titre}</span>
          </div>
          ${descriptionHtml ? `<div class="disruption-description">${descriptionHtml}</div>` : ''}
          ${hasExtendedDetail ? `
            <details class="disruption-more">
              <summary>Voir le message complet et les liens</summary>
              <div class="disruption-description disruption-description--full">${detailHtml}</div>
            </details>` : ''}
          ${trainsHtml}
          ${alerte.source ? `<div class="disruption-source">Source : ${escapeAlertHtml(alerte.source)}</div>` : ''}
        `;
        infoWrapper.appendChild(div);
      });
	  updateDisruptionsSummaryVisibility();
    })
    .catch(err => {
      console.error('Erreur lors du chargement des alertes:', err);
      let infoWrapper = document.getElementById('alertesInline');
      if (!infoWrapper) {
        infoWrapper = document.createElement('div');
        infoWrapper.id = 'alertesInline';
        container.appendChild(infoWrapper);
      }
      infoWrapper.innerHTML = '<p>Erreur lors du chargement des alertes.</p>';
	  updateDisruptionsSummaryVisibility();
    });
}

window.addEventListener('load', () => {
  // 1) Si un tableau existe déjà (cas rare : restauration d'état), charge immédiatement les alertes
  if (document.querySelector('#trainInfo table')) {
    try { chargerEtAfficherAlertes(); } catch (e) { console.warn('[alertes] init:', e); }
  }

  // 2) Si tu n'utilises PAS l'injection progressive (injectTableChunkedIntoTrainInfo),
  //    alors AJOUTE manuellement `chargerEtAfficherAlertes();`
  //    juste après l'injection du tableau dans TON handler "#loadTrains".
  //    Si tu utilises l'injection progressive, ne fais rien ici : elle appelle déjà chargerEtAfficherAlertes() en fin de rendu.

  // 3) Changement de date → Météo + (re)filtrage alertes si un tableau est présent
  const dateInput = document.getElementById('trainDate');
  if (dateInput) {
    const onDateChange = () => {
      if (window.wxTimer) { clearInterval(window.wxTimer); window.wxTimer = null; }
      if (typeof updateWeatherBadges === 'function') updateWeatherBadges();
      if (typeof startWeatherAutorefresh === 'function') startWeatherAutorefresh();

      if (document.querySelector('#trainInfo table')) {
        try { chargerEtAfficherAlertes(); } catch (e) { console.warn('[alertes] date change:', e); }
      }
    };

    dateInput.addEventListener('change', onDateChange);
    // (optionnel) dateInput.addEventListener('input', onDateChange);
  }
});

;

// Gestion du bouton Jeu
const btnJeu = document.getElementById("btnJeu");
if (btnJeu){
  btnJeu.addEventListener("click", function() {
    if (typeof window.lbOpenLoisirsView === "function") {
      window.lbOpenLoisirsView("jeu");
    } else {
      window.location.href = "/jeuBETA1.html?v=2";
    }
  });
}

;

// Gestion du bouton Carte

;

/* Échelle unique de ponctualité — accueil, STATS, favoris et fiches trains. */
window.lbPunctualityColor = function lbPunctualityColor(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '#668b95';
  if (score >= 95) return '#16a34a'; /* vert */
  if (score >= 85) return '#facc15'; /* jaune */
  if (score >= 80) return '#fb923c'; /* orange */
  if (score >= 75) return '#c2410c'; /* orange foncé */
  return '#ef4444';                  /* rouge */
};

;

document.addEventListener('DOMContentLoaded', () => {
  const accountButtons = ["bottomAccountBtn", "topBarAccountBtn", "homeAccountBtn"];
  accountButtons.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const openBtn = document.getElementById("lbBtnOpenAuth");
      if (openBtn) openBtn.click();
    });
  });

  const cflToggle = document.getElementById("includeCFLStatic");
  if (cflToggle) {
    cflToggle.addEventListener("change", () => {
      if (typeof scheduleCustomProposalRefresh === "function") {
        scheduleCustomProposalRefresh();
      }
    });
  }
});

;

document.addEventListener('DOMContentLoaded', () => {
  const statsRoot = document.getElementById('stats-section');
  if (!statsRoot) return;
  const statsConsole = document.getElementById('statsConsole');
  const updateStatsConsoleAuth = (isAuthed) => {
    if (!statsConsole) return;
    statsConsole.style.display = "block";
    try {
      document.dispatchEvent(new CustomEvent("lb:auth-state", {
        detail: { isAuthed: isAuthed === true }
      }));
    } catch (_) {}
  };
  window.updateStatsConsoleAuth = updateStatsConsoleAuth;
  updateStatsConsoleAuth(window.lbIsAuthed === true);
  // Le dashboard V2 est présent en production : l'ancien moteur Stats
  // (jamais exécuté depuis cette migration) a été retiré du bundle principal.
});

;

/* =========================================================
   STATS V2 — dashboard GTFS-RT simple, dynamique et personnel
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('statsV2Dashboard');
  if (!root) return;

  const byId = (id) => document.getElementById(id);
  const API_ORIGIN = 'https://vps.labetaillere.fr';
  const DATA_START = '2026-01-01';
  const FALLBACK_TRAIN = '88501';
  const FALLBACK_STOP = 'Thionville';
  const DEFAULT_SETTINGS = Object.freeze({
    defaultPeriod: '30d',
    granularity: 'week',
    favoriteTrain: FALLBACK_TRAIN,
    favoriteStop: FALLBACK_STOP,
    showHourly: false,
    showCauses: false,
    showRanking: true,
    compact: false
  });
  const COLORS = Object.freeze({
    cyan: '#5ee7f2',
    ok: '#25d873',
    delay: '#ffd43b',
    late: '#ff9f43',
    partial: '#ff7a21',
    cancel: '#ff4d61',
    muted: '#668b95',
    grid: 'rgba(94,231,242,.11)'
  });
  const STATUS = Object.freeze({
    ON_TIME: { label: 'À l’heure', color: COLORS.ok },
    DELAYED: { label: 'En retard', color: COLORS.delay },
    PARTIAL: { label: 'Suppr. partielle', color: COLORS.partial },
    CANCELED: { label: 'Supprimé', color: COLORS.cancel },
    NO_DATA: { label: 'Sans donnée', color: COLORS.muted }
  });

  let settings = { ...DEFAULT_SETTINGS };
  let periodKey = '30d';
  let activeView = 'overview';
  let granularity = settings.granularity;
  let currentRange = null;
  let currentOverview = null;
  let activeAbort = null;
  let hasUserInteracted = false;
  let hasTargetInteracted = false;
  let trainLoaded = '';
  let stopLoaded = '';
  const charts = { evolutionMini: null, evolution: null, hourly: null, train: null, stop: null };

  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toNumber(value, fallback = 0){
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtInt(value){
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(Math.round(n)) : '—';
  }

  function fmtPct(value, digits = 1){
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
  }

  function fmtDelay(value){
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n)} min`;
  }

  function punctualityColor(value){
    return window.lbPunctualityColor(toNumber(value));
  }

  function luxDateIso(date = new Date()){
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Paris',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(date).map((part) => [part.type, part.value])
      );
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function dateAdd(iso, days){
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function dateDiffInclusive(from, to){
    const a = new Date(`${from}T12:00:00Z`);
    const b = new Date(`${to}T12:00:00Z`);
    return Math.max(1, Math.floor((b - a) / 86400000) + 1);
  }

  function startOfMonth(iso){
    return `${String(iso).slice(0, 7)}-01`;
  }

  function previousMonthRange(baseIso){
    const d = new Date(`${startOfMonth(baseIso)}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const from = d.toISOString().slice(0, 10).slice(0, 7) + '-01';
    const next = new Date(`${from}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(next.getUTCDate() - 1);
    return { from, to: next.toISOString().slice(0, 10) };
  }

  function rangeForPeriod(key){
    const yesterday = dateAdd(luxDateIso(), -1);
    const clamp = (range) => {
      if (!range || range.to < DATA_START) return null;
      return { ...range, from: range.from < DATA_START ? DATA_START : range.from };
    };
    if (key === '7d') return clamp({ from: dateAdd(yesterday, -6), to: yesterday });
    if (key === '3m') return clamp({ from: dateAdd(yesterday, -89), to: yesterday });
    if (key === '1y') return clamp({ from: dateAdd(yesterday, -364), to: yesterday });
    if (key === 'month') return clamp({ from: startOfMonth(yesterday), to: yesterday });
    if (key === 'previous') return clamp(previousMonthRange(yesterday));
    if (key === 'custom') {
      const from = byId('statsV2From')?.value;
      const to = byId('statsV2To')?.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return clamp({ from, to });
      }
    }
    return clamp({ from: dateAdd(yesterday, -29), to: yesterday });
  }

  function humanDate(iso, options = {}){
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        day: options.day === false ? undefined : '2-digit',
        month: options.long ? 'long' : 'short',
        year: options.year ? 'numeric' : undefined,
        timeZone: 'UTC'
      }).format(new Date(`${iso}T12:00:00Z`));
    } catch (_) {
      return iso;
    }
  }

  function rangeLabel(range){
    return `${humanDate(range.from, { year: true })} → ${humanDate(range.to, { year: true })}`;
  }

  function granularityForRange(range){
    const days = range ? dateDiffInclusive(range.from, range.to) : 30;
    if (days <= 14) return 'day';
    if (days <= 92) return 'week';
    return 'month';
  }

  async function apiJson(path, options = {}){
    const urls = [`${API_ORIGIN}${path}`, path];
    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          signal: options.signal,
          method: options.method || 'GET',
          headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (response.status === 401) {
          const error = new Error('Connexion requise pour consulter les statistiques.');
          error.code = 401;
          throw error;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 401) throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('API statistiques indisponible');
  }

  function overviewPath(range){
    return `/api/stats/beta/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }

  function setBusy(isBusy, label){
    root.setAttribute('aria-busy', String(Boolean(isBusy)));
    const live = byId('statsV2LiveText');
    if (live && label) live.textContent = label;
  }

  function showError(message){
    const box = byId('statsV2Error');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
    byId('statsV2LiveDot')?.classList.toggle('is-error', Boolean(message));
  }

  function setLiveSuccess(payload){
    const generated = payload?.generated_at ? new Date(payload.generated_at) : new Date();
    const time = Number.isNaN(generated.getTime())
      ? ''
      : generated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    byId('statsV2LiveText').textContent = `Données GTFS-RT consolidées${time ? ` · mises à jour à ${time}` : ''}`;
    byId('statsV2LiveDot')?.classList.remove('is-error');
  }

  function cardsOf(payload){
    const dashboard = payload?.dashboard || {};
    const cards = payload?.cards || dashboard || {};
    const total = toNumber(cards.total_trains ?? dashboard.total_trains);
    const delayed = toNumber(cards.delayed ?? dashboard.delayed);
    const canceled = toNumber(cards.canceled ?? dashboard.canceled);
    const partial = toNumber(cards.partial ?? dashboard.partial);
    const onTime = toNumber(dashboard.on_time, Math.max(0, total - delayed - canceled - partial));
    const impacted = toNumber(cards.impacted ?? dashboard.impacted, delayed + canceled + partial);
    const punctuality = toNumber(cards.punctuality_rate ?? dashboard.punctuality_rate, total ? (onTime / total) * 100 : 0);
    return { total, delayed, canceled, partial, onTime, impacted, punctuality };
  }

  function setWidth(id, value, total){
    const node = byId(id);
    if (!node) return;
    const width = total ? Math.max(0, (toNumber(value) / total) * 100) : 0;
    node.style.width = `${width}%`;
  }

  function aggregateDaily(series, mode){
    const groups = new Map();
    const sorted = [...(Array.isArray(series) ? series : [])]
      .filter((row) => row?.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    function isoWeek(iso){
      const d = new Date(`${iso}T12:00:00Z`);
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
      const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, label: `S${week}` };
    }

    for (const row of sorted) {
      let key = row.date;
      let label = humanDate(row.date);
      if (mode === 'week') {
        const week = isoWeek(row.date);
        key = week.key;
        label = week.label;
      } else if (mode === 'month') {
        key = String(row.date).slice(0, 7);
        label = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
          .format(new Date(`${key}-01T12:00:00Z`));
      }
      const group = groups.get(key) || {
        key, label, total: 0, on_time: 0, delayed: 0, canceled: 0, partial: 0, impacted: 0
      };
      group.total += toNumber(row.total);
      group.on_time += toNumber(row.on_time);
      group.delayed += toNumber(row.delayed);
      group.canceled += toNumber(row.canceled);
      group.partial += toNumber(row.partial);
      group.impacted += toNumber(row.impacted);
      groups.set(key, group);
    }

    return [...groups.values()].map((group) => ({
      ...group,
      punctuality_rate: group.total ? (group.on_time / group.total) * 100 : 0
    }));
  }

  function destroyChart(name){
    if (charts[name]) {
      try { charts[name].destroy(); } catch (_) {}
      charts[name] = null;
    }
  }

  function chartBaseOptions(){
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 320 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(4,17,27,.96)',
          borderColor: 'rgba(94,231,242,.3)',
          borderWidth: 1,
          titleColor: '#eaffff',
          bodyColor: '#bad4d9',
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#729aa4', maxRotation: 0, autoSkip: true, maxTicksLimit: 9 }
        },
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: COLORS.grid },
          ticks: { color: '#729aa4', callback: (value) => `${value}%` }
        }
      }
    };
  }

  function renderEvolution(){
    const series = aggregateDaily(currentOverview?.daily, granularity);
    const pointColors = series.map((row) => punctualityColor(row.punctuality_rate));
    const labels = { day: 'par jour', week: 'par semaine', month: 'par mois' };
    const detailMeta = byId('statsV2EvolutionMeta');
    const miniMeta = byId('statsV2MiniEvolutionMeta');
    if (detailMeta) detailMeta.textContent = `${labels[granularity]} · moyenne pondérée`;
    if (miniMeta) miniMeta.textContent = labels[granularity];
    if (typeof Chart === 'undefined') return;

    const dataset = {
      label: 'Ponctualité',
      data: series.map((row) => Number(row.punctuality_rate.toFixed(1))),
      borderColor: pointColors,
      backgroundColor: pointColors,
      pointBackgroundColor: pointColors,
      pointBorderColor: pointColors,
      borderWidth: 0,
      borderRadius: 5,
      maxBarThickness: 34
    };
    const tooltipCallbacks = {
      label: (ctx) => `Ponctualité : ${fmtPct(ctx.parsed.y)}`,
      afterLabel: (ctx) => {
        const row = series[ctx.dataIndex];
        return `${fmtInt(row?.total)} circulation(s) observée(s)`;
      }
    };

    const miniCanvas = byId('statsV2MiniEvolutionChart');
    const evolutionSummary = byId('statsV2EvolutionSummary');
    if (miniCanvas && !evolutionSummary?.hidden) {
      destroyChart('evolutionMini');
      charts.evolutionMini = new Chart(miniCanvas, {
        type: 'bar',
        data: { labels: series.map((row) => row.label), datasets: [{ ...dataset, maxBarThickness: 22 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 260 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...chartBaseOptions().plugins.tooltip,
              callbacks: tooltipCallbacks
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: '#6f9ca7',
                font: { size: 8, weight: '700' },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 5
              }
            },
            y: {
              min: 0,
              max: 100,
              display: false,
              grid: { display: false },
              border: { display: false }
            }
          }
        }
      });
    } else {
      destroyChart('evolutionMini');
    }

    const canvas = byId('statsV2EvolutionChart');
    const detail = byId('statsV2EvolutionDetail');
    if (!canvas || detail?.hidden) {
      destroyChart('evolution');
      return;
    }
    destroyChart('evolution');
    charts.evolution = new Chart(canvas, {
      type: 'bar',
      data: { labels: series.map((row) => row.label), datasets: [dataset] },
      options: {
        ...chartBaseOptions(),
        plugins: {
          ...chartBaseOptions().plugins,
          tooltip: {
            ...chartBaseOptions().plugins.tooltip,
            callbacks: tooltipCallbacks
          }
        }
      }
    });
  }

  function renderHourly(payload){
    const source = Array.isArray(payload?.hourly) ? payload.hourly : [];
    const byHour = new Map(source.map((row) => [Number(row.hour), row]));
    const rows = Array.from({ length: 25 }, (_, hour) => {
      const row = byHour.get(hour);
      return row ? { ...row, hour } : { hour, total: 0, punctuality_rate: null };
    });
    const canvas = byId('statsV2HourlyChart');
    if (!canvas || typeof Chart === 'undefined') return;
    destroyChart('hourly');
    const hourlyColors = rows.map((row) =>
      toNumber(row.total) > 0 ? punctualityColor(row.punctuality_rate) : 'transparent'
    );
    charts.hourly = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map((row) => `${String(row.hour).padStart(2, '0')}h`),
        datasets: [{
          label: 'Ponctualité',
          data: rows.map((row) => toNumber(row.total) > 0 ? toNumber(row.punctuality_rate) : null),
          backgroundColor: hourlyColors,
          borderColor: hourlyColors,
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 22
        }]
      },
      options: {
        ...chartBaseOptions(),
        plugins: {
          ...chartBaseOptions().plugins,
          tooltip: {
            ...chartBaseOptions().plugins.tooltip,
            callbacks: {
              label: (ctx) => ctx.parsed.y == null ? 'Aucune circulation observée' : `Ponctualité : ${fmtPct(ctx.parsed.y)}`,
              afterLabel: (ctx) => `${fmtInt(rows[ctx.dataIndex]?.total)} train(s)`
            }
          }
        }
      }
    });
  }

  function renderCauses(payload){
    const host = byId('statsV2CauseList');
    if (!host) return;
    const causes = (Array.isArray(payload?.causes) ? payload.causes : []).slice(0, 7);
    if (!causes.length) {
      host.innerHTML = '<div class="stats-v2__empty">Aucune cause détaillée disponible sur cette période.</div>';
      return;
    }
    const max = Math.max(1, ...causes.map((item) => toNumber(item.occurrences)));
    host.innerHTML = causes.map((item) => {
      const width = Math.max(4, (toNumber(item.occurrences) / max) * 100);
      const label = String(item.cause || 'Cause non précisée').replace(/\s+/g, ' ').trim();
      return `
        <div class="stats-v2__cause-row" title="${escapeHtml(label)}">
          <span class="stats-v2__cause-label">${escapeHtml(label)}</span>
          <span class="stats-v2__cause-track"><i style="width:${width.toFixed(1)}%"></i></span>
          <strong class="stats-v2__cause-count">${fmtInt(item.occurrences)}</strong>
        </div>
      `;
    }).join('');
  }

  function renderTopTrains(payload){
    const host = byId('statsV2TrainList');
    const datalist = byId('statsV2TrainListData');
    if (!host) return;
    const trains = (Array.isArray(payload?.dashboard?.top_trains) ? payload.dashboard.top_trains : []).slice(0, 10);
    if (datalist) {
      const values = new Set([
        settings.favoriteTrain,
        window.lbPrefsCache?.favoriteMorningTrain,
        window.lbPrefsCache?.favoriteEveningTrain,
        ...trains.map((item) => item.train_number)
      ].filter(Boolean).map(String));
      datalist.innerHTML = [...values].map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
    }
    if (!trains.length) {
      host.innerHTML = '<div class="stats-v2__empty">Aucun classement disponible sur cette période.</div>';
      return;
    }
    host.innerHTML = trains.map((item, index) => {
      const total = toNumber(item.total);
      const impacted = toNumber(item.impacted);
      const rate = total ? (impacted / total) * 100 : 0;
      return `
        <button class="stats-v2__train-row" type="button" data-stats-train="${escapeHtml(item.train_number)}" style="--impact:${Math.min(100, rate).toFixed(1)}%">
          <span class="stats-v2__rank">${index + 1}</span>
          <span class="stats-v2__train-identity">
            <span class="stats-v2__train-number">TER ${escapeHtml(item.train_number)}</span>
            <span class="stats-v2__train-meter"><i></i></span>
          </span>
          <span class="stats-v2__train-impact">
            <strong>${fmtPct(rate, 0)}</strong>
            <small>touchés · ${fmtInt(impacted)}/${fmtInt(total)}</small>
          </span>
          <span class="stats-v2__train-stats">
            <span class="stats-v2__chip" style="--chip-color:var(--sv2-delay)"><strong>${fmtInt(item.delayed)}</strong><small>retards</small></span>
            <span class="stats-v2__chip" style="--chip-color:var(--sv2-partial)"><strong>${fmtInt(item.partial)}</strong><small>partiels</small></span>
            <span class="stats-v2__chip" style="--chip-color:var(--sv2-cancel)"><strong>${fmtInt(item.canceled)}</strong><small>suppr.</small></span>
          </span>
        </button>
      `;
    }).join('');
  }

  function renderInsights(payload){
    const cards = payload?.cards || {};
    const worstDay = cards.worst_day;
    const worstHour = cards.worst_hour;
    const topTrain = cards.top_train;
    const topCause = cards.top_cause;
    byId('statsV2WorstDay').textContent = worstDay
      ? `${humanDate(worstDay.date, { year: true })} · ${fmtPct(worstDay.impact_rate)} touchés`
      : '—';
    byId('statsV2WorstHour').textContent = worstHour
      ? `${worstHour.hour}h · ${fmtPct(worstHour.impact_rate)} touchés`
      : '—';
    byId('statsV2WorstTrain').textContent = topTrain
      ? `TER ${topTrain.train_number} · ${fmtInt(topTrain.impacted)} perturbation(s)`
      : '—';
    byId('statsV2TopCause').textContent = topCause
      ? `${String(topCause.cause || 'Non précisée').replace(/\s+/g, ' ').trim()}`
      : '—';
  }

  function renderOverview(){
    if (!currentOverview) return;
    const current = cardsOf(currentOverview);
    const ring = byId('statsV2Ring');
    const color = punctualityColor(current.punctuality);
    if (ring) {
      const boundedPunctuality = Math.max(0, Math.min(100, current.punctuality));
      ring.style.setProperty('--stats-v2-ring', String(boundedPunctuality), 'important');
      ring.style.setProperty('--stats-v2-ring-color', color, 'important');
      ring.style.setProperty(
        'background',
        `conic-gradient(${color} ${boundedPunctuality}%, rgba(75,116,127,.23) 0)`,
        'important'
      );
      ring.setAttribute('aria-label', `Ponctualité ${fmtPct(current.punctuality)}`);
    }
    byId('statsV2Punctuality').textContent = fmtPct(current.punctuality);
    byId('statsV2PunctualityCopy').textContent =
      `${fmtInt(current.onTime)} circulation(s) à l’heure sur ${fmtInt(current.total)} observée(s).`;

    byId('statsV2Total').textContent = fmtInt(current.total);
    byId('statsV2TotalMeta').textContent = `${dateDiffInclusive(currentRange.from, currentRange.to)} jour(s) calendaires`;
    byId('statsV2Delayed').textContent = fmtInt(current.delayed);
    byId('statsV2DelayedMeta').textContent = current.total ? fmtPct((current.delayed / current.total) * 100) : '—';
    byId('statsV2Partial').textContent = fmtInt(current.partial);
    byId('statsV2PartialMeta').textContent = current.total ? fmtPct((current.partial / current.total) * 100) : '—';
    byId('statsV2Canceled').textContent = fmtInt(current.canceled);
    byId('statsV2CanceledMeta').textContent = current.total ? fmtPct((current.canceled / current.total) * 100) : '—';

    setWidth('statsV2StatusOnTime', current.onTime, current.total);
    setWidth('statsV2StatusDelayed', current.delayed, current.total);
    setWidth('statsV2StatusPartial', current.partial, current.total);
    setWidth('statsV2StatusCanceled', current.canceled, current.total);
    byId('statsV2LegendOnTime').textContent = fmtInt(current.onTime);
    byId('statsV2LegendDelayed').textContent = fmtInt(current.delayed);
    byId('statsV2LegendPartial').textContent = fmtInt(current.partial);
    byId('statsV2LegendCanceled').textContent = fmtInt(current.canceled);
    byId('statsV2StatusMeta').textContent = `${fmtInt(current.impacted)} circulation(s) perturbée(s)`;

    renderEvolution();
    renderHourly(currentOverview);
    renderCauses(currentOverview);
    renderTopTrains(currentOverview);
    renderInsights(currentOverview);
    applyModuleVisibility();
  }

  async function loadOverview(options = {}){
    const range = options.range || rangeForPeriod(periodKey);
    if (!range || range.from > range.to || range.to < DATA_START) {
      showError('Les statistiques sont disponibles à partir du 1er janvier 2026.');
      return;
    }
    if (dateDiffInclusive(range.from, range.to) > 370) {
      showError('Choisis une période de 12 mois maximum pour garder un affichage fluide.');
      return;
    }
    currentRange = range;
    byId('statsV2From').value = range.from;
    byId('statsV2To').value = range.to;
    byId('statsV2RangeLabel').textContent = rangeLabel(range);
    showError('');
    if (activeAbort) activeAbort.abort();
    activeAbort = new AbortController();
    setBusy(true, 'Analyse des circulations…');

    try {
      currentOverview = await apiJson(overviewPath(range), { signal: activeAbort.signal });
      renderOverview();
      setLiveSuccess(currentOverview);
      showError('');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      const message = error?.code === 401
        ? 'Connecte-toi pour accéder aux statistiques complètes et à ton tableau personnalisé.'
        : `Impossible de charger les statistiques : ${error?.message || error}`;
      showError(message);
      byId('statsV2LiveText').textContent = 'Données statistiques indisponibles';
    } finally {
      setBusy(false);
    }
  }

  function setPeriod(key, options = {}){
    periodKey = key;
    hasUserInteracted = hasUserInteracted || options.user === true;
    const periodSelect = byId('statsV2PeriodSelect');
    if (periodSelect && periodSelect.value !== key) periodSelect.value = key;
    root.querySelectorAll('[data-period]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.period === key);
    });
    const custom = byId('statsV2CustomRange');
    if (custom) custom.hidden = key !== 'custom';
    const automaticRange = rangeForPeriod(key);
    if (automaticRange && (key !== 'custom' || options.loadCustom)) {
      setGranularity(granularityForRange(automaticRange));
    }
    if ((key !== 'custom' || options.loadCustom) && options.skipLoad !== true) loadOverview();
  }

  function setView(view, options = {}){
    activeView = ['overview', 'train', 'stop', 'compare'].includes(view) ? view : 'overview';
    const isTargetView = activeView === 'train' || activeView === 'stop';
    root.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === activeView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.setAttribute('aria-pressed', String(active));
    });
    root.querySelectorAll('[data-entry-views]').forEach((card) => {
      const views = String(card.dataset.entryViews || '').split(/\s+/).filter(Boolean);
      const active = views.includes(activeView);
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', String(active));
    });
    const targetChoices = byId('statsV2TargetChoices');
    const targetChoice = byId('statsV2TargetChoice');
    if (targetChoices) targetChoices.hidden = !isTargetView;
    if (targetChoice) targetChoice.setAttribute('aria-expanded', String(isTargetView));
    root.querySelectorAll('[data-view-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== activeView;
    });
    if (activeView === 'train' && options.autoRun !== false) {
      const value = String(byId('statsV2TrainInput')?.value || settings.favoriteTrain || '').trim();
      if (value && value !== trainLoaded) runTrain();
    }
    if (activeView === 'stop' && options.autoRun !== false) {
      const value = String(byId('statsV2StopInput')?.value || settings.favoriteStop || '').trim();
      if (value && value !== stopLoaded) runStop();
    }
  }

  function normalizeTrain(value){
    const match = String(value || '').replace(/\s+/g, '').match(/\d{4,6}/);
    return match ? match[0] : '';
  }

  function bucketOf(row){
    const bucket = String(row?.bucket || row?.status || '').toUpperCase();
    if (bucket.includes('PARTIAL')) return 'PARTIAL';
    if (bucket.includes('CANCEL') || bucket.includes('SUPPR') || bucket.includes('ANNUL')) return 'CANCELED';
    if (bucket.includes('DELAY') || toNumber(row?.value) > 0) return 'DELAYED';
    if (bucket === 'ON_TIME' || bucket === 'ONTIME' || !bucket) return 'ON_TIME';
    return 'NO_DATA';
  }

  function renderTrainWeekdays(rows){
    const names = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const stats = names.map((name) => ({ name, total: 0, impacted: 0 }));
    rows.forEach((row) => {
      if (!row?.date) return;
      const item = stats[new Date(`${row.date}T12:00:00Z`).getUTCDay()];
      const bucket = bucketOf(row);
      item.total += 1;
      if (!['ON_TIME', 'NO_DATA'].includes(bucket)) item.impacted += 1;
    });
    const usable = stats.filter((item) => item.total > 0).map((item) => ({
      ...item,
      rate: (item.impacted / item.total) * 100
    }));
    const best = [...usable].sort((a, b) => a.rate - b.rate || b.total - a.total)[0];
    const worst = [...usable].sort((a, b) => b.rate - a.rate || b.total - a.total)[0];
    byId('statsV2TrainBestWeekday').textContent = best ? best.name : '—';
    byId('statsV2TrainWorstWeekday').textContent = worst ? worst.name : '—';
    byId('statsV2TrainBestWeekdayMeta').textContent = best ? `${fmtPct(best.rate, 0)} perturbés · ${best.total} circulation(s)` : 'Pas assez de données';
    byId('statsV2TrainWorstWeekdayMeta').textContent = worst ? `${fmtPct(worst.rate, 0)} perturbés · ${worst.total} circulation(s)` : 'Pas assez de données';
  }

  function renderTrainCalendar(rows){
    const host = byId('statsV2TrainCalendar');
    if (!host) return;
    const rowByDate = new Map(rows.filter((row) => row?.date).map((row) => [row.date, row]));
    const months = new Map();
    for (let iso = currentRange.from; iso <= currentRange.to; iso = dateAdd(iso, 1)) {
      const month = iso.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(iso);
    }
    host.innerHTML = [...months.entries()].map(([month, days]) => {
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${month}-01T12:00:00Z`));
      const first = new Date(`${days[0]}T12:00:00Z`).getUTCDay();
      const offset = (first + 6) % 7;
      const blanks = '<i class="stats-v2__calendar-blank"></i>'.repeat(offset);
      const cells = days.map((iso) => {
        const row = rowByDate.get(iso);
        const bucket = row ? bucketOf(row) : 'NO_DATA';
        const info = STATUS[bucket] || STATUS.NO_DATA;
        const detail = row?.value == null ? '' : ` · ${fmtDelay(row.value)}`;
        const tooltip = `${humanDate(iso, { year: true })} · ${info.label}${detail}`;
        return `<button class="stats-v2__calendar-day" type="button" style="--day-color:${info.color}" data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}"><span>${Number(iso.slice(-2))}</span></button>`;
      }).join('');
      return `<section class="stats-v2__calendar-month"><h4>${escapeHtml(label)}</h4><div class="stats-v2__calendar-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="stats-v2__calendar-days">${blanks}${cells}</div></section>`;
    }).join('');
  }

  function circulationCause(row){
    if (!row || typeof row !== 'object') return '';
    const candidates = [
      row.cause,
      row.reason,
      row.disruption_cause,
      row.sncf_disruption_cause,
      row.sncfCause,
      row.cause_text,
      row.causeText,
      row.message,
      row.description
    ];
    if (Array.isArray(row.causes)) candidates.push(...row.causes);
    if (Array.isArray(row.disruptions)) {
      row.disruptions.forEach((item) => {
        if (typeof item === 'string') candidates.push(item);
        else if (item && typeof item === 'object') {
          candidates.push(item.cause, item.reason, item.message, item.description);
        }
      });
    }
    const texts = candidates
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => {
        if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
        if (value && typeof value === 'object') {
          return String(value.label || value.name || value.text || value.message || '').trim();
        }
        return '';
      })
      .filter(Boolean)
      .filter((value) => !/^(?:à l['’]heure|en retard|retard|supprim[ée]|suppression|partiel(?:le)?)$/i.test(value));
    return [...new Set(texts)][0] || '';
  }

  function renderTrain(payload, train, stop){
    const rows = [...(Array.isArray(payload?.series) ? payload.series : [])]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    trainLoaded = train;
    const counts = { ON_TIME: 0, DELAYED: 0, PARTIAL: 0, CANCELED: 0, NO_DATA: 0 };
    const delayedValues = [];
    for (const row of rows) {
      const bucket = bucketOf(row);
      counts[bucket] += 1;
      if (bucket === 'DELAYED' && Number.isFinite(Number(row.value))) delayedValues.push(Number(row.value));
    }
    const total = rows.length;
    const punctuality = total ? (counts.ON_TIME / total) * 100 : 0;
    const avg = delayedValues.length ? delayedValues.reduce((a, b) => a + b, 0) / delayedValues.length : 0;
    const max = delayedValues.length ? Math.max(...delayedValues) : 0;
    const calendarMode = dateDiffInclusive(currentRange.from, currentRange.to) > 30;

    byId('statsV2TrainTitle').textContent = `TER ${train} · historique`;
    byId('statsV2TrainMeta').textContent = `${rangeLabel(currentRange)}${stop ? ` · retard à ${stop}` : ' · retard maximal du parcours'}`;
    byId('statsV2TrainPunct').textContent = total ? fmtPct(punctuality) : '—';
    byId('statsV2TrainRuns').textContent = fmtInt(total);
    byId('statsV2TrainAvg').textContent = delayedValues.length ? fmtDelay(avg) : '0 min';
    byId('statsV2TrainMax').textContent = delayedValues.length ? fmtDelay(max) : '0 min';

    const canvas = byId('statsV2TrainChart');
    const calendar = byId('statsV2TrainCalendar');
    if (canvas) canvas.parentElement.hidden = calendarMode;
    if (calendar) calendar.hidden = !calendarMode;
    if (canvas && typeof Chart !== 'undefined') {
      destroyChart('train');
      charts.train = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: rows.map((row) => humanDate(row.date)),
          datasets: [{
            label: 'Retard',
            data: rows.map((row) => bucketOf(row) === 'CANCELED' ? null : toNumber(row.value)),
            backgroundColor: rows.map((row) => STATUS[bucketOf(row)]?.color || COLORS.muted),
            borderRadius: 4,
            maxBarThickness: 18
          }]
        },
        options: {
          ...chartBaseOptions(),
          plugins: {
            ...chartBaseOptions().plugins,
            tooltip: {
              ...chartBaseOptions().plugins.tooltip,
              callbacks: {
                label: (ctx) => {
                  const row = rows[ctx.dataIndex];
                  const bucket = bucketOf(row);
                  if (bucket === 'CANCELED') return 'Supprimé';
                  if (bucket === 'PARTIAL') return `Suppression partielle · ${fmtDelay(row.value)}`;
                  return bucket === 'ON_TIME' ? 'À l’heure' : `Retard : ${fmtDelay(row.value)}`;
                }
              }
            }
          },
          scales: {
            x: chartBaseOptions().scales.x,
            y: {
              beginAtZero: true,
              grid: { color: COLORS.grid },
              ticks: { color: '#729aa4', callback: (value) => `${value} min` }
            }
          }
        }
      });
    }
    if (calendarMode) renderTrainCalendar(rows);
    renderTrainWeekdays(rows);

    const strip = byId('statsV2TrainRunsStrip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
    }

    const tbody = byId('statsV2TrainTable');
    if (tbody) {
      tbody.innerHTML = rows.slice(-60).reverse().map((row) => {
        const bucket = bucketOf(row);
        const info = STATUS[bucket] || STATUS.NO_DATA;
        const value = bucket === 'CANCELED' ? '—' : fmtDelay(toNumber(row.value));
        const cause = circulationCause(row);
        return `
          <tr>
            <td>${escapeHtml(row.date)}</td>
            <td><span class="stats-v2__status-label" style="--status-color:${info.color}">${escapeHtml(info.label)}</span></td>
            <td class="is-num">${value}</td>
            <td class="stats-v2__table-cause${cause ? '' : ' is-empty'}"${cause ? ` title="${escapeHtml(cause)}"` : ''}>${cause ? escapeHtml(cause) : '—'}</td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="4" class="stats-v2__empty">Aucune circulation trouvée.</td></tr>';
    }

    const message = byId('statsV2TrainMessage');
    if (message) {
      message.hidden = total > 0;
      message.textContent = total ? '' : `Aucune donnée trouvée pour le TER ${train} sur cette période.`;
    }
  }

  async function runTrain(){
    const train = normalizeTrain(byId('statsV2TrainInput')?.value || settings.favoriteTrain);
    const stop = String(byId('statsV2TrainStop')?.value || '').trim();
    const message = byId('statsV2TrainMessage');
    if (!train) {
      if (message) {
        message.hidden = false;
        message.textContent = 'Entre un numéro de train de 4 à 6 chiffres.';
      }
      return;
    }
    byId('statsV2TrainInput').value = train;
    setBusy(true, `Analyse du TER ${train}…`);
    try {
      const query = new URLSearchParams({ from: currentRange.from, to: currentRange.to, trainId: train });
      if (stop) query.set('stop', stop);
      const payload = await apiJson(`/api/stats/gtfs/train?${query.toString()}`);
      renderTrain(payload, train, stop);
      showError('');
      byId('statsV2LiveText').textContent = `Historique du TER ${train} chargé`;
    } catch (error) {
      showError(`Impossible de charger le TER ${train} : ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  let compareKind = 'period';
  let compareScale = 'month';

  function monthRange(value){
    if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month] = value.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const range = { from: `${value}-01`, to: `${value}-${String(last).padStart(2, '0')}` };
    return range.from < DATA_START ? null : range;
  }

  function comparisonRange(value, scale){
    if (scale === 'month') return monthRange(value);
    if (scale === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { from: value, to: value };
    if (scale === 'week' && /^\d{4}-W\d{2}$/.test(value)) {
      const [year, week] = value.split('-W').map(Number);
      const jan4 = new Date(Date.UTC(year, 0, 4, 12));
      const monday = new Date(jan4);
      monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + ((week - 1) * 7));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const iso = (date) => date.toISOString().slice(0, 10);
      return { from: iso(monday), to: iso(sunday) };
    }
    return null;
  }

  function recentPeriodOptions(scale){
    const values = [];
    const today = new Date();
    if (scale === 'month') {
      const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
      for (let offset = 0; offset < 30; offset += 1) {
        const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
        const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (`${value}-01` < DATA_START) break;
        values.push({
          value,
          label: formatter.format(date).replace(/^./, (letter) => letter.toUpperCase())
        });
      }
    } else if (scale === 'week') {
      const monday = new Date(today);
      monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() || 7) - 1));
      const isoWeek = (date) => {
        const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
        return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
      };
      const shortDate = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });
      for (let offset = 0; offset < 60; offset += 1) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - (offset * 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        if (startIso < DATA_START) break;
        values.push({ value: isoWeek(start), label: `${isoWeek(start).replace('-W', ' · S')} — ${shortDate.format(start)} au ${shortDate.format(end)}` });
      }
    }
    return values;
  }

  function renderCompareInputs(){
    const host = byId('statsV2CompareInputs');
    if (!host) return;
    const sameContext = host.dataset.kind === compareKind &&
      host.dataset.scale === compareScale;
    const oldValues = sameContext
      ? [...host.querySelectorAll('[data-compare-value]')].map((input) => input.value)
      : [];
    const labels = compareKind === 'period'
      ? { month: 'Mois', week: 'Semaine', day: 'Jour' }[compareScale]
      : compareKind === 'train' ? 'Bétaillère' : 'Gare';
    const periodOptions = compareKind === 'period' && compareScale !== 'day'
      ? recentPeriodOptions(compareScale).map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('')
      : '';
    host.innerHTML = Array.from({ length: 4 }, (_, index) => `
      <div class="stats-v2__field">
        <label for="statsV2CompareItem${index}">${labels} ${index + 1}${index > 1 ? ' (facultatif)' : ''}</label>
        ${compareKind === 'period' && compareScale !== 'day' ? `
        <select id="statsV2CompareItem${index}" class="stats-v2__input stats-v2__compare-select" data-compare-value>
          <option value="">Choisir ${compareScale === 'month' ? 'un mois' : 'une semaine'}…</option>
          ${periodOptions}
        </select>` : `
        <input id="statsV2CompareItem${index}" class="stats-v2__input" data-compare-value type="${compareKind === 'period' ? 'date' : 'text'}"
          ${compareKind === 'train' ? 'list="statsV2TrainListData" inputmode="numeric"' : ''}
          ${compareKind === 'stop' ? 'list="statsV2StopList"' : ''}
          ${compareKind === 'period' ? `min="${DATA_START}" max="${dateAdd(luxDateIso(), -1)}"` : ''}
          placeholder="${compareKind === 'train' ? `Choisir une bétaillère` : compareKind === 'stop' ? `Choisir une gare` : 'Choisir une date'}">`}
      </div>
    `).join('');
    host.dataset.kind = compareKind;
    host.dataset.scale = compareScale;
    host.querySelectorAll('[data-compare-value]').forEach((input, index) => {
      const preferred = compareKind === 'train'
        ? settings.favoriteTrain
        : compareKind === 'stop' ? settings.favoriteStop : '';
      input.value = oldValues[index] || (index === 0 ? preferred : '') || '';
    });
  }

  function setCompareScale(scale){
    compareScale = ['month', 'week', 'day'].includes(scale) ? scale : 'month';
    root.querySelectorAll('[data-compare-scale]').forEach((button) => {
      const active = button.dataset.compareScale === compareScale;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderCompareInputs();
    const hint = byId('statsV2ComparePeriodHint');
    if (hint) hint.textContent = `Choisis de 2 à 4 ${compareScale === 'month' ? 'mois complets' : compareScale === 'week' ? 'semaines complètes' : 'jours'}.`;
    byId('statsV2CompareResults').hidden = true;
  }

  function comparisonSummary(payload, kind){
    if (kind === 'period') {
      const cards = cardsOf(payload);
      return {
        total: cards.total,
        impacted: cards.impacted,
        delayed: cards.delayed,
        partial: cards.partial,
        canceled: cards.canceled,
        punctuality: cards.total ? (cards.onTime / cards.total) * 100 : 0
      };
    }
    const rows = Array.isArray(payload?.series) ? payload.series : [];
    if (kind === 'train') {
      const total = rows.length;
      const impacted = rows.filter((row) => !['ON_TIME', 'NO_DATA'].includes(bucketOf(row))).length;
      return {
        total, impacted,
        delayed: rows.filter((row) => bucketOf(row) === 'DELAYED').length,
        partial: rows.filter((row) => bucketOf(row) === 'PARTIAL').length,
        canceled: rows.filter((row) => bucketOf(row) === 'CANCELED').length,
        punctuality: total ? ((total - impacted) / total) * 100 : 0
      };
    }
    const totals = rows.reduce((acc, row) => {
      acc.total += toNumber(row.trains);
      acc.impacted += toNumber(row.not_on_time);
      acc.delayed += toNumber(row.delayed);
      acc.partial += toNumber(row.partial);
      acc.canceled += toNumber(row.canceled);
      return acc;
    }, { total: 0, impacted: 0, delayed: 0, partial: 0, canceled: 0 });
    totals.punctuality = totals.total ? ((totals.total - totals.impacted) / totals.total) * 100 : 0;
    return totals;
  }

  function setCompareKind(kind){
    compareKind = ['period', 'train', 'stop'].includes(kind) ? kind : 'period';
    root.querySelectorAll('[data-compare-kind]').forEach((button) => {
      const active = button.dataset.compareKind === compareKind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const hint = byId('statsV2ComparePeriodHint');
    byId('statsV2CompareScale').hidden = compareKind !== 'period';
    renderCompareInputs();
    if (compareKind === 'period') {
      hint.textContent = `Choisis de 2 à 4 ${compareScale === 'month' ? 'mois complets' : compareScale === 'week' ? 'semaines complètes' : 'jours'}.`;
    } else {
      if (compareKind === 'train') {
        hint.textContent = `Compare de 2 à 4 bétaillères sur ${rangeLabel(currentRange)}.`;
      } else {
        hint.textContent = `Compare de 2 à 4 gares sur ${rangeLabel(currentRange)}.`;
      }
    }
    byId('statsV2CompareResults').hidden = true;
  }

  async function runCompare(){
    const inputs = [...byId('statsV2CompareInputs').querySelectorAll('[data-compare-value]')]
      .map((input) => String(input.value || '').trim()).filter(Boolean);
    const message = byId('statsV2CompareMessage');
    const showCompareMessage = (text) => {
      message.hidden = !text;
      message.textContent = text || '';
    };
    if (inputs.length < 2 || inputs.length > 4) return showCompareMessage('Choisis entre 2 et 4 éléments à comparer.');
    if (new Set(inputs.map((value) => value.toLowerCase())).size !== inputs.length) return showCompareMessage('Chaque choix doit être différent.');
    let ranges = inputs.map(() => currentRange);
    let names = [...inputs];
    let paths = [];
    if (compareKind === 'period') {
      ranges = inputs.map((value) => comparisonRange(value, compareScale));
      if (ranges.some((range) => !range)) return showCompareMessage('Une période sélectionnée est invalide.');
      if (ranges.some((range) => range.from < DATA_START)) {
        return showCompareMessage('Les statistiques commencent le 1er janvier 2026.');
      }
      names = ranges.map((range) => rangeLabel(range));
      paths = ranges.map(overviewPath);
    } else if (compareKind === 'train') {
      const trains = inputs.map(normalizeTrain);
      if (trains.some((train) => !train)) return showCompareMessage('Vérifie les numéros des bétaillères.');
      names = trains.map((train) => `TER ${train}`);
      paths = trains.map((train) => `/api/stats/gtfs/train?${new URLSearchParams({ from: currentRange.from, to: currentRange.to, trainId: train })}`);
    } else {
      paths = inputs.map((stop) => `/api/stats/gtfs/stop?${new URLSearchParams({ from: currentRange.from, to: currentRange.to, stop })}`);
    }
    showCompareMessage('');
    setBusy(true, 'Comparaison en cours…');
    try {
      const payloads = await Promise.all(paths.map((path) => apiJson(path)));
      const summaries = payloads.map((payload) => comparisonSummary(payload, compareKind));
      byId('statsV2CompareCards').innerHTML = summaries.map((item, index) => `
        <article class="stats-v2__compare-card">
          <span>${escapeHtml(names[index])}</span>
          <strong>${item.total ? fmtPct(item.punctuality) : '—'}</strong>
          <small>${fmtInt(item.impacted)} touchés / ${fmtInt(item.total)}</small>
          <div class="stats-v2__compare-incidents">
            <em style="--incident:var(--sv2-delay)"><b>${fmtInt(item.delayed)}</b> retards</em>
            <em style="--incident:var(--sv2-partial)"><b>${fmtInt(item.partial)}</b> partiels</em>
            <em style="--incident:var(--sv2-cancel)"><b>${fmtInt(item.canceled)}</b> suppr.</em>
          </div>
        </article>`).join('');
      const best = summaries.reduce((winner, item, index) => item.punctuality > summaries[winner].punctuality ? index : winner, 0);
      byId('statsV2CompareWinner').textContent = `Meilleure ponctualité : ${names[best]} · ${fmtPct(summaries[best].punctuality)}`;
      byId('statsV2CompareMeta').textContent = compareKind === 'period' ? `${inputs.length} périodes comparées` : rangeLabel(currentRange);
      byId('statsV2CompareResults').hidden = false;
      const canvas = byId('statsV2CompareChart');
      if (canvas && typeof Chart !== 'undefined') {
        destroyChart('compare');
        charts.compare = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: names,
            datasets: [{
              label: 'Ponctualité',
              data: summaries.map((item) => item.punctuality),
              backgroundColor: summaries.map((item) => punctualityColor(item.punctuality)),
              borderRadius: 7,
              maxBarThickness: 82
            }]
          },
          options: chartBaseOptions()
        });
      }
    } catch (error) {
      showCompareMessage(`Comparaison indisponible : ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  function renderStop(payload, stop){
    const rows = [...(Array.isArray(payload?.series) ? payload.series : [])]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    stopLoaded = stop;
    const totals = rows.reduce((acc, row) => {
      acc.trains += toNumber(row.trains);
      acc.delayed += toNumber(row.delayed);
      acc.canceled += toNumber(row.canceled);
      acc.partial += toNumber(row.partial);
      acc.notOnTime += toNumber(row.not_on_time);
      return acc;
    }, { trains: 0, delayed: 0, canceled: 0, partial: 0, notOnTime: 0 });
    const punctuality = totals.trains ? ((totals.trains - totals.notOnTime) / totals.trains) * 100 : 0;
    byId('statsV2StopTitle').textContent = `${stop} · fiabilité`;
    byId('statsV2StopMeta').textContent = rangeLabel(currentRange);
    byId('statsV2StopPunct').textContent = totals.trains ? fmtPct(punctuality) : '—';
    byId('statsV2StopRuns').textContent = fmtInt(totals.trains);
    byId('statsV2StopDelayed').textContent = fmtInt(totals.delayed);
    byId('statsV2StopCanceled').textContent = `${fmtInt(totals.canceled)} / ${fmtInt(totals.partial)}`;
    const canvas = byId('statsV2StopChart');
    if (canvas && typeof Chart !== 'undefined') {
      destroyChart('stop');
      const values = rows.map((row) => Math.max(0, 100 - toNumber(row.pct_not_on_time)));
      destroyChart('stop');
      charts.stop = new Chart(canvas, {
        type: 'line',
        data: {
          labels: rows.map((row) => humanDate(row.date)),
          datasets: [{
            label: 'Ponctualité',
            data: values.map((value) => Number(value.toFixed(1))),
            borderColor: COLORS.cyan,
            backgroundColor: 'rgba(94,231,242,.10)',
            pointBackgroundColor: values.map(punctualityColor),
            pointBorderColor: values.map(punctualityColor),
            pointRadius: rows.length > 40 ? 1.5 : 3,
            borderWidth: 2.2,
            fill: true,
            tension: .25
          }]
        },
        options: chartBaseOptions()
      });
    }

    const tbody = byId('statsV2StopTable');
    if (tbody) {
      tbody.innerHTML = rows.slice(-60).reverse().map((row) => {
        const pct = Math.max(0, 100 - toNumber(row.pct_not_on_time));
        return `
          <tr>
            <td>${escapeHtml(row.date)}</td>
            <td class="is-num">${fmtInt(row.trains)}</td>
            <td class="is-num" style="color:${COLORS.delay}">${fmtInt(row.delayed)}</td>
            <td class="is-num" style="color:${COLORS.cancel}">${fmtInt(toNumber(row.canceled) + toNumber(row.partial))}</td>
            <td class="is-num" style="color:${punctualityColor(pct)}">${fmtPct(pct)}</td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="5" class="stats-v2__empty">Aucune donnée trouvée.</td></tr>';
    }

    const message = byId('statsV2StopMessage');
    if (message) {
      message.hidden = totals.trains > 0;
      message.textContent = totals.trains ? '' : `Aucune circulation trouvée à ${stop} sur cette période.`;
    }
  }

  async function runStop(){
    const stop = String(byId('statsV2StopInput')?.value || settings.favoriteStop || '').trim();
    const message = byId('statsV2StopMessage');
    if (!stop) {
      if (message) {
        message.hidden = false;
        message.textContent = 'Choisis une gare à analyser.';
      }
      return;
    }
    byId('statsV2StopInput').value = stop;
    setBusy(true, `Analyse de ${stop}…`);
    try {
      const query = new URLSearchParams({ from: currentRange.from, to: currentRange.to, stop });
      const payload = await apiJson(`/api/stats/gtfs/stop?${query.toString()}`);
      renderStop(payload, stop);
      showError('');
      byId('statsV2LiveText').textContent = `Statistiques de ${stop} chargées`;
    } catch (error) {
      showError(`Impossible de charger ${stop} : ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  function applyModuleVisibility(){
    const hourly = byId('statsV2HourlyCard');
    const causes = byId('statsV2CausesCard');
    const ranking = byId('statsV2RankingCard');
    if (hourly) hourly.hidden = !settings.showHourly;
    if (causes) causes.hidden = !settings.showCauses;
    if (ranking) ranking.hidden = !settings.showRanking;
    root.classList.toggle('is-compact', Boolean(settings.compact));
  }

  function applySettingsToForm(options = {}){
    const force = options.force === true;
    const setDefault = (id, value) => {
      const field = byId(id);
      if (field && (force || !field.value)) field.value = value || '';
    };
    setDefault('statsV2TrainInput', settings.favoriteTrain || FALLBACK_TRAIN);
    setDefault('statsV2TrainStop', settings.favoriteStop || FALLBACK_STOP);
    setDefault('statsV2StopInput', settings.favoriteStop || FALLBACK_STOP);
    if (compareKind === 'train' || compareKind === 'stop') renderCompareInputs();
  }

  function hydrateFromAccount(prefs, options = {}){
    if (window.lbIsAuthed !== true || !prefs || typeof prefs !== 'object') return;
    settings = {
      ...settings,
      favoriteTrain: normalizeTrain(
        prefs.favoriteMorningTrain || prefs.favoriteEveningTrain || FALLBACK_TRAIN
      ) || FALLBACK_TRAIN,
      favoriteStop: String(
        prefs.favoriteFromStation || prefs.favoriteToStation || FALLBACK_STOP
      ).trim() || FALLBACK_STOP
    };
    if (!hasTargetInteracted && options.applyDefaults !== false) {
      applySettingsToForm({ force: true });
    }
  }

  function updateAuthUI(isAuthed = window.lbIsAuthed === true){
    if (!isAuthed && !hasTargetInteracted) {
      settings = {
        ...settings,
        favoriteTrain: FALLBACK_TRAIN,
        favoriteStop: FALLBACK_STOP
      };
      applySettingsToForm({ force: true });
    }
  }

  function setGranularity(value, options = {}){
    granularity = ['day', 'week', 'month'].includes(value) ? value : 'week';
    hasUserInteracted = hasUserInteracted || options.user === true;
    root.querySelectorAll('[data-granularity]').forEach((button) => {
      const active = button.dataset.granularity === granularity;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (currentOverview) renderEvolution();
  }

  // Compatibilité avec les widgets Favoris et la fiche train déjà présents.
  const rawCache = new Map();
  function statusFlags(raw, extra = {}){
    const value = String(raw || '').trim().toUpperCase();
    const partial = value.includes('PARTIAL') || (value.includes('PART') && value.includes('SUPPR')) ||
      Boolean(extra.partial || extra.partial_canceled || extra.partial_cancelled || extra.partial_cancellation);
    const canceled = !partial && (
      value.includes('CANCEL') || value.includes('SUPPR') || value.includes('ANNUL') ||
      Boolean(extra.cancelled || extra.canceled || extra.supprime || extra.suppressed)
    );
    return { partial, canceled, delayed: value.includes('DELAY') };
  }
  function maxDelay(stops){
    return Math.max(0, ...Object.values(stops || {}).map((value) => toNumber(value)));
  }
  async function getRawRange(from, to){
    const key = `${from}|${to}`;
    if (rawCache.has(key)) return rawCache.get(key);
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    let payload;
    try {
      payload = await apiJson(`/api/stats/gtfs/rawrange?${query}`);
    } catch (_) {
      payload = await apiJson(`/stats/gtfs/rawrange?${query}`);
    }
    const days = Array.isArray(payload) ? payload : (payload?.days || payload?.series || []);
    rawCache.set(key, days);
    return days;
  }
  function computeTrainSeriesFromRawDays(days, from, to, trainId, stop){
    const series = [];
    for (const day of days || []) {
      if (!day?.date || day.date < from || day.date > to) continue;
      const train = day.trains?.[trainId];
      if (!train) continue;
      const flags = statusFlags(train.status, train);
      const value = stop && Object.prototype.hasOwnProperty.call(train.stops || {}, stop)
        ? toNumber(train.stops[stop])
        : maxDelay(train.stops);
      const bucket = flags.partial ? 'PARTIAL' : flags.canceled ? 'CANCELED' :
        (flags.delayed || value > 0) ? 'DELAYED' : 'ON_TIME';
      series.push({
        date: day.date,
        status: String(train.status || ''),
        bucket,
        value: flags.canceled ? null : value,
        partial: flags.partial
      });
    }
    return { from, to, days: series.length, series };
  }
  window.__lbStats = {
    ...(window.__lbStats || {}),
    getLastDaysRange(days = 10){
      const to = dateAdd(luxDateIso(), -1);
      return { from: dateAdd(to, -(Math.max(1, days) - 1)), to };
    },
    getRawRange,
    computeTrainSeriesFromRawDays,
    colorForPunctuality: punctualityColor,
    openTrain(train){
      byId('statsV2TrainInput').value = normalizeTrain(train);
      setView('train', { autoRun: false });
      return runTrain();
    },
    openStop(stop){
      byId('statsV2StopInput').value = String(stop || '').trim();
      setView('stop', { autoRun: false });
      return runStop();
    }
  };

  root.querySelectorAll('[data-period]').forEach((button) => {
    button.addEventListener('click', () => setPeriod(button.dataset.period, { user: true }));
  });
  byId('statsV2PeriodSelect')?.addEventListener('change', (event) => {
    setPeriod(event.target.value, { user: true });
  });
  root.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  byId('statsV2TargetChoice')?.addEventListener('click', () => {
    setView(activeView === 'stop' ? 'stop' : 'train');
  });
  const closeStatsInfo = () => {
    root.querySelectorAll('.stats-v2__entry-item.is-info-open').forEach((item) => {
      item.classList.remove('is-info-open');
      item.querySelector('[data-stats-info]')?.setAttribute('aria-expanded', 'false');
    });
  };
  root.querySelectorAll('[data-stats-info]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const item = button.closest('.stats-v2__entry-item');
      const shouldOpen = !item?.classList.contains('is-info-open');
      closeStatsInfo();
      if (item && shouldOpen) {
        item.classList.add('is-info-open');
        button.setAttribute('aria-expanded', 'true');
      }
    });
  });
  document.addEventListener('click', closeStatsInfo);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeStatsInfo();
  });
  root.querySelectorAll('[data-compare-kind]').forEach((button) => {
    button.addEventListener('click', () => setCompareKind(button.dataset.compareKind));
  });
  root.querySelectorAll('[data-compare-scale]').forEach((button) => {
    button.addEventListener('click', () => setCompareScale(button.dataset.compareScale));
  });
  byId('statsV2CompareRun')?.addEventListener('click', runCompare);
  root.querySelectorAll('[data-granularity]').forEach((button) => {
    button.addEventListener('click', () => setGranularity(button.dataset.granularity, { user: true }));
  });
  const evolutionToggle = byId('statsV2EvolutionToggle');
  const evolutionSummary = byId('statsV2EvolutionSummary');
  const evolutionDetail = byId('statsV2EvolutionDetail');
  function setEvolutionDetail(open, { render = true } = {}){
    if (!evolutionToggle || !evolutionSummary || !evolutionDetail) return;
    const isOpen = Boolean(open);
    evolutionSummary.hidden = !isOpen;
    evolutionDetail.hidden = !isOpen;
    evolutionToggle.closest('.stats-v2__punct-evolution')?.classList.toggle('is-open', isOpen);
    evolutionToggle.innerHTML = isOpen ? 'Masquer&nbsp;−' : 'Détails&nbsp;+';
    evolutionToggle.setAttribute('aria-expanded', String(isOpen));
    evolutionToggle.setAttribute(
      'aria-label',
      isOpen
        ? 'Masquer le graphique détaillé de ponctualité'
        : 'Afficher le graphique détaillé de ponctualité'
    );
    if (!isOpen) {
      destroyChart('evolutionMini');
      destroyChart('evolution');
    }
    if (render) renderEvolution();
    if (isOpen) {
      window.setTimeout(() => {
        try { charts.evolution?.resize?.(); } catch (_) {}
      }, 80);
    }
  }
  /* La vue complète ne s'affiche que sur demande, même après restauration de la page. */
  setEvolutionDetail(false, { render: false });
  evolutionToggle?.addEventListener('click', () => {
    setEvolutionDetail(evolutionToggle.getAttribute('aria-expanded') !== 'true');
  });
  byId('statsV2ApplyRange')?.addEventListener('click', () => setPeriod('custom', { user: true, loadCustom: true }));
  byId('statsV2TrainRun')?.addEventListener('click', runTrain);
  byId('statsV2StopRun')?.addEventListener('click', runStop);
  ['statsV2TrainInput', 'statsV2TrainStop', 'statsV2StopInput'].forEach((id) => {
    byId(id)?.addEventListener('input', () => { hasTargetInteracted = true; });
  });
  byId('statsV2CompareInputs')?.addEventListener('input', () => {
    hasTargetInteracted = true;
  });
  byId('statsV2TrainInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTrain();
  });
  byId('statsV2StopInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runStop();
  });
  byId('statsV2TrainList')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-stats-train]');
    if (!row) return;
    hasTargetInteracted = true;
    byId('statsV2TrainInput').value = row.dataset.statsTrain;
    setView('train', { autoRun: false });
    runTrain();
  });

  document.addEventListener('lb:auth-state', (event) => {
    const isAuthed = event.detail?.isAuthed === true;
    updateAuthUI(isAuthed);
    if (isAuthed && window.lbPrefsCache) {
      hydrateFromAccount(window.lbPrefsCache, { applyDefaults: !hasTargetInteracted });
    }
  });
  document.addEventListener('lb:prefs-updated', (event) => {
    if (event.detail?.source === 'stats-v2') return;
    hydrateFromAccount(event.detail?.prefs || window.lbPrefsCache, { applyDefaults: !hasTargetInteracted });
  });
  const resizeStatsCharts = () => {
    window.setTimeout(() => {
      Object.values(charts).forEach((chart) => {
        try { chart?.resize?.(); } catch (_) {}
      });
    }, 80);
  };
  window.addEventListener('hashchange', () => {
    if (location.hash === '#stats') resizeStatsCharts();
  });
  window.addEventListener('lb:chart-ready', () => {
    if (currentOverview) renderOverview();
    resizeStatsCharts();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && location.hash === '#stats') resizeStatsCharts();
  });

  const latestDataDate = dateAdd(luxDateIso(), -1);
  ['statsV2From', 'statsV2To'].forEach((id) => {
    const input = byId(id);
    if (input) {
      input.min = DATA_START;
      input.max = latestDataDate;
    }
  });
  applySettingsToForm({ force: true });
  applyModuleVisibility();
  updateAuthUI();
  setGranularity(granularity);
  setCompareKind('period');
  setView('overview', { autoRun: false });

  // PERF : initialise les contrôles Stats immédiatement, mais ne charge les
  // données complètes que lorsque l'utilisateur ouvre réellement #stats.
  const statsViewIsOpen = () => (window.location.hash || '').toLowerCase() === '#stats';
  const ensureStatsViewData = () => {
    if (!statsViewIsOpen()) return;
    if (!currentOverview) loadOverview();
  };
  setPeriod('30d', { skipLoad: !statsViewIsOpen() });
  window.addEventListener('hashchange', ensureStatsViewData, { passive:true });

  if (window.lbIsAuthed === true && window.lbPrefsCache) {
    hydrateFromAccount(window.lbPrefsCache, { applyDefaults: true });
  }
});

;

const betaModal = document.getElementById("betaModal");
const betaAcknowledge = document.getElementById("betaAcknowledge");
const BETA_NOTICE_KEY = "betaNoticeAcknowledged";

// Masquer la pop-up si elle a déjà été validée
if (localStorage.getItem(BETA_NOTICE_KEY) === "1") {
  betaModal.style.display = "none";
}

// Bouton de confirmation
betaAcknowledge.addEventListener("click", () => {
  localStorage.setItem(BETA_NOTICE_KEY, "1");
  betaModal.style.display = "none";
});

// Accessibilité : fermer avec Échap
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && betaModal.style.display !== "none") {
    betaAcknowledge.click();
  }
});

;

/* ===== METEO – Bloc unique iOS-safe (remplace tout l'ancien bloc) =====

/* ---- Etat global météo ---- */
window.__WX__ = window.__WX__ || { timer: null, runId: 0, abort: null, firstRun: true };
function __wxSetTimer(id){ window.__WX__.timer = id; window.wxTimer = id; } // alias compat historique

/* ---- COORDS connues + cache GTFS ---- */
const GARE_COORDS = {
  "Luxembourg":        { lat: 49.598, lon: 6.134 },
  "Bettembourg":       { lat: 49.518, lon: 6.105 },
  "Howald":            { lat: 49.579, lon: 6.132 },
  "Metz":              { lat: 49.119, lon: 6.176 },
  "Thionville":        { lat: 49.360, lon: 6.170 },
  "Hagondange":        { lat: 49.257, lon: 6.168 },
  "Uckange":           { lat: 49.302, lon: 6.155 },
  "Hettange-Grande":   { lat: 49.403, lon: 6.152 },
  "Woippy":            { lat: 49.152, lon: 6.165 },
  "Maizières-lès-Metz":{ lat: 49.222, lon: 6.165 },
  "Pagny-sur-Moselle": { lat: 48.984, lon: 6.026 },
  "Pont-à-Mousson":    { lat: 48.907, lon: 6.063 },
  "Nancy":             { lat: 48.692, lon: 6.184 }
};
// --- WX station name canonicalization (accents / hyphens / case) ---
function __wxCanon(s){
  try{
    return String(s||'').trim()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // remove accents
      .replace(/[’']/g,'')
      .replace(/\bsaint\b/g,'st')
      .replace(/[^a-z0-9]+/g,''); // remove spaces, hyphens, punctuation
  }catch(e){
    return String(s||'').trim().toLowerCase();
  }
}
const __WX_CANON_MAP = (function(){
  const m = new Map();
  try{
    Object.keys(GARE_COORDS||{}).forEach(k=>{
      m.set(__wxCanon(k), k);
    });
  }catch(e){}
  return m;
})();
function __wxResolveKey(name){
  if(!name) return null;
  const raw = String(name).trim();
  if(GARE_COORDS[raw]) return raw;
  const ck = __wxCanon(raw);
  if(__WX_CANON_MAP.has(ck)) return __WX_CANON_MAP.get(ck);
  // a few common variants
  const variants = [
    ck.replace('grande','grande'), // noop but placeholder
    ck.replace('lesmetz','lesmetz'),
  ];
  for(const v of variants){
    if(__WX_CANON_MAP.has(v)) return __WX_CANON_MAP.get(v);
  }
  return null;
}

const WX_COORDS_CACHE = new Map();

/* ---- Helpers ---- */
function __isSelectedDateToday(){
  try{
    const v = document.getElementById('trainDate')?.value || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Luxembourg', year:'numeric', month:'2-digit', day:'2-digit'
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    return v === `${p.year}-${p.month}-${p.day}`;
  }catch{ return true; }
}

/* ---- Annuler proprement la météo en cours (à appeler avant toute régénération) ---- */
function cancelWeatherFetch(){
  window.__WX__.runId++;                                  // invalide les rendus en vol
  try { window.__WX__.abort?.abort(); } catch{}           // abort fetch courant
  window.__WX__.abort = null;
  if (window.__WX__.timer){ clearInterval(window.__WX__.timer); __wxSetTimer(null); } // coupe timer
}

/* ---- Résolution coords : manuel -> cache -> GTFS ---- */
async function resolveCoordsByName(name){
  if (!name) return null;
  if (GARE_COORDS[name]) return GARE_COORDS[name];
  if (WX_COORDS_CACHE.has(name)) return WX_COORDS_CACHE.get(name);

 if (typeof getIdsForName !== 'function') return null;

  try {
    if (!Array.isArray(GTFS?.stops)) {
      if (GTFS_LOADING_PROMISE) {
        try { await GTFS_LOADING_PROMISE; } catch { return null; }
      } else {
        return null; // n'amorce pas un chargement lourd juste pour la météo
      }
    }

    if (!Array.isArray(GTFS?.stops)) return null;
    if (typeof buildStationGroups === 'function') buildStationGroups();
    if (!GTFS.idToStop) return null;

    const ids = getIdsForName(name);
    if (!ids || !ids.size) return null;

    let sumLat = 0, sumLon = 0, n = 0;
    ids.forEach(id => {
      const st = GTFS.idToStop?.get(id);
      const la = parseFloat(st?.stop_lat);
      const lo = parseFloat(st?.stop_lon);
      if (Number.isFinite(la) && Number.isFinite(lo)) { sumLat += la; sumLon += lo; n++; }
    });
    if (!n) return null;

    const c = { lat: +(sumLat/n).toFixed(5), lon: +(sumLon/n).toFixed(5) };
    WX_COORDS_CACHE.set(name, c);
    GARE_COORDS[name] = c; // hydrate pour appels suivants synchro
    return c;
  } catch { return null; }
}

/* ---- Lien Windy ---- */
function buildWeatherLinkByName(name, zoom = 10){
  const c = GARE_COORDS[name] || WX_COORDS_CACHE.get(name);
  if (!c) return null;
  const lat = Number(c.lat).toFixed(3);
  const lon = Number(c.lon).toFixed(3);
  return `https://www.windy.com/${lat}/${lon}?temp,${lat},${lon},${zoom},d:picker`;
}

/* ---- WMO -> icône + libellé ---- */
function wmoToIcon(code, isDay = true){
  if (code === 0) return { ico: isDay ? "☀️" : "🌙", label: "Ciel clair" };
  if (code === 1) return { ico: isDay ? "🌤️" : "☁️", label: "Peu nuageux" };
  if (code === 2) return { ico: "⛅", label: "Partiellement nuageux" };
  if (code === 3) return { ico: "☁️", label: "Couvert" };
  if ([45,48].includes(code)) return { ico: "🌫️", label: "Brouillard" };
  if ([51,53,55].includes(code)) return { ico: "🌦️", label: "Bruine" };
  if ([56,57].includes(code)) return { ico: "🌧️", label: "Bruine verglaçante" };
  if ([61,63].includes(code)) return { ico: "🌧️", label: "Pluie" };
  if (code === 65) return { ico: "🌧️", label: "Pluie forte" };
  if ([66,67].includes(code)) return { ico: "🌧️", label: "Pluie verglaçante" };
  if ([71,73].includes(code)) return { ico: "🌨️", label: "Neige" };
  if (code === 75) return { ico: "❄️", label: "Neige forte" };
  if (code === 77) return { ico: "🌨️", label: "Grains de neige" };
  if ([80,81].includes(code)) return { ico: "🌦️", label: "Averses" };
  if (code === 82) return { ico: "🌧️", label: "Averses fortes" };
  if (code === 85) return { ico: "🌨️", label: "Averses de neige" };
  if (code === 86) return { ico: "❄️", label: "Averses de neige fortes" };
  if (code === 95) return { ico: "⛈️", label: "Orage" };
  if ([96,99].includes(code)) return { ico: "⛈️", label: "Orage (grêle)" };
  return { ico: "❔", label: `Code ${code}` };
}

/* ---- Fetch Open-Meteo en chunks (iOS=4, autres=8) ---- */
async function __fetchOpenMeteoChunk(coordsSlice, opt = {}){
  const { signal, timeoutMs = 7000 } = opt || {};
  if (!coordsSlice.length) return new Map();

  const latList = coordsSlice.map(c => c.lat).join(',');
  const lonList = coordsSlice.map(c => c.lon).join(',');
  const qs = new URLSearchParams({
    latitude: latList,
    longitude: lonList,
    current: 'temperature_2m,weather_code,is_day',
    timezone: 'Europe/Luxembourg'
  }).toString();

  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal){
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relay, { once:true });
  }
  const to = setTimeout(()=>ctrl.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?'+qs, { signal: ctrl.signal, cache:'no-store' });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const json = ct.includes('application/json') ? await res.json() : JSON.parse(await res.text());

    let list;
    if (Array.isArray(json)) list = json;                  // improbable mais safe
    else if (Array.isArray(json?.results)) list = json.results;
    else if (json && json.current) list = [json];
    else list = [];

    const out = new Map();
    for (let i=0; i<coordsSlice.length; i++){
      const name = coordsSlice[i].name;
      const curr = (list[i] && list[i].current) || {};
      out.set(name, {
        temp: (typeof curr.temperature_2m === 'number') ? curr.temperature_2m : null,
        code: (typeof curr.weather_code === 'number') ? curr.weather_code : null,
        isDay: !!curr.is_day,
        time: curr.time || null
      });
    }
    return out;
  } catch(e){
    console.warn('[WX] chunk fail:', e?.message || e);
    return new Map();
  } finally {
    clearTimeout(to);
  }
}

/* ---- API: fetchWeatherForStations(names[, {signal, timeoutMs}]) ---- */
async function fetchWeatherForStations(stationNames, opt = {}){
  const { signal, timeoutMs = 7000 } = opt || {};
  const seen = new Set();
  const coords = [];
  for (const name of stationNames || []) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const key = __wxResolveKey(name) || name;
    const c = GARE_COORDS[key] || WX_COORDS_CACHE.get(key) || await resolveCoordsByName(key);
    // keep display name as chosen, but cache under key
    if(c && !WX_COORDS_CACHE.get(key) && !GARE_COORDS[key]) { try{ WX_COORDS_CACHE.set(key, c); }catch(e){} }
    if (c && Number.isFinite(+c.lat) && Number.isFinite(+c.lon)) {
      coords.push({ name, lat:+c.lat, lon:+c.lon });
    }
  }
  if (!coords.length) return new Map();

  const CHUNK = window.__IS_IOS__ ? 4 : 8;
  const merged = new Map();

  for (let i=0; i<coords.length; i += CHUNK){
    const slice = coords.slice(i, i+CHUNK);
    const part = await __fetchOpenMeteoChunk(slice, { signal, timeoutMs });
    part.forEach((v,k) => merged.set(k, v));
    // petite respiration iOS
    if (window.__IS_IOS__) await new Promise(r => setTimeout(r, 0));
  }
  return merged;
}

/* ---- Met à jour les pastilles météo dans le tableau ---- */
async function updateWeatherBadges(){
  const myRun = ++window.__WX__.runId; // single-flight id
  try{
    const table = document.querySelector('#trainInfo table');
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr[data-gare]'));
    if (!rows.length) return;

    if (!__isSelectedDateToday()){
      rows.forEach(r => { const wx=r.querySelector('.wx'); if(wx){ wx.textContent=''; wx.removeAttribute('title'); } });
      return;
    }

    const names = [...new Set(rows.map(r => r.dataset.gare).filter(Boolean))];

    // Résoudre coord manquantes (via GTFS) si besoin
    const missing = names.filter(n => !(GARE_COORDS[n]) && !(WX_COORDS_CACHE.get(n)));
    if (missing.length) await Promise.all(missing.map(n => resolveCoordsByName(n).catch(()=>null)));

    // Abort l'ancien fetch et crée un nouveau contrôleur partagé
    try { window.__WX__.abort?.abort(); } catch{}
    window.__WX__.abort = new AbortController();

    const data = await fetchWeatherForStations(names, { signal: window.__WX__.abort.signal });

    // Si une autre MAJ a commencé entre-temps, on ignore ce rendu
    if (myRun !== window.__WX__.runId) return;

    rows.forEach(r => {
      const name = r.dataset.gare;
      const wx = r.querySelector('.wx'); if (!wx) return;

      const d = data.get(name);
      if (!d || d.code == null) { wx.textContent=''; wx.removeAttribute('title'); return; }

      const meta = wmoToIcon(d.code, !!d.isDay);
      const t = (typeof d.temp === 'number') ? Math.round(d.temp)+'°' : '';
      const url = buildWeatherLinkByName(name);

      if (url) {
        wx.innerHTML = `<a class="wx-link" href="${url}" target="_blank" rel="noopener" title="${meta.label}${t?' • '+t:''}">
          <span class="wx-ico">${meta.ico}</span><span class="wx-t">${t}</span>
        </a>`;
      } else {
        wx.textContent = `${meta.ico}${t ? ' ' + t : ''}`;
        wx.title = `${meta.label}${t ? ' • ' + t : ''}`;
      }
    });
  } catch(e){
    console.warn('[weather] soft error', e);
  }
}

/* ---- Auto-refresh (timer unique + visibilité) ---- */
function startWeatherAutorefresh(intervalMs = 5 * 60 * 1000){
  if (window.__WX__.timer){ clearInterval(window.__WX__.timer); __wxSetTimer(null); }
  if (!__isSelectedDateToday()) return;

  // 1er tir immédiat
  updateWeatherBadges();

  const arm = () => {
    if (window.__WX__.timer){ clearInterval(window.__WX__.timer); __wxSetTimer(null); }
    if (document.hidden) return;
    __wxSetTimer(setInterval(() => {
      if (!document.hidden) updateWeatherBadges();
    }, intervalMs));
  };
  arm();

  document.removeEventListener('visibilitychange', startWeatherAutorefresh.__vcHandler || (()=>{}));
  startWeatherAutorefresh.__vcHandler = () => arm();
  document.addEventListener('visibilitychange', startWeatherAutorefresh.__vcHandler, { passive:true });
}

/* ---- Warmup iOS sur quelques gares, puis passe complète ---- */
async function __wxWarmupFewStations(){
  try{
    const rows = Array.from(document.querySelectorAll('#trainInfo tr[data-gare]'));
    const first = rows.slice(0, 6).map(r => r.dataset.gare).filter(Boolean);
    if (!first.length) return;
    const data = await fetchWeatherForStations(first);
    rows.forEach(r => {
      const name = r.dataset.gare;
      if (!first.includes(name)) return;
      const wx = r.querySelector('.wx'); if (!wx) return;
      const d = data.get(name);
      if (!d || d.code == null) { wx.textContent=''; wx.removeAttribute('title'); return; }
      const meta = wmoToIcon(d.code, !!d.isDay);
      const t = (typeof d.temp === 'number') ? Math.round(d.temp)+'°' : '';
      const url = buildWeatherLinkByName(name);
      if (url) {
        wx.innerHTML = `<a class="wx-link" href="${url}" target="_blank" rel="noopener" title="${meta.label}${t?' • '+t:''}">
          <span class="wx-ico">${meta.ico}</span><span class="wx-t">${t}</span>
        </a>`;
      } else {
        wx.textContent = `${meta.ico}${t ? ' ' + t : ''}`;
        wx.title = `${meta.label}${t ? ' • ' + t : ''}`;
      }
    });
  }catch(e){ console.warn('[WX warmup]', e?.message || e); }
}

/* ---- Déclenchement météo après stabilisation du tableau ---- */
function scheduleWeatherAfterTableSettled(){
  const tbody = document.querySelector('#trainInfo table tbody');
  if (!tbody) return;

  // coupe toute requête en vol (regen)
  cancelWeatherFetch();

  let idleTimer = null;

  const runFull = () => {
    const period = window.__IS_IOS__ ? 10 * 60 * 1000 : 5 * 60 * 1000;
    updateWeatherBadges().then(() => startWeatherAutorefresh(period));
  };

  const kick = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (window.__IS_IOS__ && window.__WX__.firstRun) {
      window.__WX__.firstRun = false;
      __wxWarmupFewStations();
      setTimeout(runFull, 500); // laisse iOS respirer
    } else {
      runFull();
    }
  };

  const obs = new MutationObserver(() => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { try{obs.disconnect();}catch{} kick(); }, 700);
  });

  obs.observe(tbody, { childList: true, subtree: true });

  // si déjà stable, déclenche vite
  idleTimer = setTimeout(() => { try{obs.disconnect();}catch{} kick(); }, 700);

  // kill-switch sécurité
  setTimeout(() => { try{obs.disconnect();}catch{} }, 4000);
}

// --- Auth La Bétaillère ---
(() => {
  const LB_API = "https://vps.labetaillere.fr/api";
  let lbMode = "login";
  let lbPrefsCache = null;
  let lbPrefsAppliedOnce = false;

  const $ = (id) => document.getElementById(id);
  const msg = (t, isErr = false) => {
    const node = $("lbAuthMsg");
    if (!node) return;
    node.textContent = t;
    node.style.color = isErr ? "#ffaaaa" : "#aab6c8";
  };

  const api = async (path, opts = {}) => {
    const cleanPath = String(path || '');
    const candidates = [LB_API + cleanPath, '/api' + cleanPath];
    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          ...opts,
          headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
          credentials: "include"
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!res.ok) throw (data?.error || `HTTP ${res.status}`);
        return data;
      } catch (err) {
        lastErr = err;
        console.warn('[AUTH API] tentative échouée', url, err?.message || err);
      }
    }
    throw (lastErr?.message || lastErr || 'Failed to fetch');
  };

  const LB_COMMENTS_API = `${LB_API}/comments`;
  const commentApiCandidates = (path = '') => {
    const normalized = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
    const rel = `/api/comments${normalized === '/' ? '' : normalized}`;
    const abs = `${LB_COMMENTS_API}${normalized === '/' ? '' : normalized}`;
    return location.hostname.endsWith('labetaillere.fr') ? [abs, rel] : [abs, rel];
  };

  async function fetchCommentsApi(path = '', options = {}){
    const candidates = commentApiCandidates(path);
    let lastError = null;
    for (const url of candidates){
      try{
        const res = await fetch(url, { credentials: 'include', ...options });
        if (res.ok) return res;
        lastError = new Error(`HTTP ${res.status}`);
      }catch(err){
        lastError = err;
      }
    }
    throw lastError || new Error('Impossible de joindre l’API commentaires');
  }
  window.fetchCommentsApi = fetchCommentsApi;
  let lbCommentState = { wall: [], trains: {} };
  window.lbCommentState = lbCommentState;
  let lbCurrentDetailTrain = '';
  let lbCommentsPoller = null;
  let lbCommentsLoadPromise = null;
  let currentUser = null;
  window.currentUser = null;
  const lbGamificationState = { profile: null, ranking: [], myRank: null, me: null, lastFetchAt: 0, inflight: null };
  const LB_GRADE_LEVELS = [
    { name: 'Porc en déroute', min: -20, image: 'Porc en déroute.png' },
    { name: 'Mouton égaré', min: 0, image: 'Mouton égaré.png' },
    { name: 'Poulette du quai', min: 20, image: 'Poulet du Quai.png' },
    { name: 'Porc entassé du couloir', min: 40, image: 'Porc entassé du couloir.png' },
    { name: 'Bélier du sas', min: 80, image: 'Bélier du sas.png' },
    { name: 'Architecte Chèvre de la galère', min: 120, image: 'Architecte Chèvre de la galère.png' },
    { name: 'Ministre dindon du chaos ferroviaire', min: 180, image: 'Ministre dindon du chaos ferroviaire.png' },
    { name: 'Golden Vache', min: 250, image: 'Golden Vache.png' }
  ];
  let lbProfileCache = null;
  let lbRankingCache = null;
  let lbCurrentMe = null;
  window.lbProfileCache = null;
  window.lbRankingCache = null;
  window.lbCurrentMe = null;
  let lbPseudoTooltip = null;
  let lbPseudoTooltipAnchor = null;

  const safePseudo = () => String(lbPrefsCache?.pseudo || '').trim().slice(0,24);
  const isCommentingAllowed = () => window.lbIsAuthed === true;
  const normalizeGradeKey = (v) => String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  function resolveGradeMeta(gradeLabel, points){
    const key = normalizeGradeKey(gradeLabel);
    let idx = LB_GRADE_LEVELS.findIndex((it)=> normalizeGradeKey(it.name) === key);
    if (idx < 0) idx = LB_GRADE_LEVELS.reduce((best, it, i)=> (points >= it.min ? i : best), 0);
    const current = LB_GRADE_LEVELS[Math.max(0, idx)] || LB_GRADE_LEVELS[0];
    const next = LB_GRADE_LEVELS[idx + 1] || null;
    return { current, next };
  }
  function renderGradeHelpList(){
    const listEl = $("lbGradeHelpList");
    if (!listEl) return;
    const rows = [...LB_GRADE_LEVELS].sort((a,b)=> Number(b.min) - Number(a.min));
    listEl.innerHTML = rows.map((it)=>{
      const threshold = Number(it.min);
      const label = Number.isFinite(threshold)
        ? (threshold < 0 ? '< 0 meuh' : `${threshold}+ meuh`)
        : '—';
      return `<li><span>${escapeHtml(it.name)}</span><span class="v">${escapeHtml(label)}</span></li>`;
    }).join('');
  }
  function bindGradeHelpToggle(){
    const btn = $("lbGradeHelpBtn");
    const pop = $("lbGradeHelpPop");
    if (!btn || !pop || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    const close = ()=>{ pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    const open = ()=>{ pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      if (pop.hidden) open();
      else close();
    });
    document.addEventListener('click', (e)=>{
      if (pop.hidden) return;
      if (e.target === btn || pop.contains(e.target)) return;
      close();
    });
  }
  function replayGradeAppear(imgEl){
    if (!imgEl) return;
    imgEl.classList.remove('lb-grade-appear');
    void imgEl.offsetWidth;
    imgEl.classList.add('lb-grade-appear');
  }
  function renderPrefsGradeCard(grade, points){
    renderGradeHelpList();
    bindGradeHelpToggle();
    const safePoints = Number(points || 0) || 0;
    const { current, next } = resolveGradeMeta(grade, safePoints);
    const span = next ? Math.max(1, (next.min - current.min)) : 1;
    const progress = next ? Math.min(100, Math.max(0, ((safePoints - current.min) / span) * 100)) : 100;
    const nextText = next
      ? `Prochain niveau : ${next.name} · ${Math.max(0, next.min - safePoints)} meuh restants`
      : 'Niveau max atteint 🏆';
    const imagePath = `./${encodeURIComponent(current?.image || 'Mouton égaré.png')}`;
    const cards = [
      {
        card: $("lbPrefsGradeCard"),
        nameEl: $("lbGradeName"),
        pointsEl: $("lbGradePoints"),
        imageEl: $("lbGradeImage"),
        fillEl: $("lbGradeProgressFill"),
        nextEl: $("lbGradeNext")
      },
      {
        card: $("lbProfileGradeCard"),
        nameEl: $("lbProfileGradeName"),
        pointsEl: $("lbProfileGradePoints"),
        imageEl: $("lbProfileGradeImage"),
        fillEl: $("lbProfileGradeProgressFill"),
        nextEl: $("lbProfileGradeNext")
      }
    ];
    cards.forEach((ctx)=>{
      if (!ctx.card) return;
      if (ctx.nameEl) ctx.nameEl.textContent = current?.name || String(grade || 'Mouton égaré');
      if (ctx.pointsEl) ctx.pointsEl.textContent = `${safePoints} meuh`;
      if (ctx.imageEl){
        ctx.imageEl.src = imagePath;
        ctx.imageEl.alt = `Grade ${current?.name || 'Mouton égaré'}`;
        if (ctx.imageEl.id === "lbProfileGradeImage"){
          const authModal = $("lbAuthModal");
          const modalOpen = authModal && authModal.getAttribute("aria-hidden") === "false";
          const allowAppear = ctx.imageEl.dataset.allowAppear === "1";
          if (modalOpen && allowAppear) replayGradeAppear(ctx.imageEl);
          else ctx.imageEl.classList.remove('lb-grade-appear');
        } else {
          replayGradeAppear(ctx.imageEl);
        }
      }
      if (ctx.fillEl) ctx.fillEl.style.width = `${progress.toFixed(1)}%`;
      if (ctx.nextEl) ctx.nextEl.textContent = nextText;
      ctx.card.style.display = window.lbIsAuthed ? "grid" : "none";
    });
  }

  const renderPseudoValue = (it) => String(it?.displayPseudo || it?.pseudo || 'Voyageur').trim().slice(0, 24) || 'Voyageur';
  const renderGradeValue = (it) => String(it?.authorGrade || it?.grade || 'Mouton égaré').trim() || 'Mouton égaré';
  const renderPointsValue = (it) => Number(it?.authorPoints ?? it?.points ?? 0) || 0;
  const normalizeIdentityLite = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');

  function closePseudoTooltip(){
    if (lbPseudoTooltip) lbPseudoTooltip.remove();
    lbPseudoTooltip = null;
    lbPseudoTooltipAnchor = null;
  }

  function openPseudoTooltip(anchor){
    if (!anchor) return;
    const pseudo = anchor.getAttribute('data-pseudo') || 'Voyageur';
    const grade = anchor.getAttribute('data-grade') || 'Mouton égaré';
    const points = Number(anchor.getAttribute('data-points') || 0) || 0;
    if (lbPseudoTooltipAnchor === anchor && lbPseudoTooltip){
      closePseudoTooltip();
      return;
    }
    closePseudoTooltip();
    const tip = document.createElement('div');
    tip.className = 'lb-pseudo-tooltip';
    tip.innerHTML = `<strong>${escapeHtml(pseudo)}</strong><div>${escapeHtml(grade)}</div><div>${escapeHtml(String(points))} meuh</div>`;
    document.body.appendChild(tip);
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - tip.offsetWidth - margin);
    const left = Math.min(maxLeft, Math.max(margin, rect.left));
    const top = Math.min(window.innerHeight - tip.offsetHeight - margin, rect.bottom + 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(margin, top)}px`;
    lbPseudoTooltip = tip;
    lbPseudoTooltipAnchor = anchor;
  }

  function buildPseudoTriggerHtml(item){
    const points = renderPointsValue(item);
    const grade = renderGradeValue(item);
    const gradeIndex = Math.max(0, LB_GRADE_LEVELS.indexOf(resolveGradeMeta(grade, points).current));
    return `<span class="lb-pseudo-trigger lb-pseudo-grade lb-pseudo-grade-${gradeIndex}" data-lb-pseudo-trigger data-pseudo="${escapeHtml(renderPseudoValue(item))}" data-grade="${escapeHtml(grade)}" data-points="${escapeHtml(String(points))}">${escapeHtml(renderPseudoValue(item))}</span>`;
  }
  window.buildPseudoTriggerHtml = buildPseudoTriggerHtml;

  window.lbParseTimestamp = window.lbParseTimestamp || function(value){
    const raw = value == null ? Date.now() : value;

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw < 1e12 ? raw * 1000 : raw;
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return Date.now();

      if (/^\d+$/.test(trimmed)) {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
      }

      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
        const utcLike = new Date(trimmed.replace(' ', 'T') + 'Z');
        if (Number.isFinite(utcLike.getTime())) return utcLike.getTime();
      }

      const parsed = new Date(trimmed);
      if (Number.isFinite(parsed.getTime())) return parsed.getTime();
    }

    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Date.now();
  };

  function normalizeCommentItem(raw){
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = raw.created_at || raw.createdAt || raw.ts || raw.timestamp || Date.now();
    const createdTs = window.lbParseTimestamp(createdAt);
    return {
      id: raw.id || `${createdTs}_${Math.random().toString(36).slice(2,8)}`,
      pseudo: String(raw.pseudo || raw.username || raw.user_pseudo || raw.display_pseudo || 'Voyageur').trim().slice(0, 24),
      displayPseudo: String(raw.display_pseudo || raw.pseudo || raw.username || raw.user_pseudo || 'Voyageur').trim().slice(0, 24),
      authorGrade: String(raw.author_grade || raw.grade || '').trim(),
      authorPoints: Number(raw.author_points || raw.points || 0),
      text: String(raw.message || raw.text || '').trim().slice(0, 180),
      trainNumber: String(raw.train_number || raw.trainNumber || '').trim(),
      userId: String(raw.user_id || raw.userId || '').trim(),
	  accountId: String(raw.account_id || raw.accountId || raw.user_id || '').trim(),
      ts: createdTs
    };
  }


  function lbMentionToken(pseudo){
    return String(pseudo || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/\s+/g, '_')
      .replace(/[^\p{L}\p{N}_.-]+/gu, '')
      .slice(0, 32);
  }
  window.lbMentionToken = lbMentionToken;

  function lbCurrentWallPseudo(){
    return String(
      currentUser?.public_pseudo ||
      currentUser?.publicPseudo ||
      currentUser?.pseudo ||
      lbPrefsCache?.public_pseudo ||
      lbPrefsCache?.pseudo ||
      ''
    ).trim();
  }

  function lbCommentOwnedByCurrentUser(item){
    const me = String(currentUser?.id ?? '').trim();
    if (!me) return false;
    const userId = String(item?.userId ?? '').trim();
    const accountId = String(item?.accountId ?? '').trim();
    return userId === me || accountId === me || accountId === 'uid:' + me;
  }
  window.lbCommentOwnedByCurrentUser = lbCommentOwnedByCurrentUser;

  function lbRenderWallMessageHtml(rawText){
    const src = String(rawText || '');
    let html = escapeHtml(src).replace(
      /&lt;span class=&quot;(lb-red|lb-orange)&quot;&gt;([\s\S]*?)&lt;\/span&gt;/g,
      function(_, cls, inner){
        return '<span class="' + cls + '">' + inner + '</span>';
      }
    );

    const meToken = lbMentionToken(lbCurrentWallPseudo()).toLowerCase();
    html = html.replace(
      /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,32})/gu,
      function(_, before, token){
        const isMe = meToken && String(token).toLowerCase() === meToken;
        return before + '<span class="lb-wall-mention' + (isMe ? ' lb-wall-mention--me' : '') + '">@' + token + '</span>';
      }
    );
    return html;
  }
  window.lbRenderWallMessageHtml = lbRenderWallMessageHtml;

  function lbBuildCommentActionsHtml(item){
    const commentId = String(item?.id ?? '').trim();
    const pseudo = String(item?.displayPseudo || item?.pseudo || 'Voyageur').trim().slice(0, 24);
    const token = lbMentionToken(pseudo);

    const reply = token
      ? `<button type="button" class="lb-comment-action lb-comment-reply" data-comment-reply-pseudo="${escapeHtml(pseudo)}" aria-label="Répondre à ${escapeHtml(pseudo)}" title="Répondre à @${escapeHtml(token)}">↩</button>`
      : '';

    let remove = '';
    if (commentId && currentUser?.role === 'admin') {
      // Modération historique : un seul contrôle rouge pour CelestiaFire/admin.
      remove = `<span class="fav-comments-row"><span class="fav-comment-btn" role="button" tabindex="0" data-comment-delete="${escapeHtml(commentId)}" aria-label="Supprimer le commentaire" title="Supprimer le commentaire">❌</span></span>`;
    } else if (commentId && lbCommentOwnedByCurrentUser(item)) {
      remove = `<button type="button" class="lb-comment-action lb-comment-own-delete" data-comment-delete="${escapeHtml(commentId)}" data-comment-own-delete="1" aria-label="Supprimer mon message" title="Supprimer mon message">🗑</button>`;
    }

    return (reply || remove)
      ? `<span class="lb-comment-actions" aria-label="Actions du message">${reply}${remove}</span>`
      : '';
  }
  window.lbBuildCommentActionsHtml = lbBuildCommentActionsHtml;

  function lbInsertCommentMention(input, pseudo){
    if (!input) return false;
    const token = lbMentionToken(pseudo);
    if (!token) return false;
    const mention = '@' + token;
    const current = String(input.value || '');
    const hasMention = current.toLowerCase().includes(mention.toLowerCase());
    if (!hasMention) {
      input.value = current.trim() ? mention + ' ' + current : mention + ' ';
    }
    input.focus({ preventScroll: true });
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch(_err){}
    input.dispatchEvent(new Event('input', { bubbles:true }));
    return true;
  }
  window.lbInsertCommentMention = lbInsertCommentMention;

  function lbReplyToComment(pseudo, input = null){
    if (window.lbIsAuthed !== true) {
      document.getElementById('lbBtnOpenAuth')?.click();
      return false;
    }
    return lbInsertCommentMention(input || $('homeLiveWallInput'), pseudo);
  }
  window.lbReplyToComment = lbReplyToComment;

  function lbShowMentionToast(item){
    if (!item || document.hidden) return;
    document.getElementById('lbWallMentionToast')?.remove();
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.id = 'lbWallMentionToast';
    toast.className = 'lb-wall-mention-toast';
    const author = String(item.displayPseudo || item.pseudo || 'Un voyageur').trim();
    const text = String(item.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    toast.innerHTML = '<strong>' + escapeHtml(author) + ' vous a mentionné</strong><span>' + escapeHtml(text.slice(0, 105)) + (text.length > 105 ? '…' : '') + '</span>';
    toast.addEventListener('click', () => {
      document.getElementById('lbVoiceChatExpandBtn')?.click();
      toast.remove();
    });
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 8500);
  }

  function lbNotifyCurrentUserMentions(items){
    const meId = String(currentUser?.id ?? '').trim();
    const token = lbMentionToken(lbCurrentWallPseudo());
    if (!meId || !token || !Array.isArray(items)) return;

    const storageKey = 'lb_wall_mentions_seen_v1_' + meId;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(_err){}
    if (!Array.isArray(seen)) seen = [];
    const seenSet = new Set(seen.map(String));
    const needle = '@' + token.toLowerCase();
    const maxAge = 24 * 60 * 60 * 1000;

    const matches = items.filter((item) => {
      const id = String(item?.id ?? '');
      if (!id || seenSet.has(id) || lbCommentOwnedByCurrentUser(item)) return false;
      if (Date.now() - Number(item?.ts || 0) > maxAge) return false;
      return String(item?.text || '').toLowerCase().includes(needle);
    });

    if (!matches.length) return;
    matches.forEach((item) => seenSet.add(String(item.id)));
    try { localStorage.setItem(storageKey, JSON.stringify(Array.from(seenSet).slice(-100))); } catch(_err){}
    lbShowMentionToast(matches[0]);
  }
  window.lbNotifyCurrentUserMentions = lbNotifyCurrentUserMentions;

  function wallNormalizeKey(value){
    return String(value || '').replace(/\D+/g, '').trim();
  }
  window.wallNormalizeKey = wallNormalizeKey;
  const wallHiddenRulesStorageKey = 'lb_wall_hidden_rules_v1';

  function loadHiddenWallRules(){
    try{
      const raw = JSON.parse(localStorage.getItem(wallHiddenRulesStorageKey) || '[]');
      return Array.isArray(raw) ? raw : [];
    }catch(_){
      return [];
    }
  }

  function saveHiddenWallRules(list){
    try{ localStorage.setItem(wallHiddenRulesStorageKey, JSON.stringify(Array.isArray(list) ? list.slice(-500) : [])); }catch(_){}
  }

  function rememberHiddenWallRuleFromSignal(signal){
    const trainKey = wallNormalizeKey(signal?.trainNumber || signal?.train || '');
    const type = String(signal?.signalType || '').toLowerCase();
    const delayMin = Number(signal?.delayMin || 0);
    if (!trainKey) return;
    if (type !== 'suppression' && type !== 'retard') return;
    if (type === 'retard' && delayMin < 15) return;
    const rules = loadHiddenWallRules();
    rules.push({ trainKey, type, delayMin: type === 'retard' ? delayMin : 0, ts: Date.now() });
    saveHiddenWallRules(rules);
  }

  function detectWallTrainNumber(item){
    if (!item) return '';
    const direct = wallNormalizeKey(item.trainNumber || item.train_number || '');
    if (direct) return direct;
    const text = String(item.text || item.message || '');
    const match = text.match(/(?:#?TER|#?RE|#?RB|#?IC|train\s*)?\s*(\d{3,6})/i);
    return match ? wallNormalizeKey(match[1]) : '';
  }

  function shouldHideWallCommentByAutomod(item, trainNumber){
    const trainKey = wallNormalizeKey(trainNumber || detectWallTrainNumber(item));
    if (!trainKey) return false;
	const rawText = String(item?.text || item?.message || '');
    const plainText = rawText.replace(/<[^>]*>/g, ' ').toLowerCase();
    const looksLikeSuppression = /supprim/.test(plainText);
    const delayMatch = plainText.match(/(?:retard|\+)\s*([0-9]{1,3})/i);
    const mentionedDelay = delayMatch ? Number(delayMatch[1]) : null;
    const looksLikeDelay = Number.isFinite(mentionedDelay) && mentionedDelay > 0;
	const hiddenByRule = loadHiddenWallRules().some((r)=>{
      if (wallNormalizeKey(r?.trainKey) !== trainKey) return false;
      const type = String(r?.type || '').toLowerCase();
      if (type === 'suppression') return looksLikeSuppression;
      if (type === 'retard') return looksLikeDelay && Number(mentionedDelay || 0) >= Number(r?.delayMin || 0);
      return false;
    });
    if (hiddenByRule) return true;

    if ((looksLikeSuppression || looksLikeDelay) && typeof getSignalsForTrain === 'function'){
      const activeSignals = getSignalsForTrain(trainKey);
      if (!Array.isArray(activeSignals) || !activeSignals.length) return true;
      if (looksLikeSuppression){
        const hasSuppressionChip = activeSignals.some((s)=> String(s?.signalType || '').toLowerCase() === 'suppression');
        if (!hasSuppressionChip) return true;
      }
      if (looksLikeDelay){
        const hasDelayChip = activeSignals.some((s)=>{
          if (String(s?.signalType || '').toLowerCase() !== 'retard') return false;
          const d = Number(s?.delayMin || 0);
          return d > 0 && (!Number.isFinite(mentionedDelay) || d >= mentionedDelay);
        });
        if (!hasDelayChip) return true;
      }
    }

    if (typeof shouldHideLiveCommentByAutomoderation === 'function'){
      return !!shouldHideLiveCommentByAutomoderation(item, trainKey);
    }
    return false;
  }
  window.shouldHideWallCommentByAutomod = shouldHideWallCommentByAutomod;

  const fmtHour = (ts) => {
    try{
      const raw = ts == null ? Date.now() : ts;
      const parsed = (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))
        ? new Date(raw.replace(' ', 'T') + 'Z')
        : new Date(raw);
      if (!Number.isFinite(parsed.getTime())) return '--:--';
      const parisParts = (dateObj)=>{
        const parts = new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Europe/Paris',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(dateObj);
        const get = (type)=> parts.find((p)=> p.type === type)?.value || '';
        return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
      };
      const commentDate = parisParts(parsed);
      const nowDate = parisParts(new Date());
      const commentStamp = Date.UTC(commentDate.year, commentDate.month - 1, commentDate.day);
      const nowStamp = Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day);
      const dayDiff = Math.round((nowStamp - commentStamp) / 86400000);
      if (dayDiff === 0){
        return parsed.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
      }
      if (dayDiff === 1) return 'hier';
      return parsed.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', timeZone:'Europe/Paris' });
    }catch(e){ return '--:--'; }
  };

  function renderMessages(messages){
    const feed = $('homeLiveWallFeed');
    const form = $('homeLiveWallForm');
    const input = $('homeLiveWallInput');
    const submitBtn = form?.querySelector('button[type="submit"], button:not([type]), .auth-button');
    const cta = $('homeLiveWallCta');
    if (!feed || !form || !input) return;

    const wallSource = Array.isArray(messages) ? messages : lbCommentState.wall;
    const wallAll = Array.isArray(wallSource) ? wallSource : [];
    const wall = wallAll
      .filter((it)=>{
        const trainKey = wallNormalizeKey(it?.trainNumber || detectWallTrainNumber(it));
        if (!trainKey) return true;
        return !shouldHideWallCommentByAutomod(it, trainKey);
      })
      .slice(0, 50);

    if (!wall.length) {
      feed.innerHTML = '<div class="live-wall-empty">Aucun commentaire pour le moment.</div>';
    } else {
      feed.innerHTML = wall.map((it) => `
        <div class="live-wall-item live-wall-item--home live-wall-item--compact">
          <div class="live-wall-item-text"><strong>${buildPseudoTriggerHtml(it)}</strong><span class="live-wall-inline-meta">${escapeHtml(fmtHour(it.ts))}</span> : ${lbRenderWallMessageHtml(it.text || '')}${lbBuildCommentActionsHtml(it)}</div>
        </div>
      `).join('');
      feed.scrollTop = 0;
    }

    form.hidden = false;
    const can = isCommentingAllowed();
    input.disabled = !can;
    if (submitBtn) submitBtn.disabled = !can;
    input.placeholder = can ? 'Partager une info rapide' : 'Connectez-vous pour commenter';
    cta.hidden = can;
    if (!can) cta.textContent = 'Connectez-vous pour commenter en direct.';
    else cta.textContent = '';
  }

  window.renderMessages = renderMessages;
  window.renderHomeLiveWall = renderMessages;

  function renderTrainComments(trainNumber){
    const listEl = $('trainDetailCommentsList');
    const countEl = $('trainDetailCommentsCount');
    const form = $('trainDetailCommentsForm');
    const input = $('trainDetailCommentsInput');
    if (!listEl || !countEl || !form || !input) return;
    const train = String(trainNumber || lbCurrentDetailTrain || '').trim();
    const comments = (Array.isArray(lbCommentState.wall) ? lbCommentState.wall : [])
      .filter((it) => !train || !it.trainNumber || it.trainNumber === train)
	  .filter((it)=>{
        const trainKey = wallNormalizeKey(it?.trainNumber || train || detectWallTrainNumber(it));
        if (!trainKey) return true;
        return !shouldHideWallCommentByAutomod(it, trainKey);
      })
      .slice(0, 30);

    countEl.textContent = String(comments.length);
    listEl.innerHTML = comments.length
      ? comments.map((it)=>`<div class="train-comments-item"><div class="live-wall-meta"><strong>${buildPseudoTriggerHtml(it)}</strong><span>${fmtHour(it.ts)}</span></div><div>${lbRenderWallMessageHtml(it.text || '')}</div></div>`).join('')
      : '<div class="live-wall-empty">Pas encore de commentaire sur ce train.</div>';

    form.hidden = true;
    input.disabled = true;
    input.placeholder = 'Commentaires train bientôt synchronisés';
  }

  function renderCommentsUI(){
    renderMessages();
    renderTrainComments(lbCurrentDetailTrain);
  }

  async function checkAuth(){
    let isAuthed = false;
	currentUser = null;
    window.currentUser = null;
    try{
      const data = await api('/me', { method: 'GET' });
      currentUser = data?.user || null;
      window.currentUser = currentUser;
      isAuthed = !!currentUser;
    }catch(_err){
      isAuthed = false;
	  currentUser = null;
      window.currentUser = null;
    }
    window.lbIsAuthed = isAuthed;

    if (isAuthed) {
      try {
        const data = await api('/prefs', { method: 'GET' });
        lbPrefsCache = data?.prefs || lbPrefsCache || {};
        window.lbPrefsCache = lbPrefsCache;
      } catch(_err){}
    }

    renderCommentsUI();
    if (isAuthed) lbNotifyCurrentUserMentions(lbCommentState.wall);
    refreshGamificationUI({ force: true }).catch(()=>{});
    return isAuthed;
  }

  async function loadMessages(){
    if (lbCommentsLoadPromise) return lbCommentsLoadPromise;
    lbCommentsLoadPromise = (async () => {
      try{
        const res = await fetchCommentsApi('?scope=wall');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
        lbCommentState.wall = list
          .map(normalizeCommentItem)
          .filter(Boolean)
          .sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0))
          .slice(0, 50);
        window.lbCommentState = lbCommentState;
        renderCommentsUI();
        lbNotifyCurrentUserMentions(lbCommentState.wall);
        return lbCommentState.wall;
      }catch(err){
        console.warn('Impossible de charger les commentaires', err);
        if (!Array.isArray(lbCommentState.wall)) lbCommentState.wall = [];
        window.lbCommentState = lbCommentState;
        renderCommentsUI();
        return lbCommentState.wall;
      }
    })().finally(() => { lbCommentsLoadPromise = null; });
    return lbCommentsLoadPromise;
  }

  async function sendMessage(text){
    const message = String(text || '').trim().slice(0, 180);
    if (!message) throw new Error('Commentaire vide');
    if (!isCommentingAllowed()) throw new Error('Connexion requise');

    const res = await fetchCommentsApi('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, scope: 'wall' })
    });

    let data = null;
    try { data = await res.json(); } catch(_err) {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    await loadMessages();
    return data;
  }

  async function deleteComment(id){
    const commentId = String(id || '').trim();
    if (!commentId) throw new Error('Commentaire introuvable');
    if (!currentUser) throw new Error('Connexion requise');

    // Le serveur garde l'autorité finale : admin OU auteur réel du message.
    const res = await fetch(`https://vps.labetaillere.fr/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    let data = null;
    try { data = await res.json(); } catch(_err) {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    await loadMessages();
    return data;
  }

  window.checkAuth = checkAuth;
  window.loadMessages = loadMessages;
  window.sendMessage = sendMessage;
  window.deleteComment = deleteComment;

  function bindCommentForms(){
    const homeForm = $('homeLiveWallForm');
    const homeInput = $('homeLiveWallInput');
    if (homeForm && !homeForm.dataset.bound){
      homeForm.dataset.bound = '1';
      homeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try{
          await sendMessage(homeInput?.value || '');
          if (homeInput) homeInput.value = '';
          renderCommentsUI();
        }catch(err){
          alert(err?.message || "Impossible d'ajouter le commentaire.");
        }
      });
    }

	const feed = $('homeLiveWallFeed');
    if (feed && !feed.dataset.deleteBound){
      feed.dataset.deleteBound = '1';
      feed.addEventListener('click', async (e) => {
        const replyBtn = e.target.closest('[data-comment-reply-pseudo]');
        if (replyBtn) {
          e.preventDefault();
          e.stopPropagation();
          lbReplyToComment(replyBtn.getAttribute('data-comment-reply-pseudo'));
          return;
        }

        const btn = e.target.closest('[data-comment-delete]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.hasAttribute('data-comment-own-delete') && !window.confirm('Supprimer votre message ?')) return;
        try{
          await deleteComment(btn.getAttribute('data-comment-delete'));
        }catch(err){
          alert(err?.message || "Impossible de supprimer le commentaire.");
        }
      });
      feed.addEventListener('keydown', async (e) => {
        const btn = e.target.closest('[data-comment-delete]');
        // Les boutons natifs déclenchent déjà click avec Entrée/Espace.
        if (!btn || btn.tagName === 'BUTTON' || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        try{
          await deleteComment(btn.getAttribute('data-comment-delete'));
        }catch(err){
          alert(err?.message || "Impossible de supprimer le commentaire.");
        }
      });
    }

    const trainForm = $('trainDetailCommentsForm');
    const trainInput = $('trainDetailCommentsInput');
    if (trainForm && !trainForm.dataset.bound){
      trainForm.dataset.bound = '1';
      trainForm.hidden = true;
      if (trainInput) {
        trainInput.disabled = true;
        trainInput.placeholder = 'Commentaires train bientôt synchronisés';
      }
    }
  }

  function bindPseudoTooltipEvents(){
    if (document.body.dataset.lbPseudoBound) return;
    document.body.dataset.lbPseudoBound = '1';
    document.addEventListener('mouseover', (e)=>{
      const trigger = e.target.closest('[data-lb-pseudo-trigger]');
      if (!trigger) return;
      if (window.matchMedia('(hover: hover)').matches) openPseudoTooltip(trigger);
    });
    document.addEventListener('mouseout', (e)=>{
      if (!window.matchMedia('(hover: hover)').matches) return;
      const leaving = e.target.closest?.('[data-lb-pseudo-trigger]');
      if (!leaving) return;
      const related = e.relatedTarget?.closest?.('[data-lb-pseudo-trigger]');
      if (related === leaving) return;
      closePseudoTooltip();
    });
    document.addEventListener('click', (e)=>{
      const trigger = e.target.closest('[data-lb-pseudo-trigger]');
      if (trigger){
        if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window){
          e.preventDefault();
          openPseudoTooltip(trigger);
        }
        return;
      }
      if (lbPseudoTooltip && !e.target.closest('.lb-pseudo-tooltip')) closePseudoTooltip();
    });
    window.addEventListener('scroll', closePseudoTooltip, { passive: true });
    window.addEventListener('resize', closePseudoTooltip, { passive: true });
  }

  function stopCommentsPolling(){
    if (lbCommentsPoller) clearTimeout(lbCommentsPoller);
    lbCommentsPoller = null;
  }

  function scheduleCommentsPolling(delayMs = 15000){
    stopCommentsPolling();
    if (document.hidden || !navigator.onLine) return;
    lbCommentsPoller = setTimeout(async () => {
      await loadMessages();
      scheduleCommentsPolling(15000);
    }, Math.max(1000, Number(delayMs) || 15000));
  }

  function startCommentsPolling(){
    scheduleCommentsPolling(15000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCommentsPolling();
    else loadMessages().finally(() => scheduleCommentsPolling(15000));
  }, { passive:true });
  window.addEventListener('online', () => loadMessages().finally(() => scheduleCommentsPolling(15000)), { passive:true });
  window.addEventListener('offline', stopCommentsPolling, { passive:true });

  window.lbComments = {
    setCurrentTrain(trainNumber){
      lbCurrentDetailTrain = String(trainNumber || '').trim();
      renderTrainComments(lbCurrentDetailTrain);
    },
    refresh(){ loadMessages(); },
    count(trainNumber){
      const train = String(trainNumber || '').trim();
      return (Array.isArray(lbCommentState.wall) ? lbCommentState.wall : [])
        .filter((it) => !train || it.trainNumber === train)
        .filter((it)=>{
          const trainKey = wallNormalizeKey(it?.trainNumber || train || detectWallTrainNumber(it));
          if (!trainKey) return true;
          return !shouldHideWallCommentByAutomod(it, trainKey);
        }).length;
    }
  };

  bindCommentForms();
  bindPseudoTooltipEvents();
  renderCommentsUI();
  checkAuth().finally(loadMessages);
  startCommentsPolling();
  const openModal = () => {
    const modal = $("lbAuthModal");
    if (!modal) return;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
	const profileGradeImg = $("lbProfileGradeImage");
    if (profileGradeImg){
      profileGradeImg.dataset.allowAppear = "0";
      profileGradeImg.classList.remove('lb-grade-appear');
    }
    if (window.__lbProfileGradeAppearTimer){
      clearTimeout(window.__lbProfileGradeAppearTimer);
      window.__lbProfileGradeAppearTimer = null;
    }
    window.__lbProfileGradeAppearTimer = setTimeout(() => {
      const img = $("lbProfileGradeImage");
      if (!img) return;
      img.dataset.allowAppear = "1";
      replayGradeAppear(img);
    }, 500);
  };

  const closeModal = () => {
    const modal = $("lbAuthModal");
    if (!modal) return;
	const profileGradeImg = $("lbProfileGradeImage");
    if (profileGradeImg){
      profileGradeImg.dataset.allowAppear = "0";
      profileGradeImg.classList.remove('lb-grade-appear');
    }
    if (window.__lbProfileGradeAppearTimer){
      clearTimeout(window.__lbProfileGradeAppearTimer);
      window.__lbProfileGradeAppearTimer = null;
    }
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  };

  const setMode = (mode) => {
    lbMode = mode;
    const submitBtn = $("lbBtnSubmit");
    const rgpdWrap = $("lbRgpdWrap");
    const rgpdInput = $("lbRgpd");
    const forgotWrap = $("lbForgotWrap");
    const switchLabel = $("lbAuthSwitchLabel");
    const switchBtn = $("lbAuthSwitchBtn");
    if (!submitBtn || !rgpdWrap || !rgpdInput) return;

    submitBtn.textContent = "Se connecter";
    rgpdWrap.style.display = "none";
    rgpdInput.required = false;
    if (forgotWrap) forgotWrap.style.display = "block";
    if (switchLabel) switchLabel.textContent = "Pas de compte ?";
    if (switchBtn) switchBtn.textContent = "Créer un compte";
  };

  function updateHomeWelcomeLine(){
    try{
      const line = document.getElementById('homeWelcomeLine');
      if (!line) return;
      const pseudoFromPrefs = String(window.lbPrefsCache?.pseudo || '').trim();
      const pseudoFromUser = String(window.currentUser?.pseudo || window.currentUser?.username || '').trim();
      const pseudo = pseudoFromPrefs || pseudoFromUser;
      line.textContent = pseudo
        ? `Bienvenue ${pseudo} dans la bétaillère`
        : 'Bienvenue dans la bétaillère';
    }catch(_){}
  }

  const applyPreferences = (prefs, options = {}) => {
    if (!prefs) return;
    applyCustomRapidPresets(prefs);
    lbPrefsCache = prefs;
    window.lbPrefsCache = lbPrefsCache;
    try {
      document.dispatchEvent(new CustomEvent("lb:prefs-updated", {
        detail: { prefs: lbPrefsCache }
      }));
    } catch (_) {}

    // Remplir les champs favoris dans la modale Préférences
    const pseudoInput = $("lbPseudo");
    const favAM = $("lbFavMorning");
    const favPM = $("lbFavEvening");
    if (pseudoInput) pseudoInput.value = (prefs.pseudo || "").trim();
    if (favAM) favAM.value = prefs.favoriteMorningTrain || "";
    if (favPM) favPM.value = prefs.favoriteEveningTrain || "";
    updateHomeWelcomeLine();
    // Gare favorite (départ/arrivée) -> utilisée comme valeur par défaut dans l'onglet Affluence
    const favFrom = $("lbFavFromStation");
    const favTo   = $("lbFavToStation");
    if (favFrom) favFrom.value = prefs.favoriteFromStation || "";
    if (favTo)   favTo.value   = prefs.favoriteToStation || "";
    window.__lbPreferredAffStation = (prefs.favoriteFromStation || "").trim();
    window.__lbPreferredAffTo = (prefs.favoriteToStation || "").trim();


    // Météo: source unique = gares favorites (départ/arrivée)
    try{
      const p = window.lbPrefsCache || {};
      const from = (p.favoriteFromStation || '').trim();
      const to   = (p.favoriteToStation   || '').trim();
      const inpFrom = document.getElementById('lbWxFromStation');
      const inpTo   = document.getElementById('lbWxToStation');
      if (inpFrom) inpFrom.value = from;
      if (inpTo)   inpTo.value   = to;
    }catch(e){}
    try{
      const wx = getUserWxPrefsOrDefault();
      updateHomeWeather(wx.from, wx.to).catch(()=>{});
    }catch(e){}
    try{ window.lbComments?.refresh(); }catch(e){}

    // Rafraîchir le widget favoris
    try { if (typeof window.updateFavoriteWidgetFromPrefs === "function") window.updateFavoriteWidgetFromPrefs(); } catch(e) {}

    if (!options.auto) return;
  };

  const loadPreferences = async () => {
    try {
      const data = await api("/prefs");
      const prefs = data?.prefs || {};
      applyPreferences(prefs, { auto: true });
    } catch (err) {
      console.warn("Impossible de charger les préférences", err);
    }
  };

  // Source unique pour l'étoile de la fiche train : les deux favoris du
  // compte, également affichés dans « Mes préférences ».
  window.lbSaveFavoriteTrains = async ({ morning = "", evening = "" } = {}) => {
    if (window.lbIsAuthed !== true) {
      throw new Error("Connecte-toi pour enregistrer tes bétaillères favorites.");
    }
    const normalizeFavorite = (value) => {
      const match = String(value || "").replace(/\s+/g, "").match(/\d{4,6}/);
      return match ? match[0] : "";
    };
    let remotePrefs = {};
    try {
      const current = await api("/prefs", { method: "GET" });
      remotePrefs = current?.prefs || {};
    } catch (_) {
      remotePrefs = window.lbPrefsCache || lbPrefsCache || {};
    }
    const merged = {
      ...remotePrefs,
      favoriteMorningTrain: normalizeFavorite(morning),
      favoriteEveningTrain: normalizeFavorite(evening)
    };
    await api("/prefs", {
      method: "POST",
      body: JSON.stringify({ prefs: merged })
    });
    applyPreferences(merged, { auto: false });
    return merged;
  };

  function normalizeRankingList(raw){
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.ranking) ? raw.ranking : (Array.isArray(raw?.items) ? raw.items : []));
    return list.map((it, idx)=>({
      rank: Number(it?.rank || it?.position || (idx + 1)),
      pseudo: String(it?.display_pseudo || it?.pseudo || it?.username || 'Voyageur').trim().slice(0, 24),
      grade: String(it?.grade || it?.author_grade || 'Mouton égaré').trim(),
      points: Number(it?.points || it?.author_points || 0) || 0,
	  userId: Number(it?.user_id || it?.id || 0) || null,
      me: !!(it?.me || it?.is_me || it?.self)
    })).filter((it)=> it.rank > 0).sort((a,b)=> a.rank - b.rank);
  }

  function rankMedalSrc(rank){
    const safeRank = Number(rank || 0) || 0;
    if (safeRank === 1) return 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/MedailleOR.png';
    if (safeRank === 2) return 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/MedailleARGENT.png';
    if (safeRank === 3) return 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/MedailleBRONZE.png';
    if (safeRank === 4) return 'https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/MedailleCHOCO.png';
    return '';
  }

  function rankDisplayHtml(rank, options = {}){
    const safeRank = Number(rank || 0) || 0;
    const medalSrc = rankMedalSrc(safeRank);
    if (medalSrc){
      const extraClass = options.profile ? ' lb-rank-medal--profile' : '';
      return `<span class="lb-rank-medal${extraClass}" aria-label="Rang ${safeRank}" title="Rang ${safeRank}"><img src="${medalSrc}" alt="Médaille rang ${safeRank}" loading="lazy" decoding="async"></span>`;
    }
    if (safeRank > 0){
      return options.profile
        ? `<span class="lb-profile-rank-number" aria-label="Rang ${safeRank}" title="Rang ${safeRank}">#${safeRank}</span>`
        : `#${safeRank}`;
    }
    return '—';
  }

  function renderGamificationUI(){
    const host = $("lbProfileTroupeau");
    const rankingHostInline = $("lbProfileRankingInline");
    const podium = $("lbRankingPodium");
    const listEl = $("lbRankingList");
    const podiumInline = $("lbRankingPodiumInline");
    const listElInline = $("lbRankingListInline");
    const filter = $("lbRankingFilter");
    const filterInline = $("lbRankingFilterInline");
    if (filterInline && filter && !filterInline.dataset.lbMirrorBound){
      filterInline.dataset.lbMirrorBound = '1';
      filterInline.addEventListener('change', ()=>{
        if (filter) filter.value = filterInline.value || 'top10';
        renderGamificationUI();
      });
    }
    if (filter && filterInline && filter.value !== filterInline.value){
      filterInline.value = filter.value || 'top10';
    }
    const canShowProfile = window.lbIsAuthed === true;
    if (host) host.style.display = canShowProfile ? "grid" : "none";
    if (rankingHostInline) rankingHostInline.style.display = "none";
    const p = lbGamificationState.profile || {};
    const ranking = Array.isArray(lbGamificationState.ranking) ? lbGamificationState.ranking : [];
    const pseudo = String(p.display_pseudo || p.pseudo || safePseudo() || currentUser?.pseudo || 'Voyageur').trim();
    const grade = String(p.grade || 'Mouton égaré').trim();
    const points = Number(p.points || 0) || 0;
    const myRank = Number(lbGamificationState.myRank || p.rank || 0) || null;
    if ($("lbProfilePseudo")) $("lbProfilePseudo").textContent = pseudo || "—";
    if ($("lbProfilePseudoDisplay")) $("lbProfilePseudoDisplay").textContent = pseudo || "—";
    if ($("lbProfileGrade")) $("lbProfileGrade").textContent = grade || "—";
    if ($("lbProfilePoints")) $("lbProfilePoints").textContent = `${points} meuh`;
    const profileRankHtml = rankDisplayHtml(myRank, { profile: true });
    if ($("lbProfileRank")) $("lbProfileRank").innerHTML = profileRankHtml;
    if ($("lbProfileRankInline")) $("lbProfileRankInline").innerHTML = profileRankHtml;
    if ($("lbProfileRankBadgeText")) $("lbProfileRankBadgeText").innerHTML = profileRankHtml;
    renderPrefsGradeCard(grade, points);

    const top3 = ranking.slice(0, 3);
    const podiumSlots = [2,1,3].map((rankNum)=>{
      const item = top3.find((it)=> it.rank === rankNum);
      if (!item){
        return `<div class="lb-ranking-podium-item pos-${rankNum}">
          <div class="podium-caption">
            <div class="pseudo">—</div>
            <div class="meta">0 meuh</div>
          </div>
        </div>`;
      }
      return `<div class="lb-ranking-podium-item pos-${rankNum}">
        <div class="podium-caption">
          <div class="pseudo">${escapeHtml(item.pseudo)}</div>
          <div class="meta">${escapeHtml(String(item.points))} meuh</div>
        </div>
      </div>`;
    }).join('');
    const podiumHtml = `<div class="lb-ranking-podium-visual">
      ${podiumSlots}
      <img class="lb-ranking-podium-art" loading="lazy" decoding="async" src="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/Podium.png" alt="Podium du classement">
    </div>`;
    if (podium) podium.innerHTML = podiumHtml;
    if (podiumInline) podiumInline.innerHTML = podiumHtml;

    const mode = (filterInline?.value || filter?.value || 'top10');
    if (filter) filter.value = mode;
    if (filterInline) filterInline.value = mode;
    let rows = ranking;
    if (mode === 'top3') rows = ranking.slice(0, 3);
    else if (mode === 'top10') rows = ranking.slice(0, 10);
    else if (mode === 'top50') rows = ranking.slice(0, 50);
    else if (mode === 'around'){
      const aroundRank = myRank || Number(lbGamificationState?.me?.rank || 0) || ranking.find((it)=> it.me)?.rank || null;
      if (aroundRank){
        rows = ranking.filter((it)=> Math.abs(it.rank - aroundRank) <= 2).slice(0, 7);
      } else {
        rows = ranking.slice(0, 10);
      }
    }
    const listHtml = rows.length
      ? rows.map((it)=> `<div class="lb-ranking-row${(myRank && it.rank === myRank) ? ' me' : ''}"><span class="lb-rank-cell">${rankDisplayHtml(it.rank)}</span><span title="${escapeHtml(it.grade)}">${escapeHtml(it.pseudo)}</span><span>${escapeHtml(String(it.points))} 🐮</span></div>`).join('')
      : '<div class="live-wall-empty">Classement indisponible.</div>';
    if (listEl) listEl.innerHTML = listHtml;
    if (listElInline) listElInline.innerHTML = listHtml;
  }

  function resetGamificationUI(){
    lbGamificationState.profile = null;
    lbGamificationState.ranking = [];
    lbGamificationState.myRank = null;
    lbGamificationState.me = null;
    lbGamificationState.lastFetchAt = 0;
    lbGamificationState.inflight = null;
    lbProfileCache = null;
    lbRankingCache = null;
    lbCurrentMe = null;
    window.lbProfileCache = null;
    window.lbRankingCache = null;
    window.lbCurrentMe = null;
    const host = $("lbProfileTroupeau");
    if (host) host.style.display = "none";
    if ($("lbProfilePseudo")) $("lbProfilePseudo").textContent = "—";
    if ($("lbProfilePseudoDisplay")) $("lbProfilePseudoDisplay").textContent = "—";
    if ($("lbProfileGrade")) $("lbProfileGrade").textContent = "—";
    if ($("lbProfilePoints")) $("lbProfilePoints").textContent = "0 meuh";
    if ($("lbProfileRank")) $("lbProfileRank").textContent = "—";
    if ($("lbProfileRankInline")) $("lbProfileRankInline").textContent = "—";
    renderPrefsGradeCard('Mouton égaré', 0);
    if ($("lbProfileRankingInline")) $("lbProfileRankingInline").style.display = "none";
    if ($("lbRankingPodium")) $("lbRankingPodium").innerHTML = '';
    if ($("lbRankingPodiumInline")) $("lbRankingPodiumInline").innerHTML = '';
    if ($("lbRankingList")) $("lbRankingList").innerHTML = '<div class="live-wall-empty">Classement indisponible.</div>';
    if ($("lbRankingListInline")) $("lbRankingListInline").innerHTML = '<div class="live-wall-empty">Classement indisponible.</div>';
  }

  async function refreshGamificationUI(options = {}){
    const force = !!options.force;
    const ttl = 15000;
    const now = Date.now();
    if (!force && lbGamificationState.inflight) return lbGamificationState.inflight;
    if (!force && lbGamificationState.lastFetchAt && (now - lbGamificationState.lastFetchAt) < ttl){
      renderGamificationUI();
      return;
    }
    lbGamificationState.inflight = (async ()=>{
      try{
        const [profileData, rankingData] = await Promise.all([
          window.lbIsAuthed ? api('/me/profile', { method:'GET', cache: 'no-store' }).catch(()=> ({})) : Promise.resolve({}),
          api('/ranking', { method:'GET', cache: 'no-store' }).catch(()=> ({}))
        ]);
        console.log("PROFILE_FRESH", profileData);
        console.log("RANKING_FRESH", rankingData);
        console.log("RANKING_ME_FRESH", rankingData?.me);
        const profile = profileData?.profile || profileData?.me || profileData || {};
        const ranking = normalizeRankingList(rankingData);
        const profileRank = Number(profile?.rank || 0) || null;
        const mePayload = rankingData?.me || null;
        const meUserId = Number(mePayload?.user_id || 0) || null;
        const detectedRank = ranking.find((it)=>
          it.me
          || (meUserId && Number(it.userId || 0) === meUserId)
          || normalizeIdentityLite(it.pseudo) === normalizeIdentityLite(profile?.display_pseudo || profile?.pseudo || safePseudo())
        )?.rank || null;
        lbGamificationState.profile = window.lbIsAuthed ? profile : null;
        lbGamificationState.ranking = ranking;
        lbGamificationState.me = mePayload;
        lbGamificationState.myRank = profileRank || detectedRank || null;
        lbGamificationState.lastFetchAt = Date.now();
		lbProfileCache = lbGamificationState.profile;
        lbRankingCache = lbGamificationState.ranking;
        lbCurrentMe = lbGamificationState.me;
        window.lbProfileCache = lbProfileCache;
        window.lbRankingCache = lbRankingCache;
        window.lbCurrentMe = lbCurrentMe;
      }catch(err){
        console.warn('GAMIFICATION_REFRESH_ERROR', err);
      }
      renderGamificationUI();
    })();
    try{ await lbGamificationState.inflight; } finally { lbGamificationState.inflight = null; }
  }
  window.refreshGamificationUI = refreshGamificationUI;

  if ('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistration().then((reg)=>{
      if (reg) console.log('SW_REG_ACTIVE', reg.scope);
      else console.log('SW_REG_NONE');
    }).catch(()=>{});
  }

  // ===== (UI) Ajuste automatiquement l'échelle des schémas de rame dans les favoris (mobile) =====
  function lbFitFavSchemas(){
    try{
      const wraps = document.querySelectorAll('.fav-aff-schema');
      wraps.forEach(w=>{
        const train = w.querySelector('.affls-rame, .affls-train');
        if(!train) return;
        const isCompact = w.classList.contains('fav-aff-schema--compact');
        const baseScale = isCompact ? 0.84 : 0.80; // compact: UM3 un peu plus réduit pour éviter la coupe à gauche
        // reset
        train.style.transform = `scale(${baseScale})`;
		train.style.transformOrigin = 'right center';
        w.classList.add('is-fit');
        // mesurer
        const cw = w.clientWidth || 0;
        const tw = train.scrollWidth || train.getBoundingClientRect().width || 0;
        let s = baseScale;
        if(cw>0 && tw>0 && tw>cw){
          s = isCompact
            ? Math.max(0.40, Math.min(baseScale, (cw / tw) * baseScale))
            : Math.max(0.48, Math.min(baseScale, (cw / tw) * baseScale));
        }
        train.style.transform = `scale(${s.toFixed(3)})`;
      });
    }catch(e){}
  }
  window.lbFitFavSchemas = lbFitFavSchemas;
  window.addEventListener('resize', ()=>{ try{ lbFitFavSchemas(); }catch(e){} });

  // ===== Widget Favoris Matin/Soir =====




  // --- Fiabilité des favoris : mêmes données et mêmes calculs que la fiche train ---
  // Source directe, sans dépendre de l'ouverture du module STATS.
  const FAV_QUICK_STATS_CACHE = new Map();
  async function getFavQuickStatsData(trainId){
    if (!trainId) return null;

    const today = new Date().toLocaleDateString('en-CA', { timeZone:'Europe/Luxembourg' });
    const toDate = new Date(`${today}T12:00:00Z`);
    toDate.setUTCDate(toDate.getUTCDate() - 1);
    const to = toDate.toISOString().slice(0, 10);
    const fromDate = new Date(toDate.getTime() - (29 * 86400000));
    const from = fromDate.toISOString().slice(0, 10);
    const key = `${trainId}|${from}|${to}|profile-v2`;
    if (FAV_QUICK_STATS_CACHE.has(key)) return FAV_QUICK_STATS_CACHE.get(key);

    try {
      const trainQuery = new URLSearchParams({ from, to, trainId:String(trainId) });
      const dailyQuery = new URLSearchParams({ from, to });
      const fetchStatsJson = async (url) => {
        const response = await fetch(url, { cache:'no-store', credentials:'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      };
      const [payload, dailyPayload] = await Promise.all([
        fetchStatsJson(`https://vps.labetaillere.fr/api/stats/gtfs/train?${trainQuery.toString()}`),
        fetchStatsJson(`https://vps.labetaillere.fr/api/stats/beta/daily?${dailyQuery.toString()}`).catch(() => null)
      ]);
      const series = (Array.isArray(payload?.series) ? payload.series : [])
        .filter((item) => item && item.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!series.length) {
        FAV_QUICK_STATS_CACHE.set(key, null);
        return null;
      }

      let onTime = 0, delayed = 0, canceled = 0, partial = 0;
      const delays = [];
      series.forEach((item) => {
        const bucket = String(item?.bucket || item?.status || '').toUpperCase();
        if (bucket === 'ON_TIME') onTime += 1;
        else if (bucket === 'DELAYED') {
          delayed += 1;
          if (Number.isFinite(Number(item?.value))) delays.push(Number(item.value));
        }
        else if (bucket === 'CANCELED') canceled += 1;
        else if (bucket === 'PARTIAL') partial += 1;
      });
      const total = onTime + delayed + canceled + partial;
      if (!total) return null;
      const pctOnTime = Math.round((onTime / total) * 100);
      const colorFn = window.lbPunctualityColor
        || (window.__lbStats && window.__lbStats.colorForPunctuality);
      const pctColor = typeof colorFn === 'function'
        ? colorFn(pctOnTime)
        : (pctOnTime >= 95 ? '#2add88' : pctOnTime >= 85 ? '#ffc107' : pctOnTime >= 75 ? '#fd7e14' : '#dc3545');

      // Même calendrier que la fiche : vert/orange/rouge/jaune, gris lorsque
      // le train ne circulait pas ou que la donnée journalière manque.
      const observedDates = new Set(
        (dailyPayload?.series || []).map((item) => String(item?.date || '')).filter(Boolean)
      );
      const runsByDate = new Map(series.map((item) => [String(item.date), item]));
      const calendarSeries = [];
      for (let cursor = new Date(`${from}T12:00:00Z`); cursor <= toDate; cursor = new Date(cursor.getTime() + 86400000)) {
        const date = cursor.toISOString().slice(0, 10);
        calendarSeries.push(runsByDate.get(date) || {
          date,
          bucket: observedDates.has(date) ? 'NOT_RUNNING' : 'NO_DATA',
          value: null
        });
      }
      const average = delays.length
        ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length)
        : 0;
      const maximum = delays.length ? Math.max(...delays) : 0;
      const data = {
        from, to, total, pctOnTime, pctColor,
        onTime, delayed, canceled, partial,
        average, maximum,
        series: calendarSeries
      };
      FAV_QUICK_STATS_CACHE.set(key, data);
      return data;
    } catch (error) {
      console.warn('[Favoris] historique compact indisponible', error);
      FAV_QUICK_STATS_CACHE.set(key, null);
      return null;
    }
  }

  async function renderFavStats(kind, trainId){
    const sumEl = document.getElementById(kind === 'AM' ? 'favStatsSummaryAM' : 'favStatsSummaryPM');
    const bodyEl = document.getElementById(kind === 'AM' ? 'favStatsBodyAM' : 'favStatsBodyPM');
    const rootEl = document.getElementById(kind === 'AM' ? 'favStatsAM' : 'favStatsPM');
    if (!sumEl || !bodyEl || !rootEl) return;

    if (!trainId){
      sumEl.innerHTML = '<span class="fav-stats-label">Fiabilité (30 j) : —</span>';
      bodyEl.innerHTML = '';
      rootEl.open = false;
      return;
    }

    sumEl.innerHTML = '<span class="fav-stats-label">Fiabilité (30 j) : chargement…</span>';
    const data = await getFavQuickStatsData(trainId);
    if (!data){
      sumEl.innerHTML = '<span class="fav-stats-label">Fiabilité (30 j) : —</span>';
      bodyEl.innerHTML = '';
      return;
    }

    const runView = (item) => {
      const bucket = String(item?.bucket || item?.status || '').toUpperCase();
      const delay = Number(item?.value);
      if (bucket === 'CANCELED') return { cls:'is-canceled', label:'Supprimé' };
      if (bucket === 'PARTIAL') return { cls:'is-partial', label:'Partiel' };
      if (bucket === 'DELAYED') return { cls:'is-delayed', label:Number.isFinite(delay) && delay > 0 ? `+${Math.round(delay)} min` : 'Retard' };
      if (bucket === 'ON_TIME') return { cls:'is-on-time', label:'À l’heure' };
      if (bucket === 'NOT_RUNNING') return { cls:'is-not-running', label:'Ne circulait pas' };
      return { cls:'is-no-data', label:'Donnée indisponible' };
    };
    const runs = data.series.slice(-30);
    const runsHtml = runs.map((item) => {
      const view = runView(item);
      const date = String(item.date || '').split('-').slice(1).reverse().join('/');
      return `<i class="fav-summary-run ${view.cls}" role="button" tabindex="0" data-date-label="${escapeHtml(date)}" data-state-label="${escapeHtml(view.label)}" title="${escapeHtml(date)} · ${escapeHtml(view.label)}" aria-label="${escapeHtml(date)} : ${escapeHtml(view.label)}"></i>`;
    }).join('');

    sumEl.innerHTML = `
      <span class="fav-stats-label">Fiabilité (30 j) : <b class="fav-reliability-pct" style="color:${data.pctColor}">${data.pctOnTime}%</b></span>
    `;
    bodyEl.innerHTML = `
      <div class="fav-reliability-metrics">
        <div><span>Retard moyen</span><b>${data.average} min</b></div>
        <div><span>Retard maximum</span><b>${data.maximum} min</b></div>
        <div><span>Suppressions</span><b>${data.canceled}</b></div>
        <div><span>Suppr. partielles</span><b>${data.partial}</b></div>
      </div>
      <div class="fav-reliability-runs">
        <span class="fav-reliability-runs-title">Dernières circulations</span>
        <span class="fav-summary-runs" aria-label="État du train sur les 30 derniers jours">${runsHtml}</span>
        <output class="fav-reliability-readout" aria-live="polite">Appuie sur une barre pour afficher la date.</output>
      </div>
    `;
    const showRun = (bar) => {
      const output = bodyEl.querySelector('.fav-reliability-readout');
      if (!bar || !output) return;
      bodyEl.querySelectorAll('.fav-summary-run').forEach((item) => item.classList.toggle('is-active', item === bar));
      output.innerHTML = `<b>${escapeHtml(bar.dataset.dateLabel || '')}</b><span>${escapeHtml(bar.dataset.stateLabel || '')}</span>`;
    };
    bodyEl.onclick = (event) => showRun(event.target.closest?.('.fav-summary-run'));
    bodyEl.onfocusin = (event) => showRun(event.target.closest?.('.fav-summary-run'));
    if (!rootEl.hasAttribute('data-user-opened')) rootEl.open = false;
  }

  const luxYmdToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Luxembourg' });

  const hhmmRawToMin = (raw) => {
  if (!raw) return null;

  // garde uniquement les chiffres (gère "063000", "06:30:00", "0630", etc.)
  const digits = String(raw).replace(/\D/g, "");

  // HHMMSS -> on garde HHMM
  if (digits.length === 6) {
    const hh = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  // HHMM
  if (digits.length === 4) {
    const hh = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  // cas tolérant: "630" => 06:30, "75" => 00:75 (on refuse)
  if (digits.length === 3) {
    const hh = parseInt(digits.slice(0, 1), 10);
    const mm = parseInt(digits.slice(1, 3), 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || mm > 59) return null;
    return hh * 60 + mm;
  }

  return null;
};

  const minToClock = (m) => {
    if (m == null) return '—';
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${h}:${mm}`;
  };

  const luxNowMin = () => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Luxembourg',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
    const hh = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const mm = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return hh * 60 + mm;
  };

  const computeWidgetState = (train) => {
    const stopTimes = train?.stop_times || [];
    if (!stopTimes.length) return { state: 'unknown', stopTimes: [] };
    const dep0 = hhmmRawToMin(stopTimes[0]?.departure_time || stopTimes[0]?.arrival_time);
    const arrLast = hhmmRawToMin(stopTimes[stopTimes.length - 1]?.arrival_time || stopTimes[stopTimes.length - 1]?.departure_time);
    const now = luxNowMin();

    if (dep0 != null && now < dep0) return { state: 'before', dep0, arrLast, now, stopTimes };
    if (dep0 != null && arrLast != null && now >= dep0 && now <= arrLast) return { state: 'running', dep0, arrLast, now, stopTimes };
    if (arrLast != null && now > arrLast) return { state: 'after', dep0, arrLast, now, stopTimes };
    return { state: 'unknown', dep0, arrLast, now, stopTimes };
  };

 const buildWidgetStateBadge = (state) => {
    const labels = {
      before: 'A VENIR',
      running: 'LIVE',
      after: 'ARRIVÉ',
	  unknown: 'Hors plage'
    };
    const classMap = {
      before: 'before',
      running: 'live',
      after: 'after',
      unknown: 'unknown'
    };
    const label = labels[state] || labels.unknown;
    const cls = classMap[state] || classMap.unknown;
    return `<span class="fav-state-badge fav-state-${cls}">${label}</span>`;
  };

  // --- Retards temps réel par arrêt (>= thresholdMin) ---
  const parseNavitiaDateTime = (dt) => {
    // "YYYYMMDDTHHMMSS" -> ms UTC (uniquement pour diff)
    if (!dt || typeof dt !== 'string') return null;
    const m = dt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    const [, Y, Mo, D, h, mi, s] = m;
    return Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s);
  };

  const stopDelayMin = (st) => {
    // 1) cas direct en secondes
    const sd = Number(st?.departure_delay);
    const sa = Number(st?.arrival_delay);
    if (Number.isFinite(sd)) return Math.round(sd / 60);
    if (Number.isFinite(sa)) return Math.round(sa / 60);

    // 2) cas base_*_date_time vs *_date_time
    const depReal = parseNavitiaDateTime(st?.departure_date_time);
    const depBase = parseNavitiaDateTime(st?.base_departure_date_time);
    if (depReal != null && depBase != null) return Math.round((depReal - depBase) / 60000);

    const arrReal = parseNavitiaDateTime(st?.arrival_date_time);
    const arrBase = parseNavitiaDateTime(st?.base_arrival_date_time);
    if (arrReal != null && arrBase != null) return Math.round((arrReal - arrBase) / 60000);

    return null;
  };

  const buildDelaysByStopLine = (payload, nowMin, thresholdMin = 5) => {
    const train = payload?.train;
    const stopTimes = train?.stop_times || [];
    const impacted = payload?.impacted || null;

    const toHHMM = (t) => {
      if (!t) return null;
      const s = String(t).replace(/[^0-9]/g, '');
      if (s.length >= 4) return s.slice(0,4);
      return null;
    };
    const hhmmToMin = (hhmm) => {
      if (!hhmm || hhmm.length < 4) return null;
      const h = parseInt(hhmm.slice(0,2), 10);
      const m = parseInt(hhmm.slice(2,4), 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h*60 + m;
    };
    const diffMin = (base, amended) => {
      const b = hhmmToMin(toHHMM(base));
      const a = hhmmToMin(toHHMM(amended));
      if (b == null || a == null) return null;
      return a - b;
    };

    const hits = [];

    for (const st of stopTimes) {
      const name = st?.stop_point?.name;
      const id = st?.stop_point?.id;
      const baseHHMM = st?.arrival_time || st?.departure_time;
      const baseMin = hhmmRawToMin(baseHHMM);
      if (!name || baseMin == null) continue;

      let d = null;
      let amendedMin = null;

      // 1) priorité: impacted (comme ton tableau principal)
      if (impacted && id && impacted[id]) {
        const imp = impacted[id];

        // retard direct si dispo
        const dm = (imp?.delay_minutes !== undefined && imp?.delay_minutes !== null) ? Number(imp.delay_minutes) : null;
        if (Number.isFinite(dm)) d = dm;

        // sinon calcul base/amended
        const amendedHHMM = imp?.amended_departure_time || imp?.amended_arrival_time;
        const baseImpHHMM = imp?.base_departure_time || imp?.base_arrival_time;
        amendedMin = hhmmToMin(toHHMM(amendedHHMM));
        if (d == null) {
          d = diffMin(baseImpHHMM, amendedHHMM);
        }
      }

      // 2) fallback: champs éventuels sur stop_times
      if (d == null) d = stopDelayMin(st);

      if (d == null) continue;

      // IMPORTANT: un arrêt "à venir" ne doit pas être filtré uniquement sur l'heure théorique.
      // Si l'heure théorique est déjà passée mais qu'on a une heure amendée (retard), on garde l'arrêt.
      const effectiveMin = (amendedMin != null) ? amendedMin : baseMin;
      if (nowMin != null && effectiveMin < nowMin) continue;

      if (d >= thresholdMin) hits.push({ name, d, t: effectiveMin });
    }

    if (!hits.length) return '';

    hits.sort((a,b)=>a.t-b.t);
    const shown = hits.slice(0, 4);
    const more = hits.length > 4 ? ' • …' : '';
    return `Retards: ${shown.map(x => `${x.name} +${Math.round(x.d)}`).join(' • ')}${more}`;
  };



// ---- GTFS-RT (retards_nancymetzlux.json) : récupérer un retard (min) pour un train + un arrêt
// On réutilise exactement la normalisation/Map déjà utilisée par le tableau (storeGtfsDelay + normalizeStationName).
function getGtfsDelayForStop(trainNumber, stopName){
  const num = String(trainNumber || '').trim();
  if (!num || !stopName) return null;
  const bucket = window.retardsGTFS ? window.retardsGTFS[num] : null;
  if (!bucket) return null;

  // 1) correspondance brute (clé exacte)
  const direct = coerceDelayNumber(bucket[stopName]);
  if (direct != null) return direct;

  // 2) correspondance normalisée (mêmes règles que le tableau)
  if (typeof normalizeStationName === 'function'){
    const norm = normalizeStationName(stopName);
    if (norm){
      const map = getOrInitGtfsNormalizedMap(bucket);
      if (map && map instanceof Map && map.has(norm)){
        const v = coerceDelayNumber(map.get(norm));
        if (v != null) return v;
      }
    }
  }

  return null;
}


  // Prochain arrêt (Option A): affiche l'heure prévue et, si retard >= seuil, l'heure temps réel en orange (avec l'heure prévue barrée).
  // + Support suppression partielle (arrêt supprimé) : même rendu que le tableau (rouge + barré + label "supprimé").
  function buildNextStopsHtml(payload, trainNumber, nowMin, limit=3, thresholdMin=5){
    const train = payload?.train || null;
    const stopTimes = train?.stop_times || [];
    const impacted = payload?.impacted || {};

    // voies (quais) : même logique que le tableau
    const voiesMap = (typeof getVoiesForTrain === 'function') ? getVoiesForTrain(trainNumber) : null;
    const cflVoiesMap = (typeof getCflVoiesForTrain === 'function') ? getCflVoiesForTrain(trainNumber) : null;

    // Helpers locaux (évite les ReferenceError si ces helpers ne sont pas dans le scope global)
    const toHHMM = (t) => {
      if (!t) return null;
      const s = String(t).replace(/[^0-9]/g, '');
      if (s.length >= 4) return s.slice(0, 4);
      return null;
    };
    const hhmmToMin = (hhmm) => {
      if (!hhmm || hhmm.length < 4) return null;
      const h = parseInt(hhmm.slice(0, 2), 10);
      const m = parseInt(hhmm.slice(2, 4), 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    };
    const diffMin = (base, amended) => {
      const b = hhmmToMin(toHHMM(base));
      const a = hhmmToMin(toHHMM(amended));
      if (b == null || a == null) return null;
      return a - b;
    };

    const rows = [];
    for (const st of stopTimes){
      const name = st?.stop_point?.name || '';
      const stopId = st?.stop_point?.id || '';
      if (!name) continue;

      const isLast = (st === stopTimes[stopTimes.length - 1]);
      const plannedRaw = isLast ? (st.arrival_time || st.departure_time) : (st.departure_time || st.arrival_time);
      const plannedMin = hhmmRawToMin(plannedRaw);
      if (plannedMin == null) continue;

      // impact : par id si possible, sinon par nom (cas added)
      const imp = (stopId && impacted) ? (impacted[stopId] || null) : null;
      const impByName = (!imp && impacted) ? (Object.values(impacted).find(x => x?.stop_point?.name === name) || null) : null;
      const impAny = imp || impByName;

      const departureDeleted = impAny?.departure_status === 'deleted';
      const arrivalDeleted   = impAny?.arrival_status === 'deleted';
      const isStopDeleted    = (departureDeleted && arrivalDeleted) || (impAny?.stop_time_effect === 'deleted');

      let delayMin = null;
      let amendedMin = null;

      let amendedHHMM = null;
      let baseHHMM = null;

      if (impAny){
        const dm = (impAny?.delay_minutes !== undefined && impAny?.delay_minutes !== null) ? Number(impAny.delay_minutes) : null;
        if (Number.isFinite(dm)) delayMin = dm;

        amendedHHMM = isLast
          ? (impAny?.amended_arrival_time || impAny?.amended_departure_time)
          : (impAny?.amended_departure_time || impAny?.amended_arrival_time);

        baseHHMM = isLast
          ? (impAny?.base_arrival_time || impAny?.base_departure_time)
          : (impAny?.base_departure_time || impAny?.base_arrival_time);

        amendedMin = hhmmToMin(toHHMM(amendedHHMM));
        if (delayMin == null) delayMin = diffMin(baseHHMM || plannedRaw, amendedHHMM);
      }

      if (delayMin == null) delayMin = stopDelayMin(st);

      // merge avec GTFS-RT (même logique que le tableau): on garde le "pire" retard
      const gtfsDelay = getGtfsDelayForStop(trainNumber, name);
      if (gtfsDelay != null) delayMin = pickGtfsDelay(delayMin, gtfsDelay);

      // si on a un retard (GTFS ou impacted) mais pas d'heure amendée, on peut dériver une heure temps réel
      if (amendedMin == null && delayMin != null && Number.isFinite(Number(delayMin)) && Number(delayMin) > 0){
        amendedMin = plannedMin + Number(delayMin);
        if (amendedMin >= 24*60) amendedMin = amendedMin % (24*60);
      }

      // arrêt à venir: on filtre sur l'heure effective (amended si dispo)
      const effectiveMin = (amendedMin != null) ? amendedMin : plannedMin;
      if (nowMin != null && effectiveMin < nowMin) continue;

      // Voie (si dispo) : résolue à partir de l'heure base / amendée (même logique que le tableau)
      let voieLabel = null;
      const allowCflFallback = !isLikelyFrenchStopContext({ stopName: name, stopPointId: stopId });
      if (voiesMap && (typeof resolveVoieForStop === 'function')) {
        const candidates = [];
        if (baseHHMM) candidates.push(baseHHMM);
        if (amendedHHMM) candidates.push(amendedHHMM);
        if (plannedRaw) candidates.push(plannedRaw);
		if (amendedMin != null) {
          const hh = Math.floor(amendedMin / 60) % 24;
          const mm = amendedMin % 60;
          candidates.push(String(hh).padStart(2,'0') + String(mm).padStart(2,'0'));
        }
        if (amendedMin != null) {
          const hh = Math.floor(amendedMin / 60) % 24;
          const mm = amendedMin % 60;
          candidates.push(String(hh).padStart(2,'0') + String(mm).padStart(2,'0'));
        }
        const voieMode = (impAny?.base_departure_time || impAny?.amended_departure_time || st?.departure_time) ? 'dep' : 'arr';
        voieLabel = resolveVoieForStop({ voiesMap, stopName: name, baseTimeRaw: plannedRaw, timeCandidates: candidates, mode: voieMode, preferStationResolver: !allowCflFallback });
      }
	if (!voieLabel && allowCflFallback && cflVoiesMap && typeof resolveCflVoieForStop === 'function') {
        voieLabel = resolveCflVoieForStop({ voiesMap: cflVoiesMap, stopName: name });
      }

      rows.push({ name, plannedMin, amendedMin, delayMin, effectiveMin, voieLabel, isStopDeleted });
    }

    if (!rows.length) return '';

    rows.sort((a,b)=>a.effectiveMin-b.effectiveMin);
    const shown = rows.slice(0, limit);

    let html = '<div class="fav-box fav-box-info"><div class="fav-next">';
    html += '<div class="fav-next-title">⏱ Prochains arrêts :</div>';

    for (const r of shown){
      const plannedTxt = minToClock(r.plannedMin);
      const hasDelay = (!r.isStopDeleted) && (r.delayMin != null && Number.isFinite(r.delayMin) && r.delayMin >= thresholdMin);
      const rtTxt = (!r.isStopDeleted && r.amendedMin != null) ? minToClock(r.amendedMin) : null;

      // Voie (quai) : affichée UNE SEULE FOIS, à la fin (comme dans le tableau)
      const voie = r.voieLabel ? String(r.voieLabel) : '';
      const voieBadge = (voie && typeof formatVoieLabel === 'function')
        ? ('<span class="voie-badge">' + escapeHtml(formatVoieLabel(voie)) + '</span>')
        : '';

      html += '<div class="fav-next-row">• ';

      if (r.isStopDeleted){
        html += '<span class="fav-stop deleted">' + escapeHtml(r.name) + '</span> ';
        html += '<span class="fav-time fav-time-planned is-strike deleted">' + plannedTxt + '</span>';
        html += '<span class="fav-delay-pill canceled">supprimé</span>';
        html += '</div>';
        continue;
      }

      html += '<span class="fav-stop">' + escapeHtml(r.name) + '</span> ';

      if (hasDelay && rtTxt){
        // Retard: on barre l'heure prévue et on affiche l'heure temps réel (sans (+X min))
        html += '<span class="fav-time fav-time-planned is-strike">' + plannedTxt + '</span>';
        html += '<span class="fav-time fav-time-rt delay">' + rtTxt + '</span>';
        if (voieBadge) html += ' ' + voieBadge;
      } else {
        // À l'heure (ou retard sans heure RT): on affiche juste l'heure prévue
        html += '<span class="fav-time fav-time-planned">' + plannedTxt + '</span>';
        if (voieBadge) html += ' ' + voieBadge;
      }

      html += '</div>';
    }

    html += '</div></div>';
    return html;
  }



  // Calcule un retard global (max) en minutes pour un train (SNCF impacted/stop_times + merge GTFS)


  // ===== Favoris compact : progression + prochains arrêts (compact au-dessus, expand = tous) =====
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function fmtTime(plannedMin, amendedMin, isDeleted=false){
    const plannedTxt = (plannedMin != null) ? minToClock(plannedMin) : '—';
    const rtTxt = (amendedMin != null) ? minToClock(amendedMin) : null;

    // Wrapper pour piloter l'alignement via CSS (compact vs détails)
    if (isDeleted){
      return `<span class="fav-time-wrap">`+
             `<span class="fav-time fav-time-planned is-strike deleted">${plannedTxt}</span>`+
             `<span class="fav-time fav-time-rt deleted-label">supprimé</span>`+
             `</span>`;
    }

    if (rtTxt && plannedMin != null && amendedMin != null && amendedMin !== plannedMin){
      return `<span class="fav-time-wrap">`+
             `<span class="fav-time fav-time-planned is-strike">${plannedTxt}</span>`+
             `<span class="fav-time fav-time-rt delay">${rtTxt}</span>`+
             `</span>`;
    }

    return `<span class="fav-time-wrap">`+
           `<span class="fav-time fav-time-planned">${plannedTxt}</span>`+
           `</span>`;
  }

  function computeProgressPct(depMin, arrEffMin, nowMin){
    if (depMin == null || arrEffMin == null || nowMin == null) return 0;
    const total = Math.max(1, arrEffMin - depMin);
    return Math.round(clamp01((nowMin - depMin) / total) * 100);
  }

  function buildNextTrainInfo(widgetState, st){
    if (!st || st.now == null) return '';
    if (widgetState === 'before' && st.dep0 != null){
      const diff = Math.max(0, st.dep0 - st.now);
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      return `<div class="fav-next-train">⏱ Dans ${hh}h${mm}</div>`;
    }
    if (widgetState === 'after'){
      const depTomorrow = (st.dep0 != null) ? ` ${minToClock(st.dep0)}` : '';
      return `<div class="fav-next-train">⏱ Demain${depTomorrow}</div>`;
    }
    if (widgetState === 'unknown'){
      return `<div class="fav-next-train">⏱ —</div>`;
    }
    return '';
  }

  function buildFavStopRows(payload, trainNumber){
    const train = payload?.train || null;
    const stopTimes = train?.stop_times || [];
    const impacted = payload?.impacted || {};
    const voiesMap = (typeof getVoiesForTrain === 'function') ? getVoiesForTrain(trainNumber) : null;
	const cflVoiesMap = (typeof getCflVoiesForTrain === 'function') ? getCflVoiesForTrain(trainNumber) : null;

    const toHHMM = (t) => {
      if (!t) return null;
      const s = String(t).replace(/[^0-9]/g, '');
      return s.length >= 4 ? s.slice(0,4) : null;
    };
    const hhmmToMin = (hhmm) => {
      if (!hhmm || hhmm.length < 4) return null;
      const h = parseInt(hhmm.slice(0,2),10), m = parseInt(hhmm.slice(2,4),10);
      return (Number.isFinite(h) && Number.isFinite(m)) ? (h*60+m) : null;
    };
    const diffMin = (base, amended) => {
      const b = hhmmToMin(toHHMM(base));
      const a = hhmmToMin(toHHMM(amended));
      if (b == null || a == null) return null;
      return a - b;
    };

    const rows = [];
    for (const st of stopTimes){
      const name = st?.stop_point?.name || '';
      const stopId = st?.stop_point?.id || '';
      if (!name) continue;

      const isLast = (st === stopTimes[stopTimes.length-1]);
      const plannedRaw = isLast ? (st.arrival_time || st.departure_time) : (st.departure_time || st.arrival_time);
      const plannedMin = hhmmRawToMin(plannedRaw);
      if (plannedMin == null) continue;

      const imp = (stopId && impacted) ? (impacted[stopId] || null) : null;
      const departureDeleted = imp?.departure_status === 'deleted';
      const arrivalDeleted   = imp?.arrival_status === 'deleted';
      const isDeleted = (departureDeleted && arrivalDeleted) || (imp?.stop_time_effect === 'deleted');

      let delayMin = null;
      let amendedMin = null;
      let amendedHHMM = null;
      let baseHHMM = null;

      if (imp){
        const dm = (imp?.delay_minutes !== undefined && imp?.delay_minutes !== null) ? Number(imp.delay_minutes) : null;
        if (Number.isFinite(dm)) delayMin = dm;

        amendedHHMM = isLast
          ? (imp?.amended_arrival_time || imp?.amended_departure_time)
          : (imp?.amended_departure_time || imp?.amended_arrival_time);

        baseHHMM = isLast
          ? (imp?.base_arrival_time || imp?.base_departure_time)
          : (imp?.base_departure_time || imp?.base_arrival_time);

        amendedMin = hhmmToMin(toHHMM(amendedHHMM));
        if (delayMin == null) delayMin = diffMin(baseHHMM || plannedRaw, amendedHHMM);
      }

      if (delayMin == null) delayMin = stopDelayMin(st);

      const gtfsDelay = getGtfsDelayForStop(trainNumber, name);
      if (gtfsDelay != null) delayMin = pickGtfsDelay(delayMin, gtfsDelay);

      if (amendedMin == null && delayMin != null && Number.isFinite(delayMin) && delayMin > 0){
        amendedMin = plannedMin + delayMin;
        if (amendedMin >= 24*60) amendedMin = amendedMin % (24*60);
      }

      const effectiveMin = (amendedMin != null) ? amendedMin : plannedMin;

      let voieLabel = null;
      const stopPointId = st?.stop_point?.id || imp?.stop_point?.id || '';
      const allowCflFallback = !isLikelyFrenchStopContext({ stopName: name, stopPointId });
      if (voiesMap && typeof resolveVoieForStop === 'function'){
        const candidates = [
          imp?.base_departure_time,
          imp?.base_arrival_time,
          imp?.amended_departure_time,
          imp?.amended_arrival_time,
          st?.departure_time,
          st?.arrival_time,
          baseHHMM,
          amendedHHMM,
          plannedRaw
        ];
        if (amendedMin != null) {
          const hh = Math.floor(amendedMin / 60) % 24;
          const mm = amendedMin % 60;
          candidates.push(String(hh).padStart(2,'0') + String(mm).padStart(2,'0'));
        }
        const voieMode = (imp?.base_departure_time || imp?.amended_departure_time || st?.departure_time) ? 'dep' : 'arr';
        voieLabel = resolveVoieForStop({ voiesMap, stopName: name, baseTimeRaw: plannedRaw, timeCandidates: candidates, mode: voieMode, preferStationResolver: !allowCflFallback });
      }
      if (!voieLabel && allowCflFallback && cflVoiesMap && typeof resolveCflVoieForStop === 'function') {
        voieLabel = resolveCflVoieForStop({ voiesMap: cflVoiesMap, stopName: name });
      }

      rows.push({ name, plannedMin, amendedMin, effectiveMin, voieLabel, isDeleted });
    }

    rows.sort((a,b)=>a.effectiveMin-b.effectiveMin);
    return rows;
  }

  function buildFavStopsDetails(payload, trainNumber, nowMin, widgetState = 'before', options = {}){
    const rows = buildFavStopRows(payload, trainNumber);
    if (!rows.length) return '';

    const forceDeleted = options?.forceDeleted === true;
    const state = String(widgetState || 'before');

    // Premier arrêt encore à venir. Pour un train terminé, on conserve le terminus
    // comme repère mais toutes les lignes sont marquées "passées".
    let next = rows.find(r => (nowMin == null || r.effectiveMin >= nowMin) && !r.isDeleted);
    if (!next) next = rows.find(r => (nowMin == null || r.effectiveMin >= nowMin)) || rows[rows.length-1];

    const nextIndex = Math.max(0, rows.indexOf(next));
    const voieHtml = (r) => {
      const voie = r?.voieLabel ? String(r.voieLabel) : '';
      if (!voie) return '';
      const label = (typeof formatVoieLabel === 'function') ? formatVoieLabel(voie) : voie;
      return `<span class="fav-route-track voie-badge">${escapeHtml(label)}</span>`;
    };

    const rowHtml = (r, index) => {
      const deleted = forceDeleted || Boolean(r.isDeleted);
      const past = !deleted && (
        state === 'after'
        || (state === 'running' && nowMin != null && r.effectiveMin < nowMin)
      );
      const isNext = !deleted && !past && (
        (state === 'running' && index === nextIndex)
        || (state === 'before' && index === 0)
      );
      const rowState = deleted ? 'deleted' : (past ? 'past' : (isNext ? 'next' : 'future'));
      const timeHtml = fmtTime(r.plannedMin, r.amendedMin, deleted);

      return `
        <div class="fav-route-row is-${rowState}" data-stop-state="${rowState}">
          <span class="fav-route-time">${timeHtml}</span>
          <span class="fav-route-node" aria-hidden="true"></span>
          <span class="fav-route-stop">${escapeHtml(r.name)}</span>
          <span class="fav-route-trackcell">${voieHtml(r)}</span>
        </div>`;
    };

    const first = rows[0];
    const last = rows[rows.length - 1];
    const nextTrack = voieHtml(next);
    const nextTime = fmtTime(next.plannedMin, next.amendedMin, forceDeleted || next.isDeleted);

    let summaryMain = 'Parcours';
    let summarySub = `${rows.length} arrêt${rows.length > 1 ? 's' : ''}`;

    if (forceDeleted) {
      summaryMain = 'Parcours supprimé';
      summarySub = `${rows.length} arrêt${rows.length > 1 ? 's' : ''}`;
    } else if (state === 'running') {
      summaryMain = `Prochain : ${escapeHtml(next.name)}`;
      summarySub = `${nextTime}${nextTrack ? ' ' + nextTrack : ''}`;
    } else if (state === 'after') {
      summaryMain = 'Parcours terminé';
      summarySub = `${escapeHtml(last.name)} · ${fmtTime(last.plannedMin, last.amendedMin, last.isDeleted)}`;
    } else {
      summaryMain = 'Parcours';
      summarySub = `${rows.length} arrêt${rows.length > 1 ? 's' : ''} · départ ${fmtTime(first.plannedMin, first.amendedMin, first.isDeleted)}`;
    }

    const expandedRows = rows.map((r, index) => rowHtml(r, index)).join('');
    const openAttr = state === 'running' ? ' open' : '';

    return `
      <details class="fav-route-details fav-stops-details" data-route-state="${escapeHtml(forceDeleted ? 'cancelled' : state)}"${openAttr}>
        <summary class="fav-route-summary">
          <span class="fav-route-summary-copy">
            <strong class="fav-route-summary-main">${summaryMain}</strong>
            <span class="fav-route-summary-sub">${summarySub}</span>
          </span>
          <span class="fav-route-summary-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="fav-route-timeline">
          ${expandedRows}
        </div>
      </details>
    `;
  }

  function computeMaxDelayMin(payload, trainNumber){
    const train = payload?.train || null;
    const stopTimes = train?.stop_times || [];
    const impacted = payload?.impacted || {};
    let maxDelay = null;

    // diff en minutes entre deux heures (accepte HHMM, HHMMSS, "HH:MM", etc.)
    const diffMin = (base, amended) => {
      const b = hhmmRawToMin(base);
      const a = hhmmRawToMin(amended);
      if (b == null || a == null) return null;
      return a - b;
    };

    for (const st of stopTimes){
      const name = st?.stop_point?.name || '';
      const stopId = st?.stop_point?.id || '';
      if (!name) continue;

      let delayMin = null;
      const imp = (stopId && impacted) ? impacted[stopId] : null;
      if (imp){
        const dm = (imp?.delay_minutes !== undefined && imp?.delay_minutes !== null) ? Number(imp.delay_minutes) : null;
        if (Number.isFinite(dm)) delayMin = dm;
        if (delayMin == null){
          const amendedHHMM = imp?.amended_departure_time || imp?.amended_arrival_time;
          const baseHHMM = imp?.base_departure_time || imp?.base_arrival_time;
          const d = diffMin(baseHHMM, amendedHHMM);
          if (d != null) delayMin = d;
        }
      }

      if (delayMin == null) delayMin = stopDelayMin(st);

      const gtfsDelay = getGtfsDelayForStop(trainNumber, name);
      if (gtfsDelay != null) delayMin = pickGtfsDelay(delayMin, gtfsDelay);

      if (delayMin == null || !Number.isFinite(Number(delayMin))) continue;
      const d = Number(delayMin);
      if (maxDelay == null) maxDelay = d;
      else maxDelay = pickGtfsDelay(maxDelay, d);
    }

    // On n'affiche que les retards positifs
    if (maxDelay == null || !Number.isFinite(Number(maxDelay))) return null;
    return Number(maxDelay) > 0 ? Math.round(Number(maxDelay)) : null;
  }

  const inferRealtimeStatusFromDisruptions = (payload) => {
    const disruptions = payload?.disruptions || [];
    let hasDelay = false;
    for (const d of disruptions) {
      const eff = String(d?.severity?.effect || d?.severity?.name || d?.severity?.id || '').toLowerCase();
      if (!eff) continue;
      if (eff.includes('no_service') || eff.includes('cancel') || eff.includes('suppression') || eff.includes('stops_canceled')) {
        return 'canceled';
      }
      if (eff.includes('delay') || eff.includes('delays') || eff.includes('significant')) {
        hasDelay = true;
      }
    }
    return hasDelay ? 'delayed' : null;
  };


  function formatDurationHM(totalMin){
    const m = Math.max(0, Math.round(Number(totalMin)||0));
    const h = Math.floor(m/60);
    const r = m%60;
    if (h<=0) return `${r} min`;
    if (r===0) return `${h} h`;
    return `${h} h ${r} min`;
  }

  const renderFavCard = (kind, trainId, payload) => {
    const title   = document.getElementById(kind === 'AM' ? 'favTrainAM' : 'favTrainPM');
	const badgeEl = document.getElementById(kind === 'AM' ? 'favStateAM' : 'favStatePM');
    const meta    = document.getElementById(kind === 'AM' ? 'favMetaAM'  : 'favMetaPM');
    const line    = document.getElementById(kind === 'AM' ? 'favLineAM'  : 'favLinePM');
    const causeEl = document.getElementById(kind === 'AM' ? 'favCauseAM' : 'favCausePM');
    const statsEl = document.getElementById(kind === 'AM' ? 'favStatsAM' : 'favStatsPM');
    const card    = document.getElementById(kind === 'AM' ? 'favCardAM'  : 'favCardPM');

    if (statsEl && !statsEl.__lbBound){
      statsEl.__lbBound = true;
      statsEl.addEventListener('toggle', ()=>{ if (statsEl.open) statsEl.setAttribute('data-user-opened','1'); });
    }

    if (!title || !meta || !line) return;

    if (card) card.classList.remove('is-canceled', 'is-delayed');
    try { title.dataset.trainId = String(trainId || ''); } catch(_) {}
    const serviceDate = String(payload?.serviceDate || luxYmdToday());
    title.innerHTML = trainId
      ? `<span class="fav-train-wrap"><button type="button" class="fav-train-profile-link" data-train="${escapeHtml(trainId)}" data-service-date="${escapeHtml(serviceDate)}" aria-label="Ouvrir la fiche du train ${escapeHtml(trainId)}"><span class="fav-train-num">TER ${escapeHtml(trainId)}</span></button></span>`
      : '<span class="fav-train-wrap"><span class="fav-train-num">TER —</span></span>';
	if (badgeEl) badgeEl.innerHTML = '';
    meta.innerHTML = '';
    line.innerHTML = '';
    if (causeEl){ causeEl.innerHTML = ''; causeEl.style.display = 'none'; }

    if (!trainId){
      meta.textContent = '➡️ Choisis un train dans tes préférences.';
      if (statsEl){ statsEl.open = false; }
      return;
    }

    if (payload?.error){
      meta.textContent = `🚫 ${payload.error}`;
      if (statsEl){
        renderFavStats(kind, trainId).catch(()=>{});
        if (!statsEl.hasAttribute('data-user-opened')) statsEl.open = false;
      }
      return;
    }

    const train = payload?.train;
    if (!train){
      meta.textContent = '🚫 Données indisponibles.';
      return;
    }

    const st = computeWidgetState(train);
    const stopTimes = st.stopTimes || [];
    const origin = stopTimes[0]?.stop_point?.name || '—';
    const dest   = stopTimes[stopTimes.length-1]?.stop_point?.name || '—';

    const stopRows = buildFavStopRows(payload, trainId);
    const firstRow = stopRows[0] || null;
    const lastRow = stopRows[stopRows.length - 1] || null;

    const plannedDepMin = (firstRow && firstRow.plannedMin != null) ? firstRow.plannedMin : st.dep0;
    const amendedDepMin = (firstRow && firstRow.amendedMin != null) ? firstRow.amendedMin : null;
    const depDeleted = Boolean(firstRow && firstRow.isDeleted);

    const plannedArrMin = (lastRow && lastRow.plannedMin != null) ? lastRow.plannedMin : st.arrLast;
    const amendedArrMin = (lastRow && lastRow.amendedMin != null) ? lastRow.amendedMin : null;
    const arrDeleted = Boolean(lastRow && lastRow.isDeleted);

    const depTxt = (plannedDepMin != null) ? minToClock(plannedDepMin) : '—';
    const arrTxt = (plannedArrMin != null) ? minToClock(plannedArrMin) : '—';

    const isFutureService = Boolean(payload?.nextServiceDate && payload.nextServiceDate !== luxYmdToday());
    const rtStatus = isFutureService ? null : inferRealtimeStatusFromDisruptions(payload);
    const causeText = (payload?.causeText || '').trim();

    const maxDelay = isFutureService ? null : computeMaxDelayMin(payload, trainId);
    const effectiveDepMin = (amendedDepMin != null) ? amendedDepMin : plannedDepMin;
    const effectiveArrLast = (amendedArrMin != null) ? amendedArrMin : plannedArrMin;

    let widgetState = isFutureService ? 'before' : st.state;
    if (!isFutureService && effectiveDepMin != null && effectiveArrLast != null && st.now != null) {
      if (st.now < effectiveDepMin) widgetState = 'before';
      else if (st.now >= effectiveDepMin && st.now <= effectiveArrLast) widgetState = 'running';
      else if (st.now > effectiveArrLast) widgetState = 'after';
    }
	const stateBadge = isFutureService
      ? '<span class="fav-state-badge fav-state-before">PROCHAIN</span>'
      : buildWidgetStateBadge(widgetState);
    const typeBadge = (window.buildFavTrainTypeBadge ? window.buildFavTrainTypeBadge(trainId) : '');
	if (badgeEl) badgeEl.innerHTML = `${typeBadge}${stateBadge}`;

    // SUPPRIME
    if (rtStatus === 'canceled') {
	  const canceledAfterLiveMin = (st.arrLast != null) ? (st.arrLast + 5) : null;
      let canceledState = widgetState;
      if (st.dep0 != null && st.now != null && st.now < st.dep0) canceledState = 'before';
      else if (canceledAfterLiveMin != null && st.now != null && st.now > canceledAfterLiveMin) canceledState = 'after';
      else if (st.now != null) canceledState = 'running';
      if (card) card.classList.add('is-canceled');
	  if (badgeEl) badgeEl.innerHTML = `${typeBadge}${buildWidgetStateBadge(canceledState)} <span class="fav-cancel-badge">✖ SUPPRIMÉ</span>`;
      meta.innerHTML = `
        <div class="fav-primary-route">${escapeHtml(origin)} → ${escapeHtml(dest)}</div>
        <div class="fav-primary-times fav-primary-times--canceled">
          <span class="fav-time-part is-canceled"><span class="fav-time fav-time-planned is-strike deleted">${escapeHtml(depTxt)}</span></span>
          <span class="fav-time-separator">→</span>
          <span class="fav-time-part is-canceled"><span class="fav-time fav-time-planned is-strike deleted">${escapeHtml(arrTxt)}</span></span>
        </div>
      `;
      if (causeText && causeEl){
        causeEl.style.display = '';
        causeEl.innerHTML = `<div class="fav-box fav-box-danger"><div class="fav-box-body">${escapeHtml(causeText)}</div></div>`;
      }
      line.innerHTML = buildFavStopsDetails(payload, trainId, st.now, canceledState, { forceDeleted:true });
      if (statsEl){
        renderFavStats(kind, trainId).catch(()=>{});
        if (!statsEl.hasAttribute('data-user-opened')) statsEl.open = false;
      }
      return;
    }

    // suppression partielle ?
    const firstId = stopTimes[0]?.stop_point?.id || null;
    const lastId  = stopTimes[stopTimes.length-1]?.stop_point?.id || null;
    const isPartial = Boolean((payload?.newStart && firstId && payload.newStart !== firstId) || (payload?.newEnd && lastId && payload.newEnd !== lastId));
    let hasDeletedStop = false;
    try {
      for (const s of (stopTimes||[])){
        const sid = s?.stop_point?.id;
        const imp = sid ? (payload?.impacted?.[sid] || null) : null;
        const departureDeleted = imp?.departure_status === 'deleted';
        const arrivalDeleted   = imp?.arrival_status === 'deleted';
        if ((departureDeleted && arrivalDeleted) || imp?.stop_time_effect === 'deleted'){ hasDeletedStop = true; break; }
      }
    } catch(e) {}
    const isPartialAny = isPartial || hasDeletedStop;

    const formatHeaderTime = (plannedMin, amendedMin, isDeleted, legKey) => {
      const plannedTxt = (plannedMin != null) ? minToClock(plannedMin) : '—';
      if (isDeleted) {
        return `<span class="fav-time-part" data-leg="${escapeHtml(legKey || '')}"><span class="fav-time fav-time-planned is-strike deleted">${escapeHtml(plannedTxt)}</span> <span class="fav-time fav-time-rt deleted-label">supprimé</span></span>`;
      }
      if (plannedMin != null && amendedMin != null && amendedMin !== plannedMin) {
        return `<span class="fav-time-part" data-leg="${escapeHtml(legKey || '')}"><span class="fav-time fav-time-planned is-strike">${escapeHtml(plannedTxt)}</span> <span class="fav-time fav-time-rt delay">${escapeHtml(minToClock(amendedMin))}</span></span>`;
      }
      return `<span class="fav-time-part" data-leg="${escapeHtml(legKey || '')}"><span class="fav-time fav-time-planned">${escapeHtml(plannedTxt)}</span></span>`;
    };

    let timesHtml = `${formatHeaderTime(plannedDepMin, amendedDepMin, depDeleted, 'dep')} → ${formatHeaderTime(plannedArrMin, amendedArrMin, arrDeleted, 'arr')}`;

    meta.innerHTML = `
      <div class="fav-primary-route">${escapeHtml(origin)} → ${escapeHtml(dest)}</div>
      <div class="fav-primary-times">${timesHtml}</div>
      ${isFutureService ? `<div class="fav-next-service">Prochain : ${escapeHtml(payload.nextServiceLabel || payload.nextServiceDate)}</div>` : ''}
      ${isPartialAny ? `<div class="fav-mini-alert">Suppression partielle</div>` : ''}
    `;

    // Cause (1 ligne) — affichée AVANT la barre de progression
    const isDelayed = (maxDelay != null && Number.isFinite(maxDelay) && maxDelay >= 1);
    let causeHtml = '';
    if ((isDelayed || isPartialAny) && causeText){
      causeHtml = `<div class="fav-cause-inline ${isPartialAny ? 'fav-cause-inline--cancel' : ''}">${escapeHtml(causeText)}</div>`;
    }
    if (causeEl){
      // on garde le noeud pour compat mais on le vide (la cause est rendue dans fav-line)
      causeEl.innerHTML = '';
      causeEl.style.display = 'none';
    }

    // Progression (visuel)
    const pct = (widgetState === 'before') ? 0 : (widgetState === 'after' ? 100 : computeProgressPct(effectiveDepMin, effectiveArrLast, st.now));
    const progressHtml = `
      <div style="margin:8px 0 6px 0;">
        <div style="height:5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(0,255,255,.12);">
          <div style="height:100%;width:${pct}%;background:rgba(0,255,255,.85);box-shadow:0 0 12px rgba(0,255,255,.35);border-radius:999px;transition:width .6s ease;"></div>
        </div>
      </div>
    `;

    const nextTrainHtml = isFutureService ? '' : buildNextTrainInfo(widgetState, st);
	const stopsHtml = buildFavStopsDetails(payload, trainId, isFutureService ? null : st.now, widgetState);
    const affInfo = (!isFutureService && typeof window.getAffluenceTrainInfo === 'function') ? window.getAffluenceTrainInfo(trainId, (kind==='AM' ? (window.__lbPreferredAffStation||'') : (window.__lbPreferredAffTo||''))) : null;
        const affHtml = affInfo ? (()=> {
	      const depName = affInfo.depStop?.station || affInfo.depStop?.name || '';
	      const depTime = affInfo.depStop?.hhmm || affInfo.depStop?.time || '';
      const depPctVal = (affInfo.depPct!=null) ? Number(affInfo.depPct) : null;
      const depPct  = (depPctVal!=null && Number.isFinite(depPctVal)) ? `${Math.round(depPctVal)}%` : '—';
      const pctClass = (pp)=>{ if(pp==null) return ''; const v=Number(pp); if(!Number.isFinite(v)) return ''; const n=(v<=1.01)?(v*100):v; const p=Math.round(n); if(p>=95) return 'sat'; if(p>=85) return 'bad'; if(p>=70) return 'warn'; if(p>=50) return 'mid'; return 'ok'; };
          const stops = Array.isArray(affInfo.stops) ? affInfo.stops : [];
	      const tipHtml = (() => {
	        const norm = (s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
	        const allStopsCtx = stops.map(s=>String(s?.station || s?.name || '')).join(' ');
	        const ctx = `${origin} ${dest} ${depName} ${allStopsCtx}`.trim();
	        const n = norm(ctx);
	        const tips = [];
	        if (n.includes('metz')) {
	          tips.push("🚉 <b>Metz :</b> privilégier la montée à l’arrière du train.");
	        }
	        if (n.includes('luxembourg')) {
	          tips.push("🇱🇺 <b>Luxembourg :</b> privilégier la montée à l’avant <i>et</i> à la voiture tout à l’arrière (quais 7 à 10).");
	          tips.push("↗️ <b>Autres quais :</b> privilégier d’aller à l’avant.");
	        }
	        tips.push("⏱️ <b>Général :</b> arriver au moins 10 min avant pour les express, et checker labetaillere.fr en amont 😎");
	        return `<ul class=\"fav-aff-tip-list\">${tips.map(t=>`<li>${t}</li>`).join('')}</ul>`;
	      })();
	      const toPct = (x)=>{ const n=Number(x); if(!Number.isFinite(n)) return null; const v=(n<=1.01)?(n*100):n; return Math.max(0,Math.min(100,Math.round(v))); };
      let maxPct = null; let peakName = '';
      const stopsHtml = stops.map((s,idx)=>{
        const stName = escapeHtml(s.station || s.name || `Arrêt ${idx+1}`);
        const stTime = escapeHtml(s.hhmm || s.time || '');
        const pp = toPct(s.globalOcc ?? s.pct ?? s.globalPct ?? s.occPct);
        if (pp!=null && (maxPct==null || pp>maxPct)) { maxPct = pp; peakName = String(s.station || s.name || peakName || ''); }
        const p  = (pp==null) ? '—' : `${pp}%`;
        const pcls = pctClass(pp);
        const sch = wagonSchemaHtml(s, affInfo.trainType);
        return `<div class="fav-aff-stop">
          <div class="fav-aff-stop-head">
            <div class="fav-aff-stop-title">
              <span class="fav-aff-stop-name">${stName}</span>
              ${stTime ? `<span class="fav-aff-stop-time">· ${stTime}</span>` : ``}
            </div>
            <div class="fav-aff-stop-pct ${pcls}">${p}</div>
          </div>
          <div class="fav-aff-stop-schema">${sch}</div>
        </div>`;
      }).join('');

      return `
        <details class="fav-box fav-aff" ${stops.length? '' : 'data-empty="1"'}>
          <summary class="fav-box-head">
            <div class="fav-aff-summary">
              <div class="fav-aff-top"><div class="fav-aff-title">Affluence :</div></div>
              <div class="fav-aff-schema fav-aff-schema--compact">${affInfo.schemaHtml||''}</div>
              <div class="fav-aff-toggleline"></div>
            </div>
          </summary>
              <div class="fav-box-body fav-aff-body">
	            <details class="fav-aff-tip">
	              <summary>💡 Conseil #BER</summary>
	              <div class="fav-aff-tip-body">${tipHtml}</div>
	            </details>
	            ${stops.length ? `<div class="fav-aff-stops">${stopsHtml}</div>` : `<div class="fav-aff-empty">Pas de détail d’affluence disponible pour ce train ce jour-là.</div>`}
	          </div>
        </details>
      `;
    })() : '';
	if (card) card.classList.toggle('is-delayed', Boolean(isDelayed));
    line.innerHTML = (causeHtml || '') + progressHtml + (nextTrainHtml || '') + (stopsHtml || '') + (affHtml || '');
if (statsEl){
      renderFavStats(kind, trainId).catch(()=>{});
      if (!statsEl.hasAttribute('data-user-opened')) statsEl.open = false;
    }
  };
  // Le numéro du favori ouvre la fiche complète, sans ajouter une ligne à la carte.
  if (!window.__lbFavCompactProfileBound){
    window.__lbFavCompactProfileBound = true;
    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.fav-train-profile-link');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const trainId = String(button.dataset.train || '').match(/\d{5,6}/)?.[0] || '';
      if (!trainId || typeof window.lbOpenTrainProfile !== 'function') return;
      button.disabled = true;
      const serviceDate = String(button.dataset.serviceDate || luxYmdToday());
      Promise.resolve(window.lbOpenTrainProfile(trainId, serviceDate, { origin:'favorites' }))
        .catch((error) => console.error('[Favoris] fiche train indisponible', error))
        .finally(() => { button.disabled = false; });
    }, true);
  }

  // Clic sur "Détail" dans l'affluence des favoris -> ouvre la section Affluence + détail du train
  if (!window.__lbFavAffOpenBound){
    window.__lbFavAffOpenBound = true;
    document.addEventListener('click', (ev)=>{
      const btn = ev.target && ev.target.closest ? ev.target.closest('.fav-aff-open') : null;
      if (!btn) return;
      ev.preventDefault();
      const trainId = btn.getAttribute('data-train') || '';
      if (!trainId) return;
      const dateStr = document.getElementById('affDaySel')?.value || document.getElementById('trainDate')?.value || '';
      if (window.lbOpenAffluenceTrain) window.lbOpenAffluenceTrain(trainId, dateStr);
    }, true);
  }

  const fetchTrainToday = async (selectionKey) => {
    const ymd = luxYmdToday();
    if (!/^\d{5,6}$/.test(String(selectionKey))) return { error: 'Format invalide' };

    if (typeof vpsVehicleJourneyUrl !== 'function' || typeof fetchJSON !== 'function') {
      return { error: 'Fonctions SNCF manquantes' };
    }

    const url = vpsVehicleJourneyUrl(ymd, String(selectionKey));
    let response;
    try {
      response = await fetchJSON(url, { client: 'front-favoris' });
    } catch (e) {
      console.warn('[Favoris SNCF] Erreur fetch:', e?.message || e);
      await window.lbLoadTrainStaticToday?.();
      return window.lbGetTrainStaticNextPayload?.(String(selectionKey)) || { error:'Aucune circulation prévue prochainement' };
    }
    if (!response?.ok) {
      await window.lbLoadTrainStaticToday?.();
      return window.lbGetTrainStaticNextPayload?.(String(selectionKey)) || { error:'Aucune circulation prévue prochainement' };
    }

    const train = response?.data?.vehicle_journeys?.[0];
    if (!train) {
      await window.lbLoadTrainStaticToday?.();
      return window.lbGetTrainStaticNextPayload?.(String(selectionKey)) || { error:'Aucune circulation prévue prochainement' };
    }
    // Extraire une cause lisible si dispo (perturbations temps réel)
    const disruptions = response?.data?.disruptions || [];
    const causes = [];
    for (const d of disruptions){
      const c = (d && typeof d.cause === 'string') ? d.cause.trim() : '';
      if (c) causes.push(c);
      const msgs = d?.messages || [];
      for (const m of msgs){
        const t = (m && typeof m.text === 'string') ? m.text.trim() : '';
        if (t) causes.push(t);
      }
    }
    const uniq = [];
    for (const c of causes){
      if (!c) continue;
      if (!uniq.includes(c)) uniq.push(c);
    }
    const causeText = uniq.slice(0,2).join(' • ');

    // Construire l'index impacted comme dans le tableau (fallback si le proxy ne renvoie pas impacted)
    let impactedIndex = (response?.data?.impacted && typeof response.data.impacted === 'object') ? response.data.impacted : null;
    if (!impactedIndex){
      impactedIndex = {};
      for (const d of disruptions){
        const objs = d?.impacted_objects || [];
        for (const o of objs){
          const stops = o?.impacted_stops || [];
          for (const s of stops){
            const sid = s?.stop_point?.id;
            if (sid) impactedIndex[sid] = s;
          }
        }
      }
    }

    return { train, source: 'SNCF', disruptions, causeText, impacted: impactedIndex };
  };

  let favWidgetTimer = null;

  function shouldShowFavoritesWidget(){
    if (window.lbIsAuthed !== true) return false;
    const body = document.body;
    if (body?.classList?.contains('page-favoris')) return true;
    const hash = String(location.hash || '').toLowerCase();
    return hash === '#favoris' || hash === '#favtrainswidget';
  }

  window.updateFavoriteWidgetFromPrefs = async () => {
    const root = document.getElementById('favTrainsWidget');
    if (!root) return;

    if (window.lbIsAuthed !== true) {
      root.style.display = 'none';
      try{ if (typeof ensureFavInHome==='function') ensureFavInHome(); }catch(e){}
      if (favWidgetTimer) { clearInterval(favWidgetTimer); favWidgetTimer = null; }
      return;
    }

    root.style.display = shouldShowFavoritesWidget() ? 'block' : 'none';
    try{ if (typeof ensureFavInHome==='function') ensureFavInHome(); }catch(e){}

    // S'assurer que les retards GTFS-RT sont chargés (même source que le tableau)
    if (!window.retardsGTFS && (typeof loadGtfsRetards === 'function')){
      try { await loadGtfsRetards({ forceFresh: false }); } catch(e) {}
    }

    // S'assurer que les voies (quais) sont à jour (live léger)
    if (typeof loadVoiesByTrain === 'function') {
      try { await loadVoiesByTrain({ forceFresh: false, onlyIfChanged: true }); } catch(e) {}
    }
	if (typeof loadCflVoiesByTrain === 'function') {
      try { await loadCflVoiesByTrain({ forceFresh: false }); } catch(e) {}
    }

    const prefs = window.lbPrefsCache || null;
    const favAM = (prefs?.favoriteMorningTrain || '').trim();
    const favPM = (prefs?.favoriteEveningTrain || '').trim();

    const [amRes, pmRes] = await Promise.allSettled([
      favAM ? fetchTrainToday(favAM) : Promise.resolve({ error: null }),
      favPM ? fetchTrainToday(favPM) : Promise.resolve({ error: null })
    ]);

    renderFavCard('AM', favAM, amRes.status === 'fulfilled' ? amRes.value : { error: 'Erreur API' });
    renderFavCard('PM', favPM, pmRes.status === 'fulfilled' ? pmRes.value : { error: 'Erreur API' });

    try{ if (typeof lbRenderHomeFavPreview==='function') lbRenderHomeFavPreview(); }catch(e){}

    if (!favAM && !favPM && favWidgetTimer) {
      clearInterval(favWidgetTimer);
      favWidgetTimer = null;
    }
    if ((favAM || favPM) && !favWidgetTimer) {
      favWidgetTimer = setInterval(() => {
        if (document.hidden || !navigator.onLine) return;
        window.updateFavoriteWidgetFromPrefs().catch(() => {});
      }, 60 * 1000);
    }

    try{ if (typeof lbFitFavSchemas==='function') lbFitFavSchemas(); }catch(e){}
};

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('favOpenPrefs');
    if (btn) {
      btn.addEventListener('click', () => {
        const openPrefsBtn = document.getElementById('lbBtnPrefs');
        if (openPrefsBtn) openPrefsBtn.click();
      });
    }
  });

  let lbIsAuthed = false;
  window.lbIsAuthed = false;
  const refreshAccountUI = async () => {
    const openBtn = $("lbBtnOpenAuth");
    const logoutBtn = $("lbBtnLogout");
    const deleteBox = $("delete-account-box");
    const prefsBtn = $("lbBtnPrefs");
	const rankingBtn = $("lbBtnRanking");
    const loginFields = $("lbLoginFields");
    const submitBtn = $("lbBtnSubmit");
    const forgotWrap = $("lbForgotWrap");
    const authSwitch = $("lbAuthSwitch");
    const contactBtn = $("lbBtnContact");
    const footerContactLink = $("lbFooterContactLink");
    const deleteLinkWrap = $("lbDeleteLinkWrap");
    if (!openBtn || !logoutBtn) return;
    try {
      const me = await api("/me");
      lbIsAuthed = true;
      window.lbIsAuthed = true;
      if (typeof window.updateStatsConsoleAuth === "function") {
        window.updateStatsConsoleAuth(true);
      }
      openBtn.textContent = "Mon compte / Déconnexion";
      logoutBtn.style.display = "inline-flex";
      if (deleteBox) deleteBox.style.display = "none";
      if (prefsBtn) prefsBtn.style.display = "inline-flex";
	  if (rankingBtn) rankingBtn.style.display = "inline-flex";
      if (loginFields) loginFields.style.display = "none";
      if (submitBtn) submitBtn.style.display = "none";
      if (forgotWrap) forgotWrap.style.display = "none";
      if (authSwitch) authSwitch.style.display = "none";
      if (contactBtn) contactBtn.style.display = "inline-flex";
      if (deleteLinkWrap) deleteLinkWrap.style.display = "block";
      msg(`✅ Connecté : ${me?.user?.email || "utilisateur"}`);
      await loadPreferences();
      await refreshGamificationUI({ force: true });
      try { if (typeof window.updateFavoriteWidgetFromPrefs === "function") await window.updateFavoriteWidgetFromPrefs(); } catch(e) {}
      try{ window.lbComments?.refresh(); }catch(e){}
    } catch {
      openBtn.textContent = "Se connecter";
      logoutBtn.style.display = "none";
      if (deleteBox) deleteBox.style.display = "none";
      if (prefsBtn) prefsBtn.style.display = "none";
      if (rankingBtn) rankingBtn.style.display = "none";
      if (loginFields) loginFields.style.display = "grid";
      if (submitBtn) submitBtn.style.display = "inline-flex";
      if (forgotWrap) forgotWrap.style.display = "block";
      if (authSwitch) authSwitch.style.display = "grid";
      if (contactBtn) contactBtn.style.display = "none";
      if (deleteLinkWrap) deleteLinkWrap.style.display = "none";
      const prefsModal = $("lbPrefsModal");
      const rankingModal = $("lbRankingModal");
      if (prefsModal) {
        prefsModal.style.display = "none";
        prefsModal.setAttribute("aria-hidden", "true");
        const authModal = $("lbAuthModal");
    if (authModal) {
      authModal.style.display = "none";
      authModal.setAttribute("aria-hidden", "true");
    }
      }
      if (rankingModal){
        rankingModal.style.display = "none";
        rankingModal.setAttribute("aria-hidden", "true");
      }
      lbPrefsCache = null;
      window.lbPrefsCache = null;
      try { updateHomeWelcomeLine(); } catch(e) {}
      try { if (typeof window.updateFavoriteWidgetFromPrefs === "function") window.updateFavoriteWidgetFromPrefs(); } catch(e) {}
      lbPrefsAppliedOnce = false;
      customRapidPresets.AM = null;
      customRapidPresets.PM = null;
      customRapidPresets.L3 = null;
      customRapidPresets.L4 = null;
      applyRapidPresetLabels();
      updateRapidPresetVisibility();
      lbIsAuthed = false;
      window.lbIsAuthed = false;
      if (typeof window.updateStatsConsoleAuth === "function") {
        window.updateStatsConsoleAuth(false);
      }
      resetGamificationUI();
	  msg("ℹ️ Non connecté");
      refreshGamificationUI({ force: true }).catch(()=>{});
      try{ window.lbComments?.refresh(); }catch(e){}
    }
    updateQuickAddButton();
    updateSelectionApplyButton();
  };

  const refreshAuthState = async () => {
    try{ await checkAuth(); }catch(_){}
    await refreshAccountUI();
    console.log("AUTH_REFRESH_DONE");
  };

  const openBtn = $("lbBtnOpenAuth");
  const closeBtn = $("lbBtnCloseAuth");
  const modal = $("lbAuthModal");
  const submitBtn = $("lbBtnSubmit");
  const logoutBtn = $("lbBtnLogout");
  const prefsBtn = $("lbBtnPrefs");
  const rankingBtn = $("lbBtnRanking");
  const contactBtn = $("lbBtnContact");
  const footerContactLink = $("lbFooterContactLink");
  const forgotLink = $("forgotLink");
  const prefsModal = $("lbPrefsModal");
  const prefsCloseBtn = $("lbBtnClosePrefs");
  const prefsCloseBtnAlt = $("lbClosePrefs");
  const prefsSaveBtn = $("lbSavePrefs");
  const prefsAddListBtn = $("lbAddPrefsList");
  const prefsResetBtn = $("lbResetPresets");
  const rankingFilter = $("lbRankingFilter");
  const rankingFilterInline = $("lbRankingFilterInline");
  const quickAddListBtn = $("lbQuickAddList");
  const registerModal = $("lbRegisterModal");
  const rankingModal = $("lbRankingModal");
  const rankingCloseBtn = $("lbBtnCloseRanking");
  const registerCloseBtn = $("lbBtnCloseRegister");
  const registerBtn = $("lbBtnRegister");
  const contactModal = $("lbContactModal");
  const contactCloseBtn = $("lbBtnCloseContact");
  const contactSendBtn = $("lbBtnSendContact");
  const deleteLinkWrap = $("lbDeleteLinkWrap");
  const deleteLink = $("lbDeleteLink");
  const resetPwdLink = $("lbResetPwdLink");
  const switchBtn = $("lbAuthSwitchBtn");

  const LB_PENDING_PUSH_OPTIN = "lbPendingPushOptIn.v1";
  const LB_PUSH_SETTINGS_KEY = "lbPushAlertSettings.v1";

  const normalizeEmailForOptin = (value) => String(value || "").trim().toLowerCase();

  const rememberRegistrationPushOptin = (email) => {
    try {
      localStorage.setItem(LB_PENDING_PUSH_OPTIN, JSON.stringify({
        email: normalizeEmailForOptin(email),
        favorites: true,
        trafficSevere: true,
        createdAt: Date.now()
      }));
    } catch (_) {}
  };

  const readPendingRegistrationPushOptin = (email) => {
    try {
      const raw = JSON.parse(localStorage.getItem(LB_PENDING_PUSH_OPTIN) || "null");
      if (!raw || !raw.email) return null;
      if (email && raw.email !== normalizeEmailForOptin(email)) return null;
      return raw;
    } catch (_) {
      return null;
    }
  };

  const clearPendingRegistrationPushOptin = () => {
    try { localStorage.removeItem(LB_PENDING_PUSH_OPTIN); } catch (_) {}
  };

  const saveLocalPushSettingsFromOptin = () => {
    try {
      const current = JSON.parse(localStorage.getItem(LB_PUSH_SETTINGS_KEY) || "{}");
      localStorage.setItem(LB_PUSH_SETTINGS_KEY, JSON.stringify({
        ...current,
        favorites: true,
        trafficSevere: true
      }));
    } catch (_) {
      try {
        localStorage.setItem(LB_PUSH_SETTINGS_KEY, JSON.stringify({ favorites: true, trafficSevere: true }));
      } catch (_) {}
    }
  };

  const syncPushOptinPrefsToAccount = async () => {
    try {
      const existing = await api("/prefs", { method: "GET" }).catch(() => ({}));
      const prefs = existing?.prefs || {};
      const merged = {
        ...prefs,
        favoriteAlerts: true,
        trafficSevere: true
      };
      await api("/prefs", {
        method: "POST",
        body: JSON.stringify({ prefs: merged })
      });
      applyPreferences(merged, { auto: false });
    } catch (err) {
      console.warn("PUSH_OPTIN_PREFS_SYNC_ERROR", err);
    }
  };

  const maybeHandlePendingRegistrationPushOptin = async (email) => {
    const pending = readPendingRegistrationPushOptin(email);
    if (!pending) return;

    saveLocalPushSettingsFromOptin();
    await syncPushOptinPrefsToAccount();

    const ok = confirm("🔔 Tu avais demandé les alertes importantes à la création du compte.\n\nActiver les notifications sur cet appareil maintenant ?");
    if (ok && typeof window.lbEnablePushNotifications === "function") {
      try { await window.lbEnablePushNotifications(); } catch (_) {}
    }
    clearPendingRegistrationPushOptin();
  };

  if (!openBtn || !closeBtn || !modal || !submitBtn || !logoutBtn) return;

  if (rankingFilter && !rankingFilter.dataset.bound){
    rankingFilter.dataset.bound = '1';
    rankingFilter.addEventListener('change', ()=>{
      if (rankingFilterInline) rankingFilterInline.value = rankingFilter.value || 'top10';
      renderGamificationUI();
    });
  }
  if (rankingFilterInline && !rankingFilterInline.dataset.bound){
    rankingFilterInline.dataset.bound = '1';
    rankingFilterInline.addEventListener('change', ()=>{
      if (rankingFilter) rankingFilter.value = rankingFilterInline.value || 'top10';
      renderGamificationUI();
    });
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  submitBtn.addEventListener("click", async () => {
    const email = $("lbEmail").value.trim();
    const password = $("lbPassword").value;
    if (!email || !password) return msg("❌ Email + mot de passe requis", true);

    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      msg("✅ Connecté");
      await refreshAuthState();
      await refreshGamificationUI({ force: true });
      await maybeHandlePendingRegistrationPushOptin(email);
      closeModal();
    } catch (e) {
      msg("❌ " + e, true);
    }
  });

  const deleteAccount = async () => {
    const pwd = $("deletePassword").value;
    const deleteMsg = $("deleteMsg");

    if (!pwd || pwd.length < 1) {
      if (deleteMsg) deleteMsg.textContent = "❌ Mot de passe requis.";
      return;
    }

    const ok1 = confirm("⚠️ Supprimer ton compte ? Cette action est définitive.");
    if (!ok1) return;
    const ok2 = prompt("Tape SUPPRIMER pour confirmer :");
    if (ok2 !== "SUPPRIMER") {
      if (deleteMsg) deleteMsg.textContent = "Annulé.";
      return;
    }

    if (deleteMsg) deleteMsg.textContent = "Suppression en cours…";

    try {
      await api("/auth/delete-account", {
        method: "POST",
        body: JSON.stringify({ password: pwd })
      });
      if (deleteMsg) deleteMsg.textContent = "✅ Compte supprimé. Déconnexion…";
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      if (deleteMsg) deleteMsg.textContent = "❌ " + e;
    }
  };

  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      resetGamificationUI();
      msg("✅ Déconnecté");
      await refreshAuthState();
      await refreshGamificationUI({ force: true });
    } catch (e) {
      msg("❌ " + e, true);
    }
  });

  const deleteBtn = $("deleteBtn");
  if (deleteBtn) deleteBtn.addEventListener("click", deleteAccount);
  if (deleteLink) {
    deleteLink.addEventListener("click", (e) => {
      e.preventDefault();
      const deleteBox = $("delete-account-box");
      if (!deleteBox) return;
      const isVisible = deleteBox.style.display === "block";
      deleteBox.style.display = isVisible ? "none" : "block";
    });
  }
  if (resetPwdLink) {
    resetPwdLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = String(window.currentUser?.email || $("lbEmail")?.value || "").trim();
      if (!email) {
        alert("Email introuvable pour ce compte.");
        return;
      }
      const currentPassword = prompt("Pour sécurité, entre ton mot de passe actuel :");
      if (!currentPassword) return;
      try{
        const verifyRes = await fetch(LB_API + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password: currentPassword })
        });
        if (!verifyRes.ok) {
          alert("Mot de passe actuel invalide.");
          return;
        }
        await fetch(LB_API + "/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email })
        });
      }catch(err){
        console.warn("RESET_PASSWORD_LINK_ERROR", err);
      }
      alert("Si cet email existe, un lien de réinitialisation vient d’être envoyé.");
    });
  }

  let prefsSelectionTargetKey = null;

  const PREFS_LIST_CONFIG = [
    { key: "AM", labelId: "lbPresetLabelAM", trainsId: "lbPresetTrainsAM", name: "Liste 1" },
    { key: "PM", labelId: "lbPresetLabelPM", trainsId: "lbPresetTrainsPM", name: "Liste 2" },
    { key: "L3", labelId: "lbPresetLabelL3", trainsId: "lbPresetTrainsL3", name: "Liste 3", optional: true },
    { key: "L4", labelId: "lbPresetLabelL4", trainsId: "lbPresetTrainsL4", name: "Liste 4", optional: true }
  ];

  const getPresetConfig = (key) => PREFS_LIST_CONFIG.find((item) => item.key === key);

  const getPresetFields = (key) => {
    const config = getPresetConfig(key);
    if (!config) return null;
    return {
      config,
      label: $(config.labelId),
      trains: $(config.trainsId),
      section: document.querySelector(`.lb-prefs-section[data-preset="${config.key}"]`)
    };
  };

  const getPresetFromCache = (key) => {
    const raw = lbPrefsCache?.rapidPresets || {};
    return raw[key] || raw[key.toLowerCase()] || null;
  };

  const updateDefaultListOptions = () => {
    const select = $("lbDefaultMode");
    if (!select) return;
    PREFS_LIST_CONFIG.forEach(({ key, name }) => {
      const option = select.querySelector(`option[value="${key}"]`);
      if (!option) return;
      const fields = getPresetFields(key);
      const label = fields?.label?.value?.trim();
      option.textContent = label || name;
      if (fields?.config?.optional) {
        const hasContent = !!fields.label?.value?.trim() || !!fields.trains?.value?.trim();
        option.disabled = !hasContent;
        option.hidden = !hasContent;
      } else {
        option.disabled = false;
        option.hidden = false;
      }
    });
    if (select.value) {
      const activeOption = select.querySelector(`option[value="${select.value}"]`);
      if (activeOption && activeOption.disabled) {
        select.value = "";
      }
    }
  };

  const syncOptionalPrefsSections = () => {
    PREFS_LIST_CONFIG.filter((item) => item.optional).forEach(({ key }) => {
      const fields = getPresetFields(key);
      if (!fields?.section) return;
      const hasContent = !!fields.label?.value?.trim() || !!fields.trains?.value?.trim();
      fields.section.style.display = hasContent ? "grid" : "none";
    });
  };

  const getNextOptionalPresetKey = () => {
    const optional = PREFS_LIST_CONFIG.filter((item) => item.optional);
    for (const { key } of optional) {
      const fields = getPresetFields(key);
      if (!fields?.section) continue;
      const hidden = getComputedStyle(fields.section).display === 'none';
      if (hidden) return key;
    }
    return null;
  };

  const hasHiddenOptionalPreset = () => Boolean(getNextOptionalPresetKey());

  const updatePrefsAddButton = () => {
    if (!prefsAddListBtn) return;
    prefsAddListBtn.style.display = hasHiddenOptionalPreset() ? "inline-flex" : "none";
  };

  const updateQuickAddButton = () => {
    if (!quickAddListBtn) return;
    const shouldShow = lbIsAuthed && hasHiddenOptionalPreset();
    quickAddListBtn.style.display = shouldShow ? "inline-flex" : "none";
  };

  const updateSelectionApplyButton = () => {
    const btn = document.getElementById('applySelectionToPreset');
    const loadBtn = document.getElementById('loadTrains');
    if (!btn) return;
    if (!prefsSelectionTargetKey || !lbIsAuthed) {
      btn.hidden = true;
      btn.style.display = "none";
      btn.textContent = "Ajouter à la liste";
      if (loadBtn) {
        loadBtn.hidden = false;
        loadBtn.style.display = "inline-flex";
      }
      return;
    }
    const fields = getPresetFields(prefsSelectionTargetKey);
    const defaultName = fields?.config?.name || "liste";
    const labelValue = fields?.label?.value?.trim();
    const label = labelValue || defaultName;
    btn.textContent = `Ajouter à ${label}`;
    btn.hidden = false;
    btn.style.display = "inline-flex";
    if (loadBtn) {
      loadBtn.hidden = true;
      loadBtn.style.display = "none";
    }
  };
  window.updateSelectionApplyButton = updateSelectionApplyButton;

  const openPresetBuilderModal = () => {
    const modal = $("presetBuilderModal");
    if (!modal) return;
    closePrefsModal();
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    const date = $("presetDate");
    if (date && !date.value) date.value = $("trainDate")?.value || "";
    const start = $("presetStartSearch");
    if (start) {
      setTimeout(() => {
        try { start.focus({ preventScroll: true }); }
        catch { start.focus(); }
      }, 0);
    }
  };

  const closePresetBuilderModal = () => {
    const modal = $("presetBuilderModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  };

  const prepareSelectionForPreset = (key) => {
    prefsSelectionTargetKey = key;
    updateSelectionApplyButton();
    openPresetBuilderModal();
  };

  const openPrefsModal = (options = {}) => {
    if (!prefsModal) return;
    prefsModal.style.display = "flex";
    prefsModal.setAttribute("aria-hidden", "false");
    if (!options.skipLoad) {
      PREFS_LIST_CONFIG.forEach(({ key }) => {
        const fields = getPresetFields(key);
        const preset = getPresetFromCache(key) || {};
        if (fields?.label) fields.label.value = preset?.label || "";
        if (fields?.trains) fields.trains.value = (preset?.trains || []).join(", ");
      });
      syncOptionalPrefsSections();
      updateDefaultListOptions();
      updatePrefsAddButton();
      updateQuickAddButton();
    }
  };

  const closePrefsModal = () => {
    if (!prefsModal) return;
    prefsModal.style.display = "none";
    prefsModal.setAttribute("aria-hidden", "true");
  };

  const prefsMsg = (text, isErr = false) => {
    const node = $("lbPrefsMsg");
    if (!node) return;
    node.textContent = text;
    node.style.color = isErr ? "#ffaaaa" : "#aab6c8";
  };

  if (prefsBtn) prefsBtn.addEventListener("click", () => {
    if (typeof closeModal === "function") {
      closeModal();
    }
    openPrefsModal();
  });
  if (rankingBtn) rankingBtn.addEventListener("click", async () => {
    if (typeof closeModal === "function") closeModal();
    if (!rankingModal) return;
	await refreshGamificationUI({ force: true });
    rankingModal.style.display = "flex";
    rankingModal.setAttribute("aria-hidden", "false");
    renderGamificationUI();
  });
  if (rankingCloseBtn) rankingCloseBtn.addEventListener("click", () => {
    if (!rankingModal) return;
    rankingModal.style.display = "none";
    rankingModal.setAttribute("aria-hidden", "true");
  });
  if (rankingModal) {
    rankingModal.addEventListener("click", (e) => {
      if (e.target !== rankingModal) return;
      rankingModal.style.display = "none";
      rankingModal.setAttribute("aria-hidden", "true");
    });
  }
  if (prefsCloseBtn) prefsCloseBtn.addEventListener("click", closePrefsModal);
  if (prefsCloseBtnAlt) prefsCloseBtnAlt.addEventListener("click", closePrefsModal);
  if (prefsModal) {
    prefsModal.addEventListener("click", (e) => {
      if (e.target === prefsModal) closePrefsModal();
    });
  }

  PREFS_LIST_CONFIG.forEach(({ key }) => {
    const fields = getPresetFields(key);
    if (fields?.label) {
      fields.label.addEventListener("input", updateDefaultListOptions);
    }
    if (fields?.trains) {
      fields.trains.addEventListener("input", updateDefaultListOptions);
    }
  });

  const revealNextOptionalPreset = () => {
    const next = PREFS_LIST_CONFIG.filter((item) => item.optional)
      .map((item) => getPresetFields(item.key))
      .find((fields) => fields?.section && fields.section.style.display === "none");
    if (next?.section) {
      next.section.style.display = "grid";
      updatePrefsAddButton();
      updateQuickAddButton();
      if (next.label) next.label.focus();
    }
  };

  if (prefsAddListBtn) {
    prefsAddListBtn.addEventListener("click", revealNextOptionalPreset);
  }

  if (prefsResetBtn) {
    prefsResetBtn.addEventListener("click", () => {
      const amFields = getPresetFields("AM");
      const pmFields = getPresetFields("PM");
      if (amFields?.label) amFields.label.value = "Matin";
      if (pmFields?.label) pmFields.label.value = "Soir";
      if (amFields?.trains) amFields.trains.value = PRESET_AM.join(", ");
      if (pmFields?.trains) pmFields.trains.value = PRESET_PM.join(", ");
      customRapidPresets.AM = { label: "Matin", trains: PRESET_AM.slice(), route: null };
      customRapidPresets.PM = { label: "Soir", trains: PRESET_PM.slice(), route: null };
      lbPresetRouteMeta.AM = null;
      lbPresetRouteMeta.PM = null;
      applyRapidPresetLabels();
      updateDefaultListOptions();
      updatePrefsAddButton();
      updateQuickAddButton();
    });
  }

  if (quickAddListBtn) {
    quickAddListBtn.addEventListener("click", () => {
      openPrefsModal();
      revealNextOptionalPreset();
      const target = getNextOptionalPresetKey();
      if (!target) return;
      prepareSelectionForPreset(target);
    });
  }

  document.querySelectorAll('[data-preset-build]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.presetBuild;
      if (!key) return;
      closePrefsModal();
      prepareSelectionForPreset(key);
    });
  });

 const presetBuilderModal = $("presetBuilderModal");
  const presetBuilderClose = $("presetBuilderClose");
  const presetBuilderCancel = $("presetBuilderCancel");
  const presetBuilderSearch = $("presetBuilderSearch");

  if (presetBuilderClose) presetBuilderClose.addEventListener("click", closePresetBuilderModal);
  if (presetBuilderCancel) presetBuilderCancel.addEventListener("click", closePresetBuilderModal);
  if (presetBuilderModal) {
    presetBuilderModal.addEventListener("click", (e) => {
      if (e.target === presetBuilderModal) closePresetBuilderModal();
    });
  }

  if (presetBuilderSearch) {
    presetBuilderSearch.addEventListener("click", () => {
      const startName = $("presetStartSearch")?.value?.trim() || "";
      const endName = $("presetEndSearch")?.value?.trim() || "";
      const date = $("presetDate")?.value || "";
      const fromHHMM = $("presetTimeFrom")?.value || "06:00";
      const toHHMM = $("presetTimeTo")?.value || "10:00";
      if (!startName || !endName) {
        prefsMsg("❌ Choisis une gare de départ et d'arrivée.", true);
        return;
      }
      if (date) {
        const mainDate = $("trainDate");
        if (mainDate && mainDate.value !== date) {
          mainDate.value = date;
          mainDate.dispatchEvent(new Event('input', { bubbles: true }));
          mainDate.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      // Même logique que “Recherche par trajet” : on aligne aussi les gares du tableau.
      // Ainsi une liste Thionville → Luxembourg n'affichera pas Nancy → Luxembourg.
      lbSetTableRoute(startName, endName);
      lbRememberPresetRoute(prefsSelectionTargetKey, startName, endName);
      if (typeof closeModal === "function") {
        closeModal();
      }
      closePrefsModal();
      proposerTrainsOD({
        startName,
        endName,
        fromHHMM,
        toHHMM,
        openModal: true,
        focus: false,
        trigger: presetBuilderSearch
      });
      closePresetBuilderModal();
    });
  }


  document.querySelectorAll('[data-remove-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.removePreset;
      const fields = getPresetFields(key);
      if (!fields?.section) return;
      if (fields.label) fields.label.value = "";
      if (fields.trains) fields.trains.value = "";
      lbPresetRouteMeta[key] = null;
      if (customRapidPresets[key]) customRapidPresets[key].route = null;
      fields.section.style.display = "none";
      updateDefaultListOptions();
      updatePrefsAddButton();
      updateQuickAddButton();
    });
  });

  const applySelectionToPreset = () => {
    if (!prefsSelectionTargetKey) return;
    const fields = getPresetFields(prefsSelectionTargetKey);
    if (!fields?.trains) return;
    const numbers = Array.from(selectedTrains || [])
      .map((val) => (String(val).match(/\b\d{5,6}\b/) || [])[0])
      .filter(Boolean);
    if (!numbers.length) {
      prefsMsg("❌ Sélectionne au moins un numéro de train.", true);
      openPrefsModal();
      return;
    }
    const unique = Array.from(new Set(numbers)).slice(0, 10);
    openPrefsModal({ skipLoad: true });
    fields.trains.value = unique.join(", ");
    const rememberedRoute = lbNormalizePresetRoute(lbPresetRouteMeta[prefsSelectionTargetKey]);
    if (rememberedRoute) {
      customRapidPresets[prefsSelectionTargetKey] = {
        label: fields.label?.value || fields.config?.name || '',
        trains: unique.slice(),
        route: rememberedRoute
      };
    }
    if (fields.section) fields.section.style.display = "grid";
    if (fields.label && !fields.label.value.trim()) {
      fields.label.value = fields.config?.name || "";
    }
    updateDefaultListOptions();
    updatePrefsAddButton();
    updateQuickAddButton();
    prefsSelectionTargetKey = null;
    updateSelectionApplyButton();
    closeSelectionModal({ restoreFocus: false });
  };

  if (prefsSaveBtn) {
    prefsSaveBtn.addEventListener("click", async () => {
      const payloadPresets = {};
      for (const item of PREFS_LIST_CONFIG) {
        const fields = getPresetFields(item.key);
        const raw = fields?.trains?.value || "";
        const allNumbers = parseTrainList(raw, Number.POSITIVE_INFINITY);
        const isDefaultReset = (item.key === "AM" && areListsEqual(allNumbers, PRESET_AM))
          || (item.key === "PM" && areListsEqual(allNumbers, PRESET_PM));
        const list = isDefaultReset ? allNumbers : parseTrainList(raw, 10);
        if (allNumbers.length > 10 && !isDefaultReset) {
          return prefsMsg("❌ 10 numéros maximum par liste.", true);
        }
        if (raw.trim() && list.length === 0) {
          return prefsMsg(`❌ Aucun numéro valide trouvé pour la ${item.name.toLowerCase()}.`, true);
        }
        const route = lbNormalizePresetRoute(lbPresetRouteMeta[item.key] || customRapidPresets[item.key]?.route);
        payloadPresets[item.key] = {
          label: fields?.label?.value || "",
          trains: list,
          ...(route ? { route } : {})
        };
      }

      const pseudo = ($("lbPseudo")?.value || "").trim().slice(0,24);
	  const favMorning = $("lbFavMorning")?.value?.trim() || "";
      const favEvening = $("lbFavEvening")?.value?.trim() || "";

      const payload = {
        // Conserve les préférences des autres modules (dont le tableau STATS V2)
        // quand l'utilisateur enregistre ses réglages généraux.
        ...(window.lbPrefsCache || {}),
        rapidPresets: payloadPresets,
		pseudo,
        favoriteMorningTrain: favMorning,
        favoriteEveningTrain: favEvening,
        favoriteFromStation: (document.getElementById('lbFavFromStation')?.value || '').trim(),
        favoriteToStation: (document.getElementById('lbFavToStation')?.value || '').trim(),
        favoriteAlerts: (() => { try { return JSON.parse(localStorage.getItem("lbPushAlertSettings.v1") || "{}").favorites !== false; } catch (_) { return true; } })(),
        trafficSevere: (() => { try { return JSON.parse(localStorage.getItem("lbPushAlertSettings.v1") || "{}").trafficSevere !== false; } catch (_) { return true; } })(),
        // Compat + fallback : on garde aussi weatherStations mais aligné sur les gares favorites
        weatherStations: {
          from: (document.getElementById('lbFavFromStation')?.value || '').trim(),
          to: (document.getElementById('lbFavToStation')?.value || '').trim()
        }};

      try {
        await api("/prefs", {
          method: "POST",
          body: JSON.stringify({ prefs: payload })
        });
        applyPreferences(payload, { auto: false });
        await refreshGamificationUI({ force: true });
        prefsMsg("✅ Préférences enregistrées.");
        closePrefsModal();
      } catch (err) {
        prefsMsg("❌ " + err, true);
      }
    });
  }
  const applySelectionBtn = document.getElementById('applySelectionToPreset');
  if (applySelectionBtn) {
    applySelectionBtn.addEventListener('click', applySelectionToPreset);
  }

  const openRegisterModal = () => {
    if (!registerModal) return;
    closeModal();
    registerModal.style.display = "flex";
    registerModal.setAttribute("aria-hidden", "false");
	const regMsg = $("lbRegMsg");
    if (regMsg) {
      regMsg.textContent = "ℹ️ Remplis les champs pour créer ton compte.";
      regMsg.style.color = "#aab6c8";
    }
  };

  const closeRegisterModal = () => {
    if (!registerModal) return;
    registerModal.style.display = "none";
    registerModal.setAttribute("aria-hidden", "true");
  };

  if (registerCloseBtn) registerCloseBtn.addEventListener("click", closeRegisterModal);
  if (registerModal) {
    registerModal.addEventListener("click", (e) => {
      if (e.target === registerModal) closeRegisterModal();
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      const email = $("lbRegEmail").value.trim();
      const password = $("lbRegPassword").value;
      const passwordConfirm = $("lbRegPasswordConfirm").value;
      const rgpdInput = $("lbRegRgpd");
      const alertsOptin = $("lbRegAlertsOptin");
      const regMsg = $("lbRegMsg");
      if (!email || !password) {
        if (regMsg) regMsg.textContent = "❌ Email + mot de passe requis";
        return;
      }
      if (password.length < 10) {
        if (regMsg) regMsg.textContent = "❌ Le mot de passe doit contenir au moins 10 caractères";
        return;
      }
      if (password !== passwordConfirm) {
        if (regMsg) regMsg.textContent = "❌ Les mots de passe ne correspondent pas";
        return;
      }
      if (!rgpdInput || !rgpdInput.checked) {
        if (regMsg) regMsg.textContent = "❌ Merci de confirmer la prise de connaissance de la politique de confidentialité";
        return;
      }
      const wantsAlertsAtRegister = !!(alertsOptin && alertsOptin.checked);
      if (regMsg) {
        regMsg.textContent = "⏳ Création du compte…";
        regMsg.style.color = "#aab6c8";
      }
      try {
        await api("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });

        if (wantsAlertsAtRegister) {
          rememberRegistrationPushOptin(email);
          saveLocalPushSettingsFromOptin();
        }

        $("lbRegPassword").value = "";
        $("lbRegPasswordConfirm").value = "";
        if (rgpdInput) rgpdInput.checked = false;
        if (alertsOptin) alertsOptin.checked = false;

		closeRegisterModal();
        openModal();

        const authMsg = $("lbAuthMsg");
        if (authMsg) {
          authMsg.innerHTML = "Compte créé ✅<br>Un email de validation vous a été envoyé.<br>Merci de cliquer sur le lien avant de vous connecter.<br>Vérifiez aussi vos spams." + (wantsAlertsAtRegister ? "<br><br>🔔 Après validation et connexion, on te proposera d’activer les alertes sur cet appareil." : "");
          authMsg.style.color = "#b8ffd6";
        }
        $("lbEmail").value = email;
        $("lbPassword").value = "";
      } catch (e) {
        if (regMsg) {
          regMsg.textContent = "❌ " + e;
          regMsg.style.color = "#ffaaaa";
        }
      }
    });
  }

  const openContactModal = () => {
    if (!contactModal) return;
    closeModal();
    contactModal.style.display = "flex";
    contactModal.setAttribute("aria-hidden", "false");
  };

  const closeContactModal = () => {
    if (!contactModal) return;
    contactModal.style.display = "none";
    contactModal.setAttribute("aria-hidden", "true");
  };

  if (contactBtn) contactBtn.addEventListener("click", openContactModal);
  if (footerContactLink) footerContactLink.addEventListener("click", (e) => { e.preventDefault(); openContactModal(); });
  if (contactCloseBtn) contactCloseBtn.addEventListener("click", closeContactModal);
  if (contactModal) {
    contactModal.addEventListener("click", (e) => {
      if (e.target === contactModal) closeContactModal();
    });
  }

  if (contactSendBtn) {
    contactSendBtn.addEventListener("click", () => {
      const name = $("lbContactName")?.value.trim();
      const email = $("lbContactEmail")?.value.trim();
      const message = $("lbContactMessage")?.value.trim();
      const contactMsg = $("lbContactMsg");
      if (!email || !message) {
        if (contactMsg) contactMsg.textContent = "❌ Email + message requis.";
        return;
      }
      const subject = encodeURIComponent("Contact La Bétaillère");
      const body = encodeURIComponent(
        `Nom: ${name || "Anonyme"}\nEmail: ${email}\n\nMessage:\n${message}`
      );
      window.location.href = `mailto:celestiafireber@gmail.com?subject=${subject}&body=${body}`;
      if (contactMsg) contactMsg.textContent = "✅ Merci ! Ton email est prêt à être envoyé.";
      closeContactModal();
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = prompt("Entre ton email :");
      if (!email) return;
      try {
        await fetch(LB_API + "/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
      } catch (err) {
        console.warn("Mot de passe oublié indisponible", err);
      }
      alert("Si cet email existe, un lien de réinitialisation vient d’être envoyé.");
    });
  }

  if (switchBtn) {
    switchBtn.addEventListener("click", () => {
      openRegisterModal();
    });
  }

  setMode("login");
  refreshAccountUI();
})();
// Compteur de visites labetaillere.fr
(() => {
  const counter = document.getElementById('compteur-visites');
  if (!counter) return;

  fetch('https://vps.labetaillere.fr/sncf/stats/hit')
    .then(r => r.json())
    .then(d => {
      counter.textContent = `Visites : ${d.total}`;
    })
    .catch(err => {
      console.error(err);
      counter.textContent = 'Visites : (indispo)';
    });
})();
// Bandeau cookies discret
(() => {
  const initCookieBanner = () => {
    const banner = document.getElementById('cookieBanner');
    if (!banner) return;
    const key = 'lbCookieConsent';
    let consent = null;
    try {
      consent = localStorage.getItem(key) || sessionStorage.getItem(key);
    } catch (err) {
      console.warn('Impossible de lire le consentement cookies', err);
    }
    if (consent) return;
    banner.hidden = false;
    banner.removeAttribute('hidden');
    banner.setAttribute('aria-hidden', 'false');
    const accept = banner.querySelector('.cookie-accept');
    const close = banner.querySelector('.cookie-decline');
    const closeTop = banner.querySelector('.cookie-banner__close');
    const dismiss = (value) => {
      try {
        localStorage.setItem(key, value);
      } catch (err) {
        console.warn('Impossible de stocker le consentement cookies', err);
        try { sessionStorage.setItem(key, value); } catch(_){}
      }
      banner.hidden = true;
      banner.setAttribute('aria-hidden', 'true');
    };
    if (accept) accept.addEventListener('click', () => dismiss('accepted'));
    if (close) close.addEventListener('click', () => dismiss('dismissed'));
    if (closeTop) closeTop.addEventListener('click', () => dismiss('dismissed'));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookieBanner);
  } else {
    initCookieBanner();
  }
})();

;

(function(){
  // Retards: plus fréquent, mais application in-place (faible coût)
  const RETARDS_MS = 30 * 1000; // 30s: stable sans spam réseau
  // Voies: moins fréquent + onlyIfChanged (évite de reparser si identique)
  const VOIES_MS   = 45 * 1000; // 45s: évite surcharge CPU/mémoire

  let tRetards = null;
  let tVoies = null;
  let retardsInFlight = false;
  let voiesInFlight = false;

  function hasTrainTable(){
    return !!document.querySelector('#trainInfo table');
  }

  function canLiveBase(){
    if (document.hidden || !navigator.onLine) return false;
    return true;
  }

  function canLiveRetards(){
    if (!canLiveBase()) return false;
    // Le trafic Home doit rester live même si la date tableau n'est pas "aujourd'hui".
    return true;
  }

  function canLiveVoies(){
    if (!canLiveBase()) return false;
    return hasTrainTable();
  }

  // --- Live refresh in-place (voies) ---
  function updateVoiesInTable(){
    const table = document.querySelector('#trainInfo table');
    if (!table) return;

    const headRow = table.querySelector('thead tr:first-child');
    if (!headRow) return;

    const headerThs = Array.from(headRow.querySelectorAll('th[data-train-number]'));
    if (!headerThs.length) return;

    const headerNumbers = headerThs.map(th => (th.dataset.trainNumber || '').trim()).filter(Boolean);
    if (!headerNumbers.length) return;

    const tbody = table.tBodies && table.tBodies[0];
    const bodyRows = tbody ? Array.from(tbody.rows) : Array.from(table.querySelectorAll('tbody tr'));
    if (!bodyRows.length) return;

    const updateCellVoie = (cell, baseTimeRaw, voieLabel) => {
      if (!cell || !baseTimeRaw) return;
      const baseClock = (typeof ft === 'function') ? ft(baseTimeRaw) : baseTimeRaw;
      const baseWithVoie = voieLabel ? formatClockWithVoie(baseClock, voieLabel) : baseClock;

      // Le rafraîchissement des voies ne doit jamais détruire le rendu d'un
      // départ/terminus exceptionnel (ancienne heure barrée + nouvelle heure bleue).
      const isPartialBoundaryCell =
        cell.dataset?.terminalArrival === '1' ||
        cell.dataset?.terminalStart === '1' ||
        !!cell.querySelector('.terminal-partial-stack');
      if (isPartialBoundaryCell) {
        const terminalBase = cell.querySelector('.terminal-partial-base');
        if (terminalBase) terminalBase.textContent = baseClock;
        return;
      }

      const delayStrike = cell.querySelector('.delay-strike');
      if (delayStrike) {
        delayStrike.textContent = baseClock;
        return;
      }

      const gtfsRetard = cell.querySelector('.gtfs-retard');
      if (gtfsRetard) {
        const gtfsBase = gtfsRetard.querySelector('.gtfs-retard-base');
        if (gtfsBase) gtfsBase.textContent = baseClock;
        let voieWrap = gtfsRetard.querySelector('.delay-voie');
        if (voieLabel) {
          if (!voieWrap) {
            voieWrap = document.createElement('span');
            voieWrap.className = 'delay-voie';
            gtfsRetard.appendChild(voieWrap);
          }
          voieWrap.innerHTML = `<span class="voie-badge">${escapeHtml(typeof formatVoieLabel === 'function' ? formatVoieLabel(voieLabel) : voieLabel)}</span>`;
        } else if (voieWrap) {
          voieWrap.remove();
        }
        return;
      }

      const strong = cell.querySelector('strong');
      if (strong) {
        strong.innerHTML = baseWithVoie;
        return;
      }

      const deleted = cell.querySelector('.deleted');
      if (deleted) {
        const deletedStrong = deleted.querySelector('strong');
        if (deletedStrong) {
          deletedStrong.innerHTML = baseWithVoie;
        } else if (!deleted.querySelector('.delayed')) {
          deleted.innerHTML = baseWithVoie;
        }
        return;
      }

      if (!cell.querySelector('.delayed') && !cell.querySelector('.gtfs-retard')) {
        cell.innerHTML = baseWithVoie;
      }
    };

    for (const row of bodyRows) {
      if (!row) continue;
      const stopName =
        row.dataset.gare ||
        row.querySelector('.gare-label')?.textContent?.trim() ||
        row.cells?.[0]?.textContent?.trim() ||
        '';
      if (!stopName) continue;

      for (let i = 0; i < headerNumbers.length; i++) {
        const trainNumber = headerNumbers[i];
        const cell = row.cells?.[i + 1];
        if (!trainNumber || !cell) continue;

        const baseTimeRaw = cell.dataset?.baseTime || cell.getAttribute?.('data-base-time');
        if (!baseTimeRaw) continue;

        const voies = (typeof getVoiesForTrain === 'function') ? getVoiesForTrain(trainNumber) : null;
        const cflVoies = (typeof getCflVoiesForTrain === 'function') ? getCflVoiesForTrain(trainNumber) : null;
        const voieTimeCandidates = [baseTimeRaw];
        const allowCflFallback = !isLikelyFrenchStopContext({ stopName });
        const preferCflVoie = allowCflFallback && !!cflVoies && isLikelyCflStopName(stopName);
        let voieLabel = null;

        if (!preferCflVoie && typeof resolveVoieForStop === 'function') {
          voieLabel = resolveVoieForStop({
            voiesMap: voies,
            stopName,
            baseTimeRaw,
            timeCandidates: voieTimeCandidates,
            mode: 'dep',
            preferStationResolver: !allowCflFallback
          });
        }

        if (!voieLabel && allowCflFallback && typeof resolveCflVoieForStop === 'function') {
          voieLabel = resolveCflVoieForStop({ voiesMap: cflVoies || voies, stopName });
        }

        if (!voieLabel && preferCflVoie && typeof resolveVoieForStop === 'function') {
          voieLabel = resolveVoieForStop({
            voiesMap: voies,
            stopName,
            baseTimeRaw,
            timeCandidates: voieTimeCandidates,
            mode: 'dep',
            preferStationResolver: !allowCflFallback
          });
        }

        updateCellVoie(cell, baseTimeRaw, voieLabel);
      }
    }
  }

  let liveApplyInProgress = false;
  let liveApplyScheduled = false;

  function applyLiveOverlaysNow(){
    if (liveApplyInProgress) return;
    liveApplyInProgress = true;
    try {
      try { if (typeof tryApplyGtfsToCurrentTable === 'function') tryApplyGtfsToCurrentTable(); } catch(_){}
      try { updateVoiesInTable(); } catch(_){}
    } finally {
      liveApplyInProgress = false;
    }
  }

  function scheduleLiveApply(){
    if (liveApplyScheduled) return;
    liveApplyScheduled = true;
    requestAnimationFrame(() => {
      liveApplyScheduled = false;
      applyLiveOverlaysNow();
    });
  }

  async function tickRetards(){
    if (retardsInFlight || !canLiveRetards()) return;
    retardsInFlight = true;
    try {
      if (typeof loadGtfsRetards === 'function') {
        // Force un fetch live à intervalle court, sans attendre un refresh manuel.
        await loadGtfsRetards({ forceFresh: true, useCachedFirst: false });
      }

      // Sécurité: met à jour explicitement le trafic Home même si l'event custom est raté.
      try {
        if (typeof __lbUpdateHomeTrafficUI === 'function' && window.retardsGTFS_RAW) {
          __lbUpdateHomeTrafficUI({
            rawByDataset: window.retardsGTFS_RAW?.['sncf-nml'] ? window.retardsGTFS_RAW : null,
            raw: window.retardsGTFS_RAW
          });
        }
      } catch(_){}

      scheduleLiveApply();
    } catch(e){} finally {
      retardsInFlight = false;
    }
  }

  async function tickVoies(){
    if (voiesInFlight || !canLiveVoies()) return;
    voiesInFlight = true;
    try {
      if (typeof loadVoiesByTrain !== 'function') return;

      const prevSig = window.__voiesSig || null;
      // Recharge léger: onlyIfChanged -> si identique, pas de rebuild Map
      await loadVoiesByTrain({ forceFresh: false, onlyIfChanged: true });
      const now = Date.now();
      if (typeof loadCflVoiesByTrain === 'function') {
        if (!window.__lastCflVoiesRefresh || (now - window.__lastCflVoiesRefresh) > 120000) {
          await loadCflVoiesByTrain({ forceFresh: false });
          window.__lastCflVoiesRefresh = now;
        }
      }
      const changed = !!window.__voiesLastChanged || (!!window.__voiesSig && window.__voiesSig !== prevSig);

      // Si un tableau est affiché, mise à jour in-place des voies (même sans changement déclaré,
      // utile après une génération de tableau pour appliquer les dernières voies en mémoire).
      if (!hasTrainTable()) return;
      if (window.__mainTableBusy) return;

      if (changed || document.querySelector('#trainInfo table td[data-base-time]')) {
        scheduleLiveApply();
      }

      // Met aussi à jour les favoris (ils affichent des voies)
      if (typeof window.updateFavoriteWidgetFromPrefs === 'function') {
        window.updateFavoriteWidgetFromPrefs().catch(() => {});
      }
    } catch(e){} finally {
      voiesInFlight = false;
    }
  }

  function start(){
    if (!tRetards) tRetards = setInterval(() => { tickRetards().catch(()=>{}); }, RETARDS_MS);
    if (!tVoies)   tVoies   = setInterval(() => { tickVoies().catch(()=>{}); }, VOIES_MS);
  }

  window.__lbLiveTableDebug = {
    tickRetards: () => tickRetards(),
    tickVoies: () => tickVoies(),
    applyNow: () => applyLiveOverlaysNow(),
    isRunning: () => ({ retards: !!tRetards, voies: !!tVoies, retardsMs: RETARDS_MS, voiesMs: VOIES_MS })
  };

  function stop(){
    if (tRetards){ clearInterval(tRetards); tRetards = null; }
    if (tVoies){   clearInterval(tVoies);   tVoies   = null; }
  }

  const tableHost = document.getElementById('trainInfo');
  let mo = null;

  function armTableObserver(){
    if (!tableHost || mo) return;
    mo = new MutationObserver(() => {
      // Dès qu'un tableau est (re)injecté, on applique instantanément les dernières voies/retards.
      scheduleLiveApply();
    });
    mo.observe(tableHost, { childList: true, subtree: false });
  }

  function bootLiveUpdates(){
    start();
    armTableObserver();
    // 1ère synchro immédiate
    tickRetards().catch(()=>{});
    tickVoies().catch(()=>{});
  }

  if (document.readyState === 'complete') {
    bootLiveUpdates();
  } else {
    window.addEventListener('load', bootLiveUpdates, { once: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (navigator.onLine) {
      start();
      tickRetards().catch(()=>{});
      tickVoies().catch(()=>{});
    }
  });
  window.addEventListener('offline', stop, { passive:true });
  window.addEventListener('online', () => {
    if (document.hidden) return;
    start();
    tickRetards().catch(()=>{});
    tickVoies().catch(()=>{});
  }, { passive:true });
})();

// Navigation: scroll "app" /* ===== Home dashboard (météo + BER) ===== */

const LB_WX_STATION_COORDS = {
  "Metz": { label:"Metz", lat:49.1193, lon:6.1757 },
  "Luxembourg": { label:"Luxembourg", lat:49.6116, lon:6.1319 },
  "Nancy": { label:"Nancy", lat:48.6921, lon:6.1844 },
  "Thionville": { label:"Thionville", lat:49.3599, lon:6.1680 },
  "Hagondange": { label:"Hagondange", lat:49.2526, lon:6.1639 },
  "Uckange": { label:"Uckange", lat:49.3026, lon:6.1496 }
};

function lbGetWxPrefLocal(){
  try{
    const raw = localStorage.getItem("lb_wx_prefs");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.from || !obj.to) return null;
    return { from: String(obj.from||"").trim(), to: String(obj.to||"").trim() };
  }catch(e){ return null; }
}

function lbSetWxPrefLocal(fromName, toName){
  try{
    localStorage.setItem("lb_wx_prefs", JSON.stringify({ from: fromName, to: toName }));
  }catch(e){}
}

function resolveWxStation(name, fallback){
  const key = String(name||"").trim();
  return LB_WX_STATION_COORDS[key] || fallback;
}

function fmtTemp(t){
  if (t === null || t === undefined || Number.isNaN(Number(t))) return '—';
  return `${Math.round(Number(t))}°`;
}
function fmtWind(w){
  if (w === null || w === undefined || Number.isNaN(Number(w))) return '—';
  return `${Math.round(Number(w))} km/h`;
}
function fmtPct(p){
  if (p === null || p === undefined || Number.isNaN(Number(p))) return '—';
  return `${Math.round(Number(p))}%`;
}
function wxCodeToEmoji(code){
  const c = Number(code);
  if (!Number.isFinite(c)) return '🌡️';
  // Mapping Open-Meteo weather_code (simplifié)
  if (c === 0) return '☀️';
  if (c === 1 || c === 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if ([51,53,55,56,57].includes(c)) return '🌦️';
  if ([61,63,65,66,67,80,81,82].includes(c)) return '🌧️';
  if ([71,73,75,77,85,86].includes(c)) return '🌨️';
  if ([95,96,99].includes(c)) return '⛈️';
  return '🌡️';
}

function computeBerRisk({ rainProb, windKmh }){
  const rp = Number(rainProb);
  const w = Number(windKmh);
  let score = 0;
  if (Number.isFinite(rp)) score += Math.min(3, rp/33);        // 0..3
  if (Number.isFinite(w)) score += Math.min(3, w/25);          // 0..3
  // score ~0..6
  if (score < 2.0) return { label: 'Faible', icon: '🟢', hint: 'RAS (pour une fois)' };
  if (score < 4.0) return { label: 'Moyen', icon: '🟠', hint: 'Surveillez les PN et les ralentissements' };
  return { label: 'Élevé', icon: '🔴', hint: 'PN sensibles + galère probable' };
}

async function fetchOpenMeteo(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&forecast_days=1&timezone=Europe%2FLuxembourg`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Meteo HTTP ${r.status}`);
  return r.json();
}

function pickNextHourIndex(hourlyTimes){
  try{
    const now = new Date();
    const next = new Date(now.getTime() + 60*60*1000);
    // match by YYYY-MM-DDTHH:00
    const iso = next.toISOString().slice(0,13) + ':00';
    const idx = (hourlyTimes || []).findIndex(t => String(t).startsWith(iso));
    return idx >= 0 ? idx : Math.min((hourlyTimes||[]).length-1, 1);
  }catch(e){
    return 1;
  }
}

async function updateHomeWeather(fromCfg, toCfg){
  const $ = (id)=>document.getElementById(id);
  const riskEl = $('homeWxRisk');
  const fromTitleEl = $('homeWxFromTitle');
  const toTitleEl = $('homeWxToTitle');
  const fromNowEl = $('homeWxFromNow');
  const toNowEl = $('homeWxToNow');
  if (!fromTitleEl || !toTitleEl || !fromNowEl || !toNowEl){
    return;
  }
  try{
    fromTitleEl.textContent = `${fromCfg.label}`;
    toTitleEl.textContent = `${toCfg.label}`;

    const [a,b] = await Promise.all([
      fetchOpenMeteo(fromCfg.lat, fromCfg.lon),
      fetchOpenMeteo(toCfg.lat, toCfg.lon),
    ]);

    function renderOne(prefix, data){
      const curT = data?.current?.temperature_2m;
      const curW = data?.current?.wind_speed_10m;
      const curCode = data?.current?.weather_code;
      const emoji = wxCodeToEmoji(curCode);
      const curIdx = pickNextHourIndex(data?.hourly?.time || []);
      const curP = data?.hourly?.precipitation_probability?.[Math.max(0, curIdx-1)] ?? data?.hourly?.precipitation_probability?.[0];
      const nowHtml = `
        <span class="wx-main">
          <span class="wx-icon">${emoji}</span>
          <span class="wx-temp">${fmtTemp(curT)}</span>
        </span>
        <span class="wx-details">💧 ${fmtPct(curP)} · 💨 ${fmtWind(curW)}</span>
      `;
      const nowEl = $(prefix+'Now');
      if (nowEl) nowEl.innerHTML = nowHtml;

      return { rainProb: curP, windKmh: curW };
    }

    const r1 = renderOne('homeWxFrom', a);
    const r2 = renderOne('homeWxTo', b);

    // Risque BER = max des 2 points (simple et efficace)
    const risk1 = computeBerRisk(r1);
    const risk2 = computeBerRisk(r2);
    const pick = (risk1.label === 'Élevé' || risk2.label === 'Élevé') ? (risk1.label==='Élevé'?risk1:risk2)
               : (risk1.label === 'Moyen' || risk2.label === 'Moyen') ? (risk1.label==='Moyen'?risk1:risk2)
               : risk1;
    riskEl.textContent = `⚠️ Risque BER : ${pick.icon} ${pick.label} — ${pick.hint}`;
  }catch(e){
    if (riskEl) riskEl.textContent = '⚠️ Risque BER : — (météo indisponible)';
  }
}
/* ===== HOME : état du trafic (minimal, style BER) =====
   Source: GTFS-RT retards_nancymetzlux.json (proxy VPS)
   Affichage: uniquement un état (FLUIDE / DENSE / BLOQUÉ) + une phrase courte.
*/
function __lbPickTrafficLevel({ maxDelayMin, delayed, total, partialCount, canceledStopsInSegment }){
  const d = Math.max(0, Number(delayed || 0));
  const t = Math.max(0, Number(total || 0));
  const mx = Math.max(0, Number(maxDelayMin || 0));
  const partial = Math.max(0, Number(partialCount || 0));
  const canceledStops = Math.max(0, Number(canceledStopsInSegment || 0));

  if (!t) return { level: 'loading', label: 'Données indisponibles' };

  const pct = t ? (d / t) : 0;

  // Suppression partielle: impact immédiat sur le segment concerné,
  // même si les minutes de retard restent faibles.
  if (partial > 0) {
    if (partial >= 2 || canceledStops >= 4) return { level: 'red', label: 'Trafic très perturbé' };
    return { level: 'orange', label: 'Trafic perturbé' };
  }

  if (mx <= 0 || d <= 0) return { level: 'green', label: 'Trafic fluide' };

  // Retards légers (<= 5 min) = trafic ralenti, même s'il y a plusieurs trains.
  if (mx <= 5) return { level: 'yellow', label: 'Trafic ralenti' };

  // Prend en compte la gravité minute + volume de trains retardés.
  const severeMinutes = mx >= 20;
  const highShare = pct >= 0.5;
  const manyDelayed = d >= 6;
  if (severeMinutes && (highShare || d >= 4)) return { level: 'red', label: 'Trafic très perturbé' };
  if (highShare && manyDelayed) return { level: 'red', label: 'Trafic très perturbé' };

  if (mx >= 12 || pct >= 0.25 || d >= 3) return { level: 'orange', label: 'Trafic perturbé' };
  return { level: 'orange', label: 'Trafic perturbé' };
}

function __lbBuildTrafficSegmentStats(raw, segmentStationNames){
  const trainsObj = raw?.trains || raw?.normalized?.trains || raw?.['sncf-nml']?.trains || null;
  if (!trainsObj || typeof trainsObj !== 'object') {
    return { maxDelayMin: 0, delayed: 0, total: 0, partialCount: 0, canceledStopsInSegment: 0 };
  }

  const norm = (x) => {
    try { return normalizeStationName ? normalizeStationName(x || '') : String(x || '').toLowerCase().trim(); }
    catch(_) { return String(x || '').toLowerCase().trim(); }
  };

  const stationSet = new Set((segmentStationNames || []).map(norm).filter(Boolean));
  let total = 0;
  let delayed = 0;
  let maxDelayMin = 0;
  let partialCount = 0;
  let canceledStopsInSegment = 0;

  for (const tr of Object.values(trainsObj)) {
    const stops = tr?.stops || {};
    const canceledStops = Array.isArray(tr?.canceled_stops) ? tr.canceled_stops : (Array.isArray(tr?.canceledStops) ? tr.canceledStops : []);
    const statusRaw = String(tr?.status || '').toUpperCase();

    let touchesSegment = false;
    let trSegMax = 0;
    let canceledHits = 0;

    for (const [stopName, delayVal] of Object.entries(stops)) {
      const stopNorm = norm(stopName);
      if (!stationSet.has(stopNorm)) continue;
      touchesSegment = true;
      const n = Number(delayVal);
      if (Number.isFinite(n) && n > trSegMax) trSegMax = n;
    }

    for (const stopName of canceledStops) {
      if (!stationSet.has(norm(stopName))) continue;
      touchesSegment = true;
      canceledHits += 1;
    }

    if (!touchesSegment) continue;

    total += 1;
    if (trSegMax > 0) delayed += 1;
    if (trSegMax > maxDelayMin) maxDelayMin = trSegMax;

    const isPartial = statusRaw.includes('PARTIAL');
    // N'impacte le segment que si des arrêts de CE segment sont réellement supprimés.
    // Si la source ne fournit pas canceled_stops, on garde un fallback prudent.
    const hasCanceledList = canceledStops.length > 0;
    if (isPartial && (canceledHits > 0 || !hasCanceledList)) {
      partialCount += 1;
      canceledStopsInSegment += canceledHits;
    }
  }

  return { maxDelayMin, delayed, total, partialCount, canceledStopsInSegment };
}

function __lbSetTrafficBadge(el, status){
  if (!el) return;
  const level = status?.level || 'loading';
  el.classList.remove('traffic-pill--loading', 'traffic-pill--green', 'traffic-pill--yellow', 'traffic-pill--orange', 'traffic-pill--red');
  el.classList.add(`traffic-pill--${level}`);
  el.textContent = status?.label || 'Données indisponibles';
  const row = el.closest('.traffic-split-row');
  if (row) {
    row.dataset.trafficLevel = level;
    row.classList.remove('traffic-row--loading', 'traffic-row--green', 'traffic-row--yellow', 'traffic-row--orange', 'traffic-row--red');
    row.classList.add(`traffic-row--${level}`);
    row.setAttribute('aria-label', `${row.querySelector('.traffic-split-line')?.textContent || 'Segment'} : ${el.textContent}`);
  }
}

function __lbUpdateHomeTrafficUI(payload){
  const lineNorth = document.getElementById('homeTrafficLineNorth');
  const lineSouth = document.getElementById('homeTrafficLineSouth');
  const badgeNorth = document.getElementById('homeTrafficBadgeNorth');
  const badgeSouth = document.getElementById('homeTrafficBadgeSouth');
  if (!lineNorth || !lineSouth || !badgeNorth || !badgeSouth) return;

  lineNorth.textContent = 'Metz - Lux';
  lineSouth.textContent = 'Nancy - Metz';

  const raw = payload?.rawByDataset?.['sncf-nml'] || payload?.rawByDataset?.sncfNml || payload?.raw || payload;

  // Metz est volontairement EXCLU des 2 segments pour éviter le chevauchement
  // des retards sur la gare frontière quand un train traverse les 2 zones.
  const segNorth = __lbBuildTrafficSegmentStats(raw, ['Hagondange', 'Uckange', 'Thionville', 'Hettange-Grande', 'Bettembourg', 'Luxembourg']);
  const segSouth = __lbBuildTrafficSegmentStats(raw, ['Nancy', 'Frouard', 'Pompey', 'Belleville', 'Dieulouard', 'Pont-à-Mousson', 'Vandières', 'Pagny-sur-Moselle', 'Novéant-sur-Moselle', 'Ancy-sur-Moselle', 'Ars-sur-Moselle']);

  const n = __lbPickTrafficLevel(segNorth);
  const s = __lbPickTrafficLevel(segSouth);

  __lbSetTrafficBadge(badgeNorth, n);
  __lbSetTrafficBadge(badgeSouth, s);
}

async function updateHomeTrafficStatus(){
  let hadImmediateData = false;

  try{
    if (window.retardsGTFS_RAW){
      __lbUpdateHomeTrafficUI({
        rawByDataset: window.retardsGTFS_RAW?.['sncf-nml'] ? window.retardsGTFS_RAW : null,
        raw: window.retardsGTFS_RAW
      });
      hadImmediateData = true;
    }
  }catch(_){}

  try{
    const dataset = (window.GTFS_RT_DATASETS || []).find(d => d.id === 'sncf-nml');
    if (!dataset) throw new Error('Dataset sncf-nml introuvable');
    const result = await fetchGtfsDataset(dataset, { forceFresh: false });
    __lbUpdateHomeTrafficUI({ raw: result?.raw, normalized: result?.normalized });
  }catch(e){
    if (hadImmediateData) return;
    const lineNorth = document.getElementById('homeTrafficLineNorth');
    const lineSouth = document.getElementById('homeTrafficLineSouth');
    const badgeNorth = document.getElementById('homeTrafficBadgeNorth');
    const badgeSouth = document.getElementById('homeTrafficBadgeSouth');
    if (lineNorth) lineNorth.textContent = 'Metz - Lux';
    if (lineSouth) lineSouth.textContent = 'Nancy - Metz';
    __lbSetTrafficBadge(badgeNorth, { level:'loading', label:'Chargement…' });
    __lbSetTrafficBadge(badgeSouth, { level:'loading', label:'Chargement…' });
  }
}

// Branchements: après chargement GTFS-RT et au load
window.addEventListener('gtfsrt:loaded', (ev)=>{
  // évite de faire une double logique: on exploite les rawByDataset si dispo
  try{
    const detail = ev?.detail || {};
    const rawByDataset = detail.rawByDataset || {};
    if (rawByDataset && rawByDataset['sncf-nml']){
      __lbUpdateHomeTrafficUI({ raw: rawByDataset['sncf-nml'] });
    }else if (detail.data){
      __lbUpdateHomeTrafficUI({ raw: detail.data });
    }
  }catch{}
});
window.addEventListener('load', ()=>{
  // un petit update immédiat (ne casse rien si GTFS pas encore prêt)
  setTimeout(()=>{ updateHomeTrafficStatus(); }, 400);
});



// Bingo phrases (fallback local) — déterministe par date
const HOME_BER_BINGO = [
  "Le lundi, c’est conditions de départs non réunies.",
  "Le vendredi, c’est panne de PN.",
  "Aujourd’hui, c’est “incident d’exploitation” (ça change).",
  "Votre train est bien parti… dans une timeline alternative.",
  "La science-fiction progresse plus vite que la régularité.",
  "On n’est pas en retard : on explore la notion du temps.",
  "Ceci n’est pas un retard, c’est un DLC.",
  "Prochain arrêt : patience (voie indéterminée).",
  "Le #BER : là où le direct devient un concept.",
  "Bienvenue à bord : prière de garder vos miracles sur vous."
];

function pickBingoForDate(dateStr){
  const s = String(dateStr || '');
  let h = 0;
  for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  const idx = Math.abs(h) % HOME_BER_BINGO.length;
  return HOME_BER_BINGO[idx];
}

// API optionnelle (override admin + contexte réel)
async function fetchBerDailyMessage(dateStr){
  // Tu peux implémenter cet endpoint sur ton VPS (public) :
  // GET /api/ber/daily?date=YYYY-MM-DD  -> { text, context }
  const url = `/api/ber/daily?date=${encodeURIComponent(dateStr)}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`BER daily HTTP ${r.status}`);
  return r.json();
}

function updateHomePunctuality(pct, label){
  const num = Number(pct);
  if (!Number.isFinite(num)) return false;

  const safePct = Math.max(0, Math.min(100, num));
  ['homeBerPunctuality', 'homeWxPunctuality'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtPct(safePct);
  });

  window.__LB_LAST_YESTERDAY_PCT = safePct;
  if (label) window.__LB_LAST_YESTERDAY_LABEL = label;
  if (label) window.__LB_LAST_YESTERDAY_DATE = label;
  return true;
}


// --- Ponctualité "hier" pour l'accueil (PUBLIC) ---
const __LB_YESTERDAY_CACHE_KEY = 'lb_home_yesterday_punctuality_v1';
function __lbReadYesterdayPunctualityCache(){
  try{
    const raw = localStorage.getItem(__LB_YESTERDAY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const pct = Number(parsed?.pct);
    const date = String(parsed?.date || '').trim();
    if (!date || !Number.isFinite(pct)) return null;
    return {
      date,
      label: String(parsed?.label || date),
      pct: Math.max(0, Math.min(100, pct))
    };
  }catch(e){
    return null;
  }
}
function __lbWriteYesterdayPunctualityCache(date, pct, label){
  try{
    const num = Number(pct);
    if (!date || !Number.isFinite(num)) return;
    localStorage.setItem(__LB_YESTERDAY_CACHE_KEY, JSON.stringify({
      date: String(date),
      label: String(label || date),
      pct: Math.max(0, Math.min(100, num)),
      savedAt: Date.now()
    }));
  }catch(e){}
}
function __luxTodayISO(){
  try{
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Luxembourg', year:'numeric', month:'2-digit', day:'2-digit' });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }catch(e){
    return new Date().toISOString().slice(0,10);
  }
}
function __luxYesterdayISO(){
  try{
    const t = __luxTodayISO();
    const d = new Date(t+"T12:00:00Z");
    const y = new Date(d.getTime() - 86400000);
    return y.toISOString().slice(0,10);
  }catch(e){
    return new Date(Date.now()-86400000).toISOString().slice(0,10);
  }
}
async function ensureYesterdayPunctuality(){
  const want = __luxYesterdayISO();
  const cached = __lbReadYesterdayPunctualityCache();

  if (window.__LB_LAST_YESTERDAY_DATE === want && Number.isFinite(Number(window.__LB_LAST_YESTERDAY_PCT))) {
    updateHomePunctuality(window.__LB_LAST_YESTERDAY_PCT, window.__LB_LAST_YESTERDAY_LABEL || want);
    return Number(window.__LB_LAST_YESTERDAY_PCT);
  }

  if (cached?.date === want && Number.isFinite(Number(cached.pct))) {
    window.__LB_LAST_YESTERDAY_DATE = cached.date;
    window.__LB_LAST_YESTERDAY_PCT = cached.pct;
    window.__LB_LAST_YESTERDAY_LABEL = cached.label || cached.date;
    updateHomePunctuality(cached.pct, cached.label || cached.date);
  } else {
    ['homeBerPunctuality', 'homeWxPunctuality'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && (!el.textContent || /^[-–—.\s%]*$/.test(el.textContent))) el.textContent = '…';
    });
  }

  try{
    let dayData = null;
    if (typeof loadDayAPI === 'function'){
      dayData = await loadDayAPI(want);
    }else if (typeof apiFetch === 'function'){
      dayData = await apiFetch(`/api/stats/gtfs/day?date=${encodeURIComponent(want)}`);
    }else{
      const r = await fetch(`/api/stats/gtfs/day?date=${encodeURIComponent(want)}`, { cache:'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dayData = await r.json();
    }

    const dayTotal   = Number(dayData?.total_trains || 0);
    const pctNot = (dayData?.pct_not_on_time != null) ? Number(dayData.pct_not_on_time) : null;
    let pct = null;
    if (pctNot != null && Number.isFinite(pctNot)) {
      pct = 100 - pctNot;
    } else {
      const dayDelayed = Number(dayData?.delayed_trains || 0);
      const dayCanceled= Number(dayData?.canceled_trains || 0);
      const dayPartial = Number(dayData?.partial_canceled_trains || 0);
      const dayOnTime  = Math.max(0, dayTotal - dayDelayed - dayCanceled - dayPartial);
      pct = dayTotal ? (dayOnTime / dayTotal) * 100 : 0;
    }

    if (!Number.isFinite(Number(pct))) throw new Error('Ponctualité hier invalide');

    pct = Math.max(0, Math.min(100, Number(pct)));
    window.__LB_LAST_YESTERDAY_DATE = want;
    window.__LB_LAST_YESTERDAY_PCT = pct;
    window.__LB_LAST_YESTERDAY_LABEL = want;
    __lbWriteYesterdayPunctualityCache(want, pct, want);

    updateHomePunctuality(pct, want);
    return pct;
  }catch(e){
    const fallbackPct = Number(window.__LB_LAST_YESTERDAY_PCT);
    if (window.__LB_LAST_YESTERDAY_DATE === want && Number.isFinite(fallbackPct)) {
      updateHomePunctuality(fallbackPct, window.__LB_LAST_YESTERDAY_LABEL || want);
      return fallbackPct;
    }
    if (cached?.date === want && Number.isFinite(Number(cached.pct))) {
      updateHomePunctuality(cached.pct, cached.label || cached.date);
      return Number(cached.pct);
    }
    ['homeBerPunctuality', 'homeWxPunctuality'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    return null;
  }
}

async function updateHomeBerBlock(){
  const line1 = document.getElementById('homeBerLine1');
  const ctx = document.getElementById('homeBerContext');
  const today = new Date();
  const d = today.toISOString().slice(0,10);

  // phrase du jour
  let text = pickBingoForDate(d);
  let context = '';
  try{
    const payload = await fetchBerDailyMessage(d);
    if (payload && typeof payload.text === 'string' && payload.text.trim()) text = payload.text.trim();
    if (payload && typeof payload.context === 'string' && payload.context.trim()) context = payload.context.trim();
  }catch(e){ /* fallback local */ }

  if (line1) line1.textContent = text;
  if (ctx){
    if (context){
      ctx.style.display = 'block';
      ctx.textContent = `🚧 ${context}`;
    }else{
      ctx.style.display = 'none';
      ctx.textContent = '';
    }
  }

  // ponctualité moyenne J-1 → J-30 (publique)
  try{
    if (typeof window.__LB_LAST_30D_PCT === 'number') updateHomePunctuality(window.__LB_LAST_30D_PCT, window.__LB_LAST_30D_KEY || '30d');
    else if (typeof window.ensure30DayPunctuality === 'function') await window.ensure30DayPunctuality();
  }catch(e){}
}

function bindWxLocalSave(){
  const btn = document.getElementById('lbWxSaveLocal');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const fromName = (document.getElementById('lbWxFromStation')?.value || 'Metz').trim() || 'Metz';
    const toName   = (document.getElementById('lbWxToStation')?.value || 'Luxembourg').trim() || 'Luxembourg';
    lbSetWxPrefLocal(fromName, toName);
    const wx = getUserWxPrefsOrDefault();
    updateHomeWeather(wx.from, wx.to).catch(()=>{});
  });
}


function lbRenderHomeFavPreview(){
  const slot = document.getElementById('homeFavSlot');
  if (!slot) return;

  // lecture des infos déjà calculées par le widget favoris (AM/PM)
  const read = (k) => {
    const trainEl = document.getElementById('favTrain'+k);
    const train = (trainEl?.textContent || '').trim();
    const trainNumber = (trainEl?.dataset?.trainId || '').trim();
    const metaEl = document.getElementById('favMeta'+k);
    const meta  = (metaEl?.textContent || '').trim();
    const state = (document.getElementById('favState'+k)?.textContent || '').trim();
    const routeRaw = (metaEl?.querySelector('.fav-primary-route')?.textContent || '').trim();
    const routeMatch = routeRaw.match(/^(.+?)\s*→\s*(.+)$/);
    const routeFrom = routeMatch ? routeMatch[1].trim() : '';
    const routeTo = routeMatch ? routeMatch[2].trim() : '';

    const readTimePart = (partEl) => {
      if (!partEl) return { planned: '—', live: null, canceled: false };
      const planned = (partEl.querySelector('.fav-time-planned')?.textContent || '').trim() || '—';
      const live = (partEl.querySelector('.fav-time-rt.delay')?.textContent || '').trim() || null;
      const canceled = partEl.classList.contains('is-canceled')
        || !!partEl.querySelector('.fav-time.deleted, .fav-time-rt.deleted-label');
      return { planned, live, canceled };
    };
    const timeParts = Array.from(metaEl?.querySelectorAll('.fav-primary-times .fav-time-part') || []);
    const depPart = readTimePart(timeParts[0]);
    const arrPart = readTimePart(timeParts[1]);

    return {
      train,
      meta,
      state,
      routeFrom,
      routeTo,
      plannedDep: depPart.planned,
      liveDep: depPart.live,
      canceledDep: depPart.canceled,
      plannedArr: arrPart.planned,
      liveArr: arrPart.live,
      canceledArr: arrPart.canceled,
      trainNumber
    };
  };

  const am = read('AM');
  const pm = read('PM');

  const toStateKey = (txt) => {
    const t = (txt || '').toUpperCase();
    if (t.includes('ARRIV')) return 'after';
    if (t.includes('LIVE') || t.includes('EN COURS') || t.includes('EN ROUTE')) return 'running';
    if (t.includes('A VENIR') || t.includes('PROCHAIN') || t.includes('AVENIR')) return 'before';
    return 'unknown';
  };

  const renderBadge = (stateTxt) => {
    const key = toStateKey(stateTxt);
    try{
      if (typeof buildWidgetStateBadge === 'function') return buildWidgetStateBadge(key);
    }catch(e){}
    const label = (key === 'after') ? 'ARRIVÉ' : (key === 'running') ? 'LIVE' : (key === 'before') ? 'A VENIR' : '—';
    return `<span class="fav-state-badge fav-state-${key}">${escapeHtml(label)}</span>`;
  };

  const compactStationLabel = (name) => {
    const base = String(name || '').trim();
    if (!base) return '';
    const map = {
      'Luxembourg': 'Lux',
      'Thionville': 'Thionv.',
      'Hettange-Grande': 'Hettange',
      'Pont-à-Mousson': 'PAM',
      'Maizières-lès-Metz': 'Maizières',
      'Pagny-sur-Moselle': 'Pagny'
    };
    return map[base] || base;
  };

  const parseFavMeta = (metaTxt, structuredMeta) => {
    if (structuredMeta && (structuredMeta.routeFrom || structuredMeta.routeTo || structuredMeta.plannedDep !== '—' || structuredMeta.plannedArr !== '—')) {
      const routeFrom = compactStationLabel(structuredMeta.routeFrom || '');
      const routeTo = compactStationLabel(structuredMeta.routeTo || '');
      const route = (routeFrom && routeTo) ? `${routeFrom} → ${routeTo}` : (routeFrom || routeTo || '—');
      const canceledService = /SUPPRIM/i.test(structuredMeta.state || '');
      const renderTimePart = (planned, live, canceled) => {
        if (canceled || canceledService) {
          return `<span class="home-fav-time-part is-canceled"><span class="home-fav-time-planned is-strike">${planned || '—'}</span></span>`;
        }
        if (live && live !== planned) {
          return `<span class="home-fav-time-part is-delayed"><span class="home-fav-time-planned is-strike">${planned}</span><span class="home-fav-time-live">${live}</span></span>`;
        }
        return `<span class="home-fav-time-part"><span class="home-fav-time-planned">${planned || '—'}</span></span>`;
      };
      const timeHtml = `${renderTimePart(structuredMeta.plannedDep || '—', structuredMeta.liveDep, structuredMeta.canceledDep)} <span class="home-fav-time-sep">→</span> ${renderTimePart(structuredMeta.plannedArr || '—', structuredMeta.liveArr, structuredMeta.canceledArr)}`;
      return { route, timeHtml };
    }

    const raw = String(metaTxt || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { route: '—', timeHtml: '<span class="home-fav-time-planned">—</span>' };

    const timeMatches = Array.from(raw.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g))
      .map((m) => `${m[1].padStart(2,'0')}:${m[2]}`);
    let plannedDep = timeMatches[0] || '—';
    let liveDep = null;
    let plannedArr = timeMatches.length >= 2 ? timeMatches[timeMatches.length - 1] : '—';
    let liveArr = null;

    if (timeMatches.length >= 4) {
      plannedDep = timeMatches[0];
      liveDep = timeMatches[1];
      plannedArr = timeMatches[timeMatches.length - 2];
      liveArr = timeMatches[timeMatches.length - 1];
    } else if (timeMatches.length === 3) {
      plannedDep = timeMatches[0];
      liveDep = timeMatches[1];
      plannedArr = timeMatches[2];
    }

    const renderTimePart = (planned, live) => {
      if (live && live !== planned) {
        return `<span class="home-fav-time-part is-delayed"><span class="home-fav-time-planned is-strike">${planned}</span><span class="home-fav-time-live">${live}</span></span>`;
      }
      return `<span class="home-fav-time-part"><span class="home-fav-time-planned">${planned || '—'}</span></span>`;
    };
    const timeHtml = `${renderTimePart(plannedDep, liveDep)} <span class="home-fav-time-sep">→</span> ${renderTimePart(plannedArr, liveArr)}`;

    const stationCandidates = Array.isArray(garesParLigne)
      ? garesParLigne.map((g) => g && g.nom).filter(Boolean)
      : [];
    const found = stationCandidates
      .map((nom) => ({ nom, idx: raw.toLowerCase().indexOf(String(nom).toLowerCase()) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx);

    let route = '—';
    if (found.length >= 2) {
      const start = compactStationLabel(found[0].nom);
      const end = compactStationLabel(found[1].nom);
      route = `${start} → ${end}`;
    } else {
      const fallback = raw
        .replace(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      route = fallback || '—';
    }

    return { route, timeHtml };
  };

  const buildRow = (k, data, label) => {
    const trainTxt = data.train && data.train !== '—' ? data.train : '—';
    const metaTxt  = data.meta && data.meta !== '—' ? data.meta : '';
    const parsed = parseFavMeta(metaTxt, data);
	const trainParts = String(trainTxt).split(/\s+/).filter(Boolean);
    let trainNo = trainParts.length ? trainParts[0] : '—';
    let trainCompo = trainParts.length > 1 ? trainParts.slice(1).join(' ') : '';
    if (trainParts.length >= 2 && String(trainParts[0]).toUpperCase() === 'TER') {
      trainNo = `${trainParts[0]} ${trainParts[1]}`;
      trainCompo = trainParts.length > 2 ? trainParts.slice(2).join(' ') : '';
    }
    const trainNumberForCompo = String(data.trainNumber || '').trim() || String(trainNo || '').replace(/\D+/g, '');
    const compoBadge = (trainNumberForCompo && typeof window.buildFavTrainTypeBadge === 'function')
      ? window.buildFavTrainTypeBadge(trainNumberForCompo)
      : '';
    const compoDataReady = !!(window.compoData && Object.keys(window.compoData).length);
    const compoSlot = compoBadge || ((!compoDataReady && trainNumberForCompo)
      ? '<span class="home-fav-compo-loading" aria-hidden="true"><i></i></span>'
      : '');

    return `
      <div class="home-fav-row" data-fav-k="${k}" role="button" tabindex="0" aria-label="Ouvrir favoris ${label}">
        <div class="home-fav-head">
          <div class="home-fav-trainline">
            <span class="home-fav-train">
              <span class="home-fav-train-no">${escapeHtml(trainNo)}</span>
              ${trainCompo ? `<span class="home-fav-train-compo">${escapeHtml(trainCompo)}</span>` : ''}
            </span>
          </div>
          <div class="fav-train-badge home-fav-badge">${compoSlot}${renderBadge(data.state)}</div>
        </div>
        <div class="home-fav-route">${escapeHtml(parsed.route)}</div>
        <div class="home-fav-time">${parsed.timeHtml}</div>
      </div>
    `;
  };

  slot.innerHTML = buildRow('AM', am, 'Matin') + buildRow('PM', pm, 'Soir');

  const jumpToFav = (k) => {
    location.hash = '#favTrainsWidget';

    const getTopOffset = () => {
      try{
        const topBar = document.querySelector('.top-bar');
        if (topBar) return Math.round(topBar.getBoundingClientRect().height) + 8;
        const css = getComputedStyle(document.documentElement).getPropertyValue('--top-bar-height').trim();
        if (css && css.endsWith('px')) return (parseFloat(css) || 0) + 8;
      }catch(e){}
      return 72;
    };
    const getBottomOffset = () => {
      try{
        const bottom = document.querySelector('.bottom-nav');
        if (bottom) return Math.round(bottom.getBoundingClientRect().height) + 8;
        const css = getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-height').trim();
        if (css && css.endsWith('px')) return (parseFloat(css) || 0) + 8;
      }catch(e){}
      return 84;
    };

    window.setTimeout(() => {
      const id = (k === 'PM') ? 'favCardPM' : 'favCardAM';
      const card = document.getElementById(id);
      if (!card) return;

      const topOff = getTopOffset();
      const botOff = getBottomOffset();
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const visibleH = Math.max(120, vh - topOff - botOff);
      const rect = card.getBoundingClientRect();
      const absTop = rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
      const targetY = absTop - topOff - Math.max(0, (visibleH - rect.height) / 2);

      try{
        window.scrollTo({ top: Math.max(0, Math.round(targetY)), behavior: 'smooth' });
      }catch(e){
        window.scrollTo(0, Math.max(0, Math.round(targetY)));
      }

      card.classList.add('home-jump-highlight');
      window.setTimeout(()=>card.classList.remove('home-jump-highlight'), 1300);
    }, 80);
  };

  slot.querySelectorAll('.home-fav-row').forEach(row=>{
    const k = row.getAttribute('data-fav-k');
    row.addEventListener('click', ()=>jumpToFav(k));
    row.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); jumpToFav(k);} });
  });
}


function ensureFavInHome(){
  const slot = document.getElementById('homeFavSlot');
  const cta = document.getElementById('homeFavLoginCta');
  if (!slot) return;

  const authed = (window.lbIsAuthed === true);
  if (cta) cta.style.display = authed ? 'none' : 'block';

  if (!authed){
    slot.innerHTML = '';
    return;
  }

  // On garde le vrai widget dans la section Favoris, et on affiche ici un aperçu compact.
  try { lbRenderHomeFavPreview(); } catch(e) {}
}


function getDefaultWxStations(){
  // défaut public : Metz -> Luxembourg
  return {
    from: { label: 'Metz', lat: 49.1193, lon: 6.1757 },
    to:   { label: 'Luxembourg', lat: 49.6116, lon: 6.1319 }
  };
}

// Si connecté : on tentera de lire des préférences exposées (à brancher sur ton système de compte)
function getUserWxPrefsOrDefault(){
  const def = getDefaultWxStations();

  // 1) Source unique recommandée: gares favorites (départ/arrivée)
  try{
    const p = window.lbPrefsCache || null;
    const favFrom = (p?.favoriteFromStation || '').trim();
    const favTo   = (p?.favoriteToStation   || '').trim();
    if (favFrom || favTo){
      const fromCfg = resolveWxStation(favFrom || def.from.label, def.from);
      const toCfg   = resolveWxStation(favTo   || def.to.label,   def.to);
      return { from: fromCfg, to: toCfg, source: 'prefs.favoriteStations' };
    }
  }catch(e){}

  // 2) Compat: prefs compte weatherStations (anciens champs)
  try{
    const p = window.lbPrefsCache || null;
    const ws = p && p.weatherStations;
    if (ws && (ws.from || ws.to)){
      const fromCfg = resolveWxStation(ws.from || def.from.label, def.from);
      const toCfg   = resolveWxStation(ws.to   || def.to.label,   def.to);
      return { from: fromCfg, to: toCfg, source: 'prefs.weatherStations' };
    }
  }catch(e){}

  // 3) localStorage (fallback)
  try{
    const raw = localStorage.getItem('lb_weatherStations') || '';
    if (raw){
      const js = JSON.parse(raw);
      if (js && (js.from || js.to)){
        const fromCfg = resolveWxStation(js.from || def.from.label, def.from);
        const toCfg   = resolveWxStation(js.to   || def.to.label,   def.to);
        return { from: fromCfg, to: toCfg, source: 'localStorage' };
      }
    }
  }catch(e){}

  return { from: def.from, to: def.to, source: 'default' };
}

async function initHomePublicBlocks(){
  const prefs = getUserWxPrefsOrDefault();
  // météo (public) + ponctualité moyenne 30 jours (public) + bloc BER
  await Promise.all([
    updateHomeWeather(prefs.from, prefs.to),
    (typeof window.ensure30DayPunctuality === 'function' ? window.ensure30DayPunctuality() : Promise.resolve(null))
  ]);
  await updateHomeBerBlock();
}

// Lance au chargement + rafraîchit périodiquement la météo (soft)
document.addEventListener('DOMContentLoaded', () => {
  initHomePublicBlocks();
  setInterval(() => {
    if (document.hidden || !navigator.onLine) return;
    initHomePublicBlocks();
  }, 5*60*1000);
});




// (offset top-bar) — évite que la section soit cachée par la barre fixe
(function(){
  const TOP_SEL = '.top-bar';
  const getTopOffset = () => {
    const top = document.querySelector(TOP_SEL);
    const h = top ? top.getBoundingClientRect().height : 0;
    // petit gap visuel
    return Math.max(0, Math.round(h) + 10);
  };

  function scrollToEl(el){
    if (!el) return;
    const y = window.pageYOffset + el.getBoundingClientRect().top - getTopOffset();
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function handleAnchorClick(a){
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#') || href === '#') return false;
    const id = href.slice(1);
    const target = document.getElementById(id);
    if (!target) return false;
    scrollToEl(target);
    // met à jour l’URL sans recharger
    try { history.pushState(null, '', href); } catch(e){}
    return true;
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
	// La barre de navigation principale est pilotée par le routeur hash (1 onglet = 1 page)
    if (a.closest('.bottom-nav')) return;
    // On ne touche pas aux anchors "techniques" qui servent de toggles/handlers
    if (a.hasAttribute('data-no-smooth')) return;
    const ok = handleAnchorClick(a);
    if (ok) e.preventDefault();
  });

  // Si on arrive avec un hash (ex: /#statsConsole), on aligne correctement
  window.addEventListener('load', () => {
    const hash = location.hash || '';
    if (!hash.startsWith('#') || hash.length < 2) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    // laisse le layout se stabiliser
    setTimeout(() => scrollToEl(target), 0);
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  try{
    bindWxLocalSave();
    const wx = getUserWxPrefsOrDefault();
    updateHomeWeather(wx.from, wx.to).catch(()=>{});
    updateHomeBerBlock().catch(()=>{});
    ensureFavInHome();
  }catch(e){}
});

;

(function(){
  const DEFAULT_WX = { from: "Metz", to: "Luxembourg" };

  function getStoredWx(){
    try{
      const raw = localStorage.getItem("lb_weatherStations");
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.from && obj.to) return {from:String(obj.from), to:String(obj.to)};
    }catch(e){}
    return null;
  }

  function setStoredWx(v){
    try{ localStorage.setItem("lb_weatherStations", JSON.stringify(v)); }catch(e){}
  }

  function applyWxInputsFromStore(){
    const fromEl = document.getElementById("lbWxFromStation");
    const toEl = document.getElementById("lbWxToStation");
    if(!fromEl || !toEl) return;
    const v = getStoredWx() || DEFAULT_WX;
    fromEl.value = v.from;
    toEl.value = v.to;
  }

  function showHint(msg){
    const el = document.getElementById("lbWxSaveHint");
    if(!el) return;
    el.textContent = msg || "";
  }

  function notifyHomeWeatherRefresh(){
    // If your home-weather code listens to an event, we fire one.
    try{
      window.dispatchEvent(new CustomEvent("lb:weatherStationsChanged"));
    }catch(e){}
  }

  function wireWxButtons(){
    const fromEl = document.getElementById("lbWxFromStation");
    const toEl = document.getElementById("lbWxToStation");
    const saveBtn = document.getElementById("lbWxSaveLocalBtn");
    const resetBtn = document.getElementById("lbWxResetBtn");
    if(!fromEl || !toEl || !saveBtn || !resetBtn) return;

    saveBtn.addEventListener("click", ()=>{
      const v = { from: (fromEl.value||"").trim() || DEFAULT_WX.from,
                  to: (toEl.value||"").trim() || DEFAULT_WX.to };
      setStoredWx(v);
      showHint("✅ Enregistré");
      notifyHomeWeatherRefresh();
      setTimeout(()=>showHint(""), 1800);
    });

    resetBtn.addEventListener("click", ()=>{
      setStoredWx(DEFAULT_WX);
      applyWxInputsFromStore();
      showHint("↩️ Réinitialisé");
      notifyHomeWeatherRefresh();
      setTimeout(()=>showHint(""), 1800);
    });

    // instant feedback when user changes input (no auto-save)
    fromEl.addEventListener("change", ()=>showHint(""));
    toEl.addEventListener("change", ()=>showHint(""));
  }

  // Improve "Mes préférences" opening: after toggling open, scroll to the top of the section with offset.
  function patchPrefsOpenScroll(){
    // Try common triggers/containers
    const prefsRoot =
      document.getElementById("prefsSection") ||
      document.getElementById("prefsPanel") ||
      document.querySelector(".prefs-section") ||
      document.querySelector("[data-section='prefs']");
    if(!prefsRoot) return;

    // When any <details> inside opens, scroll to it
    prefsRoot.addEventListener("toggle", (e)=>{
      const t = e.target;
      if(t && t.tagName === "DETAILS" && t.open){
        setTimeout(()=>{
          try{
            t.scrollIntoView({behavior:"smooth", block:"start"});
            window.scrollBy(0, -72); // compensate fixed topbar
          }catch(err){}
        }, 0);
      }
    }, true);
  }

  // Init on DOM ready
  document.addEventListener("DOMContentLoaded", ()=>{
    applyWxInputsFromStore();
    wireWxButtons();
    patchPrefsOpenScroll();
  });

  // Expose a small helper for existing code (optional)
  window.lbGetWeatherStations = function(){
    return getStoredWx() || DEFAULT_WX;
  };})();

(function(){
  const navItems = document.querySelectorAll('.bottom-nav__item');
  if (!navItems.length) return;

  const release = (el) => el && el.classList.remove('is-pressed');

  navItems.forEach((item) => {
    item.addEventListener('pointerdown', () => {
      item.classList.add('is-pressed');
    }, { passive: true });

    item.addEventListener('pointerup', () => release(item), { passive: true });
    item.addEventListener('pointercancel', () => release(item), { passive: true });
    item.addEventListener('pointerleave', () => release(item), { passive: true });
    item.addEventListener('blur', () => release(item), { passive: true });
  });
})();

;

(function(){
  function patchConsoleOpenScroll(){
    const root = document.querySelector(".command-console");
    if(!root) return;
    root.addEventListener("toggle", (e)=>{
      const t = e.target;
      if(t && t.tagName === "DETAILS" && t.open){
        setTimeout(()=>{
          try{
            t.scrollIntoView({behavior:"smooth", block:"start"});
            window.scrollBy(0, -72);
          }catch(err){}
        }, 0);
      }
    }, true);
  }
  document.addEventListener("DOMContentLoaded", patchConsoleOpenScroll);
})();

;

(function(){
  const TOP_OFFSET = 72;
  document.addEventListener("toggle", (e)=>{
    const d = e.target;
    if(!d || d.tagName !== "DETAILS") return;
    if(d.open){
      setTimeout(()=>{
        try{
          d.scrollIntoView({behavior:"smooth", block:"start"});
          window.scrollBy(0, -TOP_OFFSET);
        }catch(err){}
      }, 0);
    }
  }, true);
})();

;

(function(){
  function setHeights(){
    const top = document.querySelector('.top-bar') || document.querySelector('.topbar') || document.querySelector('header');
    const bottom = document.querySelector('nav.bottom-nav') || document.querySelector('.bottom-nav');
    const topH = top ? Math.round(top.getBoundingClientRect().height) : 64;
    const botH = bottom ? Math.round(bottom.getBoundingClientRect().height) : 84;
    document.documentElement.style.setProperty('--lb-topbar-h', topH + 'px');
    document.documentElement.style.setProperty('--lb-bottomnav-h', botH + 'px');
  }
  window.addEventListener('resize', setHeights, {passive:true});
  document.addEventListener('DOMContentLoaded', setHeights);

  // When opening details, ensure the bottom sticky actions remain visible above nav
  document.addEventListener('toggle', (e)=>{
    const d = e.target;
    if(!d || d.tagName !== 'DETAILS' || !d.open) return;
    setTimeout(()=>{
      try{
        d.scrollIntoView({behavior:'smooth', block:'start'});
        window.scrollBy(0, -Math.max(72, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lb-topbar-h'))+8));
      }catch(err){}
    }, 0);
  }, true);
})();

;

(function(){
  // Ouvre toutes les sections "console" et supprime la logique d'onglets.
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('details.console-section').forEach(function(d){
      d.open = true;
    });
  });
})();

;

(function(){
  const VPS_BASE = 'https://vps.labetaillere.fr/affluence/detail';
  const $ = (id)=>document.getElementById(id);
  const affState = { data:null, byStation:new Map(), stations:[], currentTrain:'', currentStop:0, maxByTrain:new Map() };

  // Chart (évolution du train)
  let affEvoChart = null;


  const pctToColor = (p)=>p==null||!isFinite(p)?'#999':p<50?'#24c25a':p<70?'#ffd166':p<85?'#ff8a1a':p<95?'#ff3131':'#111';
  const hhmmToMin=(h)=>{const m=/^\s*(\d{1,2}):(\d{2})\s*$/.exec(h||'');return m?(+m[1])*60+(+m[2]):null;};
  const norm=(js)=>{if(!js||typeof js!=='object')return null;if(js.trains&&typeof js.trains==='object')return js;const ks=Object.keys(js);if(ks.some(k=>/^\d{5,6}$/.test(k)))return {date:js.date||'',trains:js};return null;};
  const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const affBandColor = { green:'#39f78c', yellow:'#ffd166', orange:'#ff8a3d', red:'#ff4d6d', black:'#111' };
  const pctToBand = (p)=>p==null||!isFinite(p)?'black':p<50?'green':p<70?'yellow':p<85?'orange':p<95?'red':'black';
  const normBand = (b,p)=>{ const x=String(b||'').toLowerCase(); return affBandColor[x] ? x : pctToBand(p); };
  const normalizeTrainTypeForSchema = (trainType)=>{
    return String(trainType || '').toUpperCase().trim().replace(/[\s-]+/g, '_');
  };
  function getWagonGroups(trainType, wagonCount){
    const count = Math.max(0, Number(wagonCount) || 0);
    const t = normalizeTrainTypeForSchema(trainType);
    if (t === 'US5') return [{ start: 0, count: Math.min(5, count || 5) }];
    if (t === 'UM_MIXTE' || t === 'UMMIXTE' || t === 'UMMIX') return [{ start: 0, count: 3 }, { start: 3, count: 5 }];
    if (t === 'UM3') return [{ start: 0, count: 3 }, { start: 3, count: 3 }, { start: 6, count: 3 }];
    if (t === 'UM') return [{ start: 0, count: 3 }, { start: 3, count: 3 }];
    return [{ start: 0, count: 3 }];
  }

  function wagonSchemaHtml(stop, trainType){
    const bands = Array.isArray(stop?.wagonBand) ? stop.wagonBand : [];
    const pcts  = Array.isArray(stop?.wagonPct)  ? stop.wagonPct  : [];
    if (!bands.length && !pcts.length) return '';

    const n = Math.max(bands.length, pcts.length);
    const t = normalizeTrainTypeForSchema(trainType || stop?.trainType || '');
    const isUnknown = (t === 'UNKNOWN' || t === 'UNK' || !t);

    const cls = 'affls-rame' + (isUnknown ? ' affls-unk' : '');
    let out = `<span class="${cls}" aria-label="schéma affluence">`;

    const wagonColor = (pct, band)=>{
      if (Number.isFinite(Number(pct))) return pctToColor(Number(pct));
      return affBandColor[normBand(band, null)] || '#999';
    };
    const wagonTextColor = (bg)=>{
      const hex = String(bg || '').trim();
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) return '#fff';
      const val = m[1];
      const r = parseInt(val.slice(0,2), 16);
      const g = parseInt(val.slice(2,4), 16);
      const b = parseInt(val.slice(4,6), 16);
      const luma = (0.299*r) + (0.587*g) + (0.114*b);
      return luma > 160 ? '#0b1118' : '#fff';
    };

    const groups = getWagonGroups(t, n);
    groups.forEach((group)=>{
      const startIdx = Math.max(0, Number(group?.start) || 0);
      const wantedCount = Math.max(1, Number(group?.count) || 0);
      const segCount = Math.max(1, Math.min(wantedCount, Math.max(0, n - startIdx)));
      out += `<span class="affls-unit" style="--seg-count:${segCount}">`;
      for (let i=0; i<segCount; i++){
        const idx = startIdx + i;
        const pct = pcts[idx];
        const band = bands[idx];
        const bgColor = wagonColor(pct, band);
        const fgColor = wagonTextColor(bgColor);
        const label = Number.isFinite(Number(pct)) ? (Math.round(Number(pct)) + '%') : '—';
        out += `<span><span class="affls-car" style="background:${bgColor}"></span><span class="affls-pct" style="color:${fgColor}">${label}</span></span>`;
      }
      out += '</span>';
    });

    out += '<span class="aff-arrow">▶</span></span>';
    return out;
  }

  function getAffluenceTrainInfo(trainNum, preferredStopIndex){
    const t = (affState.data?.trains||{})[String(trainNum||'')];
    if(!t) return null;
    const stops = Array.isArray(t.stops) ? t.stops : [];
    let idx = Number.isFinite(Number(preferredStopIndex)) ? Number(preferredStopIndex) : -1;
    if (idx < 0 || idx >= stops.length){
      idx = stops.reduce((best,s,i)=>{
        const p = Number(s?.globalPct ?? Math.round((Number(s?.globalOcc)||0)*100));
        const bp = Number(stops[best]?.globalPct ?? Math.round((Number(stops[best]?.globalOcc)||0)*100));
        return (!Number.isFinite(bp) || p>bp) ? i : best;
      }, 0);
    }
    const stop = stops[idx] || null;
    const maxPct = Number.isFinite(Number(t?.maxPct)) ? Number(t.maxPct) : null;
    const color = t?.color || affBandColor[normBand(t?.band, maxPct)] || pctToColor(maxPct);
    return {
      maxPct,
      color,
      stopLabel: stop ? `${stop.station||stop.name||''}${stop.hhmm?(' • '+stop.hhmm):''}` : '',
      schemaHtml: wagonSchemaHtml(stop, t?.trainType),
      stopPct: stop ? Number(stop.globalPct ?? Math.round((Number(stop.globalOcc)||0)*100)) : null
    };
  }
  window.getAffluenceTrainInfo = getAffluenceTrainInfo;
  window.wagonSchemaHtml = wagonSchemaHtml;

  function applyAffluenceDots(scope=document){
    const map = affState.maxByTrain || new Map();
    scope.querySelectorAll('#trainInfo th[data-train-number]').forEach(th=>{
      const raw = String(th.dataset.trainNumber||'');
      const num = (raw.match(/\d{5,6}/)||[])[0];
      let dot = th.querySelector('.affluence-dot');

	  if(!num || !map.has(num)){
        if(dot) dot.remove();
        return;
      }

      const x = map.get(num) || {};
      const pct = Number(x.maxPct);
      const bg = x.color || pctToColor(Number.isFinite(pct) ? pct : null);
      const title = `Affluence max prévue: ${Number.isFinite(pct) ? pct : '—'}%${x.peakStop?(' • '+x.peakStop):''}`;

      if(!dot){
        dot = document.createElement('span');
        dot.className='affluence-dot';
        const trainLink = th.querySelector('a.train-link');
        if (trainLink && trainLink.nextSibling) th.insertBefore(dot, trainLink.nextSibling);
        else th.appendChild(dot);
      }

      if(dot.style.background !== bg) dot.style.background = bg;
      if(dot.title !== title) dot.title = title;
    });
  }
  window.applyAffluenceDots = applyAffluenceDots;

  function inferSide(t){
    const dk=String(t?.dirKey||'').toUpperCase(),o=String(t?.origin||'').toLowerCase(),d=String(t?.destination||'').toLowerCase();
    if(dk.includes('L2N')||o.includes('lux')) return 'B';
    if(dk.includes('N2L')||d.includes('lux')) return 'A';
    return 'A';
  }

  function rebuildIndexes(){
    affState.byStation = new Map();
    affState.stations = [];
    const stSet = new Set();
    const trains = affState.data?.trains || {};
    Object.keys(trains).forEach(num=>{
      const t=trains[num], side=inferSide(t), stops=Array.isArray(t?.stops)?t.stops:[];
      stops.forEach((s,idx)=>{
        const station = s.station||s.name;
        if(!station) return;
        stSet.add(station);
        const e={trainNum:num,side,station,stopIndex:idx,hhmm:s.hhmm||'',tm:hhmmToMin(s.hhmm||''),origin:t.origin||'',destination:t.destination||'',globalPct:s.globalPct??Math.round((Number(s.globalOcc)||0)*100)};
        if(!affState.byStation.has(station)) affState.byStation.set(station,{A:[],B:[]});
        affState.byStation.get(station)[side].push(e);
      });
    });
    affState.stations=[...stSet].sort((a,b)=>a.localeCompare(b,'fr'));
    const sel=$('affStationSel');
    if(sel){
      sel.innerHTML='<option value="">—</option>'+affState.stations.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
      if(!sel.value && affState.stations.length){
        const pref = (window.__lbPreferredAffStation || '').trim();
        if(pref && affState.stations.includes(pref)) sel.value = pref;
        else sel.value = affState.stations.includes('Metz') ? 'Metz' : affState.stations[0];
      }
    }
  }

  function renderAffLists(){
    const sel=$('affStationSel'); if(!sel) return;
    const station=sel.value, listA=$('affListA'), listB=$('affListB');
    if(!listA||!listB) return;
    listA.innerHTML=''; listB.innerHTML='';
    if(!station || !affState.byStation.has(station)){ $('affCountA').textContent='0'; $('affCountB').textContent='0'; return; }
    const min=hhmmToMin($('affTMin').value), max=hhmmToMin($('affTMax').value), lim=Math.max(1,Math.min(500,Number($('affLimit').value||25)));
    const fit=(e)=>e.tm==null||min==null||max==null||(e.tm>=min&&e.tm<=max);
    const obj=affState.byStation.get(station);
    const A=obj.A.filter(fit).slice(0,lim), B=obj.B.filter(fit).slice(0,lim);
    $('affCountA').textContent=`${A.length} train(s)`; $('affCountB').textContent=`${B.length} train(s)`;
    const mk=(e)=>{const d=document.createElement('div');d.className='aff-item'+(e.trainNum===affState.currentTrain?' active':'');const maxInfo=affState.maxByTrain.get(e.trainNum);const info=getAffluenceTrainInfo(e.trainNum,e.stopIndex);const col=(info?.color||maxInfo?.color||pctToColor(maxInfo?.maxPct));const pctVal=(info?.maxPct ?? maxInfo?.maxPct ?? e.globalPct);const pct=Number.isFinite(Number(pctVal))?Math.round(Number(pctVal)):'—';const schema=(info?.schemaHtml||'');d.innerHTML=`<div><b>${esc(e.trainNum)}</b> <span style="color:#667">• ${esc(e.hhmm||'')}</span><div style="font-size:12px;color:#667">${esc(e.origin||'')} → ${esc(e.destination||'')}</div></div><div class="aff-pct" style="color:${col}">${pct}%${schema}</div>`;d.onclick=()=>selectAffTrain(e.trainNum,e.stopIndex);return d;};
	A.forEach(e=>listA.appendChild(mk(e))); B.forEach(e=>listB.appendChild(mk(e)));
  }

  function renderAffEvolutionChart(t){
    try{
      const canvas = document.getElementById('affEvolutionChart');
      if (!canvas || !window.Chart) return;

      const stops = Array.isArray(t?.stops) ? t.stops : [];
      const labels = stops.map(s => s.station || s.name || '');
      const vals = stops.map(s => {
        const p = (s.globalPct != null) ? Number(s.globalPct) : Math.round((Number(s.globalOcc)||0)*100);
        return Number.isFinite(p) ? p : null;
      });

      const pointColors = vals.map(v => {
        if (!Number.isFinite(v)) return 'rgba(255,255,255,.15)';
        // pctToColor existe déjà dans le module affluence
        return (typeof pctToColor === 'function') ? pctToColor(v) : '#00ffff';
      });

      if (affEvoChart) { try{ affEvoChart.destroy(); }catch(e){} affEvoChart = null; }

      affEvoChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: vals,
            tension: 0.35,
            borderWidth: 2,
            borderColor: 'rgba(0,255,255,.85)',
            backgroundColor: 'rgba(0,255,255,.12)',
            fill: false,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBorderWidth: 2,
            pointBorderColor: 'rgba(255,255,255,.65)',
            pointBackgroundColor: (ctx) => pointColors[ctx.dataIndex] || 'rgba(0,255,255,.85)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => (ctx.parsed?.y!=null ? (ctx.parsed.y + '%') : '—')
              }
            }
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: {
                stepSize: 20,
                autoSkip: false,
                color: '#e8fdff',
                callback: v => v + '%',
                padding: 6,
                font: { size: 10, weight: '600' }
              },
              grid: { color: 'rgba(0,255,255,.16)' }
            },
            x: {
              ticks: {
                display: false
              },
              grid: { color: 'rgba(0,255,255,.08)' }
            }
          }
        }
      });
    }catch(e){}
  }


function selectAffTrain(num,stopIndex=0){
    affState.currentTrain=String(num||''); affState.currentStop=stopIndex||0;
    const t=(affState.data?.trains||{})[affState.currentTrain];
    const title=$('affTrainTitle'), meta=$('affTrainMeta'), stops=$('affStops');
    if(!title||!meta||!stops) return;
    if(!t){ title.textContent='—'; meta.textContent=''; stops.innerHTML=''; renderAffLists(); return; }
    title.textContent = `${t.trainNum||affState.currentTrain} • ${t.origin||'—'} (${t.depHHMM||'—'}) → ${t.destination||'—'} (${t.arrHHMM||'—'})`;
    const selectedStop = (Array.isArray(t.stops)?t.stops:[])[affState.currentStop] || null;
    meta.innerHTML = `Type: ${t.trainType||'—'} • wagons: ${t.wagons||'—'} • pic: ${t.maxPct??'—'}% ${wagonSchemaHtml(selectedStop, t.trainType)}${selectedStop?` <span style="font-size:11px;color:rgba(15,25,35,.55)">@ ${esc(selectedStop.station||selectedStop.name||'')}</span>`:''}`;
    stops.innerHTML='';
    (Array.isArray(t.stops)?t.stops:[]).forEach((s,i)=>{const p=s.globalPct??Math.round((Number(s.globalOcc)||0)*100);const col=s.globalColor||pctToColor(p);const row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;border-bottom:1px solid rgba(15,25,35,.08);padding:6px 2px;'+(i===affState.currentStop?'background:rgba(32,201,151,.10);':'');row.innerHTML=`<div><b>${esc(s.station||s.name||'')}</b> <span style="color:#667">• ${esc(s.hhmm||'')}</span></div><div class="aff-pct" style="color:${col}">${p}%${wagonSchemaHtml(s, t.trainType)}</div>`;row.onclick=()=>{affState.currentStop=i;selectAffTrain(t.trainNum||affState.currentTrain,i)};stops.appendChild(row);});
    renderAffLists();

    // Graph (évolution)
    renderAffEvolutionChart(t);
}


  // ===== Favoris: badge composition US/UM/UM3/US5/UM Mixte + réduction =====
  (function(){
    if (!window.lbReducedSeats) window.lbReducedSeats = new Set();

    const _normType = (t)=>{
      t = String(t||'').toUpperCase().trim().replace(/[\s_-]+/g,'');
      if (t === 'US' || t === 'UM' || t === 'UM3' || t === 'US5' || t === 'UMMIXTE' || t === 'UMMIX') return t;
      return '';
    };
    const _downgrade = (t)=>{
      if (t==='UM3') return 'UM';
      if (t==='UMMIXTE' || t==='UMMIX') return 'US5';
      if (t==='UM')  return 'US';
      if (t==='US5') return 'US5';
      if (t==='US')  return 'US';
      return '';
    };
    const _iconsByType = (t)=>{
      if (t === 'US') return ['US3.png'];
      if (t === 'UM') return ['US3.png', 'US3.png'];
      if (t === 'UM3') return ['US3.png', 'US3.png', 'US3.png'];
      if (t === 'US5') return ['US5.png'];
      if (t === 'UMMIXTE' || t === 'UMMIX') return ['US5.png', 'US3.png'];
      return [];
    };
    const _getBaseType = (trainNum, fallbackType)=>{
      // 1) fallbackType (ex: trainType from affluence JSON)
      const ft = _normType(fallbackType);
      if (ft) return ft;

      // 2) Compotrains.json (global compoData or window.compoData)
      try{
        const cd = (typeof compoData !== 'undefined' && compoData) ? compoData : (window.compoData || null);
        if (!cd) return '';
        return _normType(cd[String(trainNum)]);
      }catch(e){ return ''; }
    };

    window.buildFavTrainTypeBadge = function buildFavTrainTypeBadge(trainNum, fallbackType){
      const num = String(trainNum||'').trim();
      if (!num) return '';
      const base = _getBaseType(num, fallbackType);
      if (!base) return '';
      const isReduced = window.lbReducedSeats && window.lbReducedSeats.has(num);
      const shown = (isReduced ? _downgrade(base) : base) || base;
      const iconSources = _iconsByType(shown);
      const compoHtml = iconSources.length > 0
        ? `<span class="lb-compo-inline" aria-label="${iconSources.length} rame(s)">${iconSources.map(src => `<img class="lb-compo-icon${src === 'US5.png' ? ' lb-compo-icon--us5' : ''}" src="${src}" alt="Rame TER" loading="eager" decoding="async" onerror="this.onerror=null;this.replaceWith(document.createTextNode('🚆'));">`).join('')}</span>`
        : `<span>${shown}</span>`;

      const reducedBadge = isReduced
        ? `<span class="fav-type-reduced" title="Service réduit (baisse de capacité)">⚠ réduit</span>`
        : '';

      return `
        <span class="fav-type-wrap">
          <span class="fav-type-compo" title="Composition prévue">${compoHtml}</span>
          ${reducedBadge}
        </span>
      `;
    };
  })();



  // Fiche train : composition prévue issue d'abord de Compotrains.json, puis fallback affluence.
  window.buildTrainDetailCompoHtml = function buildTrainDetailCompoHtml(trainNum, fallbackType){
    const safe = (v)=> String(v ?? '').replace(/[&<>'"]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    const norm = (v)=> String(v || '').trim().toUpperCase().replace(/[\s_-]+/g,'');
    const normalizeType = (v)=>{
      const c = norm(v);
      if (c === 'US') return 'US';
      if (c === 'US5') return 'US5';
      if (c === 'UM3' || c === 'UMX3') return 'UM3';
      if (c === 'UMMIXTE' || c === 'UMMIX') return 'UMMIXTE';
      if (c.startsWith('UM')) return 'UM';
      return '';
    };
    const rawFromCompo = (()=>{
      try{
        const cd = (typeof compoData !== 'undefined' && compoData) ? compoData : (window.compoData || {});
        return cd[String(trainNum || '').trim()] || '';
      }catch(_){ return ''; }
    })();
    const code = normalizeType(rawFromCompo) || normalizeType(fallbackType);
    if (!code) return '<span class="train-detail-compo-label">Composition inconnue</span>';

    const label = (()=>{
      if (code === 'US') return 'US Z24500';
      if (code === 'US5') return 'US Z26500';
      if (code === 'UM') return 'UM Z24500';
      if (code === 'UM3') return 'UM3 Z24500';
      if (code === 'UMMIXTE') return 'UM mixte Z26500 + Z24500';
      return code;
    })();
    return '<span class="train-detail-compo-wrap"><span class="train-detail-compo-label is-' + safe(code.toLowerCase()) + '">' + safe(label) + '</span></span>';
  };

  // ===== Favoris: extraction affluence depuis le JSON chargé (detail_YYYY-MM-DD.json) =====
  window.getAffluenceTrainInfo = function getAffluenceTrainInfo(trainNum, preferredStation){
    const js = window.__lbAffluenceData || affState?.data || null;
    if (!js || !js.trains) return null;
    const t = js.trains[String(trainNum)];
    if (!t) return null;

    const stops = Array.isArray(t.stops) ? t.stops : [];
    const trainType = String(t.trainType || t.type || '').toUpperCase();
    const wagons = Number(t.wagons);

    const toPct = (x)=>{
      const n = Number(x);
      if (!Number.isFinite(n)) return null;
      // globalOcc can be 0..1 or 0..100 depending on generator; support both.
      const p = (n <= 1.01) ? (n*100) : n;
      return Math.max(0, Math.min(100, Math.round(p)));
    };

    let depStop = stops[0] || null;
    // Si l'utilisateur a choisi une gare favorite, on affiche l'affluence à CETTE gare (si trouvée dans les arrêts)
    try{
      const want = normalizeStationName(preferredStation || '');
      if (want){
        const found = stops.find(s=>{
          const n = normalizeStationName(s?.station || s?.name || '');
          return n && n === want;
        });
        if (found) depStop = found;
      }
    }catch(e){}
    const depPct = depStop ? (toPct(depStop.globalOcc ?? depStop.pct ?? depStop.globalPct ?? depStop.occPct) ?? toPct(t.maxPct)) : (toPct(t.maxPct));
    const schemaHtml = depStop ? wagonSchemaHtml(depStop, trainType) : '';

    // build sparkline points
    const pts = stops
      .map((s,i)=>({
        i,
        p: toPct(s.globalOcc ?? s.pct ?? s.globalPct ?? s.occPct),
        station: String(s?.station || s?.name || '').trim(),
        hhmm: String(s?.hhmm || '').trim()
      }))
      .filter(o=>o.p!=null);
    const spark = (()=>{
	      if (pts.length < 2) return '';
	      const W=240, H=72;
	      const padL=30, padR=8, padT=6, padB=18;
	      const xs = pts.map(o=>o.i);
	      const minX = Math.min(...xs), maxX=Math.max(...xs);
	      const scaleX = (i)=> padL + (maxX===minX ? 0 : ((i-minX)/(maxX-minX))*(W-padL-padR));
	      const scaleY = (p)=> padT + ((100-p)/100)*(H-padT-padB);
	      const d = pts.map(o=>`${scaleX(o.i).toFixed(1)},${scaleY(o.p).toFixed(1)}`).join(' ');
		  const yTicks = [100, 50, 0];
	      const grid = yTicks.map((v)=>{
	        const y = scaleY(v).toFixed(1);
	        return `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="rgba(180,230,255,.15)" stroke-width="1"></line>`;
	      }).join('');
	      const axis = yTicks.map((v)=>{
	        const y = scaleY(v).toFixed(1);
	        return `<text x="4" y="${Number(y)+2.5}" text-anchor="start" font-size="6.2" fill="rgba(195,235,255,.86)">${v}%</text>`;
	      }).join('');
	      const compactName = (name)=>{
	        const n = String(name || '').trim();
	        if (!n) return '';
	        return n.length > 9 ? `${n.slice(0, 8)}…` : n;
	      };
	      const stationNorm = (s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
	      const preferredStops = ['nancy', 'metz', 'thionville', 'luxembourg'];
	      const preferredIdx = preferredStops
	        .map((key)=>{
	          const i = pts.findIndex(p=>stationNorm(p.station).includes(key));
	          return i >= 0 ? i : null;
	        })
	        .filter(i=>i!=null);
	      const idxLabel = (() => {
	        const seed = preferredIdx.length ? preferredIdx : [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
	        const keep = Array.from(new Set(seed)).filter(i=>i>=0 && i<pts.length).sort((a,b)=>a-b);
	        if (!keep.length) return [0];
	        if (keep.length === 1 && pts.length > 1) return [keep[0], pts.length - 1];
	        return keep.slice(0, 4);
	      })();
	      const xLabels = idxLabel.map((idx)=>{
	        const o = pts[idx];
	        const x = scaleX(o.i);
	        const n = stationNorm(o.station);
	        const txt = n.includes('thionville')
	          ? 'Thionville'
	          : n.includes('luxembourg')
	            ? 'Luxembourg'
	            : n.includes('nancy')
	              ? 'Nancy'
	              : n.includes('metz')
	                ? 'Metz'
	                : compactName(o.station);
	        if (!txt) return '';
	        const safeTxt = String(txt).replace(/[&<>"']/g, (m)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
	        const anchor = (idx===0) ? 'start' : ((idx===pts.length-1) ? 'end' : 'middle');
	        return `<text x="${x.toFixed(1)}" y="${H-3}" text-anchor="${anchor}" font-size="5.6" fill="rgba(195,235,255,.82)">${safeTxt}</text>`;
	      }).join('');
	      const keyIdx = (() => {
	        const last = pts.length - 1;
	        const mid = Math.floor(last / 2);
	        let peak = 0;
        for (let i = 1; i < pts.length; i++) if (pts[i].p > pts[peak].p) peak = i;
        const picks = Array.from(new Set([0, mid, peak, last])).sort((a,b)=>a-b);
        return picks.length > 4 ? [0, peak, last] : picks;
      })();
      const keyDots = keyIdx.map((idx)=>{
        const o = pts[idx];
        const x = scaleX(o.i), y = scaleY(o.p);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7" fill="#8ef8ff" />`;
      }).join('');
      return `<svg class="fav-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Courbe affluence">
        ${grid}
            <polyline fill="none" stroke="rgba(0,255,255,.18)" stroke-width="6" points="${d}"></polyline>
			<polyline fill="none" stroke="rgba(0,255,255,.85)" stroke-width="2" points="${d}"></polyline>
            ${keyDots}
	        ${axis}
	        ${xLabels}
	      </svg>`;
	    })();

    return { trainNum:String(trainNum), trainType, wagons: (Number.isFinite(wagons)?wagons:null), depPct, depStop, stops, schemaHtml, spark };
  };

async function loadAffluenceDate(dateStr){
    if(!dateStr) return;
    const msg=$('affMsg'), url=`${VPS_BASE}/detail_${dateStr}.json`, u=$('affUrl');
    if(u) u.value=url;
    if(msg) msg.textContent=`Chargement ${dateStr}…`;
    try{
      const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const js=norm(await r.json()); if(!js) throw new Error('Format JSON non reconnu');
      affState.data=js;
      const m=new Map();
	  const bandToColor = { green:'#39f78c', yellow:'#ffd166', orange:'#ff8a3d', red:'#ff4d6d', black:'#111' };
      Object.entries(js.trains||{}).forEach(([num,t])=>{
        const n=(String(num).match(/\d{5,6}/)||[])[0]; if(!n) return;
        const maxPct = Number(t?.maxPct);
        const safePct = Number.isFinite(maxPct) ? Math.max(0, Math.min(100, Math.round(maxPct))) : null;
        const normalizedBand = String(t?.band || '').toLowerCase();
        m.set(n,{maxPct:safePct,peakStop:t?.peakStop||'',color:t?.color||bandToColor[normalizedBand]||pctToColor(safePct)});
      });
      affState.maxByTrain=m;
	  window.__lbAffluenceData = js;
      window.__lbAffluenceMaxByTrain = m;
      rebuildIndexes();
      renderAffLists();
      const station=$('affStationSel')?.value, obj=affState.byStation.get(station), first=(obj?.A?.[0]||obj?.B?.[0]);
      if(first) selectAffTrain(first.trainNum, first.stopIndex);
      if(msg) msg.textContent=`✅ ${dateStr} chargé (${Object.keys(js.trains||{}).length} trains)`;
      applyAffluenceDots(document);
	  if (typeof window.updateFavoriteWidgetFromPrefs === 'function') window.updateFavoriteWidgetFromPrefs().catch(()=>{});
    }catch(e){ if(msg) msg.textContent=`❌ ${e.message||e}`; }
  }

  function setupAffDateSelect(){
    const sel=$('affDaySel'); if(!sel) return;
    sel.innerHTML='';
    const t=new Date();
    for(let i=0;i<=14;i++){
      const d=new Date(t); d.setDate(t.getDate()+i);
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
      const ds=`${y}-${m}-${day}`;
      const o=document.createElement('option'); o.value=ds; o.textContent=`J+${i} • ${ds}`; sel.appendChild(o);
    }
    const trainDate=$('trainDate')?.value;
    if(trainDate && [...sel.options].some(o=>o.value===trainDate)) sel.value=trainDate;

    // PERF: le gros fichier affluence ne part pas sur l'accueil.
    // Il est en revanche indispensable dans Carte ET Mes Bétaillères favorites.
    const affViewNeedsData = ()=>{
      const hash = (location.hash || '').toLowerCase();
      return hash === '#carte'
        || hash === '#favoris'
        || hash === '#favtrainswidget'
        || document.body?.classList?.contains('page-favoris');
    };
    const ensureForRelevantView = ()=>{
      if (!affViewNeedsData()) return;
      if (!affState.data && sel.value) loadAffluenceDate(sel.value);
    };
    window.addEventListener('hashchange', ensureForRelevantView, { passive:true });
    ensureForRelevantView();

    sel.addEventListener('change', ()=>{
      if (affState.data || affViewNeedsData()) {
        loadAffluenceDate(sel.value);
      }
      const td=$('trainDate');
      if(td){ td.value=sel.value; td.dispatchEvent(new Event('change',{bubbles:true})); }
    });
  }

  function setupDotsSyncFromMainDate(){
    const refresh=()=>{
      const d=$('trainDate')?.value;
      if(!d) return;
      const daySel=$('affDaySel');
      if(daySel && daySel.value!==d && [...daySel.options].some(o=>o.value===d)) daySel.value=d;
      // Ne pas télécharger l'affluence en arrière-plan sur l'accueil.
      // Carte et Favoris la chargent à la demande.
      const hash = (location.hash || '').toLowerCase();
      const needsAff = hash === '#carte'
        || hash === '#favoris'
        || hash === '#favtrainswidget'
        || document.body?.classList?.contains('page-favoris');
      if (affState.data || needsAff) {
        loadAffluenceDate(d);
      }
    };
    $('trainDate')?.addEventListener('change', refresh);
    $('selectionDate')?.addEventListener('change', ()=>setTimeout(refresh,0));
    const obsHost = $('trainInfo');
    if(obsHost){
      let rafId = 0;
      const mo = new MutationObserver(()=>{
        if (rafId) return;
        rafId = requestAnimationFrame(()=>{
          rafId = 0;
          applyAffluenceDots(document);
        });
      });
      mo.observe(obsHost,{childList:true,subtree:true});
    }
    setTimeout(()=>{
      const d=$('trainDate')?.value;
      const daySel=$('affDaySel');
      if(d && daySel && daySel.value!==d) refresh();
    },300);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    setupAffDateSelect();
    ['affStationSel','affTMin','affTMax','affLimit'].forEach(id=>$(id)?.addEventListener('change',renderAffLists));
    setupDotsSyncFromMainDate();
  });

  // --- API publique (utilisée par "Mes bétaillères favorites") ---
  function _lbAffBestStopIndex(t){
    const stops = Array.isArray(t?.stops) ? t.stops : [];
    let best = 0, bestP = -1;
    for(let i=0;i<stops.length;i++){
      const s = stops[i];
      const p = (s.globalPct!=null) ? Number(s.globalPct) : Math.round((Number(s.globalOcc)||0)*100);
      if(Number.isFinite(p) && p > bestP){ bestP = p; best = i; }
    }
    return best;
  }

  function lbGetAffluenceSummary(trainNum){
    const num = String(trainNum||'');
    const t = (affState.data?.trains||{})[num];
    if(!t) return null;
    const idx = _lbAffBestStopIndex(t);
    const stop = (Array.isArray(t.stops) ? t.stops[idx] : null) || null;
    const p = stop ? ((stop.globalPct!=null)?Number(stop.globalPct):Math.round((Number(stop.globalOcc)||0)*100)) : null;
    const pct = Number.isFinite(p) ? Math.round(p) : null;
    const col = pctToColor(pct);
    const schemaHtml = stop ? wagonSchemaHtml(stop, t.trainType) : '';
    const peakStop = stop?.station || stop?.name || '';
    return { pct, color: col, schemaHtml, peakStop };
  }

  async function lbOpenAffluenceTrain(trainNum, dateStr){
    try{
      const sec = document.getElementById('affluence');
      if(sec){
        sec.scrollIntoView({behavior:'smooth', block:'start'});
        // petit offset pour la topbar
        setTimeout(()=>{ try{ window.scrollBy(0, -Math.max(72, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lb-topbar-h'))+8 || 80)); }catch(e){} }, 50);
      }
      const sel = document.getElementById('affDaySel');
      if(dateStr && sel && sel.value !== dateStr && [...sel.options].some(o=>o.value===dateStr)){
        sel.value = dateStr;
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        // le change déclenche loadAffluenceDate, donc on attend un peu
        await new Promise(r=>setTimeout(r, 350));
      }
      // si pas de date donnée, on s'assure au moins que c'est chargé
      if(!affState.data && sel && sel.value){
        await loadAffluenceDate(sel.value);
      }
      selectAffTrain(trainNum, 0);
      renderAffLists();
    }catch(e){}
  }

  window.addEventListener('lb:chart-ready', () => {
    const t = (affState.data?.trains || {})[String(affState.currentTrain || '')];
    if (t) renderAffEvolutionChart(t);
  });

  window.lbAff = {
    loadDate: loadAffluenceDate,
    selectTrain: selectAffTrain,
    summary: lbGetAffluenceSummary,
    openTrain: lbOpenAffluenceTrain
  };

  window.lbOpenAffluenceTrain = lbOpenAffluenceTrain;
})();

(function(){
  const luxTodayYMD = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Luxembourg' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] || ch));
  const fmtDateFr = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return 'date inconnue';
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
  };
  const hhmmToMin = (raw) => {
    const digits = String(raw||'').replace(/\D/g, '');
    if (digits.length < 4) return null;
    const hh = Number(digits.slice(0,2));
    const mm = Number(digits.slice(2,4));
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || mm > 59) return null;
    return hh * 60 + mm;
  };
  const minToClock = (m) => Number.isFinite(m) ? `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` : '—';
  const luxNowMin = () => {
    const parts = new Intl.DateTimeFormat('fr-FR', { timeZone:'Europe/Luxembourg', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date());
    const hh = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const mm = Number(parts.find(p => p.type === 'minute')?.value || 0);
    return hh * 60 + mm;
  };

  const state = { affChart: null };
  const affColor = (pct) => {
    const p = Number(pct);
    if (!Number.isFinite(p)) return '#9aa7b6';
    if (p < 50) return '#24c25a';
    if (p < 70) return '#ffd166';
    if (p < 85) return '#ff8a1a';
    if (p < 95) return '#ff3131';
    return '#111';
  };
  function destroyAffChart(){
    if (state.affChart){
      try{ state.affChart.destroy(); }catch(_){ }
      state.affChart = null;
    }
  }

  async function getReliabilityData(trainNumber){
    try{
      const stats = window.__lbStats || {};
      if (typeof stats.getLastDaysRange !== 'function' || typeof stats.getRawRange !== 'function' || typeof stats.computeTrainSeriesFromRawDays !== 'function') return null;
      const r = stats.getLastDaysRange(30);
      if (!r?.from || !r?.to) return null;
      const rawDays = await stats.getRawRange(r.from, r.to);
      const range = stats.computeTrainSeriesFromRawDays(rawDays || [], r.from, r.to, String(trainNumber), null);
      const s = Array.isArray(range?.series) ? range.series : [];
      if (!s.length) return null;

      let onTime = 0, delayed = 0, canceled = 0, partial = 0;
      for (const d of s){
        const b = String(d?.bucket || '');
        if (!b) continue;
        if (b === 'ON_TIME') onTime += 1;
        else if (b === 'DELAYED') delayed += 1;
        else if (b === 'CANCELED') canceled += 1;
        else if (b === 'PARTIAL') partial += 1;
      }
      const total = onTime + delayed + canceled + partial;
      if (!total) return null;
      const delayValues = s
        .filter(d => String(d?.bucket || '') === 'DELAYED' && Number.isFinite(Number(d?.value)))
        .map(d => Number(d.value));
      const avgDelay = delayValues.length ? Math.round(delayValues.reduce((a,b)=>a+b,0) / delayValues.length) : 0;
      const maxDelay = delayValues.length ? Math.max(...delayValues) : 0;
      return {
        pct: Math.round((onTime / total) * 100),
        onTime, delayed, canceled, partial,
        avgDelay, maxDelay
      };
    }catch(_){ return null; }
  }

  function firstDepartureFromStopTimes(stopTimes){
    if (!Array.isArray(stopTimes) || !stopTimes.length) return null;
    return hhmmToMin(stopTimes[0]?.departure_time || stopTimes[0]?.arrival_time);
  }

  async function computeNextDepartureLabelEnhanced(trainNumber, dateIso, stopTimes){
    const depMin = firstDepartureFromStopTimes(stopTimes);
    const arrMin = hhmmToMin(stopTimes?.[stopTimes.length - 1]?.arrival_time || stopTimes?.[stopTimes.length - 1]?.departure_time);
    if (!Number.isFinite(depMin)) return 'Non disponible';
    const today = luxTodayYMD();
    if (dateIso === today){
      const now = luxNowMin();
      if (Number.isFinite(arrMin) && now > arrMin){
        const td = new Date(`${today}T00:00:00`); td.setDate(td.getDate()+1);
        const tomorrow = td.toISOString().slice(0,10);
        try{
          const fb = await buildGtfsFallbackResult(String(trainNumber||''), { ymd: tomorrow.replace(/-/g,'') });
          const tDep = firstDepartureFromStopTimes(fb?.train?.stop_times || []);
          if (Number.isFinite(tDep)) return `Terminé aujourd’hui • prochain train demain à ${minToClock(tDep)}`;
        }catch(_){ }
        return `Terminé aujourd'hui (arrivé vers ${minToClock(arrMin)})`;
      }
      if (now >= depMin) return `En cours (départ ${minToClock(depMin)})`;
      return `Aujourd'hui à ${minToClock(depMin)} (dans ${depMin - now} min)`;
    }
    const tomorrow = (()=>{ const d=new Date(`${today}T00:00:00`); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();
    if (dateIso === tomorrow) return `Demain à ${minToClock(depMin)}`;
    return `Le ${fmtDateFr(dateIso)} à ${minToClock(depMin)}`;
  }


  function renderTrainDetailAffluenceDetails(info){
    const host = document.getElementById('trainDetailAffluenceDetails');
    if (!host) return;
    const stops = Array.isArray(info?.stops) ? info.stops : [];
    const toPct = (x)=>{
      const n = Number(x);
      if (!Number.isFinite(n)) return null;
      const p = (n <= 1.01) ? (n * 100) : n;
      return Math.max(0, Math.min(100, Math.round(p)));
    };
    const pctClass = (pp)=>{
      if (pp == null) return '';
      const p = Number(pp);
      if (!Number.isFinite(p)) return '';
      if (p >= 95) return 'sat';
      if (p >= 85) return 'bad';
      if (p >= 70) return 'warn';
      if (p >= 50) return 'mid';
      return 'ok';
    };
    if (!stops.length){
      host.innerHTML = '<div class="train-detail-aff-empty">Pas de détail d’affluence disponible pour ce train ce jour-là.</div>';
      return;
    }
    const rows = stops.map((s, idx)=>{
      const stName = escapeHtml(s?.station || s?.name || `Arrêt ${idx + 1}`);
      const stTime = escapeHtml(s?.hhmm || s?.time || '');
      const pp = toPct(s?.globalOcc ?? s?.pct ?? s?.globalPct ?? s?.occPct);
      const p = pp == null ? '—' : `${pp}%`;
      const sch = (typeof wagonSchemaHtml === 'function') ? wagonSchemaHtml(s, info?.trainType) : '';
      return `<div class="fav-aff-stop">
        <div class="fav-aff-stop-head">
          <div class="fav-aff-stop-title">
            <span class="fav-aff-stop-name">${stName}</span>
            ${stTime ? `<span class="fav-aff-stop-time">· ${stTime}</span>` : ''}
          </div>
          <div class="fav-aff-stop-pct ${pctClass(pp)}">${p}</div>
        </div>
        <div class="fav-aff-stop-schema">${sch}</div>
      </div>`;
    }).join('');
    host.innerHTML = `
      <div class="fav-aff-stops">${rows}</div>
    `;
    try { window.lbFitFavSchemas?.(); } catch(_) {}
  }

  function renderAffluenceChartFromInfo(info){
    const cvs = document.getElementById('trainDetailAffluenceChart');
    if (!cvs || !window.Chart) return;
    const stops = Array.isArray(info?.stops) ? info.stops : [];
    const labels = stops.map(s => String(s?.station || s?.name || '—'));
    const values = stops.map(s => {
      const p = Number(s?.globalPct ?? Math.round((Number(s?.globalOcc)||0)*100));
      return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null;
    });
    destroyAffChart();
    if (!labels.length) return;
    state.affChart = new Chart(cvs, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: 'rgba(0,240,255,.85)',
          backgroundColor: 'rgba(0,240,255,.12)',
          tension: .25,
          fill: false,
          pointRadius: 5,
          pointBackgroundColor: values.map(v => affColor(v)),
          pointBorderColor: 'rgba(255,255,255,.8)',
          pointBorderWidth: 1.5
        }]
      },
      options: {
        animation: false,
        plugins: { legend: { display:false } },
        scales: {
          y: {
            min:0,
            max:100,
            ticks:{
              stepSize:25,
              autoSkip:true,
              maxTicksLimit:5,
              color:'rgba(220,250,255,.92)',
              callback:v=>`${v}%`,
              padding:4,
              font:{ size:8, weight:'600' }
            },
            grid:{ color:'rgba(0,255,255,.16)' }
          },
          x: {
            ticks:{
              display:false
            },
            grid:{ color:'rgba(0,255,255,.08)' }
          }
        }
      }
    });
  }

  async function renderAffluenceBlock(trainNumber, selectedDate){
    const affEl = document.getElementById('trainDetailAffluence');
    if (typeof window.lbAff?.loadDate === 'function') {
      try { await window.lbAff.loadDate(selectedDate); } catch(_) {}
    }
    const info = (typeof window.getAffluenceTrainInfo === 'function') ? window.getAffluenceTrainInfo(String(trainNumber)) : null;
    const affDetailsEl = document.getElementById('trainDetailAffluenceDetails');
    if (!info){
      affEl.textContent = 'Non disponible';
      if (affDetailsEl) affDetailsEl.innerHTML = '<div class=\"train-detail-aff-empty\">Pas de détail d’affluence disponible pour ce train ce jour-là.</div>';
      destroyAffChart();
      return null;
    }
    const maxPct = Array.isArray(info.stops)
      ? info.stops.reduce((mx,s)=>{
          const p = Number(s?.globalPct ?? Math.round((Number(s?.globalOcc)||0)*100));
          return Number.isFinite(p) ? Math.max(mx, Math.round(p)) : mx;
        }, 0)
      : (Number.isFinite(Number(info.depPct)) ? Math.round(Number(info.depPct)) : null);
    affEl.textContent = Number.isFinite(maxPct) ? `${maxPct}%` : 'Non disponible';
    destroyAffChart();
    renderTrainDetailAffluenceDetails(info);
    return info;
  }

  async function openInternalTrainPanel(trainNumber, dateIso){
    const panel = document.getElementById('trainDetailPanel');
    if (!panel) return;
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso||'')) ? String(dateIso) : (document.getElementById('trainDate')?.value || luxTodayYMD());
    const ymd = selectedDate.replace(/-/g, '');

    const titleEl = document.getElementById('trainDetailTitle');
    const nextEl = document.getElementById('trainDetailNext');
    const relEl = document.getElementById('trainDetailReliability');
    const relDetailsEl = document.getElementById('trainDetailReliabilityDetails');
    const pathEl = document.getElementById('trainDetailPath');
    const stopsEl = document.getElementById('trainDetailStops');
    const statsBtn = document.getElementById('trainDetailStatsBtn');

    panel.hidden = false;
    lbCurrentDetailTrain = String(trainNumber || '').trim();
    try{ window.lbComments?.setCurrentTrain(lbCurrentDetailTrain); }catch(e){}
    titleEl.textContent = `Train ${trainNumber}`;
    nextEl.textContent = 'Chargement…';
    relEl.textContent = 'Chargement…';
    relDetailsEl.textContent = 'Chargement…';
    pathEl.textContent = 'Chargement…';
    stopsEl.innerHTML = '<div class="train-detail-stop"><span>Récupération du parcours…</span></div>';

    if (typeof loadCompoData === 'function') {
      try { await loadCompoData({ forceFresh: false, background: true }); } catch(_) {}
    }

    let fallback = null;
    try { fallback = await buildGtfsFallbackResult(trainNumber, { ymd }); } catch(_) {}
    const stopTimes = fallback?.train?.stop_times || [];
    const first = stopTimes[0] || null;
    const last = stopTimes[stopTimes.length - 1] || null;

    if (stopTimes.length){
      const origin = first?.stop_point?.name || '—';
      const dest = last?.stop_point?.name || '—';
      pathEl.textContent = `${origin} → ${dest} (${stopTimes.length} arrêts)`;
      nextEl.textContent = await computeNextDepartureLabelEnhanced(trainNumber, selectedDate, stopTimes);

      // Parcours simple uniquement : l’affluence détaillée est déjà rendue dans #trainDetailAffluenceDetails.
      // On évite donc de réafficher les pourcentages/wagons une deuxième fois ici.
      stopsEl.innerHTML = stopTimes.map((st) => {
        const arr = (st?.arrival_time || '').replace(/(\d{2})(\d{2}).*/, '$1:$2');
        const dep = (st?.departure_time || '').replace(/(\d{2})(\d{2}).*/, '$1:$2');
        const stopNameRaw = st?.stop_point?.name || '—';
        const stopName = esc(stopNameRaw);
        const t = dep || arr || '—';
        return `<div class="train-detail-stop train-detail-stop--route-only"><span class="left"><span class="time">${t}</span><span class="name">${stopName}</span></span></div>`;
      }).join('');
    } else {
      pathEl.textContent = 'Parcours indisponible pour cette date';
      nextEl.textContent = 'Non disponible';
      stopsEl.innerHTML = '<div class="train-detail-stop"><span>Aucun arrêt GTFS trouvé pour ce train et cette date.</span></div>';
    }

    const rel = await getReliabilityData(trainNumber);
    if (rel){
      relEl.textContent = `${rel.pct}%`;
      relDetailsEl.innerHTML = `
        <div>✅ ${rel.onTime} à l'heure ⏰ ${rel.delayed} retard ❌ ${rel.canceled} supprimé 🟠 ${rel.partial} suppr. partielle</div>
        <div style="margin-top:4px">Retard moyen : ${rel.avgDelay} min</div>
        <div>Retard max : ${rel.maxDelay} min</div>`;
    } else {
      relEl.textContent = '—';
      relDetailsEl.textContent = 'Données indisponibles.';
    }

    const affInfo = await renderAffluenceBlock(trainNumber, selectedDate);
    const compoEl = document.getElementById('trainDetailCompo');
    if (compoEl) {
      if (typeof window.buildTrainDetailCompoHtml === 'function') {
        compoEl.innerHTML = window.buildTrainDetailCompoHtml(String(trainNumber), affInfo?.trainType || '');
      } else if (typeof window.buildFavTrainTypeBadge === 'function') {
        const badge = window.buildFavTrainTypeBadge(String(trainNumber), affInfo?.trainType || '');
        compoEl.innerHTML = badge || 'Inconnue';
      } else {
        compoEl.textContent = affInfo?.trainType || 'Inconnue';
      }
    }

    if (statsBtn){
      statsBtn.onclick = (e) => {
        e.preventDefault();
        const input = document.getElementById('statsTrainId');
        if (input) input.value = String(trainNumber);
        document.getElementById('statsTabTrainBtn')?.click();
        document.getElementById('statsBtnTrainRun')?.click();
        location.hash = '#statsConsole';
      };
    }

    if (document.body.classList.contains('page-search')) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  window.lbOpenTrainDetail = openInternalTrainPanel;

  function closeCarteSourcePanel(sourceWindow){
    try {
      const frame = Array.from(document.querySelectorAll('#carte iframe')).find(
        (candidate) => candidate.contentWindow === sourceWindow
      );
      if (!frame) return;
      const frameDocument = frame.contentDocument || sourceWindow?.document;
      if (!frameDocument) return;
      const closeButton = frameDocument.getElementById('trip-panel-close');
      if (closeButton) {
        closeButton.click();
        return;
      }
      frameDocument.getElementById('trip-panel')?.classList.add('hidden');
      frameDocument.body?.classList.remove('trip-panel-open');
    } catch (_) {
      // La fiche unifiée reste ouvrable même si le contenu de l'iframe
      // n'est momentanément pas accessible.
    }
  }

  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || d.type !== 'lb:open-train-detail') return;
    const raw = String(d.trainNumber || '').match(/\d{5,6}/);
    if (!raw) return;
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dateIso || ''))
      ? String(d.dateIso)
      : (/^\d{8}$/.test(String(d.dateYmd || ''))
          ? `${String(d.dateYmd).slice(0,4)}-${String(d.dateYmd).slice(4,6)}-${String(d.dateYmd).slice(6,8)}`
          : (document.getElementById('trainDate')?.value || luxTodayYMD()));
    // La carte doit ouvrir la même fiche unifiée que la recherche et les
    // favoris. L'ancien renderer local n'affichait qu'un sous-ensemble des
    // données (GTFS, affluence et statistiques).
    const openProfile = typeof window.lbOpenTrainProfile === 'function'
      ? window.lbOpenTrainProfile
      : (typeof window.lbOpenTrainDetail === 'function'
          ? window.lbOpenTrainDetail
          : openInternalTrainPanel);
    closeCarteSourcePanel(ev.source);
    Promise.resolve(openProfile.call(window, raw[0], dateIso, { origin: 'map' })).catch((error) => {
      console.error('[Carte] ouverture de la fiche train impossible', error);
    });
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('#trainInfo a.train-link');
    if (!a) return;
    const trainNumber = a.dataset.trainNumber || (a.textContent || '').trim();
    if (!/\d{5,6}/.test(trainNumber || '')) return;
    e.preventDefault();
    const dateIso = a.dataset.trainDate || document.getElementById('trainDate')?.value || luxTodayYMD();
    openInternalTrainPanel((trainNumber.match(/\d{5,6}/)||[])[0], dateIso);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('trainDetailClose');
    const panel = document.getElementById('trainDetailPanel');
    if (closeBtn && panel) closeBtn.addEventListener('click', () => {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      destroyAffChart();
    });
  });
})();

(function(){
  const PAGE_HASH_ALIASES = {
    '#home': 'home',
    '#search': 'search',
    '#carte': 'carte',
    '#affluence': 'carte',
    '#favoris': 'favoris',
    '#favtrainswidget': 'favoris',
    '#stats': 'stats',
    '#statsconsole': 'stats',
    '#loisirs': 'loisirs',
    '#divertissement': 'loisirs',
    '#multimedia': 'loisirs'
  };

  const navItems = Array.from(document.querySelectorAll('.bottom-nav__item[href]'));
  const pages = Array.from(document.querySelectorAll('.app-page[data-page]'));

  function pageFromHash(hash){
    return PAGE_HASH_ALIASES[String(hash || '').toLowerCase()] || 'home';
  }

  function syncActiveNav(page){
    navItems.forEach((item) => {
      const targetPage = pageFromHash(item.getAttribute('href') || '');
      const active = targetPage === page;
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  // Feedback immédiat au tap/clic : évite l'impression de décalage avant le hashchange.
  navItems.forEach((item) => {
    const activateNow = () => {
      const href = item.getAttribute('href') || '';
      const page = pageFromHash(href);
      syncActiveNav(page);
    };
    item.addEventListener('pointerdown', activateNow, { passive: true });
    item.addEventListener('click', activateNow, { passive: true });
  });

  function syncPages(){
    const hash = location.hash || '#home';
    const page = pageFromHash(hash);

    document.body.classList.remove('page-home','page-search','page-carte','page-favoris','page-stats','page-loisirs');
    document.body.classList.add(`page-${page}`);

    pages.forEach((node) => {
      const active = node.dataset.page === page;
      node.classList.toggle('is-page-active', active);
      if (node.id === 'favTrainsWidget' && !active){
        node.style.display = 'none';
      }
    });

    if (page === 'favoris'){
      const fav = document.getElementById('favTrainsWidget');
      if (fav) fav.style.display = 'block';
    }

    syncActiveNav(page);

    if (hash && /^#[A-Za-z][\w:-]*$/.test(hash)){
      const target = document.querySelector(hash);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior:'smooth', block:'start' }));
    }
  }

  window.addEventListener('hashchange', syncPages);
  document.addEventListener('DOMContentLoaded', syncPages);
  syncPages();
})();

(function(){
  const nav = document.getElementById('tableauViewNav');
  const search = document.getElementById('search');
  const disruptions = document.getElementById('disruptionsSummary');
  const trainInfo = document.getElementById('trainInfo');
  if (!nav || !search || !disruptions || !trainInfo) return;

  const tabs = Array.from(nav.querySelectorAll('[data-tableau-view]'));
  let currentView = 'global';

  const hasGeneratedTable = () => !!trainInfo.querySelector('table');
  const onTableTab = () => (location.hash || '#home') === '#search';

  function activateButton(view){
    tabs.forEach(tab => { const active = tab.dataset.tableauView === view; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); });
  }

  function applyView(view, opts = {}){
    const hasTable = hasGeneratedTable();
    if (!hasTable){
      search.style.display = '';
      disruptions.style.display = 'none';
      trainInfo.style.display = '';
      nav.hidden = true;
      nav.classList.remove('is-visible');
      document.body.classList.remove('tableau-view-nav-visible');
      return;
    }

    currentView = view;
    activateButton(view);
    search.style.display = (view === 'search') ? '' : 'none';
    disruptions.style.display = (view === 'perturbations') ? 'flex' : 'none';
    trainInfo.style.display = (view === 'global') ? '' : 'none';

    const showNav = hasTable && onTableTab() && view !== 'search';
    nav.hidden = !showNav;
    nav.classList.toggle('is-visible', showNav);
    document.body.classList.toggle('tableau-view-nav-visible', showNav);

    if (opts.scroll !== false){
      const target = view === 'search' ? search : (view === 'perturbations' ? disruptions : trainInfo);
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  function refreshNav(opts = {}){
    const hasTable = hasGeneratedTable();
    const showNav = hasTable && onTableTab() && currentView !== 'search';
    nav.hidden = !showNav;
    nav.classList.toggle('is-visible', showNav);
    document.body.classList.toggle('tableau-view-nav-visible', showNav);
    if (!showNav){
      if (onTableTab()){
        search.style.display = '';
        if (!opts.keepCurrentPanels){
          disruptions.style.display = disruptions.style.display || 'none';
          trainInfo.style.display = '';
        }
      }
      return;
    }
    applyView(currentView || 'global', { scroll: false });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.tableauView;
      applyView(view);
      if (view === 'global'){
        const table = document.querySelector('#trainInfo .table-scroll table');
        if (table){
          window.__openTrainTableSnapshot?.(table, tab);
        }
      }
    });
  });

  window.addEventListener('hashchange', () => refreshNav({ keepCurrentPanels: true }));

  document.querySelectorAll('.bottom-nav__item[href]').forEach(link => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      if (href !== '#search'){
        nav.hidden = true;
        nav.classList.remove('is-visible');
        document.body.classList.remove('tableau-view-nav-visible');
      }
    }, { passive: true });
  });

  const tableNavLink = document.querySelector('.bottom-nav__item[href="#search"]');
  if (tableNavLink){
    tableNavLink.addEventListener('click', (e) => {
      if (!hasGeneratedTable()) return;
      e.preventDefault();
      if ((location.hash || '') !== '#search') location.hash = 'search';
      currentView = 'global';
      refreshNav();
      applyView('global');
    });
  }

  let lastHasTable = hasGeneratedTable();
  const mo = new MutationObserver(() => {
    const hasTableNow = hasGeneratedTable();

    if (hasTableNow !== lastHasTable) {
      lastHasTable = hasTableNow;
      if (hasTableNow) {
        currentView = 'global';
        if (onTableTab()) {
          refreshNav();
          applyView('global', { scroll: false });
        }
      } else {
        refreshNav();
      }
      return;
    }

    if (!hasTableNow) refreshNav();
  });
  mo.observe(trainInfo, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => refreshNav());
  refreshNav();
})();


(function(){
  const nav = document.getElementById('loisirsViewNav');
  const loisirsLink = document.querySelector('.bottom-nav__item[href="#loisirs"]');
  const multimediaSection = document.getElementById('multimedia');
  const jeuSection = document.getElementById('jeuContainer');
  const jeuFrame = document.getElementById('jeuFrame');
  const jeuFallbackLink = document.getElementById('jeuFallbackLink');
  const modalBlague = document.getElementById('modalBlague');
  const fondModal = document.getElementById('fondModal');
  const texteBlague = document.getElementById('texteBlague');
  const fermerBlague = document.getElementById('fermerBlague');
  if (!nav || !loisirsLink || !multimediaSection) return;

  const tabs = Array.from(nav.querySelectorAll('[data-loisirs-view]'));
  const onLoisirsTab = () => ['#loisirs', '#divertissement', '#multimedia'].includes(location.hash || '');

  const gameUrl = '/jeuBETA1.html?v=2';
  let gameLoaded = false;
  let currentLoisirsView = 'multimedia';

  if (jeuFrame){
    jeuFrame.addEventListener('load', () => {
      gameLoaded = true;
      if (jeuFallbackLink) jeuFallbackLink.style.display = 'none';
    });
  }

  const bingoFallback = [
    "Bingo du jour : retard mystère, correspondance sportive et quai surprise. 🎯",
    "Bingo TER : signalisation, météo, puis arrivée en héros. 🚆",
    "Bingo validé : un train à l'heure, c'est un jackpot ! ⭐",
    "Bingo express : quai modifié, train annoncé, suspense total. 🎲",
    "Bingo frontaliers : correspondance réussie à la seconde près ! 🕒"
  ];
  let lastBingoLine = '';

  function pickBingoLine(){
    try {
      if (Array.isArray(window.phrasesBingo) && window.phrasesBingo.length > 1) {
        let candidate = window.phrasesBingo[Math.floor(Math.random() * window.phrasesBingo.length)];
        if (candidate === lastBingoLine) {
          candidate = window.phrasesBingo[(Math.floor(Math.random() * (window.phrasesBingo.length - 1)) + 1) % window.phrasesBingo.length];
        }
        lastBingoLine = candidate;
        return candidate;
      }
    } catch(e){ console.warn('[loisirs bingo] random fallback', e); }
    let candidate = bingoFallback[Math.floor(Math.random() * bingoFallback.length)];
    if (candidate === lastBingoLine && bingoFallback.length > 1) {
      candidate = bingoFallback[(bingoFallback.indexOf(candidate) + 1) % bingoFallback.length];
    }
    lastBingoLine = candidate;
    return candidate;
  }

  function showBingoModal(){
    if (!modalBlague || !fondModal || !texteBlague) return;
    texteBlague.textContent = pickBingoLine();
    modalBlague.style.display = 'block';
    fondModal.style.display = 'block';
  }

  function hideBingoModal(){
    if (modalBlague) modalBlague.style.display = 'none';
    if (fondModal) fondModal.style.display = 'none';
  }

  fermerBlague?.addEventListener('click', hideBingoModal);
  fondModal?.addEventListener('click', hideBingoModal);

  function activate(view){
    tabs.forEach(tab => {
      const active = tab.dataset.loisirsView === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
	currentLoisirsView = view;
  }

  function setJeuFullscreen(active){
    document.body.classList.toggle('jeu-fullscreen', active);
  }

  function setJeuActive(active){
    document.body.classList.toggle('loisirs-jeu-active', active);
    if (!active && jeuSection) jeuSection.style.display = 'none';
  }

  function stopEmbeddedGame(){
    if (!jeuFrame) return;
    try {
      const w = jeuFrame.contentWindow;
      const d = jeuFrame.contentDocument;
      const audio = d && d.getElementById ? d.getElementById('gameMusic') : null;
      if (audio && typeof audio.pause === 'function') {
        audio.pause();
        try { audio.currentTime = 0; } catch(_) {}
      }
      if (w && typeof w.postMessage === 'function') {
        w.postMessage({ type: 'lb:game:stop-audio' }, '*');
      }
    } catch(e) {}
    try {
      jeuFrame.src = 'about:blank';
      jeuFrame.removeAttribute('data-loaded');
    } catch(e) {}
    gameLoaded = false;
    if (jeuFallbackLink) jeuFallbackLink.style.display = 'none';
  }

  function openView(view, opts = {}){
    activate(view);
    if (view === 'multimedia'){
      setJeuActive(false);
      setJeuFullscreen(false);
      stopEmbeddedGame();
      if ((location.hash || '') !== '#multimedia') location.hash = 'multimedia';
      if (opts.scroll !== false) requestAnimationFrame(() => multimediaSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (view === 'bingo'){
      setJeuActive(false);
      setJeuFullscreen(false);
      stopEmbeddedGame();
      if ((location.hash || '') !== '#divertissement') location.hash = 'divertissement';
      showBingoModal();
      return;
    }
    if (view === 'jeu'){
      if ((location.hash || '') !== '#divertissement') location.hash = 'divertissement';
      if (jeuFrame){
        if (!jeuFrame.dataset.loaded || !jeuFrame.src || jeuFrame.src.endsWith('about:blank')) {
          gameLoaded = false;
          jeuFrame.src = gameUrl;
          jeuFrame.dataset.loaded = '1';
        }
        setTimeout(() => {
          if (!gameLoaded && jeuFallbackLink) jeuFallbackLink.style.display = 'inline-flex';
        }, 3000);
      }
      setJeuActive(true);
      if (jeuSection) jeuSection.style.display = 'block';
      const mobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
      setJeuFullscreen(!!mobile);
	  if (typeof syncCarteFullscreenMode === 'function') syncCarteFullscreenMode();
    }
  }

  function refresh(){
    const show = onLoisirsTab();
    nav.hidden = !show;
    nav.classList.toggle('is-visible', show);
    document.body.classList.toggle('loisirs-view-nav-visible', show);
    if (!show) {
      setJeuActive(false);
      setJeuFullscreen(false);
      stopEmbeddedGame();
      hideBingoModal();
      currentLoisirsView = 'multimedia';
      return;
    }

    const hash = location.hash || '';
    if (hash === '#multimedia') {
      currentLoisirsView = 'multimedia';
      setJeuActive(false);
      setJeuFullscreen(false);
      stopEmbeddedGame();
    } else if (currentLoisirsView === 'jeu') {
      setJeuActive(true);
    } else {
      setJeuActive(false);
      setJeuFullscreen(false);
      stopEmbeddedGame();
      currentLoisirsView = 'bingo';
    }
    activate(currentLoisirsView);
	if (typeof syncCarteFullscreenMode === 'function') syncCarteFullscreenMode();
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => openView(tab.dataset.loisirsView));
  });

  window.lbOpenLoisirsView = openView;
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || d.type !== 'lb:loisirs:return') return;
    if ((location.hash || '') !== '#loisirs') location.hash = 'loisirs';
    openView('multimedia', { scroll: true });
	stopEmbeddedGame();
  });

  loisirsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if ((location.hash || '') !== '#loisirs') location.hash = 'loisirs';
    refresh();
    openView('multimedia', { scroll: true });
  });

  document.querySelectorAll('.bottom-nav__item[href]').forEach(link => {
    link.addEventListener('click', () => {
      if ((link.getAttribute('href') || '') !== '#loisirs') {
        nav.hidden = true;
        nav.classList.remove('is-visible');
        document.body.classList.remove('loisirs-view-nav-visible');
        setJeuActive(false);
        setJeuFullscreen(false);
		stopEmbeddedGame();
        hideBingoModal();
		currentLoisirsView = 'multimedia';
      }
    }, { passive: true });
  });

  window.addEventListener('hashchange', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  refresh();
})();

(function(){
  const modal = document.getElementById('alertDetailModal');
  const body = document.getElementById('alertDetailBody');
  const title = document.getElementById('alertDetailTitle');
  const closeBtn = document.getElementById('alertDetailClose');
  if (!modal || !body || !title) return;

  const esc = (v) => String(v || '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function openDetails(detailItems, trainNo, fallbackTitle){
    const key = String(trainNo || '').trim();
    const list = Array.isArray(detailItems) ? detailItems : [];
    if (!list.length) {
      const t = fallbackTitle || 'Aucun détail disponible';
      title.textContent = `Train ${key || '—'}`;
      body.innerHTML = `<div class="alert-detail-card info"><div class="alert-detail-row">ℹ️ ${esc(t)}</div></div>`;
    } else {
      title.textContent = `Train ${key} — détail perturbation`;
      body.innerHTML = list.map((it) => `
        <div class="alert-detail-card ${esc(it.level)}">
          <div class="alert-detail-row"><span>${esc(it.icon)}</span><span>${esc(it.title)}</span></div>
          ${it.descriptionHtml
            ? `<div class="alert-detail-desc">${it.descriptionHtml}</div>`
            : (it.description ? `<div class="alert-detail-desc">${esc(it.description)}</div>` : '')}
          ${Array.isArray(it.trains) && it.trains.length ? `<div class="disruption-trains">${it.trains.map(t => `<span class="disruption-train-pill">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>`).join('');
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function openForKey(alertKey, trainNo, fallbackTitle){
    const item = alertKey ? LB_ALERTS_BY_KEY.get(String(alertKey)) : null;
    if (item) return openDetails([item], trainNo, fallbackTitle);
    const trainKey = String(trainNo || '').trim();
    const disr = LB_TABLE_DISRUPTIONS_BY_TRAIN.get(trainKey) || [];
    if (disr.length) return openDetails(disr, trainNo, fallbackTitle);
    const list = LB_ALERTS_BY_TRAIN.get(trainKey) || [];
    return openDetails(list, trainNo, fallbackTitle);
  }

  function closeModal(){
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  document.addEventListener('click', (e) => {
    const icon = e.target.closest && e.target.closest('#trainInfo thead .icon, #trainInfo th .train-state');
    if (!icon) return;

    let th = icon.closest('th[data-train-number]');
    if (!th) {
      const td = icon.closest('td,th');
      const row = td?.parentElement;
      const idx = (td && row) ? Array.from(row.children).indexOf(td) : -1;
      const firstHead = icon.closest('thead')?.querySelector('tr:first-child');
      th = (firstHead && idx >= 0) ? firstHead.children[idx] : null;
      if (!(th && th.matches && th.matches('th[data-train-number]'))) th = null;
    }

    if (!th) return;
    const trainNo = (th.dataset.trainNumber || '').replace(/^CFL-/, '');
    const fallback = icon.getAttribute('title') || th.getAttribute('title') || '';
    const alertKey = icon.dataset.alertKey || th.dataset.alertKeyMain || '';
    if (!trainNo) return;
    e.preventDefault();
    openForKey(alertKey, trainNo, fallback);
  });
})();
