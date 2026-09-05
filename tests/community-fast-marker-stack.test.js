const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const installer = fs.readFileSync(
  path.join(root, 'vps/map-v2/install-community-fast-marker-stack-v1.sh'),
  'utf8'
);

test('fast marker patch removes per-icon global rescans', () => {
  assert.match(installer, /pas de rescan global par icône/);
  assert.match(installer, /aucun rescan par icône/);
  assert.match(installer, /queueMicrotask\(scheduleMarkerRefresh\);/);
  assert.match(installer, /requestAnimationFrame\(decorateMarkerBadges\)/);
  assert.match(installer, /if 'queueMicrotask\(scheduleMarkerRefresh\);' in v1:/);
  assert.match(installer, /if 'requestAnimationFrame\(decorateMarkerBadges\)' in v2:/);
});

test('community delay is rendered directly as the violet final badge', () => {
  assert.match(installer, /lb-map-traveler-delay lb-map-traveler-delay-community/);
  assert.match(installer, /\+\$\{item\.delayMin\}min\*/);
  assert.match(installer, /rgba\(61,34,91,\.94\)/);
});

test('SNCF and community badges use CSS grid without DOM geometry reads', () => {
  assert.match(installer, /LB_COMMUNITY_MARKER_STACK_CSS_V1/);
  assert.match(installer, /display:grid!important/);
  assert.match(installer, /grid-column:3!important;grid-row:1!important/);
  assert.match(installer, /grid-column:3!important;grid-row:2!important/);
  assert.doesNotMatch(installer, /getBoundingClientRect\s*\(/);
});

test('the patch refuses to remove the service-day rollover protection', () => {
  assert.match(installer, /LB_SERVICE_DAY_ROLLOVER_V1/);
  assert.match(installer, /ancien script visual-stability encore raccordé/);
});
