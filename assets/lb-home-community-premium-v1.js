'use strict';

(() => {
  const IDENTITY_ID = 'lbHomeCommunityBadge';
  const GRADE_LEVELS = [
    { min: -20, name: 'Porc en déroute' },
    { min: 0, name: 'Mouton égaré' },
    { min: 20, name: 'Poulette du quai' },
    { min: 40, name: 'Porc entassé du couloir' },
    { min: 80, name: 'Bélier du sas' },
    { min: 120, name: 'Architecte Chèvre de la galère' },
    { min: 180, name: 'Ministre dindon du chaos ferroviaire' },
    { min: 250, name: 'Golden Vache' }
  ];

  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function resolveGrade(profile, points) {
    const requested = normalize(profile?.grade);
    if (requested) {
      const exact = GRADE_LEVELS.find((item) => normalize(item.name) === requested);
      if (exact) return exact.name;
    }
    return GRADE_LEVELS.reduce(
      (best, item) => points >= item.min ? item : best,
      GRADE_LEVELS[0]
    ).name;
  }

  function getUserSnapshot() {
    const profile = window.lbProfileCache || {};
    const prefs = window.lbPrefsCache || {};
    const user = window.currentUser || {};
    const authed = window.lbIsAuthed === true;
    const pseudo = String(
      profile.display_pseudo || profile.pseudo || prefs.pseudo || user.pseudo || user.username || ''
    ).trim();
    const points = Number(profile.points || 0) || 0;
    return { authed, pseudo, grade: resolveGrade(profile, points) };
  }

  function ensureIdentity() {
    const head = document.querySelector('#home .live-wall-card--home .live-wall-head');
    const actions = head?.querySelector('.live-wall-head-actions');
    const faq = document.getElementById('faqBtn');
    if (!head || !actions || !faq) return null;

    let identity = document.getElementById(IDENTITY_ID);
    if (identity && identity.tagName !== 'DIV') {
      const replacement = document.createElement('div');
      replacement.id = IDENTITY_ID;
      identity.replaceWith(replacement);
      identity = replacement;
    }
    if (!identity) {
      identity = document.createElement('div');
      identity.id = IDENTITY_ID;
    }

    if (identity.dataset.lbIdentityVersion !== '3') {
      identity.dataset.lbIdentityVersion = '3';
      identity.className = 'lb-home-community-identity';
      identity.setAttribute('aria-label', 'Profil communautaire');
      identity.innerHTML = `
        <span class="lb-home-community-identity__pseudo"></span>
        <span class="lb-home-community-identity__sep" aria-hidden="true">·</span>
        <span class="lb-home-community-identity__grade"></span>`;
    }

    identity.style.setProperty('height', 'auto', 'important');
    identity.style.setProperty('min-height', '0', 'important');
    identity.style.setProperty('padding-top', '4px', 'important');
    identity.style.setProperty('padding-bottom', '4px', 'important');
    identity.style.setProperty('box-sizing', 'border-box', 'important');
    identity.style.setProperty('cursor', 'default', 'important');

    if (identity.parentElement !== head || identity.nextElementSibling !== actions) {
      head.insertBefore(identity, actions);
    }
    return identity;
  }

  function syncIdentity() {
    const identity = ensureIdentity();
    if (!identity) return;

    const { authed, pseudo, grade } = getUserSnapshot();
    if (!authed || !pseudo) {
      identity.classList.remove('is-visible');
      identity.hidden = true;
      return;
    }

    const pseudoEl = identity.querySelector('.lb-home-community-identity__pseudo');
    const gradeEl = identity.querySelector('.lb-home-community-identity__grade');
    if (pseudoEl) pseudoEl.textContent = pseudo;
    if (gradeEl) gradeEl.textContent = grade;

    identity.title = `${pseudo} · ${grade}`;
    identity.hidden = false;
    identity.classList.add('is-visible');
  }

  function ensureStyle(id, href) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    (document.head || document.documentElement).appendChild(link);
  }

  function ensureScript(id, src) {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  function ensureChatEnhancement() {
    ensureStyle('lb-home-community-chat-v1-css', './assets/lb-home-community-chat-v1.css?v=1');
    ensureStyle('lb-home-community-collapsed-v2-css', './assets/lb-home-community-collapsed-v2.css?v=3');
    ensureStyle('lb-home-comment-delete-v1-css', './assets/lb-home-comment-delete-v1.css?v=1');
    ensureScript('lb-home-community-chat-v1-js', './assets/lb-home-community-chat-v1.js?v=1');
    ensureScript('lb-home-community-collapsed-v2-js', './assets/lb-home-community-collapsed-v2.js?v=4');
    ensureScript('lb-home-comment-delete-v1-js', './assets/lb-home-comment-delete-v1.js?v=1');
  }

  function init() {
    syncIdentity();
    ensureChatEnhancement();
    [250, 800, 1800, 4000].forEach((delay) => setTimeout(syncIdentity, delay));
    document.addEventListener('lb:prefs-updated', syncIdentity);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncIdentity(); });
    window.addEventListener('focus', syncIdentity, { passive: true });
    setInterval(() => {
      if (!document.hidden && window.lbIsAuthed === true) syncIdentity();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
