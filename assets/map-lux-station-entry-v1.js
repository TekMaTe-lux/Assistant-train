(() => {
  'use strict';
  if (window.__LB_LUX_STATION_ENTRY_V1__) return;
  window.__LB_LUX_STATION_ENTRY_V1__ = true;

  const DYNAMIC_URL = '/map-v2/tests/luxembourg-user-preview-v5-private-maplike-trainclick.html';
  const BUTTON_CLASS = 'lb-lux-dynamic-entry';

  const norm = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();

  function isLuxembourgStationPanel(panel) {
    if (!panel?.classList?.contains('station-board-mode')) return false;
    const title = panel.querySelector('.trip-panel-title, .station-board-title, .station-board-now, h1, h2, h3, strong');
    const label = norm(title?.textContent || panel.textContent.slice(0, 220));
    return /(^|\b)GARE DE LUXEMBOURG(\b|$)/.test(label)
      || /(^|\b)LUXEMBOURG(\b|$)/.test(label);
  }

  function ensureStyle() {
    if (document.getElementById('lbLuxStationEntryStyle')) return;
    const style = document.createElement('style');
    style.id = 'lbLuxStationEntryStyle';
    style.textContent = `
      .lb-station-tabs .${BUTTON_CLASS}{
        margin-left:4px!important;
        border-color:rgba(49,231,242,.28)!important;
        color:#bdd8df!important;
        text-decoration:none!important;
        white-space:nowrap!important;
      }
      .lb-station-tabs .${BUTTON_CLASS}:hover,
      .lb-station-tabs .${BUTTON_CLASS}:focus-visible{
        color:#effcff!important;
        border-color:rgba(49,231,242,.55)!important;
        background:rgba(49,231,242,.10)!important;
      }
      @media(max-width:720px){
        .lb-station-tabs .${BUTTON_CLASS}{margin-left:0!important;font-size:9px!important;padding-inline:7px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function removeForeignEntries() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => {
      const panel = button.closest('.trip-panel');
      if (!isLuxembourgStationPanel(panel)) button.remove();
    });
  }

  function enhancePanel(panel) {
    if (!isLuxembourgStationPanel(panel)) return;
    const tabs = panel.querySelector('.lb-station-tabs');
    if (!tabs || tabs.querySelector(`.${BUTTON_CLASS}`)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lb-station-tab ${BUTTON_CLASS}`;
    button.textContent = 'Gare dynamique';
    button.setAttribute('aria-label', 'Ouvrir la gare dynamique de Luxembourg');
    button.title = 'Quais, mouvements et trains en gare de Luxembourg';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const opened = window.open(DYNAMIC_URL, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    });
    tabs.appendChild(button);
  }

  let scheduled = false;
  function refresh() {
    scheduled = false;
    ensureStyle();
    removeForeignEntries();
    document.querySelectorAll('.trip-panel.station-board-mode').forEach(enhancePanel);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
})();
