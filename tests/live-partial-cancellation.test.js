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

test('88503 starts exceptionally at Metz and keeps the canceled southern stops visible', () => {
  const block = between('const normalizeStopKey = (value)', 'function chooseStaticCandidate(');
  const applyPattern = Function(`${block}\nreturn applyEffectiveServicePattern;`)();
  const stop = (name, arrival, departure, id) => ({
    name,
    arrival,
    departure,
    raw: { stop_point: { id, name } }
  });
  const impact = (id, name, arrivalStatus, departureStatus) => ({
    stop_point: { id, name },
    arrival_status: arrivalStatus,
    departure_status: departureStatus,
    stop_time_effect: (arrivalStatus === 'deleted' || departureStatus === 'deleted') ? 'deleted' : 'unchanged'
  });
  const rows = [
    stop('Nancy', '06:51', '06:51', 'nancy'),
    stop('Pont-à-Mousson', '07:07', '07:08', 'pam'),
    stop('Pagny-sur-Moselle', '07:16', '07:17', 'pagny'),
    stop('Metz', '07:30', '07:33', 'metz'),
    stop('Luxembourg', '08:24', '08:24', 'lux')
  ];
  const liveBundle = {
    status: 'PARTIAL_CANCELLATION',
    impacted: {
      nancy: impact('nancy', 'Nancy', 'unchanged', 'deleted'),
      pam: impact('pam', 'Pont-à-Mousson', 'deleted', 'deleted'),
      pagny: impact('pagny', 'Pagny-sur-Moselle', 'deleted', 'deleted'),
      metz: impact('metz', 'Metz', 'deleted', 'unchanged'),
      lux: impact('lux', 'Luxembourg', 'unchanged', 'unchanged')
    },
    canceledStopKeys: new Set()
  };

  const result = applyPattern(rows, liveBundle);
  assert.deepEqual(result.slice(0, 3).map((row) => row.isDeleted), [true, true, true]);
  assert.equal(result[0].isNewTerminus, false);
  assert.equal(result[3].isDeleted, false);
  assert.equal(result[3].isNewOrigin, true);
  assert.equal(result[3].isNewTerminus, false);
  assert.equal(result[4].isDeleted, false);
});

test('table applies effective service boundaries before endpoint labels', () => {
  const table = between('// statuts', "html += '</tbody></table>'");
  assert.match(table, /const isOutsideEffectiveService/);
  assert.match(table, /isDepartureKeptArrivalDeletedNewStart = !!imp\s*&& !isOutsideEffectiveService/);
  assert.match(table, /isSncfExplicitPartialTerminal = !!imp\s*&& !isOutsideEffectiveService/);
  assert.match(source, /#trainInfo td > \.deleted/);
});
