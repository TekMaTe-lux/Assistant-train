const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'lb-legacy.css'), 'utf8');

function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, `missing start: ${start}`);
  assert.notEqual(b, -1, `missing end: ${end}`);
  return source.slice(a, b);
}

test('LIVE classifies a partial cancellation before a full cancellation', () => {
  const block = between('function classifyOfficialLiveDisruption(', 'function extractLiveTrains()');
  assert.ok(block.indexOf("statusClass:'partial'") < block.indexOf("statusClass:'cancel'"));
  assert.match(block, /partiel/);
  assert.match(block, /entre .* et /);
  assert.match(block, /deletedStops > 0 && runningStops > 0/);
});

test('GTFS extraction and SNCF hub hydration use the same classifier', () => {
  const raw = between('function extractLiveTrains()', 'window.extractLiveTrains = extractLiveTrains');
  const hub = between('function extractSncfHubLiveInfo(data)', 'async function hydrateLiveSncfViaHub');
  assert.match(raw, /classifyOfficialLiveDisruption/);
  assert.match(hub, /classifyOfficialLiveDisruption/);
});

test('LIVE renders a distinct partial state and official cause', () => {
  const render = between('function renderLiveTrainCards()', 'async function hydrateLiveTrainStaticInfos');
  assert.match(render, /statusClass === 'partial'/);
  assert.match(render, /Suppression partielle/);
  assert.match(css, /\.lb-live-card--partial/);
  assert.match(css, /\.lb-live-status--partial/);
});
