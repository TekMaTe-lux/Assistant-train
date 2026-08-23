/*
 * La Bétaillère — contrôleur mobile v4.
 * Mesures de viewport PWA, clavier mobile et amélioration du tableau.
 */
(function () {
  "use strict";

  const mobileQuery = window.matchMedia(
    "(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px)"
  );

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

  /*
   * Pont Gare de Luxembourg -> fiche train existante.
   *
   * Le plan dynamique est servi depuis vps.labetaillere.fr et ne peut donc pas
   * appeler directement les fonctions de la page principale (origine différente).
   * Il envoie un postMessage LB_OPEN_TRAIN_SHEET. Ce pont transforme la demande
   * en clic vers le mécanisme de fiche déjà présent dans index.html, sans dupliquer
   * le moteur métier de la fiche.
   */
  const LUX_BRIDGE_ALLOWED_ORIGINS = new Set([
    window.location.origin,
    "https://vps.labetaillere.fr"
  ]);
  const LUX_CONTEXT_KEY = "lb:lux-station-context:v1";

  function normalizeBridgeTrainNumber(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    const compact = raw.replace(/^(?:TER|TGV|IC|RB|RE)\s*/i, "").replace(/\s+/g, "");
    return compact.replace(/[^0-9A-Z_-]/g, "");
  }

  function safeBridgeText(value, max = 80) {
    return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
  }

  function normalizeLuxContext(input, trainNumber) {
    const ctx = input && typeof input === "object" ? input : {};
    const station = safeBridgeText(ctx.station || "Luxembourg", 60) || "Luxembourg";
    const arrival = ctx.arrival && typeof ctx.arrival === "object" ? ctx.arrival : {};
    const departure = ctx.departure && typeof ctx.departure === "object" ? ctx.departure : {};
    const nextCourse = ctx.nextCourse && typeof ctx.nextCourse === "object" ? ctx.nextCourse : null;
    return {
      trainNumber,
      station,
      track: safeBridgeText(ctx.track || ctx.platform || "", 20),
      sector: safeBridgeText(ctx.sector || "", 20),
      state: safeBridgeText(ctx.state || ctx.status || "", 40),
      arrival: {
        scheduled: safeBridgeText(arrival.scheduled || arrival.time || "", 16),
        realtime: safeBridgeText(arrival.realtime || arrival.actual || "", 16),
        delayMin: Number.isFinite(Number(arrival.delayMin)) ? Number(arrival.delayMin) : null,
        origin: safeBridgeText(arrival.origin || ctx.origin || "", 80)
      },
      departure: {
        scheduled: safeBridgeText(departure.scheduled || departure.time || "", 16),
        realtime: safeBridgeText(departure.realtime || departure.actual || "", 16),
        delayMin: Number.isFinite(Number(departure.delayMin)) ? Number(departure.delayMin) : null,
        destination: safeBridgeText(departure.destination || ctx.destination || "", 80)
      },
      nextCourse: nextCourse ? {
        trainNumber: normalizeBridgeTrainNumber(nextCourse.trainNumber || nextCourse.number || ""),
        destination: safeBridgeText(nextCourse.destination || "", 80),
        departure: safeBridgeText(nextCourse.departure || nextCourse.time || "", 16)
      } : null,
      updatedAt: Date.now()
    };
  }

  function writeLuxContext(context) {
    try {
      sessionStorage.setItem(LUX_CONTEXT_KEY, JSON.stringify(context));
    } catch (_) {}
  }

  function readLuxContext(trainNumber) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(LUX_CONTEXT_KEY) || "null");
      if (!parsed || parsed.trainNumber !== trainNumber) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function formatBridgeTime(data) {
    if (!data || typeof data !== "object") return "—";
    const planned = safeBridgeText(data.scheduled || "", 16);
    const realtime = safeBridgeText(data.realtime || "", 16);
    if (realtime && planned && realtime !== planned) return `${planned} → ${realtime}`;
    return realtime || planned || "—";
  }

  function ensureLuxContextStyle() {
    if (document.getElementById("lbLuxStationContextStyle")) return;
    const style = document.createElement("style");
    style.id = "lbLuxStationContextStyle";
    style.textContent = `
      #lbLuxStationContext{margin:12px 0 14px;padding:11px 12px;border:1px solid rgba(40,229,212,.28);border-radius:9px;background:linear-gradient(135deg,rgba(40,229,212,.07),rgba(6,17,24,.78));color:#eafcff;font-family:Rajdhani,Arial,sans-serif}
      #lbLuxStationContext .lb-luxctx-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:#7cf3e8;font:800 .72rem/1 Orbitron,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
      #lbLuxStationContext .lb-luxctx-live{display:inline-flex;align-items:center;gap:5px;color:#4ade80;font-size:.62rem;white-space:nowrap}
      #lbLuxStationContext .lb-luxctx-live::before{content:"";width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80}
      #lbLuxStationContext .lb-luxctx-grid{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch}
      #lbLuxStationContext .lb-luxctx-card{min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.08);border-radius:7px;background:rgba(2,12,18,.48)}
      #lbLuxStationContext .lb-luxctx-card small{display:block;margin-bottom:3px;color:#84a4ad;font-size:.66rem;text-transform:uppercase;letter-spacing:.08em}
      #lbLuxStationContext .lb-luxctx-card strong{display:block;color:#fff;font-size:1rem;line-height:1.05}
      #lbLuxStationContext .lb-luxctx-card span{display:block;margin-top:3px;color:#b6d1d7;font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #lbLuxStationContext .lb-luxctx-platform{display:flex;min-width:54px;flex-direction:column;align-items:center;justify-content:center;padding:7px;border:1px solid rgba(40,229,212,.35);border-radius:7px;background:rgba(40,229,212,.08)}
      #lbLuxStationContext .lb-luxctx-platform small{color:#84a4ad;font-size:.58rem;text-transform:uppercase}
      #lbLuxStationContext .lb-luxctx-platform strong{color:#7cf3e8;font:800 1.05rem/1 Orbitron,Arial,sans-serif}
      #lbLuxStationContext .lb-luxctx-turnback{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);color:#cfe8ed;font-size:.76rem}
      @media(max-width:560px){#lbLuxStationContext .lb-luxctx-grid{grid-template-columns:1fr 58px 1fr;gap:6px}#lbLuxStationContext{padding:9px}#lbLuxStationContext .lb-luxctx-card{padding:7px}#lbLuxStationContext .lb-luxctx-card strong{font-size:.9rem}}
    `;
    document.head.append(style);
  }

  function renderLuxContext(trainNumber) {
    const ctx = readLuxContext(trainNumber);
    const modal = document.getElementById("lbTrainDetailModal");
    const route = document.getElementById("lbTrainDetailRoute");
    if (!ctx || !modal || !route) return false;
    ensureLuxContextStyle();

    let host = document.getElementById("lbLuxStationContext");
    if (!host) {
      host = document.createElement("section");
      host.id = "lbLuxStationContext";
      route.insertAdjacentElement("afterend", host);
    }

    const platform = [ctx.track, ctx.sector].filter(Boolean).join(" ") || "—";
    const arrivalLabel = formatBridgeTime(ctx.arrival);
    const departureLabel = formatBridgeTime(ctx.departure);
    const origin = ctx.arrival?.origin || "—";
    const destination = ctx.departure?.destination || "—";
    const next = ctx.nextCourse?.trainNumber
      ? `<div class="lb-luxctx-turnback">↻ Course suivante : <strong>${safeBridgeText(ctx.nextCourse.trainNumber, 18)}</strong>${ctx.nextCourse.destination ? ` vers ${safeBridgeText(ctx.nextCourse.destination, 80)}` : ""}${ctx.nextCourse.departure ? ` · ${safeBridgeText(ctx.nextCourse.departure, 16)}` : ""}</div>`
      : "";

    host.innerHTML = `
      <div class="lb-luxctx-head"><span>${safeBridgeText(ctx.station, 60)} · passage en gare</span><span class="lb-luxctx-live">LIVE</span></div>
      <div class="lb-luxctx-grid">
        <div class="lb-luxctx-card"><small>Arrivée</small><strong>${arrivalLabel}</strong><span>${safeBridgeText(origin, 80)}</span></div>
        <div class="lb-luxctx-platform"><small>Voie</small><strong>${safeBridgeText(platform, 20)}</strong></div>
        <div class="lb-luxctx-card"><small>Départ</small><strong>${departureLabel}</strong><span>${safeBridgeText(destination, 80)}</span></div>
      </div>${next}
    `;
    return true;
  }

  function findExistingTrainTrigger(trainNumber) {
    const candidates = Array.from(document.querySelectorAll("[data-lb-view-train], .lb-live-card[data-lb-live-train]"));
    return candidates.find((el) => {
      const value = el.getAttribute("data-lb-view-train") || el.getAttribute("data-lb-live-train") || "";
      return normalizeBridgeTrainNumber(value) === trainNumber;
    }) || null;
  }

  async function openTrainSheetFromLux(trainNumber, inputContext = {}) {
    const train = normalizeBridgeTrainNumber(trainNumber);
    if (!train) return { ok: false, reason: "missing-train-number" };

    const context = normalizeLuxContext(inputContext, train);
    writeLuxContext(context);

    let trigger = findExistingTrainTrigger(train);
    if (!trigger) {
      // Le LIVE peut être rendu à la demande. On sollicite d'abord son bouton s'il existe,
      // puis on laisse le moteur actuel remplir sa liste avant un second essai.
      const liveOpen = document.querySelector("[data-lb-community-open='lbLiveModal'], #lbOpenLiveModal, [data-lb-open-live]");
      liveOpen?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      trigger = findExistingTrainTrigger(train);
    }

    if (!trigger) {
      document.dispatchEvent(new CustomEvent("lb:train-sheet-unavailable", {
        detail: { trainNumber: train, context }
      }));
      return { ok: false, reason: "train-not-in-live-list" };
    }

    trigger.click();
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    renderLuxContext(train);
    return { ok: true };
  }

  function setupLuxStationBridge() {
    if (window.lbTrainSheet?.version === 1) return;

    const api = {
      version: 1,
      open: openTrainSheetFromLux,
      getContext(trainNumber) {
        return readLuxContext(normalizeBridgeTrainNumber(trainNumber));
      },
      renderContext(trainNumber) {
        return renderLuxContext(normalizeBridgeTrainNumber(trainNumber));
      }
    };
    window.lbTrainSheet = Object.freeze(api);

    window.addEventListener("message", async (event) => {
      if (!LUX_BRIDGE_ALLOWED_ORIGINS.has(event.origin)) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== "LB_OPEN_TRAIN_SHEET") return;
      const result = await openTrainSheetFromLux(data.trainNumber || data.train || "", data.context || data);
      try {
        event.source?.postMessage?.({
          type: "LB_OPEN_TRAIN_SHEET_RESULT",
          requestId: data.requestId || null,
          trainNumber: normalizeBridgeTrainNumber(data.trainNumber || data.train || ""),
          ...result
        }, event.origin);
      } catch (_) {}
    });

    const modal = document.getElementById("lbTrainDetailModal");
    if (modal) {
      new MutationObserver(() => {
        if (!modal.classList.contains("is-open")) return;
        const title = document.getElementById("lbTrainDetailTitle")?.textContent || "";
        const match = title.match(/(?:Fiche\s+)?(?:TER|TGV|IC|RB|RE)?\s*([0-9A-Z_-]+)/i);
        const train = normalizeBridgeTrainNumber(match?.[1] || "");
        if (train) renderLuxContext(train);
      }).observe(modal, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
    }
  }

  function init() {
    document.body.classList.add("lb-mobile-v4");
    removeCompactMoreMenu();
    watchTrainTable();
    watchSecondaryNavigation();
    syncGenerateButton();
    syncViewport();
    setupLuxStationBridge();

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
