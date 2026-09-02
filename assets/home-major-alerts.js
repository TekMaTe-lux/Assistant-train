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

  const CANONICAL_SNAPSHOT_URL = 'https://vps.labetaillere.fr/map-v2/v4-preview/data/snapshot.json';
  const CANONICAL_REFRESH_MS = 15000;
  let canonicalSnapshot = null;
  let canonicalLoadedAt = 0;
  let canonicalPending = null;

  const normalizeTrainNumber = (value) => String(value || '').trim().replace(/^0+(?=\d)/, '');
  const normalizeStation = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const shortTime = (value) => {
    const match = String(value || '').match(/^(\d{1,3}):(\d{2})/);
    if (!match) return '';
    return `${String(Number(match[1]) % 24).padStart(2, '0')}:${match[2]}`;
  };

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

  const canonicalTrainByNumber = (number, serviceDate = '', includeCompleted = true) => {
    const wanted = normalizeTrainNumber(number);
    if (!wanted || !Array.isArray(canonicalSnapshot?.trains)) return null;
    const wantedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(serviceDate || ''))
      ? String(serviceDate)
      : '';
    const sameTrain = (train) => {
      if (normalizeTrainNumber(train?.number) !== wanted) return false;
      return !wantedDate || !train?.serviceDate || train.serviceDate === wantedDate;
    };

    const current = canonicalSnapshot.trains.find(sameTrain);
    if (current || !includeCompleted) return current || null;

    const completed = Array.isArray(canonicalSnapshot?.completedTrains)
      ? canonicalSnapshot.completedTrains
      : [];
    return completed.find(sameTrain) || null;
  };

  const canonicalCurrentTrainByNumber = (number) => canonicalTrainByNumber(number, '', false);

  const canonicalStopByName = (train, name) => {
    const wanted = normalizeStation(name);
    if (!wanted || !Array.isArray(train?.stops)) return null;
    return train.stops.find((stop) => normalizeStation(stop?.name) === wanted) || null;
  };

  const refreshCanonicalSnapshot = (force = false) => {
    const now = Date.now();
    if (!force && canonicalSnapshot && (now - canonicalLoadedAt) < CANONICAL_REFRESH_MS) {
      return Promise.resolve(canonicalSnapshot);
    }
    if (canonicalPending) return canonicalPending;

    const separator = CANONICAL_SNAPSHOT_URL.includes('?') ? '&' : '?';
    canonicalPending = fetch(`${CANONICAL_SNAPSHOT_URL}${separator}t=${now}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit'
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Data Engine V4 HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.schemaVersion !== '4.1-canonical' || !Array.isArray(payload?.trains)) {
          throw new Error('Snapshot canonique invalide');
        }
        canonicalSnapshot = payload;
        canonicalLoadedAt = Date.now();
        return payload;
      })
      .catch(() => canonicalSnapshot)
      .finally(() => { canonicalPending = null; });

    return canonicalPending;
  };

  // Exposé pour les migrations progressives des autres vues.
  window.lbCanonicalV4 = {
    refresh: refreshCanonicalSnapshot,
    get snapshot(){ return canonicalSnapshot; },
    getTrain: canonicalTrainByNumber,
    getCurrentTrain: canonicalCurrentTrainByNumber
  };

  const canonicalDestinationDelay = (trainNumber, destination) => {
    const canonicalTrain = canonicalCurrentTrainByNumber(trainNumber);
    if (!canonicalTrain?.realtimePresence || canonicalTrain?.realtimePresenceFresh === false) return null;
    const stop = canonicalStopByName(canonicalTrain, destination || canonicalTrain?.destination?.name);
    if (!stop || stop.cancelled || !stop.realtimeKnown || stop?.delay?.fresh === false) return null;
    const delay = Number(stop.delayMinutes);
    return Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : null;
  };

  const destinationDelayForTrain = (train) => {
    if (!train) return null;

    // Première autorité : état canonique par arrêt (SNCF en FR, CFL/HAFAS au LU).
    // On le consulte même si l'ancien rendu LIVE pensait le train à l'heure : c'est
    // précisément ce qui permet à un retard territorial CFL d'être visible au terminus LU.
    const canonicalDelay = canonicalDestinationDelay(train.trainNumber, train.to);
    if (Number.isFinite(canonicalDelay)) return canonicalDelay;

    // Fallback de compatibilité : ancien flux LIVE SNCF/GTFS, seulement quand V4
    // ne connaît pas la valeur. Les suppressions restent gérées par le moteur natif.
    if (train.statusClass !== 'delay') return null;
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

  const syncLiveStatusFromCanonical = (root = document) => {
    root.querySelectorAll?.('.lb-live-card[data-lb-live-train]').forEach((card) => {
      const number = normalizeTrainNumber(card.getAttribute('data-lb-live-train'));
      const train = canonicalCurrentTrainByNumber(number);
      if (!train?.realtimePresence || train?.realtimePresenceFresh === false) return;

      // Le classement SNCF des suppressions reste prioritaire. V4 harmonise ici
      // uniquement le couple à-l'heure / retard afin de respecter la frontière.
      if (
        card.classList.contains('lb-live-card--cancel')
        || card.classList.contains('lb-live-card--partial')
        || train.status === 'cancelled'
        || train.status === 'partial'
      ) return;

      const status = card.querySelector('.lb-live-status');
      if (!status) return;
      const delay = Math.max(0, Math.round(Number(train.delayMinutes) || 0));

      if (train.status === 'delay' && delay > 0) {
        card.classList.remove('lb-live-card--ok');
        card.classList.add('lb-live-card--delay');
        status.classList.remove('lb-live-status--ok');
        status.classList.add('lb-live-status--delay');
        status.textContent = `+${delay} min`;
        status.title = 'Statut harmonisé par l’autorité temps réel de chaque gare';
      } else if (train.status === 'on-time') {
        card.classList.remove('lb-live-card--delay');
        card.classList.add('lb-live-card--ok');
        status.classList.remove('lb-live-status--delay');
        status.classList.add('lb-live-status--ok');
        status.textContent = 'À L’HEURE';
        status.title = 'Statut harmonisé par l’autorité temps réel de chaque gare';
      }
    });
  };

  // LIVE reste strictement défini par extractLiveTrains() : V4 n'ajoute jamais de carte.
  // Il harmonise le statut et le retard de destination des cartes déjà présentes.
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
        route.dataset.lbPlannedRoute = currentPlain;
      }

      const trainNumber = normalizeTrainNumber(card.getAttribute('data-lb-live-train'));
      const train = byNumber.get(trainNumber);
      const canonicalTrain = canonicalCurrentTrainByNumber(trainNumber);
      const delay = destinationDelayForTrain(train);
      const plannedRoute = String(route.dataset.lbPlannedRoute || currentPlain).trim();

      const restorePlanned = () => {
        if (route.querySelector('.lb-live-realtime-arrival') && plannedRoute) {
          route.textContent = plannedRoute;
          route.removeAttribute('title');
        }
        delete route.dataset.lbDelayMinutes;
      };

      if (
        !train
        || train.statusClass === 'cancel'
        || train.statusClass === 'partial'
        || canonicalTrain?.status === 'cancelled'
        || canonicalTrain?.status === 'partial'
        || !Number.isFinite(delay)
        || delay <= 0
      ) {
        restorePlanned();
        return;
      }

      const match = plannedRoute.match(/^(.*?)(\d{1,2}:\d{2})\s*$/);
      if (!match) return;
      const prefix = match[1];
      const plannedArrival = match[2];
      const canonicalStop = canonicalStopByName(canonicalTrain, train.to);
      const exactRealtime = shortTime(canonicalStop?.arrival?.realtime || canonicalStop?.departure?.realtime);
      const realtimeArrival = exactRealtime || addMinutesToHhmm(plannedArrival, delay);
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
      route.title = `Arrivée prévue ${plannedArrival} · temps réel officiel ${realtimeArrival}`;
    });
  };

  const selectedTrainServiceDate = () => {
    const value = String(
      document.getElementById('selectionDate')?.value
      || document.getElementById('trainDate')?.value
      || ''
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  };

  const syncTrainDetailFromCanonical = () => {
    const panel = document.getElementById('trainDetailPanel');
    const host = document.getElementById('trainDetailStops');
    if (!panel || !host || panel.hidden || panel.getAttribute('aria-hidden') === 'true') return;

    // La fiche CFL ouverte depuis la gare dynamique garde son moteur dédié actuel.
    if (String(panel.dataset.lbProvider || '').toLowerCase() === 'cfl') return;

    const title = String(document.getElementById('trainDetailTitle')?.textContent || '');
    const match = title.match(/\b(\d{3,6})\b/);
    if (!match) return;
    const trainNumber = normalizeTrainNumber(match[1]);
    const train = canonicalTrainByNumber(trainNumber, selectedTrainServiceDate(), true);
    if (!train || !Array.isArray(train.stops)) return;

    const liveStatus = document.getElementById('trainDetailLiveStatus');
    if (train.lifecycle === 'completed' && liveStatus) {
      const finalDelay = Math.max(0, Math.round(Number(train.delayMinutes) || 0));
      liveStatus.className = 'lb-train-profile__status';
      liveStatus.innerHTML = `<i></i> TERMINÉ${finalDelay > 0 ? ` · +${finalDelay} MIN` : ''}`;
    }

    host.querySelectorAll('.lb-train-profile__stop').forEach((row) => {
      const name = String(row.querySelector('.lb-train-profile__stop-name strong')?.textContent || '').trim();
      if (!name) return;
      const stop = canonicalStopByName(train, name);
      if (!stop || stop.cancelled || !stop.realtimeKnown || stop.territoryKnown === false) return;

      const delay = Number(stop.delayMinutes);
      if (!Number.isFinite(delay)) return;

      const times = row.querySelector('.lb-train-profile__times');
      if (!times) return;

      let planned = String(row.dataset.lbCanonicalPlanned || '').trim();
      if (!planned) {
        planned = shortTime(times.querySelector('s, del')?.textContent)
          || shortTime(String(times.textContent || '').match(/\b\d{1,2}:\d{2}\b/)?.[0]);
        if (planned) row.dataset.lbCanonicalPlanned = planned;
      }
      if (!planned) return;

      const exactRealtime = shortTime(stop?.arrival?.realtime || stop?.departure?.realtime);
      const realtime = exactRealtime || addMinutesToHhmm(planned, delay);
      const signature = `${planned}|${delay}|${realtime}|${stop?.delay?.source || ''}|${stop?.delay?.quality || ''}|${train.lifecycle || ''}`;
      if (row.dataset.lbCanonicalSignature === signature) return;

      let badge = row.querySelector('.lb-train-profile__delay');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'lb-train-profile__delay';
        row.appendChild(badge);
      }

      if (delay > 0 && realtime && realtime !== planned) {
        const struck = document.createElement('s');
        struck.textContent = planned;
        const actual = document.createElement('b');
        actual.textContent = realtime;
        times.replaceChildren(struck, actual);
        badge.classList.remove('is-ok');
        badge.textContent = `+${Math.round(delay)} min`;
      } else {
        const actual = document.createElement('b');
        actual.textContent = planned;
        times.replaceChildren(actual);
        badge.classList.add('is-ok');
        badge.textContent = 'À L’HEURE';
      }

      row.dataset.lbCanonicalSignature = signature;
      row.dataset.lbCanonicalSource = String(stop?.delay?.source || '');
      row.title = train.lifecycle === 'completed'
        ? 'État final conservé par La Bétaillère'
        : stop?.delay?.quality === 'fallback_official'
          ? 'Temps réel harmonisé · source officielle de secours'
          : 'Temps réel harmonisé · autorité territoriale';
    });
  };

  const canonicalTableTrainNumber = (header) => normalizeTrainNumber(
    header?.dataset?.trainNumber
    || header?.querySelector?.('[data-train-number]')?.getAttribute?.('data-train-number')
    || header?.querySelector?.('.train-num, .train-link')?.textContent
    || String(header?.textContent || '').match(/\b\d{3,6}\b/)?.[0]
    || ''
  );

  const tableStationName = (row) => {
    const first = row?.querySelector?.('td:first-child');
    return String(
      first?.querySelector?.('a.gare-link')?.textContent
      || first?.querySelector?.('.gare-label')?.textContent
      || first?.textContent
      || ''
    ).trim();
  };

  const canonicalTableExactRealtime = (stop) => shortTime(
    stop?.departure?.realtime || stop?.arrival?.realtime
  );

  const canonicalTableMarkupOk = (cell, planned, realtime, delay) => {
    if (delay > 0) {
      return shortTime(cell.querySelector('.delay-strike')?.textContent) === planned
        && shortTime(cell.querySelector('.delayed')?.textContent) === realtime;
    }
    return !cell.querySelector('.delayed')
      && shortTime(cell.textContent) === planned;
  };

  const renderCanonicalTableCell = (cell, planned, realtime, delay, stop, train) => {
    const signature = [
      planned,
      realtime,
      delay,
      stop?.delay?.source || '',
      stop?.delay?.quality || '',
      train?.lifecycle || ''
    ].join('|');

    if (
      cell.dataset.lbCanonicalTableSignature === signature
      && canonicalTableMarkupOk(cell, planned, realtime, delay)
    ) return;

    // Les étiquettes de voie restent gérées par le moteur natif du tableau.
    const badge = cell.querySelector('.voie-badge')?.cloneNode(true) || null;
    const wasStrong = !!cell.querySelector('strong');

    const appendActualWithTrack = (clockNode) => {
      if (!badge) {
        cell.appendChild(clockNode);
        return;
      }
      const wrapper = document.createElement('span');
      wrapper.className = 'voie-info';
      wrapper.append(clockNode, badge);
      cell.appendChild(wrapper);
    };

    cell.replaceChildren();
    if (delay > 0 && realtime && realtime !== planned) {
      const struck = document.createElement('span');
      struck.className = 'delay-strike';
      struck.textContent = planned;
      const actual = document.createElement('span');
      actual.className = 'delayed';
      actual.textContent = realtime;
      cell.append(struck, document.createElement('br'));
      appendActualWithTrack(actual);
    } else {
      const clock = document.createElement(wasStrong ? 'strong' : 'span');
      clock.textContent = planned;
      appendActualWithTrack(clock);
    }

    cell.dataset.lbCanonicalTableSignature = signature;
    cell.dataset.lbCanonicalSource = String(stop?.delay?.source || '');
    cell.title = train?.lifecycle === 'completed'
      ? 'État final conservé par La Bétaillère'
      : stop?.delay?.quality === 'fallback_official'
        ? 'Temps réel harmonisé · source officielle de secours'
        : 'Temps réel harmonisé · autorité territoriale';
  };

  const syncTrainTableFromCanonical = () => {
    const host = document.getElementById('trainInfo');
    const table = host?.querySelector('.table-scroll table, table');
    if (!table || !canonicalSnapshot) return;

    const date = selectedTrainServiceDate();
    const headerRow = table.querySelector('thead tr:first-child');
    const headers = Array.from(headerRow?.querySelectorAll('th') || []);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (headers.length < 2 || !rows.length) return;

    rows.forEach((row) => {
      const stationName = tableStationName(row);
      if (!stationName) return;
      const cells = Array.from(row.querySelectorAll('td'));

      for (let index = 1; index < Math.min(headers.length, cells.length); index += 1) {
        const cell = cells[index];
        const number = canonicalTableTrainNumber(headers[index]);
        if (!cell || !number) continue;

        const train = canonicalTrainByNumber(number, date, true);
        if (!train || (date && train.serviceDate && train.serviceDate !== date)) continue;
        const stop = canonicalStopByName(train, stationName);
        if (
          !stop
          || stop.cancelled
          || !stop.realtimeKnown
          || stop.territoryKnown === false
          || stop?.delay?.fresh === false
        ) continue;

        // Ne jamais écraser les cellules de suppression partielle / origine ou terminus
        // exceptionnel : leur sémantique reste produite par applyEffectiveServicePattern.
        if (
          cell.querySelector('.deleted')
          || /SUPPRIM|EXCEPTIONNEL/i.test(String(cell.textContent || ''))
        ) continue;

        const planned = shortTime(cell.dataset.baseTime || cell.getAttribute('data-base-time'));
        const delay = Math.max(0, Math.round(Number(stop.delayMinutes) || 0));
        if (!planned) continue;
        const exactRealtime = canonicalTableExactRealtime(stop);
        const realtime = exactRealtime || addMinutesToHhmm(planned, delay);
        if (!realtime) continue;

        // On ne réécrit une cellule à l'heure que si le moteur natif affichait
        // effectivement un retard. Sinon on laisse son HTML intact (voie, gras, etc.).
        if (delay <= 0 && !cell.querySelector('.delayed')) {
          cell.dataset.lbCanonicalTableSignature = [
            planned, planned, 0, stop?.delay?.source || '', stop?.delay?.quality || '', train?.lifecycle || ''
          ].join('|');
          cell.dataset.lbCanonicalSource = String(stop?.delay?.source || '');
          continue;
        }

        renderCanonicalTableCell(cell, planned, realtime, delay, stop, train);
      }
    });
  };

  const installCanonicalDetailSync = () => {
    const panel = document.getElementById('trainDetailPanel');
    if (!panel || panel.dataset.lbCanonicalSync === '1') return;
    panel.dataset.lbCanonicalSync = '1';

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncTrainDetailFromCanonical();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'data-lb-provider']
    });
    schedule();
  };

  const installCanonicalTableSync = () => {
    const host = document.getElementById('trainInfo');
    if (!host || host.dataset.lbCanonicalTableSync === '1') return;
    host.dataset.lbCanonicalTableSync = '1';

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncTrainTableFromCanonical();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(host, { childList: true, subtree: true });
    ['selectionDate', 'trainDate'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', schedule);
    });
    schedule();
  };

  const installLiveCardSync = () => {
    const host = document.getElementById('lbLiveTrainCards');
    if (!host || host.dataset.lbLiveCardSync === '1') return;
    host.dataset.lbLiveCardSync = '1';

    let frame = 0;
    const sync = () => {
      frame = 0;
      syncLivePresenceButtons(host);
      syncLiveStatusFromCanonical(host);
      syncLiveDelayedArrivalTimes(host);
    };
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(host, { childList: true, subtree: true, characterData: true });

    refreshCanonicalSnapshot().then(() => {
      scheduleSync();
      syncTrainDetailFromCanonical();
      syncTrainTableFromCanonical();
    });
    window.setInterval(() => {
      refreshCanonicalSnapshot(true).then(() => {
        scheduleSync();
        syncTrainDetailFromCanonical();
        syncTrainTableFromCanonical();
      });
    }, CANONICAL_REFRESH_MS);
  };

  const install = () => {
    installLiveCardSync();
    installCanonicalDetailSync();
    installCanonicalTableSync();
    refreshCanonicalSnapshot().then(() => {
      syncLiveStatusFromCanonical(document);
      syncLiveDelayedArrivalTimes(document);
      syncTrainDetailFromCanonical();
      syncTrainTableFromCanonical();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
