'use strict';

(() => {
  const BTN_ATTR = 'data-lb-comment-delete';
  let observer = null;
  let busy = false;
  let decorating = false;

  const normalizeId = (value) => String(value ?? '').trim().replace(/^uid:/i, '');

  function isModerator() {
    return String(window.currentUser?.role || '').trim().toLowerCase() === 'admin';
  }

  function currentUserId() {
    return normalizeId(window.currentUser?.id || window.currentUser?.user_id || '');
  }

  function canDelete(item) {
    if (!item?.id || window.lbIsAuthed !== true) return false;
    if (isModerator()) return true;
    const me = currentUserId();
    if (!me) return false;
    const owner = normalizeId(item.accountId || item.account_id || item.userId || item.user_id || '');
    return !!owner && owner === me;
  }

  function visibleWallItems() {
    const source = Array.isArray(window.lbCommentState?.wall) ? window.lbCommentState.wall : [];
    return source.filter((item) => {
      const trainKey = typeof window.wallNormalizeKey === 'function'
        ? window.wallNormalizeKey(item?.trainNumber || (typeof window.detectWallTrainNumber === 'function' ? window.detectWallTrainNumber(item) : ''))
        : '';
      if (!trainKey) return true;
      return typeof window.shouldHideWallCommentByAutomod === 'function'
        ? !window.shouldHideWallCommentByAutomod(item, trainKey)
        : true;
    });
  }

  function setButtonLabels(button) {
    const mod = isModerator();
    button.setAttribute('aria-label', mod ? 'Supprimer ce message (modération)' : 'Supprimer mon message');
    button.setAttribute('title', mod ? 'Supprimer (modérateur)' : 'Supprimer mon message');
  }

  function makeDeleteControl(item) {
    const wrap = document.createElement('span');
    wrap.className = 'fav-comments-row';

    const button = document.createElement('span');
    button.className = 'fav-comment-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute(BTN_ATTR, String(item.id));
    setButtonLabels(button);
    button.textContent = '❌';

    wrap.appendChild(button);
    return wrap;
  }

  function decorateFeed(feed) {
    if (!feed || decorating) return;
    decorating = true;
    try {
      const items = visibleWallItems();
      const rows = Array.from(feed.querySelectorAll('.live-wall-item--home'));

      rows.forEach((row, index) => {
        row.querySelectorAll(`[${BTN_ATTR}], [data-comment-delete]`).forEach((node) => {
          const wrap = node.closest('.fav-comments-row');
          if (wrap) wrap.remove();
          else node.remove();
        });

        const item = items[index];
        row.removeAttribute('data-lb-comment-id');
        if (!item || !canDelete(item)) return;

        row.dataset.lbCommentId = String(item.id);
        const target = row.querySelector('.lb-chat-row-message') || row.querySelector('.live-wall-item-text') || row;
        target.appendChild(makeDeleteControl(item));
      });
    } finally {
      decorating = false;
    }
  }

  function decorateAll() {
    decorateFeed(document.getElementById('homeLiveWallFeed'));
    const full = document.getElementById('lbVoiceChatFullFeed');
    if (full) decorateFeed(full);
  }

  async function deleteMessage(id, button) {
    if (busy || !id) return;
    busy = true;
    if (button) button.setAttribute('aria-disabled', 'true');
    try {
      const response = await fetch(`https://vps.labetaillere.fr/api/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      if (typeof window.loadMessages === 'function') await window.loadMessages();
      setTimeout(decorateAll, 0);
    } catch (error) {
      alert(error?.message || 'Impossible de supprimer ce message.');
      if (button) button.removeAttribute('aria-disabled');
    } finally {
      busy = false;
    }
  }

  function requestDelete(button) {
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    if (!confirm('Supprimer ce message ?')) return;
    deleteMessage(button.getAttribute(BTN_ATTR), button);
  }

  function bindDelete() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.(`[${BTN_ATTR}]`);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestDelete(button);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const button = event.target.closest?.(`[${BTN_ATTR}]`);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      requestDelete(button);
    }, true);
  }

  function watch() {
    const feed = document.getElementById('homeLiveWallFeed');
    if (!feed) return false;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (decorating) return;
      setTimeout(decorateAll, 0);
    });
    observer.observe(feed, { childList: true, subtree: true });
    return true;
  }

  function init() {
    bindDelete();
    decorateAll();
    if (!watch()) setTimeout(watch, 700);
    [250, 800, 1800, 4000].forEach((delay) => setTimeout(decorateAll, delay));
    document.addEventListener('lb:prefs-updated', decorateAll);
    window.addEventListener('focus', decorateAll, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
