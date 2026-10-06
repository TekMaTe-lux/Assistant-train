/* Compte intégré : réutilise les formulaires et API existants. */
(function () {
  'use strict';
  const root = document.getElementById('compte');
  if (!root) return;
  const panels = { profile: 'lbAuthModal', prefs: 'lbPrefsModal', ranking: 'lbRankingModal', register: 'lbRegisterModal', contact: 'lbContactModal', grades: 'lbGradesPanel' };
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
    if (current === 'grades') renderGrades();
    root.dataset.accountView = current;
    if (location.hash !== '#compte') location.hash = 'compte';
    sync();
    requestAnimationFrame(() => {
      const title = document.querySelector('#' + panels[current] + ' h3');
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      root.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }
  function renderGrades() {
    const loggedIn = window.lbIsAuthed === true;
    const overview = document.getElementById('lbGradesOverview');
    overview.hidden = !loggedIn;
    const label = document.getElementById('lbProfileGradeName').textContent;
    const pointsText = document.getElementById('lbProfileGradePoints').textContent;
    const points = Number(pointsText.replace('meuh', '').trim().replace(',', '.'));
    const thresholds = [-Infinity, 0, 20, 40, 80, 120, 180, 250];
    const index = Number.isFinite(points) ? thresholds.reduce((last, min, i) => points >= min ? i : last, 0) : 1;
    document.getElementById('lbGradesCurrent').textContent = label;
    document.getElementById('lbGradesScore').textContent = pointsText;
    document.getElementById('lbGradesNext').textContent = document.getElementById('lbProfileGradeNext').textContent;
    const avatar = document.getElementById('lbGradesAvatar');
    if (loggedIn) avatar.src = document.getElementById('lbProfileGradeImage').src;
    document.querySelectorAll('#lbGradesPanel .lb-grade-sheet').forEach((card, i) => {
      card.classList.toggle('is-current-grade', loggedIn && i === index);
      card.classList.toggle('is-next-grade', loggedIn && i === index + 1);
      const state = card.querySelector('.lb-grade-state');
      state.textContent = !loggedIn ? '' : i === index ? 'Ton grade' : i === index + 1 ? 'Prochain grade' : i > index ? 'À atteindre' : 'Palier inférieur';
      if (loggedIn && i === index) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
  }
  document.getElementById('lbGradeExploreBtn').addEventListener('click', () => show('grades'));
  document.getElementById('lbGradesBack').addEventListener('click', () => show('profile'));
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
