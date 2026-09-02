'use strict';

(function loadLabetaillereModules(){
  const head = document.head || document.documentElement;

  const load = (src, id) => {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    head.appendChild(script);
  };

  // Script d’alertes historique conservé à l’identique.
  load('./assets/home-major-alerts-core.js?v=20260826-1', 'lb-home-major-alert-core');

  // Pont gare dynamique Luxembourg -> fiche train #BER.
  load('./assets/lux-train-sheet.js?v=20260826-1', 'lb-lux-train-sheet');

  // Signalement LIVE : toujours proposer le parcours complet, jamais seulement l'origine/destination.
  // La logique de signalement voyageur reste séparée et n'est pas modifiée ci-dessous.
  load('./assets/signal-stations-fix.js?v=20260902-1', 'lb-signal-stations-fix');

  const normalizeTrainNumber = (value) => String(value || '').trim().replace(/^0+(?=\d)/, '');
  const normalizeStation = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const addMinutesToHhmm = (hhmm, delayMinutes) => {
    const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const delay = Math.round(Number(delayMinutes));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(delay)) return '';
    const total = ((hours * 60 + minutes + delay) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const destinationDelayForTrain = (train) => {
    if (!train || train.statusClass !== 'delay') return null;

    // Priorité au retard officiel de la gare d'arrivée dans le flux LIVE SNCF/GTFS.
    // extractLiveTrains() expose raw.stops sous la forme { "Gare": retardEnMinutes }.
    const stops = train?.raw?.stops;
    if (stops && typeof stops === 'object' && !Array.isArray(stops)) {
      const destination = normalizeStation(train.to);
      let rawDelay;
      if (Object.prototype.hasOwnProperty.call(stops, train.to)) {
        rawDelay = stops[train.to];
      } else if (destination) {
        const key = Object.keys(stops).find((name) => normalizeStation(name) === destination);
        if (key) rawDelay = stops[key];
      }
      if (rawDelay !== undefined && rawDelay !== null) {
        const delay = Number(rawDelay);
        if (Number.isFinite(delay)) return Math.max(0, Math.round(delay));
      }
    }

    // Secours uniquement si le retard par gare n'est pas présent dans le flux.
    const fallback = Number(train.maxDelay);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : null;
  };

  // Présence LIVE : on garde strictement le bouton et son handler existants.
  // Seuls le libellé et l'état accessible sont harmonisés sur PC et mobile.
  const syncLivePresenceButtons = (root = document) => {
    root.querySelectorAll?.('.lb-live-presence-btn[data-lb-presence-train]').forEach((button) => {
      const current = String(button.textContent || '').trim();
      const active = button.getAttribute('aria-pressed') === 'true'
        || /(?:^|\s)À bord\s*✓/i.test(current)
        || /✓\s*À bord/i.test(current);
      const next = active ? '✓ À bord' : 'Je suis à bord';
      if (current !== next) button.textContent = next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute(
        'aria-label',
        active ? 'Retirer ma présence de ce train' : 'Indiquer que je suis à bord de ce train'
      );
    });
  };

  // Horaire LIVE : même convention que les fiches train.
  // Exemple : Metz 08:50 → Luxembourg 09:54 09:59, avec 09:54 barré.
  // On ne touche ni au statut voyageur ni aux signalements : seuls les retards officiels
  // issus de extractLiveTrains() peuvent modifier l'affichage de l'horaire.
  const syncLiveDelayedArrivalTimes = (root = document) => {
    if (typeof window.extractLiveTrains !== 'function') return;

    let trains = [];
    try {
      trains = window.extractLiveTrains();
    } catch (_) {
      return;
    }
    const byNumber = new Map(
      (Array.isArray(trains) ? trains : []).map((train) => [normalizeTrainNumber(train?.trainNumber), train])
    );

    root.querySelectorAll?.('.lb-live-card[data-lb-live-train]').forEach((card) => {
      const route = card.querySelector('.lb-live-route[data-lb-train-route-line]');
      if (!route) return;

      const hasRealtimeMarkup = !!route.querySelector('.lb-live-realtime-arrival');
      const currentPlain = String(route.textContent || '').replace(/\s+/g, ' ').trim();
      if (!hasRealtimeMarkup && /\d{1,2}:\d{2}\s*$/.test(currentPlain)) {
        // Le moteur natif peut réhydrater la ligne après nous : on mémorise alors
        // automatiquement sa nouvelle version planifiée, sans figer une ancienne valeur.
        route.dataset.lbPlannedRoute = currentPlain;
      }

      const trainNumber = normalizeTrainNumber(card.getAttribute('data-lb-live-train'));
      const train = byNumber.get(trainNumber);
      const delay = destinationDelayForTrain(train);
      const plannedRoute = String(route.dataset.lbPlannedRoute || currentPlain).trim();

      const restorePlanned = () => {
        if (route.querySelector('.lb-live-realtime-arrival') && plannedRoute) {
          route.textContent = plannedRoute;
          route.removeAttribute('title');
        }
        delete route.dataset.lbDelayMinutes;
      };

      if (!train || train.statusClass !== 'delay' || !Number.isFinite(delay) || delay <= 0) {
        restorePlanned();
        return;
      }

      const match = plannedRoute.match(/^(.*?)(\d{1,2}:\d{2})\s*$/);
      if (!match) return;
      const prefix = match[1];
      const plannedArrival = match[2];
      const realtimeArrival = addMinutesToHhmm(plannedArrival, delay);
      if (!realtimeArrival || realtimeArrival === plannedArrival) {
        restorePlanned();
        return;
      }

      if (
        route.querySelector('.lb-live-realtime-arrival')
        && route.dataset.lbDelayMinutes === String(delay)
        && route.querySelector('.lb-live-realtime-arrival')?.textContent === realtimeArrival
      ) return;

      const planned = document.createElement('del');
      planned.className = 'lb-live-planned-arrival';
      planned.textContent = plannedArrival;
      planned.style.color = '#91a6ad';
      planned.style.opacity = '.82';
      planned.style.textDecorationThickness = '1px';

      const realtime = document.createElement('span');
      realtime.className = 'lb-live-realtime-arrival';
      realtime.textContent = realtimeArrival;
      realtime.style.marginLeft = '4px';
      realtime.style.color = 'var(--lb-live-accent, #ff9d4d)';
      realtime.style.fontWeight = '800';

      route.textContent = '';
      route.append(document.createTextNode(prefix), planned, document.createTextNode(' '), realtime);
      route.dataset.lbDelayMinutes = String(delay);
      route.title = `Arrivée prévue ${plannedArrival} · horaire SNCF ${realtimeArrival}`;
    });
  };

  const installLiveCardSync = () => {
    const host = document.getElementById('lbLiveTrainCards');
    if (!host || host.dataset.lbLiveCardSync === '1') return;
    host.dataset.lbLiveCardSync = '1';

    let frame = 0;
    const sync = () => {
      frame = 0;
      syncLivePresenceButtons(host);
      syncLiveDelayedArrivalTimes(host);
    };
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLiveCardSync, { once: true });
  } else {
    installLiveCardSync();
  }
})();