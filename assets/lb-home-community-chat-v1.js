'use strict';

(() => {
  const ROOT_ID = 'lbVoiceChatFullscreen';
  const EXPAND_ID = 'lbVoiceChatExpandBtn';
  const PHOTO_UPLOAD_ENABLED = false;
  let feedObserver = null;
  let lastFocus = null;

  const $ = (id) => document.getElementById(id);
  const homeFeed = () => $('homeLiveWallFeed');

  function escapeText(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function enhanceCollapsedRows() {
    const feed = homeFeed();
    if (!feed) return;

    feed.querySelectorAll('.live-wall-item--home').forEach((item) => {
      if (item.dataset.lbChatRow === '1') return;
      const source = item.querySelector('.live-wall-item-text');
      if (!source) return;

      const pseudoStrong = source.querySelector(':scope > strong');
      const timeNode = source.querySelector(':scope > .live-wall-inline-meta');
      const copy = source.cloneNode(true);
      copy.querySelector(':scope > strong')?.remove();
      copy.querySelector(':scope > .live-wall-inline-meta')?.remove();
      const messageHtml = copy.innerHTML.replace(/^\s*:\s*/, '').trim();
      const pseudoHtml = pseudoStrong?.innerHTML || '<span>Bétail</span>';
      const timeText = timeNode?.textContent?.trim() || '';

      item.dataset.lbChatRow = '1';
      item.innerHTML = `
        <span class="lb-chat-avatar-slot" aria-hidden="true"></span>
        <div class="lb-chat-row-body">
          <div class="lb-chat-row-meta">
            <strong>${pseudoHtml}</strong>
            <span class="lb-chat-row-time">${escapeText(timeText)}</span>
          </div>
          <div class="lb-chat-row-message">${messageHtml}</div>
        </div>`;
    });
  }

  function getIdentityText() {
    return String($('lbHomeCommunityBadge')?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function ensureExpandButton() {
    const actions = document.querySelector('#home .live-wall-card--home .live-wall-head-actions');
    const faq = $('faqBtn');
    if (!actions || !faq) return null;

    let button = $(EXPAND_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = EXPAND_ID;
      button.type = 'button';
      button.className = 'lb-voice-chat-expand';
      button.setAttribute('aria-label', 'Ouvrir La Voix du Bétail en plein écran');
      button.setAttribute('title', 'Ouvrir en plein écran');
      button.innerHTML = '<span aria-hidden="true">⛶</span><span class="lb-voice-chat-expand__label">Plein écran</span>';
      button.addEventListener('click', openFullscreen);
    }
    if (button.parentElement !== actions) actions.appendChild(button);
    return button;
  }

  function ensureFullscreen() {
    let root = $(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'lb-voice-chat-fullscreen';
    root.setAttribute('aria-hidden', 'true');
    root.dataset.photoEnabled = PHOTO_UPLOAD_ENABLED ? '1' : '0';
    root.innerHTML = `
      <section class="lb-voice-chat-fullscreen__panel" role="dialog" aria-modal="true" aria-labelledby="lbVoiceChatFullTitle">
        <header class="lb-voice-chat-fullscreen__head">
          <button type="button" class="lb-voice-chat-back" data-lb-voice-close aria-label="Fermer et revenir à l'accueil">‹ <span>Retour</span></button>
          <div class="lb-voice-chat-fullscreen__heading">
            <h2 id="lbVoiceChatFullTitle">La Voix du Bétail</h2>
            <div id="lbVoiceChatFullIdentity" class="lb-voice-chat-fullscreen__identity"></div>
          </div>
          <div class="lb-voice-chat-fullscreen__head-actions">
            <button type="button" class="lb-voice-chat-full-faq" data-lb-voice-faq>FAQ</button>
            <span class="lb-voice-chat-live-state"><i aria-hidden="true"></i>LIVE</span>
          </div>
        </header>
        <div id="lbVoiceChatFullFeed" class="lb-voice-chat-fullscreen__feed" aria-live="polite"></div>
        <div id="lbVoiceChatFullCta" class="lb-voice-chat-fullscreen__cta" hidden></div>
        <form id="lbVoiceChatFullForm" class="lb-voice-chat-fullscreen__composer" autocomplete="off">
          <button type="button" class="lb-voice-chat-photo" data-lb-photo-future hidden disabled aria-label="Ajouter une photo, bientôt disponible">📷</button>
          <input id="lbVoiceChatPhotoInput" type="file" accept="image/*" hidden disabled>
          <input id="lbVoiceChatFullInput" type="text" maxlength="180" placeholder="Partager une info rapide…">
          <button type="submit" class="lb-voice-chat-send">Envoyer</button>
        </form>
      </section>`;
    document.body.appendChild(root);

    root.querySelector('[data-lb-voice-close]')?.addEventListener('click', closeFullscreen);
    root.querySelector('[data-lb-voice-faq]')?.addEventListener('click', () => $('faqBtn')?.click());
    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) closeFullscreen();
    });
    root.querySelector('#lbVoiceChatFullForm')?.addEventListener('submit', submitFullscreenMessage);
    root.querySelector('#lbVoiceChatFullFeed')?.addEventListener('click', handleFullFeedClick);
    return root;
  }

  function syncFullscreen() {
    const root = $(ROOT_ID);
    if (!root) return;
    const fullFeed = $('lbVoiceChatFullFeed');
    const feed = homeFeed();
    if (fullFeed && feed) {
      fullFeed.innerHTML = feed.innerHTML;
      fullFeed.querySelectorAll('.lb-chat-avatar-slot').forEach((node) => node.setAttribute('aria-hidden', 'true'));
    }

    const identity = $('lbVoiceChatFullIdentity');
    if (identity) identity.textContent = getIdentityText();

    const canComment = window.lbIsAuthed === true;
    const input = $('lbVoiceChatFullInput');
    const send = root.querySelector('.lb-voice-chat-send');
    const cta = $('lbVoiceChatFullCta');
    if (input) {
      input.disabled = !canComment;
      input.placeholder = canComment ? 'Partager une info rapide…' : 'Connectez-vous pour commenter';
    }
    if (send) send.disabled = !canComment;
    if (cta) {
      cta.hidden = canComment;
      cta.textContent = canComment ? '' : 'Connectez-vous pour participer à La Voix du Bétail.';
    }
  }

  async function submitFullscreenMessage(event) {
    event.preventDefault();
    const input = $('lbVoiceChatFullInput');
    const submit = event.currentTarget?.querySelector('.lb-voice-chat-send');
    const value = String(input?.value || '').trim();
    if (!value) return;
    if (typeof window.sendMessage !== 'function') {
      alert('La messagerie est momentanément indisponible.');
      return;
    }
    try {
      if (submit) submit.disabled = true;
      await window.sendMessage(value);
      if (input) input.value = '';
      setTimeout(() => {
        enhanceCollapsedRows();
        syncFullscreen();
      }, 0);
    } catch (error) {
      alert(error?.message || "Impossible d'envoyer le message.");
    } finally {
      if (submit) submit.disabled = window.lbIsAuthed !== true;
    }
  }

  async function handleFullFeedClick(event) {
    const deleteButton = event.target.closest('[data-comment-delete]');
    if (!deleteButton || typeof window.deleteComment !== 'function') return;
    event.preventDefault();
    try {
      await window.deleteComment(deleteButton.getAttribute('data-comment-delete'));
      setTimeout(() => {
        enhanceCollapsedRows();
        syncFullscreen();
      }, 0);
    } catch (error) {
      alert(error?.message || 'Impossible de supprimer le commentaire.');
    }
  }

  function openFullscreen() {
    const root = ensureFullscreen();
    lastFocus = document.activeElement;
    enhanceCollapsedRows();
    syncFullscreen();
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lb-voice-chat-open');
    requestAnimationFrame(() => $('lbVoiceChatFullInput')?.focus({ preventScroll: true }));
  }

  function closeFullscreen() {
    const root = $(ROOT_ID);
    if (!root) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-voice-chat-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }

  function watchFeed() {
    const feed = homeFeed();
    if (!feed) return false;
    feedObserver?.disconnect();
    feedObserver = new MutationObserver(() => {
      queueMicrotask(() => {
        enhanceCollapsedRows();
        if ($(ROOT_ID)?.classList.contains('is-open')) syncFullscreen();
      });
    });
    feedObserver.observe(feed, { childList: true, subtree: true });
    return true;
  }

  function init() {
    ensureExpandButton();
    ensureFullscreen();
    enhanceCollapsedRows();
    if (!watchFeed()) setTimeout(watchFeed, 800);
    [300, 1000, 2500, 6000].forEach((delay) => setTimeout(() => {
      ensureExpandButton();
      enhanceCollapsedRows();
      syncFullscreen();
    }, delay));

    document.addEventListener('lb:prefs-updated', syncFullscreen);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $(ROOT_ID)?.classList.contains('is-open')) closeFullscreen();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
