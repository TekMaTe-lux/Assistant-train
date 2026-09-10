'use strict';

/*
 * La Bétaillère — fiche détaillée d'un retard voyageur.
 *
 * - aucun appel réseau au chargement initial : lecture API uniquement au clic ;
 * - les retards communautaires restent NON OFFICIELS et distincts des retards opérateur ;
 * - chaque signalement garde ses propres votes ;
 * - l'auteur peut supprimer uniquement son propre signalement ;
 * - le backend reste l'autorité : DELETE /api/comments/:id vérifie auth + ownership.
 */
(() => {
  if (window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__) return;
  window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__ = true;

  const SIGNAL_TTL_MS = 45 * 60 * 1000;
  const API_SIGNALS = '/api/comments?scope=signals';
  let currentTrain = '';
  let currentHint = { station:'', delay:0 };
  let currentSignals = [];
  let currentUser = null;
  let shell = null;
  let busy = false;

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
    const value = raw?.created_at ?? raw?.createdAt ?? raw?.ts ?? raw?.timestamp ?? raw?.date ?? '';
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value || '').trim())) {
      let n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 1e12) n *= 1000;
      return n;
    }
    let text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
      text = text.replace(' ', 'T') + 'Z';
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function extractList(data){
    if (Array.isArray(data)) return data;
    for (const key of ['comments','signals','items','data','results']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  function normalizeSignal(raw){
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id ?? '').trim();
    const trainNumber = normalizeTrain(raw.train_number ?? raw.trainNumber ?? raw.train ?? '');
    const station = String(raw.station ?? raw.stop_name ?? raw.stopName ?? '').trim();
    let type = String(raw.signal_type ?? raw.signalType ?? raw.type ?? '').trim().toLowerCase();
    type = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-');
    if (['delay','late','retard-train'].includes(type)) type = 'retard';
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? raw.delay ?? 0) || 0);
    const upvotes = Math.max(0, Math.round(Number(raw.upvotes ?? raw.votes_up ?? raw.votesUp ?? 0) || 0));
    const downvotes = Math.max(0, Math.round(Number(raw.downvotes ?? raw.votes_down ?? raw.votesDown ?? 0) || 0));
    const myVote = Math.max(-1, Math.min(1, Math.round(Number(raw.my_vote ?? raw.myVote ?? 0) || 0)));
    const ts = parseTs(raw);
    const autoDeleted = Number(raw.auto_deleted ?? raw.autoDeleted ?? 0) === 1;
    if (!id || !trainNumber || type !== 'retard' || !(delayMin > 0) || autoDeleted) return null;
    if (ts && ts < Date.now() - SIGNAL_TTL_MS) return null;
    if ((upvotes - downvotes) <= -3) return null;
    return {
      id,
      trainNumber,
      station,
      stopKey:normalizeStop(station),
      delayMin,
      upvotes,
      downvotes,
      myVote,
      ts,
      userId:String(raw.user_id ?? raw.userId ?? '').trim(),
      accountId:String(raw.account_id ?? raw.accountId ?? '').trim(),
      pseudo:String(raw.display_pseudo ?? raw.author_public_pseudo ?? raw.pseudo ?? 'Voyageur').trim() || 'Voyageur'
    };
  }

  function ensureStyle(){
    if (document.getElementById('lb-community-signal-dialog-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-signal-dialog-v1-style';
    style.textContent = `
      /* Les pouces compacts historiques disparaissent : le vote se fait désormais par signalement. */
      .lb-community-map-votes{display:none!important}
      .lb-community-delay-status,.lb-stop-traveler-delay-propagated,.lb-map-traveler-delay-community{pointer-events:auto!important;cursor:pointer!important;touch-action:manipulation}
      .lb-community-delay-status:hover,.lb-stop-traveler-delay-propagated:hover,.lb-map-traveler-delay-community:hover{filter:brightness(1.18)}

      .lb-signal-dialog-v1{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(1,9,17,.72);backdrop-filter:blur(4px)}
      .lb-signal-dialog-v1[hidden]{display:none!important}
      .lb-signal-dialog-card{box-sizing:border-box;width:min(520px,calc(100vw - 28px));max-height:min(78vh,720px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(0,234,255,.38);border-radius:18px;background:linear-gradient(180deg,rgba(4,24,40,.985),rgba(2,14,27,.99));color:#eefcff;box-shadow:0 22px 80px rgba(0,0,0,.5),0 0 28px rgba(0,234,255,.08)}
      .lb-signal-dialog-head{display:flex;align-items:flex-start;gap:10px;padding:15px 16px 11px;border-bottom:1px solid rgba(0,234,255,.18)}
      .lb-signal-dialog-head-main{min-width:0;flex:1}
      .lb-signal-dialog-kicker{font-size:10px;font-weight:950;letter-spacing:.08em;color:#bca2df;text-transform:uppercase}
      .lb-signal-dialog-title{margin:3px 0 2px;font-size:20px;line-height:1.1;font-weight:950;color:#fff}
      .lb-signal-dialog-sub{font-size:11px;line-height:1.35;color:#a9c6d1}
      .lb-signal-dialog-close{flex:0 0 auto;width:34px;height:34px;border:1px solid rgba(0,234,255,.28);border-radius:50%;background:rgba(5,31,51,.9);color:#eaffff;font-size:18px;cursor:pointer}
      .lb-signal-dialog-body{overflow:auto;padding:12px 14px 15px;overscroll-behavior:contain}
      .lb-signal-dialog-info{margin:0 0 10px;padding:8px 10px;border:1px solid rgba(183,140,255,.24);border-radius:10px;background:rgba(77,43,113,.12);font-size:10.5px;line-height:1.35;color:#d8c9eb}
      .lb-signal-dialog-loading,.lb-signal-dialog-empty{padding:22px 8px;text-align:center;color:#a9c6d1;font-size:12px}
      .lb-signal-card{margin-top:9px;padding:11px;border:1px solid rgba(183,140,255,.28);border-radius:13px;background:rgba(60,35,88,.14)}
      .lb-signal-card.is-target{border-color:rgba(183,140,255,.68);box-shadow:inset 0 0 0 1px rgba(183,140,255,.12),0 0 12px rgba(183,140,255,.07)}
      .lb-signal-card-top{display:flex;align-items:flex-start;gap:10px}
      .lb-signal-card-place{min-width:0;flex:1}
      .lb-signal-station{font-size:14px;font-weight:950;color:#f5fbff;line-height:1.15}
      .lb-signal-meta{margin-top:3px;font-size:9.5px;line-height:1.3;color:#9cb9c5}
      .lb-signal-delay{flex:0 0 auto;padding:4px 8px;border:1px solid rgba(183,140,255,.46);border-radius:999px;background:rgba(77,43,113,.22);color:#efe5ff;font-size:13px;font-weight:950;white-space:nowrap}
      .lb-signal-score{display:flex;gap:8px;align-items:center;margin-top:9px;font-size:10px;color:#b7ccd5}
      .lb-signal-owner{font-weight:900;color:#8ef8ff}
      .lb-signal-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
      .lb-signal-actions button{min-height:38px;flex:1 1 150px;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,234,255,.28);background:rgba(5,31,51,.92);color:#effdff;font-size:11px;font-weight:900;cursor:pointer}
      .lb-signal-actions button.is-active{border-color:rgba(183,140,255,.75);background:rgba(77,43,113,.5)}
      .lb-signal-actions button.lb-signal-delete{border-color:rgba(255,115,115,.35);background:rgba(92,25,31,.45);color:#ffd8d8}
      .lb-signal-actions button:disabled{opacity:.55;cursor:wait}
      .lb-signal-dialog-error{margin-top:9px;padding:8px 9px;border-radius:9px;background:rgba(125,35,41,.34);color:#ffd8d8;font-size:10px}

      @media(max-width:700px),(pointer:coarse){
        .lb-signal-dialog-v1{align-items:flex-end;padding:0;background:rgba(1,9,17,.62)}
        .lb-signal-dialog-card{width:100%;max-height:88vh;border-radius:18px 18px 0 0;border-left:0;border-right:0;border-bottom:0}
        .lb-signal-dialog-head{padding:14px 14px 10px}
        .lb-signal-dialog-title{font-size:18px}
        .lb-signal-dialog-body{padding:10px 12px calc(16px + env(safe-area-inset-bottom))}
        .lb-signal-actions button{min-height:44px;font-size:11.5px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShell(){
    if (shell) return shell;
    const root = document.createElement('div');
    root.id = 'lb-community-signal-dialog-v1';
    root.className = 'lb-signal-dialog-v1';
    root.hidden = true;
    root.innerHTML = `
      <section class="lb-signal-dialog-card" role="dialog" aria-modal="true" aria-labelledby="lb-signal-dialog-title">
        <header class="lb-signal-dialog-head">
          <div class="lb-signal-dialog-head-main">
            <div class="lb-signal-dialog-kicker">Signalement voyageur · NON OFFICIEL</div>
            <h2 class="lb-signal-dialog-title" id="lb-signal-dialog-title">Retard communautaire</h2>
            <div class="lb-signal-dialog-sub">Chaque signalement est noté séparément. La donnée opérateur officielle reste indépendante.</div>
          </div>
          <button type="button" class="lb-signal-dialog-close" aria-label="Fermer">×</button>
        </header>
        <div class="lb-signal-dialog-body"></div>
      </section>`;
    document.body.appendChild(root);
    root.addEventListener('click', (event) => {
      if (event.target === root || event.target.closest('.lb-signal-dialog-close')) closeDialog();
    });
    shell = root;
    return root;
  }

  function bodyNode(){ return ensureShell().querySelector('.lb-signal-dialog-body'); }

  function setBody(html){ bodyNode().innerHTML = html; }

  function htmlEscape(value){
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function ageLabel(ts){
    if (!(ts > 0)) return 'à l’instant';
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return 'à l’instant';
    const min = Math.floor(sec / 60);
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    return `il y a ${h} h`;
  }

  function isOwner(signal){
    const me = String(currentUser?.id ?? '').trim();
    return !!me && (signal.userId === me || signal.accountId === me);
  }

  function isTarget(signal){
    const stationHint = normalizeStop(currentHint.station);
    const delayHint = Math.round(Number(currentHint.delay) || 0);
    if (stationHint && signal.stopKey !== stationHint) return false;
    if (delayHint > 0 && signal.delayMin !== delayHint) return false;
    return !!(stationHint || delayHint);
  }

  function renderSignals(errorText = ''){
    const list = currentSignals.slice().sort((a,b) => {
      const ta = isTarget(a) ? 1 : 0;
      const tb = isTarget(b) ? 1 : 0;
      if (ta !== tb) return tb - ta;
      return Number(b.ts || 0) - Number(a.ts || 0);
    });

    if (!list.length) {
      setBody(`<div class="lb-signal-dialog-empty">Aucun signalement de retard actif pour ce train.</div>${errorText ? `<div class="lb-signal-dialog-error">${htmlEscape(errorText)}</div>` : ''}`);
      return;
    }

    const cards = list.map((signal) => {
      const owner = isOwner(signal);
      const score = signal.upvotes - signal.downvotes;
      const meta = `${ageLabel(signal.ts)} · ${htmlEscape(signal.pseudo)}`;
      const actions = owner
        ? `<button type="button" class="lb-signal-delete" data-lb-signal-delete="${htmlEscape(signal.id)}">Supprimer mon signalement</button>`
        : `<button type="button" data-lb-signal-vote="1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === 1 ? 'is-active' : ''}">👍 Je confirme</button>
           <button type="button" data-lb-signal-vote="-1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === -1 ? 'is-active' : ''}">👎 Je ne constate pas</button>`;
      return `<article class="lb-signal-card${isTarget(signal) ? ' is-target' : ''}" data-signal-card="${htmlEscape(signal.id)}">
        <div class="lb-signal-card-top">
          <div class="lb-signal-card-place">
            <div class="lb-signal-station">${htmlEscape(signal.station || 'Gare non précisée')}</div>
            <div class="lb-signal-meta">${meta}${owner ? ' · <span class="lb-signal-owner">votre signalement</span>' : ''}</div>
          </div>
          <div class="lb-signal-delay">(+${signal.delayMin} min)</div>
        </div>
        <div class="lb-signal-score"><span>👍 ${signal.upvotes}</span><span>👎 ${signal.downvotes}</span><span>score ${score >= 0 ? '+' : ''}${score}</span></div>
        <div class="lb-signal-actions">${actions}</div>
      </article>`;
    }).join('');

    setBody(`<div class="lb-signal-dialog-info">Ces retards sont déclarés par des voyageurs. Ils ne remplacent pas l’information officielle SNCF/CFL.</div>${cards}${errorText ? `<div class="lb-signal-dialog-error">${htmlEscape(errorText)}</div>` : ''}`);
  }

  async function fetchCurrentUser(){
    try {
      const response = await fetch('/api/me', { method:'GET', credentials:'include', cache:'no-store', headers:{'Accept':'application/json'} });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.user || null;
    } catch(_) { return null; }
  }

  async function fetchSignals(train){
    const url = `${API_SIGNALS}&train_number=${encodeURIComponent(train)}&_=${Date.now()}`;
    const response = await fetch(url, { method:'GET', credentials:'include', cache:'no-store', headers:{'Accept':'application/json'} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return extractList(data).map(normalizeSignal).filter((x) => x && x.trainNumber === train);
  }

  function currentTripNumber(){
    const fromBlock = normalizeTrain(document.getElementById('lb-map-trip-community')?.dataset?.trainNumber);
    if (fromBlock) return fromBlock;
    return normalizeTrain(document.querySelector('#trip-panel-train')?.textContent || document.querySelector('.trip-panel-title')?.textContent);
  }

  function contextFromTarget(target){
    const marker = target.closest('.cow-marker');
    const train = normalizeTrain(marker?.getAttribute('data-train-number')) || currentTripNumber();
    const delay = Math.round(Number(String(target.textContent || '').match(/\+\s*(\d{1,3})/)?.[1] || 0));
    const title = String(target.getAttribute('title') || '');
    const stationMatch = title.match(/depuis\s+(.+?)(?:\s+par\b|\s*[—-]|$)/i);
    return { train, station:String(stationMatch?.[1] || '').trim(), delay };
  }

  async function openDialog(context){
    const train = normalizeTrain(context?.train);
    if (!train) return;
    currentTrain = train;
    currentHint = { station:String(context?.station || ''), delay:Math.round(Number(context?.delay) || 0) };
    ensureStyle();
    const root = ensureShell();
    root.hidden = false;
    document.documentElement.classList.add('lb-signal-dialog-open');
    setBody('<div class="lb-signal-dialog-loading">Chargement du signalement…</div>');
    try {
      const [signals, me] = await Promise.all([fetchSignals(train), fetchCurrentUser()]);
      currentSignals = signals;
      currentUser = me;
      renderSignals();
    } catch (error) {
      currentSignals = [];
      currentUser = await fetchCurrentUser();
      renderSignals(`Impossible de charger les signalements (${error?.message || 'erreur'}).`);
    }
  }

  function closeDialog(){
    if (!shell) return;
    shell.hidden = true;
    document.documentElement.classList.remove('lb-signal-dialog-open');
  }

  function requestAuthentication(){
    try { window.parent?.postMessage({ type:'lb:community:open-signal', trainNumber:currentTrain }, '*'); } catch(_) {}
  }

  function notifyParentChanged(){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.lbCommunityMapVotesV2?.refresh?.();
        window.parent.dispatchEvent?.(new CustomEvent('lb:community-data-changed'));
      }
    } catch(_) {}
    try { window.dispatchEvent(new CustomEvent('lb:community-data-changed')); } catch(_) {}
    try { window.parent?.postMessage({ type:'lb:community:signals-changed', trainNumber:currentTrain }, '*'); } catch(_) {}
  }

  async function refreshDialog(){
    currentSignals = await fetchSignals(currentTrain);
    currentUser = await fetchCurrentUser();
    renderSignals();
  }

  async function vote(signalId, value){
    if (busy) return;
    const signal = currentSignals.find((x) => x.id === String(signalId)) || null;
    if (!signal || isOwner(signal)) return;
    const voteValue = Number(value) > 0 ? 1 : -1;
    const projectedScore = (signal.upvotes - signal.downvotes)
      + (signal.myVote === 1 ? -1 : signal.myVote === -1 ? 1 : 0)
      + voteValue;
    if (voteValue < 0 && projectedScore <= -3) {
      if (!window.confirm('Ce vote peut entraîner la suppression automatique de ce signalement. Continuer ?')) return;
    }
    busy = true;
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(signal.id)}/vote`, {
        method:'POST', credentials:'include', cache:'no-store',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({ vote:voteValue })
      });
      if (response.status === 401 || response.status === 403) {
        requestAuthentication();
        throw new Error('Connectez-vous pour voter.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      await refreshDialog();
      notifyParentChanged();
      window.setTimeout(notifyParentChanged, 700);
    } catch (error) {
      renderSignals(error?.message || 'Vote impossible.');
    } finally { busy = false; }
  }

  async function removeOwn(signalId){
    if (busy) return;
    const signal = currentSignals.find((x) => x.id === String(signalId)) || null;
    if (!signal || !isOwner(signal)) return;
    if (!window.confirm(`Supprimer votre signalement de +${signal.delayMin} min à ${signal.station || 'cette gare'} ?`)) return;
    busy = true;
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(signal.id)}`, {
        method:'DELETE', credentials:'include', cache:'no-store', headers:{'Accept':'application/json'}
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        requestAuthentication();
        throw new Error(data?.error || 'Suppression non autorisée.');
      }
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      await refreshDialog();
      notifyParentChanged();
      window.setTimeout(notifyParentChanged, 250);
      window.setTimeout(notifyParentChanged, 1000);
    } catch (error) {
      renderSignals(error?.message || 'Suppression impossible.');
    } finally { busy = false; }
  }

  document.addEventListener('click', (event) => {
    const deleteButton = event.target?.closest?.('[data-lb-signal-delete]');
    if (deleteButton) {
      event.preventDefault(); event.stopPropagation();
      removeOwn(deleteButton.dataset.lbSignalDelete).catch(() => {});
      return;
    }

    const voteButton = event.target?.closest?.('[data-lb-signal-vote]');
    if (voteButton) {
      event.preventDefault(); event.stopPropagation();
      vote(voteButton.dataset.signalId, Number(voteButton.dataset.lbSignalVote)).catch(() => {});
      return;
    }

    const trigger = event.target?.closest?.('.lb-community-delay-status,.lb-stop-traveler-delay-propagated,.lb-map-traveler-delay-community');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    openDialog(contextFromTarget(trigger)).catch(() => {});
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shell && !shell.hidden) closeDialog();
  });

  function start(){
    ensureStyle();
  }

  window.lbCommunitySignalDialogV1 = {
    open: (trainNumber, station = '', delay = 0) => openDialog({ train:trainNumber, station, delay }),
    close: closeDialog
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
