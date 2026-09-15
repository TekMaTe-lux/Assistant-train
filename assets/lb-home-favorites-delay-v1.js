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


  const NEXT_SERVICE_STYLE_ID = 'lb-home-fav-next-service-style-v2';

  function ensureNextServiceStyle() {
    if (document.getElementById(NEXT_SERVICE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = NEXT_SERVICE_STYLE_ID;
    style.textContent = `
html[data-lb-v4-live="1"] body.lb-v3 #home #homeFavSlot .home-fav-time .lb-home-fav-next-service {
  display: block !important;
  width: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 3px 0 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  color: rgba(213, 242, 248, .82) !important;
  font-family: var(--lb-font-body, "Rajdhani", system-ui, sans-serif) !important;
  font-size: .72rem !important;
  font-weight: 600 !important;
  line-height: 1 !important;
  letter-spacing: .01em !important;
  text-align: center !important;
  text-overflow: ellipsis !important;
  text-shadow: none !important;
  text-transform: none !important;
  white-space: nowrap !important;
}
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  html[data-lb-v4-live="1"] body.lb-v3 #home #homeFavSlot .home-fav-time .lb-home-fav-next-service {
    margin-top: 2px !important;
    font-size: clamp(.52rem, 2.3vw, .60rem) !important;
  }

html[data-lb-v4-live="1"] body.lb-v3 #home #homeFavSlot .home-fav-row.is-cancelled .fav-state-cancelled {
  border-color: rgba(255, 102, 114, .72) !important;
  background: linear-gradient(180deg, rgba(84, 18, 28, .88), rgba(48, 10, 18, .92)) !important;
  color: #ff9aa3 !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 0 10px rgba(255,102,114,.10) !important;
}
html[data-lb-v4-live="1"] body.lb-v3 #home #homeFavSlot .home-fav-row.is-cancelled .home-fav-time {
  color: #ff9aa3 !important;
}
html[data-lb-v4-live="1"] body.lb-v3 #home #homeFavSlot .home-fav-row.is-cancelled :is(.home-fav-time-clock, .home-fav-time-planned) {
  color: #ff9aa3 !important;
  text-decoration: line-through !important;
  text-decoration-thickness: 1px !important;
  text-decoration-color: rgba(255, 154, 163, .72) !important;
}`;
    document.head.append(style);
  }

  function todayServiceLabel() {
    try {
      const label = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        day: 'numeric',
        month: 'short'
      }).format(new Date()).replace(/\.$/, '');
      return `Aujourd’hui · ${label}`;
    } catch (_) {
      return 'Aujourd’hui';
    }
  }

  function readNextService(card) {
    const key = clean(card?.getAttribute('data-fav-k')).toUpperCase();
    if (!key) return '';

    const meta = document.getElementById(`favMeta${key}`);
    const explicit = clean(q('.fav-next-service', meta)?.textContent);
    if (explicit) return explicit;

    const sourceState = clean(document.getElementById(`favState${key}`)?.textContent).toUpperCase();
    if (
      !sourceState.includes('PROCHAIN') &&
      (sourceState.includes('A VENIR') || sourceState.includes('AVENIR'))
    ) {
      return todayServiceLabel();
    }
    return '';
  }

  function readCancellationInfo(card) {
    const key = clean(card?.getAttribute('data-fav-k')).toUpperCase();
    if (!key) return null;

    const sourceState = clean(document.getElementById(`favState${key}`)?.textContent).toUpperCase();
    const sourceCard = document.getElementById(`favCard${key}`);
    const canceled = /(?:CANCEL|SUPPR|ANNUL|NO[_ -]?SERVICE)/i.test(sourceState) ||
      !!sourceCard?.classList?.contains('is-canceled');
    if (!canceled) return null;

    const meta = document.getElementById(`favMeta${key}`);
    const rawTimes = clean(q('.fav-primary-times', meta)?.textContent);
    const times = Array.from(rawTimes.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g))
      .map((match) => `${String(match[1]).padStart(2, '0')}:${match[2]}`);

    return {
      departure: times[0] || null,
      arrival: times.length >= 2 ? times[times.length - 1] : null
    };
  }

  function improveCancellation(card) {
    const info = readCancellationInfo(card);
    if (!info) return;

    if (!card.classList.contains('is-cancelled')) card.classList.add('is-cancelled');

    const badgeHost = q('.home-fav-badge', card);
    let stateBadge = q('.fav-state-badge', badgeHost);
    if (!stateBadge && badgeHost) {
      stateBadge = document.createElement('span');
      badgeHost.append(stateBadge);
    }
    if (stateBadge) {
      if (stateBadge.className !== 'fav-state-badge fav-state-cancelled') {
        stateBadge.className = 'fav-state-badge fav-state-cancelled';
      }
      if (stateBadge.textContent !== '✕ SUPPRIMÉ') stateBadge.textContent = '✕ SUPPRIMÉ';
    }

    const host = q('.home-fav-time', card);
    if (!host || !info.departure || !info.arrival) return;
    const signature = `${info.departure}|${info.arrival}`;
    if (host.dataset.lbCancelTimes === signature) return;

    host.dataset.lbCancelTimes = signature;
    delete host.dataset.lbDelaySignature;
    host.innerHTML = `
      <span class="home-fav-time-part"><span class="home-fav-time-planned">${info.departure}</span></span>
      <span class="home-fav-time-sep">→</span>
      <span class="home-fav-time-part"><span class="home-fav-time-planned">${info.arrival}</span></span>
    `;
  }

  function improveNextService(card) {
    const host = q('.home-fav-time', card);
    if (!host) return;

    const text = readNextService(card);
    let line = q('.lb-home-fav-next-service', host);

    if (!text) {
      if (line) line.remove();
      return;
    }

    if (!line) {
      line = document.createElement('span');
      line.className = 'lb-home-fav-next-service';
      host.append(line);
    }
    if (line.textContent !== text) line.textContent = text;
  }

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
    ensureNextServiceStyle();
    improveCancellation(card);
    improveTimes(card);
    improveNextService(card);
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

    const favSource = document.getElementById('favTrainsWidget');
    if (favSource) {
      observer.observe(favSource, { childList: true, subtree: true, characterData: true });
    }
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
