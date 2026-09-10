'use strict';

/*
 * La Bétaillère — notation compacte du retard voyageur dans la fiche carte.
 * Couche visuelle additive, chargée après lb-community-traveler-compact-v2.js.
 */
(() => {
  if (window.__LB_COMMUNITY_TRAVELER_VOTE_V1__) return;
  window.__LB_COMMUNITY_TRAVELER_VOTE_V1__ = true;

  const snapshot = { trains:{}, canContribute:false };
  let renderQueued = false;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  function currentTripNumber(){
    const block = document.getElementById('lb-map-trip-community');
    const fromBlock = normalizeTrain(block?.dataset?.trainNumber);
    if (fromBlock) return fromBlock;
    return normalizeTrain(document.querySelector('#trip-panel-train')?.textContent);
  }

  function itemForTrain(trainNumber){
    const key = normalizeTrain(trainNumber);
    return key ? (snapshot.trains?.[key] || null) : null;
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

  function buildVoteButton(kind, signalId, value, active){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lb-community-map-vote-btn is-${kind}${active ? ' is-active' : ''}`;
    button.dataset.lbMapDelayVote = String(value);
    button.dataset.signalId = String(signalId || '');
    button.textContent = kind === 'up' ? '👍' : '👎';
    button.title = kind === 'up' ? 'Confirmer ce retard voyageur' : 'Contester ce retard voyageur';
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

    if (!(delay > 0) || !station) return;

    const vote = report?.vote && typeof report.vote === 'object' ? report.vote : null;
    const signalId = String(vote?.signalId || '').trim();
    const score = Math.round(Number(vote?.score) || 0);
    const myVote = Math.max(-1, Math.min(1, Math.round(Number(vote?.myVote) || 0)));

    sourceLine.replaceChildren();
    sourceLine.classList.add('lb-community-source-line--votes');
    sourceLine.hidden = false;

    const label = document.createElement('span');
    label.className = 'lb-community-source-label';
    label.textContent = `Retard signalé par le bétail depuis ${station}`;
    label.title = `Retard voyageur signalé par le bétail depuis ${station}`;
    sourceLine.appendChild(label);

    if (!signalId) return;

    const votes = document.createElement('span');
    votes.className = 'lb-community-map-votes';
    votes.dataset.signalId = signalId;
    votes.appendChild(buildVoteButton('up', signalId, 1, myVote > 0));

    const count = document.createElement('span');
    count.className = 'lb-community-map-vote-count';
    count.textContent = String(score);
    count.title = `Score communautaire : ${score}`;
    votes.appendChild(count);

    votes.appendChild(buildVoteButton('down', signalId, -1, myVote < 0));
    sourceLine.appendChild(votes);
  }

  function scheduleRender(){
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function installTripHook(){
    if (typeof renderTripPanel !== 'function' || renderTripPanel.__lbCommunityVoteV1) return;
    const original = renderTripPanel;
    const wrapped = function(...args){
      const result = original.apply(this, args);
      scheduleRender();
      return result;
    };
    wrapped.__lbCommunityVoteV1 = true;
    if (original.__lbTravelerWrapped) wrapped.__lbTravelerWrapped = true;
    if (original.__lbCommunityCompactV2) wrapped.__lbCommunityCompactV2 = true;
    renderTripPanel = wrapped;
  }

  function installStyle(){
    if (document.getElementById('lb-community-traveler-vote-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-traveler-vote-v1-style';
    style.textContent = `
      .lb-community-source-line.lb-community-source-line--votes{display:flex!important;align-items:center!important;gap:5px!important;min-width:0!important;overflow:hidden!important}
      .lb-community-source-label{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8b9dd}
      .lb-community-map-votes{display:inline-flex;flex:0 0 auto;align-items:center;gap:1px;height:17px;padding:0 1px;border-radius:999px;background:rgba(32,22,46,.34)}
      .lb-community-map-vote-btn{box-sizing:border-box;width:16px;min-width:16px;height:16px;min-height:16px;padding:0;border:0;border-radius:50%;background:rgba(8,27,38,.68);color:#dce9ee;font-size:8.5px;line-height:16px;text-align:center;cursor:pointer;box-shadow:none;opacity:.72}
      .lb-community-map-vote-btn:hover,.lb-community-map-vote-btn:focus-visible{opacity:1;background:rgba(15,49,65,.92);outline:1px solid rgba(142,248,255,.45)}
      .lb-community-map-vote-btn.is-active{opacity:1;background:rgba(91,52,126,.92);box-shadow:inset 0 0 0 1px rgba(195,154,255,.58)}
      .lb-community-map-vote-count{min-width:9px;color:#b9a8cc;font-size:7.5px;font-weight:900;line-height:1;text-align:center}
      @media(max-width:520px){
        .lb-community-source-line.lb-community-source-line--votes{gap:3px!important}
        .lb-community-map-votes{height:16px}
        .lb-community-map-vote-btn{width:15px;min-width:15px;height:15px;min-height:15px;font-size:8px;line-height:15px}
        .lb-community-map-vote-count{font-size:7px}
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-lb-map-delay-vote]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const signalId = String(button.dataset.signalId || button.closest('.lb-community-map-votes')?.dataset?.signalId || '').trim();
    if (!signalId) return;
    try {
      window.parent?.postMessage({
        type:'lb:community:vote-delay',
        trainNumber:currentTripNumber(),
        signalId,
        value:Number(button.dataset.lbMapDelayVote) > 0 ? 1 : -1
      }, '*');
    } catch(_) {}
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
    // Couvre l'ordre d'initialisation des couches V1/V2 sans polling permanent.
    window.setTimeout(() => { installTripHook(); scheduleRender(); }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
