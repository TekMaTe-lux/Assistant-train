const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'assets/lb-community-map-bridge-v1.js'), 'utf8');
const mapLayer = fs.readFileSync(path.join(root, 'vps/map-v2/lb-community-traveler-v1.js'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing block: ${start}`);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return source.slice(from, to);
}

test('the map bridge does not observe or poll the entire page', () => {
  assert.doesNotMatch(bridge, /new MutationObserver/);
  assert.doesNotMatch(bridge, /setInterval\(/);
});

test('anonymous visitors can receive snapshots but cannot contribute', () => {
  assert.match(bridge, /canContribute:\s*canContribute\(\)/);
  assert.match(bridge, /if \(!canContribute\(\)\) \{ requestAuthentication\(\);/);
  assert.match(mapLayer, /data\.canContribute === true/);
  assert.match(mapLayer, /communityCanContribute \? \(item\?\.isCurrentUserAboard/);
});

test('presence publication waits for authentication and server confirmation', () => {
  const publish = block(index, 'async function publishPresence(trainNumber)', 'async function clearMyPresence');
  assert.match(publish, /requireCommunityAuthentication\(\)/);
  assert.match(publish, /presenceMutationInFlight/);
  assert.match(publish, /if \(!res\.ok\) throw/);
  assert.match(publish, /confirmedPresenceGrace/);
  assert.doesNotMatch(publish, /pending-presence/);
});

test('loading public presences never auto-deletes a server presence', () => {
  const loader = block(index, 'async function loadPresences()', 'function getRawLiveTrainPayload');
  assert.doesNotMatch(loader, /clearMyPresence\(/);
  assert.match(loader, /confirmedPresenceGrace/);
});

test('community refresh is throttled and paused in background tabs', () => {
  assert.match(index, /if \(document\.hidden\) return;[\s\S]*?Promise\.allSettled\(\[loadSignals\(\), loadPresences\(\)\]\);[\s\S]*?20000/);
});

test('delay selector stays hidden until Retard is selected', () => {
  assert.match(bridge, /#lbSignalDelayWrap\{display:none/);
  assert.match(bridge, /#lbSignalDelayWrap\.is-visible\{display:flex\}/);
});

