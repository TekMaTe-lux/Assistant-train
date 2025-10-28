const {
  createSncfProxyHandler,
  getSncfProxyStatsAsync
} = require('./sncfProxy.js');
const { loadSncfStatsSnapshot } = require('./sncfStatsSnapshot.js');

function resolveApiUrl(req) {
  const { id, url } = req.query || {};
  if (id) {
    return `https://api.sncf.com/v1/coverage/sncf/${id}`;
  }

  if (url) {
    try {
      const decoded = decodeURIComponent(url);
      return `https://api.sncf.com/v1/coverage/sncf/${decoded}`;
    } catch (err) {
      const error = new Error('Paramètre "url" invalide');
      error.statusCode = 400;
      throw error;
    }
  }
  const error = new Error('Paramètre "id" ou "url" requis');
  error.statusCode = 400;
  throw error;
}

const handler = createSncfProxyHandler({ resolveApiUrl });

function setStatsCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isStatsRequest(req) {
  const query = req.query || {};
  return Object.prototype.hasOwnProperty.call(query, 'stats');
}

async function handleStats(req, res) {
  setStatsCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const stats = await getSncfProxyStatsAsync({ forceSync: true });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[SNCF proxy] Impossible de récupérer les statistiques dynamiques', err);
    const snapshot = loadSncfStatsSnapshot();
    if (snapshot) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json(snapshot);
    }
    return res.status(500).json({ error: 'Impossible de récupérer les statistiques actuelles.' });
  }
}

module.exports = async function trainHandler(req, res) {
  if (isStatsRequest(req)) {
    return handleStats(req, res);
  }

  return handler(req, res);
};
