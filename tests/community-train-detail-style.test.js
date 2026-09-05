const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const signalFix = fs.readFileSync(path.join(root, 'assets/signal-stations-fix.js'), 'utf8');

test('train detail community delay is compact and purple', () => {
  assert.match(signalFix, /lb-stop-chip--community-delay/);
  assert.match(signalFix, /`\+\$\{delayMin\} min\*`/);
  assert.match(signalFix, /183,140,255/);
  assert.match(signalFix, /77,43,113/);
});

test('propagated delay keeps its source outside the purple chip', () => {
  assert.match(signalFix, /lb-community-detail-propagated/);
  assert.match(signalFix, /lb-community-detail-source/);
  assert.match(signalFix, /sourceLabel\.textContent = `depuis \$\{source\}`/);
});

test('official SNCF chips are never recolored as community data', () => {
  assert.match(signalFix, /chip\.getAttribute\('title'\) === 'Donnée officielle SNCF'/);
});

test('train detail observation is targeted and does not add polling or geometry scans', () => {
  assert.match(signalFix, /detailObserver\.observe\(root, \{ childList:true, subtree:true \}\)/);
  assert.doesNotMatch(signalFix, /observe\(document\.body/);
  assert.doesNotMatch(signalFix, /setInterval\(/);
  assert.doesNotMatch(signalFix, /getBoundingClientRect\(/);
});
