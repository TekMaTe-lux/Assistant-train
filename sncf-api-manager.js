(function (global) {
  'use strict';

  const DAILY_QUOTA = 5000;
  const MIN_INTERVAL_MS = Math.ceil((24 * 60 * 60 * 1000) / DAILY_QUOTA);
  const MIN_BURST_INTERVAL_MS = 120;
  const MAX_GLOBAL_WAIT_MS = 1500;
  const CACHE_LIMIT = 150;
  const MS_PER_MINUTE = 60 * 1000;
  const SAME_DAY_WINDOWS = [
    { startMinutes: 270, endMinutes: 570, intervalMinutes: 4 },   // 04:30 – 09:30
    { startMinutes: 570, endMinutes: 930, intervalMinutes: 8 },   // 09:30 – 15:30
    { startMinutes: 930, endMinutes: 1260, intervalMinutes: 4 }   // 15:30 – 21:00
  ];
  const NIGHT_INTERVAL_MINUTES = 20; // 21:00 – 04:30
  const NEXT_DAY_INTERVAL_MINUTES = 4 * 60; // 4 h
  const FUTURE_DAY_INTERVAL_MINUTES = 12 * 60; // 12 h → 2 requêtes / jour
  const PAST_DAY_INTERVAL_MINUTES = 30; // requêtes historiques plus souples

  const STORAGE_KEYS = {
    usage: 'sncf:usage-tracking',
    cacheIndex: 'sncf:journey-cache:index',
    lastRequestAt: 'sncf:last-request-at'
  };

  const CACHE_PREFIX = 'sncf:journey-cache:';

  function buildStorageDriver() {
    if (typeof localStorage !== 'undefined') {
      try {
        const testKey = '__sncf_usage_test__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return {
          type: 'localStorage',
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
          removeItem: (key) => localStorage.removeItem(key)
        };
      } catch (err) {
        // ignore and continue to next fallback
      }
    }

    if (typeof document !== 'undefined') {
      const cookieDriver = {
        type: 'cookie',
        getItem(key) {
          const pattern = `(?:^|; )${encodeURIComponent(key)}=`;
          const match = document.cookie.match(new RegExp(pattern + '([^;]*)'));
          return match ? decodeURIComponent(match[1]) : null;
        },
        setItem(key, value) {
          const expires = new Date();
          expires.setHours(23, 59, 59, 999);
          document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
        },
        removeItem(key) {
          document.cookie = `${encodeURIComponent(key)}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
        }
      };

      try {
        cookieDriver.setItem('__sncf_cookie_test__', '1');
        cookieDriver.removeItem('__sncf_cookie_test__');
        return cookieDriver;
      } catch (err) {
        // ignore and fallback to in-memory store
      }
    }

    const memoryStore = new Map();
    return {
      type: 'memory',
      getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
      setItem: (key, value) => memoryStore.set(key, value),
      removeItem: (key) => memoryStore.delete(key)
    };
  }

  const cacheStorage = (() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const testKey = '__sncf_cache_test__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return {
          type: 'localStorage',
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
          removeItem: (key) => localStorage.removeItem(key)
        };
      } catch (err) {
        // ignore and fallback to memory store
      }
    }

    const memoryStore = new Map();
    return {
      type: 'memory',
      getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
      setItem: (key, value) => memoryStore.set(key, value),
      removeItem: (key) => memoryStore.delete(key)
    };
  })();

  const usageStorage = buildStorageDriver();

  let memoryUsage = null;
  let memoryCacheIndex = null;
  let lastRequestTimestamp = 0;
  const usageChannel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel('sncf:usage-sync')
    : null;

  const usageSubscribers = new Set();
  const inFlightRequests = new Map();
  const requestQueue = [];
  let queueActive = false;

  function now() {
    return Date.now();
  }

  function todayIso() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function ensureUsageState() {
    let usage;
    if (usageStorage.type !== 'memory') {
      const raw = usageStorage.getItem(STORAGE_KEYS.usage);
      if (raw) {
        try {
          usage = JSON.parse(raw);
        } catch (err) {
          usage = null;
        }
      }
    } else {
      usage = memoryUsage;
    }

    const today = todayIso();
    if (!usage || usage.date !== today) {
      usage = {
        date: today,
        userRequests: 0,
        apiRequests: 0,
        cacheHits: 0,
        lastReset: now()
      };
    }

    try {
      if (usageStorage.type !== 'memory') {
        usageStorage.setItem(STORAGE_KEYS.usage, JSON.stringify(usage));
      } else {
        memoryUsage = usage;
      }
    } catch (err) {
      memoryUsage = usage;
    }

    return usage;
  }

  function saveUsage(usage) {
    if (!usage) return;
    usage.lastUpdated = now();
    let persisted = false;
    if (usageStorage.type !== 'memory') {
      try {
        usageStorage.setItem(STORAGE_KEYS.usage, JSON.stringify(usage));
        persisted = true;
      } catch (err) {
        // ignore quota errors, fallback to memory only
      }
    }
    if (!persisted) {
      memoryUsage = usage;
    }
    notifyUsageSubscribers();
    if (usageChannel) {
      try {
        usageChannel.postMessage({ type: 'usage-update' });
      } catch (err) {
        // ignore broadcast failures
      }
    }
  }

  function getUsageSnapshot() {
    const usage = ensureUsageState();
    return Object.freeze({
      date: usage.date,
      userRequests: usage.userRequests,
      apiRequests: usage.apiRequests,
      cacheHits: usage.cacheHits,
      lastReset: usage.lastReset,
      lastUpdated: usage.lastUpdated || usage.lastReset,
      remainingQuota: Math.max(0, DAILY_QUOTA - usage.apiRequests),
      cacheSize: getCacheIndex().length
    });
  }

  function notifyUsageSubscribers() {
    const snapshot = getUsageSnapshot();
    usageSubscribers.forEach(cb => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('[SncfApiManager] Usage subscriber error', err);
      }
    });
  }

  function recordUserRequest(count = 1) {
    if (!Number.isFinite(count) || count <= 0) return;
    const usage = ensureUsageState();
    usage.userRequests += count;
    saveUsage(usage);
  }

  function recordApiRequest(count = 1) {
    if (!Number.isFinite(count) || count <= 0) return;
    const usage = ensureUsageState();
    usage.apiRequests += count;
    saveUsage(usage);
  }

  function recordCacheHit(count = 1) {
    if (!Number.isFinite(count) || count <= 0) return;
    const usage = ensureUsageState();
    usage.cacheHits += count;
    saveUsage(usage);
  }

  function parseTargetDate({ isoDate, ymdDate }) {
    const raw = isoDate || ymdDate;
    if (!raw) return null;
    let normalized = raw;
    if (/^\d{8}$/.test(raw)) {
      normalized = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  function minutesToMs(minutes) {
    return Math.max(MS_PER_MINUTE, minutes * MS_PER_MINUTE);
  }

  function getSameDayIntervalMinutes(requestDate) {
    if (!(requestDate instanceof Date)) {
      return NIGHT_INTERVAL_MINUTES;
    }
    const minutes = requestDate.getHours() * 60 + requestDate.getMinutes();
    for (const window of SAME_DAY_WINDOWS) {
      if (minutes >= window.startMinutes && minutes < window.endMinutes) {
        return window.intervalMinutes;
      }
    }
    return NIGHT_INTERVAL_MINUTES;
  }

  function computeCachePolicy({ isoDate, ymdDate, requestDate = new Date() }) {
    const targetDate = parseTargetDate({ isoDate, ymdDate });
    if (!targetDate) {
      const fallback = minutesToMs(5);
      return { intervalMs: fallback, ttlMs: fallback, diffDays: null };
    }

    const startOfRequestDay = new Date(
      requestDate.getFullYear(),
      requestDate.getMonth(),
      requestDate.getDate()
    );
    const diffDays = Math.round((targetDate - startOfRequestDay) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) {
      const intervalMinutes = getSameDayIntervalMinutes(requestDate);
      const intervalMs = minutesToMs(intervalMinutes);
      return { intervalMs, ttlMs: intervalMs, diffDays };
    }

    if (diffDays === 1) {
      const intervalMs = minutesToMs(NEXT_DAY_INTERVAL_MINUTES);
      return { intervalMs, ttlMs: intervalMs, diffDays };
    }

    if (diffDays > 1) {
      const intervalMs = minutesToMs(FUTURE_DAY_INTERVAL_MINUTES);
      return { intervalMs, ttlMs: intervalMs, diffDays };
    }

    const intervalMs = minutesToMs(PAST_DAY_INTERVAL_MINUTES);
    return { intervalMs, ttlMs: intervalMs, diffDays };
  }

  function getCacheIndex() {
    if (cacheStorage.type === 'localStorage') {
      try {
        const raw = cacheStorage.getItem(STORAGE_KEYS.cacheIndex);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (err) {
        // ignore
      }
    } else if (memoryCacheIndex) {
      return memoryCacheIndex;
    }
    return [];
  }

  function saveCacheIndex(index) {
    if (!Array.isArray(index)) index = [];
    if (cacheStorage.type === 'localStorage') {
      try {
        cacheStorage.setItem(STORAGE_KEYS.cacheIndex, JSON.stringify(index));
      } catch (err) {
        // ignore storage quota issues
      }
    } else {
      memoryCacheIndex = index;
    }
  }

  function buildCacheKey(trainNumber, isoDate, ymdDate) {
    const normalizedDate = isoDate || (ymdDate && /^\d{8}$/.test(ymdDate)
      ? `${ymdDate.slice(0, 4)}-${ymdDate.slice(4, 6)}-${ymdDate.slice(6, 8)}`
      : ymdDate || 'unknown');
    return `${CACHE_PREFIX}${normalizedDate}:${trainNumber}`;
  }

  function getCacheEntry(key) {
    if (!key) return null;
    const raw = cacheStorage.getItem(key);
    if (!raw) return null;

    let entry;
    try {
      entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      cacheStorage.removeItem(key);
      return null;
    }

    if (!entry || typeof entry !== 'object') {
      cacheStorage.removeItem(key);
      return null;
    }

    if (entry.expiresAt && entry.expiresAt <= now()) {
      removeCacheEntry(key);
      return null;
    }

    return entry;
  }

  function setCacheEntry(key, entry) {
    if (!key || !entry) return;
    const payload = JSON.stringify(entry);
    if (cacheStorage.type === 'localStorage') {
      try {
        cacheStorage.setItem(key, payload);
      } catch (err) {
        // si quota dépassé, on essaie de purger et réessayer une fois
        trimCache(Math.max(20, Math.floor(CACHE_LIMIT * 0.8)));
        try {
          cacheStorage.setItem(key, payload);
        } catch (err2) {
          // abandonne silencieusement
        }
      }
    } else {
      cacheStorage.setItem(key, payload);
    }

    const index = getCacheIndex().filter(item => item.key !== key);
    index.push({ key, createdAt: entry.createdAt || now() });
    saveCacheIndex(index);
  }

  function removeCacheEntry(key) {
    if (!key) return;
    cacheStorage.removeItem(key);
    const index = getCacheIndex().filter(item => item.key !== key);
    saveCacheIndex(index);
  }

  function trimCache(limit = CACHE_LIMIT) {
    const index = getCacheIndex();
    if (index.length <= limit) return;
    index.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    while (index.length > limit) {
      const entry = index.shift();
      if (entry?.key) {
        cacheStorage.removeItem(entry.key);
      }
    }
    saveCacheIndex(index);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getLastRequestTimestamp() {
    if (lastRequestTimestamp) return lastRequestTimestamp;
    if (cacheStorage.type === 'localStorage') {
      const raw = cacheStorage.getItem(STORAGE_KEYS.lastRequestAt);
      if (raw) lastRequestTimestamp = Number(raw) || 0;
    }
    return lastRequestTimestamp;
  }

  function updateLastRequestTimestamp(ts) {
    lastRequestTimestamp = ts;
    if (cacheStorage.type === 'localStorage') {
      try {
        cacheStorage.setItem(STORAGE_KEYS.lastRequestAt, String(ts));
      } catch (err) {
        // ignore
      }
    }
  }

  function parseCacheKey(key) {
    if (!key || typeof key !== 'string') return null;
    if (!key.startsWith(CACHE_PREFIX)) return null;
    const raw = key.slice(CACHE_PREFIX.length);
    const parts = raw.split(':');
    if (parts.length < 2) return null;
    const isoDate = parts[0];
    const trainNumber = parts.slice(1).join(':');
    return { isoDate, trainNumber };
  }

  function getCacheSnapshot() {
    const index = getCacheIndex();
    const rows = [];
    index.forEach(entry => {
      if (!entry?.key) return;
      const meta = parseCacheKey(entry.key);
      if (!meta) return;
      const cached = getCacheEntry(entry.key);
      if (!cached || !cached.data) return;
      rows.push({
        key: entry.key,
        trainNumber: meta.trainNumber,
        isoDate: meta.isoDate,
        createdAt: cached.createdAt || entry.createdAt || null,
        expiresAt: cached.expiresAt || null,
        policy: cached.policy || null
      });
    });
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return rows;
  }

  function computeGlobalThrottleDelay(elapsedMs) {
    try {
      const usage = ensureUsageState();
      const remainingRequests = Math.max(0, DAILY_QUOTA - usage.apiRequests);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const millisLeft = Math.max(0, endOfDay.getTime() - now());

      let dynamicCap = MAX_GLOBAL_WAIT_MS;
      if (remainingRequests <= 250) {
        dynamicCap = Math.max(dynamicCap, MIN_INTERVAL_MS);
      }
      if (remainingRequests <= 50) {
        dynamicCap = Math.max(dynamicCap, 5 * 60 * 1000);
      }

      const ideal = (remainingRequests > 0 && millisLeft > 0)
        ? millisLeft / remainingRequests
        : dynamicCap;
      const boundedTarget = Math.min(dynamicCap, Math.max(MIN_BURST_INTERVAL_MS, ideal));
      const wait = boundedTarget - (elapsedMs || 0);
      return wait > 0 ? wait : 0;
    } catch (err) {
      return Math.max(0, MIN_BURST_INTERVAL_MS - (elapsedMs || 0));
    }
  }

  async function scheduleNetworkCall(task) {
    return new Promise((resolve, reject) => {
      requestQueue.push({ task, resolve, reject });
      processQueue();
    });
  }

  async function processQueue() {
    if (queueActive) return;
    queueActive = true;
    try {
      while (requestQueue.length > 0) {
        const item = requestQueue.shift();
        if (!item) continue;
        const { task, resolve, reject } = item;
        const elapsed = now() - getLastRequestTimestamp();
        const burstGap = Math.max(0, MIN_BURST_INTERVAL_MS - elapsed);
        const quotaGap = computeGlobalThrottleDelay(elapsed);
        const waitMs = Math.max(burstGap, quotaGap);
        if (waitMs > 0) {
          await delay(waitMs);
        }
        try {
          const result = await task();
          updateLastRequestTimestamp(now());
          resolve(result);
        } catch (err) {
          updateLastRequestTimestamp(now());
          reject(err);
        }
      }
    } finally {
      queueActive = false;
    }
  }

  function subscribeToUsage(callback) {
    if (typeof callback !== 'function') return () => {};
    usageSubscribers.add(callback);
    try {
      callback(getUsageSnapshot());
    } catch (err) {
      console.error('[SncfApiManager] Usage subscriber init error', err);
    }
    return () => usageSubscribers.delete(callback);
  }

  if (typeof window !== 'undefined' && (cacheStorage.type === 'localStorage' || usageStorage.type === 'localStorage')) {
    window.addEventListener('storage', (event) => {
      if (!event) return;
      if (event.key === STORAGE_KEYS.lastRequestAt) {
        lastRequestTimestamp = Number(event.newValue) || 0;
      }
      if (event.key === STORAGE_KEYS.usage) {
        notifyUsageSubscribers();
      }
    });
  }

  if (usageChannel) {
    usageChannel.addEventListener('message', (event) => {
      if (!event || event.data?.type !== 'usage-update') return;
      notifyUsageSubscribers();
    });
  }

  async function fetchVehicleJourney({
    url,
    trainNumber,
    isoDate,
    ymdDate,
    signal
  }) {
    if (!trainNumber) {
      throw new Error('trainNumber requis');
    }

    // On loggue la demande UTILISATEUR tout de suite (c'est rapide, local)
    recordUserRequest(1);

    // 1. TENTE LE CACHE DIRECT
    const cacheKey = buildCacheKey(trainNumber, isoDate, ymdDate);
    const cachedEntry = getCacheEntry(cacheKey);
    if (cachedEntry && cachedEntry.data) {
      // <- IMPORTANT : ici on répond tout de suite, pas de throttle, pas d'attente
      recordCacheHit(1);
      return {
        data: cachedEntry.data,
        fromCache: true,
        cacheTimestamp: cachedEntry.createdAt,
        expiresAt: cachedEntry.expiresAt,
        enforcedIntervalMs: cachedEntry.policy?.intervalMs || null,
        targetDiffDays: cachedEntry.policy?.diffDays ?? null
      };
    }

    // 2. DÉDUP ENTRE ONGLETS / APPELS CONCURRENTS
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }

    // -- fonction qui fait VRAIMENT le fetch au réseau protégée par le throttle --
    const fetchTask = async () => {
      if (signal?.aborted) {
        const abortErr = new DOMException('Aborted', 'AbortError');
        throw abortErr;
      }
      const headers = {};
      if (typeof getSncfAuthHeader === 'function') {
        headers['Authorization'] = getSncfAuthHeader();
      }
      const response = await fetch(url, {
        headers,
        cache: 'no-store',
        signal
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.statusText = response.statusText;
        throw error;
      }
      return response.json();
    };

    // 3. ON LANCE UNE PROMESSE QUI :
    //    - attend le throttle + fetch réseau
    //    - RENVOIE LA DATA IMMÉDIATEMENT À L'APPELANT
    //    - puis fait la mise à jour du compteur / cache en arrière-plan
    const immediatePromise = (async () => {
      // a) on respecte encore l'anti-burst, quota, etc.
      const data = await scheduleNetworkCall(fetchTask);

      // b) on renvoie le résultat tout de suite à l'appelant
      //    (=> la page peut remplir le tableau)
      const result = {
        data,
        fromCache: false,
        cacheTimestamp: now(),
        expiresAt: null,            // on mettra à jour juste après
        enforcedIntervalMs: null,   // idem
        targetDiffDays: null
      };

      // c) post-traitement async non bloquant UI
      //    NOTE: pas d'await ici
      queueMicrotask(() => {
        try {
          // on marque que c'était bien un hit API réelle
          recordApiRequest(1);

          const policy = computeCachePolicy({ isoDate, ymdDate, requestDate: new Date() });
          const createdAt = now();
          const ttl = Math.max(MS_PER_MINUTE, policy.ttlMs || 0);

          const entry = {
            createdAt,
            expiresAt: createdAt + ttl,
            data,
            policy: {
              intervalMs: policy.intervalMs,
              ttlMs: ttl,
              diffDays: policy.diffDays
            }
          };

          setCacheEntry(cacheKey, entry);
          trimCache();

          // mets à jour les champs qu'on avait pas encore
          result.cacheTimestamp = entry.createdAt;
          result.expiresAt = entry.expiresAt;
          result.enforcedIntervalMs = policy.intervalMs;
          result.targetDiffDays = policy.diffDays;
        } catch (err) {
          // le post-processing a raté ? pas grave pour l'affichage du tableau
          console.error('[SncfApiManager] post-cache update failed', err);
        } finally {
          inFlightRequests.delete(cacheKey);
        }
      });

      return result;
    })();

    inFlightRequests.set(cacheKey, immediatePromise);
    return immediatePromise;
  }
  
  function clearCache() {
    const index = getCacheIndex();
    index.forEach(entry => {
      if (entry?.key) {
        cacheStorage.removeItem(entry.key);
      }
    });
    saveCacheIndex([]);
  }

  const api = Object.freeze({
    DAILY_QUOTA,
    MIN_INTERVAL_MS,
    fetchVehicleJourney,
    getCachePolicy: computeCachePolicy,
    getUsageSnapshot,
    subscribeToUsage,
    clearCache,
    getCacheSnapshot
  });

  global.SncfApiManager = api;
})(typeof window !== 'undefined' ? window : globalThis);
