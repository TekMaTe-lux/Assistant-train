(() => {
'use strict';

const API='/api/map-v2/route-editor';
const RFN='/map-v2/data/moorail-rfn-game-v2';
const $=id=>document.getElementById(id);

const state={
  catalog:[], serverState:{sections:{}}, route:null, legIndex:0,
  manifest:null, cellSize:.2, cells:new Map(), segments:new Map(), graph:null,
  via:[], fixedMarkers:[], viaMarkers:[], routeLayers:[], railLayers:new Map(),
  loadingToken:0, routeCoords:[], routeKm:0, routeErrors:0
};

const map=L.map('map',{zoomControl:true,minZoom:5,maxZoom:19,preferCanvas:true}).setView([48.95,6.02],10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,opacity:.42,attribution:'© OpenStreetMap'}).addTo(map);
map.createPane('rfn');map.getPane('rfn').style.zIndex=360;
map.createPane('route');map.getPane('route').style.zIndex=520;
map.createPane('markers');map.getPane('markers').style.zIndex=600;
const railRenderer=L.canvas({padding:.4});

const el={
  search:$('search'),routes:$('routes'),legs:$('legs'),routeTitle:$('routeTitle'),routeMeta:$('routeMeta'),legHelp:$('legHelp'),
  status:$('status'),rfnInfo:$('rfnInfo'),cellInfo:$('cellInfo'),viaCount:$('viaCount'),partCount:$('partCount'),kmCount:$('kmCount'),errorCount:$('errorCount')
};

$('undo').onclick=()=>{if(!state.via.length)return;state.via.pop();renderVia();recompute();};
$('reset').onclick=()=>{state.via=[];renderVia();recompute();setStatus('Passages intermédiaires supprimés. Le trajet est recalculé uniquement entre les deux gares.','warn');};
$('validate').onclick=validateLeg;
el.search.oninput=renderRoutes;
map.on('click',e=>addVia(e.latlng));

boot();

async function boot(){
  try{
    setStatus('Chargement du catalogue TGV…');
    const [cat,sv,mf]=await Promise.all([
      fetch(`${API}/catalog`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('catalog '+r.status);return r.json()}),
      fetch(`${API}/state`,{cache:'no-cache'}).then(r=>r.ok?r.json():({sections:{}})),
      fetch(`${RFN}/manifest.json?v=3`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('RFN '+r.status);return r.json()})
    ]);
    state.catalog=cat.routes||[];state.serverState=sv||{sections:{}};state.manifest=mf;state.cellSize=+mf.cellSize||.2;
    el.rfnInfo.textContent=`RFN détaillé : ${mf.features||'?'} objets · cellules ${mf.cells||'?'} · zoom ${mf.minZoom||10}+`;
    renderRoutes();
    const preferred=state.catalog.find(r=>r.origin==='Paris Est'&&r.destination==='Nancy')||state.catalog.find(r=>r.origin==='Paris Est'&&r.destination==='Strasbourg')||state.catalog[0];
    if(preferred)await selectRoute(preferred);
    else setStatus('Aucun parcours grande vitesse trouvé.','bad');
  }catch(e){console.error(e);setStatus(`Erreur initialisation : ${e.message}`,'bad');}
}

function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setStatus(s,k=''){el.status.className='status'+(k?' '+k:'');el.status.innerHTML=s;}
function leg(){return state.route?.sections?.[state.legIndex]||null;}
function stopPair(){if(!state.route)return null;return [state.route.stops[state.legIndex],state.route.stops[state.legIndex+1]];}

function renderRoutes(){
  const q=norm(el.search.value);el.routes.innerHTML='';
  let rs=state.catalog.filter(r=>!q||norm(`${r.origin} ${r.destination} ${r.signature} ${(r.trainNumbers||[]).join(' ')}`).includes(q));
  rs=rs.slice(0,60);
  for(const r of rs){
    const b=document.createElement('button');b.className='route'+(state.route?.id===r.id?' active':'');
    const val=(r.sections||[]).filter(s=>state.serverState.sections?.[s.id]?.status==='validated').length;
    b.innerHTML=`<b>${esc(r.origin)} → ${esc(r.destination)}</b><span>${r.tripCount||0} circulations · ${val}/${r.sections?.length||0} étapes validées · ${(r.trainNumbers||[]).slice(0,5).join(', ')}</span>`;
    b.onclick=()=>selectRoute(r);el.routes.appendChild(b);
  }
  if(!rs.length)el.routes.innerHTML='<div class="help">Aucun parcours correspondant.</div>';
}

async function selectRoute(r){
  state.route=r;state.legIndex=0;state.via=[];renderRoutes();renderLegs();await activateLeg(0);
}

function renderLegs(){
  if(!state.route)return;
  el.routeTitle.textContent=`${state.route.origin} → ${state.route.destination}`;
  el.routeMeta.textContent=`${state.route.tripCount||0} circulations · trains ${(state.route.trainNumbers||[]).slice(0,12).join(', ')}`;
  el.legs.innerHTML='';
  (state.route.sections||[]).forEach((s,i)=>{
    const saved=state.serverState.sections?.[s.id]?.status==='validated';
    const b=document.createElement('button');b.className='leg'+(i===state.legIndex?' active':'')+(saved?' saved':'');
    b.innerHTML=`<b>${i+1}. ${esc(s.from?.name||state.route.stops[i]?.name)} → ${esc(s.to?.name||state.route.stops[i+1]?.name)}</b><span>${saved?'✓ validée':'à vérifier'}${state.serverState.sections?.[s.id]?.waypoints?.length?` · ${state.serverState.sections[s.id].waypoints.length} passage(s) imposé(s)`:''}</span>`;
    b.onclick=()=>activateLeg(i);el.legs.appendChild(b);
  });
}

async function activateLeg(i){
  if(!state.route)return;state.legIndex=i;renderLegs();
  clearMapWork();
  const sec=leg(),pair=stopPair();if(!sec||!pair)return;
  const saved=state.serverState.sections?.[sec.id];
  state.via=(saved?.waypoints||[]).map(p=>({lat:+p.lat,lon:+p.lon})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  el.legHelp.innerHTML=`<b>${esc(pair[0].name)}</b> → <b>${esc(pair[1].name)}</b><br>Départ et arrivée sont fixes. Si le chemin jaune est faux, clique seulement sur un point de passage obligatoire (par exemple le raccord de Pagny).`;
  const a=[+pair[0].lat,+pair[0].lon],b=[+pair[1].lat,+pair[1].lon];
  if(a.every(Number.isFinite)&&b.every(Number.isFinite))map.fitBounds(L.latLngBounds([a,b]).pad(.18),{padding:[35,35],maxZoom:12});
  setStatus(`Chargement du RFN entre ${esc(pair[0].name)} et ${esc(pair[1].name)}…`);
  await loadCorridor(pair[0],pair[1]);
  buildGraph();renderFixed();renderVia();await recompute();
}

function clearMapWork(){
  state.loadingToken++;state.segments.clear();state.cells.clear();state.graph=null;state.routeCoords=[];
  for(const l of state.railLayers.values())map.removeLayer(l);state.railLayers.clear();
  for(const m of state.fixedMarkers)map.removeLayer(m);state.fixedMarkers=[];
  for(const m of state.viaMarkers)map.removeLayer(m);state.viaMarkers=[];
  for(const l of state.routeLayers)map.removeLayer(l);state.routeLayers=[];
  updateMetrics(0,0,0);
}

async function loadCorridor(a,b){
  const token=++state.loadingToken,cs=state.cellSize;
  const lon1=+a.lon,lon2=+b.lon,lat1=+a.lat,lat2=+b.lat;
  const lonPad=Math.max(.30,Math.abs(lon2-lon1)*.08),latPad=Math.max(.25,Math.abs(lat2-lat1)*.45);
  const x0=Math.floor((Math.min(lon1,lon2)-lonPad)/cs)-1,x1=Math.floor((Math.max(lon1,lon2)+lonPad)/cs)+1;
  const y0=Math.floor((Math.min(lat1,lat2)-latPad)/cs)-1,y1=Math.floor((Math.max(lat1,lat2)+latPad)/cs)+1;
  const jobs=[];let count=0;
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){count++;jobs.push(loadCell(x,y,token));}
  el.cellInfo.textContent=`Chargement de ${count} cellules…`;
  await Promise.all(jobs);
  if(token!==state.loadingToken)return;
  el.cellInfo.textContent=`${state.cells.size} cellules · ${state.segments.size} segments de voie`;
}

async function loadCell(x,y,token){
  const k=`${x}:${y}`;
  try{
    const r=await fetch(`${RFN}/cells/c_${x}_${y}.geojson`,{cache:'force-cache'});if(!r.ok)return;
    const g=await r.json();if(token!==state.loadingToken)return;
    state.cells.set(k,g.features||[]);
    const layer=L.geoJSON(g,{renderer:railRenderer,pane:'rfn',interactive:false,style:{color:'#4bdcf4',weight:1.15,opacity:.46}}).addTo(map);state.railLayers.set(k,layer);
    (g.features||[]).forEach((f,fi)=>{
      const geom=f.geometry||{};if(geom.type!=='LineString')return;const c=geom.coordinates||[];
      for(let j=0;j<c.length-1;j++){
        const p=c[j],q=c[j+1];if(!p||!q||p.length<2||q.length<2)continue;
        const id=`${k}|${fi}|${j}`;state.segments.set(id,{id,a:[+p[0],+p[1]],b:[+q[0],+q[1]],props:f.properties||{}});
      }
    });
  }catch(e){console.warn('cell',k,e)}
}

function nodeKey(c){return `${c[0].toFixed(6)},${c[1].toFixed(6)}`;}
function buildGraph(){
  const nodes=new Map(),adj=new Map();
  function node(c){const k=nodeKey(c);if(!nodes.has(k))nodes.set(k,{key:k,lon:c[0],lat:c[1]});if(!adj.has(k))adj.set(k,[]);return k;}
  for(const s of state.segments.values()){
    const a=node(s.a),b=node(s.b),w=distanceLL(s.a,s.b);s.aKey=a;s.bKey=b;s.w=w;
    adj.get(a).push({to:b,w,seg:s});adj.get(b).push({to:a,w,seg:s});
  }
  state.graph={nodes,adj};
}

function distanceLL(a,b){const R=6371000,p1=a[1]*Math.PI/180,p2=b[1]*Math.PI/180,dp=(b[1]-a[1])*Math.PI/180,dl=(b[0]-a[0])*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function projectToSeg(latlng,s){
  const lat=latlng.lat,lon=latlng.lng,cl=Math.cos(lat*Math.PI/180),x=(lon-s.a[0])*cl,y=lat-s.a[1],vx=(s.b[0]-s.a[0])*cl,vy=s.b[1]-s.a[1],den=vx*vx+vy*vy;let t=den?(x*vx+y*vy)/den:0;t=Math.max(0,Math.min(1,t));
  const p=[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t],d=distanceLL([lon,lat],p);return {p,t,d};
}
function anchorAt(latlng,kind){
  const radius=kind==='stop'?900:45,max=kind==='stop'?18:10,c=[];
  for(const s of state.segments.values()){const q=projectToSeg(latlng,s);if(q.d<=radius)c.push({s,...q});}
  c.sort((a,b)=>a.d-b.d);const keep=c.slice(0,max);if(!keep.length){let best=null;for(const s of state.segments.values()){const q=projectToSeg(latlng,s);if(!best||q.d<best.d)best={s,...q};}if(best)keep.push(best);}
  if(!keep.length)return null;
  const nearest=keep[0],links=[];
  for(const q of keep){links.push({node:q.s.aKey,cost:q.s.w*q.t+q.d});links.push({node:q.s.bKey,cost:q.s.w*(1-q.t)+q.d});}
  return {lat:kind==='stop'?latlng.lat:nearest.p[1],lon:kind==='stop'?latlng.lng:nearest.p[0],railLat:nearest.p[1],railLon:nearest.p[0],links,nearestSeg:nearest.s.id};
}

function renderFixed(){
  for(const m of state.fixedMarkers)map.removeLayer(m);state.fixedMarkers=[];const p=stopPair();if(!p)return;
  [p[0],p[1]].forEach((s,i)=>{
    const m=L.marker([+s.lat,+s.lon],{pane:'markers',interactive:false,icon:L.divIcon({className:'',html:`<div class="fixed-marker">${i?'B':'A'}</div>`,iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
    m.bindTooltip(s.name,{permanent:true,direction:'right',offset:[12,0]});state.fixedMarkers.push(m);
  });
}
function renderVia(){
  for(const m of state.viaMarkers)map.removeLayer(m);state.viaMarkers=[];
  state.via.forEach((p,i)=>{
    const m=L.marker([p.lat,p.lon],{pane:'markers',draggable:true,icon:L.divIcon({className:'',html:`<div class="via-marker">${i+1}</div>`,iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map);
    m.on('dragend',()=>{const a=anchorAt(m.getLatLng(),'via');if(!a){m.setLatLng([p.lat,p.lon]);return;}state.via[i]={lat:a.railLat,lon:a.railLon};renderVia();recompute();});
    m.on('contextmenu',()=>{state.via.splice(i,1);renderVia();recompute();});state.viaMarkers.push(m);
  });el.viaCount.textContent=state.via.length;
}
function addVia(latlng){
  if(!state.route||!state.graph)return;const a=anchorAt(latlng,'via');if(!a){setStatus('Aucune voie RFN proche de ce clic.','bad');return;}state.via.push({lat:a.railLat,lon:a.railLon});renderVia();recompute();
}

class Heap{constructor(){this.a=[]}push(x){const a=this.a;a.push(x);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=x[0])break;a[i]=a[p];i=p;}a[i]=x}pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1,r=l+1;if(l>=a.length)break;let c=r<a.length&&a[r][0]<a[l][0]?r:l;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return top}get size(){return this.a.length}}
function routeAnchors(A,B){
  if(!A||!B||!state.graph)return null;const dist=new Map(),prev=new Map(),heap=new Heap(),goal=new Map();
  for(const l of A.links){if(l.cost<(dist.get(l.node)??Infinity)){dist.set(l.node,l.cost);prev.set(l.node,null);heap.push([l.cost,l.node]);}}
  for(const l of B.links)goal.set(l.node,Math.min(goal.get(l.node)??Infinity,l.cost));
  let best=Infinity,end=null;
  while(heap.size){const [d,u]=heap.pop();if(d!==(dist.get(u)))continue;if(d>=best)break;if(goal.has(u)&&d+goal.get(u)<best){best=d+goal.get(u);end=u;}
    for(const e of state.graph.adj.get(u)||[]){const nd=d+e.w;if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,u);heap.push([nd,e.to]);}}
  }
  if(!end)return null;const keys=[];let u=end;while(u){keys.push(u);u=prev.get(u);}keys.reverse();const coords=[[A.lon,A.lat]];for(const k of keys){const n=state.graph.nodes.get(k);coords.push([n.lon,n.lat]);}coords.push([B.lon,B.lat]);return coords;
}

async function recompute(){
  for(const l of state.routeLayers)map.removeLayer(l);state.routeLayers=[];state.routeCoords=[];state.routeKm=0;state.routeErrors=0;
  const p=stopPair();if(!p||!state.graph)return;
  const anchors=[];const A=anchorAt(L.latLng(+p[0].lat,+p[0].lon),'stop'),B=anchorAt(L.latLng(+p[1].lat,+p[1].lon),'stop');if(!A||!B){setStatus('Impossible d’accrocher une gare au RFN détaillé.','bad');return;}
  anchors.push(A);for(const v of state.via){const x=anchorAt(L.latLng(v.lat,v.lon),'via');if(x)anchors.push(x);}anchors.push(B);
  let all=[];
  for(let i=0;i<anchors.length-1;i++){
    const c=routeAnchors(anchors[i],anchors[i+1]);if(!c){state.routeErrors++;continue;}
    if(all.length&&distanceLL(all.at(-1),c[0])<5)c.shift();all.push(...c);
    const line=L.polyline(c.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:5,opacity:.96}).addTo(map);state.routeLayers.push(line);
  }
  state.routeCoords=all;for(let i=1;i<all.length;i++)state.routeKm+=distanceLL(all[i-1],all[i])/1000;
  updateMetrics(anchors.length-1,state.routeKm,state.routeErrors);
  if(state.routeErrors) setStatus(`⚠ ${state.routeErrors} morceau(x) sans chemin. Ajoute un point de passage exactement sur le raccord qui doit être emprunté.`,`bad`);
  else setStatus(`✓ ${esc(p[0].name)} → ${esc(p[1].name)} calculé sur ${state.routeKm.toFixed(1)} km${state.via.length?` avec ${state.via.length} passage(s) imposé(s)`:''}.`,`ok`);
}
function updateMetrics(parts,km,errors){el.viaCount.textContent=state.via.length;el.partCount.textContent=parts;el.kmCount.textContent=km.toFixed(1);el.errorCount.textContent=errors;}

async function validateLeg(){
  const sec=leg(),pair=stopPair();if(!sec||!pair)return;if(state.routeErrors||state.routeCoords.length<2){setStatus('Impossible de valider tant que le tracé n’est pas continu.','bad');return;}
  const payload={
    routeId:state.route.id,sectionId:sec.id,status:'validated',source:'MOORAIL_STOP_TO_STOP_V3',
    route:{origin:state.route.origin,destination:state.route.destination,signature:state.route.signature},
    stopFrom:{name:pair[0].name,lat:+pair[0].lat,lon:+pair[0].lon},stopTo:{name:pair[1].name,lat:+pair[1].lat,lon:+pair[1].lon},
    waypoints:state.via.map(x=>({lat:x.lat,lon:x.lon})),coordinates:state.routeCoords,
    distanceKm:+state.routeKm.toFixed(3)
  };
  try{setStatus('Enregistrement de cette étape…');const r=await fetch(`${API}/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||r.status);state.serverState.sections=state.serverState.sections||{};state.serverState.sections[sec.id]={...payload,updatedAt:new Date().toISOString()};renderRoutes();renderLegs();setStatus(`✓ Étape validée : ${esc(pair[0].name)} → ${esc(pair[1].name)}.`,`ok`);}catch(e){setStatus(`Erreur sauvegarde : ${e.message}`,'bad');}
}

})();
