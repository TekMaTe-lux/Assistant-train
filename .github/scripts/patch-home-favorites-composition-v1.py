from pathlib import Path

index = Path('index.html')
source = index.read_text(encoding='utf-8')

head_marker = '  <meta name="apple-mobile-web-app-title" content="La Bétaillère" />\n'
head_insert = head_marker + '  <link rel="preconnect" href="https://vps.labetaillere.fr" crossorigin>\n  <link rel="preload" href="https://vps.labetaillere.fr/gtfs/Compotrains.json" as="fetch" crossorigin>\n'
if 'rel="preload" href="https://vps.labetaillere.fr/gtfs/Compotrains.json"' not in source:
    if source.count(head_marker) != 1:
        raise SystemExit('head marker missing or not unique')
    source = source.replace(head_marker, head_insert, 1)

source = source.replace(
    './assets/lb-v4-live-preview.css?v=20260831-1',
    './assets/lb-v4-live-preview.css?v=20260831-2',
    1
)

cached_marker = '''        window.compoData = cached;
        updateCompoHeaderColors();
'''
cached_replacement = '''        window.compoData = cached;
        updateCompoHeaderColors();
        if (typeof lbRenderHomeFavPreview === 'function') lbRenderHomeFavPreview();
'''
hook = "if (typeof lbRenderHomeFavPreview === 'function') lbRenderHomeFavPreview();"
if hook not in source:
    if source.count(cached_marker) < 1:
        raise SystemExit('cached composition marker missing')
    source = source.replace(cached_marker, cached_replacement, 1)

remote_marker = '''    window.compoData = { ...(json.NancyMetzLux||{}), ...(json.LuxMetzNancy||{}) };
    lbCacheWrite('compoData', window.compoData);
    updateCompoHeaderColors();
    return window.compoData;
'''
remote_replacement = '''    window.compoData = { ...(json.NancyMetzLux||{}), ...(json.LuxMetzNancy||{}) };
    lbCacheWrite('compoData', window.compoData);
    updateCompoHeaderColors();
    if (typeof lbRenderHomeFavPreview === 'function') lbRenderHomeFavPreview();
    return window.compoData;
'''
if source.count(hook) < 2:
    if source.count(remote_marker) < 1:
        raise SystemExit('remote composition marker missing')
    source = source.replace(remote_marker, remote_replacement, 1)

badge_marker = '''    const compoBadge = (trainNumberForCompo && typeof window.buildFavTrainTypeBadge === 'function')
      ? window.buildFavTrainTypeBadge(trainNumberForCompo)
      : '';

    return `
'''
badge_replacement = '''    const compoBadge = (trainNumberForCompo && typeof window.buildFavTrainTypeBadge === 'function')
      ? window.buildFavTrainTypeBadge(trainNumberForCompo)
      : '';
    const compoDataReady = !!(window.compoData && Object.keys(window.compoData).length);
    const compoSlot = compoBadge || ((!compoDataReady && trainNumberForCompo)
      ? '<span class="home-fav-compo-loading" aria-hidden="true"><i></i></span>'
      : '');

    return `
'''
if 'const compoSlot = compoBadge ||' not in source:
    if source.count(badge_marker) < 1:
        raise SystemExit('home favorites composition badge marker missing')
    source = source.replace(badge_marker, badge_replacement, 1)

html_badge = '<div class="fav-train-badge home-fav-badge">${compoBadge}${renderBadge(data.state)}</div>'
html_badge_new = '<div class="fav-train-badge home-fav-badge">${compoSlot}${renderBadge(data.state)}</div>'
if html_badge in source:
    source = source.replace(html_badge, html_badge_new, 1)
elif html_badge_new not in source:
    raise SystemExit('home favorites badge HTML marker missing')

bg_marker = 'const LB_BG_REFRESH_STATE = { timer: null, inFlight: false };\n'
early = '''// Composition des favoris : démarrage anticipé. Le preload du <head>
// a déjà lancé le téléchargement pendant le parsing de la page.
const LB_COMPO_EARLY_PROMISE = loadCompoData({ forceFresh: false, background: true })
  .catch((err) => {
    console.warn('[COMPO] Préchargement anticipé échoué', err?.message || err);
    return null;
  });

'''
if 'const LB_COMPO_EARLY_PROMISE =' not in source:
    if source.count(bg_marker) != 1:
        raise SystemExit('background refresh marker missing or not unique')
    source = source.replace(bg_marker, early + bg_marker, 1)

load_direct = '  loadCompoData({ forceFresh: false, background: false });\n'
if load_direct in source:
    source = source.replace(load_direct, '  // Compotrains est déjà préchargé avant window.load.\n', 1)

immediate_refresh = '''  lbRunInBackground(() => {
    refreshLiveDataInBackground({ forceFresh: true });
    scheduleBackgroundRefresh(false);
  });
'''
scheduled_only = '''  lbRunInBackground(() => {
    // Pas de second téléchargement Compotrains immédiat : le prochain contrôle
    // normal est planifié à 75 s lorsque la page est visible.
    scheduleBackgroundRefresh(false);
  });
'''
if immediate_refresh in source:
    source = source.replace(immediate_refresh, scheduled_only, 1)
elif 'Pas de second téléchargement Compotrains immédiat' not in source:
    raise SystemExit('startup background refresh marker missing')

index.write_text(source, encoding='utf-8')

css_path = Path('assets/lb-v4-live-preview.css')
css = css_path.read_text(encoding='utf-8')
if 'LB HOME FAVORITES STABLE COMPO V1' not in css:
    css += r'''

/* LB HOME FAVORITES STABLE COMPO V1
 * Empêche le badge ARRIVÉ / À VENIR de changer brutalement de largeur pendant
 * l'arrivée de Compotrains.json. La composition remplace un espace déjà réservé.
 */
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-head {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  align-items: center !important;
  column-gap: 8px !important;
}
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-trainline {
  min-width: 0 !important;
}
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-badge {
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  min-height: 25px !important;
  margin: 0 0 0 auto !important;
  padding: 3px 6px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 5px !important;
  white-space: nowrap !important;
}
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-badge .fav-type-wrap,
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-badge .fav-type-compo,
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-badge .lb-compo-inline {
  display: inline-flex !important;
  align-items: center !important;
  flex: 0 0 auto !important;
}
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-compo-loading {
  width: 48px;
  height: 17px;
  flex: 0 0 48px;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(54,229,239,.055);
}
html[data-lb-v4-live="1"] #homeFavSlot .home-fav-compo-loading i {
  width: 100%;
  height: 100%;
  display: block;
  background: linear-gradient(90deg, transparent, rgba(128,245,250,.18), transparent);
  transform: translateX(-100%);
  animation: lbHomeFavCompoLoading 1.15s ease-in-out infinite;
}
@keyframes lbHomeFavCompoLoading {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  html[data-lb-v4-live="1"] #homeFavSlot .home-fav-compo-loading i {
    animation: none !important;
    transform: none !important;
  }
}
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  html[data-lb-v4-live="1"] #homeFavSlot .home-fav-head {
    column-gap: 4px !important;
  }
  html[data-lb-v4-live="1"] #homeFavSlot .home-fav-badge {
    max-width: none !important;
    min-width: 0 !important;
    padding: 2px 4px !important;
    gap: 3px !important;
  }
  html[data-lb-v4-live="1"] #homeFavSlot .home-fav-compo-loading {
    width: 30px;
    height: 13px;
    flex-basis: 30px;
  }
}
'''
    css_path.write_text(css, encoding='utf-8')

test_path = Path('tests/home-favorites-composition.test.js')
test_path.write_text(r'''const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'lb-v4-live-preview.css'), 'utf8');

test('home favorites reserve the composition slot before Compotrains is ready', () => {
  assert.match(source, /const compoSlot = compoBadge \|\|/);
  assert.match(source, /home-fav-compo-loading/);
  assert.match(source, /\$\{compoSlot\}\$\{renderBadge\(data\.state\)\}/);
  assert.match(css, /LB HOME FAVORITES STABLE COMPO V1/);
  assert.match(css, /#homeFavSlot \.home-fav-head/);
  assert.match(css, /#homeFavSlot \.home-fav-compo-loading/);
});

test('Compotrains starts before background startup and is not fetched twice immediately', () => {
  const preload = source.indexOf('rel="preload" href="https://vps.labetaillere.fr/gtfs/Compotrains.json"');
  const early = source.indexOf('const LB_COMPO_EARLY_PROMISE =');
  const bgState = source.indexOf('const LB_BG_REFRESH_STATE =');
  assert.ok(preload > -1, 'Compotrains preload missing');
  assert.ok(early > -1 && bgState > -1 && early < bgState, 'early composition hydration must precede background startup');
  const comment = source.indexOf('// Charge d’abord le strict nécessaire');
  const load = source.indexOf("window.addEventListener('load', () => {", Math.max(0, bgState));
  const start = comment > -1 ? comment : load;
  const startup = source.slice(start, start + 1500);
  assert.doesNotMatch(startup, /loadCompoData\(\{ forceFresh: false, background: false \}\)/);
  assert.doesNotMatch(startup, /refreshLiveDataInBackground\(\{ forceFresh: true \}\)/);
});

test('home shortcut repaints as soon as cached or remote composition is available', () => {
  const matches = source.match(/typeof lbRenderHomeFavPreview === 'function'\) lbRenderHomeFavPreview\(\)/g) || [];
  assert.ok(matches.length >= 2, 'home favorite repaint hook must exist for cache and network');
});
''', encoding='utf-8')
