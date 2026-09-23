import fs from 'node:fs';

function numberKey(value) {
  const match = String(value ?? '').match(/\b(\d{4,6})\b/);
  return match ? match[1] : null;
}

function secondsFrom(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // Les caches existants peuvent exprimer le retard en minutes ou secondes.
  return Math.abs(number) <= 360 ? Math.round(number * 60) : Math.round(number);
}

function ingest(target, key, raw) {
  const normalized = numberKey(key ?? raw?.trainNumber ?? raw?.number ?? raw?.name ?? raw?.id);
  if (!normalized) return;
  const delay = secondsFrom(
    raw?.delaySeconds ?? raw?.delay_seconds ?? raw?.delaySec ?? raw?.delay ?? raw?.delayMinutes
  );
  const cancelled = Boolean(raw?.cancelled ?? raw?.isCancelled ?? raw?.is_cancelled);
  if (delay == null && !cancelled) return;
  target.set(normalized, { delaySeconds: delay ?? 0, cancelled });
}

export function loadRealtime(filePath) {
  const map = new Map();
  if (!filePath || !fs.existsSync(filePath)) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const containers = [raw, raw?.data, raw?.trains, raw?.byTrain, raw?.vehicle_journeys].filter(Boolean);
    for (const container of containers) {
      if (Array.isArray(container)) {
        for (const entry of container) ingest(map, null, entry);
      } else if (typeof container === 'object') {
        for (const [key, value] of Object.entries(container)) ingest(map, key, value);
      }
    }
  } catch (error) {
    console.warn('[map-v2] cache temps réel illisible:', error.message);
  }
  return map;
}
