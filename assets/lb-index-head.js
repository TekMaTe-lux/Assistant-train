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

/* Moorail — signature ferroviaire discrète dans la barre supérieure.
   Injection autonome pour ne pas toucher à la structure historique de l'index. */
function installMoorailHeaderBrand(){
  if (document.getElementById('lb-moorail-header-brand')) return;

  const actions = document.querySelector('.top-bar__actions');
  if (!actions) return;

  if (!document.getElementById('lb-moorail-header-style')) {
    const style = document.createElement('style');
    style.id = 'lb-moorail-header-style';
    style.textContent = `
      body.lb-v3 .top-bar__moorail {
        width: clamp(122px, 10vw, 154px);
        height: 58px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        margin-left: 2px;
        padding: 1px 3px;
        border-radius: 13px;
        text-decoration: none;
        opacity: .98;
        transition: transform .18s ease, filter .18s ease, background .18s ease;
      }
      body.lb-v3 .top-bar__moorail:hover,
      body.lb-v3 .top-bar__moorail:focus-visible {
        transform: translateY(-1px);
        background: rgba(49,231,242,.055);
        filter: drop-shadow(0 0 8px rgba(49,231,242,.28));
      }
      body.lb-v3 .top-bar__moorail svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      @media (max-width: 1120px) {
        body.lb-v3 .top-bar__moorail { display: none !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        body.lb-v3 .top-bar__moorail { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  const link = document.createElement('a');
  link.id = 'lb-moorail-header-brand';
  link.className = 'top-bar__moorail';
  link.href = '#carte';
  link.setAttribute('aria-label', 'Ouvrir Moorail, la carte ferroviaire de La Bétaillère');
  link.setAttribute('title', 'Moorail — la carte ferroviaire de La Bétaillère');
  link.innerHTML = `
    <svg viewBox="0 0 300 168" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lbMoorailCyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#38f5ff"/>
          <stop offset="1" stop-color="#02a9ff"/>
        </linearGradient>
        <linearGradient id="lbMoorailBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#00ddeb"/>
          <stop offset="1" stop-color="#176cff"/>
        </linearGradient>
        <filter id="lbMoorailGlow" x="-25%" y="-35%" width="150%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#lbMoorailGlow)">
        <path d="M12 69 H51 Q68 69 68 52 V19 Q68 11 76 18 L150 70 L224 18 Q232 11 232 19 V69 Q232 69 249 69 H288" stroke="#f8feff" stroke-width="8"/>
        <path d="M12 80 H65 Q82 80 82 63 V31 Q82 23 90 31 L150 77 L210 31 Q218 23 218 31 V80 Q218 80 235 80 H288" stroke="url(#lbMoorailCyan)" stroke-width="8"/>
        <path d="M12 91 H80 Q96 91 96 75 V45 L150 84 L204 45 V75 Q204 91 220 91 H288" stroke="url(#lbMoorailBlue)" stroke-width="8"/>
      </g>
      <g stroke="#f8feff" stroke-width="5">
        <circle cx="45" cy="69" r="7" fill="#f8feff"/>
        <circle cx="96" cy="80" r="7" fill="#06131f"/>
        <circle cx="150" cy="70" r="7" fill="#06131f"/>
        <circle cx="232" cy="23" r="7" fill="#06131f"/>
      </g>
      <text x="150" y="130" text-anchor="middle" fill="#f7fdff" font-family="Orbitron,Segoe UI,sans-serif" font-size="34" font-weight="600" letter-spacing="4">MOORAIL</text>
      <g fill="#dffbff" font-family="Rajdhani,Segoe UI,sans-serif" font-size="10" font-weight="700" letter-spacing="3">
        <path d="M20 149 H63" stroke="#20dff0" stroke-width="2"/>
        <text x="150" y="153" text-anchor="middle">BY LA BÉTAILLÈRE</text>
        <path d="M237 149 H280" stroke="#20dff0" stroke-width="2"/>
      </g>
    </svg>`;

  actions.appendChild(link);
}

document.addEventListener('DOMContentLoaded', installMoorailHeaderBrand);
