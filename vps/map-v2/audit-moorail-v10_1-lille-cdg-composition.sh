#!/usr/bin/env bash
set -u

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
SERVICE="labetaillere-map-v2.service"
TMP="$(mktemp -d /tmp/moorail-v101-lille-cdg.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok(){ printf '  ✅ %s\n' "$*"; }
ko(){ printf '  ❌ %s\n' "$*"; fail=$((fail+1)); }
wa(){ printf '  ⚠️  %s\n' "$*"; }

echo "============================================================"
echo " MOO RAIL V10.1 — AUDIT COMPOSITION LILLE ↔ CDG"
echo " AUCUNE MODIFICATION"
echo "============================================================"

echo
echo "=== 1/6 SERVICE / FICHIERS ==="
if systemctl is-active --quiet "$SERVICE"; then ok "service map actif"; else ko "service map inactif"; fi
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health || true
echo
for f in "$LIVE" "$NETWORK" "$STATE"; do [[ -f "$f" ]] && ok "$(basename "$f") présent" || ko "$f absent"; done

echo
echo "=== 2/6 VARIANTES 7815 / 7818 ==="
python3 - "$NETWORK" <<'PY'
import json,sys
n=json.load(open(sys.argv[1],encoding='utf-8'))
for num in ('7815','7818'):
    vs=(n.get('trainRoutes') or {}).get(num) or []
    print(num,':',len(vs),'variante(s)')
    for v in vs:
        print(' ', ' → '.join((x.get('name') or '?') for x in (v.get('stops') or [])))
        print('   tripId:',v.get('tripId'))
PY

echo
echo "=== 3/6 PAIRE DIRECTE LILLE FLANDRES ↔ CDG ==="
python3 - "$LIVE" <<'PY'
import json,sys,unicodedata

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

d=json.load(open(sys.argv[1],encoding='utf-8'))
want={norm('Lille Flandres'),norm('Aéroport Charles de Gaulle 2 TGV')}
rows=[x for x in d.get('pairs') or [] if {norm(x.get('from')),norm(x.get('to'))}==want]
if not rows:
    print('DIRECT : ❌ absente')
else:
    for x in rows:
        print('DIRECT : ✅',x.get('from'),'→',x.get('to'),'|',x.get('sectionId'),'| points',len(x.get('coords') or []))
PY

echo
echo "=== 4/6 RECHERCHE D'UNE CHAINE LIVE REUTILISABLE ==="
python3 - "$LIVE" <<'PY'
import json,sys,unicodedata,heapq,math

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def pathlen(coords):
    # Longueur approximative suffisante pour classer les chaînes LIVE.
    R=6371000.0
    out=0.0
    for a,b in zip(coords or [],(coords or [])[1:]):
        try:
            lon1,lat1=float(a[1] if abs(float(a[0]))>30 else a[0]),float(a[0] if abs(float(a[0]))>30 else a[1])
            lon2,lat2=float(b[1] if abs(float(b[0]))>30 else b[0]),float(b[0] if abs(float(b[0]))>30 else b[1])
        except: continue
        p1,p2=math.radians(lat1),math.radians(lat2)
        dp=math.radians(lat2-lat1);dl=math.radians(lon2-lon1)
        x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        out += 2*R*math.atan2(math.sqrt(x),math.sqrt(max(0,1-x)))
    return out

d=json.load(open(sys.argv[1],encoding='utf-8'))
name={}
adj={}
for x in d.get('pairs') or []:
    a,b=norm(x.get('from')),norm(x.get('to'))
    if not a or not b: continue
    name[a]=x.get('from');name[b]=x.get('to')
    c=x.get('coords') or []
    w=pathlen(c) or 1.0
    adj.setdefault(a,[]).append((b,w,x))

start=norm('Lille Flandres');goal=norm('Aéroport Charles de Gaulle 2 TGV')
q=[(0.0,0,start,[])]
seen={}
solutions=[]
while q:
    cost,hops,u,edges=heapq.heappop(q)
    if hops>8: continue
    key=(u,hops)
    if seen.get(key,1e99)<=cost: continue
    seen[key]=cost
    if u==goal:
        solutions.append((cost,edges))
        if len(solutions)>=5: break
        continue
    for v,w,x in adj.get(u,[]):
        # évite boucles évidentes
        used={norm(e.get('from')) for e in edges}|{norm(e.get('to')) for e in edges}
        if v in used and v!=goal: continue
        heapq.heappush(q,(cost+w,hops+1,v,edges+[x]))

if not solutions:
    print('CHAINE LIVE : ❌ aucune chaîne <= 8 briques')
    raise SystemExit(0)

for rank,(cost,edges) in enumerate(solutions,1):
    names=[edges[0].get('from')]+[e.get('to') for e in edges]
    print(f'CHAINE {rank}: ✅ {len(edges)} brique(s) | ~{cost/1000:.1f} km')
    print('  '+' → '.join(names))
    for e in edges:
        print('   ',e.get('from'),'→',e.get('to'),'|',e.get('sectionId'),'|',e.get('validationEngine') or e.get('engine') or '?')
PY

echo
echo "=== 5/6 BRIQUES V8 AUTOUR DE LILLE / CDG ==="
python3 - "$NETWORK" <<'PY'
import json,sys,unicodedata

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

n=json.load(open(sys.argv[1],encoding='utf-8'))
keys=['lille flandres','lille europe','arras','tgv haute picardie','aeroport charles de gaulle 2 tgv']
for t in n.get('tasks') or []:
    a=(t.get('from') or {}).get('name','');b=(t.get('to') or {}).get('name','')
    z=norm(a+' '+b)
    if any(k in z for k in keys):
        print(f"{t.get('status','?'):12} | impact {t.get('impactToday',0):3} | {a} → {b} | {t.get('sectionId')}")
PY

echo
echo "=== 6/6 VERDICT ==="
python3 - "$LIVE" <<'PY'
import json,sys,unicodedata,collections

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

d=json.load(open(sys.argv[1],encoding='utf-8'))
adj=collections.defaultdict(list)
for x in d.get('pairs') or []:
    a,b=norm(x.get('from')),norm(x.get('to'))
    if a and b: adj[a].append((b,x))
start=norm('Lille Flandres');goal=norm('Aéroport Charles de Gaulle 2 TGV')
q=collections.deque([(start,[])])
seen={start}
found=None
while q:
    u,p=q.popleft()
    if len(p)>=8: continue
    for v,x in adj.get(u,[]):
        if v==goal:
            found=p+[x];q.clear();break
        if v not in seen:
            seen.add(v);q.append((v,p+[x]))
    if found:break

direct=any(norm(x.get('from'))==start and norm(x.get('to'))==goal for x in d.get('pairs') or [])
if direct:
    print('RESULTAT : ✅ paire directe LIVE ; le publisher devrait la reconnaître directement.')
elif found:
    print('RESULTAT : 🟡 chaîne LIVE disponible mais paire GTFS directe absente.')
    print('=> Il faut apprendre au publisher V10.1 à COMPOSER les briques validées au lieu de te faire retracer Lille Flandres → CDG en une seule énorme brique.')
    print('=> chaîne :',' → '.join([found[0].get('from')]+[x.get('to') for x in found]))
else:
    print('RESULTAT : ❌ aucune chaîne LIVE complète Lille Flandres → CDG.')
    print('=> il manque encore de vraies briques physiques à valider dans l’éditeur ; ne pas créer une fausse grande section directe.')
PY

echo
echo "AUCUNE MODIFICATION EFFECTUEE."
exit 0
