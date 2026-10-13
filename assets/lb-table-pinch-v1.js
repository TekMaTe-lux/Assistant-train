/* LB_PINCH_TABLE_V1 — two-finger zoom on mobile timetable only. */
(() => {
  'use strict';
  if (window.__lbPinchTableV1) return;
  window.__lbPinchTableV1 = true;
  const mobile = () => matchMedia('(max-width: 768px) and (pointer: coarse)').matches;
  const clamp = value => Math.min(1.4, Math.max(1, value));
  let active = null;
  let currentZoom = 1;
  try {
    const saved = Number(sessionStorage.getItem('lb-table-pinch-zoom-v1'));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 1.4) currentZoom = saved;
  } catch (_) {}
  let boundScroll = null;
  let pinch = null;
  let frame = 0;
  let pending = null;

  function setZoom(root, scroller, zoom, centerX) {
    const old = currentZoom;
    const z = clamp(zoom);
    if (Math.abs(old - z) < 0.001) return;
    const rect = scroller.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, centerX - rect.left));
    const stickyOld = 128 * old;
    const stickyNew = 128 * z;
    const contentX = (scroller.scrollLeft + x - stickyOld) / old;
    currentZoom = z;
    root.style.setProperty('--lb-pinch-zoom', z.toFixed(3));
    // Keep the same content point under the user's fingers as the cells reflow.
    scroller.scrollLeft = Math.max(0, contentX * z - x + stickyNew);
  }
  function scheduleZoom(root, scroller, z, x) {
    pending = [root, scroller, z, x];
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const args = pending; pending = null;
      if (args) setZoom(...args);
    });
  }
  const distance = touches => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
  const midpoint = touches => (touches[0].clientX + touches[1].clientX) / 2;

  function attach() {
    if (!mobile()) return;
    const root = document.querySelector('#trainInfo');
    const scroller = root?.querySelector('.table-scroll');
    if (!root || !scroller || scroller === boundScroll) return;
    active = root;
    boundScroll = scroller;
    root.classList.add('lb-pinch-enabled');
    root.style.setProperty('--lb-pinch-zoom', currentZoom.toFixed(3));
    scroller.addEventListener('touchstart', event => {
      if (event.touches.length !== 2) return;
      pinch = { distance: Math.max(1, distance(event.touches)), zoom: currentZoom };
    }, { passive: true });
    scroller.addEventListener('touchmove', event => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const nextZoom = pinch.zoom * distance(event.touches) / pinch.distance;
      scheduleZoom(root, scroller, nextZoom, midpoint(event.touches));
    }, { passive: false });
    const finish = event => {
      if (!pinch || event.touches.length >= 2) return;
      pinch = null;
      if (frame && pending) {
        cancelAnimationFrame(frame); frame = 0;
        const args = pending; pending = null;
        setZoom(...args);
      }
      try { sessionStorage.setItem('lb-table-pinch-zoom-v1', currentZoom.toFixed(3)); } catch (_) {}
    };
    scroller.addEventListener('touchend', finish, { passive: true });
    scroller.addEventListener('touchcancel', finish, { passive: true });
  }
  attach();
  // Table DOM can be rebuilt when users select other trains or change date.
  const observer = new MutationObserver(() => {
    if (!mobile()) return;
    if (!document.contains(boundScroll)) { boundScroll = null; attach(); }
    else if (active && !active.classList.contains('lb-pinch-enabled')) attach();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) attach();
  });
})();
