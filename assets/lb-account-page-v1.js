/* Compte intégré : réutilise les formulaires et API existants. */
(function () {
  'use strict';
  const root = document.getElementById('compte');
  if (!root) return;
  const panels = { profile: 'lbAuthModal', prefs: 'lbPrefsModal', ranking: 'lbRankingModal', register: 'lbRegisterModal', contact: 'lbContactModal' };
  let current = 'profile';
  function sync() {
    const visible = location.hash.toLowerCase() === '#compte';
    Object.entries(panels).forEach(([key, id]) => {
      const panel = document.getElementById(id);
      if (!panel) return;
      const active = key === current;
      panel.classList.toggle('is-account-panel-active', active);
      const hidden = String(!visible || !active);
      if (panel.getAttribute('aria-hidden') !== hidden) panel.setAttribute('aria-hidden', hidden);
      panel.inert = !visible || !active;
    });
  }
  function show(key) {
    current = panels[key] ? key : 'profile';
    root.dataset.accountView = current;
    if (location.hash !== '#compte') location.hash = 'compte';
    sync();
    requestAnimationFrame(() => {
      const title = document.querySelector('#' + panels[current] + ' h3');
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      root.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }
  window.lbAccountPage = Object.freeze({ show, back: () => show('profile') });
  const observer = new MutationObserver(sync);
  Object.values(panels).forEach(id => {
    const panel = document.getElementById(id);
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['aria-hidden'] });
  });
  window.addEventListener('hashchange', () => {
    if (location.hash.toLowerCase() !== '#compte') current = 'profile';
    sync();
  });
  sync();
})();
