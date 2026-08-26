'use strict';

(function initLuxTrainSheetBridge(){
  if (window.__lbLuxTrainSheetBridgeV2) return;
  window.__lbLuxTrainSheetBridgeV2 = true;

  const VPS_ORIGIN = 'https://vps.labetaillere.fr';
  const CFL_TYPES = /^(?:RE|RB|IC|EC|ICE|L|S)$/i;
  let requestSeq = 0;

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  const text = (id, value) => {
    const node = el(id);
    if (node) node.textContent = value ?? '';
    return node;
  };

  const shortTime = (value) => {
    const m = String(value || '').match(/^(\d{1,3}):(\d{2})/);
    if (!m) return '';
    return `${String(Number(m[1]) % 24).padStart(2, '0')}:${m[2]}`;
  };

  const toMinutes = (value) => {
    const m = String(value || '').match(/^(\d{1,3}):(\d{2})/);
    return m ? (Number(m[1]) * 60 + Number(m[2])) : null;
  };

  const delayMinutes = (planned, realtime) => {
    const p = toMinutes(planned);
    const r = toMinutes(realtime);
    if (!Number.isFinite(p) || !Number.isFinite(r)) return 0;
    let diff = r - p;
    if (diff < -720) diff += 1440;
    if (diff > 720) diff -= 1440;
    return Math.max(0, Math.round(diff));
  };

  const durationMinutes = (start, end) => {
    const a = toMinutes(start);
    const b = toMinutes(end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    let diff = b - a;
    while (diff < 0) diff += 1440;
    return diff;
  };

  const dateLabel = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso || '—';
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'
      }).format(new Date(`${iso}T12:00:00`));
    } catch (_) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
  };

  const todayIso = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const stopName = (stop) => String(stop?.name || stop?.stop_name || '').trim();
  const stopId = (stop) => String(stop?.stopId || stop?.stop_id || '').trim();
  const stopArr = (stop) => String(stop?.arrival || stop?.arrival_time || '').trim();
  const stopDep = (stop) => String(stop?.departure || stop?.departure_time || '').trim();

  const isLuxStop = (stop) => {
    if (stopId(stop) === '000200405060') return true;
    const name = stopName(stop).toLowerCase();
    return name.includes('luxembourg') && (name.includes('gare') || name === 'luxembourg');
  };

  const phaseLabel = (status) => {
    switch (String(status || '').toLowerCase()) {
      case 'arrow':
      case 'approach':
      case 'enter': return 'EN APPROCHE';
      case 'dwell': return 'À QUAI';
      case 'exit': return 'EN DÉPART';
      case 'departed':
      case 'after': return 'PARTI';
      default: return 'LIVE';
    }
  };

  function openPanel(){
    const panel = el('trainDetailPanel');
    if (!panel) return null;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.setAttribute('aria-busy', 'true');
    panel.dataset.lbProvider = 'cfl';
    document.body.classList.add('lb-train-detail-open', 'lb-train-detail-from-map');
    return panel;
  }

  function resetCflPanel(payload, number, type, dateIso){
    const panel = openPanel();
    if (!panel) return null;

    text('trainDetailTitle', `${type || 'CFL'} ${number}`);
    text('trainDetailDateLabel', dateLabel(dateIso));
    text('trainDetailDeparture', '—');
    text('trainDetailArrival', '—');
    text('trainDetailOrigin', '—');
    text('trainDetailDestination', '—');
    text('trainDetailDuration', '—');
    text('trainDetailPlatform', payload?.track ? `Voie ${payload.track}` : 'Voie non communiquée');
    text('trainDetailNext', 'Résolution du parcours CFL…');
    text('trainDetailPath', 'Parcours CFL');
    text('trainDetailRouteMode', 'GTFS CFL + LIVE');
    text('trainDetailCompo', 'Non disponible');
    text('trainDetailCompoConfidence', 'CFL');
    text('trainDetailCompoMeta', 'Composition CFL non disponible pour le moment.');
    text('trainDetailReliabilitySample', 'CFL · PAS ENCORE DE STATS');
    text('trainDetailReliabilityDetails', 'Les statistiques historiques CFL ne sont pas encore disponibles.');
    text('trainDetailReliabilityRuns', '');
    text('trainDetailMessage', 'Chargement du parcours CFL…');

    const source = el('trainDetailSourceState');
    if (source) {
      source.className = 'lb-train-profile__source is-loading';
      source.innerHTML = '<i></i> LIVE CFL / HAFAS + GTFS';
    }

    const status = el('trainDetailLiveStatus');
    if (status) {
      status.className = 'lb-train-profile__status';
      status.innerHTML = '<i></i> LIVE';
    }

    const stops = el('trainDetailStops');
    if (stops) stops.innerHTML = '<div class="lb-train-profile__empty">Chargement du parcours CFL…</div>';

    const disruption = el('trainDetailDisruption');
    if (disruption) disruption.textContent = 'Aucune perturbation CFL détaillée dans cette fiche.';

    const drawing = el('trainDetailDrawing');
    if (drawing) drawing.innerHTML = '';
    const compoStats = el('trainDetailCompoStats');
    if (compoStats) compoStats.innerHTML = '';
    const reliability = el('trainDetailReliability');
    if (reliability) reliability.textContent = '—';
    const donut = el('trainDetailReliabilityDonut');
    if (donut) donut.innerHTML = '';

    return panel;
  }

  function renderCflRoute(payload, gtfs, number, type, dateIso){
    const match = gtfs?.match;
    const stops = Array.isArray(match?.stops) ? match.stops : [];
    if (!match || !stops.length) throw new Error('Parcours GTFS CFL introuvable');

    const first = stops[0] || {};
    const last = stops[stops.length - 1] || {};
    const origin = String(match.origin || stopName(first) || payload?.origin || '').trim();
    const destination = String(match.destination || stopName(last) || payload?.destination || '').trim();
    const firstPlanned = stopDep(first) || stopArr(first);
    const lastPlanned = stopArr(last) || stopDep(last);

    const mode = String(payload?.mode || '').toLowerCase() === 'arr' ? 'arr' : 'dep';
    const planned = mode === 'arr'
      ? String(payload?.plannedArrival || '')
      : String(payload?.plannedDeparture || '');
    const realtime = mode === 'arr'
      ? String(payload?.realtimeArrival || payload?.plannedArrival || '')
      : String(payload?.realtimeDeparture || payload?.plannedDeparture || '');
    const delay = delayMinutes(planned, realtime);
    const phase = phaseLabel(payload?.status);
    const track = String(payload?.track || '').trim();

    let depDisplay = shortTime(firstPlanned) || '—';
    let arrDisplay = shortTime(lastPlanned) || '—';
    if (isLuxStop(first)) depDisplay = shortTime(payload?.realtimeDeparture || payload?.plannedDeparture || firstPlanned) || depDisplay;
    if (isLuxStop(last)) arrDisplay = shortTime(payload?.realtimeArrival || payload?.plannedArrival || lastPlanned) || arrDisplay;

    text('trainDetailTitle', `${type || 'CFL'} ${number}`);
    text('trainDetailDateLabel', dateLabel(dateIso));
    text('trainDetailDeparture', depDisplay);
    text('trainDetailArrival', arrDisplay);
    text('trainDetailOrigin', origin || 'Origine');
    text('trainDetailDestination', destination || 'Destination');
    text('trainDetailPath', origin && destination ? `${origin} → ${destination}` : 'Parcours CFL');
    text('trainDetailRouteMode', 'GTFS CFL + LIVE');
    text('trainDetailPlatform', track ? `Voie ${track}` : 'Voie non communiquée');

    const duration = durationMinutes(firstPlanned, lastPlanned);
    text('trainDetailDuration', Number.isFinite(duration) ? `${duration} min` : 'GTFS CFL');
    text('trainDetailNext', `${origin} → ${destination} · ${phase.toLowerCase()}${delay > 0 ? ` · retard +${delay} min` : ''}.`);
    text('trainDetailMessage', '');

    const source = el('trainDetailSourceState');
    if (source) {
      source.className = 'lb-train-profile__source';
      source.innerHTML = '<i></i> LIVE CFL / HAFAS + GTFS';
    }

    const liveStatus = el('trainDetailLiveStatus');
    if (liveStatus) {
      liveStatus.className = 'lb-train-profile__status';
      liveStatus.innerHTML = `<i></i> ${esc(phase)}${delay > 0 ? ` · +${delay} MIN` : ''}`;
    }

    const host = el('trainDetailStops');
    if (host) {
      host.innerHTML = stops.map((stop) => {
        const name = stopName(stop) || 'Arrêt';
        const arr = shortTime(stopArr(stop));
        const dep = shortTime(stopDep(stop));
        const lux = isLuxStop(stop);
        let timeHtml = `<b>${esc(dep || arr || '—')}</b>`;
        let meta = arr && dep && arr !== dep
          ? `Arr. ${arr} · Dép. ${dep} · GTFS CFL`
          : 'GTFS CFL';
        let delayHtml = '';

        if (lux) {
          const localPlanned = shortTime(planned) || (mode === 'arr' ? arr : dep) || dep || arr || '—';
          const localRealtime = shortTime(realtime) || localPlanned;
          timeHtml = delay > 0
            ? `<s>${esc(localPlanned)}</s><b>${esc(localRealtime)}</b>`
            : `<b>${esc(localRealtime)}</b>`;
          const details = [];
          if (arr) details.push(`Arr. ${arr}`);
          if (dep) details.push(`Dép. ${dep}`);
          if (track) details.push(`Voie ${track}`);
          details.push('LIVE HAFAS');
          meta = details.join(' · ');
          delayHtml = delay > 0
            ? `<span class="lb-train-profile__delay">+${delay} min</span>`
            : '<span class="lb-train-profile__delay is-ok">À L’HEURE</span>';
        }

        return `<div class="lb-train-profile__stop${lux ? ' is-current' : ''}">
          <div class="lb-train-profile__times">${timeHtml}</div>
          <i class="lb-train-profile__dot"></i>
          <div class="lb-train-profile__stop-name"><strong>${esc(name)}</strong><span>${esc(meta)}</span></div>
          ${delayHtml}
        </div>`;
      }).join('');
    }

    const panel = el('trainDetailPanel');
    if (panel) {
      panel.setAttribute('aria-busy', 'false');
      panel.setAttribute('aria-hidden', 'false');
      panel.focus?.({ preventScroll:true });
    }
  }

  function renderCflError(error, payload, number, type, dateIso){
    const panel = openPanel();
    text('trainDetailTitle', `${type || 'CFL'} ${number}`);
    text('trainDetailDateLabel', dateLabel(dateIso));
    text('trainDetailPlatform', payload?.track ? `Voie ${payload.track}` : 'Voie non communiquée');
    text('trainDetailMessage', 'LIVE disponible, mais parcours GTFS CFL momentanément indisponible.');
    const source = el('trainDetailSourceState');
    if (source) {
      source.className = 'lb-train-profile__source is-error';
      source.innerHTML = '<i></i> LIVE CFL / HAFAS';
    }
    if (panel) panel.setAttribute('aria-busy', 'false');
    console.error('[Gare Luxembourg] fiche CFL impossible', error);
  }

  async function openCfl(payload){
    const numberMatch = String(payload?.trainNumber || '').match(/\d{3,6}/);
    if (!numberMatch) return;
    const number = numberMatch[0];
    const type = String(payload?.trainType || 'CFL').trim().toUpperCase() || 'CFL';
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.date || ''))
      ? String(payload.date)
      : (el('trainDate')?.value || todayIso());
    const mode = String(payload?.mode || '').toLowerCase() === 'arr' ? 'arr' : 'dep';
    const planned = mode === 'arr'
      ? String(payload?.plannedArrival || '')
      : String(payload?.plannedDeparture || '');
    const place = mode === 'arr'
      ? String(payload?.origin || '')
      : String(payload?.destination || '');
    const seq = ++requestSeq;

    resetCflPanel(payload, number, type, dateIso);

    try {
      if (!planned) throw new Error('Horaire planifié Luxembourg absent');
      const url = new URL(`${VPS_ORIGIN}/api/cfl-trip`);
      url.searchParams.set('date', dateIso);
      url.searchParams.set('number', number);
      url.searchParams.set('time', shortTime(planned));
      url.searchParams.set('mode', mode);
      if (place) url.searchParams.set('place', place);

      const response = await fetch(url.toString(), {
        method:'GET', cache:'no-store', credentials:'omit'
      });
      if (!response.ok) throw new Error(`GTFS CFL HTTP ${response.status}`);
      const gtfs = await response.json();
      if (!gtfs?.ok || !gtfs?.match) throw new Error('Réponse GTFS CFL invalide');
      if (seq !== requestSeq) return;
      renderCflRoute(payload, gtfs, number, type, dateIso);
    } catch (error) {
      if (seq !== requestSeq) return;
      renderCflError(error, payload, number, type, dateIso);
    }
  }

  function openSncf(payload){
    const raw = String(payload?.trainNumber || '').match(/\d{5,6}/);
    if (!raw) return;
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.date || ''))
      ? String(payload.date)
      : (el('trainDate')?.value || todayIso());
    const open = window.lbOpenTrainProfile || window.lbOpenTrainDetail;
    if (typeof open !== 'function') {
      console.warn('[Gare Luxembourg] moteur de fiche SNCF indisponible');
      return;
    }
    const panel = el('trainDetailPanel');
    if (panel) delete panel.dataset.lbProvider;
    Promise.resolve(open.call(window, raw[0], dateIso, { origin:'lux-gare' }))
      .catch((error) => console.error('[Gare Luxembourg] fiche SNCF impossible', error));
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== VPS_ORIGIN) return;
    const payload = event.data;
    if (!payload || payload.type !== 'LB_OPEN_TRAIN_SHEET') return;
    const type = String(payload.trainType || '').trim().toUpperCase();
    if (CFL_TYPES.test(type)) openCfl(payload);
    else openSncf(payload);
  });

  document.addEventListener('click', (event) => {
    const panel = el('trainDetailPanel');
    if (!panel || panel.dataset.lbProvider !== 'cfl') return;
    if (event.target.closest?.('#trainDetailStatsBtn, #trainDetailRefresh, #trainDetailFavorite')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
