/*
 * La Bétaillère — Coeur v4
 * Couche progressive et non destructive : elle révèle mieux les données déjà
 * présentes dans l'interface sans modifier les API métier.
 */
(function () {
  "use strict";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const HOME = "#home";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function severityFromText(value) {
    const text = normalize(value);
    if (!text || text.includes("chargement")) return "loading";
    if (
      text.includes("interrompu") ||
      text.includes("tres perturbe") ||
      text.includes("supprime") ||
      text.includes("rouge")
    ) return "danger";
    if (
      text.includes("perturbe") ||
      text.includes("ralenti") ||
      text.includes("vigilance") ||
      text.includes("retard")
    ) return "warning";
    if (
      text.includes("fluide") ||
      text.includes("normal") ||
      text.includes("vert") ||
      text.includes("a l'heure")
    ) return "ok";
    return "neutral";
  }

  function trafficRows() {
    return qsa(`${HOME} .traffic-split-row`).map((row) => {
      const route = clean(qs(".traffic-split-line", row)?.textContent) || "Ligne";
      const status = clean(qs(".traffic-pill", row)?.textContent) || "Mise à jour en cours";
      return { route, status, severity: severityFromText(status) };
    });
  }

  function overallTraffic(items) {
    if (!items.length || items.every((item) => item.severity === "loading")) {
      return {
        severity: "loading",
        title: "La ligne se met à jour",
        subtitle: "Lecture des infos trafic…"
      };
    }

    if (items.some((item) => item.severity === "danger")) {
      return {
        severity: "danger",
        title: "Attention sur la ligne",
        subtitle: items.map((item) => `${item.route} : ${item.status}`).join(" · ")
      };
    }

    if (items.some((item) => item.severity === "warning")) {
      return {
        severity: "warning",
        title: "Trafic à surveiller",
        subtitle: items.map((item) => `${item.route} : ${item.status}`).join(" · ")
      };
    }

    if (items.every((item) => item.severity === "ok")) {
      return {
        severity: "ok",
        title: "La ligne respire",
        subtitle: items.map((item) => `${item.route} : ${item.status}`).join(" · ")
      };
    }

    return {
      severity: "neutral",
      title: "Situation de la ligne",
      subtitle: items.map((item) => `${item.route} : ${item.status}`).join(" · ")
    };
  }

  function timeLabel() {
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date());
    } catch (_) {
      return "maintenant";
    }
  }

  function explicitGuestState() {
    const favoriteCard = qs(`${HOME} .home-card[aria-label="Mes Bétaillères favorites"]`);
    if (!favoriteCard) return false;

    const hasRealFavorite = qsa(".home-fav-row", favoriteCard).some((row) => /\b\d{5}\b/.test(clean(row.textContent)));
    if (hasRealFavorite) return false;

    const favoriteText = normalize(favoriteCard.textContent);
    return (
      favoriteText.includes("connecte-toi") ||
      favoriteText.includes("connectez-vous") ||
      favoriteText.includes("se connecter")
    );
  }

  function proxyCommunityAction(keyword) {
    const voice = qs(`${HOME} .live-wall-card--home`) || qs(`${HOME} [aria-label*="Voix"]`);
    if (!voice) return false;
    const needle = normalize(keyword);
    const control = qsa("button, a", voice).find((candidate) => normalize(candidate.textContent).includes(needle));
    if (!control) return false;
    control.click();
    return true;
  }

  function go(hash, after) {
    if (location.hash !== hash) location.hash = hash;
    window.setTimeout(() => {
      if (typeof after === "function") after();
    }, 90);
  }

  async function shareBrief() {
    const items = trafficRows();
    const summary = overallTraffic(items);
    const details = items.length
      ? items.map((item) => `${item.route} : ${item.status}`).join(" · ")
      : summary.subtitle;
    const text = `La Bétaillère — ${summary.title}. ${details}`;
    const url = `${location.origin}${location.pathname}#home`;

    try {
      if (navigator.share) {
        await navigator.share({ title: "La Bétaillère", text, url });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        window.lbAppShell?.toast?.("Brief de la ligne copié.");
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    window.lbAppShell?.toast?.("Partage indisponible sur ce navigateur.");
  }

  function renderBriefSheet() {
    const host = qs("#lbCoreSheetStatus");
    if (!host) return;

    const items = trafficRows();
    const summary = overallTraffic(items);
    host.replaceChildren();

    const summaryNode = document.createElement("div");
    summaryNode.className = `lb-core-sheet__summary is-${summary.severity}`;
    summaryNode.innerHTML = '<span class="lb-core-status-dot" aria-hidden="true"></span>';

    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = summary.title;
    const small = document.createElement("small");
    small.textContent = `Lecture ${timeLabel()}`;
    copy.append(strong, small);
    summaryNode.append(copy);
    host.append(summaryNode);

    const list = document.createElement("div");
    list.className = "lb-core-sheet__routes";
    const safeItems = items.length
      ? items
      : [{ route: "Nancy · Metz · Luxembourg", status: "Mise à jour en cours", severity: "loading" }];

    safeItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = `lb-core-route is-${item.severity}`;
      const route = document.createElement("span");
      route.textContent = item.route;
      const status = document.createElement("strong");
      status.textContent = item.status;
      row.append(route, status);
      list.append(row);
    });
    host.append(list);
  }

  function createBriefSheet() {
    let sheet = qs("#lbCoreBriefSheet");
    if (sheet) return sheet;

    sheet = document.createElement("div");
    sheet.id = "lbCoreBriefSheet";
    sheet.className = "lb-core-sheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "lbCoreSheetTitle");
    sheet.innerHTML = `
      <div class="lb-core-sheet__backdrop" data-lb-core-close></div>
      <section class="lb-core-sheet__panel" tabindex="-1">
        <header class="lb-core-sheet__head">
          <div>
            <span class="lb-core-sheet__eyebrow">LE BRIEF BER</span>
            <h2 id="lbCoreSheetTitle">La ligne maintenant</h2>
          </div>
          <button type="button" class="lb-core-sheet__close" data-lb-core-close aria-label="Fermer">×</button>
        </header>
        <div class="lb-core-sheet__status" id="lbCoreSheetStatus"></div>
        <div class="lb-core-sheet__actions" aria-label="Actions rapides">
          <button type="button" data-lb-core-action="favorites"><span>★</span><b>Mes trains</b><small>favoris & état réel</small></button>
          <button type="button" data-lb-core-action="report"><span>⚡</span><b>Signaler</b><small>aider en quelques secondes</small></button>
          <button type="button" data-lb-core-action="map"><span>◎</span><b>Carte live</b><small>voir ce qui roule</small></button>
          <button type="button" data-lb-core-action="share"><span>↗</span><b>Partager</b><small>envoyer le brief</small></button>
        </div>
        <p class="lb-core-sheet__source">Synthèse des informations déjà affichées par La Bétaillère. Les canaux officiels SNCF/CFL restent prioritaires.</p>
      </section>
    `;
    document.body.append(sheet);

    let previousFocus = null;
    const panel = qs(".lb-core-sheet__panel", sheet);

    function close() {
      sheet.hidden = true;
      document.body.classList.remove("lb-core-sheet-open");
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    }

    function open() {
      previousFocus = document.activeElement;
      renderBriefSheet();
      sheet.hidden = false;
      document.body.classList.add("lb-core-sheet-open");
      window.requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    }

    qsa("[data-lb-core-close]", sheet).forEach((element) => element.addEventListener("click", close));
    qs('[data-lb-core-action="favorites"]', sheet)?.addEventListener("click", () => {
      close();
      go("#favoris");
    });
    qs('[data-lb-core-action="report"]', sheet)?.addEventListener("click", () => {
      close();
      go("#home", () => {
        if (!proxyCommunityAction("signaler")) {
          qs(`${HOME} .live-wall-card--home`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
    qs('[data-lb-core-action="map"]', sheet)?.addEventListener("click", () => {
      close();
      go("#carte");
    });
    qs('[data-lb-core-action="share"]', sheet)?.addEventListener("click", shareBrief);

    sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = qsa('button:not([disabled]), a[href], [tabindex="0"]', panel);
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

    sheet.lbOpen = open;
    return sheet;
  }

  function ensureBrief() {
    const dashboard = qs(`${HOME} .home-dashboard`);
    if (!dashboard) return null;

    let brief = qs("#lbCoreBrief", dashboard);
    if (brief) return brief;

    const welcome = qs(".home-welcome-line", dashboard);
    if (welcome) welcome.classList.add("lb-core-welcome-superseded");

    brief = document.createElement("button");
    brief.id = "lbCoreBrief";
    brief.type = "button";
    brief.className = "lb-core-brief is-loading";
    brief.setAttribute("aria-haspopup", "dialog");
    brief.setAttribute("aria-label", "Ouvrir le brief de la ligne");
    brief.innerHTML = `
      <span class="lb-core-brief__signal" aria-hidden="true"><span class="lb-core-status-dot"></span></span>
      <span class="lb-core-brief__copy">
        <span class="lb-core-brief__kicker">LA LIGNE MAINTENANT</span>
        <strong class="lb-core-brief__title">Lecture du trafic…</strong>
        <small class="lb-core-brief__subtitle">Nancy · Metz · Luxembourg</small>
      </span>
      <span class="lb-core-brief__chevron" aria-hidden="true">›</span>
    `;

    if (welcome) welcome.insertAdjacentElement("afterend", brief);
    else dashboard.prepend(brief);
    brief.addEventListener("click", () => createBriefSheet().lbOpen?.());
    return brief;
  }

  function updateBrief() {
    const brief = ensureBrief();
    if (!brief) return;

    const summary = overallTraffic(trafficRows());
    const signature = `${summary.severity}|${summary.title}|${summary.subtitle}`;
    if (brief.dataset.state === signature) return;
    brief.dataset.state = signature;

    brief.className = `lb-core-brief is-${summary.severity}`;
    qs(".lb-core-brief__title", brief).textContent = summary.title;
    qs(".lb-core-brief__subtitle", brief).textContent = summary.subtitle;
    brief.setAttribute("aria-label", `${summary.title}. ${summary.subtitle}. Ouvrir le brief de la ligne.`);

    const sheet = qs("#lbCoreBriefSheet");
    if (sheet && !sheet.hidden) renderBriefSheet();
  }

  function enhanceGuestValue() {
    const favoriteCard = qs(`${HOME} .home-card[aria-label="Mes Bétaillères favorites"]`);
    if (!favoriteCard || !explicitGuestState() || qs(".lb-core-signup", favoriteCard)) return;

    const value = document.createElement("div");
    value.className = "lb-core-signup";
    value.innerHTML = `
      <div class="lb-core-signup__copy">
        <strong>Ta ligne, pas une appli générique.</strong>
        <span>2 trains favoris · alertes utiles · participation LIVE</span>
      </div>
      <button type="button">Personnaliser</button>
    `;
    qs("button", value)?.addEventListener("click", () => qs("#bottomAccountBtn")?.click());
    favoriteCard.append(value);
  }

  function enhanceCommunity() {
    const voice = qs(`${HOME} .live-wall-card--home`);
    if (!voice) return;
    const actions = qs(".lb-community-actions", voice);
    if (!actions) return;

    let nudge = qs(".lb-core-community-nudge", voice);
    if (!nudge) {
      nudge = document.createElement("div");
      nudge.className = "lb-core-community-nudge";
      actions.before(nudge);
    }

    const count = qsa(".live-wall-item, .live-wall-item--home", voice).length;
    const guest = explicitGuestState();
    const signature = `${guest ? "guest" : "member"}|${count}`;

    if (nudge.dataset.state !== signature) {
      nudge.dataset.state = signature;
      nudge.replaceChildren();

      const copy = document.createElement("span");
      copy.className = "lb-core-community-nudge__copy";
      const strong = document.createElement("strong");
      strong.textContent = guest ? "Le terrain, c’est vous." : "Vu quelque chose ? Dites-le au train derrière.";
      const small = document.createElement("small");
      small.textContent = guest
        ? "Un compte suffit pour signaler et confirmer les infos utiles."
        : count
          ? `${count} info${count > 1 ? "s" : ""} terrain visible${count > 1 ? "s" : ""} · un signalement prend quelques secondes.`
          : "Retard, rame bondée, clim, quai… quelques secondes suffisent.";
      copy.append(strong, small);
      nudge.append(copy);

      if (guest) {
        const join = document.createElement("button");
        join.type = "button";
        join.className = "lb-core-community-join";
        join.textContent = "Participer";
        join.addEventListener("click", () => qs("#bottomAccountBtn")?.click());
        nudge.append(join);
      }
    }

    qsa(".lb-community-btn", actions).forEach((button) => {
      const text = normalize(button.textContent);
      if (text.includes("signaler") || text.includes("a signaler")) {
        button.classList.add("lb-core-community-btn--report");
        button.setAttribute("aria-label", "Signaler une information terrain");
      } else if (text.includes("live")) {
        button.classList.add("lb-core-community-btn--live");
        button.setAttribute("aria-label", "Voir les informations live des voyageurs");
      }
    });
  }

  function ensureDiscover() {
    const dashboard = qs(`${HOME} .home-dashboard`);
    if (!dashboard || qs("#lbCoreDiscover")) return;

    const section = document.createElement("section");
    section.id = "lbCoreDiscover";
    section.className = "lb-core-discover";
    section.setAttribute("aria-labelledby", "lbCoreDiscoverTitle");
    section.innerHTML = `
      <button class="lb-core-discover__toggle" type="button" aria-expanded="false" aria-controls="lbCoreDiscoverPanel">
        <span class="lb-core-discover__icon" aria-hidden="true">⌁</span>
        <span><strong id="lbCoreDiscoverTitle">Explorer la ligne autrement</strong><small>Même pour un trajet occasionnel, un élu, un curieux ou un journaliste.</small></span>
        <span class="lb-core-discover__arrow" aria-hidden="true">›</span>
      </button>
      <div id="lbCoreDiscoverPanel" class="lb-core-discover__panel" hidden>
        <button type="button" data-lb-discover="train"><span aria-hidden="true">⌕</span><strong>Mon train est-il fiable ?</strong><small>Retrouver une bétaillère et son historique.</small></button>
        <button type="button" data-lb-discover="stats"><span aria-hidden="true">▥</span><strong>Le vrai bilan de la ligne</strong><small>Ponctualité, retards et suppressions observés.</small></button>
        <button type="button" data-lb-discover="map"><span aria-hidden="true">◎</span><strong>Qu’est-ce qui roule maintenant ?</strong><small>Ouvrir la carte en direct.</small></button>
        <button type="button" data-lb-discover="share"><span aria-hidden="true">↗</span><strong>Partager la situation</strong><small>Envoyer le brief BER autour de soi.</small></button>
      </div>
    `;
    dashboard.insertAdjacentElement("afterend", section);

    const toggle = qs(".lb-core-discover__toggle", section);
    const panel = qs("#lbCoreDiscoverPanel", section);
    toggle?.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      panel.hidden = expanded;
    });

    qs('[data-lb-discover="train"]', section)?.addEventListener("click", () => {
      go("#search", () => qs('#lbSearchModes [data-value="train"]')?.click());
    });
    qs('[data-lb-discover="stats"]', section)?.addEventListener("click", () => go("#stats"));
    qs('[data-lb-discover="map"]', section)?.addEventListener("click", () => go("#carte"));
    qs('[data-lb-discover="share"]', section)?.addEventListener("click", shareBrief);
  }

  let refreshQueued = false;
  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      updateBrief();
      enhanceGuestValue();
      enhanceCommunity();
      ensureDiscover();
    });
  }

  function observeHome() {
    const home = qs(HOME);
    if (!home) return;

    const traffic = qs('.home-card[aria-label="Info trafic"]', home);
    if (traffic) {
      new MutationObserver(refresh).observe(traffic, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const voice = qs(".live-wall-card--home", home);
    if (voice) {
      new MutationObserver(refresh).observe(voice, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function init() {
    document.body.classList.add("lb-core-v4");
    createBriefSheet();
    refresh();
    observeHome();
    window.addEventListener("hashchange", refresh, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
