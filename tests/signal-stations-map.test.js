const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fix = fs.readFileSync(path.join(root, 'assets/signal-stations-fix.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

test('map-opened signal modal triggers full stop hydration', () => {
  assert.match(fix, /const MODAL_ID = 'lbSignalModal'/);
  assert.match(fix, /modalObserver\.observe\(modal, \{ attributes:true, attributeFilter:\['class', 'aria-hidden'\] \}\)/);
  assert.match(fix, /scheduleRefresh\(0\)/);
});

test('station fix compares official route with train-static and keeps richer list', () => {
  assert.match(fix, /lbGetOfficialServicePattern/);
  assert.match(fix, /api\/train-static\?date=\$\{encodeURIComponent\(todayIso\(\)\)\}/);
  assert.match(fix, /if \(apiNames\.length > names\.length\) names = apiNames/);
  assert.match(fix, /stops\.length < existing\.length/);
});

test('station observers are targeted instead of watching the whole page', () => {
  assert.doesNotMatch(fix, /observe\(document\.body/);
  assert.match(fix, /stationObserver\.observe\(stationSelect, \{ childList:true \}\)/);
});

test('service worker always fetches the latest station fix first', () => {
  assert.match(sw, /CACHE_VERSION = 'v41'/);
  assert.match(sw, /signal-stations-fix\.js/);
  assert.match(sw, /isCriticalCommunityAsset/);
});
