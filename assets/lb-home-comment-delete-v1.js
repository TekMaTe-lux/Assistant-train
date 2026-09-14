'use strict';

(() => {
  const ATTR = 'data-lb-comment-delete';
  let observer = null;

  const normalizeId = (v) => String(v ?? '').trim().replace(/^uid:/i, '');
  const isModerator = () => String(window.currentUser?.role || '').trim().toLowerCase() === 'admin';
  const currentUserId = () => normalizeId(window.currentUser?.id || window.currentUser?.user_id || '');

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

  function canDelete(item) {
    if (!item?.id || window.lbIsAuthed !== true) return false;
    if (isModerator()) return true;
    const me = currentUserId();
    if (!me) return false;
    const owner = normalizeId(item.accountId || item.account_id || item.userId || item.user_id || '');
    return !!owner && owner === me;
  }

  async function apiDelete(id) {
    const urls = [
      `/api/comments/${encodeURIComponent(id)}`,
      `https://vps.labetaillere.fr/api/comments/${encodeURIComponent(id)}`
    ];
    let lastError = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
        let data = null;
        try { data = await res.json(); } catch (_) {}
        if (res.ok) return data || { ok: true };
        lastError = new Error(data?.error || `HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Suppression impossible');
  }

  async function requestDelete(control) {
    const id = control?.getAttribute(ATTR);
    if (!id || control.dataset.busy === '1') return;
    if (!window.confirm('Supprimer ce message ?')) return;
    control.dataset.busy = '1';
    control.style.opacity = '.45';
    try {
      await apiDelete(id);
      if (typeof window.loadMessages === 'function') await window.loadMessages();
      setTimeout(decorateAll, 0);
    } catch (err) {
      alert(err?.message || 'Impossible de supprimer ce message.');
      control.dataset.busy = '0';
      control.style.opacity = '';
    }
  }

  function makeControl(item) {
    const wrap = document.createElement('span');
    wrap.className = 'fav-comments-row';
    const btn = document.createElement('span');
    btn.className = 'fav-comment-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute(ATTR, String(item.id));
    btn.setAttribute('aria-label', isModerator() ? 'Supprimer ce message (modération)' : 'Supprimer mon message');
    btn.setAttribute('title', isModerator() ? 'Supprimer le commentaire' : 'Supprimer mon message');
    btn.textContent = '❌';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestDelete(btn);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      requestDelete(btn);
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function decorateFeed(feed) {
    if (!feed) return;
    const items = visibleWallItems();
    const rows = Array.from(feed.querySelectorAll('.live-wall-item--home'));
    rows.forEach((row, index) => {
      row.querySelectorAll(`[${ATTR}]`).forEach((n) => n.closest('.fav-comments-row')?.remove());
      const item = items[index];
      if (!item || !canDelete(item)) return;
      const message = row.querySelector('.lb-chat-row-message') || row.querySelector('.live-wall-item-text') || row;
      message.appendChild(document.createTextNode(' '));
      message.appendChild(makeControl(item));
    });
  }

  function decorateAll() {
    decorateFeed(document.getElementById('homeLiveWallFeed'));
    decorateFeed(document.getElementById('lbVoiceChatFullFeed'));
  }

  function init() {
    decorateAll();
    const feed = document.getElementById('homeLiveWallFeed');
    if (feed) {
      observer = new MutationObserver(() => setTimeout(decorateAll, 0));
      observer.observe(feed, { childList: true, subtree: true });
    }
    [250, 800, 1800, 4000].forEach((d) => setTimeout(decorateAll, d));
    document.addEventListener('lb:prefs-updated', decorateAll);
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('#lbVoiceChatExpandBtn')) setTimeout(decorateAll, 60);
    });
    window.addEventListener('focus', decorateAll, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
