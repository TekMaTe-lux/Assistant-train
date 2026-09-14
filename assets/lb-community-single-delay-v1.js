'use strict';

(() => {
  if (window.__LB_COMMUNITY_SINGLE_DELAY_V1__) return;
  window.__LB_COMMUNITY_SINGLE_DELAY_V1__ = true;

  let rawFetchComments = null;
  let current = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const close = () => {
    const modal = document.getElementById('lbExistingDelayModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden','true');
    if (!document.querySelector('.lb-community-modal.is-open')) document.body.classList.remove('lb-community-modal-open');
  };

  function ensureModal(){
    let modal = document.getElementById('lbExistingDelayModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'lbExistingDelayModal';
    modal.className = 'lb-community-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `<div class="lb-community-panel" role="dialog" aria-modal="true" aria-labelledby="lbExistingDelayTitle">
      <button type="button" class="lb-community-close tron-close-button" data-lb-existing-close aria-label="Fermer"></button>
      <div class="lb-community-head"><div><h3 id="lbExistingDelayTitle">🐮 Retard déjà signalé</h3><div class="lb-community-panel-sub">Un seul signalement actif par train et par gare.</div></div></div>
      <div id="lbExistingDelayBody"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-lb-existing-close]')) { close(); return; }
      const vote = event.target.closest('[data-lb-existing-vote]');
      if (vote) submitVote(Number(vote.dataset.lbExistingVote)).catch(() => {});
      const open = event.target.closest('[data-lb-existing-open-train]');
      if (open) openCurrentTrain();
    });
    return modal;
  }

  function render(){
    const modal = ensureModal();
    const body = modal.querySelector('#lbExistingDelayBody');
    if (!body || !current) return;
    const score = Number(current.upvotes || 0) - Number(current.downvotes || 0);
    const summary = `<div class="lb-signal-dialog-info"><strong>${esc(current.train_number)}</strong> · ${esc(current.station)} · <strong>+${Number(current.delay_min || 0)} min</strong></div>`;
    if (current.is_owner) {
      body.innerHTML = `${summary}<div class="lb-signal-dialog-info">C’est votre signalement. Vous pouvez le modifier ou le supprimer depuis la fiche actuelle du train.</div><div class="lb-vote-confirm-actions"><button type="button" class="lb-signal-submit" data-lb-existing-open-train>Ouvrir la fiche</button><button type="button" class="lb-community-btn" data-lb-existing-close>Fermer</button></div>`;
    } else {
      body.innerHTML = `${summary}<div class="lb-signal-dialog-info">Le premier signalement reste la référence. Confirmez-le ou contestez-le.</div><div class="lb-vote-confirm-actions"><button type="button" class="lb-signal-submit${Number(current.my_vote)===1?' is-active':''}" data-lb-existing-vote="1">👍 Je confirme</button><span class="lb-signal-vote-count">${score >= 0 ? '+' : ''}${score}</span><button type="button" class="lb-community-btn${Number(current.my_vote)===-1?' is-active':''}" data-lb-existing-vote="-1">👎 Je ne constate pas</button></div>`;
    }
  }

  function show(signal){
    if (!signal?.id) return;
    current = { ...signal };
    document.querySelector('#lbSignalModal [data-lb-community-close="lbSignalModal"]')?.click();
    const modal = ensureModal();
    render();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('lb-community-modal-open');
  }

  async function submitVote(value){
    if (!current?.id || !rawFetchComments) return;
    const res = await rawFetchComments(`/${encodeURIComponent(current.id)}/vote`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ vote:value > 0 ? 1 : -1 })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) { close(); document.getElementById('lbBtnOpenAuth')?.click(); return; }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (data.auto_deleted) { close(); window.lbToast?.('Signalement retiré après contestation du bétail.'); }
    else {
      current = { ...current, upvotes:Number(data.upvotes||0), downvotes:Number(data.downvotes||0), my_vote:Number(data.my_vote||0) };
      render();
    }
    window.dispatchEvent(new CustomEvent('lb:community-data-changed'));
    window.lbCommunityMapVotesV2?.refresh?.();
  }

  function openCurrentTrain(){
    const train = String(current?.train_number || '');
    close();
    document.getElementById('lbOpenLiveModal')?.click();
    window.setTimeout(() => document.querySelector(`[data-lb-live-train="${CSS.escape(train)}"]`)?.click(), 120);
  }

  function install(){
    if (typeof window.fetchCommentsApi !== 'function') return false;
    if (window.fetchCommentsApi.__lbSingleDelayWrapped) return true;
    rawFetchComments = window.fetchCommentsApi.bind(window);
    const wrapped = async (path = '', options = {}) => {
      const response = await rawFetchComments(path, options);
      try {
        if (String(options?.method || 'GET').toUpperCase() === 'POST' && response.status === 409) {
          const data = await response.clone().json();
          if (data?.code === 'SIGNAL_ALREADY_EXISTS' && data?.existing_signal) window.setTimeout(() => show(data.existing_signal), 80);
        }
      } catch(_) {}
      return response;
    };
    wrapped.__lbSingleDelayWrapped = true;
    window.fetchCommentsApi = wrapped;
    return true;
  }

  if (!install()) {
    let tries = 0;
    const timer = window.setInterval(() => { if (install() || ++tries > 100) window.clearInterval(timer); }, 100);
  }
})();
