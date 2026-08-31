const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'lb-v4-live-preview.css'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('dynamic table train numbers keep the legend composition colors above the V4 th rule', () => {
  assert.match(css, /LB TABLE TRAIN COMPOSITION COLOR PRIORITY V1/);
  assert.match(css, /train-header\.us-train:not\(\.reduced-seats\)[\s\S]*?#bf00ff !important/);
  assert.match(css, /train-header\.us5-train:not\(\.reduced-seats\)[\s\S]*?#ffd24a !important/);
  assert.match(css, /train-header\.um-train:not\(\.reduced-seats\)[\s\S]*?#00f0ff !important/);
  assert.match(css, /train-header\.um3-train:not\(\.reduced-seats\)[\s\S]*?#00ffa6 !important/);
  assert.match(css, /train-header\.no-compo-text:not\(\.reduced-seats\)[\s\S]*?#ffffff !important/);
  assert.match(html, /lb-v4-live-preview\.css\?v=20260831-3/);
});

test('reduced-capacity visual override remains conditional on the JS class', () => {
  const blockStart = css.indexOf('LB TABLE TRAIN COMPOSITION COLOR PRIORITY V1');
  const scoped = css.slice(blockStart);
  assert.match(scoped, /th\.train-header\.reduced-seats \.train-num/);
  assert.doesNotMatch(scoped, /th\.train-header:not\(\.reduced-seats\) \.train-num[\s\S]*?reduced/);
});
