(()=>{
  'use strict';

  if (window.__LB_PARTIAL_GHOST_V2__) return;
  window.__LB_PARTIAL_GHOST_V2__ = true;

  function lbClassifyCancellationFlags(flags){
    const list = Array.isArray(flags) ? flags.map(Boolean) : [];
    const cancelledIndices = [];
    for (let i=0;i<list.length;i++) if (list[i]) cancelledIndices.push(i);
    if (!cancelledIndices.length){
      return { kind:'none', cancelledIndices, prefixEnd:null, suffixStart:null, ghostSegmentIndices:[] };
    }
    if (cancelledIndices.length === list.length){
      return {
        kind:'full',
        cancelledIndices,
        prefixEnd:list.length,
        suffixStart:0,
        ghostSegmentIndices:Array.from({length:Math.max(0,list.length-1)},(_,i)=>i)
      };
    }

    const firstActive = list.findIndex(v=>!v);
    let lastActive = -1;
    for (let i=list.length-1;i>=0;i--){ if (!list[i]) { lastActive=i; break; } }

    const ghostSegments = new Set();
    const prefixEnd = firstActive > 0 ? firstActive : null;
    const suffixStart = lastActive >= 0 && lastActive < list.length - 1 ? lastActive : null;

    if (prefixEnd != null){
      for (let i=0;i<Math.min(prefixEnd, list.length-1);i++) ghostSegments.add(i);
    }
    if (suffixStart != null){
      for (let i=Math.max(0,suffixStart);i<list.length-1;i++) ghostSegments.add(i);
    }

    return {
      kind:'partial',
      cancelledIndices,
      prefixEnd,
      suffixStart,
      ghostSegmentIndices:Array.from(ghostSegments).sort((a,b)=>a-b)
    };
  }

  function lbRealtimeProfileForTrain(train){
    if (!train || !train.id) return { seq:null, profile:null };
    const seq = stopTimesByTrip.get(train.id);
    if (!seq || !seq.length) return { seq:null, profile:null };
    const numberKey = resolveRealtimeNumberKey(train) ?? extractTrainNumberCandidate(train.id);
    const profile = realtimeStopDataByTrip.get(train.id)
      || computeRealtimeStopData(train.id, seq, numberKey, realtimeOptionsForTrain(train));
    return { seq, profile };
  }

  function lbTrainCancellationState(train, suppliedProfile = null){
    if (!train) return { kind:'none', cancelledIndices:[], prefixEnd:null, suffixStart:null, ghostSegmentIndices:[], profile:null, seq:null };
    const resolved = suppliedProfile
      ? { seq: stopTimesByTrip.get(train.id) || null, profile: suppliedProfile }
      : lbRealtimeProfileForTrain(train);
    const profile = resolved.profile;
    const seq = resolved.seq;
    const flags = Array.isArray(profile?.stops) ? profile.stops.map(st=>Boolean(st?.cancelled)) : [];
    const classified = lbClassifyCancellationFlags(flags);
    return { ...classified, profile, seq };
  }

  function lbPositiveDelayFallback(train, state){
    const seq = state?.seq || stopTimesByTrip.get(train?.id);
    const profile = state?.profile;
    if (!train || !seq || !seq.length || !profile?.stops?.length) return null;
    const startIdx = Number.isInteger(train.segmentIndex) && train.segmentIndex >= 0 ? train.segmentIndex : 0;
    for (let i=Math.max(0,startIdx);i<profile.stops.length;i++){
      const st = profile.stops[i];
      if (!st || st.cancelled) continue;
      const minutes = Number.isFinite(st.delayMinutes)
        ? st.delayMinutes
        : (Number.isFinite(st.delaySec) ? st.delaySec / 60 : null);
      if (!(minutes > 0)) continue;
      const meta = seq[i] ? stopsById.get(seq[i].stop_id) : null;
      const info = buildDelayInfo({ value:minutes, original:meta?.name || st.delaySource || null }, train);
      if (info) return info;
    }
    const currentDelayMin = Number.isFinite(train.currentDelaySec) ? train.currentDelaySec / 60 : null;
    if (currentDelayMin > 0){
      return buildDelayInfo({ value:currentDelayMin, original:train.from || null }, train);
    }
    return null;
  }

  const lbOriginalComputeTrainDelayInfo = computeTrainDelayInfo;
  computeTrainDelayInfo = function(train){
    const info = lbOriginalComputeTrainDelayInfo(train);
    const state = lbTrainCancellationState(train);

    // Un SUP. n'est autorise que si TOUT le trajet est prouve supprime.
    if (state.kind === 'full'){
      if (info?.severity === 'cancelled') return info;
      const firstIdx = state.cancelledIndices[0] ?? 0;
      const meta = state.seq?.[firstIdx] ? stopsById.get(state.seq[firstIdx].stop_id) : null;
      return buildDelayInfo({ value:null, original:meta?.name || state.profile?.stops?.[firstIdx]?.delaySource || null }, train) || info;
    }

    // Une gare non desservie / une suppression partielle ne transforme jamais le train entier en SUP.
    if (info?.severity === 'cancelled'){
      return lbPositiveDelayFallback(train, state);
    }
    return info;
  };

  const lbOriginalGlyphForTrain = glyphForTrain;
  glyphForTrain = function(train, delayInfoOverride){
    const state = lbTrainCancellationState(train);
    // Conserver le pictogramme habituel: la croix/lisere signale l'etat sans masquer le train.
    if (state.kind === 'full') return cowForTrain(train);
    return lbOriginalGlyphForTrain(train, delayInfoOverride);
  };

  const lbOriginalTrainIconSignature = trainIconSignature;
  trainIconSignature = function(train){
    const state = lbTrainCancellationState(train);
    return `${lbOriginalTrainIconSignature(train)}|lb-cancel:${state.kind}:${state.cancelledIndices.join(',')}`;
  };

  function lbAddMarkerClass(html, className){
    return String(html || '').replace(/class="([^"]*\bcow-marker\b[^"]*)"/, (all, classes)=>{
      const list = classes.split(/\s+/).filter(Boolean);
      if (!list.includes(className)) list.push(className);
      return `class="${list.join(' ')}"`;
    });
  }

  const lbOriginalIconForTrain = iconForTrain;
  iconForTrain = function(train){
    const icon = lbOriginalIconForTrain(train);
    if (!icon?.options) return icon;
    const state = lbTrainCancellationState(train);
    let html = String(icon.options.html || '');

    if (state.kind === 'partial'){
      html = lbAddMarkerClass(html, 'train-partial-ghost');
      html = html.replace(/<button\b/, '<button data-lb-cancel-state="partial"');
      const hasDelayBadge = /train-delay-badge--(?:moderate|major|severe|cancelled)/.test(html);
      if (!hasDelayBadge && !/train-partial-badge/.test(html)){
        html = html.replace('</button>', '<span class="train-delay-badge train-partial-badge" title="Circulation partielle / arrêt non desservi">PART.</span></button>');
      }
    } else if (state.kind === 'full'){
      html = lbAddMarkerClass(html, 'train-cancelled');
      html = html.replace(/<button\b/, '<button data-lb-cancel-state="full"');
    }

    icon.options.html = html;
    return icon;
  };

  let lbGhostRouteLayer = null;
  let lbGhostRouteSignature = '';

  function lbClearGhostRoute(){
    if (lbGhostRouteLayer){
      try { lbGhostRouteLayer.remove(); } catch(_){ }
      lbGhostRouteLayer = null;
    }
    lbGhostRouteSignature = '';
  }

  function lbGhostSignature(train, state){
    return `${train?.id || ''}|${state?.kind || 'none'}|${(state?.cancelledIndices || []).join(',')}|${(state?.ghostSegmentIndices || []).join(',')}`;
  }

  function lbCoordsForSegment(stopA, stopB){
    if (!stopA || !stopB) return null;
    try {
      const path = pathBetweenStops(stopA, stopB);
      if (Array.isArray(path?.coords) && path.coords.length >= 2) return path.coords;
    } catch(_){ }
    return [[stopA.lat, stopA.lon], [stopB.lat, stopB.lon]];
  }

  function lbRenderGhostRouteForTrain(train){
    if (!train){ lbClearGhostRoute(); return; }
    const state = lbTrainCancellationState(train);
    if (state.kind === 'none') { lbClearGhostRoute(); return; }
    const signature = lbGhostSignature(train, state);
    if (signature === lbGhostRouteSignature && lbGhostRouteLayer) return;

    lbClearGhostRoute();
    const seq = state.seq;
    if (!seq || seq.length < 2) return;

    const segmentIndices = state.ghostSegmentIndices || [];
    const layer = L.layerGroup().addTo(map);
    let drew = false;

    for (const i of segmentIndices){
      if (i < 0 || i >= seq.length - 1) continue;
      const stopA = stopsById.get(seq[i].stop_id);
      const stopB = stopsById.get(seq[i+1].stop_id);
      if (!stopA || !stopB) continue;
      const coords = lbCoordsForSegment(stopA, stopB);
      if (!coords || coords.length < 2) continue;

      L.polyline(coords, {
        color:'#07121f', weight:8.2, opacity:.38,
        lineCap:'round', lineJoin:'round', interactive:false
      }).addTo(layer);
      const ghost = L.polyline(coords, {
        color:'#b8c4d8', weight:5.0, opacity:.84,
        dashArray:'8 7', dashOffset:'0', lineCap:'round', lineJoin:'round', interactive:false
      }).addTo(layer);
      try { ghost.bringToFront(); } catch(_){ }
      drew = true;
    }

    // Une suppression isolee au milieu signifie surtout "gare non desservie":
    // on marque la gare, sans faire croire que la voie entre les gares n'est plus parcourue.
    if (state.kind === 'partial'){
      const ghostSegments = new Set(segmentIndices);
      for (const idx of state.cancelledIndices){
        const belongsToGhostTailOrHead = ghostSegments.has(idx) || ghostSegments.has(idx - 1);
        if (belongsToGhostTailOrHead) continue;
        const st = seq[idx];
        const meta = st ? stopsById.get(st.stop_id) : null;
        if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lon)) continue;
        L.circleMarker([meta.lat, meta.lon], {
          radius:5, color:'#e5eaf2', weight:1.5, opacity:.9,
          fillColor:'#8997ad', fillOpacity:.78, interactive:false
        }).addTo(layer);
        drew = true;
      }
    }

    if (!drew){
      try { layer.remove(); } catch(_){ }
      return;
    }
    lbGhostRouteLayer = layer;
    lbGhostRouteSignature = signature;
  }

  const lbOriginalRenderTripPanel = renderTripPanel;
  renderTripPanel = function(...args){
    const result = lbOriginalRenderTripPanel.apply(this, args);
    if (activeTripId){
      const train = trainDataById.get(activeTripId) || buildStaticPanelTrainData(activeTripId);
      lbRenderGhostRouteForTrain(train || null);
    } else {
      lbClearGhostRoute();
    }
    return result;
  };

  const lbOriginalHideTripPanel = hideTripPanel;
  hideTripPanel = function(...args){
    lbClearGhostRoute();
    return lbOriginalHideTripPanel.apply(this, args);
  };

  const lbOriginalOpenStationPanel = openStationPanel;
  openStationPanel = function(...args){
    lbClearGhostRoute();
    return lbOriginalOpenStationPanel.apply(this, args);
  };

  // Expose seulement le diagnostic utile dans la console.
  window.lbCancellationStateForTrain = function(trainId){
    const train = trainDataById.get(trainId) || buildStaticPanelTrainData(trainId);
    return lbTrainCancellationState(train || null);
  };

  try {
    const checks = [
      lbClassifyCancellationFlags([true,true,true]).kind === 'full',
      lbClassifyCancellationFlags([false,true,false]).ghostSegmentIndices.length === 0,
      lbClassifyCancellationFlags([false,false,true,true]).ghostSegmentIndices.join(',') === '1,2',
      lbClassifyCancellationFlags([true,true,false,false]).ghostSegmentIndices.join(',') === '0,1'
    ];
    console.info('[LB partial ghost v2]', checks.every(Boolean) ? 'self-test OK' : 'self-test ECHEC', checks);
  } catch(err){
    console.warn('[LB partial ghost v2] self-test erreur', err);
  }
})();
