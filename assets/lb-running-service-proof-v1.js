// Embedded at build time in the app and map: no extra request or timer.
function lbResolveRunningServiceProof(meta, stops, normalize, now = Date.now()) {
  const status = String(meta?.status || '').toUpperCase();
  const source = String(meta?.data_source || '').toLowerCase();
  if (!['ON_TIME','DELAYED','NO_DELAY'].includes(status)) return null;
  if (!/gtfs_rt|gtfs-rt|siri/.test(source)) return null;
  const generated = meta.feed_generated_at;
  const timestamp = typeof generated === 'number'
    ? (generated < 1e12 ? generated * 1000 : generated)
    : Date.parse(generated || '');
  if (!Number.isFinite(timestamp) || now - timestamp > 5 * 60000 || timestamp > now + 60000) return null;
  const serviceStops = meta.service_stops;
  if (!serviceStops || typeof serviceStops !== 'object') return null;
  const names = Array.isArray(stops) ? stops.filter(Boolean) : [];
  if (!names.length || (meta.canceled_stops || []).length) return null;
  const values = new Map(Object.entries(serviceStops).map(([name,value]) => [normalize(name), value]));
  const delays = names.map(name => {
    const value = values.get(normalize(name));
    return value === null || value === undefined || value === '' ? NaN : Number(value);
  });
  if (!delays.every(Number.isFinite)) return null;
  return { status, maxDelay: Math.max(0, ...delays) };
}
