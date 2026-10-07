const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = fs.readFileSync(require('node:path').join(__dirname,'../assets/lb-index-core.js'),'utf8');
function block(a,b) { return core.slice(core.indexOf(a),core.indexOf(b,core.indexOf(a))); }
test('overlapping static requests share each train, across both date formats and server batch limit',async()=>{
 const calls=[];
 const ctx={Map,Set,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url)=>{calls.push(url);await new Promise(r=>setTimeout(r,10));const nums=new URL(url).searchParams.get('trains').split(',');assert.ok(nums.length<=50);return {ok:true,json:async()=>({trains:Object.fromEntries(nums.map(n=>[n,{stop_times:[{name:n}]}]))})};}};
 vm.createContext(ctx);vm.runInContext(block('const LB_FAST_STATIC_CACHE','function renderFastStaticPreview'),ctx);
 const nums=Array.from({length:60},(_,i)=>String(88000+i));
 const [a,b]=await Promise.all([ctx.loadFastStaticBatch('2026-10-07',nums),ctx.loadFastStaticBatch('20261007',['88000'])]);
 assert.equal(calls.length,2);assert.equal(Object.keys(a.trains).length,60);assert.ok(b.trains['88000']);
 await ctx.loadFastStaticBatch('20261007',nums);assert.equal(calls.length,2);
});
test('a failed static request can be retried without poisoning cache',async()=>{
 let calls=0;const ctx={Map,Set,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async()=>{if(++calls===1)throw new Error('offline');return {ok:true,json:async()=>({trains:{88740:{stop_times:[]}}})};}};
 vm.createContext(ctx);vm.runInContext(block('const LB_FAST_STATIC_CACHE','function renderFastStaticPreview'),ctx);
 await assert.rejects(ctx.loadFastStaticBatch('20261007',['88740']));assert.ok((await ctx.loadFastStaticBatch('20261007',['88740'])).trains['88740']);
});
test('list batch and detail share the same SNCF request and normalized date cache',async()=>{
 let calls=0;const ctx={Map,Set,URLSearchParams,AbortController,setTimeout,clearTimeout,console,VPS_BASE:'https://test',SNCF_FRONT_CACHE:new Map(),SNCF_FRONT_INFLIGHT:new Map(),SNCF_FRONT_TTL_MS:60000,fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {ok:true,status:200,json:async()=>({trains:{88740:{ok:true,data:{vehicle_journeys:[]}}}})};}};
 vm.createContext(ctx);vm.runInContext(block('async function fetchVehicleJourneyViaHub','// Fetch JSON générique'),ctx);
 await Promise.all([ctx.fetchVehicleJourneysBatchViaHub('20261007',['88740']),ctx.fetchVehicleJourneyViaHub('2026-10-07','88740')]);
 assert.equal(calls,1);await ctx.fetchVehicleJourneyViaHub('20261007','88740');assert.equal(calls,1);
});
const features=fs.readFileSync(require('node:path').join(__dirname,'../assets/lb-index-features.js'),'utf8');
test('full cancellation and partial terminus keep distinct stop states',()=>{
 const a=features.indexOf('  function applyEffectiveServicePattern('),b=features.indexOf('  function chooseStaticCandidate(',a);
 const ctx={impactForRow:row=>row.impact,isLegDeleted:(impact,leg)=>impact?.[leg+'_status']==='deleted',getGtfsDelayForStop:()=>null,normalizeStopKey:x=>x};
 vm.createContext(ctx);vm.runInContext(features.slice(a,b),ctx);
 const rows=['Metz','Thionville','Luxembourg'].map(name=>({name,arrival:'15:00',departure:'15:01'}));
 assert.ok(ctx.applyEffectiveServicePattern(rows,{status:'CANCELED'}).every(row=>row.isDeleted));
 const partial=rows.map((row,i)=>({...row,impact:i===2?{arrival_status:'deleted',departure_status:'deleted'}:null}));
 const out=ctx.applyEffectiveServicePattern(partial,{status:'PARTIAL'});
 assert.equal(out[0].isDeleted,false);assert.equal(out[1].isNewTerminus,true);assert.equal(out[2].isDeleted,true);
});
test('GTFS zeros cannot erase an explicit SNCF trip cancellation on repeated refresh',()=>{
 const cancelledHtml='<span class="deleted">15:57</span>';
 const cell={dataset:{baseTime:'155700',sncfTripCanceled:'1'},innerHTML:cancelledHtml};
 const row={dataset:{gare:'Luxembourg'},cells:[{},cell]};
 const table={querySelector:()=>({querySelectorAll:()=>[{dataset:{trainNumber:'88745'}}]}),tBodies:[{rows:[row]}]};
 const ctx={document:{querySelector:()=>table},console,isGtfsTrainClearlyRunning:()=>true,resetGtfsRetards:()=>{}};
 vm.createContext(ctx);
 const a=core.indexOf('function applyRetardsFromGTFS('),b=core.indexOf('/* ---------- ALERTES ---------- */',a);
 vm.runInContext(core.slice(a,b),ctx);
 for(let i=0;i<3;i++)ctx.applyRetardsFromGTFS({'88745':{Luxembourg:0}});
 assert.equal(cell.innerHTML,cancelledHtml);
 assert.equal(cell.dataset.gtfsDelayMinutes,undefined);
});
