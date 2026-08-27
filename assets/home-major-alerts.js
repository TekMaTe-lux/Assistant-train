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

  const style = (href, id) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    head.appendChild(link);
  };

  // Script d’alertes historique conservé à l’identique.
  load('./assets/home-major-alerts-core.js?v=20260826-1', 'lb-home-major-alert-core');

  // Pont gare dynamique Luxembourg -> fiche train #BER.
  load('./assets/lux-train-sheet.js?v=20260826-1', 'lb-lux-train-sheet');

  // Preview de la refonte Command Center. Activable uniquement avec ?v4=1
  // ou localStorage.lbV4Preview=1. Aucun effet sur l'affichage normal de la branche.
  const params = new URLSearchParams(location.search);
  const preview = params.get('v4') === '1' || (() => {
    try { return localStorage.getItem('lbV4Preview') === '1'; } catch (_) { return false; }
  })();

  if (preview) {
    style('./assets/lb-v4-tokens.css?v=1', 'lb-v4-tokens');
    style('./assets/lb-v4-command-center.css?v=1', 'lb-v4-command-center-style');
    style('./assets/lb-train-components-v4.css?v=1', 'lb-v4-train-components-style');
    style('./assets/lb-command-center-home-v4.css?v=1', 'lb-v4-command-center-home-style');
    load('./assets/lb-data-client-v4.js?v=1', 'lb-data-client-v4');
    load('./assets/lb-train-components-v4.js?v=1', 'lb-train-components-v4');
    load('./assets/lb-v4-command-center.js?v=1', 'lb-v4-command-center-script');
    load('./assets/lb-command-center-home-v4.js?v=1', 'lb-v4-command-center-home-script');
  }
})();
