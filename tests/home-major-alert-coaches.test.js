const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '..', 'assets', 'home-major-alerts-core.js'), 'utf8');
const start = source.indexOf('  const escapeHtml = ');
const end = source.indexOf('  function routeLabelForBanner(');
assert.ok(start > 0 && end > start, 'Major-alert pure rules are present');
const helpers = Function(source.slice(start, end) + '\nreturn { classify, dedupe, severityFor, hasMajorImpact };')();

const detail = 'Du samedi 10 au dimanche 11 octobre 2026, la circulation des trains est perturbée entre Metz et Luxembourg en raison de travaux de maintenance sur la voie.\nDes autocars de substitution sont mis en place.\nRetrouvez les informations horaires sur le site TER Grand Est, SNCF Connect ou l\'application de mobilité de votre choix.';

const general = {
  situation_number: 'QOM:Broadcast::1531556450347824234:LOC',
  participant_ref: 'LOR',
  scope_type: 'general',
  summary: 'Travaux en cours.',
  description: '',
  detail,
  affects: [],
  links: [],
};
const perTrains = {
  situation_number: 'QOM:Broadcast::8326589979272360506:LOC',
  participant_ref: 'LOR',
  scope_type: 'vehicleJourney',
  summary: 'Travaux en cours.',
  description: 'Du 10 au 11/10, la circulation des trains est perturbée entre Metz et Luxembourg en raison de travaux sur la voie. Des autocars de substitution sont mis en place',
  detail: detail.replace('2026,', '2026.,'),
  affects: [{vehicle_journeys: ['88700', '88701', '88702', '88703', '88704', '88705', '88706', '88707']}],
  links: [],
};

test('10-11 October 2026 Metz-Luxembourg coach substitution is major and red', () => {
  const item = helpers.classify(general);
  assert.ok(item, 'published corridor works must be seen as major');
  assert.equal(item.severity.key, 'critical');
  assert.equal(item.severity.rank, 5);
  assert.match(item.severity.label, /Cars de substitution/);
  assert.equal(helpers.hasMajorImpact(item.text), true);
});

test('SIRI general and train-specific broadcasts merge despite different descriptions', () => {
  const left = helpers.classify(general);
  const right = helpers.classify(perTrains);
  assert.ok(left && right);
  assert.equal(left.fingerprint, right.fingerprint);
  const unique = helpers.dedupe([left, right]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].corridorTrains.length, 8);
});

test('distinct works on the same route and different dates do not get merged', () => {
  const copy = { ...general, situation_number: 'another-event', detail: detail.replace('10 au dimanche 11 octobre', '17 au dimanche 18 octobre') };
  const items = helpers.dedupe([helpers.classify(general), helpers.classify(copy)]);
  assert.equal(items.length, 2);
});

test('ordinary planned maintenance without significant disruption is not major', () => {
  const routine = 'Du samedi 10 au dimanche 11 octobre 2026, travaux sur la voie entre Metz et Luxembourg. Les horaires habituels restent assurés.';
  assert.equal(helpers.hasMajorImpact(routine), false);
  assert.equal(helpers.severityFor(routine).key, 'works');
  assert.equal(helpers.classify({ ...general, detail: routine }), null);
});

test('a real interruption remains red, but a simple work mention does not', () => {
  assert.equal(helpers.severityFor('interruption totale des circulations entre metz et luxembourg').key, 'critical');
  assert.equal(helpers.severityFor('travaux metz luxembourg').key, 'works');
});
