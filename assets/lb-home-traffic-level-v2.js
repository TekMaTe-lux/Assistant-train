/*
 * La Bétaillère — état du trafic accueil v2
 *
 * Le statut décrit l'état GLOBAL du tronçon, pas la présence d'une anomalie isolée.
 * Règles principales :
 * - 0/1 retard normal => fluide
 * - ralenti à partir de 2 trains impactés ET 20 % du trafic
 * - perturbé à partir de 3 trains impactés ET 30 % du trafic
 * - très perturbé à partir de 4 trains impactés ET 50 % du trafic
 * - 1 suppression (totale/partielle) => au minimum ralenti
 * - 2 suppressions (totales/partielles) => au minimum perturbé
 * - 1 retard >= 30 min => au minimum ralenti, jamais perturbé à lui seul
 */
(function () {
  'use strict';

  function stopName(value) {
    if (value && typeof value === 'object') {
      return value.name || value.stop_name || value.stopName || value.station || value.id || '';
    }
    return value || '';
  }

  function normalizeStation(value) {
    try {
      if (typeof window.normalizeStationName === 'function') {
        return window.normalizeStationName(value || '');
      }
    } catch (_) {}

    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function unwrapTrains(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const dataset = raw['sncf-nml'] || raw.sncfNml || raw;
    return dataset?.trains ||
      dataset?.raw?.trains ||
      dataset?.normalized?.trains ||
      raw?.trains ||
      raw?.normalized?.trains ||
      null;
  }

  function isFullyCanceled(status) {
    if (status.includes('PARTIAL')) return false;
    return status.includes('CANCEL') || status.includes('SUPPR') || status.includes('DELETED');
  }

  function pickTrafficLevel(stats) {
    const total = Math.max(0, Number(stats?.total || 0));
    const delayed = Math.max(0, Number(stats?.delayed || 0));
    const partial = Math.max(0, Number(stats?.partialCount || 0));
    const canceled = Math.max(0, Number(stats?.canceledCount || 0));
    const maxDelayMin = Math.max(0, Number(stats?.maxDelayMin || 0));

    if (!total) return { level: 'loading', label: 'Données indisponibles' };

    const impacted = Math.min(total, delayed + partial + canceled);
    if (!impacted) return { level: 'green', label: 'Trafic fluide' };

    const share = impacted / total;
    const cancellations = partial + canceled;

    // Très perturbé : la moitié du trafic (au moins 4 trains) est réellement impactée.
    if (impacted >= 4 && share >= 0.50) {
      return { level: 'red', label: 'Trafic très perturbé' };
    }

    // Deux suppressions suffisent à rendre la situation globalement perturbée.
    if (cancellations >= 2) {
      return { level: 'orange', label: 'Trafic perturbé' };
    }

    // Perturbé : au moins 3 trains ET au moins 30 % du trafic.
    if (impacted >= 3 && share >= 0.30) {
      return { level: 'orange', label: 'Trafic perturbé' };
    }

    // Une suppression, même isolée, reste visible sans faire passer tout le tronçon en orange.
    if (cancellations >= 1) {
      return { level: 'yellow', label: 'Trafic ralenti' };
    }

    // Un seul gros retard doit être signalé, mais il ne suffit pas à qualifier le tronçon de perturbé.
    if (maxDelayMin >= 30) {
      return { level: 'yellow', label: 'Trafic ralenti' };
    }

    // Ralenti : au moins 2 trains ET au moins 20 % du trafic.
    if (impacted >= 2 && share >= 0.20) {
      return { level: 'yellow', label: 'Trafic ralenti' };
    }

    // Cas typique : 1 train à +10 sur 13, ou 2 retards isolés sur un trafic dense.
    return { level: 'green', label: 'Trafic fluide' };
  }

  function buildTrafficSegmentStats(raw, segmentStationNames) {
    const trainsObj = unwrapTrains(raw);
    if (!trainsObj || typeof trainsObj !== 'object') {
      return {
        maxDelayMin: 0,
        delayed: 0,
        total: 0,
        partialCount: 0,
        canceledCount: 0,
        canceledStopsInSegment: 0
      };
    }

    const stationSet = new Set((segmentStationNames || []).map(normalizeStation).filter(Boolean));
    let total = 0;
    let delayed = 0;
    let maxDelayMin = 0;
    let partialCount = 0;
    let canceledCount = 0;
    let canceledStopsInSegment = 0;

    for (const train of Object.values(trainsObj)) {
      if (!train || typeof train !== 'object') continue;

      const stops = train.stops && typeof train.stops === 'object' ? train.stops : {};
      const canceledStops = Array.isArray(train.canceled_stops)
        ? train.canceled_stops
        : (Array.isArray(train.canceledStops) ? train.canceledStops : []);
      const status = String(train.status || '').toUpperCase();

      let touchesSegment = false;
      let trainMaxDelay = 0;
      let canceledHits = 0;

      for (const [name, delayValue] of Object.entries(stops)) {
        if (!stationSet.has(normalizeStation(name))) continue;
        touchesSegment = true;
        const delay = Number(delayValue);
        if (Number.isFinite(delay) && delay > trainMaxDelay) trainMaxDelay = delay;
      }

      for (const canceledStop of canceledStops) {
        if (!stationSet.has(normalizeStation(stopName(canceledStop)))) continue;
        touchesSegment = true;
        canceledHits += 1;
      }

      if (!touchesSegment) continue;
      total += 1;

      const fullCanceled = isFullyCanceled(status);
      const partialOnSegment = status.includes('PARTIAL') &&
        (canceledHits > 0 || canceledStops.length === 0);

      // Un train n'est compté que dans UN état : supprimé > partiel > retardé > à l'heure.
      if (fullCanceled) {
        canceledCount += 1;
        canceledStopsInSegment += canceledHits;
        continue;
      }

      if (partialOnSegment) {
        partialCount += 1;
        canceledStopsInSegment += canceledHits;
        continue;
      }

      if (trainMaxDelay > 0) {
        delayed += 1;
        if (trainMaxDelay > maxDelayMin) maxDelayMin = trainMaxDelay;
      }
    }

    return {
      maxDelayMin,
      delayed,
      total,
      partialCount,
      canceledCount,
      canceledStopsInSegment
    };
  }

  // Surcharge volontaire de la logique historique embarquée dans index.html.
  // Les fonctions d'affichage existantes restent intactes et utilisent ces versions au prochain refresh.
  window.__lbPickTrafficLevel = pickTrafficLevel;
  window.__lbBuildTrafficSegmentStats = buildTrafficSegmentStats;
  window.LB_HOME_TRAFFIC_LEVEL_V2 = Object.freeze({
    pickTrafficLevel,
    buildTrafficSegmentStats
  });

  function refresh() {
    try {
      if (typeof window.updateHomeTrafficStatus === 'function') {
        window.updateHomeTrafficStatus();
      }
    } catch (_) {}
  }

  if (document.readyState === 'complete') {
    setTimeout(refresh, 0);
  } else {
    window.addEventListener('load', () => setTimeout(refresh, 50), { once: true });
  }
})();
