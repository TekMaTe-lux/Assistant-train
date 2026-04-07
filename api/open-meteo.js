const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

function appendQueryParams(url, query = {}) {
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null || entry === '') return;
        url.searchParams.append(key, String(entry));
      });
      return;
    }
    url.searchParams.set(key, String(value));
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const upstreamUrl = new URL(OPEN_METEO_ENDPOINT);
  appendQueryParams(upstreamUrl, req.query || {});

  let upstream;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: { accept: 'application/json' }
    });
  } catch (error) {
    return res.status(502).json({ error: 'Failed to reach Open-Meteo endpoint', details: String(error) });
  }

  const payloadText = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  res.setHeader('Content-Type', contentType);

  if (!upstream.ok) {
    try {
      return res.status(upstream.status).json(payloadText ? JSON.parse(payloadText) : { error: 'Open-Meteo upstream error' });
    } catch (_err) {
      return res.status(upstream.status).send(payloadText || '');
    }
  }

  if (!payloadText) return res.status(204).end();

  try {
    return res.status(200).json(JSON.parse(payloadText));
  } catch (_err) {
    return res.status(200).send(payloadText);
  }
}
