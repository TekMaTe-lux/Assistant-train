const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, '_source/index.html'), 'utf8');
const built = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/lb-legacy.css'), 'utf8');
const features = fs.readFileSync(path.join(root,'assets/lb-index-features.js'),'utf8');
test('One existing history button lives directly below 30-day reliability card', () => {
  assert.equal((html.match(/id="trainDetailStatsBtn"/g)||[]).length,1);
  assert.equal((built.match(/id="trainDetailStatsBtn"/g)||[]).length,1);
  const reliability = html.indexOf('lb-train-profile__reliability-card');
  const runs = html.indexOf('id="trainDetailReliabilityRuns"',reliability);
  const closing = html.indexOf('</section>',runs);
  const actions = html.indexOf('lb-train-profile__actions',closing);
  const community = html.indexOf('lb-train-profile__community',actions);
  assert.ok(reliability < runs && runs < closing && closing < actions && actions < community);
  assert.doesNotMatch(html.slice(closing, actions), /<sectionb/, 'no card between reliability and history button');
  assert.match(features,/const statsButton = byId\('trainDetailStatsBtn'\)/);
  assert.match(features,/window\.setTimeout\(\(\) =>/);
});
test('Mobile layout places history after reliability and before detailed crowding', () => {
 const cssMobile=css.slice(css.indexOf('@media (max-width:760px){',css.indexOf('lb-train-profile__grid{')));
 const matches=Object.fromEntries(Array.from(cssMobile.matchAll(/\.lb-train-profile__(route-card|composition-card|reliability-card|actions|affluence-details|community)\{ order:(\d+); \}/g)).map(m=>[m[1],Number(m[2])]));
 assert.deepEqual(matches,{'route-card':1,'composition-card':2,'reliability-card':3,'actions':4,'affluence-details':5,'community':6});
});
