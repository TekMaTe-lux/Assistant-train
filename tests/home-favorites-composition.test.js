const { test } = require('node:test');
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
