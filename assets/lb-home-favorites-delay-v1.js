/* La Bétaillère — favoris accueil : horaires réels + retards distincts.
 * L'accueil affiche uniquement les heures utiles maintenant.
 * Les heures théoriques restent disponibles dans la fiche train.
 */
(() => {
  'use strict';
  if (window.__LB_HOME_FAV_DELAY_V1__) return;
  window.__LB_HOME_FAV_DELAY_V1__ = true;

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function clock(value) {
    const match = clean(value).match(/\b(\d{1,2}):(\d{2})\b/);
    if (!match) return null;
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  }

  function minuteOfDay(value) {
    const normalized = clock(value);
    if (!normalized) return null;
    const [hour, minute] = normalized.split(':').map(Number);
    return hour * 60 + minute;
  }

  function deltaMinutes(planned, realtime) {
    const p = minuteOfDay(planned);
    const r = minuteOfDay(realtime);
    if (p == null || r == null) return null;
    let delta = r - p;
    if (delta < -720) delta += 1440;
    if (delta > 720) delta -= 1440;
    return delta;
  }

  function delayLabel(delta) {
    if (!Number.isFinite(delta) || delta === 0) return '';
    return delta > 0 ? `+${delta} min` : `−${Math.abs(delta)} min`;
  }

  function readTimePart(part) {
    const planned = clock(q('.home-fav-time-planned', part)?.textContent);
    const realtime = clock(q('.home-fav-time-live', part)?.textContent) || planned;
    const delta = deltaMinutes(planned, realtime);
    return {
      planned,
      realtime,
      delta: Number.isFinite(delta) ? delta : 0,
      changed: !!(planned && realtime && planned !== realtime)
    };
  }

  function makeDelay(delta) {
    const label = document.createElement('span');
    label.className = `lb-home-fav-delay ${delta > 0 ? 'is-late' : 'is-early'}`;
    label.textContent = delayLabel(delta);
    return label;
  }

  function makePoint(info, side, showDelay) {
    const point = document.createElement('span');
    point.className = `lb-home-fav-time-point lb-home-fav-time-${side}`;

    const time = document.createElement('span');
    time.className = 'lb-home-fav-time-clock';
    if (info.changed) time.classList.add(info.delta >= 0 ? 'is-late' : 'is-early');
    time.textContent = info.realtime || info.planned || '—';
    point.append(time);

    if (showDelay && info.changed && info.delta !== 0) point.append(makeDelay(info.delta));

    if (info.planned && info.changed) {
      point.title = `Prévu ${info.planned} · ${delayLabel(info.delta)}`;
      point.setAttribute(
        'aria-label',
        `${side === 'departure' ? 'Départ' : 'Arrivée'} ${info.realtime}, prévu ${info.planned}, ${delayLabel(info.delta)}`
      );
    }
    return point;
  }

  function improveTimes(card) {
    const host = q('.home-fav-time', card);
    if (!host) return;

    const parts = qa('.home-fav-time-part', host);
    if (parts.length < 2) return;

    const departure = readTimePart(parts[0]);
    const arrival = readTimePart(parts[1]);
    const signature = [
      departure.planned, departure.realtime, departure.delta,
      arrival.planned, arrival.realtime, arrival.delta
    ].join('|');

    if (host.dataset.lbDelaySignature === signature && q('.lb-home-fav-times-v2', host)) return;

    const sameDelay =
      departure.changed && arrival.changed &&
      departure.delta !== 0 && departure.delta === arrival.delta;

    const row = document.createElement('span');
    row.className = 'lb-home-fav-times-v2';

    row.append(makePoint(departure, 'departure', !sameDelay));

    const middle = document.createElement('span');
    middle.className = 'lb-home-fav-time-middle';
    const arrow = document.createElement('span');
    arrow.className = 'lb-home-fav-time-arrow';
    arrow.textContent = '→';
    middle.append(arrow);
    if (sameDelay) middle.append(makeDelay(departure.delta));
    row.append(middle);

    row.append(makePoint(arrival, 'arrival', !sameDelay));

    host.dataset.lbDelaySignature = signature;
    host.replaceChildren(row);
  }

  function improveRoute(card) {
    const route = q('.home-fav-route', card);
    if (!route) return;
    if (q('.lb-home-fav-route-stop', route)) {
      route.classList.add('lb-home-fav-route-noarrow');
      return;
    }

    const raw = clean(route.textContent);
    const match = raw.match(/^(.*?)\s*(?:→|➜|›|->)\s*(.*?)$/);
    if (!match) return;
    const from = clean(match[1]);
    const to = clean(match[2]);
    if (!from || !to) return;

    const origin = document.createElement('span');
    origin.className = 'lb-home-fav-route-stop lb-home-fav-route-origin';
    origin.textContent = from;

    const destination = document.createElement('span');
    destination.className = 'lb-home-fav-route-stop lb-home-fav-route-destination';
    destination.textContent = to;

    route.classList.add('lb-home-fav-route-noarrow');
    route.setAttribute('aria-label', `${from} vers ${to}`);
    route.replaceChildren(origin, destination);
  }

  function improveCard(card) {
    improveTimes(card);
    improveRoute(card);
  }

  let scheduled = false;
  function enhanceSlot(slot) {
    if (!slot) return;
    qa('.home-fav-row', slot).forEach(improveCard);
  }

  function schedule(slot) {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceSlot(slot);
    });
  }

  function attach() {
    const slot = document.getElementById('homeFavSlot');
    if (!slot) return false;
    if (slot.dataset.lbDelayObserver === '1') {
      schedule(slot);
      return true;
    }

    slot.dataset.lbDelayObserver = '1';
    enhanceSlot(slot);
    const observer = new MutationObserver(() => schedule(slot));
    observer.observe(slot, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function start() {
    if (attach()) return;
    const waiter = new MutationObserver(() => {
      if (attach()) waiter.disconnect();
    });
    waiter.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => waiter.disconnect(), 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
