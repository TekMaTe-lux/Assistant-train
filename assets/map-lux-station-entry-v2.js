(() => {
  'use strict';
  if (window.__LB_LUX_STATION_ENTRY_V2__) return;
  window.__LB_LUX_STATION_ENTRY_V2__ = true;

  const BUTTON_CLASS = 'lb-lux-dynamic-entry-v2';
  const DYNAMIC_URL = '/map-v2/tests/luxembourg-user-preview-v5-private-maplike-trainclick.html';

  const norm = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();

  function isLuxembourgPanel(panel) {
    if (!panel?.classList?.contains('station-board-mode')) return false;
    const candidates = [
      panel.querySelector('.trip-panel-title'),
      panel.querySelector('.station-board-title'),
      panel.querySelector('.station-board-now'),
      panel.querySelector('h1,h2,h3,strong')
    ].filter(Boolean);
    const label = norm(candidates.map(el => el.textContent || '').join(' ') || panel.textContent.slice(0, 220));
    return /(^|\b)GARE DE LUXEMBOURG(\b|$)/.test(label)
      || /(^|\b)LUXEMBOURG(\b|$)/.test(label);
  }

  function ensureStyle() {
    if (document.getElementById('lbLuxStationEntryV2Style')) return;
    const style = document.createElement('style');
    style.id = 'lbLuxStationEntryV2Style';
    style.textContent = `
      .lb-station-tabs .${BUTTON_CLASS}{
        margin-left:4px!important;
        border-color:rgba(49,231,242,.34)!important;
        color:#effcff!important;
        background:rgba(49,231,242,.08)!important;
        white-space:nowrap!important;
      }
      .lb-station-tabs .${BUTTON_CLASS}:hover,
      .lb-station-tabs .${BUTTON_CLASS}:focus-visible{
        border-color:rgba(49,231,242,.62)!important;
        background:rgba(49,231,242,.15)!important;
      }
      @media(max-width:720px){
        .lb-station-tabs .${BUTTON_CLASS}{
          margin-left:0!important;
          padding-inline:7px!important;
          font-size:9px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function openDynamicStation() {
    const message = {
      type: 'lb:open-lux-dynamic-v2',
      station: 'Luxembourg',
      url: DYNAMIC_URL
    };
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, location.origin);
      return;
    }
    window.open(DYNAMIC_URL, '_blank', 'noopener,noreferrer');
  }

  function enhance(panel) {
    if (!isLuxembourgPanel(panel)) return;
    const tabs = panel.querySelector('.lb-station-tabs');
    if (!tabs || tabs.querySelector(`.${BUTTON_CLASS}`)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lb-station-tab ${BUTTON_CLASS}`;
    button.textContent = 'Gare dynamique';
    button.title = 'Ouvrir la gare dynamique de Luxembourg';
    button.setAttribute('aria-label', 'Ouvrir la gare dynamique de Luxembourg');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDynamicStation();
    });
    tabs.appendChild(button);
  }

  function cleanup() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => {
      if (!isLuxembourgPanel(button.closest('.trip-panel'))) button.remove();
    });
  }

  let scheduled = false;
  function refresh() {
    scheduled = false;
    ensureStyle();
    cleanup();
    document.querySelectorAll('.trip-panel.station-board-mode').forEach(enhance);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once:true });
  else schedule();

  new MutationObserver(schedule).observe(document.documentElement, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['class']
  });
})();
