/* La Bétaillère : prochains trains en gare (cache compact de la carte). */
(function(){
'use strict';
if(window.__lbStationBoardInit)return;
window.__lbStationBoardInit=true;
var URL_STATIC='https://vps.labetaillere.fr/map-v2/z/41a9d7f2';
var URL_LIVE='https://vps.labetaillere.fr/map-v2/z/77a13c5e';
var S={open:false,mode:'dep',station:'Nancy',staticData:null,staticLoading:null,live:null,liveAt:0,byStation:new Map(),stations:[],limit:8,token:0,lastFocus:null,userPicked:false,exact:null,exactKey:'',bridgeFrame:null,bridgeTarget:null,bridgeTimer:null,bridgeToken:0};
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
  if(!meta||!meta.name||/fronti[eè]re|grenze/i.test(id+' '+meta.name))return;
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
   var key=stopKeys.get(stop.stop_id);if(!key)return;
   if(!indexed.has(key))indexed.set(key,[]);
   var base={id:id,service:String(trip.service_id),number:number,station:stationNames.get(key),origin:origin,dest:dest,category:(/OCECar|:CTE:/i.test(id+' '+stop.stop_id)?'bus':'train')};
   if(i<seq.length-1&&stop.departure!=null&&Number.isFinite(Number(stop.departure)))indexed.get(key).push(Object.assign({},base,{mode:'dep',sec:Number(stop.departure)}));
   if(i>0&&stop.arrival!=null&&Number.isFinite(Number(stop.arrival)))indexed.get(key).push(Object.assign({},base,{mode:'arr',sec:Number(stop.arrival)}));
  });
 });
 S.byStation=indexed;S.stations=Array.from(stationNames.values()).sort(function(a,b){return a.localeCompare(b,'fr',{sensitivity:'base'});});
 renderChoices();
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
   if(sec<time.sec-120||sec>time.sec+86400)return;
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
 if(!rows.length){host.innerHTML='<p class="lb-board-wait">Aucun autre train prévu pour cette gare.</p>';more.hidden=true;return;}
 var heading=S.mode==='dep'?'DÉPARTS':'ARRIVÉES';
 var col=S.mode==='dep'?'DESTINATION':'PROVENANCE';
 var html='<div class="lb-gare-table-top"><b>'+heading+'</b><time id="lbBoardClock">'+new Date().toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris'})+'</time></div>'+
 '<table class="lb-gare-table"><colgroup><col style="width:47%"><col style="width:21%"><col style="width:32%"></colgroup>'+
 '<thead><tr><th>'+col+'</th><th>HEURE</th><th aria-label="Voie et détails"></th></tr></thead><tbody>';
 rows.slice(0,S.limit).forEach(function(r){
  var late=r.delay>0,partial=!!r.partial,cancelled=!!r.cancelled;
  var status=cached?'Non actualisé':cancelled?'Supprimé':partial?'Suppr. partielle':late?'Retard +'+r.delay+'m':r.exact?'À l’heure':'Prévu';
  var statusClass=cancelled?'is-cancelled':partial?'is-partial':late?'is-late':'is-normal';
  var timeText=late&&r.planned!==r.when
    ?'<s class="lb-gare-old-time">'+clock(r.planned)+'</s><strong class="lb-gare-time is-late">'+clock(r.when)+'</strong>'
    :'<strong class="lb-gare-time '+(cancelled?'is-cancelled':'')+'">'+clock(r.when)+'</strong>';
  var rawNum=String(r.number||'').trim();
  var num=r.exact?rawNum:(r.category==='bus'?'BUS ':'TER ')+rawNum.replace(/^TER |^BUS /i,'');
  var place=r.mode==='dep'?r.dest:r.origin;
  var details='<button type="button" class="lb-gare-details" data-lb-board-train="'+clean(r.number)+'" data-lb-board-date="'+clean(r.day)+'" aria-label="Ouvrir le détail du '+clean(num)+'">🐄 Détails</button>';
  var voie=r.category==='bus'?'<span class="lb-gare-bus" aria-label="Service routier">🚌</span>'
           :r.track?'<span class="lb-gare-voie" title="Voie '+clean(r.track)+'"><small>Voie</small><b>'+clean(r.track)+'</b></span>':'';
  html+='<tr class="'+statusClass+'"><td class="lb-gare-place-cell"><b class="lb-gare-place">'+clean(place||'Destination inconnue')+'</b><small class="lb-gare-train">'+clean(num)+'</small></td>'+
   '<td class="lb-gare-clock-cell">'+timeText+'<small class="lb-gare-status '+statusClass+'">'+clean(status)+'</small></td>'+
   '<td class="lb-gare-actions"><div class="lb-gare-actions-inner">'+voie+details+'</div></td></tr>';
 });
 host.innerHTML=html+'</tbody></table>';
 more.hidden=rows.length<=S.limit;more.textContent='Plus de trains';
}
function render(){
 if(!S.open)return;
 if(S.exact && S.exactKey===norm(S.station)+'|'+S.mode){
  draw(S.exact,false);saveCached(S.exact);
  src('Source : carte La Bétaillère · horaires et statuts synchronisés');
  return;
 }
 if(!S.staticData){
  var old=getCached();if(old){draw(old.rows,true);src('Dernières données mémorisées · non actualisées');}
  else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Chargement des prochains trains…</p>';src('Chargement à la demande…');}
  return;
 }
 var rows=getRows();draw(rows,false);saveCached(rows);
 src('Synchronisation avec la carte… · horaires prévus en attendant');
}
async function refresh(){
 var ticket=++S.token;render();
 try{await loadStatic();if(!S.open||ticket!==S.token)return;render();await loadLive();if(S.open&&ticket===S.token)render();}
 catch(_){if(!S.open||ticket!==S.token)return;var old=getCached();if(old){draw(old.rows,true);src('Hors ligne · dernières données du '+new Date(old.at).toLocaleString('fr-FR'));}
 else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Horaires indisponibles. Réessaie quand la connexion revient.</p>';src('Impossible de récupérer les horaires');}}
}
function setTitle(){
 var label=document.getElementById('lbBoardName');
 if(label)label.textContent=S.station;
}
function stopBridge(){
 if(S.bridgeTimer){clearTimeout(S.bridgeTimer);S.bridgeTimer=null;}
 if(S.bridgeFrame){S.bridgeFrame.remove();S.bridgeFrame=null;}
 S.bridgeTarget=null;
}
function sendExactRequest(){
 if(!S.open||!S.bridgeTarget?.contentWindow)return;
 S.bridgeTarget.contentWindow.postMessage({
  type:'lb:station-board:request',requestId:String(++S.bridgeToken),
  station:S.station,mode:S.mode
 },S.bridgeFrame?'https://vps.labetaillere.fr':location.origin);
}
function bridgeLoop(){
 if(!S.open||!S.bridgeTarget)return;
 sendExactRequest();
 S.bridgeTimer=setTimeout(bridgeLoop,S.exact?30000:2700);
}
function requestExact(){
 if(!S.open||!navigator.onLine)return;
 if(!S.bridgeTarget){
  var mapFrame=document.querySelector('#carte iframe');
  try {
   if(mapFrame?.contentDocument?.getElementById('mapV2'))S.bridgeTarget=mapFrame;
  }catch(_){}
 }
 if(!S.bridgeTarget){
  var iframe=document.createElement('iframe');
  iframe.title='Données de la carte ferroviaire';
  iframe.setAttribute('aria-hidden','true');iframe.tabIndex=-1;
  iframe.className='lb-board-data-frame';
  iframe.style.cssText='position:fixed!important;left:-1500px!important;top:0!important;width:450px!important;height:650px!important;border:0!important;pointer-events:none!important;opacity:0!important;';
  iframe.loading='eager';
  iframe.addEventListener('load',sendExactRequest);
  S.bridgeFrame=iframe;
  S.bridgeTarget=iframe;
  document.body.appendChild(iframe);
  iframe.src='https://vps.labetaillere.fr/map-v2/carte-preview.html?lbStationBoard=1';
 }
 if(S.bridgeTimer)clearTimeout(S.bridgeTimer);
 S.bridgeTimer=setTimeout(bridgeLoop,1800);
}
function onExactResponse(event){
 if(!['https://vps.labetaillere.fr',location.origin].includes(event.origin)||event.source!==S.bridgeTarget?.contentWindow)return;
 var m=event.data;
 if(!S.open||!m||m.type!=='lb:station-board:response'||!m.ready)return;
 if(norm(m.station)!==norm(S.station)||m.mode!==S.mode||!Array.isArray(m.rows))return;
 S.exactKey=norm(S.station)+'|'+S.mode;
 S.exact=m.rows.map(function(r){
  var delay=Math.max(0,Math.round(Number(r.delaySeconds||0)/60));
  return {number:r.number,day:r.serviceDate,planned:r.planned,when:r.when,
   delay:delay,cancelled:!!r.isCancelled,partial:!!r.partialCancellationStation,
   partialStation:r.partialCancellationStation,track:r.track||'',
   category:r.category,mode:S.mode,origin:r.place,dest:r.place,
   imminent:!!r.isImminent,trainId:r.trainId,exact:true};
 });
 S.limit=8;render();
}

/* Compte BER : gare aller = départ du matin, gare retour = départ du soir.
 * Ne crée aucune préférence ni appel réseau supplémentaire. */
function accountStations(){
 if(window.lbIsAuthed!==true)return {morning:'',evening:''};
 var prefs=window.lbPrefsCache||{};
 return {
  morning:friendly(String(prefs.favoriteFromStation||'').trim()),
  evening:friendly(String(prefs.favoriteToStation||'').trim())
 };
}
function defaultStation(){
 var favorites=accountStations(),isEvening=nowParis().sec>=12*3600;
 return (isEvening?favorites.evening||favorites.morning:favorites.morning||favorites.evening)||'Nancy';
}
function renderChoices(){
 var favorites=accountStations();
 var quick=document.getElementById('lbBoardFavorites');
 if(quick){
  quick.hidden=!(favorites.morning||favorites.evening);
  quick.querySelectorAll('[data-lb-board-favorite]').forEach(function(button){
   var when=button.dataset.lbBoardFavorite,name=favorites[when]||'';
   button.hidden=!name;
   button.querySelector('.lb-board-fav-station').textContent=name;
   button.setAttribute('aria-pressed',String(!!name&&norm(S.station)===norm(name)));
   button.setAttribute('aria-label',(when==='morning'?'Gare du matin : ':'Gare du soir : ')+name);
  });
 }
 var list=document.getElementById('lbBoardStationList');
 if(!list)return;
 var seen=new Set(),all=[];
 [favorites.morning,favorites.evening].concat(priority,S.stations).forEach(function(name){
  if(!name||seen.has(norm(name)))return;
  seen.add(norm(name));all.push(name);
 });
 list.replaceChildren(...all.map(function(name){var option=document.createElement('option');option.value=name;return option;}));
}
function onAccountStationsUpdated(){
 renderChoices();
 if(!S.open||S.userPicked)return;
 var wanted=defaultStation();
 if(norm(wanted)!==norm(S.station))choose(wanted,false);
}

function choose(value,explicit){
 var key=norm(value),favorites=accountStations();
 var name=S.stations.find(function(x){return norm(x)===key;})||priority.find(function(x){return norm(x)===key;})||[favorites.morning,favorites.evening].find(function(x){return norm(x)===key;});
 if(!name){src('Gare non reconnue : choisis une gare dans la liste.');return;}
 if(explicit!==false)S.userPicked=true;
 S.station=name;S.limit=8;S.exact=null;S.exactKey='';document.getElementById('lbBoardStation').value=name;setTitle();renderChoices();refresh();requestExact();
}
function tabs(){document.querySelectorAll('[data-lb-board-mode]').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.lbBoardMode===S.mode));});}
function open(station){
 var overlay=document.getElementById('lbStationBoardOverlay');if(!overlay)return;
 S.lastFocus=document.activeElement;S.open=true;S.mode='dep';S.limit=8;S.userPicked=false;S.exact=null;S.exactKey='';
 S.station=friendly(station||defaultStation());
 overlay.hidden=false;document.body.classList.add('lb-board-visible');
 document.getElementById('lbBoardStation').value=S.station;tabs();setTitle();renderChoices();
 document.getElementById('lbStationBoardSheet').focus({preventScroll:true});
 refresh();requestExact();
}
function close(){
 if(!S.open)return;S.open=false;++S.token;stopBridge();
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
 '<div class="lb-board-handle" aria-hidden="true"></div><header class="lb-board-head"><span class="lb-board-symbol" aria-hidden="true">🏠</span><div class="lb-board-head-text"><h2 id="lbBoardTitle">Gare de <span id="lbBoardName">Nancy</span></h2></div><button type="button" class="lb-auth-close tron-close-button lb-board-x" data-lb-board-close aria-label="Fermer la gare"></button></header>'+
 '<label for="lbBoardStation" class="lb-board-picker-label">Choisir une gare</label><div class="lb-board-picker"><input id="lbBoardStation" type="search" list="lbBoardStationList" autocomplete="off" spellcheck="false" placeholder="Rechercher une gare…"><datalist id="lbBoardStationList"></datalist><span aria-hidden="true">⌄</span></div>'+ 
 '<div id="lbBoardFavorites" class="lb-board-favorites" role="group" aria-label="Mes gares favorites" hidden><button type="button" data-lb-board-favorite="morning"><span class="lb-board-fav-label">☀ Matin</span><span class="lb-board-fav-station"></span></button><button type="button" data-lb-board-favorite="evening"><span class="lb-board-fav-label">☾ Soir</span><span class="lb-board-fav-station"></span></button></div>'+ 
 '<div class="lb-board-tabs" role="tablist" aria-label="Départs ou arrivées"><button type="button" data-lb-board-mode="dep" role="tab" aria-selected="true">↗ Départs</button><button type="button" data-lb-board-mode="arr" role="tab" aria-selected="false">↙ Arrivées</button></div>'+
 '<p class="lb-board-source" id="lbBoardSource" aria-live="polite">Chargement à la demande…</p><div id="lbBoardRows" class="lb-board-rows" aria-live="polite"></div>'+
 '<button type="button" class="lb-board-more" id="lbBoardMore" hidden>Voir plus de trains ↓</button></section>';
 document.body.appendChild(wrap);
 wrap.addEventListener('click',function(e){
  if(e.target.closest('[data-lb-board-close]'))return close();
  var favorite=e.target.closest('[data-lb-board-favorite]');
  if(favorite){var name=accountStations()[favorite.dataset.lbBoardFavorite];if(name)choose(name,true);return;}
  var mode=e.target.closest('[data-lb-board-mode]');if(mode){S.mode=mode.dataset.lbBoardMode;S.limit=8;S.exact=null;S.exactKey='';tabs();render();requestExact();return;}
  var train=e.target.closest('[data-lb-board-train]');if(train){var num=train.dataset.lbBoardTrain,date=train.dataset.lbBoardDate;close();if(typeof window.lbOpenTrainDetail==='function')window.lbOpenTrainDetail(num,date);return;}
  if(e.target.closest('#lbBoardMore')){S.limit+=8;render();}
 });
 wrap.querySelector('#lbBoardStation').addEventListener('change',function(e){choose(e.target.value,true);});
 wrap.querySelector('#lbBoardStation').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();choose(e.target.value,true);e.target.blur();}});
 document.addEventListener('keydown',function(e){if(e.key==='Escape'&&S.open){e.preventDefault();close();}});
 window.addEventListener('message',onExactResponse);
 document.addEventListener('lb:prefs-updated',onAccountStationsUpdated);
 document.addEventListener('lb:auth-state',onAccountStationsUpdated);
 window.addEventListener('online',function(){if(S.open)refresh();});
 document.addEventListener('visibilitychange',function(){if(S.open&&!document.hidden&&Date.now()-S.liveAt>45000)refresh();});
 window.lbOpenStationBoard=open;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
