// Rendu échelonné pour gros tableaux (évite le mur de mémoire sur iOS)
function renderRowsChunked(htmlRows, tbody, chunk=200){
  tbody.textContent = '';
  let i=0;
  function step(){
    const frag = document.createDocumentFragment();
    for(let c=0;c<chunk && i<htmlRows.length;c++,i++){
      const tr = document.createElement('tr'); tr.innerHTML = htmlRows[i];
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    if(i<htmlRows.length) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Charge les bibliothèques non critiques uniquement au moment où une action
// utilisateur en a réellement besoin (capture, export, etc.).
window.lbLoadScriptOnce = window.lbLoadScriptOnce || function lbLoadScriptOnce(src, test){
  if (typeof test === 'function' && test()) return Promise.resolve();
  window.__lbScriptLoads = window.__lbScriptLoads || new Map();
  if (window.__lbScriptLoads.has(src)) return window.__lbScriptLoads.get(src);

  const pending = new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === new URL(src, document.baseURI).href);
    const script = existing || document.createElement('script');
    const done = () => (typeof test !== 'function' || test())
      ? resolve()
      : reject(new Error(`Bibliothèque indisponible après chargement: ${src}`));

    if (existing && (typeof test !== 'function' || test())) {
      resolve();
      return;
    }

    script.addEventListener('load', done, { once:true });
    script.addEventListener('error', () => reject(new Error(`Échec du chargement: ${src}`)), { once:true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    window.__lbScriptLoads.delete(src);
    throw error;
  });

  window.__lbScriptLoads.set(src, pending);
  return pending;
};


function ensureEmbeddedCarteLoaded(){
  const frame = document.querySelector('#carte iframe');
  if (!frame || frame.dataset.lbMapLoaded === '1') return frame;

  const source = String(frame.dataset.src || '').trim();
  if (!source) return frame;

  frame.dataset.lbMapLoaded = '1';
  frame.src = source;
  return frame;
}

function initEmbeddedCarteFrame(){
  const frame = document.querySelector('#carte iframe');
  if (!frame) return;

  if (frame.dataset.embedInit !== '1') {
    frame.dataset.embedInit = '1';

    const hideInnerUi = () => {
      try{
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) return;
        const selectors = [
          '.leaflet-top.leaflet-right',
          '.map-title', '.map-header', '.hero', 'header', 'nav',
          '[data-embed-hide]', '.banner', '.top-banner', '.project-support', '.support-project'
        ];
        selectors.forEach(sel => {
          doc.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
        });
        doc.body && (doc.body.style.marginTop = '0');
        doc.documentElement && (doc.documentElement.style.marginTop = '0');
      }catch(e){ /* cross-origin or selector unsupported */ }
    };

    frame.addEventListener('load', () => {
      if (frame.src === 'about:blank') return;
      hideInnerUi();
      let n = 0;
      const t = setInterval(() => {
        hideInnerUi();
        n += 1;
        if (n > 20) clearInterval(t);
      }, 200);
    });
  }

  // La carte coûte plusieurs Mo de données et beaucoup de CPU. Elle ne démarre
  // qu'au premier affichage de l'onglet Carte, puis reste vivante pour les retours.
  if ((location.hash || '').toLowerCase() === '#carte') ensureEmbeddedCarteLoaded();
}

document.addEventListener('DOMContentLoaded', initEmbeddedCarteFrame);

function syncCarteFullscreenMode(){
  const active = (location.hash || '') === '#carte';
  const topH = Math.round(document.querySelector('.top-bar')?.getBoundingClientRect().height || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-bar-height')) || 72);
  const botH = Math.round(document.querySelector('.bottom-nav')?.getBoundingClientRect().height || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-height')) || 84);
  const loisirsNav = document.getElementById('loisirsViewNav');
  const loisirsVisible = !!(loisirsNav && loisirsNav.classList.contains('is-visible') && !loisirsNav.hidden);
  const loisirsH = loisirsVisible ? Math.round(loisirsNav.getBoundingClientRect().height || 64) : 0;
  document.documentElement.style.setProperty('--carte-top-offset', `${topH}px`);
  document.documentElement.style.setProperty('--loisirs-viewbar-h', `${loisirsH}px`);
  document.documentElement.style.setProperty('--carte-bottom-offset', `calc(${botH + loisirsH}px + env(safe-area-inset-bottom, 0px))`);
  document.body.classList.toggle('carte-fullscreen', active);
  document.body.classList.toggle('carte-underlay', !active);

  const frame = document.querySelector('#carte iframe');
  if (frame) frame.style.pointerEvents = active ? 'auto' : 'none';

  if (active) initEmbeddedCarteFrame();
}

window.addEventListener('hashchange', syncCarteFullscreenMode);
window.addEventListener('resize', syncCarteFullscreenMode, { passive:true });

document.addEventListener('DOMContentLoaded', () => {
  syncCarteFullscreenMode();
  const carteTab = document.querySelector('.bottom-nav__item[href="#carte"]');
  carteTab?.addEventListener('click', () => setTimeout(syncCarteFullscreenMode, 0));

  document.querySelectorAll('.bottom-nav__item[href]').forEach(link => {
    link.addEventListener('click', () => {
      if ((link.getAttribute('href') || '') !== '#carte') {
        document.body.classList.remove('carte-fullscreen');
        document.body.classList.add('carte-underlay');
        const frame = document.querySelector('#carte iframe');
        if (frame) frame.style.pointerEvents = 'none';
      }
    }, { passive: true });
  });
});

// État réseau + boîte d'envoi hors connexion. Visuel uniquement :
// le service worker reste la source de vérité pour la synchronisation.
(() => {
  if (!('serviceWorker' in navigator)) return;
  let pending = 0;
  let lastPending = 0;
  let successTimer = null;
  const staleData = new Map();

  const ensureBadge = () => {
    let badge = document.getElementById('lbOfflineStatus');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'lbOfflineStatus';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    Object.assign(badge.style, {
      position: 'fixed',
      left: '50%',
      bottom: 'calc(var(--bottom-bar-height, 84px) + env(safe-area-inset-bottom, 0px) + 10px)',
      transform: 'translateX(-50%)',
      zIndex: '2147483000',
      maxWidth: 'calc(100vw - 28px)',
      padding: '8px 12px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,.22)',
      background: 'rgba(8,14,24,.94)',
      color: '#fff',
      font: '600 12px/1.25 system-ui,-apple-system,Segoe UI,sans-serif',
      boxShadow: '0 8px 30px rgba(0,0,0,.35)',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none',
      display: 'none',
      textAlign: 'center'
    });
    document.body.appendChild(badge);
    return badge;
  };

  const latestStaleData = () => {
    const items = Array.from(staleData.entries())
      .map(([label, cachedAt]) => ({ label, cachedAt:Number(cachedAt || 0) }))
      .filter((item) => item.cachedAt > 0)
      .sort((a, b) => b.cachedAt - a.cachedAt);
    return items[0] || null;
  };

  const formatCachedAt = (stamp) => {
    try { return new Date(Number(stamp)).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }); }
    catch (_) { return ''; }
  };

  const render = () => {
    if (!document.body) return;
    const badge = ensureBadge();
    const stale = latestStaleData();
    const staleTime = stale ? formatCachedAt(stale.cachedAt) : '';
    clearTimeout(successTimer);
    if (!navigator.onLine) {
      if (pending > 0) {
        badge.textContent = `📡 Hors connexion · ${pending} action${pending > 1 ? 's' : ''} en attente · ${staleTime ? `données de ${staleTime}` : 'envoi automatique au retour du réseau'}`;
      } else if (stale) {
        badge.textContent = `📡 Hors connexion · dernières données ${stale.label} : ${staleTime}`;
      } else {
        badge.textContent = '📡 Hors connexion · les dernières données disponibles restent consultables';
      }
      badge.style.display = 'block';
      return;
    }
    if (pending > 0) {
      badge.textContent = `🟠 ${pending} action${pending > 1 ? 's' : ''} en cours de synchronisation`;
      badge.style.display = 'block';
      return;
    }
    if (stale) {
      badge.textContent = `🕘 Réseau instable · dernières données ${stale.label} : ${staleTime}`;
      badge.style.display = 'block';
      return;
    }
    if (lastPending > 0) {
      badge.textContent = '✅ Tout est synchronisé';
      badge.style.display = 'block';
      successTimer = setTimeout(() => { badge.style.display = 'none'; }, 2200);
    } else {
      badge.style.display = 'none';
    }
  };

  const askWorker = (flush = false) => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    worker.postMessage({ type: 'LB_OUTBOX_STATUS' });
    if (flush) worker.postMessage({ type: 'LB_FLUSH_OUTBOX' });
  };

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'LB_OUTBOX_STATUS') {
      lastPending = pending;
      pending = Math.max(0, Number(data.pending || 0));
      render();
      return;
    }
    if (data.type === 'LB_DATA_STATE') {
      const label = String(data.label || 'données');
      if (data.source === 'cache' && Number(data.cachedAt || 0) > 0) staleData.set(label, Number(data.cachedAt));
      if (data.source === 'network') staleData.delete(label);
      render();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(() => askWorker(navigator.onLine), 100));
  window.addEventListener('online', () => { render(); askWorker(true); }, { passive:true });
  window.addEventListener('offline', render, { passive:true });
  document.addEventListener('DOMContentLoaded', () => {
    render();
    navigator.serviceWorker.ready.then(() => askWorker(navigator.onLine)).catch(() => {});
  }, { once:true });
})();
