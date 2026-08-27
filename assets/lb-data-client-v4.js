/* La Bétaillère — Data Client V4
 * Un seul point d'entrée côté UI. Déduplique les requêtes et masque les sources métier.
 */
(function () {
  'use strict';

  if (window.LBData) return;

  const DEFAULT_BASE = '/api/v4';
  const cache = new Map();
  const inflight = new Map();
  const listeners = new Map();

  const now = () => Date.now();
  const keyFor = (path, params) => `${path}?${new URLSearchParams(params || {}).toString()}`;

  function emit(type, detail) {
    const set = listeners.get(type);
    set?.forEach((fn) => {
      try { fn(detail); } catch (error) { console.error('[LBData listener]', error); }
    });
    document.dispatchEvent(new CustomEvent(`lb:data:${type}`, { detail }));
  }

  function subscribe(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function normalizeStatus(value) {
    const s = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (['on-time', 'ontime', 'ok', 'a-lheure', 'à-lheure'].includes(s)) return 'on-time';
    if (['delay', 'delayed', 'retard', 'late'].includes(s)) return 'delay';
    if (['cancelled', 'canceled', 'suppression', 'supprime', 'supprimé'].includes(s)) return 'cancelled';
    if (['partial', 'partially-cancelled', 'reduced', 'partiel'].includes(s)) return 'partial';
    if (['live', 'running'].includes(s)) return 'live';
    if (['planned', 'scheduled', 'a-venir'].includes(s)) return 'planned';
    return 'unknown';
  }

  function normalizeTrain(raw = {}) {
    const number = String(raw.number ?? raw.train_number ?? raw.train ?? raw.label ?? '').match(/\d{3,6}/)?.[0] || '';
    const stopEntries = raw.stops && !Array.isArray(raw.stops) && typeof raw.stops === 'object'
      ? Object.entries(raw.stops).map(([name, delay]) => ({ name, delayMinutes: Number(delay) || 0 }))
      : Array.isArray(raw.stops) ? raw.stops : [];
    const status = normalizeStatus(raw.status);
    const delayMinutes = Number(raw.delayMinutes ?? raw.delay ?? Math.max(0, ...stopEntries.map((s) => Number(s.delayMinutes ?? s.delay) || 0), 0)) || 0;
    return {
      id: raw.id || raw.train_id || (number ? `${number}:${raw.serviceDate || raw.date || ''}` : ''),
      number,
      serviceDate: raw.serviceDate || raw.date || null,
      operator: raw.operator || raw.source || null,
      line: raw.line || null,
      origin: raw.origin || (stopEntries[0] ? { name: stopEntries[0].name } : null),
      destination: raw.destination || (stopEntries.length ? { name: stopEntries.at(-1).name } : null),
      status: status === 'unknown' && delayMinutes > 0 ? 'delay' : status,
      delayMinutes,
      cancelled: Boolean(raw.cancelled || status === 'cancelled'),
      partial: Boolean(raw.partial || status === 'partial'),
      live: Boolean(raw.live || status === 'live'),
      position: raw.position || null,
      composition: raw.composition || null,
      occupancy: raw.occupancy || null,
      stops: stopEntries,
      disruptions: Array.isArray(raw.disruptions) ? raw.disruptions : [],
      provenance: Array.isArray(raw.provenance) ? raw.provenance : [],
      updatedAt: raw.updatedAt || null,
      raw
    };
  }

  function normalizeEnvelope(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload.trains)) {
      return { ...payload, trains: payload.trains.map(normalizeTrain) };
    }
    if (payload.train && typeof payload.train === 'object') {
      return { ...payload, train: normalizeTrain(payload.train) };
    }
    return payload;
  }

  async function request(path, { params, ttl = 15000, force = false, signal } = {}) {
    const base = String(window.LB_DATA_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
    const cacheKey = keyFor(path, params);
    const cached = cache.get(cacheKey);
    if (!force && cached && now() - cached.at < ttl) return cached.value;
    if (!force && inflight.has(cacheKey)) return inflight.get(cacheKey);

    const promise = (async () => {
      const url = new URL(`${base}${path}`, location.origin);
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal
      });
      if (!response.ok) throw new Error(`LB Data API ${response.status} ${path}`);
      const value = normalizeEnvelope(await response.json());
      cache.set(cacheKey, { at: now(), value });
      emit('update', { path, params: params || {}, value });
      return value;
    })();

    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      emit('error', { path, params: params || {}, error });
      if (cached) return { ...cached.value, stale: true, dataClientError: error.message };
      throw error;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  function invalidate(prefix = '') {
    Array.from(cache.keys()).forEach((key) => {
      if (!prefix || key.startsWith(prefix)) cache.delete(key);
    });
  }

  const api = {
    version: 4,
    request,
    subscribe,
    invalidate,
    normalizeTrain,
    normalizeStatus,
    snapshot: (options) => request('/snapshot', { ttl: 10000, ...options }),
    trains: (params, options) => request('/trains', { params, ttl: 10000, ...options }),
    train: (number, date, options) => request(`/trains/${encodeURIComponent(number)}`, { params: { date }, ttl: 10000, ...options }),
    station: (id, options) => request(`/stations/${encodeURIComponent(id)}`, { ttl: 15000, ...options }),
    traffic: (options) => request('/traffic', { ttl: 20000, ...options }),
    map: (options) => request('/map', { ttl: 8000, ...options }),
    statsOverview: (params, options) => request('/stats/overview', { params, ttl: 60000, ...options }),
    health: (options) => request('/health', { ttl: 10000, ...options })
  };

  window.LBData = Object.freeze(api);
  document.dispatchEvent(new CustomEvent('lb:data-ready', { detail: api }));
})();
