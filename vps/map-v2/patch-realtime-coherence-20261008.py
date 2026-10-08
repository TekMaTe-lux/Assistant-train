from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
proof=(root/'assets/lb-running-service-proof-v1.js').read_text()
def replace(s,old,new):
 if old not in s: raise RuntimeError('Patch marker missing: '+old[:90])
 return s.replace(old,new,1)
def patch_map(path):
 s=path.read_text()
 if 'LB_RUNNING_SERVICE_PROOF_V1_START' in s: return
 helper='''
  /* LB_RUNNING_SERVICE_PROOF_V1_START */
PROOF
  const lbMapRunningProofCache = new WeakMap();
  function lbMapRunningServiceState(tripId, seq, numberKey) {
    const raw = realtimeRawData.gtfs;
    if (!raw || typeof raw !== 'object' || !seq?.length) return null;
    const key = String(normalizeTrainNumberKey(numberKey) || numberKey || '');
    const payload = raw.trains?.[key];
    if (!payload) return null;
    const generated = raw.generated_at || raw.generatedAt || raw.updated_at;
    const stamp = parseGtfsRtTimestamp(generated);
    const now = Date.now();
    if (!Number.isFinite(stamp) || now - stamp > 300000 || stamp > now + 60000) return null;
    let cache = lbMapRunningProofCache.get(raw);
    if (!cache) { cache = new Map(); lbMapRunningProofCache.set(raw, cache); }
    const cached = cache.get(tripId);
    if (cached?.seq === seq) return cached.state;
    const names = seq.map(stop => stopsById.get(stop.stop_id)?.name);
    const state = names.every(Boolean) ? lbResolveRunningServiceProof({
      status: payload.status,
      data_source: payload.data_source,
      feed_generated_at: generated,
      service_stops: payload.stops,
      canceled_stops: payload.canceled_stops || payload.cancelled_stops || []
    }, names, normalizeStationName, now) : null;
    cache.set(tripId, { seq, state });
    return state;
  }
  function lbMapHasOldSncfCancellation(train) {
    const key = resolveRealtimeNumberKey(train);
    const seq = stopTimesByTrip.get(train?.id);
    if (!lbMapRunningServiceState(train?.id, seq, key)) return false;
    const entries = realtimeSources.sncf.map.get(String(key));
    return entries instanceof Map && Array.from(entries.values()).some(entry => entry?.value === null);
  }
  /* LB_RUNNING_SERVICE_PROOF_V1_END */
'''.replace('\nPROOF\n','\n'+proof+'\n')
 s=replace(s,'  function computeRealtimeStopData(tripId, seq, numberKey, options = {}){',helper+'\n  function computeRealtimeStopData(tripId, seq, numberKey, options = {}){')
 s=replace(s,'    const normalizedKey = normalizeTrainNumberKey(numberKey);\n\n    const nationalFullCancelled','    const normalizedKey = normalizeTrainNumberKey(numberKey);\n    const runningService = lbMapRunningServiceState(tripId, seq, normalizedKey);\n\n    const nationalFullCancelled')
 s=replace(s,'          if (!candidate) continue;\n\n          if (\n            normalizedSource','''          if (!candidate) continue;
          // Same full-route SNCF proof as timetable/LIVE. Other cancellation
          // authorities (GTFS trip/stop, national, HAFAS HIM) remain intact.
          if (runningService && normalizedSource === 'sncf' && candidate.value === null) continue;

          if (
            normalizedSource''')
 s=replace(s,'      if (!entry && combinedFallback){','      if (!entry && combinedFallback && !runningService){')
 s=replace(s,'        if (sncfDisruptionsByTrain.has(k)) return sncfDisruptionsByTrain.get(k);',"        if (sncfDisruptionsByTrain.has(k)) {\n          if (lbMapHasOldSncfCancellation(train)) return 'Remis en circulation selon le temps réel SNCF';\n          return sncfDisruptionsByTrain.get(k);\n        }")
 a=s.index('    const sncfPromise = loadSncfRealtime({ forceFresh: true }).catch(');b=s.index('    const gtfsPromise =',a)
 s=s[:a]+"    // Legacy retards_carte export retired: realtime/cause enrichment uses the shared HUB.\n"+s[b:]
 a=s.index('    sncfPromise.finally(()=>{');b=s.index('    tracksPromise.finally(()=>{',a)
 s=s[:a]+s[b:];path.write_text(s)
if __name__=='__main__':
 for arg in sys.argv[1:]: patch_map(Path(arg))
