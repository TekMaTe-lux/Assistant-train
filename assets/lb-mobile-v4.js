/*
 * La Bétaillère — contrôleur mobile v4.
 * Mesures de viewport PWA, clavier mobile et amélioration du tableau.
 */
(function () {
  "use strict";

  const mobileQuery = window.matchMedia(
    "(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)"
  );

  const LUX_TRACK_REFRESH_MS = 120000;
  const LUX_TRACK_SOURCES = [
    {
      label: "voies_by_train",
      urls: ["https://vps.labetaillere.fr/gtfs/voies_by_train.json"]
    },
    {
      label: "retards_cfl",
      urls: ["https://vps.labetaillere.fr/gtfs/retards_cfl.json"]
    },
    {
      label: "retards_cfl_by_station",
      urls: ["https://vps.labetaillere.fr/gtfs/retards_cfl_by_station.json"]
    }
  ];
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
    const normalized = Array.from(new Set(group.map(normalizeTrainNumberKey).filter(Boolean)));
    for (const key of normalized) trainNumberEquivalents.set(key, normalized);
  }

  let luxTracksByTrainNumber = new Map();
  let luxTrackLoadPromise = null;
  let luxTrackLastLoadedAt = 0;
  let luxTableRenderQueued = false;
  let luxTrackRefreshTimer = null;

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

  function normalizeStationName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalStationName(value) {
    return normalizeStationName(value)
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
    matches.sort((a, b) => b[0].length - a[0].length || (b.index || 0) - (a.index || 0));
    return matches[0][0].replace(/^0+(?=\d)/, "");
  }

  function normalizeTrainNumberKey(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const candidate = extractTrainNumberCandidate(raw) || raw;
    const trimmed = String(candidate).replace(/^0+/, "");
    return trimmed || "0";
  }

  function equivalentTrainNumbers(value) {
    const key = normalizeTrainNumberKey(value);
    if (!key) return [];
    return trainNumberEquivalents.get(key) || [key];
  }

  function normalizeTrackValue(value) {
    if (value == null) return null;
    const type = typeof value;
    if (type !== "string" && type !== "number") return null;
    const raw = String(value).trim();
    if (!raw || /^(-+|n\/?a|nc|null|undefined)$/i.test(raw)) return null;
    const compact = raw.replace(/^voie\s*/i, "").replace(/^track\s*/i, "").trim();
    return compact || null;
  }

  function ingestTrackRecord(targetMap, trainRawKey, payload, sourceLabel) {
    if (!trainRawKey || !payload || typeof payload !== "object") return;
    const normalizedKey = normalizeTrainNumberKey(trainRawKey);
    if (!normalizedKey) return;

    const stationName =
      payload.station ?? payload.gare ?? payload.stop_name ?? payload.stop ?? payload.name ?? null;
    const stationNorm = stationName ? canonicalStationName(stationName) : null;
    const depTrack = normalizeTrackValue(
      payload.departure_track ??
        payload.dep_track ??
        payload.departure_platform ??
        payload.dep_platform ??
        payload.dep_voie ??
        payload.voie_depart ??
        payload.voie_dep ??
        payload.depVoie ??
        payload.dep
    );
    const arrTrack = normalizeTrackValue(
      payload.arrival_track ??
        payload.arr_track ??
        payload.arrival_platform ??
        payload.arr_platform ??
        payload.arr_voie ??
        payload.voie_arrivee ??
        payload.voie_arr ??
        payload.arrVoie ??
        payload.arr
    );
    const genericTrack = normalizeTrackValue(
      payload.track ?? payload.platform ?? payload.voie ?? payload.quai
    );
    if (!depTrack && !arrTrack && !genericTrack) return;

    if (!targetMap.has(normalizedKey)) targetMap.set(normalizedKey, []);
    targetMap.get(normalizedKey).push({
      stationNorm,
      depTrack,
      arrTrack,
      genericTrack,
      source: sourceLabel || ""
    });
  }

  function registerTracksFromPayload(targetMap, payload, sourceLabel) {
    if (!payload) return;

    if (
      sourceLabel === "retards_cfl" &&
      payload &&
      typeof payload === "object" &&
      payload.data &&
      typeof payload.data === "object"
    ) {
      for (const [trainLabel, stationMap] of Object.entries(payload.data)) {
        const trainCandidate = extractTrainNumberCandidate(trainLabel);
        if (trainCandidate == null || !stationMap || typeof stationMap !== "object") continue;
        for (const [stationName, stationPayload] of Object.entries(stationMap)) {
          if (!stationPayload || typeof stationPayload !== "object") continue;
          const platform = normalizeTrackValue(
            stationPayload.platform ?? stationPayload.voie ?? stationPayload.track ?? stationPayload.quai
          );
          if (!platform) continue;
          ingestTrackRecord(targetMap, trainCandidate, { station: stationName, voie: platform }, sourceLabel);
        }
      }
    }

    if (
      sourceLabel === "retards_cfl_by_station" &&
      payload &&
      typeof payload === "object" &&
      payload.stations &&
      typeof payload.stations === "object"
    ) {
      for (const [stationName, stationInfo] of Object.entries(payload.stations)) {
        const departures = Array.isArray(stationInfo?.departures) ? stationInfo.departures : [];
        const arrivals = Array.isArray(stationInfo?.arrivals) ? stationInfo.arrivals : [];
        for (const item of [...departures, ...arrivals]) {
          if (!item || typeof item !== "object") continue;
          const trainCandidate = extractTrainNumberCandidate(
            item.train ?? item.name ?? item.number ?? item.trainNumber
          );
          if (trainCandidate == null) continue;
          const platform = normalizeTrackValue(item.platform ?? item.track ?? item.voie ?? item.quai);
          if (!platform) continue;
          ingestTrackRecord(targetMap, trainCandidate, { station: stationName, voie: platform }, sourceLabel);
        }
      }
    }

    const queue = [payload];
    while (queue.length) {
      const node = queue.shift();
      if (!node) continue;
      if (Array.isArray(node)) {
        for (const item of node) queue.push(item);
        continue;
      }
      if (typeof node !== "object") continue;

      const trainKey =
        node.trainNumber ??
        node.train_number ??
        node.trainNo ??
        node.train ??
        node.numero ??
        node.num ??
        node.trip_number ??
        node.tripNo ??
        node.id;
      if (trainKey != null) ingestTrackRecord(targetMap, trainKey, node, sourceLabel);

      for (const [key, value] of Object.entries(node)) {
        if (value == null) continue;
        const candidate = extractTrainNumberCandidate(key);
        if (candidate != null && typeof value === "object") {
          if (Array.isArray(value)) {
            for (const entry of value) {
              if (entry && typeof entry === "object") {
                ingestTrackRecord(targetMap, candidate, entry, sourceLabel);
              }
            }
          } else {
            ingestTrackRecord(targetMap, candidate, value, sourceLabel);
            for (const [subKey, subValue] of Object.entries(value)) {
              const stationPart = String(subKey || "").split("|")[0]?.trim();
              if (!stationPart) continue;
              if (subValue && typeof subValue === "object" && !Array.isArray(subValue)) {
                const parsedObjTrack = normalizeTrackValue(
                  subValue.platform ??
                    subValue.voie ??
                    subValue.track ??
                    subValue.quai ??
                    subValue.departure_platform ??
                    subValue.arrival_platform
                );
                if (!parsedObjTrack) continue;
                ingestTrackRecord(
                  targetMap,
                  candidate,
                  { station: stationPart, voie: parsedObjTrack },
                  sourceLabel
                );
                continue;
              }
              const parsedTrack = normalizeTrackValue(subValue);
              if (!parsedTrack) continue;
              ingestTrackRecord(
                targetMap,
                candidate,
                { station: stationPart, voie: parsedTrack },
                sourceLabel
              );
            }
          }
          continue;
        }
        if (typeof value === "object") queue.push(value);
      }
    }
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
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

  async function ensureLuxTrackAssignments({ force = false } = {}) {
    const now = Date.now();
    if (!force && luxTracksByTrainNumber.size && now - luxTrackLastLoadedAt < LUX_TRACK_REFRESH_MS) {
      return luxTracksByTrainNumber;
    }
    if (luxTrackLoadPromise) return luxTrackLoadPromise;

    luxTrackLoadPromise = (async () => {
      const freshMap = new Map();
      let loadedAnySource = false;
      for (const source of LUX_TRACK_SOURCES) {
        for (const url of source.urls) {
          try {
            const data = await fetchJsonWithTimeout(url);
            registerTracksFromPayload(freshMap, data, source.label);
            loadedAnySource = true;
            break;
          } catch (_) {
            // Une source de secours peut encore fournir la voie.
          }
        }
      }

      if (loadedAnySource) {
        luxTracksByTrainNumber = freshMap;
        luxTrackLastLoadedAt = Date.now();
      }
      return luxTracksByTrainNumber;
    })();

    try {
      return await luxTrackLoadPromise;
    } finally {
      luxTrackLoadPromise = null;
    }
  }

  function findLuxembourgArrivalTrack(trainNumber) {
    const key = normalizeTrainNumberKey(trainNumber);
    if (!key) return null;
    const candidateKeys = [];
    for (const candidate of [key, ...equivalentTrainNumbers(key)]) {
      if (candidate && !candidateKeys.includes(candidate)) candidateKeys.push(candidate);
    }

    for (const candidate of candidateKeys) {
      const records = luxTracksByTrainNumber.get(candidate);
      if (!Array.isArray(records) || !records.length) continue;
      const stationSpecific = records.find((record) => record.stationNorm === "luxembourg");
      if (!stationSpecific) continue;
      const track = stationSpecific.arrTrack || stationSpecific.genericTrack || stationSpecific.depTrack;
      if (track) return track;
    }
    return null;
  }

  function installLuxTrackStyle() {
    if (document.getElementById("lb-lux-arrival-track-style")) return;
    const style = document.createElement("style");
    style.id = "lb-lux-arrival-track-style";
    style.textContent = `
      #trainInfo .lb-lux-arrival-track{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        margin-left:5px;
        padding:2px 6px;
        border:1px solid rgba(0,240,255,.68);
        border-radius:999px;
        background:rgba(0,240,255,.11);
        color:#00f0ff;
        font-size:10px;
        font-weight:700;
        line-height:1.05;
        white-space:nowrap;
        vertical-align:middle;
        box-shadow:0 0 8px rgba(0,240,255,.14), inset 0 0 6px rgba(0,240,255,.05);
      }
      #trainInfo .lb-lux-arrival-track::before{
        content:"Voie ";
        margin-right:2px;
        font-size:.82em;
        font-weight:600;
        opacity:.88;
      }
    `;
    document.head.appendChild(style);
  }

  function getLuxembourgArrivalTableContext() {
    const table = document.querySelector("#trainInfo .table-scroll table");
    if (!table) return null;
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const stationRows = bodyRows.filter((row) => row.querySelector("td:first-child"));
    if (!stationRows.length) return null;

    const luxRow = stationRows.find((row) => {
      const stationLink = row.querySelector("td:first-child a.gare-link");
      const label = stationLink?.textContent || row.querySelector("td:first-child")?.textContent || "";
      return canonicalStationName(label).startsWith("luxembourg");
    });
    if (!luxRow) return null;

    // On ne met une voie d'arrivée que lorsque Luxembourg est le terminus affiché.
    // En sens Luxembourg -> France, la ligne Luxembourg est en tête : aucun badge d'arrivée.
    if (stationRows[stationRows.length - 1] !== luxRow) return { table, luxRow, isArrivalLayout: false };

    return { table, luxRow, isArrivalLayout: true };
  }

  function removeLuxArrivalTrackBadges(row) {
    row?.querySelectorAll?.(".lb-lux-arrival-track").forEach((badge) => badge.remove());
  }

  function renderLuxembourgArrivalTracks() {
    const context = getLuxembourgArrivalTableContext();
    if (!context) return false;
    const { table, luxRow, isArrivalLayout } = context;
    if (!isArrivalLayout) {
      removeLuxArrivalTrackBadges(luxRow);
      return false;
    }

    installLuxTrackStyle();
    const headers = Array.from(table.querySelectorAll("thead th"));
    const cells = Array.from(luxRow.querySelectorAll("td"));
    if (headers.length < 2 || cells.length < 2) return false;

    for (let columnIndex = 1; columnIndex < cells.length; columnIndex += 1) {
      const cell = cells[columnIndex];
      const header = headers[columnIndex];
      if (!cell || !header) continue;

      const trainNumber = extractTrainNumberCandidate(header.textContent || "");
      const hasTime = /\b\d{1,2}:\d{2}\b/.test(cell.textContent || "");
      const existing = cell.querySelector(".lb-lux-arrival-track");
      if (!trainNumber || !hasTime) {
        existing?.remove();
        continue;
      }

      const track = findLuxembourgArrivalTrack(trainNumber);
      if (!track) {
        existing?.remove();
        continue;
      }

      if (existing) {
        if (existing.dataset.track !== track) {
          existing.dataset.track = track;
          existing.textContent = track;
          existing.title = `Voie ${track} à l'arrivée à Luxembourg`;
        }
        continue;
      }

      const badge = document.createElement("span");
      badge.className = "lb-lux-arrival-track";
      badge.dataset.track = track;
      badge.textContent = track;
      badge.title = `Voie ${track} à l'arrivée à Luxembourg`;
      badge.setAttribute("aria-label", `Voie ${track} à l'arrivée à Luxembourg`);
      cell.appendChild(badge);
    }
    return true;
  }

  function scheduleLuxembourgArrivalTracks() {
    if (luxTableRenderQueued) return;
    luxTableRenderQueued = true;
    const run = async () => {
      luxTableRenderQueued = false;
      const context = getLuxembourgArrivalTableContext();
      if (!context) return;
      if (!context.isArrivalLayout) {
        removeLuxArrivalTrackBadges(context.luxRow);
        return;
      }
      try {
        await ensureLuxTrackAssignments();
      } catch (_) {
        return;
      }
      renderLuxembourgArrivalTracks();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  function startLuxTrackRefresh() {
    if (luxTrackRefreshTimer) return;
    luxTrackRefreshTimer = window.setInterval(async () => {
      const context = getLuxembourgArrivalTableContext();
      if (!context?.isArrivalLayout) return;
      try {
        await ensureLuxTrackAssignments({ force: true });
        renderLuxembourgArrivalTracks();
      } catch (_) {
        // On garde les dernières voies connues en cas de panne temporaire du flux.
      }
    }, LUX_TRACK_REFRESH_MS);
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

    scheduleLuxembourgArrivalTracks();
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
    new MutationObserver(enhanceTrainTable).observe(host, {
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
    startLuxTrackRefresh();

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
