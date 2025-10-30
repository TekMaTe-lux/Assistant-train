const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(process.env.SNCF_CACHE_TTL_SECONDS || '', 10) || 300;
const CACHE_MAX_ENTRIES = Number.parseInt(process.env.SNCF_CACHE_MAX_ENTRIES || '', 10) || 250;

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

function createEmptyCache() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: {}
  };
}

function normaliseCache(raw) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyCache();
  }

  const safe = {
    version: Number.isFinite(raw.version) ? raw.version : 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    entries: {}
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
    throw new Error(`GitHub cache update failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.content?.sha || sha || null;
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

  let cacheState = 'BYPASS';
  let cachePayload = { cache: createEmptyCache(), sha: null };
  let cacheEnabled = Boolean(githubConfig);

  if (githubConfig) {
    try {
      cachePayload = await loadGithubCache(githubConfig);
    } catch (err) {
      console.error('[sncf-cache] Impossible de charger le cache GitHub', err);
      cacheEnabled = false;
    }
  }

  const cache = cachePayload.cache || createEmptyCache();
  let sha = cachePayload.sha || null;

  if (cacheEnabled) {
    const existing = cache.entries?.[buildCacheKey(cacheKey)];
    if (isEntryValid(existing, nowMs)) {
      cacheState = 'HIT';
      res.setHeader('X-Sncf-Cache-State', cacheState);
      res.setHeader('X-Sncf-Cache-Expires', existing.expiresAt);
      return res.status(200).json(existing.data);
    }
  }

  try {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Erreur API SNCF : ${response.statusText}` });
    }

    const data = await response.json();
    cacheState = cacheEnabled ? 'MISS' : 'BYPASS';
    res.setHeader('X-Sncf-Cache-State', cacheState);
    res.setHeader('X-Sncf-Cache-Expires', new Date(nowMs + ttlSeconds * 1000).toISOString());
    res.status(200).json(data);

    if (cacheEnabled) {
      try {
        const entry = {
          data,
          fetchedAt: nowIso,
          expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
          ttlSeconds,
          meta: {
            cacheKey: buildCacheKey(cacheKey)
          }
        };

        cache.entries[buildCacheKey(cacheKey)] = entry;
        cache.updatedAt = nowIso;
        trimCacheEntries(cache, CACHE_MAX_ENTRIES);
        sha = await persistGithubCache(githubConfig, cache, sha);
      } catch (persistErr) {
        console.error('[sncf-cache] Impossible d\'enregistrer le cache GitHub', persistErr);
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du proxy SNCF', details: err.message });
  }
}
