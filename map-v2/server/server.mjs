import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRealtime } from './realtime-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');
const dataDir = path.resolve(process.env.MAP_V2_DATA || path.resolve(here, '../data/generated'));
const port = Number(process.env.MAP_V2_PORT || 3110);
const realtimeFile = process.env.MAP_V2_REALTIME_FILE || '';

function readJson(name, fallback) {
  const filename = path.join(dataDir, name);
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : fallback;
}

const network = readJson('network.geojson', { type: 'FeatureCollection', features: [] });
const paths = readJson('paths.json', {});
const trips = readJson('trips.json', {});
const services = readJson('services.json', {});
const networkRows = (network.features || []).map(feature => ({ feature, bbox: feature.properties?.bbox }));

function send(res, status, payload, type = 'application/json; charset=utf-8') {
  const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': type.startsWith('application/json') ? 'no-store' : 'public, max-age=300',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function parseBbox(raw) {
  const values = String(raw || '').split(',').map(Number);
  if (values.length !== 4 || values.some(value => !Number.isFinite(value))) return null;
  return values;
}

function bboxIntersects(a, b) {
  return !a || !b || !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function pointInside(lon, lat, bbox) {
  return !bbox || (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);
}

function serviceDate(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function secondsOfDay(now) {
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function locate(pathInfo, distance) {
  const coords = pathInfo?.coordinates || [];
  const cumulative = pathInfo?.cumulative || [];
  if (!coords.length) return null;
  if (coords.length === 1) return { lon: coords[0][0], lat: coords[0][1] };
  const target = Math.max(0, Math.min(Number(pathInfo.length) || 0, distance));
  let lo = 1;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const index = Math.max(1, lo);
  const before = cumulative[index - 1] || 0;
  const after = cumulative[index] || before;
  const ratio = after > before ? (target - before) / (after - before) : 0;
  return {
    lon: coords[index - 1][0] + (coords[index][0] - coords[index - 1][0]) * ratio,
    lat: coords[index - 1][1] + (coords[index][1] - coords[index - 1][1]) * ratio
  };
}

function activePosition(trip, nowSec, delaySeconds) {
  const times = trip.times || [];
  const offsets = trip.offsets || [];
  if (times.length < 2 || times.length !== offsets.length) return null;
  const adjusted = nowSec - delaySeconds;
  if (adjusted < times[0] || adjusted > times[times.length - 1]) return null;
  let index = 0;
  while (index < times.length - 2 && adjusted > times[index + 1]) index += 1;
  const start = times[index];
  const end = times[index + 1];
  const ratio = end > start ? (adjusted - start) / (end - start) : 0;
  return offsets[index] + (offsets[index + 1] - offsets[index]) * Math.max(0, Math.min(1, ratio));
}

function categoryFor(trip) {
  const value = `${trip.category || ''} ${trip.routeName || ''}`.toUpperCase();
  if (/TGV|OUIGO|EUROSTAR|LYRIA|FRECCIAROSSA/.test(value)) return 'tgv';
  if (/CFL|LUXEMBOURG/.test(value)) return 'cfl';
  return 'ter';
}

function serviceRuns(serviceId, date) {
  const dates = services[serviceId];
  return Array.isArray(dates) && dates.includes(date);
}

function normalizeStopName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bGARE\b|\bDE\b|\bLA\b|\bLE\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameStopName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a));
}

function matchPathByStops(rawStops) {
  const wanted = String(rawStops || '').split('|').map(normalizeStopName).filter(Boolean);
  if (wanted.length < 2) return null;
  let best = null;
  for (const trip of Object.values(trips)) {
    const candidate = (trip.stops || []).map(stop => normalizeStopName(stop.name)).filter(Boolean);
    if (candidate.length < 2 || !paths[trip.pathId]) continue;
    let cursor = 0;
    let matched = 0;
    for (const wantedName of wanted) {
      while (cursor < candidate.length && !sameStopName(wantedName, candidate[cursor])) cursor += 1;
      if (cursor >= candidate.length) break;
      matched += 1;
      cursor += 1;
    }
    const firstMatches = sameStopName(wanted[0], candidate[0]);
    const lastMatches = sameStopName(wanted.at(-1), candidate.at(-1));
    const required = Math.max(2, Math.ceil(Math.min(wanted.length, candidate.length) * 0.6));
    if (matched < required || (!firstMatches && !lastMatches)) continue;
    const score = matched * 100 + (firstMatches ? 35 : 0) + (lastMatches ? 35 : 0)
      - Math.abs(wanted.length - candidate.length) * 3;
    if (!best || score > best.score) best = { trip, score, matched };
  }
  if (!best) return null;
  const pathInfo = paths[best.trip.pathId];
  return {
    matchedTripId: best.trip.id,
    pathId: best.trip.pathId,
    score: best.score,
    matchedStops: best.matched,
    path: {
      type: 'Feature',
      properties: { pathId: best.trip.pathId },
      geometry: { type: 'LineString', coordinates: pathInfo.coordinates }
    }
  };
}

function visibleTrains(bbox, at) {
  const now = at ? new Date(at) : new Date();
  const date = serviceDate(now);
  const nowSec = secondsOfDay(now);
  const realtime = loadRealtime(realtimeFile);
  const result = [];
  for (const trip of Object.values(trips)) {
    if (!serviceRuns(trip.serviceId, date)) continue;
    const realtimeInfo = realtime.get(String(trip.number)) || { delaySeconds: 0, cancelled: false };
    if (realtimeInfo.cancelled) continue;
    const distance = activePosition(trip, nowSec, realtimeInfo.delaySeconds || 0);
    if (distance == null) continue;
    const pathInfo = paths[trip.pathId];
    const position = locate(pathInfo, distance);
    if (!position || !pointInside(position.lon, position.lat, bbox)) continue;
    result.push({
      tripId: trip.id,
      pathId: trip.pathId,
      number: trip.number || '',
      label: trip.displayLabel || trip.number || trip.routeShortName || categoryFor(trip).toUpperCase(),
      category: categoryFor(trip),
      lat: position.lat,
      lon: position.lon,
      delaySeconds: realtimeInfo.delaySeconds || 0
    });
  }
  return { generatedAt: now.toISOString(), trains: result };
}

function tripResponse(trip) {
  if (!trip) return null;
  return {
    id: trip.id,
    number: trip.number,
    label: trip.displayLabel || trip.number || trip.routeShortName || '',
    routeName: trip.routeName || '',
    headsign: trip.headsign || '',
    origin: trip.stops?.[0]?.name || '',
    destination: trip.stops?.at(-1)?.name || '',
    stops: (trip.stops || []).map((stop, index) => ({
      name: stop.name,
      time: stop.displayTime || '',
      lat: Number.isFinite(Number(stop.lat)) ? Number(stop.lat) : null,
      lon: Number.isFinite(Number(stop.lon)) ? Number(stop.lon) : null,
      offset: trip.offsets?.[index] ?? null
    }))
  };
}

function serveStatic(urlPath, res) {
  const relative = urlPath === '/' ? 'carte-v2.html' : urlPath.replace(/^\//, '');
  const filename = path.resolve(publicDir, relative);
  if (!filename.startsWith(publicDir) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return false;
  const ext = path.extname(filename);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  send(res, 200, fs.readFileSync(filename), type);
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/map-v2/health') {
    return send(res, 200, { ok: true, trips: Object.keys(trips).length, paths: Object.keys(paths).length, network: networkRows.length });
  }
  if (url.pathname === '/api/map-v2/infrastructure') {
    const bbox = parseBbox(url.searchParams.get('bbox'));
    const features = networkRows.filter(row => bboxIntersects(row.bbox, bbox)).map(row => row.feature);
    return send(res, 200, { type: 'FeatureCollection', features });
  }
  if (url.pathname === '/api/map-v2/trains') {
    return send(res, 200, visibleTrains(parseBbox(url.searchParams.get('bbox')), url.searchParams.get('at')));
  }
  if (url.pathname === '/api/map-v2/match-path') {
    const match = matchPathByStops(url.searchParams.get('stops'));
    return match ? send(res, 200, match) : send(res, 404, { error: 'Aucun parcours V2 correspondant' });
  }
  if (url.pathname.startsWith('/api/map-v2/paths/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/map-v2/paths/'.length));
    const item = paths[id];
    if (!item) return send(res, 404, { error: 'Parcours introuvable' });
    return send(res, 200, { type: 'Feature', properties: { pathId: id }, geometry: { type: 'LineString', coordinates: item.coordinates } });
  }
  if (url.pathname.startsWith('/api/map-v2/trips/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/map-v2/trips/'.length));
    const item = tripResponse(trips[id]);
    return item ? send(res, 200, item) : send(res, 404, { error: 'Train introuvable' });
  }
  if (serveStatic(url.pathname, res)) return;
  send(res, 404, { error: 'Ressource introuvable' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[map-v2] http://0.0.0.0:${port}/carte-v2.html`);
  console.log(`[map-v2] données: ${dataDir}`);
});
