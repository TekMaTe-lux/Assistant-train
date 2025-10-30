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
sncf-usage-dashboard.html
Nouveau
+267-0
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suivi des appels SNCF</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #050911;
      --panel: #0b1324;
      --accent: #00f0ff;
      --accent-soft: rgba(0, 240, 255, 0.18);
      --text: #e0f0ff;
      --muted: #7ea0c8;
      --danger: #ff5c8a;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 32px 16px 48px;
      font-family: 'Orbitron', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: radial-gradient(circle at top left, rgba(0, 240, 255, 0.08), transparent 55%), var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
    }

    h1 {
      font-size: clamp(1.8rem, 2.8vw, 2.6rem);
      margin: 0;
      text-align: center;
      text-shadow: 0 0 16px rgba(0, 240, 255, 0.65);
    }

    .panels {
      width: min(960px, 100%);
      display: grid;
      gap: 24px;
    }

    @media (min-width: 720px) {
      .panels {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .card {
      background: linear-gradient(145deg, rgba(11, 19, 36, 0.92), rgba(9, 15, 27, 0.75));
      border-radius: 18px;
      padding: 24px;
      box-shadow: inset 0 0 24px rgba(0, 240, 255, 0.08), 0 12px 38px rgba(0, 0, 0, 0.45);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: "";
      position: absolute;
      inset: -120px -80px auto auto;
      width: 220px;
      height: 220px;
      background: radial-gradient(circle, rgba(0, 240, 255, 0.35), transparent 70%);
      opacity: 0.8;
      pointer-events: none;
    }

    .card h2 {
      margin: 0 0 18px;
      font-size: 1.1rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .metric {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(0, 240, 255, 0.15);
    }

    .metric:last-child {
      border-bottom: none;
    }

    .metric span.label {
      font-size: 0.85rem;
      color: var(--muted);
      letter-spacing: 0.04em;
    }

    .metric span.value {
      font-size: clamp(1.4rem, 2.2vw, 2.1rem);
      font-weight: 600;
      color: var(--text);
    }

    .metric span.value.danger {
      color: var(--danger);
    }

    .remaining-bar {
      position: relative;
      margin-top: 18px;
      height: 12px;
      border-radius: 6px;
      background: rgba(0, 240, 255, 0.12);
      overflow: hidden;
    }

    .remaining-bar::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(0, 240, 255, 0.65), rgba(0, 240, 255, 0.15));
      width: var(--progress, 0%);
      transition: width 0.4s ease;
    }

    .meta {
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
      letter-spacing: 0.05em;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    button {
      font-family: inherit;
      padding: 10px 18px;
      border-radius: 999px;
      border: 1px solid rgba(0, 240, 255, 0.35);
      background: rgba(0, 240, 255, 0.08);
      color: var(--text);
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 22px rgba(0, 240, 255, 0.16);
    }

    button:active {
      transform: translateY(0);
    }

    footer {
      margin-top: auto;
      font-size: 0.75rem;
      color: rgba(224, 240, 255, 0.55);
      text-align: center;
      max-width: 720px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>Compteur quotidien des appels SNCF</h1>

  <div class="panels">
    <section class="card" aria-labelledby="calls-title">
      <h2 id="calls-title">Volume utilisateurs</h2>
      <div class="metric"><span class="label">Trains demandés aujourd'hui</span><span class="value" id="user-requests">0</span></div>
      <div class="metric"><span class="label">Réponses servies via cache</span><span class="value" id="cache-hits">0</span></div>
      <div class="metric"><span class="label">Requêtes API SNCF effectuées</span><span class="value" id="api-requests">0</span></div>
      <div class="remaining-bar" id="quota-bar"></div>
    </section>

    <section class="card" aria-labelledby="quota-title">
      <h2 id="quota-title">Quota journalier</h2>
      <div class="metric"><span class="label">Quota total</span><span class="value">5000</span></div>
      <div class="metric"><span class="label">Requêtes restantes</span><span class="value" id="remaining-quota">5000</span></div>
      <div class="metric"><span class="label">Intervalle minimum</span><span class="value" id="min-interval">0 s</span></div>
      <div class="metric"><span class="label">Dernière mise à jour</span><span class="value" id="last-updated">--:--</span></div>
    </section>
  </div>

  <div class="actions">
    <button type="button" id="refresh">Actualiser</button>
    <button type="button" id="clear-cache">Vider le cache local</button>
  </div>

  <p class="meta" id="meta-text"></p>

  <footer>
    Compteur synchronisé sur ce navigateur. Les valeurs se remettent à zéro automatiquement à minuit (heure locale) et se basent uniquement sur les requêtes réellement envoyées depuis cette interface sans passer par Vercel.
  </footer>

  <script src="sncf-api-key.js"></script>
  <script src="sncf-api-manager.js"></script>
  <script>
    const dailyQuota = (window.SncfApiManager && window.SncfApiManager.DAILY_QUOTA) || 5000;
    const minIntervalMs = (window.SncfApiManager && window.SncfApiManager.MIN_INTERVAL_MS) || Math.ceil((24 * 60 * 60 * 1000) / dailyQuota);

    function formatTime(ts) {
      if (!Number.isFinite(ts)) return '--:--';
      const date = new Date(ts);
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function updateView(snapshot) {
      if (!snapshot) return;
      document.getElementById('user-requests').textContent = snapshot.userRequests.toLocaleString('fr-FR');
      document.getElementById('api-requests').textContent = snapshot.apiRequests.toLocaleString('fr-FR');
      document.getElementById('cache-hits').textContent = snapshot.cacheHits.toLocaleString('fr-FR');
      document.getElementById('remaining-quota').textContent = snapshot.remainingQuota.toLocaleString('fr-FR');
      document.getElementById('last-updated').textContent = formatTime(snapshot.lastUpdated);

      const ratio = Math.max(0, Math.min(1, 1 - snapshot.apiRequests / dailyQuota));
      document.getElementById('quota-bar').style.setProperty('--progress', `${ratio * 100}%`);

      const meta = `Jour suivi : ${snapshot.date} — Réinitialisation automatique : ${formatTime(snapshot.lastReset)}`;
      document.getElementById('meta-text').textContent = meta;
    }

    document.getElementById('min-interval').textContent = `${(minIntervalMs / 1000).toFixed(1)} s`;

    document.getElementById('refresh').addEventListener('click', () => {
      if (window.SncfApiManager) {
        updateView(window.SncfApiManager.getUsageSnapshot());
      }
    });

    document.getElementById('clear-cache').addEventListener('click', () => {
      if (window.SncfApiManager && typeof window.SncfApiManager.clearCache === 'function') {
        window.SncfApiManager.clearCache();
        updateView(window.SncfApiManager.getUsageSnapshot());
        alert('Cache local vidé.');
      }
    });

    if (window.SncfApiManager && typeof window.SncfApiManager.subscribeToUsage === 'function') {
      window.SncfApiManager.subscribeToUsage(updateView);
    } else {
      updateView({
        date: new Date().toISOString().slice(0, 10),
        userRequests: 0,
        apiRequests: 0,
        cacheHits: 0,
        remainingQuota: dailyQuota,
        lastUpdated: Date.now(),
        lastReset: Date.now()
      });
    }
  </script>
</body>
</html>
