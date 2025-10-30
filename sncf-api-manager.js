(function (global) {
  'use strict';

  const DAILY_QUOTA = 5000;
  const MIN_INTERVAL_MS = Math.ceil((24 * 60 * 60 * 1000) / DAILY_QUOTA);
  const CACHE_LIMIT = 150;

  const STORAGE_KEYS = {
    usage: 'sncf:usage-tracking',
    cacheIndex: 'sncf:journey-cache:index',
    lastRequestAt: 'sncf:last-request-at'
  };

  const CACHE_PREFIX = 'sncf:journey-cache:';

  const storageAvailable = (() => {
    try {
      if (typeof localStorage === 'undefined') return false;
      const testKey = '__sncf_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  })();

  const memoryCache = new Map();
  let memoryUsage = null;
  let memoryCacheIndex = null;
  let lastRequestTimestamp = 0;

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
    if (storageAvailable) {
      const raw = localStorage.getItem(STORAGE_KEYS.usage);
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

    if (storageAvailable) {
      localStorage.setItem(STORAGE_KEYS.usage, JSON.stringify(usage));
    } else {
      memoryUsage = usage;
    }

    return usage;
  }

  function saveUsage(usage) {
    if (!usage) return;
    usage.lastUpdated = now();
    if (storageAvailable) {
      try {
        localStorage.setItem(STORAGE_KEYS.usage, JSON.stringify(usage));
      } catch (err) {
        // ignore quota errors, fallback to memory only
      }
    } else {
      memoryUsage = usage;
    }
    notifyUsageSubscribers();
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
      remainingQuota: Math.max(0, DAILY_QUOTA - usage.apiRequests)
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

  function computeCacheTTL({ isoDate, ymdDate }) {
    const targetDate = parseTargetDate({ isoDate, ymdDate });
    const nowDate = new Date();
    if (!targetDate) {
      return 5 * 60 * 1000; // défaut 5 min
    }

    const startOfNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const diffDays = Math.round((targetDate - startOfNow) / (24 * 60 * 60 * 1000));

    if (diffDays > 1) {
      return 6 * 60 * 60 * 1000; // J+2 et plus : 6h
    }
    if (diffDays === 1) {
      return 60 * 60 * 1000; // J+1 : 1h
    }
    if (diffDays < 0) {
      return 30 * 60 * 1000; // dates passées : 30 min
    }

    const minutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const isMorningPeak = minutes >= (6 * 60) && minutes < (9 * 60);
    const isEveningPeak = minutes >= (16 * 60) && minutes < (19 * 60);

    if (isMorningPeak || isEveningPeak) {
      return 90 * 1000; // heures de pointe : 1 min 30
    }

    return 5 * 60 * 1000; // reste de la journée : 5 min
  }

  function getCacheIndex() {
    if (storageAvailable) {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.cacheIndex);
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
    if (storageAvailable) {
      try {
        localStorage.setItem(STORAGE_KEYS.cacheIndex, JSON.stringify(index));
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
    let raw;
    if (storageAvailable) {
      raw = localStorage.getItem(key);
    } else {
      raw = memoryCache.get(key);
    }
    if (!raw) return null;

    let entry;
    try {
      entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      if (storageAvailable) localStorage.removeItem(key);
      else memoryCache.delete(key);
      return null;
    }

    if (!entry || typeof entry !== 'object') {
      if (storageAvailable) localStorage.removeItem(key);
      else memoryCache.delete(key);
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
    if (storageAvailable) {
      try {
        localStorage.setItem(key, payload);
      } catch (err) {
        // si quota dépassé, on essaie de purger et réessayer une fois
        trimCache(Math.max(20, Math.floor(CACHE_LIMIT * 0.8)));
        try {
          localStorage.setItem(key, payload);
        } catch (err2) {
          // abandonne silencieusement
        }
      }
    } else {
      memoryCache.set(key, payload);
    }

    const index = getCacheIndex().filter(item => item.key !== key);
    index.push({ key, createdAt: entry.createdAt || now() });
    saveCacheIndex(index);
  }

  function removeCacheEntry(key) {
    if (!key) return;
    if (storageAvailable) {
      localStorage.removeItem(key);
    } else {
      memoryCache.delete(key);
    }
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
        if (storageAvailable) {
          localStorage.removeItem(entry.key);
        } else {
          memoryCache.delete(entry.key);
        }
      }
    }
    saveCacheIndex(index);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getLastRequestTimestamp() {
    if (lastRequestTimestamp) return lastRequestTimestamp;
    if (storageAvailable) {
      const raw = localStorage.getItem(STORAGE_KEYS.lastRequestAt);
      if (raw) lastRequestTimestamp = Number(raw) || 0;
    }
    return lastRequestTimestamp;
  }

  function updateLastRequestTimestamp(ts) {
    lastRequestTimestamp = ts;
    if (storageAvailable) {
      try {
        localStorage.setItem(STORAGE_KEYS.lastRequestAt, String(ts));
      } catch (err) {
        // ignore
      }
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
        const waitMs = Math.max(0, MIN_INTERVAL_MS - elapsed);
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

  if (typeof window !== 'undefined' && storageAvailable) {
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

    recordUserRequest(1);

    const cacheKey = buildCacheKey(trainNumber, isoDate, ymdDate);
    const cachedEntry = getCacheEntry(cacheKey);
    if (cachedEntry && cachedEntry.data) {
      recordCacheHit(1);
      return {
        data: cachedEntry.data,
        fromCache: true,
        cacheTimestamp: cachedEntry.createdAt,
        expiresAt: cachedEntry.expiresAt
      };
    }

    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }

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

    const scheduledPromise = scheduleNetworkCall(fetchTask)
      .then(data => {
        recordApiRequest(1);
        const ttl = computeCacheTTL({ isoDate, ymdDate });
        const entry = {
          createdAt: now(),
          expiresAt: now() + ttl,
          data
        };
        setCacheEntry(cacheKey, entry);
        trimCache();
        return {
          data,
          fromCache: false,
          cacheTimestamp: entry.createdAt,
          expiresAt: entry.expiresAt
        };
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      })
      .catch(err => {
        throw err;
      });

    inFlightRequests.set(cacheKey, scheduledPromise);
    return scheduledPromise;
  }

  function clearCache() {
    const index = getCacheIndex();
    index.forEach(entry => {
      if (entry?.key) {
        if (storageAvailable) localStorage.removeItem(entry.key);
        else memoryCache.delete(entry.key);
      }
    });
    saveCacheIndex([]);
  }

  const api = Object.freeze({
    DAILY_QUOTA,
    MIN_INTERVAL_MS,
    fetchVehicleJourney,
    getUsageSnapshot,
    subscribeToUsage,
    clearCache
  });

  global.SncfApiManager = api;
})(typeof window !== 'undefined' ? window : globalThis);
