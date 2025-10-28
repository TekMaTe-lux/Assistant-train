const DEFAULT_BASE_URL = process.env.SNCF_STATS_STORE_URL || 'https://api.countapi.xyz';
const DEFAULT_NAMESPACE = process.env.SNCF_STATS_NAMESPACE || 'assistant-train-sncf-proxy';
const DISABLE_PERSISTENCE = process.env.SNCF_STATS_DISABLE_PERSISTENCE === '1';

function getProviderName() {
  const url = new URL(DEFAULT_BASE_URL, 'https://api.countapi.xyz');
  return url.host;
}

const providerName = getProviderName();

function shouldBypass(dayKey) {
  if (DISABLE_PERSISTENCE) return true;
  if (!dayKey || typeof dayKey !== 'string') return true;
  return false;
}

function buildKey(dayKey, suffix) {
  return `${dayKey}-${suffix}`;
}

function buildUrl(action, key) {
  const namespace = encodeURIComponent(DEFAULT_NAMESPACE);
  const encodedKey = encodeURIComponent(key);
  return `${DEFAULT_BASE_URL.replace(/\/$/, '')}/${action}/${namespace}/${encodedKey}`;
}

async function fetchCounter(url, { expectNotFound = false } = {}) {
  const response = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (response.status === 404 && expectNotFound) {
    return { value: 0 };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`Statistiques SNCF: échec de la requête ${url} (${response.status})`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return response.json();
}

async function hitCounter(url) {
  const response = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`Statistiques SNCF: échec de l'incrément ${url} (${response.status})`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return response.json();
}

async function readCounters(dayKey) {
  if (shouldBypass(dayKey)) {
    return null;
  }

  try {
    const [total, longTerm] = await Promise.all([
      fetchCounter(buildUrl('get', buildKey(dayKey, 'total')), { expectNotFound: true }),
      fetchCounter(buildUrl('get', buildKey(dayKey, 'longTerm')), { expectNotFound: true })
    ]);

    const snapshot = {
      total: Number.isFinite(total?.value) ? total.value : 0,
      longTerm: Number.isFinite(longTerm?.value) ? longTerm.value : 0,
      provider: providerName
    };
    return snapshot;
  } catch (err) {
    err.context = 'readCounters';
    throw err;
  }
}

async function incrementCounters(dayKey, { incrementLongTerm = false } = {}) {
  if (shouldBypass(dayKey)) {
    return null;
  }

  try {
    const totalPromise = hitCounter(buildUrl('hit', buildKey(dayKey, 'total')));
    const longTermPromise = incrementLongTerm
      ? hitCounter(buildUrl('hit', buildKey(dayKey, 'longTerm')))
      : Promise.resolve(null);

    const [total, longTerm] = await Promise.all([totalPromise, longTermPromise]);

    return {
      total: Number.isFinite(total?.value) ? total.value : undefined,
      longTerm: Number.isFinite(longTerm?.value) ? longTerm.value : undefined,
      provider: providerName
    };
  } catch (err) {
    err.context = 'incrementCounters';
    throw err;
  }
}

module.exports = {
  providerName,
  readCounters,
  incrementCounters
};
