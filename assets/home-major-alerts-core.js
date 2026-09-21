'use strict';

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
  setHomeMajorAlertModal(!!trigger);
}, true);

(function initHomeMajorAlerts(){
  'use strict';

  if (window.__lbHomeMajorAlertsReady) return;

  const SIRI_URL = 'https://vps.labetaillere.fr/gtfs/siri_sx_alertes.json';
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
  const BANNER_DISMISS_KEY = 'lb.major-alert-banner.dismissed.v1';
  let currentBannerSignature = '';

  const ensureBannerUi = () => {
    let style = document.getElementById('lb-major-alert-banner-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lb-major-alert-banner-style';
      style.textContent = `
        #lbMajorAlertBanner[hidden] { display: none !important; }
        #lbMajorAlertBanner {
          --lb-major-accent: #dc3545;
          --lb-major-bg: rgba(74, 10, 18, .90);
          position: fixed;
          left: 0;
          right: 0;
          z-index: 12950;
          top: var(--lb-major-banner-top, 72px);
          padding: 0 max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left));
          border-bottom: 1px solid color-mix(in srgb, var(--lb-major-accent) 72%, transparent);
          background:
            linear-gradient(90deg,
              color-mix(in srgb, var(--lb-major-bg) 94%, transparent),
              rgba(7, 20, 28, .84));
          box-shadow: 0 8px 26px rgba(0,0,0,.24), 0 0 18px color-mix(in srgb, var(--lb-major-accent) 12%, transparent);
          -webkit-backdrop-filter: blur(14px) saturate(130%);
          backdrop-filter: blur(14px) saturate(130%);
        }
        #lbMajorAlertBanner[data-level="warning"] {
          --lb-major-accent: #ffc107;
          --lb-major-bg: rgba(78, 54, 3, .90);
        }
        #lbMajorAlertBanner[data-level="delay"] {
          --lb-major-accent: #fd7e14;
          --lb-major-bg: rgba(76, 34, 4, .90);
        }
        #lbMajorAlertBanner[data-level="info"] {
          --lb-major-accent: #17a2b8;
          --lb-major-bg: rgba(5, 47, 57, .90);
        }
        .lb-major-alert-banner__inner {
          min-height: 46px;
          max-width: 1240px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
        }
        .lb-major-alert-banner__icon {
          display: grid;
          place-items: center;
          width: 29px;
          height: 29px;
          border: 1px solid color-mix(in srgb, var(--lb-major-accent) 80%, white 10%);
          border-radius: 8px;
          color: var(--lb-major-accent);
          background: color-mix(in srgb, var(--lb-major-accent) 10%, transparent);
          box-shadow: 0 0 12px color-mix(in srgb, var(--lb-major-accent) 18%, transparent);
          font-size: 16px;
          line-height: 1;
        }
        .lb-major-alert-banner__open {
          min-width: 0;
          border: 0;
          padding: 7px 0;
          background: transparent;
          color: #f7fbfd;
          text-align: left;
          cursor: pointer;
          display: flex;
          align-items: baseline;
          gap: 9px;
        }
        .lb-major-alert-banner__open:focus-visible,
        .lb-major-alert-banner__close:focus-visible {
          outline: 2px solid var(--lb-major-accent);
          outline-offset: 2px;
        }
        .lb-major-alert-banner__eyebrow {
          flex: 0 0 auto;
          color: var(--lb-major-accent);
          font: 900 .70rem/1 "Orbitron", system-ui, sans-serif;
          letter-spacing: .055em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .lb-major-alert-banner__text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #eefbff;
          font: 700 .88rem/1.2 "Rajdhani", system-ui, sans-serif;
          letter-spacing: .01em;
        }
        .lb-major-alert-banner__more {
          flex: 0 0 auto;
          color: #9cefff;
          font-size: .76rem;
          font-weight: 800;
          white-space: nowrap;
        }
        .lb-major-alert-banner__close {
          width: 38px;
          height: 38px;
          border: 0;
          border-radius: 9px;
          background: transparent;
          color: #dbe7eb;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          opacity: .82;
        }
        .lb-major-alert-banner__close:hover {
          background: rgba(255,255,255,.08);
          color: #fff;
          opacity: 1;
        }
        #lbMajorAlertSpacer {
          height: 0;
          transition: height .16s ease;
          pointer-events: none;
        }
        body.lb-major-alert-banner-visible #lbMajorAlertSpacer {
          height: var(--lb-major-banner-height, 46px);
        }
        @media (max-width: 700px) {
          #lbMajorAlertBanner {
            padding-left: max(7px, env(safe-area-inset-left));
            padding-right: max(7px, env(safe-area-inset-right));
          }
          .lb-major-alert-banner__inner {
            min-height: 52px;
            gap: 7px;
          }
          .lb-major-alert-banner__icon {
            width: 27px;
            height: 27px;
            border-radius: 7px;
            font-size: 14px;
          }
          .lb-major-alert-banner__open {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 2px 7px;
            align-items: center;
            padding: 6px 0;
          }
          .lb-major-alert-banner__eyebrow {
            grid-column: 1 / -1;
            font-size: .58rem;
          }
          .lb-major-alert-banner__text {
            font-size: .80rem;
          }
          .lb-major-alert-banner__more {
            font-size: .68rem;
          }
          .lb-major-alert-banner__close {
            width: 36px;
            height: 42px;
          }
          body.lb-major-alert-banner-visible #lbMajorAlertSpacer {
            height: var(--lb-major-banner-height, 52px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          #lbMajorAlertSpacer { transition: none; }
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
          <button class="lb-major-alert-banner__open" id="lbMajorAlertBannerOpen" type="button">
            <strong class="lb-major-alert-banner__eyebrow" id="lbMajorAlertBannerEyebrow">PERTURBATION MAJEURE</strong>
            <span class="lb-major-alert-banner__text" id="lbMajorAlertBannerText"></span>
            <span class="lb-major-alert-banner__more">Voir le détail</span>
          </button>
          <button class="lb-major-alert-banner__close" id="lbMajorAlertBannerClose" type="button" aria-label="Masquer ce bandeau">×</button>
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

  const hasMajorImpact = (text) =>
    /(tous les trains[^.]{0,90}(supprim|remplac)|interruption (totale|des circulations)|circulation[^.]{0,80}(interromp|tres perturbee|très perturbée)|aucun train|nombreuses suppressions|remplac[ée]s? par des cars|forts? retards?|retards? importants?)/.test(text);

  // Même hiérarchie et mêmes couleurs que les cartes de l'onglet Perturbations.
  const severityFor = (text) => {
    if (/(tous les trains[^.]{0,100}supprim|interruption totale|aucun train|circulation[^.]{0,80}interromp)/.test(text)) {
      return { key: 'critical', icon: '❌', label: 'Circulation interrompue', rank: 5 };
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
    const major = hasMajorImpact(text);

    if (!relevant || !broad || !major) return null;

    return {
      situation,
      text,
      corridorTrains,
      severity: severityFor(text),
      fingerprint: normalize(situation?.detail || situation?.description || situation?.summary || '')
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
    if (/nancy/.test(text) && /metz/.test(text)) return 'Nancy–Metz';
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

    let dismissed = '';
    try { dismissed = sessionStorage.getItem(BANNER_DISMISS_KEY) || ''; } catch (_) {}
    if (dismissed && dismissed === currentBannerSignature) {
      banner.hidden = true;
      document.body.classList.remove('lb-major-alert-banner-visible');
      document.documentElement.style.removeProperty('--lb-major-banner-height');
      return;
    }

    const first = items[0];
    const severity = first?.severity || strongest || { key:'critical', icon:'⚠️', label:'Perturbation majeure' };
    const route = routeLabelForBanner(first);
    const firstLabel = route ? `${severity.label} — ${route}` : severity.label;
    const suffix = items.length > 1 ? ` + ${items.length - 1} autre${items.length > 2 ? 's' : ''}` : '';

    banner.dataset.level = strongest?.key || severity.key || 'critical';
    if (bannerIcon) bannerIcon.textContent = strongest?.icon || severity.icon || '⚠️';
    if (bannerEyebrow) bannerEyebrow.textContent = items.length > 1 ? `${items.length} PERTURBATIONS MAJEURES` : 'PERTURBATION MAJEURE';
    if (bannerText) bannerText.textContent = `${firstLabel}${suffix}`;
    banner.hidden = false;
    document.body.classList.add('lb-major-alert-banner-visible');
    requestAnimationFrame(syncBannerGeometry);
  }

  function render(items){
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
    modal.classList.remove('is-open');
    modal.style.removeProperty('display');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
    badge.focus();
  }

  bannerOpen?.addEventListener('click', (event) => {
    event.preventDefault();
    openModal();
  });
  bannerClose?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentBannerSignature) {
      try { sessionStorage.setItem(BANNER_DISMISS_KEY, currentBannerSignature); } catch (_) {}
    }
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
