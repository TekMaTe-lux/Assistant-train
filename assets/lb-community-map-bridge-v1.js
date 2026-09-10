'use strict';

/*
 * Bootstrap conservateur du pont carte communautaire.
 * Le pont historique reste byte-for-byte dans lb-community-map-bridge-core-v1.js ;
 * cette enveloppe ajoute seulement la couche de vote carte après son chargement.
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

  load('./assets/lb-community-map-bridge-core-v1.js?v=20260905-6', 'lb-community-map-bridge-core-v1', () => {
    load('./assets/lb-community-map-votes-v2.js?v=20260910-1', 'lb-community-map-votes-v2');
  });
})();
