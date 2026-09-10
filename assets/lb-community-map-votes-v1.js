'use strict';

/*
 * La Bétaillère — votes compacts des retards voyageurs sur la carte.
 *
 * Couche additive :
 * - ne modifie pas le moteur SNCF/CFL ;
 * - réutilise le vote/modération existant via un clic DOM délégué ;
 * - enrichit seulement le snapshot carte avec l'identifiant et le score du
 *   signalement à l'origine du retard affiché.
 */
(() => {
  if (window.__LB_COMMUNITY_MAP_VOTES_V1__) return;
  window.__LB_COMMUNITY_MAP_VOTES_V1__ = true;

  const MAP_SELECTOR = '#carte iframe';
  const SIGNAL_TTL_MS = 45 * 60 * 1000;
  const voteSignals = [];
  const boundFrames = new WeakSet();
  let refreshPromise = null;
  let broadcastTimer = 0;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const parseTs = (raw) => {
    const direct = Number(raw?.ts || raw?.timestamp || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(raw?.created_at || raw?.createdAt || raw?.date || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const mapFrames = () => Array.from(document.querySelectorAll(MAP_SELECTOR));
  const canContribute = () => window.lbIsAuthed === true;

  function requestAuthentication(){
    document.getElementById('lbBtnOpenAuth')?.click();
    if (typeof window.lbToast === 'function') {
      window.lbToast('Connectez-vous pour noter ce retard signalé par le bétail.');
    }
  }

  function normalizeSignal(raw){
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const trainNumber = normalizeTrain(raw.train_number || raw.trainNumber || raw.train || '');
    const station = String(raw.station || raw.stop_name || raw.stopName || '').trim();
    const signalType = String(raw.signal_type || raw.signalType || '').trim().toLowerCase();
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? 0) || 0);
    const upvotes = Math.max(0, Math.round(Number(raw.upvotes || 0) || 0));
    const downvotes = Math.max(0, Math.round(Number(raw.downvotes || 0) || 0));
    const myVote = Math.max(-1, Math.min(1, Math.round(Number(raw.my_vote ?? raw.myVote ?? 0) || 0)));
    const ts = parseTs(raw);
    if (!id || !trainNumber || signalType !== 'retard' || !(delayMin > 0)) return null;
    if (ts && ts < Date.now() - SIGNAL_TTL_MS) return null;
    if ((upvotes - downvotes) <= -3) return null;
    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  async function refreshVoteSignals(){
    if (refreshPromise) return refreshPromise;
    if (typeof window.fetchCommentsApi !== 'function') return voteSignals;

    refreshPromise = (async () => {
      try {
        const response = await window.fetchCommentsApi('?scope=signals');
        if (!response?.ok) throw new Error(`HTTP ${response?.status || '?'}`);
        const data = await response.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
        voteSignals.splice(0, voteSignals.length, ...list.map(normalizeSignal).filter(Boolean));
      } catch (error) {
        console.warn('[Voix du Bétail / carte] votes indisponibles', error?.message || error);
      }
      return voteSignals;
    })().finally(() => { refreshPromise = null; });

    return refreshPromise;
  }

  function signalForStop(trainNumber, station, delayMin){
    const trainKey = normalizeTrain(trainNumber);
    const stopKey = normalizeStop(station);
    const wantedDelay = Math.round(Number(delayMin) || 0);
    if (!trainKey || !stopKey) return null;

    const candidates = voteSignals
      .filter((signal) => signal.trainNumber === trainKey && signal.stopKey === stopKey)
      .sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0));
    if (!candidates.length) return null;
    return candidates.find((signal) => signal.delayMin === wantedDelay) || candidates[0];
  }

  function enrichedSnapshot(){
    let base = null;
    try { base = window.lbCommunityLive?.getMapSnapshot?.() || null; } catch(_) { base = null; }
    if (!base || typeof base !== 'object') return null;

    const trains = {};
    Object.entries(base.trains || {}).forEach(([number, rawItem]) => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const travelerStops = {};
      Object.entries(item.travelerStops || {}).forEach(([stopKey, rawReport]) => {
        const report = rawReport && typeof rawReport === 'object' ? rawReport : {};
        const signal = signalForStop(number, report.station || stopKey, report.delayMin);
        travelerStops[stopKey] = {
          ...report,
          vote: signal ? {
            signalId:signal.id,
            score:signal.upvotes - signal.downvotes,
            upvotes:signal.upvotes,
            downvotes:signal.downvotes,
            myVote:signal.myVote
          } : null
        };
      });
      trains[number] = { ...item, travelerStops };
    });

    return { ...base, canContribute:canContribute(), trains, voteMetadata:true };
  }

  function postSnapshot(targetWindow = null){
    const snapshot = enrichedSnapshot();
    if (!snapshot) return;
    const payload = { type:'lb:community:snapshot', ...snapshot };

    if (targetWindow && typeof targetWindow.postMessage === 'function') {
      try { targetWindow.postMessage(payload, '*'); } catch(_) {}
      return;
    }
    mapFrames().forEach((frame) => {
      try { frame.contentWindow?.postMessage(payload, '*'); } catch(_) {}
    });
  }

  async function refreshAndBroadcast(targetWindow = null){
    await refreshVoteSignals();
    postSnapshot(targetWindow);
  }

  function queueRefreshAndBroadcast(delay = 0, targetWindow = null){
    window.clearTimeout(broadcastTimer);
    broadcastTimer = window.setTimeout(() => {
      refreshAndBroadcast(targetWindow).catch(() => {});
    }, delay);
  }

  function bindFrames(){
    mapFrames().forEach((frame) => {
      if (boundFrames.has(frame)) return;
      boundFrames.add(frame);
      frame.addEventListener('load', () => {
        window.setTimeout(() => refreshAndBroadcast(frame.contentWindow).catch(() => {}), 180);
        window.setTimeout(() => refreshAndBroadcast(frame.contentWindow).catch(() => {}), 850);
      });
    });
  }

  function delegateVoteToExistingSystem(signalId, value){
    const id = String(signalId || '').trim();
    const voteValue = Number(value) > 0 ? 1 : -1;
    const signal = voteSignals.find((item) => item.id === id) || null;
    if (!id || !signal) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.hidden = true;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    button.setAttribute('data-lb-vote-signal', id);
    button.setAttribute('data-lb-vote-value', String(voteValue));
    document.body.appendChild(button);
    button.click();
    button.remove();
    return true;
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || typeof data !== 'object' || data.type !== 'lb:community:vote-delay') return;
    if (!mapFrames().some((frame) => frame.contentWindow === event.source)) return;

    if (!canContribute()) {
      requestAuthentication();
      return;
    }

    const id = String(data.signalId || '').trim();
    const train = normalizeTrain(data.trainNumber);
    const signal = voteSignals.find((item) => item.id === id) || null;
    if (!signal || (train && signal.trainNumber !== train)) return;

    if (delegateVoteToExistingSystem(id, data.value)) {
      // Le système natif déclenche lb:community-data-changed après succès.
      // Ces deux reprises courtes ne servent que de filet de sécurité réseau/UI.
      window.setTimeout(() => queueRefreshAndBroadcast(0), 650);
      window.setTimeout(() => queueRefreshAndBroadcast(0), 1800);
    }
  });

  window.addEventListener('lb:community-data-changed', () => queueRefreshAndBroadcast(0));
  window.addEventListener('lb:community-presence-changed', () => queueRefreshAndBroadcast(0));
  document.addEventListener('lb:auth-state', () => queueRefreshAndBroadcast(0));
  window.addEventListener('pageshow', () => { bindFrames(); queueRefreshAndBroadcast(0); });
  window.addEventListener('hashchange', () => { bindFrames(); queueRefreshAndBroadcast(0); });

  function start(){
    bindFrames();
    queueRefreshAndBroadcast(250);
    window.setTimeout(() => { bindFrames(); queueRefreshAndBroadcast(0); }, 1200);
  }

  window.lbCommunityMapVotesV1 = {
    refresh: () => refreshAndBroadcast(),
    get signals(){ return voteSignals.slice(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
