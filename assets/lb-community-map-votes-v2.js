'use strict';

/*
 * La Bétaillère — votes des retards voyageurs sur la carte, V2.
 * Le module lit directement l'API commentaires (même backend que Voix du Bétail)
 * afin de ne pas dépendre d'une fonction privée de index.html.
 */
(() => {
  if (window.__LB_COMMUNITY_MAP_VOTES_V2__) return;
  window.__LB_COMMUNITY_MAP_VOTES_V2__ = true;

  const MAP_SELECTOR = '#carte iframe';
  const SIGNAL_TTL_MS = 45 * 60 * 1000;
  const API_URLS = [
    'https://vps.labetaillere.fr/api/comments?scope=signals',
    '/api/comments?scope=signals'
  ];
  const voteSignals = [];
  const boundFrames = new WeakSet();
  let refreshPromise = null;
  let broadcastTimer = 0;
  let lastFetchAt = 0;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const parseTs = (raw) => {
    const value = raw?.created_at || raw?.createdAt || raw?.ts || raw?.timestamp || raw?.date || '';
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const mapFrames = () => Array.from(document.querySelectorAll(MAP_SELECTOR));
  const canContribute = () => window.lbIsAuthed === true;

  function normalizeSignal(raw){
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const message = String(raw.message || raw.text || '').trim();
    const parsed = message.match(/^\[(RETARD|SUPPRESSION|INFORMATION|A L'HEURE|A-L'HEURE|A LHEURE)\]\s*(?:#?([A-Z]{2,5})\s*)?(\d{3,6})?\s*(?:\[([^\]]+)\])?\s*[—\-:]?\s*(.*)$/i);
    const trainNumber = normalizeTrain(raw.train_number || raw.trainNumber || raw.train || parsed?.[3] || '');
    const station = String(raw.station || raw.stop_name || raw.stopName || parsed?.[4] || '').trim();
    const signalType = String(raw.signal_type || raw.signalType || parsed?.[1] || '')
      .trim().toLowerCase().replace(/\s+/g, '-');
    const parsedDelay = Number(String(parsed?.[5] || message).match(/\+\s*(\d{1,3})\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? parsedDelay ?? 0) || 0);
    const upvotes = Math.max(0, Math.round(Number(raw.upvotes || 0) || 0));
    const downvotes = Math.max(0, Math.round(Number(raw.downvotes || 0) || 0));
    const myVote = Math.max(-1, Math.min(1, Math.round(Number(raw.my_vote ?? raw.myVote ?? 0) || 0)));
    const ts = parseTs(raw);
    if (!id || !trainNumber || signalType !== 'retard' || !(delayMin > 0)) return null;
    if (ts && ts < Date.now() - SIGNAL_TTL_MS) return null;
    if ((upvotes - downvotes) <= -3) return null;
    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  async function fetchSignalsPayload(){
    let lastError = null;
    for (const url of API_URLS) {
      try {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
          method:'GET',
          credentials:'include',
          cache:'no-store'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('API commentaires indisponible');
  }

  async function refreshVoteSignals(force = false){
    if (refreshPromise) return refreshPromise;
    if (!force && voteSignals.length && (Date.now() - lastFetchAt) < 10000) return voteSignals;

    refreshPromise = (async () => {
      try {
        const data = await fetchSignalsPayload();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
        voteSignals.splice(0, voteSignals.length, ...list.map(normalizeSignal).filter(Boolean));
        lastFetchAt = Date.now();
      } catch (error) {
        console.warn('[Voix du Bétail / carte] chargement des votes impossible', error?.message || error);
      }
      return voteSignals;
    })().finally(() => { refreshPromise = null; });

    return refreshPromise;
  }

  function signalForStop(trainNumber, station, delayMin){
    const trainKey = normalizeTrain(trainNumber);
    const stopKey = normalizeStop(station);
    const wantedDelay = Math.round(Number(delayMin) || 0);
    if (!trainKey || !stopKey || !(wantedDelay > 0)) return null;

    return voteSignals
      .filter((signal) => signal.trainNumber === trainKey && signal.stopKey === stopKey && signal.delayMin === wantedDelay)
      .sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0))[0] || null;
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

  async function refreshAndBroadcast(targetWindow = null, force = false){
    await refreshVoteSignals(force);
    postSnapshot(targetWindow);
  }

  function queueRefreshAndBroadcast(delay = 0, targetWindow = null, force = false){
    window.clearTimeout(broadcastTimer);
    broadcastTimer = window.setTimeout(() => {
      refreshAndBroadcast(targetWindow, force).catch(() => {});
    }, delay);
  }

  function bindFrames(){
    mapFrames().forEach((frame) => {
      if (boundFrames.has(frame)) return;
      boundFrames.add(frame);
      frame.addEventListener('load', () => {
        window.setTimeout(() => refreshAndBroadcast(frame.contentWindow, true).catch(() => {}), 150);
        window.setTimeout(() => refreshAndBroadcast(frame.contentWindow, false).catch(() => {}), 900);
      });
    });
  }

  function requestAuthentication(){
    document.getElementById('lbBtnOpenAuth')?.click();
    if (typeof window.lbToast === 'function') window.lbToast('Connectez-vous pour noter ce retard signalé par le bétail.');
  }

  function delegateVoteToExistingSystem(signalId, value){
    const id = String(signalId || '').trim();
    const signal = voteSignals.find((item) => item.id === id) || null;
    if (!id || !signal) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.hidden = true;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    button.setAttribute('data-lb-vote-signal', id);
    button.setAttribute('data-lb-vote-value', Number(value) > 0 ? '1' : '-1');
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
      window.setTimeout(() => queueRefreshAndBroadcast(0, null, true), 650);
      window.setTimeout(() => queueRefreshAndBroadcast(0, null, true), 1800);
    }
  });

  window.addEventListener('lb:community-data-changed', () => queueRefreshAndBroadcast(0, null, true));
  window.addEventListener('lb:community-presence-changed', () => queueRefreshAndBroadcast(0));
  document.addEventListener('lb:auth-state', () => queueRefreshAndBroadcast(0, null, true));
  window.addEventListener('pageshow', () => { bindFrames(); queueRefreshAndBroadcast(0, null, true); });
  window.addEventListener('hashchange', () => { bindFrames(); queueRefreshAndBroadcast(0, null, true); });

  function start(){
    bindFrames();
    queueRefreshAndBroadcast(120, null, true);
    window.setTimeout(() => { bindFrames(); queueRefreshAndBroadcast(0, null, true); }, 1100);
  }

  window.lbCommunityMapVotesV2 = {
    refresh: () => refreshAndBroadcast(null, true),
    get signals(){ return voteSignals.slice(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
