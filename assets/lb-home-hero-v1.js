'use strict';

(() => {
  function getPseudo() {
    const profile = window.lbProfileCache || {};
    const prefs = window.lbPrefsCache || {};
    const user = window.currentUser || {};
    return String(
      profile.display_pseudo || profile.pseudo || prefs.pseudo || user.pseudo || user.username || ''
    ).trim().slice(0, 24);
  }

  function syncGreeting() {
    const el = document.getElementById('homeWelcomeLine');
    if (!el) return;
    const pseudo = getPseudo();
    el.textContent = pseudo ? `Bonjour ${pseudo} 👋` : 'Bonjour 👋';
    el.title = el.textContent;
  }

  function init() {
    syncGreeting();
    [250, 800, 1800, 4000].forEach((delay) => setTimeout(syncGreeting, delay));
    document.addEventListener('lb:prefs-updated', syncGreeting);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncGreeting(); });
    window.addEventListener('focus', syncGreeting, { passive: true });
    setInterval(() => {
      if (!document.hidden && window.lbIsAuthed === true) syncGreeting();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();