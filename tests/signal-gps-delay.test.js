const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gpsPath = path.resolve(__dirname, '..', 'assets', 'signal-gps-delay.js');
const loaderPath = path.resolve(__dirname, '..', 'assets', 'signal-stations-fix.js');
const source = fs.readFileSync(gpsPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

test('GPS delay module is loaded by the existing signal script', () => {
  assert.match(loader, /signal-gps-delay\.js\?v=20260905-1/);
});

test('GPS is one-shot and never continuously tracked', () => {
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.doesNotMatch(source, /watchPosition/);
});

test('GPS estimate only hooks the traveller delay action', () => {
  assert.match(source, /\.lb-signal-type\[data-signal-type="retard"\]/);
  assert.match(source, /lbSignalDelaySelect/);
  assert.match(source, /prérempli · modifiable avant publication/);
});

test('static timetable is fetched only for the selected train', () => {
  assert.match(source, /\/api\/train-static\?date=/);
  assert.match(source, /fetchTripRows\(meta\)/);
});

test('raw GPS coordinates are not placed in a request body', () => {
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*(latitude|longitude|coords)/);
  assert.doesNotMatch(source, /URLSearchParams\([^)]*(latitude|longitude|coords)/);
});
