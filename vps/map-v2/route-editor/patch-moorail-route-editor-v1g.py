from pathlib import Path
import re, sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-moorail-route-editor-v1g.py <html>")

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")

if "MOORAIL_SWITCH_EDITOR_V1G" in s:
    print("V1G déjà présente")
    raise SystemExit(0)

required = [
    "MOORAIL_TOPOLOGY_EDITOR_V1D",
    "MOORAIL_DIRECT_POINTER_DRAG_V1E",
    "function renderAnchors()",
    "function renderJunctions()",
    "function directPointerDown",
    "async function directPointerUp",
    "async function recalculate",
]
missing = [x for x in required if x not in s]
if missing:
    raise SystemExit("ERREUR prérequis V1E manquants: " + ", ".join(missing))

def find_function_span(text, name):
    m = re.search(r"(?m)(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", text)
    if not m:
        raise SystemExit(f"ERREUR: fonction {name} introuvable")
    start = m.start()
    brace = text.find("{", m.end())
    if brace < 0:
        raise SystemExit(f"ERREUR: accolade {name} introuvable")
    i = brace
    depth = 0
    mode = "code"
    quote = None
    while i < len(text):
        c = text[i]
        n = text[i+1] if i + 1 < len(text) else ""
        if mode == "code":
            if c in ("'", '"', "`"):
                mode = "string"; quote = c
            elif c == "/" and n == "/":
                mode = "line"; i += 1
            elif c == "/" and n == "*":
                mode = "block"; i += 1
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        elif mode == "string":
            if c == "\\":
                i += 1
            elif c == quote:
                mode = "code"; quote = None
        elif mode == "line":
            if c == "\n":
                mode = "code"
        elif mode == "block":
            if c == "*" and n == "/":
                mode = "code"; i += 1
        i += 1
    raise SystemExit(f"ERREUR: fonction {name} non fermée")

def replace_function(text, name, code):
    a, b = find_function_span(text, name)
    return text[:a] + code + text[b:]

helpers = '''
// MOORAIL_SWITCH_EDITOR_V1G
function clearBranchChoices(){
  if(state.branchLayer){map.removeLayer(state.branchLayer);state.branchLayer=null}
  state.junctionPick=null;
}
function branchSegmentId(snap){return snap ? `${snap.featureIndex}:${snap.partIndex}:${snap.segmentIndex}` : '';}
function makeExactNodeAnchor(k,c,groupId){
  return {coord:[Number(c[0]),Number(c[1])],line:'NŒUD',kind:'junction',speed:320,distance:0,featureIndex:-1,partIndex:-1,segmentIndex:-1,t:.5,a:[Number(c[0]),Number(c[1])],b:[Number(c[0]),Number(c[1])],ka:k,kb:k,d:0,props:{kind:'junction',line:'NŒUD',speed:320},label:'Nœud RFN',lockedNode:true,junctionKey:k,junctionGroup:groupId,junctionRole:'node'};
}
function branchSnapForEdge(k,c,edge){
  const seg=edge?.seg;if(!seg||!seg.a||!seg.b||!Number.isFinite(seg.d)||seg.d<=0)return null;
  const fromA=seg.ka===k,fromB=seg.kb===k;if(!fromA&&!fromB)return null;
  const travel=Math.min(80,Math.max(6,seg.d*.35)),frac=Math.min(.45,Math.max(.02,travel/seg.d)),t=fromA?frac:1-frac;
  const coord=[seg.a[0]+(seg.b[0]-seg.a[0])*t,seg.a[1]+(seg.b[1]-seg.a[1])*t];
  return makeSnap({coord,t,distance:0,featureIndex:seg.featureIndex,partIndex:seg.partIndex,segmentIndex:seg.segmentIndex,a:seg.a,b:seg.b,ka:seg.ka,kb:seg.kb,d:seg.d,props:seg.props});
}
function junctionInsertIndex(c){
  if(!state.pieces?.length)return Math.max(1,state.anchors.length-1);
  const p=[Number(c[0]),Number(c[1])];let best={d:Infinity,idx:Math.max(1,state.anchors.length-1)};
  state.pieces.forEach((piece,pi)=>{const cc=piece?.coords||[];for(let j=0;j<cc.length-1;j++){const q=projectPoint(p,cc[j],cc[j+1]);if(q.distance<best.d)best={d:q.distance,idx:Math.min(state.anchors.length-1,pi+1)};}});
  return best.idx;
}
function existingJunctionGroupRange(k){let first=-1,last=-1;state.anchors.forEach((a,i)=>{if(a?.junctionKey===k&&a?.junctionGroup){if(first<0)first=i;last=i;}});return first>=0?{first,last,count:last-first+1}:null;}
function removeAnchorConstraintAt(i){
  const a=state.anchors[i];if(!a||i<=0||i>=state.anchors.length-1)return;
  if(a.junctionGroup){const g=a.junctionGroup;state.anchors=state.anchors.filter((x,idx)=>idx===0||idx===state.anchors.length-1||x.junctionGroup!==g);}else state.anchors.splice(i,1);
  clearBranchChoices();recalculate();renderEditor();
}
function undoLastConstraint(){
  if(state.anchors.length<=2)return;const a=state.anchors.at(-2);
  if(a?.junctionGroup){const g=a.junctionGroup;state.anchors=state.anchors.filter((x,idx)=>idx===0||idx===state.anchors.length-1||x.junctionGroup!==g);}else state.anchors.splice(-2,1);
  clearBranchChoices();recalculate();renderEditor();
}
function nearestJunctionForSnap(snap,maxM=110){
  if(!snap||!state.graph)return null;let best=null;
  for(const k of [snap.ka,snap.kb]){const c=state.graph.nodeCoords.get(k);if(!c)continue;const ids=new Set((state.graph.adjacency.get(k)||[]).filter(e=>e?.seg).map(e=>`${e.seg.featureIndex}:${e.seg.partIndex}:${e.seg.segmentIndex}`));const deg=ids.size;if(deg<3)continue;const d=distM(c,snap.coord);if(d<=maxM&&(!best||d<best.d))best={k,c,d,deg};}
  return best;
}
function renderJunctionBranchChoices(){
  if(state.branchLayer){map.removeLayer(state.branchLayer);state.branchLayer=null}
  const pick=state.junctionPick;if(!pick)return;const {k,c}=pick,edges=state.graph?.adjacency?.get(k)||[],layers=[],seen=new Set();let n=0;
  for(const edge of edges){const snap=branchSnapForEdge(k,c,edge);if(!snap)continue;const sid=branchSegmentId(snap);if(seen.has(sid))continue;seen.add(sid);n++;snap.label=`Branche ${n} · RFN ${snap.line||'—'}`;const isFirst=pick.firstSid===sid,color=isFirst?'#ff8a3d':'#ffd54a',weight=isFirst?14:11;const line=L.polyline([[c[1],c[0]],[snap.coord[1],snap.coord[0]]],{pane:'junctions',color,weight,opacity:.92,interactive:true,bubblingMouseEvents:false});line.bindTooltip(isFirst?`ENTRÉE choisie · RFN ${snap.line||'—'} · choisis la SORTIE`:`${pick.first?'SORTIE':'ENTRÉE'} · RFN ${snap.line||'—'} · clique`,{sticky:true,className:'rail-tip'});line.on('click',async e=>{L.DomEvent.stopPropagation(e);await chooseJunctionBranch(snap,sid);});layers.push(line);layers.push(L.marker([snap.coord[1],snap.coord[0]],{pane:'junctions',interactive:false,icon:L.divIcon({className:'',iconSize:[20,20],iconAnchor:[10,10],html:`<div class="switchBranchDot ${isFirst?'chosen':''}">${n}</div>`})}));}
  layers.push(L.marker([c[1],c[0]],{pane:'junctions',interactive:false,icon:L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:'<div class="switchNodeDot">●</div>'})}));state.branchLayer=L.layerGroup(layers).addTo(map);
  if(!pick.first){setMapStatus('AIGUILLAGE : clique d’abord la branche D’OÙ VIENT le train, puis celle OÙ IL REPART.');if($('editStatus'))$('editStatus').innerHTML='<strong style="color:#ffd54a">Aiguillage sélectionné.</strong> Clique la <b>branche d’entrée</b>, puis la <b>branche de sortie</b>, dans le sens du trajet.';}else{setMapStatus(`ENTRÉE choisie (RFN ${pick.first.line||'—'}). Clique maintenant la branche de SORTIE.`);if($('editStatus'))$('editStatus').innerHTML=`<strong style="color:#ff9a54">Entrée verrouillée : RFN ${esc(pick.first.line||'—')}.</strong> Choisis maintenant la branche de <b>sortie</b>.`;}
}
function showJunctionBranches(k,c){if(!state.section||!state.graph)return;clearBranchChoices();state.junctionPick={k,c:[Number(c[0]),Number(c[1])],first:null,firstSid:null};renderJunctionBranchChoices();}
async function chooseJunctionBranch(snap,sid){
  const pick=state.junctionPick;if(!pick)return;if(!pick.first){pick.first={...snap};pick.firstSid=sid;renderJunctionBranchChoices();return;}if(pick.firstSid===sid){setMapStatus('Choisis une AUTRE branche pour la sortie.');return;}
  const group=`junction:${pick.k}:${Date.now()}`,entry={...pick.first,label:`Entrée aiguillage · RFN ${pick.first.line||'—'}`,lockedBranch:true,junctionKey:pick.k,junctionGroup:group,junctionRole:'entry'},node=makeExactNodeAnchor(pick.k,pick.c,group),exit={...snap,label:`Sortie aiguillage · RFN ${snap.line||'—'}`,lockedBranch:true,junctionKey:pick.k,junctionGroup:group,junctionRole:'exit'};const existing=existingJunctionGroupRange(pick.k);let idx;if(existing){idx=existing.first;state.anchors.splice(existing.first,existing.count,entry,node,exit);}else{idx=junctionInsertIndex(pick.c);state.anchors.splice(idx,0,entry,node,exit);}clearBranchChoices();renderAnchors();await recalculate(true);renderEditor();renderJunctions();setMapStatus(`✓ Aiguillage verrouillé : RFN ${entry.line||'—'} → NŒUD → RFN ${exit.line||'—'}.`);
}
'''

css_extra = '''
.switchBranchDot{width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;display:grid;place-items:center;background:#ffd54a;border:2px solid #fff;color:#07131d;font:900 10px/1 system-ui;box-shadow:0 0 14px rgba(255,213,74,.9)}
.switchBranchDot.chosen{background:#ff8a3d;box-shadow:0 0 18px rgba(255,138,61,1)}
.switchNodeDot{width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;display:grid;place-items:center;background:#7f5cff;border:2px solid #fff;color:#fff;font:900 12px/1 system-ui;box-shadow:0 0 18px rgba(127,92,255,.95)}
.lockedBranchMarker{width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;display:grid;place-items:center;background:#ff8a3d;border:2px solid #fff;color:#07131d;font:900 9px/1 system-ui;box-shadow:0 0 12px rgba(255,138,61,.8)}
.lockedNodeMarker{width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;display:grid;place-items:center;background:#45e59b;border:2px solid #fff;color:#062017;font:900 9px/1 system-ui;box-shadow:0 0 12px rgba(69,229,155,.8)}
'''

render_anchors = '''function renderAnchors(){
  if(state.anchorLayer)map.removeLayer(state.anchorLayer);state.anchorLayer=L.layerGroup();state.anchors.forEach((a,i)=>{const endpoint=i===0||i===state.anchors.length-1;if(endpoint){L.circleMarker([a.coord[1],a.coord[0]],{pane:'anchors',renderer:anchorRenderer,radius:5,color:'#fff',weight:1.4,fillColor:'#00cdeb',fillOpacity:1,interactive:false}).bindTooltip(`${i+1}. ${esc(a.label||'Gare')} · RFN ${esc(a.line||'—')}`,{className:'rail-tip'}).addTo(state.anchorLayer);return;}if(a.lockedNode){L.marker([a.coord[1],a.coord[0]],{pane:'anchors',interactive:false,icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:'<div class="lockedNodeMarker">N</div>'})}).bindTooltip(`Nœud verrouillé · ${esc(a.junctionKey||'')}`,{className:'rail-tip'}).addTo(state.anchorLayer);return;}if(a.lockedBranch){const role=a.junctionRole==='entry'?'E':'S';L.marker([a.coord[1],a.coord[0]],{pane:'anchors',interactive:false,icon:L.divIcon({className:'',iconSize:[20,20],iconAnchor:[10,10],html:`<div class="lockedBranchMarker">${role}</div>`})}).bindTooltip(`${a.junctionRole==='entry'?'Entrée':'Sortie'} verrouillée · RFN ${esc(a.line||'—')}`,{className:'rail-tip'}).addTo(state.anchorLayer);return;}const marker=L.marker([a.coord[1],a.coord[0]],{pane:'anchors',draggable:true,autoPan:true,icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:`<div class="dragAnchor">${i}</div>`})}).bindTooltip(`${i+1}. ${esc(a.label||'Passage')} · glisse-moi sur la bonne voie · RFN ${esc(a.line||'—')}`,{className:'rail-tip'});marker.on('dragstart',()=>setMapStatus(`Déplacement du point ${i}… relâche-le sur la voie voulue.`));marker.on('dragend',async e=>{const ll=e.target.getLatLng(),old=state.anchors[i],snap=snapGlobal(ll.lat,ll.lng);if(!snap){renderAnchors();return;}const j=nearestJunctionForSnap(snap,100);if(j){showJunctionBranches(j.k,j.c);renderAnchors();return;}snap.label=old.label||`Passage ${i}`;state.anchors[i]=snap;await recalculate();renderEditor();});marker.addTo(state.anchorLayer)});state.anchorLayer.addTo(map);
}'''

render_junctions = '''function renderJunctions(){
  if(state.junctionLayer){map.removeLayer(state.junctionLayer);state.junctionLayer=null}if(!state.section||!state.graph||map.getZoom()<11)return;const bounds=map.getBounds().pad(.12),layer=L.layerGroup(),seen=new Set();let shown=0;for(const [k,c] of state.graph.nodeCoords.entries()){if(shown>700)break;if(!bounds.contains([c[1],c[0]]))continue;const ids=new Set((state.graph.adjacency.get(k)||[]).filter(e=>e?.seg).map(e=>`${e.seg.featureIndex}:${e.seg.partIndex}:${e.seg.segmentIndex}`));const deg=ids.size;if(deg<3)continue;const id=`n:${k}`;if(seen.has(id))continue;seen.add(id);shown++;const hasLock=state.anchors.some(a=>a?.junctionKey===k&&a?.junctionGroup),html=hasLock?'<div class="junctionDot manual"></div>':'<div class="junctionDot"></div>',m=L.marker([c[1],c[0]],{pane:'junctions',icon:L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],html})}).bindTooltip(`${hasLock?'Aiguillage verrouillé':'Nœud RFN'} · ${deg} branches · clique pour choisir entrée/sortie`,{className:'rail-tip'});m.on('click',e=>{L.DomEvent.stopPropagation(e);showJunctionBranches(k,c)});m.addTo(layer);}for(const link of state.graph.softLinks||[]){const c=link.coord;if(!c||!bounds.contains([c[1],c[0]]))continue;L.marker([c[1],c[0]],{pane:'junctions',icon:L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],html:'<div class="junctionDot soft"></div>'})}).bindTooltip(`Raccord auto · écart ${link.gap.toFixed(1)} m · ${link.line||'—'} ↔ ${link.toLine||'—'}`,{className:'rail-tip'}).addTo(layer);}for(const link of state.manualLinks||[]){const c=link.a?.coord;if(!c||!bounds.contains([c[1],c[0]]))continue;L.marker([c[1],c[0]],{pane:'junctions',icon:L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],html:'<div class="junctionDot manual"></div>'})}).bindTooltip(`Raccord manuel · ${link.a?.line||'—'} ↔ ${link.b?.line||'—'}`,{className:'rail-tip'}).addTo(layer);}state.junctionLayer=layer.addTo(map);if(state.junctionPick)renderJunctionBranchChoices();
}'''

direct_up = '''async function directPointerUp(ev){const d=state.directDrag;if(!d||d.pointerId!==ev.pointerId)return;ev.preventDefault();ev.stopImmediatePropagation();const container=map.getContainer();state.directDrag=null;container.classList.remove('moorail-direct-drag');map.dragging.enable();try{container.releasePointerCapture?.(ev.pointerId)}catch{}const ll=d.lastLatLng||map.containerPointToLatLng(pointerContainerPoint(ev));clearDirectDragLayer();const snap=snapGlobal(ll.lat,ll.lng);if(!snap){setMapStatus('Relâchement hors réseau : aucune modification.');return}const j=nearestJunctionForSnap(snap,110);if(j){showJunctionBranches(j.k,j.c);setMapStatus('Tu as déposé le tracé sur un aiguillage : choisis maintenant ENTRÉE puis SORTIE.');return;}snap.label=`Passage ${d.insertIndex}`;state.anchors.splice(d.insertIndex,0,snap);renderAnchors();await recalculate(true);renderEditor();renderJunctions();}'''

end_drag = '''async function endRouteDrag(e){if(!state.routeDrag)return;map.off('mousemove',moveRouteDrag);map.dragging.enable();const drag=state.routeDrag;state.routeDrag=null;clearLinkPick();const snap=snapGlobal(e.latlng.lat,e.latlng.lng)||drag.lastSnap;if(!snap)return;const j=nearestJunctionForSnap(snap,110);if(j){showJunctionBranches(j.k,j.c);setMapStatus('Aiguillage détecté : choisis ENTRÉE puis SORTIE.');return;}snap.label=`Passage ${drag.insertIndex}`;state.anchors.splice(drag.insertIndex,0,snap);renderAnchors();await recalculate(true);renderEditor();renderJunctions();}'''

add_handle = '''async function addHandleOnCurrentPath(latlng){if(!state.section||!state.pieces.length)return;const hit=nearestPieceIndex(latlng),base=hit?.coord||[latlng.lng,latlng.lat],snap=snapGlobal(base[1],base[0]);if(!snap)return;const j=nearestJunctionForSnap(snap,110);if(j){showJunctionBranches(j.k,j.c);return;}snap.label=`Poignée ${hit.i+1}`;state.anchors.splice(Math.min(state.anchors.length-1,hit.i+1),0,snap);await recalculate();renderEditor();setMapStatus('Poignée créée : fais glisser le rond jaune pour l’ajuster.');}'''

add_manual = '''function addManualAnchor(latlng,feature){if(!state.section||state.anchors.length<2||!state.graph)return;const snap=snapFeature(latlng,feature);if(!snap)return;const j=nearestJunctionForSnap(snap,110);if(j){showJunctionBranches(j.k,j.c);return;}snap.label=`Passage ${state.anchors.length-1}`;state.anchors.splice(state.anchors.length-1,0,snap);recalculate();renderEditor();setMapStatus('Passage ajouté. Hors aiguillage, ce point reste déplaçable.');}'''

clear_layers = '''function clearLayers(){for(const name of ['currentPathLayer','newPathLayer','anchorLayer','stopLayer','junctionLayer','linkLayer','branchLayer']){if(state[name]){map.removeLayer(state[name]);state[name]=null}}state.linkMode=null;state.routeDrag=null;state.directDrag=null;state.junctionPick=null;clearDirectDragLayer();map.getContainer().classList.remove('moorail-direct-drag','moorail-link-pick');}'''

s = re.sub(r"<title>MooRail — Route Editor [^<]+</title>", "<title>MooRail — Route Editor V1G · AIGUILLAGES</title>", s, count=1)
s = re.sub(r'<span class="badge">[^<]*(?:DIRECT DRAG|NŒUDS|SAFE)[^<]*</span>', '<span class="badge">V1G · AIGUILLAGES</span>', s, count=1)
if ".switchBranchDot{" not in s:
    if "</style>" not in s: raise SystemExit("ERREUR: </style> introuvable")
    s = s.replace("</style>", css_extra + "\n</style>", 1)
anchor = "// MOORAIL_TOPOLOGY_EDITOR_V1D"
if anchor not in s: raise SystemExit("ERREUR: ancre topologie introuvable")
s = s.replace(anchor, helpers + "\n" + anchor, 1)
for name, code in [("renderAnchors", render_anchors),("renderJunctions", render_junctions),("directPointerUp", direct_up),("endRouteDrag", end_drag),("addHandleOnCurrentPath", add_handle),("addManualAnchor", add_manual),("clearLayers", clear_layers)]:
    s = replace_function(s, name, code)
old_hint = '<span class="routeGrabHint">CLIQUE-MAINTIENS sur le cyan, TIRE-LE sur la branche voulue, puis RELÂCHE.</span><br>Les points violets = nœuds RFN. Si un embranchement visible n’est pas connecté, utilise <b>Créer nœud</b> puis clique ses deux rails.'
new_hint = '<span class="routeGrabHint">AIGUILLAGE : clique un point violet, puis choisis la branche D’ENTRÉE et la branche DE SORTIE.</span><br>Tu peux toujours tirer le cyan ; si tu le déposes près d’un aiguillage, le sélecteur de branches s’ouvre automatiquement.'
if old_hint in s: s = s.replace(old_hint, new_hint, 1)
s = s.replace("document.querySelectorAll('[data-del-anchor]').forEach(el=>el.onclick=()=>{state.anchors.splice(Number(el.dataset.delAnchor),1);recalculate();renderEditor()});","document.querySelectorAll('[data-del-anchor]').forEach(el=>el.onclick=()=>removeAnchorConstraintAt(Number(el.dataset.delAnchor)));",1)
s = s.replace("$('undo').onclick=()=>{if(state.anchors.length>2){state.anchors.splice(-2,1);recalculate();renderEditor()}};","$('undo').onclick=undoLastConstraint;",1)
wp_old = "props:{line:a.line,kind:a.kind,speed:a.speed}}))"
wp_new = "props:{line:a.line,kind:a.kind,speed:a.speed},junctionKey:a.junctionKey||null,junctionGroup:a.junctionGroup||null,junctionRole:a.junctionRole||null,lockedNode:!!a.lockedNode,lockedBranch:!!a.lockedBranch}))"
if wp_old in s: s = s.replace(wp_old, wp_new, 1)
else: print("AVERTISSEMENT: sérialisation waypoint ancienne forme non trouvée")
p.write_text(s, encoding="utf-8")
print("OK: V1G aiguillages entrée/sortie appliquée")
