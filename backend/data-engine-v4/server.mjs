/*
 * La Bétaillère — Data Engine V4
 * Node >= 18, zéro dépendance externe.
 *
 * But : une seule source de vérité pour les vues du site. Les sources brutes sont
 * récupérées, mises en cache, normalisées et enrichies ici. Le front ne doit plus
 * agréger SNCF/CFL/GTFS/SIRI/composition lui-même.
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.LB_DATA_PORT || 3120);
const HOST = process.env.LB_DATA_HOST || '127.0.0.1';
const SOURCE_TTL_MS = Number(process.env.LB_SOURCE_TTL_MS || 12000);
const SOURCE_TIMEOUT_MS = Number(process.env.LB_SOURCE_TIMEOUT_MS || 7000);

const SOURCES = {
  sncfRt: process.env.LB_SOURCE_SNCF_RT || 'https://vps.labetaillere.fr/gtfs/retards_nancymetzlux.json',
  cflRt: process.env.LB_SOURCE_CFL_RT || 'https://vps.labetaillere.fr/gtfs/retards_cfl.json',
  cflArrivals: process.env.LB_SOURCE_CFL_ARRIVALS || 'https://vps.labetaillere.fr/gtfs/retards_cfl_arrivals.json',
  traffic: process.env.LB_SOURCE_TRAFFIC || 'https://vps.labetaillere.fr/gtfs/siri_sx_alertes.json',
  compositions: process.env.LB_SOURCE_COMPOSITIONS || 'https://www.labetaillere.fr/Compotrains.json'
};

const STATS_BASE = (process.env.LB_STATS_BASE || 'http://127.0.0.1:3099').replace(/\/$/, '');

const cache = new Map();
const inFlight = new Map();

const TRAIN_ALIAS_GROUPS = [
  ['2870', '2871'], ['2864', '2865'], ['2806', '2807'], ['2872', '2873'], ['2816', '2817'],
  ['88504', '88505'], ['88502', '88503'], ['88500', '88501'], ['88529', '88530'], ['88531', '88530'],
  ['88533', '88532'], ['88535', '88534'], ['88520', '88521'], ['88522', '88523'], ['88524', '88525'],
  ['88526', '88527'], ['88528', '88529']
];

const aliasIndex = new Map();
for (const group of TRAIN_ALIAS_GROUPS) {
  const normalized = [...new Set(group.map(normalizeTrainNumber).filter(Boolean))];
  normalized.forEach((number) => aliasIndex.set(number, normalized));
}

function normalizeTrainNumber(value) {
  const matches = String(value ?? '').match(/\d{3,6}/g);
  if (!matches?.length) return '';
  return matches.sort((a, b) => b.length - a.length)[0].replace(/^0+(?=\d)/, '');
}

function aliasesFor(number) {
  const key = normalizeTrainNumber(number);
  return key ? (aliasIndex.get(key) || [key]) : [];
}

function normalizeStatus(value, delay = 0) {
  const status = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['ON_TIME', 'ONTIME', 'OK'].includes(status)) return Number(delay) > 0 ? 'delay' : 'on-time';
  if (['DELAYED', 'DELAY', 'LATE'].includes(status)) return 'delay';
  if (['CANCELLED', 'CANCELED', 'CANCEL', 'SUPPRESSED'].includes(status)) return 'cancelled';
  if (['PARTIAL', 'PARTIALLY_CANCELLED', 'REDUCED'].includes(status)) return 'partial';
  if (['LIVE', 'RUNNING'].includes(status)) return 'live';
  if (['PLANNED', 'SCHEDULED'].includes(status)) return 'planned';
  return Number(delay) > 0 ? 'delay' : 'unknown';
}

function normalizePlatform(value) {
  if (value == null) return null;
  const v = String(value).trim().replace(/^(voie|track)\s*/i, '');
  return !v || /^(?:n\/?a|null|undefined|-+)$/i.test(v) ? null : v;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.LB_CORS_ORIGIN || 'https://www.labetaillere.fr',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function fetchJson(url, { timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'labetaillere-data-engine-v4/1.0' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function source(name, url = SOURCES[name]) {
  if (!url) return { ok: false, name, data: null, error: 'source non configurée', fetchedAt: null, stale: true };
  const cached = cache.get(name);
  const age = cached ? Date.now() - cached.fetchedAtMs : Infinity;
  if (cached && age < SOURCE_TTL_MS) return { ...cached, stale: false };
  if (inFlight.has(name)) return inFlight.get(name);

  const promise = (async () => {
    try {
      const data = await fetchJson(url);
      const value = {
        ok: true,
        name,
        data,
        error: null,
        fetchedAt: new Date().toISOString(),
        fetchedAtMs: Date.now(),
        stale: false
      };
      cache.set(name, value);
      return value;
    } catch (error) {
      if (cached) return { ...cached, ok: true, stale: true, error: error.message };
      return {
        ok: false,
        name,
        data: null,
        error: error.message,
        fetchedAt: null,
        fetchedAtMs: 0,
        stale: true
      };
    } finally {
      inFlight.delete(name);
    }
  })();

  inFlight.set(name, promise);
  return promise;
}

function flattenCompositions(payload) {
  const map = new Map();
  if (!payload || typeof payload !== 'object') return map;
  for (const group of Object.values(payload)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    for (const [number, code] of Object.entries(group)) {
      const key = normalizeTrainNumber(number);
      if (key && code) map.set(key, String(code));
    }
  }
  return map;
}

function objectRecords(payload) {
  const root = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.map((value, index) => [String(index), value]);
  return Object.entries(root).filter(([, value]) => value && typeof value === 'object');
}

function ancillaryIndex(payload) {
  const map = new Map();
  for (const [label, raw] of objectRecords(payload)) {
    const number = normalizeTrainNumber(raw.train ?? raw.train_number ?? raw.number ?? label);
    if (!number) continue;
    if (!map.has(number)) map.set(number, []);
    map.get(number).push(raw);
  }
  return map;
}

function firstAncillary(index, number) {
  for (const alias of aliasesFor(number)) {
    const list = index.get(alias);
    if (list?.length) return list[0];
  }
  return null;
}

function normalizeSncfTrains(payload, context) {
  const result = [];
  if (!payload || typeof payload !== 'object') return result;
  const compositionMap = context.compositions;
  const cflIndex = context.cflIndex;
  const arrivalIndex = context.arrivalIndex;

  for (const [key, raw] of Object.entries(payload)) {
    if (!raw || typeof raw !== 'object') continue;
    const number = normalizeTrainNumber(raw.train_number ?? raw.train ?? key);
    if (!number) continue;

    const stops = raw.stops && typeof raw.stops === 'object' && !Array.isArray(raw.stops)
      ? Object.entries(raw.stops).map(([name, delay]) => ({
          name,
          delayMinutes: Number(delay) || 0
        }))
      : [];
    const delayMinutes = Math.max(0, ...stops.map((stop) => Number(stop.delayMinutes) || 0));
    const cfl = firstAncillary(cflIndex, number);
    const arrival = firstAncillary(arrivalIndex, number);
    const platform = normalizePlatform(
      arrival?.arrivalPlatformRealtime ?? arrival?.arrivalPlatformPlanned ??
      cfl?.arrivalPlatformRealtime ?? cfl?.arrivalPlatformPlanned ?? cfl?.platform
    );

    const originName = stops[0]?.name || null;
    const destinationName = stops.at(-1)?.name || null;
    const status = normalizeStatus(raw.status, delayMinutes);
    const compositionCode = compositionMap.get(number) || null;

    result.push({
      id: raw.train_id || `${number}:${context.serviceDate || ''}`,
      number,
      serviceDate: context.serviceDate || null,
      operator: 'SNCF',
      line: 'L90',
      origin: originName ? { name: originName } : null,
      destination: destinationName ? { name: destinationName, platform } : null,
      status,
      delayMinutes,
      cancelled: status === 'cancelled',
      partial: status === 'partial',
      live: Boolean(raw.live),
      position: raw.position || null,
      composition: compositionCode ? {
        code: compositionCode,
        source: 'labetaillere-composition',
        confidence: 'estimated'
      } : null,
      occupancy: null,
      stops,
      disruptions: Array.isArray(raw.disruptions) ? raw.disruptions : [],
      provenance: [
        { source: 'sncf-gtfs-rt', stale: Boolean(context.sncfStale) },
        ...(cfl ? [{ source: 'cfl', role: 'enrichment', stale: Boolean(context.cflStale) }] : []),
        ...(arrival ? [{ source: 'cfl-arrivals', role: 'platform', stale: Boolean(context.arrivalsStale) }] : []),
        ...(compositionCode ? [{ source: 'labetaillere-composition', role: 'composition', stale: Boolean(context.compositionsStale) }] : [])
      ],
      updatedAt: context.updatedAt
    });
  }
  return result;
}

function normalizeTraffic(payload) {
  const situations = Array.isArray(payload?.situations) ? payload.situations : [];
  return situations.map((item) => ({
    id: String(item?.situation_number || item?.id || ''),
    summary: String(item?.summary || ''),
    description: String(item?.detail || item?.description || ''),
    participant: item?.participant_ref || null,
    scope: item?.scope_type || null,
    validity: Array.isArray(item?.validity_periods) ? item.validity_periods : [],
    affects: Array.isArray(item?.affects) ? item.affects : [],
    links: Array.isArray(item?.links) ? item.links : []
  }));
}

async function buildSnapshot() {
  const startedAt = Date.now();
  const [sncf, cfl, arrivals, traffic, compositions] = await Promise.all([
    source('sncfRt'),
    source('cflRt'),
    source('cflArrivals'),
    source('traffic'),
    source('compositions')
  ]);

  const updatedAt = new Date().toISOString();
  const compositionMap = flattenCompositions(compositions.data);
  const cflIndex = ancillaryIndex(cfl.data);
  const arrivalIndex = ancillaryIndex(arrivals.data);
  const serviceDate = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Luxembourg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const trains = normalizeSncfTrains(sncf.data, {
    compositionMap,
    cflIndex,
    arrivalIndex,
    serviceDate,
    updatedAt,
    sncfStale: sncf.stale,
    cflStale: cfl.stale,
    arrivalsStale: arrivals.stale,
    compositionsStale: compositions.stale
  });

  const sourceMeta = [sncf, cfl, arrivals, traffic, compositions].map((entry) => ({
    name: entry.name,
    ok: entry.ok,
    stale: entry.stale,
    fetchedAt: entry.fetchedAt,
    error: entry.error
  }));

  return {
    apiVersion: 4,
    updatedAt,
    stale: sourceMeta.some((item) => item.stale),
    buildMs: Date.now() - startedAt,
    sources: sourceMeta,
    trains,
    traffic: normalizeTraffic(traffic.data),
    meta: {
      trainCount: trains.length,
      trafficCount: Array.isArray(traffic.data?.situations) ? traffic.data.situations.length : 0
    }
  };
}

async function proxyStats(pathname, searchParams) {
  const target = new URL(`${STATS_BASE}${pathname}`);
  searchParams.forEach((value, key) => target.searchParams.set(key, value));
  return fetchJson(target.toString(), { timeoutMs: Number(process.env.LB_STATS_TIMEOUT_MS || 7000) });
}

function healthFromSnapshot(snapshot) {
  return {
    apiVersion: 4,
    status: snapshot.sources.every((s) => s.ok) ? (snapshot.stale ? 'degraded' : 'ok') : 'degraded',
    updatedAt: snapshot.updatedAt,
    buildMs: snapshot.buildMs,
    trainCount: snapshot.trains.length,
    sources: snapshot.sources
  };
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return json(res, 400, { error: 'bad request' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': process.env.LB_CORS_ORIGIN || 'https://www.labetaillere.fr',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  try {
    if (path === '/api/v4/snapshot') {
      return json(res, 200, await buildSnapshot());
    }
    if (path === '/api/v4/health') {
      return json(res, 200, healthFromSnapshot(await buildSnapshot()));
    }
    if (path === '/api/v4/trains') {
      const snapshot = await buildSnapshot();
      const status = url.searchParams.get('status');
      const station = String(url.searchParams.get('station') || '').toLowerCase();
      const trains = snapshot.trains.filter((train) => {
        if (status && train.status !== status) return false;
        if (station && !train.stops.some((stop) => String(stop.name || '').toLowerCase().includes(station))) return false;
        return true;
      });
      return json(res, 200, {
        apiVersion: 4, updatedAt: snapshot.updatedAt, stale: snapshot.stale, sources: snapshot.sources, trains
      });
    }
    const trainMatch = path.match(/^\/api\/v4\/trains\/(\d{3,6})$/);
    if (trainMatch) {
      const snapshot = await buildSnapshot();
      const number = normalizeTrainNumber(trainMatch[1]);
      const train = snapshot.trains.find((item) => item.number === number) || null;
      return json(res, train ? 200 : 404, {
        apiVersion: 4, updatedAt: snapshot.updatedAt, stale: snapshot.stale, sources: snapshot.sources, train,
        ...(train ? {} : { error: 'train not found' })
      });
    }
    if (path === '/api/v4/traffic') {
      const snapshot = await buildSnapshot();
      return json(res, 200, {
        apiVersion: 4, updatedAt: snapshot.updatedAt, stale: snapshot.stale, sources: snapshot.sources, traffic: snapshot.traffic
      });
    }
    if (path === '/api/v4/map') {
      const snapshot = await buildSnapshot();
      const trains = snapshot.trains.filter((train) => train.position).map((train) => ({
        number: train.number,
        status: train.status,
        delayMinutes: train.delayMinutes,
        position: train.position,
        origin: train.origin,
        destination: train.destination,
        composition: train.composition,
        updatedAt: train.updatedAt
      }));
      return json(res, 200, { apiVersion: 4, updatedAt: snapshot.updatedAt, stale: snapshot.stale, trains });
    }
    if (path === '/api/v4/stats/overview') {
      const data = await proxyStats('/beta/overview', url.searchParams);
      return json(res, 200, { apiVersion: 4, updatedAt: new Date().toISOString(), stale: false, data });
    }
    if (path === '/api/v4') {
      return json(res, 200, {
        name: 'La Bétaillère Data Engine', apiVersion: 4,
        endpoints: ['/api/v4/health', '/api/v4/snapshot', '/api/v4/trains', '/api/v4/trains/:number', '/api/v4/traffic', '/api/v4/map', '/api/v4/stats/overview']
      });
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('[LB Data Engine]', error);
    return json(res, 500, { error: 'data engine failure', detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[LB Data Engine V4] http://${HOST}:${PORT}/api/v4`);
});
