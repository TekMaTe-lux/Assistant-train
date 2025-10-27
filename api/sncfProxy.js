const DAILY_LIMIT = 5000;
const LONG_TERM_LIMIT = 40;
const LONG_TERM_TTL_MINUTES = 12 * 60; // 12 hours
const TIMEZONE = 'Europe/Paris';

const state = globalThis.__SNCF_PROXY_STATE__ || (globalThis.__SNCF_PROXY_STATE__ = {
  cache: new Map(),
  counters: { dayKey: null, total: 0, longTerm: 0 },
  lastPrune: 0
});

function getTimeZoneOffset(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return Date.UTC(
    Number.parseInt(map.year, 10),
    Number.parseInt(map.month, 10) - 1,
    Number.parseInt(map.day, 10),
    Number.parseInt(map.hour, 10),
    Number.parseInt(map.minute, 10),
    Number.parseInt(map.second, 10)
  ) - date.getTime();
}

function zonedTimeToUtc(dayKey, time, timeZone) {
  const [year, month, day] = dayKey.split('-').map(v => Number.parseInt(v, 10));
  const [hour, minute] = time.split(':').map(v => Number.parseInt(v, 10));
  if ([year, month, day, hour, minute].some(v => !Number.isFinite(v))) return null;
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offset);
}

function getLocalInfo(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const dayKey = `${map.year}-${map.month}-${map.day}`;
  const hour = Number.parseInt(map.hour, 10);
  const minute = Number.parseInt(map.minute, 10);
  const second = Number.parseInt(map.second, 10);
  return {
    dayKey,
    hour,
    minute,
    second,
    minutes: (hour * 60) + minute,
    isoLocal: `${dayKey}T${map.hour}:${map.minute}:${map.second}`
  };
}

function parseYMD(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  return new Date(Date.UTC(year, month, day));
}

function addDays(dayKey, amount) {
  const base = parseYMD(dayKey);
  if (!base) return null;
  const next = new Date(base.getTime() + amount * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(next);
}

function diffDays(target, base) {
  const targetDate = parseYMD(target);
  const baseDate = parseYMD(base);
  if (!targetDate || !baseDate) return null;
  const diff = (targetDate.getTime() - baseDate.getTime()) / 86400000;
  return Math.round(diff);
}

function normaliseYMD(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return null;
}

function extractTargetInfo(apiUrl) {
  if (typeof apiUrl !== 'string') return { date: null, trainNumber: null };

  const vehicleMatch = apiUrl.match(/vehicle_journey:sncf:([^:]+):(\d{5,6})/i);
  if (vehicleMatch) {
    const date = normaliseYMD(vehicleMatch[1]);
    const trainNumber = vehicleMatch[2];
    return { date, trainNumber };
  }

  const datetimeParam = apiUrl.match(/[?&](?:datetime|date)=(\d{8})(?:T|$)/i);
  if (datetimeParam) {
    const date = normaliseYMD(datetimeParam[1]);
    return { date, trainNumber: null };
  }

  return { date: null, trainNumber: null };
}

function getLiveIntervalMinutes(totalMinutes) {
  const fourMinutesStart = (4 * 60) + 30;
  const morningEnd = (9 * 60) + 30;
  const middayEnd = (15 * 60) + 30;
  const eveningStart = (21 * 60);

  if (totalMinutes >= fourMinutesStart && totalMinutes < morningEnd) {
    return 4;
  }
  if (totalMinutes >= morningEnd && totalMinutes < middayEnd) {
    return 10;
  }
  if (totalMinutes >= middayEnd && totalMinutes < eveningStart) {
    return 4;
  }
  return 20; // 21:00 -> 05:00 (+ wrap)
}

function computeNextSnapshotSeconds(nextSnapshotLocal, nowDate) {
  if (!nextSnapshotLocal) return null;
  const [dayKey, timePart] = nextSnapshotLocal.split('T');
  if (!dayKey || !timePart) return null;
  const target = zonedTimeToUtc(dayKey, timePart, TIMEZONE);
  if (!target || Number.isNaN(target.getTime())) return null;
  const diff = Math.round((target.getTime() - nowDate.getTime()) / 1000);
  return diff > 0 ? diff : 0;
}

function buildSnapshotPolicy(targetDate, nowInfo, snapshots, label, nowDate) {
  let active = null;
  let next = null;
  for (const snap of snapshots) {
    if (nowInfo.minutes >= snap.minutes) {
      active = snap;
    } else if (!next) {
      next = snap;
    }
  }

  let snapshotKey = null;
  if (active) {
    snapshotKey = `${targetDate}|${nowInfo.dayKey}|${active.label}`;
  }

  let nextSnapshotLocal = null;
  if (next) {
    nextSnapshotLocal = `${nowInfo.dayKey}T${next.label}`;
  } else {
    const tomorrow = addDays(nowInfo.dayKey, 1);
    if (tomorrow) {
      nextSnapshotLocal = `${tomorrow}T${snapshots[0].label}`;
    }
  }

  const nextSnapshotSeconds = computeNextSnapshotSeconds(nextSnapshotLocal, nowDate);

  return {
    type: 'snapshot',
    label,
    snapshots,
    snapshotKey,
    nextSnapshotLocal,
    nextSnapshotSeconds,
    cacheSeconds: 30 * 60,
    description: `${label} — snapshot${snapshots.length > 1 ? 's' : ''} ${snapshots.map(s => s.label).join(' & ')}`
  };
}

function determinePolicy(targetDate, nowInfo, nowDate) {
  if (!targetDate) {
    return {
      type: 'unknown',
      minIntervalMinutes: 5,
      cacheSeconds: 5 * 60,
      description: 'Date de circulation inconnue — cache 5 minutes'
    };
  }

  const diff = diffDays(targetDate, nowInfo.dayKey);
  if (diff == null) {
    return {
      type: 'unknown',
      minIntervalMinutes: 5,
      cacheSeconds: 5 * 60,
      description: 'Date de circulation inconnue — cache 5 minutes'
    };
  }

  if (diff < 0) {
    return {
      type: 'historic',
      ttlMinutes: 60,
      cacheSeconds: 30 * 60,
      description: 'Date passée — actualisation horaire'
    };
  }

  if (diff === 0) {
    const minIntervalMinutes = getLiveIntervalMinutes(nowInfo.minutes);
    return {
      type: 'live',
      minIntervalMinutes,
      cacheSeconds: minIntervalMinutes * 60,
      description: `Suivi temps réel J0 — 1 appel toutes les ${minIntervalMinutes} minutes`
    };
  }

  if (diff === 1) {
    return buildSnapshotPolicy(targetDate, nowInfo, [
      { label: '07:00', minutes: 7 * 60 },
      { label: '12:00', minutes: 12 * 60 }
    ], 'J+1', nowDate);
  }

  if (diff >= 2 && diff <= 7) {
    return buildSnapshotPolicy(targetDate, nowInfo, [
      { label: '12:00', minutes: 12 * 60 }
    ], 'J+2 → J+7', nowDate);
  }

  if (diff >= 8 && diff <= 29) {
    return {
      type: 'longTerm',
      ttlMinutes: LONG_TERM_TTL_MINUTES,
      cacheSeconds: LONG_TERM_TTL_MINUTES * 60,
      description: 'Prévisions J+8 → J+29 — 40 appels/jour',
      dailyLimit: LONG_TERM_LIMIT
    };
  }

  return {
    type: 'longTerm',
    ttlMinutes: LONG_TERM_TTL_MINUTES,
    cacheSeconds: LONG_TERM_TTL_MINUTES * 60,
    description: 'Prévisions > J+29 — 40 appels/jour',
    dailyLimit: LONG_TERM_LIMIT
  };
}

function resetCountersIfNeeded(dayKey) {
  if (state.counters.dayKey !== dayKey) {
    state.counters.dayKey = dayKey;
    state.counters.total = 0;
    state.counters.longTerm = 0;
  }
}

function tryConsumeQuota(policy) {
  if (state.counters.total >= DAILY_LIMIT) {
    return false;
  }
  if (policy.type === 'longTerm' && state.counters.longTerm >= LONG_TERM_LIMIT) {
    return false;
  }
  state.counters.total += 1;
  if (policy.type === 'longTerm') {
    state.counters.longTerm += 1;
  }
  return true;
}

function pruneCache(nowTs) {
  if (nowTs - state.lastPrune < 30 * 60 * 1000) return;
  state.lastPrune = nowTs;
  const maxAge = 36 * 60 * 60 * 1000; // 36h
  for (const [key, entry] of state.cache.entries()) {
    if (nowTs - entry.fetchedAt > maxAge) {
      state.cache.delete(key);
    }
  }
}

function shouldFetchEntry(entry, policy, nowTs) {
  if (!entry) {
    return { shouldFetch: true, reason: 'miss' };
  }

  switch (policy.type) {
    case 'live': {
      const minMs = (policy.minIntervalMinutes || 5) * 60 * 1000;
      const fresh = nowTs - entry.fetchedAt < minMs;
      return { shouldFetch: !fresh, reason: fresh ? 'fresh' : 'interval-expired' };
    }
    case 'snapshot': {
      if (!policy.snapshotKey) {
        return { shouldFetch: false, reason: 'awaiting-snapshot' };
      }
      if (entry.snapshotKey === policy.snapshotKey) {
        return { shouldFetch: false, reason: 'snapshot-match' };
      }
      return { shouldFetch: true, reason: entry.snapshotKey ? 'new-snapshot' : 'snapshot-miss' };
    }
    case 'longTerm': {
      const ttlMs = (policy.ttlMinutes || LONG_TERM_TTL_MINUTES) * 60 * 1000;
      const fresh = nowTs - entry.fetchedAt < ttlMs;
      return { shouldFetch: !fresh, reason: fresh ? 'fresh' : 'ttl-expired' };
    }
    case 'historic': {
      const ttlMs = (policy.ttlMinutes || 60) * 60 * 1000;
      const fresh = nowTs - entry.fetchedAt < ttlMs;
      return { shouldFetch: !fresh, reason: fresh ? 'fresh' : 'ttl-expired' };
    }
    default: {
      const ttlMs = (policy.minIntervalMinutes || 5) * 60 * 1000;
      const fresh = nowTs - entry.fetchedAt < ttlMs;
      return { shouldFetch: !fresh, reason: fresh ? 'fresh' : 'ttl-expired' };
    }
  }
}

function buildCacheControl(policy) {
  const seconds = Math.max(30, Math.round(policy.cacheSeconds || 300));
  const swr = Math.max(seconds, seconds * 2);
  return `public, max-age=${seconds}, stale-while-revalidate=${swr}`;
}

function respondWithData(res, data, policy, meta = {}) {
  const headerParts = [meta.status || 'MISS', `policy=${policy.type}`];
  if (meta.reason) headerParts.push(`reason=${meta.reason}`);
  if (meta.targetDate) headerParts.push(`target=${meta.targetDate}`);
  res.setHeader('X-SNCF-Cache', headerParts.join(';'));
  if (meta.fetchedAt) {
    const value = typeof meta.fetchedAt === 'string'
      ? meta.fetchedAt
      : new Date(meta.fetchedAt).toISOString();
    res.setHeader('X-SNCF-Fetched-At', value);
  }
  if (policy.nextSnapshotLocal) {
    res.setHeader('X-SNCF-Next-Snapshot', policy.nextSnapshotLocal);
    if (typeof policy.nextSnapshotSeconds === 'number') {
      res.setHeader('X-SNCF-Next-Snapshot-Seconds', String(policy.nextSnapshotSeconds));
    }
  }
  if (meta.trainNumber) {
    res.setHeader('X-SNCF-Train', meta.trainNumber);
  }
  res.setHeader('Cache-Control', buildCacheControl(policy));
  res.status(200).json(data);
}

function respondFromCache(res, entry, policy, meta = {}) {
  const info = {
    status: meta.status || 'HIT',
    reason: meta.reason,
    targetDate: entry.targetDate,
    trainNumber: entry.trainNumber,
    fetchedAt: entry.fetchedAt
  };
  if (meta.stale) {
    res.setHeader('Warning', '110 - "Réponse en cache potentiellement obsolète"');
  }
  respondWithData(res, entry.data, policy, info);
}

function respondWaiting(res, policy, targetInfo) {
  res.setHeader('X-SNCF-Cache', `WAITING;policy=${policy.type}`);
  const retrySeconds = typeof policy.nextSnapshotSeconds === 'number'
    ? Math.max(policy.nextSnapshotSeconds, 60)
    : 60;
  res.setHeader('Retry-After', String(retrySeconds));
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(425).json({
    error: 'Le prochain snapshot SNCF n\'est pas encore disponible.',
    policy: policy.type,
    schedule: policy.description,
    nextSnapshot: policy.nextSnapshotLocal || null,
    nextSnapshotSeconds: policy.nextSnapshotSeconds ?? null,
    targetDate: targetInfo?.date || null,
    trainNumber: targetInfo?.trainNumber || null
  });
}

function respondQuotaExceeded(res, policy) {
  const retry = policy.type === 'longTerm' ? (6 * 60 * 60) : (15 * 60);
  res.setHeader('Retry-After', String(retry));
  res.status(429).json({
    error: 'Quota quotidien SNCF atteint.',
    policy: policy.type,
    schedule: policy.description,
    retryAfterSeconds: retry
  });
}

function createSncfProxyHandler({ resolveApiUrl }) {
  if (typeof resolveApiUrl !== 'function') {
    throw new Error('resolveApiUrl option manquant');
  }

  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    let apiUrl;
    try {
      apiUrl = resolveApiUrl(req);
    } catch (err) {
      const status = err?.statusCode || 400;
      const message = err?.message || 'Requête invalide';
      return res.status(status).json({ error: message });
    }

    if (!apiUrl || typeof apiUrl !== 'string') {
      return res.status(400).json({ error: 'Paramètre SNCF manquant' });
    }

    const apiKey = process.env.SNCF_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Configuration manquante côté serveur (SNCF_KEY).' });
    }

    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    const now = new Date();
    const nowInfo = getLocalInfo(now);
    resetCountersIfNeeded(nowInfo.dayKey);
    pruneCache(now.getTime());

    const targetInfo = extractTargetInfo(apiUrl);
    const policy = determinePolicy(targetInfo.date, nowInfo, now);

    if (policy.type === 'snapshot' && !policy.snapshotKey) {
      const existing = state.cache.get(apiUrl);
      if (existing) {
        return respondFromCache(res, existing, policy, { reason: 'awaiting-snapshot' });
      }
      return respondWaiting(res, policy, targetInfo);
    }

    const cacheEntry = state.cache.get(apiUrl);
    const decision = shouldFetchEntry(cacheEntry, policy, now.getTime());

    if (!decision.shouldFetch && cacheEntry) {
      return respondFromCache(res, cacheEntry, policy, { reason: decision.reason });
    }

    if (!tryConsumeQuota(policy)) {
      if (cacheEntry) {
        return respondFromCache(res, cacheEntry, policy, { reason: 'quota', stale: true });
      }
      return respondQuotaExceeded(res, policy);
    }

    try {
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Basic ${auth}` }
      });

      if (!response.ok) {
        if (cacheEntry) {
          return respondFromCache(res, cacheEntry, policy, {
            reason: `upstream-${response.status}`,
            stale: true
          });
        }
        return res.status(response.status).json({
          error: `Erreur API SNCF : ${response.statusText}`,
          policy: policy.type,
          schedule: policy.description
        });
      }

      const data = await response.json();
      const entry = {
        data,
        fetchedAt: now.getTime(),
        snapshotKey: policy.snapshotKey || null,
        policyType: policy.type,
        targetDate: targetInfo.date || null,
        trainNumber: targetInfo.trainNumber || null
      };
      state.cache.set(apiUrl, entry);

      return respondWithData(res, data, policy, {
        status: cacheEntry ? 'REFRESH' : 'MISS',
        reason: decision.reason,
        targetDate: targetInfo.date || null,
        trainNumber: targetInfo.trainNumber || null,
        fetchedAt: entry.fetchedAt
      });
    } catch (err) {
      console.error('[SNCF proxy] Erreur réseau', err);
      if (cacheEntry) {
        return respondFromCache(res, cacheEntry, policy, {
          reason: 'network-error',
          stale: true
        });
      }
      return res.status(500).json({
        error: 'Erreur interne du proxy SNCF',
        details: err?.message || String(err),
        policy: policy.type,
        schedule: policy.description
      });
    }
  };
}

function getSncfProxyStats() {
  const now = new Date();
  const nowInfo = getLocalInfo(now);
  resetCountersIfNeeded(nowInfo.dayKey);

  return {
    dayKey: state.counters.dayKey,
    timezone: TIMEZONE,
    generatedAt: now.toISOString(),
    dailyLimit: DAILY_LIMIT,
    total: state.counters.total,
    remaining: Math.max(DAILY_LIMIT - state.counters.total, 0),
    longTermLimit: LONG_TERM_LIMIT,
    longTerm: state.counters.longTerm,
    longTermRemaining: Math.max(LONG_TERM_LIMIT - state.counters.longTerm, 0),
    cacheSize: state.cache.size
  };
}

module.exports = {
  createSncfProxyHandler,
  getSncfProxyStats
};
