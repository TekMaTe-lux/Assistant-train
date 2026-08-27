/* La Bétaillère V4 — Command Center controller
 * Comportements UI transverses uniquement. Ne modifie aucune logique ferroviaire.
 */
(function () {
  'use strict';

  if (window.__LB_V4_COMMAND_CENTER__) return;
  window.__LB_V4_COMMAND_CENTER__ = true;

  const qs = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => Array.from(root.querySelectorAll(s));
  const state = {
    modalFocus: new WeakMap(),
    lastFocused: document.activeElement,
    observer: null
  };

  function activateTheme() {
    document.documentElement.classList.add('lb-v4');
    document.body?.classList.add('lb-v4');
    document.documentElement.dataset.lbUi = 'command-center-v4';
  }

  function ensureHomeHeading() {
    const home = qs('#home');
    if (!home) return;
    if (home.querySelector('h1')) return;
    const heading = document.createElement('h1');
    heading.className = 'visually-hidden';
    heading.textContent = 'La Bétaillère — Info trafic Nancy, Metz, Thionville et Luxembourg';
    home.prepend(heading);
  }

  function labelLooseControls() {
    const labels = new Map([
      ['lbRankingFilter', 'Filtrer le classement'],
      ['lbRankingFilterInline', 'Filtrer le classement'],
      ['affDaySel', 'Choisir la date d’affluence']
    ]);
    labels.forEach((label, id) => {
      const el = document.getElementById(id);
      if (el && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
        el.setAttribute('aria-label', label);
      }
    });

    ['lbAuthMsg', 'lbRegMsg', 'lbContactMsg', 'tableauTrainSearchStatus'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
      if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
      if (!el.hasAttribute('aria-atomic')) el.setAttribute('aria-atomic', 'true');
    });
  }

  function enhanceAffluence(scope = document) {
    qsa('.affluence-dot', scope).forEach((dot) => {
      const text = String(dot.title || '').trim();
      if (!text) return;
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', text);
    });
  }

  function enhanceCharts(scope = document) {
    qsa('canvas', scope).forEach((canvas) => {
      if (canvas.hasAttribute('aria-label')) {
        if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'img');
        return;
      }
      const card = canvas.closest('article, .stats-card, .stats-v2__card, .aff-evo, section');
      const title = card?.querySelector('h2, h3, h4, .title, .stats-v2__card-title')?.textContent?.trim();
      const fallback = canvas.textContent?.trim();
      const label = title || fallback;
      if (!label) return;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${label}. Un résumé textuel des données est disponible dans cette section lorsqu’il est fourni.`);
    });
  }

  function isVisible(el) {
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function openModal() {
    return qsa('.lb-auth-modal, .home-major-alert-modal, .train-detail-modal, .lb-modal-backdrop')
      .filter(isVisible)
      .sort((a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0))
      .at(-1) || null;
  }

  function focusables(root) {
    return qsa([
      'a[href]:not([tabindex="-1"])',
      'button:not([disabled]):not([hidden]):not([tabindex="-1"])',
      'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
      'select:not([disabled]):not([tabindex="-1"])',
      'textarea:not([disabled]):not([tabindex="-1"])',
      'summary:not([tabindex="-1"])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(','), root).filter(isVisible);
  }

  function modalPanel(modal) {
    return qs('[role="dialog"], dialog, .lb-auth-card, .home-major-alert-panel, .train-detail-panel, .lb-modal', modal) || modal;
  }

  function rememberModalFocus(modal) {
    if (state.modalFocus.has(modal)) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.modalFocus.set(modal, active && !modal.contains(active) ? active : state.lastFocused);
  }

  function prepareModal(modal) {
    const panel = modalPanel(modal);
    if (panel !== modal) {
      if (!panel.hasAttribute('role') && panel.tagName !== 'DIALOG') panel.setAttribute('role', 'dialog');
      if (!panel.hasAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');
    }
    rememberModalFocus(modal);
    const items = focusables(panel);
    const target = qs('[autofocus]', panel) || qs('.lb-auth-close, .tron-close-button, .train-detail-close, [aria-label^="Fermer"]', panel) || items[0];
    if (target && !panel.contains(document.activeElement)) {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }

  function restoreModalFocus(modal) {
    const target = state.modalFocus.get(modal);
    state.modalFocus.delete(modal);
    if (target instanceof HTMLElement && document.contains(target)) {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }

  function trapModalTab(event, modal) {
    if (event.key !== 'Tab') return;
    const panel = modalPanel(modal);
    const items = focusables(panel);
    if (!items.length) {
      event.preventDefault();
      if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeTopModalWithEscape(event, modal) {
    if (event.key !== 'Escape') return false;
    const close = qs('.lb-auth-close, .tron-close-button, .train-detail-close, [aria-label^="Fermer"]', modal);
    if (!close) return false;
    event.preventDefault();
    close.click();
    return true;
  }

  function enhanceModalState() {
    qsa('.lb-auth-modal, .home-major-alert-modal, .train-detail-modal, .lb-modal-backdrop').forEach((modal) => {
      const visible = isVisible(modal);
      const wasOpen = modal.dataset.lbV4Open === '1';
      if (visible && !wasOpen) {
        modal.dataset.lbV4Open = '1';
        prepareModal(modal);
      } else if (!visible && wasOpen) {
        modal.dataset.lbV4Open = '0';
        restoreModalFocus(modal);
      }
    });
  }

  function syncPageSemantics() {
    const hash = String(location.hash || '#home').toLowerCase();
    const pages = qsa('.app-page, #home, #search, #carte, #stats, #multimedia, #favTrainsWidget');
    let mainAssigned = false;
    pages.forEach((page) => {
      const id = `#${String(page.id || '').toLowerCase()}`;
      const aliases = id === '#favtrainswidget' ? ['#favoris', '#favtrainswidget'] : [id];
      const active = aliases.includes(hash) && isVisible(page);
      if (active && !mainAssigned) {
        page.setAttribute('role', 'main');
        mainAssigned = true;
      } else if (page.getAttribute('role') === 'main') {
        page.removeAttribute('role');
      }
    });
  }

  function enhanceDynamicUi(scope = document) {
    enhanceAffluence(scope);
    enhanceCharts(scope);
    labelLooseControls();
    enhanceModalState();
  }

  function observe() {
    if (state.observer) return;
    state.observer = new MutationObserver((mutations) => {
      let needsModal = false;
      const roots = new Set();
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') needsModal = true;
        mutation.addedNodes?.forEach((node) => {
          if (node instanceof Element) roots.add(node);
        });
      }
      roots.forEach((root) => enhanceDynamicUi(root));
      if (needsModal) enhanceModalState();
    });
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'hidden', 'class', 'style']
    });
  }

  document.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLElement) state.lastFocused = event.target;
  });

  document.addEventListener('keydown', (event) => {
    const modal = openModal();
    if (!modal) return;
    if (closeTopModalWithEscape(event, modal)) return;
    trapModalTab(event, modal);
  }, true);

  window.addEventListener('hashchange', () => requestAnimationFrame(syncPageSemantics));

  function init() {
    activateTheme();
    ensureHomeHeading();
    labelLooseControls();
    enhanceDynamicUi(document);
    syncPageSemantics();
    observe();
    document.dispatchEvent(new CustomEvent('lb:v4-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
