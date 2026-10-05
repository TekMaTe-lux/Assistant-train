'use strict';

/*
 * La Bétaillère — réactions emoji sur La Voix du Bétail.
 * Une seule réaction par membre/commentaire, persistée par l'API.
 * Ce module est volontairement séparé des votes des signalements et de la gamification.
 */
(() => {
  if (window.__lbCommentReactionsV1) return;
  window.__lbCommentReactionsV1 = true;

  const PICKER_ID = 'lbCommentReactionPicker';
  const REACTIONS = window.LB_COMMENT_REACTION_META || {
    like:  { emoji:'👍', label:'J’aime' },
    love:  { emoji:'❤️', label:'J’adore' },
    haha:  { emoji:'😂', label:'Haha' },
    wow:   { emoji:'😮', label:'Wouah' },
    sad:   { emoji:'😢', label:'Triste' },
    angry: { emoji:'😡', label:'Grrr' }
  };

  let activeCommentId = '';
  let activeTrigger = null;
  let pending = false;

  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function findComment(commentId) {
    const id = String(commentId || '');
    const wall = Array.isArray(window.lbCommentState?.wall) ? window.lbCommentState.wall : [];
    return wall.find((item) => String(item?.id || '') === id) || null;
  }

  function getCurrentReaction(commentId, trigger = null) {
    const item = findComment(commentId);
    return String(
      item?.myReaction ||
      item?.my_reaction ||
      trigger?.getAttribute?.('data-my-reaction') ||
      ''
    ).trim().toLowerCase();
  }

  function ensurePicker() {
    let picker = document.getElementById(PICKER_ID);
    if (picker) return picker;

    picker = document.createElement('div');
    picker.id = PICKER_ID;
    picker.className = 'lb-comment-reaction-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Choisir une réaction');
    picker.innerHTML = Object.entries(REACTIONS).map(([key, meta]) =>
      '<button type="button" class="lb-comment-reaction-option" ' +
      'data-comment-reaction-option="' + esc(key) + '" ' +
      'aria-label="' + esc(meta.label) + '" title="' + esc(meta.label) + '">' +
      '<span aria-hidden="true">' + meta.emoji + '</span>' +
      '<small>' + esc(meta.label) + '</small>' +
      '</button>'
    ).join('');
    document.body.appendChild(picker);
    return picker;
  }

  function closePicker() {
    const picker = document.getElementById(PICKER_ID);
    if (!picker) return;
    picker.hidden = true;
    picker.classList.remove('is-open', 'is-busy');
    picker.querySelectorAll('.lb-comment-reaction-option').forEach((button) => {
      button.disabled = false;
      button.classList.remove('is-selected');
      button.removeAttribute('aria-pressed');
    });
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeCommentId = '';
    activeTrigger = null;
    pending = false;
  }

  function positionPicker(picker, trigger) {
    const rect = trigger.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const gap = 7;
    const margin = 8;
    const width = pickerRect.width || 250;
    const height = pickerRect.height || 46;

    let left = rect.left + (rect.width / 2) - (width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    let top = rect.top - height - gap;
    if (top < margin) top = rect.bottom + gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

    picker.style.left = Math.round(left) + 'px';
    picker.style.top = Math.round(top) + 'px';
  }

  function openPicker(commentId, trigger) {
    const id = String(commentId || '').trim();
    if (!id || !trigger) return;

    if (window.lbIsAuthed !== true) {
      closePicker();
      document.getElementById('lbBtnOpenAuth')?.click();
      return;
    }

    const picker = ensurePicker();
    const same = !picker.hidden && activeCommentId === id && activeTrigger === trigger;
    if (same) {
      closePicker();
      return;
    }

    if (activeTrigger && activeTrigger !== trigger) {
      activeTrigger.setAttribute('aria-expanded', 'false');
    }

    activeCommentId = id;
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');

    const mine = getCurrentReaction(id, trigger);
    picker.querySelectorAll('[data-comment-reaction-option]').forEach((button) => {
      const selected = button.getAttribute('data-comment-reaction-option') === mine;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    picker.hidden = false;
    picker.classList.add('is-open');
    requestAnimationFrame(() => positionPicker(picker, trigger));
  }

  function applyReactionState(commentId, data) {
    const item = findComment(commentId);
    if (item) {
      item.reactions = (data?.reactions && typeof data.reactions === 'object')
        ? { ...data.reactions }
        : (item.reactions || {});
      item.reactionTotal = Number(data?.reaction_total || 0);
      item.myReaction = String(data?.my_reaction || '').trim().toLowerCase();
    }

    try {
      if (typeof window.renderHomeLiveWall === 'function') window.renderHomeLiveWall();
      else if (typeof window.renderMessages === 'function') window.renderMessages();
    } catch (error) {
      console.warn('[réactions] rafraîchissement local', error);
    }
  }

  async function submitReaction(commentId, reaction) {
    const id = String(commentId || '').trim();
    const key = String(reaction || '').trim().toLowerCase();
    if (!id || !REACTIONS[key] || pending) return;

    if (window.lbIsAuthed !== true) {
      closePicker();
      document.getElementById('lbBtnOpenAuth')?.click();
      return;
    }
    if (typeof window.fetchCommentsApi !== 'function') return;

    const picker = ensurePicker();
    pending = true;
    picker.classList.add('is-busy');
    picker.querySelectorAll('.lb-comment-reaction-option').forEach((button) => {
      button.disabled = true;
    });

    try {
      const response = await window.fetchCommentsApi('/' + encodeURIComponent(id) + '/reaction', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ reaction:key })
      });

      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(data?.error || ('HTTP ' + response.status));

      applyReactionState(id, data || {});
      closePicker();

      // Resynchronisation silencieuse : l'API reste la source d'autorité.
      if (typeof window.loadMessages === 'function') {
        window.loadMessages().catch((error) => console.warn('[réactions] resynchronisation', error));
      }
    } catch (error) {
      pending = false;
      picker.classList.remove('is-busy');
      picker.querySelectorAll('.lb-comment-reaction-option').forEach((button) => {
        button.disabled = false;
      });
      console.error('[réactions]', error);
      window.alert?.(error?.message || 'Impossible d’enregistrer la réaction.');
    }
  }

  document.addEventListener('click', (event) => {
    const option = event.target.closest?.('[data-comment-reaction-option]');
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      if (!activeCommentId) return;
      submitReaction(activeCommentId, option.getAttribute('data-comment-reaction-option'));
      return;
    }

    const trigger = event.target.closest?.('[data-comment-react]');
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      openPicker(trigger.getAttribute('data-comment-react'), trigger);
      return;
    }

    const picker = document.getElementById(PICKER_ID);
    if (picker && !picker.hidden && !picker.contains(event.target)) closePicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePicker();
  });

  window.addEventListener('resize', closePicker, { passive:true });
  window.addEventListener('scroll', () => {
    const picker = document.getElementById(PICKER_ID);
    if (picker && !picker.hidden) closePicker();
  }, { passive:true, capture:true });
})();
