/* La Bétaillère V4 — Train components
 * Un seul objet Train, trois niveaux de densité : compact, favorite, full.
 */
(function () {
  'use strict';
  if (window.LBTrainUI) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const icon = (name, label = '') => `<svg class="lb-v4-icon" aria-hidden="${label ? 'false' : 'true'}"${label ? ` aria-label="${esc(label)}" role="img"` : ''}><use href="./assets/lb-v4-icons.svg#${esc(name)}"></use></svg>`;

  const statusLabels = {
    'on-time': 'À l’heure',
    live: 'LIVE',
    delay: 'Retard',
    cancelled: 'Supprimé',
    partial: 'Service partiel',
    planned: 'À venir',
    unknown: 'Statut inconnu'
  };

  function statusLabel(status) { return statusLabels[status] || statusLabels.unknown; }

  function delayText(train) {
    const delay = Number(train?.delayMinutes || 0);
    if (train?.status === 'cancelled') return 'Supprimé';
    if (train?.status === 'partial') return 'Partiel';
    if (delay > 0) return `+${delay} min`;
    return train?.status === 'on-time' ? 'À l’heure' : '';
  }

  function occupancyText(occupancy) {
    if (!occupancy) return '';
    const pct = Number(occupancy.percent);
    if (Number.isFinite(pct)) {
      if (pct < 50) return `${pct}% · faible`;
      if (pct < 70) return `${pct}% · modérée`;
      if (pct < 85) return `${pct}% · forte`;
      return `${pct}% · très forte`;
    }
    return occupancy.level ? String(occupancy.level) : '';
  }

  function platformMarkup(train) {
    const platform = train?.destination?.platform || train?.origin?.platform;
    return platform ? `<span class="lb-platform">${icon('platform')}Voie ${esc(platform)}</span>` : '';
  }

  function compositionMarkup(train) {
    const code = train?.composition?.code;
    return code ? `<span class="lb-badge">${icon('train')}Compo ${esc(code)}</span>` : '';
  }

  function occupancyMarkup(train) {
    const text = occupancyText(train?.occupancy);
    return text ? `<span class="lb-badge" aria-label="Affluence ${esc(text)}">${icon('occupancy')}Affluence ${esc(text)}</span>` : '';
  }

  function routeMarkup(train) {
    const from = train?.origin?.name || train?.stops?.[0]?.name || '—';
    const to = train?.destination?.name || train?.stops?.at?.(-1)?.name || '—';
    return `<div class="lb-train-route">${icon('route')}<span>${esc(from)}</span><span aria-hidden="true">→</span><span>${esc(to)}</span></div>`;
  }

  function statusMarkup(train) {
    const status = train?.status || 'unknown';
    const delay = delayText(train);
    return `<span class="lb-status" data-status="${esc(status)}"><span>${esc(statusLabel(status))}</span>${delay && delay !== statusLabel(status) ? `<b>${esc(delay)}</b>` : ''}</span>`;
  }

  function trainHead(train) {
    return `
      <div class="lb-train-card__head">
        <div class="lb-train-card__identity">
          <span class="lb-section-kicker">Bétaillère</span>
          <strong class="lb-train-card__number">${esc(train?.number || '—')}</strong>
        </div>
        ${statusMarkup(train)}
      </div>
      ${routeMarkup(train)}
    `;
  }

  function compact(train, options = {}) {
    return `
      <article class="lb-train-card lb-train-card--compact" data-status="${esc(train?.status || 'unknown')}" data-train-number="${esc(train?.number || '')}">
        ${trainHead(train)}
        <div class="lb-train-card__meta">
          ${platformMarkup(train)}
          ${train?.live ? `<span class="lb-badge" data-status="live">${icon('live')}LIVE</span>` : ''}
        </div>
        ${options.action !== false ? `<button class="lb-button lb-train-card__open" type="button" data-lb-open-train="${esc(train?.number || '')}">Voir la fiche</button>` : ''}
      </article>
    `;
  }

  function favorite(train, options = {}) {
    return `
      <article class="lb-train-card lb-train-card--favorite" data-status="${esc(train?.status || 'unknown')}" data-train-number="${esc(train?.number || '')}">
        ${trainHead(train)}
        <div class="lb-train-card__meta">
          ${platformMarkup(train)}
          ${compositionMarkup(train)}
          ${occupancyMarkup(train)}
        </div>
        <div class="lb-train-card__actions">
          <button class="lb-button" type="button" data-lb-open-train="${esc(train?.number || '')}">${icon('train')}Fiche train</button>
          ${options.allowRemove ? `<button class="lb-icon-button" type="button" aria-label="Retirer le train ${esc(train?.number || '')} des favoris" data-lb-remove-favorite="${esc(train?.number || '')}">${icon('favorite')}</button>` : ''}
        </div>
      </article>
    `;
  }

  function stopsMarkup(train) {
    const stops = Array.isArray(train?.stops) ? train.stops : [];
    if (!stops.length) return '<div class="lb-empty-state">Parcours non disponible.</div>';
    return `<ol class="lb-train-stops">${stops.map((stop, index) => {
      const delay = Number(stop?.delayMinutes || 0);
      return `<li class="lb-train-stop${delay > 0 ? ' is-delay' : ''}">
        <span class="lb-train-stop__rail" aria-hidden="true"></span>
        <div><strong>${esc(stop?.name || '—')}</strong>${delay > 0 ? `<span class="lb-status" data-status="delay">+${delay} min</span>` : ''}</div>
        ${stop?.platform ? `<span class="lb-platform">Voie ${esc(stop.platform)}</span>` : ''}
      </li>`;
    }).join('')}</ol>`;
  }

  function full(train) {
    const provenance = Array.isArray(train?.provenance) ? train.provenance : [];
    const disruptions = Array.isArray(train?.disruptions) ? train.disruptions : [];
    return `
      <article class="lb-train-card lb-train-card--full" data-status="${esc(train?.status || 'unknown')}" data-train-number="${esc(train?.number || '')}">
        ${trainHead(train)}
        <div class="lb-train-card__meta">
          ${platformMarkup(train)}
          ${compositionMarkup(train)}
          ${occupancyMarkup(train)}
          ${train?.live ? `<span class="lb-badge" data-status="live">${icon('live')}Position LIVE</span>` : ''}
        </div>
        ${disruptions.length ? `<section class="lb-train-card__alerts" aria-label="Perturbations">${disruptions.map((item) => `<div class="lb-alert">${icon('alert')}<span>${esc(item?.summary || item?.description || item)}</span></div>`).join('')}</section>` : ''}
        <section class="lb-train-card__journey" aria-label="Parcours du train">
          <h4>Parcours</h4>
          ${stopsMarkup(train)}
        </section>
        ${provenance.length ? `<details class="lb-train-card__sources"><summary>Sources et fraîcheur</summary><ul>${provenance.map((source) => `<li>${esc(source?.source || 'Source')} ${source?.stale ? '· donnée ancienne' : '· à jour'}</li>`).join('')}</ul></details>` : ''}
      </article>
    `;
  }

  window.LBTrainUI = Object.freeze({ compact, favorite, full, statusLabel, occupancyText });
  document.dispatchEvent(new CustomEvent('lb:train-ui-ready'));
})();
