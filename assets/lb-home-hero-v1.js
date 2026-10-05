'use strict';
(() => {
  function getPseudo() {
    if (window.lbIsAuthed !== true) return '';
    const profile = window.lbProfileCache || {};
    const prefs = window.lbPrefsCache || {};
    const user = window.currentUser || {};
    return String(prefs.pseudo || user.public_pseudo || user.pseudo || user.username ||
      profile.display_pseudo || profile.pseudo || '').trim().slice(0,24);
  }
  function fit(el) {
    const name = el.querySelector('.lb-neon-pseudo');
    name.style.fontSize = '';
    const base = parseFloat(getComputedStyle(name).fontSize);
    if (name.scrollWidth > el.clientWidth) name.style.fontSize = (base * el.clientWidth / name.scrollWidth) + 'px';
  }
  function syncGreeting() {
    const el = document.getElementById('lbHomeNeonGreeting');
    if (!el) return;
    const pseudo = getPseudo();
    const display = pseudo || 'le bétail';
    let name = el.querySelector('.lb-neon-pseudo');
    if (!name) {
      const hello = document.createElement('span');
      hello.className = 'lb-neon-hello'; hello.textContent = 'Bonjour';
      name = document.createElement('span'); name.className = 'lb-neon-pseudo';
      el.replaceChildren(hello,name);
    }
    if (name.textContent !== display) name.textContent = display;
    el.setAttribute('aria-label','Bonjour ' + display);
    el.title = 'Bonjour ' + display;
    fit(el);
  }
  function init() {
    syncGreeting();
    [250,800,1800,4000].forEach(delay => setTimeout(syncGreeting,delay));
    document.addEventListener('lb:prefs-updated',syncGreeting);
    document.addEventListener('lb:auth-state',syncGreeting);
    document.addEventListener('visibilitychange',() => {if (!document.hidden) syncGreeting();});
    window.addEventListener('resize',syncGreeting,{passive:true});
    window.addEventListener('focus',syncGreeting,{passive:true});
    if (document.fonts) document.fonts.ready.then(syncGreeting);
    setInterval(() => {if (!document.hidden) syncGreeting();},15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
