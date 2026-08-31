from pathlib import Path

index_path = Path('index.html')
css_path = Path('assets/lb-v4-live-preview.css')
test_path = Path('tests/table-train-composition-colors.test.js')

index = index_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')

marker = 'LB TABLE TRAIN COMPOSITION COLOR PRIORITY V1'
block = r'''

/* LB TABLE TRAIN COMPOSITION COLOR PRIORITY V1
 * Le thème V4 impose un cyan !important à tous les <th>. Les anciennes classes
 * de composition continuaient toutefois à fournir leur text-shadow : le texte cyan
 * se superposait donc au halo violet/jaune/vert et donnait l'impression d'une
 * couche estompée au-dessus du numéro.
 *
 * On corrige uniquement le numéro de train. La logique JS de composition et la
 * détection .reduced-seats restent strictement inchangées.
 */
html[data-lb-v4-live="1"] #trainInfo th.train-header.us-train:not(.reduced-seats) .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.us-train:not(.reduced-seats) .train-num a.train-link {
  color: #bf00ff !important;
  text-shadow: 0 0 5px #bf00ff, 0 0 10px #8000ff !important;
}
html[data-lb-v4-live="1"] #trainInfo th.train-header.us5-train:not(.reduced-seats) .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.us5-train:not(.reduced-seats) .train-num a.train-link {
  color: #ffd24a !important;
  text-shadow: 0 0 5px #ffd24a, 0 0 12px rgba(255,210,74,.65) !important;
}
html[data-lb-v4-live="1"] #trainInfo th.train-header.um-train:not(.reduced-seats) .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.um-train:not(.reduced-seats) .train-num a.train-link {
  color: #00f0ff !important;
  text-shadow: 0 0 5px rgba(0,240,255,.75), 0 0 10px rgba(0,200,255,.45) !important;
}
html[data-lb-v4-live="1"] #trainInfo th.train-header.um3-train:not(.reduced-seats) .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.um3-train:not(.reduced-seats) .train-num a.train-link {
  color: #00ffa6 !important;
  text-shadow: 0 0 5px #00ffa6, 0 0 10px rgba(0,255,166,.5) !important;
}
html[data-lb-v4-live="1"] #trainInfo th.train-header.no-compo-text:not(.reduced-seats) .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.no-compo-text:not(.reduced-seats) .train-num a.train-link {
  color: #ffffff !important;
  text-shadow: none !important;
}

/* Une modification visuelle de capacité ne prend priorité QUE lorsque le code
 * a réellement posé la classe .reduced-seats après détection de l'alerte.
 * Aucun sélecteur générique ne simule cet état.
 */
html[data-lb-v4-live="1"] #trainInfo th.train-header.reduced-seats .train-num,
html[data-lb-v4-live="1"] #trainInfo th.train-header.reduced-seats .train-num a.train-link {
  color: #bf00ff !important;
  text-shadow: 0 0 5px #bf00ff, 0 0 10px #8000ff !important;
}
'''

if marker not in css:
    css += block

old_ref = './assets/lb-v4-live-preview.css?v=20260831-2'
new_ref = './assets/lb-v4-live-preview.css?v=20260831-3'
if new_ref not in index:
    if old_ref not in index:
        raise SystemExit('CSS cache-bust marker not found')
    index = index.replace(old_ref, new_ref, 1)

index_path.write_text(index, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')

test_path.write_text(r'''const { test } = require('node:test');
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
''', encoding='utf-8')
