const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'assets/lb-index-core.js'),'utf8');
const begin=src.indexOf('  const lbFavoriteHasEndedToday = ');
const end=src.indexOf('  window.updateFavoriteWidgetFromPrefs = ',begin);
assert.ok(begin > 0 && end > begin,'selection helpers exist');
const sharedBegin=src.indexOf('  const lbFavoriteJourneyLogic = ');
const sharedEnd=src.indexOf('  const renderFavCard = ',sharedBegin);
assert.ok(sharedBegin>0 && sharedEnd>sharedBegin);
const rules=src.slice(sharedBegin,sharedEnd)+src.slice(begin,end);
const future={nextServiceDate:'2026-10-12',nextServiceLabel:'lundi 12 octobre',train:{stop_times:[{departure_time:'17:39'},{arrival_time:'19:11'}]}};
const today={train:{stop_times:[{departure_time:'17:39'},{arrival_time:'19:29'}]},disruptions:[]};
const canceled={...today,disruptions:[{severity:{effect:'no_service'}}]};
function harness({now=22*60+20,rows=[{plannedMin:17*60+39,amendedMin:null,isDeleted:false},{plannedMin:19*60+29,amendedMin:null,isDeleted:false}],delay=0,next=future}={}){
 const calls={static:0,next:0};
 const ctx=vm.createContext({console,window:{
   lbLoadTrainStaticToday:async()=>{calls.static++;},
   lbGetTrainStaticNextPayload:()=>{calls.next++;return next;}
 },
 buildFavStopRows:()=>rows,
 computeWidgetState:()=>({now,arrLast:19*60+29}),
 computeMaxDelayMin:()=>delay,
 inferRealtimeStatusFromDisruptions:payload=>payload?.disruptions?.some(x=>x.severity.effect==='no_service')?'canceled':null,
 luxYmdToday:()=> '2026-10-10',
 Number,String,Math});
 vm.runInContext(rules+'\nthis.lbFavoriteDisplayPayload=lbFavoriteDisplayPayload;',ctx);
 return {ctx,calls};
}
test('88532 finished Saturday: next Monday displayed',async()=>{
 const {ctx,calls}=harness();
 const result=await ctx.lbFavoriteDisplayPayload('88532',today);
 assert.equal(result.nextServiceDate,'2026-10-12');
 assert.deepEqual(calls,{static:1,next:1});
});
test('88501 future Monday: future calendar already selected, no duplicate network',async()=>{
 const {ctx,calls}=harness();
 const result=await ctx.lbFavoriteDisplayPayload('88501',future);
 assert.equal(result.nextServiceDate,'2026-10-12');
 assert.equal(calls.static,0);
});
test('before departure / in progress: keep live SNCF and no static fetch',async()=>{
 for(const now of [16*60,18*60,19*60+29]){
  const {ctx,calls}=harness({now});
  const result=await ctx.lbFavoriteDisplayPayload('88532',today);
  assert.equal(result,today);
  assert.equal(calls.static,0);
 }
});
test('a late train keeps live state until its revised arrival, even after planned terminus',async()=>{
 const {ctx,calls}=harness({now:19*60+35,delay:25});
 assert.equal(await ctx.lbFavoriteDisplayPayload('88532',today),today);
 assert.equal(calls.static,0);
 const withAmended=harness({now:19*60+35,delay:25,rows:[{plannedMin:17*60+39,isDeleted:false},{plannedMin:19*60+29,amendedMin:19*60+50,isDeleted:false}]});
 assert.equal(await withAmended.ctx.lbFavoriteDisplayPayload('88532',today),today);
 assert.equal(withAmended.calls.static,0);
});
test('day cancellation stays visible even after scheduled arrival',async()=>{
 const {ctx,calls}=harness();
 assert.equal(await ctx.lbFavoriteDisplayPayload('88532',canceled),canceled);
 assert.equal(calls.static,0);
});
test('partially canceled effective end can switch after the remaining journey has ended',async()=>{
 const {ctx}=harness({rows:[{plannedMin:17*60+39,isDeleted:false},{plannedMin:18*60+55,isDeleted:false},{plannedMin:19*60+29,isDeleted:true}]});
 assert.equal((await ctx.lbFavoriteDisplayPayload('88532',today)).nextServiceDate,'2026-10-12');
});
test('bad or stale calendar never replaces verified current history',async()=>{
 for(const next of [null,{...future,nextServiceDate:'2026-10-10'},{...future,nextServiceDate:'2026-10-09'},{...future,train:{stop_times:[]}}]){
  const {ctx}=harness({next});
  assert.equal(await ctx.lbFavoriteDisplayPayload('88532',today),today);
 }
});
test('same helper applies to both AM and PM; the home preview keeps PROCHAIN explicit',async()=>{
 const {ctx,calls}=harness();
 const [a,b]=await Promise.all([
   ctx.lbFavoriteDisplayPayload('88501',today),
   ctx.lbFavoriteDisplayPayload('88532',today)
 ]);
 assert.equal(a.nextServiceDate,'2026-10-12');
 assert.equal(b.nextServiceDate,'2026-10-12');
 assert.match(src,/lbFavoriteDisplayPayload\(favAM, amToday\)/);
 assert.match(src,/lbFavoriteDisplayPayload\(favPM, pmToday\)/);
 assert.match(src,/return '<span class="fav-state-badge fav-state-before">PROCHAIN<\/span>'/);
 assert.match(src,/lbRenderHomeFavPreview\(\)/);
 assert.equal(calls.static,2); // Called twice, but loadTrainStaticToday shares its promise/cache
});
test('existing line/disruption/render paths remain intact',()=>{
 assert.match(src,/renderFavCard\('AM', favAM, amShown\)/);
 assert.match(src,/renderFavCard\('PM', favPM, pmShown\)/);
 assert.match(src,/inferRealtimeStatusFromDisruptions\(payload\)/);
 assert.match(src,/buildFavStopsDetails\(payload, trainId, st.now, canceledState, \{ forceDeleted:true \}\)/);
});
