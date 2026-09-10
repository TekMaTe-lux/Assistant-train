'use strict';

/*
 * La Bétaillère — votes compacts des retards voyageurs sur la carte V3.
 *
 * Objectifs V3 :
 * - aucune requête de vote au démarrage de la carte : les trains gardent la priorité ;
 * - lecture de l'API seulement lorsqu'une fiche ouverte contient un retard voyageur ;
 * - created_at SQL interprété en UTC ;
 * - pouces réellement visibles/tactiles sur mobile sans agrandir le bloc desktop.
 */
(() => {
  if (window.__LB_COMMUNITY_TRAVELER_VOTE_V3__) return;
  window.__LB_COMMUNITY_TRAVELER_VOTE_V3__ = true;

  const SIGNAL_TTL_MS = 45 * 60 * 1000;
  const API_SIGNALS = '/api/comments?scope=signals';
  const snapshot = { trains:{}, canContribute:false };
  const signals = [];
  let renderQueued = false;
  let refreshPromise = null;
  let lastFetchAt = 0;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(gare|centrale|station)\b/g, ' ')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function parseTs(raw){
    const value = raw?.created_at ?? raw?.createdAt ?? raw?.ts ?? raw?.timestamp ?? raw?.date ?? raw?.created ?? '';
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value || '').trim())) {
      let n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 1e12) n *= 1000;
      return n;
    }

    let text = String(value || '').trim();
    // L'API stocke created_at en UTC sans suffixe : "YYYY-MM-DD HH:MM:SS".
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
      text = text.replace(' ', 'T') + 'Z';
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeSignal(raw){
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id ?? raw.signal_id ?? raw.signalId ?? '').trim();
    const message = String(raw.message ?? raw.text ?? raw.content ?? '').trim();
    const parsed = message.match(/^\s*\[(RETARD|DELAY|SUPPRESSION|INFORMATION|A L'HEURE|A-L'HEURE|A LHEURE)\]\s*(?:#?([A-Z]{2,8})\s*)?(\d{3,6})?\s*(?:\[([^\]]+)\])?\s*[—\-:]?\s*(.*)$/i);

    const trainNumber = normalizeTrain(
      raw.train_number ?? raw.trainNumber ?? raw.train ?? raw.number ?? raw.train_no ?? parsed?.[3] ?? message
    );
    const station = String(
      raw.station ?? raw.stop_name ?? raw.stopName ?? raw.station_name ?? raw.stationName ?? parsed?.[4] ?? ''
    ).trim();

    let signalType = String(
      raw.signal_type ?? raw.signalType ?? raw.type ?? raw.kind ?? parsed?.[1] ?? ''
    ).trim().toLowerCase();
    signalType = signalType.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-');
    if (['delay','late','retard-train'].includes(signalType)) signalType = 'retard';

    const textDelay = Number(String(parsed?.[5] || message).match(/\+\s*(\d{1,3})\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(
      raw.delay_min ?? raw.delayMin ?? raw.delay_minutes ?? raw.delayMinutes ?? raw.delay ?? textDelay ?? 0
    ) || 0);

    const upvotes = Math.max(0, Math.round(Number(
      raw.upvotes ?? raw.upVotes ?? raw.votes_up ?? raw.votesUp ?? raw.positive_votes ?? 0
    ) || 0));
    const downvotes = Math.max(0, Math.round(Number(
      raw.downvotes ?? raw.downVotes ?? raw.votes_down ?? raw.votesDown ?? raw.negative_votes ?? 0
    ) || 0));
    const myVote = Math.max(-1, Math.min(1, Math.round(Number(
      raw.my_vote ?? raw.myVote ?? raw.user_vote ?? raw.userVote ?? 0
    ) || 0)));
    const ts = parseTs(raw);

    if (!id || !trainNumber || signalType !== 'retard' || !(delayMin > 0)) return null;
    if (ts && ts < Date.now() - SIGNAL_TTL_MS) return null;
    if ((upvotes - downvotes) <= -3) return null;

    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  function extractList(data){
    if (Array.isArray(data)) return data;
    for (const key of ['comments','signals','items','data','results']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  async function refreshSignals(force = false){
    if (refreshPromise) return refreshPromise;
    if (!force && lastFetchAt && Date.now() - lastFetchAt < 8000) return signals;

    refreshPromise = (async () => {
      try {
        const separator = API_SIGNALS.includes('?') ? '&' : '?';
        const response = await fetch(`${API_SIGNALS}${separator}_=${Date.now()}`, {
          method:'GET',
          credentials:'include',
          cache:'no-store',
          headers:{ 'Accept':'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const normalized = extractList(data).map(normalizeSignal).filter(Boolean);
        signals.splice(0, signals.length, ...normalized);
        lastFetchAt = Date.now();
      } catch (error) {
        console.warn('[Voix du Bétail / carte] API votes indisponible', error?.message || error);
      }
      scheduleRender();
      return signals;
    })().finally(() => { refreshPromise = null; });

    return refreshPromise;
  }

  function currentTripNumber(){
    const block = document.getElementById('lb-map-trip-community');
    const fromBlock = normalizeTrain(block?.dataset?.trainNumber);
    if (fromBlock) return fromBlock;
    return normalizeTrain(document.querySelector('#trip-panel-train')?.textContent || document.querySelector('.trip-panel-title')?.textContent);
  }

  function itemForTrain(trainNumber){
    const key = normalizeTrain(trainNumber);
    if (!key) return null;
    return snapshot.trains?.[key] || Object.entries(snapshot.trains || {}).find(([k]) => normalizeTrain(k) === key)?.[1] || null;
  }

  function latestDelayReport(item){
    const reports = Object.values(item?.travelerStops || {})
      .filter((report) => report && Number(report.delayMin) > 0);
    if (!reports.length) return null;

    const wantedDelay = Math.round(Number(item?.travelerDelayMin) || 0);
    const matching = wantedDelay > 0
      ? reports.filter((report) => Math.round(Number(report.delayMin) || 0) === wantedDelay)
      : reports;
    const candidates = matching.length ? matching : reports;
    candidates.sort((a,b) => Number(b.lastReportAt || 0) - Number(a.lastReportAt || 0));
    return candidates[0] || null;
  }

  function signalForReport(trainNumber, report, delayMin){
    const trainKey = normalizeTrain(trainNumber);
    const wantedDelay = Math.round(Number(delayMin) || 0);
    const stopKey = normalizeStop(report?.station || '');
    let reportTs = Number(report?.lastReportAt || 0);
    if (reportTs > 0 && reportTs < 1e12) reportTs *= 1000;

    const candidates = signals.filter((signal) =>
      signal.trainNumber === trainKey && signal.delayMin === wantedDelay
    );
    if (!candidates.length) return null;

    const exact = candidates
      .filter((signal) => stopKey && signal.stopKey === stopKey)
      .sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0));
    if (exact.length) return exact[0];

    if (reportTs > 0) {
      const near = candidates
        .map((signal) => ({ signal, dt:Math.abs(Number(signal.ts || 0) - reportTs) }))
        .filter((entry) => entry.signal.ts > 0 && entry.dt <= 10 * 60 * 1000)
        .sort((a,b) => a.dt - b.dt);
      if (near.length === 1 || (near.length > 1 && near[0].dt + 30000 < near[1].dt)) return near[0].signal;
    }

    if (candidates.length === 1) return candidates[0];
    return null;
  }

  function buildVoteButton(kind, signal, value){
    const active = Number(signal?.myVote || 0) === value;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lb-community-map-vote-btn is-${kind}${active ? ' is-active' : ''}`;
    button.dataset.lbMapDelayVote = String(value);
    button.dataset.signalId = String(signal?.id || '');
    button.textContent = kind === 'up' ? '👍' : '👎';
    button.title = kind === 'up' ? 'Confirmer ce retard signalé par le bétail' : 'Contester ce retard signalé par le bétail';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    return button;
  }

  function render(){
    renderQueued = false;
    const block = document.getElementById('lb-map-trip-community');
    const sourceLine = block?.querySelector('.lb-community-source-line');
    if (!block || !sourceLine) return;

    const number = currentTripNumber();
    const item = itemForTrain(number);
    const delay = Math.max(0, Math.round(Number(item?.travelerDelayMin) || 0));
    const report = delay > 0 ? latestDelayReport(item) : null;
    const station = String(report?.station || '').trim();

    if (!(delay > 0) || !station) {
      sourceLine.classList.remove('lb-community-source-line--votes');
      return;
    }

    // Lazy load : seulement maintenant qu'une fiche avec retard voyageur est ouverte.
    // Cette requête ne concurrence donc plus le chargement initial des trains.
    if (!lastFetchAt || Date.now() - lastFetchAt >= 8000) {
      refreshSignals(false).catch(() => {});
    }

    const signal = signalForReport(number, report, delay);
    sourceLine.replaceChildren();
    sourceLine.classList.add('lb-community-source-line--votes');
    sourceLine.hidden = false;

    const label = document.createElement('span');
    label.className = 'lb-community-source-label';
    label.textContent = `Retard signalé par le bétail depuis ${station}`;
    label.title = `Retard voyageur signalé par le bétail depuis ${station}`;
    sourceLine.appendChild(label);

    if (!signal) return;

    const votes = document.createElement('span');
    votes.className = 'lb-community-map-votes';
    votes.dataset.signalId = signal.id;
    votes.appendChild(buildVoteButton('up', signal, 1));

    const count = document.createElement('span');
    count.className = 'lb-community-map-vote-count';
    count.textContent = String(signal.upvotes - signal.downvotes);
    count.title = `Score du signalement : ${signal.upvotes - signal.downvotes}`;
    votes.appendChild(count);

    votes.appendChild(buildVoteButton('down', signal, -1));
    sourceLine.appendChild(votes);
  }

  function scheduleRender(){
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function installTripHook(){
    if (typeof renderTripPanel !== 'function' || renderTripPanel.__lbCommunityVoteV3) return;
    const original = renderTripPanel;
    const wrapped = function(...args){
      const result = original.apply(this, args);
      scheduleRender();
      return result;
    };
    wrapped.__lbCommunityVoteV3 = true;
    if (original.__lbTravelerWrapped) wrapped.__lbTravelerWrapped = true;
    if (original.__lbCommunityCompactV2) wrapped.__lbCommunityCompactV2 = true;
    renderTripPanel = wrapped;
  }

  function installStyle(){
    if (document.getElementById('lb-community-traveler-vote-v3-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-traveler-vote-v3-style';
    style.textContent = `
      .lb-community-source-line.lb-community-source-line--votes{display:flex!important;align-items:center!important;gap:5px!important;min-width:0!important;overflow:hidden!important}
      .lb-community-source-label{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8b9dd}
      .lb-community-map-votes{display:inline-flex!important;flex:0 0 auto;align-items:center;gap:1px;height:18px;padding:0 2px;border-radius:999px;background:rgba(32,22,46,.42);visibility:visible!important;opacity:1!important}
      .lb-community-map-vote-btn{box-sizing:border-box;width:17px;min-width:17px;height:17px;min-height:17px;padding:0;border:0;border-radius:50%;background:rgba(8,27,38,.72);color:#dce9ee;font-size:9px;line-height:17px;text-align:center;cursor:pointer;box-shadow:none;opacity:.82}
      .lb-community-map-vote-btn:hover,.lb-community-map-vote-btn:focus-visible{opacity:1;background:rgba(15,49,65,.95);outline:1px solid rgba(142,248,255,.5)}
      .lb-community-map-vote-btn.is-active{opacity:1;background:rgba(91,52,126,.95);box-shadow:inset 0 0 0 1px rgba(195,154,255,.65)}
      .lb-community-map-vote-count{min-width:10px;color:#d2c2e5;font-size:8px;font-weight:900;line-height:1;text-align:center}

      /* Mobile : la source prend toute la deuxième ligne. Les pouces ne sont
         plus coincés entre le texte et les boutons À bord / Signaler. */
      @media (max-width:700px), (pointer:coarse){
        .lb-map-trip-community{grid-template-areas:'title status actions' 'source source source'!important}
        .lb-community-source-line.lb-community-source-line--votes{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;column-gap:5px!important;width:100%!important;max-width:100%!important;overflow:visible!important;padding-top:1px!important}
        .lb-community-source-label{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        .lb-community-map-votes{display:inline-flex!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:5!important;flex:none!important;height:22px!important;padding:0 2px!important;gap:1px!important}
        .lb-community-map-vote-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:21px!important;min-width:21px!important;height:21px!important;min-height:21px!important;font-size:11px!important;line-height:21px!important;opacity:1!important}
        .lb-community-map-vote-count{display:inline-block!important;min-width:11px!important;font-size:9px!important;line-height:1!important}
      }

      @media(max-width:380px){
        .lb-community-source-line.lb-community-source-line--votes{column-gap:3px!important}
        .lb-community-map-votes{height:21px!important;padding:0 1px!important}
        .lb-community-map-vote-btn{width:20px!important;min-width:20px!important;height:20px!important;min-height:20px!important;font-size:10.5px!important;line-height:20px!important}
        .lb-community-map-vote-count{min-width:9px!important;font-size:8.5px!important}
      }
    `;
    document.head.appendChild(style);
  }

  async function directVote(signalId, value){
    const id = String(signalId || '').trim();
    const voteValue = Number(value) > 0 ? 1 : -1;
    const signal = signals.find((entry) => entry.id === id) || null;
    if (!id || !signal) return;

    const projectedScore = (signal.upvotes - signal.downvotes)
      + (signal.myVote === 1 ? -1 : signal.myVote === -1 ? 1 : 0)
      + voteValue;
    if (voteValue < 0 && projectedScore <= -3) {
      const ok = window.confirm('Ce vote peut entraîner la suppression du signalement communautaire. Confirmer ?');
      if (!ok) return;
    }

    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(id)}/vote`, {
        method:'POST',
        credentials:'include',
        cache:'no-store',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body:JSON.stringify({ vote:voteValue })
      });

      if (response.status === 401 || response.status === 403) {
        try {
          window.parent?.postMessage({ type:'lb:community:open-signal', trainNumber:currentTripNumber() }, '*');
        } catch(_) {}
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await refreshSignals(true);
      scheduleRender();
    } catch (error) {
      console.warn('[Voix du Bétail / carte] vote impossible', error?.message || error);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-lb-map-delay-vote]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const signalId = String(button.dataset.signalId || '').trim();
    if (!signalId) return;
    directVote(signalId, Number(button.dataset.lbMapDelayVote)).catch(() => {});
  }, true);

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || typeof data !== 'object' || data.type !== 'lb:community:snapshot') return;
    if (window.parent !== window && event.source !== window.parent) return;
    snapshot.trains = data.trains && typeof data.trains === 'object' ? data.trains : {};
    snapshot.canContribute = data.canContribute === true;
    scheduleRender();
  });

  function start(){
    installStyle();
    installTripHook();
    scheduleRender();
    // Un second passage couvre uniquement l'ordre d'initialisation des wrappers.
    // Aucune API communautaire n'est appelée tant qu'un retard voyageur n'est pas ouvert.
    window.setTimeout(() => { installTripHook(); scheduleRender(); }, 0);
  }

  window.lbCommunityTravelerVoteV3 = {
    refresh: () => refreshSignals(true),
    get signals(){ return signals.slice(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
