const HAFAS_ENDPOINT = 'https://cdt.hafas.de/opendata/apiserver/departureBoard';
const DEFAULT_ACCESS_ID = process.env.CFL_HAFAS_ACCESS_ID || '58ef9a71-6837-4405-bd5d-23beaf92864c';
const DEFAULT_DURATION = 180;
const DEFAULT_MAX_JOURNEYS = 50;

function firstString(value, fallback = '') {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry;
      }
    }
    return value.length ? String(value[0]) : fallback;
  }
  return typeof value === 'string' ? value : fallback;
}

function normalisePositiveInt(value, fallback) {
  const raw = Number.parseInt(firstString(value, ''), 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return fallback;
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

  const hafasId = firstString(req.query.id, '').trim();
  const date = firstString(req.query.date, '').trim();
  const time = firstString(req.query.time, '').trim();
  if (!hafasId || !date || !time) {
    return res.status(400).json({ error: 'Missing required parameters: id, date, time' });
  }

  const duration = normalisePositiveInt(req.query.duration, DEFAULT_DURATION);
  const maxJourneys = normalisePositiveInt(req.query.maxJourneys, DEFAULT_MAX_JOURNEYS);
  const format = firstString(req.query.format, 'json') || 'json';
  const accessId = firstString(req.query.accessId, DEFAULT_ACCESS_ID) || DEFAULT_ACCESS_ID;

  const url = new URL(HAFAS_ENDPOINT);
  url.searchParams.set('accessId', accessId);
  url.searchParams.set('id', hafasId);
  url.searchParams.set('date', date);
  url.searchParams.set('time', time);
  url.searchParams.set('duration', String(duration));
  url.searchParams.set('maxJourneys', String(maxJourneys));
  url.searchParams.set('format', format);

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      headers: { 'accept': 'application/json' }
    });
  } catch (error) {
    return res.status(502).json({ error: 'Failed to reach HAFAS endpoint', details: String(error) });
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  res.setHeader('Content-Type', contentType);

  if (!upstream.ok) {
    try {
      const payload = text ? JSON.parse(text) : null;
      return res.status(upstream.status).json(payload || { error: 'Upstream error' });
    } catch (err) {
      return res.status(upstream.status).send(text || '');
    }
  }

  if (!text) {
    return res.status(204).end();
  }

  try {
    const payload = JSON.parse(text);
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(200).send(text);
  }
}
