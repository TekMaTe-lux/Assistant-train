/* En gare — emplacement du bouton dans le bandeau TRON.
 * Ne change pas la fiche gare ni la logique de données.
 */
(() => {
  'use strict';
  function placeStationButton() {
    const hero = document.querySelector('#home .lb-home-hero');
    const button = document.querySelector('#home .lb-board-open-button');
    if (!hero || !button || button.parentElement === hero) return;
    hero.appendChild(button); // conserve les événements du bouton existant
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeStationButton, { once:true });
  } else {
    placeStationButton();
  }
})();
