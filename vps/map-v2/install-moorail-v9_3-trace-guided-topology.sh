#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v9_3-trace-topology-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v93.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V9.3..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  [[ -f "$BACKUP/moorail-route-editor-stops.html" ]] && cp -a "$BACKUP/moorail-route-editor-stops.html" "$HTML2" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

echo "============================================================"
echo " MOO RAIL V9.3 — LE TRACE ROUGE DEVIENT LE CORRIDOR"
echo "============================================================"
echo "Cause traitée : le RFN chargé dans l'éditeur est d'abord une GEOMETRIE."
echo "Deux voies qui se touchent/croisent visuellement ne partagent pas toujours"
echo "le même sommet informatique. L'ancien Dijkstra pouvait donc dire 'impossible'"
echo "ou faire un détour alors que le raccordement existe sur la carte."
echo
echo "V9.3 ne transforme plus le rouge en une poignée de simples vias :"
echo " - le rouge définit un corridor étroit,"
echo " - les raccordements RFN de ce corridor sont 'nodés' localement,"
echo " - les extrémités proches d'une autre voie sont raccordées à <= 3 m,"
echo " - les croisements intérieurs ne deviennent des aiguillages que s'ils"
echo "   ressemblent à un raccord ferroviaire (angle <= 38°),"
echo " - le coût force ensuite le chemin à rester près du rouge."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
for marker in LB_MOORAIL_FREEHAND_TRACE_V91 LB_MOORAIL_FREEHAND_SIMPLIFY_V92 LB_MOORAIL_ENDPOINT_HANDLES_V89; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
grep -qF 'function lbRdpV92' "$JS"
grep -qF 'function routeAnchors(A,B)' "$JS"
grep -qF 'function projectToSeg(latlng,s)' "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93' "$JS"; then
  echo "ERREUR: V9.3 déjà présente" >&2
  exit 5
fi

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH MOTEUR : NODING LOCAL + ROUTAGE GUIDE PAR LE ROUGE ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93 */'
if marker in s:raise SystemExit('V9.3 déjà présente')

helper=marker+r'''
state.manualGuideV93=[];
state.manualTopoStatsV93=null;

function lbGuidePrepareV93(raw){
  let pts=(raw||[]).map(p=>[+p[0],+p[1]]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(pts.length<2)return [];
  // 6 m : on garde fidèlement les bifurcations dessinées, sans garder chaque pixel souris.
  if(typeof lbRdpV92==='function')pts=lbRdpV92(pts,6);
  if(pts.length>80){
    const a=[pts[0]],n=pts.length;
    for(let i=1;i<79;i++)a.push(pts[Math.round(i*(n-1)/79)]);
    a.push(pts.at(-1));pts=a;
  }
  return pts;
}
function lbGuideOrientV93(guide,pair){
  const g=(guide||[]).map(x=>[+x[0],+x[1]]);if(g.length<2||!pair)return g;
  const A=[+pair[0].lon,+pair[0].lat],B=[+pair[1].lon,+pair[1].lat];
  const F=[g[0][1],g[0][0]],LST=[g.at(-1)[1],g.at(-1)[0]];
  const f=distanceLL(A,F)+distanceLL(LST,B),r=distanceLL(A,LST)+distanceLL(F,B);
  if(r<f)g.reverse();return g;
}
function lbPointGuideDistV93(c,guide){
  if(!guide?.length)return Infinity;
  let best=Infinity;
  const p=[+c[1],+c[0]]; // RDP helpers use [lat,lon]
  for(let i=1;i<guide.length;i++){
    const d=lbPointSegDistanceV92(p,guide[i-1],guide[i]);
    if(d<best)best=d;
  }
  return best;
}
function lbAcuteAngleV93(a,b){
  const lat=(a.a[1]+a.b[1]+b.a[1]+b.b[1])/4,c=Math.cos(lat*Math.PI/180);
  const ax=(a.b[0]-a.a[0])*c,ay=a.b[1]-a.a[1],bx=(b.b[0]-b.a[0])*c,by=b.b[1]-b.a[1];
  const na=Math.hypot(ax,ay),nb=Math.hypot(bx,by);if(!na||!nb)return 90;
  let x=Math.abs((ax*bx+ay*by)/(na*nb));x=Math.max(0,Math.min(1,x));
  return Math.acos(x)*180/Math.PI;
}
function lbSegIntersectionV93(a,b){
  const x1=a.a[0],y1=a.a[1],x2=a.b[0],y2=a.b[1],x3=b.a[0],y3=b.a[1],x4=b.b[0],y4=b.b[1];
  const dx1=x2-x1,dy1=y2-y1,dx2=x4-x3,dy2=y4-y3,den=dx1*dy2-dy1*dx2;
  if(Math.abs(den)<1e-13)return null;
  const rx=x3-x1,ry=y3-y1,t=(rx*dy2-ry*dx2)/den,u=(rx*dy1-ry*dx1)/den;
  if(t<-1e-7||t>1+1e-7||u<-1e-7||u>1+1e-7)return null;
  return {t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u)),p:[x1+dx1*t,y1+dy1*t]};
}
function lbTopoNodeKeyV93(c){return `${(+c[0]).toFixed(7)},${(+c[1]).toFixed(7)}`;}
function lbBuildGuidedCoreV93(guide){
  if(!state.segments?.size||!Array.isArray(guide)||guide.length<2)return null;
  const corridor=55; // mètres autour du trait rouge
  const candidates=[];
  for(const seg of state.segments.values()){
    const mid=[(seg.a[0]+seg.b[0])/2,(seg.a[1]+seg.b[1])/2];
    const d=Math.min(lbPointGuideDistV93(seg.a,guide),lbPointGuideDistV93(seg.b,guide),lbPointGuideDistV93(mid,guide));
    if(d<=corridor)candidates.push({seg,d});
  }
  if(!candidates.length)return null;
  const split=new Map(),extras=[];
  for(const c of candidates)split.set(c.seg.id,[0,1]);

  // Index spatial grossier pour éviter le O(n²) dans les gros faisceaux.
  const cell=.0015,grid=new Map();
  function put(k,id){if(!grid.has(k))grid.set(k,[]);grid.get(k).push(id)}
  candidates.forEach((c,i)=>{
    const s=c.seg,x0=Math.floor(Math.min(s.a[0],s.b[0])/cell),x1=Math.floor(Math.max(s.a[0],s.b[0])/cell),y0=Math.floor(Math.min(s.a[1],s.b[1])/cell),y1=Math.floor(Math.max(s.a[1],s.b[1])/cell);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)put(`${x}:${y}`,i);
  });
  const pairs=new Set();
  for(const ids of grid.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
    const a=Math.min(ids[i],ids[j]),b=Math.max(ids[i],ids[j]);pairs.add(`${a}:${b}`);
  }
  let intersections=0,nearJoins=0;
  function addT(id,t){const a=split.get(id);if(!a)return;a.push(Math.max(0,Math.min(1,t)))}
  function nearEndpointToSeg(sa,sb,ta){
    const pt=ta===0?sa.a:sa.b,q=projectToSeg(L.latLng(pt[1],pt[0]),sb);
    if(q.d>3.0)return;
    // Evite de fabriquer une communication entre deux voies parallèles sur des dizaines de mètres.
    const ang=lbAcuteAngleV93(sa,sb);
    const qEnd=q.t<.025||q.t>.975;
    if(!qEnd&&ang<2.0)return;
    addT(sa.id,ta);addT(sb.id,q.t);extras.push({a:pt,b:q.p,d:q.d});nearJoins++;
  }
  for(const key of pairs){
    const [ia,ib]=key.split(':').map(Number),sa=candidates[ia].seg,sb=candidates[ib].seg;
    if(!sa||!sb||sa.id===sb.id)continue;
    const it=lbSegIntersectionV93(sa,sb);
    if(it){
      const edge=it.t<.035||it.t>.965||it.u<.035||it.u>.965;
      const ang=lbAcuteAngleV93(sa,sb);
      // Une croix à 90° peut être un saut-de-mouton. Un raccord/aiguille est généralement aigu
      // ou touche l'extrémité d'un des objets RFN.
      if(edge||ang<=38){addT(sa.id,it.t);addT(sb.id,it.u);intersections++;}
    }
    nearEndpointToSeg(sa,sb,0);nearEndpointToSeg(sa,sb,1);nearEndpointToSeg(sb,sa,0);nearEndpointToSeg(sb,sa,1);
  }

  // Départ/fin du trait : on les insère explicitement dans leur segment RFN.
  function nearestGuidePoint(gp){
    let best=null;const ll=L.latLng(+gp[0],+gp[1]);
    for(const c of candidates){const q=projectToSeg(ll,c.seg);if(!best||q.d<best.q.d)best={seg:c.seg,q};}
    return best;
  }
  const st=nearestGuidePoint(guide[0]),en=nearestGuidePoint(guide.at(-1));
  if(!st||!en||st.q.d>70||en.q.d>70)return null;
  addT(st.seg.id,st.q.t);addT(en.seg.id,en.q.t);

  const nodes=new Map(),adj=new Map(),segPoints=new Map();
  function node(c){const k=lbTopoNodeKeyV93(c);if(!nodes.has(k))nodes.set(k,{key:k,lon:+c[0],lat:+c[1]});if(!adj.has(k))adj.set(k,[]);return k;}
  function edge(a,b,w){if(a===b)return;adj.get(a).push({to:b,w});adj.get(b).push({to:a,w});}
  for(const c of candidates){
    const s=c.seg,ts=[...new Set((split.get(s.id)||[0,1]).map(t=>+t.toFixed(8)))].sort((a,b)=>a-b),arr=[];
    for(const t of ts){const p=[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t];arr.push({t,p,k:node(p)});}
    segPoints.set(s.id,arr);
    for(let i=1;i<arr.length;i++){
      const a=arr[i-1],b=arr[i],len=distanceLL(a.p,b.p),mid=[(a.p[0]+b.p[0])/2,(a.p[1]+b.p[1])/2],d=lbPointGuideDistV93(mid,guide);
      const penalty=1+Math.pow(Math.min(12,d/7),2)*2.2;
      edge(a.k,b.k,Math.max(.01,len)*penalty);
    }
  }
  // Petits raccords de données (<=3 m) uniquement : ils réparent les near-miss RFN sans
  // permettre au train de sauter arbitrairement d'une voie parallèle à l'autre.
  for(const x of extras){const ka=node(x.a),kb=node(x.b);edge(ka,kb,Math.max(.1,x.d)*8);}

  function keyAt(seg,q){
    const arr=segPoints.get(seg.id)||[];let best=null;
    for(const x of arr){const d=Math.abs(x.t-q.t);if(!best||d<best.d)best={d,k:x.k};}
    return best?.k||null;
  }
  const start=keyAt(st.seg,st.q),goal=keyAt(en.seg,en.q);if(!start||!goal)return null;

  const dist=new Map([[start,0]]),prev=new Map(),heap=new Heap();heap.push([0,start]);
  while(heap.size){const [d,u]=heap.pop();if(d!==dist.get(u))continue;if(u===goal)break;
    for(const e of adj.get(u)||[]){const nd=d+e.w;if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,u);heap.push([nd,e.to]);}}
  }
  if(!dist.has(goal))return {error:'guided-disconnected',stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size}};
  const keys=[];let u=goal;while(u){keys.push(u);if(u===start)break;u=prev.get(u);}keys.reverse();
  const coords=[[st.q.p[0],st.q.p[1]]];
  for(const k of keys){const n=nodes.get(k);if(n)coords.push([n.lon,n.lat]);}
  coords.push([en.q.p[0],en.q.p[1]]);
  return {coords,stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size,nodes:nodes.size}};
}
function lbRouteByRedV93(pair,A,B){
  let guide=lbGuideOrientV93(state.manualGuideV93||[],pair);if(guide.length<2)return null;
  const core=lbBuildGuidedCoreV93(guide);if(!core||core.error)return core;
  const first=guide[0],last=guide.at(-1);
  const S=lbStrictRailAnchorV89(L.latLng(+first[0],+first[1]));
  const E=lbStrictRailAnchorV89(L.latLng(+last[0],+last[1]));
  if(!S||!E)return {error:'guide-end-anchor'};
  let pre=routeAnchors(A,S),post=routeAnchors(E,B);
  // Si l'utilisateur commence/termine son trait tout près d'une gare et que le graphe RFN
  // historique est justement cassé à cet endroit, on garde l'attache gare->rail courte.
  if(!pre){const d=distanceLL([A.lon,A.lat],[S.lon,S.lat]);if(d<1200)pre=[[A.lon,A.lat],[S.lon,S.lat]];}
  if(!post){const d=distanceLL([E.lon,E.lat],[B.lon,B.lat]);if(d<1200)post=[[E.lon,E.lat],[B.lon,B.lat]];}
  if(!pre||!post)return {error:'prefix-or-suffix-disconnected',stats:core.stats};
  const all=[];function append(c){for(const p of c||[]){if(all.length&&distanceLL(all.at(-1),p)<2)continue;all.push(p)}}
  append(pre);append(core.coords);append(post);
  return {coords:all,stats:core.stats};
}
'''

anchor='function renderFixed(){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR: renderFixed introuvable')
s=s[:pos]+helper+'\n'+s[pos:]

# Au relâchement du crayon, mémorise d'abord la FORME rouge (simplifiée à 6 m)
# avant que V9.2 ne la transforme en quelques accroches.
needle='  const lbStatsV92=lbSimplifyManualTraceV92();\n'
if needle not in s:raise SystemExit('ERREUR: appel simplifier V9.2 absent')
s=s.replace(needle,"  state.manualGuideV93=lbGuidePrepareV93(state.manualGuideRawV91||[]);\n"+needle,1)

# Effacement manuel : efface aussi le corridor rouge V9.3.
needle2='function lbClearManualTraceV91(recomputeNow=false){\n'
if needle2 not in s:raise SystemExit('ERREUR: clear manual absent')
s=s.replace(needle2,needle2+'  state.manualGuideV93=[];state.manualTopoStatsV93=null;\n',1)

# Changement de brique : purge l'ancien corridor avant de charger le saved suivant.
needle3='function clearMapWork(){\n'
if needle3 not in s:raise SystemExit('ERREUR: clearMapWork absent')
s=s.replace(needle3,needle3+'  state.manualGuideV93=[];state.manualTopoStatsV93=null;\n',1)

# Recharge le corridor enregistré.
pat=re.compile(r'(state\.manualTraceV91=\(saved\?\.manualTraceV91\|\|\[\]\)[^;]+;)')
m=pat.search(s)
if not m:raise SystemExit('ERREUR: recharge manualTraceV91 absente')
load=m.group(1)+"\n  state.manualGuideV93=(saved?.manualGuideV93||[]).map(p=>[+p[0],+p[1]]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));"
s=s[:m.start()]+load+s[m.end():]

# Le rouge affiché est l'intention utilisateur V9.3 ; fallback V9.1/V9.2 sinon.
old="const pts=(state.manualTraceV91||[]).map(x=>[+x.lat,+x.lon]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));"
new="const pts=((state.manualGuideV93||[]).length?state.manualGuideV93:(state.manualTraceV91||[]).map(x=>[+x.lat,+x.lon])).filter(x=>Number.isFinite(+x[0])&&Number.isFinite(+x[1]));"
if old not in s:raise SystemExit('ERREUR: pts render guide V9.2 absent')
s=s.replace(old,new,1)

# Persistance.
needle4="manualTraceV91:(state.manualTraceV91||[]).map(v=>({lat:v.lat,lon:v.lon,segmentId:v.segmentId||null})),coordinates:state.routeCoords,"
if needle4 not in s:raise SystemExit('ERREUR: payload manualTrace V9.1 absent')
repl4="manualTraceV91:(state.manualTraceV91||[]).map(v=>({lat:v.lat,lon:v.lon,segmentId:v.segmentId||null})),manualGuideV93:(state.manualGuideV93||[]).map(p=>[+p[0],+p[1]]),coordinates:state.routeCoords,"
s=s.replace(needle4,repl4,1)

# Le changement essentiel : si un rouge V9.3 existe, il devient la loi AVANT le
# Dijkstra classique par vias. On ne demande plus au graphe exact historique de
# deviner les intersections.
pat2=re.compile(r"(const anchors=\[\];const A=lbEndpointAnchorV89\(p\[0\],'A'\),B=lbEndpointAnchorV89\(p\[1\],'B'\);if\(!A\|\|!B\)\{setStatus\('Impossible d’accrocher une gare au RFN détaillé\.','bad'\);return;\})")
m2=pat2.search(s)
if not m2:raise SystemExit('ERREUR: ancre A/B recompute V8.9 absente')
branch=m2.group(1)+r'''
  if((state.manualGuideV93||[]).length>=2){
    const guided=lbRouteByRedV93(p,A,B);
    for(const l of state.routeLayers)map.removeLayer(l);state.routeLayers=[];state.routeCoords=[];state.routeKm=0;state.routeErrors=0;
    if(!guided||guided.error||!Array.isArray(guided.coords)||guided.coords.length<2){
      state.routeErrors=1;updateMetrics(0,0,1);state.manualTopoStatsV93=guided?.stats||null;
      const st=guided?.stats?` · candidats ${guided.stats.candidates||0}, intersections réparées ${guided.stats.intersections||0}, raccords proches ${guided.stats.nearJoins||0}`:'';
      setStatus(`⚠ Le corridor ROUGE est encore non connecté (${esc(guided?.error||'aucun chemin')})${st}. Le jaune n’est PAS validable : élargis/redessine légèrement le rouge sur le raccord réel.`,'bad');return;
    }
    state.manualTopoStatsV93=guided.stats||null;state.routeCoords=guided.coords;
    for(let i=1;i<guided.coords.length;i++)state.routeKm+=distanceLL(guided.coords[i-1],guided.coords[i])/1000;
    const line=L.polyline(guided.coords.map(x=>[x[1],x[0]]),{pane:'route',color:'#ffd84d',weight:7,opacity:.98,lineJoin:'round',lineCap:'round'}).addTo(map);state.routeLayers.push(line);
    updateMetrics(1,state.routeKm,0);
    const st=guided.stats||{};
    setStatus(`✓ TRACE ROUGE SUIVI : 1 chemin jaune · ${state.routeKm.toFixed(1)} km · ${st.candidates||0} segments RFN dans le corridor · ${st.intersections||0} intersection(s) nodée(s) · ${st.nearJoins||0} raccord(s) <=3 m. Si le jaune suit le rouge, valide la brique V8.`,'ok');return;
  }'''
s=s[:m2.start()]+branch+s[m2.end():]

p.write_text(s,encoding='utf-8')
print('Patch moteur V9.3 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 3/8 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8')
checks={
 'marker':'LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93' in js,
 'guide':'function lbGuidePrepareV93' in js,
 'local-topology':'function lbBuildGuidedCoreV93' in js,
 'intersections':'function lbSegIntersectionV93' in js,
 'near-joins':'nearEndpointToSeg' in js and 'q.d>3.0' in js,
 'grade-crossing-guard':'ang<=38' in js,
 'red-cost':'lbPointGuideDistV93(mid,guide)' in js,
 'red-first':'const guided=lbRouteByRedV93(p,A,B)' in js,
 'persist':'manualGuideV93:(state.manualGuideV93||[])' in js,
 'one-yellow':'TRACE ROUGE SUIVI : 1 chemin jaune' in js,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 4/8 CACHE HTML V9.3 ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")";cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=9.3', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 5/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"

echo "=== 6/8 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93' "$TMP/served.js"
grep -qF 'function lbBuildGuidedCoreV93' "$TMP/served.js"
echo "Editeur V9.3 servi : OK"

echo "=== 7/8 NON-REGRESSION DES COUCHES PRECEDENTES ==="
for marker in LB_MOORAIL_FOREIGN_STRAIGHT_V88 LB_MOORAIL_ENDPOINT_HANDLES_V89 LB_MOORAIL_DIRECTION_CHOOSER_V90 LB_MOORAIL_FREEHAND_TRACE_V91 LB_MOORAIL_FREEHAND_SIMPLIFY_V92; do
  grep -qF "$marker" "$JS"
  echo "  $marker : OK"
done

echo "=== 8/8 HEALTH FINAL ==="
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "$HEALTH"
python3 - "$TMP/health-before.json" <(printf '%s' "$HEALTH") <<'PY'
import json,sys
b=json.load(open(sys.argv[1]));a=json.load(open(sys.argv[2]))
assert a.get('ok') is True,a
assert a.get('network')==b.get('network'),(b,a)
print('Non-régression health/network : OK')
PY

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V9.3 INSTALLE ET VALIDE"
echo "============================================================"
echo " - le rouge définit désormais un CORRIDOR, pas une liste de micro-vias"
echo " - topologie RFN réparée localement aux raccordements du corridor"
echo " - near-miss <= 3 m reconnectés"
echo " - intersections aiguës <= 38° nodées, croix franches protégées"
echo " - Dijkstra pénalisé très fortement s'il s'éloigne du rouge"
echo " - UN SEUL jaune final ; aucune modification du routage automatique sans rouge"
echo "Backup : $BACKUP"
echo "============================================================"
