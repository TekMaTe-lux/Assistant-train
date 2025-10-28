const { loadSncfStatsSnapshot } = require('./sncfStatsSnapshot.js');

async function forwardToTrainStats(req, res) {
  const headers = req.headers || {};
  const proto = headers['x-forwarded-proto'] || headers['x-real-proto'] || 'https';
  const host = headers['x-forwarded-host'] || headers.host || process.env.VERCEL_URL;
  if (!host) {
    return null;
  }

const base = `${proto}://${host}`.replace(/\/$/, '');
  const url = `${base}/api/train?stats=1`;


const response = await fetch(url, {
    headers: {
      'X-SNCF-Stats-Forward': 'sncf-stats'
    }
   });

  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  res.setHeader('Cache-Control', response.headers.get('cache-control') || 'no-store, max-age=0');
  res.setHeader('Content-Type', contentType);
  if (contentType.includes('application/json') && typeof payload === 'object') {
    return res.status(response.status).json(payload);
  }
  
  if (typeof res.send === 'function') {
    return res.status(response.status).send(payload);
  }

  res.statusCode = response.status;
  res.end(payload);
  return res;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
   const forwarded = await forwardToTrainStats(req, res);
    if (forwarded != null) {
      return forwarded;
    }
   } catch (err) {
    console.error('[SNCF proxy] Redirection vers /api/train?stats=1 impossible', err);
  }

  const snapshot = loadSncfStatsSnapshot();
  if (snapshot) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(snapshot);
  }

  return res.status(500).json({ error: 'Impossible de récupérer les statistiques actuelles.' });
};
