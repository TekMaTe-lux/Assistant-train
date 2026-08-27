(() => {
  'use strict';
  if (window.__LB_V4_DATA_BRIDGE__) return;
  window.__LB_V4_DATA_BRIDGE__ = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function lbV4Fetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url === '/api/v4/snapshot' || /\/api\/v4\/snapshot(?:[?#]|$)/.test(url)) {
      try {
        const separator = './data/snapshot.json'.includes('?') ? '&' : '?';
        const response = await nativeFetch(`./data/snapshot.json${separator}t=${Date.now()}`, {
          ...(init || {}),
          cache: 'no-store',
          headers: { ...((init && init.headers) || {}), accept: 'application/json' }
        });
        if (response.ok) return response;
      } catch (_) {
        // Le snapshot statique n'existe pas encore : on laisse le flux normal continuer.
      }
    }
    return nativeFetch(input, init);
  };
})();
