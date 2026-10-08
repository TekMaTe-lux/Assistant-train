(() => {
  'use strict';
  const root = document.getElementById('favTrainsWidget');
  if (!root || window.__lbFavLiveDashboard) return;
  window.__lbFavLiveDashboard = true;
  const byId = id => document.getElementById(id);
  const txt = el => (el?.textContent || '').trim();
  function openTrain(kind) {
    const trigger = byId('favTrain' + kind)?.querySelector('.fav-train-profile-link');
    if (trigger) trigger.click();
  }
  function syncCard(kind) {
    const card = byId('favCard' + kind), line = byId('favLine' + kind), stats = byId('favStats' + kind);
    if (!card || !line || !stats) return;
    let tools = card.querySelector('.lb-fav-live-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'lb-fav-live-tools';
      tools.innerHTML = '<button type="button" data-tool="composition"><span>🚆 Composition</span><strong>Fiche train ↗</strong></button><button type="button" data-tool="affluence"><span>♟ Affluence</span><strong>Voir détail ⌄</strong></button><button type="button" data-tool="fiabilite"><span>▥ Fiabilité (30 j)</span><strong>—</strong></button>';
      card.insertBefore(tools, line);
      tools.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tool]');
        if (!btn) return;
        const type = btn.dataset.tool;
        if (type === 'composition') return openTrain(kind);
        if (type === 'fiabilite') { stats.open = !stats.open; if (stats.open) stats.setAttribute('data-user-opened','1'); return; }
        const aff = line.querySelector('details.fav-aff');
        if (aff) { aff.open = !aff.open; if (aff.open) aff.scrollIntoView({block:'nearest',behavior:'smooth'}); }
        else openTrain(kind);
      });
    }
    const aff = line.querySelector('details.fav-aff');
    const affBtn = tools.querySelector('[data-tool="affluence"] strong');
    // Reuse the EXISTING schematic (not textContent, which concatenates all carriage percentages).
    // Copy the real visual and strip labels; the original stays available when expanded.
    const affSource = aff?.querySelector('.fav-aff-schema--compact');
    const affTool = tools.querySelector('[data-tool="affluence"]');
    let preview = affTool.querySelector('.lb-fav-aff-preview');
    if (!preview) { preview = document.createElement('span'); preview.className = 'lb-fav-aff-preview'; affBtn.before(preview); }
    const html = affSource?.innerHTML || '';
    if (preview.dataset.schema !== html) {
      preview.dataset.schema = html;
      preview.innerHTML = html;
      preview.querySelectorAll('script,style,[onload]').forEach(el => el.remove());
      preview.querySelectorAll('*').forEach(el => {
        if (!el.children.length && /^\s*[+]?\d+(?:[.,]\d+)?\s*%\s*$/.test(el.textContent || '')) el.textContent = '';
      });
    }
    preview.hidden = !html;
    if (affBtn) {
      const label = aff ? (aff.open ? 'Réduire ⌃' : (html ? 'Détails ⌄' : 'Voir détail ↗')) : '—';
      if (affBtn.textContent !== label) affBtn.textContent = label;
    }
    const reliability = stats.querySelector('.fav-reliability-pct');
    const reliabilityBtn = tools.querySelector('[data-tool="fiabilite"] strong');
    if (reliabilityBtn) {
      const value = txt(reliability) || '—';
      if (reliabilityBtn.textContent !== value) reliabilityBtn.textContent = value;
    }
    const compositionBtn = tools.querySelector('[data-tool="composition"] strong');
    const train = byId('favTrain' + kind)?.querySelector('.fav-train-profile-link');
    if (compositionBtn) compositionBtn.textContent = train ? 'Détails ↗' : '—';
    const compositionTool = tools.querySelector('[data-tool="composition"]');
    let compositionPreview = compositionTool.querySelector('.lb-fav-composition-preview');
    if (!compositionPreview) { compositionPreview = document.createElement('span'); compositionPreview.className = 'lb-fav-composition-preview'; compositionBtn.before(compositionPreview); }
    const badge = byId('favState'+kind);
    const icons = badge?.querySelector('.fav-type-badge, .fav-train-type-badge, .fav-composition, .fav-type-icon');
    const compositionMarkup = icons?.innerHTML || '';
    if (compositionPreview.dataset.icons !== compositionMarkup) { compositionPreview.dataset.icons = compositionMarkup; compositionPreview.innerHTML = compositionMarkup; }
    compositionPreview.hidden = !compositionMarkup;

    tools.querySelector('[data-tool="fiabilite"]').setAttribute('aria-expanded',String(stats.open));
    tools.querySelector('[data-tool="affluence"]').setAttribute('aria-expanded',String(!!aff?.open));
  }
  function highlightRelevant() {
    const cards = ['AM','PM'].map(kind => ({kind, card:byId('favCard'+kind), state: (txt(byId('favState'+kind))+' '+txt(byId('favCause'+kind))).toLowerCase()}));
    const score = item => {
      if (!item.card || !item.card.querySelector('.fav-train-profile-link')) return 99;
      if (/supprim|annul/.test(item.state)) return 4;
      if (/live|en cours|en circulation|en route/.test(item.state)) return 0;
      if (/venir|prochain/.test(item.state)) return 1;
      if (/arriv|termin/.test(item.state)) return 3;
      return 2;
    };
    const current = cards.slice().sort((a,b)=>score(a)-score(b))[0];
    cards.forEach(item=> {
      if (!item.card) return;
      const featured = item === current && score(item)<3;
      item.card.classList.toggle('lb-fav-featured',featured);
      item.card.style.order = featured ? '-1' : '0';
      let label = item.card.querySelector('.lb-fav-featured-label');
      if (featured && !label) {
        label=document.createElement('div');label.className='lb-fav-featured-label';
        label.textContent='◉ À suivre maintenant';item.card.prepend(label);
      }
      if (!featured && label) label.remove();
    });
  }
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; syncCard('AM'); syncCard('PM'); highlightRelevant(); });
  };
  const obs = new MutationObserver(update);
  obs.observe(root,{childList:true,subtree:true,characterData:true});
  root.addEventListener('toggle',update,true);
  update();
})();
