#!/usr/bin/env bash
set -euo pipefail
ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-direct-drag-v1e-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v1e.XXXXXX)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"
cp -a "$FILE" "$TMP/moorail-route-editor.html"

python3 - "$TMP/moorail-route-editor.html" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='MOORAIL_DIRECT_POINTER_DRAG_V1E'
if marker in s:
    print('V1E déjà présente')
    raise SystemExit(0)

s=s.replace('<span class="badge">V1D · NŒUDS</span>','<span class="badge">V1E · DIRECT DRAG</span>',1)
s=s.replace('<span class="badge">V1 · SAFE</span>','<span class="badge">V1E · DIRECT DRAG</span>',1)

css='.dragAnchor{width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;display:grid;place-items:center;background:#ffbd3e;border:2px solid #fff19b;color:#07131d;font:900 9px/1 system-ui;box-shadow:0 0 0 3px rgba(255,189,62,.18),0 0 14px rgba(255,189,62,.75);cursor:grab}.dragAnchor:active{cursor:grabbing}.routeGrabHint{color:#fff19b;font-weight:800}'
if css not in s: raise SystemExit('ERREUR: ancre CSS V1D introuvable')
s=s.replace(css,css+'.routeDragMarker{width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;display:grid;place-items:center;background:#ffbd3e;border:3px solid #fff;color:#04121d;font:1000 13px/1 system-ui;box-shadow:0 0 0 7px rgba(255,189,62,.20),0 0 24px rgba(255,189,62,.95);pointer-events:none}.leaflet-container.moorail-direct-drag{cursor:grabbing!important}.leaflet-container.moorail-link-pick{cursor:crosshair!important}',1)

old='manualLinks:[],linkMode:null,routeDrag:null};'
if old not in s: raise SystemExit('ERREUR: état V1D inattendu')
s=s.replace(old,'manualLinks:[],linkMode:null,routeDrag:null,directDrag:null,directDragLayer:null};',1)

s=s.replace('if(!state.section||!state.graph||map.getZoom()<12)return;','if(!state.section||!state.graph||map.getZoom()<11)return;',1)

old="clearLinkPick();state.linkMode={first:null};\n  setMapStatus('CRÉATION DE NŒUD : clique le premier rail du raccordement, puis le second.');"
if old not in s: raise SystemExit('ERREUR: startLinkMode inattendu')
s=s.replace(old,"clearLinkPick();state.linkMode={first:null};map.getContainer().classList.add('moorail-link-pick');\n  setMapStatus('CRÉATION DE NŒUD : clique le premier rail du raccordement, puis le second.');",1)

old='const first=state.linkMode.first;state.linkMode=null;clearLinkPick();const link=addManualGraphLink(first,snap,false);'
if old not in s: raise SystemExit('ERREUR: handleRailClick inattendu')
s=s.replace(old,"const first=state.linkMode.first;state.linkMode=null;map.getContainer().classList.remove('moorail-link-pick');clearLinkPick();const link=addManualGraphLink(first,snap,false);",1)

anchor='function beginRouteDrag(e){'
if anchor not in s: raise SystemExit('ERREUR: beginRouteDrag introuvable')
helpers=r'''// MOORAIL_DIRECT_POINTER_DRAG_V1E
function pointerContainerPoint(ev){const r=map.getContainer().getBoundingClientRect();return L.point(ev.clientX-r.left,ev.clientY-r.top)}
function pixelSegProjection(p,a,b){const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,den=vx*vx+vy*vy;let t=den?((wx*vx+wy*vy)/den):0;t=Math.max(0,Math.min(1,t));const x=a.x+t*vx,y=a.y+t*vy,dx=p.x-x,dy=p.y-y;return{distance:Math.hypot(dx,dy),point:L.point(x,y),t}}
function hitCurrentRoutePointer(ev,tolerance=26){if(!state.section||!state.pieces?.length)return null;const p=pointerContainerPoint(ev);let best={distance:Infinity,pieceIndex:0,point:null};state.pieces.forEach((piece,pi)=>{const c=piece?.coords||[];for(let j=0;j<c.length-1;j++){const a=map.latLngToContainerPoint([c[j][1],c[j][0]]),b=map.latLngToContainerPoint([c[j+1][1],c[j+1][0]]),q=pixelSegProjection(p,a,b);if(q.distance<best.distance)best={distance:q.distance,pieceIndex:pi,point:q.point};}});return best.distance<=tolerance?best:null}
function clearDirectDragLayer(){if(state.directDragLayer){map.removeLayer(state.directDragLayer);state.directDragLayer=null}}
function drawDirectDragPreview(ll,insertIndex){clearDirectDragLayer();const before=state.anchors[insertIndex-1]?.coord,after=state.anchors[insertIndex]?.coord,parts=[];if(before&&after)parts.push(L.polyline([[before[1],before[0]],[ll.lat,ll.lng],[after[1],after[0]]],{pane:'anchors',color:'#ffbd3e',weight:4,opacity:.85,dashArray:'8 6',interactive:false}));parts.push(L.marker(ll,{pane:'anchors',interactive:false,icon:L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,14],html:'<div class="routeDragMarker">↕</div>'})}));state.directDragLayer=L.layerGroup(parts).addTo(map)}
async function directPickLinkAtPointer(ev){const ll=map.containerPointToLatLng(pointerContainerPoint(ev)),snap=snapGlobal(ll.lat,ll.lng);if(!snap||Number(snap.distance)>150){setMapStatus('Clique plus près du rail à raccorder.');return}if(!state.linkMode.first){state.linkMode.first=snap;clearLinkPick();state.linkLayer=L.layerGroup([L.marker([snap.coord[1],snap.coord[0]],{pane:'anchors',icon:L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:'<div class="linkPick"></div>'})})]).addTo(map);setMapStatus(`Rail 1 choisi (RFN ${snap.line||'—'}). Clique maintenant le second rail.`);return}const first=state.linkMode.first;state.linkMode=null;map.getContainer().classList.remove('moorail-link-pick');clearLinkPick();const link=addManualGraphLink(first,snap,false);renderJunctions();renderAnchors();await recalculate(true);renderEditor();setMapStatus(`Nœud créé : RFN ${first.line||'—'} ↔ ${snap.line||'—'} · écart ${link?.gap?.toFixed?.(1)||'?'} m.`)}
function directPointerDown(ev){if(ev.button!==0||!state.section||state.busy)return;if(ev.target?.closest?.('.leaflet-marker-icon'))return;if(state.linkMode){ev.preventDefault();ev.stopImmediatePropagation();directPickLinkAtPointer(ev);return}const hit=hitCurrentRoutePointer(ev,28);if(!hit)return;ev.preventDefault();ev.stopImmediatePropagation();const container=map.getContainer(),ll=map.containerPointToLatLng(pointerContainerPoint(ev)),insertIndex=Math.min(state.anchors.length-1,hit.pieceIndex+1);state.directDrag={pointerId:ev.pointerId,insertIndex,startX:ev.clientX,startY:ev.clientY,lastLatLng:ll};container.classList.add('moorail-direct-drag');map.dragging.disable();try{container.setPointerCapture?.(ev.pointerId)}catch{}drawDirectDragPreview(ll,insertIndex);setMapStatus('TRACÉ SAISI ✓ — garde le bouton enfoncé, tire vers la voie voulue puis relâche.')}
function directPointerMove(ev){const d=state.directDrag;if(!d||d.pointerId!==ev.pointerId)return;ev.preventDefault();ev.stopImmediatePropagation();const ll=map.containerPointToLatLng(pointerContainerPoint(ev));d.lastLatLng=ll;drawDirectDragPreview(ll,d.insertIndex)}
async function directPointerUp(ev){const d=state.directDrag;if(!d||d.pointerId!==ev.pointerId)return;ev.preventDefault();ev.stopImmediatePropagation();const container=map.getContainer();state.directDrag=null;container.classList.remove('moorail-direct-drag');map.dragging.enable();try{container.releasePointerCapture?.(ev.pointerId)}catch{}const ll=d.lastLatLng||map.containerPointToLatLng(pointerContainerPoint(ev));clearDirectDragLayer();const snap=snapGlobal(ll.lat,ll.lng);if(!snap){setMapStatus('Relâchement hors réseau : aucune modification.');return}snap.label=`Passage ${d.insertIndex}`;state.anchors.splice(d.insertIndex,0,snap);renderAnchors();await recalculate(true);renderEditor();renderJunctions()}
function installDirectPointerEditor(){const c=map.getContainer();c.addEventListener('pointerdown',directPointerDown,true);c.addEventListener('pointermove',directPointerMove,true);c.addEventListener('pointerup',directPointerUp,true);c.addEventListener('pointercancel',directPointerUp,true)}
'''
s=s.replace(anchor,helpers+anchor,1)

old="grab=L.polyline(routeLL,{pane:'new',color:'#ffffff',weight:18,opacity:.001,interactive:true,bubblingMouseEvents:false});grab.on('mousedown',beginRouteDrag);grab.on('click',e=>{L.DomEvent.stopPropagation(e);if(!state.routeDrag)addHandleOnCurrentPath(e.latlng)});grab.bindTooltip('ATTRAPE ET TIRE le tracé vers la branche voulue',{sticky:true,className:'rail-tip'});"
if old not in s: raise SystemExit('ERREUR: grab V1D inattendu')
s=s.replace(old,"grab=L.polyline(routeLL,{pane:'new',color:'#ffffff',weight:22,opacity:0,interactive:false});",1)

old="state.linkMode=null;state.routeDrag=null;}"
if old not in s: raise SystemExit('ERREUR: clearLayers inattendu')
s=s.replace(old,"state.linkMode=null;state.routeDrag=null;state.directDrag=null;clearDirectDragLayer();map.getContainer().classList.remove('moorail-direct-drag','moorail-link-pick');}",1)

s=s.replace('ATTRAPE le tracé cyan et TIRE-LE sur la branche voulue.','CLIQUE-MAINTIENS sur le cyan, TIRE-LE sur la branche voulue, puis RELÂCHE.',1)

old="$('search').addEventListener('input',renderCatalog);$('filter').addEventListener('change',renderCatalog);$('reload').onclick=async()=>{await loadAll();if(state.route){const id=state.route.id;state.route=state.catalog.find(r=>r.id===id)||null;renderEditor()}};\n(async()=>{try{await loadNetwork();await loadAll();}catch(e){setMapStatus(`Erreur initialisation : ${e.message}`)}})();"
if old not in s: raise SystemExit('ERREUR: init V1D inattendu')
s=s.replace(old,"$('search').addEventListener('input',renderCatalog);$('filter').addEventListener('change',renderCatalog);$('reload').onclick=async()=>{await loadAll();if(state.route){const id=state.route.id;state.route=state.catalog.find(r=>r.id===id)||null;renderEditor()}};\ninstallDirectPointerEditor();\n(async()=>{try{await loadNetwork();await loadAll();}catch(e){setMapStatus(`Erreur initialisation : ${e.message}`)}})();",1)

p.write_text(s,encoding='utf-8')
print('OK: V1E direct pointer drag préparée')
PY

TMPJS="$TMP/editor.js"
python3 - "$TMP/moorail-route-editor.html" "$TMPJS" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
required=['V1E · DIRECT DRAG','MOORAIL_DIRECT_POINTER_DRAG_V1E','installDirectPointerEditor','directPointerDown','directPointerUp','directPickLinkAtPointer']
missing=[x for x in required if x not in s]
if missing: raise SystemExit('ERREUR fonctions V1E manquantes: '+', '.join(missing))
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts: raise SystemExit('aucun script inline')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
PY
node --check "$TMPJS"

install -m 0644 "$TMP/moorail-route-editor.html" "$FILE"

CHECK="$TMP/served.html"
if ! curl -fsS --max-time 5 http://127.0.0.1:3111/moorail-route-editor.html -o "$CHECK"; then
  cp -a "$BACKUP/moorail-route-editor.html" "$FILE"
  echo "ERREUR: page non servie, rollback effectué" >&2
  exit 20
fi
if ! grep -q 'MOORAIL_DIRECT_POINTER_DRAG_V1E' "$CHECK"; then
  cp -a "$BACKUP/moorail-route-editor.html" "$FILE"
  echo "ERREUR: V1E absente de la page servie, rollback effectué" >&2
  exit 21
fi

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1E — VRAI DRAG SOURIS OK"
echo "============================================================"
echo "Page   : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Interaction V1E :"
echo "  - clique-maintiens à moins de ~28 px du cyan"
echo "  - un gros rond jaune + une ligne pointillée apparaissent immédiatement"
echo "  - tire la souris vers la voie choisie"
echo "  - relâche : le point est aimanté au rail et le parcours se recalcule"
echo "  - le mode Créer nœud intercepte aussi directement les clics sur la carte"
