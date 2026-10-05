/* Observe only the two home favourites; no polling or network requests. */
(() => {
  'use strict';
  if (window.__lbHomePolishV1) return;
  window.__lbHomePolishV1 = true;
  const slot = document.getElementById('homeFavSlot');
  if (!slot) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previous = new Map();
  let scheduled = false;
  function inspect() {
    scheduled = false;
    const next = new Map();
    slot.querySelectorAll('.home-fav-row[data-fav-k]').forEach(row => {
      const key = row.dataset.favK;
      const train = row.querySelector('.home-fav-train-no')?.textContent.trim() || '';
      const signature = [train,
        row.querySelector('.home-fav-time')?.textContent.trim() || '',
        row.querySelector('.fav-state-badge')?.textContent.trim() || ''
      ].join('|');
      const valid = train !== '' && train !== '—';
      const old = previous.get(key);
      next.set(key, { signature, valid });
      const home = slot.closest('#home');
      if (!valid || !old?.valid || old.signature === signature ||
          document.hidden || motion.matches || (home && home.getClientRects().length === 0)) return;
      row.classList.add('lb-polish-updated');
      window.setTimeout(() => row.classList.remove('lb-polish-updated'), 360);
    });
    previous = next;
  }
  inspect();
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(inspect);
  }).observe(slot, { childList: true, subtree: true, characterData: true });
})();
