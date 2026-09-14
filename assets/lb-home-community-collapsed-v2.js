'use strict';

(() => {
  const FEED_ID = 'homeLiveWallFeed';
  const mobileQuery = window.matchMedia('(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)');
  let observer = null;

  function targetHeight() {
    if (mobileQuery.matches) {
      const vh = Math.round(window.visualViewport?.height || window.innerHeight || 0);
      return vh && vh < 760 ? 128 : 140;
    }
    return 176;
  }

  function applyFeedHeight() {
    const feed = document.getElementById(FEED_ID);
    if (!feed) return false;
    const px = `${targetHeight()}px`;
    const wanted = [
      ['height', px],
      ['min-height', px],
      ['max-height', px],
      ['overflow-y', 'auto'],
      ['overflow-x', 'hidden']
    ];
    for (const [name, value] of wanted) {
      if (feed.style.getPropertyValue(name) !== value || feed.style.getPropertyPriority(name) !== 'important') {
        feed.style.setProperty(name, value, 'important');
      }
    }
    document.documentElement.dataset.lbVoiceCollapsedV2 = '1';
    return true;
  }

  function watchFeed() {
    const feed = document.getElementById(FEED_ID);
    if (!feed) return false;
    observer?.disconnect();
    observer = new MutationObserver(() => queueMicrotask(applyFeedHeight));
    observer.observe(feed, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
    return true;
  }

  function sync() {
    applyFeedHeight();
    watchFeed();
  }

  function init() {
    sync();
    [100, 300, 700, 1500, 3000, 6000].forEach((delay) => setTimeout(applyFeedHeight, delay));
    window.addEventListener('resize', applyFeedHeight, { passive: true });
    window.visualViewport?.addEventListener('resize', applyFeedHeight, { passive: true });
    mobileQuery.addEventListener?.('change', applyFeedHeight);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) applyFeedHeight(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
