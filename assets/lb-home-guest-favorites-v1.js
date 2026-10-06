/* Invitation réservée aux visiteurs : aucun calcul de favoris ni appel réseau. */
(() => {
  'use strict';
  const cta = document.getElementById('homeFavLoginCta');
  const slot = document.getElementById('homeFavSlot');
  if (!cta || !slot) return;
  const card = cta.closest('.home-card');
  function sync() {
    const guest = window.lbIsAuthed !== true;
    card.dataset.favoritesGuest = String(guest);
    cta.hidden = !guest;
    cta.style.display = guest ? 'block' : 'none';
    slot.hidden = guest;
  }
  document.getElementById('homeCreateAccountBtn').addEventListener('click', () => {
    if (window.lbAccountPage) window.lbAccountPage.show('register');
    else document.getElementById('lbAuthSwitchBtn')?.click();
  });
  document.addEventListener('lb:auth-state', sync);
  document.addEventListener('lb:prefs-updated', sync);
  window.addEventListener('pageshow', sync);
  sync();
})();
