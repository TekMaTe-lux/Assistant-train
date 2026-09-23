'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dialog = fs.readFileSync(path.join(root, 'vps/map-v2/lb-community-signal-dialog-v1.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'assets/lb-community-map-bridge-core-v1.js'), 'utf8');
const features = fs.readFileSync(path.join(root, 'assets/lb-index-features.js'), 'utf8');

test('a propagated delay keeps the clicked stop distinct from its source stop', () => {
  assert.match(dialog, /clickedStation/);
  assert.match(dialog, /data-lb-signal-new-measure/);
  assert.match(dialog, /source:'map-next-stop'/);
  assert.match(dialog, /station,\s*delayMin/);
});

test('parent bridge opens a station-scoped signal instead of a generic signal', () => {
  assert.match(bridge, /data\.station/);
  assert.match(bridge, /openSignalAt/);
});

test('station update opens a fresh report, requires an explicit new delay and returns to map', () => {
  assert.match(features, /function openSignalAtStop/);
  assert.match(features, /delaySelect\.value = ''/);
  assert.match(features, /returnToMapAfterSignal = true/);
  assert.match(features, /if \(!returnToMapAfterSignal\)/);
});
