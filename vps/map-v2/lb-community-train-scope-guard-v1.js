'use strict';

/*
 * La Bétaillère — garde-fou de périmètre Voix du Bétail.
 * Objectif : les informations communautaires d'un train ne doivent jamais
 * rester visibles dans une fiche gare ni fuiter vers un autre train.
 * Aucun appel API ni règle métier n'est modifié ici.
 */
(() => {
  if (window.__LB_COMMUNITY_TRAIN_SCOPE_GUARD_V1__) return;
  window.__LB_COMMUNITY_TRAIN_SCOPE_GUARD_V1__ = true;

  const normalizeTrain = (value) => {
    const matches = String(value || '').match(/\d{3,6}/g);
    return matches?.length ? matches[matches.length - 1].replace(/^0+(?=\d)/, '') : '';
  };

  function panel(){
    return document.getElementById('trip-panel');
  }

  function isStationMode(p = panel()){
    return !!p && p.classList.contains('station-board-mode');
  }

  function panelTrainNumber(p = panel()){
    if (!p || isStationMode(p)) return '';
    return normalizeTrain(p.querySelector('#trip-panel-train')?.textContent || '');
  }

  function communityBlock(){
    return document.getElementById('lb-map-trip-community');
  }

  function removeTravelerStopArtifacts(p = panel()){
    if (!p) return;
    p.querySelectorAll('.lb-stop-traveler-delay-right,.lb-stop-traveler-delay-propagated')
      .forEach((node) => node.remove());
  }

  function hideCommunityBlock(block, reason){
    if (!block) return;
    block.hidden = true;
    block.setAttribute('aria-hidden', 'true');
    block.dataset.lbScopeHidden = reason || '1';
  }

  function enforceScope(){
    const p = panel();
    if (!p) return;
    const block = communityBlock();

    // Règle stricte n°1 : une fiche gare n'affiche JAMAIS la Voix du Bétail d'un train.
    if (isStationMode(p)) {
      hideCommunityBlock(block, 'station');
      if (block) block.dataset.trainNumber = '';
      removeTravelerStopArtifacts(p);
      return;
    }

    // Règle stricte n°2 : dans une fiche train, un bloc communautaire ne peut
    // être visible que s'il appartient exactement au train affiché.
    if (!block) return;
    const displayedTrain = panelTrainNumber(p);
    const blockTrain = normalizeTrain(block.dataset.trainNumber || '');

    if (displayedTrain && blockTrain && displayedTrain !== blockTrain) {
      hideCommunityBlock(block, 'train-mismatch');
      removeTravelerStopArtifacts(p);
      return;
    }

    // Le garde-fou ne force jamais l'affichage : la couche communautaire reste
    // seule décisionnaire pour savoir si le bloc doit être visible ou non.
    if (block.dataset.lbScopeHidden && displayedTrain && blockTrain === displayedTrain) {
      delete block.dataset.lbScopeHidden;
      block.removeAttribute('aria-hidden');
    }
  }

  function installStyle(){
    if (document.getElementById('lb-community-train-scope-guard-v1-style')) return;
    const style = document.createElement('style');
    style.id = 'lb-community-train-scope-guard-v1-style';
    style.textContent = `
      /* Sécurité visuelle absolue : jamais de bandeau train dans une fiche gare. */
      #trip-panel.station-board-mode #lb-map-trip-community,
      #trip-panel.station-board-mode .lb-stop-traveler-delay-right,
      #trip-panel.station-board-mode .lb-stop-traveler-delay-propagated{
        display:none!important;
      }
      #lb-map-trip-community[data-lb-scope-hidden]{display:none!important}
    `;
    document.head.appendChild(style);
  }

  let queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enforceScope();
    });
  }

  function installObserver(){
    const p = panel();
    if (!p || p.__lbCommunityScopeObserved) return;
    p.__lbCommunityScopeObserved = true;
    const observer = new MutationObserver(schedule);
    observer.observe(p, {
      attributes:true,
      attributeFilter:['class'],
      childList:true,
      subtree:true,
      characterData:true
    });
  }

  installStyle();
  installObserver();
  enforceScope();

  document.addEventListener('click', schedule, true);
  window.addEventListener('lb:community:snapshot', schedule);
  window.addEventListener('lb:community:changed', schedule);

  // Le panneau peut être créé tardivement selon le chemin d'ouverture.
  let tries = 0;
  const boot = setInterval(() => {
    tries += 1;
    installObserver();
    enforceScope();
    if (panel() || tries >= 40) clearInterval(boot);
  }, 250);
})();
