/* La Bétaillère : prochains trains en gare (cache compact de la carte). */
(function(){
'use strict';
if(window.__lbStationBoardInit)return;
window.__lbStationBoardInit=true;
var URL_STATIC='https://vps.labetaillere.fr/map-v2/z/41a9d7f2';
var URL_LIVE='https://vps.labetaillere.fr/map-v2/z/77a13c5e';
var S={open:false,mode:'dep',station:'Nancy',staticData:null,staticLoading:null,live:null,liveAt:0,byStation:new Map(),stations:[],limit:5,token:0,lastFocus:null};
var priority=['Nancy','Metz','Thionville','Luxembourg','Hagondange','Bettembourg','Pont-à-Mousson','Hettange-Grande','Howald','Uckange'];
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/ gare centrale$/,'');}
function friendly(s){return String(s||'').replace(/^Luxembourg, Gare Centrale$/i,'Luxembourg').replace(/^Howald, Gare$/i,'Howald').replace(/^Bettembourg, Gare$/i,'Bettembourg');}
function clean(s){return String(s==null?'':s).replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];});}
function clock(sec){var min=Math.floor(sec/60);return String((Math.floor(min/60)%24+24)%24).padStart(2,'0')+':'+String((min%60+60)%60).padStart(2,'0');}
function nowParis(){var d=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(function(p){return p.type!=='literal';}).map(function(p){return [p.type,Number(p.value)];}));return {y:d.year,m:d.month,d:d.day,sec:d.hour*3600+d.minute*60+d.second};}
function isoDay(now,offset){return new Date(Date.UTC(now.y,now.m-1,now.d+offset)).toISOString().slice(0,10);}
function src(text){document.getElementById('lbBoardSource').textContent=text;}
function getCached(){
 try {var v=JSON.parse(localStorage.getItem('lb:station-board:'+norm(S.station)+':'+S.mode)||'null');return v&&v.at>Date.now()-36*3600000&&Array.isArray(v.rows)?v:null;}catch(_){return null;}
}
function saveCached(rows){try{localStorage.setItem('lb:station-board:'+norm(S.station)+':'+S.mode,JSON.stringify({at:Date.now(),rows:rows.slice(0,18)}));}catch(_){}}
function stationData(data){
 var stops=new Map(data.stopsById),trips=new Map(data.tripsById),stopKeys=new Map(),stationNames=new Map();
 stops.forEach(function(meta,id){
  if(!meta||!meta.name||/OCECar|fronti[eè]re|grenze/i.test(id+' '+meta.name))return;
  var parent=meta.parent_station&&stops.has(meta.parent_station)?meta.parent_station:id;
  var name=friendly((stops.get(parent)||meta).name),key=norm(name);
  if(key.length<3||!/[a-z]/.test(key))return;
  stationNames.set(key,name);stopKeys.set(id,key);
  if(meta.parent_station)stopKeys.set(meta.parent_station,key);
 });
 var indexed=new Map();
 data.stopTimesByTrip.forEach(function(pair){
  var id=pair[0],seq=pair[1],trip=trips.get(id);
  if(!trip||!trip.service_id||!Array.isArray(seq)||seq.length<2)return;
  var number=String(trip.trip_short_name||'').trim()||String(trip.headsign||'').match(/\b\d{4,6}\b/)?.[0]||'';
  if(!number)return;
  seq=seq.slice().sort(function(a,b){return Number(a.seq)-Number(b.seq);});
  var a=stops.get(seq[0].stop_id),b=stops.get(seq[seq.length-1].stop_id);
  var origin=friendly(a?.name||'Gare inconnue'),dest=friendly(b?.name||'Gare inconnue');
  seq.forEach(function(stop,i){
   if(/OCECar/i.test(stop.stop_id))return;
   var key=stopKeys.get(stop.stop_id);if(!key)return;
   if(!indexed.has(key))indexed.set(key,[]);
   var base={id:id,service:String(trip.service_id),number:number,station:stationNames.get(key),origin:origin,dest:dest};
   if(i<seq.length-1&&stop.departure!=null&&Number.isFinite(Number(stop.departure)))indexed.get(key).push(Object.assign({},base,{mode:'dep',sec:Number(stop.departure)}));
   if(i>0&&stop.arrival!=null&&Number.isFinite(Number(stop.arrival)))indexed.get(key).push(Object.assign({},base,{mode:'arr',sec:Number(stop.arrival)}));
  });
 });
 S.byStation=indexed;S.stations=Array.from(stationNames.values()).sort(function(a,b){return a.localeCompare(b,'fr',{sensitivity:'base'});});
 var datalist=document.getElementById('lbBoardStationList');datalist.replaceChildren();
 S.stations.forEach(function(name){var op=document.createElement('option');op.value=name;datalist.appendChild(op);});
}
async function loadStatic(){
 if(S.staticData)return;
 if(S.staticLoading)return S.staticLoading;
 S.staticLoading=(async function(){
  var r=await fetch(URL_STATIC,{cache:'force-cache',mode:'cors'});
  if(!r.ok)throw new Error('Source gare indisponible');
  var json=await r.json();if(!json?.data?.stopTimesByTrip||!json.data.activeServiceIdsByDate)throw new Error('Horaires incomplets');
  S.staticData=json.data;stationData(json.data);
 })();
 try{await S.staticLoading;}finally{S.staticLoading=null;}
}
async function loadLive(){
 if(S.live&&Date.now()-S.liveAt<45000)return;
 try{
  var c=new AbortController(),timer=setTimeout(function(){c.abort();},5000);
  var r;try{r=await fetch(URL_LIVE,{mode:'cors',cache:'no-store',signal:c.signal});}finally{clearTimeout(timer);}
  if(!r.ok)return;
  var j=await r.json();if(!Array.isArray(j.trains))return;
  S.live=new Map(j.trains.map(function(t){return [String(t.tripId),t];}));S.liveAt=Date.now();
 }catch(_){/* les horaires restent affichés comme prévus */}
}
function track(row){
 try{
  var maps=[];
  if(typeof getVoiesForTrain==='function')maps.push(getVoiesForTrain(row.number));
  if(typeof getCflVoiesForTrain==='function')maps.push(getCflVoiesForTrain(row.number));
  for(var m of maps){if(!(m instanceof Map))continue;
   for(var e of m){var stop=norm(e[0]);if(stop!==norm(row.station)&&!stop.endsWith(norm(row.station)))continue;
    var v=e[1];v=typeof v==='string'?v:(row.mode==='dep'?v?.depTrack||v?.genericTrack:v?.arrTrack||v?.genericTrack);
    if(v)return String(v).replace(/^voie\s*/i,'').slice(0,8);
   }
  }
 }catch(_){}
 return '';
}
function getRows(){
 if(!S.staticData)return [];
 var time=nowParis(),source=S.byStation.get(norm(S.station))||[],result=[],seen=new Set(),calendar=S.staticData.activeServiceIdsByDate;
 [-1,0,1].forEach(function(dayOffset){
  var date=isoDay(time,dayOffset),active=new Set((calendar[date]||[]).map(String));
  if(!active.size)return;
  source.forEach(function(r){
   if(r.mode!==S.mode||!active.has(r.service))return;
   var sec=r.sec+dayOffset*86400;
   if(sec<time.sec-180||sec>time.sec+21600)return;
   var sig=r.number+'|'+date+'|'+r.mode+'|'+Math.floor(sec/90);
   if(seen.has(sig))return;seen.add(sig);
   var live=S.live?.get(r.id);
   if(live&&live.serviceDate!==date)live=null;
   var status=String(live?.realtimeStatus||'').toUpperCase();
   var cancelled=!!live&&/CANCEL|SUPPR|DELETE/.test(status)&&!status.includes('PARTIAL');
   var partial=!!live&&status.includes('PARTIAL_CANCELLATION');
   var confirmedDelay=!!live&&status==='DELAYED'&&live.delayMinutes!=null&&Number.isFinite(Number(live.delayMinutes));
   var minutes=confirmedDelay&&Number(live.delayMinutes)>2?Math.round(Number(live.delayMinutes)):0;
   result.push(Object.assign({},r,{day:date,planned:sec,when:sec+minutes*60,delay:minutes,cancelled:cancelled,partial:partial,liveConfirmed:confirmedDelay||cancelled||partial,track:track(r)}));
  });
 });
 result.sort(function(a,b){return a.when-b.when;});
 return result;
}
function draw(rows,cached){
 var host=document.getElementById('lbBoardRows'),more=document.getElementById('lbBoardMore');
 if(!rows.length){host.innerHTML='<p class="lb-board-wait">Aucun train prévu dans les 6 prochaines heures pour cette gare.</p>';more.hidden=true;return;}
 host.innerHTML=rows.slice(0,S.limit).map(function(r){
  var status=cached?'Non actualisé':r.cancelled?'Supprimé':r.partial?'Suppr. partielle':r.delay>0?'+'+r.delay+' min':'Prévu';
  var klass=r.cancelled?'cancelled':r.partial?'delayed':r.delay>0?'delayed':'planned';
  return '<button type="button" class="lb-board-row '+klass+'" data-lb-board-train="'+clean(r.number)+'" data-lb-board-date="'+clean(r.day)+'">'+
   '<span class="lb-board-time"><strong title="'+(r.delay?'Prévu '+clock(r.planned):'')+'">'+clock(r.when)+'</strong><small>'+clean(status)+'</small></span>'+
   '<span class="lb-board-destination"><small>TRAIN '+clean(r.number)+'</small><b>'+clean(r.mode==='dep'?r.dest:r.origin)+'</b></span>'+
   '<span class="lb-board-platform">'+(r.track?'Voie '+clean(r.track):'Voie —')+'</span><span class="lb-board-chevron" aria-hidden="true">›</span></button>';
 }).join('');
 more.hidden=rows.length<=S.limit;more.textContent='Voir '+Math.min(8,rows.length-S.limit)+' trains de plus ↓';
}
function render(){
 if(!S.open)return;
 if(!S.staticData){
  var old=getCached();if(old){draw(old.rows,true);src('Dernières données mémorisées · non actualisées');}
  else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Chargement des prochains trains…</p>';src('Chargement à la demande…');}
  return;
 }
 var rows=getRows();draw(rows,false);saveCached(rows);
 src('Horaires prévus · LIVE signalé uniquement si confirmé');
}
async function refresh(){
 var ticket=++S.token;render();
 try{await loadStatic();if(!S.open||ticket!==S.token)return;render();await loadLive();if(S.open&&ticket===S.token)render();}
 catch(_){if(!S.open||ticket!==S.token)return;var old=getCached();if(old){draw(old.rows,true);src('Hors ligne · dernières données du '+new Date(old.at).toLocaleString('fr-FR'));}
 else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Horaires indisponibles. Réessaie quand la connexion revient.</p>';src('Impossible de récupérer les horaires');}}
}
function choose(value){
 var key=norm(value),name=S.stations.find(function(x){return norm(x)===key;})||priority.find(function(x){return norm(x)===key;});
 if(!name){src('Gare non reconnue : choisis une gare dans la liste.');return;}
 S.station=name;S.limit=5;document.getElementById('lbBoardStation').value=name;refresh();
}
function tabs(){document.querySelectorAll('[data-lb-board-mode]').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.lbBoardMode===S.mode));});}
function open(station){
 var overlay=document.getElementById('lbStationBoardOverlay');if(!overlay)return;
 S.lastFocus=document.activeElement;S.open=true;S.mode='dep';S.limit=5;
 S.station=friendly(station||document.getElementById('lbFavFromStation')?.value||'Nancy');
 overlay.hidden=false;document.body.classList.add('lb-board-visible');
 document.getElementById('lbBoardStation').value=S.station;tabs();
 document.getElementById('lbStationBoardSheet').focus({preventScroll:true});
 refresh();
}
function close(){
 if(!S.open)return;S.open=false;++S.token;
 document.getElementById('lbStationBoardOverlay').hidden=true;
 document.body.classList.remove('lb-board-visible');
 if(S.lastFocus?.isConnected)S.lastFocus.focus({preventScroll:true});
}
function init(){
 var card=document.querySelector('#home .home-card[aria-label="Mes Bétaillères favorites"]');if(!card)return;
 var head=card.querySelector(':scope > h2');if(!head)return;
 var trigger=document.createElement('button');trigger.type='button';trigger.className='lb-board-open-button';
 trigger.setAttribute('aria-label','Voir les prochains trains en gare');
 trigger.innerHTML='<span aria-hidden="true">🚉</span><span>En gare</span><span aria-hidden="true">›</span>';
 head.insertAdjacentElement('afterend',trigger);trigger.addEventListener('click',function(){open();});
 var wrap=document.createElement('div');wrap.id='lbStationBoardOverlay';wrap.className='lb-board-overlay';wrap.hidden=true;
 wrap.innerHTML='<div class="lb-board-shade" data-lb-board-close></div><section id="lbStationBoardSheet" class="lb-board-sheet" role="dialog" aria-modal="true" aria-labelledby="lbBoardTitle" tabindex="-1">'+
 '<div class="lb-board-handle" aria-hidden="true"></div><header class="lb-board-head"><span class="lb-board-symbol" aria-hidden="true">🚉</span><div class="lb-board-head-text"><h2 id="lbBoardTitle">Les trains en gare</h2><p>Départs et arrivées · Temps réel si disponible</p></div><button type="button" class="lb-board-x" data-lb-board-close aria-label="Fermer">×</button></header>'+
 '<label for="lbBoardStation" class="lb-board-picker-label">📍 Choisir une gare</label><div class="lb-board-picker"><input id="lbBoardStation" type="search" list="lbBoardStationList" autocomplete="off" spellcheck="false" placeholder="Rechercher une gare…"><datalist id="lbBoardStationList"></datalist><span aria-hidden="true">⌄</span></div>'+
 '<div class="lb-board-tabs" role="tablist" aria-label="Départs ou arrivées"><button type="button" data-lb-board-mode="dep" role="tab" aria-selected="true">↗ Départs</button><button type="button" data-lb-board-mode="arr" role="tab" aria-selected="false">↙ Arrivées</button></div>'+
 '<p class="lb-board-source" id="lbBoardSource" aria-live="polite">Chargement à la demande…</p><div id="lbBoardRows" class="lb-board-rows" aria-live="polite"></div>'+
 '<button type="button" class="lb-board-more" id="lbBoardMore" hidden>Voir plus de trains ↓</button></section>';
 document.body.appendChild(wrap);
 wrap.addEventListener('click',function(e){
  if(e.target.closest('[data-lb-board-close]'))return close();
  var mode=e.target.closest('[data-lb-board-mode]');if(mode){S.mode=mode.dataset.lbBoardMode;S.limit=5;tabs();render();return;}
  var train=e.target.closest('[data-lb-board-train]');if(train){var num=train.dataset.lbBoardTrain,date=train.dataset.lbBoardDate;close();if(typeof window.lbOpenTrainDetail==='function')window.lbOpenTrainDetail(num,date);return;}
  if(e.target.closest('#lbBoardMore')){S.limit+=8;render();}
 });
 wrap.querySelector('#lbBoardStation').addEventListener('change',function(e){choose(e.target.value);});
 wrap.querySelector('#lbBoardStation').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();choose(e.target.value);e.target.blur();}});
 document.addEventListener('keydown',function(e){if(e.key==='Escape'&&S.open){e.preventDefault();close();}});
 window.addEventListener('online',function(){if(S.open)refresh();});
 document.addEventListener('visibilitychange',function(){if(S.open&&!document.hidden&&Date.now()-S.liveAt>45000)refresh();});
 window.lbOpenStationBoard=open;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
