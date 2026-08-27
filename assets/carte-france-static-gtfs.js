(()=>{
'use strict';

const API='https://vps.labetaillere.fr';
const ZIP_URL='https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip';
const FRANCE_BOUNDS=L.latLngBounds([[41.20,-5.70],[51.35,9.85]]);
const filters={ter:true,tgv:true,intercites:true,autres:true};
const routeMap=new Map(),stopMap=new Map(),tripMeta=new Map(),infraCache=new Map();
let schedules=[],runs=[],currentPositions=[],selectedRunKey=null,selectedTime=null,liveTimer=null,serviceDayKey='';
let baseLayer=null,infraAbort=null,infraTimer=null,infraSerial=0;

const statusEl=document.getElementById('status');
const timeEl=document.getElementById('mapTime');
const liveBtn=document.getElementById('liveBtn');
const baseMapEl=document.getElementById('baseMap');
const detailEl=document.getElementById('detail');
const detailTitleEl=document.getElementById('detailTitle');
const detailMetaEl=document.getElementById('detailMeta');
const detailSubEl=document.getElementById('detailSub');
const stopsEl=document.getElementById('stops');

const map=L.map('map',{preferCanvas:true,zoomControl:false,attributionControl:false,fadeAnimation:false,zoomAnimation:true,markerZoomAnimation:false});
map.fitBounds(FRANCE_BOUNDS,{padding:[8,8]});
L.control.zoom({position:'bottomleft'}).addTo(map);
L.control.attribution({position:'bottomright',prefix:false}).addTo(map).addAttribution('© OpenStreetMap · SNCF Réseau · GTFS SNCF');

const tiles={
  standard:()=>L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:2}),
  faded:()=>L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:2}),
  bw:()=>L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:2}),
  satellite:()=>L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,updateWhenIdle:true,keepBuffer:2}),
  'sat-faded':()=>L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,updateWhenIdle:true,keepBuffer:2})
};

const infrastructureLayer=L.geoJSON(null,{renderer:L.canvas({padding:.35}),interactive:false,style:infraStyle}).addTo(map);
const trainLayer=L.layerGroup().addTo(map);

function setStatus(text){statusEl.textContent=text}
function setBaseMap(mode){
  if(!tiles[mode])mode='standard';
  if(baseLayer)map.removeLayer(baseLayer);
  document.body.classList.remove('mode-faded','mode-bw','mode-sat-faded');
  if(mode==='faded')document.body.classList.add('mode-faded');
  if(mode==='bw')document.body.classList.add('mode-bw');
  if(mode==='sat-faded')document.body.classList.add('mode-sat-faded');
  baseLayer=tiles[mode]().addTo(map);baseLayer.bringToBack();
  try{localStorage.setItem('lb-france-basemap',mode)}catch(_){ }
}
function infraStyle(feature){
  const p=feature?.properties||{},kind=String(p.kind||'classic').toLowerCase(),source=String(p.source||'').toUpperCase();
  if(source==='CFL')return{color:'#e83e8c',weight:1.9,opacity:.72};
  if(kind==='lgv')return{color:'#7457e8',weight:2.4,opacity:.84};
  if(kind==='connector')return{color:'#ff9f1c',weight:1.6,opacity:.78,dashArray:'5 5'};
  if(kind==='closed')return{color:'#727b86',weight:1,opacity:.35,dashArray:'4 5'};
  return{color:'#00a9c7',weight:1.45,opacity:.58};
}
function bboxString(){const b=map.getBounds();return[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(5)).join(',')}
function infraKey(){const b=map.getBounds(),z=Math.max(6,Math.min(11,map.getZoom()));return`${z}|${[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(2)).join(',')}`}
async function refreshInfrastructure(){
  if(map.getZoom()<6){infrastructureLayer.clearLayers();return}
  const key=infraKey();
  if(infraCache.has(key)){infrastructureLayer.clearLayers().addData(infraCache.get(key));return}
  const serial=++infraSerial;if(infraAbort)infraAbort.abort();infraAbort=new AbortController();
  try{
    const r=await fetch(`${API}/api/map-v2/infrastructure?bbox=${bboxString()}`,{signal:infraAbort.signal,headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error(String(r.status));
    const data=await r.json();if(serial!==infraSerial)return;
    infraCache.set(key,data);if(infraCache.size>6)infraCache.delete(infraCache.keys().next().value);
    infrastructureLayer.clearLayers().addData(data);
  }catch(e){if(e?.name!=='AbortError')console.warn('[france] infrastructure',e)}
}
function scheduleInfrastructure(delay=450){clearTimeout(infraTimer);infraTimer=setTimeout(refreshInfrastructure,delay)}

function csvLine(line){
  const out=[];let cur='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++}else quoted=false}else cur+=ch}
    else if(ch==='"')quoted=true;
    else if(ch===','){out.push(cur);cur=''}
    else cur+=ch;
  }
  out.push(cur);return out;
}
function forEachCsv(text,onRow){
  let pos=0,head=null,first=true;
  while(pos<=text.length){
    let end=text.indexOf('\n',pos);if(end<0)end=text.length;
    let line=text.slice(pos,end);pos=end+1;
    if(line.endsWith('\r'))line=line.slice(0,-1);
    if(!line){if(end===text.length)break;continue}
    const row=csvLine(line);
    if(first){first=false;head=Object.fromEntries(row.map((x,i)=>[x.replace(/^\uFEFF/,''),i]));}
    else onRow(row,head);
    if(end===text.length)break;
  }
}
function field(row,h,name){const i=h?.[name];return i==null?'':(row[i]??'')}
function dateKey(date){return`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`}
function normalizeDate(value){return String(value||'').replace(/\D/g,'').slice(0,8)}
function localTimeValue(date=new Date()){return`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}
function timeToSec(value){const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value||'').trim());return m?(Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0)):null}
function formatSec(sec){if(!Number.isFinite(sec))return'';const s=((sec%86400)+86400)%86400,h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function extractTrainNumber(...parts){const text=parts.filter(Boolean).join(' '),matches=[...text.matchAll(/(?:^|\D)(\d{4,6})(?!\d)/g)];return matches.length?matches[matches.length-1][1]:''}
function isRailRoute(route){if(!route)return true;const n=Number(route.type);return!Number.isFinite(n)||n===2||(n>=100&&n<200)}
function categoryFor(meta,route){
  const t=`${route?.short||''} ${route?.long||''} ${route?.desc||''} ${meta.headsign||''} ${meta.shortName||''} ${meta.tripId||''}`.toUpperCase();
  if(/TGV|INOUI|OUIGO|EUROSTAR|THALYS/.test(t))return'tgv';
  if(/INTERCIT/.test(t))return'intercites';
  if(/\bTER\b|REGIO2N|NOMAD|FLUO|ZOU|ALEOP|BREIZHGO|REMI/.test(t))return'ter';
  return'autres';
}
function categoryColor(cat){return cat==='tgv'?'#a76cff':cat==='intercites'?'#ffb347':cat==='ter'?'#00b9d8':'#b8c2cc'}
function dayName(date){return['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()]}
function addServiceOffset(map,sid,offset,on=true){
  if(!sid)return;let set=map.get(sid);if(!set){set=new Set();map.set(sid,set)}
  if(on)set.add(offset);else set.delete(offset);
  if(!set.size)map.delete(sid);
}
function zipFile(zip,name){return zip.file(name)||zip.file(name.replace(/^.*\//,''))||Object.values(zip.files).find(f=>!f.dir&&f.name.endsWith('/'+name))||null}
async function zipText(zip,name,required=true){const f=zipFile(zip,name);if(!f){if(required)throw new Error(`Fichier GTFS manquant : ${name}`);return''}return f.async('string')}

async function loadStaticGtfs(){
  document.body.classList.add('is-loading');
  routeMap.clear();stopMap.clear();tripMeta.clear();schedules=[];runs=[];currentPositions=[];trainLayer.clearLayers();
  if(typeof JSZip==='undefined')throw new Error('JSZip non chargé');

  const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  const todayKey=dateKey(now),yesterdayKey=dateKey(yesterday);serviceDayKey=todayKey;
  const serviceOffsets=new Map();

  setStatus('GTFS officiel · téléchargement…');
  const response=await fetch(ZIP_URL,{cache:'no-store',mode:'cors'});
  if(!response.ok)throw new Error(`GTFS SNCF : HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  setStatus(`GTFS officiel · ${(bytes.byteLength/1048576).toFixed(1)} Mo · décompression…`);
  const zip=await JSZip.loadAsync(bytes);

  const [calendarText,calendarDatesText,routesText,stopsText,tripsText]=await Promise.all([
    zipText(zip,'calendar.txt',false),zipText(zip,'calendar_dates.txt',false),zipText(zip,'routes.txt'),zipText(zip,'stops.txt'),zipText(zip,'trips.txt')
  ]);

  setStatus('GTFS 1/5 · services actifs…');
  if(calendarText){
    forEachCsv(calendarText,(row,h)=>{
      const sid=field(row,h,'service_id'),start=normalizeDate(field(row,h,'start_date')),end=normalizeDate(field(row,h,'end_date'));
      for(const [date,key,offset] of [[now,todayKey,0],[yesterday,yesterdayKey,-1]]){
        if(key>=start&&key<=end&&field(row,h,dayName(date))==='1')addServiceOffset(serviceOffsets,sid,offset,true);
      }
    });
  }
  if(calendarDatesText){
    forEachCsv(calendarDatesText,(row,h)=>{
      const sid=field(row,h,'service_id'),d=normalizeDate(field(row,h,'date')),ex=String(field(row,h,'exception_type')||'1').trim();
      if(d===todayKey)addServiceOffset(serviceOffsets,sid,0,ex!=='2');
      if(d===yesterdayKey)addServiceOffset(serviceOffsets,sid,-1,ex!=='2');
    });
  }
  if(!serviceOffsets.size)throw new Error(`Aucun service GTFS actif pour ${todayKey}`);

  setStatus(`GTFS 2/5 · ${serviceOffsets.size.toLocaleString('fr-FR')} services · référentiels…`);
  forEachCsv(routesText,(row,h)=>{
    const id=field(row,h,'route_id');if(!id)return;
    routeMap.set(id,{short:field(row,h,'route_short_name'),long:field(row,h,'route_long_name'),desc:field(row,h,'route_desc'),type:field(row,h,'route_type')});
  });
  forEachCsv(stopsText,(row,h)=>{
    const id=field(row,h,'stop_id');if(!id)return;
    const lat=Number(field(row,h,'stop_lat')),lon=Number(field(row,h,'stop_lon'));
    if(Number.isFinite(lat)&&Number.isFinite(lon))stopMap.set(id,{name:field(row,h,'stop_name')||id,lat,lon});
  });
  forEachCsv(tripsText,(row,h)=>{
    const sid=field(row,h,'service_id'),offsetSet=serviceOffsets.get(sid);if(!offsetSet||!offsetSet.size)return;
    const routeId=field(row,h,'route_id'),route=routeMap.get(routeId);if(!isRailRoute(route))return;
    const tripId=field(row,h,'trip_id');if(!tripId)return;
    const meta={tripId,serviceId:sid,routeId,headsign:field(row,h,'trip_headsign'),shortName:field(row,h,'trip_short_name'),offsets:[...offsetSet]};
    meta.category=categoryFor(meta,route);
    meta.number=meta.shortName||extractTrainNumber(meta.tripId,meta.headsign,route?.short,route?.long)||'Train';
    tripMeta.set(tripId,meta);
  });
  if(!tripMeta.size)throw new Error('Services trouvés mais aucun trajet ferroviaire actif');

  setStatus(`GTFS 3/5 · ${tripMeta.size.toLocaleString('fr-FR')} trajets · horaires…`);
  const stopTimesText=await zipText(zip,'stop_times.txt');
  const grouped=new Map();
  forEachCsv(stopTimesText,(row,h)=>{
    const tripId=field(row,h,'trip_id');if(!tripMeta.has(tripId))return;
    const stopId=field(row,h,'stop_id'),stop=stopMap.get(stopId);if(!stop)return;
    const arr=timeToSec(field(row,h,'arrival_time')),dep=timeToSec(field(row,h,'departure_time')),seq=Number(field(row,h,'stop_sequence'));
    let list=grouped.get(tripId);if(!list){list=[];grouped.set(tripId,list)}
    list.push({stopId,name:stop.name,lat:stop.lat,lon:stop.lon,arr,dep,seq:Number.isFinite(seq)?seq:list.length});
  });

  setStatus('GTFS 4/5 · construction des circulations…');
  for(const[tripId,stops]of grouped){
    if(stops.length<2)continue;stops.sort((a,b)=>a.seq-b.seq);
    const meta=tripMeta.get(tripId),first=stops[0],last=stops[stops.length-1];
    const firstSec=Number.isFinite(first.dep)?first.dep:first.arr,lastSec=Number.isFinite(last.arr)?last.arr:last.dep;
    if(!Number.isFinite(firstSec)||!Number.isFinite(lastSec)||lastSec<firstSec)continue;
    const sched={...meta,stops,firstSec,lastSec,origin:first.name,destination:last.name,route:routeMap.get(meta.routeId)||null};
    schedules.push(sched);
    for(const offset of meta.offsets)runs.push({key:`${tripId}|${offset}`,schedule:sched,offset,start:firstSec+offset*86400,end:lastSec+offset*86400});
  }

  document.body.classList.remove('is-loading');
  setStatus(`GTFS prêt · ${schedules.length.toLocaleString('fr-FR')} circulations du jour`);
  recomputePositions();refreshInfrastructure();
}

function stopEventWindow(stop){const arr=Number.isFinite(stop.arr)?stop.arr:stop.dep,dep=Number.isFinite(stop.dep)?stop.dep:stop.arr;return{arr,dep}}
function positionForRun(run,targetAbs){
  const s=run.schedule,rel=targetAbs-run.offset*86400,st=s.stops;if(rel<s.firstSec||rel>s.lastSec)return null;
  for(let i=0;i<st.length;i++){
    const w=stopEventWindow(st[i]);if(Number.isFinite(w.arr)&&Number.isFinite(w.dep)&&rel>=w.arr&&rel<=w.dep)return{lat:st[i].lat,lon:st[i].lon,index:i,progress:0,rel};
  }
  for(let i=0;i<st.length-1;i++){
    const a=st[i],b=st[i+1],wa=stopEventWindow(a),wb=stopEventWindow(b),t1=wa.dep,t2=wb.arr;if(!Number.isFinite(t1)||!Number.isFinite(t2)||t2<=t1)continue;
    if(rel>=t1&&rel<=t2){const p=Math.max(0,Math.min(1,(rel-t1)/(t2-t1)));return{lat:a.lat+(b.lat-a.lat)*p,lon:a.lon+(b.lon-a.lon)*p,index:i,progress:p,rel};}
  }
  const last=st[st.length-1];return{lat:last.lat,lon:last.lon,index:st.length-1,progress:1,rel};
}
function activeTargetSeconds(){const value=selectedTime||localTimeValue(),[h,m]=value.split(':').map(Number);return h*3600+m*60+(selectedTime?0:new Date().getSeconds())}
function recomputePositions(){
  if(!runs.length)return;
  const today=dateKey(new Date());if(today!==serviceDayKey&&!selectedTime){loadStaticGtfs().catch(showError);return}
  const target=activeTargetSeconds(),out=[];
  for(const run of runs){if(target<run.start||target>run.end)continue;const pos=positionForRun(run,target);if(!pos)continue;out.push({runKey:run.key,run,schedule:run.schedule,lat:pos.lat,lon:pos.lon,index:pos.index,progress:pos.progress,category:run.schedule.category,number:run.schedule.number});}
  currentPositions=out;renderTrains();
  const shown=out.filter(p=>filters[p.category]!==false).length;
  setStatus(`${shown.toLocaleString('fr-FR')} trains théoriques · ${selectedTime||localTimeValue()} · GTFS SNCF officiel`);
  if(selectedRunKey)refreshSelectedDetail();
}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function labelIcon(p){return L.divIcon({className:'train-icon',html:`<span class="train-marker ${escapeHtml(p.category)}"><span class="num">${escapeHtml(p.number)}</span></span>`,iconSize:[1,1],iconAnchor:[0,0]})}
function visibleBoundsPadded(){return map.getBounds().pad(.18)}
function renderTrains(){
  trainLayer.clearLayers();const mode=map.getZoom()<8?'dot':'label',bounds=visibleBoundsPadded();
  for(const p of currentPositions){
    if(filters[p.category]===false||!bounds.contains([p.lat,p.lon]))continue;
    let marker;
    if(mode==='dot'){
      const c=categoryColor(p.category);marker=L.circleMarker([p.lat,p.lon],{radius:3.1,color:c,weight:1.2,fillColor:c,fillOpacity:.83,opacity:.95,bubblingMouseEvents:false});
    }else marker=L.marker([p.lat,p.lon],{icon:labelIcon(p),keyboard:false,riseOnHover:true,bubblingMouseEvents:false});
    marker.on('click',e=>{L.DomEvent.stopPropagation(e);openDetail(p)});marker.addTo(trainLayer);
  }
}
function openDetail(p){selectedRunKey=p.runKey;refreshSelectedDetail()}
function refreshSelectedDetail(){
  const p=currentPositions.find(x=>x.runKey===selectedRunKey);if(!p){detailEl.hidden=true;return}
  const s=p.schedule,route=s.route||{};
  detailTitleEl.textContent=`${String(s.category||'train').toUpperCase()} ${s.number}`;
  detailMetaEl.textContent=`${s.origin} → ${s.destination}`;
  detailSubEl.textContent=[route.short,route.long].filter(Boolean).join(' · ');
  stopsEl.innerHTML=s.stops.map((stop,i)=>{const t=Number.isFinite(stop.dep)?stop.dep:stop.arr;return`<li class="${i===p.index?'current':''}"><span class="stop-time">${escapeHtml(formatSec(t))}</span><span class="stop-name">${escapeHtml(stop.name)}</span></li>`}).join('');
  detailEl.hidden=false;
}
function closeDetail(){selectedRunKey=null;detailEl.hidden=true}
function showError(error){console.error('[france]',error);document.body.classList.remove('is-loading');setStatus(`Erreur GTFS · ${error?.message||error}`)}
function updateAllButton(){const all=Object.values(filters).every(Boolean);document.getElementById('allBtn')?.classList.toggle('is-active',all)}

document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.filter;filters[key]=!filters[key];btn.classList.toggle('is-active',filters[key]);updateAllButton();renderTrains();const shown=currentPositions.filter(p=>filters[p.category]!==false).length;setStatus(`${shown.toLocaleString('fr-FR')} trains théoriques · ${selectedTime||localTimeValue()} · GTFS SNCF officiel`)}));
document.getElementById('allBtn')?.addEventListener('click',()=>{const turnOn=!Object.values(filters).every(Boolean);for(const k of Object.keys(filters))filters[k]=turnOn;document.querySelectorAll('[data-filter]').forEach(btn=>btn.classList.toggle('is-active',turnOn));updateAllButton();renderTrains()});
document.getElementById('franceBtn')?.addEventListener('click',()=>map.fitBounds(FRANCE_BOUNDS,{padding:[8,8]}));
document.getElementById('closeDetail')?.addEventListener('click',closeDetail);
baseMapEl?.addEventListener('change',()=>setBaseMap(baseMapEl.value));
timeEl.value=localTimeValue();
timeEl.addEventListener('change',()=>{selectedTime=timeEl.value||null;liveBtn.classList.toggle('is-active',!selectedTime);recomputePositions()});
liveBtn.addEventListener('click',()=>{selectedTime=null;timeEl.value=localTimeValue();liveBtn.classList.add('is-active');recomputePositions()});
map.on('moveend',()=>{renderTrains();scheduleInfrastructure(450)});
map.on('zoomend',()=>{renderTrains();scheduleInfrastructure(250)});
map.on('click',closeDetail);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!selectedTime){timeEl.value=localTimeValue();recomputePositions()}});

let savedBase='standard';try{savedBase=localStorage.getItem('lb-france-basemap')||'standard'}catch(_){ }if(!tiles[savedBase])savedBase='standard';baseMapEl.value=savedBase;setBaseMap(savedBase);
clearInterval(liveTimer);liveTimer=setInterval(()=>{if(!document.hidden&&!selectedTime){timeEl.value=localTimeValue();recomputePositions()}},10000);
loadStaticGtfs().catch(showError);
})();