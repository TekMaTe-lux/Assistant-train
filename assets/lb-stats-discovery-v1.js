'use strict';

(() => {
  const ROOT_ID = 'statsV2Dashboard';
  const DISCOVERY_ID = 'lbStatsDiscovery';
  let syncQueued = false;
  let observer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function numberFrom(text) {
    const normalized = clean(text)
      .replace(/\s/g, '')
      .replace(/,/g, '.')
      .replace(/[^0-9.+-]/g, '');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function intText(text) {
    const raw = clean(text).replace(/[^0-9]/g, '');
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function colorFor(score) {
    if (typeof window.lbPunctualityColor === 'function') {
      return window.lbPunctualityColor(Number(score));
    }
    const n = Number(score);
    if (!Number.isFinite(n)) return '#6be9f4';
    if (n >= 90) return '#22c55e';
    if (n >= 75) return '#eab308';
    if (n >= 60) return '#f97316';
    return '#ef4444';
  }

  function periodLabel(value) {
    const labels = {
      '7d': '7 jours',
      '30d': '30 jours',
      '3m': '3 mois',
      '1y': 'Depuis janv.',
      'custom': 'Dates…'
    };
    return labels[value] || value || '30 jours';
  }

  function ensureDiscovery() {
    const root = byId(ROOT_ID);
    if (!root) return null;

    let panel = byId(DISCOVERY_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = DISCOVERY_ID;
      panel.className = 'lb-stats-discovery';
      panel.setAttribute('aria-label', 'Découvrir les statistiques');
      panel.innerHTML = `
        <div class="lb-stats-discovery__head">
          <div class="lb-stats-discovery__title">
            <strong>📊 La Bétaillère sous la loupe</strong>
            <span>Les chiffres utiles d’abord. Fouille ensuite où ça t’intéresse.</span>
          </div>
          <div class="lb-stats-discovery__period">
            <label class="stats-v2__sr-only" for="lbStatsDiscoveryPeriod">Période</label>
            <select id="lbStatsDiscoveryPeriod" class="lb-stats-discovery__period-select" aria-label="Choisir la période"></select>
          </div>
        </div>

        <div class="lb-stats-discovery__body">
          <div class="lb-stats-discovery__hero">
            <div class="lb-stats-discovery__score">
              <strong data-disc-punctuality>—</strong>
              <span>ponctualité</span>
            </div>
            <div class="lb-stats-discovery__hero-meta">
              <b data-disc-total>—</b> circulations observées<br>
              <span data-disc-impacted>— perturbées</span>
            </div>
          </div>

          <div class="lb-stats-discovery__insights">
            <div class="lb-stats-discovery__section-label">🔥 À retenir</div>
            <div class="lb-stats-discovery__insight-grid">
              <button type="button" class="lb-stats-discovery__insight" data-disc-action="worst-day">
                <span class="lb-stats-discovery__insight-icon" aria-hidden="true">📅</span>
                <span class="lb-stats-discovery__insight-label">Journée difficile</span>
                <span class="lb-stats-discovery__insight-value" data-disc-worst-day>—</span>
              </button>
              <button type="button" class="lb-stats-discovery__insight" data-disc-action="worst-hour">
                <span class="lb-stats-discovery__insight-icon" aria-hidden="true">🕒</span>
                <span class="lb-stats-discovery__insight-label">Heure fragile</span>
                <span class="lb-stats-discovery__insight-value" data-disc-worst-hour>—</span>
              </button>
              <button type="button" class="lb-stats-discovery__insight" data-disc-action="worst-train">
                <span class="lb-stats-discovery__insight-icon" aria-hidden="true">🚆</span>
                <span class="lb-stats-discovery__insight-label">Bétaillère touchée</span>
                <span class="lb-stats-discovery__insight-value" data-disc-worst-train>—</span>
              </button>
            </div>
          </div>

          <div class="lb-stats-discovery__explore">
            <div class="lb-stats-discovery__section-label">Que veux-tu fouiller ?</div>
            <div class="lb-stats-discovery__actions">
              <button type="button" class="lb-stats-discovery__action" data-disc-action="train"><span aria-hidden="true">🚆</span>Mon train</button>
              <button type="button" class="lb-stats-discovery__action" data-disc-action="stop"><span aria-hidden="true">🚉</span>Ma gare</button>
              <button type="button" class="lb-stats-discovery__action" data-disc-action="evolution"><span aria-hidden="true">📈</span>Évolution</button>
              <button type="button" class="lb-stats-discovery__action" data-disc-action="compare"><span aria-hidden="true">⇄</span>Comparer</button>
            </div>
          </div>
        </div>`;

      root.insertBefore(panel, root.firstChild);
      root.classList.add('lb-stats-discovery-ready');
      bindPanel(panel);
    }

    syncPeriodOptions(panel);
    return panel;
  }

  function syncPeriodOptions(panel) {
    const source = byId('statsV2PeriodSelect');
    const target = panel?.querySelector('#lbStatsDiscoveryPeriod');
    if (!source || !target) return;

    if (!target.options.length || target.options.length !== source.options.length) {
      target.innerHTML = '';
      Array.from(source.options).forEach((option) => {
        const clone = document.createElement('option');
        clone.value = option.value;
        clone.textContent = periodLabel(option.value);
        target.appendChild(clone);
      });
    }
    if (target.value !== source.value) target.value = source.value;
  }

  function syncValues() {
    syncQueued = false;
    const root = byId(ROOT_ID);
    const panel = byId(DISCOVERY_ID);
    if (!root || !panel) return;

    const overviewPanel = byId('statsV2OverviewPanel');
    panel.hidden = Boolean(overviewPanel?.hidden);

    const punctText = clean(byId('statsV2Punctuality')?.textContent);
    const punctValue = numberFrom(punctText);
    const punctNode = panel.querySelector('[data-disc-punctuality]');
    if (punctNode) punctNode.textContent = punctText || '—';
    panel.style.setProperty('--lb-stats-disc-color', colorFor(punctValue));

    const totalText = clean(byId('statsV2Total')?.textContent) || '—';
    const delayed = intText(byId('statsV2Delayed')?.textContent);
    const partial = intText(byId('statsV2Partial')?.textContent);
    const canceled = intText(byId('statsV2Canceled')?.textContent);
    const impacted = delayed + partial + canceled;

    const totalNode = panel.querySelector('[data-disc-total]');
    const impactedNode = panel.querySelector('[data-disc-impacted]');
    if (totalNode) totalNode.textContent = totalText;
    if (impactedNode) {
      impactedNode.textContent = impacted > 0
        ? impacted.toLocaleString('fr-FR') + ' perturbée' + (impacted > 1 ? 's' : '')
        : '— perturbée';
    }

    const mappings = [
      ['statsV2WorstDay', '[data-disc-worst-day]'],
      ['statsV2WorstHour', '[data-disc-worst-hour]'],
      ['statsV2WorstTrain', '[data-disc-worst-train]']
    ];
    mappings.forEach(([sourceId, selector]) => {
      const value = clean(byId(sourceId)?.textContent) || '—';
      const node = panel.querySelector(selector);
      if (node) {
        node.textContent = value;
        node.title = value;
      }
    });

    syncPeriodOptions(panel);
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncValues);
  }

  function scrollTo(node) {
    if (!node) return;
    window.setTimeout(() => {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {
        node.scrollIntoView();
      }
    }, 70);
  }

  function activateView(view) {
    const button = view === 'overview' ? byId('statsV2TabOverviewBtn')
      : view === 'train' ? byId('statsV2TabTrainBtn')
      : view === 'stop' ? byId('statsV2TabStopBtn')
      : view === 'compare' ? byId('statsV2TabCompareBtn')
      : null;
    button?.click();
    const panel = view === 'overview' ? byId('statsV2OverviewPanel')
      : view === 'train' ? byId('statsV2TrainPanel')
      : view === 'stop' ? byId('statsV2StopPanel')
      : view === 'compare' ? byId('statsV2ComparePanel')
      : null;
    scrollTo(panel);
  }

  function openWorstTrain() {
    const text = clean(byId('statsV2WorstTrain')?.textContent);
    const match = text.match(/\b(\d{4,6})\b/);
    if (!match) {
      scrollTo(byId('statsV2RankingCard'));
      return;
    }
    const input = byId('statsV2TrainInput');
    if (input) {
      input.value = match[1];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    byId('statsV2TabTrainBtn')?.click();
    window.setTimeout(() => byId('statsV2TrainRun')?.click(), 80);
    scrollTo(byId('statsV2TrainPanel'));
  }

  function runAction(action) {
    if (action === 'train') {
      activateView('train');
      window.setTimeout(() => byId('statsV2TrainInput')?.focus({ preventScroll: true }), 160);
      return;
    }
    if (action === 'stop') {
      activateView('stop');
      window.setTimeout(() => byId('statsV2StopInput')?.focus({ preventScroll: true }), 160);
      return;
    }
    if (action === 'compare') {
      activateView('compare');
      return;
    }
    if (action === 'evolution' || action === 'worst-day') {
      byId('statsV2TabOverviewBtn')?.click();
      const toggle = byId('statsV2EvolutionToggle');
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      scrollTo(byId('statsV2EvolutionDetail') || byId('statsV2Ring'));
      return;
    }
    if (action === 'worst-hour') {
      byId('statsV2TabOverviewBtn')?.click();
      scrollTo(byId('statsV2HourlyCard'));
      return;
    }
    if (action === 'worst-train') {
      openWorstTrain();
    }
  }

  function bindPanel(panel) {
    const period = panel.querySelector('#lbStatsDiscoveryPeriod');
    period?.addEventListener('change', () => {
      const source = byId('statsV2PeriodSelect');
      if (!source || source.value === period.value) return;
      source.value = period.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });

    panel.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-disc-action]');
      if (!trigger) return;
      runAction(trigger.dataset.discAction);
    });
  }

  function observe() {
    const root = byId(ROOT_ID);
    if (!root || observer) return;
    observer = new MutationObserver((mutations) => {
      const hasSourceChange = mutations.some((mutation) => {
        const target = mutation.target?.nodeType === 1
          ? mutation.target
          : mutation.target?.parentElement;
        return !target?.closest?.('#' + DISCOVERY_ID);
      });
      if (hasSourceChange) scheduleSync();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'aria-expanded']
    });
  }

  function init() {
    const panel = ensureDiscovery();
    if (!panel) {
      setTimeout(init, 500);
      return;
    }
    observe();
    scheduleSync();
    [250, 800, 1800, 3500].forEach((delay) => setTimeout(scheduleSync, delay));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();