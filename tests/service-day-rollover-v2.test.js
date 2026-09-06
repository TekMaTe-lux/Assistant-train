const assert = require('node:assert/strict');

const DAY = 86400;

function dayDiff(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

function serviceNow(civilDate, civilSecond, serviceDate) {
  return civilSecond + dayDiff(serviceDate, civilDate) * DAY;
}

function visible(train, civilDate, civilSecond, keep = 180) {
  const now = serviceNow(civilDate, civilSecond, train.serviceDate);
  return now >= train.start - 180 && now <= train.end + keep;
}

function key(date, tripId) { return `${date}::${tripId}`; }

const before = { serviceDate: '2026-09-05', start: 22 * 3600, end: 23 * 3600 };
const cross0037 = { serviceDate: '2026-09-05', start: 23 * 3600 + 42 * 60, end: 24 * 3600 + 37 * 60 };
const cross01 = { serviceDate: '2026-09-05', start: 23 * 3600 + 42 * 60, end: 25 * 3600 + 7 * 60 };
const next0001 = { serviceDate: '2026-09-06', start: 60, end: 20 * 60 };

assert.equal(visible(before, '2026-09-06', 60), false, '1. train entièrement avant minuit retiré');
assert.equal(visible(cross0037, '2026-09-05', 23 * 3600 + 59 * 60), true, '2a. visible à 23:59');
assert.equal(visible(cross0037, '2026-09-06', 0), true, '2b. visible à 00:00');
assert.equal(visible(cross0037, '2026-09-06', 20 * 60), true, '2c. visible à 00:20');
assert.equal(visible(cross0037, '2026-09-06', 41 * 60), false, '2d. retiré après arrivée + conservation');
assert.equal(visible(cross01, '2026-09-06', 60 * 60), true, '3. trajet jusque 01hxx conservé');
assert.equal(visible(next0001, '2026-09-05', 23 * 3600 + 57 * 60), false, '4a. J+1 pas affiché avant sa fenêtre');
assert.equal(visible(next0001, '2026-09-05', 23 * 3600 + 59 * 60), true, '4b. J+1 visible dans sa fenêtre de pré-départ');
assert.equal(visible(next0001, '2026-09-06', 60), true, '4c. J+1 affiché à 00:01');
assert.notEqual(key('2026-09-05', 'same-trip'), key('2026-09-06', 'same-trip'), '5. aucune collision inter-journée');

const selected = key('2026-09-05', 'late');
assert.equal(selected, key('2026-09-05', 'late'), '6. identité de la fiche stable au rollover');
assert.equal(visible(cross0037, '2026-09-06', 1), true, '7. rollover sans interaction');

const delayed = { serviceDate: '2026-09-05', start: 23 * 3600 + 40 * 60, end: 23 * 3600 + 55 * 60 + 20 * 60 };
assert.equal(visible(delayed, '2026-09-06', 5 * 60), true, '8. retard après minuit conservé');

const cancelled = { ...cross0037, cancelled: true };
const partial = { ...cross0037, partial: true };
assert.equal(visible(cancelled, '2026-09-06', 10 * 60), true, '9a. suppression garde sa fenêtre métier');
assert.equal(visible(partial, '2026-09-06', 10 * 60), true, '9b. partiel garde sa fenêtre métier');

const loops = 200000;
const started = process.hrtime.bigint();
for (let i = 0; i < loops; i++) serviceNow('2026-09-06', i % DAY, i & 1 ? '2026-09-05' : '2026-09-06');
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.ok(elapsedMs < 1500, `10. conversion trop lente: ${elapsedMs.toFixed(1)} ms`);

console.log(`service-day-rollover-v2: 10/10 OK (${elapsedMs.toFixed(1)} ms pour ${loops} conversions)`);
