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

test('LIVE gives trip-level full cancellation priority without breaking partial cancellations', () => {
  const block = between('function classifyOfficialLiveDisruption(', 'function extractLiveTrains()');
  const classify = Function(`${block}\nreturn classifyOfficialLiveDisruption;`)();
  const deleted = { stop_time_effect: 'deleted' };
  const running = { stop_time_effect: 'scheduled' };

  // Cas réel 88748 : le voyage SNCF est CANCELED. Même si un texte ou une
  // autre source laisse croire à un terminus exceptionnel, il reste supprimé.
  assert.equal(classify({
    status: 'CANCELED',
    cause: 'Suppression partielle · terminus exceptionnel à Bettembourg',
    stops: [deleted, running]
  }).statusClass, 'cancel');

  // Une vraie suppression partielle continue de fonctionner normalement.
  assert.equal(classify({
    status: 'SCHEDULED',
    cause: 'Suppression partielle entre Thionville et Luxembourg',
    stops: [running, deleted]
  }).statusClass, 'partial');

  // Tous les arrêts supprimés = suppression totale, même sans libellé CANCELED.
  assert.equal(classify({
    status: 'SCHEDULED',
    stops: [deleted, deleted]
  }).statusClass, 'cancel');

  assert.match(block, /explicitTripCanceled/);
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


test('Voix detail reuses the unified official service pattern', () => {
  const profile = between('async function getOfficialServicePattern(numberValue, dateValue)', 'function init()');
  assert.match(profile, /loadLiveBundle/);
  assert.match(profile, /applyEffectiveServicePattern/);
  assert.match(source, /window\.lbGetOfficialServicePattern = getOfficialServicePattern/);

  const detail = between('async function renderTrainDetail(trainNumber)', 'function signalTrainOptionsSignature');
  assert.match(detail, /lbGetOfficialServicePattern/);
  assert.match(detail, /officialDeleted/);
  assert.match(detail, /officialNewOrigin/);
  assert.match(detail, /officialNewTerminus/);
  assert.match(detail, /SUPPRIMÉ · arrêt non desservi/);
  assert.match(detail, /DÉPART EXCEPTIONNEL/);
  assert.match(detail, /TERMINUS EXCEPTIONNEL/);
});
