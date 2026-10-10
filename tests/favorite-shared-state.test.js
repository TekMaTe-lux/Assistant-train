const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'assets/lb-index-core.js'),'utf8');
const hero=fs.readFileSync(path.join(root,'assets/lb-index-features.js'),'utf8');
const siri=fs.readFileSync(path.join(root,'assets/home-major-alerts-core.js'),'utf8');
const html=fs.readFileSync(path.join(root,'_source/index.html'),'utf8');
const begin=core.indexOf('  const lbFavoriteJourneyLogic = ');
const end=core.indexOf('  const renderFavCard',begin);
assert.ok(begin>0&&end>begin);
const windowMock={};
const ctx=vm.createContext({window:windowMock,luxYmdToday:()=> '2026-10-10',Number,String,Array,Object,Math});
vm.runInContext(core.slice(begin,end),ctx);
const logic=windowMock.lbFavoriteJourneyLogic;

test('single state engine shared by homepage favorites and My Journey',()=>{
 assert.equal(typeof logic.selectUpcoming,'function');
 assert.equal(typeof logic.hasFinished,'function');
 assert.match(core,/lbFavoriteJourneyLogic\.selectUpcoming/);
 assert.match(core,/lbFavoriteJourneyLogic\.hasFinished/);
 assert.match(hero,/window\.lbFavoriteJourneyLogic/);
 assert.match(hero,/logic\?\.selectUpcoming\(options/);
});
test('select next calendar service with ordering and weekend, rejecting invalid dates/times',()=>{
 const result=logic.selectUpcoming([
  {day:'2026-10-13',clock:'06:20'},
  {day:'2026-10-12',clock:'06:20'},
  {day:'2026-10-11',clock:'xx:xx'},
  {day:'2026-10-09',clock:'06:20'}
 ],{today:'2026-10-10',futureOnly:true});
 assert.equal(result.day,'2026-10-12');
 assert.equal(logic.selectUpcoming([{day:'2026-10-10',clock:'18:00'}],{today:'2026-10-10',futureOnly:true}),null);
 assert.equal(logic.selectUpcoming([{day:'2026-10-12',clock:'06:20'}],{today:'2026-10-10',excludedDate:'2026-10-12'}),null);
});
test('GTFS next service does not claim operational confirmation',()=>{
 assert.equal(logic.isFutureService({nextServiceDate:'2026-10-12'}),true);
 assert.equal(logic.isFutureService({nextServiceDate:'2026-10-10'}),false);
 assert.match(logic.sourceLabel(true),/théorique GTFS/);
 assert.match(logic.sourceLabel(true),/non confirmé/);
 assert.match(core,/Horaire théorique GTFS, sous réserve de modifications/);
});
test('arrival safety keeps train visible after its theoretical arrival',()=>{
 assert.equal(logic.hasFinished({now:19*60+31,lastArrival:19*60+29}),false);
 assert.equal(logic.hasFinished({now:19*60+41,lastArrival:19*60+29}),false);
 assert.equal(logic.hasFinished({now:19*60+45,lastArrival:19*60+29}),true);
 assert.equal(logic.hasFinished({now:19*60+45,lastArrival:19*60+29,announcedDelay:25}),false);
 assert.equal(logic.hasFinished({now:19*60+45,lastArrival:19*60+29,canceled:true}),false);
 assert.equal(logic.hasFinished({now:19*60+45,lastArrival:NaN}),false);
});
test('no unverified automatic alternative and only existing search route is linked',()=>{
 assert.match(core,/class="lb-fav-find-other"/);
 assert.match(core,/href="#search"/);
 assert.match(html,/href="#search"/);
 assert.doesNotMatch(core,/confirme la correspondance automatiquement/);
});
test('SIRI impact maps to relevant home traffic segments only',()=>{
 const first=siri.indexOf('    const impact = { north: null, south: null };');
 const end=siri.indexOf('    countNode.textContent',first);
 assert.ok(first>0&&end>first);
 const section=siri.slice(first,end);
 const testImpact=(items)=>{
  const env={window:{},Event:function(name){this.type=name;},hasSubstitutionImpact:(text)=>/autocars? de substitution/.test(text),};
  env.window.dispatchEvent=()=>{};
  vm.runInNewContext(section, {...env,items});
  return env.window.__lbMajorTrafficImpact;
 };
 const works={text:'circulation perturbee entre metz et luxembourg des autocars de substitution sont mis en place',severity:{rank:5}};
 const north=testImpact([works]);
 assert.equal(north.north.level,'red');
 assert.equal(north.south,null);
 assert.equal(north.north.label,'TRAVAUX · CARS');
 assert.equal(testImpact([{text:'travaux en gare de metz',severity:{rank:2}}]).north,null);
 assert.equal(testImpact([{text:'circulation perturbee entre nancy et metz des autocars de substitution sont mis en place',severity:{rank:5}}]).south.level,'red');
 assert.match(core,/window\.__lbMajorTrafficImpact\?\.north \|\| n/);
 assert.match(core,/window\.addEventListener\('lb:major-traffic-updated'/);
});
test('refresh race cannot overwrite a newer favorite date',()=>{
 assert.match(core,/const generation = \+\+favWidgetGeneration/);
 assert.match(core,/if \(generation !== favWidgetGeneration\) return/);
});
