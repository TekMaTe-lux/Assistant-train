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

function runningContext() {
 const ctx={window:{retardsGTFS:{}},Date,console,getGtfsTrainMeta:bucket=>bucket?.meta||{},normalizeStationName:x=>String(x).toLowerCase()};
 vm.createContext(ctx);
 vm.runInContext(block('function getGtfsRunningServiceState(', 'function mergeGtfsNormalizedPayloads('),ctx);
 return ctx;
}
test('reinstatement requires a fresh explicit SNCF running status covering every stop',()=>{
 const ctx=runningContext();const bucket={Luxembourg:0,Thionville:0,Metz:0,meta:{status:'ON_TIME',data_source:'gtfs_rt',feed_generated_at:new Date().toISOString()}};
 bucket.meta.service_stops=bucket;
 ctx.window.retardsGTFS['88745']=bucket;
 assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Thionville','Metz']).status,'ON_TIME');
 bucket.meta.status='DELAYED';bucket.Metz=7;
 assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Thionville','Metz']).maxDelay,7);
 for(const status of ['CANCELED','PARTIAL_CANCELLATION','SCHEDULED','']){bucket.meta.status=status;assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);}
 bucket.meta.status='ON_TIME';delete bucket.Metz;
 assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
 bucket.Metz=null;assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
 bucket.Metz=0;bucket.meta.data_source='cfl-hafas';assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
 bucket.meta.data_source='gtfs_rt';bucket.meta.feed_generated_at=new Date(Date.now()-6*60000).toISOString();assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
 bucket.meta.feed_generated_at=new Date().toISOString();bucket.meta.canceled_stops=['Metz'];assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
});
test('old SNCF cancellation restores only on confirmed reinstatement and comes back if proof disappears',()=>{
 const cancelledHtml='<span class="deleted">15:57<span class="voie-badge">Voie 9</span></span>';
 const cell={dataset:{baseTime:'155700',sncfTripCanceled:'1'},innerHTML:cancelledHtml,querySelector:selector=>selector==='.voie-badge'&&cell.innerHTML.includes('voie-badge')?{textContent:'Voie 9'}:selector.includes('.deleted')&&cell.innerHTML.includes('deleted')?{}:null};
 const row={dataset:{gare:'Luxembourg'},cells:[{},cell]};
 const icon={dataset:{},textContent:'❌',title:'Train supprimé'};
 const header={dataset:{trainNumber:'88745',sncfCanceledStops:'["Luxembourg"]'},querySelector:()=>icon};
 const table={querySelector:()=>({querySelectorAll:()=>[header]}),tBodies:[{rows:[row]}]};
 let confirmed=false;
 const ctx={document:{querySelector:()=>table},console,isGtfsTrainClearlyRunning:()=>true,getGtfsRunningServiceState:()=>confirmed?{status:'ON_TIME',maxDelay:0}:null,resetGtfsRetards:()=>{},ft:()=> '15:57',escapeHtml:x=>x,formatClockWithVoie:(clock,voie)=>clock+'<span class="voie-badge">'+voie+'</span>'};
 vm.createContext(ctx);
 const a=core.indexOf('function applyRetardsFromGTFS('),b=core.indexOf('/* ---------- ALERTES ---------- */',a);
 vm.runInContext(core.slice(a,b),ctx);
 ctx.applyRetardsFromGTFS({'88745':{Luxembourg:0}});assert.equal(cell.innerHTML,cancelledHtml);assert.equal(icon.textContent,'❌');
 confirmed=true;
 for(let i=0;i<3;i++){ctx.applyRetardsFromGTFS({'88745':{Luxembourg:0}});assert.ok(cell.innerHTML.includes('voie-badge'));assert.ok(cell.innerHTML.includes('Voie 9'));}
 assert.ok(cell.innerHTML.includes('gtfs-restored'));assert.equal(icon.textContent,'↺');
 confirmed=false;cell.innerHTML=cancelledHtml;ctx.applyRetardsFromGTFS({'88745':{Luxembourg:0}});
 assert.equal(cell.innerHTML,cancelledHtml);assert.equal(icon.textContent,'❌');
});
test('detail lifts full cancellation using shared proof but preserves explicit canceled stops',()=>{
 const a=features.indexOf('  function applyEffectiveServicePattern('),b=features.indexOf('  function chooseStaticCandidate(',a);
 const ctx={impactForRow:row=>row.impact,isLegDeleted:(impact,leg)=>impact?.[leg+'_status']==='deleted',getGtfsDelayForStop:()=>0,isGtfsTrainClearlyRunning:()=>true,getGtfsRunningServiceState:()=>({status:'ON_TIME',maxDelay:0}),normalizeStopKey:x=>x,Set};
 vm.createContext(ctx);vm.runInContext(features.slice(a,b),ctx);
 const rows=['Luxembourg','Thionville','Metz'].map(name=>({name,arrival:'15:00',departure:'15:01',impact:{arrival_status:'deleted',departure_status:'deleted'}}));
 assert.ok(ctx.applyEffectiveServicePattern(rows,{number:'88745',status:'CANCELED',bucket:{}}).every(row=>!row.isDeleted));
 ctx.getGtfsRunningServiceState=()=>null;
 assert.ok(ctx.applyEffectiveServicePattern(rows,{number:'88745',status:'CANCELED',bucket:{}}).every(row=>row.isDeleted));
 const partial=ctx.applyEffectiveServicePattern(rows,{number:'88745',status:'PARTIAL',bucket:{},canceledStopKeys:new Set(['Metz'])});
 assert.equal(partial[0].isDeleted,false);assert.equal(partial[1].isNewTerminus,true);assert.equal(partial[2].isDeleted,true);
});

test('CFL merge cannot complete missing SNCF stops for a total reinstatement',()=>{
 const ctx=runningContext();ctx.window.retardsGTFS['88745']={Luxembourg:0,Metz:0,meta:{status:'ON_TIME',data_source:'gtfs_rt',feed_generated_at:new Date().toISOString(),service_stops:{Metz:0}}};
 assert.equal(ctx.getGtfsRunningServiceState('88745',['Luxembourg','Metz']),null);
});
test('LIVE first paint clears a stale cancellation cause only with the shared running proof',()=>{
 const a=features.indexOf('  function extractLiveTrains()'),b=features.indexOf('  window.extractLiveTrains',a);
 let confirmed=true;
 const ctx={window:{retardsGTFS_RAW:{}},getRawLiveTrainPayload:()=>({trains:{88745:{status:'ON_TIME',stops:{Luxembourg:0,Metz:0}}}}),buildSncfCauseIndex:()=>null,normalizeKey:String,getSncfCauseForTrain:()=> 'Ancienne suppression',classifyOfficialLiveDisruption:()=>({statusClass:'cancel',statusLabel:'Supprimé'}),getGtfsRunningServiceState:()=>confirmed?{status:'ON_TIME',maxDelay:0}:null};
 vm.createContext(ctx);vm.runInContext(features.slice(a,b),ctx);
 assert.equal(ctx.extractLiveTrains()[0].statusClass,'ok');assert.equal(ctx.extractLiveTrains()[0].sncfCause,'');
 confirmed=false;assert.equal(ctx.extractLiveTrains()[0].statusClass,'cancel');
});
test('LIVE reuses the already received HUB cancellation for an immediate reinstatement label, including delay',()=>{
 const a=features.indexOf('  function extractLiveTrains()'),b=features.indexOf('  window.extractLiveTrains',a);
 let cached=true;
 const ctx={window:{retardsGTFS_RAW:{}},getRawLiveTrainPayload:()=>({trains:{88745:{status:'DELAYED',stops:{Luxembourg:8,Metz:8}}}}),buildSncfCauseIndex:()=>null,normalizeKey:String,getSncfCauseForTrain:()=>'',classifyOfficialLiveDisruption:()=>({statusClass:'',statusLabel:''}),getGtfsRunningServiceState:()=>({status:'DELAYED',maxDelay:8}),getCachedSncfVehicleJourney:()=>cached?{}:null,toYmd:()=> '2026-10-07',extractSncfHubLiveInfo:()=>({statusClass:'cancel',train:{stop_times:[{stop_point:{name:'Luxembourg'}},{stop_point:{name:'Metz'}}]}})};
 vm.createContext(ctx);vm.runInContext(features.slice(a,b),ctx);
 const train=ctx.extractLiveTrains()[0];assert.equal(train.statusClass,'delay');assert.equal(train.statusLabel,'Remis en circulation · +8 min');assert.equal(train.reinstated,true);
 cached=false;assert.equal(ctx.extractLiveTrains()[0].statusLabel,'+8 min');assert.equal(ctx.extractLiveTrains()[0].reinstated,false);
});
test('realtime payload supplies Luxembourg platforms immediately without another request or overriding station data',async()=>{
 const calls=[],events=[];const raw={data:{'TER 88745':{Luxembourg:{platform:'9',delay:0},Bettembourg:{platform:'2',delay:0}}}};
 const ctx={window:{},Map,Set,Date,console,CustomEvent:class{constructor(type){this.type=type;}},GTFS_RT_USE_CACHED_FIRST:false,GTFS_RT_DATASETS:[{id:'cfl-hafas'}],fetchGtfsDataset:async dataset=>{calls.push(dataset.id);return {...dataset,normalized:{},raw,source:'HAFAS'};},mergeGtfsNormalizedPayloads:()=>({}),persistGtfsRetardsCache:()=>{},tryApplyGtfsToCurrentTable:()=>{},normalizeVoiesTrainKey:x=>String(x).toLowerCase().replace(/^train\s+/,''),};
 ctx.window.dispatchEvent=e=>events.push(e.type);vm.createContext(ctx);
 vm.runInContext(block('function normalizeCflVoiesTrainKey(', 'async function loadCflVoiesByTrain('),ctx);
 vm.runInContext(block('async function loadGtfsRetards(', '// 1er chargement + rafraîchissement intelligent'),ctx);
 await ctx.loadGtfsRetards();assert.deepEqual(calls,['cfl-hafas']);assert.equal(ctx.window.cflVoiesByTrainMap.get('88745').get('luxembourg'),'9');assert.ok(events.includes('lb:voies-loaded'));
 ctx.cflVoiesByTrainPromise=null;ctx.HAFAS_PROXY_CANDIDATES=['https://test/rt'];ctx.HAFAS_BY_STATION_CANDIDATES=['https://test/station'];
 const voieCalls=[];ctx.fetch=async url=>{voieCalls.push(url);return {ok:true,json:async()=>url.endsWith('/station')?{stations:{Luxembourg:{departures:[{train:'TER 88745',platform:'8'}]}}}:raw};};
 vm.runInContext(block('async function loadCflVoiesByTrain(', 'function getCflVoiesForTrain('),ctx);
 await ctx.loadCflVoiesByTrain();assert.equal(voieCalls.length,2);assert.equal(ctx.window.cflVoiesByTrainMap.get('88745').get('luxembourg'),'8');
 const current=ctx.window.cflVoiesByTrainMap;await ctx.loadGtfsRetards();assert.equal(ctx.window.cflVoiesByTrainMap,current);assert.equal(current.get('88745').get('luxembourg'),'8');
});
