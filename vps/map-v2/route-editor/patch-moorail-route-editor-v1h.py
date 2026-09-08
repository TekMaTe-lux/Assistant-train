from pathlib import Path
import re, sys

if len(sys.argv) != 2:
    raise SystemExit('usage: patch-moorail-route-editor-v1h.py <html>')

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

if 'MOORAIL_FORCED_SWITCH_TRANSITION_V1H' in s:
    print('V1H déjà présente')
    raise SystemExit(0)

required = [
    'MOORAIL_SWITCH_EDITOR_V1G',
    'function makeExactNodeAnchor',
    'function renderJunctions()',
    'async function recalculate',
    'async function directPointerUp',
]
missing = [x for x in required if x not in s]
if missing:
    raise SystemExit('ERREUR prérequis V1G manquants: ' + ', '.join(missing))


def find_function_span(text, name):
    m = re.search(r'(?m)(?:async\s+)?function\s+' + re.escape(name) + r'\s*\(', text)
    if not m:
        raise SystemExit(f'ERREUR: fonction {name} introuvable')
    start = m.start()
    brace = text.find('{', m.end())
    if brace < 0:
        raise SystemExit(f'ERREUR: accolade {name} introuvable')
    i = brace
    depth = 0
    mode = 'code'
    quote = None
    while i < len(text):
        c = text[i]
        n = text[i+1] if i + 1 < len(text) else ''
        if mode == 'code':
            if c in ("'", '"', '`'):
                mode = 'string'; quote = c
            elif c == '/' and n == '/':
                mode = 'line'; i += 1
            elif c == '/' and n == '*':
                mode = 'block'; i += 1
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return start, i + 1
        elif mode == 'string':
            if c == '\\':
                i += 1
            elif c == quote:
                mode = 'code'; quote = None
        elif mode == 'line':
            if c == '\n': mode = 'code'
        elif mode == 'block':
            if c == '*' and n == '/':
                mode = 'code'; i += 1
        i += 1
    raise SystemExit(f'ERREUR: fonction {name} non fermée')


def replace_function(text, name, code):
    a, b = find_function_span(text, name)
    return text[:a] + code + text[b:]

s = s.replace('V1G · AIGUILLAGES', 'V1H · TRANSITIONS', 1)
s = s.replace('// MOORAIL_SWITCH_EDITOR_V1G', '// MOORAIL_SWITCH_EDITOR_V1G\n// MOORAIL_FORCED_SWITCH_TRANSITION_V1H', 1)

helpers = r'''
function exactOuterNodeAnchor(branch){
  if(!branch||!branch.junctionKey)return null;
  const k=branch.junctionKey;
  let outerKey=null,coord=null;
  if(branch.ka===k){outerKey=branch.kb;coord=branch.b;}
  else if(branch.kb===k){outerKey=branch.ka;coord=branch.a;}
  if(!outerKey||!coord)return null;
  return {coord:[Number(coord[0]),Number(coord[1])],line:branch.line||'',kind:branch.kind||'',speed:Number(branch.speed)||120,distance:0,featureIndex:branch.featureIndex,partIndex:branch.partIndex,segmentIndex:branch.segmentIndex,t:branch.ka===k?1:0,a:[Number(coord[0]),Number(coord[1])],b:[Number(coord[0]),Number(coord[1])],ka:outerKey,kb:outerKey,d:0,props:{line:branch.line||'',kind:branch.kind||'',speed:Number(branch.speed)||120},label:'Porte aiguillage',exactGraphNode:true};
}
function forcedSwitchPiece(from,to,line,group,role,insertIndex){
  return {coords:[[Number(from.coord[0]),Number(from.coord[1])],[Number(to.coord[0]),Number(to.coord[1])]],lines:[line].filter(Boolean),links:[],cost:distM(from.coord,to.coord),forcedSwitch:true,junctionGroup:group,junctionRole:role,insertIndex};
}
function isJunctionTriple(i){
  const a=state.anchors[i],n=state.anchors[i+1],z=state.anchors[i+2];
  return !!(a&&n&&z&&a.junctionRole==='entry'&&n.junctionRole==='node'&&z.junctionRole==='exit'&&a.junctionGroup&&a.junctionGroup===n.junctionGroup&&a.junctionGroup===z.junctionGroup);
}
function buildRouteWithForcedSwitches(){
  if(!state.anchors||state.anchors.length<2)return null;
  const pieces=[];
  let current=state.anchors[0],i=1,forcedCount=0;
  while(i<state.anchors.length-1){
    if(isJunctionTriple(i)){
      const entry=state.anchors[i],node=state.anchors[i+1],exit=state.anchors[i+2];
      const entryOuter=exactOuterNodeAnchor(entry),exitOuter=exactOuterNodeAnchor(exit);
      if(!entryOuter||!exitOuter)return null;
      const pre=aStar(current,entryOuter);if(!pre)return null;pre.insertIndex=i;pieces.push(pre);
      pieces.push(forcedSwitchPiece(entryOuter,node,entry.line,entry.junctionGroup,'entry',i+1));
      pieces.push(forcedSwitchPiece(node,exitOuter,exit.line,exit.junctionGroup,'exit',i+2));
      forcedCount++;
      current=exitOuter;i+=3;continue;
    }
    const target=state.anchors[i],leg=aStar(current,target);if(!leg)return null;leg.insertIndex=i;pieces.push(leg);current=target;i++;
  }
  const last=state.anchors.at(-1),tail=aStar(current,last);if(!tail)return null;tail.insertIndex=state.anchors.length-1;pieces.push(tail);
  return {pieces,forcedCount};
}
'''

anchor = 'async function recalculate'
pos = s.find(anchor)
if pos < 0:
    raise SystemExit('ERREUR: recalculate introuvable')
s = s[:pos] + helpers + s[pos:]

recalc = r'''async function recalculate(showMessage=false){
  if(!state.section||state.anchors.length<2||state.busy)return;
  state.busy=true;setMapStatus('Calcul du chemin avec transitions d’aiguillage forcées…');await new Promise(r=>setTimeout(r,10));
  try{
    const plan=buildRouteWithForcedSwitches();if(!plan)throw new Error('aucun chemin RFN respectant les aiguillages imposés');
    const pieces=plan.pieces;let coords=[];for(const p of pieces){if(!coords.length)coords.push(...p.coords);else coords.push(...p.coords.slice(1));}
    state.pieces=pieces;renderAnchors();if(state.newPathLayer)map.removeLayer(state.newPathLayer);
    const routeLL=coords.map(c=>[c[1],c[0]]),layers=[];
    layers.push(L.polyline(routeLL,{pane:'new',color:'#18e7ff',weight:10,opacity:.16,interactive:false}));
    layers.push(L.polyline(routeLL,{pane:'new',color:'#89f8ff',weight:3.2,opacity:.98,interactive:false}));
    for(const p of pieces){if(!p.forcedSwitch)continue;layers.push(L.polyline(p.coords.map(c=>[c[1],c[0]]),{pane:'new',color:'#ff8a3d',weight:8,opacity:.35,interactive:false}));layers.push(L.polyline(p.coords.map(c=>[c[1],c[0]]),{pane:'new',color:'#ffd54a',weight:3.8,opacity:.98,interactive:false}));}
    state.newPathLayer=L.layerGroup(layers).addTo(map);renderAnchors();renderJunctions();
    const km=pieces.reduce((sum,p)=>sum+p.coords.slice(1).reduce((x,c,j)=>x+distM(p.coords[j],c),0),0)/1000;
    const links=pieces.reduce((n,p)=>n+(p.links?.length||0),0);
    setMapStatus(`Nouveau tracé : ${km.toFixed(1)} km · ${plan.forcedCount} aiguillage(s) forcé(s) · ${links} raccord(s) topo`);
    if(showMessage&&$('editStatus'))$('editStatus').innerHTML=`<strong style="color:#52ffb1">Chemin trouvé.</strong> ${plan.forcedCount} transition(s) d’aiguillage sont maintenant imposées physiquement : branche d’entrée → nœud → branche de sortie.`;
  }catch(e){
    if(state.newPathLayer){map.removeLayer(state.newPathLayer);state.newPathLayer=null}
    renderAnchors();renderJunctions();setMapStatus(`ERREUR : ${e.message}`);if($('editStatus'))$('editStatus').innerHTML=`<span style="color:#ff8794">${esc(e.message)}</span>`;
  }finally{state.busy=false;}
}'''
s = replace_function(s, 'recalculate', recalc)

hit = r'''function hitCurrentRoutePointer(ev,tolerance=26){if(!state.section||!state.pieces?.length)return null;const p=pointerContainerPoint(ev);let best={distance:Infinity,pieceIndex:0,insertIndex:1,point:null};state.pieces.forEach((piece,pi)=>{const c=piece?.coords||[];for(let j=0;j<c.length-1;j++){const a=map.latLngToContainerPoint([c[j][1],c[j][0]]),b=map.latLngToContainerPoint([c[j+1][1],c[j+1][0]]),q=pixelSegProjection(p,a,b);if(q.distance<best.distance)best={distance:q.distance,pieceIndex:pi,insertIndex:piece.insertIndex??Math.min(state.anchors.length-1,pi+1),point:q.point};}});return best.distance<=tolerance?best:null;}'''
s = replace_function(s, 'hitCurrentRoutePointer', hit)

down = r'''function directPointerDown(ev){if(ev.button!==0||!state.section||state.busy)return;if(ev.target?.closest?.('.leaflet-marker-icon'))return;if(state.linkMode){ev.preventDefault();ev.stopImmediatePropagation();directPickLinkAtPointer(ev);return}const hit=hitCurrentRoutePointer(ev,28);if(!hit)return;ev.preventDefault();ev.stopImmediatePropagation();const container=map.getContainer(),ll=map.containerPointToLatLng(pointerContainerPoint(ev)),insertIndex=Math.min(state.anchors.length-1,hit.insertIndex??hit.pieceIndex+1);state.directDrag={pointerId:ev.pointerId,insertIndex,startX:ev.clientX,startY:ev.clientY,lastLatLng:ll};container.classList.add('moorail-direct-drag');map.dragging.disable();try{container.setPointerCapture?.(ev.pointerId)}catch{}drawDirectDragPreview(ll,insertIndex);setMapStatus('TRACÉ SAISI ✓ — tire vers la voie voulue. Si tu relâches près d’un aiguillage, choisis ensuite entrée puis sortie.');}'''
s = replace_function(s, 'directPointerDown', down)

# Make saveSection preserve junction metadata if the serializer is present.
needle = "props:{line:a.line,kind:a.kind,speed:a.speed}}))"
if needle in s:
    s = s.replace(needle, "props:{line:a.line,kind:a.kind,speed:a.speed},lockedBranch:!!a.lockedBranch,lockedNode:!!a.lockedNode,junctionKey:a.junctionKey||null,junctionGroup:a.junctionGroup||null,junctionRole:a.junctionRole||null}))", 1)

p.write_text(s,encoding='utf-8')
print('OK: V1H transitions d’aiguillage forcées préparées')
