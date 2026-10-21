'use strict';

(function initLuxTrainSheetBridge(){
  if (window.__lbLuxTrainSheetBridgeV2) return;
  window.__lbLuxTrainSheetBridgeV2 = true;

  const VPS_ORIGIN = 'https://vps.labetaillere.fr';
  const CFL_TYPES = /^(?:RE|RB|IC|EC|ICE|L|S)$/i;
  let requestSeq = 0;
  let beResourcePromise = null;
  let beResource = null;
  const BE_HELPER_URL = VPS_ORIGIN + '/map-v2/lb-be-extension-helper-v1.js';
  const BE_INDEX_URL = VPS_ORIGIN + '/map-v2/data/lb-be-international-ends-v1.json';

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
    text('trainDetailReliabilitySample', 'CFL · HISTORIQUE EN CONSTRUCTION');
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
    if (disruption) {
      disruption.hidden = true;
      disruption.textContent = '';
    }
    const traffic = el('trainDetailEvents');
    if (traffic) {
      traffic.hidden = true;
      traffic.open = false;
      traffic.ontoggle = null;
      const content = traffic.querySelector('.lb-train-profile__events-body');
      if (content) content.textContent = '';
    }

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

  // Même agrégation train/date que la carte et les fiches SNCF.
  // Chargement secondaire : aucune influence sur les horaires HAFAS/CFL.
  async function loadCflTrafficEvents(number, dateIso, sequence) {
    const details = el('trainDetailEvents');
    const body = details?.querySelector('.lb-train-profile__events-body');
    if (!details || !body) return;
    const query = new URLSearchParams({ date:dateIso, number, source:'CFL', limit:'30' });
    const isCurrent = () => sequence === requestSeq &&
      el('trainDetailPanel')?.dataset.lbProvider === 'cfl';
    try {
      const response = await fetch(`${VPS_ORIGIN}/g/c7f290ab?${query}`, {
        method:'GET', cache:'no-store', credentials:'omit'
      });
      if (!response.ok) throw new Error('Flux perturbations CFL indisponible');
      const data = await response.json();
      if (!isCurrent()) return;
      if (data?.ok !== true || !Array.isArray(data.events)) throw new Error('Flux CFL invalide');
      const seen = new Set();
      const relevant = data.events.filter(event => {
        if (event?.state !== 'active' && event?.state !== 'upcoming') return false;
        if (!event?.operational && event?.state !== 'upcoming') return false;
        const sources = Array.isArray(event.sources) ? event.sources : [];
        if (!sources.some(x => ['HAFAS-CFL','SIRI-SX','GTFS-RT','API-SNCF','SNCF-API'].includes(x))) return false;
        const key = [event.title,event.text || event.detail,event.state].map(x =>
          String(x || '').toLowerCase().replace(/\\s+/g,' ').trim()).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!relevant.length) return;
      body.innerHTML = relevant.map(event => {
        const sources = event.sources || [];
        const level = event.state === 'upcoming' ? 1 :
          Math.max(1, Math.min(4, Number(event.severity) || 1));
        const title = String(event.title || '').trim();
        const detail = String(event.text || event.detail || '').trim();
        const provenance = [
          sources.includes('HAFAS-CFL') ? 'CFL' : '',
          sources.some(x => ['GTFS-RT','SIRI-SX','API-SNCF','SNCF-API'].includes(x)) ? 'SNCF' : ''
        ].filter(Boolean).join(' + ');
        return `<article class="lb-train-profile__event sev${level}">${event.state === 'upcoming' ? '<small>À VENIR</small>' : ''}${title ? `<strong>${esc(title)}</strong>` : ''}${detail ? `<p>${esc(detail)}</p>` : ''}<small>Source ${esc(provenance || 'trafic ferroviaire')}</small></article>`;
      }).join('');
      details.hidden = false;
      details.open = true;
    } catch (_) {
      // Une panne de la source perturbations ne modifie jamais l'état CFL.
      // Ne pas afficher un faux « aucune perturbation ».
    }
  }


  // Archivage CFL complémentaire : lecture différée, sans incidence sur les sources LIVE.
  const CFL_STATS_URL = 'https://vps.labetaillere.fr/gtfs/cfl-history/summary.json';
  let cflStatsCached = null;
  let cflStatsLoading = null;
  function getCflStats(){
    const now = Date.now();
    if (cflStatsCached && (now - cflStatsCached.at) < 600000) {
      return Promise.resolve(cflStatsCached.value);
    }
    if (cflStatsLoading) return cflStatsLoading;
    cflStatsLoading = fetch(CFL_STATS_URL, { cache:'no-store', credentials:'omit' })
      .then((response) => {
        if (!response.ok) throw new Error('CFL stats unavailable');
        return response.json();
      })
      .then((value) => {
        if (value?.version !== 1 || !value?.trains || !value?.source) {
          throw new Error('CFL stats invalid');
        }
        cflStatsCached = { at:Date.now(), value };
        return value;
      })
      .finally(() => { cflStatsLoading = null; });
    return cflStatsLoading;
  }

  async function loadCflStatistics(number, type, sequence){
    const isCurrent = () => sequence === requestSeq &&
      el('trainDetailPanel')?.dataset.lbProvider === 'cfl';
    try {
      const data = await getCflStats();
      if (!isCurrent()) return;
      const trains = data?.trains || {};
      const wanted = (String(type || '') + String(number || '')).replace(/\s+/g,'').toUpperCase();
      const keys = Object.keys(trains);
      let key = keys.find((name) => name.replace(/\s+/g,'').toUpperCase() === wanted);
      if (!key) {
        const matching = keys.filter((name) => {
          const match = name.match(/(\d{3,6})\s*$/);
          return match && match[1] === String(number);
        });
        if (matching.length === 1) key = matching[0];
      }
      const stats = key ? trains[key] : null;
      const days = Object.keys(data?.daily || {}).length;
      const coverage = data?.coverageStart || 'date inconnue';
      if (!stats || !stats.observedJourneys) {
        text('trainDetailReliabilitySample','CFL · HISTORIQUE EN CONSTRUCTION');
        text('trainDetailReliabilityDetails',
          'Collecte des retards CFL active depuis le ' + coverage +
          '. Pas encore assez de données pour ce train.');
        text('trainDetailReliabilityRuns',
          'Observations HAFAS, distinctes des statistiques SNCF.');
        return;
      }
      const journeys = Number(stats.observedJourneys) || 0;
      const stops = Number(stats.observedStops) || 0;
      const delayed = Number(stats.delay6OrMoreStops) || 0;
      text('trainDetailReliabilitySample',
        'CFL · ' + journeys + ' CIRCULATION' + (journeys > 1 ? 'S' : '') + ' OBSERVÉE' + (journeys > 1 ? 'S' : ''));
      const samples = stops + ' arrêt' + (stops > 1 ? 's' : '') + ' mémorisé' + (stops > 1 ? 's' : '');
      const delayText = delayed + ' avec un retard annoncé de 6 min ou plus';
      text('trainDetailReliabilityDetails',
        samples + ' · ' + delayText + '. ' +
        (journeys < 10 || days < 7 ? 'Échantillon encore trop faible pour une fiabilité représentative.' :
         'Résultats indicatifs fondés sur la dernière prévision observée par arrêt.'));
      text('trainDetailReliabilityRuns',
        'Historique depuis ' + coverage + ' · HAFAS CFL · Non officiel');
    } catch (_) {
      // Indisponibilité de l'archive : aucune modification du LIVE ni des fiches SNCF.
    }
  }


  // Optional international termini: NEVER substitute Belgian RT for CFL delays,
  // cancellations, platforms or stop rows. Loads only when a CFL detail opens.
  function loadBelgianEndResource(){
    if(beResource)return Promise.resolve(beResource);
    if(beResourcePromise)return beResourcePromise;
    const getMatcher=typeof window.lbVerifyInternationalBeEndpoint==='function'
      ? Promise.resolve()
      : new Promise((resolve,reject)=>{
          const script=document.createElement('script');
          script.src=BE_HELPER_URL;
          script.async=true;
          script.onload=resolve;
          script.onerror=()=>reject(new Error('International matcher unavailable'));
          document.head.appendChild(script);
        });
    beResourcePromise=Promise.all([
      getMatcher,
      fetch(BE_INDEX_URL,{cache:'no-cache',credentials:'omit'})
        .then(resp=>{if(!resp.ok)throw Error('International index unavailable');return resp.json();})
    ]).then(([,index])=>{
      if(typeof window.lbVerifyInternationalBeEndpoint!=='function'||
         index?.schema!=='lb-be-international-ends-v1'||!index.trains)
         throw Error('International index invalid');
      beResource=index;
      return index;
    }).finally(()=>{beResourcePromise=null;});
    return beResourcePromise;
  }

  function appendBelgianTerminus(payload,gtfs,number,type,dateIso,seq){
    void loadBelgianEndResource().then(index=>{
      if(seq!==requestSeq)return;
      const match=gtfs?.match;
      const stops=Array.isArray(match?.stops)?match.stops:[];
      const extension=window.lbVerifyInternationalBeEndpoint(
        {number,type,date:dateIso},stops,index);
      if(!extension)return;
      const first=stops[0]||{},last=stops[stops.length-1]||{};
      const origin=extension.origin?.name || String(match?.origin || stopName(first)||payload?.origin||'').trim();
      const destination=extension.destination?.name || String(match?.destination || stopName(last)||payload?.destination||'').trim();
      if(extension.origin){
        text('trainDetailOrigin',origin);
        text('trainDetailDeparture',shortTime(extension.origin.time));
      }
      if(extension.destination){
        text('trainDetailDestination',destination);
        text('trainDetailArrival',shortTime(extension.destination.time));
      }
      const start=extension.origin?.time || stopDep(first)||stopArr(first);
      const end=extension.destination?.time || stopArr(last)||stopDep(last);
      const duration=durationMinutes(start,end);
      if(Number.isFinite(duration))text('trainDetailDuration',duration+' min');
      text('trainDetailPath',origin+' → '+destination);
      const phase=phaseLabel(payload?.status).toLowerCase();
      const localPlanned=payload?.mode==='arr'?payload?.plannedArrival:payload?.plannedDeparture;
      const localRealtime=payload?.mode==='arr'?payload?.realtimeArrival:payload?.realtimeDeparture;
      const localDelay=delayMinutes(localPlanned,localRealtime);
      text('trainDetailNext',origin+' → '+destination+' · '+phase+
        (localDelay>0?' · retard +'+localDelay+' min':'')+'.');
      // Clarify that the detailed list is the original CFL section only.
      text('trainDetailRouteMode','Arrêts détaillés de '+extension.sectionFrom+' à '+extension.sectionTo);
    }).catch(()=>{/* Existing CFL train detail remains fully usable */});
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
    void loadCflTrafficEvents(number, dateIso, seq);
    void loadCflStatistics(number, type, seq);

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
      appendBelgianTerminus(payload,gtfs,number,type,dateIso,seq);
    } catch (error) {
      if (seq !== requestSeq) return;
      renderCflError(error, payload, number, type, dateIso);
    }
  }

  function openSncf(payload){
    const raw = String(payload?.trainNumber || '').match(/\d{4,6}/);
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
    Promise.resolve(open.call(window, raw[0], dateIso, { origin:'map' }))
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
