const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(process.env.SNCF_CACHE_TTL_SECONDS || '', 10) || 300;
const CACHE_MAX_ENTRIES = Number.parseInt(process.env.SNCF_CACHE_MAX_ENTRIES || '', 10) || 250;
const DAILY_QUOTA = Number.parseInt(process.env.SNCF_DAILY_QUOTA || '', 10) || 5000;
const MAX_GITHUB_PERSIST_ATTEMPTS = Number.parseInt(process.env.GITHUB_CACHE_MAX_ATTEMPTS || '', 10) || 3;

const githubConfig = (() => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_TOKEN;
  const repoEnv = process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || '';
  const [fallbackOwner, fallbackRepo] = repoEnv.split('/');

  const owner = process.env.GITHUB_OWNER || fallbackOwner || '';
  const repo = fallbackRepo || '';
  const path = (process.env.GITHUB_CACHE_PATH || 'data/shared-sncf-cache.json').replace(/^\/+/, '');
  const branch = process.env.GITHUB_CACHE_BRANCH || process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo || !path) {
    return null;
  }

  return { token, owner, repo, path, branch };
})();

function buildGithubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'sncf-shared-cache-proxy',
    Accept: 'application/vnd.github+json'
  };
}

function isoDateFromMs(ms) {
  const date = new Date(ms);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function createEmptyUsage(nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  return {
    date: isoDateFromMs(nowMs),
    userRequests: 0,
    apiRequests: 0,
    cacheHits: 0,
    lastReset: nowIso,
    lastUpdated: nowIso
  };
}

function createEmptyCache(nowMs = Date.now()) {
  return {
    version: 2,
    updatedAt: new Date(nowMs).toISOString(),
    entries: {},
    usage: createEmptyUsage(nowMs)
  };
}

function normaliseUsage(raw, nowMs = Date.now()) {
  const base = createEmptyUsage(nowMs);
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const safe = {
    date: typeof raw.date === 'string' && raw.date ? raw.date : base.date,
    userRequests: Number.isFinite(raw.userRequests) ? raw.userRequests : 0,
    apiRequests: Number.isFinite(raw.apiRequests) ? raw.apiRequests : 0,
    cacheHits: Number.isFinite(raw.cacheHits) ? raw.cacheHits : 0,
    lastReset: typeof raw.lastReset === 'string' ? raw.lastReset : base.lastReset,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : base.lastUpdated
  };

  const today = isoDateFromMs(nowMs);
  if (safe.date !== today) {
    safe.date = today;
    safe.userRequests = 0;
    safe.apiRequests = 0;
    safe.cacheHits = 0;
    safe.lastReset = base.lastReset;
  }

  if (!safe.lastUpdated) {
    safe.lastUpdated = base.lastUpdated;
  }

  return safe;
}

function normaliseCache(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyCache(nowMs);
  }

  const safe = {
    version: Number.isFinite(raw.version) ? raw.version : 2,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(nowMs).toISOString(),
    entries: {},
    usage: createEmptyUsage(nowMs)
  };

  if (raw.entries && typeof raw.entries === 'object') {
    for (const [key, value] of Object.entries(raw.entries)) {
      if (!value || typeof value !== 'object') continue;
      safe.entries[key] = {
        data: value.data,
        fetchedAt: value.fetchedAt || value.createdAt || new Date(0).toISOString(),
        expiresAt: value.expiresAt || null,
        ttlSeconds: Number.isFinite(value.ttlSeconds) ? value.ttlSeconds : null,
        meta: value.meta && typeof value.meta === 'object' ? value.meta : {}
      };
    }
  }

  safe.usage = normaliseUsage(raw.usage, nowMs);
  
  return safe;
}

async function loadGithubCache(config) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, {
    headers: buildGithubHeaders(config.token)
  });

  if (response.status === 404) {
    return { cache: createEmptyCache(), sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub cache fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const content = payload.content ? Buffer.from(payload.content, payload.encoding || 'base64').toString('utf8') : '';

  let parsed = null;
  if (content && content.trim()) {
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      parsed = null;
    }
  }

  return {
    cache: normaliseCache(parsed),
    sha: payload.sha || null
  };
}

async function persistGithubCache(config, cache, sha) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}`;
  const body = {
    message: `chore(cache): update SNCF shared cache (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(cache, null, 2)).toString('base64'),
    branch: config.branch
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...buildGithubHeaders(config.token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = new Error(`GitHub cache update failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return payload.content?.sha || sha || null;
}

function computeNextUsage(rawUsage, nowMs, deltas) {
  const usage = normaliseUsage(rawUsage, nowMs);
  const next = { ...usage };
  let changed = false;

  const nowIso = new Date(nowMs).toISOString();

  const rawDate = rawUsage && typeof rawUsage === 'object' && typeof rawUsage.date === 'string'
    ? rawUsage.date
    : usage.date;

  if (deltas) {
    const { userRequests = 0, apiRequests = 0, cacheHits = 0 } = deltas;
    if (userRequests) {
      next.userRequests += userRequests;
      changed = true;
    }
    if (apiRequests) {
      next.apiRequests += apiRequests;
      changed = true;
    }
    if (cacheHits) {
      next.cacheHits += cacheHits;
      changed = true;
    }
  }

  if (rawDate !== usage.date) {
    changed = true;
  }

  if (changed) {
    next.lastUpdated = nowIso;
  }

  return { usage: next, changed };
}

function applyUpdatesToCache(cache, nowMs, updates = {}) {
  if (!cache || typeof cache !== 'object') {
    return { changed: false };
  }

  const { usageDelta = null, entry = null } = updates;
  const result = computeNextUsage(cache.usage, nowMs, usageDelta);
  let changed = result.changed;

  if (entry && entry.key) {
    cache.entries[entry.key] = entry.value;
    changed = true;
  }

  if (!changed) {
    return { changed: false, usage: result.usage };
  }

  cache.usage = result.usage;
  cache.updatedAt = new Date(nowMs).toISOString();
  trimCacheEntries(cache, CACHE_MAX_ENTRIES);
  return { changed: true, usage: result.usage };
}

async function persistCacheWithRetry(config, initialPayload, updates, nowMs) {
  if (!config) {
    return null;
  }

  let attempt = 0;
  let payload = initialPayload;
  let lastError = null;

  while (attempt < MAX_GITHUB_PERSIST_ATTEMPTS) {
    const workingPayload = payload || { cache: createEmptyCache(nowMs), sha: null };
    const cache = normaliseCache(workingPayload.cache, nowMs);
    const applyResult = applyUpdatesToCache(cache, nowMs, updates);

    if (!applyResult.changed) {
      return applyResult.usage;
    }

    try {
      const newSha = await persistGithubCache(config, cache, workingPayload.sha);
      payload = { cache, sha: newSha };
      return applyResult.usage;
    } catch (err) {
      lastError = err;
      if (err && (err.status === 409 || err.status === 422)) {
        payload = await loadGithubCache(config);
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Unable to persist GitHub cache');
}

function trimCacheEntries(cache, limit = CACHE_MAX_ENTRIES) {
  const entries = cache.entries || {};
  const keys = Object.keys(entries);
  if (keys.length <= limit) {
    return;
  }

  keys.sort((a, b) => {
    const timeA = new Date(entries[a]?.fetchedAt || 0).getTime();
    const timeB = new Date(entries[b]?.fetchedAt || 0).getTime();
    return timeA - timeB;
  });

  while (keys.length > limit) {
    const key = keys.shift();
    if (key) {
      delete entries[key];
    }
  }
}

function buildCacheKey(input) {
  return input;
}

function isEntryValid(entry, nowMs) {
  if (!entry) return false;
  if (!entry.expiresAt) return false;
  const expiry = new Date(entry.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > nowMs;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader(
    'Access-Control-Expose-Headers',
    [
      'X-Sncf-Cache-State',
      'X-Sncf-Cache-Expires',
      'X-Sncf-Usage-Date',
      'X-Sncf-Usage-Requests',
      'X-Sncf-Usage-ApiRequests',
      'X-Sncf-Usage-CacheHits',
      'X-Sncf-Usage-Updated-At',
      'X-Sncf-Usage-Quota',
      'X-Sncf-Usage-Remaining'
    ].join(', ')
  );
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.SNCF_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Clé API SNCF manquante sur le serveur' });
  }

  const auth = Buffer.from(`${apiKey}:`).toString('base64');

  let apiUrl = null;
  let cacheKey = null;

  if (req.query.id) {
    cacheKey = String(req.query.id);
    apiUrl = `https://api.sncf.com/v1/coverage/sncf/${cacheKey}`;
  } else if (req.query.url) {
    const decoded = decodeURIComponent(req.query.url);
    cacheKey = decoded;
    apiUrl = `https://api.sncf.com/v1/coverage/sncf/${decoded}`;
  } else {
    return res.status(400).json({ error: 'Paramètre "id" ou "url" requis' });
  }

  const ttlParam = Number.parseInt(req.query.ttl, 10);
  const ttlSeconds = Number.isFinite(ttlParam) && ttlParam > 0
    ? Math.min(ttlParam, 24 * 60 * 60)
    : DEFAULT_CACHE_TTL_SECONDS;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let cachePayload = { cache: createEmptyCache(nowMs), sha: null };
  let cacheEnabled = Boolean(githubConfig);

  if (githubConfig) {
    try {
      cachePayload = await loadGithubCache(githubConfig);
    } catch (err) {
      console.error('[sncf-cache] Impossible de charger le cache GitHub', err);
      cacheEnabled = false;
    }
  }

  const cache = cachePayload.cache || createEmptyCache(nowMs);
  const cacheKeyNormalised = buildCacheKey(cacheKey);
  const existing = cache.entries?.[cacheKeyNormalised];

  const usageDelta = { userRequests: 1, apiRequests: 0, cacheHits: 0 };
  let cacheState = cacheEnabled ? 'MISS' : 'BYPASS';
  let cacheExpiresAt = null;
  let entryUpdate = null;
  let responseData = null;
  let responseStatus = 200;
  let responseError = null;

  if (cacheEnabled && isEntryValid(existing, nowMs)) {
    cacheState = 'HIT';
    usageDelta.cacheHits = 1;
    cacheExpiresAt = existing.expiresAt || null;
    responseData = existing.data;
  } else {
    try {
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Basic ${auth}` }
      });

      usageDelta.apiRequests = 1;

      if (!response.ok) {
        responseStatus = response.status;
        responseError = { error: `Erreur API SNCF : ${response.statusText}` };
      } else {
        const data = await response.json();
        responseData = data;
        cacheExpiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
        if (cacheEnabled) {
          entryUpdate = {
            key: cacheKeyNormalised,
            value: {
              data,
              fetchedAt: nowIso,
              expiresAt: cacheExpiresAt,
              ttlSeconds,
              meta: { cacheKey: cacheKeyNormalised }
            }
          };
        }
      }
    } catch (err) {
      usageDelta.apiRequests = 1;
      responseStatus = 500;
      responseError = { error: 'Erreur interne du proxy SNCF', details: err.message };
      console.error('[sncf-cache] Échec de récupération auprès de l\'API SNCF', err);
    }
  }

  let sharedUsage = computeNextUsage(cache.usage, nowMs, usageDelta).usage;

  if (cacheEnabled) {
    try {
      const persisted = await persistCacheWithRetry(
        githubConfig,
        cachePayload,
        { usageDelta, entry: entryUpdate },
        nowMs
      );
      if (persisted) {
        sharedUsage = persisted;
      }
    } catch (persistErr) {
      console.error('[sncf-cache] Impossible d\'enregistrer le cache GitHub', persistErr);
    }
  }

  res.setHeader('X-Sncf-Cache-State', cacheState);
  if (cacheExpiresAt) {
    res.setHeader('X-Sncf-Cache-Expires', cacheExpiresAt);
  }

    if (sharedUsage) {
    res.setHeader('X-Sncf-Usage-Date', sharedUsage.date);
    res.setHeader('X-Sncf-Usage-Requests', String(sharedUsage.userRequests));
    res.setHeader('X-Sncf-Usage-ApiRequests', String(sharedUsage.apiRequests));
    res.setHeader('X-Sncf-Usage-CacheHits', String(sharedUsage.cacheHits));
    res.setHeader('X-Sncf-Usage-Updated-At', sharedUsage.lastUpdated || nowIso);
    res.setHeader('X-Sncf-Usage-Quota', String(DAILY_QUOTA));
    res.setHeader(
      'X-Sncf-Usage-Remaining',
      String(Math.max(0, DAILY_QUOTA - (sharedUsage.apiRequests || 0)))
    );
  }
  
if (responseError) {
    return res.status(responseStatus).json(responseError);
  }

  return res.status(responseStatus).json(responseData);
}
