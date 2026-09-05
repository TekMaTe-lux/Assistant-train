'use strict';

/*
 * La Bétaillère — pont Carte <-> Voix du Bétail.
 *
 * Cette couche est volontairement optionnelle : elle ne modifie ni les
 * données SNCF/CFL, ni le rendu de la carte lorsque personne ne contribue.
 * Le GPS n'est demandé qu'après une action explicite et n'est jamais stocké.
 */
(function installCommunityMapBridge(){
  if (window.__LB_COMMUNITY_MAP_BRIDGE_V1__) return;
  window.__LB_COMMUNITY_MAP_BRIDGE_V1__ = true;

  const MAP_SELECTOR = '#carte iframe';
  const SNAPSHOT_INTERVAL_MS = 8000;
  const GPS_TIMEOUT_MS = 12000;
  const params = new URLSearchParams(window.location.search);
  const DEMO_MODE = params.get('lbCommunityDemo') === '1';
  const DEMO_TRAIN = normalizeDemoTrain(params.get('lbCommunityTrain')) || '88733';
  let lastSnapshotSignature = '';
  let gpsResultTimer = 0;
  let demoAboard = false;
  const boundFrames = new WeakSet();
  let frameObserver = null;

  function normalizeDemoTrain(value){
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  }

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const mapFrames = () => Array.from(document.querySelectorAll(MAP_SELECTOR));

  function postToMaps(payload, targetWindow){
    if (targetWindow && typeof targetWindow.postMessage === 'function') {
      try { targetWindow.postMessage(payload, '*'); } catch(_) {}
      return;
    }
    mapFrames().forEach((frame) => {
      try { frame.contentWindow?.postMessage(payload, '*'); } catch(_) {}
    });
  }

  function currentSnapshot(){
    if (DEMO_MODE) {
      return {
        generatedAt:Date.now(),
        presenceTtlMs:4 * 60 * 60 * 1000,
        signalTtlMs:45 * 60 * 1000,
        demo:true,
        trains:{
          [DEMO_TRAIN]:{
            presenceCount:demoAboard ? 4 : 3,
            travelerDelayMin:12,
            delayReports:2,
            lastReportAt:Date.now(),
            travelerStops:{
              uckange:{ station:'Uckange', delayMin:12, reports:2, lastReportAt:Date.now() }
            },
            isCurrentUserAboard:demoAboard
          }
        }
      };
    }
    try {
      return window.lbCommunityLive?.getMapSnapshot?.() || null;
    } catch(error) {
      console.warn('[Voix du Bétail / carte] instantané indisponible', error?.message || error);
      return null;
    }
  }

  function broadcastSnapshot(force = false, targetWindow = null){
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    const signature = JSON.stringify(snapshot.trains || {});
    if (!force && !targetWindow && signature === lastSnapshotSignature) return;
    lastSnapshotSignature = signature;
    postToMaps({ type:'lb:community:snapshot', ...snapshot }, targetWindow);
  }

  function bindMapFrames(){
    mapFrames().forEach((frame) => {
      if (boundFrames.has(frame)) return;
      boundFrames.add(frame);
      frame.addEventListener('load', () => {
        window.setTimeout(() => broadcastSnapshot(true, frame.contentWindow), 120);
        window.setTimeout(() => broadcastSnapshot(true, frame.contentWindow), 700);
      });
    });
  }

  function refreshMapAfterReturn(){
    if ((window.location.hash || '').toLowerCase() !== '#carte') return;
    bindMapFrames();
    // Le moteur cartographique peut redessiner ses marqueurs juste après que
    // la page Carte redevient visible. Plusieurs envois courts garantissent
    // que la couche voyageurs est réappliquée après ce redessin.
    [0, 120, 450, 1100].forEach((delay) => {
      window.setTimeout(() => broadcastSnapshot(true), delay);
    });
  }

  function gpsErrorMessage(error){
    if (!window.isSecureContext) return 'Le GPS exige une connexion sécurisée.';
    if (error?.code === 1) return 'Localisation refusée. Le retard peut toujours être saisi manuellement.';
    if (error?.code === 2) return 'Position indisponible. Le retard peut toujours être saisi manuellement.';
    if (error?.code === 3) return 'Le GPS met trop de temps à répondre. Réessayez ou saisissez le retard.';
    return 'Estimation GPS indisponible. Le signalement manuel reste disponible.';
  }

  function showSignalFeedback(message){
    const feedback = document.getElementById('lbSignalFeedback');
    if (feedback) feedback.textContent = String(message || '');
  }

  function requestGpsPosition(sourceWindow, trainNumber){
    const train = normalizeTrain(trainNumber);
    if (!train) return;
    if (!navigator.geolocation) {
      postToMaps({ type:'lb:community:gps-error', trainNumber:train, message:'GPS non disponible sur cet appareil.' }, sourceWindow);
      showSignalFeedback('GPS non disponible sur cet appareil. Choisissez le retard manuellement.');
      return;
    }

    showSignalFeedback('Recherche ponctuelle de votre position…');
    navigator.geolocation.getCurrentPosition((position) => {
      const coords = position?.coords;
      if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
        postToMaps({ type:'lb:community:gps-error', trainNumber:train, message:'Position GPS inexploitable.' }, sourceWindow);
        return;
      }
      postToMaps({
        type:'lb:community:gps-position',
        trainNumber:train,
        latitude:Number(coords.latitude),
        longitude:Number(coords.longitude),
        accuracy:Number(coords.accuracy || 0),
        capturedAt:Date.now()
      }, sourceWindow);
    }, (error) => {
      const message = gpsErrorMessage(error);
      postToMaps({ type:'lb:community:gps-error', trainNumber:train, message }, sourceWindow);
      showSignalFeedback(message);
    }, {
      enableHighAccuracy:true,
      timeout:GPS_TIMEOUT_MS,
      maximumAge:15000
    });
  }

  function ensureGpsButton(){
    const delayWrap = document.getElementById('lbSignalDelayWrap');
    if (!delayWrap || document.getElementById('lbSignalGpsEstimate')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'lbSignalGpsEstimate';
    button.className = 'lb-signal-gps-estimate';
    button.innerHTML = '<span aria-hidden="true">📍</span><span>Estimer par GPS</span>';
    button.hidden = true;
    button.addEventListener('click', () => {
      const train = normalizeTrain(document.getElementById('lbSignalTrainSelect')?.value);
      if (!train) {
        showSignalFeedback('Choisissez d\'abord le train concerné.');
        return;
      }
      const frame = mapFrames()[0];
      if (!frame?.contentWindow) {
        showSignalFeedback('Ouvrez la carte pour utiliser l\'estimation GPS. La saisie manuelle reste disponible.');
        return;
      }
      button.disabled = true;
      button.classList.add('is-loading');
      window.clearTimeout(gpsResultTimer);
      gpsResultTimer = window.setTimeout(() => {
        finishGpsButton();
        showSignalFeedback('Le calcul cartographique ne répond pas. Choisissez le retard manuellement.');
      }, GPS_TIMEOUT_MS + 5000);
      requestGpsPosition(frame.contentWindow, train);
    });
    delayWrap.appendChild(button);
  }

  function updateGpsButtonVisibility(){
    ensureGpsButton();
    const button = document.getElementById('lbSignalGpsEstimate');
    if (!button) return;
    const selected = document.querySelector('.lb-signal-type.is-selected')?.getAttribute('data-signal-type');
    button.hidden = selected !== 'retard';
  }

  function finishGpsButton(){
    const button = document.getElementById('lbSignalGpsEstimate');
    if (!button) return;
    button.disabled = false;
    button.classList.remove('is-loading');
  }

  function installStyle(){
    if (document.getElementById('lb-community-map-bridge-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-map-bridge-v1-style';
    style.textContent = `
      #lbSignalDelayWrap{display:none;flex-wrap:wrap;gap:7px;align-items:stretch}
      #lbSignalDelayWrap.is-visible{display:flex}
      #lbSignalDelayWrap>select{flex:1 1 150px;min-width:0}
      .lb-signal-gps-estimate{flex:0 1 auto;min-height:40px;padding:8px 11px;border-radius:10px;border:1px solid rgba(0,234,255,.42);background:rgba(4,25,43,.92);color:#eafcff;font:inherit;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
      .lb-signal-gps-estimate:hover,.lb-signal-gps-estimate:focus-visible{border-color:#8ef8ff;box-shadow:0 0 0 2px rgba(0,234,255,.12)}
      .lb-signal-gps-estimate.is-loading{opacity:.7;cursor:wait}
      .lb-signal-gps-estimate[hidden]{display:none!important}
      @media(max-width:620px){.lb-signal-gps-estimate{flex:1 1 100%;width:100%}}
    `;
    document.head.appendChild(style);
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    const comesFromMap = mapFrames().some((frame) => frame.contentWindow === event.source);
    if (!comesFromMap) return;
    const train = normalizeTrain(data.trainNumber);

    if (data.type === 'lb:community:request') {
      broadcastSnapshot(true, event.source);
      return;
    }
    if (data.type === 'lb:community:open-signal') {
      if (train) window.lbCommunityLive?.openSignal?.(train);
      return;
    }
    if (data.type === 'lb:community:toggle-presence') {
      if (DEMO_MODE) {
        demoAboard = !demoAboard;
        broadcastSnapshot(true);
        return;
      }
      if (train) Promise.resolve(window.lbCommunityLive?.togglePresence?.(train)).finally(() => {
        window.setTimeout(() => broadcastSnapshot(true), 250);
      });
      return;
    }
    if (data.type === 'lb:community:gps-position-request') {
      requestGpsPosition(event.source, train);
      return;
    }
    if (data.type === 'lb:community:gps-delay-result') {
      window.clearTimeout(gpsResultTimer);
      finishGpsButton();
      if (!train) return;
      if (data.ok === false) {
        const message = String(data.message || 'Estimation GPS impossible. Choisissez le retard manuellement.');
        window.lbCommunityLive?.openSignal?.(train);
        showSignalFeedback(message);
        return;
      }
      window.lbCommunityLive?.openSignalEstimate?.({
        trainNumber:train,
        delayMin:Number(data.delayMin || 0),
        station:String(data.station || ''),
        accuracy:Number(data.accuracy || 0),
        railDistance:Number(data.railDistance || 0)
      });
      return;
    }
    if (data.type === 'lb:community:gps-error') {
      window.clearTimeout(gpsResultTimer);
      finishGpsButton();
      showSignalFeedback(String(data.message || 'Estimation GPS indisponible.'));
    }
  });

  document.addEventListener('click', (event) => {
    if (DEMO_MODE && event.target?.closest?.('#lbSignalSubmit')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showSignalFeedback('Test réussi ✅ Aucun signalement envoyé en production.');
      return;
    }
    if (event.target?.closest?.('.lb-signal-type,[data-lb-signal-train],#lbOpenSignalModal')) {
      window.setTimeout(updateGpsButtonVisibility, 0);
      window.setTimeout(updateGpsButtonVisibility, 300);
    }
  }, true);

  window.addEventListener('lb:community-presence-changed', () => {
    window.setTimeout(() => broadcastSnapshot(true), 0);
  });

  window.addEventListener('hashchange', refreshMapAfterReturn);
  window.addEventListener('pageshow', refreshMapAfterReturn);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshMapAfterReturn();
  });

  const start = () => {
    installStyle();
    ensureGpsButton();
    updateGpsButtonVisibility();
    bindMapFrames();
    frameObserver = new MutationObserver(() => bindMapFrames());
    frameObserver.observe(document.documentElement, { childList:true, subtree:true });
    window.setTimeout(() => broadcastSnapshot(true), 1200);
    window.setInterval(() => broadcastSnapshot(false), SNAPSHOT_INTERVAL_MS);
    if (DEMO_MODE) console.info(`[Voix du Bétail / carte] mode démonstration actif pour le train ${DEMO_TRAIN}`);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
