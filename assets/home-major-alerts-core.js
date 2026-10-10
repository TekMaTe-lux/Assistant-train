'use strict';
/* Operational works dates override a publication window or a generic heading. */
window.LBWorkNoticeState = window.LBWorkNoticeState || ((event, now = Date.now()) => {
  const text = ['summary','title','description','text','detail','header_text','description_text','detail_html']
    .map(key => String(event?.[key] || '').replace(/<[^>]*>/g, ' '))
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  if (event?.kind !== 'travaux' && !/\btravaux\b|operations programmees|chantier/.test(text)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(now)).map(part => [part.type, part.value]));
  const wallNow = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  const months = {janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12};
  const M = '(?:'+Object.keys(months).join('|')+')';
  const W = '(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+)?';
  const T = '(?:\\s+(?:a\\s+)?(\\d{1,2})[h:](\\d{2})?)?';
  const date = (day,month,year,hour,minute,end=false) => {
    const y=+(year || parts.year),m=months[month],d=+day,h=+(hour || 0),n=+(minute || 0);
    const value=Date.UTC(y,m-1,d,h,n);
    const check=new Date(value);
    if (!m || check.getUTCFullYear()!==y || check.getUTCMonth()!==m-1 || check.getUTCDate()!==d || h>23 || n>59) return null;
    return value + (end && hour == null ? 86400000-1 : 0);
  };
  const intervals=[];
  let remaining=text;
  const range=new RegExp('(?:du|depuis le|a partir du)\\s+'+W+'(\\d{1,2})(?:er)?(?:\\s+('+M+'))?(?:\\s+(\\d{4}))?'+T+'\\s+(?:au|jusqu[\\s\\x27]*au)\\s+'+W+'(\\d{1,2})(?:er)?\\s+('+M+')(?:\\s+(\\d{4}))?'+T,'g');
  for (const match of text.matchAll(range)) {
    const [,d1,m1,y1,h1,n1,d2,m2,y2,h2,n2]=match;
    const a=date(d1,m1 || m2,y1 || y2,h1,n1),b=date(d2,m2,y2 || y1,h2,n2,true);
    if(a!==null && b!==null && b>=a) { intervals.push([a,b]); remaining=remaining.replace(match[0],' '); }
  }
  const discrete=new RegExp('(?<!\\d)(\\d{1,2}(?:er)?(?:\\s*(?:et|&|/|-)\\s*\\d{1,2})*)\\s+('+M+')(?:\\s+(\\d{4}))?','g');
  for(const match of remaining.matchAll(discrete)) {
    for(const day of match[1].match(/\d{1,2}/g)) {
      const a=date(day,match[2],match[3]),b=date(day,match[2],match[3],null,null,true);
      if(a!==null && b!==null) intervals.push([a,b]);
    }
  }
  if(!intervals.length) return null;
  if(intervals.some(([a,b]) => a<=wallNow && wallNow<=b)) return 'active';
  return intervals.some(([a]) => a>wallNow) ? 'upcoming' : 'ended';
});


document.documentElement.dataset.homeMajorAlertsController = '4';

function setHomeMajorAlertModal(open) {
  const modal = document.getElementById('homeMajorAlertModal');
  if (!modal) return;
  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  modal.classList.toggle('is-open', open);
  if (open) modal.style.display = 'flex';
  else modal.style.removeProperty('display');
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.style.toggleProperty?.('overflow', open ? 'hidden' : '');
  if (!open) document.body.style.removeProperty('overflow');
}

window.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('#homeMajorAlertBadge');
  const close = event.target.closest?.('#homeMajorAlertClose');
  const backdrop = event.target.id === 'homeMajorAlertModal';
  if (!trigger && !close && !backdrop) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (close || backdrop) {
    window.__lbMajorAlertSuppressOpenUntil = Date.now() + 650;
  }
  document.getElementById('lbMajorAlertBanner')?.classList.toggle('is-paused', !!trigger);
  setHomeMajorAlertModal(!!trigger);
}, true);

(function initHomeMajorAlerts(){
  'use strict';

  if (window.__lbHomeMajorAlertsReady) return;

  const SIRI_URL = 'https://vps.labetaillere.fr/g/72ab61c9';
  const badge = document.getElementById('homeMajorAlertBadge');
  const countNode = document.getElementById('homeMajorAlertCount');
  const modal = document.getElementById('homeMajorAlertModal');
  const body = document.getElementById('homeMajorAlertBody');
  const closeButton = document.getElementById('homeMajorAlertClose');
  if (!badge || !countNode || !modal || !body) {
    window.setTimeout(initHomeMajorAlerts, 200);
    return;
  }
  window.__lbHomeMajorAlertsReady = true;

  // Sortir la modale de la grille d'accueil : position fixed fiable sur PC, iOS et Android.
  if (modal.parentElement !== document.body) document.body.appendChild(modal);

  // LB_MAJOR_ALERT_BANNER_V1 — vue compacte des mêmes alertes majeures que le badge.
  // Aucun appel réseau supplémentaire : le bandeau est alimenté par render(items).
  let currentBannerSignature = '';
  let dismissedBannerSignature = '';

  const ensureBannerUi = () => {
    let style = document.getElementById('lb-major-alert-banner-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lb-major-alert-banner-style';
      style.textContent = `
        #lbMajorAlertBanner[hidden] { display:none !important; }
        #lbMajorAlertBanner {
          --alarm:#ff405c;
          --alarm-soft:#ff9baa;
          --lb-ticker-gap:34px;
          --lb-ticker-duration:24s;
          position:fixed;
          left:0;
          right:0;
          top:var(--lb-major-banner-top,72px);
          z-index:12950;
          overflow:hidden;
          padding:0 max(12px,env(safe-area-inset-right)) 0 max(12px,env(safe-area-inset-left));
          border-block:1px solid rgba(255,66,95,.32);
          background:linear-gradient(90deg,#3d0d19 0%,#240d15 60%,#180b11 100%);
          box-shadow:0 8px 22px rgba(0,0,0,.26),inset 0 -1px rgba(255,255,255,.03);
          -webkit-backdrop-filter:blur(12px);
          backdrop-filter:blur(12px);
        }
        #lbMajorAlertBanner[data-level="warning"] {
          --alarm:#ffb44b;
          --alarm-soft:#ffe0a7;
          border-block-color:rgba(255,177,67,.32);
          background:linear-gradient(90deg,#44300e 0%,#2a1b10 60%,#17120c);
        }
        .lb-major-alert-banner__inner {
          width:100%;
          max-width:1240px;
          margin:0 auto;
          min-height:39px;
          display:grid;
          grid-template-columns:28px minmax(0,1fr) auto;
          gap:10px;
          align-items:center;
          padding:3px 0;
        }
        .lb-major-alert-banner__icon {
          width:27px;
          height:27px;
          display:grid;
          place-items:center;
          flex-shrink:0;
          color:var(--alarm);
          filter:drop-shadow(0 0 4px color-mix(in srgb,var(--alarm) 42%,transparent));
        }
        .lb-major-alert-banner__icon svg { display:block; width:100%; height:100%; }
        .lb-major-alert-banner__ticker {
          position:relative;
          min-width:0;
          overflow:hidden;
          white-space:nowrap;
          -webkit-mask-image:linear-gradient(90deg,transparent,#000 12px,#000 calc(100% - 12px),transparent);
          mask-image:linear-gradient(90deg,transparent,#000 12px,#000 calc(100% - 12px),transparent);
        }
        .lb-major-alert-banner__track {
          display:flex;
          align-items:center;
          gap:var(--lb-ticker-gap);
          width:max-content;
          animation:lbMajorTicker var(--lb-ticker-duration) linear infinite;
          will-change:transform;
        }
        .lb-major-alert-banner__repeat {
          display:block;
          flex:0 0 auto;
          white-space:nowrap;
          font:800 .92rem/1.2 "Rajdhani",system-ui,sans-serif;
          letter-spacing:.008em;
          color:#fff5f5;
          text-shadow:0 0 8px rgba(255,102,126,.12);
        }
        @keyframes lbMajorTicker {
          from { transform:translate3d(0,0,0); }
          to { transform:translate3d(calc(-50% - 17px),0,0); }
        }
        #lbMajorAlertBanner.is-paused .lb-major-alert-banner__track,
        .lb-major-alert-banner__ticker:hover .lb-major-alert-banner__track,
        .lb-major-alert-banner__ticker:focus-within .lb-major-alert-banner__track {
          animation-play-state:paused;
        }
        .lb-major-alert-banner__actions {
          flex:0 0 auto;
          display:flex;
          align-items:center;
          gap:8px;
        }
        .lb-major-alert-banner__more {
          border:0;
          padding:5px 0;
          background:transparent;
          color:var(--alarm-soft);
          font:800 .73rem/1 "Rajdhani",system-ui,sans-serif;
          letter-spacing:.01em;
          white-space:nowrap;
          cursor:pointer;
          touch-action:manipulation;
        }
        .lb-major-alert-banner__more::after {
          content:" ›";
          font-size:1.1em;
          color:var(--alarm);
        }
        #lbMajorAlertBanner .lb-major-alert-banner__close {
          appearance:none;
          display:grid;
          place-items:center;
          width:30px !important;
          height:30px !important;
          min-width:30px !important;
          min-height:30px !important;
          max-width:30px !important;
          max-height:30px !important;
          padding:0;
          margin:0;
          border:0;
          border-radius:7px;
          background:transparent;
          color:rgba(255,223,228,.72);
          font:600 17px/1 system-ui,sans-serif !important;
          cursor:pointer;
          touch-action:manipulation;
        }
        .lb-major-alert-banner__close:hover { color:#fff; background:rgba(255,73,98,.1); }
        .lb-major-alert-banner__more:hover { color:#fff; }
        .lb-major-alert-banner__more:focus-visible,
        .lb-major-alert-banner__close:focus-visible {
          outline:2px solid var(--alarm);
          outline-offset:2px;
        }
        #lbMajorAlertSpacer { height:0; pointer-events:none; }
        body.lb-major-alert-banner-visible #lbMajorAlertSpacer { height:var(--lb-major-banner-height,41px); }
        @media (max-width:700px) {
          #lbMajorAlertBanner {
            padding-left:max(7px,env(safe-area-inset-left));
            padding-right:max(7px,env(safe-area-inset-right));
          }
          .lb-major-alert-banner__inner {
            min-height:36px;
            grid-template-columns:25px minmax(0,1fr) auto;
            gap:6px;
            padding:3px 0;
          }
          .lb-major-alert-banner__icon { width:24px; height:24px; }
          .lb-major-alert-banner__repeat { font-size:.85rem; }
          .lb-major-alert-banner__actions { gap:5px; }
          .lb-major-alert-banner__more { font-size:.69rem; }
          #lbMajorAlertBanner .lb-major-alert-banner__close { width:30px !important; min-width:30px !important; min-height:30px !important; height:30px !important; max-width:30px !important; max-height:30px !important; font-size:17px !important; }
          body.lb-major-alert-banner-visible #lbMajorAlertSpacer { height:var(--lb-major-banner-height,38px); }
        }
        @keyframes lbTickerAlarmGlow {
          0%,100% { filter:drop-shadow(0 0 3px color-mix(in srgb,var(--alarm) 35%,transparent)); }
          50% { filter:drop-shadow(0 0 7px color-mix(in srgb,var(--alarm) 60%,transparent)); }
        }
        #lbMajorAlertBanner[data-level="critical"] .lb-major-alert-banner__icon {
          animation:lbTickerAlarmGlow 3.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion:reduce) {
          .lb-major-alert-banner__track { animation:none !important; width:100%; will-change:auto; }
          .lb-major-alert-banner__repeat:first-child { overflow:hidden; text-overflow:ellipsis; max-width:100%; }
          .lb-major-alert-banner__repeat:last-child { display:none; }
          .lb-major-alert-banner__icon { animation:none !important; }
        }
      `;
      document.head.appendChild(style);
    }

    let banner = document.getElementById('lbMajorAlertBanner');
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'lbMajorAlertBanner';
      banner.hidden = true;
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = `
        <div class="lb-major-alert-banner__inner">
          <span class="lb-major-alert-banner__icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true"><path d="M14.3 4.4c.75-1.35 2.65-1.35 3.4 0l12.15 21.1c.77 1.34-.19 3.02-1.73 3.02H3.88c-1.54 0-2.5-1.68-1.73-3.02L14.3 4.4Z" fill="currentColor"/><path d="M16 11v8" fill="none" stroke="#2c0d16" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23.2" r="1.7" fill="#2c0d16"/></svg>
          </span>
          <div class="lb-major-alert-banner__ticker" id="lbMajorAlertBannerTicker" aria-label="Alerte de circulation">
            <div class="lb-major-alert-banner__track" aria-hidden="true">
              <span class="lb-major-alert-banner__repeat" id="lbMajorAlertBannerText"></span>
              <span class="lb-major-alert-banner__repeat" id="lbMajorAlertBannerEcho"></span>
            </div>
          </div>
          <div class="lb-major-alert-banner__actions">
            <button class="lb-major-alert-banner__more" id="lbMajorAlertBannerOpen" type="button">Plus d’infos</button>
            <button class="lb-major-alert-banner__close" id="lbMajorAlertBannerClose" type="button" aria-label="Masquer ce bandeau"><span aria-hidden="true">×</span></button>
          </div>
        </div>`;

      const topBar = document.querySelector('.top-bar');
      if (topBar?.parentNode) topBar.insertAdjacentElement('afterend', banner);
      else document.body.prepend(banner);
    }

    let spacer = document.getElementById('lbMajorAlertSpacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.id = 'lbMajorAlertSpacer';
      spacer.setAttribute('aria-hidden', 'true');
      banner.insertAdjacentElement('afterend', spacer);
    }
    return banner;
  };

  const banner = ensureBannerUi();
  const bannerText = document.getElementById('lbMajorAlertBannerText');
  const bannerEcho = document.getElementById('lbMajorAlertBannerEcho');
  const bannerTicker = document.getElementById('lbMajorAlertBannerTicker');
  const bannerOpen = document.getElementById('lbMajorAlertBannerOpen');
  const bannerClose = document.getElementById('lbMajorAlertBannerClose');

  const syncBannerGeometry = () => {
    const topBar = document.querySelector('.top-bar');
    const top = topBar ? Math.max(0, Math.round(topBar.getBoundingClientRect().bottom)) : 0;
    document.documentElement.style.setProperty('--lb-major-banner-top', `${top}px`);
    if (!banner.hidden) {
      const height = Math.max(44, Math.round(banner.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--lb-major-banner-height', `${height}px`);
    }
  };
  window.addEventListener('resize', syncBannerGeometry, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(syncBannerGeometry, 80), { passive: true });
  window.addEventListener('load', () => window.setTimeout(syncBannerGeometry, 120), { passive: true });

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  const normalize = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const activeNow = (situation, now) => {
    const workState = window.LBWorkNoticeState(situation, now);
    if (workState === 'upcoming' || workState === 'ended') return false;
    const periods = Array.isArray(situation?.validity_periods)
      ? situation.validity_periods
      : [];
    if (!periods.length) return false;
    return periods.some((period) => {
      const start = Date.parse(period?.start || '');
      const end = Date.parse(period?.end || '');
      return (!Number.isFinite(start) || start <= now)
        && (!Number.isFinite(end) || now <= end);
    });
  };

  const affectedTrainNumbers = (situation) => {
    const numbers = new Set();
    (Array.isArray(situation?.affects) ? situation.affects : []).forEach((affected) => {
      (Array.isArray(affected?.vehicle_journeys) ? affected.vehicle_journeys : [])
        .forEach((ref) => {
          const match = String(ref || '').match(/(?:^|\D)(\d{5,6})(?:\D|$)/);
          if (match) numbers.add(match[1]);
        });
    });
    return numbers;
  };

  const isCorridorTrain = (number) =>
    /^(?:885\d{2}|887\d{2}|888\d{2}|837[56]\d{2}|8340\d{2})$/.test(String(number || ''));

  const CORRIDOR_PLACE_GROUPS = [
    ['nancy'], ['champigneulles'], ['frouard'], ['pompey'], ['dieulouard'],
    ['pont-a-mousson', 'pont a mousson'], ['pagny-sur-moselle', 'pagny'],
    ['noveant'], ['ars-sur-moselle'], ['metz'], ['woippy'], ['maizieres-les-metz'],
    ['hagondange'], ['uckange'], ['thionville'], ['hettange-grande', 'hettange'],
    ['zoufftgen'], ['bettembourg'], ['luxembourg']
  ];
  const OUTSIDE_CORRIDOR_PLACES = [
    'varangeville', 'luneville', 'saint-nicolas-de-port', 'saint nicolas de port',
    'dombasle', 'blainville', 'epinal', 'remiremont', 'saint-die', 'saint die',
    'sarrebourg', 'saverne', 'strasbourg', 'bar-le-duc', 'bar le duc',
    'toul', 'longwy', 'verdun'
  ];

  const corridorPlacesIn = (text) => CORRIDOR_PLACE_GROUPS
    .filter((aliases) => aliases.some((place) => text.includes(place)))
    .map((aliases) => aliases[0]);

  const isCorridorText = (text) => corridorPlacesIn(text).length > 0;

  // Certains broadcasts SIRI régionaux associent des centaines de trains à un
  // chantier local. Un unique terminus du corridor (ex. Nancy) ne suffit pas :
  // l'alerte doit citer au moins deux points du sillon si elle mentionne une zone extérieure.
  const isOutsideCorridorOnly = (text) => {
    const hasOutsidePlace = OUTSIDE_CORRIDOR_PLACES.some((place) => text.includes(place));
    if (!hasOutsidePlace) return false;
    return corridorPlacesIn(text).length < 2;
  };

  // Une substitution par autocars avec circulation réellement perturbée est
  // majeure, même si le chantier est programmé. Le mot "travaux" seul ne l'est pas.
  const hasSubstitutionImpact = (text) =>
    /(?:autocars?|cars?|bus) (?:de|d') (?:substitution|remplacement)|trains?[^.]{0,100}remplac[^.]{0,60}(?:autocars?|cars?|bus)/.test(text)
    && /circulation[^.]{0,120}perturbee|trains?[^.]{0,100}(?:supprim|remplac)|(?:service|trafic)[^.]{0,80}(?:reduit|modifie|perturbe)/.test(text);

  const hasMajorImpact = (text) =>
    /(tous les trains[^.]{0,90}(supprim|remplac)|interruption (totale|des circulations)|circulation[^.]{0,80}(interromp|tres perturbee|très perturbée)|aucun train|nombreuses suppressions|remplac[ée]s? par des cars|forts? retards?|retards? importants?)/.test(text)
    || hasSubstitutionImpact(text);

  // Même hiérarchie et mêmes couleurs que les cartes de l'onglet Perturbations.
  const severityFor = (text) => {
    if (/(tous les trains[^.]{0,100}supprim|interruption totale|aucun train|circulation[^.]{0,80}interromp)/.test(text)) {
      return { key: 'critical', icon: '❌', label: 'Circulation interrompue', rank: 5 };
    }
    if (hasSubstitutionImpact(text)) {
      // Rouge : substitution routière + fort impact, sans prétendre que
      // TOUS les trains sont remplacés si la source SNCF ne l'indique pas.
      return { key: 'critical', icon: '🚌', label: 'Trafic très perturbé · Cars de substitution', rank: 5 };
    }
    if (/circulation[^.]{0,100}perturbee/.test(text) && /suppressions?/.test(text)) {
      return { key: 'critical', icon: '⚠️', label: 'Service perturbé', rank: 5 };
    }
    if (/(service reduit|service modifie|nombreuses suppressions|remplac[ée]s? par des cars)/.test(text)) {
      return { key: 'warning', icon: '⚠️', label: 'Service réduit', rank: 4 };
    }
    if (/(forts? retards?|retards? importants?)/.test(text)) {
      return { key: 'delay', icon: '⏰', label: 'Retards importants', rank: 3 };
    }
    if (/travaux/.test(text)) {
      return { key: 'works', icon: '🔧', label: 'Travaux', rank: 2 };
    }
    return { key: 'info', icon: 'ℹ️', label: 'Information trafic', rank: 1 };
  };

  function classify(situation){
    const fullText = [
      situation?.summary,
      situation?.description,
      situation?.detail
    ].filter(Boolean).join(' ');
    const text = normalize(fullText);
    const allTrains = affectedTrainNumbers(situation);
    const corridorTrains = Array.from(allTrains).filter(isCorridorTrain);
    const participant = String(situation?.participant_ref || '').toUpperCase();
    const scope = String(situation?.scope_type || '').toLowerCase();

    if (isOutsideCorridorOnly(text)) return null;

    const relevant = corridorTrains.length > 0
      || ((participant === 'LOR' || scope === 'general') && isCorridorText(text));
    const broad = scope === 'general' || corridorTrains.length >= 8;

    // Les messages SIRI Lorraine sont parfois rédigés de façon très sobre
    // ("circulation perturbée", "des suppressions sont à prévoir") sans employer
    // les mots "très perturbée". Si LOR cite au moins deux points du Sillon et
    // annonce un impact réel sur la circulation, on le traite comme majeur #BER.
    const lorraineCorridorImpact = participant === 'LOR'
      && corridorPlacesIn(text).length >= 2
      && /(circulation[^.]{0,100}perturbee|suppressions?|interruption|retards?)/.test(text);

    const major = hasMajorImpact(text) || lorraineCorridorImpact;

    if (!relevant || !broad || !major) return null;

    return {
      situation,
      text,
      corridorTrains,
      severity: severityFor(text),
      // SIRI : scope général et scope vehicleJourney peuvent avoir des descriptions
      // courtes différentes, mais le même détail opérationnel (à la ponctuation près).
      // Priorité au détail complet : il garde trajet + dates et évite de fusionner
      // deux chantiers distincts partageant un titre générique "Travaux en cours".
      fingerprint: normalize(situation?.detail || situation?.description || situation?.summary || '')
        .replace(/^lorraine\s*:\s*/, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    };
  }

  function dedupe(items){
    const groups = new Map();
    items.forEach((item) => {
      const key = item.fingerprint || String(item.situation?.situation_number || '');
      if (!groups.has(key)) {
        groups.set(key, item);
        return;
      }
      const current = groups.get(key);
      current.corridorTrains = Array.from(new Set([
        ...current.corridorTrains,
        ...item.corridorTrains
      ]));
      const known = new Set(
        (current.situation.links || []).map((link) => String(link?.url || ''))
      );
      (item.situation.links || []).forEach((link) => {
        const url = String(link?.url || '');
        if (url && !known.has(url)) {
          current.situation.links = [...(current.situation.links || []), link];
          known.add(url);
        }
      });
    });
    return Array.from(groups.values());
  }

  function routeLabelForBanner(item){
    const text = item?.text || normalize(
      item?.situation?.detail || item?.situation?.description || item?.situation?.summary || ''
    );
    if (/thionville/.test(text) && /luxembourg/.test(text)) return 'Thionville–Luxembourg';
    if (/metz/.test(text) && /luxembourg/.test(text)) return 'Metz–Luxembourg';
    if (/metz/.test(text) && /thionville/.test(text)) return 'Metz–Thionville';
    if (/nancy/.test(text) && /metz/.test(text)) return 'Nancy–Metz';
    return '';
  }

  function bannerTitleFor(item){
    const situation = item?.situation || {};
    const summary = String(situation.summary || '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();

    // Les intitulés régionaux génériques n'apportent rien : on cherche alors
    // la cause dans le message, pour obtenir par ex. « Panne d’un train ».
    if (
      summary
      && !/^(perturbation(?: en)? lorraine|perturbation lorraine)\.?$/i.test(summary)
      && !/^(information trafic|info trafic)\.?$/i.test(summary)
    ) {
      return summary.length > 74 ? `${summary.slice(0, 71)}…` : summary;
    }

    const source = String(situation.description || situation.detail || '');
    const causeMatch = source.match(/suite\s+[àa]\s+([^\n.]+)/i);
    if (causeMatch?.[1]) {
      const cause = causeMatch[1].trim().replace(/[.!]+$/, '');
      if (cause) {
        const title = cause.charAt(0).toUpperCase() + cause.slice(1);
        return title.length > 74 ? `${title.slice(0, 71)}…` : title;
      }
    }
    return '';
  }

  function tickerMessageFor(item){
    const rawTitle = bannerTitleFor(item).replace(/[.!?\s]+$/g, '').trim();
    const text = item?.text || '';
    const works = /travaux|chantier|maintenance/.test(text);
    const substitution = hasSubstitutionImpact(text);
    const severity = item?.severity?.label || 'Trafic perturbé';
    const title = rawTitle && !/^(information trafic|perturbations? majeures?|info trafic)$/i.test(rawTitle)
      ? rawTitle : (works ? 'Travaux en cours' : severity);
    const message = [title];
    if (substitution && !/autocars?|cars?|bus (?:de )?substitution/i.test(title)) message.push('Cars de substitution');
    const route = routeLabelForBanner(item);
    if (route && !title.toLowerCase().includes(route.toLowerCase())) message.push(route);
    return message.join(' · ');
  }

  function renderBanner(items, strongest){
    if (!banner) return;
    if (!Array.isArray(items) || items.length === 0) {
      banner.hidden = true;
      currentBannerSignature = '';
      document.body.classList.remove('lb-major-alert-banner-visible');
      document.documentElement.style.removeProperty('--lb-major-banner-height');
      return;
    }

    const ids = items.map((item) =>
      item.fingerprint
      || String(item?.situation?.situation_number || '')
      || normalize(item?.situation?.summary || item?.situation?.description || '')
    ).filter(Boolean).sort();
    currentBannerSignature = ids.join('|');
    if (dismissedBannerSignature && dismissedBannerSignature === currentBannerSignature) {
      banner.hidden = true;
      document.body.classList.remove('lb-major-alert-banner-visible');
      document.documentElement.style.removeProperty('--lb-major-banner-height');
      return;
    }

    banner.dataset.level = strongest?.key || items[0]?.severity?.key || 'critical';
    const messages = items.slice(0,4).map(tickerMessageFor).filter(Boolean);
    if (items.length > 4) messages.push(`+ ${items.length - 4} autres alertes`);
    const text = messages.join('  ◆  ');
    if (bannerText && bannerEcho && bannerText.textContent !== text) {
      bannerText.textContent = text;
      bannerEcho.textContent = text;
    }
    if (bannerTicker) bannerTicker.setAttribute('aria-label', messages.join('. '));
    banner.hidden = false;
    document.body.classList.add('lb-major-alert-banner-visible');
    requestAnimationFrame(() => {
      if (banner.hidden) return;
      // Une seule mesure à chaque nouvelle réponse SIRI : animation CSS ensuite.
      const width = bannerText?.getBoundingClientRect().width || 650;
      banner.style.setProperty('--lb-ticker-duration', `${Math.max(17, Math.min(95, Math.round((width + 34) / 33)))}s`);
      syncBannerGeometry();
    });
  }

  // Une alerte SIRI active avec substitution a priorite sur le calcul GTFS-RT.
  // Garde leger (un seul observateur, uniquement si alerte active) contre
  // les anciens scripts encore presents dans le cache PWA Android.
  let majorTrafficObserver = null;
  function syncMajorTrafficBadges(){
    const impact = window.__lbMajorTrafficImpact || {};
    [['north', 'homeTrafficBadgeNorth'], ['south', 'homeTrafficBadgeSouth']].forEach(([segment, id]) => {
      const warning = impact[segment];
      const el = document.getElementById(id);
      if (!warning || !el) return;
      const level = warning.level || 'red';
      const row = el.closest('.traffic-split-row');
      if (el.textContent.trim() === warning.label && el.classList.contains(`traffic-pill--${level}`)
          && el.title === (warning.detail || '')
          && (!row || (row.dataset.trafficLevel === level && row.classList.contains(`traffic-row--${level}`)))) return;
      if (typeof window.__lbSetTrafficBadge === 'function') {
        window.__lbSetTrafficBadge(el, warning);
      } else {
        el.classList.remove('traffic-pill--loading', 'traffic-pill--green', 'traffic-pill--yellow', 'traffic-pill--orange', 'traffic-pill--red');
        el.classList.add(`traffic-pill--${level}`);
        el.textContent = warning.label;
        el.title = warning.detail || '';
        if (row) {
          row.dataset.trafficLevel = level;
          row.classList.remove('traffic-row--loading', 'traffic-row--green', 'traffic-row--yellow', 'traffic-row--orange', 'traffic-row--red');
          row.classList.add(`traffic-row--${level}`);
          row.setAttribute('aria-label', `${row.querySelector('.traffic-split-line')?.textContent || 'Segment'} : ${warning.label}`);
        }
      }
    });
  }
  function keepMajorTrafficBadgePriority(){
    if (majorTrafficObserver) majorTrafficObserver.disconnect();
    const impact = window.__lbMajorTrafficImpact;
    if (!impact?.north && !impact?.south) return;
    const host = document.getElementById('homeTrafficRows');
    if (!host) return;
    if (!majorTrafficObserver) majorTrafficObserver = new MutationObserver(syncMajorTrafficBadges);
    majorTrafficObserver.observe(host, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'title']
    });
    syncMajorTrafficBadges();
  }

  function render(items){
    // Réconcilier le statut GTFS-RT instantané avec les perturbations SIRI
    // réellement actives. Une substitution routière confirmée sur le segment
    // ne peut pas cohabiter avec une carte verte « trafic fluide ».
    const impact = { north: null, south: null };
    items.forEach((item) => {
      const text = item?.text || '';
      const severe = item?.severity?.rank >= 4;
      const serviceAffected = severe && (hasSubstitutionImpact(text)
        || /circulation[^.]{0,80}interromp|aucun train/.test(text));
      if (!serviceAffected) return;
      const betweenNorth = /metz.{0,110}luxembourg|luxembourg.{0,110}metz|thionville.{0,110}luxembourg|luxembourg.{0,110}thionville/.test(text);
      const betweenSouth = /nancy.{0,110}metz|metz.{0,110}nancy/.test(text);
      const warning = {
        level: 'red', label: 'TRAVAUX · CARS',
        detail: 'Substitution routière annoncée par SNCF SIRI, à vérifier dans Info trafic'
      };
      if (betweenNorth && !impact.north) impact.north = warning;
      if (betweenSouth && !impact.south) impact.south = warning;
    });
    window.__lbMajorTrafficImpact = impact;
    window.dispatchEvent(new Event('lb:major-traffic-updated'));
    keepMajorTrafficBadgePriority();
    countNode.textContent = String(items.length);
    const labelNode = document.getElementById('homeMajorAlertLabel');
    if (labelNode) labelNode.textContent = items.length > 1 ? 'ALERTES' : 'ALERTE';

    const strongest = items.reduce(
      (best, item) => !best || (item.severity?.rank || 0) > (best.rank || 0)
        ? item.severity
        : best,
      null
    );
    if (strongest?.key) badge.dataset.level = strongest.key;
    else badge.removeAttribute('data-level');

    renderBanner(items, strongest);
    badge.hidden = items.length === 0;
    badge.setAttribute(
      'aria-label',
      items.length === 1
        ? 'Afficher la perturbation majeure en cours'
        : `Afficher les ${items.length} perturbations majeures en cours`
    );

    body.innerHTML = items.map((item) => {
      const situation = item.situation;
      const detail = String(situation.detail || situation.description || '').trim();
      const text = item.text || normalize(detail);
      const severity = item.severity || severityFor(text);

      let route = '';
      if (/thionville/.test(text) && /luxembourg/.test(text)) route = 'Thionville–Luxembourg';
      else if (/metz/.test(text) && /luxembourg/.test(text)) route = 'Metz–Luxembourg';
      else if (/nancy/.test(text) && /metz/.test(text)) route = 'Nancy–Metz';

      let title = route ? `${severity.label} — ${route}` : severity.label;
      if (severity.key === 'info') {
        const summary = String(situation.summary || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
        if (summary && !/^(plus d'infos?|information trafic)\s*:?$/i.test(summary)) {
          title = summary.length > 86 ? `${summary.slice(0, 83)}…` : summary;
        }
      }

      const links = (Array.isArray(situation.links) ? situation.links : [])
        .filter((link) => /^https?:\/\//i.test(String(link?.url || '')))
        .map((link) => {
          const label = normalize(link?.label) === 'ici'
            ? 'Fiche informative'
            : (link?.label || 'En savoir plus');
          return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
        }).join('');

      return `
        <article class="home-major-alert-item" data-level="${escapeHtml(severity.key)}">
          <h4><span class="home-major-alert-item-icon" aria-hidden="true">${severity.icon}</span>${escapeHtml(title)}</h4>
          <p>${escapeHtml(detail)}</p>
          ${links ? `<div class="home-major-alert-links">${links}</div>` : ''}
        </article>`;
    }).join('');
  }

  function openModal(){
    banner.classList.add('is-paused');
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.add('is-open');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    body.scrollTop = 0;
    closeButton?.focus();
  }

  function closeModal(){
    banner.classList.remove('is-paused');
    window.__lbMajorAlertSuppressOpenUntil = Date.now() + 650;
    modal.classList.remove('is-open');
    modal.style.removeProperty('display');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
  }

  closeButton?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    window.__lbMajorAlertSuppressOpenUntil = Date.now() + 650;
  }, { passive: true });

  bannerOpen?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < Number(window.__lbMajorAlertSuppressOpenUntil || 0)) return;
    openModal();
  });
  bannerClose?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismissedBannerSignature = currentBannerSignature || '';
    banner.classList.remove('is-paused');
    banner.hidden = true;
    document.body.classList.remove('lb-major-alert-banner-visible');
    document.documentElement.style.removeProperty('--lb-major-banner-height');
  });
  syncBannerGeometry();

  // L'accueil peut reconstruire ses cartes : délégation nécessaire pour conserver le clic.
  window.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('#homeMajorAlertBadge');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    trigger.dataset.majorAlertClicked = '1';
    openModal();
  }, true);
  closeButton?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  fetch(`${SIRI_URL}?t=${Date.now()}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const now = Date.now();
      const situations = Array.isArray(payload?.situations) ? payload.situations : [];
      const important = situations
        .filter((situation) => activeNow(situation, now))
        .map(classify)
        .filter(Boolean);
      render(dedupe(important));
    })
    .catch((error) => {
      badge.hidden = true;
      renderBanner([], null);
      console.warn('[accueil] alertes majeures indisponibles :', error);
    });
})();
