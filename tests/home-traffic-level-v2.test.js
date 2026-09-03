const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'assets', 'lb-home-traffic-level-v2.js'),
  'utf8'
);

const context = {
  window: {},
  document: { readyState: 'complete' },
  setTimeout() {},
  console
};
context.window.window = context.window;
context.window.document = context.document;
context.window.setTimeout = context.setTimeout;
context.window.addEventListener = () => {};

vm.runInNewContext(source, context, { filename: 'lb-home-traffic-level-v2.js' });

const { pickTrafficLevel, buildTrafficSegmentStats } = context.window.LB_HOME_TRAFFIC_LEVEL_V2;

function level(stats) {
  return pickTrafficLevel(stats).level;
}

test('one +10 min train out of 13 keeps the corridor fluid', () => {
  assert.equal(level({ total: 13, delayed: 1, maxDelayMin: 10 }), 'green');
});

test('two isolated delays out of 13 still keep the corridor fluid', () => {
  assert.equal(level({ total: 13, delayed: 2, maxDelayMin: 10 }), 'green');
});

test('three delayed trains out of 13 mean slowed traffic, not perturbed', () => {
  assert.equal(level({ total: 13, delayed: 3, maxDelayMin: 10 }), 'yellow');
});

test('five impacted trains out of 13 mean perturbed traffic', () => {
  assert.equal(level({ total: 13, delayed: 5, maxDelayMin: 10 }), 'orange');
});

test('seven impacted trains out of 13 mean very perturbed traffic', () => {
  assert.equal(level({ total: 13, delayed: 7, maxDelayMin: 10 }), 'red');
});

test('one >=30 minute delay is visible but cannot make traffic perturbed alone', () => {
  assert.equal(level({ total: 13, delayed: 1, maxDelayMin: 30 }), 'yellow');
});

test('one cancellation slows traffic and two cancellations perturb it', () => {
  assert.equal(level({ total: 13, partialCount: 1 }), 'yellow');
  assert.equal(level({ total: 13, canceledCount: 2 }), 'orange');
});

test('segment stats count each train in only one impact state', () => {
  const raw = {
    trains: {
      delayed: { status: 'DELAYED', stops: { Thionville: 10 } },
      partial: {
        status: 'PARTIAL_CANCELED',
        stops: { Thionville: 8 },
        canceled_stops: ['Thionville']
      },
      canceled: { status: 'CANCELED', stops: { Thionville: 12 } },
      ontime: { status: 'ON_TIME', stops: { Thionville: 0 } }
    }
  };

  const stats = buildTrafficSegmentStats(raw, ['Thionville']);
  assert.equal(stats.total, 4);
  assert.equal(stats.delayed, 1);
  assert.equal(stats.partialCount, 1);
  assert.equal(stats.canceledCount, 1);
  assert.equal(stats.maxDelayMin, 10);
});
