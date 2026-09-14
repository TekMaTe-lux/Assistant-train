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
    feed.style.setProperty('height', px, 'important');
    feed.style.setProperty('min-height', px, 'important');
    feed.style.setProperty('max-height', px, 'important');
    feed.style.setProperty('overflow-y', 'auto', 'important');
    feed.style.setProperty('overflow-x', 'hidden', 'important');
    return true;
  }

  function watchFeed() {
    const feed = document.getElementById(FEED_ID);
    if (!feed) return false;
    observer?.disconnect();
    observer = new MutationObserver(() => queueMicrotask(applyFeedHeight));
    observer.observe(feed, { childList: true, subtree: true });
    return true;
  }

  function sync() {
    applyFeedHeight();
    watchFeed();
  }

  function init() {
    sync();
    [150, 500, 1200, 2500, 5000].forEach((delay) => setTimeout(applyFeedHeight, delay));
    window.addEventListener('resize', applyFeedHeight, { passive: true });
    window.visualViewport?.addEventListener('resize', applyFeedHeight, { passive: true });
    mobileQuery.addEventListener?.('change', applyFeedHeight);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) applyFeedHeight(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
