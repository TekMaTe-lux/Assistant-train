/* La Bétaillère — dedicated CFL details; never handles SNCF trains. */
(function(){
'use strict';
if(window.lbOpenCflMapDetail)return;
const GTFS='https://vps.labetaillere.fr/api/cfl-trip';
const HIM='https://vps.labetaillere.fr/g/d14c83e7';
let layer=null, token=0, cachedEvents=null, cacheTime=0, pending=null;
const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=(x)=>{const m=String(x||'').match(/^(\d{1,3}):(\d\d)/);return m?String(Number(m[1])%24).padStart(2,'0')+':'+m[2]:'—';};
function stripMarkup(s){return String(s||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').trim();}
function init(){
 if(layer)return;
 const style=document.createElement('style');
 style.textContent=[
 '.lb-cfl-sheet-bg{position:fixed;inset:0;z-index:200000;background:rgba(0,6,18,.7);display:flex;align-items:flex-end;justify-content:center;color:#ecf9ff;font:500 14px/1.4 Rajdhani,system-ui,sans-serif}',
 '.lb-cfl-sheet-bg[hidden]{display:none!important}',
 '.lb-cfl-sheet{box-sizing:border-box;width:min(650px,100%);max-height:89vh;max-height:89dvh;overflow-y:auto;padding:16px 15px max(20px,env(safe-area-inset-bottom));background:linear-gradient(145deg,#092037,#03101f 68%);border:1px solid #24677c;border-radius:17px 17px 0 0;box-shadow:0 -12px 55px #000b}',
 '.lb-cfl-sheet-hd{position:sticky;top:-16px;z-index:2;display:flex;gap:10px;align-items:center;background:#071a2d;border-bottom:1px solid #24566b;padding:10px 0}',
 '.lb-cfl-sheet-hd h2{margin:0;font-size:20px;font-weight:900;color:#fff}',
 '.lb-cfl-sheet-kicker{font-size:10px;color:#6be3f4;letter-spacing:.12em}',
 '.lb-cfl-sheet-close{margin-left:auto;flex:0 0 36px;width:36px;height:36px;border-radius:10px;border:1px solid #326479;background:#082438;color:#fff;font-size:22px;cursor:pointer}',
 '.lb-cfl-sheet-route{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#0b283d;border:1px solid #29546a;border-radius:11px;padding:11px;margin:13px 0}',
 '.lb-cfl-sheet-route b{font-size:23px;line-height:1.15;display:block;color:#fff}',
 '.lb-cfl-sheet-route small{font-size:12px;color:#b3d3e1}',
 '.lb-cfl-sheet-route i{font-style:normal;color:#5de5f4;font-size:23px}',
 '.lb-cfl-sheet-state{background:#152b3b;border:1px solid #446376;border-radius:9px;padding:10px;font-weight:800;font-size:13px;color:#d9edf6}',
 '.lb-cfl-sheet-state.cancel{background:#421729;color:#ffdee5;border-color:#b84964}',
 '.lb-cfl-sheet-block{margin-top:15px}',
 '.lb-cfl-sheet-block h3{margin:0 0 9px;text-transform:uppercase;font-size:13px;color:#74e9f5;letter-spacing:.07em}',
 '.lb-cfl-sheet-incident{background:#341b2a;border:1px solid #8c445e;border-radius:10px;padding:11px;white-space:pre-line;color:#ffedf1;font-size:13px;line-height:1.5}',
 '.lb-cfl-sheet-incident strong{display:block;font-size:14px;margin-bottom:4px}',
 '.lb-cfl-sheet-stop{display:grid;grid-template-columns:52px 12px minmax(0,1fr) auto;gap:8px;align-items:center;border-left:1px solid #144458;padding:9px 0}',
 '.lb-cfl-sheet-stop .dot{height:10px;width:10px;border-radius:100%;background:#09364a;border:2px solid #55cfe6}',
 '.lb-cfl-sheet-stop b{color:#f5ffff;font-size:13px}.lb-cfl-sheet-stop small{display:block;color:#b0ccd9;font-size:11px}',
 '.lb-cfl-sheet-stop .delay{color:#ffb761;font-weight:900}',
 '.lb-cfl-sheet-stop.is-cancelled{opacity:.88;border-left:2px solid #e24968;background:rgba(107,18,42,.18)}',
 '.lb-cfl-sheet-stop.is-cancelled .dot{border-color:#ef526f;background:#5c142b}',
 '.lb-cfl-sheet-stop .planned.is-struck{text-decoration:line-through;opacity:.65}',
 '.lb-cfl-sheet-stop .new-time{color:#fcd1a1;margin-left:5px;font-size:13px}',
 '.lb-cfl-sheet-stop .stop-state{font-weight:900;color:#ff5878;font-size:11px;white-space:nowrap}',
 '.lb-cfl-sheet-stop .delay.ontime{color:#7ee9bc}',
 '.lb-cfl-sheet-stop .delay.estimated{color:#f9b674}',
 '.lb-cfl-sheet-stop .stop-voie{font-size:11px;color:#8ef3ff;font-weight:800}',
 '.lb-cfl-sheet-state.partial{background:#3b2417;color:#ffdaac;border-color:#9d6528}',
 '.lb-cfl-sheet-note{color:#99b9c9;font-size:11px;margin-top:13px;line-height:1.5}',
 '@media(min-width:760px){.lb-cfl-sheet-bg{align-items:center}.lb-cfl-sheet{border-radius:15px;max-height:80vh}}'
 ].join('\n');
 document.head.appendChild(style);
 layer=document.createElement('div');
 layer.className='lb-cfl-sheet-bg';
 layer.hidden=true;
 layer.innerHTML='<section class="lb-cfl-sheet" role="dialog" aria-modal="true" aria-label="Fiche détaillée CFL" tabindex="-1">'+
 '<div class="lb-cfl-sheet-hd"><div><div class="lb-cfl-sheet-kicker">LA BÉTAILLÈRE · INFO TRAIN</div><h2 id="lbCflDetailTitle">Train CFL</h2></div>'+
 '<button class="lb-cfl-sheet-close" type="button" aria-label="Fermer la fiche">×</button></div>'+
 '<div id="lbCflDetailRoute"></div><div id="lbCflDetailState" class="lb-cfl-sheet-state"></div>'+
 '<div id="lbCflDetailIncidents"></div><div id="lbCflDetailStops"></div>'+
 '<p class="lb-cfl-sheet-note">Horaires et informations susceptibles d’évoluer. Les heures annoncées ne confirment pas forcément le passage du train.</p></section>';
 document.body.appendChild(layer);
 layer.addEventListener('click',e=>{if(e.target===layer||e.target.closest('.lb-cfl-sheet-close'))close();});
 document.addEventListener('keydown',e=>{if(!layer.hidden&&e.key==='Escape')close();});
}
const node=id=>document.getElementById('lbCflDetail'+id);
function close(){if(layer){layer.hidden=true;token++;}}

const STOPS_URL='https://vps.labetaillere.fr/gtfs/cfl_live_stops.json';
let stopCache=null,stopCacheAt=0,stopPending=null;

function normalizeStation(value){
 return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
   .replace(/[-_,.;/]+/g,' ').replace(/\b(?:gare centrale|gare)\b/g,' ')
   .replace(/\s+/g,' ').trim();
}
const minutes=(time)=>{
 const m=String(time||'').match(/^(\d{1,3}):(\d\d)/);
 return m?(Number(m[1])*60+Number(m[2])):null;
};
function changedClock(time,delay){
 const min=minutes(time),diff=Number(delay);
 if(min==null||!Number.isFinite(diff))return '';
 const updated=((min+Math.round(diff))%1440+1440)%1440;
 return String(Math.floor(updated/60)).padStart(2,'0')+':'+String(updated%60).padStart(2,'0');
}
function fromArchive(info,payload){
 if(!payload||payload.version!==1)return null;
 let label=(info.type+' '+info.number).trim().toUpperCase();
 const all=payload.trains||{};
 let journeys=all[label];
 if(!Array.isArray(journeys)){
  const choices=Object.keys(all).filter(k=>new RegExp('(?:^|\\D)'+info.number+'$').test(k));
  if(choices.length===1) {label=choices[0];journeys=all[label];}
 }
 const matches=Array.isArray(journeys)?journeys.filter(j=>j.date===info.date):[];
 const expected=minutes(info.time);
 const pick=matches.slice().sort((a,b)=>{
  const distance=j=>{
   const planned=minutes(j.stops?.[0]?.planned);
   return planned!=null&&expected!=null?Math.abs(planned-expected):999999;
  };
  return distance(a)-distance(b)||b.lastSeen-a.lastSeen;
 })[0];
 const arrival=payload.arrivals?.[label];
 return {stops:pick?.stops||[],arrival:arrival?.date===info.date?arrival:null};
}
function readStopData(){
 if(stopCache&&Date.now()-stopCacheAt<120000)return Promise.resolve(stopCache);
 if(stopPending)return stopPending;
 stopPending=fetch(STOPS_URL,{cache:'no-store',credentials:'omit'})
  .then(r=>{if(!r.ok)throw Error('CFL stop cache HTTP '+r.status);return r.json();})
  .then(j=>{if(j?.version!==1||!j.trains)throw Error('CFL stop cache schema');stopCache=j;stopCacheAt=Date.now();return j;})
  .finally(()=>{stopPending=null;});
 return stopPending;
}
function stopObservation(stop,view){
 const key=normalizeStation(stop?.name);
 let observed=(view.selected?.stops||[]).filter(s=>normalizeStation(s.name)===key);
 const time=minutes(stop?.departure||stop?.arrival);
 observed=observed.sort((a,b)=>{
  const dist=s=>{const n=minutes(s.planned);return n!=null&&time!=null?Math.abs(n-time):999999;};
  return dist(a)-dist(b);
 });
 let result=observed[0]||null;
 if(result&&result.planned&&time!=null&&minutes(result.planned)!=null&&
    Math.abs(minutes(result.planned)-time)>20)result=null;
 // The arrivals feed has more precise terminus arrival/track data than departures.
 if(view.selected?.arrival&&key===normalizeStation(view.selected.arrival.station||'Luxembourg')){
  const arr=view.selected.arrival;
  const arrivalPlanned=minutes(arr.planned),gtfsPlanned=minutes(stop?.arrival||stop?.departure);
  if(arrivalPlanned==null||gtfsPlanned==null||Math.abs(arrivalPlanned-gtfsPlanned)<25){
   result={
    name:stop.name,planned:arr.planned||stop.arrival||stop.departure,
    delay:arr.cancelled?null:arr.delay,cancelled:!!arr.cancelled,
    platform:arr.platform,seenEpoch:null,forecast:arr.forecast,
    supplement:'arrivals'
   };
  }
 }
 if(result)return result;
 const fallback=(view.info.observedStops||[]).find(s=>normalizeStation(s.name)===key);
 return fallback?{...fallback,delay:fallback.delayMinutes,cancelled:false,supplement:'map'}:null;
}
function renderAll(view){
 const stops=view.gtfsStops||[];
 if(!stops.length){node('Stops').innerHTML='<p>Parcours prévu momentanément indisponible.</p>';return;}
 const fullNotice=(view.events||[]).some(e=>
   /\bce train est supprim[eé]/i.test(stripMarkup(e.text||e.detail||'')) &&
   !/supprim[eé].*entre\s+/i.test(stripMarkup(e.text||e.detail||'')));
 const records=stops.map(s=>{
   let obs=stopObservation(s,view);
   if(fullNotice)obs={...(obs||{}),cancelled:true,delay:null,supplement:'him'};
   return {stop:s,obs};
 });
 const first=records[0],last=records[records.length-1];
 function plannedTime(s,obs){
  const base=clock(s.departure||s.arrival);
  const candidate=clock(obs?.planned);
  if(obs?.planned&&minutes(base)!=null&&minutes(candidate)!=null&&
    Math.abs(minutes(base)-minutes(candidate))<=20)return candidate;
  return base;
 }
 function renderTop(entry){
  const planned=plannedTime(entry.stop,entry.obs);
  if(entry.obs?.cancelled)return '<s>'+esc(planned)+'</s><small>Arrêt supprimé</small>';
  const forecast=entry.obs?.forecast?clock(entry.obs.forecast):
   entry.obs?.delay!=null?changedClock(planned,entry.obs.delay):'';
  if(forecast&&forecast!==planned)return '<s>'+esc(planned)+'</s><b>'+esc(forecast)+'</b>';
  return '<b>'+esc(planned)+'</b>';
 }
 node('Route').innerHTML='<div class="lb-cfl-sheet-route"><div>'+renderTop(first)+
  '<small>'+esc(first.stop.name)+'</small></div><i>→</i><div style="text-align:right">'+
  renderTop(last)+'<small>'+esc(last.stop.name)+'</small></div></div>';
 node('Stops').innerHTML='<section class="lb-cfl-sheet-block"><h3>Parcours et horaires</h3>'+
 records.map(({stop,obs})=>{
  const planned=plannedTime(stop,obs);
  const cancelled=obs?.cancelled===true;
  const delay=obs?.delay;
  const platform=String(obs?.platform||'').trim();
  const forecast=obs?.forecast?clock(obs.forecast):
    !cancelled&&delay!=null?changedClock(planned,delay):'';
  let time='<b class="planned'+(cancelled||forecast&&forecast!==planned?' is-struck':'')+'">'+esc(planned)+'</b>';
  if(forecast&&!cancelled&&forecast!==planned)time+='<b class="new-time">→ '+esc(forecast)+'</b>';
  const detail=platform?'<span class="stop-voie">Voie '+esc(platform)+'</span>':'';
  const metadata=detail || (!obs ? 'Horaire prévu' : '');
  const status=cancelled?'<strong class="stop-state">SUPPRIMÉ</strong>':
   delay!=null&&Number.isFinite(Number(delay))?
    '<span class="delay'+(Number(delay)===0?' ontime':'')+'">'+
    (Number(delay)===0?'À L’HEURE':(Number(delay)>0?'+':'')+esc(Number(delay))+' min')+'</span>':'';
  return '<div class="lb-cfl-sheet-stop'+(cancelled?' is-cancelled':'')+'">'+
   '<div>'+time+'</div><i class="dot"></i><div><b>'+esc(stop.name)+'</b>'+
   (metadata?'<small>'+metadata+'</small>':'')+'</div>'+status+'</div>';
 }).join('')+'</section>';
 const known=records.filter(r=>r.obs?.cancelled===true).length;
 const served=records.filter(r=>r.obs&&r.obs.cancelled===false).length;
 const lastArrival=view.selected?.arrival;
 const status=node('State');
 const cancelledEvent=(view.events||[]).some(r=>/suppression|supprim[eé]/i.test(r.title||''));
 const delayedEvent=(view.events||[]).some(r=>/retard|delay/i.test(r.title||''));
 const arrivalDelay=lastArrival?.delay;
 const arrivalSuffix=arrivalDelay!=null&&Number(arrivalDelay)>0?
  ' · arrivée prévue +'+Number(arrivalDelay)+' min':'';
 status.classList.toggle('partial',known>0&&served>0 || lastArrival?.partialCancelled===true);
 status.classList.toggle('cancel',!(known>0&&served>0 || lastArrival?.partialCancelled===true)&&
   (lastArrival?.cancelled===true||cancelledEvent||known>0));
 status.textContent=known>0&&served>0 || lastArrival?.partialCancelled===true?
  '⚠️ SUPPRESSION PARTIELLE · '+known+' arrêt'+(known>1?'s':'')+' signalé'+(known>1?'s':'')+' supprimé'+(known>1?'s':'')+arrivalSuffix:
  lastArrival?.cancelled===true?'⛔ ARRIVÉE SUPPRIMÉE':
  fullNotice?'⛔ TRAIN SUPPRIMÉ':
  known>0?'⛔ ARRÊTS SUPPRIMÉS':
  cancelledEvent?'⛔ SUPPRESSION SIGNALÉE':
  arrivalDelay!=null&&Number(arrivalDelay)>0?'🟠 RETARD PRÉVU À L’ARRIVÉE +'+Number(arrivalDelay)+' MIN':
  delayedEvent?'🟠 RETARD SIGNALÉ':
  records.some(r=>r.obs?.delay>0)?'🟠 RETARD OBSERVÉ SUR LE PARCOURS':
  records.some(r=>r.obs)?'ℹ️ HORAIRES MIS À JOUR':
  'Horaires prévus · informations en direct non disponibles';
}

function loadEvents(){
 if(cachedEvents&&Date.now()-cacheTime<120000)return Promise.resolve(cachedEvents);
 if(pending)return pending;
 pending=fetch(HIM,{cache:'no-store',credentials:'omit'})
 .then(r=>{if(!r.ok)throw Error('HAFAS events unavailable');return r.json();})
 .then(j=>{cachedEvents=Array.isArray(j.incidents)?j.incidents:[];cacheTime=Date.now();return cachedEvents;})
 .finally(()=>{pending=null;});
 return pending;
}

function showEvents(rows,view){
 rows=rows.filter(r=>r?.active!==false&&Array.isArray(r.trainNumbers)&&
   r.trainNumbers.some(n=>String(n).replace(/\D/g,'')===view.info.number));
 view.events=rows;
 node('Incidents').innerHTML=rows.length?'<section class="lb-cfl-sheet-block"><h3>Perturbations et alternatives</h3>'+
 rows.slice(0,4).map(r=>'<div class="lb-cfl-sheet-incident"><strong>'+esc(r.title||'Information CFL')+'</strong>'+
 esc(stripMarkup(r.text||r.detail||''))+'</div>').join('')+'</section>':'';
 renderAll(view);
}
async function open(info){
 init();const t=++token;
 layer.hidden=false;
 const view={info,gtfsStops:info.fallbackStops||[],gtfsSource:'carte / GTFS',
             selected:null,events:null};
 node('Title').textContent=(info.type||'CFL')+' '+info.number;
 node('State').textContent='Vérification des informations trafic…';
 node('State').className='lb-cfl-sheet-state';
 node('Incidents').textContent='';
 renderAll(view);
 layer.querySelector('.lb-cfl-sheet')?.focus({preventScroll:true});
 void readStopData().then(payload=>{
  if(token!==t)return;
  view.selected=fromArchive(info,payload);
  renderAll(view);
 }).catch(()=>{/* Keep map+GTFS fallback; do not manufacture cancellations */});
 void loadEvents().then(events=>{if(token===t)showEvents(events,view);})
 .catch(()=>{/* Stop-level data remains authoritative where available */});
 const url=new URL(GTFS);
 url.searchParams.set('date',info.date);
 url.searchParams.set('number',info.number);
 url.searchParams.set('mode','dep');
 if(info.time&&info.time!=='—')url.searchParams.set('time',info.time);
 if(info.destination)url.searchParams.set('place',info.destination);
 const controller=new AbortController();
 const wait=setTimeout(()=>controller.abort(),6500);
 try{
  const response=await fetch(url.toString(),{cache:'default',credentials:'omit',signal:controller.signal});
  if(!response.ok)throw Error('GTFS CFL HTTP '+response.status);
  const j=await response.json();
  if(token!==t)return;
  if(!j?.ok||!Array.isArray(j.match?.stops)||!j.match.stops.length)throw Error('Parcours introuvable');
  view.gtfsStops=j.match.stops;
  view.gtfsSource='GTFS CFL';
  renderAll(view);
 }catch(e){
  if(token===t&&!(view.gtfsStops||[]).length)node('Stops').innerHTML='<p>Parcours momentanément indisponible.</p>';
 }finally{clearTimeout(wait);}
}

window.lbOpenCflMapDetail=function(info){
 if(!info||! /^\d{3,6}$/.test(String(info.number||'')))return false;
 void open(info);return true;
};
})();
