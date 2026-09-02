'use strict';

(function loadLabetaillereModules(){
  const head = document.head || document.documentElement;

  const load = (src, id) => {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    head.appendChild(script);
  };

  // Script d’alertes historique conservé à l’identique.
  load('./assets/home-major-alerts-core.js?v=20260826-1', 'lb-home-major-alert-core');

  // Pont gare dynamique Luxembourg -> fiche train #BER.
  load('./assets/lux-train-sheet.js?v=20260826-1', 'lb-lux-train-sheet');

  // Signalement LIVE : toujours proposer le parcours complet, jamais seulement l'origine/destination.
  load('./assets/signal-stations-fix.js?v=20260902-1', 'lb-signal-stations-fix');

  // Présence LIVE : on garde strictement le bouton et son handler existants.
  // Seuls le libellé et l'état accessible sont harmonisés sur PC et mobile.
  const syncLivePresenceButtons = (root = document) => {
    root.querySelectorAll?.('.lb-live-presence-btn[data-lb-presence-train]').forEach((button) => {
      const current = String(button.textContent || '').trim();
      const active = button.getAttribute('aria-pressed') === 'true'
        || /(?:^|\s)À bord\s*✓/i.test(current)
        || /✓\s*À bord/i.test(current);
      const next = active ? '✓ À bord' : 'Je suis à bord';
      if (current !== next) button.textContent = next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute(
        'aria-label',
        active ? 'Retirer ma présence de ce train' : 'Indiquer que je suis à bord de ce train'
      );
    });
  };

  const installLivePresenceLabelSync = () => {
    const host = document.getElementById('lbLiveTrainCards');
    if (!host || host.dataset.lbPresenceLabelSync === '1') return;
    host.dataset.lbPresenceLabelSync = '1';
    syncLivePresenceButtons(host);
    const observer = new MutationObserver(() => syncLivePresenceButtons(host));
    observer.observe(host, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLivePresenceLabelSync, { once: true });
  } else {
    installLivePresenceLabelSync();
  }
})();