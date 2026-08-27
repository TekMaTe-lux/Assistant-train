(() => {
  'use strict';
  if (window.__LB_LUX_STATION_HOST_V2__) return;
  window.__LB_LUX_STATION_HOST_V2__ = true;

  const DYNAMIC_URL = '/map-v2/tests/luxembourg-user-preview-v5-private-maplike-trainclick.html';
  let activeFrame = null;
  let originalSrc = '';

  function findFrameFromSource(source) {
    return [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === source) || null;
  }

  function ensureReturnButton() {
    let button = document.getElementById('lbLuxDynamicReturnV2');
    if (button) return button;
    button = document.createElement('button');
    button.id = 'lbLuxDynamicReturnV2';
    button.type = 'button';
    button.textContent = '← Retour à la carte';
    button.hidden = true;
    button.setAttribute('aria-label', 'Retour à la carte des trains');
    Object.assign(button.style, {
      position:'fixed', top:'10px', left:'10px', zIndex:'2147483000',
      minHeight:'36px', padding:'7px 12px', borderRadius:'10px',
      border:'1px solid rgba(49,231,242,.48)', background:'rgba(2,15,24,.94)',
      color:'#effcff', font:'800 12px/1.1 system-ui,sans-serif', cursor:'pointer',
      boxShadow:'0 8px 28px rgba(0,0,0,.34)'
    });
    button.addEventListener('click', () => {
      if (activeFrame && originalSrc) activeFrame.src = originalSrc;
      activeFrame = null;
      originalSrc = '';
      button.hidden = true;
    });
    document.body.appendChild(button);
    return button;
  }

  function openDynamic(frame, requestedUrl) {
    if (!frame) return;
    const current = frame.getAttribute('src') || frame.src || '';
    if (!originalSrc) originalSrc = current;
    activeFrame = frame;
    frame.src = requestedUrl || DYNAMIC_URL;
    ensureReturnButton().hidden = false;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type !== 'lb:open-lux-dynamic-v2') return;
    const frame = findFrameFromSource(event.source);
    if (!frame) return;
    openDynamic(frame, event.data.url);
  });
})();
