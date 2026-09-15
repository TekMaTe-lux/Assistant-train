from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: attendu 1 occurrence, trouve {count}")
    return text.replace(old, new, 1)


# index.html : retire toute la logique du mode et garde le comportement normal.
p = ROOT / "index.html"
s = p.read_text(encoding="utf-8")
old = """      const isBetailleireMode = !!(document.body && document.body.classList.contains('monde-betaillere'));
      const officialBetailleireName = (isBetailleireMode && window.LB_BETAILLERE_TRAIN_NAME)
        ? window.LB_BETAILLERE_TRAIN_NAME(num, { compact:true, fallback:'' })
        : '';
      const label = officialBetailleireName
        || (isBetailleireMode && /^\\d{4,6}$/.test(String(num || '')) ? 'Bétaillère' : '')
        || TRAIN_LABEL_REGISTRY.get(num)
        || (num.startsWith('CFL-') ? formatTrainDisplayLabel(num) : num);
      const safeNum = escapeHtml(num);
      const safeLabel = escapeHtml(label);
      const classes = ['chip-tag'];
      if (num.startsWith('CFL-')) classes.push('cfl-train');
      const officialFullBetailleireName = (isBetailleireMode && window.LB_BETAILLERE_TRAIN_NAME)
        ? window.LB_BETAILLERE_TRAIN_NAME(num, { compact:false, fallback:'' })
        : '';
      const safeTitle = escapeHtml(officialFullBetailleireName || label);
"""
new = """      const label = TRAIN_LABEL_REGISTRY.get(num)
        || (num.startsWith('CFL-') ? formatTrainDisplayLabel(num) : num);
      const safeNum = escapeHtml(num);
      const safeLabel = escapeHtml(label);
      const classes = ['chip-tag'];
      if (num.startsWith('CFL-')) classes.push('cfl-train');
      const safeTitle = escapeHtml(label);
"""
s = replace_once(s, old, new, "selection")

start = s.find("<!-- =========================================================\n     MONDE BÉTAILLÈRE V3 - couche visuelle ferme/cyberprairie")
end = s.find("<!-- =========================================================\n     PATCH V36_HOME_STABLE_NO_ANIM", start)
if start < 0 or end < 0:
    raise SystemExit(f"marqueurs mode absents: {start=} {end=}")
s = s[:start] + s[end:]

profile_re = re.compile(
    r"  function profileTrainName\(number\) \{.*?  async function ensureProfileTitle\(number\) \{.*?\n  \}\n",
    re.S,
)
m = profile_re.search(s)
if not m:
    raise SystemExit("bloc fiche train du mode introuvable")
profile_new = """  function updateProfileTitle(number) {
    const normalized = normalizeTrainNumber(number);
    const title = byId('trainDetailTitle');
    if (!title || !normalized) return;
    title.textContent = `Bétaillère ${normalized}`;
    title.title = `Bétaillère ${normalized}`;
  }

  async function ensureProfileTitle(number) {
    updateProfileTitle(number);
  }
"""
s = s[: m.start()] + profile_new + s[m.end() :]
s = s.replace(
    "Objectif : accueil stable en mode normal ET en mode Bétaillère.",
    "Objectif : accueil stable, sans animation parasite.",
)
for needle in (
    "monde-betaillere",
    "monde_betaillere",
    "LB_BETAILLERE_TRAIN_NAME",
    "LB_LOAD_BETAILLERE_TRAIN_NAMES",
):
    if needle in s:
        raise SystemExit(f"index contient encore {needle}")

# Cache-bust principal.
for old_ref, new_ref in (
    ("./assets/lb-legacy.css?v=4", "./assets/lb-legacy.css?v=5"),
    ("./assets/lb-design-system-v3.css?v=9", "./assets/lb-design-system-v3.css?v=10"),
    ("./assets/lb-mobile-v4.css?v=12", "./assets/lb-mobile-v4.css?v=14"),
):
    if old_ref not in s:
        raise SystemExit(f"reference index absente: {old_ref}")
    s = s.replace(old_ref, new_ref, 1)
p.write_text(s, encoding="utf-8")

# Supprime les exceptions :not(.monde-betaillere) devenues inutiles.
for css in (ROOT / "assets").glob("*.css"):
    t = css.read_text(encoding="utf-8")
    if ":not(.monde-betaillere)" in t:
        css.write_text(t.replace(":not(.monde-betaillere)", ""), encoding="utf-8")

# Palette alternative du design system.
p = ROOT / "assets/lb-design-system-v3.css"
s = p.read_text(encoding="utf-8")
s, n = re.subn(r"\nbody\.lb-v3\.monde-betaillere \{.*?\n\}\n", "\n", s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"palette mode retiree={n}")
p.write_text(s, encoding="utf-8")

# Positionnement mobile de l'ancien bouton.
p = ROOT / "assets/lb-mobile-v4-base.css"
s = p.read_text(encoding="utf-8")
s, n = re.subn(
    r"\n\s*/\* Le bouton Mode Bétail ne masque plus les actions du tableau\. \*/\n\s*body\.lb-v3 #monde-betaillere-btn \{.*?\n\s*\}\n",
    "\n",
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"style bouton retire={n}")
p.write_text(s, encoding="utf-8")

# Gros historique CSS du thème : suppression par marqueurs stables.
p = ROOT / "assets/lb-legacy.css"
s = p.read_text(encoding="utf-8")
for i, pattern in enumerate(
    (
        r"\nbody\.monde-betaillere \.lb-live-card \.lb-live-compo-top\{.*?\n\}\n/\* FIX Tableau : liens de gares en mode Bétaillère, plus de bleu Tron \*/\nbody\.monde-betaillere #trainInfo a\.gare-link\{.*?\n\}\nbody\.monde-betaillere #trainInfo a\.gare-link:hover,\nbody\.monde-betaillere #trainInfo a\.gare-link:focus-visible\{.*?\n\}\n",
        r"\nbody\.monde-betaillere \.lb-compo-icon\{.*?\n\}\nbody\.monde-betaillere #homeFavSlot \.home-fav-badge \.fav-state-badge\{.*?\n\}\n",
    ),
    1,
):
    s, n = re.subn(pattern, "\n", s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"bloc legacy isole {i} retire={n}")

start_marker = "/* ===== Source historique : monde-betaillere-v3-style ===== */"
end_marker = "/* ===== Source historique : lb-v36-home-stable-no-animation ===== */"
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("marqueurs gros theme legacy absents")
s = s[:start] + s[end:]

s, n = re.subn(
    r"\n/\* En mode Bétaillère : on garde le style ferme, mais sans voile mouvant ni effet de fond dynamique sur l'accueil \*/\nbody\.page-home\.monde-betaillere #home \.home-card::after,\nbody\.page-home\.monde-betaillere #home \.command-console::after,\nbody\.page-home\.monde-betaillere #home \.lb-community-panel::after\{.*?\n\}\n",
    "\n",
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"sous-bloc V36 retire={n}")

v46 = "/* ===== Source historique : lb-v46-fix-horaires-supprimes-betail ===== */"
v63 = "/* ===== Source historique : lb-fix-terminal-arrival-newstart-v63 ===== */"
start = s.find(v46)
end = s.find(v63, start)
if start < 0 or end < 0:
    raise SystemExit("marqueurs V46/V47 absents")
s = s[:start] + s[end:]

s, n = re.subn(
    r"\n/\* Même en mode Bétaillère : ce cas reste une nouvelle arrivée, pas une cellule supprimée\. \*/\nbody\.monde-betaillere #trainInfo \.terminal-arrival-cell,\nbody\.monde-betaillere #trainInfo td\[data-terminal-arrival=\"1\"\]\{.*?\n\}\n\nbody\.monde-betaillere #trainInfo \.terminal-arrival-cell \.new-start,\nbody\.monde-betaillere #trainInfo td\[data-terminal-arrival=\"1\"\] \.new-start,\nbody\.monde-betaillere #trainInfo \.terminal-arrival-time\{.*?\n\}\n",
    "\n",
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"sous-bloc V63 retire={n}")

s, n = re.subn(
    r"\nbody\.monde-betaillere #trainInfo td\.terminal-arrival-cell,\nbody\.monde-betaillere #trainInfo td\[data-terminal-arrival=\"1\"\]\{.*?\n\}\n",
    "\n",
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"sous-bloc V64 retire={n}")
s = s.replace(
    "/* Verrou final: en mode normal comme en mode Bétaillère, une cellule terminal-arrival reste bleu texte. */",
    "/* Verrou final : une cellule terminal-arrival reste en texte bleu. */",
)
s, n = re.subn(
    r"\n\s*/\* Le thème Bétaillère garde ses couleurs, avec la même échelle de bureau\. \*/\n\s*body\.page-home\.monde-betaillere #home \.home-card h2,\n\s*body\.page-home\.monde-betaillere #home \.live-wall-title\{.*?\n\s*\}\n",
    "\n",
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"sous-bloc desktop tardif retire={n}")
s = s.replace(
    "/* V25 — Compositions visibles en LIVE, accueil favoris et page Mes bêtes, en mode Tron comme en mode Bétaillère */",
    "/* V25 — Compositions visibles en LIVE, accueil favoris et page Mes bêtes. */",
)
if "monde-betaillere" in s or "#monde-betaillere-btn" in s:
    leftovers = [
        (i, line)
        for i, line in enumerate(s.splitlines(), 1)
        if "monde-betaillere" in line or "#monde-betaillere-btn" in line
    ]
    raise SystemExit(f"legacy contient encore: {leftovers[:20]}")
p.write_text(s, encoding="utf-8")

# Versions des imports CSS réellement chargés.
p = ROOT / "assets/lb-mobile-v4.css"
s = p.read_text(encoding="utf-8")
for old_ref, new_ref in (
    ('@import url("./lb-mobile-v4-base.css");', '@import url("./lb-mobile-v4-base.css?v=2");'),
    ('@import url("./lb-home-network-unified-v1.css?v=3");', '@import url("./lb-home-network-unified-v1.css?v=4");'),
    ('@import url("./lb-home-mobile-compact-v8.css?v=4");', '@import url("./lb-home-mobile-compact-v8.css?v=5");'),
):
    if old_ref not in s:
        raise SystemExit(f"import absent: {old_ref}")
    s = s.replace(old_ref, new_ref, 1)
p.write_text(s, encoding="utf-8")

for rel, old_ref, new_ref in (
    ("assets/lb-home-mobile-compact-v8.css", "lb-home-mobile-compact-v6.css?v=1", "lb-home-mobile-compact-v6.css?v=2"),
    ("assets/lb-home-mobile-compact-v6.css", "lb-home-mobile-compact-v5.css?v=1", "lb-home-mobile-compact-v5.css?v=2"),
    ("assets/lb-home-mobile-compact-v5.css", "lb-home-mobile-compact-v4.css?v=1", "lb-home-mobile-compact-v4.css?v=2"),
    ("assets/lb-home-mobile-compact-v4.css", "lb-home-mobile-compact-v3.css?v=1", "lb-home-mobile-compact-v3.css?v=2"),
    ("assets/lb-home-mobile-compact-v3.css", "lb-home-mobile-compact-v2.css?v=1", "lb-home-mobile-compact-v2.css?v=2"),
    ("assets/lb-home-mobile-compact-v2.css", "lb-home-mobile-compact-v1.css?v=1", "lb-home-mobile-compact-v1.css?v=2"),
):
    f = ROOT / rel
    t = f.read_text(encoding="utf-8")
    if old_ref not in t:
        raise SystemExit(f"import absent dans {rel}: {old_ref}")
    f.write_text(t.replace(old_ref, new_ref, 1), encoding="utf-8")

# PWA : nouveau cache afin d'évacuer les anciens CSS du mode.
p = ROOT / "service-worker.js"
s = p.read_text(encoding="utf-8")
for old_ref, new_ref in (
    ("const CACHE_VERSION = 'v45';", "const CACHE_VERSION = 'v46';"),
    ("'./assets/lb-legacy.css?v=4'", "'./assets/lb-legacy.css?v=5'"),
    ("'./assets/lb-design-system-v3.css?v=9'", "'./assets/lb-design-system-v3.css?v=10'"),
    ("'./assets/lb-mobile-v4.css?v=13'", "'./assets/lb-mobile-v4.css?v=14'"),
):
    if old_ref not in s:
        raise SystemExit(f"reference SW absente: {old_ref}")
    s = s.replace(old_ref, new_ref, 1)
p.write_text(s, encoding="utf-8")

# Le JSON ne servait qu'au mode supprimé.
mode_json = ROOT / "monde_betaillere_trains.json"
if mode_json.exists():
    mode_json.unlink()

# Vérification finale des sources actives.
active = [ROOT / "index.html", ROOT / "service-worker.js"]
active += list((ROOT / "assets").glob("*.css"))
active += list((ROOT / "assets").glob("*.js"))
active += list((ROOT / "config").glob("*.js"))
left = []
for f in active:
    t = f.read_text(encoding="utf-8", errors="ignore")
    for needle in ("monde-betaillere", "#monde-betaillere-btn"):
        if needle in t:
            left.append((str(f.relative_to(ROOT)), needle))
if left:
    raise SystemExit(f"references actives restantes: {left[:40]}")

print("Mode Bétail supprimé et CSS simplifié")
