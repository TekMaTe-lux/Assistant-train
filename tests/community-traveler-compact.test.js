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

test('a station delay propagates forward until another station report replaces it', () => {
  assert.match(compact, /let activeReport = null/);
  assert.match(compact, /if \(nextReport && nextDelay > 0\) activeReport = nextReport/);
  assert.match(compact, /if \(!activeReport\) return/);
  assert.match(compact, /activeReport\.delayMin/);
  assert.match(compact, /jusqu’au prochain signalement/);
});

test('compact layer reuses travelerStops and does not invent a second data source', () => {
  assert.match(compact, /item\?\.travelerStops/);
  assert.doesNotMatch(compact, /fetch\(/);
  assert.doesNotMatch(compact, /XMLHttpRequest/);
  assert.doesNotMatch(compact, /MutationObserver/);
  assert.doesNotMatch(compact, /setInterval\(/);
});

test('VPS installer loads compact layer after the existing traveler layer', () => {
  const v1 = installer.indexOf('lb-community-traveler-v1.js?v=20260905-5');
  const v2 = installer.indexOf('lb-community-traveler-compact-v2.js?v=20260905-1');
  assert.ok(v1 >= 0, 'V1 marker missing');
  assert.ok(v2 > v1, 'compact V2 must be installed after V1');
  assert.match(installer, /__LB_COMMUNITY_TRAVELER_COMPACT_V2__/);
});
