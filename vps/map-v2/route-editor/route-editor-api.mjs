import fs from 'node:fs';
import path from 'node:path';

const API_PREFIX = '/api/map-v2/route-editor';
const MAX_BODY = 20 * 1024 * 1024;

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function highSpeedTrip(trip) {
  const dump = [trip?.category, trip?.routeName, trip?.routeShortName, trip?.id]
    .map(v => String(v || '').toUpperCase())
    .join(' ');
  return /(^|[^A-Z])(TGV|OUIGO|LYRIA|ICE|AVR|TRENITALIA|FRECCIAROSSA|OUI|OGO|TRN)([^A-Z]|$)/.test(dump);
}

function safeStop(stop) {
  return {
    name: String(stop?.name || 'Gare'),
    lat: Number.isFinite(Number(stop?.lat)) ? Number(stop.lat) : null,
    lon: Number.isFinite(Number(stop?.lon)) ? Number(stop.lon) : null,
    time: String(stop?.displayTime || stop?.time || '')
  };
}

function buildCatalog(trips, state) {
  const groups = new Map();
  for (const trip of Object.values(trips || {})) {
    if (!trip || !highSpeedTrip(trip)) continue;
    const stops = Array.isArray(trip.stops) ? trip.stops.map(safeStop) : [];
    if (stops.length < 2) continue;
    const signature = stops.map(s => s.name).join(' → ');
    const routeId = `r-${fnv1a(signature)}`;
    let group = groups.get(routeId);
    if (!group) {
      group = {
        id: routeId,
        origin: stops[0].name,
        destination: stops.at(-1).name,
        stops,
        signature,
        routeNames: new Map(),
        trainNumbers: new Set(),
        pathIds: new Map(),
        tripCount: 0
      };
      groups.set(routeId, group);
    }
    group.tripCount += 1;
    if (trip.number) group.trainNumbers.add(String(trip.number));
    if (trip.routeName) group.routeNames.set(String(trip.routeName), (group.routeNames.get(String(trip.routeName)) || 0) + 1);
    if (trip.pathId) group.pathIds.set(String(trip.pathId), (group.pathIds.get(String(trip.pathId)) || 0) + 1);
  }

  const topKey = map => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const routes = [...groups.values()].map(group => {
    const sections = group.stops.slice(0, -1).map((stop, index) => {
      const sectionId = `${group.id}:s${index + 1}`;
      const saved = state?.sections?.[sectionId] || null;
      return {
        id: sectionId,
        index,
        from: stop,
        to: group.stops[index + 1],
        status: saved?.status || 'todo',
        updatedAt: saved?.updatedAt || null
      };
    });
    const validated = sections.filter(s => s.status === 'validated').length;
    return {
      id: group.id,
      origin: group.origin,
      destination: group.destination,
      signature: group.signature,
      stops: group.stops,
      sections,
      progress: { validated, total: sections.length },
      tripCount: group.tripCount,
      trainNumbers: [...group.trainNumbers].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })).slice(0, 80),
      routeName: topKey(group.routeNames),
      pathId: topKey(group.pathIds),
      pathVariants: [...group.pathIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pathId, count]) => ({ pathId, count }))
    };
  });

  const priority = route => {
    const text = `${route.origin} ${route.destination} ${route.signature}`.toUpperCase();
    if (text.includes('PARIS EST') && text.includes('STRASBOURG')) return 0;
    if (text.includes('PARIS EST') && text.includes('NANCY')) return 1;
    if (text.includes('PARIS EST') && text.includes('METZ')) return 2;
    if (text.includes('PARIS') && text.includes('STRASBOURG')) return 3;
    if (text.includes('LILLE') && text.includes('LYON')) return 4;
    return 10;
  };
  routes.sort((a, b) => priority(a) - priority(b) || b.tripCount - a.tripCount || a.signature.localeCompare(b.signature, 'fr'));
  return { ok: true, version: 1, generatedAt: new Date().toISOString(), routes };
}

function readJson(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { return fallback; }
}

function atomicWrite(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filename);
}

function readBody(req, callback) {
  let size = 0;
  const chunks = [];
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      callback(new Error('Payload trop volumineux'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      callback(null, raw ? JSON.parse(raw) : {});
    } catch (error) { callback(error); }
  });
  req.on('error', error => callback(error));
}

export function createMoorailRouteEditorHandler({ trips, send, storeDir }) {
  const stateFile = path.join(storeDir, 'moorail-route-editor-state-v1.json');
  const sectionsFile = path.join(storeDir, 'moorail-validated-sections-v1.json');
  const templatesFile = path.join(storeDir, 'moorail-route-templates-v1.json');
  const catalogFile = path.join(storeDir, 'moorail-route-catalog-v1.json');

  fs.mkdirSync(storeDir, { recursive: true });

  const defaultState = () => ({ version: 1, updatedAt: null, routes: {}, sections: {} });
  const loadState = () => readJson(stateFile, defaultState());

  function writeDerived(state) {
    const templates = {};
    for (const [routeId, route] of Object.entries(state.routes || {})) {
      templates[routeId] = {
        id: routeId,
        origin: route.origin || '',
        destination: route.destination || '',
        signature: route.signature || '',
        sectionIds: Array.isArray(route.sectionIds) ? route.sectionIds : [],
        updatedAt: route.updatedAt || null
      };
    }
    atomicWrite(sectionsFile, { version: 1, updatedAt: state.updatedAt, sections: state.sections || {} });
    atomicWrite(templatesFile, { version: 1, updatedAt: state.updatedAt, routes: templates });
  }

  function saveSection(payload) {
    const routeId = String(payload?.routeId || '').trim();
    const sectionId = String(payload?.sectionId || '').trim();
    if (!routeId || !sectionId) throw new Error('routeId/sectionId manquant');
    if (!Array.isArray(payload?.coordinates) || payload.coordinates.length < 2) throw new Error('Géométrie invalide');
    if (payload.coordinates.length > 250000) throw new Error('Géométrie trop volumineuse');

    const state = loadState();
    const now = new Date().toISOString();
    const section = {
      ...payload,
      routeId,
      sectionId,
      status: payload.status === 'draft' ? 'draft' : 'validated',
      updatedAt: now
    };
    state.sections[sectionId] = section;
    const route = state.routes[routeId] || {
      id: routeId,
      origin: String(payload?.route?.origin || ''),
      destination: String(payload?.route?.destination || ''),
      signature: String(payload?.route?.signature || ''),
      sectionIds: []
    };
    if (!route.sectionIds.includes(sectionId)) route.sectionIds.push(sectionId);
    route.updatedAt = now;
    state.routes[routeId] = route;
    state.updatedAt = now;
    atomicWrite(stateFile, state);
    writeDerived(state);
    return section;
  }

  function deleteSection(sectionId) {
    const state = loadState();
    if (!state.sections?.[sectionId]) return false;
    const routeId = state.sections[sectionId].routeId;
    delete state.sections[sectionId];
    if (routeId && state.routes?.[routeId]) {
      state.routes[routeId].sectionIds = (state.routes[routeId].sectionIds || []).filter(id => id !== sectionId);
      state.routes[routeId].updatedAt = new Date().toISOString();
    }
    state.updatedAt = new Date().toISOString();
    atomicWrite(stateFile, state);
    writeDerived(state);
    return true;
  }

  return function handleMoorailRouteEditor(req, res, url) {
    if (!url.pathname.startsWith(API_PREFIX)) return false;

    if (req.method === 'GET' && url.pathname === `${API_PREFIX}/catalog`) {
      const state = loadState();
      const catalog = buildCatalog(trips, state);
      try { atomicWrite(catalogFile, catalog); } catch {}
      send(res, 200, catalog);
      return true;
    }

    if (req.method === 'GET' && (url.pathname === `${API_PREFIX}/state` || url.pathname === `${API_PREFIX}/export`)) {
      send(res, 200, loadState());
      return true;
    }

    if (req.method === 'POST' && url.pathname === `${API_PREFIX}/save`) {
      readBody(req, (error, payload) => {
        if (error) return send(res, 400, { error: error.message });
        try {
          const saved = saveSection(payload);
          return send(res, 200, { ok: true, saved });
        } catch (saveError) {
          return send(res, 400, { error: saveError.message });
        }
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === `${API_PREFIX}/delete`) {
      readBody(req, (error, payload) => {
        if (error) return send(res, 400, { error: error.message });
        const sectionId = String(payload?.sectionId || '').trim();
        if (!sectionId) return send(res, 400, { error: 'sectionId manquant' });
        return send(res, 200, { ok: deleteSection(sectionId) });
      });
      return true;
    }

    send(res, 404, { error: 'Route editor API: ressource introuvable' });
    return true;
  };
}
