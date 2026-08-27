/*
 * La Bétaillère — contrôleur mobile v4.
 * Mesures de viewport PWA, clavier mobile, tableau et voies d'arrivée Luxembourg.
 */
(function () {
  "use strict";

  const mobileQuery = window.matchMedia(
    "(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)"
  );

  const LUX_TRACK_REFRESH_MS = 120000;
  const LUX_STATION_LIVE_URL = "https://vps.labetaillere.fr/gtfs/lux_station_live.json";
  const LUX_TRACK_FALLBACK_SOURCES = [
    ["voies_by_train", "https://vps.labetaillere.fr/gtfs/voies_by_train.json"],
    ["retards_cfl", "https://vps.labetaillere.fr/gtfs/retards_cfl.json"],
    ["retards_cfl_by_station", "https://vps.labetaillere.fr/gtfs/retards_cfl_by_station.json"]
  ];

  const TRAIN_NUMBER_EQUIVALENCE_GROUPS = [
    ["2870", "2871"], ["2864", "2865"], ["2806", "2807"], ["2872", "2873"],
    ["2816", "2817"], ["88504", "88505"], ["88502", "88503"], ["88500", "88501"],
    ["88529", "88530"], ["88531", "88530"], ["88533", "88532"], ["88535", "88534"],
    ["88520", "88521"], ["88522", "88523"], ["88524", "88525"], ["88526", "88527"],
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
      isMobileLayout() && editsText && visualHeight > 0 && visualHeight < window.innerHeight * 0.76;
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
    const matches = Array.from(String(value).matchAll(/\d{3,}/g));
    if (!matches.length) return null;
    matches.sort((a, b) => b[0].length - a[0].length || (b.index || 0) - (a.index || 0));
    return matches[0][0].replace(/^0+(?=\d)/, "");
  }

  function normalizeTrainNumberKey(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const candidate = extractTrainNumberCandidate(raw) || raw;
    return String(candidate).replace(/^0+/, "") || "0";
  }

  function equivalentTrainNumbers(value) {
    const key = normalizeTrainNumberKey(value);
    return key ? (trainNumberEquivalents.get(key) || [key]) : [];
  }

  function normalizeTrackValue(value) {
    if (value == null || (typeof value !== "string" && typeof value !== "number")) return null;
    const raw = String(value).trim();
    if (!raw || /^(-+|n\/?a|nc|null|undefined)$/i.test(raw)) return null;
    return raw.replace(/^voie\s*/i, "").replace(/^track\s*/i, "").trim() || null;
  }

  function normalizeEventType(value) {
    return normalizeStationName(value).replace(/[^a-z]/g, "");
  }

  function isArrivalEventType(value) {
    const type = normalizeEventType(value);
    return type === "arr" || type === "arrival" || type === "arrivee" || type.startsWith("arriv");
  }

  function ingestTrackRecord(targetMap, trainRawKey, payload, sourceLabel, options = {}) {
    if (!trainRawKey || !payload || typeof payload !== "object") return;
    const key = normalizeTrainNumberKey(trainRawKey);
    if (!key) return;

    const stationName = options.stationName || (
      payload.station ?? payload.gare ?? payload.stop_name ?? payload.stop ?? payload.name ?? null
    );
    const stationNorm = stationName ? canonicalStationName(stationName) : null;

    let depTrack = normalizeTrackValue(
      payload.departure_track ?? payload.dep_track ?? payload.departure_platform ?? payload.dep_platform ??
      payload.dep_voie ?? payload.voie_depart ?? payload.voie_dep ?? payload.depVoie ?? payload.dep
    );
    let arrTrack = normalizeTrackValue(
      payload.arrival_track ?? payload.arr_track ?? payload.arrival_platform ?? payload.arr_platform ??
      payload.arr_voie ?? payload.voie_arrivee ?? payload.voie_arr ?? payload.arrVoie ?? payload.arr
    );
    const genericTrack = normalizeTrackValue(payload.track ?? payload.platform ?? payload.voie ?? payload.quai);

    if (options.mode === "arr" && !arrTrack && genericTrack) arrTrack = genericTrack;
    if (options.mode === "dep" && !depTrack && genericTrack) depTrack = genericTrack;
    if (!depTrack && !arrTrack && !genericTrack) return;

    if (!targetMap.has(key)) targetMap.set(key, []);
    targetMap.get(key).push({ stationNorm, depTrack, arrTrack, genericTrack, source: sourceLabel || "" });
  }

  // Même snapshot que le tableau « Gare de Luxembourg ».
  // Il est déjà alimenté côté VPS par HAFAS StationBoard : aucun nouvel appel HAFAS ici.
  function registerLuxStationLive(targetMap, payload) {
    const seen = new Set();

    const visit = (node, inheritedType = "") => {
      if (node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, inheritedType);
        return;
      }
      if (typeof node !== "object" || seen.has(node)) return;
      seen.add(node);

      const explicitType = node.type ?? node.mode ?? node.eventType ?? node.event_type ?? node.kind ?? "";
      const eventType = explicitType || inheritedType;
      const trainRaw =
        node.number ?? node.trainNumber ?? node.train_number ?? node.train ?? node.name ?? node.line ?? null;
      const track = normalizeTrackValue(
        node.track ?? node.platform ?? node.voie ?? node.quai ?? node.arrivalTrack ?? node.arrival_track
      );

      if (trainRaw != null && track && isArrivalEventType(eventType)) {
        ingestTrackRecord(
          targetMap,
          trainRaw,
          { station: "Luxembourg", arrival_track: track },
          "lux_station_live",
          { stationName: "Luxembourg", mode: "arr" }
        );
      }

      for (const [childKey, childValue] of Object.entries(node)) {
        if (childValue == null || typeof childValue !== "object") continue;
        const keyType = normalizeEventType(childKey);
        let nextType = eventType;
        if (["arrivals", "arrival", "arrivees", "arrivee"].includes(keyType)) nextType = "arrival";
        if (["departures", "departure", "departs", "depart"].includes(keyType)) nextType = "departure";
        visit(childValue, nextType);
      }
    };

    visit(payload, "");
  }

  function registerFallbackTracks(targetMap, payload, sourceLabel) {
    if (!payload || typeof payload !== "object") return;

    if (sourceLabel === "retards_cfl" && payload.data && typeof payload.data === "object") {
      for (const [trainLabel, stationMap] of Object.entries(payload.data)) {
        const train = extractTrainNumberCandidate(trainLabel);
        if (!train || !stationMap || typeof stationMap !== "object") continue;
        for (const [stationName, info] of Object.entries(stationMap)) {
          if (!info || typeof info !== "object") continue;
          const track = normalizeTrackValue(info.platform ?? info.voie ?? info.track ?? info.quai);
          if (track) ingestTrackRecord(targetMap, train, { station: stationName, voie: track }, sourceLabel);
        }
      }
    }

    if (sourceLabel === "retards_cfl_by_station" && payload.stations && typeof payload.stations === "object") {
      for (const [stationName, stationInfo] of Object.entries(payload.stations)) {
        const arrivals = Array.isArray(stationInfo?.arrivals) ? stationInfo.arrivals : [];
        const departures = Array.isArray(stationInfo?.departures) ? stationInfo.departures : [];
        for (const item of arrivals) {
          const train = extractTrainNumberCandidate(item?.train ?? item?.name ?? item?.number ?? item?.trainNumber);
          const track = normalizeTrackValue(item?.platform ?? item?.track ?? item?.voie ?? item?.quai);
          if (train && track) {
            ingestTrackRecord(
              targetMap, train, { station: stationName, arrival_track: track }, sourceLabel, { mode: "arr" }
            );
          }
        }
        for (const item of departures) {
          const train = extractTrainNumberCandidate(item?.train ?? item?.name ?? item?.number ?? item?.trainNumber);
          const track = normalizeTrackValue(item?.platform ?? item?.track ?? item?.voie ?? item?.quai);
          if (train && track) {
            ingestTrackRecord(
              targetMap, train, { station: stationName, departure_track: track }, sourceLabel, { mode: "dep" }
            );
          }
        }
      }
    }

    // Parser générique pour voies_by_train et éventuelles variantes de structure.
    const queue = [payload];
    const seen = new Set();
    while (queue.length) {
      const node = queue.shift();
      if (node == null) continue;
      if (Array.isArray(node)) {
        for (const item of node) queue.push(item);
        continue;
      }
      if (typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);

      const train =
        node.trainNumber ?? node.train_number ?? node.trainNo ?? node.train ?? node.numero ??
        node.num ?? node.trip_number ?? node.tripNo ?? null;
      if (train != null) ingestTrackRecord(targetMap, train, node, sourceLabel);

      for (const [key, value] of Object.entries(node)) {
        if (value == null || typeof value !== "object") continue;
        const keyTrain = extractTrainNumberCandidate(key);
        if (keyTrain) {
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === "object") ingestTrackRecord(targetMap, keyTrain, item, sourceLabel);
            }
          } else {
            ingestTrackRecord(targetMap, keyTrain, value, sourceLabel);
            for (const [stationName, stationValue] of Object.entries(value)) {
              if (stationValue == null) continue;
              if (typeof stationValue === "object") {
                const track = normalizeTrackValue(
                  stationValue.platform ?? stationValue.voie ?? stationValue.track ?? stationValue.quai ??
                  stationValue.arrival_platform ?? stationValue.departure_platform
                );
                if (track) ingestTrackRecord(targetMap, keyTrain, { station: stationName, voie: track }, sourceLabel);
              } else {
                const track = normalizeTrackValue(stationValue);
                if (track) ingestTrackRecord(targetMap, keyTrain, { station: stationName, voie: track }, sourceLabel);
              }
            }
          }
        }
        queue.push(value);
      }
    }
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const sep = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${sep}t=${Date.now()}`, {
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
      let loadedSomething = false;

      try {
        const live = await fetchJsonWithTimeout(LUX_STATION_LIVE_URL);
        registerLuxStationLive(freshMap, live);
        loadedSomething = true;
      } catch (_) {
        // Les anciennes consolidations ci-dessous restent disponibles en secours.
      }

      for (const [label, url] of LUX_TRACK_FALLBACK_SOURCES) {
        try {
          const data = await fetchJsonWithTimeout(url);
          registerFallbackTracks(freshMap, data, label);
          loadedSomething = true;
        } catch (_) {
          // Source suivante.
        }
      }

      if (loadedSomething) {
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
    const candidates = Array.from(new Set([key, ...equivalentTrainNumbers(key)]));

    // Priorité absolue au même snapshot que le tableau « Arrivées ».
    for (const candidate of candidates) {
      const records = luxTracksByTrainNumber.get(candidate) || [];
      const live = records.find(
        (record) => record.stationNorm === "luxembourg" && record.source === "lux_station_live"
      );
      const track = live?.arrTrack || live?.genericTrack;
      if (track) return track;
    }

    for (const candidate of candidates) {
      const records = luxTracksByTrainNumber.get(candidate) || [];
      const record = records.find((item) => item.stationNorm === "luxembourg");
      const track = record?.arrTrack || record?.genericTrack || record?.depTrack;
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
        display:inline-flex;align-items:center;justify-content:center;margin-left:5px;padding:2px 6px;
        border:1px solid rgba(0,240,255,.68);border-radius:999px;background:rgba(0,240,255,.11);
        color:#00f0ff;font-size:10px;font-weight:700;line-height:1.05;white-space:nowrap;vertical-align:middle;
        box-shadow:0 0 8px rgba(0,240,255,.14),inset 0 0 6px rgba(0,240,255,.05)
      }
      #trainInfo .lb-lux-arrival-track::before{content:"Voie ";margin-right:2px;font-size:.82em;font-weight:600;opacity:.88}
    `;
    document.head.appendChild(style);
  }

  function getLuxembourgArrivalTableContext() {
    const table = document.querySelector("#trainInfo .table-scroll table");
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelector("td:first-child"));
    if (!rows.length) return null;

    const luxRow = rows.find((row) => {
      const firstCell = row.querySelector("td:first-child");
      const label = firstCell?.querySelector("a.gare-link")?.textContent || firstCell?.textContent || "";
      return canonicalStationName(label).startsWith("luxembourg");
    });
    if (!luxRow) return null;

    return { table, luxRow, isArrivalLayout: rows[rows.length - 1] === luxRow };
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

    for (let i = 1; i < cells.length; i += 1) {
      const cell = cells[i];
      const header = headers[i];
      if (!cell || !header) continue;

      const train = extractTrainNumberCandidate(header.textContent || "");
      const hasTime = /\b\d{1,2}:\d{2}\b/.test(cell.textContent || "");
      const existing = cell.querySelector(".lb-lux-arrival-track");
      if (!train || !hasTime) {
        existing?.remove();
        continue;
      }

      const track = findLuxembourgArrivalTrack(train);
      if (!track) {
        existing?.remove();
        continue;
      }

      if (existing) {
        existing.dataset.track = track;
        existing.textContent = track;
        existing.title = `Voie ${track} à l'arrivée à Luxembourg`;
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
        renderLuxembourgArrivalTracks();
      } catch (_) {}
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
      } catch (_) {}
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
      scroller.setAttribute("aria-label", "Tableau des trains, défilement horizontal et vertical");
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
    document.documentElement.style.setProperty("--lb-secondary-bar-height", `${Math.max(tableHeight, funHeight)}px`);
  }

  function watchSecondaryNavigation() {
    const targets = [document.getElementById("tableauViewNav"), document.getElementById("loisirsViewNav")].filter(Boolean);
    const observer = new MutationObserver(syncSecondaryNavigation);
    targets.forEach((target) => observer.observe(target, {
      attributes: true,
      attributeFilter: ["class", "hidden", "style"]
    }));
    syncSecondaryNavigation();
  }

  function watchTrainTable() {
    const host = document.getElementById("trainInfo");
    if (!host) return;
    enhanceTrainTable();
    new MutationObserver(enhanceTrainTable).observe(host, { childList: true, subtree: true });
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
    window.addEventListener("focusout", () => window.setTimeout(syncViewport, 50), { passive: true });
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
