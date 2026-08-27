/*
 * La Bétaillère — contrôleur mobile v4.
 * Mesures de viewport PWA, clavier mobile et enrichissement du tableau.
 */
(function () {
  "use strict";

  const mobileQuery = window.matchMedia(
    "(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)"
  );

  /*
   * Voies d'arrivée Luxembourg
   * --------------------------
   * Source volontairement identique au correctif BER V9 du tableau
   * « Arrivées » de la carte : le snapshot HAFAS StationBoard dédié.
   * Le navigateur ne contacte jamais HAFAS directement.
   */
  const LUX_ARRIVALS_URL =
    "https://vps.labetaillere.fr/gtfs/retards_cfl_arrivals.json";
  const LUX_ARRIVALS_REFRESH_MS = 120000;
  const LUX_TABLE_MUTATION_DEBOUNCE_MS = 120;

  const TRAIN_NUMBER_EQUIVALENCE_GROUPS = [
    ["2870", "2871"],
    ["2864", "2865"],
    ["2806", "2807"],
    ["2872", "2873"],
    ["2816", "2817"],
    ["88504", "88505"],
    ["88502", "88503"],
    ["88500", "88501"],
    ["88529", "88530"],
    ["88531", "88530"],
    ["88533", "88532"],
    ["88535", "88534"],
    ["88520", "88521"],
    ["88522", "88523"],
    ["88524", "88525"],
    ["88526", "88527"],
    ["88528", "88529"]
  ];

  const trainNumberEquivalents = new Map();
  for (const group of TRAIN_NUMBER_EQUIVALENCE_GROUPS) {
    const normalized = Array.from(
      new Set(group.map(normalizeTrainNumberKey).filter(Boolean))
    );
    for (const key of normalized) trainNumberEquivalents.set(key, normalized);
  }

  let luxArrivalsByNumber = new Map();
  let luxArrivalsLastLoadedAt = 0;
  let luxArrivalsPromise = null;
  let luxArrivalRenderQueued = false;
  let luxArrivalTimer = null;
  let luxTableMutationObserver = null;
  let luxTableMutationDebounce = null;

  function isMobileLayout() {
    return mobileQuery.matches;
  }

  function syncGenerateButton() {
    const button = document.getElementById("loadTrains");
    if (!button) return;
    const label = "Générer le tableau";
    if ((button.textContent || "").trim() !== label) button.textContent = label;
    button.setAttribute("aria-label", label);
    button.classList.toggle("lb-generate-mobile", isMobileLayout());
  }

  function syncViewport() {
    const viewport = window.visualViewport;
    const visualHeight = Math.round(viewport?.height || window.innerHeight || 0);
    const visualTop = Math.round(viewport?.offsetTop || 0);
    document.documentElement.style.setProperty("--lb-visual-height", `${visualHeight}px`);
    document.documentElement.style.setProperty("--lb-visual-top", `${visualTop}px`);

    const active = document.activeElement;
    const editsText =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      active?.isContentEditable;
    const keyboardOpen =
      isMobileLayout() &&
      editsText &&
      visualHeight > 0 &&
      visualHeight < window.innerHeight * 0.76;
    document.body?.classList.toggle("lb-keyboard-open", keyboardOpen);
  }

  function removeCompactMoreMenu() {
    document.getElementById("lbMoreNavButton")?.remove();
    document.getElementById("lbMoreSheet")?.remove();
    document.body?.classList.remove("lb-sheet-open");
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalStationName(value) {
    return normalizeText(value)
      .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractTrainNumberCandidate(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const matches = Array.from(raw.matchAll(/\d{3,}/g));
    if (!matches.length) return null;
    matches.sort(
      (a, b) => b[0].length - a[0].length || (b.index || 0) - (a.index || 0)
    );
    return matches[0][0].replace(/^0+(?=\d)/, "");
  }

  function normalizeTrainNumberKey(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const candidate = extractTrainNumberCandidate(raw) || raw;
    const stripped = String(candidate).replace(/^0+/, "");
    return stripped || "0";
  }

  function equivalentTrainNumbers(value) {
    const key = normalizeTrainNumberKey(value);
    if (!key) return [];
    return trainNumberEquivalents.get(key) || [key];
  }

  function normalizeTrack(value) {
    if (value == null) return null;
    if (typeof value !== "string" && typeof value !== "number") return null;
    const raw = String(value).trim();
    if (!raw || /^(-+|n\/?a|nc|null|undefined)$/i.test(raw)) return null;
    return raw.replace(/^voie\s*/i, "").replace(/^track\s*/i, "").trim() || null;
  }

  function normalizeClock(value) {
    const match = String(value || "").match(/\b(\d{1,2}):(\d{2})\b/);
    if (!match) return null;
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  }

  function cellClocks(cell) {
    const clocks = new Set();
    const text = String(cell?.textContent || "");
    for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
      clocks.add(`${String(Number(match[1])).padStart(2, "0")}:${match[2]}`);
    }
    const baseTime = cell?.dataset?.baseTime || cell?.getAttribute?.("data-base-time");
    const normalizedBase = normalizeClock(baseTime);
    if (normalizedBase) clocks.add(normalizedBase);
    return clocks;
  }

  function parseLuxArrivalSnapshot(payload) {
    const byNumber = new Map();
    const data = payload?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return byNumber;

    for (const [label, rawInfo] of Object.entries(data)) {
      if (!rawInfo || typeof rawInfo !== "object") continue;
      const number = normalizeTrainNumberKey(rawInfo.train || label);
      if (!number) continue;

      const track = normalizeTrack(
        rawInfo.arrivalPlatformRealtime ?? rawInfo.arrivalPlatformPlanned
      );
      if (!track) continue;

      const info = {
        number,
        train: String(rawInfo.train || label || number),
        track,
        planned: normalizeClock(rawInfo.arrivalPlanned),
        realtime: normalizeClock(rawInfo.arrivalRealtime),
        platformChanged: rawInfo.platformChanged === true,
        plannedTrack: normalizeTrack(rawInfo.arrivalPlatformPlanned),
        realtimeTrack: normalizeTrack(rawInfo.arrivalPlatformRealtime),
        origin: String(rawInfo.origin || "").trim()
      };

      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push(info);
    }

    return byNumber;
  }

  async function fetchJsonNoCache(url, timeoutMs = 8000) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${separator}t=${Date.now()}`, {
        cache: "no-store",
        signal: controller?.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  async function ensureLuxArrivals({ force = false } = {}) {
    const age = Date.now() - luxArrivalsLastLoadedAt;
    if (!force && luxArrivalsByNumber.size && age < LUX_ARRIVALS_REFRESH_MS) {
      return luxArrivalsByNumber;
    }
    if (luxArrivalsPromise) return luxArrivalsPromise;

    luxArrivalsPromise = (async () => {
      const payload = await fetchJsonNoCache(LUX_ARRIVALS_URL);
      const parsed = parseLuxArrivalSnapshot(payload);
      if (parsed.size) {
        luxArrivalsByNumber = parsed;
        luxArrivalsLastLoadedAt = Date.now();
      }
      return luxArrivalsByNumber;
    })();

    try {
      return await luxArrivalsPromise;
    } finally {
      luxArrivalsPromise = null;
    }
  }

  function chooseLuxArrival(trainNumber, cell) {
    const exactKey = normalizeTrainNumberKey(trainNumber);
    if (!exactKey) return null;

    const candidateKeys = Array.from(
      new Set([exactKey, ...equivalentTrainNumbers(exactKey)])
    );
    const clocks = cellClocks(cell);
    let best = null;
    let bestScore = -Infinity;

    for (const key of candidateKeys) {
      const infos = luxArrivalsByNumber.get(key) || [];
      for (const info of infos) {
        let score = key === exactKey ? 100 : 50;
        if (info.realtime && clocks.has(info.realtime)) score += 80;
        if (info.planned && clocks.has(info.planned)) score += 70;
        if (info.realtimeTrack) score += 4;
        if (info.platformChanged) score += 1;

        if (score > bestScore) {
          bestScore = score;
          best = info;
        }
      }
    }

    return best;
  }

  function installLuxArrivalStyle() {
    // Les voies Luxembourg réutilisent exactement le badge natif du tableau.
    // On supprime seulement un éventuel style injecté par une ancienne version.
    document.getElementById("lb-lux-arrival-track-style")?.remove();
  }

  function getLuxembourgArrivalTableContext() {
    const table = document.querySelector("#trainInfo .table-scroll table");
    if (!table) return null;

    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) =>
      row.querySelector("td:first-child")
    );
    if (!rows.length) return null;

    const luxRow = rows.find((row) => {
      const firstCell = row.querySelector("td:first-child");
      const label =
        firstCell?.querySelector("a.gare-link")?.textContent || firstCell?.textContent || "";
      return canonicalStationName(label).startsWith("luxembourg");
    });
    if (!luxRow) return null;

    return {
      table,
      luxRow,
      isArrivalLayout: rows[rows.length - 1] === luxRow
    };
  }

  function removeLuxArrivalBadges(row) {
    row?.querySelectorAll?.(".lb-lux-arrival-track").forEach((badge) => badge.remove());
  }

  function renderLuxArrivalBadges() {
    const context = getLuxembourgArrivalTableContext();
    if (!context) return false;

    const { table, luxRow, isArrivalLayout } = context;
    if (!isArrivalLayout) {
      removeLuxArrivalBadges(luxRow);
      return false;
    }

    installLuxArrivalStyle();

    const headers = Array.from(table.querySelectorAll("thead th"));
    const cells = Array.from(luxRow.querySelectorAll("td"));
    if (headers.length < 2 || cells.length < 2) return false;

    for (let i = 1; i < cells.length; i += 1) {
      const cell = cells[i];
      const header = headers[i];
      if (!cell || !header) continue;

      const trainNumber = extractTrainNumberCandidate(header.textContent || "");
      const existing = cell.querySelector(".lb-lux-arrival-track");
      const hasTime = /\b\d{1,2}:\d{2}\b/.test(cell.textContent || "");

      if (!trainNumber || !hasTime) {
        existing?.remove();
        continue;
      }

      const info = chooseLuxArrival(trainNumber, cell);
      if (!info?.track) {
        existing?.remove();
        continue;
      }

      const title =
        info.platformChanged && info.plannedTrack && info.realtimeTrack
          ? `Voie d’arrivée HAFAS : ${info.plannedTrack} → ${info.realtimeTrack}`
          : "Voie d’arrivée HAFAS";

      if (existing) {
        let changed = false;
        if (existing.dataset.track !== info.track) {
          existing.dataset.track = info.track;
          existing.textContent = `Voie ${info.track}`;
          changed = true;
        }
        if (existing.title !== title) {
          existing.title = title;
          changed = true;
        }
        const aria = `Voie ${info.track} à l'arrivée à Luxembourg`;
        if (existing.getAttribute("aria-label") !== aria) {
          existing.setAttribute("aria-label", aria);
          changed = true;
        }
        if (!changed) {
          // Rien à faire : on évite toute mutation DOM inutile qui provoquerait un scintillement.
        }
        continue;
      }

      const badge = document.createElement("span");
      badge.className = "voie-badge lb-lux-arrival-track";
      badge.dataset.track = info.track;
      badge.dataset.source = "hafas-stationboard-arrivals";
      badge.style.marginLeft = "6px";
      badge.textContent = `Voie ${info.track}`;
      badge.title = title;
      badge.setAttribute("aria-label", `Voie ${info.track} à l'arrivée à Luxembourg`);
      cell.appendChild(badge);
    }

    return true;
  }

  function scheduleLuxArrivalBadges() {
    if (luxArrivalRenderQueued) return;
    luxArrivalRenderQueued = true;

    const run = async () => {
      luxArrivalRenderQueued = false;
      const context = getLuxembourgArrivalTableContext();
      if (!context) return;
      if (!context.isArrivalLayout) {
        removeLuxArrivalBadges(context.luxRow);
        return;
      }

      try {
        await ensureLuxArrivals();
        renderLuxArrivalBadges();
      } catch (error) {
        console.warn("[Luxembourg arrivées] voies indisponibles", error);
      }
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  function startLuxArrivalRefresh() {
    if (luxArrivalTimer) return;
    luxArrivalTimer = window.setInterval(async () => {
      const context = getLuxembourgArrivalTableContext();
      if (!context?.isArrivalLayout) return;
      try {
        await ensureLuxArrivals({ force: true });
        renderLuxArrivalBadges();
      } catch (error) {
        console.warn("[Luxembourg arrivées] rafraîchissement impossible", error);
      }
    }, LUX_ARRIVALS_REFRESH_MS);
  }

  function isLuxArrivalInjectedNode(node) {
    if (!(node instanceof Element)) return false;
    return (
      node.classList.contains("lb-lux-arrival-track") ||
      node.closest(".lb-lux-arrival-track") ||
      node.classList.contains("lb-table-swipe-hint") ||
      node.closest(".lb-table-swipe-hint")
    );
  }

  function shouldIgnoreTableMutations(mutations) {
    if (!Array.isArray(mutations) || !mutations.length) return true;
    return mutations.every((mutation) => {
      if (mutation.type !== "childList") return false;
      const changedNodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || [])
      ];
      if (!changedNodes.length) return false;
      return changedNodes.every((node) => isLuxArrivalInjectedNode(node));
    });
  }

  function enhanceTrainTable() {
    const host = document.getElementById("trainInfo");
    const scroller = host?.querySelector(".table-scroll");
    if (!host || !scroller) return;

    if (!host.querySelector(".lb-table-swipe-hint")) {
      const hint = document.createElement("div");
      hint.className = "lb-table-swipe-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.textContent = "← Glisser pour voir les autres trains →";
      scroller.before(hint);
    }

    if (!scroller.hasAttribute("tabindex")) scroller.tabIndex = 0;
    if (!scroller.hasAttribute("aria-label")) {
      scroller.setAttribute(
        "aria-label",
        "Tableau des trains, défilement horizontal et vertical"
      );
    }

    scheduleLuxArrivalBadges();
  }

  function syncSecondaryNavigation() {
    const tableNav = document.getElementById("tableauViewNav");
    const funNav = document.getElementById("loisirsViewNav");
    const visibleHeight = (element) => {
      if (!element || element.hidden || !element.classList.contains("is-visible")) return 0;
      return Math.ceil(element.getBoundingClientRect().height || 0);
    };
    const tableHeight = visibleHeight(tableNav);
    const funHeight = visibleHeight(funNav);
    document.documentElement.style.setProperty("--tableau-viewbar-h", `${tableHeight}px`);
    document.documentElement.style.setProperty(
      "--lb-secondary-bar-height",
      `${Math.max(tableHeight, funHeight)}px`
    );
  }

  function watchSecondaryNavigation() {
    const targets = [
      document.getElementById("tableauViewNav"),
      document.getElementById("loisirsViewNav")
    ].filter(Boolean);
    const observer = new MutationObserver(syncSecondaryNavigation);
    targets.forEach((target) => {
      observer.observe(target, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"]
      });
    });
    syncSecondaryNavigation();
  }

  function watchTrainTable() {
    const host = document.getElementById("trainInfo");
    if (!host) return;

    enhanceTrainTable();
    luxTableMutationObserver?.disconnect?.();
    luxTableMutationObserver = new MutationObserver((mutations) => {
      if (shouldIgnoreTableMutations(mutations)) return;
      if (luxTableMutationDebounce) window.clearTimeout(luxTableMutationDebounce);
      luxTableMutationDebounce = window.setTimeout(() => {
        luxTableMutationDebounce = null;
        enhanceTrainTable();
      }, LUX_TABLE_MUTATION_DEBOUNCE_MS);
    });

    luxTableMutationObserver.observe(host, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    document.body.classList.add("lb-mobile-v4");
    removeCompactMoreMenu();
    watchTrainTable();
    watchSecondaryNavigation();
    syncGenerateButton();
    syncViewport();
    startLuxArrivalRefresh();

    window.addEventListener("resize", syncViewport, { passive: true });
    window.addEventListener("resize", syncSecondaryNavigation, { passive: true });
    window.addEventListener("orientationchange", syncViewport, { passive: true });
    window.addEventListener("focusin", syncViewport, { passive: true });
    window.addEventListener("focusout", () => window.setTimeout(syncViewport, 50), {
      passive: true
    });
    window.visualViewport?.addEventListener("resize", syncViewport, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncViewport, { passive: true });
    mobileQuery.addEventListener?.("change", () => {
      removeCompactMoreMenu();
      syncGenerateButton();
      syncViewport();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
