#!/usr/bin/env python3
"""MooRail Global HGV Router V7.

Generic rail graph used by the national preview:
- operated French RFN only;
- real LGV features only (catlig == Ligne à grande vitesse);
- validated/editor sections, including cross-border sections;
- conservative station multi-snap;
- one explicit provisional infrastructure bridge for the missing RFN source
  of raccordement 768300 Pasilly -> Aisy-sur-Armancon.

The provisional bridge is a topology aid, not a claim of exact track geometry.
"""
from __future__ import annotations
import json, math, heapq, os, unicodedata
from pathlib import Path
from collections import defaultdict, Counter

MAPROOT = Path(os.environ.get("MOORAIL_MAPROOT", "/opt/labetaillere-map-v2-src/map-v2"))
SOURCES = MAPROOT / "data/sources"
BASE_GEO = SOURCES / "lignes-par-statut.geojson"
LGV_GEO = SOURCES / "lignes-lgv.geojson"
EDITOR = MAPROOT / "public/data/moorail-live-v1/sections.json"
CODE = MAPROOT / "public/data/moorail-code-v1/sections.json"

NODE_ROUND = 6
STITCH_MAX_M = 35.0
STATION_SNAP_MAX_M = 1400.0
STATION_CANDIDATE_M = 220.0
LGV_SPEED_KMH = 320.0
VALIDATED_SPEED_KMH = 160.0
RFN_SPEED_KMH = 120.0
STITCH_SPEED_KMH = 35.0
PROVISIONAL_SPEED_KMH = 200.0

# The source currently omits RFN 768300 although it is the normal TGV access
# between LGV Sud-Est and the PLM line for Dijon/BFC/Switzerland.
# Hints are town locations only; endpoints are projected to the nearest
# real LGV/RFN edges at build time, so source coordinate updates stay usable.
PROVISIONAL_CONNECTORS = [
    {
        "id": "rfn-768300-pasilly-aisy-provisional",
        "a_hint": (4.07813, 47.69767),
        "a_kind": "lgv",
        "b_hint": (4.22534, 47.66782),
        "b_kind": "rfn",
        "max_snap_m": 2200.0,
    }
]


def norm(v):
    s=unicodedata.normalize("NFKD",str(v or ""))
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.upper().split())

def hav(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    dlon=lon2-lon1;dlat=lat2-lat1
    h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*6371000*math.asin(math.sqrt(h))

def plen(c): return sum(hav(a,b) for a,b in zip(c,c[1:]))
def qpoint(p): return (round(float(p[0]),NODE_ROUND),round(float(p[1]),NODE_ROUND))
def valid_lonlat(p):
    return isinstance(p,(list,tuple)) and len(p)>=2 and -180<=float(p[0])<=180 and -90<=float(p[1])<=90

def flatten_lines(geom):
    if not isinstance(geom,dict): return
    typ=geom.get("type"); c=geom.get("coordinates") or []
    if typ=="LineString":
        pts=[qpoint(x) for x in c if valid_lonlat(x)]
        if len(pts)>=2: yield pts
    elif typ=="MultiLineString":
        for line in c:
            pts=[qpoint(x) for x in line if valid_lonlat(x)]
            if len(pts)>=2: yield pts
    elif typ=="GeometryCollection":
        for g in geom.get("geometries") or []: yield from flatten_lines(g)

def load_geo_lines(path):
    d=json.loads(Path(path).read_text(encoding="utf-8"));out=[];name=Path(path).name
    for f in d.get("features") or []:
        p=f.get("properties") or {}
        if name=="lignes-lgv.geojson" and norm(p.get("catlig"))!="LIGNE A GRANDE VITESSE": continue
        if name=="lignes-par-statut.geojson" and norm(p.get("statut"))!="EXPLOITEE": continue
        out.extend(flatten_lines(f.get("geometry") or {}))
    return out

def load_validated():
    safe=[];seen=set()
    for source,path in (("code",CODE),("editor",EDITOR)):
        if not path.exists(): continue
        d=json.loads(path.read_text(encoding="utf-8"))
        for x in d.get("pairs") or []:
            sid=x.get("sectionId")
            if not sid or sid in seen: continue
            seen.add(sid)
            raw=x.get("coords") or [];coords=[]
            for p in raw:
                if not isinstance(p,(list,tuple)) or len(p)<2: continue
                try: lat=float(p[0]);lon=float(p[1])
                except Exception: continue
                if -90<=lat<=90 and -180<=lon<=180: coords.append(qpoint((lon,lat)))
            if len(coords)<2: continue
            length=plen(coords); geo=hav(coords[0],coords[-1]);ratio=length/geo if geo>100 else 1
            if length<30 or length>1_500_000 or (geo>5000 and ratio>2.6): continue
            safe.append({"sectionId":sid,"source":source,"from":x.get("from"),"to":x.get("to"),"coords":coords,"length_m":length})
    return safe

def local_xy(p,ref):
    lat0=math.radians(ref[1]);return ((p[0]-ref[0])*111320*math.cos(lat0),(p[1]-ref[1])*110540)
def nearest_on_segment(p,a,b):
    ax,ay=local_xy(a,p);bx,by=local_xy(b,p);vx=bx-ax;vy=by-ay;den=vx*vx+vy*vy
    if den<=1e-12:return math.hypot(ax,ay),0.0,a
    t=max(0,min(1,-((ax*vx)+(ay*vy))/den));q=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
    qx,qy=local_xy(q,p);return math.hypot(qx,qy),t,q

class Graph:
    def __init__(self):
        self.node_id={};self.coords=[];self.adj=defaultdict(list);self.edges=[];self.endpoints=[]
    def node(self,p):
        p=qpoint(p);n=self.node_id.get(p)
        if n is None:
            n=len(self.coords);self.node_id[p]=n;self.coords.append(p)
        return n
    def add_edge(self,a,b,kind,dist=None,meta=None):
        if a==b:return
        if dist is None:dist=hav(self.coords[a],self.coords[b])
        if dist<=0 or dist>30000:return
        self.adj[a].append((b,dist,kind,meta));self.adj[b].append((a,dist,kind,meta));self.edges.append((a,b,dist,kind,meta))

def add_lines(g,lines,kind,meta_prefix=None):
    start=len(g.edges)
    for i,line in enumerate(lines):
        ids=[g.node(p) for p in line];g.endpoints.extend((ids[0],ids[-1]));meta=(meta_prefix,i) if meta_prefix else None
        for a,b in zip(ids,ids[1:]):g.add_edge(a,b,kind,meta=meta)
    return len(g.edges)-start

def add_validated(g,sections):
    start=len(g.edges)
    for x in sections:
        ids=[g.node(p) for p in x["coords"]];g.endpoints.extend((ids[0],ids[-1]))
        for a,b in zip(ids,ids[1:]):g.add_edge(a,b,"validated",meta=x["sectionId"])
    return len(g.edges)-start

def node_bins(g,cell=0.0005):
    bins=defaultdict(list)
    for i,p in enumerate(g.coords):bins[(int(p[0]/cell),int(p[1]/cell))].append(i)
    return bins,cell

def stitch(g,bins,cell):
    count=0;seen=set()
    for e in g.endpoints:
        p=g.coords[e];kx=int(p[0]/cell);ky=int(p[1]/cell);best=None
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for j in bins.get((kx+dx,ky+dy),()):
                    if j==e:continue
                    d=hav(p,g.coords[j])
                    if d<=STITCH_MAX_M and (best is None or d<best[0]):best=(d,j)
        if best:
            d,j=best;key=tuple(sorted((e,j)))
            if key not in seen:seen.add(key);g.add_edge(e,j,"stitch",dist=d);count+=1
    return count

def edge_bins(g,cell=0.01):
    bins=defaultdict(list)
    for ei,(a,b,dist,kind,meta) in enumerate(g.edges):
        pa=g.coords[a];pb=g.coords[b];xmin=min(pa[0],pb[0]);xmax=max(pa[0],pb[0]);ymin=min(pa[1],pb[1]);ymax=max(pa[1],pb[1])
        ix0=int(xmin/cell);ix1=int(xmax/cell);iy0=int(ymin/cell);iy1=int(ymax/cell)
        if ix1-ix0>20 or iy1-iy0>20:
            bins[(int(((xmin+xmax)/2)/cell),int(((ymin+ymax)/2)/cell))].append(ei);continue
        for ix in range(ix0,ix1+1):
            for iy in range(iy0,iy1+1):bins[(ix,iy)].append(ei)
    return bins,cell

def nearest_edges(g,bins,cell,p,max_m=STATION_CANDIDATE_M,kinds=None,limit=12):
    kx=int(p[0]/cell);ky=int(p[1]/cell);seen=set();rows=[];rings=max(2,int(math.ceil(max_m/700))+3)
    for ring in range(rings+1):
        for dx in range(-ring,ring+1):
            for dy in range(-ring,ring+1):
                if ring and abs(dx)!=ring and abs(dy)!=ring:continue
                for ei in bins.get((kx+dx,ky+dy),()):
                    if ei in seen:continue
                    seen.add(ei);a,b,dist,kind,meta=g.edges[ei]
                    if kinds and kind not in kinds:continue
                    d,t,q=nearest_on_segment(p,g.coords[a],g.coords[b])
                    if d<=max_m:rows.append((d,ei,t,q))
    rows.sort(key=lambda x:x[0]);return rows[:limit]

def nearest_edge(g,bins,cell,p,max_m,kinds=None):
    x=nearest_edges(g,bins,cell,p,max_m,kinds=kinds,limit=1);return x[0] if x else None

def permanent_projection(g,snap):
    dperp,ei,t,q=snap;a,b,dist,kind,meta=g.edges[ei];n=g.node(q)
    da=dist*t;db=dist*(1-t)
    g.add_edge(n,a,kind,dist=da if da>0.01 else 0.01,meta=meta);g.add_edge(n,b,kind,dist=db if db>0.01 else 0.01,meta=meta)
    return n

def add_provisional_connectors(g):
    # Build bins before each connector because permanent projection adds nodes/edges.
    added=[]
    for c in PROVISIONAL_CONNECTORS:
        bins,cell=edge_bins(g)
        sa=nearest_edge(g,bins,cell,c["a_hint"],c["max_snap_m"],kinds={c["a_kind"]})
        sb=nearest_edge(g,bins,cell,c["b_hint"],c["max_snap_m"],kinds={c["b_kind"]})
        if not sa or not sb:continue
        na=permanent_projection(g,sa);nb=permanent_projection(g,sb)
        d=hav(g.coords[na],g.coords[nb]);g.add_edge(na,nb,"provisional",dist=d,meta=c["id"])
        added.append({"id":c["id"],"a":g.coords[na],"b":g.coords[nb],"length_m":d,"snap_a_m":sa[0],"snap_b_m":sb[0]})
    return added

def speed(kind):
    if kind=="lgv":return LGV_SPEED_KMH/3.6
    if kind=="validated":return VALIDATED_SPEED_KMH/3.6
    if kind=="provisional":return PROVISIONAL_SPEED_KMH/3.6
    if kind=="stitch":return STITCH_SPEED_KMH/3.6
    return RFN_SPEED_KMH/3.6

def attach_temp(g,snap):
    dperp,ei,t,q=snap;a,b,dist,kind,meta=g.edges[ei];n=len(g.coords);g.coords.append(q);g.adj[n]=[];da=dist*t;db=dist*(1-t)
    g.adj[n].append((a,da,kind,meta));g.adj[a].append((n,da,kind,meta));g.adj[n].append((b,db,kind,meta));g.adj[b].append((n,db,kind,meta));return n,(a,b)
def detach_temp(g,n,neigh):
    for x in neigh:g.adj[x]=[e for e in g.adj[x] if e[0]!=n]
    g.adj.pop(n,None)

def astar(g,start,goal,distance_mode=False):
    gp=g.coords[goal];vmax=LGV_SPEED_KMH/3.6
    def h(n):return hav(g.coords[n],gp)/(1.0 if distance_mode else vmax)
    pq=[(h(start),0.0,start)];best={start:0.0};prev={}
    while pq:
        f,c,n=heapq.heappop(pq)
        if c!=best.get(n):continue
        if n==goal:break
        for nb,dist,kind,meta in g.adj.get(n,()):
            ecost=dist if distance_mode else dist/speed(kind)
            if kind=="stitch":ecost+=(50.0 if distance_mode else 6.0)
            nc=c+ecost
            if nc<best.get(nb,float("inf")):
                best[nb]=nc;prev[nb]=(n,dist,kind,meta);heapq.heappush(pq,(nc+h(nb),nc,nb))
    if goal not in best:return None
    nodes=[goal];n=goal
    while n!=start:n=prev[n][0];nodes.append(n)
    nodes.reverse();meters=Counter();section_m=Counter();total=0.0
    for b in nodes[1:]:
        _,dist,kind,meta=prev[b];total+=dist;meters[kind]+=dist
        if meta:section_m[str(meta)]+=dist
    return {"nodes":nodes,"length_m":total,"meters":meters,"section_m":section_m}

def station_candidates(g,bins,cell,p,max_m=STATION_CANDIDATE_M):
    rows=nearest_edges(g,bins,cell,p,max_m,limit=24);groups=defaultdict(list)
    for x in rows:groups[g.edges[x[1]][3]].append(x)
    out=[]
    for kind,x in groups.items():out.extend(x[:4])
    return sorted(out,key=lambda z:z[0])[:16]

def route_coords(g,bins,cell,pa,pb,distance_mode=False):
    sa=station_candidates(g,bins,cell,pa);sb=station_candidates(g,bins,cell,pb)
    if not sa or not sb:return None
    base=len(g.coords);temp=[];roots=[];attached=[]
    try:
        for p,snaps in ((pa,sa),(pb,sb)):
            root=len(g.coords);g.coords.append(p);g.adj[root]=[];roots.append(root);grp=[]
            for snap in snaps:
                n,neigh=attach_temp(g,snap);temp.append((n,neigh));grp.append((snap,n));d=hav(p,snap[3]);g.adj[root].append((n,d,"stitch",None));g.adj[n].append((root,d,"stitch",None))
            attached.append(grp)
        for a,na in attached[0]:
            for b,nb in attached[1]:
                if a[1]==b[1]:
                    _,_,length,kind,meta=g.edges[a[1]];d=length*abs(a[2]-b[2]);g.adj[na].append((nb,d,kind,meta));g.adj[nb].append((na,d,kind,meta))
        r=astar(g,*roots,distance_mode=distance_mode)
        if r:r["coords"]=[g.coords[n] for n in r["nodes"]];r["snap_a_m"]=sa[0][0];r["snap_b_m"]=sb[0][0]
        return r
    finally:
        for n,neigh in reversed(temp):detach_temp(g,n,neigh)
        for n in roots:g.adj.pop(n,None)
        del g.coords[base:]

def build_graph():
    g=Graph();add_lines(g,load_geo_lines(BASE_GEO),"rfn","RFN");add_lines(g,load_geo_lines(LGV_GEO),"lgv","LGV");add_validated(g,load_validated())
    nb,nc=node_bins(g);stitches=stitch(g,nb,nc);provisional=add_provisional_connectors(g);eb,ec=edge_bins(g)
    return g,eb,ec,{"nodes":len(g.coords),"edges":len(g.edges),"stitches":stitches,"provisional":provisional}
