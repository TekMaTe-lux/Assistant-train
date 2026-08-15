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
      console.warn('[accueil] alertes majeures indisponibles :', error);
    });
})();
