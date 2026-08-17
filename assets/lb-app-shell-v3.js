/*
 * La Bétaillère — App shell v3
 * Améliorations d'interface uniquement : aucune donnée ni API métier modifiée.
 */
(function () {
  "use strict";

  const config = window.LB_TERRITORY_CONFIG || {};
  const pageConfig = config.pages || {};
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const pageAliases = {
    home: "home",
    search: "search",
    carte: "carte",
    affluence: "carte",
    favoris: "favoris",
    favtrainswidget: "favoris",
    stats: "stats",
    statsconsole: "stats",
    loisirs: "loisirs",
    divertissement: "loisirs",
    multimedia: "loisirs"
  };

  function currentPage() {
    const hash = String(location.hash || "#home").replace(/^#/, "").toLowerCase();
    return pageAliases[hash] || "home";
  }

  function iconMarkup(symbol) {
    return `<span aria-hidden="true">${symbol}</span>`;
  }

  function ensureSkipLink() {
    if (qs(".lb-skip-link")) return;
    const link = document.createElement("a");
    link.className = "lb-skip-link";
    link.href = `#${currentPage()}`;
    link.textContent = "Aller au contenu";
    document.body.prepend(link);
  }

  function ensureToastRegion() {
    let region = qs("#lbToastRegion");
    if (region) return region;
    region = document.createElement("div");
    region.id = "lbToastRegion";
    region.className = "lb-toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.append(region);
    return region;
  }

  function toast(message, timeout = 3200) {
    const region = ensureToastRegion();
    const item = document.createElement("div");
    item.className = "lb-toast";
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), timeout);
  }

  function enhanceHeader() {
    const brand = qs(".top-bar__brand");
    if (brand && brand.dataset.lbHomeLinkReady !== "1") {
      brand.dataset.lbHomeLinkReady = "1";
      brand.setAttribute("role", "link");
      brand.setAttribute("tabindex", "0");
      brand.setAttribute("aria-label", "Retour à l’accueil");
      brand.style.cursor = "pointer";

      const goHome = () => {
        window.location.href = "./index.html#home";
      };

      brand.addEventListener("click", goHome);
      brand.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        goHome();
      });
    }

    const actions = qs(".top-bar__actions");
    if (!actions) return;

    if (!qs("#lbNetworkStatus")) {
      const status = document.createElement("div");
      status.id = "lbNetworkStatus";
      status.className = "lb-header-status";
      status.setAttribute("role", "status");
      status.innerHTML = "<span>Connecté</span>";
      actions.prepend(status);
    }

    if (!qs("#lbHeaderAccountBtn")) {
      const account = document.createElement("button");
      account.id = "lbHeaderAccountBtn";
      account.className = "lb-header-account";
      account.type = "button";
      account.setAttribute("aria-label", "Ouvrir mon compte");
      account.innerHTML = '<img src="./ber_icons_pack/compte.svg" alt="" aria-hidden="true">';
      account.addEventListener("click", () => qs("#bottomAccountBtn")?.click());
      actions.append(account);
    }
  }

  function updateNetworkState({ announce = false } = {}) {
    const status = qs("#lbNetworkStatus");
    if (!status) return;
    const online = navigator.onLine;
    status.classList.toggle("is-offline", !online);
    status.innerHTML = `<span>${online ? "Connecté" : "Hors ligne"}</span>`;
    status.setAttribute(
      "aria-label",
      online ? "Connexion internet disponible" : "Mode hors ligne"
    );
    if (announce) {
      toast(online ? "Connexion rétablie — données actualisées." : "Mode hors ligne — dernière version disponible.");
    }
  }

  function buildPageIntro(targetSelector, page, actions = []) {
    const target = qs(targetSelector);
    const info = pageConfig[page];
    if (!target || !info || qs(`.lb-page-intro[data-lb-page="${page}"]`, target)) return;

    const intro = document.createElement("header");
    intro.className = "lb-page-intro";
    intro.dataset.lbPage = page;

    const links = actions
      .map(
        (action) =>
          `<a class="lb-context-link" href="${action.href}" aria-label="${action.label}">${iconMarkup(
            action.icon
          )}<span>${action.label}</span></a>`
      )
      .join("");

    intro.innerHTML = `
      <div class="lb-page-intro__copy">
        <div class="lb-page-intro__eyebrow">${info.eyebrow || config.shortTerritory || "La Bétaillère"}</div>
        <h1>${info.title}</h1>
        <p>${info.description || ""}</p>
      </div>
      ${links ? `<nav class="lb-page-intro__actions" aria-label="Raccourcis">${links}</nav>` : ""}
    `;
    target.prepend(intro);
  }

  function enhancePages() {
    buildPageIntro("#search", "search", [
      { href: "#favoris", label: "Mes trains", icon: "☆" },
      { href: "#carte", label: "Carte", icon: "◎" }
    ]);
    buildPageIntro("#carte", "carte", [
      { href: "#search", label: "Rechercher", icon: "⌕" }
    ]);
    buildPageIntro("#favTrainsWidget", "favoris", [
      { href: "#search", label: "Rechercher", icon: "⌕" }
    ]);
    buildPageIntro("#stats", "stats", [
      { href: "#search", label: "Une bétaillère", icon: "⌕" }
    ]);
    buildPageIntro("#multimedia", "loisirs", [
      { href: "#home", label: "Accueil", icon: "⌂" }
    ]);
  }

  function enhanceSearchModes() {
    const select = qs("#tableauModeSelect");
    const selector = qs("#tableauSelector");
    if (!select || qs("#lbSearchModes")) return;

    const labels = {
      quick: { icon: "▦", text: "Tableau rapide" },
      train: { icon: "→", text: "Une bétaillère" },
      advanced: { icon: "⌕", text: "Un trajet" }
    };
    const group = document.createElement("div");
    group.id = "lbSearchModes";
    group.className = "lb-search-modes";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Choisir un type de recherche");

    Object.entries(labels).forEach(([value, item]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lb-search-mode";
      button.dataset.value = value;
      button.innerHTML = `${iconMarkup(item.icon)}<span>${item.text}</span>`;
      button.addEventListener("click", () => {
        if (select.value !== value) {
          select.value = value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        sync();
      });
      group.append(button);
    });

    function sync() {
      const safe = ["quick", "train", "advanced"].includes(select.value)
        ? select.value
        : "quick";
      if (select.value !== safe) select.value = safe;
      if (selector) selector.dataset.searchMode = safe;
      qsa(".lb-search-mode", group).forEach((button) => {
        const active = button.dataset.value === safe;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    select.classList.add("lb-mode-select-enhanced");
    select.insertAdjacentElement("afterend", group);
    select.addEventListener("input", sync);
    select.addEventListener("change", sync);
    sync();
  }

  function buildMoreNavigation() {
    const navItems = qs(".bottom-nav__items");
    if (!navItems || qs("#lbMoreNavButton")) return;

    const more = document.createElement("button");
    more.id = "lbMoreNavButton";
    more.className = "bottom-nav__item";
    more.type = "button";
    more.hidden = false;
    more.innerHTML = `
      <span class="bottom-nav__icon" aria-hidden="true">•••</span>
      <span class="bottom-nav__label">Plus</span>
    `;
    navItems.append(more);

    const sheet = document.createElement("div");
    sheet.id = "lbMoreSheet";
    sheet.className = "lb-more-sheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "lbMoreSheetTitle");
    sheet.innerHTML = `
      <div class="lb-more-sheet__panel">
        <div class="lb-more-sheet__head">
          <span id="lbMoreSheetTitle">Plus de La Bétaillère</span>
          <button class="lb-more-sheet__close" type="button">Fermer</button>
        </div>
        <button class="lb-more-sheet__item" type="button" data-lb-proxy="#stats">
          <span class="lb-more-sheet__icon" aria-hidden="true">▥</span>
          <span>Statistiques<small>Fiabilité, retards et comparaisons</small></span>
        </button>
        <button class="lb-more-sheet__item" type="button" data-lb-proxy="#loisirs">
          <span class="lb-more-sheet__icon" aria-hidden="true">♬</span>
          <span>Fun<small>Vidéos, bingo et jeux BER</small></span>
        </button>
        <button class="lb-more-sheet__item" type="button" data-lb-account>
          <span class="lb-more-sheet__icon" aria-hidden="true">♙</span>
          <span>Mon compte<small>Préférences, favoris et alertes</small></span>
        </button>
        <button class="lb-more-sheet__item" type="button" data-lb-install hidden>
          <span class="lb-more-sheet__icon" aria-hidden="true">⇩</span>
          <span>Installer l’application<small>Accès rapide depuis l’écran d’accueil</small></span>
        </button>
      </div>
    `;
    document.body.append(sheet);

    let previousFocus = null;

    function open() {
      previousFocus = document.activeElement;
      sheet.hidden = false;
      document.body.classList.add("lb-sheet-open");
      more.setAttribute("aria-expanded", "true");
      qs(".lb-more-sheet__close", sheet)?.focus();
    }

    function close() {
      sheet.hidden = true;
      document.body.classList.remove("lb-sheet-open");
      more.setAttribute("aria-expanded", "false");
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    }

    more.setAttribute("aria-haspopup", "dialog");
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", open);
    qs(".lb-more-sheet__close", sheet)?.addEventListener("click", close);
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) close();
    });
    qsa("[data-lb-proxy]", sheet).forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.lbProxy;
        close();
        const source = qs(`.bottom-nav__item[href="${target}"]`);
        if (source) source.click();
        else location.hash = target;
      });
    });
    qs("[data-lb-account]", sheet)?.addEventListener("click", () => {
      close();
      qs("#bottomAccountBtn")?.click();
    });
    document.addEventListener("keydown", (event) => {
      if (sheet.hidden) return;
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = qsa('button:not([hidden]):not([disabled]), a[href]', sheet);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    function syncMoreState() {
      const active = ["stats", "loisirs"].includes(currentPage());
      more.classList.toggle("active", active);
      more.setAttribute("aria-current", active ? "page" : "false");
    }

    window.addEventListener("hashchange", syncMoreState);
    syncMoreState();
  }

  function setupInstallExperience() {
    const installButton = qs("[data-lb-install]");
    if (!installButton) return;

    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let deferredPrompt = null;

    if (isIos) {
      installButton.hidden = false;
      installButton.addEventListener("click", () => {
        qs(".lb-more-sheet__close")?.click();
        toast("Sur iPhone : touchez Partager, puis « Sur l’écran d’accueil ».", 6500);
      });
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      installButton.hidden = false;
    });

    if (!isIos) {
      installButton.addEventListener("click", async () => {
        if (!deferredPrompt) return;
        qs(".lb-more-sheet__close")?.click();
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice.catch(() => null);
        if (choice?.outcome === "accepted") toast("Installation lancée.");
        deferredPrompt = null;
        installButton.hidden = true;
      });
    }

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      installButton.hidden = true;
      toast("La Bétaillère est installée.");
    });
  }

  function syncDocumentContext() {
    const page = currentPage();
    const info = pageConfig[page];
    const brand = config.brand || "La Bétaillère";
    document.title = info?.title ? `${info.title} · ${brand}` : brand;
    const skip = qs(".lb-skip-link");
    if (skip) skip.href = `#${page}`;
  }

  function improveNavigationState() {
    function sync() {
      const page = currentPage();
      qsa(".bottom-nav__item[href]").forEach((item) => {
        const target = pageAliases[String(item.hash || "").replace(/^#/, "").toLowerCase()];
        const active = target === page;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      syncDocumentContext();
    }
    window.addEventListener("hashchange", sync);
    sync();
  }

  function syncViewportMetrics() {
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--lb-viewport-height", `${Math.round(height)}px`);
  }

  function watchPwaUpdates() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      toast("Nouvelle version installée.");
    });
    navigator.serviceWorker.ready
      .then((registration) => {
        if (registration.waiting) toast("Une mise à jour est prête. Elle sera appliquée au prochain lancement.");
      })
      .catch(() => {});
  }

  function init() {
    document.body.classList.add("lb-v3");
    ensureSkipLink();
    enhanceHeader();
    enhancePages();
    enhanceSearchModes();
    buildMoreNavigation();
    setupInstallExperience();
    improveNavigationState();
    updateNetworkState();
    syncViewportMetrics();
    watchPwaUpdates();

    window.addEventListener("online", () => updateNetworkState({ announce: true }));
    window.addEventListener("offline", () => updateNetworkState({ announce: true }));
    window.addEventListener("resize", syncViewportMetrics, { passive: true });
    window.visualViewport?.addEventListener("resize", syncViewportMetrics, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.lbAppShell = Object.freeze({ toast, currentPage });
})();