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


function initEmbeddedCarteFrame(){
  const frame = document.querySelector('#carte iframe');
  if (!frame || frame.dataset.embedInit === '1') return;
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
    hideInnerUi();
    let n = 0;
    const t = setInterval(() => {
      hideInnerUi();
      n += 1;
      if (n > 20) clearInterval(t);
    }, 200);
  });
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
