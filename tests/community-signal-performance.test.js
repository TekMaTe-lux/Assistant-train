const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '..', 'index.html');
const source = fs.readFileSync(indexPath, 'utf8');

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing block start: ${start}`);
  assert.notEqual(endIndex, -1, `missing block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('signal train list uses one grouped timetable request', () => {
  const hydration = between(
    'async function hydrateSignalTrainOptions()',
    'function updateSignalTypeUI()'
  );

  assert.match(hydration, /await loadTrainStaticToday\(\)/);
  assert.doesNotMatch(
    hydration,
    /getLiveTrainStaticInfo\(/,
    'opening the signal modal must not start one detailed request per train'
  );
});

test('signal select is rebuilt only when its train signature changes', () => {
  const refresh = between(
    'function refreshSignalModal(',
    'async function hydrateSignalTrainOptions()'
  );

  assert.match(refresh, /signalTrainOptionsSignature/);
  assert.match(refresh, /if \(mustRebuild\)/);
  assert.match(refresh, /COMMUNITY\.signalOptionsSignature !== signature/);
});

test('detailed timetable is loaded only after the traveller selects a train', () => {
  const changes = between(
    "document.addEventListener('change', (e)=>{",
    "document.addEventListener('click', (e)=>{\n    const typeBtn"
  );

  assert.match(changes, /e\.target\.id === 'lbSignalTrainSelect'/);
  assert.match(changes, /getLiveTrainStaticInfo\(trainKey\)/);
});

test('daily timetable URL stays stable during the day', () => {
  const loader = between(
    'async function loadTrainStaticToday(force = false)',
    'function getTrainStaticTodayInfo'
  );

  assert.match(loader, /\?v=\$\{today\}/);
  assert.doesNotMatch(loader, /Date\.now\(\)/);
});
