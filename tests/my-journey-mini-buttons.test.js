const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.css'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.js'),'utf8');
const page=fs.readFileSync(path.join(root,'_source/index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
test('matin and soir have equal small dimensions, not oversized touch panels',()=>{
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.lbmj-select button\{[\s\S]*?height:28px!important;[\s\S]*?min-height:28px!important;[\s\S]*?max-height:28px!important/);
 assert.match(css,/width:150px/);
 assert.match(css,/\.lbmj-select button\.is-active\{/);
});
test('return exactly to previous layout and remove energy effects',()=>{
 assert.doesNotMatch(css,/lbmj-energy|energy-link|energy-spine/);
 assert.doesNotMatch(js,/pulseEnergy|lbmj-energy/);
 assert.match(js,/window\.lbOpenTrainProfile\(number,date,\{origin:'favorites'\}\)/);
 assert.match(js,/holder\.appendChild\(panel\)/);
 assert.match(js,/anchor\.parentNode\.insertBefore\(panel,anchor\.nextSibling\)/);
});
test('versioned assets and cache busting preserve the PWA upgrade',()=>{
 assert.match(page,/lb-my-journey-inline-v1\.css\?v=20261010-mini-buttons1/);
 assert.match(page,/lb-my-journey-inline-v1\.js\?v=20261010-mini-buttons1/);
 assert.match(worker,/CACHE_VERSION = 'v132'/);
});
