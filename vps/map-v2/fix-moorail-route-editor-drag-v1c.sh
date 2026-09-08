#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
FILE="$ROOT/public/moorail-route-editor.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-drag-v1c-$STAMP"

[ -f "$FILE" ] || { echo "ERREUR: $FILE introuvable" >&2; exit 1; }
mkdir -p "$BACKUP"
cp -a "$FILE" "$BACKUP/moorail-route-editor.html"

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
marker='MOORAIL_DRAG_HANDLES_V1C'
if marker in s:
    print('Patch drag V1C déjà présent')
    raise SystemExit(0)

s=s.replace('<span class="badge">V1 · SAFE</span>','<span class="badge">V1C · DRAG</span>',1)

needle='.leaflet-overlay-pane svg{filter:drop-shadow(0 0 2px rgba(0,210,255,.22))}'
if needle not in s: raise SystemExit('ERREUR: ancre CSS introuvable')
s=s.replace(needle,needle+'\n.dragAnchor{width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;display:grid;place-items:center;background:#ffbd3e;border:2px solid #fff19b;color:#07131d;font:900 9px/1 system-ui;box-shadow:0 0 0 3px rgba(255,189,62,.18),0 0 14px rgba(255,189,62,.75);cursor:grab}.dragAnchor:active{cursor:grabbing}.routeGrabHint{color:#fff19b;font-weight:800}',1)

old="${state.section?'Clique sur une voie de la carte pour imposer un point de passage entre les deux gares.':'Choisis une section.'}"
new="${state.section?'<span class=\"routeGrabHint\">Clique sur le tracé cyan pour créer une poignée, puis fais-la glisser sur la bonne voie.</span><br>Tu peux aussi cliquer directement sur une voie RFN pour ajouter un passage.':'Choisis une section.'}"
if old not in s: raise SystemExit('ERREUR: ancre texte éditeur introuvable')
s=s.replace(old,new,1)

old="function renderAnchors(){if(state.anchorLayer)map.removeLayer(state.anchorLayer);state.anchorLayer=L.layerGroup();state.anchors.forEach((a,i)=>{L.circleMarker([a.coord[1],a.coord[0]],{pane:'anchors',renderer:anchorRenderer,radius:i===0||i===state.anchors.length-1?5:4,color:i===0||i===state.anchors.length-1?'#fff':'#fff19b',weight:1.4,fillColor:i===0||i===state.anchors.length-1?'#00cdeb':'#ffbd3e',fillOpacity:1}).bindTooltip(`${i+1}. ${esc(a.label||'Passage')} · RFN ${esc(a.line||'—')}`,{className:'rail-tip'}).addTo(state.anchorLayer)});state.anchorLayer.addTo(map);}"
new=r'''function renderAnchors(){if(state.anchorLayer)map.removeLayer(state.anchorLayer);state.anchorLayer=L.layerGroup();state.anchors.forEach((a,i)=>{const endpoint=i===0||i===state.anchors.length-1;if(endpoint){L.circleMarker([a.coord[1],a.coord[0]],{pane:'anchors',renderer:anchorRenderer,radius:5,color:'#fff',weight:1.4,fillColor:'#00cdeb',fillOpacity:1,interactive:false}).bindTooltip(`${i+1}. ${esc(a.label||'Gare')} · RFN ${esc(a.line||'—')}`,{className:'rail-tip'}).addTo(state.anchorLayer);return;}const marker=L.marker([a.coord[1],a.coord[0]],{pane:'anchors',draggable:true,autoPan:true,icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:`<div class="dragAnchor">${i}</div>`})}).bindTooltip(`${i+1}. ${esc(a.label||'Passage')} · glisse-moi sur la bonne voie · RFN ${esc(a.line||'—')}`,{className:'rail-tip'});marker.on('dragstart',()=>setMapStatus(`Déplacement du point ${i}… relâche-le sur la voie voulue.`));marker.on('dragend',async e=>{const ll=e.target.getLatLng(),old=state.anchors[i],snap=snapGlobal(ll.lat,ll.lng);if(!snap){renderAnchors();return;}snap.label=old.label||`Passage ${i}`;state.anchors[i]=snap;await recalculate();renderEditor();});marker.addTo(state.anchorLayer)});state.anchorLayer.addTo(map);}'''
if old not in s: raise SystemExit('ERREUR: fonction renderAnchors inattendue')
s=s.replace(old,new,1)

anchor='async function recalculate(showMessage=false){'
if anchor not in s: raise SystemExit('ERREUR: recalculate introuvable')
helpers=r'''// MOORAIL_DRAG_HANDLES_V1C
function nearestPieceIndex(latlng){if(!state.pieces?.length)return 0;const p=[latlng.lng,latlng.lat];let best={i:0,d:Infinity,coord:null};state.pieces.forEach((piece,i)=>{const c=piece?.coords||[];for(let j=0;j<c.length-1;j++){const q=projectPoint(p,c[j],c[j+1]);if(q.distance<best.d)best={i,d:q.distance,coord:q.coord};}});return best;}
async function addHandleOnCurrentPath(latlng){if(!state.section||!state.pieces.length)return;const hit=nearestPieceIndex(latlng),base=hit?.coord||[latlng.lng,latlng.lat],snap=snapGlobal(base[1],base[0]);if(!snap)return;snap.label=`Poignée ${hit.i+1}`;state.anchors.splice(Math.min(state.anchors.length-1,hit.i+1),0,snap);await recalculate();renderEditor();setMapStatus('Poignée créée : fais glisser le rond jaune sur la voie que tu veux imposer.');}
'''
s=s.replace(anchor,helpers+anchor,1)

old="state.newPathLayer=L.layerGroup([L.polyline(coords.map(c=>[c[1],c[0]]),{pane:'new',color:'#18e7ff',weight:10,opacity:.16,interactive:false}),L.polyline(coords.map(c=>[c[1],c[0]]),{pane:'new',color:'#89f8ff',weight:3.2,opacity:.98,interactive:false})]).addTo(map);renderAnchors();"
new="const routeLL=coords.map(c=>[c[1],c[0]]),glow=L.polyline(routeLL,{pane:'new',color:'#18e7ff',weight:10,opacity:.16,interactive:false}),visible=L.polyline(routeLL,{pane:'new',color:'#89f8ff',weight:3.2,opacity:.98,interactive:false}),grab=L.polyline(routeLL,{pane:'new',color:'#ffffff',weight:18,opacity:.001,interactive:true,bubblingMouseEvents:false});grab.on('click',e=>{L.DomEvent.stopPropagation(e);addHandleOnCurrentPath(e.latlng)});grab.bindTooltip('Clique ici pour créer une poignée déplaçable',{sticky:true,className:'rail-tip'});state.newPathLayer=L.layerGroup([glow,visible,grab]).addTo(map);renderAnchors();"
if old not in s: raise SystemExit('ERREUR: construction tracé cyan inattendue')
s=s.replace(old,new,1)

old="snap.label=`Passage ${state.anchors.length-1}`;state.anchors.splice(state.anchors.length-1,0,snap);recalculate();renderEditor();"
new="snap.label=`Passage ${state.anchors.length-1}`;state.anchors.splice(state.anchors.length-1,0,snap);recalculate();renderEditor();setMapStatus('Passage ajouté. Tu peux maintenant faire glisser le rond jaune pour l’ajuster.');"
if old not in s: raise SystemExit('ERREUR: addManualAnchor inattendu')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('OK: poignées déplaçables ajoutées')
PY

TMPJS="$(mktemp /tmp/moorail-editor-v1c.XXXXXX.js)"
trap 'rm -f "$TMPJS"' EXIT
python3 - "$FILE" "$TMPJS" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
scripts=re.findall(r'<script(?: [^>]*)?>(.*?)</script>',s,re.S)
if not scripts: raise SystemExit('aucun script inline')
Path(sys.argv[2]).write_text(scripts[-1],encoding='utf-8')
PY
node --check "$TMPJS"

grep -q 'MOORAIL_DRAG_HANDLES_V1C' "$FILE"

echo
echo "============================================================"
echo " MOO RAIL ROUTE EDITOR V1C — DRAG OK"
echo "============================================================"
echo "Page : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup : $BACKUP/moorail-route-editor.html"
echo
echo "Utilisation :"
echo "  1. sélectionne une section"
echo "  2. clique sur le tracé cyan -> une poignée jaune apparaît"
echo "  3. glisse la poignée sur la voie voulue"
echo "  4. au relâchement elle s'aimante au RFN et le tracé se recalcule"
echo "  5. répète avec plusieurs poignées si nécessaire"
