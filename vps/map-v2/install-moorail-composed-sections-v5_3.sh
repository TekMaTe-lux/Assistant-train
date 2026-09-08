#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-composed-sections-v5_3-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v53.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V5.3..." >&2
  for f in "$BACKUP"/*.html; do
    [[ -f "$f" ]] || continue
    cp -a "$f" "$PUBLIC/$(basename "$f")"
  done
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }

echo "============================================================"
echo " MOO RAIL V5.3 — COMPOSITION AUTOMATIQUE DES SECTIONS"
echo "============================================================"

echo "=== 1/5 Détection moteurs France V3 ==="
TARGETS=()
for name in carte-core-canonical-v4-preview.html carte-core-preview.html france-v3-preview.html; do
  f="$PUBLIC/$name"
  [[ -f "$f" ]] || continue
  if grep -qF 'function lbMoorailPathBetweenStops(stopA,stopB)' "$f" && \
     grep -qF 'function pathBetweenStops(stopA, stopB)' "$f"; then
    TARGETS+=("$f")
    echo "Moteur : $f"
  fi
done
[[ ${#TARGETS[@]} -gt 0 ]] || { echo "ERREUR: aucun moteur MooRail V4.5 trouvé" >&2; exit 3; }

mkdir -p "$BACKUP"
for f in "${TARGETS[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done

echo "=== 2/5 Patch résolution directe + composée ==="
for f in "${TARGETS[@]}"; do
python3 - "$f" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_COMPOSED_PATH_V53 */'
if marker in s:
    print('Déjà patché :',p)
    raise SystemExit(0)

required=[
    'const lbMoorailLivePairs = new Map();',
    'let lbMoorailLiveLoaded = false;',
    'function lbMoorailPathBetweenStops(stopA,stopB)',
    'function pathBetweenStops(stopA, stopB)',
]
for x in required:
    if x not in s: raise SystemExit(f'ERREUR ancre absente dans {p}: {x}')

# Cache des compositions ; invalidé à chaque rechargement du JSON live.
s=s.replace(
    '  let lbMoorailLiveLoaded = false;',
    '  let lbMoorailLiveLoaded = false;\n  const lbMoorailComposedCache = new Map();',
    1
)
s=s.replace(
    '      lbMoorailLivePairs.clear();',
    '      lbMoorailLivePairs.clear();\n      lbMoorailComposedCache.clear();',
    1
)

helper=r'''

  /* LB_MOORAIL_COMPOSED_PATH_V53 */
  function lbMoorailResolvedPathBetweenStops(stopA,stopB){
    const direct=lbMoorailPathBetweenStops(stopA,stopB);
    if(direct) return direct;
    if(!lbMoorailLiveLoaded || !stopA || !stopB) return null;

    const fromName=lbMoorailStopName(stopA);
    const toName=lbMoorailStopName(stopB);
    const start=lbMoorailNormName(fromName);
    const goal=lbMoorailNormName(toName);
    if(!start || !goal || start===goal) return null;

    const cacheKey=`${start}|${goal}`;
    if(lbMoorailComposedCache.has(cacheKey)){
      const cached=lbMoorailComposedCache.get(cacheKey);
      if(!cached) return null;
      const path=makePath(cached.coords.map(c=>[Number(c[0]),Number(c[1])]),false);
      if(!path || !path.totalDist) return null;
      path.moorailValidated=true;
      path.moorailComposed=true;
      path.moorailSectionIds=[...(cached.sectionIds||[])];
      path.moorailViaNames=[...(cached.viaNames||[])];
      return path;
    }

    const adjacency=new Map();
    for(const item of lbMoorailLivePairs.values()){
      if(!item?.from || !item?.to || !Array.isArray(item.coords) || item.coords.length<2) continue;
      const a=lbMoorailNormName(item.from), b=lbMoorailNormName(item.to);
      if(!a || !b || a===b) continue;
      const edgePath=makePath(item.coords.map(c=>[Number(c[0]),Number(c[1])]),false);
      const cost=Number(edgePath?.totalDist);
      if(!Number.isFinite(cost) || cost<=0) continue;
      if(!adjacency.has(a)) adjacency.set(a,[]);
      adjacency.get(a).push({to:b,item,cost});
    }

    const MAX_HOPS=10;
    let straight=0;
    try{ straight=Number(distLL(stopA,stopB)) || 0; }catch(_){ straight=0; }
    const MAX_COST=straight>0 ? straight*2.6+120000 : 1800000;

    const queue=[{node:start,cost:0,hops:0,coords:[],sectionIds:[],viaNames:[fromName]}];
    const best=new Map([[start,0]]);

    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost);
      const cur=queue.shift();
      if(!cur) break;
      if(cur.cost > (best.get(cur.node) ?? Infinity)+1e-6) continue;
      if(cur.node===goal){
        if(cur.coords.length<2 || cur.sectionIds.length<2) break;
        const saved={coords:cur.coords,sectionIds:cur.sectionIds,viaNames:cur.viaNames};
        lbMoorailComposedCache.set(cacheKey,saved);
        const path=makePath(cur.coords.map(c=>[Number(c[0]),Number(c[1])]),false);
        if(!path || !path.totalDist) return null;
        path.moorailValidated=true;
        path.moorailComposed=true;
        path.moorailSectionIds=[...cur.sectionIds];
        path.moorailViaNames=[...cur.viaNames];
        console.info('[MOO RAIL V5.3] section composée',fromName,'→',toName,'via',cur.viaNames);
        return path;
      }
      if(cur.hops>=MAX_HOPS) continue;

      for(const edge of adjacency.get(cur.node) || []){
        const nextCost=cur.cost+edge.cost;
        if(nextCost>MAX_COST) continue;
        if(nextCost >= (best.get(edge.to) ?? Infinity)-1e-6) continue;

        const coords=cur.coords.slice();
        for(const raw of edge.item.coords || []){
          if(!Array.isArray(raw) || raw.length<2) continue;
          const pt=[Number(raw[0]),Number(raw[1])];
          if(!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
          const last=coords.at(-1);
          if(!last || last[0]!==pt[0] || last[1]!==pt[1]) coords.push(pt);
        }
        if(coords.length<2) continue;

        best.set(edge.to,nextCost);
        queue.push({
          node:edge.to,
          cost:nextCost,
          hops:cur.hops+1,
          coords,
          sectionIds:[...cur.sectionIds,edge.item.sectionId || `${edge.item.from}→${edge.item.to}`],
          viaNames:[...cur.viaNames,edge.item.to]
        });
      }
    }

    lbMoorailComposedCache.set(cacheKey,null);
    return null;
  }
'''
anchor='  function pathBetweenStops(stopA, stopB){'
s=s.replace(anchor,helper+'\n'+anchor,1)

# Mouvement live : direct d'abord, puis composition de plusieurs sections validées.
old='    const moorail=lbMoorailPathBetweenStops(stopA,stopB);'
new='    const moorail=lbMoorailResolvedPathBetweenStops(stopA,stopB);'
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit(f'ERREUR ancre pathBetweenStops MooRail absente dans {p}')

# Tracé jaune V5.2 : une paire commerciale sautée peut maintenant être reconstruite
# avec plusieurs sections validées intermédiaires (ex. Rennes -> Le Mans -> Massy).
old2='      const path=lbMoorailPathBetweenStops(stopA,stopB);'
new2='      const path=lbMoorailResolvedPathBetweenStops(stopA,stopB);'
if old2 in s:
    s=s.replace(old2,new2,1)

p.write_text(s,encoding='utf-8')
print('Patché :',p)
PY
done

echo "=== 3/5 Contrôles statiques ==="
for f in "${TARGETS[@]}"; do
  grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$f"
  grep -qF 'const moorail=lbMoorailResolvedPathBetweenStops(stopA,stopB)' "$f"
  if grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$f"; then
    grep -qF 'const path=lbMoorailResolvedPathBetweenStops(stopA,stopB)' "$f"
  fi
done

echo "=== 4/5 Vérification composition TGV 5460 ==="
python3 - <<'PY'
import json,urllib.request,unicodedata,heapq,math

def get(url):
    return json.load(urllib.request.urlopen(url,timeout=15))
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
def hav(a,b):
    r=6371000.0
    p1,p2=math.radians(a[0]),math.radians(b[0])
    dp=math.radians(b[0]-a[0]); dl=math.radians(b[1]-a[1])
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(min(1,math.sqrt(x)))
def edge_km(coords):
    return sum(hav(a,b) for a,b in zip(coords,coords[1:]))/1000.0

cat=get('http://127.0.0.1:3111/api/map-v2/route-editor/catalog')
live=get('http://127.0.0.1:3111/data/moorail-live-v1/sections.json')
adj={}
for x in live.get('pairs') or []:
    a,b=norm(x.get('from')),norm(x.get('to'))
    c=x.get('coords') or []
    if not a or not b or len(c)<2: continue
    adj.setdefault(a,[]).append((b,max(edge_km(c),0.001),x.get('to')))

def resolve(a,b,maxh=10):
    aa,bb=norm(a),norm(b)
    for to,_,label in adj.get(aa,[]):
        if to==bb:return [a,label]
    q=[(0.0,0,aa,[a])]; best={(aa,0):0.0}
    while q:
        cost,h,node,names=heapq.heappop(q)
        if node==bb and h>=2:return names
        if h>=maxh:continue
        for to,w,label in adj.get(node,[]):
            nc=cost+w; key=(to,h+1)
            if nc>=best.get(key,1e99):continue
            best[key]=nc;heapq.heappush(q,(nc,h+1,to,names+[label]))
    return None

routes=[r for r in cat.get('routes') or [] if '5460' in [str(x) for x in (r.get('trainNumbers') or [])]]
print('Variantes 5460 :',len(routes))
all_ok=False
for r in routes:
    print('\n',r.get('id'),'|',r.get('signature'))
    ok=True
    stops=r.get('stops') or []
    for a,b in zip(stops,stops[1:]):
        an,bn=a.get('name'),b.get('name')
        path=resolve(an,bn)
        if not path:
            ok=False;print('  ❌',an,'→',bn)
        elif len(path)>2:
            print('  🔗',an,'→',bn,'COMPOSÉ :',' → '.join(path))
        else:
            print('  ✅',an,'→',bn)
    print('  RESULTAT :','✅ 100 % RESOLVABLE' if ok else '❌ incomplet')
    all_ok=all_ok or ok
assert all_ok,'Aucune variante 5460 entièrement résoluble, même par composition'

p=resolve('Rennes','Massy TGV')
print('\nRennes → Massy TGV :', ' → '.join(p) if p else 'ABSENT')
assert p and len(p)>2,'Rennes → Massy TGV ne se compose pas avec les sections existantes'
PY

echo "=== 5/5 Redémarrage + health ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 http://127.0.0.1:3111/carte-core-canonical-v4-preview.html -o "$TMP/page.html"
grep -qF 'LB_MOORAIL_COMPOSED_PATH_V53' "$TMP/page.html"
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "Health : $HEALTH"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V5.3 INSTALLE — SECTIONS COMPOSEES ACTIVES"
echo "============================================================"
echo "Une paire d'arrêts absente peut maintenant réutiliser plusieurs"
echo "sections MooRail déjà validées, même si le train saute un arrêt"
echo "commercial. Exemple attendu :"
echo " Rennes -> Massy TGV = Rennes -> Le Mans -> Massy TGV"
echo "Cette logique s'applique au mouvement ET au tracé jaune V5.2."
echo "Backup : $BACKUP"
echo "============================================================"
