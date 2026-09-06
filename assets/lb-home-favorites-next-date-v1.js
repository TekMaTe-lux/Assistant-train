/* La Bétaillère — date de prochaine circulation dans les raccourcis favoris. */
(() => {
  'use strict';

  const STYLE_ID = 'lb-home-favorites-next-date-v1-style';

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#home #homeFavSlot .home-fav-next-service {
  margin: 2px 0 0;
  padding: 0;
  min-height: 11px;
  font-size: clamp(.58rem, 1.05vw, .68rem);
  line-height: 1.05;
  font-weight: 600;
  letter-spacing: .01em;
  color: rgba(205, 239, 244, .74);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  #home #homeFavSlot .home-fav-next-service {
    margin-top: 1px;
    min-height: 9px;
    font-size: clamp(.52rem, 2.35vw, .62rem);
  }
}
`;
    document.head.appendChild(style);
  }

  function normalizeText(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function syncRow(k){
    const row = document.querySelector(`#homeFavSlot .home-fav-row[data-fav-k="${k}"]`);
    if (!row) return;

    const time = row.querySelector('.home-fav-time');
    if (!time) return;

    const source = document.querySelector(`#favMeta${k} .fav-next-service`);
    const text = normalizeText(source?.textContent);
    let line = row.querySelector('.home-fav-next-service');

    if (!text) {
      if (line) line.remove();
      return;
    }

    if (!line) {
      line = document.createElement('div');
      line.className = 'home-fav-next-service';
      time.insertAdjacentElement('afterend', line);
    }
    if (line.textContent !== text) line.textContent = text;
  }

  function sync(){
    ensureStyle();
    syncRow('AM');
    syncRow('PM');
  }

  let queued = false;
  function scheduleSync(){
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
    });
  }

  function observe(target){
    if (!target) return;
    new MutationObserver(scheduleSync).observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function boot(){
    sync();
    observe(document.getElementById('homeFavSlot'));
    observe(document.getElementById('favTrainsWidget'));
    window.addEventListener('hashchange', scheduleSync);
    window.addEventListener('pageshow', scheduleSync);
    setTimeout(sync, 250);
    setTimeout(sync, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
