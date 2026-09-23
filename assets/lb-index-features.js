(function(){
  const $id = (id)=> document.getElementById(id);
  const safeEscape = (value)=> {
    const str = String(value == null ? '' : value);
    return str.replace(/[&<>'"]/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  };
  const normalizeKey = (value)=> String(value == null ? '' : value).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  const formatHour = (ts)=> {
    try {
      const raw = ts == null ? Date.now() : ts;
      const parsed = (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))
        ? new Date(raw.replace(' ', 'T') + 'Z')
        : new Date(raw);
      if (!Number.isFinite(parsed.getTime())) return '--:--';
      return parsed.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
    }
    catch(_){ return '--:--'; }
  };
  const COMMUNITY = {
    selectedTrain: '',
    selectedSignalType: '',
    selectedInfoTag: '',
    editingSignalId: '',
    returnToMapAfterSignal: false,
    liveDirection: 'all',
    liveTrains: [],
    signals: [],
    presences: [],
    staticInfoCache: new Map(),
    signalOptionsSignature: '',
    signalOptionsHydrationKey: '',
    signalOptionsHydrationPromise: null,
    localSignals: []
  };
  let presenceMutationInFlight = false;
  let confirmedPresenceGrace = null;

  // LIVE: base horaires publique pré-générée sur le VPS.
  // Objectif: 1 seul fetch pour tous les trains au lieu de /api/train-static train par train.
  const LB_TRAIN_STATIC_TODAY_URL = 'https://vps.labetaillere.fr/gtfs/train_static_today.json';
  let LB_TRAIN_STATIC_TODAY = {};
  let LB_TRAIN_STATIC_NEXT = {};
  let LB_TRAIN_STATIC_TODAY_DATE = '';
  let LB_TRAIN_STATIC_TODAY_PROMISE = null;

  try{
    const savedDirection = localStorage.getItem('lbLiveDirectionMode');
    if (savedDirection && ['all','lux_to_nancy','nancy_to_lux'].includes(savedDirection)){
      COMMUNITY.liveDirection = savedDirection;
    }
  }catch(_){}

  const toYmd = (date = new Date())=>{
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  };
  const toIsoDay = (date = new Date())=> `${toYmd(date).slice(0,4)}-${toYmd(date).slice(4,6)}-${toYmd(date).slice(6,8)}`;
  const formatGtfsHHMM = (raw)=>{
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '—';
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4) || '00';
    if (!hh) return '—';
    return `${hh}:${mm}`;
  };
  const addMinutesToHHMM = (hhmm, delta)=>{
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return hhmm || '—';
    const base = Number(m[1]) * 60 + Number(m[2]);
    const total = base + Number(delta || 0);
    const day = 24 * 60;
    const normalized = ((total % day) + day) % day;
    const h = String(Math.floor(normalized / 60)).padStart(2, '0');
    const mn = String(normalized % 60).padStart(2, '0');
    return `${h}:${mn}`;
  };
  const hhmmToMinutes = (hhmm)=>{
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const normalizeCorridorStop = (value)=>{
    const txt = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    if (!txt) return '';
    if (txt.includes('lux')) return 'luxembourg';
    if (txt.includes('thionville')) return 'thionville';
    if (txt.includes('metz')) return 'metz';
    if (txt.includes('nancy')) return 'nancy';
    return txt;
  };
  const corridorOrderMap = new Map([
    ['luxembourg', 0],
    ['thionville', 1],
    ['metz', 2],
    ['nancy', 3]
  ]);
  const inferTrainDirection = (train)=>{
    const from = normalizeCorridorStop(train?.from || '');
    const to = normalizeCorridorStop(train?.to || '');
    const fromRank = corridorOrderMap.get(from);
    const toRank = corridorOrderMap.get(to);
    if (!Number.isFinite(fromRank) || !Number.isFinite(toRank) || fromRank === toRank) return 'other';
    return fromRank < toRank ? 'lux_to_nancy' : 'nancy_to_lux';
  };
  const sortAndFilterLiveTrainsByDirection = (trains, direction = 'all')=>{
    const list = Array.isArray(trains) ? [...trains] : [];
    const tagged = list.map((train)=> ({ ...train, direction: inferTrainDirection(train) }));
    const filtered = direction === 'all' ? tagged : tagged.filter((train)=> train.direction === direction);
    const corridorSort = direction === 'nancy_to_lux'
      ? ['nancy','metz','thionville','luxembourg']
      : ['luxembourg','thionville','metz','nancy'];
    const sortMap = new Map(corridorSort.map((name, idx)=> [name, idx]));
    filtered.sort((a, b)=>{
      const aFrom = sortMap.get(normalizeCorridorStop(a.from));
      const bFrom = sortMap.get(normalizeCorridorStop(b.from));
      const aRank = Number.isFinite(aFrom) ? aFrom : 99;
      const bRank = Number.isFinite(bFrom) ? bFrom : 99;
      if (aRank !== bRank) return aRank - bRank;
      const aTo = sortMap.get(normalizeCorridorStop(a.to));
      const bTo = sortMap.get(normalizeCorridorStop(b.to));
      const aToRank = Number.isFinite(aTo) ? aTo : 99;
      const bToRank = Number.isFinite(bTo) ? bTo : 99;
      if (aToRank !== bToRank) return aToRank - bToRank;
      return String(a.trainNumber || '').localeCompare(String(b.trainNumber || ''), 'fr', { numeric: true });
    });
    return filtered;
  };
  const getCompoForTrain = (trainNumber)=>{
    const raw = window.compoData?.[String(trainNumber || '').trim()] || '';
    const normalized = String(raw || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (!normalized) return '';
    if (normalized === 'US') return 'US';
    if (normalized === 'US5') return 'US5';
    if (normalized.startsWith('UM3')) return 'UM3';
    if (normalized === 'UMMIXTE' || normalized === 'UMMIX') return 'UMMIXTE';
    if (normalized.startsWith('UM')) return 'UM';
    return '';
  };
  const compoVisual = (code)=>{
    if (code === 'US') return '🚆';
    if (code === 'UM') return '🚆🚆';
    if (code === 'UM3') return '🚆🚆🚆';
    if (code === 'US5') return '🚅';
    if (code === 'UMMIXTE') return '🚅🚆';
    return '🚆?';
  };
  const compoMeaningLabel = (code)=>{
    if (code === 'US') return '🐮 Composition simple (US)';
    if (code === 'UM') return '🐮🐮 Composition double (UM)';
    if (code === 'UM3') return '🐮🐮🐮 Composition triple (UM3)';
    if (code === 'US5') return '🐮 Composition US5';
    if (code === 'UMMIXTE') return '🐮🐮 Composition UM Mixte';
    return '🐮 Composition inconnue';
  };
  const COMPO_ICON_SRC = 'US3.png';
  const COMPO_ICON_US5_SRC = 'US5.png';
  const compoIconSources = (code)=>{
    if (code === 'US') return [COMPO_ICON_SRC];
    if (code === 'UM') return [COMPO_ICON_SRC, COMPO_ICON_SRC];
    if (code === 'UM3') return [COMPO_ICON_SRC, COMPO_ICON_SRC, COMPO_ICON_SRC];
    if (code === 'US5') return [COMPO_ICON_US5_SRC];
    if (code === 'UMMIXTE') return [COMPO_ICON_US5_SRC, COMPO_ICON_SRC];
    return [];
  };
  const compoVisualHtml = (code)=>{
    const sources = compoIconSources(code);
    if (!sources.length) return safeEscape(compoVisual(code));
    const imgs = sources.map((src)=> '<img class="lb-compo-icon' + (src === COMPO_ICON_US5_SRC ? ' lb-compo-icon--us5' : '') + '" src="' + src + '" alt="Rame TER" loading="eager" decoding="async" onerror="this.onerror=null;this.replaceWith(document.createTextNode(\'🚆\'));">').join('');
    return '<span class="lb-compo-inline" aria-label="' + sources.length + ' rame(s)">' + imgs + '</span>';
  };
  const buildLiveRouteLineHtml = (train, info)=>{
    const from = safeEscape(train?.from || '—');
    const to = safeEscape(train?.to || '—');
    const dep = safeEscape(info?.departure || '');
    const arr = safeEscape(info?.arrival || '');
    const hasTimes = dep && arr && dep !== '—' && arr !== '—';
    return hasTimes
      ? `${from} ${dep} → ${to} ${arr}`
      : `${from} → ${to}`;
  };
  const compoCodeFromInfoTag = (tag)=>{
    switch(String(tag || '').toLowerCase()){
      case 'composition-simple': return 'US';
      case 'composition-double': return 'UM';
      case 'composition-triple': return 'UM3';
      case 'composition-us5': return 'US5';
      case 'composition-um-mixte': return 'UMMIXTE';
      default: return '';
    }
  };
  const INFO_TAG_LABELS = {
    'composition-simple': '🚆 Composition simple',
    'composition-double': '🚆🚆 Composition double',
    'composition-triple': '🚆🚆🚆 Composition triple',
    'composition-us5': '🚅 Composition US5',
    'composition-um-mixte': '🚅🚆 Composition UM Mixte',
    'climatisation-hs': '❄️ Climatisation HS',
    'chauffage-hs': '🌡️ Chauffage HS',
    'forte-affluence': '👥 Forte affluence',
    'wc-condamne': '🚻 WC condamné',
	'prise-hs': '🔌 Prise de courant HS',
    'porte-hs': '🚪 Porte HS',
    'forces-ordre': '👮 Intervention forces de l\'ordre'
  };
  const localSignalStorageKey = ()=> `lb_local_signals_${toIsoDay()}`;
  const localPresenceStorageKey = ()=> `lb_local_presence_${toIsoDay()}`;
  const localPresenceOptInKey = ()=> `lb_presence_optin_${toIsoDay()}`;

  function isPresenceOptedInToday(){
    try { return window.localStorage.getItem(localPresenceOptInKey()) === '1'; } catch(_) { return false; }
  }

  function setPresenceOptInToday(enabled){
    try {
      if (enabled) window.localStorage.setItem(localPresenceOptInKey(), '1');
      else window.localStorage.removeItem(localPresenceOptInKey());
    } catch(_){ }
  }
  const localDeviceAccountKey = 'lb_local_account_id';
  const signalVotesStorageKey = 'lb_signal_votes_v1';

  function getLocalAccountId(){
    try{
      const existing = localStorage.getItem(localDeviceAccountKey);
      if (existing) return existing;
      const created = `device_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(localDeviceAccountKey, created);
      return created;
    }catch(_){
      return `device_fallback`;
    }
  }

  function loadLocalSignals(){
    try{
      const raw = JSON.parse(localStorage.getItem(localSignalStorageKey()) || '[]');
      COMMUNITY.localSignals = Array.isArray(raw) ? raw.map(normalizeSignalItem).filter(Boolean) : [];
    }catch(_){
      COMMUNITY.localSignals = [];
    }
  }

  function saveLocalSignal(item){
    loadLocalSignals();
    COMMUNITY.localSignals.unshift(item);
    COMMUNITY.localSignals = COMMUNITY.localSignals.slice(0, 300);
    try { localStorage.setItem(localSignalStorageKey(), JSON.stringify(COMMUNITY.localSignals)); } catch(_){}
  }

  function removeLocalSignalById(signalId){
    loadLocalSignals();
    COMMUNITY.localSignals = COMMUNITY.localSignals.filter((it)=> String(it.id) !== String(signalId));
    try { localStorage.setItem(localSignalStorageKey(), JSON.stringify(COMMUNITY.localSignals)); } catch(_){}
  }

  function loadLocalPresences(){
    try{
      const raw = JSON.parse(localStorage.getItem(localPresenceStorageKey()) || '[]');
      const list = Array.isArray(raw) ? raw : [];
      return list.map(normalizePresenceItem).filter(Boolean);
    }catch(_){
      return [];
    }
  }

  function saveLocalPresence(item){
    const current = loadLocalPresences();
    current.unshift(item);
    try { localStorage.setItem(localPresenceStorageKey(), JSON.stringify(current.slice(0, 500))); } catch(_){}
  }

  function removeLocalPresenceById(presenceId){
    const current = loadLocalPresences().filter((it)=> String(it.id) !== String(presenceId));
    try { localStorage.setItem(localPresenceStorageKey(), JSON.stringify(current)); } catch(_){}
  }

  function loadSignalVotes(){
    try{
      const raw = JSON.parse(localStorage.getItem(signalVotesStorageKey) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    }catch(_){
      return {};
    }
  }

  function saveSignalVotes(store){
    try { localStorage.setItem(signalVotesStorageKey, JSON.stringify(store || {})); } catch(_){}
  }

  function getSignalVoteSummary(signalId){
    const id = String(signalId || '');
    if (!id) return { up:0, down:0, mine:0 };
    const store = loadSignalVotes();
    const votes = store[id] && typeof store[id] === 'object' ? store[id] : {};
    let up = 0, down = 0;
    Object.values(votes).forEach((v)=>{
      if (Number(v) > 0) up += 1;
      else if (Number(v) < 0) down += 1;
    });
    const mine = Number(votes[getCurrentPresenceIdentity()] || 0);
    return { up, down, mine };
  }

  function setSignalVote(signalId, value){
    const id = String(signalId || '');
    if (!id) return;
    const val = Number(value) > 0 ? 1 : -1;
    const user = getCurrentPresenceIdentity();
    const store = loadSignalVotes();
    if (!store[id] || typeof store[id] !== 'object') store[id] = {};
    store[id][user] = (store[id][user] === val) ? 0 : val;
    if (store[id][user] === 0) delete store[id][user];
    saveSignalVotes(store);
  }

  function buildCommentDeletePath(commentId, options = {}){
    const id = String(commentId || '').trim();
    if (!id) return '';
    const params = new URLSearchParams();
    if (options.moderationConfirmed) params.set('moderation_confirmed', '1');
    return params.toString() ? `/${encodeURIComponent(id)}?${params.toString()}` : `/${encodeURIComponent(id)}`;
  }

  function detectCommentTrainNumber(item){
    if (!item) return '';
    const direct = normalizeKey(item.trainNumber || item.train_number || item.train || '');
    if (direct) return direct;
    const text = String(item.text || item.message || '');
    const match = text.match(/(?:#?TER|#?RE|#?RB|#?IC|train\s*)?\s*(\d{3,6})/i);
    return match ? normalizeKey(match[1]) : '';
  }

  function normalizeSignalItem(raw){
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = raw.created_at || raw.createdAt || raw.ts || raw.timestamp || Date.now();
    const ts = (typeof window.lbParseTimestamp === 'function') ? window.lbParseTimestamp(createdAt) : (Date.parse(createdAt) || Date.now());
    const message = String(raw.message || raw.text || '').trim().slice(0, 180);
    const parsed = message.match(/^\[(RETARD|SUPPRESSION|INFORMATION|A L'HEURE|A-L'HEURE|A LHEURE)\]\s*(?:#?([A-Z]{2,5})\s*)?(\d{3,6})?\s*(?:\[([^\]]+)\])?\s*[—\-:]?\s*(.*)$/i);
    const trainNumber = normalizeKey(raw.train_number || raw.trainNumber || (parsed && parsed[3]) || detectCommentTrainNumber(raw));
    const station = String(raw.station || (parsed && parsed[4]) || '').trim();
    const signalType = String(raw.signal_type || (parsed && parsed[1]) || '').trim().toLowerCase().replace(/\s+/g,'-');
    const detail = parsed ? String(parsed[5] || '').trim() : message;
    const delayMin = Number(raw.delay_min || raw.delayMin || 0);
    const infoTag = String(raw.info_tag || raw.infoTag || '').trim();
    const accountId = String(raw.account_id || raw.accountId || raw.user_id || '').trim();
    return {
      id: raw.id || `${ts}_${Math.random().toString(36).slice(2,8)}`,
      pseudo: String(raw.pseudo || raw.username || raw.user_pseudo || raw.display_pseudo || 'Voyageur').trim().slice(0,24),
      displayPseudo: String(raw.display_pseudo || raw.pseudo || raw.username || raw.user_pseudo || 'Voyageur').trim().slice(0,24),
      authorGrade: String(raw.author_grade || raw.grade || '').trim(),
      authorPoints: Number(raw.author_points || raw.points || 0),
      text: message,
      detail: detail || message,
      signalType,
      delayMin: Number.isFinite(delayMin) ? delayMin : 0,
      infoTag,
      accountId,
      trainNumber,
      station,
      ts,
      upvotes: Number(raw.upvotes || 0),
      downvotes: Number(raw.downvotes || 0),
      myVote: Number(raw.my_vote || raw.myVote || 0)
    };
  }

  async function loadSignals(){
    const previousSignature = JSON.stringify((COMMUNITY.signals || []).map((item)=>[item.id,item.ts,item.upvotes,item.downvotes]));
    try{
      const res = await window.fetchCommentsApi('?scope=signals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
      const today = toIsoDay();
      COMMUNITY.signals = list
        .map(normalizeSignalItem)
        .filter(Boolean)
        .filter((it)=> toIsoDay(new Date(it.ts || Date.now())) === today)
        .sort((a,b)=> Number(b.ts||0) - Number(a.ts||0))
        .slice(0, 200);
    }catch(err){
      console.warn('Impossible de charger les signalements', err);
      COMMUNITY.signals = Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : [];
    }
    refreshCommunityViews();
    const nextSignature = JSON.stringify((COMMUNITY.signals || []).map((item)=>[item.id,item.ts,item.upvotes,item.downvotes]));
    if (nextSignature !== previousSignature) window.dispatchEvent(new CustomEvent('lb:community-data-changed'));
    return COMMUNITY.signals;
  }

  function normalizePresenceItem(raw){
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = raw.created_at || raw.createdAt || raw.ts || raw.timestamp || Date.now();
    const ts = (typeof window.lbParseTimestamp === 'function') ? window.lbParseTimestamp(createdAt) : (Date.parse(createdAt) || Date.now());
    const trainNumber = normalizeKey(raw.train_number || raw.trainNumber || detectCommentTrainNumber(raw));
    if (!trainNumber) return null;
    return {
      id: raw.id || `${ts}_${Math.random().toString(36).slice(2,8)}`,
      pseudo: String(raw.pseudo || raw.username || raw.user_pseudo || raw.display_pseudo || '').trim().slice(0,24),
      displayPseudo: String(raw.display_pseudo || raw.pseudo || raw.username || raw.user_pseudo || '').trim().slice(0,24),
      authorGrade: String(raw.author_grade || raw.grade || '').trim(),
      authorPoints: Number(raw.author_points || raw.points || 0),
      accountId: String(raw.account_id || raw.accountId || raw.user_id || '').trim(),
      trainNumber,
      ts
    };
  }

  async function loadPresences(){
    const previousSignature = JSON.stringify((COMMUNITY.presences || []).map((item)=>[item.id,item.trainNumber,item.accountId,item.ts]));
    try{
      const res = await window.fetchCommentsApi(`?scope=presence&_=${Date.now()}`, { cache:'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
      let nextPresences = list.map(normalizePresenceItem).filter(Boolean).sort((a,b)=> Number(b.ts||0) - Number(a.ts||0)).slice(0, 500);
      if (confirmedPresenceGrace && confirmedPresenceGrace.expiresAt > Date.now()){
        const confirmed = confirmedPresenceGrace.item;
        const found = nextPresences.some((item)=> String(item.id) === String(confirmed.id)
          || (normalizeIdentity(item.accountId) === normalizeIdentity(confirmed.accountId)
            && normalizeKey(item.trainNumber) === normalizeKey(confirmed.trainNumber)));
        if (found) confirmedPresenceGrace = null;
        else nextPresences.unshift(confirmed);
      }else{
        confirmedPresenceGrace = null;
      }
      COMMUNITY.presences = nextPresences;
    }catch(err){
      console.warn('Impossible de charger les présences voyageurs', err);
      COMMUNITY.presences = Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : [];
    }
    refreshCommunityViews();
    const nextSignature = JSON.stringify((COMMUNITY.presences || []).map((item)=>[item.id,item.trainNumber,item.accountId,item.ts]));
    if (nextSignature !== previousSignature) window.dispatchEvent(new CustomEvent('lb:community-presence-changed'));
    return COMMUNITY.presences;
  }

  function getRawLiveTrainPayload(){
    const raw = window.retardsGTFS_RAW;
    if (raw && raw['sncf-nml']) return raw['sncf-nml'];
    return raw || null;
  }

  function collectSncfDisruptionCauses(payload){
    if (!payload || typeof payload !== 'object') return [];
    const direct = [
      payload.sncf_disruption_cause,
      payload.disruption_cause,
      payload.cause,
      payload.reason
    ]
      .map((v)=> String(v || '').trim())
      .filter(Boolean);
    const disruptions = Array.isArray(payload.disruptions) ? payload.disruptions : [];
    disruptions.forEach((d)=>{
      const c = String(d?.cause || '').trim();
      if (c) direct.push(c);
      const msg = String(d?.messages?.[0]?.text || '').trim();
      if (msg) direct.push(msg);
    });
    return Array.from(new Set(direct)).slice(0, 3);
  }

  function buildSncfCauseIndex(rawPayload){
    const map = new Map();
    if (!rawPayload || typeof rawPayload !== 'object') return map;

    const visitNode = (node, keyHint = '')=>{
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)){
        node.forEach((entry)=> visitNode(entry, keyHint));
        return;
      }

      const causes = collectSncfDisruptionCauses(node);
      const candidates = [
        node.train_number,
        node.train,
        node.number
      ].map((v)=> String(v || '').trim()).filter(Boolean);

      if (typeof keyHint === 'string' && keyHint.includes('vehicle_journey:')){
        const m = keyHint.match(/:(\d+):\d+:Train$/) || keyHint.match(/:(\d+):/);
        if (m && m[1]) candidates.push(String(m[1]).trim());
      }

      if (causes.length && candidates.length){
        candidates.forEach((n)=>{
          const key = normalizeKey(n);
          if (!key) return;
          const prev = map.get(key) || [];
          map.set(key, Array.from(new Set([...prev, ...causes])).slice(0, 3));
        });
      }

      Object.entries(node).forEach(([k, v])=>{
        if (!v || typeof v !== 'object') return;
        visitNode(v, k);
      });
    };

    Object.entries(rawPayload).forEach(([key, value])=> visitNode(value, key));
    return map;
  }

  function getSncfCauseForTrain(trainNumber, payload, causeIndex = null){
    const ownCause = collectSncfDisruptionCauses(payload);
    if (ownCause.length) return ownCause.slice(0, 2).join(' • ');
    const key = normalizeKey(trainNumber);
    if (!key) return '';
    let idx = causeIndex;
    if (!(idx instanceof Map)){
      const raw = window.retardsGTFS_RAW;
      const rawCarte = raw && raw['sncf-carte'] ? raw['sncf-carte'] : null;
      idx = buildSncfCauseIndex(rawCarte || raw);
    }
    return (idx.get(key) || []).slice(0, 2).join(' • ');
  }

  function classifyOfficialLiveDisruption({ status = '', cause = '', disruptions = [], stops = [] } = {}){
    const statusText = String(status || '').toLowerCase();
    const detailText = [cause, JSON.stringify(disruptions || [])].join(' ').toLowerCase();
    const combined = `${statusText} ${detailText}`;
    const stopRows = Array.isArray(stops) ? stops : [];
    let deletedStops = 0;
    let runningStops = 0;
    stopRows.forEach((stop)=>{
      const raw = JSON.stringify(stop || {}).toLowerCase();
      const deleted = /"(?:stop_time_effect|arrival_status|departure_status)"\s*:\s*"deleted"/.test(raw);
      if (deleted) deletedStops += 1;
      else runningStops += 1;
    });
    // Un CANCELED au niveau du voyage SNCF est autoritaire. Une autre source
    // (notamment HAFAS sur Bettembourg/Luxembourg) ne doit jamais ressusciter
    // un arrêt et transformer une suppression totale en suppression partielle.
    const explicitTripCanceled = !/partial|partiel/.test(statusText)
      && /no_service|cancell|cancel|supprim|annul|deleted|trip canceled/.test(statusText);
    const allStopsDeleted = deletedStops > 0 && runningStops === 0;
    if (explicitTripCanceled || allStopsDeleted) {
      return { statusClass:'cancel', statusLabel:'Supprimé' };
    }

    const partial = /partial|partiel|service reduit|service réduit|terminus exceptionnel|depart exceptionnel|départ exceptionnel|a partir de|à partir de|entre .{2,40} et /.test(combined)
      || (deletedStops > 0 && runningStops > 0);
    if (partial) return { statusClass:'partial', statusLabel:'Suppression partielle' };

    const canceled = !/partial|partiel/.test(combined)
      && /no_service|cancell|cancel|supprim|annul|deleted|trip canceled/.test(combined);
    if (canceled) return { statusClass:'cancel', statusLabel:'Supprimé' };
    return { statusClass:'', statusLabel:'' };
  }

  function extractLiveTrains(){
    const raw = getRawLiveTrainPayload();
	const rawAll = window.retardsGTFS_RAW;
    const rawCarte = rawAll && rawAll['sncf-carte'] ? rawAll['sncf-carte'] : null;
    const causeIndex = buildSncfCauseIndex(rawCarte || rawAll);
    const trainsObj = raw?.trains || raw?.normalized?.trains || null;
    const list = [];
    if (!trainsObj || typeof trainsObj !== 'object') return list;
    Object.entries(trainsObj).forEach(([key, payload])=>{
      if (!payload || typeof payload !== 'object') return;
      const trainNumber = normalizeKey(payload.train_number || payload.train || payload.number || key);
      if (!trainNumber) return;
      const stopsObj = (payload.stops && typeof payload.stops === 'object') ? payload.stops : null;
      const stopNames = stopsObj ? Object.keys(stopsObj).filter(Boolean) : [];
      const routeFrom = stopNames[0] || payload.from || payload.origin || '—';
      const routeTo = stopNames[stopNames.length - 1] || payload.to || payload.destination || '—';
      let maxDelay = 0;
      if (stopsObj){
        Object.values(stopsObj).forEach((value)=>{
          const n = Number(value);
          if (Number.isFinite(n) && n > maxDelay) maxDelay = n;
        });
      }
      const statusRaw = String(payload.status || '').toUpperCase();
      const sncfCause = getSncfCauseForTrain(trainNumber, payload, causeIndex);
      let statusLabel = 'À l\'heure';
      let statusClass = 'ok';
      const officialState = classifyOfficialLiveDisruption({
        status: statusRaw,
        cause: sncfCause,
        disruptions: payload.disruptions,
        stops: Array.isArray(payload.stop_times) ? payload.stop_times : []
      });
      if (officialState.statusClass){
        statusLabel = officialState.statusLabel;
        statusClass = officialState.statusClass;
      } else if (maxDelay > 0){
        statusLabel = `+${maxDelay} min`;
        statusClass = 'delay';
      }
      list.push({
        key: trainNumber,
        label: `TER ${trainNumber}`,
        trainNumber,
        route: `${routeFrom} → ${routeTo}`,
        from: routeFrom,
        to: routeTo,
        statusLabel,
        statusClass,
		sncfCause,
        maxDelay,
        stops: stopNames,
        raw: payload
      });
    });
    list.sort((a,b)=>{
      if (a.statusClass === b.statusClass) return Number(b.maxDelay||0) - Number(a.maxDelay||0) || a.trainNumber.localeCompare(b.trainNumber, 'fr');
      const rank = { delay:0, partial:1, cancel:2, ok:3 };
      return (rank[a.statusClass] ?? 9) - (rank[b.statusClass] ?? 9);
    });
    return list;
  }
  window.extractLiveTrains = extractLiveTrains;

  function isCommentFromToday(comment){
    const rawTs = comment?.ts ?? comment?.created_at ?? comment?.createdAt ?? comment?.timestamp;
    const parsedTs = (typeof window.lbParseTimestamp === 'function') ? window.lbParseTimestamp(rawTs) : Number(rawTs || 0);
    const d = new Date(parsedTs);
    if (!Number.isFinite(d.getTime())) return false;
    return toIsoDay(d) === toIsoDay();
  }

  function getWallCommentsForTrain(trainNumber, options = {}){
    const key = normalizeKey(trainNumber);
    const onlyToday = options.onlyToday !== false;
    const wall = Array.isArray(window.lbCommentState?.wall) ? window.lbCommentState.wall : [];
    return wall
      .filter((it)=> !onlyToday || isCommentFromToday(it))
      .filter((it)=>{
        const direct = normalizeKey(it?.trainNumber || it?.train_number || '');
        if (direct && direct === key) return true;
        const txt = String(it?.text || '').toLowerCase();
        return !!key && txt.includes(key);
      });
  }

  function getSignalsForTrain(trainNumber){
    const key = normalizeKey(trainNumber);
    return (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : [])
      .filter((it)=> normalizeKey(it.trainNumber) === key)
      .filter((it)=> !isSignalRejectedByVotes(it));
  }

  function getSignalScore(signal){
    const votes = getSignalVoteSummary(signal);
    return Number(votes.up || 0) - Number(votes.down || 0);
  }

  function isSignalContestedByVotes(signal){
    const score = getSignalScore(signal);
    return score <= -1 && score >= -2;
  }

  function isSignalRejectedByVotes(signal){
    return getSignalScore(signal) <= -3;
  }

  function isImportantDisruptionSignal(signal){
    const type = String(signal?.signalType || '').toLowerCase();
    if (type === 'suppression') return true;
    if (type === 'retard' && Number(signal?.delayMin || 0) >= 15) return true;
    return false;
  }

  function shouldHideLiveCommentByAutomoderation(comment, trainNumber){
    const text = String(comment?.text || '').toLowerCase();
    const mentionsSuppression = /supprim/.test(text);
    const delayMatch = text.match(/(?:retard|\+)\s*([0-9]{1,3})/i);
    const mentionsMajorDelay = !!(delayMatch && Number(delayMatch[1]) >= 15);
    if (!mentionsSuppression && !mentionsMajorDelay) return false;
    const key = normalizeKey(trainNumber);
    const rejectedImportantSignalExists = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : [])
      .filter((sig)=> normalizeKey(sig?.trainNumber) === key)
      .some((sig)=> isImportantDisruptionSignal(sig) && isSignalRejectedByVotes(sig));
    return rejectedImportantSignalExists;
  }

  function getEffectiveCompositionCode(trainNumber){
    const fromSignals = getSignalsForTrain(trainNumber)
      .filter((s)=> String(s.signalType || '').toLowerCase() === 'information')
      .sort((a,b)=> Number(b.ts || 0) - Number(a.ts || 0))
      .map((s)=> compoCodeFromInfoTag(s.infoTag))
      .find(Boolean);
    return fromSignals || getCompoForTrain(trainNumber) || '';
  }

  function getLatestTravelerDisruption(trainNumber){
    const disruptions = getSignalsForTrain(trainNumber)
      .filter((s)=> ['retard', 'suppression'].includes(String(s.signalType || '').toLowerCase()))
      .sort((a,b)=> Number(b.ts || 0) - Number(a.ts || 0));
    if (!disruptions.length) return null;
    const latest = disruptions[0];
    return {
      type: String(latest.signalType || '').toLowerCase(),
      delayMin: Number(latest.delayMin || 0),
      station: latest.station || '',
      ts: Number(latest.ts || 0)
    };
  }

  function getPresenceStatsForTrain(trainNumber){
    const key = normalizeKey(trainNumber);
    const today = toIsoDay();
    const map = new Map();
    (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : []).forEach((it)=>{
      if (normalizeKey(it.trainNumber) !== key) return;
      const day = toIsoDay(new Date(it.ts || Date.now()));
      if (day !== today) return;
      const identity = String(it.accountId || it.pseudo || it.id || '').trim().toLowerCase();
      const uniqKey = `${identity || `presence:${String(it.id || '').trim()}`}|${day}|${key}`;
      if (!map.has(uniqKey)) map.set(uniqKey, it);
    });
    return { count: map.size, today };
  }

  function getCurrentPresenceIdentity(){
    const userId = String(window.currentUser?.id || window.currentUser?.user_id || '').trim();
    if (userId) return `uid:${userId}`;
    const pseudo = String(window.currentUser?.pseudo || window.currentUser?.username || window.lbPrefsCache?.pseudo || '').trim().toLowerCase();
    if (pseudo) return `pseudo:${pseudo}`;
    return '';
  }

  function requireCommunityAuthentication(){
    if (window.lbIsAuthed === true) return true;
    document.getElementById('lbBtnOpenAuth')?.click();
    if (typeof window.lbToast === 'function') window.lbToast('Connectez-vous pour participer à la Voix du Bétail.');
    return false;
  }

  function normalizeIdentity(value){
    return String(value || '').trim().toLowerCase();
  }

  function isOwnSignal(signal){
    const current = normalizeIdentity(getCurrentPresenceIdentity());
    const byAccount = normalizeIdentity(signal?.accountId);
    if (byAccount) return byAccount === current;
    const pseudo = normalizeIdentity(window.currentUser?.pseudo || window.currentUser?.username || window.lbPrefsCache?.pseudo);
    return !!pseudo && normalizeIdentity(signal?.pseudo) === pseudo;
  }

  function getMyPresenceToday(){
    const ident = normalizeIdentity(getCurrentPresenceIdentity());
    const today = toIsoDay();
    return (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : []).find((it)=>{
      const day = toIsoDay(new Date(it.ts || Date.now()));
      const identity = normalizeIdentity(it.accountId || it.pseudo || it.id);
      return day === today && identity === ident;
    }) || null;
  }

  function getMyPresencesToday(){
    const ident = normalizeIdentity(getCurrentPresenceIdentity());
    const today = toIsoDay();
    return (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : []).filter((it)=>{
      const day = toIsoDay(new Date(it.ts || Date.now()));
      const identity = normalizeIdentity(it.accountId || it.pseudo || it.id);
      return day === today && identity === ident;
    });
  }

  function hasCurrentUserPresence(trainNumber){
    const key = normalizeKey(trainNumber);
    const mine = getMyPresenceToday();
    return !!mine && normalizeKey(mine.trainNumber) === key;
  }

  async function loadTrainStaticToday(force = false){
    const today = toYmd();
    if (!force && LB_TRAIN_STATIC_TODAY_DATE === today && LB_TRAIN_STATIC_TODAY && Object.keys(LB_TRAIN_STATIC_TODAY).length){
      return LB_TRAIN_STATIC_TODAY;
    }
    if (!force && LB_TRAIN_STATIC_TODAY_PROMISE) return LB_TRAIN_STATIC_TODAY_PROMISE;

    // Une URL stable par journée permet au navigateur de revalider le JSON au lieu
    // de retélécharger la même base à chaque ouverture de LIVE / SIGNALER.
    LB_TRAIN_STATIC_TODAY_PROMISE = fetch(`${LB_TRAIN_STATIC_TODAY_URL}?v=${today}`, { cache:'no-cache' })
      .then((res)=>{
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data)=>{
        LB_TRAIN_STATIC_TODAY = (data && typeof data === 'object' && data.trains && typeof data.trains === 'object') ? data.trains : {};
        LB_TRAIN_STATIC_NEXT = (data && typeof data === 'object' && data.next_trains && typeof data.next_trains === 'object') ? data.next_trains : {};
        LB_TRAIN_STATIC_TODAY_DATE = String(data?.date || today);
        console.log('[LIVE static today] chargé', Object.keys(LB_TRAIN_STATIC_TODAY).length, 'trains');
        return LB_TRAIN_STATIC_TODAY;
      })
      .catch((err)=>{
        console.warn('[LIVE static today] indisponible', err?.message || err);
        LB_TRAIN_STATIC_TODAY = {};
        LB_TRAIN_STATIC_NEXT = {};
        LB_TRAIN_STATIC_TODAY_DATE = '';
        return LB_TRAIN_STATIC_TODAY;
      })
      .finally(()=>{ LB_TRAIN_STATIC_TODAY_PROMISE = null; });

    return LB_TRAIN_STATIC_TODAY_PROMISE;
  }

  function getTrainStaticTodayInfo(trainNumber){
    const key = normalizeKey(trainNumber);
    if (!key || !LB_TRAIN_STATIC_TODAY || typeof LB_TRAIN_STATIC_TODAY !== 'object') return null;
    const row = LB_TRAIN_STATIC_TODAY[key];
    if (!row || typeof row !== 'object') return null;
    const origin = String(row.origin || '').trim();
    const destination = String(row.destination || '').trim();
    const departure = formatGtfsHHMM(row.departure || row.departure_time || '');
    const arrival = formatGtfsHHMM(row.arrival || row.arrival_time || '');

    // Nouveau format VPS: stopRows contient tous les arrêts.
    // Ancien format: seulement origine/destination => utilisé uniquement comme résumé.
    let stopRows = [];
    if (Array.isArray(row.stopRows)){
      stopRows = row.stopRows.map((s)=>({
        name: String(s?.name || s?.stop_name || '').trim(),
        time: formatGtfsHHMM(s?.time || s?.arrival_time || s?.departure_time || ''),
        amendedTime: formatGtfsHHMM(s?.amendedTime || s?.amended_arrival_time || s?.amended_departure_time || ''),
        delayMin: Number.isFinite(Number(s?.delayMin ?? s?.delay_minutes)) ? Number(s?.delayMin ?? s?.delay_minutes) : null
      })).filter((s)=> s.name);
    } else if (Array.isArray(row.stops)){
      stopRows = row.stops.map((s, idx)=>({
        name: String(s?.name || s?.stop_name || s || '').trim(),
        time: formatGtfsHHMM(s?.time || s?.arrival_time || s?.departure_time || (idx === 0 ? departure : (idx === row.stops.length - 1 ? arrival : ''))),
        amendedTime: formatGtfsHHMM(s?.amendedTime || s?.amended_arrival_time || s?.amended_departure_time || ''),
        delayMin: Number.isFinite(Number(s?.delayMin ?? s?.delay_minutes)) ? Number(s?.delayMin ?? s?.delay_minutes) : null
      })).filter((s)=> s.name);
    }

    const hasFullStops = stopRows.length > 2;
    const stops = hasFullStops ? stopRows.map((s)=> s.name) : [origin, destination].filter(Boolean);

    return {
      departure: departure || '—',
      arrival: arrival || '—',
      trainType: getCompoForTrain(key),
      stops,
      stopRows: hasFullStops ? stopRows : [],
      origin,
      destination,
      summaryOnly: !hasFullStops,
      source: 'train_static_today'
    };
  }

  function getTrainStaticNextPayload(trainNumber){
    const key = normalizeKey(trainNumber);
    const row = key && LB_TRAIN_STATIC_NEXT && typeof LB_TRAIN_STATIC_NEXT === 'object'
      ? LB_TRAIN_STATIC_NEXT[key]
      : null;
    if (!row || typeof row !== 'object') return null;
    const rawDate = String(row.service_date || '').replace(/\D/g, '');
    if (rawDate.length !== 8) return null;
    const serviceDate = `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`;
    const origin = String(row.origin || '').trim();
    const destination = String(row.destination || '').trim();
    if (!origin || !destination) return null;
    const departure = formatGtfsHHMM(row.departure || row.departure_time || '');
    const arrival = formatGtfsHHMM(row.arrival || row.arrival_time || '');
    const stopTimes = [
      { stop_point:{ id:'', name:origin }, departure_time:departure, base_departure_time:departure },
      { stop_point:{ id:'', name:destination }, arrival_time:arrival, base_arrival_time:arrival }
    ];
    const dateValue = new Date(`${serviceDate}T12:00:00Z`);
    const nextServiceLabel = new Intl.DateTimeFormat('fr-FR', {
      timeZone:'Europe/Luxembourg', weekday:'long', day:'numeric', month:'long'
    }).format(dateValue);
    return {
      train:{ id:key, stop_times:stopTimes },
      source:'GTFS_NEXT_SERVICE_CACHE',
      serviceDate,
      nextServiceDate:serviceDate,
      nextServiceLabel,
      disruptions:[],
      impacted:{},
      causeText:''
    };
  }

  // Pont public minimal pour le widget Favoris, défini dans un autre bloc JS.
  window.lbLoadTrainStaticToday = loadTrainStaticToday;
  window.lbGetTrainStaticNextPayload = getTrainStaticNextPayload;

  function getGtfsRtDelayForStop(trainNumber, stopName){
    const trainKey = normalizeKey(trainNumber);
    const station = String(stopName || '').trim();
    if (!trainKey || !station) return null;
    const perTrain = window.retardsGTFS && typeof window.retardsGTFS === 'object'
      ? window.retardsGTFS[trainKey]
      : null;
    if (!perTrain || typeof perTrain !== 'object') return null;
    let value = perTrain[station];
    if (value == null && typeof normalizeStationName === 'function'){
      const targetNorm = normalizeStationName(station);
      if (targetNorm){
        const normalizedLookup = perTrain[GTFS_NORMALIZED_STATION_MAP_KEY];
        if (normalizedLookup instanceof Map && normalizedLookup.has(targetNorm)){
          value = normalizedLookup.get(targetNorm);
        } else {
          for (const [knownStop, knownValue] of Object.entries(perTrain)){
            if (normalizeStationName(knownStop) === targetNorm){
              value = knownValue;
              if (normalizedLookup instanceof Map) normalizedLookup.set(targetNorm, knownValue);
              break;
            }
          }
        }
      }
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  async function getLiveTrainStaticInfo(trainNumber){
    const key = normalizeKey(trainNumber);
    const day = toYmd();
    if (!key) return null;
    const cacheKey = `${key}_${day}`;
    if (COMMUNITY.staticInfoCache.has(cacheKey)) return COMMUNITY.staticInfoCache.get(cacheKey);

    const liveTrain = (Array.isArray(COMMUNITY.liveTrains) ? COMMUNITY.liveTrains : [])
      .find((it)=> normalizeKey(it?.trainNumber) === key) || null;
    const knownStops = Array.isArray(liveTrain?.stops)
      ? liveTrain.stops.map((s)=> String(s || '').trim()).filter(Boolean)
      : [];

    const chooseBestStaticTrip = (rows)=>{
      const groups = new Map();
      (Array.isArray(rows) ? rows : []).forEach((row)=>{
        const tid = String(row?.trip_id || 'unknown');
        if (!groups.has(tid)) groups.set(tid, []);
        groups.get(tid).push(row);
      });
      const candidates = Array.from(groups.values()).map((list)=>{
        const sorted = list.slice().sort((a,b)=> Number(a?.stop_sequence || 0) - Number(b?.stop_sequence || 0));
        let score = sorted.length;
        if (knownStops.length && sorted.length === knownStops.length) score += 1000;
        if (knownStops.length && sorted.length > 1) score -= Math.abs(sorted.length - knownStops.length) * 10;
        return { score, sorted };
      }).sort((a,b)=> b.score - a.score);
      return candidates[0]?.sorted || [];
    };

    let info = null;
    let summaryInfo = null;

    // Source ultra-légère: JSON public unique déjà pré-généré sur le VPS.
    // Si ce JSON contient tous les arrêts, on l'utilise directement.
    // Si c'est l'ancien format origine/destination, on le garde pour secours mais on charge le détail au clic seulement.
    await loadTrainStaticToday();
    const todayInfo = getTrainStaticTodayInfo(key);
    if (todayInfo && !todayInfo.summaryOnly){
      info = todayInfo;
    } else if (todayInfo){
      summaryInfo = todayInfo;
    }

    // Fallback détaillé par train uniquement au clic fiche/signalement, jamais pour le rendu initial des cartes.
    // Source légère VPS : le navigateur ne télécharge plus stop_times.txt (73 Mo).
    if (!info) try {
      const url = `https://vps.labetaillere.fr/api/train-static?date=${encodeURIComponent(day)}&train=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: 'default' });
      if (res.ok) {
        const data = await res.json();
        const selected = chooseBestStaticTrip(data?.stop_times || []);
        if (selected.length) {
          const stopRows = selected.map((row, idx)=>{
            const fallbackName = knownStops[idx] || String(row?.stop_name || row?.name || row?.stop_id || '').replace(/^StopPoint:OCETrain TER-/, '').trim();
            return {
              name: String(row?.stop_name || row?.name || fallbackName || '').trim(),
              time: formatGtfsHHMM(row?.arrival_time || row?.departure_time || ''),
              amendedTime: formatGtfsHHMM(row?.amended_arrival_time || row?.amended_departure_time || ''),
              delayMin: Number.isFinite(Number(row?.delay_minutes)) ? Number(row.delay_minutes) : null
            };
          }).filter((s)=> s.name);
          info = {
            departure: formatGtfsHHMM(selected[0]?.departure_time || selected[0]?.arrival_time),
            arrival: formatGtfsHHMM(selected[selected.length - 1]?.arrival_time || selected[selected.length - 1]?.departure_time),
            trainType: getCompoForTrain(key),
            stops: stopRows.map((s)=> s.name),
            stopRows
          };
        }
      }
    } catch (err) {
      console.warn('[LIVE static] /api/train-static indisponible', err?.message || err);
    }

    // Secours legacy uniquement si explicitement autorisé à la main.
    // Ne pas utiliser au clic LIVE, sinon stop_times.txt revient dans le navigateur.
    if (!info && summaryInfo){
      info = summaryInfo;
    }

    if (!info && window.LB_ALLOW_HEAVY_GTFS === true && typeof buildGtfsFallbackResult === 'function'){
      try{
        const fallback = await buildGtfsFallbackResult(key, { ymd: day });
        const stops = fallback?.train?.stop_times || [];
        if (stops.length){
          const stopRows = stops.map((s)=>({
            name: String(s?.stop_point?.name || '').trim(),
            time: formatGtfsHHMM(s?.arrival_time || s?.departure_time || ''),
            amendedTime: formatGtfsHHMM(s?.amended_arrival_time || s?.amended_departure_time || ''),
            delayMin: Number.isFinite(Number(s?.delay_minutes)) ? Number(s.delay_minutes) : null
          })).filter((s)=> s.name);
          info = {
            departure: formatGtfsHHMM(stops[0]?.departure_time || stops[0]?.arrival_time),
            arrival: formatGtfsHHMM(stops[stops.length - 1]?.arrival_time || stops[stops.length - 1]?.departure_time),
            trainType: getCompoForTrain(key),
            stops: stopRows.map((s)=> s.name),
            stopRows
          };
        }
      }catch(_){}
    }

    if (!info){
      info = { departure:'—', arrival:'—', trainType:getCompoForTrain(key), stops:knownStops, stopRows:knownStops.map((name)=>({ name, time:'—' })) };
    }
    COMMUNITY.staticInfoCache.set(cacheKey, info);
    return info;
  }

  function formatSignalTypeLabel(type){
    switch(String(type || '').toLowerCase()){
      case 'retard': return '⏱ Retard';
      case 'suppression': return '❌ Suppression';
      case 'information': return 'ℹ️ Information';
      case 'a-lheure':
      case "a l'heure":
      case 'a-l-heure':
      case 'a-lheure':
      case 'a-lheure ': return '✅ À l\'heure';
      default: return 'ℹ️ Signalement';
    }
  }

  function signalDisplayLabel(signal){
    if (!signal) return 'Signalement';
    const base = formatSignalTypeLabel(signal.signalType);
    let label = base;
    if (signal.signalType === 'retard' && Number(signal.delayMin) > 0) label = `${base} +${signal.delayMin} min`;
    if (signal.signalType === 'information' && signal.infoTag && INFO_TAG_LABELS[signal.infoTag]) label = INFO_TAG_LABELS[signal.infoTag];
    if (isSignalContestedByVotes(signal)) label = `${label} · Signalement contesté`;
    return label;
  }

  function getSignalVoteSummary(signal){
    const up = Number(signal?.upvotes || 0);
    const down = Number(signal?.downvotes || 0);
    const mine = Number(signal?.myVote || 0);
    return { up, down, mine };
  }

  function normalizeSignalGroupText(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function signalGroupKey(signal){
    const type = String(signal?.signalType || '').toLowerCase().trim();
    const station = String(signal?.station || '').toLowerCase().trim();
    const infoTag = String(signal?.infoTag || '').toLowerCase().trim();
    const delay = Number(signal?.delayMin || 0);
    const detail = normalizeSignalGroupText(type === 'information' ? (signal?.infoTag || signalDisplayLabel(signal)) : signalDisplayLabel(signal));
    return [type, station, infoTag, delay, detail].join('|');
  }

  function mergeSignalGroup(signals){
    const list = Array.isArray(signals) ? signals.filter(Boolean) : [];
    if (!list.length) return [];
    const byKey = new Map();
    list.forEach((sig)=>{
      const key = signalGroupKey(sig);
      const existing = byKey.get(key);
      if (!existing){
        byKey.set(key, { ...sig, upvotes: Number(sig.upvotes || 0), downvotes: Number(sig.downvotes || 0), myVote: Number(sig.myVote || 0), groupedIds:[String(sig.id || '')], groupedCount:1 });
        return;
      }
      existing.upvotes += Number(sig.upvotes || 0);
      existing.downvotes += Number(sig.downvotes || 0);
      if (!existing.myVote && Number(sig.myVote || 0)) existing.myVote = Number(sig.myVote || 0);
      existing.groupedIds.push(String(sig.id || ''));
      existing.groupedCount += 1;
      if (Number(sig.ts || 0) > Number(existing.ts || 0)){
        existing.id = sig.id;
        existing.ts = sig.ts;
        existing.message = sig.message;
        existing.detail = sig.detail;
        existing.accountId = sig.accountId;
        existing.pseudo = sig.pseudo;
      }
    });
    return Array.from(byKey.values()).sort((a,b)=> Number(b.ts || 0) - Number(a.ts || 0));
  }

  function buildSignalVoteMarkup(signal){
    const rawType = String(signal?.signalType || '').toLowerCase().trim();
    const type = rawType
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z-]/g, '')
      .replace(/a-lheure|alheure|a-l-heure/g, 'a-lheure');
    if (!signal || !new Set(['information','retard','suppression','a-lheure']).has(type)) return '';
    const votes = getSignalVoteSummary(signal);
    const score = Number(votes.up || 0) - Number(votes.down || 0);
    return `<span class="lb-signal-vote"><button type="button" class="lb-signal-vote-btn is-up${votes.mine > 0 ? ' is-active' : ''}" data-lb-vote-signal="${safeEscape(String(signal.id || ''))}" data-lb-vote-value="1" aria-label="Vote positif">👍</button><span class="lb-signal-vote-count">${score}</span><button type="button" class="lb-signal-vote-btn is-down${votes.mine < 0 ? ' is-active' : ''}" data-lb-vote-signal="${safeEscape(String(signal.id || ''))}" data-lb-vote-value="-1" aria-label="Vote négatif">👎</button></span>`;
  }

  function askSignalModerationConfirmation(message){
    return new Promise((resolve)=>{
      let modal = document.getElementById('lbVoteConfirmModal');
      if (!modal){
        modal = document.createElement('div');
        modal.id = 'lbVoteConfirmModal';
        modal.className = 'lb-community-modal';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
          <div class="lb-community-panel" role="dialog" aria-modal="true" aria-labelledby="lbVoteConfirmTitle">
            <button type="button" class="lb-community-close tron-close-button" data-lb-vote-confirm-cancel aria-label="Fermer"></button>
            <div class="lb-community-head">
              <h3 id="lbVoteConfirmTitle">Confirmer la modération</h3>
            </div>
            <div class="lb-vote-confirm-text" id="lbVoteConfirmText"></div>
            <div class="lb-vote-confirm-actions">
              <button type="button" class="lb-signal-submit" data-lb-vote-confirm-ok>Confirmer</button>
              <button type="button" class="lb-community-btn" data-lb-vote-confirm-cancel>Annuler</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
      }
      const txt = modal.querySelector('#lbVoteConfirmText');
      if (txt) txt.textContent = String(message || '');
      const previousModal = Array.from(document.querySelectorAll('.lb-community-modal.is-open'))
        .find((item)=> item !== modal);
      if (previousModal?.id) modal.dataset.lbReturnModal = previousModal.id;
      let settled = false;
      const finalize = (choice)=>{
        if (settled) return;
        settled = true;
        closeCommunityModal(modal.id);
        resolve(!!choice);
      };
      modal.querySelectorAll('[data-lb-vote-confirm-ok]').forEach((btn)=> btn.onclick = ()=> finalize(true));
      modal.querySelectorAll('[data-lb-vote-confirm-cancel]').forEach((btn)=> btn.onclick = ()=> finalize(false));
      openCommunityModal(modal.id);
    });
  }

  async function submitSignalVote(signalId, value){
    const id = String(signalId || '').trim();
    if (!id) return;
    try{
      const voteValue = Number(value) > 0 ? 1 : -1;
	  const targetBeforeVote = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).find((it)=> String(it.id) === id) || null;
      if (voteValue < 0 && targetBeforeVote){
        const currentScore = Number(targetBeforeVote.upvotes || 0) - Number(targetBeforeVote.downvotes || 0);
        const mine = Number(targetBeforeVote.myVote || 0);
        const delta = mine < 0 ? 1 : (mine > 0 ? -2 : -1);
        const projectedScore = currentScore + delta;
        const willReachAutoModeration = currentScore > -3 && projectedScore <= -3;
        if (willReachAutoModeration){
          const ok = await askSignalModerationConfirmation('Ce vote valide la suppression du signalement initial (signalement multicontesté).');
          if (!ok) return;
        }
	  } else if (voteValue < 0){
        const safeId = String(id).replace(/"/g, '\\"');
        const btn = document.querySelector(`[data-lb-vote-signal="${safeId}"][data-lb-vote-value="-1"]`) || document.querySelector(`[data-lb-vote-signal="${safeId}"]`);
        const voteWrap = btn ? btn.closest('.lb-signal-vote') : null;
        const scoreEl = voteWrap ? voteWrap.querySelector('.lb-signal-vote-count') : null;
        const domScore = Number(scoreEl?.textContent || 0);
        if (Number.isFinite(domScore) && domScore <= -2){
          const ok = await askSignalModerationConfirmation('Ce vote valide la suppression du signalement initial (signalement multicontesté).');
          if (!ok) return;
        }
      }
      const res = await window.fetchCommentsApi(`/${encodeURIComponent(id)}/vote`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ vote: voteValue })
      });
      let data = null;
      try { data = await res.json(); } catch(_){}
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      let moderationNotice = '';
      let signalRemovedByModeration = null;
      const target = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).find((it)=> String(it.id) === id);
      if (target){
        const previousScore = Number(target.upvotes || 0) - Number(target.downvotes || 0);
        target.upvotes = Number(data?.upvotes || 0);
        target.downvotes = Number(data?.downvotes || 0);
        target.myVote = Number(data?.my_vote || 0);
        const nextScore = Number(target.upvotes || 0) - Number(target.downvotes || 0);
        if (voteValue < 0 && nextScore <= -3){
          if (previousScore > -3){
            moderationNotice = 'Votre vote fait passer ce signalement à -3 : il est automatiquement supprimé du live et du mur des commentaires.';
          }
          signalRemovedByModeration = { ...target };
        }
      } else {
        const nextScore = Number(data?.upvotes || 0) - Number(data?.downvotes || 0);
        if (voteValue < 0 && nextScore <= -3){
          moderationNotice = 'Votre vote fait passer ce signalement à -3 : il est automatiquement supprimé du live et du mur des commentaires.';
		  if (targetBeforeVote){
            signalRemovedByModeration = {
              ...targetBeforeVote,
              upvotes: Number(data?.upvotes || targetBeforeVote.upvotes || 0),
              downvotes: Number(data?.downvotes || targetBeforeVote.downvotes || 0)
            };
          }
        }
      }
      if (signalRemovedByModeration) await removeAssociatedWallAlertsForSignal(signalRemovedByModeration, { ignoreAuthorCheck: true });
      if (signalRemovedByModeration) rememberHiddenWallRuleFromSignal(signalRemovedByModeration);
      if (signalRemovedByModeration) forceHideWallCommentsInFrontForSignal(signalRemovedByModeration);
      await loadSignals();
      if (typeof window.refreshGamificationUI === 'function') window.refreshGamificationUI({ force: true }).catch(()=>{});
	  if (voteValue < 0) await pruneWallAlertsWithoutActiveSignals();
      if (COMMUNITY.selectedTrain) renderTrainDetail(COMMUNITY.selectedTrain);
      refreshLiveModal();
      if (moderationNotice) console.info(moderationNotice);
    }catch(err){
      console.error('SIGNAL_VOTE_ERROR', err);
    }
  }

  function buildPropagatedSignalsByStop(stopNames, trainSignals){
    const normalizedStops = (Array.isArray(stopNames) ? stopNames : []).map((name)=> String(name || '').trim()).filter(Boolean);
    const latestPerStop = new Map();
    const propagationTypes = new Set(['retard', 'a-lheure', 'suppression']);
    (Array.isArray(trainSignals) ? trainSignals : []).forEach((sig)=>{
      const station = String(sig?.station || '').trim();
      if (!station || !propagationTypes.has(String(sig?.signalType || '').toLowerCase())) return;
      const key = station.toLowerCase();
      const prev = latestPerStop.get(key);
      if (!prev || Number(sig.ts || 0) > Number(prev.ts || 0)) latestPerStop.set(key, sig);
    });
    const out = new Map();
    let carry = null;
    normalizedStops.forEach((name)=>{
      const key = name.toLowerCase();
      const atStop = latestPerStop.get(key);
      if (atStop) carry = atStop;
      if (carry) out.set(key, carry);
    });
    return out;
  }

  function syncCommunityModalState(){
    const hasOpenModal = !!document.querySelector('.lb-community-modal.is-open');
    document.body.classList.toggle('lb-community-modal-open', hasOpenModal);
  }

  function hideTrainProfileOverlay(){
    const panel = $id('trainDetailPanel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-train-detail-open');
  }

  function hideCommunityModal(modal, { preserveSignalState = false } = {}){
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (modal.id === 'lbSignalModal' && !preserveSignalState) resetSignalEditMode();
  }

  function openCommunityModal(id){
    const modal = $id(id);
    if (!modal) return;

    // Une seule surface principale à la fois : la fiche train disparaît avant
    // l'ouverture de LIVE / SIGNALER, et deux modales ne peuvent plus s'empiler.
    hideTrainProfileOverlay();
    const returningToSignal = id === 'lbInfoQuickModal'
      && $id('lbSignalModal')?.classList.contains('is-open');
    const returningToLive = id === 'lbTrainDetailModal'
    && $id('lbLiveModal')?.classList.contains('is-open');
  if (returningToSignal) modal.dataset.lbReturnModal = 'lbSignalModal';
  if (returningToLive) modal.dataset.lbReturnModal = 'lbLiveModal';
    const returnModalId = modal.dataset.lbReturnModal || '';
    document.querySelectorAll('.lb-community-modal.is-open').forEach((current)=>{
      if (current === modal) return;
      hideCommunityModal(current, {
        preserveSignalState: !!returnModalId && current.id === returnModalId
      });
    });

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    syncCommunityModalState();
    if (id === 'lbLiveModal') {
      // LIVE léger : les horaires viennent du JSON public train_static_today, pas de stop_times.txt côté navigateur.
      window.LB_ALLOW_HEAVY_GTFS = false;
      loadTrainStaticToday().finally(()=> refreshLiveModal());
      refreshLiveModal();
    }
    if (id === 'lbSignalModal') refreshSignalModal();
    window.requestAnimationFrame(()=>{
      const focusTarget = modal.querySelector(
        '[data-modal-autofocus], select:not([disabled]), input:not([disabled]), button:not([disabled])'
      );
      focusTarget?.focus?.({ preventScroll:true });
    });
  }

  function closeCommunityModal(id){
    const modal = $id(id);
    if (!modal) return;
    const returnModalId = modal.dataset.lbReturnModal || '';
    delete modal.dataset.lbReturnModal;
    hideCommunityModal(modal);
    syncCommunityModalState();
    if (returnModalId) openCommunityModal(returnModalId);
  }

  function refreshCommunityViews(){
    const statusEl = $id('lbCommunityStatus');
    if (statusEl){
      const signalCount = Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals.length : 0;
      const presenceCount = Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences.filter((it)=> toIsoDay(new Date(it.ts || Date.now())) === toIsoDay()).length : 0;
      statusEl.textContent = (signalCount > 0 || presenceCount > 0)
        ? `${signalCount} signalement(s) · ${presenceCount} voyageur(s) en live aujourd'hui.`
        : 'Live voyageurs et signalements en temps réel.';
    }
    if ($id('lbLiveModal')?.classList.contains('is-open')) refreshLiveModal();
    if ($id('lbSignalModal')?.classList.contains('is-open')) refreshSignalModal();
  }


  function extractSncfHubLiveInfo(data){
    const train = data?.vehicle_journeys?.[0] || null;
    const disruptions = Array.isArray(data?.disruptions) ? data.disruptions : [];
    const causes = [];
    disruptions.forEach((d)=>{
      const cause = String(d?.cause || '').trim();
      if (cause) causes.push(cause);
      const msg = String(d?.messages?.[0]?.text || '').trim();
      if (msg) causes.push(msg);
    });
    let statusClass = '';
    let statusLabel = '';
    let maxDelay = 0;
    const stops = Array.isArray(train?.stop_times) ? train.stop_times : [];
    const officialState = classifyOfficialLiveDisruption({
      status: train?.status || data?.status || '',
      cause: causes.join(' • '),
      disruptions,
      stops
    });
    if (officialState.statusClass){
      statusClass = officialState.statusClass;
      statusLabel = officialState.statusLabel;
    }
    stops.forEach((st)=>{
      const planned = String(st?.base_departure_time || st?.base_arrival_time || st?.departure_time || st?.arrival_time || '').trim();
      const amended = String(st?.amended_departure_time || st?.amended_arrival_time || '').trim();
      let d = 0;
      if (typeof dl === 'function' && planned && amended) {
        try { d = Number(dl(planned, amended) || 0); } catch(_) { d = 0; }
      }
      const explicit = Number(st?.delay_minutes ?? st?.delay ?? 0);
      if (Number.isFinite(explicit) && explicit > d) d = explicit;
      if (Number.isFinite(d) && d > maxDelay) maxDelay = d;
    });
    if (!statusClass && maxDelay > 0){
      statusClass = 'delay';
      statusLabel = `+${maxDelay} min`;
    }
    if (!statusClass){
      statusClass = 'ok';
      statusLabel = 'À l\'heure';
    }
    return {
      train,
      statusClass,
      statusLabel,
      maxDelay,
      sncfCause: Array.from(new Set(causes)).slice(0, 2).join(' • ')
    };
  }

  async function hydrateLiveSncfViaHub(sourceTrains){
    const trains = Array.isArray(sourceTrains) ? sourceTrains : [];
    if (!trains.length) return;
    if (typeof window.fetchVehicleJourneyViaHub !== 'function') return;
    const day = toYmd();
    const targets = trains
      .map((t)=> normalizeKey(t?.trainNumber))
      .filter(Boolean)
      .filter((n, idx, arr)=> arr.indexOf(n) === idx)
      .slice(0, 30);
    if (!targets.length) return;

    await Promise.allSettled(targets.map(async (num)=>{
      const response = await window.fetchVehicleJourneyViaHub(day, num, { client: 'front-live', timeoutMs: 12000 });
      if (!response?.ok || !response?.data) return;
      const info = extractSncfHubLiveInfo(response.data);
      const liveTrain = COMMUNITY.liveTrains.find((it)=> normalizeKey(it?.trainNumber) === num);
      const currentClass = liveTrain?.statusClass || 'ok';
      const currentDelay = Number(liveTrain?.maxDelay || 0);
      let finalInfo = { ...info };

      // Priorité identique au tableau :
      // 1) suppression SNCF/HUB prioritaire
      // 2) retard SNCF/HUB si > 0 prioritaire
      // 3) si HUB dit "À l'heure" mais GTFS-RT/HAFAS avait déjà un retard/suppression,
      //    on conserve le GTFS-RT/HAFAS au lieu de l'écraser.
      if (info.statusClass === 'ok' && currentClass !== 'ok') {
        finalInfo.statusClass = currentClass;
        finalInfo.statusLabel = liveTrain?.statusLabel || (currentClass === 'delay' ? `+${currentDelay} min` : 'Supprimé');
        finalInfo.maxDelay = currentDelay;
        finalInfo.sncfCause = liveTrain?.sncfCause || finalInfo.sncfCause || '';
      } else if (info.statusClass === 'delay' && currentClass === 'delay' && currentDelay > Number(info.maxDelay || 0)) {
        finalInfo.statusLabel = liveTrain?.statusLabel || `+${currentDelay} min`;
        finalInfo.maxDelay = currentDelay;
        finalInfo.sncfCause = info.sncfCause || liveTrain?.sncfCause || '';
      }

      if (liveTrain){
        liveTrain.statusClass = finalInfo.statusClass || liveTrain.statusClass;
        liveTrain.statusLabel = finalInfo.statusLabel || liveTrain.statusLabel;
        liveTrain.maxDelay = Number(finalInfo.maxDelay || liveTrain.maxDelay || 0);
        if (finalInfo.sncfCause) liveTrain.sncfCause = finalInfo.sncfCause;
      }
      const card = document.querySelector(`[data-lb-live-train="${String(num).replace(/"/g, '\"')}"]`);
      if (!card) return;
      card.classList.remove('lb-live-card--ok','lb-live-card--delay','lb-live-card--partial','lb-live-card--cancel');
      card.classList.add(`lb-live-card--${finalInfo.statusClass || 'ok'}`);
      const statusEl = card.querySelector('.lb-live-status');
      if (statusEl){
        statusEl.className = `lb-live-status lb-live-status--${finalInfo.statusClass || 'ok'}`;
        statusEl.textContent = finalInfo.statusLabel || 'À l\'heure';
      }
      if (finalInfo.sncfCause && ['delay','partial','cancel'].includes(finalInfo.statusClass)){
        let causeEl = card.querySelector('.lb-live-sncf-cause');
        if (!causeEl){
          const right = card.querySelector('.lb-live-right');
          if (right){
            causeEl = document.createElement('div');
            causeEl.className = 'lb-live-sncf-cause';
            right.appendChild(causeEl);
          }
        }
        if (causeEl){
          causeEl.classList.toggle('lb-live-sncf-cause--cancel', finalInfo.statusClass === 'cancel');
          const causePrefix = finalInfo.statusClass === 'partial' ? 'Suppression partielle' : (finalInfo.statusClass === 'cancel' ? 'Suppression' : 'Retard');
          causeEl.textContent = `${causePrefix} : ${finalInfo.sncfCause}`;
        }
      }
    }));
  }

  function lbCompactLiveTrainName(label, max = 26){
    const clean = String(label || '')
      .replace(/^[\s🐮🐄🚆🚃🚄🚅🛤️🌾⚠️⏱️🚫✅]+/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return '';
    return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1)).trim()}…` : clean;
  }

  function renderLiveTrainCards(){
    const liveExtractor = (typeof window.extractLiveTrains === 'function' ? window.extractLiveTrains : (()=>[]));
    COMMUNITY.liveTrains = liveExtractor();
    const cardsEl = $id('lbLiveTrainCards');
    const countEl = $id('lbLiveTrainsCount');
	const directionSelect = $id('lbLiveDirectionSelect');
    if (directionSelect && directionSelect.value !== COMMUNITY.liveDirection){
      directionSelect.value = COMMUNITY.liveDirection;
    }
    if (!cardsEl || !countEl) return;
    const displayTrains = sortAndFilterLiveTrainsByDirection(COMMUNITY.liveTrains, COMMUNITY.liveDirection);
    countEl.textContent = String(displayTrains.length);
    if (!displayTrains.length){
      const msg = COMMUNITY.liveDirection === 'all'
        ? 'Aucun train live détecté pour le moment.'
        : 'Aucun train trouvé pour ce sens actuellement.';
      cardsEl.innerHTML = `<div class="lb-live-empty">${safeEscape(msg)}</div>`;
      renderLiveFeed('');
      if ($id('lbTrainDetailModal')?.classList.contains('is-open')) renderTrainDetail('');
      return;
    }
    cardsEl.innerHTML = displayTrains.map((train)=>{
      const signals = getSignalsForTrain(train.trainNumber);
      const wallComments = getWallCommentsForTrain(train.trainNumber);
      const presence = getPresenceStatsForTrain(train.trainNumber);
      const myPresence = getMyPresenceToday();
      const isInThisTrain = !!myPresence && normalizeKey(myPresence.trainNumber) === normalizeKey(train.trainNumber);
      const travelerDisruption = getLatestTravelerDisruption(train.trainNumber);
      const effectiveCompo = getEffectiveCompositionCode(train.trainNumber);
      const cardState = (()=> {
        if (train.statusClass === 'cancel') return 'cancel';
        if (train.statusClass === 'partial') return 'partial';
        if (train.statusClass === 'delay') return 'delay';
        if (train.statusClass === 'ok' && travelerDisruption?.type === 'suppression') return 'cancel';
        if (train.statusClass === 'ok' && travelerDisruption?.type === 'retard') return 'delay';
        return 'ok';
      })();
      const gtfsInfo = COMMUNITY.staticInfoCache.get(`${normalizeKey(train.trainNumber)}_${toYmd()}`) || getTrainStaticTodayInfo(train.trainNumber) || null;
      const chips = [];
      const groupedSignals = mergeSignalGroup(signals);
      if (wallComments.length) chips.push(`<span class="lb-live-chip">💬 ${wallComments.length} commentaire(s)</span>`);
      const firstStationSignal = groupedSignals.find((s)=> s.station);
      if (firstStationSignal?.station) chips.push(`<span class="lb-live-chip">📍 ${safeEscape(firstStationSignal.station)}</span>`);
      const latestNonInfoSignal = groupedSignals.find((s)=> String(s?.signalType || '').toLowerCase() !== 'information');
      if (latestNonInfoSignal){
        const nonInfoChip = `<span class="lb-live-chip">${safeEscape(signalDisplayLabel(latestNonInfoSignal))}</span>`;
        const nonInfoVote = buildSignalVoteMarkup(latestNonInfoSignal);
        chips.push(nonInfoVote ? `<span class="lb-stop-chip-wrap">${nonInfoChip}${nonInfoVote}</span>` : nonInfoChip);
      }
      const infoSignals = groupedSignals
        .filter((s)=> String(s?.signalType || '').toLowerCase() === 'information')
        .slice(0, 4);
      infoSignals.forEach((s)=>{
        const mine = s.groupedCount === 1 && isOwnSignal(s);
        const attrs = mine ? ` role="button" tabindex="0" title="Supprimer mon signalement" data-lb-delete-signal="${safeEscape(String(s.id || ''))}"` : '';
        chips.push(`<span class="lb-stop-chip-wrap"><span class="lb-live-chip${mine ? ' is-own' : ''}"${attrs}>${safeEscape(signalDisplayLabel(s))}</span>${buildSignalVoteMarkup(s)}</span>`);
      });
      return `
        <div class="lb-live-card lb-live-card--${safeEscape(cardState)}" data-lb-live-train="${safeEscape(train.trainNumber)}">
          <div class="lb-live-card-top">
            <div>
              <div class="lb-live-train-row">
                <div class="lb-live-train" title="${safeEscape(train.label)}">${safeEscape(lbCompactLiveTrainName(train.label, 28))}</div>
              </div>
              <div class="lb-live-route" data-lb-train-route-line="${safeEscape(train.trainNumber)}">${buildLiveRouteLineHtml(train, gtfsInfo)}</div>
            </div>
            <div class="lb-live-compo-top" data-lb-train-compo="${safeEscape(train.trainNumber)}" data-compo-help="${safeEscape(compoMeaningLabel(effectiveCompo))}" title="${safeEscape(compoMeaningLabel(effectiveCompo))}">${compoVisualHtml(effectiveCompo)}</div>
            <div class="lb-live-right">
              <div class="lb-live-status-row">
                <span class="lb-live-passenger">🐮 ${presence.count}</span>
                <span class="lb-live-status lb-live-status--${safeEscape(train.statusClass)}">${safeEscape(train.statusLabel)}</span>
              </div>
	              ${travelerDisruption
	                ? (travelerDisruption.type === 'suppression'
	                    ? `<span class="lb-live-user-alert lb-live-user-alert--cancel" title="Signalement usager récent (visible même avec statut SNCF existant)">❌ Supprimé (usager)</span>`
	                    : `<span class="lb-live-user-alert" title="Signalement usager récent (visible même avec statut SNCF existant)">Signalé: +${safeEscape(travelerDisruption.delayMin || '?')} min</span>`)
	                : ''}
			  ${['delay','partial','cancel'].includes(train.statusClass) && train.sncfCause
                ? `<div class="lb-live-sncf-cause ${train.statusClass === 'cancel' ? 'lb-live-sncf-cause--cancel' : ''}">${safeEscape(train.statusClass === 'partial' ? 'Suppression partielle' : (train.statusClass === 'cancel' ? 'Suppression' : 'Retard'))} : ${safeEscape(train.sncfCause)}</div>`
                : ''}
            </div>
          </div>
          ${chips.length ? `<div class="lb-live-meta">${chips.join('')}</div>` : ''}
          <div class="lb-live-card-actions">
            <button type="button" data-lb-signal-train="${safeEscape(train.trainNumber)}">⚠️ Signaler</button>
            <button type="button" class="lb-live-presence-btn" data-no-betaillere="1" data-lb-presence-train="${safeEscape(train.trainNumber)}">${isInThisTrain ? 'À bord ✓' : 'Monter à bord'}</button>
          </div>
        </div>`;
    }).join('');
    hydrateLiveTrainStaticInfos(displayTrains);
    hydrateLiveSncfViaHub(displayTrains).catch((err)=> console.warn('[LIVE SNCF HUB] indisponible', err?.message || err));
  }

  async function hydrateLiveTrainStaticInfos(sourceTrains){
    const trains = Array.isArray(sourceTrains) ? sourceTrains : (Array.isArray(COMMUNITY.liveTrains) ? COMMUNITY.liveTrains : []);
    if (!trains.length) return;
    try { if (typeof loadCompoData === 'function') await loadCompoData({ forceFresh:false, background:true }); } catch(_) {}
    await loadTrainStaticToday();
    trains.forEach((train)=>{
      // Important: ici on utilise seulement le JSON déjà chargé.
      // On ne lance plus /api/train-static en cascade pour chaque carte LIVE.
      const info = getTrainStaticTodayInfo(train.trainNumber);
      const effectiveCompo = getEffectiveCompositionCode(train.trainNumber);
      const node = document.querySelector(`[data-lb-train-route-line="${String(train.trainNumber)}"]`);
      if (node && info) node.innerHTML = buildLiveRouteLineHtml(train, info);
      const compoNode = document.querySelector(`[data-lb-train-compo="${String(train.trainNumber)}"]`);
      if (compoNode){
        const compoHelp = compoMeaningLabel(effectiveCompo);
        compoNode.innerHTML = compoVisualHtml(effectiveCompo);
        compoNode.setAttribute('data-compo-help', compoHelp);
        compoNode.setAttribute('title', compoHelp);
        compoNode.setAttribute('aria-label', compoHelp);
      }
    });
  }

  function renderLiveFeed(trainNumber){
    const feedEl = $id('lbLiveFeedList');
    const countEl = $id('lbLiveFeedCount');
    const titleEl = $id('lbLiveSideTitle');
    if (!feedEl || !countEl || !titleEl) return;
    const key = normalizeKey(trainNumber || COMMUNITY.selectedTrain);
    COMMUNITY.selectedTrain = key;
    const train = COMMUNITY.liveTrains.find((it)=> normalizeKey(it.trainNumber) === key) || null;
    titleEl.textContent = train ? `Retours voyageurs — ${train.label}` : 'Flux voyageurs';
    let items = [];
    if (train){
      const signals = getSignalsForTrain(train.trainNumber).map((it)=>({ kind:'signal', ts:it.ts, pseudo:it.pseudo, displayPseudo: it.displayPseudo, authorGrade: it.authorGrade, authorPoints: it.authorPoints, text:`${signalDisplayLabel(it)}${it.station ? ` — ${it.station}` : ''}${it.detail ? ` — ${it.detail}` : ''}` }));
      const comments = getWallCommentsForTrain(train.trainNumber)
        .filter((it)=> !shouldHideLiveCommentByAutomoderation(it, train.trainNumber))
        .map((it)=>({ kind:'comment', ts:it.ts, pseudo:it.pseudo || 'Voyageur', displayPseudo: it.displayPseudo, authorGrade: it.authorGrade, authorPoints: it.authorPoints, text: String(it.text || '') }));
      items = [...signals, ...comments].sort((a,b)=> Number(b.ts||0) - Number(a.ts||0)).slice(0, 30);
    } else {
      items = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).slice(0, 30).map((it)=>({ kind:'signal', ts:it.ts, pseudo:it.pseudo, displayPseudo: it.displayPseudo, authorGrade: it.authorGrade, authorPoints: it.authorPoints, text:`${it.trainNumber ? `TER ${it.trainNumber} — ` : ''}${signalDisplayLabel(it)}${it.station ? ` — ${it.station}` : ''}${it.detail ? ` — ${it.detail}` : ''}` }));
    }
    countEl.textContent = String(items.length);
    if (!items.length){
      feedEl.innerHTML = '<div class="lb-live-empty">Aucun retour voyageur pour ce train pour le moment.</div>';
      return;
    }
    feedEl.innerHTML = items.map((it)=>{
      const pseudoHtml = (typeof window.buildPseudoTriggerHtml === 'function')
        ? window.buildPseudoTriggerHtml(it)
        : safeEscape(it?.displayPseudo || it?.pseudo || 'Voyageur');
      return `
      <div class="lb-live-feed-item">
        <div class="meta">${pseudoHtml} — ${safeEscape(formatHour(it.ts))}</div>
        <div class="text">${safeEscape(it.text || '')}</div>
      </div>`;
    }).join('');
  }

  function refreshLiveModal(){
    if (!LB_TRAIN_STATIC_TODAY_DATE && !LB_TRAIN_STATIC_TODAY_PROMISE){
      loadTrainStaticToday().then(()=>{
        if ($id('lbLiveModal')?.classList.contains('is-open')) renderLiveTrainCards();
      });
    }
    renderLiveTrainCards();
    const displayTrains = sortAndFilterLiveTrainsByDirection(COMMUNITY.liveTrains, COMMUNITY.liveDirection);
    renderLiveFeed(COMMUNITY.selectedTrain || (displayTrains[0]?.trainNumber || ''));
  }

  function resetSignalEditMode(){
    COMMUNITY.editingSignalId = '';
  }

  function resetSignalDraft(){
    COMMUNITY.selectedSignalType = '';
    COMMUNITY.selectedInfoTag = '';
    const delaySelect = $id('lbSignalDelaySelect');
    if (delaySelect) delaySelect.value = '';
    document.querySelectorAll('.lb-signal-type.is-selected,.lb-info-quick-btn.is-selected').forEach((button)=>{
      button.classList.remove('is-selected');
    });
    updateSignalTypeUI();
  }

  function openSignalForTrain(trainNumber){
    if (!requireCommunityAuthentication()) return;
    COMMUNITY.selectedTrain = normalizeKey(trainNumber || COMMUNITY.selectedTrain);
    COMMUNITY.returnToMapAfterSignal = false;
    resetSignalEditMode();
    resetSignalDraft();
    openCommunityModal('lbSignalModal');
    const trainSelect = $id('lbSignalTrainSelect');
    if (trainSelect && COMMUNITY.selectedTrain) trainSelect.value = COMMUNITY.selectedTrain;
    updateSignalStationOptions();
  }

  function openSignalEditFromTrainDetail({ signalId, trainNumber, station, delayMin } = {}){
    const editId = String(signalId || '').trim();
    if (!editId) return;
    COMMUNITY.editingSignalId = editId;
    COMMUNITY.selectedTrain = normalizeKey(trainNumber || COMMUNITY.selectedTrain);
    COMMUNITY.selectedSignalType = 'retard';
    COMMUNITY.selectedInfoTag = '';
    openCommunityModal('lbSignalModal');
    const trainSelect = $id('lbSignalTrainSelect');
    const stationSelect = $id('lbSignalStationSelect');
    const delaySelect = $id('lbSignalDelaySelect');
    if (trainSelect && COMMUNITY.selectedTrain) trainSelect.value = COMMUNITY.selectedTrain;
    updateSignalStationOptions();
    if (stationSelect && station) stationSelect.value = String(station);
    if (delaySelect && Number(delayMin) > 0) delaySelect.value = String(Number(delayMin));
    document.querySelectorAll('.lb-signal-type').forEach((btn)=> btn.classList.toggle('is-selected', btn.getAttribute('data-signal-type') === 'retard'));
    updateSignalTypeUI();
    const feedback = $id('lbSignalFeedback');
    if (feedback) feedback.textContent = 'Mode modification: mettez à jour le retard puis publiez.';
  }

  async function renderTrainDetail(trainNumber){
    const key = normalizeKey(trainNumber || COMMUNITY.selectedTrain);
    const title = $id('lbTrainDetailTitle');
    const route = $id('lbTrainDetailRoute');
    const cause = $id('lbTrainDetailCause');
    const stopsEl = $id('lbTrainDetailStops');
    const train = COMMUNITY.liveTrains.find((it)=> normalizeKey(it.trainNumber) === key);
    if (!title || !route || !stopsEl || !train) return;
    title.textContent = `Fiche ${train.label}`;
    route.textContent = train.route;
    if (cause){
      const txt = String(train.sncfCause || '').trim();
      if (['delay','partial','cancel'].includes(train.statusClass) && txt){
        cause.hidden = false;
        cause.textContent = `${train.statusClass === 'partial' ? 'Suppression partielle' : (train.statusClass === 'cancel' ? 'Suppression' : 'Retard')} : ${txt}`;
      } else {
        cause.hidden = true;
        cause.textContent = '';
      }
    }

    let stops = Array.isArray(train.stops) ? train.stops.filter(Boolean) : [];
    const info = await getLiveTrainStaticInfo(train.trainNumber);
    if (info?.stops?.length) stops = info.stops;
    const stopRows = Array.isArray(info?.stopRows) && info.stopRows.length
      ? info.stopRows
      : stops.map((name)=>({ name, time:'—' }));
    if (!stops.length){
      stopsEl.innerHTML = '<div class="lb-live-empty">Aucun arrêt disponible.</div>';
      return;
    }
    let officialRows = [];
  try {
    if (typeof window.lbGetOfficialServicePattern === 'function') {
      const official = await window.lbGetOfficialServicePattern(train.trainNumber, toYmd());
      officialRows = Array.isArray(official?.rows) ? official.rows : [];
    }
  } catch (err) {
    console.warn('[Voix du bétail] parcours officiel indisponible', err?.message || err);
  }
  const voiceStopKey = (value)=> String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const officialByStop = new Map(
    officialRows
      .map((row)=> [voiceStopKey(row?.name), row])
      .filter(([key])=> key)
  );
  const signals = getSignalsForTrain(train.trainNumber);
    const propagatedByStop = buildPropagatedSignalsByStop(stopRows.map((s)=> s.name), signals);
    stopsEl.innerHTML = stopRows.map((row)=>{
      const stopName = row?.name || '';
      const officialRow = officialByStop.get(voiceStopKey(stopName)) || null;
      const officialDeleted = !!officialRow?.isDeleted;
      const officialNewOrigin = !!officialRow?.isNewOrigin;
      const officialNewTerminus = !!officialRow?.isNewTerminus;
      const stopKey = String(stopName || '').toLowerCase();
      const stopSignals = mergeSignalGroup(signals.filter((s)=> String(s.station || '').toLowerCase() === stopKey));
      const propagatedRaw = propagatedByStop.get(stopKey) || null;
      const propagated = propagatedRaw ? mergeSignalGroup([propagatedRaw])[0] : null;
      const baseTime = String(row?.time || '—');
	  const gtfsAmendedTime = String(row?.amendedTime || '—');
      const gtfsDelayFromStop = getGtfsRtDelayForStop(train.trainNumber, stopName);
      const gtfsDelayMin = Number.isFinite(gtfsDelayFromStop) ? gtfsDelayFromStop : Number(row?.delayMin);
      const baseMinutes = hhmmToMinutes(baseTime);
      const amendedMinutes = hhmmToMinutes(gtfsAmendedTime);
      const hasGtfsDelay = baseTime !== '—'
        && gtfsAmendedTime !== '—'
        && baseMinutes != null
        && amendedMinutes != null
        && amendedMinutes > baseMinutes;
      let timeClass = 'lb-train-stop-time';
      let timeHtml = `<span class="actual">${safeEscape(baseTime)}</span>`;
      if (officialDeleted){
      timeClass = 'lb-train-stop-time is-cancel';
      timeHtml = `<span class="actual">${safeEscape(baseTime)}</span>`;
    } else if (hasGtfsDelay){
        timeClass = 'lb-train-stop-time is-delay';
        timeHtml = `<span class="planned">${safeEscape(baseTime)}</span><span class="actual">${safeEscape(gtfsAmendedTime)}</span>`;
      } else if (baseTime !== '—' && Number.isFinite(gtfsDelayMin) && gtfsDelayMin > 0){
        timeClass = 'lb-train-stop-time is-delay';
        timeHtml = `<span class="planned">${safeEscape(baseTime)}</span><span class="actual">${safeEscape(addMinutesToHHMM(baseTime, gtfsDelayMin))}</span>`;
      } else if (baseTime !== '—' && String(propagated?.signalType || '').toLowerCase() === 'retard' && Number(propagated.delayMin || 0) > 0){
        timeClass = 'lb-train-stop-time is-delay';
        timeHtml = `<span class="planned">${safeEscape(baseTime)}</span><span class="actual">${safeEscape(addMinutesToHHMM(baseTime, Number(propagated.delayMin || 0)))}</span>`;
      } else if (baseTime !== '—' && String(propagated?.signalType || '').toLowerCase() === 'suppression'){
        timeClass = 'lb-train-stop-time is-cancel';
        timeHtml = `<span class="actual">${safeEscape(baseTime)}</span>`;
      }
      const chipsList = [];
      if (officialDeleted) {
        chipsList.push('<span class="lb-stop-chip lb-stop-chip--suppression" title="Donnée officielle SNCF">SUPPRIMÉ · arrêt non desservi</span>');
      } else if (officialNewOrigin) {
        chipsList.push('<span class="lb-stop-chip lb-stop-chip--a-lheure" title="Donnée officielle SNCF">DÉPART EXCEPTIONNEL</span>');
      } else if (officialNewTerminus) {
        chipsList.push('<span class="lb-stop-chip lb-stop-chip--a-lheure" title="Donnée officielle SNCF">TERMINUS EXCEPTIONNEL</span>');
      }
      if (propagated){
        const alreadyExact = stopSignals.some((s)=> String(s.id) === String(propagated.id));
        if (!alreadyExact){
          const t = String(propagated.signalType || '').toLowerCase().replace(/[^a-z-]/g,'');
          chipsList.push(`<span class="lb-stop-chip lb-stop-chip--${safeEscape(t)}">${safeEscape(`${signalDisplayLabel(propagated)} · depuis ${propagated.station}`)}</span>`);
        }
      }
      if (stopSignals.length){
        chipsList.push(...stopSignals.slice(0, 6).map((s)=>{
          const mine = s.groupedCount === 1 && isOwnSignal(s);
          const t = String(s.signalType || '').toLowerCase().replace(/[^a-z-]/g,'');
          const isEditableSignal = mine && ['retard', 'suppression'].includes(t);
          const attrs = isEditableSignal
            ? ` role="button" tabindex="0" title="Modifier ce signalement" data-lb-inline-edit-signal="${safeEscape(String(s.id || ''))}"`
            : (mine ? ` role="button" tabindex="0" title="Supprimer mon signalement" data-lb-delete-signal="${safeEscape(String(s.id || ''))}"` : '');
          const chip = `<span class="lb-stop-chip lb-stop-chip--${safeEscape(t)}${mine ? ' is-own' : ''}"${attrs}>${safeEscape(signalDisplayLabel(s))}</span>`;
          const voteMarkup = buildSignalVoteMarkup(s);
          return voteMarkup ? `<span class="lb-stop-chip-wrap">${chip}${voteMarkup}</span>` : chip;
        }));
      }
      const chips = chipsList.length ? chipsList.join('') : '<span class="lb-stop-chip">Aucun signalement</span>';
      const editableOwnSignal = stopSignals.find((s)=>{
        if (!(s.groupedCount === 1 && isOwnSignal(s))) return false;
        const tt = String(s.signalType || '').toLowerCase().replace(/[^a-z-]/g,'');
        return tt === 'retard' || tt === 'suppression';
      });
      const delayOptions = ['1','2','3','4','5','6','7','8','9','10','15','20','30','45','60']
        .map((n)=> `<option value="${n}"${Number(editableOwnSignal?.delayMin || 0) === Number(n) ? ' selected' : ''}>+${n} min</option>`)
        .join('');
      const editorHtml = editableOwnSignal ? `
        <div class="lb-inline-signal-editor" data-lb-inline-editor="${safeEscape(String(editableOwnSignal.id || ''))}" hidden>
          <select data-lb-inline-type>
            <option value="retard"${String(editableOwnSignal.signalType || '').toLowerCase() === 'retard' ? ' selected' : ''}>Retard</option>
            <option value="suppression"${String(editableOwnSignal.signalType || '').toLowerCase() === 'suppression' ? ' selected' : ''}>Suppression</option>
          </select>
          <select data-lb-inline-delay ${String(editableOwnSignal.signalType || '').toLowerCase() === 'suppression' ? 'hidden' : ''}>
            ${delayOptions}
          </select>
          <button type="button" data-lb-inline-save data-lb-signal-id="${safeEscape(String(editableOwnSignal.id || ''))}" data-lb-train="${safeEscape(String(train.trainNumber || ''))}" data-lb-station="${safeEscape(String(stopName || ''))}">Mettre à jour</button>
          <button type="button" data-lb-inline-delete data-lb-signal-id="${safeEscape(String(editableOwnSignal.id || ''))}">Supprimer</button>
        </div>
      ` : '';
      return `<article class="lb-train-stop-item"><div class="lb-train-stop-head"><div class="lb-train-stop-name">${safeEscape(stopName)}</div><div class="${timeClass}">${timeHtml}</div></div><div class="lb-train-stop-signals">${chips}</div>${editorHtml}</article>`;
    }).join('');
  }

  function signalTrainOptionsSignature(trains){
    return (Array.isArray(trains) ? trains : []).map((train)=> [
      normalizeKey(train?.trainNumber),
      String(train?.route || ''),
      Array.isArray(train?.stops) ? train.stops.join('>') : ''
    ].join('|')).join('||');
  }

  function signalTrainOptionLabel(train, info = null){
    const departure = info?.departure || '—';
    const arrival = info?.arrival || '—';
    return `${train.label} — ${train.route} (${departure} - ${arrival})`;
  }

  function refreshSignalModal({ forceOptions = false } = {}){
    const liveExtractor = (typeof window.extractLiveTrains === 'function' ? window.extractLiveTrains : (()=>[]));
    COMMUNITY.liveTrains = liveExtractor();
    const trainSelect = $id('lbSignalTrainSelect');
    const stationSelect = $id('lbSignalStationSelect');
    const feedback = $id('lbSignalFeedback');
    const submitBtn = $id('lbSignalSubmit');
    const can = typeof isCommentingAllowed === 'function' ? isCommentingAllowed() : false;
    if (trainSelect){
      const current = normalizeKey(trainSelect.value || COMMUNITY.selectedTrain);
      const signature = signalTrainOptionsSignature(COMMUNITY.liveTrains);
      const mustRebuild = forceOptions
        || !trainSelect.options.length
        || COMMUNITY.signalOptionsSignature !== signature;
      if (mustRebuild){
        trainSelect.innerHTML = '<option value="">Choisir un train live</option>' + COMMUNITY.liveTrains.map((train)=>{
          const info = COMMUNITY.staticInfoCache.get(`${normalizeKey(train.trainNumber)}_${toYmd()}`)
            || getTrainStaticTodayInfo(train.trainNumber)
            || null;
          return `<option value="${safeEscape(train.trainNumber)}">${safeEscape(signalTrainOptionLabel(train, info))}</option>`;
        }).join('');
        COMMUNITY.signalOptionsSignature = signature;
        if (current && COMMUNITY.liveTrains.some((train)=> normalizeKey(train.trainNumber) === current)){
          trainSelect.value = current;
        }
      }
    }
    hydrateSignalTrainOptions().catch((err)=> console.warn('[SIGNAL horaires groupés] indisponibles', err?.message || err));
    updateSignalStationOptions();
    if (submitBtn) submitBtn.textContent = COMMUNITY.editingSignalId ? 'Mettre à jour le signalement' : 'Publier le signalement';
    if (feedback){
      feedback.textContent = can
        ? (COMMUNITY.editingSignalId
          ? 'Mode modification actif: publiez pour remplacer votre retard signalé.'
          : 'Le signalement sera publié dans le live voyageurs et restera distinct des données officielles SNCF.')
        : "";
    }
    const submit = $id('lbSignalSubmit');
    if (submit) submit.disabled = false;
    updateSignalTypeUI();
  }

  async function hydrateSignalTrainOptions(){
    const trainSelect = $id('lbSignalTrainSelect');
    if (!trainSelect || !COMMUNITY.liveTrains.length) return;
    const hydrationKey = `${toYmd()}|${signalTrainOptionsSignature(COMMUNITY.liveTrains)}`;
    if (COMMUNITY.signalOptionsHydrationKey === hydrationKey){
      return COMMUNITY.signalOptionsHydrationPromise || undefined;
    }
    COMMUNITY.signalOptionsHydrationKey = hydrationKey;
    COMMUNITY.signalOptionsHydrationPromise = (async()=>{
      // Un seul JSON groupé pour toute la liste. Le détail /api/train-static
      // n'est demandé qu'après la sélection d'un train, jamais 30 fois en parallèle.
      await loadTrainStaticToday();
      COMMUNITY.liveTrains.slice(0, 60).forEach((train)=>{
        const key = normalizeKey(train.trainNumber);
        const info = COMMUNITY.staticInfoCache.get(`${key}_${toYmd()}`)
          || getTrainStaticTodayInfo(key)
          || null;
        const option = trainSelect.querySelector(`option[value="${String(train.trainNumber)}"]`);
        if (option) option.textContent = signalTrainOptionLabel(train, info);
      });
      updateSignalStationOptions();
    })();
    try{
      await COMMUNITY.signalOptionsHydrationPromise;
    } finally {
      COMMUNITY.signalOptionsHydrationPromise = null;
    }
  }

  function updateSignalTypeUI(){
    const delayWrap = $id('lbSignalDelayWrap');
    const stationWrap = $id('lbSignalStationWrap');
    if (delayWrap){
      delayWrap.classList.toggle('is-visible', COMMUNITY.selectedSignalType === 'retard');
    }
    const needStation = COMMUNITY.selectedSignalType !== 'information' || COMMUNITY.selectedInfoTag === 'forces-ordre';
    if (stationWrap){
      stationWrap.classList.toggle('is-hidden', !needStation);
    }
  }

  function updateSignalStationOptions(){
    const trainSelect = $id('lbSignalTrainSelect');
    const stationSelect = $id('lbSignalStationSelect');
    if (!trainSelect || !stationSelect) return;
    const selectedStation = String(stationSelect.value || '').trim();
    const trainKey = normalizeKey(trainSelect.value);
    const train = COMMUNITY.liveTrains.find((it)=> normalizeKey(it.trainNumber) === trainKey);
    const staticInfo = COMMUNITY.staticInfoCache.get(`${trainKey}_${toYmd()}`)
      || getTrainStaticTodayInfo(trainKey)
      || null;
    const options = (Array.isArray(staticInfo?.stops) && staticInfo.stops.length)
      ? staticInfo.stops
      : (Array.isArray(train?.stops) ? train.stops : []);
    stationSelect.innerHTML = '<option value="">Choisir la gare concernée</option>' + options.map((name)=>`<option value="${safeEscape(name)}">${safeEscape(name)}</option>`).join('');
    if (selectedStation && options.some((name)=> String(name) === selectedStation)){
      stationSelect.value = selectedStation;
    } else if (options.length === 1){
      stationSelect.value = options[0];
    }
  }

  async function publishSignal(){
    if (!requireCommunityAuthentication()) return;
    const trainSelect = $id('lbSignalTrainSelect');
    const stationSelect = $id('lbSignalStationSelect');
    const feedback = $id('lbSignalFeedback');
    const submit = $id('lbSignalSubmit');
    const trainKey = normalizeKey(trainSelect?.value || '');
    const signalType = COMMUNITY.selectedSignalType;
    const station = String(stationSelect?.value || '').trim();
    const delayMin = Number($id('lbSignalDelaySelect')?.value || 0);
    const infoTag = COMMUNITY.selectedInfoTag;
    const accountId = getCurrentPresenceIdentity();
    const needsStation = signalType !== 'information' || infoTag === 'forces-ordre';
    if (!trainKey){ if (feedback) feedback.textContent = 'Choisissez un train live.'; return; }
    if (!signalType){ if (feedback) feedback.textContent = 'Choisissez un type de signalement.'; return; }
    if (needsStation && !station){ if (feedback) feedback.textContent = 'Choisissez la gare concernée.'; return; }
    if (signalType === 'retard' && !(delayMin > 0)){ if (feedback) feedback.textContent = 'Choisissez un retard.'; return; }
    if (signalType === 'information' && !infoTag){ if (feedback) feedback.textContent = 'Choisissez une information prédéfinie.'; return; }
    const train = COMMUNITY.liveTrains.find((it)=> normalizeKey(it.trainNumber) === trainKey);
    const label = train?.label || `TER ${trainKey}`;
    const baseDetail = signalType === 'retard'
      ? `Retard +${delayMin} min`
      : signalType === 'suppression'
        ? `Train supprimé à l'arrêt`
        : signalType === 'a-lheure'
          ? `Train à l'heure`
          : `${INFO_TAG_LABELS[infoTag] || 'Information'}`;
    const signalMessage = `[${signalType.toUpperCase().replace(/-/g,' ')}] ${label}${(needsStation && station) ? ` [${station}]` : ''} — ${baseDetail}`;
    const editingSignalId = String(COMMUNITY.editingSignalId || '').trim();
    const returnToMapAfterSignal = COMMUNITY.returnToMapAfterSignal === true;

    const publishAutoWallAlertIfNeeded = async ()=>{
      const isSuppression = signalType === 'suppression';
      const isMajorDelay = signalType === 'retard' && delayMin >= 15;
      if (!isSuppression && !isMajorDelay) return;
      const statusTxt = isSuppression ? 'signalé supprimé' : `signalé en retard +${delayMin} min`;
      const stationTxt = station ? ` à ${station}` : '';
      const wallMessage = isSuppression
        ? `🚫 <span class="lb-red">${trainKey} supprimé</span> à ${station} · 🐄`
        : `⏱️ ${trainKey} <span class="lb-orange">+${delayMin}</span> à ${station} · 🐄`;
      try{
        await window.fetchCommentsApi('', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({
            message: wallMessage,
            scope:'wall',
            train_number: trainKey,
            account_id: accountId
          })
        });
        try { window.lbComments?.refresh?.(); } catch(_){}
      }catch(err){
        console.warn('WALL_AUTO_SIGNAL_POST_ERROR', err);
      }
    };
    try{
      if (submit) submit.disabled = true;
      if (feedback) feedback.textContent = 'Publication du signalement…';
      if (editingSignalId){
        const previousSignal = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).find((it)=> String(it.id) === editingSignalId) || null;
        const deleteRes = await window.fetchCommentsApi(`/${encodeURIComponent(editingSignalId)}`, { method:'DELETE' });
        if (!deleteRes.ok) throw new Error('Impossible de modifier ce signalement (suppression préalable refusée).');
        if (previousSignal) await removeAssociatedWallAlertsForSignal(previousSignal);
      }
      const res = await window.fetchCommentsApi('', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ message: signalMessage, scope:'signals', train_number: trainKey, station: needsStation ? station : '', signal_type: signalType, delay_min: delayMin || null, info_tag: infoTag || null, account_id: accountId })
      });
      let data = null;
      try { data = await res.json(); } catch(_){ }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const delaySelectEl = $id('lbSignalDelaySelect');
      if (delaySelectEl) delaySelectEl.value = '';
      COMMUNITY.selectedSignalType = '';
      COMMUNITY.selectedInfoTag = '';
      COMMUNITY.returnToMapAfterSignal = false;
      resetSignalEditMode();
      document.querySelectorAll('.lb-signal-type.is-selected').forEach((btn)=> btn.classList.remove('is-selected'));
      if (feedback) feedback.textContent = 'Signalement publié ✅';
      await publishAutoWallAlertIfNeeded();
      await loadSignals();
      if (typeof window.refreshGamificationUI === 'function') window.refreshGamificationUI({ force: true }).catch(()=>{});
      closeCommunityModal('lbSignalModal');
      if (!returnToMapAfterSignal) {
        openCommunityModal('lbLiveModal');
        renderLiveFeed(trainKey);
      }
    }catch(err){
      console.error('SIGNAL_POST_ERROR', err);
      if (feedback) feedback.textContent = `Échec de publication: ${err?.message || err}`;
      return;
    }finally{
      if (submit) submit.disabled = false;
    }
  }

  async function publishPresence(trainNumber){
    const key = normalizeKey(trainNumber);
    if (!key) return;
    if (!requireCommunityAuthentication() || presenceMutationInFlight) return;
    presenceMutationInFlight = true;
    try{
      setPresenceOptInToday(true);
      const existingPresences = getMyPresencesToday();
      const alreadyInTargetTrain = existingPresences.some((it)=> normalizeKey(it.trainNumber) === key);
      if (alreadyInTargetTrain){
        const cleared = await clearMyPresence();
        if (!cleared) throw new Error('Impossible de retirer la présence actuelle. Réessayez.');
        confirmedPresenceGrace = null;
        return;
      }
      const cleared = await clearMyPresence({ keepOptIn: true });
      if (!cleared) throw new Error('Impossible de changer de train. Réessayez.');
      const accountId = getCurrentPresenceIdentity();
      if (!accountId) throw new Error('Identité du compte indisponible. Rechargez la page.');
      const payload = { message: `[PRESENCE] TER ${key} — ${toIsoDay()}`, scope:'presence', train_number:key, account_id: accountId };
      const res = await window.fetchCommentsApi('', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      let data = null;
      try { data = await res.json(); } catch(_){ }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const confirmed = normalizePresenceItem(data?.comment || data) || normalizePresenceItem({
        id:`confirmed-presence-${Date.now()}`,
        created_at:new Date().toISOString(),
        train_number:key,
        pseudo:window.currentUser?.pseudo || window.currentUser?.username || window.lbPrefsCache?.pseudo || 'Voyageur',
        account_id:accountId
      });
      if (confirmed){
        confirmedPresenceGrace = { item:confirmed, expiresAt:Date.now() + 30000 };
        COMMUNITY.presences = (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : [])
          .filter((item)=> normalizeIdentity(item.accountId) !== normalizeIdentity(accountId));
        COMMUNITY.presences.unshift(confirmed);
        refreshCommunityViews();
        refreshLiveModal();
        window.dispatchEvent(new CustomEvent('lb:community-presence-changed'));
      }
      await loadPresences();
      refreshCommunityViews();
      refreshLiveModal();
      window.dispatchEvent(new CustomEvent('lb:community-presence-changed'));
    }catch(err){
      console.error('PRESENCE_POST_ERROR', err);
      setPresenceOptInToday(false);
      refreshCommunityViews();
      refreshLiveModal();
      window.dispatchEvent(new CustomEvent('lb:community-presence-changed'));
      if (typeof window.lbToast === 'function') window.lbToast(`Présence non enregistrée : ${err?.message || 'API indisponible'}`);
    }finally{
      presenceMutationInFlight = false;
    }
  }

  async function clearMyPresence(options = {}){
    const keepOptIn = !!options.keepOptIn;
    if (!keepOptIn) setPresenceOptInToday(false);
    const mineList = getMyPresencesToday();
    if (!mineList.length) return true;
    try{
      for (const mine of mineList){
        if (!mine.id) continue;
        const deleteRes = await fetchCommentsApi(`/${encodeURIComponent(String(mine.id))}`, { method:'DELETE' });
        if (!deleteRes.ok) throw new Error(`HTTP ${deleteRes.status}`);
      }
    }catch(_){ return false; }
    const mineIds = new Set(mineList.map((it)=> String(it.id)));
    COMMUNITY.presences = (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : []).filter((it)=> !mineIds.has(String(it.id)));
    refreshCommunityViews();
    refreshLiveModal();
    window.dispatchEvent(new CustomEvent('lb:community-presence-changed'));
    return true;
  }

  async function deleteOwnSignal(signalId){
    const sig = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).find((it)=> String(it.id) === String(signalId));
    if (!sig || !isOwnSignal(sig)) return;
    try{
      if (sig.id){
        const res = await window.fetchCommentsApi(`/${encodeURIComponent(String(sig.id))}`, { method:'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    }catch(_){ return; }
    await removeAssociatedWallAlertsForSignal(sig);
    COMMUNITY.signals = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).filter((it)=> String(it.id) !== String(sig.id));
    refreshCommunityViews();
    renderTrainDetail(COMMUNITY.selectedTrain);
    if (typeof window.refreshGamificationUI === 'function') window.refreshGamificationUI({ force: true }).catch(()=>{});
  }

  async function removeAssociatedWallAlertsForSignal(signal, options = {}){
    const ignoreAuthorCheck = !!options.ignoreAuthorCheck;
    const sigType = String(signal?.signalType || '').toLowerCase();
    const trainKey = normalizeKey(signal?.trainNumber);
    const station = String(signal?.station || '').trim().toLowerCase();
    const delayMin = Number(signal?.delayMin || 0);
    const ownIdentity = normalizeIdentity(getCurrentPresenceIdentity());
    if (!trainKey) return;
    if (!['suppression', 'retard'].includes(sigType)) return;
    if (sigType === 'retard' && delayMin < 15) return;

    let wall = Array.isArray(window.lbCommentState?.wall) ? window.lbCommentState.wall : [];
    try{
      const res = await window.fetchCommentsApi('?scope=wall');
      if (res.ok){
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
        wall = list.map(normalizeCommentItem).filter(Boolean);
      }
    }catch(_){}
    const candidates = wall.filter((it)=>{
      if (!it?.id) return false;
      const text = String(it?.text || '').toLowerCase();
      const commentTrain = normalizeKey(it?.trainNumber || detectCommentTrainNumber(it));
      if (commentTrain !== trainKey) return false;
      // Station ignorée pour la suppression mur auto: certains messages mur n'embarquent
      // pas exactement le même libellé d'arrêt, on privilégie train + type (+delay si retard).
      if (sigType === 'suppression' && !/supprim/.test(text)) return false;
      if (sigType === 'retard'){
        const m = text.match(/\+\s*([0-9]{1,3})/);
        if (!m) return false;
        const commentDelay = Number(m[1] || 0);
        if (commentDelay !== delayMin) return false;
      }
      const author = normalizeIdentity(it?.accountId || '');
      if (!ignoreAuthorCheck && author && ownIdentity && author !== ownIdentity) return false;
      return true;
    });
    if (!candidates.length) return;

    for (const item of candidates){
      try{
        await window.fetchCommentsApi(buildCommentDeletePath(item.id, { moderationConfirmed: true }), { method:'DELETE' });
      }catch(_){}
    }
    try { await window.loadMessages?.(); } catch(_){}
  }

  async function postAssociatedWallAlertForSignal(signal){
    const sigType = String(signal?.signalType || '').toLowerCase();
    const trainKey = normalizeKey(signal?.trainNumber);
    const station = String(signal?.station || '').trim();
    const delayMin = Number(signal?.delayMin || 0);
    const accountId = String(signal?.accountId || getCurrentPresenceIdentity() || '').trim();
    if (!trainKey) return;
    if (sigType !== 'suppression' && sigType !== 'retard') return;
    if (sigType === 'retard' && delayMin < 15) return;
    const wallMessage = sigType === 'suppression'
      ? `🚫 <span class="lb-red">${trainKey} supprimé</span> à ${station} · 🐄`
      : `⏱️ ${trainKey} <span class="lb-orange">+${delayMin}</span> à ${station} · 🐄`;
    try{
      await window.fetchCommentsApi('', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          message: wallMessage,
          scope:'wall',
          train_number: trainKey,
          account_id: accountId
        })
      });
      try { await window.loadMessages?.(); } catch(_){}
    }catch(_){}
  }

  function forceHideWallCommentsInFrontForSignal(signal){
    const sigType = String(signal?.signalType || '').toLowerCase();
    const trainKey = normalizeKey(signal?.trainNumber);
    const delayMin = Number(signal?.delayMin || 0);
    if (!trainKey) return;
    if (!['suppression','retard'].includes(sigType)) return;
    if (sigType === 'retard' && delayMin < 15) return;
    const before = Array.isArray(window.lbCommentState?.wall) ? window.lbCommentState.wall : [];
    const filtered = before.filter((it)=>{
      const text = String(it?.text || '').toLowerCase();
      const commentTrain = normalizeKey(it?.trainNumber || detectCommentTrainNumber(it));
      if (commentTrain !== trainKey) return true;
      if (sigType === 'suppression') return !/supprim/.test(text);
      const m = text.match(/\+\s*([0-9]{1,3})/);
      if (!m) return true;
      return Number(m[1] || 0) !== delayMin;
    });
    if (filtered.length === before.length) return;
    if (!window.lbCommentState || typeof window.lbCommentState !== 'object') window.lbCommentState = { wall:[], trains:{} };
    window.lbCommentState.wall = filtered;
    try { window.renderMessages?.(); } catch(_){}
    try { window.renderHomeLiveWall?.(); } catch(_){}
  }

  async function pruneWallAlertsWithoutActiveSignals(){
    let wall = [];
    try{
      const res = await window.fetchCommentsApi('?scope=wall');
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []);
      wall = list.map(normalizeCommentItem).filter(Boolean);
    }catch(_){ return; }
    if (!wall.length) return;

    const toDelete = wall.filter((it)=>{
      if (!it?.id) return false;
      const trainKey = normalizeKey(it?.trainNumber || detectCommentTrainNumber(it));
      if (!trainKey) return false;
      const text = String(it?.text || '').toLowerCase().replace(/<[^>]*>/g, ' ');
      const isSupp = /supprim/.test(text);
      const delayMatch = text.match(/\+\s*([0-9]{1,3})/);
      const delay = delayMatch ? Number(delayMatch[1]) : 0;
      const isMajorDelay = delay >= 15;
      if (!isSupp && !isMajorDelay) return false;
      const active = getSignalsForTrain(trainKey);
      if (!active.length) return true;
      if (isSupp){
        return !active.some((s)=> String(s?.signalType || '').toLowerCase() === 'suppression');
      }
      if (isMajorDelay){
        return !active.some((s)=> String(s?.signalType || '').toLowerCase() === 'retard' && Number(s?.delayMin || 0) >= delay);
      }
      return false;
    });
    if (!toDelete.length) return;
    for (const it of toDelete){
      try{ await window.fetchCommentsApi(buildCommentDeletePath(it.id, { moderationConfirmed: true }), { method:'DELETE' }); }catch(_){}
    }
    try { await window.loadMessages?.(); } catch(_){}
  }

  async function updateSignalInlineFromTrainDetail({ signalId, trainNumber, station, signalType, delayMin } = {}){
    const id = String(signalId || '').trim();
    const trainKey = normalizeKey(trainNumber || COMMUNITY.selectedTrain);
    if (!id || !trainKey) return;
    const type = String(signalType || '').toLowerCase();
    const delay = Number(delayMin || 0);
    if (type === 'retard' && !(delay > 0)) return;
    const label = `TER ${trainKey}`;
    const message = type === 'suppression'
      ? `[SUPPRESSION] ${label}${station ? ` [${station}]` : ''} — Train supprimé à l'arrêt`
      : `[RETARD] ${label}${station ? ` [${station}]` : ''} — Retard +${delay} min`;
    const accountId = getCurrentPresenceIdentity();
	const previousSignal = (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).find((it)=> String(it.id) === id) || null;
    const delRes = await window.fetchCommentsApi(`/${encodeURIComponent(id)}`, { method:'DELETE' });
    if (!delRes.ok) throw new Error('Suppression de l’ancien signalement impossible.');
	if (previousSignal) await removeAssociatedWallAlertsForSignal(previousSignal);
    const postRes = await window.fetchCommentsApi('', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        message,
        scope:'signals',
        train_number: trainKey,
        station: station ? String(station) : '',
        signal_type: type,
        delay_min: type === 'retard' ? delay : null,
        info_tag: null,
        account_id: accountId
      })
    });
    if (!postRes.ok) throw new Error('Publication du nouveau signalement impossible.');
	await postAssociatedWallAlertForSignal({
      signalType: type,
      trainNumber: trainKey,
      station: station ? String(station) : '',
      delayMin: type === 'retard' ? delay : 0,
      accountId
    });
    await loadSignals();
    await renderTrainDetail(trainKey);
    refreshLiveModal();
  }

  document.addEventListener('click', (e)=>{
	if (!e.target.closest('[data-compo-help]')){
      document.querySelectorAll('.lb-live-compo-top.is-open').forEach((node)=> node.classList.remove('is-open'));
    }
    const openLiveBtn = e.target.closest('#lbOpenLiveModal');
    if (openLiveBtn){ e.preventDefault(); openCommunityModal('lbLiveModal'); return; }
    const openSignalBtn = e.target.closest('#lbOpenSignalModal');
    if (openSignalBtn){
      e.preventDefault();
      if (!requireCommunityAuthentication()) return;
      resetSignalEditMode();
      resetSignalDraft();
      openCommunityModal('lbSignalModal');
      return;
    }
    const closeBtn = e.target.closest('[data-lb-community-close]');
    if (closeBtn){ e.preventDefault(); closeCommunityModal(closeBtn.getAttribute('data-lb-community-close')); return; }
    const viewTrainBtn = e.target.closest('[data-lb-view-train]');
    if (viewTrainBtn){
      COMMUNITY.selectedTrain = normalizeKey(viewTrainBtn.getAttribute('data-lb-view-train'));
      renderLiveFeed(COMMUNITY.selectedTrain);
      renderTrainDetail(COMMUNITY.selectedTrain);
      openCommunityModal('lbTrainDetailModal');
      return;
    }
    const signalTrainBtn = e.target.closest('[data-lb-signal-train]');
    if (signalTrainBtn){
      e.preventDefault();
      openSignalForTrain(signalTrainBtn.getAttribute('data-lb-signal-train'));
      return;
    }
    const presenceBtn = e.target.closest('[data-lb-presence-train]');
    if (presenceBtn){
      e.preventDefault();
      publishPresence(presenceBtn.getAttribute('data-lb-presence-train'));
      return;
    }
    const infoQuickBtn = e.target.closest('.lb-info-quick-btn');
    if (infoQuickBtn){
      e.preventDefault();
      COMMUNITY.selectedInfoTag = infoQuickBtn.getAttribute('data-info-tag') || '';
      document.querySelectorAll('.lb-info-quick-btn').forEach((btn)=> btn.classList.toggle('is-selected', btn === infoQuickBtn));
      closeCommunityModal('lbInfoQuickModal');
      const feedback = $id('lbSignalFeedback');
      if (feedback) feedback.textContent = `Information sélectionnée : ${INFO_TAG_LABELS[COMMUNITY.selectedInfoTag] || COMMUNITY.selectedInfoTag}`;
      updateSignalTypeUI();
      return;
    }
	const compoHelpTrigger = e.target.closest('[data-compo-help]');
    if (compoHelpTrigger){
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.lb-live-compo-top.is-open').forEach((node)=>{
        if (node !== compoHelpTrigger) node.classList.remove('is-open');
      });
      compoHelpTrigger.classList.toggle('is-open');
      return;
    }
    const liveCard = e.target.closest('.lb-live-card');
    if (liveCard && !e.target.closest('button,[data-lb-delete-signal]')){
      const trainNo = liveCard.getAttribute('data-lb-live-train');
      COMMUNITY.selectedTrain = normalizeKey(trainNo);
      renderTrainDetail(COMMUNITY.selectedTrain);
      openCommunityModal('lbTrainDetailModal');
      return;
    }
    const deleteSignalChip = e.target.closest('[data-lb-delete-signal]');
    if (deleteSignalChip){
      e.preventDefault();
      deleteOwnSignal(deleteSignalChip.getAttribute('data-lb-delete-signal'));
      return;
    }
    const inlineEditChip = e.target.closest('[data-lb-inline-edit-signal]');
    if (inlineEditChip){
      e.preventDefault();
      const id = inlineEditChip.getAttribute('data-lb-inline-edit-signal');
      document.querySelectorAll('[data-lb-inline-editor]').forEach((el)=>{
        if (el.getAttribute('data-lb-inline-editor') !== String(id || '')) el.hidden = true;
      });
      const editor = document.querySelector(`[data-lb-inline-editor="${String(id || '')}"]`);
      if (editor) editor.hidden = !editor.hidden;
      return;
    }
    const inlineDeleteBtn = e.target.closest('[data-lb-inline-delete]');
    if (inlineDeleteBtn){
      e.preventDefault();
      deleteOwnSignal(inlineDeleteBtn.getAttribute('data-lb-signal-id'));
      return;
    }
    const inlineSaveBtn = e.target.closest('[data-lb-inline-save]');
    if (inlineSaveBtn){
      e.preventDefault();
      const holder = inlineSaveBtn.closest('[data-lb-inline-editor]');
      const type = holder?.querySelector('[data-lb-inline-type]')?.value || 'retard';
      const delay = Number(holder?.querySelector('[data-lb-inline-delay]')?.value || 0);
      updateSignalInlineFromTrainDetail({
        signalId: inlineSaveBtn.getAttribute('data-lb-signal-id'),
        trainNumber: inlineSaveBtn.getAttribute('data-lb-train'),
        station: inlineSaveBtn.getAttribute('data-lb-station'),
        signalType: type,
        delayMin: delay
      }).catch((err)=> console.error('INLINE_SIGNAL_UPDATE_ERROR', err));
      return;
    }
    const voteBtn = e.target.closest('[data-lb-vote-signal]');
    if (voteBtn){
      e.preventDefault();
      submitSignalVote(voteBtn.getAttribute('data-lb-vote-signal'), Number(voteBtn.getAttribute('data-lb-vote-value') || 1));
      return;
    }
    if (e.target.classList.contains('lb-community-modal')){
      closeCommunityModal(e.target.id);
    }
  });

  document.addEventListener('keydown', (e)=>{
    if (e.key !== 'Escape') return;
    const openModals = Array.from(document.querySelectorAll('.lb-community-modal.is-open'));
    const modal = openModals[openModals.length - 1];
    if (!modal) return;
    e.preventDefault();
    closeCommunityModal(modal.id);
  });

  document.addEventListener('change', (e)=>{
    if (e.target && e.target.matches('[data-lb-inline-type]')){
      const holder = e.target.closest('[data-lb-inline-editor]');
      const delaySel = holder?.querySelector('[data-lb-inline-delay]');
      if (delaySel) delaySel.hidden = String(e.target.value || '') !== 'retard';
      return;
    }
    if (e.target && e.target.id === 'lbSignalTrainSelect'){
      const trainKey = normalizeKey(e.target.value);
      COMMUNITY.selectedTrain = trainKey;
      updateSignalStationOptions();
      const stationSelect = $id('lbSignalStationSelect');
      if (!trainKey) return;
      stationSelect?.setAttribute('aria-busy', 'true');
      getLiveTrainStaticInfo(trainKey).then((info)=>{
        if (normalizeKey($id('lbSignalTrainSelect')?.value) !== trainKey) return;
        const train = COMMUNITY.liveTrains.find((it)=> normalizeKey(it.trainNumber) === trainKey);
        const option = $id('lbSignalTrainSelect')?.querySelector(`option[value="${String(trainKey)}"]`);
        if (option && train && info) option.textContent = signalTrainOptionLabel(train, info);
        updateSignalStationOptions();
      }).catch((err)=>{
        console.warn('[SIGNAL horaire train] indisponible', err?.message || err);
      }).finally(()=>{
        stationSelect?.removeAttribute('aria-busy');
      });
      return;
    }
    if (e.target && e.target.id === 'lbLiveDirectionSelect'){
      const next = String(e.target.value || 'all');
      COMMUNITY.liveDirection = ['all','lux_to_nancy','nancy_to_lux'].includes(next) ? next : 'all';
      try{ localStorage.setItem('lbLiveDirectionMode', COMMUNITY.liveDirection); }catch(_){}
      const visible = sortAndFilterLiveTrainsByDirection(COMMUNITY.liveTrains, COMMUNITY.liveDirection);
      if (COMMUNITY.selectedTrain && !visible.some((it)=> normalizeKey(it.trainNumber) === normalizeKey(COMMUNITY.selectedTrain))){
        COMMUNITY.selectedTrain = visible[0]?.trainNumber || '';
      }
      refreshLiveModal();
    }
  });

  document.addEventListener('click', (e)=>{
    const typeBtn = e.target.closest('.lb-signal-type');
    if (!typeBtn) return;
    COMMUNITY.selectedSignalType = typeBtn.getAttribute('data-signal-type') || '';
    document.querySelectorAll('.lb-signal-type').forEach((btn)=> btn.classList.toggle('is-selected', btn === typeBtn));
    if (COMMUNITY.selectedSignalType === 'information'){
      openCommunityModal('lbInfoQuickModal');
    }else{
      COMMUNITY.selectedInfoTag = '';
      document.querySelectorAll('.lb-info-quick-btn').forEach((btn)=> btn.classList.remove('is-selected'));
    }
    updateSignalTypeUI();
  });

  const signalSubmit = $id('lbSignalSubmit');
  if (signalSubmit && !signalSubmit.dataset.bound){
    signalSubmit.dataset.bound = '1';
    signalSubmit.addEventListener('click', publishSignal);
  }

  const originalRenderMessages = window.renderMessages;
  if (typeof originalRenderMessages === 'function' && !window.__lbCommunityRenderWrapped){
    window.__lbCommunityRenderWrapped = true;
    window.renderMessages = function(){
      const out = originalRenderMessages.apply(this, arguments);
      refreshCommunityViews();
      return out;
    };
    window.renderHomeLiveWall = window.renderMessages;
  }

  let communityPollTimer = null;
  let communityPollPromise = null;

  const stopCommunityPolling = () => {
    if (communityPollTimer) clearTimeout(communityPollTimer);
    communityPollTimer = null;
  };

  const runCommunityPoll = () => {
    if (document.hidden || !navigator.onLine) return Promise.resolve([]);
    if (communityPollPromise) return communityPollPromise;
    communityPollPromise = Promise.allSettled([loadSignals(), loadPresences()])
      .finally(() => { communityPollPromise = null; });
    return communityPollPromise;
  };

  const scheduleCommunityPolling = (delayMs = 20000) => {
    stopCommunityPolling();
    if (document.hidden || !navigator.onLine) return;
    communityPollTimer = setTimeout(async () => {
      await runCommunityPoll();
      scheduleCommunityPolling(20000);
    }, Math.max(1000, Number(delayMs) || 20000));
  };

  window.addEventListener('gtfsrt:loaded', ()=>{ refreshCommunityViews(); });
  window.addEventListener('load', ()=>{
    refreshCommunityViews();
    setTimeout(()=>{
      runCommunityPoll().finally(() => scheduleCommunityPolling(20000));
    }, 1000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCommunityPolling();
    else runCommunityPoll().finally(() => scheduleCommunityPolling(20000));
  }, { passive:true });
  window.addEventListener('online', () => runCommunityPoll().finally(() => scheduleCommunityPolling(20000)), { passive:true });
  window.addEventListener('offline', stopCommunityPolling, { passive:true });

  function buildCommunityMapSnapshot(){
    const now = Date.now();
    const presenceCutoff = now - (4 * 60 * 60 * 1000);
    const signalCutoff = now - (45 * 60 * 1000);
    const trains = {};
    const ensureTrain = (trainNumber)=>{
      const key = normalizeKey(trainNumber);
      if (!key) return null;
      if (!trains[key]) trains[key] = { presenceCount:0, travelerDelayMin:null, delayReports:0, lastReportAt:0, travelerStops:{}, isCurrentUserAboard:false };
      return trains[key];
    };

    const presenceIdentities = new Map();
    (Array.isArray(COMMUNITY.presences) ? COMMUNITY.presences : []).forEach((presence)=>{
      const ts = Number(presence?.ts || 0);
      if (!Number.isFinite(ts) || ts < presenceCutoff) return;
      const trainKey = normalizeKey(presence?.trainNumber);
      if (!trainKey) return;
      const identity = normalizeIdentity(presence?.accountId || presence?.pseudo || presence?.id);
      const uniq = `${trainKey}|${identity || String(presence?.id || ts)}`;
      if (!presenceIdentities.has(uniq)) presenceIdentities.set(uniq, presence);
    });
    presenceIdentities.forEach((presence)=>{
      const entry = ensureTrain(presence?.trainNumber);
      if (!entry) return;
      entry.presenceCount += 1;
      if (hasCurrentUserPresence(presence?.trainNumber)) entry.isCurrentUserAboard = true;
    });

    const delaysByTrain = new Map();
    const delaysByStop = new Map();
    const normalizeStopKey = (value)=> String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    (Array.isArray(COMMUNITY.signals) ? COMMUNITY.signals : []).forEach((signal)=>{
      const ts = Number(signal?.ts || 0);
      const delay = Number(signal?.delayMin || 0);
      const score = Number(signal?.upvotes || 0) - Number(signal?.downvotes || 0);
      if (String(signal?.signalType || '').toLowerCase() !== 'retard') return;
      if (!Number.isFinite(ts) || ts < signalCutoff || !(delay > 0) || score <= -3) return;
      const key = normalizeKey(signal?.trainNumber);
      if (!key) return;
      if (!delaysByTrain.has(key)) delaysByTrain.set(key, []);
      delaysByTrain.get(key).push({ delay:Math.round(delay), ts });
      const station = String(signal?.station || '').trim();
      const stopKey = normalizeStopKey(station);
      if (stopKey){
        const scopedKey = `${key}|${stopKey}`;
        if (!delaysByStop.has(scopedKey)) delaysByStop.set(scopedKey, { trainKey:key, stopKey, station, reports:[] });
        delaysByStop.get(scopedKey).reports.push({ delay:Math.round(delay), ts });
      }
    });
    delaysByTrain.forEach((reports, key)=>{
      const entry = ensureTrain(key);
      if (!entry) return;
      const values = reports.map((item)=> item.delay).sort((a,b)=> a-b);
      const middle = Math.floor(values.length / 2);
      entry.travelerDelayMin = values.length % 2
        ? values[middle]
        : Math.round((values[middle - 1] + values[middle]) / 2);
      entry.delayReports = values.length;
      entry.lastReportAt = Math.max(...reports.map((item)=> item.ts));
    });
    delaysByStop.forEach((group)=>{
      const entry = ensureTrain(group.trainKey);
      if (!entry) return;
      const values = group.reports.map((item)=> item.delay).sort((a,b)=> a-b);
      const middle = Math.floor(values.length / 2);
      entry.travelerStops[group.stopKey] = {
        station:group.station,
        delayMin:values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2),
        reports:values.length,
        lastReportAt:Math.max(...group.reports.map((item)=> item.ts))
      };
    });

    Object.keys(trains).forEach((key)=>{
      const item = trains[key];
      if (!(item.presenceCount > 0) && !(item.travelerDelayMin > 0)) delete trains[key];
    });
    return { generatedAt:now, presenceTtlMs:4 * 60 * 60 * 1000, signalTtlMs:45 * 60 * 1000, trains };
  }

  function openSignalAtStop({ trainNumber, station, delayMin } = {}){
    const trainKey = normalizeKey(trainNumber);
    const stop = String(station || '').trim();
    if (!trainKey) return;

    openSignalForTrain(trainKey);
    COMMUNITY.returnToMapAfterSignal = true;
    COMMUNITY.selectedSignalType = 'retard';
    COMMUNITY.selectedInfoTag = '';

    document.querySelectorAll('.lb-signal-type').forEach((button)=>{
      button.classList.toggle('is-selected', button.getAttribute('data-signal-type') === 'retard');
    });

    // On ne recopie volontairement PAS l'ancien retard dans la liste :
    // l'usager doit choisir la nouvelle valeur réellement constatée à cette gare.
    const delaySelect = $id('lbSignalDelaySelect');
    if (delaySelect) delaySelect.value = '';

    const normalizeStation = (value)=> String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

    const applyStation = ()=>{
      const stationSelect = $id('lbSignalStationSelect');
      if (!stationSelect || !stop) return;
      const wanted = normalizeStation(stop);
      const option = Array.from(stationSelect.options).find((item)=> normalizeStation(item.value) === wanted);
      if (option) stationSelect.value = option.value;
    };

    applyStation();
    setTimeout(applyStation, 250);
    setTimeout(applyStation, 700);

    updateSignalTypeUI();
    const previous = Math.max(0, Math.round(Number(delayMin || 0)));
    const feedback = $id('lbSignalFeedback');
    if (feedback) {
      feedback.textContent = stop
        ? `Nouvelle mesure à ${stop}${previous > 0 ? ` · valeur précédente +${previous} min` : ''}. Choisissez le retard constaté puis publiez.`
        : 'Choisissez la nouvelle valeur de retard constatée puis publiez.';
    }
  }

  function selectGpsEstimateInSignalModal({ trainNumber, delayMin, station, accuracy } = {}){
    const trainKey = normalizeKey(trainNumber);
    if (!trainKey) return;
    openSignalForTrain(trainKey);
    const roundedDelay = Math.max(0, Math.min(240, Math.round(Number(delayMin || 0))));
    COMMUNITY.selectedSignalType = roundedDelay > 0 ? 'retard' : 'a-lheure';
    COMMUNITY.selectedInfoTag = '';
    document.querySelectorAll('.lb-signal-type').forEach((button)=>{
      button.classList.toggle('is-selected', button.getAttribute('data-signal-type') === COMMUNITY.selectedSignalType);
    });
    const delaySelect = $id('lbSignalDelaySelect');
    if (delaySelect && roundedDelay > 0){
      let option = Array.from(delaySelect.options).find((item)=> Number(item.value) === roundedDelay);
      if (!option){
        option = document.createElement('option');
        option.value = String(roundedDelay);
        option.textContent = `+${roundedDelay} min (GPS)`;
        option.dataset.lbGpsEstimate = '1';
        delaySelect.appendChild(option);
      }
      delaySelect.value = String(roundedDelay);
    }
    const applyStation = ()=>{
      const stationSelect = $id('lbSignalStationSelect');
      if (!stationSelect || !station) return;
      const wanted = String(station).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const option = Array.from(stationSelect.options).find((item)=>
        String(item.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === wanted
      );
      if (option) stationSelect.value = option.value;
    };
    applyStation();
    setTimeout(applyStation, 350);
    setTimeout(applyStation, 900);
    updateSignalTypeUI();
    const feedback = $id('lbSignalFeedback');
    if (feedback){
      const precision = Number.isFinite(Number(accuracy)) && Number(accuracy) > 0
        ? ` (GPS ±${Math.round(Number(accuracy))} m)`
        : '';
      feedback.textContent = roundedDelay > 0
        ? `Retard estimé : +${roundedDelay} min${precision}. Vérifiez puis publiez pour confirmer.`
        : `Votre position correspond à un train à l'heure${precision}. Vérifiez puis publiez pour confirmer.`;
    }
  }

  window.lbCommunityLive = {
    refresh: refreshCommunityViews,
    openLive: ()=> openCommunityModal('lbLiveModal'),
    openSignal: (trainNumber)=> openSignalForTrain(trainNumber),
    openSignalAt: (context)=> openSignalAtStop(context),
    openSignalEstimate: (estimate)=> selectGpsEstimateInSignalModal(estimate),
    togglePresence: (trainNumber)=> publishPresence(trainNumber),
    getMapSnapshot: ()=> buildCommunityMapSnapshot()
  };
})();

;

(() => {
  const faqModal = document.getElementById('faqModal');
  const faqBtn = document.getElementById('faqBtn');
  const closeFaq = document.getElementById('closeFaq');
  if (!faqModal || !faqBtn || !closeFaq) return;
  faqBtn.addEventListener('click', () => {
    if (typeof faqModal.showModal === 'function') faqModal.showModal();
  });
  closeFaq.addEventListener('click', () => faqModal.close());
})();

;

(() => {
  function lbOpenModal(modal){
    if (!modal) return;
    try{
      if (typeof modal.showModal === 'function') {
        if (!modal.open) modal.showModal();
        return;
      }
    }catch(_){ }
    modal.classList.add('is-open');
    modal.setAttribute('open', '');
    modal.removeAttribute('hidden');
  }

  function lbCloseModal(modal){
    if (!modal) return;
    try{ if (typeof modal.close === 'function' && modal.open) modal.close(); }catch(_){ }
    modal.classList.remove('is-open');
    if (!modal.open) modal.removeAttribute('open');
  }

  window.lbOpenTableLegendModal = function(){
    lbOpenModal(document.getElementById('tableLegendModal'));
  };

  document.addEventListener('click', (event) => {
    const btn = event.target.closest && event.target.closest('#tableLegendBtn');
    if (!btn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.lbOpenTableLegendModal();
  }, true);

  document.addEventListener('click', (event) => {
    const modal = document.getElementById('tableLegendModal');
    if (!modal) return;
    if (event.target && event.target.id === 'closeTableLegend') {
      event.preventDefault();
      lbCloseModal(modal);
      return;
    }
    if (event.target === modal) lbCloseModal(modal);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = document.getElementById('tableLegendModal');
    if (modal && (modal.open || modal.classList.contains('is-open'))) lbCloseModal(modal);
  });
})();

;

(() => {
  function openTrainFromLink(a){
    if (!a) return false;
    const raw = a.dataset.trainNumber || a.textContent || '';
    const match = String(raw).match(/\d{5,6}/);
    if (!match) return false;
    const dateIso = a.dataset.trainDate || document.getElementById('trainDate')?.value || (typeof luxTodayYMD === 'function' ? luxTodayYMD() : '');
    if (typeof window.lbOpenTrainDetail === 'function') {
      window.lbOpenTrainDetail(match[0], dateIso);
      return true;
    }
    return false;
  }

  document.addEventListener('click', (event) => {
    const a = event.target.closest && event.target.closest('#trainInfo a.train-link');
    if (!a) return;
    if (openTrainFromLink(a)){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (!(event.target && event.target.id === 'trainDetailClose')) return;
    const panel = document.getElementById('trainDetailPanel');
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-train-detail-open');
    document.body.classList.remove('lb-train-detail-from-map');
    try{ if (typeof destroyAffChart === 'function') destroyAffChart(); }catch(_){}
  }, true);

  const existing = window.lbOpenTrainDetail;
  if (typeof existing === 'function' && !existing.__lbOverlayWrapped){
    const wrapped = async function(){
      document.body.classList.add('lb-train-detail-open');
      const panel = document.getElementById('trainDetailPanel');
      if (panel) {
        panel.hidden = false;
        panel.setAttribute('aria-hidden', 'false');
      }
      return existing.apply(this, arguments);
    };
    wrapped.__lbOverlayWrapped = true;
    window.lbOpenTrainDetail = wrapped;
  }
})();

;

(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js?v=24').catch((err) => {
        console.warn('[PWA] Service worker non enregistré', err);
      });
    });
  }
})();

;

// === LB QUICK WINS SAFE 2026-04-29 ===
(function(){
  'use strict';

  function ensureToastHost(){
    let host = document.getElementById('lbToastHost');
    if (!host){
      host = document.createElement('div');
      host.id = 'lbToastHost';
      host.className = 'lb-toast-host';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      document.body.appendChild(host);
    }
    return host;
  }

  window.lbToast = window.lbToast || function(message){
    try{
      const host = ensureToastHost();
      const toast = document.createElement('div');
      toast.className = 'lb-toast';
      toast.textContent = String(message || 'Action effectuée');
      host.appendChild(toast);
      window.setTimeout(() => toast.remove(), 3100);
    }catch(e){}
  };

  function setupFaqAccordion(){
    const modal = document.getElementById('faqModal');
    if (!modal) return;
    const items = Array.from(modal.querySelectorAll('.faq-item'));
    items.forEach((item, index) => {
      if (item.dataset.lbAccordionReady === '1') return;
      item.dataset.lbAccordionReady = '1';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
      if (index === 0) item.classList.add('is-open');
      const toggle = () => {
        const willOpen = !item.classList.contains('is-open');
        items.forEach(other => {
          other.classList.remove('is-open');
          other.setAttribute('aria-expanded', 'false');
        });
        if (willOpen){
          item.classList.add('is-open');
          item.setAttribute('aria-expanded', 'true');
        }
      };
      item.addEventListener('click', toggle);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  function setupSoftFeedback(){
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const interactive = target.closest('button, .home-action, .mini-btn, .lb-community-btn, .faq-btn, .bottom-nav__item, .home-fav-row');
      if (interactive && navigator.vibrate){
        try{ navigator.vibrate(12); }catch(err){}
      }

      const signalSubmit = target.closest('#lbSignalSubmit');
      if (signalSubmit && !signalSubmit.disabled) window.lbToast('Signalement en cours d’envoi 🐄');

      const openSignal = target.closest('[data-lb-signal-train], #lbOpenSignalBtn, .lb-community-btn--signal');
      if (openSignal) window.lbToast('Choisis le train et le type de signalement ⚠️');
    }, true);

    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof Element)) return;
      if (form.classList.contains('live-wall-form') || form.closest('.live-wall-form')){
        window.lbToast('Message envoyé à la Voix du Bétail 💬');
      }
    }, true);
  }

  function init(){
    setupFaqAccordion();
    setupSoftFeedback();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

;

(() => {
  'use strict';
  function modal(){ return document.getElementById('tableLegendModal'); }
  function openLegend(){
    const m = modal();
    if (!m) return;
    try { document.body.appendChild(m); } catch(_) {}
    m.hidden = false;
    m.classList.add('is-open');
    m.style.display = 'flex';
    m.style.alignItems = 'center';
    m.style.justifyContent = 'center';
    m.style.position = 'fixed';
    m.style.inset = '0';
    m.style.zIndex = '6000';
    try { if (typeof m.showModal === 'function' && !m.open) m.showModal(); else m.setAttribute('open', ''); } catch(_) { m.setAttribute('open', ''); }
  }
  function closeLegend(){
    const m = modal();
    if (!m) return;
    try { if (typeof m.close === 'function' && m.open) m.close(); } catch(_) {}
    m.classList.remove('is-open');
    m.style.display = '';
    if (!m.open) m.removeAttribute('open');
  }
  window.lbOpenTableLegendModal = openLegend;
  window.lbCloseTableLegendModal = closeLegend;
  function handleLegendEvent(e){
    const btn = e.target && e.target.closest ? e.target.closest('#tableLegendBtn, .table-legend-btn') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    openLegend();
  }
  document.addEventListener('pointerdown', handleLegendEvent, true);
  document.addEventListener('click', handleLegendEvent, true);
  document.addEventListener('touchend', handleLegendEvent, true);
  document.addEventListener('click', (e) => {
    const m = modal();
    if (!m) return;
    if (e.target && (e.target.id === 'closeTableLegend' || e.target.closest?.('#closeTableLegend'))) { e.preventDefault(); e.stopPropagation(); closeLegend(); return; }
    if (e.target === m) closeLegend();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLegend(); }, true);
})();

;

(() => {
  'use strict';
  function normalizeLiveCauses(root=document){
    const causes = root.querySelectorAll ? root.querySelectorAll('.lb-live-sncf-cause') : [];
    causes.forEach(cause => {
      const card = cause.closest('.lb-live-card');
      if (!card) return;
      const top = card.querySelector('.lb-live-card-top');
      if (!top) return;
      cause.classList.add('lb-live-sncf-cause--full');
      if (cause.parentElement && cause.parentElement.classList.contains('lb-live-right')) {
        top.insertAdjacentElement('afterend', cause);
      }
    });
  }
  const run = () => normalizeLiveCauses(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {once:true});
  else run();
  try{
    new MutationObserver(() => normalizeLiveCauses(document)).observe(document.body,{childList:true,subtree:true});
  }catch(_){ }
})();

;

(function(){
  'use strict';
  const TARGET = '#home [data-home-animated], #home .is-updating, #home .is-state-changed, #home .is-severity-up';
  let queued = false;
  function cleanHomeAnimationFlags(){
    queued = false;
    document.querySelectorAll(TARGET).forEach(function(el){
      el.removeAttribute('data-home-animated');
      el.classList.remove('is-updating', 'is-state-changed', 'is-severity-up');
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
  }
  function queueClean(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(cleanHomeAnimationFlags);
  }
  function init(){
    cleanHomeAnimationFlags();
    const home = document.getElementById('home');
    if (!home) return;
    const mo = new MutationObserver(queueClean);
    mo.observe(home, { childList:true, subtree:true, attributes:true, attributeFilter:['class','data-home-animated'] });
    window.addEventListener('hashchange', queueClean);
    window.addEventListener('pageshow', queueClean);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();

;

(() => {
  function activatePrefsTab(name){
    document.querySelectorAll('[data-lb-pref-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.lbPrefTab === name);
    });
    document.querySelectorAll('[data-lb-pref-panel]').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.lbPrefPanel === name);
    });
  }
  document.addEventListener('click', (event) => {
    const btn = event.target.closest?.('[data-lb-pref-tab]');
    if (!btn) return;
    event.preventDefault();
    activatePrefsTab(btn.dataset.lbPrefTab || 'lists');
  });
  window.lbActivatePrefsTab = activatePrefsTab;
})();

;

(() => {
  const PUSH_API_BASE = 'https://vps.labetaillere.fr/api/push';
  const LS_SETTINGS = 'lbPushAlertSettings.v1';

  const $ = (id) => document.getElementById(id);

  function readSettings(){
    try {
      return Object.assign({ favorites: true, trafficSevere: true }, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'));
    } catch (_) {
      return { favorites: true, trafficSevere: true };
    }
  }

  function saveSettings(settings){
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      favorites: !!settings.favorites,
      trafficSevere: !!settings.trafficSevere
    }));
  }

  function setMsg(message, isError = false){
    const el = $('lbAlertsMsg');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', !!isError);
  }

  function setState(active){
    const st = $('lbAlertsState');
    if (!st) return;
    st.textContent = active ? 'BÊTA ACTIVE' : 'BÊTA';
    st.classList.toggle('is-on', !!active);
    st.classList.toggle('is-off', !active);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  function isAuthed(){
    return !!(window.lbIsAuthed || window.currentUser || window.lbCurrentUser);
  }

  async function getRegistration(){
    if (!('serviceWorker' in navigator)) throw new Error('Service worker non supporté sur ce navigateur.');
    return navigator.serviceWorker.ready;
  }

  async function refreshAlertsUi(){
    const box = $('lbAlertsBox');
    if (!box) return;
    box.classList.toggle('is-visible', isAuthed());

    const settings = readSettings();
    if ($('lbAlertFavs')) $('lbAlertFavs').checked = !!settings.favorites;
    if ($('lbAlertTraffic')) $('lbAlertTraffic').checked = !!settings.trafficSevere;

    if (!isAuthed()) {
      setState(false);
      return;
    }

    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(!!sub && Notification.permission === 'granted');
    } catch (_) {
      setState(false);
    }
  }

  async function saveSubscriptionToVps(subscription){
    const settings = readSettings();
    const res = await fetch(`${PUSH_API_BASE}/subscribe`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription,
        settings: {
          favorites: !!settings.favorites,
          trafficSevere: !!settings.trafficSevere
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Abonnement push refusé par le VPS.');
    return data;
  }

  window.lbEnablePushNotifications = async function lbEnablePushNotifications(){
    try {
      setMsg('Préparation des Alertes Bétaillère bêta…');

      if (!isAuthed()) throw new Error('Connecte-toi d’abord à ton compte La Bétaillère.');
      if (!('Notification' in window)) throw new Error('Notifications non supportées sur ce navigateur.');
      if (!('PushManager' in window)) throw new Error('PushManager non supporté sur ce navigateur.');
      if (Notification.permission === 'denied') throw new Error('Notifications bloquées dans les réglages du navigateur.');

      let permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications non autorisées.');

      const reg = await getRegistration();
      const keyRes = await fetch(`${PUSH_API_BASE}/public-key`, { credentials: 'include' });
      if (!keyRes.ok) throw new Error('Impossible de récupérer la clé push publique.');
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error('Clé push publique vide côté VPS.');

      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      await saveSubscriptionToVps(subscription);
      setMsg('✅ Appareil inscrit à la phase de test notifications. Certaines alertes peuvent encore être ajustées.');
      setState(true);
    } catch (err) {
      console.warn('[Alertes Bétaillère] activation impossible', err);
      setMsg('❌ ' + (err?.message || 'Erreur activation notifications.'), true);
      alert(err?.message || 'Erreur activation notifications.');
      setState(false);
    }
  };

  window.lbDisablePushNotifications = async function lbDisablePushNotifications(){
    try {
      setMsg('Désactivation sur cet appareil…');
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const subscription = reg ? await reg.pushManager.getSubscription() : null;

      if (subscription) {
        try {
          await fetch(`${PUSH_API_BASE}/unsubscribe`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription })
          });
        } catch (_) {}
        await subscription.unsubscribe();
      }

      setState(false);
      setMsg('✅ Alertes désactivées sur cet appareil.');
    } catch (err) {
      console.warn('[Alertes Bétaillère] désactivation impossible', err);
      setMsg('❌ ' + (err?.message || 'Erreur désactivation.'), true);
    }
  };

  window.lbSendTestPush = async function lbSendTestPush(){
    try {
      setMsg('Envoi de la notification test…');
      if (!isAuthed()) throw new Error('Connecte-toi d’abord à ton compte La Bétaillère.');
      const res = await fetch(`${PUSH_API_BASE}/test`, { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Erreur envoi notification test.');
      setMsg(`✅ Notif test envoyée : ${data.sent || 0} appareil(s).`);
      if (!data.sent) alert('Aucun appareil enregistré. Clique d’abord sur “Activer”.');
    } catch (err) {
      console.warn('[Alertes Bétaillère] test impossible', err);
      setMsg('❌ ' + (err?.message || 'Erreur notification test.'), true);
      alert(err?.message || 'Erreur notification test.');
    }
  };

  function bindAlertsUi(){
    const favs = $('lbAlertFavs');
    const traffic = $('lbAlertTraffic');
    const saveAndMaybeSync = async () => {
      const settings = { favorites: favs?.checked !== false, trafficSevere: traffic?.checked !== false };
      saveSettings(settings);
      setMsg('Préférences alertes enregistrées sur cet appareil.');
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) await saveSubscriptionToVps(sub);
      } catch (_) {}
    };
    favs?.addEventListener('change', saveAndMaybeSync);
    traffic?.addEventListener('change', saveAndMaybeSync);

    $('lbBtnEnableAlerts')?.addEventListener('click', window.lbEnablePushNotifications);
    $('lbBtnEnableAlertsPrompt')?.addEventListener('click', window.lbEnablePushNotifications);
    $('lbBtnDisableAlerts')?.addEventListener('click', window.lbDisablePushNotifications);
    $('lbBtnTestAlerts')?.addEventListener('click', window.lbSendTestPush);

    refreshAlertsUi();
    if (!window.__lbAlertsUiTimer) {
      const scheduleAlertsRefresh = () => {
        clearTimeout(window.__lbAlertsUiTimer);
        window.__lbAlertsUiTimer = null;
        if (document.hidden) return;
        window.__lbAlertsUiTimer = setTimeout(async () => {
          await refreshAlertsUi();
          scheduleAlertsRefresh();
        }, 30000);
      };
      window.__lbScheduleAlertsRefresh = scheduleAlertsRefresh;
      scheduleAlertsRefresh();
    }
  }

  document.addEventListener('DOMContentLoaded', bindAlertsUi);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (window.__lbAlertsUiTimer) clearTimeout(window.__lbAlertsUiTimer);
      window.__lbAlertsUiTimer = null;
      return;
    }
    refreshAlertsUi().finally(() => window.__lbScheduleAlertsRefresh?.());
  }, { passive:true });
  document.addEventListener('click', (e) => {
    if (e.target && (e.target.id === 'bottomAccountBtn' || e.target.id === 'lbBtnSubmit')) {
      setTimeout(refreshAlertsUi, 400);
      setTimeout(refreshAlertsUi, 1500);
    }
  });

  const mo = new MutationObserver(() => {
    const msg = $('lbAuthMsg');
    const prompt = $('lbAlertsRegisterPrompt');
    if (!msg || !prompt) return;
    const txt = String(msg.textContent || '');
    const shouldShow = /Compte créé|Connecté/i.test(txt) && isAuthed();
    prompt.classList.toggle('is-visible', shouldShow && Notification.permission !== 'granted');
    refreshAlertsUi();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const msg = $('lbAuthMsg');
    if (msg) mo.observe(msg, { childList: true, subtree: true, characterData: true });
  });
})();

;

(() => {
  'use strict';

  const STATIC_TRAIN_API = 'https://vps.labetaillere.fr/api/train-static';
  const RECENT_KEY = 'lbTrainFinderRecent.v1';
  const state = {
    trainNumber: '',
    dateIso: '',
    origin: '',
    requestId: 0,
    lastBundle: null
  };

  const byId = (id) => document.getElementById(id);
  const safe = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
  const normalizeTrainNumber = (value) => {
    const match = String(value || '').replace(/\s+/g, '').match(/\d{4,6}/);
    return match ? match[0] : '';
  };
  const todayIso = () => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Luxembourg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (_) {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  };
  const formatDate = (dateIso) => {
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Luxembourg',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(new Date(`${dateIso}T12:00:00`));
    } catch (_) {
      return dateIso;
    }
  };
  const formatTime = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 3) return '—';
    const normalized = digits.padStart(4, '0');
    return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
  };
  const timeToMinutes = (value) => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return (Number(match[1]) * 60) + Number(match[2]);
  };
  const addMinutes = (value, delta) => {
    const minutes = timeToMinutes(value);
    if (!Number.isFinite(minutes)) return value || '—';
    const total = ((minutes + Number(delta || 0)) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  const scheduleDelayMinutes = (baseValue, amendedValue) => {
    const base = timeToMinutes(formatTime(baseValue));
    let amended = timeToMinutes(formatTime(amendedValue));
    if (!Number.isFinite(base) || !Number.isFinite(amended)) return null;
    if (amended < base - 12 * 60) amended += 24 * 60;
    const delay = amended - base;
    return Number.isFinite(delay) ? delay : null;
  };
  const uniqueTexts = (values) => {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter((value) => {
        if (!value) return false;
        const key = value.toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const durationLabel = (departure, arrival) => {
    const start = timeToMinutes(departure);
    let end = timeToMinutes(arrival);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
    if (end < start) end += 1440;
    const duration = Math.max(0, end - start);
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    if (!hours) return `${minutes} min`;
    if (!minutes) return `${hours} h`;
    return `${hours} h ${String(minutes).padStart(2, '0')}`;
  };
  const loadStoredList = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(normalizeTrainNumber).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  };
  const saveStoredList = (key, values) => {
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(new Set(values.map(normalizeTrainNumber).filter(Boolean)))));
    } catch (_) {}
  };
  const corridorStopMap = () => {
    const map = new Map();
    try {
      if (typeof garesParLigne !== 'undefined' && Array.isArray(garesParLigne)) {
        garesParLigne.forEach((stop) => {
          if (stop?.code && stop?.nom) map.set(String(stop.code), String(stop.nom));
        });
      }
    } catch (_) {}
    return map;
  };

  function setFinderStatus(message, type = '') {
    const element = byId('lbTrainFinderStatus');
    if (!element) return;
    element.textContent = message || '';
    element.classList.remove('is-error', 'is-loading', 'is-success');
    if (type) element.classList.add(`is-${type}`);
  }

  function renderRecentSearches() {
    const host = byId('lbTrainFinderRecent');
    if (!host) return;
    const recent = loadStoredList(RECENT_KEY).slice(0, 6);
    host.innerHTML = recent.map((number) => (
      `<button type="button" data-lb-train-recent="${safe(number)}">${safe(number)}</button>`
    )).join('');
  }

  function rememberTrain(number) {
    const normalized = normalizeTrainNumber(number);
    if (!normalized) return;
    const next = [normalized, ...loadStoredList(RECENT_KEY).filter((item) => item !== normalized)].slice(0, 6);
    saveStoredList(RECENT_KEY, next);
    renderRecentSearches();
  }

  function favoritePrefs() {
    const prefs = window.lbPrefsCache || {};
    return {
      morning: normalizeTrainNumber(
        prefs.favoriteMorningTrain || byId('lbFavMorning')?.value || ''
      ),
      evening: normalizeTrainNumber(
        prefs.favoriteEveningTrain || byId('lbFavEvening')?.value || ''
      )
    };
  }

  function isFavorite(number) {
    const normalized = normalizeTrainNumber(number);
    if (!normalized) return false;
    const prefs = favoritePrefs();
    return prefs.morning === normalized || prefs.evening === normalized;
  }

  function favoriteSlotFor(number) {
    const normalized = normalizeTrainNumber(number);
    const prefs = favoritePrefs();
    if (prefs.morning === normalized && prefs.evening === normalized) return 'matin et soir';
    if (prefs.morning === normalized) return 'matin';
    if (prefs.evening === normalized) return 'soir';
    return '';
  }

  function updateProfileTitle(number) {
    const normalized = normalizeTrainNumber(number);
    const title = byId('trainDetailTitle');
    if (!title || !normalized) return;
    title.textContent = `Bétaillère ${normalized}`;
    title.title = `Bétaillère ${normalized}`;
  }

  async function ensureProfileTitle(number) {
    updateProfileTitle(number);
  }

  function inferredFavoriteSlot() {
    const first = state.lastBundle?.rows?.[0] || null;
    const departure = first?.departure || first?.arrival || '';
    const minutes = timeToMinutes(departure);
    return Number.isFinite(minutes) && minutes >= 12 * 60 ? 'evening' : 'morning';
  }

  function refreshFavoriteButton() {
    const button = byId('trainDetailFavorite');
    if (!button) return;
    const selected = !!state.trainNumber && isFavorite(state.trainNumber);
    const slot = selected ? favoriteSlotFor(state.trainNumber) : '';
    button.textContent = selected ? '★' : '☆';
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.setAttribute('aria-label', selected
      ? `Retirer cette bétaillère des favoris ${slot}`
      : 'Ajouter cette bétaillère aux favoris du compte');
    button.title = selected
      ? `Favori ${slot} dans Mes préférences`
      : 'Ajouter aux favoris de Mes préférences';
  }

  async function toggleFavorite() {
    const number = normalizeTrainNumber(state.trainNumber);
    if (!number) return;
    if (window.lbIsAuthed !== true || typeof window.lbSaveFavoriteTrains !== 'function') {
      if (typeof window.lbToast === 'function') {
        window.lbToast('Connecte-toi pour enregistrer tes favoris.');
      }
      byId('lbBtnOpenAuth')?.click();
      return;
    }

    const button = byId('trainDetailFavorite');
    if (button?.dataset.saving === '1') return;
    if (button) {
      button.dataset.saving = '1';
      button.disabled = true;
    }

    const prefs = favoritePrefs();
    let morning = prefs.morning;
    let evening = prefs.evening;
    let addedSlot = '';
    const alreadyMorning = morning === number;
    const alreadyEvening = evening === number;

    if (alreadyMorning || alreadyEvening) {
      if (alreadyMorning) morning = '';
      if (alreadyEvening) evening = '';
    } else {
      let slot = inferredFavoriteSlot();
      if (slot === 'morning' && !morning) {
        morning = number;
      } else if (slot === 'evening' && !evening) {
        evening = number;
      } else if (!morning) {
        slot = 'morning';
        morning = number;
      } else if (!evening) {
        slot = 'evening';
        evening = number;
      } else {
        const oldNumber = slot === 'morning' ? morning : evening;
        const slotLabel = slot === 'morning' ? 'matin' : 'soir';
        const replace = window.confirm(
          `Remplacer le favori ${slotLabel} ${oldNumber} par la bétaillère ${number} ?`
        );
        if (!replace) {
          if (button) {
            button.dataset.saving = '0';
            button.disabled = false;
          }
          return;
        }
        if (slot === 'morning') morning = number;
        else evening = number;
      }
      addedSlot = slot === 'morning' ? 'matin' : 'soir';
    }

    try {
      await window.lbSaveFavoriteTrains({ morning, evening });
      refreshFavoriteButton();
      if (typeof window.lbToast === 'function') {
        window.lbToast(alreadyMorning || alreadyEvening
          ? `Bétaillère ${number} retirée de Mes préférences`
          : `Bétaillère ${number} enregistrée comme favori ${addedSlot}`);
      }
    } catch (error) {
      if (typeof window.lbToast === 'function') {
        window.lbToast(error?.message || 'Impossible d’enregistrer ce favori.');
      }
    } finally {
      if (button) {
        button.dataset.saving = '0';
        button.disabled = false;
      }
      refreshFavoriteButton();
    }
  }

  function reliabilityColor(percent) {
    if (percent == null || percent === '') return '#7cf7ff';
    const value = Number(percent);
    if (!Number.isFinite(value)) return '#7cf7ff';
    return window.lbPunctualityColor(value);
  }

  function paintReliabilityDonut(percent) {
    const donut = byId('trainDetailReliabilityDonut');
    if (!donut) return;
    const value = Number(percent);
    const valid = Number.isFinite(value);
    const bounded = valid ? Math.max(0, Math.min(100, value)) : 0;
    const color = reliabilityColor(valid ? bounded : null);
    const angle = bounded * 3.6;
    donut.style.setProperty('--lb-reliability-color', color);
    donut.style.background =
      `conic-gradient(${color} ${angle}deg,#173743 ${angle}deg)`;
    donut.style.boxShadow = valid
      ? `0 0 22px color-mix(in srgb, ${color} 22%, transparent)`
      : '0 0 20px rgba(0,240,255,.09)';
  }

  function resetProfile(number, dateIso) {
    const panel = byId('trainDetailPanel');
    if (!panel) return;
    // La fiche doit vivre au niveau du body : sinon, depuis Accueil/Favoris,
    // un contexte d'empilement parent peut la maintenir derrière le voile.
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.setAttribute('aria-busy', 'true');
    document.body.classList.add('lb-train-detail-open');
    updateProfileTitle(number);
    void ensureProfileTitle(number);
    byId('trainDetailDateLabel').textContent = formatDate(dateIso);
    byId('trainDetailSourceState').className = 'lb-train-profile__source is-loading';
    byId('trainDetailSourceState').innerHTML = '<i></i> SYNCHRONISATION';
    byId('trainDetailDeparture').textContent = '—';
    byId('trainDetailArrival').textContent = '—';
    byId('trainDetailOrigin').textContent = '—';
    byId('trainDetailDestination').textContent = '—';
    byId('trainDetailDuration').textContent = '—';
    byId('trainDetailPlatform').textContent = 'Voie —';
    byId('trainDetailNext').textContent = 'Récupération des horaires et du temps réel…';
    const disruption = byId('trainDetailDisruption');
    if (disruption) {
      disruption.hidden = true;
      disruption.className = 'lb-train-profile__disruption';
      disruption.innerHTML = '';
    }
    byId('trainDetailLiveStatus').className = 'lb-train-profile__status is-unknown';
    byId('trainDetailLiveStatus').innerHTML = '<i></i> CHARGEMENT';
    byId('trainDetailPath').textContent = 'Chargement…';
    byId('trainDetailRouteMode').textContent = 'HORAIRES';
    byId('trainDetailStops').innerHTML = '<div class="lb-train-profile__empty">Récupération du parcours…</div>';
    byId('trainDetailCompo').textContent = 'Chargement…';
    byId('trainDetailDrawing').className = 'lb-train-profile__drawing is-loading';
    byId('trainDetailDrawing').innerHTML = '';
    byId('trainDetailDrawing').setAttribute('aria-label', 'Schéma de la composition en cours de chargement');
    byId('trainDetailCompoStats').innerHTML = '<span><b>—</b> UNITÉ</span><span><b>—</b> VOITURES</span><span><b>—</b> PLACES ENV.</span>';
    byId('trainDetailCompoMeta').textContent = 'Récupération de Compotrains.json…';
    byId('trainDetailCompoConfidence').textContent = 'ESTIMATION';
    byId('trainDetailCompoConfidence').classList.add('is-estimated');
    byId('trainDetailAffluence').textContent = '—';
    byId('trainDetailAffluence').className = 'is-green';
    byId('trainDetailAffluenceLabel').textContent = '—';
    byId('trainDetailAffluenceBar').className = 'is-green';
    byId('trainDetailAffluenceBar').style.width = '0%';
    byId('trainDetailAffluenceDetails').innerHTML = '<div class="train-detail-aff-empty">Chargement…</div>';
    byId('trainDetailReliability').textContent = '—';
    byId('trainDetailReliabilitySample').textContent = '—';
    byId('trainDetailReliabilityDetails').textContent = 'Chargement…';
    byId('trainDetailReliabilityRuns').innerHTML = '';
    paintReliabilityDonut(null);
    byId('trainDetailMessage').textContent = '';
    byId('trainDetailMessage').classList.remove('is-error');
    refreshFavoriteButton();
  }

  async function loadLiveBundle(number, dateIso, forceFresh) {
    if (dateIso !== todayIso()) return null;

    // La fiche réutilise la même source SNCF que les favoris. C'est elle qui
    // connaît le parcours réellement exploité lorsqu'un train part de
    // Thionville ou y devient terminus à la suite d'une suppression partielle.
    const hubPromise = (async () => {
      try {
        if (typeof window.fetchVehicleJourneyViaHub === 'function') {
          const response = await window.fetchVehicleJourneyViaHub(dateIso, number, {
            client: 'front-fiche-train',
            timeoutMs: 15000
          });
          return response?.ok ? response.data : null;
        }
        if (typeof window.vpsVehicleJourneyUrl === 'function' && typeof window.fetchJSON === 'function') {
          const response = await window.fetchJSON(
            window.vpsVehicleJourneyUrl(dateIso, number),
            { client: 'front-fiche-train', timeoutMs: 15000 }
          );
          return response?.ok ? response.data : null;
        }
      } catch (error) {
        console.warn('[Fiche Bétaillère] source favoris indisponible', error);
      }
      return null;
    })();

    const gtfsPromise = (async () => {
      try {
        if (typeof loadGtfsRetards === 'function') {
          await loadGtfsRetards({ forceFresh: !!forceFresh, useCachedFirst: !forceFresh });
        }
      } catch (error) {
        console.warn('[Fiche Bétaillère] temps réel indisponible', error);
      }
    })();

    const [hubData] = await Promise.all([hubPromise, gtfsPromise]);

    let extracted = null;
    try {
      if (typeof window.extractLiveTrains === 'function') {
        extracted = window.extractLiveTrains().find((train) => (
          normalizeTrainNumber(train?.trainNumber) === number
        )) || null;
      }
    } catch (_) {}

    const bucket = window.retardsGTFS && typeof window.retardsGTFS === 'object'
      ? (window.retardsGTFS[number] || null)
      : null;
    let meta = {};
    try {
      meta = (typeof getGtfsTrainMeta === 'function' && bucket)
        ? getGtfsTrainMeta(bucket)
        : {};
    } catch (_) {}

    const journey = Array.isArray(hubData?.vehicle_journeys)
      ? (hubData.vehicle_journeys[0] || null)
      : null;
    const impacted = {};
    if (hubData?.impacted && typeof hubData.impacted === 'object') {
      Object.assign(impacted, hubData.impacted);
    }
    (Array.isArray(hubData?.disruptions) ? hubData.disruptions : []).forEach((disruption) => {
      (Array.isArray(disruption?.impacted_objects) ? disruption.impacted_objects : []).forEach((object) => {
        (Array.isArray(object?.impacted_stops) ? object.impacted_stops : []).forEach((stop) => {
          const stopId = String(stop?.stop_point?.id || '').trim();
          if (stopId) impacted[stopId] = stop;
        });
      });
    });

    const hubStops = Array.isArray(journey?.stop_times)
      ? journey.stop_times.map((stop) => String(stop?.stop_point?.name || '').trim()).filter(Boolean)
      : [];
    const stops = hubStops.length
      ? hubStops
      : (extracted?.stops?.length
        ? extracted.stops.slice()
        : (bucket ? Object.keys(bucket).filter((key) => !key.startsWith('__')) : []));

    const disruptions = Array.isArray(hubData?.disruptions) ? hubData.disruptions : [];
    const disruptionText = JSON.stringify(disruptions).toLowerCase();
    const rawCanceledStops = [
      ...(Array.isArray(extracted?.raw?.canceled_stops) ? extracted.raw.canceled_stops : []),
      ...(Array.isArray(extracted?.raw?.canceledStops) ? extracted.raw.canceledStops : []),
      ...(Array.isArray(meta?.canceled_stops) ? meta.canceled_stops : [])
    ].map((stop) => String(stop?.name || stop?.stop_name || stop || '').trim()).filter(Boolean);
    const canceledStopKeys = new Set(rawCanceledStops.map(normalizeStopKey).filter(Boolean));
    const gtfsClearlyRunning = !!(bucket
      && typeof isGtfsTrainClearlyRunning === 'function'
      && isGtfsTrainClearlyRunning(bucket));
    const hasDeletedStop = Object.values(impacted).some((stop) => (
      stop?.stop_time_effect === 'deleted'
      || stop?.arrival_status === 'deleted'
      || stop?.departure_status === 'deleted'
    ));
    const normalizedHubRows = journey
      ? normalizeJourneyRows({ journey, trainId: String(journey?.id || '') })
      : [];
    const checkedHubRows = normalizedHubRows.length
      ? applyEffectiveServicePattern(normalizedHubRows, {
          journey,
          impacted,
          bucket,
          number,
          canceledStopKeys
        })
      : [];
    const allStopsDeleted = checkedHubRows.length > 0
      && checkedHubRows.every((row) => row.isDeleted);
    let rawStatus = String(extracted?.raw?.status || meta?.status || '').toUpperCase();
    if (!gtfsClearlyRunning) {
      const statusSaysCanceled = /NO_SERVICE|CANCEL|SUPPR/.test(rawStatus);
      if (!statusSaysCanceled && allStopsDeleted) {
        rawStatus = 'CANCELED';
      } else if (!statusSaysCanceled && (hasDeletedStop || canceledStopKeys.size > 0)) {
        rawStatus = 'PARTIAL';
      } else if (!rawStatus && (
        /no_service|cancell|trip canceled|train[^.]{0,60}supprim|circulation[^.]{0,60}supprim/.test(disruptionText)
      )) {
        rawStatus = 'CANCELED';
      }
    }

    const stopDelays = stops.map((stop) => {
      let delay = null;
      try {
        if (typeof getGtfsDelayForStop === 'function') delay = getGtfsDelayForStop(number, stop);
      } catch (_) {}
      if (!Number.isFinite(Number(delay)) && bucket) delay = Number(bucket[stop]);
      return Number.isFinite(Number(delay)) ? Number(delay) : 0;
    });
    const hubDelays = [
      ...Object.values(impacted),
      ...(Array.isArray(journey?.stop_times) ? journey.stop_times : [])
    ].map((stop) => {
      const explicit = Number(stop?.delay_minutes ?? stop?.delay);
      if (Number.isFinite(explicit)) return explicit;
      for (const leg of ['departure', 'arrival']) {
        const delay = scheduleDelayMinutes(
          stop?.[`base_${leg}_time`] || stop?.[`${leg}_time`],
          stop?.[`amended_${leg}_time`]
        );
        if (Number.isFinite(delay)) return delay;
      }
      return 0;
    });
    const gtfsMaxDelay = Math.max(0, Number(extracted?.maxDelay || 0), ...stopDelays);
    const hubMaxDelay = Math.max(0, ...hubDelays);
    // Même règle que le tableau : un GTFS-RT explicite à zéro neutralise
    // les anciens retards SNCF qui peuvent rester momentanément en cache.
    const maxDelay = gtfsClearlyRunning
      ? gtfsMaxDelay
      : Math.max(gtfsMaxDelay, hubMaxDelay);
    if (!bucket && !extracted && !journey) return null;

    const gtfsCauses = uniqueTexts([extracted?.sncfCause]);
    const sncfCauses = [];
    disruptions.forEach((disruption) => {
      const cause = String(disruption?.cause || '').trim();
      if (cause) sncfCauses.push(cause);
      (Array.isArray(disruption?.messages) ? disruption.messages : []).forEach((message) => {
        const text = String(message?.text || '').trim();
        if (text) sncfCauses.push(text);
      });
    });
    Object.values(impacted).forEach((stop) => {
      const cause = String(stop?.cause || stop?.reason || '').trim();
      if (cause) sncfCauses.push(cause);
    });
    const causes = uniqueTexts([...gtfsCauses, ...sncfCauses]);

    return {
      number,
      bucket,
      meta,
      extracted,
      raw: extracted?.raw || null,
      hubData,
      journey,
      impacted,
      canceledStopKeys,
      trainId: String(extracted?.raw?.train_id || meta?.train_id || journey?.id || ''),
      status: rawStatus,
      stops,
      maxDelay,
      causes,
      cause: causes[0] || '',
      causeSource: gtfsCauses.length ? 'GTFS-RT' : (sncfCauses.length ? 'API SNCF' : '')
    };
  }

  async function fetchStaticCandidates(number, dateIso) {
    const params = new URLSearchParams({
      date: String(dateIso || '').replace(/-/g, ''),
      train: number
    });
    const response = await fetch(`${STATIC_TRAIN_API}?${params.toString()}`, {
      cache: 'default'
    });
    if (!response.ok) throw new Error(`Horaires indisponibles (HTTP ${response.status})`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.stop_times) ? payload.stop_times : [];
    if (!rows.length) return [];
    const groups = new Map();
    rows.forEach((row) => {
      const tripId = String(row?.trip_id || 'inconnu');
      if (!groups.has(tripId)) groups.set(tripId, []);
      groups.get(tripId).push(row);
    });
    return Array.from(groups.entries()).map(([tripId, groupRows]) => ({
      tripId,
      rows: groupRows.slice().sort((a, b) => Number(a?.stop_sequence || 0) - Number(b?.stop_sequence || 0))
    }));
  }

  function stopNameFromRow(row, index, liveStops, stopMap) {
    const explicit = String(row?.stop_name || row?.name || '').trim();
    if (explicit) return explicit;
    const stopId = String(row?.stop_id || '');
    const digits = stopId.match(/(\d{8})/);
    if (digits && stopMap.has(digits[1])) return stopMap.get(digits[1]);
    if (Array.isArray(liveStops) && liveStops[index]) return String(liveStops[index]);
    return stopId
      .replace(/^StopPoint:OCETrain TER-/, '')
      .replace(/^StopPoint:[^-]*-/, '')
      .trim() || `Arrêt ${index + 1}`;
  }

  function normalizeStaticRows(candidate, liveBundle) {
    const stopMap = corridorStopMap();
    const liveStops = liveBundle?.stops || [];
    return (candidate?.rows || []).map((row, index) => ({
      tripId: candidate.tripId,
      name: stopNameFromRow(row, index, liveStops, stopMap),
      arrival: formatTime(row?.arrival_time),
      departure: formatTime(row?.departure_time),
      sequence: Number(row?.stop_sequence || index),
      raw: row
    }));
  }

  function normalizeJourneyRows(liveBundle) {
    const rows = Array.isArray(liveBundle?.journey?.stop_times)
      ? liveBundle.journey.stop_times
      : [];
    return rows.map((row, index) => ({
      tripId: String(liveBundle?.journey?.id || liveBundle?.trainId || ''),
      name: String(row?.stop_point?.name || row?.stop_name || row?.name || '').trim() || `Arrêt ${index + 1}`,
      arrival: formatTime(row?.arrival_time || row?.base_arrival_time),
      departure: formatTime(row?.departure_time || row?.base_departure_time),
      sequence: Number(row?.stop_sequence || index),
      raw: row
    }));
  }

  const normalizeStopKey = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  function impactForRow(row, liveBundle) {
    const impacted = liveBundle?.impacted || {};
    const rawStopId = String(row?.raw?.stop_point?.id || row?.raw?.stop_id || '').trim();
    if (rawStopId && impacted[rawStopId]) return impacted[rawStopId];

    const idDigits = rawStopId.match(/(\d{8})/)?.[1] || '';
    const rowName = normalizeStopKey(row?.name);
    return Object.entries(impacted).find(([impactId, impact]) => {
      if (idDigits && String(impactId).includes(idDigits)) return true;
      const impactStopId = String(impact?.stop_point?.id || '');
      if (idDigits && impactStopId.includes(idDigits)) return true;
      return rowName && normalizeStopKey(impact?.stop_point?.name) === rowName;
    })?.[1] || null;
  }

  function isLegDeleted(impact, leg, row) {
    if (!impact) return false;
    const status = String(impact?.[`${leg}_status`] || '').toLowerCase();
    if (status) return status === 'deleted';

    const amended = impact?.[`amended_${leg}_time`];
    if (amended) return false;
    const scheduled = impact?.[`base_${leg}_time`] || row?.[leg];
    return impact?.stop_time_effect === 'deleted' && !!scheduled && scheduled !== '—';
  }

  function applyEffectiveServicePattern(rows, liveBundle) {
    if (!Array.isArray(rows) || !rows.length || !liveBundle) return rows || [];

    const rawLiveStatus = String(liveBundle?.status || '').toUpperCase();
    const fullCancellation = !rawLiveStatus.includes('PARTIAL')
      && (rawLiveStatus.includes('CANCEL')
        || rawLiveStatus.includes('NO_SERVICE')
        || rawLiveStatus.includes('SUPPR'));
    const gtfsClearlyRunning = !!(liveBundle?.bucket
      && typeof isGtfsTrainClearlyRunning === 'function'
      && isGtfsTrainClearlyRunning(liveBundle.bucket));
    const enriched = rows.map((row) => {
      const impact = impactForRow(row, liveBundle);
      const hasArrival = !!row.arrival && row.arrival !== '—';
      const hasDeparture = !!row.departure && row.departure !== '—';
      let arrivalDeleted = isLegDeleted(impact, 'arrival', row);
      let departureDeleted = isLegDeleted(impact, 'departure', row);
      let gtfsDelay = null;
      if (liveBundle?.number && typeof getGtfsDelayForStop === 'function') {
        gtfsDelay = getGtfsDelayForStop(liveBundle.number, row.name);
      }
      const gtfsStopKnown = gtfsDelay !== null
        && gtfsDelay !== ''
        && Number.isFinite(Number(gtfsDelay));
      const canceledByGtfs = liveBundle?.canceledStopKeys instanceof Set
        && liveBundle.canceledStopKeys.has(normalizeStopKey(row.name));
      if (gtfsClearlyRunning && gtfsStopKnown) {
        // Même règle que le tableau : un arrêt GTFS-RT présent et roulant
        // annule une ancienne suppression SNCF restée en cache.
        arrivalDeleted = false;
        departureDeleted = false;
      }
      if (canceledByGtfs) {
        arrivalDeleted = true;
        departureDeleted = true;
      }
      const arrivalAvailable = hasArrival && !arrivalDeleted;
      const departureAvailable = hasDeparture && !departureDeleted;
      return {
        ...row,
        impact,
        arrivalDeleted,
        departureDeleted,
        arrivalAvailable,
        departureAvailable,
        isDeleted: fullCancellation || (!arrivalAvailable && !departureAvailable)
      };
    });

    if (fullCancellation) return enriched;

    // Départ effectif = premier départ encore assuré.
    // Terminus effectif = dernière arrivée encore assurée.
    // Cela couvre notamment arrivée conservée + départ supprimé à Thionville,
    // ainsi que l'inverse pour un nouveau départ depuis Thionville.
    let firstIndex = enriched.findIndex((row) => row.departureAvailable);
    let lastIndex = -1;
    for (let index = enriched.length - 1; index >= 0; index -= 1) {
      if (enriched[index].arrivalAvailable) {
        lastIndex = index;
        break;
      }
    }
    if (firstIndex < 0) firstIndex = enriched.findIndex((row) => !row.isDeleted);
    if (lastIndex < 0) {
      for (let index = enriched.length - 1; index >= 0; index -= 1) {
        if (!enriched[index].isDeleted) {
          lastIndex = index;
          break;
        }
      }
    }

    // Une suppression totale conserve le parcours théorique pour que la fiche
    // puisse expliquer clairement que toute la circulation est supprimée.
    if (firstIndex < 0 || lastIndex < 0 || firstIndex > lastIndex) return enriched;

    // La fiche conserve le parcours théorique complet. Les arrêts situés avant
    // le nouveau départ ou après le terminus exceptionnel restent visibles,
    // mais sont marqués comme supprimés.
    return enriched.map((row, index) => ({
      ...row,
      isDeleted: row.isDeleted || index < firstIndex || index > lastIndex,
      isNewOrigin: firstIndex > 0 && index === firstIndex,
      isNewTerminus: lastIndex < enriched.length - 1 && index === lastIndex
    }));
  }

  function chooseStaticCandidate(candidates, liveBundle, dateIso) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const exactLive = liveBundle?.trainId
      ? candidates.find((candidate) => candidate.tripId === liveBundle.trainId)
      : null;
    if (exactLive) return exactLive;

    const ymd = String(dateIso || '').replace(/-/g, '');
    const exactDate = candidates.filter((candidate) => candidate.tripId.includes(ymd));
    if (exactDate.length) {
      return exactDate.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
    }

    const stopMap = corridorStopMap();
    const liveStops = new Set((liveBundle?.stops || []).map((name) => String(name).toLowerCase()));
    return candidates.slice().sort((a, b) => {
      const score = (candidate) => {
        let value = candidate.rows.length;
        candidate.rows.forEach((row, index) => {
          const name = stopNameFromRow(row, index, liveBundle?.stops || [], stopMap);
          if (liveStops.has(name.toLowerCase())) value += 25;
          const stopId = String(row?.stop_id || '').match(/(\d{8})/)?.[1];
          if (stopId && stopMap.has(stopId)) value += 5;
        });
        if (liveStops.size && candidate.rows.length === liveStops.size) value += 80;
        return value;
      };
      return score(b) - score(a);
    })[0];
  }

  async function loadReliability(number) {
    const buildReliability = (sourceSeries, range, observedDates = null) => {
      const allowedBuckets = new Set(['ON_TIME', 'DELAYED', 'CANCELED', 'PARTIAL']);
      const byDate = new Map();

      (sourceSeries || []).forEach((item) => {
        const date = String(item?.date || '');
        if (!date || date < range.from || date > range.to) return;

        const status = String(item?.status || '').trim().toUpperCase();
        let bucket = String(item?.bucket || '').trim().toUpperCase();
        const valueNumber = Number(item?.value);

        if (!allowedBuckets.has(bucket)) {
          if (status.includes('PARTIAL')) bucket = 'PARTIAL';
          else if (status.includes('CANCELED') || status.includes('CANCELLED') || status.includes('SUPPR')) bucket = 'CANCELED';
          else if (status.includes('DELAY') || (Number.isFinite(valueNumber) && valueNumber > 0)) bucket = 'DELAYED';
          else bucket = 'ON_TIME';
        }

        byDate.set(date, {
          ...item,
          date,
          bucket,
          value: bucket === 'CANCELED'
            ? null
            : (Number.isFinite(valueNumber) ? valueNumber : 0)
        });
      });

      const series = Array.from(byDate.values())
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!series.length) return null;

      const counts = { ON_TIME: 0, DELAYED: 0, CANCELED: 0, PARTIAL: 0 };
      const delays = [];
      series.forEach((item) => {
        const bucket = String(item?.bucket || '');
        if (bucket in counts) counts[bucket] += 1;
        if (bucket === 'DELAYED' && Number.isFinite(Number(item?.value))) {
          delays.push(Number(item.value));
        }
      });

      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      if (!total) return null;

      const runsByDate = new Map(series.map((item) => [String(item.date), item]));
      const calendarSeries = [];
      const start = new Date(`${range.from}T12:00:00Z`);
      const end = new Date(`${range.to}T12:00:00Z`);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
        for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
          const date = cursor.toISOString().slice(0, 10);
          calendarSeries.push(runsByDate.get(date) || {
            date,
            bucket: observedDates?.has(date) ? 'NOT_RUNNING' : 'NO_DATA',
            value: null
          });
        }
      }

      return {
        series: calendarSeries.length ? calendarSeries : series,
        total,
        counts,
        pct: Math.round((counts.ON_TIME / total) * 100),
        average: delays.length
          ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length)
          : 0,
        maximum: delays.length ? Math.max(...delays) : 0
      };
    };

    const end = new Date(`${todayIso()}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end.getTime());
    start.setUTCDate(start.getUTCDate() - 29);
    const range = {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10)
    };

    try {
      const trainQuery = new URLSearchParams({
        from: range.from,
        to: range.to,
        trainId: String(number)
      });
      const dailyQuery = new URLSearchParams({
        from: range.from,
        to: range.to
      });
      const fetchStatsJson = async (url) => {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      };

      const [trainResult, dailyResult] = await Promise.allSettled([
        fetchStatsJson(`https://vps.labetaillere.fr/api/stats/gtfs/train?${trainQuery.toString()}`),
        fetchStatsJson(`https://vps.labetaillere.fr/api/stats/beta/daily?${dailyQuery.toString()}`)
      ]);

      if (trainResult.status === 'fulfilled') {
        const series = Array.isArray(trainResult.value?.series)
          ? trainResult.value.series
          : [];
        const observedDates = dailyResult.status === 'fulfilled'
          ? new Set((dailyResult.value?.series || []).map((day) => String(day?.date || '')).filter(Boolean))
          : null;
        const direct = buildReliability(series, range, observedDates);
        if (direct) return direct;
      } else {
        console.warn('[Fiche Bétaillère] endpoint train indisponible', trainResult.reason);
      }
    } catch (error) {
      console.warn('[Fiche Bétaillère] endpoint train indisponible', error);
    }

    // Compatibilité avec l'ancien module STATS : ce secours évite de perdre
    // la fiabilité si l'endpoint dédié est momentanément indisponible.
    try {
      const stats = window.__lbStats || {};
      if (typeof stats.getRawRange !== 'function'
        || typeof stats.computeTrainSeriesFromRawDays !== 'function') {
        return null;
      }
      const rawDays = await stats.getRawRange(range.from, range.to);
      const result = stats.computeTrainSeriesFromRawDays(
        rawDays || [],
        range.from,
        range.to,
        String(number),
        null
      );
      const observedDates = new Set(
        (rawDays || [])
          .map((day) => String(day?.date || ''))
          .filter(Boolean)
      );
      return buildReliability(result?.series || [], range, observedDates);
    } catch (error) {
      console.warn('[Fiche Bétaillère] statistiques indisponibles', error);
      return null;
    }
  }

  async function loadAffluence(number, dateIso) {
    try {
      if (typeof window.lbAff?.loadDate === 'function') await window.lbAff.loadDate(dateIso);
      if (typeof window.getAffluenceTrainInfo === 'function') {
        return window.getAffluenceTrainInfo(number) || null;
      }
    } catch (error) {
      console.warn('[Fiche Bétaillère] affluence indisponible', error);
    }
    return null;
  }

  async function loadSupplementaryData(forceFresh) {
    const tasks = [];
    if (typeof loadCompoData === 'function') {
      tasks.push(loadCompoData({ forceFresh: !!forceFresh, background: !forceFresh }));
    }
    if (typeof loadVoiesByTrain === 'function') {
      tasks.push(loadVoiesByTrain({ forceFresh: !!forceFresh, onlyIfChanged: !forceFresh }));
    }
    if (typeof loadCflVoiesByTrain === 'function') {
      tasks.push(loadCflVoiesByTrain({ forceFresh: !!forceFresh, onlyIfChanged: !forceFresh }));
    }
    await Promise.allSettled(tasks);
  }

  function gtfsRealtimeAtStop(number, stopName, liveBundle) {
    let value = null;
    try {
      if (typeof getGtfsDelayForStop === 'function') value = getGtfsDelayForStop(number, stopName);
    } catch (_) {}
    if (!Number.isFinite(Number(value)) && liveBundle?.bucket) {
      const direct = Number(liveBundle.bucket[stopName]);
      if (Number.isFinite(direct)) value = direct;
    }
    const known = value !== null && value !== '' && Number.isFinite(Number(value));
    return {
      known,
      delay: known ? Number(value) : 0
    };
  }

  function sncfRealtimeAtRow(row, liveBundle, isLast) {
    const impact = row?.impact || impactForRow(row, liveBundle);
    const legs = isLast ? ['arrival', 'departure'] : ['departure', 'arrival'];
    for (const leg of legs) {
      const baseRaw = impact?.[`base_${leg}_time`]
        || row?.raw?.[`base_${leg}_time`]
        || row?.[leg];
      const amendedRaw = impact?.[`amended_${leg}_time`]
        || row?.raw?.[`amended_${leg}_time`];
      const planned = formatTime(baseRaw);
      const amended = formatTime(amendedRaw);
      const explicit = Number(impact?.delay_minutes ?? row?.raw?.delay_minutes);
      const computed = scheduleDelayMinutes(baseRaw, amendedRaw);
      const delay = Number.isFinite(explicit)
        ? explicit
        : (Number.isFinite(computed) ? computed : 0);
      if (amended !== '—' || Number.isFinite(explicit)) {
        const baseTime = planned !== '—' ? planned : (row?.[leg] || '—');
        return {
          known: true,
          planned: baseTime,
          actual: amended !== '—' ? amended : addMinutes(baseTime, delay),
          delay: Math.max(0, Number(delay || 0)),
          source: 'SNCF'
        };
      }
    }
    return { known: false, planned: '—', actual: '—', delay: 0, source: '' };
  }

  function realtimeAtRow(number, row, liveBundle, isLast) {
    const fallbackPlanned = isLast
      ? (row?.arrival || row?.departure || '—')
      : (row?.departure || row?.arrival || '—');
    // Une heure SNCF amendée est plus précise qu'un simple décalage GTFS-RT.
    // Une heure SNCF amendée reste prioritaire sur un simple décalage GTFS-RT.
    const sncf = sncfRealtimeAtRow(row, liveBundle, isLast);
    if (sncf.known) return sncf;
    const gtfs = liveBundle
      ? gtfsRealtimeAtStop(number, row?.name, liveBundle)
      : { known: false, delay: 0 };
    if (gtfs.known) {
      return {
        planned: fallbackPlanned,
        actual: gtfs.delay > 0 ? addMinutes(fallbackPlanned, gtfs.delay) : fallbackPlanned,
        delay: Math.max(0, Number(gtfs.delay || 0)),
        source: 'GTFS-RT'
      };
    }
    return { planned: fallbackPlanned, actual: fallbackPlanned, delay: 0, source: '' };
  }

  function platformAtStop(number, row, isLast) {
    let value = '';
    const scheduled = isLast ? (row.arrival || row.departure) : (row.departure || row.arrival);
    try {
      const sncfMap = typeof getVoiesForTrain === 'function' ? getVoiesForTrain(number) : null;
      const cflMap = typeof getCflVoiesForTrain === 'function' ? getCflVoiesForTrain(number) : null;
      if (typeof resolveVoieForStop === 'function') {
        value = resolveVoieForStop({
          voiesMap: sncfMap,
          stopName: row.name,
          baseTimeRaw: scheduled,
          timeCandidates: [scheduled],
          mode: isLast ? 'arr' : 'dep',
          preferStationResolver: false
        }) || resolveVoieForStop({
          voiesMap: cflMap,
          stopName: row.name,
          baseTimeRaw: scheduled,
          timeCandidates: [scheduled],
          mode: isLast ? 'arr' : 'dep',
          preferStationResolver: false
        }) || '';
      }
      if (value && typeof formatVoieLabel === 'function') return formatVoieLabel(value);
    } catch (_) {}
    if (!value) return '';
    return /^(voie|quai)\s/i.test(String(value)) ? String(value) : `Voie ${value}`;
  }

  function liveStatus(liveBundle, dateIso) {
    if (dateIso !== todayIso()) {
      return { className: 'is-unknown', label: 'HORAIRE PROGRAMMÉ', live: false };
    }
    if (!liveBundle) {
      return { className: 'is-unknown', label: 'TEMPS RÉEL INDISPONIBLE', live: false };
    }
    const status = String(liveBundle.status || '').toUpperCase();
    if (status.includes('PARTIAL')) {
    const partialDelay = Math.max(0, Number(liveBundle?.maxDelay || 0));
    return {
      className: 'is-partial',
      label: partialDelay > 0
        ? `SUPPRESSION PARTIELLE · +${Math.round(partialDelay)} MIN`
        : 'SUPPRESSION PARTIELLE',
      live: true
    };
      }
    if (status.includes('CANCEL') || status.includes('SUPPR') || status.includes('NO_SERVICE')) {
      return { className: 'is-cancel', label: 'SUPPRIMÉE', live: true };
    }
    if (Number(liveBundle.maxDelay) > 0) {
      return { className: 'is-delay', label: `RETARD +${Math.round(liveBundle.maxDelay)} MIN`, live: true };
    }
    return { className: 'is-ok', label: 'À L’HEURE', live: true };
  }

  function luxembourgNowMinutes() {
    try {
      const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Luxembourg',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date());
      const hours = Number(parts.find((part) => part.type === 'hour')?.value);
      const minutes = Number(parts.find((part) => part.type === 'minute')?.value);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) return (hours * 60) + minutes;
    } catch (_) {}
    const now = new Date();
    return (now.getHours() * 60) + now.getMinutes();
  }

  function profileJourneyPhase(dateIso, actualDeparture, actualArrival) {
    if (dateIso !== todayIso()) return 'scheduled';
    const departureMinutes = timeToMinutes(actualDeparture);
    let arrivalMinutes = timeToMinutes(actualArrival);
    let nowMinutes = luxembourgNowMinutes();
    if (!Number.isFinite(departureMinutes) || !Number.isFinite(arrivalMinutes)) return 'unknown';

    // Même logique que les favoris : avant le premier départ, pendant la
    // circulation, puis ARRIVÉ après la dernière heure d'arrivée. Les heures
    // amendées sont utilisées ici afin qu'un train retardé ne passe pas trop
    // tôt à l'état ARRIVÉ.
    if (arrivalMinutes < departureMinutes) {
      arrivalMinutes += 1440;
      if (nowMinutes < departureMinutes && nowMinutes <= arrivalMinutes - 1440) {
        nowMinutes += 1440;
      }
    }
    if (nowMinutes < departureMinutes) return 'before';
    if (nowMinutes <= arrivalMinutes) return 'running';
    return 'after';
  }

  function renderHeroTime(element, realtime, canceled) {
    if (!element) return;
    const planned = realtime?.planned || '—';
    const actual = realtime?.actual || planned;
    const delayed = !canceled
      && Number(realtime?.delay || 0) > 0
      && planned !== '—'
      && actual !== '—'
      && actual !== planned;

    element.classList.toggle('is-delay', delayed);
    element.classList.toggle('is-cancel', !!canceled);
    if (delayed) {
      element.innerHTML = `
        <s class="lb-train-profile__hero-planned">${safe(planned)}</s>
        <span class="lb-train-profile__hero-actual">${safe(actual)}</span>
      `;
      element.setAttribute('aria-label', `Horaire prévu ${planned}, horaire réel ${actual}`);
    } else {
      element.textContent = planned;
      element.setAttribute(
        'aria-label',
        canceled ? `Horaire prévu ${planned}, circulation supprimée` : `Horaire ${planned}`
      );
    }
  }

  function renderDisruption(liveBundle, status) {
  const host = byId('trainDetailDisruption');
  if (!host) return;
  const cause = String(liveBundle?.cause || '').trim();
  const isDisrupted = ['is-delay', 'is-cancel', 'is-partial'].includes(status?.className);
  const hide = () => {
    host.hidden = true;
    host.className = 'lb-train-profile__disruption';
    host.innerHTML = '';
  };
  if (!liveBundle || !isDisrupted) {
    hide();
    return;
  }

  const type = status.className === 'is-cancel'
    ? { icon: '❌', label: 'Suppression', className: 'is-cancel' }
    : (status.className === 'is-partial'
      ? { icon: '⚠️', label: 'Suppression partielle', className: 'is-partial' }
      : { icon: '⏰', label: 'Retard', className: 'is-delay' });
  const maxDelay = Math.max(0, Number(liveBundle?.maxDelay || 0));
  const delaySuffix = type.className === 'is-delay' && maxDelay > 0
    ? ` +${Math.round(maxDelay)} min`
    : '';

  // Les statuts SNCF arrivée/départ ont priorité sur stop_time_effect.
  // Les statuts SNCF arrivée/départ déterminent le parcours réellement assuré.
  // Une tête supprimée produit un départ exceptionnel ; une queue supprimée,
  // un terminus exceptionnel.
  let partialDetails = null;
  if (type.className === 'is-partial') {
    try {
      const scheduledRows = normalizeJourneyRows(liveBundle);
      const serviceRows = scheduledRows.length
        ? applyEffectiveServicePattern(scheduledRows, liveBundle)
        : [];
      const effectiveRows = serviceRows.filter((row) => !row.isDeleted);
      if (scheduledRows.length && effectiveRows.length) {
        const scheduledOrigin = String(scheduledRows[0]?.name || '').trim();
        const scheduledDestination = String(scheduledRows[scheduledRows.length - 1]?.name || '').trim();
        const effectiveOrigin = String(effectiveRows[0]?.name || '').trim();
        const effectiveDestination = String(effectiveRows[effectiveRows.length - 1]?.name || '').trim();
        const partialStart = !!scheduledOrigin && !!effectiveOrigin
          && normalizeStopKey(scheduledOrigin) !== normalizeStopKey(effectiveOrigin);
        const partialEnd = !!scheduledDestination && !!effectiveDestination
          && normalizeStopKey(scheduledDestination) !== normalizeStopKey(effectiveDestination);
        if (partialStart || partialEnd) {
          partialDetails = {
            scheduledOrigin,
            scheduledDestination,
            effectiveOrigin,
            effectiveDestination,
            partialStart,
            partialEnd
          };
        }
      }
    } catch (error) {
      console.warn('[Fiche Bétaillère] analyse suppression partielle impossible', error);
    }
  }

  const details = [];
  if (type.className === 'is-partial' && maxDelay > 0) {
    const number = normalizeTrainNumber(liveBundle?.number || '') || String(liveBundle?.number || '').trim();
    const from = partialDetails?.effectiveOrigin || '';
    const to = partialDetails?.effectiveDestination || '';
    if (from && to) {
      details.push(`${number ? `TER ${number}` : 'Train'} retardé d’environ ${Math.round(maxDelay)} min entre ${from} et ${to}.`);
    } else {
      details.push(`${number ? `TER ${number}` : 'Train'} retardé d’environ ${Math.round(maxDelay)} min.`);
    }
  }
  if (partialDetails?.partialStart) {
    details.push(`Départ exceptionnel ${partialDetails.effectiveOrigin} : circulation supprimée entre ${partialDetails.scheduledOrigin} et ${partialDetails.effectiveOrigin}.`);
  }
  if (partialDetails?.partialEnd) {
    details.push(`Terminus exceptionnel ${partialDetails.effectiveDestination} : circulation supprimée entre ${partialDetails.effectiveDestination} et ${partialDetails.scheduledDestination}.`);
  }

  if (!cause && !details.length) {
    hide();
    return;
  }

  const heading = type.className === 'is-partial'
    ? 'Circulation perturbée'
    : type.label + delaySuffix;
  const detailsHtml = details.map((line, index) => {
    if (index === details.length - 1 && partialDetails?.partialEnd) {
      const prefix = `Terminus exceptionnel ${partialDetails.effectiveDestination}`;
      if (line.startsWith(prefix)) {
        return `<p><strong>${safe(prefix)}</strong>${safe(line.slice(prefix.length))}</p>`;
      }
    }
    if (partialDetails?.partialStart && line.startsWith(`Départ exceptionnel ${partialDetails.effectiveOrigin}`)) {
      const prefix = `Départ exceptionnel ${partialDetails.effectiveOrigin}`;
      return `<p><strong>${safe(prefix)}</strong>${safe(line.slice(prefix.length))}</p>`;
    }
    return `<p>${safe(line)}</p>`;
  }).join('');

  host.className = `lb-train-profile__disruption ${type.className}`;
  host.innerHTML = `
    <span class="lb-train-profile__disruption-icon" aria-hidden="true">${type.icon}</span>
    <div>
      <div class="lb-train-profile__disruption-head">
        <strong>${safe(heading)}</strong>
        ${liveBundle.causeSource ? `<span>Source ${safe(liveBundle.causeSource)}</span>` : ''}
      </div>
      ${cause ? `<p><strong>${safe(cause)}</strong></p>` : ''}
      ${detailsHtml}
    </div>
  `;
  host.hidden = false;
}

  function renderHero(number, dateIso, rows, liveBundle) {
    const first = rows[0] || null;
    const last = rows[rows.length - 1] || null;
    const departureLive = first
      ? realtimeAtRow(number, first, liveBundle, false)
      : { planned: '—', actual: '—', delay: 0 };
    const arrivalLive = last
      ? realtimeAtRow(number, last, liveBundle, true)
      : { planned: '—', actual: '—', delay: 0 };
    const departure = departureLive.planned;
    const arrival = arrivalLive.planned;
    const status = liveStatus(liveBundle, dateIso);
    const actualDeparture = departureLive.delay > 0 ? departureLive.actual : departure;
    const actualArrival = arrivalLive.delay > 0 ? arrivalLive.actual : arrival;
    const journeyPhase = profileJourneyPhase(dateIso, actualDeparture, actualArrival);
    const firstPlatform = first ? platformAtStop(number, first, false) : '';

    renderHeroTime(byId('trainDetailDeparture'), departureLive, status.className === 'is-cancel');
    renderHeroTime(byId('trainDetailArrival'), arrivalLive, status.className === 'is-cancel');
    byId('trainDetailOrigin').textContent = first?.name || liveBundle?.extracted?.from || '—';
    byId('trainDetailDestination').textContent = last?.name || liveBundle?.extracted?.to || '—';
    byId('trainDetailDuration').textContent = durationLabel(departure, arrival);
    byId('trainDetailPlatform').textContent = firstPlatform || 'Voie non communiquée';
    byId('trainDetailLiveStatus').className = `lb-train-profile__status ${status.className}`;
    byId('trainDetailLiveStatus').innerHTML = `<i></i> ${safe(status.label)}`;
    const liveActive = journeyPhase === 'running' && status.live;
    byId('trainDetailRouteMode').textContent = journeyPhase === 'after'
      ? 'ARRIVÉ'
      : (journeyPhase === 'before'
          ? 'À VENIR'
          : (liveActive ? 'LIVE' : 'HORAIRES'));

    const source = byId('trainDetailSourceState');
    if (journeyPhase === 'after' && status.className !== 'is-cancel') {
      source.className = 'lb-train-profile__source is-arrived';
      source.innerHTML = '<i></i> ARRIVÉ';
    } else if (journeyPhase === 'before') {
      source.className = 'lb-train-profile__source is-upcoming';
      source.innerHTML = '<i></i> À VENIR';
    } else if (liveActive) {
      source.className = 'lb-train-profile__source';
      source.innerHTML = '<i></i> LIVE SNCF / CFL';
    } else {
      source.className = 'lb-train-profile__source is-static';
      source.innerHTML = '<i></i> HORAIRES PROGRAMMÉS';
    }

    let nextLabel = `Circulation prévue le ${formatDate(dateIso)}.`;
    if (dateIso === todayIso() && departure !== '—' && arrival !== '—') {
      const nowMinutes = luxembourgNowMinutes();
      let actualDepartureMinutes = timeToMinutes(actualDeparture);
      if (Number.isFinite(actualDepartureMinutes) && actualDepartureMinutes < nowMinutes - (12 * 60)) {
        actualDepartureMinutes += 1440;
      }
      if (status.className === 'is-cancel') {
        nextLabel = 'Cette circulation est annoncée supprimée.';
      } else if (journeyPhase === 'before' && Number.isFinite(actualDepartureMinutes)) {
        nextLabel = `Départ dans ${Math.max(0, actualDepartureMinutes - nowMinutes)} min.`;
      } else if (journeyPhase === 'running') {
        nextLabel = 'Bétaillère en circulation ou sur le point de partir.';
      } else if (journeyPhase === 'after') {
        nextLabel = 'Circulation terminée aujourd’hui.';
      }
    }
    byId('trainDetailNext').textContent = nextLabel;
    renderDisruption(liveBundle, status);
    return { status, journeyPhase, liveActive };
  }

  function renderRoute(number, dateIso, rows, liveBundle) {
    const host = byId('trainDetailStops');
    if (!host) return;
    if (!rows.length) {
      byId('trainDetailPath').textContent = 'Parcours indisponible';
      host.innerHTML = '<div class="lb-train-profile__empty">Aucun arrêt trouvé pour cette bétaillère et cette date.</div>';
      return;
    }
    byId('trainDetailPath').textContent = `${rows[0].name} → ${rows[rows.length - 1].name} · ${rows.length} arrêts`;
    const today = dateIso === todayIso();
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const route = rows.map((row, index) => {
      const isLast = index === rows.length - 1;
      const realtime = today
        ? realtimeAtRow(number, row, liveBundle, isLast)
        : {
            planned: isLast ? (row.arrival || row.departure) : (row.departure || row.arrival),
            actual: isLast ? (row.arrival || row.departure) : (row.departure || row.arrival),
            delay: 0,
            source: ''
          };
      const planned = realtime.planned || '—';
      const delay = Math.max(0, Number(realtime.delay || 0));
      const actual = realtime.actual || planned;
      const platform = platformAtStop(number, row, isLast);
      const actualMinutes = timeToMinutes(actual);
      const rawStatus = String(liveBundle?.status || '').toUpperCase();
      const canceled = !!row.isDeleted || (
        !rawStatus.includes('PARTIAL')
        && (rawStatus.includes('CANCEL') || rawStatus.includes('NO_SERVICE'))
      );
      const passed = today && Number.isFinite(actualMinutes) && actualMinutes < nowMinutes;
      return {
        ...row,
        planned,
        actual,
        delay,
        realtimeSource: realtime.source,
        platform,
        canceled,
        passed,
        index
      };
    });
    const firstUpcoming = route.findIndex((row) => !row.passed && !row.canceled);

    host.innerHTML = route.map((row) => {
      const classes = ['lb-train-profile__stop'];
      if (row.delay > 0) classes.push('is-delay');
      if (row.canceled) classes.push('is-cancel');
      if (row.isNewOrigin || row.isNewTerminus) classes.push('is-effective-endpoint');
      if (row.passed) classes.push('is-passed');
      if (row.index === firstUpcoming && firstUpcoming > 0) classes.push('is-current');
      const timeHtml = row.canceled
        ? `<b>${safe(row.planned)}</b>`
        : (row.delay > 0
          ? `<s>${safe(row.planned)}</s><b>${safe(row.actual)}</b>`
          : `<b>${safe(row.planned)}</b>`);
      const delayLabel = row.canceled
        ? 'SUPPRIMÉ'
        : (row.isNewOrigin
          ? 'DÉPART EXCEPTIONNEL'
          : (row.isNewTerminus
            ? 'TERMINUS EXCEPTIONNEL'
            : (row.delay > 0 ? `+${Math.round(row.delay)} min` : (liveBundle ? 'À L’HEURE' : ''))));
      const stopMeta = row.canceled
        ? 'Arrêt non desservi'
        : (row.platform || (row.index === firstUpcoming && firstUpcoming > 0 ? 'Prochain arrêt' : 'Voie non communiquée'));
      return `
        <div class="${classes.join(' ')}">
          <div class="lb-train-profile__times">${timeHtml}</div>
          <i class="lb-train-profile__dot"></i>
          <div class="lb-train-profile__stop-name">
            <strong>${safe(row.name)}</strong>
            <span>${safe(stopMeta)}</span>
          </div>
          ${delayLabel ? `<span class="lb-train-profile__delay${row.delay === 0 && !row.canceled ? ' is-ok' : ''}">${safe(delayLabel)}</span>` : ''}
        </div>
      `;
    }).join('');
  }

  function compositionCode(number, fallbackType) {
    const raw = String(window.compoData?.[number] || fallbackType || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (raw === 'US') return 'US';
    if (raw === 'US5') return 'US5';
    if (raw.startsWith('UM3')) return 'UM3';
    if (raw === 'UMMIXTE' || raw === 'UMMIX') return 'UMMIXTE';
    if (raw.startsWith('UM')) return 'UM';
    return '';
  }

  function compositionLayout(code) {
    const layouts = {
      US: {
        units: [3],
        unitLabel: 'US',
        unitDescription: 'UNITÉ SIMPLE',
        model: 'Z24500'
      },
      US5: {
        units: [5],
        unitLabel: 'US',
        unitDescription: 'UNITÉ SIMPLE',
        model: 'Z26500'
      },
      UM: {
        units: [3, 3],
        unitLabel: 'UM2',
        unitDescription: 'UNITÉ MULTIPLE',
        model: 'Z24500'
      },
      UM3: {
        units: [3, 3, 3],
        unitLabel: 'UM3',
        unitDescription: 'UNITÉ MULTIPLE',
        model: 'Z24500'
      },
      UMMIXTE: {
        units: [5, 3],
        unitLabel: 'UM2',
        unitDescription: 'UNITÉ MULTIPLE MIXTE',
        model: 'Z26500 + Z24500'
      }
    };
    return layouts[code] || null;
  }

  function renderCompositionDrawing(code) {
    const drawing = byId('trainDetailDrawing');
    const stats = byId('trainDetailCompoStats');
    if (!drawing || !stats) return;
    const layout = compositionLayout(code);
    if (!layout) {
      drawing.className = 'lb-train-profile__drawing is-unknown';
      drawing.innerHTML = '<span class="lb-train-profile__drawing-empty">Schéma indisponible</span>';
      drawing.setAttribute('aria-label', 'Schéma de la composition indisponible');
      stats.innerHTML = '<span><b>—</b> UNITÉ</span><span><b>—</b> VOITURES</span><span><b>—</b> PLACES ENV.</span>';
      return;
    }

    const carCount = layout.units.reduce((sum, count) => sum + count, 0);
    const cars = [];
    let globalIndex = 0;
    layout.units.forEach((unitCars, unitIndex) => {
      for (let index = 0; index < unitCars; index += 1) {
        const classes = ['lb-train-profile__car'];
        if (globalIndex === 0) classes.push('is-front');
        if (globalIndex === carCount - 1) classes.push('is-rear');
        if (index === 0) classes.push('is-unit-start');
        if (index === unitCars - 1) classes.push('is-unit-end');
        cars.push(
          `<span class="${classes.join(' ')}" data-unit="${unitIndex + 1}" aria-hidden="true">`
          + '<i></i><i></i><i></i>'
          + '</span>'
        );
        globalIndex += 1;
      }
    });

    drawing.className = 'lb-train-profile__drawing';
    drawing.style.setProperty('--car-count', String(carCount));
    drawing.innerHTML = cars.join('');
    drawing.setAttribute(
      'aria-label',
      `Schéma de ${layout.unitLabel}, ${carCount} voitures, matériel ${layout.model}`
    );
    stats.innerHTML = `
      <span><b>${layout.unitLabel}</b> ${layout.unitDescription}</span>
      <span><b>${carCount}</b> VOITURES</span>
      <span><b>${carCount * 110}</b> PLACES ENV.</span>
    `;
  }

  function renderComposition(number, affluenceInfo) {
    const fallbackType = String(affluenceInfo?.trainType || affluenceInfo?.type || '');
    const direct = String(window.compoData?.[number] || '').trim();
    const code = compositionCode(number, fallbackType);
    const host = byId('trainDetailCompo');
    if (typeof window.buildTrainDetailCompoHtml === 'function') {
      host.innerHTML = window.buildTrainDetailCompoHtml(number, fallbackType);
    } else {
      host.textContent = code || 'Composition inconnue';
    }
    const confidence = byId('trainDetailCompoConfidence');
    confidence.textContent = direct ? 'PRÉVUE' : (code ? 'ESTIMATION' : 'INCONNUE');
    confidence.classList.toggle('is-estimated', !direct);
    renderCompositionDrawing(code);
    const descriptions = {
      US: 'Unité simple · rame Z24500',
      US5: 'Unité simple · rame Z26500',
      UM: 'Unité multiple · 2 rames Z24500',
      UM3: 'Unité multiple · 3 rames Z24500',
      UMMIXTE: 'Unité multiple mixte · Z26500 + Z24500'
    };
    byId('trainDetailCompoMeta').textContent = descriptions[code]
      ? `${descriptions[code]} · Source : ${direct ? 'Compotrains.json' : 'prévision d’affluence'}`
      : 'Aucune composition exploitable communiquée pour cette circulation.';
  }

  function affluenceBand(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return { className: 'is-green', label: 'NON DISPONIBLE' };
    if (value >= 100) return { className: 'is-black', label: 'SATURATION' };
    if (value >= 80) return { className: 'is-red', label: 'TRÈS FORTE' };
    if (value >= 60) return { className: 'is-orange', label: 'FORTE' };
    if (value >= 40) return { className: 'is-yellow', label: 'MODÉRÉE' };
    return { className: 'is-green', label: 'FAIBLE' };
  }

  function renderAffluence(info) {
    const stops = Array.isArray(info?.stops) ? info.stops : [];
    const values = stops.map((stop) => {
      const raw = Number(stop?.globalPct ?? stop?.pct ?? (Number(stop?.globalOcc) * 100));
      return Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
    });
    const valid = values.filter(Number.isFinite);
    const max = valid.length ? Math.max(...valid) : null;
    const band = affluenceBand(max);
    const bar = byId('trainDetailAffluenceBar');
    const percent = byId('trainDetailAffluence');
    percent.textContent = Number.isFinite(max) ? `${max}%` : '—';
    percent.className = band.className;
    byId('trainDetailAffluenceLabel').textContent = band.label;
    bar.className = band.className;
    bar.style.width = Number.isFinite(max) ? `${max}%` : '0%';
    const host = byId('trainDetailAffluenceDetails');
    if (!stops.length) {
      host.innerHTML = '<div class="train-detail-aff-empty">Pas de détail d’affluence disponible pour ce train ce jour-là.</div>';
      return;
    }
    host.innerHTML = stops.map((stop, index) => {
      const percent = values[index];
      const station = stop?.station || stop?.name || `Arrêt ${index + 1}`;
      const time = stop?.hhmm || stop?.time || '';
      return `
        <div class="fav-aff-stop">
          <div class="fav-aff-stop-head">
            <div class="fav-aff-stop-title">
              <span class="fav-aff-stop-name">${safe(station)}</span>
              ${time ? `<span class="fav-aff-stop-time">· ${safe(time)}</span>` : ''}
            </div>
            <div class="fav-aff-stop-pct">${Number.isFinite(percent) ? `${percent}%` : '—'}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function reliabilityRunPresentation(item) {
    const bucket = String(item?.bucket || 'NO_DATA');
    if (bucket === 'ON_TIME') return { className: 'is-on-time', label: 'À l’heure' };
    if (bucket === 'DELAYED') {
      const delay = Math.max(0, Math.round(Number(item?.value || 0)));
      return { className: 'is-delay', label: `Retard ${delay} min` };
    }
    if (bucket === 'CANCELED') return { className: 'is-cancel', label: 'Supprimé' };
    if (bucket === 'PARTIAL') return { className: 'is-partial', label: 'Suppression partielle' };
    if (bucket === 'NOT_RUNNING') return { className: 'is-not-running', label: 'Ne circulait pas' };
    return { className: 'is-no-data', label: 'Donnée indisponible' };
  }

  function setupReliabilityRunsInteraction(host) {
    const track = host?.querySelector('.lb-train-profile__runs-track');
    const readout = host?.querySelector('.lb-train-profile__runs-readout');
    const bars = track ? Array.from(track.querySelectorAll('.lb-train-profile__run')) : [];
    if (!track || !readout || !bars.length) return;

    let activePointerId = null;
    let lastPointerType = '';
    const defaultText = 'Survole ou glisse pour afficher la date';

    const selectBar = (bar) => {
      if (!bar) return;
      bars.forEach((candidate) => {
        const selected = candidate === bar;
        candidate.classList.toggle('is-active', selected);
        candidate.setAttribute('aria-current', selected ? 'date' : 'false');
      });
      readout.innerHTML = `<b>${safe(bar.dataset.dateLabel || bar.dataset.date || '')}</b><span>${safe(bar.dataset.stateLabel || '')}</span>`;
    };

    const barAtX = (clientX) => {
      const rect = track.getBoundingClientRect();
      if (!rect.width) return null;
      const ratio = Math.max(0, Math.min(0.999999, (clientX - rect.left) / rect.width));
      return bars[Math.floor(ratio * bars.length)] || bars[bars.length - 1];
    };

    const resetMouseSelection = () => {
      bars.forEach((bar) => {
        bar.classList.remove('is-active');
        bar.setAttribute('aria-current', 'false');
      });
      readout.textContent = defaultText;
    };

    track.onpointerdown = (event) => {
      activePointerId = event.pointerId;
      lastPointerType = event.pointerType || '';
      selectBar(barAtX(event.clientX));
      try { track.setPointerCapture(event.pointerId); } catch (_) {}
    };
    track.onpointermove = (event) => {
      lastPointerType = event.pointerType || lastPointerType;
      if (event.pointerType === 'mouse' || activePointerId === event.pointerId) {
        selectBar(barAtX(event.clientX));
      }
    };
    track.onpointerup = (event) => {
      if (activePointerId === event.pointerId) activePointerId = null;
      try { track.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    track.onpointercancel = (event) => {
      if (activePointerId === event.pointerId) activePointerId = null;
    };
    track.onpointerleave = () => {
      if (activePointerId === null && lastPointerType === 'mouse') resetMouseSelection();
    };
    host.onfocusin = (event) => {
      const bar = event.target.closest?.('.lb-train-profile__run');
      if (bar) selectBar(bar);
    };
    host.onmouseover = (event) => {
      const bar = event.target.closest?.('.lb-train-profile__run');
      if (bar) selectBar(bar);
    };
    host.onclick = (event) => {
      const bar = event.target.closest?.('.lb-train-profile__run');
      if (bar) selectBar(bar);
    };
  }

  function renderReliability(data) {
    if (!data) {
      byId('trainDetailReliability').textContent = '—';
      byId('trainDetailReliabilitySample').textContent = 'AUCUNE DONNÉE';
      byId('trainDetailReliabilityDetails').textContent = 'Historique indisponible pour ce train.';
      byId('trainDetailReliabilityRuns').innerHTML = '';
      paintReliabilityDonut(null);
      return;
    }
    byId('trainDetailReliability').textContent = `${data.pct}%`;
    byId('trainDetailReliabilitySample').textContent = `${data.total} CIRC.`;
    paintReliabilityDonut(data.pct);
    byId('trainDetailReliabilityDetails').innerHTML = `
      <div class="lb-train-profile__reliability-row"><span>Retard moyen</span><b>${data.average} min</b></div>
      <div class="lb-train-profile__reliability-row"><span>Retard maximum</span><b>${data.maximum} min</b></div>
      <div class="lb-train-profile__reliability-row"><span>Suppressions</span><b>${data.counts.CANCELED}</b></div>
      <div class="lb-train-profile__reliability-row"><span>Suppr. partielles</span><b>${data.counts.PARTIAL}</b></div>
    `;
    const runsHost = byId('trainDetailReliabilityRuns');
    const runs = data.series.slice(-30);
    runsHost.innerHTML = `
      <div class="lb-train-profile__runs-track" aria-label="État du train sur les 30 derniers jours">
        ${runs.map((item) => {
          const presentation = reliabilityRunPresentation(item);
          const dateIso = String(item?.date || '');
          const dateLabel = formatDate(dateIso);
          return `
            <button
              type="button"
              class="lb-train-profile__run ${presentation.className}"
              data-date="${safe(dateIso)}"
              data-date-label="${safe(dateLabel)}"
              data-state-label="${safe(presentation.label)}"
              title="${safe(dateLabel)} · ${safe(presentation.label)}"
              aria-label="${safe(dateLabel)} : ${safe(presentation.label)}"
              aria-current="false"
            ></button>
          `;
        }).join('')}
      </div>
      <output class="lb-train-profile__runs-readout" aria-live="polite">Survole ou glisse pour afficher la date</output>
    `;
    setupReliabilityRunsInteraction(runsHost);
  }

  function setupProfileActions(number, dateIso, hasLive) {
    const signalButton = byId('trainDetailSignalBtn');
    signalButton.dataset.lbSignalTrain = number;
    signalButton.disabled = !hasLive || dateIso !== todayIso();
    signalButton.title = signalButton.disabled
      ? 'Le signalement est disponible uniquement pour un train présent dans le live du jour.'
      : 'Compléter les données officielles avec un signalement voyageur.';

    const statsButton = byId('trainDetailStatsBtn');
    statsButton.onclick = (event) => {
      event.preventDefault();
      byId('trainDetailPanel').hidden = true;
      byId('trainDetailPanel').setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lb-train-detail-open');
      document.body.classList.remove('lb-train-detail-from-map');
      location.hash = '#stats';
      window.setTimeout(() => {
        if (window.__lbStats?.openTrain) {
          window.__lbStats.openTrain(number);
          return;
        }
        const details = byId('statsDetails');
        if (details?.classList.contains('stats-hide')) byId('statsToggleDetails')?.click();
        if (byId('statsTrainId')) byId('statsTrainId').value = number;
        byId('statsTabTrainBtn')?.click();
        byId('statsBtnTrainRun')?.click();
      }, 120);
    };
  }

  async function openTrainProfile(numberValue, dateValue, options = {}) {
    const number = normalizeTrainNumber(numberValue);
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))
      ? String(dateValue)
      : (byId('lbTrainFinderDate')?.value || byId('trainDate')?.value || todayIso());
    if (!number) {
      setFinderStatus('Entre un numéro de train valide (4 à 6 chiffres).', 'error');
      byId('lbTrainFinderInput')?.focus();
      return;
    }

    state.trainNumber = number;
    state.dateIso = dateIso;
    state.origin = options.origin === 'map' ? 'map' : '';
    state.lastBundle = null;
    document.body.classList.toggle('lb-train-detail-from-map', state.origin === 'map');
    const requestId = ++state.requestId;
    const forceFresh = !!options.forceFresh;
    rememberTrain(number);
    resetProfile(number, dateIso);
    if (byId('lbTrainFinderInput')) byId('lbTrainFinderInput').value = number;
    if (byId('lbTrainFinderDate')) byId('lbTrainFinderDate').value = dateIso;
    setFinderStatus(`Chargement de la bétaillère ${number}…`, 'loading');
    const submit = byId('lbTrainFinderSubmit');
    if (submit) submit.disabled = true;

    try {
      const livePromise = loadLiveBundle(number, dateIso, forceFresh);
      const staticPromise = fetchStaticCandidates(number, dateIso);
      const reliabilityPromise = loadReliability(number);
      const affluencePromise = loadAffluence(number, dateIso);
      const supplementaryPromise = loadSupplementaryData(forceFresh)
        .catch((error) => console.warn('[Fiche Bétaillère] données complémentaires indisponibles', error));

      // Les données secondaires (composition / voies) ne doivent jamais bloquer
      // l'affichage des horaires, du LIVE et du parcours principal.
      const [liveResult, staticResult, reliabilityResult, affluenceResult] = await Promise.allSettled([
        livePromise,
        staticPromise,
        reliabilityPromise,
        affluencePromise
      ]);

      if (requestId !== state.requestId) return;
      const liveBundle = liveResult.status === 'fulfilled' ? liveResult.value : null;
      const candidates = staticResult.status === 'fulfilled' ? staticResult.value : [];
      const reliability = reliabilityResult.status === 'fulfilled' ? reliabilityResult.value : null;
      const affluence = affluenceResult.status === 'fulfilled' ? affluenceResult.value : null;
      const chosen = chooseStaticCandidate(candidates, liveBundle, dateIso);
      const liveJourneyRows = normalizeJourneyRows(liveBundle);
      let rows = liveJourneyRows.length
        ? liveJourneyRows
        : normalizeStaticRows(chosen, liveBundle);
      rows = applyEffectiveServicePattern(rows, liveBundle);

      if (!rows.length && liveBundle?.stops?.length) {
        rows = liveBundle.stops.map((name, index) => ({
          name,
          arrival: '—',
          departure: '—',
          sequence: index,
          raw: {}
        }));
      }
      if (!rows.length) {
        throw new Error(`Aucune circulation ${number} trouvée dans les horaires disponibles.`);
      }

      // Le bandeau décrit le trajet réellement assuré ; la timeline conserve
      // également le tronçon théorique supprimé pour l'expliquer visuellement.
      const effectiveRows = rows.filter((row) => !row.isDeleted);
      const heroRows = effectiveRows.length ? effectiveRows : rows;
      const heroState = renderHero(number, dateIso, heroRows, liveBundle);
      renderRoute(number, dateIso, rows, liveBundle);
      renderComposition(number, affluence);
      renderAffluence(affluence);
      renderReliability(reliability);
      state.lastBundle = { number, dateIso, rows, effectiveRows, liveBundle, reliability, affluence };

      // Quand les données complémentaires finissent plus tard, enrichir la fiche
      // en place sans relancer les appels principaux ni rouvrir le panneau.
      void supplementaryPromise.then(() => {
        if (requestId !== state.requestId || state.trainNumber !== number || state.dateIso !== dateIso) return;
        renderHero(number, dateIso, heroRows, liveBundle);
        renderRoute(number, dateIso, rows, liveBundle);
        renderComposition(number, affluence);
      });

      setupProfileActions(number, dateIso, !!heroState?.liveActive);
      refreshFavoriteButton();
      void ensureProfileTitle(number);
      byId('trainDetailPanel').setAttribute('aria-busy', 'false');
      byId('trainDetailPanel').setAttribute('aria-hidden', 'false');
      setFinderStatus(`Fiche ${number} chargée.`, 'success');
      byId('trainDetailPanel').focus?.({ preventScroll: true });
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.error('[Fiche Bétaillère] chargement impossible', error);
      const message = error?.message || 'Impossible de charger cette fiche.';
      byId('trainDetailPanel').setAttribute('aria-busy', 'false');
      byId('trainDetailSourceState').className = 'lb-train-profile__source is-error';
      byId('trainDetailSourceState').innerHTML = '<i></i> DONNÉES INDISPONIBLES';
      byId('trainDetailMessage').textContent = message;
      byId('trainDetailMessage').classList.add('is-error');
      byId('trainDetailStops').innerHTML = `<div class="lb-train-profile__empty">${safe(message)}</div>`;
      setFinderStatus(message, 'error');
    } finally {
      if (requestId === state.requestId && submit) submit.disabled = false;
    }
  }

  function removeLegacyTrainFinder() {
    // La recherche par numéro appartient désormais exclusivement à l'onglet
    // Recherche. L'ancien bloc était déplacé devant STAT par ce script.
    document.querySelectorAll('.lb-train-finder').forEach((finder) => finder.remove());

    // Sécurité si un ancien fragment mis en cache tente de réinjecter le bloc.
    const statsRoot = byId('stats');
    if (statsRoot && !statsRoot.__lbLegacyFinderGuard) {
      statsRoot.__lbLegacyFinderGuard = new MutationObserver(() => {
        statsRoot.querySelectorAll('.lb-train-finder').forEach((finder) => finder.remove());
      });
      statsRoot.__lbLegacyFinderGuard.observe(statsRoot, { childList: true });
    }
  }

  function bindProfile() {
    byId('trainDetailFavorite')?.addEventListener('click', toggleFavorite);
    document.addEventListener('lb:prefs-updated', refreshFavoriteButton);
    byId('trainDetailRefresh')?.addEventListener('click', (event) => {
      if (!state.trainNumber) return;
      const button = event.currentTarget;
      button.classList.add('is-spinning');
      openTrainProfile(state.trainNumber, state.dateIso, {
        forceFresh: true,
        origin: state.origin
      })
        .finally(() => window.setTimeout(() => button.classList.remove('is-spinning'), 250));
    });
    if (document.body) {
      new MutationObserver(() => {
        if (state.trainNumber) void ensureProfileTitle(state.trainNumber);
      }).observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const panel = byId('trainDetailPanel');
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lb-train-detail-open');
      document.body.classList.remove('lb-train-detail-from-map');
    });
  }

  async function getOfficialServicePattern(numberValue, dateValue) {
  const number = normalizeTrainNumber(numberValue);
  const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))
    ? String(dateValue)
    : todayIso();
  if (!number) return { rows: [], liveBundle: null };

  const [liveResult, staticResult] = await Promise.allSettled([
    loadLiveBundle(number, dateIso, false),
    fetchStaticCandidates(number, dateIso)
  ]);
  const liveBundle = liveResult.status === 'fulfilled' ? liveResult.value : null;
  const candidates = staticResult.status === 'fulfilled' ? staticResult.value : [];
  const chosen = chooseStaticCandidate(candidates, liveBundle, dateIso);
  const liveJourneyRows = normalizeJourneyRows(liveBundle);
  let rows = liveJourneyRows.length
    ? liveJourneyRows
    : normalizeStaticRows(chosen, liveBundle);
  rows = applyEffectiveServicePattern(rows, liveBundle);
  return { rows, liveBundle };
}

  function init() {
    removeLegacyTrainFinder();
    bindProfile();
    window.lbOpenTrainDetail = openTrainProfile;
    window.lbOpenTrainProfile = openTrainProfile;
    window.lbGetOfficialServicePattern = getOfficialServicePattern;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
