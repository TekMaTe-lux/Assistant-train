'use strict';

(() => {
  const ROOT_ID = 'lbPunctDetailDialog';
  const HOST_ID = 'homePunctualityChartHost';
  const STATS_ORIGIN = 'https://vps.labetaillere.fr';
  const DETAIL_TTL_MS = 5 * 60 * 1000;

  let detailCache = null;
  let detailPromise = null;
  let lastTrigger = null;

  function todayIso() {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Paris',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(new Date()).map((part) => [part.type, part.value])
      );
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function dateAdd(iso, days) {
    const date = new Date(iso + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function ranges() {
    const yesterday = dateAdd(todayIso(), -1);
    return {
      yesterday,
      from30: dateAdd(yesterday, -29),
      to30: yesterday
    };
  }

  function fmtInt(value) {
    return Math.max(0, Number(value || 0)).toLocaleString('fr-FR');
  }

  function fmtPct(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }) + ' %';
  }

  function fmtDate(iso) {
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }).format(new Date(iso + 'T12:00:00Z'));
    } catch (_) {
      return iso;
    }
  }

  function punctualityColor(value) {
    if (typeof window.lbPunctualityColor === 'function') {
      return window.lbPunctualityColor(Number(value));
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return '#6c98a1';
    if (n >= 90) return '#22c55e';
    if (n >= 75) return '#eab308';
    if (n >= 60) return '#f97316';
    return '#ef4444';
  }

  function normalizeSummary(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const total = Number(raw.total ?? raw.total_trains ?? 0);
    const onTime = Number(raw.on_time ?? 0);
    const delayed = Number(raw.delayed ?? 0);
    const canceled = Number(raw.canceled ?? 0);
    const partial = Number(raw.partial ?? 0);
    const impacted = Number(raw.impacted ?? (delayed + canceled + partial));
    const pctRaw = Number(raw.punctuality_rate);
    const pct = Number.isFinite(pctRaw)
      ? pctRaw
      : (total > 0 ? (onTime / total) * 100 : 0);

    return {
      total: Math.max(0, total),
      onTime: Math.max(0, onTime),
      delayed: Math.max(0, delayed),
      canceled: Math.max(0, canceled),
      partial: Math.max(0, partial),
      impacted: Math.max(0, impacted),
      pct: Math.max(0, Math.min(100, pct))
    };
  }

  async function fetchDetail() {
    if (detailCache && Date.now() - detailCache.loadedAt < DETAIL_TTL_MS) return detailCache;
    if (detailPromise) return detailPromise;

    detailPromise = (async () => {
      const r = ranges();
      const path = '/api/stats/beta/overview?from=' + encodeURIComponent(r.from30) + '&to=' + encodeURIComponent(r.to30);
      const urls = [STATS_ORIGIN + path, path];
      let lastError = null;

      for (const url of urls) {
        try {
          const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store'
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const payload = await response.json();
          if (!payload || !Array.isArray(payload.daily)) throw new Error('Données statistiques invalides');

          const thirty = normalizeSummary(payload.dashboard || payload.cards || {});
          const yesterdayRow = payload.daily.find((row) => row && row.date === r.yesterday)
            || payload.daily[payload.daily.length - 1];
          const yesterday = normalizeSummary(yesterdayRow || {});

          if (!thirty || !yesterday || !thirty.total || !yesterday.total) {
            throw new Error('Ponctualité indisponible');
          }

          detailCache = {
            loadedAt: Date.now(),
            payload,
            thirty,
            yesterday,
            yesterdayDate: yesterdayRow?.date || r.yesterday
          };
          return detailCache;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('API statistiques indisponible');
    })().finally(() => {
      detailPromise = null;
    });

    return detailPromise;
  }

  function ensureDialog() {
    let dialog = document.getElementById(ROOT_ID);
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = ROOT_ID;
    dialog.className = 'lb-punct-detail-dialog';
    dialog.setAttribute('aria-labelledby', 'lbPunctDetailTitle');
    dialog.innerHTML = `
      <section class="lb-punct-detail-sheet">
        <div class="lb-punct-detail-head">
          <div class="lb-punct-detail-heading">
            <h3 id="lbPunctDetailTitle">📊 Ponctualité</h3>
            <p data-punct-subtitle>Chargement…</p>
          </div>
          <button type="button" class="lb-punct-detail-close tron-close-button" data-punct-close aria-label="Fermer" title="Fermer"></button>
        </div>

        <div data-punct-content hidden>
          <div class="lb-punct-detail-hero">
            <div class="lb-punct-detail-score" data-punct-score-ring>
              <strong data-punct-score>—</strong>
            </div>
            <div class="lb-punct-detail-summary">
              <strong data-punct-summary>—</strong>
              <span data-punct-total>—</span>
              <span class="lb-punct-detail-delta" data-punct-delta>—</span>
            </div>
          </div>

          <div class="lb-punct-detail-mode" data-punct-mode hidden></div>

          <div class="lb-punct-detail-stats">
            <div class="lb-punct-detail-stat" data-punct-stat="ontime"><strong data-punct-ontime>—</strong><span>✅ à l’heure</span></div>
            <div class="lb-punct-detail-stat" data-punct-stat="delayed"><strong data-punct-delayed>—</strong><span>🟠 en retard</span></div>
            <div class="lb-punct-detail-stat" data-punct-stat="canceled"><strong data-punct-canceled>—</strong><span>🔴 supprimés</span></div>
            <div class="lb-punct-detail-stat" data-punct-stat="partial"><strong data-punct-partial>—</strong><span>⚠️ partiels</span></div>
          </div>

          <div class="lb-punct-trend">
            <div class="lb-punct-trend-head">
              <span>Tendance des 7 derniers jours</span>
              <small data-punct-trend-range></small>
            </div>
            <div data-punct-trend></div>
          </div>
        </div>

        <div class="lb-punct-detail-loading" data-punct-loading>Chargement des détails…</div>
        <div class="lb-punct-detail-error" data-punct-error hidden></div>
      </section>`;

    document.body.appendChild(dialog);
    dialog.querySelector('[data-punct-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        try { lastTrigger.focus({ preventScroll: true }); } catch (_) {}
      }
    });
    return dialog;
  }

  function lineSvg(rows) {
    const data = rows.filter((row) => Number.isFinite(Number(row?.punctuality_rate))).slice(-7);
    if (!data.length) return '<div class="lb-punct-detail-loading">Tendance indisponible</div>';

    const width = 320;
    const height = 64;
    const padX = 16;
    const padY = 10;
    const min = Math.max(0, Math.min(...data.map((row) => Number(row.punctuality_rate))) - 8);
    const max = Math.min(100, Math.max(...data.map((row) => Number(row.punctuality_rate))) + 8);
    const span = Math.max(10, max - min);
    const xStep = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
    const point = (row, index) => {
      const x = padX + index * xStep;
      const y = padY + (max - Number(row.punctuality_rate)) / span * (height - padY * 2);
      return { x, y };
    };
    const points = data.map(point);
    const path = points.map((p, index) => (index ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const circles = points.map((p, index) => {
      const value = Math.round(Number(data[index].punctuality_rate));
      return '<circle class="lb-punct-point" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"><title>' + value + ' %</title></circle>';
    }).join('');
    const labels = points.map((p, index) => {
      const date = String(data[index].date || '').slice(5);
      return '<text x="' + p.x.toFixed(1) + '" y="63" text-anchor="middle">' + date + '</text>';
    }).join('');
    return '<svg class="lb-punct-trend-svg" viewBox="0 0 320 68" role="img" aria-label="Évolution de la ponctualité sur les 7 derniers jours">' +
      '<line class="lb-punct-grid" x1="16" y1="32" x2="304" y2="32"></line>' +
      '<path class="lb-punct-line" d="' + path + '"></path>' +
      circles + labels + '</svg>';
  }

  function renderDetail(detail, period, mode) {
    const dialog = ensureDialog();
    const data = period === 'yesterday' ? detail.yesterday : detail.thirty;
    const subtitle = dialog.querySelector('[data-punct-subtitle]');
    const title = dialog.querySelector('#lbPunctDetailTitle');
    const content = dialog.querySelector('[data-punct-content]');
    const loading = dialog.querySelector('[data-punct-loading]');
    const error = dialog.querySelector('[data-punct-error]');

    title.textContent = period === 'yesterday' ? '📊 Ponctualité — hier' : '📊 Ponctualité — 30 jours';
    subtitle.textContent = period === 'yesterday'
      ? fmtDate(detail.yesterdayDate)
      : 'Du ' + fmtDate(detail.payload.from) + ' au ' + fmtDate(detail.payload.to);

    const score = dialog.querySelector('[data-punct-score]');
    const ring = dialog.querySelector('[data-punct-score-ring]');
    const color = punctualityColor(data.pct);
    score.textContent = fmtPct(data.pct, 1);
    ring.style.setProperty('--lb-punct-pct', Math.max(0, Math.min(100, data.pct)) + '%');
    ring.style.setProperty('--lb-punct-color', color);

    dialog.querySelector('[data-punct-summary]').textContent =
      data.onTime === 1 ? '1 circulation à l’heure' : fmtInt(data.onTime) + ' circulations à l’heure';
    dialog.querySelector('[data-punct-total]').textContent =
      fmtInt(data.total) + ' circulations observées';

    const deltaNode = dialog.querySelector('[data-punct-delta]');
    const delta = detail.yesterday.pct - detail.thirty.pct;
    if (period === 'yesterday') {
      const sign = delta > 0 ? '+' : '';
      deltaNode.textContent = sign + delta.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' pt' + (Math.abs(delta) >= 2 ? 's' : '') + ' vs moyenne J-30';
    } else {
      deltaNode.textContent = 'Moyenne des 30 derniers jours complets';
    }

    dialog.querySelector('[data-punct-ontime]').textContent = fmtInt(data.onTime);
    dialog.querySelector('[data-punct-delayed]').textContent = fmtInt(data.delayed);
    dialog.querySelector('[data-punct-canceled]').textContent = fmtInt(data.canceled);
    dialog.querySelector('[data-punct-partial]').textContent = fmtInt(data.partial);

    dialog.querySelectorAll('[data-punct-stat]').forEach((node) => node.classList.remove('is-selected'));
    const modeNode = dialog.querySelector('[data-punct-mode]');
    if (mode === 'ontime') {
      modeNode.hidden = false;
      modeNode.textContent = '✅ Vous avez touché la partie ponctuelle du donut : ' + fmtInt(data.onTime) + ' circulations à l’heure.';
      dialog.querySelector('[data-punct-stat="ontime"]')?.classList.add('is-selected');
    } else if (mode === 'impacted') {
      modeNode.hidden = false;
      modeNode.textContent = '⚠️ Vous avez touché la partie perturbée : ' + fmtInt(data.impacted) + ' circulations impactées.';
      ['delayed', 'canceled', 'partial'].forEach((key) => dialog.querySelector('[data-punct-stat="' + key + '"]')?.classList.add('is-selected'));
    } else {
      modeNode.hidden = true;
      modeNode.textContent = '';
    }

    const trendRows = Array.isArray(detail.payload.daily) ? detail.payload.daily.slice(-7) : [];
    dialog.querySelector('[data-punct-trend]').innerHTML = lineSvg(trendRows);
    const trendRange = dialog.querySelector('[data-punct-trend-range]');
    if (trendRows.length) {
      trendRange.textContent = String(trendRows[0]?.date || '').slice(5) + ' → ' + String(trendRows[trendRows.length - 1]?.date || '').slice(5);
    } else {
      trendRange.textContent = '';
    }

    loading.hidden = true;
    error.hidden = true;
    content.hidden = false;
  }

  function showLoading(period) {
    const dialog = ensureDialog();
    dialog.querySelector('#lbPunctDetailTitle').textContent =
      period === 'yesterday' ? '📊 Ponctualité — hier' : '📊 Ponctualité — 30 jours';
    dialog.querySelector('[data-punct-subtitle]').textContent = 'Chargement des statistiques détaillées';
    dialog.querySelector('[data-punct-content]').hidden = true;
    dialog.querySelector('[data-punct-error]').hidden = true;
    dialog.querySelector('[data-punct-loading]').hidden = false;
  }

  function showError(error) {
    const dialog = ensureDialog();
    dialog.querySelector('[data-punct-loading]').hidden = true;
    dialog.querySelector('[data-punct-content]').hidden = true;
    const node = dialog.querySelector('[data-punct-error]');
    node.hidden = false;
    node.textContent = 'Détails momentanément indisponibles. Les donuts de l’accueil restent utilisables.';
    console.warn('[Accueil] Détail ponctualité indisponible', error);
  }

  function detectArcMode(event, target) {
    try {
      if (!target) return null;

      // Nouveau donut CSS : aucun canvas/Chart.js nécessaire sur l'accueil.
      if (target.classList?.contains('home-punct-css-ring')) {
        const pct = Number(target.dataset.pct);
        if (!Number.isFinite(pct)) return null;
        const rect = target.getBoundingClientRect();
        const x = Number(event.clientX) - (rect.left + rect.width / 2);
        const y = Number(event.clientY) - (rect.top + rect.height / 2);
        const radius = Math.sqrt((x * x) + (y * y));
        const outer = Math.min(rect.width, rect.height) / 2;
        if (!(outer > 0) || radius < outer * .56 || radius > outer * 1.05) return null;
        const angle = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
        return (angle / 360 * 100) <= pct ? 'ontime' : 'impacted';
      }

      // Compatibilité avec une ancienne version en cache utilisant encore Chart.js.
      if (typeof Chart === 'undefined' || typeof Chart.getChart !== 'function') return null;
      const chart = Chart.getChart(target);
      if (!chart || typeof chart.getElementsAtEventForMode !== 'function') return null;
      const active = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
      if (!active || !active.length) return null;
      return active[0].index === 0 ? 'ontime' : 'impacted';
    } catch (_) {
      return null;
    }
  }

  async function openDetail(period, mode, trigger) {
    lastTrigger = trigger || null;
    const dialog = ensureDialog();
    showLoading(period);

    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    try {
      const detail = await fetchDetail();
      renderDetail(detail, period, mode);
    } catch (error) {
      showError(error);
    }
  }

  function enhance() {
    const host = document.getElementById(HOST_ID);
    if (!host) return false;

    const configs = [
      ['homeWxPunctualityChart30d', 'thirty'],
      ['homeWxPunctualityChartYesterday', 'yesterday']
    ];

    configs.forEach(([targetId, period]) => {
      const target = document.getElementById(targetId);
      const wrap = target?.closest('.home-punct-chart-wrap');
      if (!target || !wrap || wrap.dataset.punctInteractive === '1') return;

      wrap.dataset.punctInteractive = '1';
      wrap.dataset.punctPeriod = period;
      wrap.classList.add('lb-punct-interactive');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('aria-label', period === 'yesterday'
        ? 'Ouvrir le détail de la ponctualité d’hier'
        : 'Ouvrir le détail de la ponctualité des 30 derniers jours');

      wrap.addEventListener('click', (event) => {
        const mode = target.contains(event.target) ? detectArcMode(event, target) : null;
        openDetail(period, mode, wrap);
      });

      wrap.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openDetail(period, null, wrap);
      });
    });

    return true;
  }

  function init() {
    enhance();
    [300, 900, 1800, 4000].forEach((delay) => setTimeout(enhance, delay));

    const host = document.getElementById(HOST_ID);
    if (host && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(enhance);
      observer.observe(host, { childList: true, subtree: true });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const dialog = document.getElementById(ROOT_ID);
        if (dialog?.open) dialog.close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();