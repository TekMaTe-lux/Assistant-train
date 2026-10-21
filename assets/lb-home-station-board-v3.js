/* La Bétaillère : prochains trains en gare (cache compact de la carte). */
(function(){
'use strict';
if(window.__lbStationBoardInit)return;
window.__lbStationBoardInit=true;
var URL_STATIC='https://vps.labetaillere.fr/map-v2/z/41a9d7f2';
var URL_LIVE='https://vps.labetaillere.fr/map-v2/z/77a13c5e';
var S={open:false,mode:'dep',station:'Nancy',staticData:null,staticLoading:null,live:null,liveLoading:null,liveAt:0,byStation:new Map(),stations:[],stationChoices:[],limit:8,token:0,lastFocus:null,userPicked:false,exact:null,exactKey:'',bridgeFrame:null,bridgeTarget:null,bridgeTimer:null,bridgeToken:0,lastMarkup:null,exactCache:new Map(),clockTimer:null,luxArrivalFeed:null,luxArrivalAt:0,luxArrivalPromise:null};
var BE_ENDPOINTS_URL='https://vps.labetaillere.fr/map-v2/data/lb-be-international-ends-v1.json';
var BE_MATCHER_URL='https://vps.labetaillere.fr/map-v2/lb-be-extension-helper-v1.js?v=20261021-arlon3';
var beIndex=null,beIndexAt=0,beLoading=null,beTripRoutes=new Map();
var priority=['Nancy','Metz','Thionville','Luxembourg','Hagondange','Bettembourg','Pont-à-Mousson','Hettange-Grande','Howald','Uckange'];
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/ gare centrale$/,'');}
function friendly(s){return String(s||'').trim().replace(/^Luxembourg, Gare Centrale$/i,'Luxembourg').replace(/^Luxembourg,?\s+Gare$/i,'Luxembourg').replace(/^Howald, Gare$/i,'Howald').replace(/^Bettembourg,?\s+Gare$/i,'Bettembourg');}
function clean(s){return String(s==null?'':s).replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];});}
function clock(sec){var min=Math.floor(sec/60);return String((Math.floor(min/60)%24+24)%24).padStart(2,'0')+':'+String((min%60+60)%60).padStart(2,'0');}
function nowParis(){var d=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(function(p){return p.type!=='literal';}).map(function(p){return [p.type,Number(p.value)];}));return {y:d.year,m:d.month,d:d.day,sec:d.hour*3600+d.minute*60+d.second};}
function isoDay(now,offset){return new Date(Date.UTC(now.y,now.m-1,now.d+offset)).toISOString().slice(0,10);}
/* Horloge de la gare : secondes réellement animées, aucun nouveau fetch
 * et aucune reconstruction du tableau. Timer actif uniquement modal visible. */
var boardClockFmt=new Intl.DateTimeFormat('fr-FR',{
 timeZone:'Europe/Luxembourg',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
function boardClockText(){return boardClockFmt.format(new Date());}
function tickBoardClock(){
 if(!S.open||document.hidden){stopBoardClock();return;}
 var node=document.getElementById('lbBoardClock');
 if(node)node.textContent=boardClockText();
 S.clockTimer=setTimeout(tickBoardClock,Math.max(100,1010-Date.now()%1000));
}
function stopBoardClock(){
 if(S.clockTimer!=null){clearTimeout(S.clockTimer);S.clockTimer=null;}
}
function startBoardClock(){
 stopBoardClock();
 if(S.open&&!document.hidden)tickBoardClock();
}
function src(text){document.getElementById('lbBoardSource').textContent=text;}
function getCached(){
 try {var v=JSON.parse(localStorage.getItem('lb:station-board:'+norm(S.station)+':'+S.mode)||'null');return v&&v.at>Date.now()-36*3600000&&Array.isArray(v.rows)?v:null;}catch(_){return null;}
}
function saveCached(rows){try{localStorage.setItem('lb:station-board:'+norm(S.station)+':'+S.mode,JSON.stringify({at:Date.now(),rows:rows.slice(0,18)}));}catch(_){}}

function ensureBelgianStations(){
 if(beIndex&&Date.now()-beIndexAt<10*60*1000&&typeof window.lbVerifyInternationalBeEndpoint==='function')return Promise.resolve(beIndex);
 if(beLoading)return beLoading;
 var matcher=typeof window.lbVerifyInternationalBeEndpoint==='function'?Promise.resolve():new Promise(function(resolve,reject){
   var script=document.createElement('script');script.src=BE_MATCHER_URL;script.async=true;
   script.onload=resolve;script.onerror=function(){reject(new Error('International matcher unavailable'));};
   document.head.appendChild(script);
 });
 beLoading=Promise.all([matcher,fetch(BE_ENDPOINTS_URL,{mode:'cors',cache:'no-cache'}).then(function(r){
   if(!r.ok)throw new Error('International index unavailable');return r.json();
 })]).then(function(values){
   var data=values[1];
   if(data?.schema!=='lb-be-international-ends-v1'||!data.trains||
      typeof window.lbVerifyInternationalBeEndpoint!=='function')throw Error('International index invalid');
   beIndex=data;beIndexAt=Date.now();
   if(S.open){S.lastMarkup=null;render();}
   return data;
 }).finally(function(){beLoading=null;});
 return beLoading;
}
function internationalBoardPlace(row){
 var place=row.mode==='dep'?row.dest:row.origin;
 if(!beIndex||row.category==='bus')return place;
 var id=String(row.id||row.trainId||''),route=beTripRoutes.get(id);
 if(!route)return place;
 var match=String(row.number||'').match(/\d{3,6}/);
 if(!match)return place;
 var ext=window.lbVerifyInternationalBeEndpoint({date:row.day,number:match[0],type:'CFL'},route,beIndex);
 var name=row.mode==='dep'?ext?.destination?.name:ext?.origin?.name;
 return name?String(name).replace(/\s+\((?:LU|BE)\)$/i,''):place;
}

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
  beTripRoutes=new Map();
 data.stopTimesByTrip.forEach(function(pair){
  var id=pair[0],seq=pair[1],trip=trips.get(id);
  if(!trip||!trip.service_id||!Array.isArray(seq)||seq.length<2)return;
  var number=String(trip.trip_short_name||'').trim()||String(trip.headsign||'').match(/\b\d{4,6}\b/)?.[0]||'';
  if(!number)return;
  seq=seq.slice().sort(function(a,b){return Number(a.seq)-Number(b.seq);});
  var a=stops.get(seq[0].stop_id),b=stops.get(seq[seq.length-1].stop_id);
  var origin=friendly(a?.name||'Gare inconnue'),dest=friendly(b?.name||'Gare inconnue');
   if(trip.source==='CFL'&&String(id).startsWith('CFL:')&&/arlon|gouvy|athus/i.test(origin+' '+dest)){
     beTripRoutes.set(String(id),seq.map(function(stop){
       var meta=stops.get(stop.stop_id);
       return {name:meta?.name||stop.stop_id,
        arrival:stop.arrival==null?'':clock(Number(stop.arrival)),
        departure:stop.departure==null?'':clock(Number(stop.departure))};
     }));
   }
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
 if(S.liveLoading)return S.liveLoading;
 S.liveLoading=(async function(){
  try{
   var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},5000),response;
   try{response=await fetch(URL_LIVE,{mode:'cors',cache:'no-store',signal:controller.signal});}
   finally{clearTimeout(timer);}
   if(!response.ok)return;
   var json=await response.json();if(!Array.isArray(json.trains))return;
   S.live=new Map(json.trains.map(function(t){return [String(t.tripId),t];}));
   S.liveAt=Date.now();
  }catch(_){/* Le tableau statique reste utilisable hors temps réel. */}
 })();
 try{await S.liveLoading;}finally{S.liveLoading=null;}
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
/* Mettre à jour les cellules qui changent, sans détruire le tableau ni
 * reprendre le focus/défilement lors de l'arrivée des données de la carte. */
function patchTableInPlace(host,markup){
 var existing=host.querySelector('.lb-gare-table');
 if(!existing||!existing.tBodies?.[0])return false;
 var template=document.createElement('template');template.innerHTML=markup;
 var next=template.content.querySelector('.lb-gare-table');
 if(!next||!next.tBodies?.[0]||existing.tHead?.textContent!==next.tHead?.textContent)return false;
 var top=host.querySelector('.lb-gare-table-top');
 var nextTop=template.content.querySelector('.lb-gare-table-top');
 if(top&&nextTop){
  var clock=top.querySelector('#lbBoardClock');
  var nextClock=nextTop.querySelector('#lbBoardClock');
  if(clock&&nextClock)clock.textContent=nextClock.textContent;
  var title=top.querySelector('b'),nextTitle=nextTop.querySelector('b');
  if(title&&nextTitle&&title.textContent!==nextTitle.textContent)title.textContent=nextTitle.textContent;
 }
 var body=existing.tBodies[0],desired=Array.from(next.tBodies[0].rows);
 function id(row){
  var button=row.querySelector('[data-lb-board-train]');
  return button?button.dataset.lbBoardTrain+'|'+button.dataset.lbBoardDate:'';
 }
 var buckets=new Map();
 Array.from(body.rows).forEach(function(row){
  var key=id(row);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(row);
 });
 var keep=new Set();
 desired.forEach(function(target,index){
  var key=id(target),found=buckets.get(key)?.shift();
  if(!found){
   body.insertBefore(target,body.rows[index]||null);
   keep.add(target);
   return;
  }
  keep.add(found);
  if(found.className!==target.className)found.className=target.className;
  Array.from(target.cells).forEach(function(fresh,i){
   var current=found.cells[i];
   if(!current)return;
   if(current.className!==fresh.className)current.className=fresh.className;
   if(current.innerHTML!==fresh.innerHTML)current.innerHTML=fresh.innerHTML;
  });
  if(body.rows[index]!==found)body.insertBefore(found,body.rows[index]||null);
 });
 Array.from(body.rows).forEach(function(row){if(!keep.has(row))row.remove();});
 return true;
}
function draw(rows,cached){
 var host=document.getElementById('lbBoardRows'),more=document.getElementById('lbBoardMore');
 if(!rows.length){
  var empty='<p class="lb-board-wait">Aucun autre train prévu pour cette gare.</p>';
  if(host.innerHTML!==empty)host.innerHTML=empty;
  S.lastMarkup=empty;more.hidden=true;return;
 }
 var heading=S.mode==='dep'?'DÉPARTS':'ARRIVÉES';
 var col=S.mode==='dep'?'DESTINATION':'PROVENANCE';
 var html='<div class="lb-gare-table-top"><b>'+heading+'</b><span class="lb-gare-clock-live"><span class="lb-gare-clock-live-label" aria-hidden="true">LIVE</span><time id="lbBoardClock" aria-label="Heure actuelle" aria-live="off" title="Horloge actualisée chaque seconde">'+boardClockText()+'</time></span></div>'+
 '<table class="lb-gare-table"><colgroup><col style="width:47%"><col style="width:21%"><col style="width:32%"></colgroup>'+
 '<thead><tr><th>'+col+'</th><th>HEURE</th><th aria-label="Voie et détails"></th></tr></thead><tbody>';
 rows.slice(0,S.limit).forEach(function(r){
  var late=r.delay>0,partial=!!r.partial,cancelled=!!r.cancelled;
  var status=cached?'Non actualisé':cancelled?'Supprimé':r.bePlannedOnly?'Horaire prévu':partial?'Suppr. partielle':late?'Retard +'+r.delay+'m':r.exact?'À l’heure':'Prévu';
  var statusClass=cancelled?'is-cancelled':partial?'is-partial':late?'is-late':'is-normal';
  var timeText=late&&r.planned!==r.when
    ?'<s class="lb-gare-old-time">'+clock(r.planned)+'</s><strong class="lb-gare-time is-late">'+clock(r.when)+'</strong>'
    :'<strong class="lb-gare-time '+(cancelled?'is-cancelled':'')+'">'+clock(r.when)+'</strong>';
  var rawNum=String(r.number||'').trim();
  var num=r.exact?rawNum:(r.category==='bus'?'BUS ':'TER ')+rawNum.replace(/^TER |^BUS /i,'');
  var place=internationalBoardPlace(r);
  var details='<button type="button" class="lb-gare-details" data-lb-board-train="'+clean(r.number)+'" data-lb-board-date="'+clean(r.day)+'" aria-label="Ouvrir le détail du '+clean(num)+'">🐄 Détails</button>';
  var voie=r.category==='bus'?'<span class="lb-gare-bus" title="Service routier" aria-label="Bus"><svg class="bus-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect x="12" y="7" width="40" height="43" rx="7" fill="#0a0a0a"/><rect x="17" y="13" width="30" height="15" rx="2.5" fill="#ffffff"/><rect x="17" y="33" width="6" height="5" rx="1" fill="#ffffff"/><rect x="41" y="33" width="6" height="5" rx="1" fill="#ffffff"/><rect x="21" y="42" width="22" height="3" rx="1.5" fill="#ffffff"/><circle cx="20" cy="52" r="5" fill="#0a0a0a"/><circle cx="44" cy="52" r="5" fill="#0a0a0a"/></svg></span>'
           :r.track?'<span class="lb-gare-voie" title="Voie '+clean(r.track)+'"><small>Voie</small><b>'+clean(r.track)+'</b></span>':'';
  html+='<tr class="'+statusClass+'"><td class="lb-gare-place-cell"><b class="lb-gare-place">'+clean(place||'Destination inconnue')+'</b><small class="lb-gare-train">'+clean(num)+'</small></td>'+
   '<td class="lb-gare-clock-cell">'+timeText+'<small class="lb-gare-status '+statusClass+'">'+clean(status)+'</small></td>'+
   '<td class="lb-gare-actions"><div class="lb-gare-actions-inner">'+voie+details+'</div></td></tr>';
 });
 var markup=html+'</tbody></table>';
 // L'horloge qui avance ne nécessite pas un remplacement de tout le tableau.
 var stable=markup.replace(/<time id="lbBoardClock"[^>]*>[^<]*<\/time>/,'<time id="lbBoardClock"></time>');
 if(S.lastMarkup===stable&&host.querySelector('.lb-gare-table')){
  var clockLabel=host.querySelector('#lbBoardClock');
  if(clockLabel)clockLabel.textContent=boardClockText();
 }else{
  if(!patchTableInPlace(host,markup))host.innerHTML=markup;
  S.lastMarkup=stable;
 }
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
  var old=getCached();if(old&&Date.now()-old.at<60000){draw(old.rows,true);src('Mise à jour en direct…');}
  else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Chargement des prochains trains…</p>';src('Chargement à la demande…');}
  return;
 }
 var rows=getRows();draw(rows,false);saveCached(rows);
 src('Synchronisation avec la carte… · horaires prévus en attendant');
}
function refresh(){
  void ensureBelgianStations().catch(function(){});
 // Dès que l'index local est prêt, afficher SYNCHRONEMENT chaque gare.
 var ticket=++S.token;
 render();
 if(!S.staticData){
  loadStatic().then(function(){
   if(S.open&&ticket===S.token)render();
  }).catch(function(){
   if(!S.open||ticket!==S.token||S.exact)return;
   var old=getCached();
   if(old){draw(old.rows,true);src('Hors ligne · données mémorisées non actualisées');}
   else{document.getElementById('lbBoardRows').innerHTML='<p class="lb-board-wait">Horaires temporairement indisponibles.</p>';src('Impossible de récupérer les horaires');}
  });
 }
 // La requête LIVE enrichit les horaires mais ne bloque JAMAIS l'ouverture.
 loadLive().then(function(){
  if(S.open&&ticket===S.token&&S.staticData&&!S.exact)render();
 }).catch(function(){});
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
 // Ne plus attendre 1,8 s lorsque la carte est déjà disponible.
 if(S.bridgeTarget?.contentWindow)sendExactRequest();
 S.bridgeTimer=setTimeout(bridgeLoop,S.exact?30000:2700);
}
/* Voie Luxembourg : même correspondance sécurisée que la carte BER V9.
 * SNCF Nancy TER 88513 => HAFAS 88512, numéro + retards jamais modifiés.
 * Donnée HAFAS unique, même arrivée planifiée, provenance Nancy, jour courant.
 * Récupération paresseuse, maximum 1 requête / 60s, jamais bloquante. */
var LUX_ARRIVAL_FEED='https://vps.labetaillere.fr/g/e7a329d6';
function luxServiceDay(date){
 var parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(date);
 var d={};parts.forEach(function(p){d[p.type]=p.value;});
 return d.year+'-'+d.month+'-'+d.day;
}
function luxPlatformValue(info){
 var raw=info?.arrivalPlatformRealtime||info?.arrivalPlatformPlanned;
 if(typeof raw!=='string'&&typeof raw!=='number')return '';
 var platform=String(raw).trim();
 return /^[a-z\d][a-z\d\s-]{0,10}$/i.test(platform)?platform.slice(0,8):'';
}
function mergeLuxArrivalTracks(rows){
 if(norm(S.station)!=='luxembourg'||S.mode!=='arr'||!Array.isArray(rows))return false;
 var feed=S.luxArrivalFeed;
 if(!feed||Date.now()-S.luxArrivalAt>60000)return false;
 var changed=false;
 rows.forEach(function(row){
  if(row.track||!/^nancy(?: ville)?$/.test(norm(row.origin)))return;
  var raw=String(row.number||'');
  var match=raw.match(/\b(885\d{2})\b/);
  if(!match)return;
  var number=Number(match[1]);
  var arrivalClock=clock(row.planned);
  if(!arrivalClock||row.day!==feed.day)return;
  // Certaines courses SNCF/CFL ont le même numéro, d'autres +/- 1.
  // L'horaire prévu et la provenance Nancy doivent toujours coïncider.
  var candidates=Array.from(feed.data.entries()).filter(function(entry){
   var key=Number(entry[0]),info=entry[1];
   return Math.abs(key-number)<=1 && info.arrivalPlanned===arrivalClock &&
    luxPlatformValue(info) && /^nancy(?: ville)?$/.test(norm(info.origin));
  }).map(function(entry){return entry[1];});
  // Repli sûr : uniquement si un seul train CFL de Nancy correspond à
  // l'heure exacte (au cas où la numérotation évolue davantage).
  if(!candidates.length){
   candidates=Array.from(feed.data.values()).filter(function(info){
    return info.arrivalPlanned===arrivalClock && luxPlatformValue(info) &&
     /^nancy(?: ville)?$/.test(norm(info.origin));
   });
  }
  var matching=candidates;
  // Jamais de voie supposée si les candidats ne sont pas uniques.
  if(matching.length!==1)return;
  var platform=luxPlatformValue(matching[0]);
  if(platform){row.track=platform;row.trackFromCflAlias=true;changed=true;}
 });
 return changed;
}
function ensureLuxArrivalTracks(){
 if(!S.open||norm(S.station)!=='luxembourg'||S.mode!=='arr'||!navigator.onLine)return;
 if(S.luxArrivalPromise)return;
 if(S.luxArrivalFeed&&Date.now()-S.luxArrivalAt<60000){
  if(S.exact&&mergeLuxArrivalTracks(S.exact))render();
  return;
 }
 S.luxArrivalPromise=(async function(){
  var ctrl=new AbortController(),t=setTimeout(function(){ctrl.abort();},4500);
  try{
   var response=await fetch(LUX_ARRIVAL_FEED,{cache:'no-store',mode:'cors',signal:ctrl.signal});
   if(!response.ok)return;
   var payload=await response.json(),entries=payload?.data;
   var updated=new Date(payload?.updatedAt);
   if(!entries||typeof entries!=='object'||!Number.isFinite(updated.getTime())||
    Math.abs(Date.now()-updated.getTime())>8*60000)return;
   var map=new Map();
   Object.entries(entries).forEach(function(entry){
    var number=String(entry[0]).match(/885\d{2}/);
    if(number&&entry[1]&&typeof entry[1]==='object')map.set(number[0],entry[1]);
   });
   if(!map.size)return;
   S.luxArrivalFeed={data:map,day:luxServiceDay(updated)};
   S.luxArrivalAt=Date.now();
   if(S.open&&S.exact&&mergeLuxArrivalTracks(S.exact)){
    S.exactCache.set(S.exactKey,{at:Date.now(),rows:S.exact});
    render();
   }
  }catch(_){/* La voie reste non renseignée si CFL indisponible. */}
  finally{clearTimeout(t);}
 })();
 S.luxArrivalPromise.finally(function(){S.luxArrivalPromise=null;});
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
   imminent:!!r.isImminent,bePlannedOnly:!!r.bePlannedOnly,trainId:r.trainId,exact:true};
 });
 mergeLuxArrivalTracks(S.exact);
 S.exactCache.set(S.exactKey,{at:Date.now(),rows:S.exact});
 if(S.exactCache.size>24)S.exactCache.delete(S.exactCache.keys().next().value);
 render();ensureLuxArrivalTracks();
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
 var seen=new Set(),all=[];
 [favorites.morning,favorites.evening].concat(priority,S.stations).forEach(function(name){
  if(!name||seen.has(norm(name)))return;
  seen.add(norm(name));all.push(name);
 });
 S.stationChoices=all;
 renderStationOptions();
}
/* Les boutons sélectionnent immédiatement la gare sur mobile.
 * Ouvrir la liste ne donne pas le focus au champ et n'ouvre pas le clavier. */
function renderStationOptions(){
 var host=document.getElementById('lbBoardStationResults');
 var input=document.getElementById('lbBoardStationSearch');
 var hint=document.getElementById('lbBoardStationHint');
 if(!host||!input)return;
 var query=norm(input.value);
 var matches=S.stationChoices.filter(function(name){return norm(name).includes(query);});
 if(query)matches.sort(function(a,b){
  return Number(!norm(a).startsWith(query))-Number(!norm(b).startsWith(query));
 });
 var shown=matches.slice(0,query?24:15);
 host.replaceChildren(...shown.map(function(name){
  var button=document.createElement('button');
  button.type='button';button.className='lb-board-station-option';
  button.dataset.lbBoardStationChoice=name;
  button.setAttribute('aria-current',String(norm(name)===norm(S.station)));
  button.textContent=name;
  return button;
 }));
 if(hint)hint.textContent=!matches.length?'Aucune gare trouvée.':matches.length>shown.length
  ?matches.length+' gares · Affine la recherche pour afficher les autres.'
  :query?matches.length+' gare'+(matches.length>1?'s':'')+' trouvée'+(matches.length>1?'s':'')+'.'
  :'Choisis une gare : validation immédiate.';
}
function showStationPicker(visible){
 var panel=document.getElementById('lbBoardStationPanel');
 var toggle=document.getElementById('lbBoardStationToggle');
 var input=document.getElementById('lbBoardStationSearch');
 if(!panel||!toggle)return;
 panel.hidden=!visible;
 toggle.setAttribute('aria-expanded',String(visible));
 if(visible){
  if(input)input.value='';
  renderStationOptions();
 }else if(input){
  if(document.activeElement===input)input.blur();
  input.value='';
 }
}
function onAccountStationsUpdated(){
 renderChoices();
 if(!S.open||S.userPicked)return;
 var wanted=defaultStation();
 if(norm(wanted)!==norm(S.station))choose(wanted,false);
}

function useRecentExact(){
 var key=norm(S.station)+'|'+S.mode,hit=S.exactCache.get(key);
 S.exact=hit&&Date.now()-hit.at<30000?hit.rows:null;
 S.exactKey=S.exact?key:'';
 if(S.exact)mergeLuxArrivalTracks(S.exact);
}
function choose(value,explicit){
 var key=norm(friendly(value)),favorites=accountStations();
 var name=S.stations.find(function(x){return norm(x)===key;})||priority.find(function(x){return norm(x)===key;})||[favorites.morning,favorites.evening].find(function(x){return norm(x)===key;});
 if(!name){src('Gare non reconnue : choisis une gare dans la liste.');return false;}
 if(explicit!==false)S.userPicked=true;
 S.station=name;S.limit=8;useRecentExact();
 document.getElementById('lbBoardStationValue').textContent=name;
 showStationPicker(false);
 setTitle();renderChoices();refresh();requestExact();ensureLuxArrivalTracks();
 return true;
}
function tabs(){
 document.querySelectorAll('[data-lb-board-mode]').forEach(function(btn){
  btn.setAttribute('aria-selected',String(btn.dataset.lbBoardMode===S.mode));
 });
 // Teinte du tableau dépend seulement de la direction affichée.
 var overlay=document.getElementById('lbStationBoardOverlay');
 if(overlay)overlay.setAttribute('data-board-mode',S.mode);
}
function open(station){
 var overlay=document.getElementById('lbStationBoardOverlay');if(!overlay)return;
 S.lastFocus=document.activeElement;S.open=true;S.mode='dep';S.limit=8;S.userPicked=false;
 S.station=friendly(station||defaultStation());useRecentExact();
 overlay.hidden=false;document.body.classList.add('lb-board-visible');
 document.getElementById('lbBoardStationValue').textContent=S.station;showStationPicker(false);tabs();setTitle();renderChoices();
 document.getElementById('lbStationBoardSheet').focus({preventScroll:true});
 overlay.dispatchEvent(new Event('lb-board-opened'));
 startBoardClock();
 refresh();requestExact();ensureLuxArrivalTracks();
}
function close(){
 if(!S.open)return;S.open=false;++S.token;stopBoardClock();stopBridge();showStationPicker(false);
 document.getElementById('lbStationBoardOverlay').hidden=true;
 document.body.classList.remove('lb-board-visible');
 if(S.lastFocus?.isConnected)S.lastFocus.focus({preventScroll:true});
}
/* En gare — tiroir à hauteur stable et poignée redimensionnable.
 * La hauteur ne dépend plus des statuts/retards ni du mode Départs/Arrivées. */
function setupDrawerResize(overlay){
 var sheet=overlay.querySelector('#lbStationBoardSheet'),handle=overlay.querySelector('.lb-board-handle');
 if(!sheet||!handle)return;
 handle.setAttribute('role','slider');
 handle.setAttribute('tabindex','0');
 handle.setAttribute('aria-label','Régler la hauteur du tiroir En gare');
 handle.setAttribute('aria-orientation','vertical');
 handle.setAttribute('title','Faire glisser vers le haut ou le bas pour régler la hauteur');
 var drag=null,userHeight=null;
 function bounds(){
  var viewport=Math.min(window.innerHeight,window.visualViewport?.height||window.innerHeight);
  var max=Math.max(220,Math.floor(viewport)-8);
  var min=Math.min(max,Math.max(330,Math.round(max*.5)));
  return {min:min,max:max};
 }
 function syncAria(){
  var b=bounds(),height=Math.round(sheet.getBoundingClientRect().height);
  handle.setAttribute('aria-valuemin',String(b.min));
  handle.setAttribute('aria-valuemax',String(b.max));
  handle.setAttribute('aria-valuenow',String(height));
  handle.setAttribute('aria-valuetext',height+' pixels');
 }
 function changeHeight(next){
  var b=bounds();
  userHeight=Math.max(b.min,Math.min(b.max,Math.round(next)));
  sheet.style.setProperty('--lb-board-drawer-height',userHeight+'px');
  syncAria();
 }
 handle.addEventListener('pointerdown',function(e){
  if(e.button!==0)return;
  e.preventDefault();
  drag={id:e.pointerId,startY:e.clientY,startHeight:sheet.getBoundingClientRect().height};
  handle.setPointerCapture?.(e.pointerId);
  handle.classList.add('is-dragging');
 });
 handle.addEventListener('pointermove',function(e){
  if(!drag||drag.id!==e.pointerId)return;
  e.preventDefault();
  changeHeight(drag.startHeight+drag.startY-e.clientY);
 });
 function endDrag(e){
  if(!drag||drag.id!==e.pointerId)return;
  drag=null;handle.classList.remove('is-dragging');
  if(handle.hasPointerCapture?.(e.pointerId))handle.releasePointerCapture(e.pointerId);
 }
 handle.addEventListener('pointerup',endDrag);
 handle.addEventListener('pointercancel',endDrag);
 handle.addEventListener('lostpointercapture',function(){drag=null;handle.classList.remove('is-dragging');});
 handle.addEventListener('keydown',function(e){
  var amount=(e.shiftKey?50:24),key=e.key;
  if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(key))return;
  e.preventDefault();
  var h=sheet.getBoundingClientRect().height,b=bounds();
  changeHeight(key==='Home'?b.min:key==='End'?b.max:h+((key==='ArrowUp'||key==='PageUp')?amount:-amount));
 });
 handle.addEventListener('dblclick',function(){
  userHeight=null;sheet.style.removeProperty('--lb-board-drawer-height');syncAria();
 });
 window.addEventListener('resize',function(){
  if(userHeight!==null)changeHeight(userHeight);
  else syncAria();
 });
 overlay.addEventListener('lb-board-opened',syncAria);
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
 '<span id="lbBoardStationLabel" class="lb-board-picker-label">Choisir une gare</span><div class="lb-board-picker"><button type="button" id="lbBoardStationToggle" aria-labelledby="lbBoardStationLabel lbBoardStationValue" aria-controls="lbBoardStationPanel" aria-expanded="false"><span id="lbBoardStationValue">Nancy</span><span class="lb-board-station-chevron" aria-hidden="true">⌄</span></button><div id="lbBoardStationPanel" class="lb-board-station-panel" hidden><label for="lbBoardStationSearch" class="lb-board-station-search-label">Rechercher une gare</label><input id="lbBoardStationSearch" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Nom de la gare…" aria-controls="lbBoardStationResults"><div id="lbBoardStationResults" class="lb-board-station-results" role="group" aria-label="Choisir une gare"></div><p id="lbBoardStationHint" class="lb-board-station-hint" aria-live="polite"></p></div></div>'+ 
 '<div id="lbBoardFavorites" class="lb-board-favorites" role="group" aria-label="Mes gares favorites" hidden><button type="button" data-lb-board-favorite="morning"><span class="lb-board-fav-label">☀ Matin</span><span class="lb-board-fav-station"></span></button><button type="button" data-lb-board-favorite="evening"><span class="lb-board-fav-label">☾ Soir</span><span class="lb-board-fav-station"></span></button></div>'+ 
 '<div class="lb-board-tabs" role="tablist" aria-label="Départs ou arrivées"><button type="button" data-lb-board-mode="dep" role="tab" aria-selected="true">↗ Départs</button><button type="button" data-lb-board-mode="arr" role="tab" aria-selected="false">↙ Arrivées</button></div>'+
 '<p class="lb-board-source" id="lbBoardSource" aria-live="polite">Chargement à la demande…</p><div id="lbBoardRows" class="lb-board-rows" aria-live="polite"></div>'+
 '<button type="button" class="lb-board-more" id="lbBoardMore" hidden>Voir plus de trains ↓</button></section>';
 document.body.appendChild(wrap);
 setupDrawerResize(wrap);
 wrap.addEventListener('click',function(e){
  if(e.target.closest('[data-lb-board-close]'))return close();
  var stationOption=e.target.closest('[data-lb-board-station-choice]');
  if(stationOption){choose(stationOption.dataset.lbBoardStationChoice,true);return;}
  if(e.target.closest('#lbBoardStationToggle')){
   var panel=document.getElementById('lbBoardStationPanel');
   showStationPicker(!!panel?.hidden);
   return;
  }
  if(!e.target.closest('.lb-board-picker'))showStationPicker(false);
  var favorite=e.target.closest('[data-lb-board-favorite]');
  if(favorite){var name=accountStations()[favorite.dataset.lbBoardFavorite];if(name)choose(name,true);return;}
  var mode=e.target.closest('[data-lb-board-mode]');if(mode){if(S.mode===mode.dataset.lbBoardMode)return;S.mode=mode.dataset.lbBoardMode;S.limit=8;useRecentExact();tabs();refresh();requestExact();ensureLuxArrivalTracks();return;}
  var train=e.target.closest('[data-lb-board-train]');if(train){var num=train.dataset.lbBoardTrain,date=train.dataset.lbBoardDate;close();if(typeof window.lbOpenTrainDetail==='function')window.lbOpenTrainDetail(num,date);return;}
  if(e.target.closest('#lbBoardMore')){S.limit+=8;render();}
 });
 /* iOS/Android : quand le clavier est ouvert, le premier clic natif peut
    seulement retirer le focus du champ. Valider au touchend (avant le click),
    sans gêner le défilement du sélecteur par glissement. */
 var stationResults=wrap.querySelector('#lbBoardStationResults'),pendingStationTouch=null;
 stationResults.addEventListener('touchstart',function(e){
  if(e.touches.length!==1){pendingStationTouch=null;return;}
  var button=e.target.closest('[data-lb-board-station-choice]');
  if(!button){pendingStationTouch=null;return;}
  var finger=e.touches[0];
  pendingStationTouch={name:button.dataset.lbBoardStationChoice,x:finger.clientX,y:finger.clientY};
 },{passive:true});
 stationResults.addEventListener('touchmove',function(e){
  if(!pendingStationTouch||e.touches.length!==1)return;
  var finger=e.touches[0];
  if(Math.abs(finger.clientX-pendingStationTouch.x)>12||Math.abs(finger.clientY-pendingStationTouch.y)>12)pendingStationTouch=null;
 },{passive:true});
 stationResults.addEventListener('touchcancel',function(){pendingStationTouch=null;},{passive:true});
 stationResults.addEventListener('touchend',function(e){
  var tap=pendingStationTouch;pendingStationTouch=null;
  if(!tap||e.changedTouches.length!==1)return;
  var finger=e.changedTouches[0];
  if(Math.abs(finger.clientX-tap.x)>12||Math.abs(finger.clientY-tap.y)>12)return;
  var option=e.target.closest('[data-lb-board-station-choice]');
  if(!option||norm(option.dataset.lbBoardStationChoice)!==norm(tap.name))return;
  e.preventDefault(); // Pas de clic fantôme et sélection avant la fermeture du clavier
  e.stopPropagation();
  choose(tap.name,true);
 },{passive:false});
 var stationSearch=wrap.querySelector('#lbBoardStationSearch');
 stationSearch.addEventListener('input',renderStationOptions);
 stationSearch.addEventListener('keydown',function(e){
  if(e.key==='Enter'){
   e.preventDefault();
   var first=wrap.querySelector('#lbBoardStationResults [data-lb-board-station-choice]');
   if(first)choose(first.dataset.lbBoardStationChoice,true);
  }
 });
 document.addEventListener('keydown',function(e){
  if(e.key!=='Escape'||!S.open)return;
  e.preventDefault();
  if(!document.getElementById('lbBoardStationPanel').hidden){showStationPicker(false);return;}
  close();
 });
 window.addEventListener('message',onExactResponse);
 document.addEventListener('lb:prefs-updated',onAccountStationsUpdated);
 document.addEventListener('lb:auth-state',onAccountStationsUpdated);
 window.addEventListener('online',function(){if(S.open)refresh();});
 document.addEventListener('visibilitychange',function(){if(!S.open)return;if(document.hidden)stopBoardClock();else{startBoardClock();if(Date.now()-S.liveAt>45000)refresh();}});
 window.lbOpenStationBoard=open;
}
// Préparer l'index local pendant un temps libre, sans bloquer l'accueil.
function warmBoardData(){
 if(navigator.connection?.saveData)return;
 loadStatic().catch(function(){});
 loadLive().catch(function(){});
}
function scheduleWarm(){
 if(typeof requestIdleCallback==='function')requestIdleCallback(warmBoardData,{timeout:2600});
 else setTimeout(warmBoardData,1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init();scheduleWarm();},{once:true});else{init();scheduleWarm();}
})();
