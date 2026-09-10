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
  const GPS_TIMEOUT_MS = 12000;
  const params = new URLSearchParams(window.location.search);
  const DEMO_MODE = params.get('lbCommunityDemo') === '1';
  const DEMO_TRAIN = normalizeDemoTrain(params.get('lbCommunityTrain')) || '88733';
  let lastSnapshotSignature = '';
  let gpsResultTimer = 0;
  let demoAboard = false;
  let liveDecorateQueued = false;
  let liveCardsObserver = null;
  const boundFrames = new WeakSet();

  const canContribute = () => DEMO_MODE || window.lbIsAuthed === true;

  function requestAuthentication(){
    document.getElementById('lbBtnOpenAuth')?.click();
    if (typeof window.lbToast === 'function') window.lbToast('Connectez-vous pour participer à la Voix du Bétail.');
  }

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
        canContribute:true,
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
      const value = window.lbCommunityLive?.getMapSnapshot?.() || null;
      return value ? { ...value, canContribute:canContribute() } : null;
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
    [0, 450].forEach((delay) => {
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

  function liveMetaKind(node){
    const chip = node?.matches?.('.lb-live-chip') ? node : node?.querySelector?.('.lb-live-chip');
    if (!chip) return { kind:'', chip:null };
    const text = String(chip.textContent || '').replace(/\s+/g, ' ').trim();
    if (/retard\s*\+\s*\d+/i.test(text) || /^\+\s*\d+\s*min\*$/i.test(text)) return { kind:'delay', chip };
    if (/supprim/i.test(text)) return { kind:'cancel', chip };
    if (/^📍/u.test(text)) return { kind:'station', chip };
    if (/^💬/u.test(text)) return { kind:'comment', chip };
    return { kind:'info', chip };
  }

  function decorateLiveTravelerCard(card){
    if (!card) return;
    const statusRow = card.querySelector('.lb-live-status-row');
    const official = statusRow?.querySelector('.lb-live-status') || null;
    const passenger = statusRow?.querySelector('.lb-live-passenger') || null;
    const userAlert = card.querySelector('.lb-live-user-alert');

    if (userAlert){
      const raw = String(userAlert.textContent || '').replace(/\s+/g, ' ').trim();
      const delayMatch = raw.match(/Signalé\s*:\s*\+?\s*(\d+)\s*min/i);
      if (delayMatch) userAlert.textContent = `+${Number(delayMatch[1])} min*`;
      else if (/supprim/i.test(raw) && raw !== 'Supprimé*') userAlert.textContent = 'Supprimé*';
      userAlert.classList.add('lb-live-community-alert');
      userAlert.title = 'Signalement de la communauté (* = Voix du Bétail)';
      if (statusRow && userAlert.parentElement !== statusRow) statusRow.appendChild(userAlert);
    }

    if (passenger){
      const countMatch = String(passenger.textContent || '').match(/(\d+)/);
      const count = countMatch ? Number(countMatch[1]) : 0;
      passenger.hidden = !(count > 0);
      passenger.title = count > 0 ? `${count} voyageur${count > 1 ? 's' : ''} signalé${count > 1 ? 's' : ''} à bord` : '';
    }

    if (statusRow){
      // Ordre stable et lisible : officiel SNCF, communauté, présence.
      const desired = [official, userAlert, passenger].filter(Boolean);
      const current = Array.from(statusRow.children).filter((node) => desired.includes(node));
      const sameOrder = desired.length === current.length
        && desired.every((node, index) => current[index] === node);
      if (!sameOrder) desired.forEach((node) => statusRow.appendChild(node));
    }

    const cause = card.querySelector('.lb-live-sncf-cause');
    const top = card.querySelector('.lb-live-card-top');
    if (cause && top && cause.previousElementSibling !== top){
      top.insertAdjacentElement('afterend', cause);
    }

    const meta = card.querySelector('.lb-live-meta');
    if (meta){
      meta.classList.add('lb-live-community-meta');
      const children = Array.from(meta.children);
      const ranked = children.map((node, index) => {
        const { kind, chip } = liveMetaKind(node);
        if (kind) node.classList.add(`lb-live-meta-${kind}`);
        if (chip){
          chip.classList.add(`lb-live-chip--community-${kind || 'info'}`);
          if (kind === 'delay'){
            const match = String(chip.textContent || '').match(/\+\s*(\d+)\s*min/i);
            if (match) {
              const wanted = `+${Number(match[1])} min*`;
              if (String(chip.textContent || '').trim() !== wanted) chip.textContent = wanted;
            }
            chip.title = 'Retard signalé par la communauté';
          } else if (kind === 'cancel'){
            if (!/\*$/.test(String(chip.textContent || '').trim())) chip.textContent = `${String(chip.textContent || '').trim()}*`;
            chip.title = 'Suppression signalée par la communauté';
          }
        }
        const rank = ({ delay:0, cancel:0, station:1, info:2, comment:3 })[kind] ?? 4;
        return { node, rank, index };
      });
      const sorted = ranked.sort((a,b) => a.rank - b.rank || a.index - b.index);
      const currentOrder = Array.from(meta.children);
      const sameOrder = sorted.length === currentOrder.length
        && sorted.every(({ node }, index) => currentOrder[index] === node);
      if (!sameOrder) sorted.forEach(({ node }) => meta.appendChild(node));
    }
  }

  function decorateLiveTravelerCards(){
    liveDecorateQueued = false;
    const root = document.getElementById('lbLiveTrainCards');
    if (!root) return;
    root.querySelectorAll('.lb-live-card').forEach(decorateLiveTravelerCard);
  }

  function scheduleLiveTravelerDecorate(){
    if (liveDecorateQueued) return;
    liveDecorateQueued = true;
    requestAnimationFrame(decorateLiveTravelerCards);
  }

  function bindLiveCardsObserver(){
    const root = document.getElementById('lbLiveTrainCards');
    if (!root || liveCardsObserver) return;
    liveCardsObserver = new MutationObserver(() => scheduleLiveTravelerDecorate());
    liveCardsObserver.observe(root, { childList:true, subtree:true });
    scheduleLiveTravelerDecorate();
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

      /* LIVE voyageurs : officiel > communauté > détails. */
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-status-row{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex-wrap:wrap!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-status-row .lb-live-status{order:1}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-status-row .lb-live-community-alert{order:2}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-status-row .lb-live-passenger{order:3}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-alert{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:auto!important;min-width:0!important;height:18px!important;min-height:18px!important;padding:0 6px!important;border:1px solid rgba(183,140,255,.52)!important;border-radius:999px!important;background:rgba(77,43,113,.78)!important;color:#f3ebff!important;font:900 .57rem/1 "Rajdhani",system-ui,sans-serif!important;letter-spacing:.01em!important;box-shadow:none!important;white-space:nowrap!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-alert.lb-live-user-alert--cancel{background:rgba(94,45,112,.82)!important;border-color:rgba(203,151,255,.58)!important;color:#f6eaff!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-passenger[hidden]{display:none!important}

      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-sncf-cause{box-sizing:border-box!important;width:100%!important;max-width:none!important;margin:5px 0 0!important;padding:4px 7px!important;border:0!important;border-left:2px solid var(--lb-live-accent,#ff9d4d)!important;border-radius:4px!important;background:color-mix(in srgb,var(--lb-live-accent,#ff9d4d) 7%,transparent)!important;color:#d8edf1!important;font:700 .62rem/1.18 "Rajdhani",system-ui,sans-serif!important;text-align:left!important;white-space:normal!important;overflow-wrap:anywhere!important;box-shadow:none!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-sncf-cause--cancel{border-left-color:#ff5967!important;background:rgba(255,89,103,.055)!important}

      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta{display:flex!important;align-items:center!important;gap:5px!important;flex-wrap:wrap!important;margin:7px 0 0!important;padding:6px 0 0!important;border-top:1px solid rgba(183,140,255,.15)!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta>.lb-stop-chip-wrap,
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta>.lb-live-chip{margin:0!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-live-chip{box-sizing:border-box!important;min-height:18px!important;height:18px!important;padding:0 6px!important;border-radius:999px!important;font:800 .57rem/1 "Rajdhani",system-ui,sans-serif!important;box-shadow:none!important;white-space:nowrap!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-chip--community-delay,
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-chip--community-cancel{border:1px solid rgba(183,140,255,.48)!important;background:rgba(77,43,113,.66)!important;color:#f1e8ff!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-chip--community-station{border:1px solid rgba(183,140,255,.18)!important;background:rgba(55,39,75,.42)!important;color:#cfbddf!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-chip--community-comment,
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-chip--community-info{border:1px solid rgba(111,151,165,.16)!important;background:rgba(8,27,38,.55)!important;color:#a9c0c7!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-stop-chip-wrap{display:inline-flex!important;align-items:center!important;gap:3px!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-signal-vote{display:inline-flex!important;align-items:center!important;gap:1px!important;height:18px!important;padding:0 2px!important;border:0!important;background:transparent!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-signal-vote-btn{box-sizing:border-box!important;width:17px!important;min-width:17px!important;height:17px!important;min-height:17px!important;padding:0!important;border:0!important;border-radius:50%!important;background:rgba(8,27,38,.68)!important;font-size:9px!important;line-height:17px!important;box-shadow:none!important;transform:none!important}
      html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-signal-vote-count{min-width:9px!important;color:#9fb4bc!important;font:800 .55rem/1 "Rajdhani",system-ui,sans-serif!important;text-align:center!important}

      @media(max-width:620px){
        .lb-signal-gps-estimate{flex:1 1 100%;width:100%}
        html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-alert{height:17px!important;min-height:17px!important;padding:0 5px!important;font-size:.54rem!important}
        html[data-lb-v4-live="1"] #lbLiveModal .lb-live-sncf-cause{margin-top:4px!important;padding:3px 6px!important;font-size:.59rem!important}
        html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta{gap:4px!important;margin-top:6px!important;padding-top:5px!important}
        html[data-lb-v4-live="1"] #lbLiveModal .lb-live-community-meta .lb-live-chip{height:17px!important;min-height:17px!important;padding:0 5px!important;font-size:.54rem!important}
      }
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
      if (!canContribute()) { requestAuthentication(); return; }
      if (train) window.lbCommunityLive?.openSignal?.(train);
      return;
    }
    if (data.type === 'lb:community:toggle-presence') {
      if (DEMO_MODE) {
        demoAboard = !demoAboard;
        broadcastSnapshot(true);
        return;
      }
      if (!canContribute()) { requestAuthentication(); broadcastSnapshot(true); return; }
      if (train) Promise.resolve(window.lbCommunityLive?.togglePresence?.(train)).finally(() => {
        window.setTimeout(() => broadcastSnapshot(true), 250);
      });
      return;
    }
    if (data.type === 'lb:community:gps-position-request') {
      if (!canContribute()) { requestAuthentication(); return; }
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
    scheduleLiveTravelerDecorate();
  });
  window.addEventListener('lb:community-data-changed', () => {
    window.setTimeout(() => broadcastSnapshot(false), 0);
    scheduleLiveTravelerDecorate();
  });
  document.addEventListener('lb:auth-state', () => {
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
    bindLiveCardsObserver();
    window.setTimeout(() => {
      bindLiveCardsObserver();
      scheduleLiveTravelerDecorate();
    }, 800);
    window.setTimeout(() => broadcastSnapshot(true), 1200);
    if (DEMO_MODE) console.info(`[Voix du Bétail / carte] mode démonstration actif pour le train ${DEMO_TRAIN}`);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
