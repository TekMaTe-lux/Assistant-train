#!/usr/bin/env bash
set +e

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
LIVE="$ROOT/public/data/moorail-live-v1/sections.json"
NETWORK="$ROOT/public/data/moorail-network-v8/network.json"
SERVICE="labetaillere-map-v2.service"

printf '%s\n' "============================================================"
printf '%s\n' " MOO RAIL V10.2 — AUDIT COMPOSITION SURE LILLE ↔ CDG"
printf '%s\n' " AUCUNE MODIFICATION"
printf '%s\n' "============================================================"

systemctl is-active --quiet "$SERVICE"
SRV=$?
if [ "$SRV" -eq 0 ]; then echo "✅ service map actif"; else echo "❌ service map inactif"; fi
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health || true
echo

python3 - "$LIVE" "$NETWORK" <<'PY'
import json,sys,math,unicodedata,heapq
from collections import defaultdict

LIVE,NETWORK=sys.argv[1:]
live=json.load(open(LIVE,encoding='utf-8'))
net=json.load(open(NETWORK,encoding='utf-8'))

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def hav_ll(lat1,lon1,lat2,lon2):
    R=6371.0088
    p1,p2=math.radians(lat1),math.radians(lat2)
    dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.atan2(math.sqrt(a),math.sqrt(max(0,1-a)))

def coords_km(coords):
    if not isinstance(coords,list) or len(coords)<2:return 0.0
    out=0.0
    prev=None
    for p in coords:
        if not isinstance(p,(list,tuple)) or len(p)<2:continue
        a,b=float(p[0]),float(p[1])
        # sections.json MooRail live est en [lat,lon]. Filet de sécurité si inversé.
        if abs(a)>90 and abs(b)<=90: lat,lon=b,a
        else: lat,lon=a,b
        if prev: out+=hav_ll(prev[0],prev[1],lat,lon)
        prev=(lat,lon)
    return out

# Coordonnées de gares tirées du network.json.
stations={}
def put(name,lat,lon):
    try: lat=float(lat);lon=float(lon)
    except: return
    if not (-90<=lat<=90 and -180<=lon<=180):return
    stations.setdefault(norm(name),(str(name),lat,lon))

for t in net.get('tasks') or []:
    for k in ('from','to'):
        x=t.get(k) or {};put(x.get('name'),x.get('lat'),x.get('lon'))
for variants in (net.get('trainRoutes') or {}).values():
    for v in variants or []:
        for s in v.get('stops') or []:put(s.get('name'),s.get('lat'),s.get('lon'))

A='Lille Flandres'; B='Aéroport Charles de Gaulle 2 TGV'
ka,kb=norm(A),norm(B)
if ka not in stations or kb not in stations:
    raise SystemExit('ERREUR coordonnées cibles absentes du network.json')
_,alat,alon=stations[ka];_,blat,blon=stations[kb]
straight=hav_ll(alat,alon,blat,blon)
print(f'Distance à vol d’oiseau {A} → CDG : {straight:.1f} km')
print()

# Graphe LIVE orienté. Les reverse exportés sont déjà présents dans sections.json.
g=defaultdict(list)
for x in live.get('pairs') or []:
    a,b=norm(x.get('from')),norm(x.get('to'))
    if not a or not b:continue
    km=coords_km(x.get('coords') or [])
    if km<=0:
        sa, sb=stations.get(a),stations.get(b)
        if sa and sb: km=hav_ll(sa[1],sa[2],sb[1],sb[2])
    g[a].append((b,km,x))

# Top K chemins simples par coût, max 7 briques.
paths=[]
pq=[(0.0,ka,[ka],[])]
while pq and len(paths)<12:
    cost,u,nodes,edges=heapq.heappop(pq)
    if u==kb:
        paths.append((cost,nodes,edges));continue
    if len(edges)>=7:continue
    for v,w,e in g.get(u,[]):
        if v in nodes:continue
        heapq.heappush(pq,(cost+w,v,nodes+[v],edges+[e]))

print('=== CHAINES LIVE TROUVEES ===')
if not paths: print('Aucune chaîne LIVE.')

def name(k): return stations.get(k,(k,None,None))[0]
def dist_to_dest(k):
    s=stations.get(k)
    if not s:return None
    return hav_ll(s[1],s[2],blat,blon)

safe=[]
for i,(cost,nodes,edges) in enumerate(paths[:8],1):
    ratio=cost/straight if straight else 999
    back=0.0; unknown=False
    prev=dist_to_dest(nodes[0])
    for n in nodes[1:]:
        cur=dist_to_dest(n)
        if cur is None or prev is None: unknown=True
        else: back=max(back,cur-prev)
        prev=cur
    # Garde-fous target-specific : pas de grand retour arrière, pas de détour >35%.
    ok=(ratio<=1.35 and back<=15.0 and len(edges)<=6 and not unknown)
    tag='✅ SURE' if ok else '❌ REJETEE'
    print(f'CHAINE {i}: {tag} | {len(edges)} briques | {cost:.1f} km | ratio {ratio:.2f} | retour arrière max {back:.1f} km')
    print('  '+' → '.join(name(n) for n in nodes))
    for e in edges:
        print(f"    {e.get('from')} → {e.get('to')} | {e.get('sectionId')} | {coords_km(e.get('coords') or []):.1f} km")
    if ok:safe.append((cost,nodes,edges))
    print()

print('=== BRIQUES PHYSIQUES PERTINENTES DANS NETWORK V8 ===')
keys=['lille flandres','lille europe','tgv haute picardie','aeroport charles de gaulle 2 tgv']
for t in net.get('tasks') or []:
    a=(t.get('from') or {}).get('name','');b=(t.get('to') or {}).get('name','')
    na,nb=norm(a),norm(b)
    if any(k in na for k in keys) or any(k in nb for k in keys):
        if ('lille' in na or 'lille' in nb or 'haute picardie' in na or 'haute picardie' in nb or 'charles de gaulle' in na or 'charles de gaulle' in nb):
            print(f"{str(t.get('status') or '?'):12} | impact {int(t.get('impactToday') or 0):3d} | {a} → {b} | {t.get('sectionId')}")

print()
print('=== VERDICT ===')
if safe:
    best=safe[0]
    print('✅ Au moins une composition respecte les garde-fous géographiques.')
    print('   '+ ' → '.join(name(n) for n in best[1]))
else:
    print('❌ AUCUNE composition LIVE actuelle n’est sûre pour Lille Flandres → CDG.')
    print('Le chemin LIVE trouvé précédemment via Douai puis retour vers Lille Europe est un détour et doit être REJETÉ.')
    print('Ne pas activer de composition automatique aveugle.')
    print('Priorité : compléter/valider les briques physiques LGV Nord cohérentes autour de Lille / Haute-Picardie / CDG.')

# Contrôle explicite de la chaîne aberrante observée précédemment.
weird=[norm('Lille Flandres'),norm('Douai'),norm('Lille Europe'),kb]
for cost,nodes,edges in paths:
    if nodes==weird:
        ratio=cost/straight
        prev=dist_to_dest(nodes[0]);back=0
        for n in nodes[1:]:
            cur=dist_to_dest(n)
            if cur is not None and prev is not None:back=max(back,cur-prev)
            prev=cur
        print(f'CONTROLE chaîne Douai/Lille Europe : {cost:.1f} km, ratio {ratio:.2f}, retour arrière {back:.1f} km => REJETEE')
        break
PY
RC=$?

echo
echo "AUCUNE MODIFICATION EFFECTUEE."
exit "$RC"
