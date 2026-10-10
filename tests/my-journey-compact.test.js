const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.css'),'utf8');
const src=fs.readFileSync(path.join(root,'_source/index.html'),'utf8');
const built=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('Compact single-line Matin/Soir UI replaces redundant title and note',()=>{
  assert.match(ui,/lbmj-head/);
  assert.match(ui,/Mon trajet<\/strong>/);
  assert.doesNotMatch(ui,/Mon trajet <span>LIVE/);
  assert.doesNotMatch(ui,/Données LIVE du TER/);
  assert.match(css,/\.lbmj-head\{\s*display:flex/);
  assert.match(css,/\.lbmj-select button\{[\s\S]*?min-height:28px!important/);
  assert.match(css,/\.lbmj-note\[hidden\]\{display:none!important\}/);
});
test('Small refresh action retains original button id and trigger',()=>{
  assert.equal((src.match(/id="trainDetailRefresh"/g)||[]).length,1);
  assert.equal((built.match(/id="trainDetailRefresh"/g)||[]).length,1);
  assert.match(src,/id="trainDetailRefresh"[^>]+aria-label="Actualiser la fiche"/);
  assert.match(css,/#trainDetailRefresh\{[\s\S]*?flex:0 0 32px!important/);
  assert.match(css,/#trainDetailRefresh\{[\s\S]*?max-width:32px!important/);
  const js=fs.readFileSync(path.join(root,'assets/lb-index-features.js'),'utf8');
  assert.match(js,/byId\('trainDetailRefresh'\)\?\.addEventListener\('click'/);
});
test('Status and incident details remain, only redundant sentence and unknown tracks are visually hidden',()=>{
  assert.match(ui,/circulation pr\[eé\]vue le/);
  assert.match(ui,/lbmj-next-redundant/);
  assert.match(ui,/voie non communiquée/);
  assert.match(css,/\.lbmj-next-redundant\{display:none!important\}/);
  assert.match(src,/id="trainDetailDisruption"/);
  assert.match(src,/id="trainDetailEvents"/);
  assert.match(src,/id="trainDetailNext"/);
  assert.match(src,/id="trainDetailStops"/);
});
test('Live panel and favourites continue to reuse same mount and actions',()=>{
  assert.match(ui,/holder\.appendChild\(panel\)/);
  assert.match(ui,/anchor\.parentNode\.insertBefore\(panel,anchor\.nextSibling\)/);
  assert.match(ui,/window\.lbOpenTrainProfile\(number,date,\{origin:'favorites'\}\)/);
  assert.match(ui,/setAttribute\('aria-pressed'/);
  assert.match(ui,/trafficLabel\.textContent=expandedTrafficLabel/);
  assert.match(src,/id="trainDetailFavorite"/);
  assert.match(src,/id="trainDetailReliabilityRuns"/);
});
