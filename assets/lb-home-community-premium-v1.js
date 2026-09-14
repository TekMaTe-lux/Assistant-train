'use strict';

(() => {
  const BADGE_ID = 'lbHomeCommunityBadge';
  const GRADE_IMAGES = [
    { min: -20, name: 'Porc en déroute', image: 'Porc en déroute.png' },
    { min: 0, name: 'Mouton égaré', image: 'Mouton égaré.png' },
    { min: 20, name: 'Poulette du quai', image: 'Poulet du Quai.png' },
    { min: 40, name: 'Porc entassé du couloir', image: 'Porc entassé du couloir.png' },
    { min: 80, name: 'Bélier du sas', image: 'Bélier du sas.png' },
    { min: 120, name: 'Architecte Chèvre de la galère', image: 'Architecte Chèvre de la galère.png' },
    { min: 180, name: 'Ministre dindon du chaos ferroviaire', image: 'Ministre dindon du chaos ferroviaire.png' },
    { min: 250, name: 'Golden Vache', image: 'Golden Vache.png' }
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
      const exact = GRADE_IMAGES.find((item) => normalize(item.name) === requested);
      if (exact) return exact;
    }
    return GRADE_IMAGES.reduce((best, item) => points >= item.min ? item : best, GRADE_IMAGES[0]);
  }

  function getUserSnapshot() {
    const profile = window.lbProfileCache || {};
    const prefs = window.lbPrefsCache || {};
    const user = window.currentUser || {};
    const authed = window.lbIsAuthed === true;
    const pseudo = String(profile.display_pseudo || profile.pseudo || prefs.pseudo || user.pseudo || user.username || '').trim();
    const points = Number(profile.points || 0) || 0;
    const grade = resolveGrade(profile, points);
    return { authed, pseudo, points, grade };
  }

  function ensureBadge() {
    const actions = document.querySelector('#home .live-wall-card--home .live-wall-head-actions');
    const faq = document.getElementById('faqBtn');
    if (!actions || !faq) return null;

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('button');
      badge.id = BADGE_ID;
      badge.type = 'button';
      badge.className = 'lb-home-community-badge';
      badge.setAttribute('aria-label', 'Ouvrir mon profil troupeau');
      badge.innerHTML = `
        <span class="lb-home-community-badge__avatar" aria-hidden="true"><img alt="" loading="lazy" decoding="async"></span>
        <span class="lb-home-community-badge__copy">
          <span class="lb-home-community-badge__pseudo"></span>
          <span class="lb-home-community-badge__meta"></span>
        </span>`;
      badge.addEventListener('click', () => {
        const openAccount = document.getElementById('lbBtnOpenAuth') || document.getElementById('bottomAccountBtn');
        openAccount?.click?.();
      });
      actions.insertBefore(badge, faq);
    } else if (badge.nextElementSibling !== faq) {
      actions.insertBefore(badge, faq);
    }
    return badge;
  }

  function syncBadge() {
    const badge = ensureBadge();
    if (!badge) return;

    const { authed, pseudo, points, grade } = getUserSnapshot();
    if (!authed || !pseudo) {
      badge.classList.remove('is-visible');
      badge.hidden = true;
      return;
    }

    const image = badge.querySelector('.lb-home-community-badge__avatar img');
    const pseudoEl = badge.querySelector('.lb-home-community-badge__pseudo');
    const metaEl = badge.querySelector('.lb-home-community-badge__meta');

    if (image) {
      image.src = `./${encodeURIComponent(grade.image)}`;
      image.alt = grade.name;
    }
    if (pseudoEl) pseudoEl.textContent = pseudo;
    if (metaEl) metaEl.textContent = `★ ${points.toLocaleString('fr-FR')} meuh`;

    badge.title = `${pseudo} · ${grade.name} · ${points.toLocaleString('fr-FR')} meuh`;
    badge.hidden = false;
    badge.classList.add('is-visible');
  }

  function init() {
    syncBadge();
    [350, 1000, 2500, 6000].forEach((delay) => setTimeout(syncBadge, delay));
    document.addEventListener('lb:prefs-updated', syncBadge);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncBadge(); });
    window.addEventListener('focus', syncBadge, { passive: true });
    setInterval(() => {
      if (!document.hidden && window.lbIsAuthed === true) syncBadge();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
