const fs = require('fs');
const path = require('path');

const { getSncfProxyStats } = require('./sncfProxy.js');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'sncf-stats-snapshot.json');

function loadSnapshot() {
  try {
    const buffer = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    if (!buffer) {
      return null;
    }
    const parsed = JSON.parse(buffer);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      ...parsed,
      source: 'snapshot'
    };
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('[SNCF proxy] Impossible de lire le snapshot statique', err);
    }
    return null;
  }
}

module.exports = function handler(req, res) {
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
    const stats = getSncfProxyStats();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[SNCF proxy] Impossible de récupérer les statistiques dynamiques', err);
    const snapshot = loadSnapshot();
    if (snapshot) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json(snapshot);
    }
    return res.status(500).json({ error: 'Impossible de récupérer les statistiques actuelles.' });
  }
};
