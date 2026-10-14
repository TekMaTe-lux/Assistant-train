/* La Bétaillère — Snake / profil et classement. Aucune attribution de Meuh. */
(() => {
  "use strict";
  const ROOT = "https://vps.labetaillere.fr/api/game/snake";
  let mode = "loading";
  let profile = null;
  let ticket = null;
  let pending = null;
  let isOpen = false;
  let resumeGame = false;
  let hooks = {};
  const byId = (id) => document.getElementById(id);

  async function request(path, opts = {}) {
    const ctrl = new AbortController();
    const stop = window.setTimeout(() => ctrl.abort(), 5500);
    try {
      const response = await fetch(ROOT + path, {
        method: opts.body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        headers: opts.body ? { "Content-Type": "application/json" } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal
      });
      if (!response.ok) {
        const error = new Error("HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } finally { window.clearTimeout(stop); }
  }

  const tag = (tagName, cssName, content) => {
    const element = document.createElement(tagName);
    if (cssName) element.className = cssName;
    if (content !== undefined) element.textContent = String(content);
    return element;
  };
  const setText = (id, text) => {
    const el = byId(id);
    if (el) el.textContent = text;
  };
  function statusMessage() {
    return mode === "account"
      ? "Connecté : " + profile.pseudo + " · record du compte : " + profile.best_score
      : mode === "loading"
        ? "Vérification de ton compte…"
        : mode === "offline"
          ? "Connexion aux records indisponible. Partie locale possible."
          : "Mode invité : connecte-toi à La Bétaillère pour enregistrer ton record.";
  }
  function renderStatus() {
    setText("gameAccountStatus",statusMessage());
    const badge=byId("gameAccountBadge");
    if (badge) badge.textContent = mode === "account" ? "Record lié au compte" : "Record sur cet appareil";
  }
  async function refresh() {
    try {
      const data = await request("/me");
      profile = data;
      mode = "account";
    } catch (err) {
      profile = null;
      mode = err.status === 401 ? "guest" : "offline";
    }
    renderStatus();
    hooks.onAccountRecord?.(mode === "account" ? profile.best_score : null);
    return mode;
  }
  let ready = null;

  function makeButton(label, className, onClick, aria) {
    const button = tag("button",className,label);
    button.type = "button";
    if (aria) button.setAttribute("aria-label",aria);
    button.addEventListener("click",onClick);
    return button;
  }

  const overlay = tag("div","overlay game-ranking-overlay");
  overlay.id="gameRankingOverlay";
  overlay.hidden=true;
  overlay.setAttribute("aria-label","Classement du Snake");
  const panel = tag("section","dialog game-ranking-dialog");
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-modal","true");
  panel.setAttribute("aria-labelledby","gameRankingTitle");
  const title = tag("h2","", "🏆 Les as du rail");
  title.id="gameRankingTitle";
  const note = tag("p","game-ranking-intro", "Classement des records des joueurs connectés · aucun Meuh attribué.");
  const mine = tag("div","game-ranking-me","");
  mine.id="gameRankingMe";
  const list = tag("ol","game-ranking-list");
  list.id="gameRankingList";
  const footer = tag("p","game-ranking-footer","");
  footer.id="gameRankingFooter";
  const close = makeButton("Fermer","dialog-button","",null);
  close.id="gameRankingClose";
  close.addEventListener("click",closeRanking);
  panel.append(title,note,mine,list,footer,close);
  overlay.append(panel);
  document.body.append(overlay);

  function closeRanking() {
    if (!isOpen) return;
    isOpen=false;
    overlay.hidden=true;
    if (resumeGame) hooks.pause?.(false);
    resumeGame=false;
    const active=byId("gameRankingOpen");
    if (active) active.focus({preventScroll:true});
  }

  function renderRanking(data) {
    list.replaceChildren();
    if (!Array.isArray(data.ranking) || !data.ranking.length) {
      const li = tag("li","game-ranking-empty","Le classement attend ses premiers conducteurs !");
      list.append(li);
    } else {
      data.ranking.forEach((entry) => {
        const li = tag("li","game-ranking-row");
        const pos = tag("span","game-ranking-rank", "#" + entry.rank);
        const pseudo = tag("span","game-ranking-name",entry.pseudo || "Bétail");
        pseudo.title = pseudo.textContent;
        const score = tag("strong","game-ranking-score",entry.best_score);
        li.append(pos,pseudo,score);
        if (data.me && entry.rank === data.me.rank) li.classList.add("is-me");
        list.append(li);
      });
    }
    mine.textContent = data.me
      ? "🐮 Ta place : #" + data.me.rank + " · " + data.me.best_score + " point(s)"
      : "Joue en étant connecté pour rejoindre le classement.";
    footer.textContent = data.total_players + " joueur(s) classé(s) · Top " + data.ranking.length;
  }
  async function openRanking() {
    if (isOpen) return;
    isOpen=true;
    resumeGame=!!hooks.isRunning?.();
    if (resumeGame) hooks.pause?.(true);
    overlay.hidden=false;
    list.replaceChildren(tag("li","game-ranking-empty","Chargement…"));
    setText("gameRankingMe","");
    setText("gameRankingFooter","");
    close.focus({preventScroll:true});
    try {
      const data = await request("/leaderboard?limit=30");
      if (isOpen) renderRanking(data);
    } catch (_) {
      if (isOpen) list.replaceChildren(tag("li","game-ranking-empty","Classement momentanément indisponible."));
    }
  }

  function init(handlers) {
    hooks=handlers || {};
    const hud=byId("gameApp")?.querySelector(".game-hud");
    if (hud) {
      const trophy=makeButton("🏆","game-ranking-trophy",openRanking,"Afficher le classement du Snake");
      trophy.id="gameRankingOpen";
      hud.prepend(trophy);
    }
    const startActions=byId("startBtn")?.parentElement;
    if (startActions) startActions.append(
      makeButton("🏆 Classement","dialog-button secondary game-ranking-action",openRanking)
    );
    const finishActions=byId("restartBtn")?.parentElement;
    if (finishActions) finishActions.append(
      makeButton("🏆 Classement","dialog-button secondary game-ranking-action",openRanking)
    );
    const status=tag("p","game-account-status");
    status.id="gameAccountStatus";
    byId("startBtn")?.closest(".dialog")?.insertBefore(status,startActions);
    const badge=tag("span","game-account-badge");
    badge.id="gameAccountBadge";
    hud?.append(badge);
    const result=tag("p","game-account-result");
    result.id="gameAccountResult";
    byId("restartBtn")?.closest(".dialog")?.insertBefore(result,finishActions);
    overlay.addEventListener("pointerdown",e=>{if(e.target===overlay)closeRanking();});
    window.addEventListener("keydown",e=>{if(isOpen&&e.key==="Escape"){e.preventDefault();closeRanking();}});
    renderStatus();
    ready = refresh();
  }

  async function beforeStart() {
    ticket=null;
    await (ready || refresh());
    // Si la session vient d'expirer, continuer le jeu sans annoncer de sauvegarde.
    if (mode!=="account") return;
    try {
      const result=await request("/start",{body:{}});
      ticket=result.ticket;
    } catch (err) {
      if (err.status===401){mode="guest";profile=null;}
      ticket=null;
      renderStatus();
      hooks.onAccountRecord?.(mode==="account"?profile.best_score:null);
    }
  }

  async function afterEnd(score) {
    const activeTicket=ticket;
    ticket=null;
    const result=byId("gameAccountResult");
    if (result) result.textContent=activeTicket?"Enregistrement du score…":statusMessage();
    if (!activeTicket) return;
    try {
      const data=await request("/finish",{body:{ticket:activeTicket,score}});
      if (mode==="account" && profile) {
        profile.best_score=data.best_score;
        profile.last_score=data.last_score;
        profile.games_played=data.games_played;
        renderStatus();
        hooks.onAccountRecord?.(data.best_score);
      }
      if (result) result.textContent="✓ Score enregistré sur ton compte · record : "+data.best_score;
    } catch (_) {
      if (result) result.textContent="Score non enregistré : connexion indisponible ou résultat refusé.";
      await refresh();
    }
  }

  window.lbSnakeAccount = {
    init,beforeStart,afterEnd,
    accountRecord:()=>mode==="account"?profile.best_score:null,
    isAccount:()=>mode==="account",
    isRankingOpen:()=>isOpen
  };
})();
