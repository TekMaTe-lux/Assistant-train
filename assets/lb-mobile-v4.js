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
    const mobile = isMobileLayout();
    const label = mobile ? "Générer" : "Générer le tableau";
    if ((button.textContent || "").trim() !== label) button.textContent = label;
    button.setAttribute("aria-label", label);
    button.classList.toggle("lb-generate-mobile", mobile);
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

  function init() {
    document.body.classList.add("lb-mobile-v4");
    removeCompactMoreMenu();
    watchTrainTable();
    watchSecondaryNavigation();
    syncGenerateButton();
    syncViewport();

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
