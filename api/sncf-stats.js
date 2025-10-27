import { getSncfProxyStats } from './sncfProxy.js';

export default function handler(req, res) {
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
    console.error('[SNCF proxy] Impossible de récupérer les statistiques', err);
    return res.status(500).json({ error: 'Impossible de récupérer les statistiques actuelles.' });
  }
}
