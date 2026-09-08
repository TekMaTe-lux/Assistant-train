from pathlib import Path
import re,sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')

s=s.replace('V1E · DIRECT DRAG','V1F · AIGUILLAGES')
s=s.replace('MOORAIL_DIRECT_POINTER_DRAG_V1E','MOORAIL_DIRECT_POINTER_DRAG_V1E\n// MOORAIL_BRANCH_LOCK_V1F',1)

# state branch layer
s=s.replace('junctionLayer:null,linkLayer:null,anchors:[]','junctionLayer:null,linkLayer:null,branchLayer:null,anchors:[]',1)

# add helpers before renderJunctions
anchor='function renderJunctions(){'
helpers=r'''
function clearBranchChoices(){if(state.branchLayer){map.removeLayer(state.branchLayer);state.branchLayer=null}}
function snapFromSegmentAtT(seg,t){
  const tt=Math.max(.001,Math.min(.999,Number(t)||0));
  const coord=[seg.a[0]+(seg.b[0]-seg.a[0])*tt,seg.a[1]+(seg.b[1]-seg.a[1])*tt];
  return makeSnap({coord,t:tt,distance:0,featureIndex:seg.featureIndex,partIndex:seg.partIndex,segmentIndex:seg.segmentIndex,a:seg.a,b:seg.b,ka:seg.ka,kb:seg.kb,d:seg.d,props:seg.props});
}
function nearestAdjacentJunctionKey(snap,maxM=140){
  if(!state.graph||!snap)return null;let best=null;
  for(const k of [snap.ka,snap.kb]){const c=state.graph.nodeCoords.get(k);if(!c)continue;const deg=(state.graph.adjacency.get(k)||[]).length;if(deg<3)continue;const d=distM(c,snap.coord);if(d<=maxM&&(!best||d<best.d))best={k,d,coord:c,deg};}
  return best;
}
function markBranchConstraint(snap,label=null){
  if(!snap)return snap;snap.forceSegment=true;const j=nearestAdjacentJunctionKey(snap);
  if(j){snap.junctionKey=j.k;snap.junctionCoord=j.coord;snap.label=label||`Aiguillage RFN ${snap.line||'—'}`;}
  else snap.label=label||`Branche RFN ${snap.line||'—'}`;
  return snap;
}
function upsertBranchConstraint(snap,insertIndex){
  if(!snap)return null;const j=snap.junctionKey;
  if(j){const existing=state.anchors.findIndex((a,i)=>i>0&&i<state.anchors.length-1&&a.junctionKey===j);if(existing>0){state.anchors[existing]=snap;return existing;}}
  const idx=Math.max(1,Math.min(state.anchors.length-1,Number(insertIndex)||state.anchors.length-1));state.anchors.splice(idx,0,snap);return idx;
}
function junctionInsertIndex(coord){
  if(!state.pieces?.length)return state.anchors.length-1;const p=[coord[0],coord[1]];let best={d:Infinity,idx:state.anchors.length-1};
  state.pieces.forEach((piece,pi)=>{for(let j=0;j<(piece.coords?.length||0)-1;j++){const q=projectPoint(p,piece.coords[j],piece.coords[j+1]);if(q.distance<best.d)best={d:q.distance,idx:piece.insertIndex??Math.min(state.anchors.length-1,pi+1)};}});return best.idx;
}
function showJunctionBranches(k,c){
  clearBranchChoices();const edges=state.graph?.adjacency?.get(k)||[];const seen=new Set(),layers=[];let n=0;
  for(const edge of edges){const seg=edge.seg;if(!seg)continue;const sid=`${seg.featureIndex}:${seg.partIndex}:${seg.segmentIndex}`;if(seen.has(sid))continue;seen.add(sid);n++;
    const fromA=seg.ka===k,frac=Math.min(.85,Math.max(.18,45/Math.max(1,seg.d))),t=fromA?frac:1-frac,snap=markBranchConstraint(snapFromSegmentAtT(seg,t),`Branche ${n} · RFN ${String(seg.props?.line||'—')}`),ll=[[c[1],c[0]],[snap.coord[1],snap.coord[0]]];
    const line=L.polyline(ll,{pane:'junctions',color:'#ffbd3e',weight:10,opacity:.82,interactive:true,bubblingMouseEvents:false});
    line.bindTooltip(`Branche ${n} · RFN ${snap.line||'—'} · clique pour imposer cette branche`,{sticky:true,className:'rail-tip'});
    line.on('click',async e=>{L.DomEvent.stopPropagation(e);const idx=junctionInsertIndex(c);upsertBranchConstraint(snap,idx);clearBranchChoices();renderAnchors();await recalculate(true);renderEditor();renderJunctions();setMapStatus(`Aiguillage verrouillé sur RFN ${snap.line||'—'}. Clique à nouveau le nœud pour changer de branche.`);});layers.push(line);
    layers.push(L.marker([snap.coord[1],snap.coord[0]],{pane:'junctions',interactive:false,icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:`<div class="dragAnchor">${n}</div>`})}));
  }
  state.branchLayer=L.layerGroup(layers).addTo(map);setMapStatus(`Nœud sélectionné : ${n} branche(s). Clique la branche que le train doit emprunter.`);
}
'''
if anchor not in s: raise SystemExit('renderJunctions anchor missing')
s=s.replace(anchor,helpers+anchor,1)

# replace junction click behavior to show branches instead of inserting ambiguous node
old="m.on('click',async e=>{L.DomEvent.stopPropagation(e);const snap=snapAtNode(c);if(!snap)return;snap.label='Nœud RFN';state.anchors.splice(state.anchors.length-1,0,snap);renderAnchors();await recalculate(true);renderEditor();});m.addTo(layer);"
new="m.on('click',e=>{L.DomEvent.stopPropagation(e);showJunctionBranches(k,c)});m.addTo(layer);"
if old not in s: raise SystemExit('junction click old missing')
s=s.replace(old,new,1)

# render anchor marker dragend should branch lock
old="marker.on('dragend',async e=>{const ll=e.target.getLatLng(),old=state.anchors[i],snap=snapGlobal(ll.lat,ll.lng);if(!snap){renderAnchors();return;}snap.label=old.label||`Passage ${i}`;state.anchors[i]=snap;await recalculate();renderEditor();});"
new="marker.on('dragend',async e=>{const ll=e.target.getLatLng(),old=state.anchors[i],snap=markBranchConstraint(snapGlobal(ll.lat,ll.lng),old.label);if(!snap){renderAnchors();return;}state.anchors[i]=snap;await recalculate(true);renderEditor();renderJunctions();});"
if old not in s: raise SystemExit('marker dragend old missing')
s=s.replace(old,new,1)

# hit route should use piece insertIndex
old="if(q.distance<best.distance)best={distance:q.distance,pieceIndex:pi,point:q.point};"
new="if(q.distance<best.distance)best={distance:q.distance,pieceIndex:pi,insertIndex:piece.insertIndex??Math.min(state.anchors.length-1,pi+1),point:q.point};"
if old not in s: raise SystemExit('hit route old missing')
s=s.replace(old,new,1)

# direct pointer down insert index
old="const container=map.getContainer(),ll=map.containerPointToLatLng(pointerContainerPoint(ev)),insertIndex=Math.min(state.anchors.length-1,hit.pieceIndex+1);state.directDrag={pointerId:ev.pointerId,insertIndex,startX:ev.clientX,startY:ev.clientY,lastLatLng:ll};"
new="const container=map.getContainer(),ll=map.containerPointToLatLng(pointerContainerPoint(ev)),insertIndex=Math.min(state.anchors.length-1,hit.insertIndex??hit.pieceIndex+1);state.directDrag={pointerId:ev.pointerId,insertIndex,startX:ev.clientX,startY:ev.clientY,lastLatLng:ll};"
if old not in s: raise SystemExit('direct down old missing')
s=s.replace(old,new,1)

# direct pointer up branch lock/upsert
old="const snap=snapGlobal(ll.lat,ll.lng);if(!snap){setMapStatus('Relâchement hors réseau : aucune modification.');return}snap.label=`Passage ${d.insertIndex}`;state.anchors.splice(d.insertIndex,0,snap);renderAnchors();await recalculate(true);renderEditor();renderJunctions();}"
new="const snap=markBranchConstraint(snapGlobal(ll.lat,ll.lng));if(!snap){setMapStatus('Relâchement hors réseau : aucune modification.');return}const idx=upsertBranchConstraint(snap,d.insertIndex);renderAnchors();await recalculate(true);renderEditor();renderJunctions();setMapStatus(`Branche imposée au point ${idx} · RFN ${snap.line||'—'}.`);}"
if old not in s: raise SystemExit('direct up old missing')
s=s.replace(old,new,1)

# replace legacy route end drag too
old="snap.label=`Passage ${drag.insertIndex}`;state.anchors.splice(drag.insertIndex,0,snap);renderAnchors();await recalculate(true);renderEditor();renderJunctions();"
new="markBranchConstraint(snap);upsertBranchConstraint(snap,drag.insertIndex);renderAnchors();await recalculate(true);renderEditor();renderJunctions();"
s=s.replace(old,new,1)

# nearestPiece returns insert index
old="if(q.distance<best.d)best={i,d:q.distance,coord:q.coord};"
new="if(q.distance<best.d)best={i,d:q.distance,coord:q.coord,insertIndex:piece.insertIndex??Math.min(state.anchors.length-1,i+1)};"
s=s.replace(old,new,1)

# add handle current path branch lock and correct insertion
old="const hit=nearestPieceIndex(latlng),base=hit?.coord||[latlng.lng,latlng.lat],snap=snapGlobal(base[1],base[0]);if(!snap)return;snap.label=`Poignée ${hit.i+1}`;state.anchors.splice(Math.min(state.anchors.length-1,hit.i+1),0,snap);await recalculate();renderEditor();"
new="const hit=nearestPieceIndex(latlng),base=hit?.coord||[latlng.lng,latlng.lat],snap=markBranchConstraint(snapGlobal(base[1],base[0]));if(!snap)return;upsertBranchConstraint(snap,hit?.insertIndex??Math.min(state.anchors.length-1,hit.i+1));await recalculate(true);renderEditor();"
if old in s: s=s.replace(old,new,1)

# add forced routing helpers before recalculate and replace recalculate
start=s.index('async function recalculate(showMessage=false){')
end=s.index('function addManualAnchor',start)
newblock=r'''
function gateSnap(base,t){
  const tt=Math.max(.002,Math.min(.998,t)),coord=[base.a[0]+(base.b[0]-base.a[0])*tt,base.a[1]+(base.b[1]-base.a[1])*tt];
  return {...base,coord,t:tt,distance:0,label:base.label};
}
function forcedStates(anchor){
  if(!anchor?.forceSegment||!anchor.a||!anchor.b||!Number.isFinite(anchor.d)||anchor.d<=0)return[{entry:anchor,exit:anchor,forced:null}];
  const half=Math.min(.44,Math.max(.08,38/anchor.d));let t1=Math.max(.015,anchor.t-half),t2=Math.min(.985,anchor.t+half);
  if(t2-t1<.12){const mid=(t1+t2)/2;t1=Math.max(.015,mid-.06);t2=Math.min(.985,mid+.06);}
  const a=gateSnap(anchor,t1),b=gateSnap(anchor,t2),speed=Math.max(40,Math.min(320,Number(anchor.speed)||120)),cost=Math.abs(t2-t1)*anchor.d/(speed/3.6);
  const ab={cost,coords:[a.coord,b.coord],lines:[anchor.line].filter(Boolean),links:[],forced:true,forceLine:anchor.line};
  const ba={cost,coords:[b.coord,a.coord],lines:[anchor.line].filter(Boolean),links:[],forced:true,forceLine:anchor.line};
  return[{entry:a,exit:b,forced:ab},{entry:b,exit:a,forced:ba}];
}
function planConstrainedRoute(){
  const A=state.anchors;if(A.length<2)return null;let dp=[{exit:A[0],cost:0,pieces:[]}];
  for(let ai=1;ai<A.length-1;ai++){
    const opts=forcedStates(A[ai]),next=[];
    for(const opt of opts){let best=null;for(const prev of dp){const leg=aStar(prev.exit,opt.entry);if(!leg)continue;leg.insertIndex=ai;leg.fromLabel=A[ai-1]?.label||'';leg.toLabel=A[ai]?.label||'';const pieces=[...prev.pieces,leg];let cost=prev.cost+leg.cost;if(opt.forced){const fp={...opt.forced,insertIndex:ai+1,fromLabel:A[ai]?.label||'',toLabel:A[ai]?.label||''};pieces.push(fp);cost+=fp.cost;}if(!best||cost<best.cost)best={exit:opt.exit,cost,pieces};}if(best)next.push(best);}if(!next.length)return null;dp=next;
  }
  let best=null;for(const prev of dp){const leg=aStar(prev.exit,A.at(-1));if(!leg)continue;leg.insertIndex=A.length-1;leg.fromLabel=A.at(-2)?.label||'';leg.toLabel=A.at(-1)?.label||'';const cand={cost:prev.cost+leg.cost,pieces:[...prev.pieces,leg]};if(!best||cand.cost<best.cost)best=cand;}return best;
}
async function recalculate(showMessage=false){if(!state.section||state.anchors.length<2||state.busy)return;state.busy=true;setMapStatus('Calcul du chemin avec verrouillage des aiguillages…');await new Promise(r=>setTimeout(r,10));try{const planned=planConstrainedRoute();if(!planned)throw new Error('aucun chemin RFN respectant les branches imposées');const pieces=planned.pieces;let coords=[];for(const p of pieces){if(!coords.length)coords.push(...p.coords);else coords.push(...p.coords.slice(1));}state.pieces=pieces;renderAnchors();if(state.newPathLayer)map.removeLayer(state.newPathLayer);const routeLL=coords.map(c=>[c[1],c[0]]),glow=L.polyline(routeLL,{pane:'new',color:'#18e7ff',weight:10,opacity:.16,interactive:false}),visible=L.polyline(routeLL,{pane:'new',color:'#89f8ff',weight:3.2,opacity:.98,interactive:false}),grab=L.polyline(routeLL,{pane:'new',color:'#ffffff',weight:22,opacity:0,interactive:false});state.newPathLayer=L.layerGroup([glow,visible,grab]).addTo(map);renderAnchors();const km=pieces.reduce((s,p)=>s+p.coords.slice(1).reduce((x,c,j)=>x+distM(p.coords[j],c),0),0)/1000;renderJunctions();const usedLinks=pieces.reduce((n,p)=>n+(p.links?.length||0),0),locks=state.anchors.filter(a=>a.forceSegment).length;setMapStatus(`Nouveau tracé : ${km.toFixed(1)} km · ${locks} aiguillage(s) verrouillé(s) · ${usedLinks} raccord(s) topo`);if(showMessage&&$('editStatus'))$('editStatus').innerHTML=`<strong>Chemin continu trouvé.</strong> ${locks} branche(s) imposée(s). Les ronds jaunes correspondent maintenant à des rails réellement verrouillés.`;}catch(e){if(state.newPathLayer){map.removeLayer(state.newPathLayer);state.newPathLayer=null}renderAnchors();renderJunctions();setMapStatus(`ERREUR : ${e.message}. Choisis une branche au nœud ou crée le raccord manquant.`);if($('editStatus'))$('editStatus').innerHTML=`<span style="color:#ff8794">${esc(e.message)}</span>`;}finally{state.busy=false;}}
'''
s=s[:start]+newblock+s[end:]

# addManualAnchor branch lock/upsert
old="function addManualAnchor(latlng,feature){if(!state.section||state.anchors.length<2||!state.graph)return;const snap=snapFeature(latlng,feature);if(!snap)return;snap.label=`Passage ${state.anchors.length-1}`;state.anchors.splice(state.anchors.length-1,0,snap);recalculate();renderEditor();setMapStatus('Passage ajouté. Tu peux maintenant faire glisser le rond jaune pour l’ajuster.');}"
new="function addManualAnchor(latlng,feature){if(!state.section||state.anchors.length<2||!state.graph)return;const snap=markBranchConstraint(snapFeature(latlng,feature));if(!snap)return;upsertBranchConstraint(snap,state.anchors.length-1);recalculate(true);renderEditor();setMapStatus(`Branche RFN ${snap.line||'—'} imposée.`);}"
if old not in s: raise SystemExit('addManualAnchor old missing')
s=s.replace(old,new,1)

# clear layers branch layer
s=s.replace("['currentPathLayer','newPathLayer','anchorLayer','stopLayer','junctionLayer','linkLayer']","['currentPathLayer','newPathLayer','anchorLayer','stopLayer','junctionLayer','linkLayer','branchLayer']",1)

# save waypoints include lock metadata and cuts safe
old="distance:a.distance,props:{line:a.line,kind:a.kind,speed:a.speed}})),cuts:state.pieces.map((p,i)=>({index:i,from:state.anchors[i].label,to:state.anchors[i+1].label,coordinates:p.coords,lineSequence:p.lines||[]})),"
new="distance:a.distance,forceSegment:!!a.forceSegment,junctionKey:a.junctionKey||null,junctionCoord:a.junctionCoord||null,props:{line:a.line,kind:a.kind,speed:a.speed}})),cuts:state.pieces.map((p,i)=>({index:i,from:p.fromLabel||'',to:p.toLabel||'',forced:!!p.forced,forceLine:p.forceLine||null,coordinates:p.coords,lineSequence:p.lines||[]})),"
if old not in s: raise SystemExit('save chunk old missing')
s=s.replace(old,new,1)

# editor text
s=s.replace('CLIQUE-MAINTIENS sur le cyan, TIRE-LE sur la branche voulue, puis RELÂCHE.','À UN EMBRANCHEMENT : clique le point violet, puis clique la BRANCHE à emprunter. Tu peux aussi tirer le cyan directement sur une branche.',1)

# label markers with lock visual
old='html:`<div class="dragAnchor">${i}</div>`'
new='html:`<div class="dragAnchor">${a.forceSegment?\'↗\':i}</div>`'
if old in s:s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('OK V1F AIGUILLAGES')
