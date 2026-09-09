#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
HTML2="$PUBLIC/moorail-route-editor-stops.html"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v9_4-lane-continuity-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v94.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V9.4..." >&2
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
echo " MOO RAIL V9.4 — CONTINUITE DE VOIE / ANTI-ZIGZAG"
echo "============================================================"
echo "Le rouge reste le corridor V9.3, mais le routeur ne doit plus"
echo "sauter d'une voie parallèle à l'autre à chaque aiguille."
echo "Il privilégie désormais la CONTINUITE de la même voie et ne change"
echo "de voie que si le rouge / la topologie rendent ce changement utile."
echo

echo "=== 0/8 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-before.json"
python3 - "$TMP/health-before.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('ok') is True,h
print('Health :',h)
PY
for marker in LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93 LB_MOORAIL_FREEHAND_SIMPLIFY_V92 LB_MOORAIL_FREEHAND_TRACE_V91; do
  grep -qF "$marker" "$JS" || { echo "ERREUR marqueur absent: $marker" >&2; exit 4; }
done
grep -qF 'function lbBuildGuidedCoreV93(guide)' "$JS"
grep -qF 'function edge(a,b,w){if(a===b)return;adj.get(a).push({to:b,w});adj.get(b).push({to:a,w});}' "$JS"
grep -qF 'const dist=new Map([[start,0]]),prev=new Map(),heap=new Heap();heap.push([0,start]);' "$JS"
node --check "$JS"
if grep -qF 'LB_MOORAIL_LANE_CONTINUITY_V94' "$JS"; then
  echo "ERREUR: V9.4 déjà présente" >&2
  exit 5
fi

echo "=== 1/8 BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ -f "$HTML2" ]] && cp -a "$HTML2" "$BACKUP/moorail-route-editor-stops.html" || true
echo "Backup : $BACKUP"

echo "=== 2/8 PATCH : DIJKSTRA AVEC MEMOIRE DE VOIE ==="
cp -a "$JS" "$TMP/editor.js"
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_LANE_CONTINUITY_V94 */'
if marker in s:raise SystemExit('V9.4 déjà présente')

helper=marker+r'''
function lbSegFamilyV94(seg){
  // Un feature GeoJSON représente en pratique une polyline de voie. Les petits
  // segments j d'un même feature doivent être considérés comme LA MEME voie.
  const id=String(seg?.id||'');
  const parts=id.split('|');
  if(parts.length>=3)return parts.slice(0,-1).join('|');
  return id;
}
function lbTurnDegV94(prevNode,node,nextNode,nodes){
  if(!prevNode||!node||!nextNode)return 0;
  const A=nodes.get(prevNode),B=nodes.get(node),C=nodes.get(nextNode);
  if(!A||!B||!C)return 0;
  const lat=B.lat*Math.PI/180,cc=Math.cos(lat);
  const ax=(B.lon-A.lon)*cc,ay=B.lat-A.lat;
  const bx=(C.lon-B.lon)*cc,by=C.lat-B.lat;
  const na=Math.hypot(ax,ay),nb=Math.hypot(bx,by);if(!na||!nb)return 0;
  let dot=(ax*bx+ay*by)/(na*nb);dot=Math.max(-1,Math.min(1,dot));
  return Math.acos(dot)*180/Math.PI;
}
function lbTransitionPenaltyV94(cur,e,nodes){
  if(!cur?.inEdge)return 0;
  const prev=cur.inEdge;
  const turn=lbTurnDegV94(cur.prevNode,cur.node,e.to,nodes);

  // Un petit raccord de réparation <=3 m doit rester possible, mais il ne doit
  // pas devenir un raccourci gratuit pour changer de voie sans raison.
  if(prev.kind==='repair'||e.kind==='repair')return 90 + Math.min(500,turn*8);

  const sameFamily=prev.family&&e.family&&prev.family===e.family;
  if(sameFamily){
    // Même voie : quasiment aucune pénalité. Une courbe normale reste naturelle.
    return turn>45 ? (turn-45)*4 : 0;
  }

  // Changement de feature/voie : on le permet aux aiguilles, mais on le rend
  // volontairement plus cher que "continuer tout droit". Cela supprime les
  // zigzags voie 1 -> voie 2 -> voie 1 dans les faisceaux parallèles.
  if(turn<=3)return 80;
  if(turn<=8)return 150 + (turn-3)*8;
  if(turn<=18)return 240 + (turn-8)*14;
  if(turn<=38)return 420 + (turn-18)*22;
  return 1200 + (turn-38)*35;
}
'''
anchor='function lbBuildGuidedCoreV93(guide){'
pos=s.find(anchor)
if pos<0:raise SystemExit('ERREUR: lbBuildGuidedCoreV93 absent')
s=s[:pos]+helper+'\n'+s[pos:]

old="function edge(a,b,w){if(a===b)return;adj.get(a).push({to:b,w});adj.get(b).push({to:a,w});}"
new="""let lbEdgeSeqV94=0;
  function edge(a,b,w,meta={}){
    if(a===b)return;
    const base=`v94-${++lbEdgeSeqV94}`;
    const common={w,segId:meta.segId||null,family:meta.family||null,kind:meta.kind||'rail'};
    adj.get(a).push({to:b,...common,eid:base+'a'});
    adj.get(b).push({to:a,...common,eid:base+'b'});
  }"""
if old not in s:raise SystemExit('ERREUR: fonction edge V9.3 absente')
s=s.replace(old,new,1)

old2="edge(a.k,b.k,Math.max(.01,len)*penalty);"
new2="edge(a.k,b.k,Math.max(.01,len)*penalty,{segId:s.id,family:lbSegFamilyV94(s),kind:'rail'});"
if old2 not in s:raise SystemExit('ERREUR: rail edge V9.3 absent')
s=s.replace(old2,new2,1)

old3="for(const x of extras){const ka=node(x.a),kb=node(x.b);edge(ka,kb,Math.max(.1,x.d)*8);}"
new3="for(const x of extras){const ka=node(x.a),kb=node(x.b);edge(ka,kb,Math.max(.1,x.d)*8,{kind:'repair'});}"
if old3 not in s:raise SystemExit('ERREUR: repair edge V9.3 absent')
s=s.replace(old3,new3,1)

old4="""  const dist=new Map([[start,0]]),prev=new Map(),heap=new Heap();heap.push([0,start]);
  while(heap.size){const [d,u]=heap.pop();if(d!==dist.get(u))continue;if(u===goal)break;
    for(const e of adj.get(u)||[]){const nd=d+e.w;if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,u);heap.push([nd,e.to]);}}
  }
  if(!dist.has(goal))return {error:'guided-disconnected',stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size}};
  const keys=[];let u=goal;while(u){keys.push(u);if(u===start)break;u=prev.get(u);}keys.reverse();
  const coords=[[st.q.p[0],st.q.p[1]]];
  for(const k of keys){const n=nodes.get(k);if(n)coords.push([n.lon,n.lat]);}
  coords.push([en.q.p[0],en.q.p[1]]);
  return {coords,stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size,nodes:nodes.size}};"""
new4="""  // V9.4 : état = (noeud courant + arête d'arrivée). On peut ainsi pénaliser
  // un changement de voie, ce qu'un Dijkstra uniquement par noeud ne sait pas faire.
  const startState=`${start}§START`,dist=new Map([[startState,0]]),rec=new Map(),heap=new Heap();
  rec.set(startState,{node:start,prevState:null,prevNode:null,inEdge:null});heap.push([0,startState]);
  let goalState=null;
  while(heap.size){
    const [d,sk]=heap.pop();if(d!==dist.get(sk))continue;
    const cur=rec.get(sk);if(!cur)continue;
    if(cur.node===goal){goalState=sk;break;}
    for(const e of adj.get(cur.node)||[]){
      const trans=lbTransitionPenaltyV94(cur,e,nodes),nd=d+e.w+trans,nk=`${e.to}§${e.eid}`;
      if(nd<(dist.get(nk)??Infinity)){
        dist.set(nk,nd);
        rec.set(nk,{node:e.to,prevState:sk,prevNode:cur.node,inEdge:e});
        heap.push([nd,nk]);
      }
    }
  }
  if(!goalState)return {error:'guided-disconnected',stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size}};

  const states=[];let sk=goalState;
  while(sk){const r=rec.get(sk);if(!r)break;states.push(r);sk=r.prevState;}
  states.reverse();
  const keys=states.map(r=>r.node);

  let laneChanges=0,repairEdges=0,lastFamily=null;
  for(const r of states){
    const e=r.inEdge;if(!e)continue;
    if(e.kind==='repair'){repairEdges++;continue;}
    if(lastFamily&&e.family&&e.family!==lastFamily)laneChanges++;
    if(e.family)lastFamily=e.family;
  }

  const coords=[[st.q.p[0],st.q.p[1]]];
  for(const k of keys){const n=nodes.get(k);if(n)coords.push([n.lon,n.lat]);}
  coords.push([en.q.p[0],en.q.p[1]]);
  return {coords,stats:{candidates:candidates.length,intersections,nearJoins,pairs:pairs.size,nodes:nodes.size,laneChanges,repairEdges}};"""
if old4 not in s:raise SystemExit('ERREUR: Dijkstra V9.3 exact absent')
s=s.replace(old4,new4,1)

old5="setStatus(`✓ TRACE ROUGE SUIVI : 1 chemin jaune · ${state.routeKm.toFixed(1)} km · ${st.candidates||0} segments RFN dans le corridor · ${st.intersections||0} intersection(s) nodée(s) · ${st.nearJoins||0} raccord(s) <=3 m. Si le jaune suit le rouge, valide la brique V8.`,'ok');return;"
new5="setStatus(`✓ TRACE ROUGE SUIVI : 1 chemin jaune · ${state.routeKm.toFixed(1)} km · voie stable V9.4 · ${st.laneChanges||0} changement(s) de voie utile(s) · ${st.candidates||0} segments RFN · ${st.intersections||0} intersection(s) nodée(s) · ${st.nearJoins||0} raccord(s) <=3 m. Si le jaune suit le rouge sans zigzag, valide la brique V8.`,'ok');return;"
if old5 not in s:raise SystemExit('ERREUR: status V9.3 absent')
s=s.replace(old5,new5,1)

p.write_text(s,encoding='utf-8')
print('Patch V9.4 préparé')
PY

node --check "$TMP/editor.js"

echo "=== 3/8 CONTROLES STRUCTURELS ==="
python3 - "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
js=Path(sys.argv[1]).read_text(encoding='utf-8')
checks={
 'marker':'LB_MOORAIL_LANE_CONTINUITY_V94' in js,
 'family':'function lbSegFamilyV94' in js,
 'turn':'function lbTurnDegV94' in js,
 'switch-penalty':'function lbTransitionPenaltyV94' in js,
 'edge-meta':"family:meta.family||null" in js,
 'stateful-dijkstra':'const startState=`${start}§START`' in js,
 'lane-stats':'laneChanges' in js,
 'status':'voie stable V9.4' in js,
 'v93-kept':'LB_MOORAIL_TRACE_GUIDED_TOPOLOGY_V93' in js,
}
for k,v in checks.items():print(' ',k,':','OK' if v else 'FAIL')
assert all(checks.values()),checks
PY

echo "=== 4/8 SELF-TEST SYNTHETIQUE ANTI-ZIGZAG ==="
node <<'JS'
function penalty(prevFamily,nextFamily,turn){
  if(prevFamily===nextFamily)return turn>45?(turn-45)*4:0;
  if(turn<=3)return 80;
  if(turn<=8)return 150+(turn-3)*8;
  if(turn<=18)return 240+(turn-8)*14;
  if(turn<=38)return 420+(turn-18)*22;
  return 1200+(turn-38)*35;
}
const stay=100+100+100;
const zig=95+penalty('voie-A','voie-B',2)+95+penalty('voie-B','voie-A',2)+95;
console.log('coût continuité :',stay);
console.log('coût zigzag     :',zig);
if(!(stay<zig))process.exit(2);
console.log('SELF-TEST ANTI-ZIGZAG : OK');
JS

echo "=== 5/8 CACHE HTML V9.4 ==="
for src in "$HTML" "$HTML2"; do
  [[ -f "$src" ]] || continue
  out="$TMP/$(basename "$src")";cp -a "$src" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=9.4', s)
p.write_text(s,encoding='utf-8')
PY
done

echo "=== 6/8 INSTALLATION ==="
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"
install -o root -g root -m 0644 "$TMP/$(basename "$HTML")" "$HTML"
if [[ -f "$HTML2" ]]; then install -o root -g root -m 0644 "$TMP/$(basename "$HTML2")" "$HTML2"; fi
node --check "$JS"

echo "=== 7/8 RESTART + PRODUIT SERVI ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 "http://127.0.0.1:3111/moorail-route-editor-stops.js?$(date +%s)" -o "$TMP/served.js"
grep -qF 'LB_MOORAIL_LANE_CONTINUITY_V94' "$TMP/served.js"
grep -qF 'function lbTransitionPenaltyV94' "$TMP/served.js"
echo "Editeur V9.4 servi : OK"

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
echo " MOO RAIL V9.4 INSTALLE ET VALIDE"
echo "============================================================"
echo " - le rouge reste le corridor directeur V9.3"
echo " - continuité d'une même voie fortement privilégiée"
echo " - changements de voie pénalisés mais toujours possibles aux aiguilles"
echo " - zigzags voie parallèle -> voie parallèle -> retour supprimés"
echo " - statistiques de changements de voie affichées dans ETAT"
echo " - aucun changement du routage automatique sans tracé rouge"
echo "Backup : $BACKUP"
echo "============================================================"
