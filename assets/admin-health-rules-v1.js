'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { overview:null, selectedNumber:'', anomaliesOnly:false };
  const SOURCE_NAMES = { canonical:'CANONIQUE', sncf:'SNCF', gtfs:'GTFS', hafas:'CFL/HAFAS', sncfRt:'SNCF GTFS-RT', cflRt:'CFL/HAFAS', cflArrivals:'CFL Arrivées', traffic:'SIRI SX', compositions:'Compositions' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const srcName = (v) => SOURCE_NAMES[String(v || '')] || String(v || '—').replaceAll('_',' ');
  const age = (sec) => {
    if (sec == null || !Number.isFinite(Number(sec))) return '—';
    const n = Math.max(0, Math.round(Number(sec)));
    if (n < 60) return `${n}s`;
    if (n < 3600) return `${Math.floor(n/60)}m ${n%60}s`;
    return `${Math.floor(n/3600)}h ${Math.floor((n%3600)/60)}m`;
  };
  const when = (iso) => iso ? new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
  const statusDot = (ok, warn=false) => `<span class="dot ${ok ? (warn?'warn':'ok') : 'bad'}"></span>`;
  const orderHtml = (items) => (items || []).map((s,i) => `${i ? '<span class="arrow">→</span>' : ''}<span class="source-pill">${esc(srcName(s))}</span>`).join('');
  const card = (label,value,sub='',klass='') => `<article class="health-card ${klass}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></article>`;

  async function getJson(url) {
    const res = await fetch(url,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`),{status:res.status,data});
    return data;
  }

  function deny(message) {
    $('gate').className = 'gate denied';
    $('gate').textContent = message;
    $('app').hidden = true;
    $('footer').hidden = true;
  }

  function renderHealth(data) {
    const sources = data.snapshot?.sources || [];
    const sourcesOk = sources.filter(s => s.ok && !s.stale).length;
    const map = data.services?.map || {};
    const quota = data.services?.sncfProxy?.quota;
    const snapWarn = !!data.snapshot?.stale || Number(data.snapshot?.ageSec || 0) > 180;
    $('healthGrid').innerHTML = [
      card('Snapshot canonique',data.snapshot?.stale ? 'PÉRIMÉ' : 'OK',`âge ${age(data.snapshot?.ageSec)} · build ${data.snapshot?.buildMs || 0} ms`,snapWarn?'warn':'ok'),
      card('Moteur carte',map.ok ? 'OK' : 'ERREUR',map.ok ? `${map.ms} ms · ${map.data?.trips ?? '?'} trips` : `HTTP ${map.http || '—'}`,map.ok?'ok':'bad'),
      card('Sources',`${sourcesOk}/${sources.length} OK`,sources.some(s=>s.stale||!s.ok) ? 'au moins une source à surveiller' : 'toutes fraîches',sourcesOk===sources.length?'ok':'warn'),
      card('Quota SNCF',quota ? `${quota.percent}%` : 'N/D',quota ? `${quota.used}/${quota.cap} · reste ${quota.remaining}` : 'proxy indisponible',quota && quota.percent < 80 ? 'ok' : 'warn')
    ].join('');
    $('lastUpdate').textContent = `Snapshot ${when(data.snapshot?.updatedAt)} · âge ${age(data.snapshot?.ageSec)}`;

    $('sourceBody').innerHTML = sources.map(s => {
      const ok = s.ok && !s.stale;
      return `<tr><td><strong>${esc(srcName(s.name))}</strong><span class="source-sub">${esc(s.target || '')}</span></td><td><span class="status">${statusDot(ok,s.stale)} ${ok?'OK':(s.stale?'PÉRIMÉ':'ERREUR')}</span></td><td>${age(s.ageSec)}</td><td>${age(s.ttlSec)}</td><td>${esc(s.readMs)} ms</td><td>${esc(when(s.observedAt))}</td></tr>`;
    }).join('');
  }

  function renderRules(data) {
    $('ruleFr').innerHTML = orderHtml(data.rules?.fr);
    $('ruleLu').innerHTML = orderHtml(data.rules?.lu);
    $('ruleFrBoard').innerHTML = `Tableau gare FR : ${orderHtml(data.rules?.stationBoardFR)}`;
    $('ruleLuBoard').innerHTML = `Tableau gare LU : ${orderHtml(data.rules?.stationBoardLU)}`;
    $('ruleNotes').innerHTML = (data.rules?.notes || []).map(n => `<div>${esc(n)}</div>`).join('');
    $('fingerprint').textContent = `empreinte règles ${data.mapRuleFingerprint || '—'}`;
  }

  function renderFleet(data) {
    const f = data.fleetStats || {};
    $('fleetGrid').innerHTML = [
      card('Trains actifs',data.meta?.trainCount ?? data.trains?.length ?? 0,`${data.meta?.delayedCount || 0} retardés`),
      card('Arrêts analysés',f.stops || 0,`${f.fr || 0} FR · ${f.lu || 0} LU`),
      card('Fallback officiel',f.fallbackOfficial || 0,'source secondaire mais officielle',f.fallbackOfficial ? 'warn' : 'ok'),
      card('Temps réel périmé',f.staleRealtime || 0,'fresh=false',f.staleRealtime ? 'bad' : 'ok'),
      card('Temps réel inconnu',f.unknownRealtime || 0,'aucune donnée RT connue',f.unknownRealtime ? 'warn' : 'ok'),
      card('Territoires inconnus',data.meta?.unknownTerritoryStopCount || 0,data.meta?.territoryPolicy || '',data.meta?.unknownTerritoryStopCount ? 'warn' : 'ok')
    ].join('');
  }

  function fillTrains(data) {
    const select = $('trainSelect');
    const current = state.selectedNumber || select.value;
    select.innerHTML = '<option value="">Choisir un train actif…</option>' + (data.trains || []).map(t => `<option value="${esc(t.number)}">${esc(t.number)} · ${esc(t.origin)} → ${esc(t.destination)} · ${esc(t.status)}</option>`).join('');
    if (current && (data.trains || []).some(t => t.number === current)) select.value = current;
  }

  function stopIsAnomaly(s) {
    return !s.realtimeKnown || s.fresh === false || !s.expectedAuthority || String(s.quality || '') !== 'realtime';
  }

  function renderTrain(data) {
    const t = data.selectedTrain;
    if (!t) {
      $('trainHeader').textContent = state.selectedNumber ? `Train ${state.selectedNumber} introuvable dans le snapshot actif.` : 'Choisissez un train.';
      $('stopsBody').innerHTML = '';
      return;
    }
    $('trainHeader').innerHTML = `<strong>${esc(t.number)}</strong><span>${esc(t.origin)} → ${esc(t.destination)}</span><span>${esc(t.status)}${t.delayMinutes ? ` · +${esc(t.delayMinutes)} min` : ''}</span><span>${esc(t.stopCount)} arrêts</span><span>RT ${t.realtimePresence ? (t.realtimePresenceFresh===false?'présent mais périmé':'présent'):'absent'}</span>`;
    let stops = t.stops || [];
    if (state.anomaliesOnly) stops = stops.filter(stopIsAnomaly);
    $('stopsBody').innerHTML = stops.map(s => {
      const anomaly = stopIsAnomaly(s);
      const cls = s.fresh === false || !s.realtimeKnown ? 'bad-row' : (anomaly ? 'fallback-row' : '');
      const q = s.fresh === false ? 'stale' : String(s.quality || 'inconnue');
      const freshTxt = s.fresh === false ? 'PÉRIMÉ' : (s.fresh === true ? `${when(s.observedAt)}` : '—');
      return `<tr class="${cls}"><td><strong>${esc(s.name)}</strong></td><td><span class="zone ${esc(s.ruleZone)}">${esc(s.ruleZone)}</span><span class="source-sub">${esc(s.network || '')}</span></td><td>${orderHtml(s.ruleOrder)}<span class="source-sub">${esc(s.ruleReason)}</span></td><td><strong>${esc(s.expectedAuthority || '—')}</strong><span class="source-sub">snapshot: ${esc(s.realtimeAuthority || '—')}</span></td><td><span class="source-main">${esc(srcName(s.delaySource))}</span><span class="source-sub">famille ${esc(s.delaySourceFamily || '—')} · autorité ${esc(s.delayAuthority || '—')}</span></td><td><span class="quality ${esc(q)}">${esc(q)}</span></td><td>${s.cancelled ? 'SUPPR.' : `+${esc(s.delayMinutes || 0)} min`}</td><td class="${s.fresh===false?'old':'fresh'}">${esc(freshTxt)}</td><td>${esc(s.platform || '—')}<span class="source-sub">${esc(srcName(s.platformSource))}</span></td></tr>`;
    }).join('') || `<tr><td colspan="9" class="muted">${state.anomaliesOnly ? 'Aucun repli / inconnu sur ce train.' : 'Aucun arrêt à afficher.'}</td></tr>`;
  }

  async function loadTrain(number) {
    const clean = String(number || '').trim();
    if (!clean) { state.selectedNumber=''; renderTrain({selectedTrain:null}); return; }
    state.selectedNumber = clean;
    $('trainSearch').value = clean;
    const data = await getJson(`/api/admin/health-rules?train=${encodeURIComponent(clean)}`);
    renderTrain(data);
    if ($('trainSelect').querySelector(`option[value="${CSS.escape(clean)}"]`)) $('trainSelect').value = clean;
    history.replaceState(null,'',`?train=${encodeURIComponent(clean)}`);
  }

  async function loadOverview({keepTrain=true}={}) {
    const data = await getJson('/api/admin/health-rules');
    state.overview = data;
    renderHealth(data); renderRules(data); renderFleet(data); fillTrains(data);
    if (keepTrain && state.selectedNumber) await loadTrain(state.selectedNumber);
  }

  async function init() {
    try {
      const me = await getJson('/api/me');
      if (me?.user?.role !== 'admin') return deny('Accès refusé : ce tableau est réservé au compte administrateur.');
      $('gate').className = 'gate ok'; $('app').hidden = false; $('footer').hidden = false;
      const initial = new URLSearchParams(location.search).get('train') || '';
      state.selectedNumber = initial;
      await loadOverview({keepTrain:false});
      if (initial) await loadTrain(initial);
    } catch (error) {
      if (error.status === 401 || error.status === 403) deny('Connectez-vous avec le compte administrateur La Bétaillère pour ouvrir ce tableau.');
      else deny(`Diagnostic indisponible : ${error.message}`);
    }
  }

  $('refreshBtn').addEventListener('click', () => loadOverview().catch(e => deny(`Actualisation impossible : ${e.message}`)));
  $('trainSelect').addEventListener('change', e => loadTrain(e.target.value).catch(console.error));
  $('trainSearch').addEventListener('keydown', e => { if (e.key === 'Enter') loadTrain(e.target.value).catch(console.error); });
  $('anomaliesOnly').addEventListener('change', e => { state.anomaliesOnly=!!e.target.checked; if(state.selectedNumber) loadTrain(state.selectedNumber).catch(console.error); });
  setInterval(() => { if (!document.hidden && !document.getElementById('app').hidden) loadOverview().catch(()=>{}); }, 30000);
  init();
})();
