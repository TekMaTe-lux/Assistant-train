const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.css'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.js'),'utf8');
const html=fs.readFileSync(path.join(root,'_source/index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');

test('Matin/Soir are equal grid columns with identical button dimensions',()=>{
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.lbmj-select button\{[\s\S]*?width:100%;[\s\S]*?height:36px;[\s\S]*?min-height:36px;[\s\S]*?max-height:36px/);
  assert.match(css,/\.lbmj-select button\.is-active\{/);
});
test('Energy only plays on a changed selection, is scoped, finite and accessible',()=>{
  assert.match(js,/if\(selected!==b\.dataset\.kind\)pulseEnergy\(\)/);
  assert.match(js,/prefers-reduced-motion: reduce/);
  assert.match(css,/#favTrainsWidget\.lbmj-page\.lbmj-energy-pulse/);
  assert.match(css,/lbmj-energy-link \.85s ease-out 1 both/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/lbmj-energy-link \.85s ease-out 1 both/);
  assert.match(css,/lbmj-energy-spine \.85s ease-out 1 both/);
});
test('The original live journey, controls and cache safety remain',()=>{
  assert.match(js,/window\.lbOpenTrainProfile\(number,date,\{origin:'favorites'\}\)/);
  assert.match(js,/holder\.appendChild\(panel\)/);
  assert.match(js,/anchor\.parentNode\.insertBefore\(panel,anchor\.nextSibling\)/);
  assert.match(html,/lb-my-journey-inline-v1\.css\?v=20261010-energy1/);
  assert.match(html,/lb-my-journey-inline-v1\.js\?v=20261010-energy1/);
  assert.match(worker,/CACHE_VERSION = 'v129'/);
});
