const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compact = fs.readFileSync(path.join(root, 'vps/map-v2/lb-community-traveler-compact-v2.js'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'vps/map-v2/install-community-traveler-layer-v1.sh'), 'utf8');

test('compact community block stays concise on mobile', () => {
  assert.match(compact, /status\.push\(`\$\{presenceCount\} à bord`\)/);
  assert.match(compact, /status\.push\(`\+\$\{delayMin\} min`\)/);
  assert.match(compact, /Retard signalé depuis/);
  assert.match(compact, /content:'Participer'/);
  assert.match(compact, /lb-community-read-only .*nth-child\(2\)\{display:none!important\}/);
});

test('connected actions stay on the right and do not decorate the summary button', () => {
  assert.match(compact, /lb-community-can-contribute \.lb-map-trip-community-actions \[data-lb-map-community-signal\]/);
  assert.doesNotMatch(compact, /lb-community-can-contribute \[data-lb-map-community-signal\]\{font-size:0!important\}/);
  assert.match(compact, /content:'À bord ✓'/);
});

test('a station delay propagates forward until another station report replaces it', () => {
  assert.match(compact, /let activeReport = null/);
  assert.match(compact, /if \(nextReport && nextDelay > 0\) activeReport = nextReport/);
  assert.match(compact, /if \(!activeReport\) return/);
  assert.match(compact, /activeReport\.delayMin/);
  assert.match(compact, /label\.textContent = `\+\$\{delay\} min\*`/);
  assert.match(compact, /jusqu’au prochain signalement/);
});

test('map marker uses the compact community star notation', () => {
  assert.match(compact, /badge\.textContent = `\+\$\{delay\}min\*`/);
  assert.match(compact, /Retard signalé par la communauté/);
  assert.match(compact, /installMarkerHook/);
});

test('compact layer reuses travelerStops and avoids permanent observers or polling', () => {
  assert.match(compact, /item\?\.travelerStops/);
  assert.doesNotMatch(compact, /fetch\(/);
  assert.doesNotMatch(compact, /XMLHttpRequest/);
  assert.doesNotMatch(compact, /MutationObserver/);
  assert.doesNotMatch(compact, /setInterval\(/);
});

test('VPS installer loads the refreshed compact layer after the existing traveler layer', () => {
  const v1 = installer.indexOf('lb-community-traveler-v1.js?v=20260905-5');
  const v2 = installer.indexOf('lb-community-traveler-compact-v2.js?v=20260905-2');
  assert.ok(v1 >= 0, 'V1 marker missing');
  assert.ok(v2 > v1, 'compact V2 must be installed after V1');
  assert.match(installer, /__LB_COMMUNITY_TRAVELER_COMPACT_V2__/);
});
