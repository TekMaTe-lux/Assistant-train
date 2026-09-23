(function(){
  function luxTodayISO(){
    try{
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Luxembourg', year:'numeric', month:'2-digit', day:'2-digit' });
      const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    }catch(e){
      return new Date().toISOString().slice(0,10);
    }
  }
  function dateMinusDays(iso, days){
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0,10);
  }
  const __LB_30D_CACHE_KEY = 'lb_home_30d_punctuality_v1';
  function read30DayPunctualityCache(){
    try{
      const raw = localStorage.getItem(__LB_30D_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const pct = Number(parsed?.pct);
      const key = String(parsed?.key || '').trim();
      if (!key || !Number.isFinite(pct)) return null;
      return { key, pct: Math.max(0, Math.min(100, pct)), from: parsed?.from || '', to: parsed?.to || '' };
    }catch(e){
      return null;
    }
  }
  function write30DayPunctualityCache(key, pct, from, to){
    try{
      const num = Number(pct);
      if (!key || !Number.isFinite(num)) return;
      localStorage.setItem(__LB_30D_CACHE_KEY, JSON.stringify({
        key: String(key),
        pct: Math.max(0, Math.min(100, num)),
        from: String(from || ''),
        to: String(to || ''),
        savedAt: Date.now()
      }));
    }catch(e){}
  }
  async function fetchPublicRawRange(from, to){
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const urls = [
      `${STATS_API_BASE}/api/stats/gtfs/rawrange?${qs}`,
      `${STATS_API_BASE}/stats/gtfs/rawrange?${qs}`
    ];
    let lastErr = null;
    for (const url of urls){
      try{
        const res = await fetch(url, { cache:'no-store', credentials:'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error('rawrange indisponible');
  }
  async function fetchPublicRange(from, to){
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const urls = [
      `${STATS_API_BASE}/api/stats/gtfs/range?${qs}`,
      `${STATS_API_BASE}/stats/gtfs/range?${qs}`
    ];
    let lastErr = null;
    for (const url of urls){
      try{
        const res = await fetch(url, { cache:'no-store', credentials:'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error('range indisponible');
  }
  async function ensure30DayPunctuality(){
    const fallbackTo = dateMinusDays(luxTodayISO(), 1);
    const fallbackFrom = dateMinusDays(fallbackTo, 29);
    const period = (typeof getLastDaysRange === 'function')
      ? getLastDaysRange(30)
      : { from: fallbackFrom, to: fallbackTo };
    const from = String(period?.from || fallbackFrom);
    const to = String(period?.to || fallbackTo);
    const key = `${from}_${to}`;
    const cached = read30DayPunctualityCache();

    if (window.__LB_LAST_30D_KEY === key && Number.isFinite(Number(window.__LB_LAST_30D_PCT))) {
      if (typeof updateHomePunctuality === 'function') updateHomePunctuality(window.__LB_LAST_30D_PCT, key);
      return Number(window.__LB_LAST_30D_PCT);
    }

    if (cached?.key === key && Number.isFinite(Number(cached.pct))) {
      window.__LB_LAST_30D_KEY = key;
      window.__LB_LAST_30D_PCT = Number(cached.pct);
      if (typeof updateHomePunctuality === 'function') updateHomePunctuality(cached.pct, key);
    } else {
      ['homeBerPunctuality','homeWxPunctuality'].forEach((id)=>{
        const el = document.getElementById(id);
        if (el && (!el.textContent || /^[-–—.\s%]*$/.test(el.textContent))) el.textContent = '…';
      });
    }

    const dailyPctFromSummary = (day) => {
      const total = Number(day?.total_trains || 0);
      const pctNot = Number(day?.pct_not_on_time);
      if (total > 0 && Number.isFinite(pctNot)) return 100 - pctNot;
      return null;
    };
    const avgFromRangeSeries = (range) => {
      const series = Array.isArray(range?.series) ? range.series : [];
      const values = series
        .filter(x => x && x.date >= from && x.date <= to)
        .map(x => 100 - Number(x?.pct_not_on_time ?? NaN))
        .filter(v => Number.isFinite(v));
      return values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
    };

    ['homeBerPunctuality','homeWxPunctuality'].forEach((id)=>{
      const el = document.getElementById(id);
      if (el && (!el.textContent || /^[-–—.\s%]*$/.test(el.textContent))) el.textContent = '…';
    });
    try{
      let pct = null;

      try{
        if (typeof loadRangeAPI === 'function'){
          const range = await loadRangeAPI(from, to);
          pct = avgFromRangeSeries(range);
        } else {
          throw new Error('loadRangeAPI indisponible');
        }
      }catch(_statsRangeErr){
        try{
          const range = await fetchPublicRange(from, to);
          pct = avgFromRangeSeries(range);
        }catch(_publicRangeErr){
          let rawPayload = null;
          try{
            if (typeof loadRawRangeAPI === 'function') rawPayload = await loadRawRangeAPI(from, to);
            else throw _publicRangeErr;
          }catch(_statsRawErr){
            try{
              rawPayload = await fetchPublicRawRange(from, to);
            }catch(_publicErr){
              throw _publicErr;
            }
          }

          const rawDays = (typeof normalizeRawRangePayload === 'function')
            ? normalizeRawRangePayload(rawPayload)
            : (Array.isArray(rawPayload) ? rawPayload : (Array.isArray(rawPayload?.days) ? rawPayload.days : []));

          const values = rawDays
            .filter(day => day && day.date >= from && day.date <= to)
            .map(day => {
              if (typeof computeDaySummaryFromRaw === 'function') return dailyPctFromSummary(computeDaySummaryFromRaw(day));
              return dailyPctFromSummary(day);
            })
            .filter(v => Number.isFinite(v));

          pct = values.length ? (values.reduce((a,b)=>a+b,0) / values.length) : null;
        }
      }
      if (!Number.isFinite(Number(pct))) throw new Error('Moyenne 30 jours invalide');

      window.__LB_LAST_30D_KEY = key;
      window.__LB_LAST_30D_PCT = Math.max(0, Math.min(100, Number(pct)));
      write30DayPunctualityCache(key, window.__LB_LAST_30D_PCT, from, to);
      if (pct != null && typeof updateHomePunctuality === 'function') updateHomePunctuality(pct, key);
      return pct;
    }catch(e){
      if (window.__LB_LAST_30D_KEY === key && Number.isFinite(Number(window.__LB_LAST_30D_PCT))) {
        if (typeof updateHomePunctuality === 'function') updateHomePunctuality(window.__LB_LAST_30D_PCT, key);
        return Number(window.__LB_LAST_30D_PCT);
      }
      if (cached?.key === key && Number.isFinite(Number(cached.pct))) {
        if (typeof updateHomePunctuality === 'function') updateHomePunctuality(cached.pct, key);
        return Number(cached.pct);
      }
      ['homeBerPunctuality','homeWxPunctuality'].forEach((id)=>{
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      return null;
    }
  }

  function applyHomeV13Tweaks(){
    const north = document.getElementById('homeTrafficLineNorth');
    if (north) north.textContent = 'Metz - Lux';
  }
  function kickHomePunctuality(){
    try{
      ensure30DayPunctuality().catch(()=>{});
    }catch(e){}
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', applyHomeV13Tweaks);
    document.addEventListener('DOMContentLoaded', kickHomePunctuality);
  } else {
    applyHomeV13Tweaks();
    kickHomePunctuality();
  }
  window.addEventListener('load', kickHomePunctuality);
  setTimeout(kickHomePunctuality, 400);
  setTimeout(kickHomePunctuality, 1400);
  window.ensure30DayPunctuality = ensure30DayPunctuality;
})();

;

(function(){
  function forceYesterdayPunctuality(){
    try{
      const title = document.querySelector('[data-home-punctuality-title], #homeWxPunctualityTitle, #homeBerPunctualityTitle');
      if (title) title.textContent = 'Ponctualité';
    }catch(e){}
  }

  function bindHomeCommentsScroll(){
    const feed = document.getElementById('homeLiveWallFeed');
    if (!feed || feed.dataset.scrollBound === '1') return;
    feed.dataset.scrollBound = '1';

    const stopIfScrollable = function(e){
      const el = e.currentTarget;
      if (!el) return;
      if (el.scrollHeight <= el.clientHeight + 2) return;
      e.stopPropagation();
    };

    feed.addEventListener('touchstart', stopIfScrollable, { passive:true });
    feed.addEventListener('touchmove', stopIfScrollable, { passive:true });
    feed.addEventListener('wheel', stopIfScrollable, { passive:true });
    feed.addEventListener('pointerdown', stopIfScrollable, { passive:true });
  }

  function install(){
    forceYesterdayPunctuality();
    bindHomeCommentsScroll();
  }

  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
  window.forceHomeCommentsScrollable = bindHomeCommentsScroll;
})();

;

(function(){
  function getOuterHeight(el){
    if(!el) return 0;
    const cs = window.getComputedStyle(el);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    return el.offsetHeight + mt + mb;
  }

  function applyHomeCommentsViewportLimit(){
    const feed = document.getElementById('homeLiveWallFeed');
    if(!feed) return;

    const items = Array.from(feed.querySelectorAll('.live-wall-item, .live-wall-item--home, .live-wall-item--compact'))
      .filter(el => el.offsetParent !== null);

    if(!items.length){
      feed.style.maxHeight = 'none';
      return;
    }

    const visible = items.slice(0, 4);
    const total = visible.reduce((sum, el) => sum + getOuterHeight(el), 0);
    if(total > 0){
      feed.style.maxHeight = Math.ceil(total) + 'px';
      feed.style.overflowY = 'auto';
    }
  }

  function wrapRender(){
    const original = window.renderHomeLiveWall;
    if(typeof original !== 'function' || original.__lbWrapped4Visible) return;

    const wrapped = function(){
      const out = original.apply(this, arguments);
      requestAnimationFrame(applyHomeCommentsViewportLimit);
      return out;
    };
    wrapped.__lbWrapped4Visible = true;
    window.renderHomeLiveWall = wrapped;
  }

  function install(){
    wrapRender();
    requestAnimationFrame(applyHomeCommentsViewportLimit);
    setTimeout(applyHomeCommentsViewportLimit, 120);
    setTimeout(applyHomeCommentsViewportLimit, 500);
  }

  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
  window.addEventListener('resize', applyHomeCommentsViewportLimit);
  window.applyHomeCommentsViewportLimit = applyHomeCommentsViewportLimit;
})();

;

(function(){
  function getUniqueItems(feed){
    const seen = new Set();
    return Array.from(feed.querySelectorAll('.live-wall-item, .live-wall-item--home, .live-wall-item--compact')).filter(function(el){
      if(!el || seen.has(el)) return false;
      seen.add(el);
      return el.offsetParent !== null;
    });
  }

  function limitHomeCommentsTo4(){
    var feed = document.getElementById('homeLiveWallFeed');
    if(!feed) return;
    var items = getUniqueItems(feed);
    if(!items.length){
      feed.style.maxHeight = 'none';
      feed.style.height = '';
      return;
    }
    var visible = items.slice(0,4);
    var top = visible[0].offsetTop;
    var last = visible[visible.length - 1];
    var cs = window.getComputedStyle(last);
    var mb = parseFloat(cs.marginBottom) || 0;
    var target = (last.offsetTop - top) + last.offsetHeight + mb;
    if(target > 0){
      feed.style.maxHeight = Math.ceil(target) + 'px';
      feed.style.height = Math.ceil(target) + 'px';
      feed.style.overflowY = 'auto';
    }
  }

  function syncPunctualityLayout(){
    try{
      var title = document.querySelector('[data-home-punctuality-title], #homeWxPunctualityTitle, #homeBerPunctualityTitle');
      if(title) title.textContent = 'Ponctualité';
    }catch(e){}
  }

  function renderHomeLiveWallFixed(){
    var feed = document.getElementById('homeLiveWallFeed');
    var form = document.getElementById('homeLiveWallForm');
    var cta = document.getElementById('homeLiveWallCta');
    if (!feed || !form || !cta || !window.lbCommentState) return;

    var wallAll = Array.isArray(window.lbCommentState.wall) ? window.lbCommentState.wall : [];
    var wall = wallAll.filter(function(it){
      var trainKey = '';
      if (typeof window.wallNormalizeKey === 'function' && typeof window.detectWallTrainNumber === 'function'){
        trainKey = window.wallNormalizeKey((it && it.trainNumber) || window.detectWallTrainNumber(it));
      }
      if (!trainKey) return true;
      if (typeof window.shouldHideWallCommentByAutomod === 'function'){
        return !window.shouldHideWallCommentByAutomod(it, trainKey);
      }
      return true;
    }).slice(0, 60);
    var can = window.lbIsAuthed === true;
    var pseudo = String(window.lbPrefsCache?.pseudo || '').trim().slice(0,24);
    var isAdmin = String(window.currentUser?.role || '').toLowerCase() === 'admin';

	    if (!wall.length){
	      feed.innerHTML = '<div class="live-wall-empty">Aucun commentaire pour le moment.</div>';
	    } else {
	      var fmtParisHour = function(ts){
	        try {
	          var raw = (ts == null) ? Date.now() : ts;
	          var parsed = (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))
	            ? new Date(raw.replace(' ', 'T') + 'Z')
	            : new Date(raw);
	          if (!Number.isFinite(parsed.getTime())) return '--:--';
	          var parisParts = function(dateObj){
	            var parts = new Intl.DateTimeFormat('fr-FR', {
	              timeZone: 'Europe/Paris',
	              year: 'numeric',
	              month: '2-digit',
	              day: '2-digit'
	            }).formatToParts(dateObj);
	            var pick = function(type){
	              var found = parts.find(function(p){ return p.type === type; });
	              return found ? found.value : '';
	            };
	            return { year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')) };
	          };
	          var commentDate = parisParts(parsed);
	          var nowDate = parisParts(new Date());
	          var commentStamp = Date.UTC(commentDate.year, commentDate.month - 1, commentDate.day);
	          var nowStamp = Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day);
	          var dayDiff = Math.round((nowStamp - commentStamp) / 86400000);
	          if (dayDiff === 0){
	            return parsed.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
	          }
	          if (dayDiff === 1) return 'hier';
	          return parsed.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', timeZone:'Europe/Paris' });
	        }
	        catch(_){ return '--:--'; }
	      };
	      feed.innerHTML = wall.map(function(it){
	        var renderWallHtml = (typeof window.lbRenderWallMessageHtml === 'function')
	          ? window.lbRenderWallMessageHtml
	          : function(v){ return escapeHtml(String(v || '')); };
	        var pseudoHtml = (typeof window.buildPseudoTriggerHtml === 'function')
	          ? window.buildPseudoTriggerHtml(it)
	          : '<strong>' + escapeHtml(it.pseudo || 'Voyageur') + '</strong>';
	        var actionsHtml = (typeof window.lbBuildCommentActionsHtml === 'function')
	          ? window.lbBuildCommentActionsHtml(it)
	          : '';
	        return '<div class="live-wall-item live-wall-item--home live-wall-item--compact"><div class="live-wall-item-text">' + pseudoHtml + '<span class="live-wall-inline-meta">' + escapeHtml(fmtParisHour(it.ts)) + '</span> : ' + renderWallHtml(it.text || '') + actionsHtml + '</div></div>';
	      }).join('');
	      feed.scrollTop = 0;
	    }

    form.hidden = !can;
    cta.hidden = can;
    if (!window.lbIsAuthed) cta.textContent = 'Connectez-vous pour commenter en direct.';
    else if (!pseudo) cta.textContent = 'Ajoutez un pseudo dans Mes préférences pour commenter.';
    else cta.textContent = '';

    requestAnimationFrame(limitHomeCommentsTo4);
    setTimeout(limitHomeCommentsTo4, 80);
  }

  function installHomeCommentsFix(){
    window.renderHomeLiveWall = renderHomeLiveWallFixed;
    syncPunctualityLayout();
    renderHomeLiveWallFixed();
  }

  document.addEventListener('DOMContentLoaded', installHomeCommentsFix);
  window.addEventListener('load', installHomeCommentsFix);
  window.addEventListener('resize', function(){ requestAnimationFrame(limitHomeCommentsTo4); });

  var mo = null;
  function armObserver(){
    var feed = document.getElementById('homeLiveWallFeed');
    if(!feed || mo) return;
    mo = new MutationObserver(function(){ requestAnimationFrame(limitHomeCommentsTo4); });
    mo.observe(feed, { childList:true, subtree:true, characterData:true });
  }
  document.addEventListener('DOMContentLoaded', armObserver);
  window.addEventListener('load', armObserver);

  window.limitHomeCommentsTo4 = limitHomeCommentsTo4;
})();

;

(function(){
  function commentItems(feed){
    if(!feed) return [];
    const list = Array.from(feed.querySelectorAll('.live-wall-item--home'));
    return list.filter(el => el && el.offsetParent !== null);
  }

  function lockFeedToFour(){
    const feed = document.getElementById('homeLiveWallFeed');
    if(!feed) return;

    const items = commentItems(feed);
    if(!items.length){
      feed.style.setProperty('height', '0px', 'important');
      feed.style.setProperty('max-height', '0px', 'important');
      return;
    }

    const visible = items.slice(0, 4);
    const first = visible[0];
    const last = visible[visible.length - 1];
    const firstBox = first.getBoundingClientRect();
    const lastBox = last.getBoundingClientRect();
    let target = Math.ceil((lastBox.bottom - firstBox.top) + 1);

    const cs = getComputedStyle(last);
    target += Math.ceil(parseFloat(cs.marginBottom) || 0);

    target = Math.max(56, target);
    target = Math.min(target, 96);

    feed.style.setProperty('height', target + 'px', 'important');
    feed.style.setProperty('max-height', target + 'px', 'important');
    feed.style.setProperty('min-height', target + 'px', 'important');
    feed.style.setProperty('overflow-y', 'auto', 'important');
    feed.style.setProperty('overflow-x', 'hidden', 'important');
  }

  function rerenderComments(){
    if(typeof window.renderHomeLiveWall === 'function'){
      window.renderHomeLiveWall();
    }
    requestAnimationFrame(lockFeedToFour);
    setTimeout(lockFeedToFour, 120);
    setTimeout(lockFeedToFour, 400);
    setTimeout(lockFeedToFour, 900);
  }

  function install(){
    rerenderComments();

    const feed = document.getElementById('homeLiveWallFeed');
    if(feed && !feed.__lbObs4){
      const mo = new MutationObserver(function(){
        requestAnimationFrame(lockFeedToFour);
        setTimeout(lockFeedToFour, 60);
      });
      mo.observe(feed, {childList:true, subtree:true, characterData:true});
      feed.__lbObs4 = mo;
    }

    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(function(){
        setTimeout(lockFeedToFour, 50);
        setTimeout(lockFeedToFour, 250);
      }).catch(function(){});
    }
  }

  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
  window.addEventListener('resize', function(){
    requestAnimationFrame(lockFeedToFour);
    setTimeout(lockFeedToFour, 100);
  });

  window.lockHomeCommentsToFourFinal = lockFeedToFour;
})();

;

(function(){
  var homePunctChart30d = null;
  var homePunctChartYesterday = null;
  var homePunctualityRequest = null;
  var homePunctualityLoadedKey = '';
  var homePunctualityLastValues = null;
  var HOME_RING_REST_COLOR = 'rgba(125,217,255,0.18)';
  var HOME_STATS_ORIGIN = 'https://vps.labetaillere.fr';
  var HOME_PUNCT_CACHE_KEY = 'lb_home_overview_punctuality_v2';
  var HOME_CENTER_PLUGIN_ID = 'homePunctCenterText';
  var homeCenterPluginRegistered = false;

  function homeFmtPctShort(x){
    var n = Number(x);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n) + '%';
  }

  function homeColorForPunctuality(score){
    var n = Number(score);
    if (!Number.isFinite(n)) return '#7cf7ff';
    return window.lbPunctualityColor(n);
  }

  function makeDonutRing(node){
    return node || null;
  }

  function ensureHomePunctualityChart(){
    var host = document.getElementById('homePunctualityChartHost');
    if (!host) return null;
    host.classList.add('home-punct-chart-host');

    if (!document.getElementById('homeWxPunctualityChart30d') || !document.getElementById('homeWxPunctualityChartYesterday')){
      host.innerHTML =
        '<div class="home-punct-chart-wrap" title="Ponctualité des 30 derniers jours complets">' +
          '<div id="homeWxPunctualityChart30d" class="home-punct-css-ring" role="img" aria-label="Ponctualité à J-30" data-pct="">' +
            '<strong class="home-punct-css-value">—</strong>' +
          '</div>' +
          '<span class="home-punct-mini-label">J-30</span>' +
        '</div>' +
        '<div class="home-punct-chart-wrap" title="Ponctualité de la journée d’hier">' +
          '<div id="homeWxPunctualityChartYesterday" class="home-punct-css-ring" role="img" aria-label="Ponctualité à J-1" data-pct="">' +
            '<strong class="home-punct-css-value">—</strong>' +
          '</div>' +
          '<span class="home-punct-mini-label">J-1</span>' +
        '</div>';
    }

    if (!homePunctChart30d) homePunctChart30d = makeDonutRing(document.getElementById('homeWxPunctualityChart30d'));
    if (!homePunctChartYesterday) homePunctChartYesterday = makeDonutRing(document.getElementById('homeWxPunctualityChartYesterday'));
    return { thirty: homePunctChart30d, yesterday: homePunctChartYesterday };
  }

  function setDonutValue(ring, pct, label, total){
    if (!ring) return;
    var value = Number(pct);
    var valid = Number.isFinite(value);
    value = valid ? Math.max(0, Math.min(100, value)) : 0;
    var ringColor = valid ? homeColorForPunctuality(value) : '#668b95';
    ring.style.setProperty('--lb-home-punct-pct', (valid ? value : 0) + '%');
    ring.style.setProperty('--lb-home-punct-color', ringColor);
    ring.dataset.pct = valid ? String(value) : '';
    var valueNode = ring.querySelector('.home-punct-css-value');
    if (valueNode) valueNode.textContent = valid ? homeFmtPctShort(value) : '—';

    var description = valid
      ? 'Ponctualité ' + label + ' : ' + value.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %, ' + Number(total || 0).toLocaleString('fr-FR') + ' circulations observées'
      : 'Ponctualité ' + label + ' indisponible';
    ring.setAttribute('aria-label', description);
    if (ring.parentElement) ring.parentElement.title = description;
  }

  function renderHomePunctualityCharts(p30, py){
    var charts = ensureHomePunctualityChart();
    if (!charts) return;
    setDonutValue(charts.thirty, p30 && p30.pct, 'J-30', p30 && p30.total);
    setDonutValue(charts.yesterday, py && py.pct, 'J-1', py && py.total);
  }

  function homeTodayIso(){
    try{
      var parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone:'Europe/Paris',
          year:'numeric',
          month:'2-digit',
          day:'2-digit'
        }).formatToParts(new Date()).map(function(part){ return [part.type, part.value]; })
      );
      return parts.year + '-' + parts.month + '-' + parts.day;
    }catch(e){
      return new Date().toISOString().slice(0, 10);
    }
  }

  function homeDateAdd(iso, days){
    var date = new Date(iso + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function homeRanges(){
    var yesterday = homeDateAdd(homeTodayIso(), -1);
    return {
      yesterday: { from:yesterday, to:yesterday },
      thirty: { from:homeDateAdd(yesterday, -29), to:yesterday }
    };
  }

  function overviewMetric(payload){
    var dashboard = payload && payload.dashboard || {};
    var cards = payload && payload.cards || dashboard;
    var total = Number(cards.total_trains != null ? cards.total_trains : dashboard.total_trains);
    var punctuality = Number(cards.punctuality_rate != null ? cards.punctuality_rate : dashboard.punctuality_rate);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(punctuality)) return null;
    return {
      pct: Math.max(0, Math.min(100, punctuality)),
      total: total
    };
  }

  async function fetchHomeOverview(range){
    var path = '/api/stats/beta/overview?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
    var urls = [HOME_STATS_ORIGIN + path, path];
    var lastError = null;
    for (var i = 0; i < urls.length; i++){
      try{
        var response = await fetch(urls[i], { credentials:'include', cache:'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.json();
      }catch(error){
        lastError = error;
      }
    }
    throw lastError || new Error('API statistiques indisponible');
  }

  function readHomePunctualityCache(key){
    try{
      var cached = JSON.parse(localStorage.getItem(HOME_PUNCT_CACHE_KEY) || 'null');
      if (!cached || cached.key !== key) return null;
      var thirty = cached.thirty;
      var yesterday = cached.yesterday;
      if (!overviewMetric({ cards:{ total_trains:thirty && thirty.total, punctuality_rate:thirty && thirty.pct } })) return null;
      if (!overviewMetric({ cards:{ total_trains:yesterday && yesterday.total, punctuality_rate:yesterday && yesterday.pct } })) return null;
      return { thirty:thirty, yesterday:yesterday };
    }catch(e){
      return null;
    }
  }

  function writeHomePunctualityCache(key, values){
    try{
      localStorage.setItem(HOME_PUNCT_CACHE_KEY, JSON.stringify({
        key:key,
        thirty:values.thirty,
        yesterday:values.yesterday,
        savedAt:Date.now()
      }));
    }catch(e){}
  }

  async function loadHomePunctualityChart(force){
    if (homePunctualityRequest && !force) return homePunctualityRequest;
    var ranges = homeRanges();
    var key = ranges.thirty.from + '_' + ranges.thirty.to;
    if (!force && homePunctualityLoadedKey === key) return homePunctualityLastValues;
    var cached = readHomePunctualityCache(key);
    if (cached) {
      homePunctualityLastValues = cached;
      renderHomePunctualityCharts(cached.thirty, cached.yesterday);
    }

    homePunctualityRequest = (async function(){
      try{
        var payloads = await Promise.all([
          fetchHomeOverview(ranges.thirty),
          fetchHomeOverview(ranges.yesterday)
        ]);
        var values = {
          thirty:overviewMetric(payloads[0]),
          yesterday:overviewMetric(payloads[1])
        };
        if (!values.thirty || !values.yesterday) throw new Error('Ponctualité invalide');
        writeHomePunctualityCache(key, values);
        homePunctualityLastValues = values;
        renderHomePunctualityCharts(values.thirty, values.yesterday);
        window.__LB_HOME_PUNCTUALITY = {
          source:'beta/overview',
          ranges:ranges,
          values:values
        };
        return values;
      }catch(error){
        if (!cached) renderHomePunctualityCharts(null, null);
        homePunctualityLastValues = cached;
        console.warn('[Accueil] Ponctualité J-30 / J-1 indisponible', error);
        return cached;
      }finally{
        homePunctualityLoadedKey = key;
        homePunctualityRequest = null;
      }
    })();
    return homePunctualityRequest;
  }

  function applyHomePunctualityVisual(){
    try{
      var title = document.getElementById('homePunctCardTitle');
      if (title) title.textContent = 'Ponctualité';
      ensureHomePunctualityChart();
      renderHomePunctualityCharts(null, null);
    }catch(e){}
  }

  document.addEventListener('DOMContentLoaded', function(){ applyHomePunctualityVisual(); loadHomePunctualityChart(); });
  window.addEventListener('load', loadHomePunctualityChart);
  setTimeout(loadHomePunctualityChart, 250);
  setTimeout(loadHomePunctualityChart, 1200);
  window.loadHomePunctualityChart = loadHomePunctualityChart;
})();

;

(() => {
  const motionOk = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let refreshQueued = false;
  const selectors = [
    '#homeTrafficBadgeNorth', '#homeTrafficBadgeSouth', '#homeWxFromNow', '#homeWxToNow', '#homeWxPunctuality', '#homeWxRisk',
    '#homeBerLine1', '#homeBerContext', '#homeBerPunctuality', '#homeFavSlot', '#homeWelcomeLine'
  ];

  function pulse(el, changed){
    if (!motionOk || !el) return;
    const cls = changed ? 'is-state-changed' : 'is-updating';
    el.classList.remove('is-updating', 'is-state-changed');
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), changed ? 460 : 340);
    });
  }

  function trafficSeverity(el){
    if (!el) return 0;
    if (el.classList.contains('traffic-pill--red')) return 4;
    if (el.classList.contains('traffic-pill--orange')) return 3;
    if (el.classList.contains('traffic-pill--yellow')) return 2;
    if (el.classList.contains('traffic-pill--green')) return 1;
    return 0;
  }

  function remember(el, value, severity = ''){
    if (!el) return;
    const nextValue = value == null ? '' : String(value);
    const nextSeverity = severity == null ? '' : String(severity);
    const changed = el.dataset.lastValue != null && el.dataset.lastValue !== '' && el.dataset.lastValue !== nextValue;
    const severityUp = el.dataset.lastSeverity != null && el.dataset.lastSeverity !== '' && Number(nextSeverity) > Number(el.dataset.lastSeverity);
    el.dataset.lastValue = nextValue;
    el.dataset.lastSeverity = nextSeverity;
    el.classList.toggle('is-severity-up', severityUp);
    pulse(el, changed);
  }

  function syncLabels(){
    const punctualityTitle = document.getElementById('homeWxPunctualityTitle');
    const punctualityValue = document.getElementById('homeWxPunctuality');
    if (punctualityTitle) punctualityTitle.textContent = 'Ponctualité';
    if (punctualityValue) punctualityValue.title = 'Moyenne de ponctualité calculée sur les 7 derniers jours clos';
    ['homeTrafficBadgeNorth','homeTrafficBadgeSouth'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.title = 'Mise à jour automatique via GTFS temps réel';
    });
    const risk = document.getElementById('homeWxRisk');
    if (risk && !risk.title) risk.title = 'Météo synchronisée avec vos gares favorites quand elles sont définies';
  }

  function refreshVisualState(){
    syncLabels();
    selectors.forEach((selector) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.setAttribute('data-home-animated', '1');
      const value = selector === '#homeFavSlot' ? el.textContent.replace(/\s+/g, ' ').trim() : el.textContent.trim();
      remember(el, value, selector.includes('TrafficBadge') ? trafficSeverity(el) : '');
    });
  }

  function scheduleRefresh(){
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshVisualState();
    });
  }

  function wrap(name){
    const original = window[name];
    if (typeof original !== 'function' || original.__lbPremiumWrapped) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      Promise.resolve(result).finally(scheduleRefresh);
      return result;
    };
    wrapped.__lbPremiumWrapped = true;
    window[name] = wrapped;
  }

  function installObserver(){
    const root = document.querySelector('.home-dashboard') || document.getElementById('home');
    if (!root || root.__lbPremiumObserver) return;
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(root, { subtree:true, childList:true, characterData:false });
    root.__lbPremiumObserver = observer;
  }

  function install(){
    ['updateHomeWeather', 'updateHomeTrafficStatus', 'updateHomeBerBlock', 'updateHomePunctuality', 'lbRenderHomeFavPreview', 'renderHomeLiveWall'].forEach(wrap);
    installObserver();
    refreshVisualState();
    setTimeout(refreshVisualState, 400);
    setTimeout(refreshVisualState, 1400);
  }

  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
  window.addEventListener('gtfsrt:loaded', scheduleRefresh);
})();
