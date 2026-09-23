'use strict';

/*
 * Bootstrap conservateur du pont carte communautaire.
 * Le pont historique reste dans lb-community-map-bridge-core-v1.js.
 * V3 ajoute la synchro Voix du Bétail -> carte sans écraser À bord,
 * et le garde-fou 1 retard actif par train + gare.
 */
(() => {
  if (window.__LB_COMMUNITY_MAP_BRIDGE_BOOTSTRAP_V1__) return;
  window.__LB_COMMUNITY_MAP_BRIDGE_BOOTSTRAP_V1__ = true;

  const head = document.head || document.documentElement;

  function load(src, id, done){
    const existing = document.getElementById(id);
    if (existing) {
      if (typeof done === 'function') {
        if (existing.dataset.lbLoaded === '1') done();
        else existing.addEventListener('load', done, { once:true });
      }
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    script.addEventListener('load', () => {
      script.dataset.lbLoaded = '1';
      if (typeof done === 'function') done();
    }, { once:true });
    script.addEventListener('error', () => {
      console.error('[Voix du Bétail / carte] module impossible à charger :', src);
    }, { once:true });
    head.appendChild(script);
  }

  // UX anti-doublon côté site : si l'API répond 409, afficher le signal existant et ses votes.
  load('./assets/lb-community-single-delay-v1.js?v=20260914-1', 'lb-community-single-delay-v1');

  // Pont carte historique : présence, signaler, GPS et messages parent <-> iframe.
  load('./assets/lb-community-map-bridge-core-v1.js?v=20260923-nextstop-1', 'lb-community-map-bridge-core-v1', () => {
    // V3 corrige l'heure UTC et complète seulement les retards absents du snapshot natif.
    load('./assets/lb-community-map-votes-v3.js?v=20260923-stoplogic-1', 'lb-community-map-votes-v3');
  });
})();
