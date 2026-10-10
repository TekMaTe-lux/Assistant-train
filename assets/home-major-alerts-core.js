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
          --alarm:#ff3f57;
          --alarm-soft:#ff8b99;
          position:fixed;
          left:0;
          right:0;
          top:var(--lb-major-banner-top,72px);
          z-index:12950;
          overflow:hidden;
          padding:0 max(14px,env(safe-area-inset-right)) 0 max(14px,env(safe-area-inset-left));
          border-top:1px solid rgba(255,67,91,.18);
          border-bottom:1px solid rgba(255,67,91,.68);
          background:
            linear-gradient(90deg,rgba(73,7,20,.985) 0%,rgba(47,8,18,.975) 46%,rgba(20,10,16,.965) 100%);
          box-shadow:
            0 10px 28px rgba(0,0,0,.30),
            0 0 26px rgba(255,48,72,.08),
            inset 0 -1px rgba(255,255,255,.03);
          -webkit-backdrop-filter:blur(15px) saturate(132%);
          backdrop-filter:blur(15px) saturate(132%);
        }

        #lbMajorAlertBanner::after {
          content:"";
          position:absolute;
          top:0;
          bottom:0;
          left:0;
          width:34%;
          pointer-events:none;
          background:linear-gradient(90deg,rgba(255,48,74,.055),transparent 82%);
        }

        #lbMajorAlertBanner[data-level="warning"] {
          --alarm:#ffba3a;
          --alarm-soft:#ffd88a;
          border-top-color:rgba(255,186,58,.13);
          border-bottom-color:rgba(255,186,58,.56);
          background:linear-gradient(90deg,rgba(69,40,6,.985),rgba(46,28,8,.975) 46%,rgba(21,15,9,.965));
        }
        .lb-major-alert-banner__inner {
          position:relative;
          z-index:1;
          min-height:48px;
          max-width:1240px;
          margin:0 auto;
          display:grid;
          grid-template-columns:22px minmax(0,1fr) auto;
          align-items:center;
          gap:9px;
          padding:4px 0 4px 6px;
        }

        .lb-major-alert-banner__icon {
          position:relative;
          width:22px;
          height:22px;
          display:grid;
          place-items:center;
          border:0;
          border-radius:0;
          background:transparent;
          color:var(--alarm);
          font:900 14px/1 "Orbitron",system-ui,sans-serif;
          text-shadow:0 0 11px color-mix(in srgb,var(--alarm) 48%,transparent);
          box-shadow:none;
        }
        .lb-major-alert-banner__icon::before {
          content:"";
          position:absolute;
          width:5px;
          height:5px;
          border-radius:50%;
          background:var(--alarm);
          box-shadow:
            0 0 0 4px color-mix(in srgb,var(--alarm) 9%,transparent),
            0 0 12px color-mix(in srgb,var(--alarm) 45%,transparent);
          opacity:.95;
          transform:translate(-6px,-6px);
        }

        .lb-major-alert-banner__content {
          min-width:0;
          display:grid;
          align-content:center;
          gap:2px;
        }

        .lb-major-alert-banner__eyebrow {
          display:flex;
          align-items:center;
          gap:6px;
          min-width:0;
          color:var(--alarm);
          font:900 .51rem/1 "Orbitron",system-ui,sans-serif;
          letter-spacing:.085em;
          text-transform:uppercase;
          white-space:nowrap;
          text-shadow:0 0 12px color-mix(in srgb,var(--alarm) 16%,transparent);
        }
        .lb-major-alert-banner__eyebrow::after {
          content:"";
          width:18px;
          height:1px;
          background:linear-gradient(90deg,color-mix(in srgb,var(--alarm) 65%,transparent),transparent);
          flex:0 0 auto;
        }

        .lb-major-alert-banner__title {
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          color:#fff;
          font:800 .82rem/1.02 "Rajdhani",system-ui,sans-serif;
          letter-spacing:.005em;
        }

        .lb-major-alert-banner__text {
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          color:#f1dfe3;
          font:700 .65rem/1.04 "Rajdhani",system-ui,sans-serif;
          letter-spacing:.01em;
          opacity:.90;
        }

        .lb-major-alert-banner__actions {
          display:flex;
          align-items:center;
          gap:9px;
          flex:0 0 auto;
        }

        .lb-major-alert-banner__more {
          -webkit-tap-highlight-color:transparent;
          touch-action:manipulation;
          appearance:none;
          position:relative;
          border:0;
          padding:3px 1px;
          background:transparent;
          color:var(--alarm-soft);
          font:800 .66rem/1 "Rajdhani",system-ui,sans-serif;
          letter-spacing:.02em;
          white-space:nowrap;
          cursor:pointer;
          transition:color .15s ease,transform .15s ease;
        }
        .lb-major-alert-banner__more::after {
          content:"›";
          display:inline-block;
          margin-left:5px;
          color:var(--alarm);
          font-size:.95em;
          transform:translateY(.2px);
        }
        .lb-major-alert-banner__more:hover {
          color:#fff;
          transform:translateX(1px);
        }
        .lb-major-alert-banner__more:focus-visible {
          outline:1px solid color-mix(in srgb,var(--alarm) 55%,transparent);
          outline-offset:3px;
          border-radius:4px;
        }

        .lb-major-alert-banner__close {
          -webkit-tap-highlight-color:transparent;
          touch-action:manipulation;
          appearance:none;
          width:21px;
          height:21px;
          min-width:21px;
          min-height:21px;
          display:grid;
          place-items:center;
          margin:0;
          padding:0;
          border:0;
          border-radius:7px;
          background:transparent;
          color:rgba(255,213,219,.64);
          font:600 9px/1 system-ui,sans-serif;
          cursor:pointer;
          box-shadow:none;
          transition:background .15s ease,color .15s ease;
        }
        .lb-major-alert-banner__close:hover {
          background:rgba(255,73,98,.09);
          color:#fff;
        }
        .lb-major-alert-banner__close:focus-visible {
          outline:1px solid color-mix(in srgb,var(--alarm) 50%,transparent);
          outline-offset:2px;
        }

        #lbMajorAlertSpacer {
          height:0;
          transition:height .16s ease;
          pointer-events:none;
        }
        body.lb-major-alert-banner-visible #lbMajorAlertSpacer {
          height:var(--lb-major-banner-height,48px);
        }

        @media (max-width:700px) {
          #lbMajorAlertBanner {
            padding-left:max(8px,env(safe-area-inset-left));
            padding-right:max(8px,env(safe-area-inset-right));
          }

          .lb-major-alert-banner__inner {
            min-height:44px;
            grid-template-columns:20px minmax(0,1fr) auto;
            gap:7px;
            padding:3px 0 3px 5px;
          }

          .lb-major-alert-banner__icon {
            width:20px;
            height:20px;
            font-size:12px;
          }
          .lb-major-alert-banner__icon::before {
            width:4px;
            height:4px;
            transform:translate(-5px,-5px);
            box-shadow:
              0 0 0 3px color-mix(in srgb,var(--alarm) 9%,transparent),
              0 0 10px color-mix(in srgb,var(--alarm) 42%,transparent);
          }

          .lb-major-alert-banner__content {
            gap:1px;
          }

          .lb-major-alert-banner__eyebrow {
            font-size:.43rem;
            letter-spacing:.07em;
            gap:5px;
          }
          .lb-major-alert-banner__eyebrow::after {
            width:12px;
          }

          .lb-major-alert-banner__title {
            font-size:.73rem;
            line-height:1.02;
          }

          .lb-major-alert-banner__text {
            font-size:.58rem;
            line-height:1.05;
          }

          .lb-major-alert-banner__actions {
            gap:5px;
          }

          .lb-major-alert-banner__more {
            padding:4px 0;
            font-size:.60rem;
          }
          .lb-major-alert-banner__more::after {
            margin-left:3px;
          }

          .lb-major-alert-banner__close {
            width:19px;
            height:19px;
            min-width:19px;
            min-height:19px;
            border-radius:6px;
            font-size:8px;
          }

          body.lb-major-alert-banner-visible #lbMajorAlertSpacer {
            height:var(--lb-major-banner-height,44px);
          }
        }

        @media (max-width:390px) {
          .lb-major-alert-banner__inner {
            grid-template-columns:22px minmax(0,1fr) auto;
            gap:7px;
          }
          .lb-major-alert-banner__icon {
            width:22px;
            height:22px;
            font-size:13px;
          }
          .lb-major-alert-banner__eyebrow { font-size:.45rem; }
          .lb-major-alert-banner__title { font-size:.76rem; }
          .lb-major-alert-banner__text { font-size:.61rem; }
          .lb-major-alert-banner__more { font-size:.60rem; }
          .lb-major-alert-banner__close {
            width:21px;
            height:21px;
            min-width:21px;
            min-height:21px;
          }
        }

        @keyframes lbAlarmPulse {
          0%,100% { opacity:.86; }
          50% { opacity:1; }
        }
        @keyframes lbAlarmBang {
          0%,100% { transform:scale(1); opacity:.90; }
          50% { transform:scale(1.08); opacity:1; }
        }
        #lbMajorAlertBanner[data-level="critical"] .lb-major-alert-banner__icon::before {
          animation:lbAlarmPulse 1.6s ease-in-out infinite;
        }
        #lbMajorAlertBanner[data-level="critical"] .lb-major-alert-banner__icon {
          animation:lbAlarmBang 2.4s ease-in-out infinite;
          transform-origin:center;
        }

        @media (prefers-reduced-motion:reduce) {
          #lbMajorAlertSpacer { transition:none; }
          .lb-major-alert-banner__more,
          .lb-major-alert-banner__close { transition:none; }
          #lbMajorAlertBanner .lb-major-alert-banner__icon,
          #lbMajorAlertBanner .lb-major-alert-banner__icon::before { animation:none !important; }
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
          <span class="lb-major-alert-banner__icon" id="lbMajorAlertBannerIcon" aria-hidden="true">⚠️</span>
          <div class="lb-major-alert-banner__content">
            <strong class="lb-major-alert-banner__eyebrow" id="lbMajorAlertBannerEyebrow">PERTURBATION MAJEURE</strong>
            <span class="lb-major-alert-banner__title" id="lbMajorAlertBannerTitle" hidden></span>
            <span class="lb-major-alert-banner__text" id="lbMajorAlertBannerText"></span>
          </div>
          <div class="lb-major-alert-banner__actions">
            <button class="lb-major-alert-banner__more" id="lbMajorAlertBannerOpen" type="button">Plus d’infos</button>
            <button class="lb-major-alert-banner__close" id="lbMajorAlertBannerClose" type="button" aria-label="Masquer ce bandeau"><span aria-hidden="true">✕</span></button>
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
  const bannerIcon = document.getElementById('lbMajorAlertBannerIcon');
  const bannerEyebrow = document.getElementById('lbMajorAlertBannerEyebrow');
  const bannerTitle = document.getElementById('lbMajorAlertBannerTitle');
  const bannerText = document.getElementById('lbMajorAlertBannerText');
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

    const first = items[0];
    const severity = first?.severity || strongest || { key:'critical', icon:'⚠️', label:'Perturbation majeure' };
    const route = routeLabelForBanner(first);
    const title = bannerTitleFor(first);
    const firstLabel = route ? `${severity.label} — ${route}` : severity.label;
    const suffix = items.length > 1 ? ` + ${items.length - 1} autre${items.length > 2 ? 's' : ''}` : '';

    banner.dataset.level = strongest?.key || severity.key || 'critical';
    if (bannerIcon) {
      const level = strongest?.key || severity.key || 'critical';
      bannerIcon.textContent = (level === 'critical' || level === 'warning' || level === 'delay') ? '!' : '•';
    }
    if (bannerEyebrow) bannerEyebrow.textContent = items.length > 1 ? `${items.length} PERTURBATIONS MAJEURES` : 'PERTURBATION MAJEURE';
    if (bannerTitle) {
      bannerTitle.textContent = title;
      bannerTitle.hidden = !title;
    }
    if (bannerText) bannerText.textContent = `${firstLabel}${suffix}`;
    banner.hidden = false;
    document.body.classList.add('lb-major-alert-banner-visible');
    requestAnimationFrame(syncBannerGeometry);
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
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.add('is-open');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    body.scrollTop = 0;
    closeButton?.focus();
  }

  function closeModal(){
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
