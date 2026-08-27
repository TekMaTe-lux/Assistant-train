(() => {
  'use strict';
  if (window.__LB_V4_FAVORITES_SHEETS__) return;
  window.__LB_V4_FAVORITES_SHEETS__ = true;

  const text = (el) => String(el?.textContent || '').replace(/\s+/g, ' ').trim();

  function cleanupCommandExperiment() {
    document.getElementById('lb4CommandDeck')?.remove();
    document.getElementById('lb4LuxStationModal')?.remove();
    document.getElementById('lb4LuxMapTrigger')?.remove();
    document.querySelectorAll('.lb4-lux-th-trigger').forEach(el => el.remove());
    document.body.classList.remove('lb4-lux-open');
    document.querySelectorAll('#home .lb4-zone-traffic, #home .lb4-zone-live, #home .lb4-zone-quick, #home .lb4-zone-punct, #home .lb4-zone-favs, #home .lb4-zone-actions')
      .forEach(el => el.classList.remove('lb4-zone-traffic', 'lb4-zone-live', 'lb4-zone-quick', 'lb4-zone-punct', 'lb4-zone-favs', 'lb4-zone-actions'));
  }

  function detectFavoriteState(card, kind, stateEl, causeEl) {
    const metaEl = document.getElementById(`favMeta${kind}`);
    const stateText = text(stateEl).toLowerCase();
    const causeText = text(causeEl).toLowerCase();
    const metaText = text(metaEl).toLowerCase();
    // Ne surtout pas lire l'historique 30 j : « retard moyen » ne décrit pas l'état actuel.
    const operational = `${stateText} ${causeText} ${metaText}`;
    const live = /\blive\b|en approche|à quai|a quai|en départ|en depart|circule/.test(stateText)
      || !!card.querySelector('.is-live, .live, [data-state="live"], [data-status="live"]');

    let state = 'normal';
    if (/suppression partielle|supprim(?:é|e)e? partiel|service réduit|service reduit|\bpartiel(?:le)?\b/.test(operational)) state = 'partial';
    else if (/train supprim|supprim(?:é|e)e?\b|annul(?:é|e)e?\b/.test(operational)) state = 'cancelled';
    else if (/retard|\+\s*\d+\s*min/.test(operational)) state = 'delay';
    else if (/arriv(?:é|e)|termin(?:é|e)/.test(stateText)) state = 'arrived';
    else if (live) state = 'live';

    return { state, live };
  }

  function ensureFavoriteStatus(card, kind) {
    const stateEl = document.getElementById(`favState${kind}`);
    const causeEl = document.getElementById(`favCause${kind}`);
    const detected = detectFavoriteState(card, kind, stateEl, causeEl);
    card.dataset.lb4State = detected.state;
    card.dataset.lb4Live = detected.live ? '1' : '0';

    let rail = card.querySelector('.lb4-fav-state-rail');
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'lb4-fav-state-rail';
      rail.setAttribute('role', 'status');
      const head = card.querySelector('.fav-card-head');
      head?.insertAdjacentElement('afterend', rail);
    }

    const cause = text(causeEl);
    const originalState = text(stateEl);
    let main = '';
    if (detected.state === 'partial') main = '⚠ Suppression partielle';
    else if (detected.state === 'cancelled') main = '✕ Train supprimé';
    else if (detected.state === 'delay') main = originalState || 'Retard en cours';
    else if (detected.state === 'live') main = 'En circulation';
    else if (detected.state === 'arrived') main = 'Arrivé';

    const showRail = ['partial', 'cancelled', 'delay'].includes(detected.state);
    rail.hidden = !showRail;
    const wanted = showRail ? `<strong>${main}</strong>${cause ? `<span>${cause}</span>` : ''}` : '';
    if (rail.innerHTML !== wanted) rail.innerHTML = wanted;

    let liveChip = card.querySelector('.lb4-fav-live-chip');
    if (!liveChip) {
      liveChip = document.createElement('span');
      liveChip.className = 'lb4-fav-live-chip';
      liveChip.innerHTML = '<i></i> LIVE';
      liveChip.setAttribute('aria-label', 'Bétaillère actuellement en circulation');
      const head = card.querySelector('.fav-card-head');
      head?.appendChild(liveChip);
    }
    if (liveChip.hidden === detected.live) liveChip.hidden = !detected.live;
  }

  function improveFavoriteCard(kind) {
    const card = document.getElementById(`favCard${kind}`);
    if (!card) return;
    card.classList.add('lb4-favorite-sheet');

    const head = card.querySelector('.fav-card-head');
    if (head) head.classList.add('lb4-fav-sheet-head');

    const tag = card.querySelector('.fav-tag');
    if (tag && !tag.dataset.lb4Labelled) {
      tag.dataset.lb4Labelled = '1';
      tag.textContent = kind === 'AM' ? 'Favori matin' : 'Favori soir';
    }

    const train = document.getElementById(`favTrain${kind}`);
    if (train) train.classList.add('lb4-fav-sheet-train');

    const meta = document.getElementById(`favMeta${kind}`);
    if (meta) meta.classList.add('lb4-fav-sheet-meta');

    const details = document.getElementById(`favStats${kind}`);
    if (details) {
      details.classList.add('lb4-fav-sheet-history');
      if (!details.dataset.lb4InitialCollapse) {
        details.dataset.lb4InitialCollapse = '1';
        details.open = false;
        details.removeAttribute('data-user-opened');
      }
    }

    ensureFavoriteStatus(card, kind);
  }

  function improveFavorites() {
    const widget = document.getElementById('favTrainsWidget');
    if (!widget) return;
    widget.classList.add('lb4-favorites-page');
    improveFavoriteCard('AM');
    improveFavoriteCard('PM');
  }

  function improveHomeFavorites() {
    const slot = document.getElementById('homeFavSlot');
    if (!slot) return;
    slot.classList.add('lb4-home-fav-sheets');
    [...slot.children].forEach(card => card.classList.add('lb4-home-fav-sheet'));
  }

  function decorate() {
    cleanupCommandExperiment();
    improveFavorites();
    improveHomeFavorites();
  }

  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  function start() {
    decorate();
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-state', 'data-status']
    });
    window.addEventListener('hashchange', scheduleDecorate, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
