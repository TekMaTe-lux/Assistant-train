/*
 * La Bétaillère — contrôleur mobile v4.
 * Mesures de viewport PWA, clavier mobile et enrichissement léger du tableau.
 *
 * Luxembourg : les voies d'arrivée ne sont PAS injectées dans le DOM.
 * Elles sont fournies au moteur natif du tableau via getCflVoiesForTrain(),
 * afin que le même rendu .voie-badge soit utilisé partout sans scintillement.
 */
(function () {
  "use strict";

  const mobileQuery = window.matchMedia(
    "(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)"
  );

  const LUX_ARRIVALS_URL =
    "https://vps.labetaillere.fr/gtfs/retards_cfl_arrivals.json";
  const LUX_ARRIVALS_REFRESH_MS = 120000;

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
  let luxArrivalsPromise = null;
  let luxArrivalsLastLoadedAt = 0;
  let luxArrivalsRefreshTimer = null;
  let trainHostObserver = null;

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
        track,
        planned: normalizeClock(rawInfo.arrivalPlanned),
        realtime: normalizeClock(rawInfo.arrivalRealtime),
        plannedTrack: normalizeTrack(rawInfo.arrivalPlatformPlanned),
        realtimeTrack: normalizeTrack(rawInfo.arrivalPlatformRealtime)
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

  function getLuxembourgArrivalContext() {
    const table = document.querySelector("#trainInfo .table-scroll table, #trainInfo table");
    if (!table) return null;

    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) =>
      row.querySelector("td:first-child")
    );
    if (!rows.length) return null;

    const luxRow = rows.find((row) => {
      const firstCell = row.querySelector("td:first-child");
      const label =
        firstCell?.querySelector("a.gare-link")?.textContent ||
        firstCell?.querySelector(".gare-label")?.textContent ||
        firstCell?.textContent ||
        "";
      return canonicalStationName(label).startsWith("luxembourg");
    });
    if (!luxRow) return null;

    return {
      table,
      luxRow,
      isArrivalLayout: rows[rows.length - 1] === luxRow
    };
  }

  function getLuxArrivalTrack(trainNumber) {
    const context = getLuxembourgArrivalContext();
    if (!context?.isArrivalLayout) return null;

    const exactKey = normalizeTrainNumberKey(trainNumber);
    if (!exactKey) return null;

    const candidateKeys = Array.from(
      new Set([exactKey, ...equivalentTrainNumbers(exactKey)])
    );

    // Priorité au numéro exact, puis aux équivalences connues.
    for (const key of candidateKeys) {
      const infos = luxArrivalsByNumber.get(key);
      if (!Array.isArray(infos) || !infos.length) continue;
      const info = infos[0];
      const track = normalizeTrack(info?.realtimeTrack ?? info?.track ?? info?.plannedTrack);
      if (track) return track;
    }

    return null;
  }

  function patchNativeCflVoiesResolver() {
    const current = window.getCflVoiesForTrain;
    if (typeof current !== "function") return false;
    if (current.__lbLuxArrivalsNative === true) return true;

    const original = current;
    const wrapped = function (trainNumber) {
      const base = original.apply(this, arguments);
      const arrivalTrack = getLuxArrivalTrack(trainNumber);
      if (!arrivalTrack) return base;

      // Clone uniquement la petite Map du train : on ne modifie jamais les données CFL
      // globales. Le moteur natif du tableau lira ensuite "luxembourg" et fabriquera
      // lui-même le même .voie-badge que pour toutes les autres gares.
      const result = base instanceof Map ? new Map(base) : new Map();
      result.set("luxembourg", arrivalTrack);
      return result;
    };

    Object.defineProperty(wrapped, "__lbLuxArrivalsNative", {
      value: true,
      configurable: false,
      enumerable: false
    });
    Object.defineProperty(wrapped, "__lbLuxArrivalsOriginal", {
      value: original,
      configurable: false,
      enumerable: false
    });

    window.getCflVoiesForTrain = wrapped;
    return window.getCflVoiesForTrain === wrapped;
  }

  function ensureNativePatch() {
    if (patchNativeCflVoiesResolver()) return;
    // Sécurité si ce fichier est exécuté avant le gros script historique.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (patchNativeCflVoiesResolver() || attempts >= 30) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  function pokeNativeTableRefresh() {
    const host = document.getElementById("trainInfo");
    if (!host?.querySelector("table")) return;

    // Le moteur LIVE historique observe les enfants directs de #trainInfo.
    // Un commentaire invisible suffit à lui demander un refresh natif, sans toucher
    // aux cellules ni provoquer de flash visuel.
    const marker = document.createComment("lb-lux-arrivals-refresh");
    host.appendChild(marker);
    marker.remove();
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
      ensureNativePatch();
      pokeNativeTableRefresh();
      return luxArrivalsByNumber;
    })();

    try {
      return await luxArrivalsPromise;
    } finally {
      luxArrivalsPromise = null;
    }
  }

  function startLuxArrivalRefresh() {
    if (luxArrivalsRefreshTimer) return;
    luxArrivalsRefreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      ensureLuxArrivals({ force: true }).catch((error) => {
        console.warn("[Luxembourg arrivées] rafraîchissement impossible", error);
      });
    }, LUX_ARRIVALS_REFRESH_MS);
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

    // Nettoyage d'un éventuel badge hérité des versions précédentes.
    host.querySelectorAll(".lb-lux-arrival-track").forEach((node) => node.remove());

    // Si les arrivées sont déjà en mémoire, le moteur natif peut les appliquer.
    if (luxArrivalsByNumber.size) pokeNativeTableRefresh();
  }

  function watchTrainTable() {
    const host = document.getElementById("trainInfo");
    if (!host) return;

    enhanceTrainTable();
    trainHostObserver?.disconnect?.();
    trainHostObserver = new MutationObserver(() => {
      // On observe seulement les enfants directs : génération/remplacement du tableau,
      // jamais les modifications internes des cellules.
      window.setTimeout(enhanceTrainTable, 0);
    });
    trainHostObserver.observe(host, {
      childList: true,
      subtree: false
    });
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

  function init() {
    document.body.classList.add("lb-mobile-v4");
    removeCompactMoreMenu();
    ensureNativePatch();
    watchTrainTable();
    watchSecondaryNavigation();
    syncGenerateButton();
    syncViewport();

    // Précharge la même source StationBoard que la carte avant la génération du tableau.
    ensureLuxArrivals().catch((error) => {
      console.warn("[Luxembourg arrivées] voies indisponibles", error);
    });
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
