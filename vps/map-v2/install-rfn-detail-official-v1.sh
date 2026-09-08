#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
DATA_DIR="$PUBLIC/data/rfn-detail-official-v1"
LOADER="$PUBLIC/rfn-detail-official-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/rfn-detail-official-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-rfn-detail-v1.XXXXXX)"
SOURCE_URL="https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/fichier-de-formes-des-voies-du-reseau-ferre-national/exports/geojson"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [ "$SUCCESS" = "1" ]; then return; fi
  echo "ROLLBACK RFN DETAIL..." >&2
  for name in france-v3-preview.html moorail-route-editor.html; do
    if [ -f "$BACKUP/$name" ]; then cp -a "$BACKUP/$name" "$PUBLIC/$name" || true; fi
  done
  if [ -f "$BACKUP/rfn-detail-official-v1.js" ]; then cp -a "$BACKUP/rfn-detail-official-v1.js" "$LOADER" || true; else rm -f "$LOADER"; fi
  if [ -d "$BACKUP/rfn-detail-official-v1" ]; then rm -rf "$DATA_DIR"; cp -a "$BACKUP/rfn-detail-official-v1" "$DATA_DIR" || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

if [ "${EUID:-$(id -u)}" -ne 0 ]; then echo "ERREUR: lancer avec sudo/root" >&2; exit 2; fi
mkdir -p "$BACKUP"
for name in france-v3-preview.html moorail-route-editor.html; do
  [ ! -f "$PUBLIC/$name" ] || cp -a "$PUBLIC/$name" "$BACKUP/$name"
done
[ ! -f "$LOADER" ] || cp -a "$LOADER" "$BACKUP/rfn-detail-official-v1.js"
[ ! -d "$DATA_DIR" ] || cp -a "$DATA_DIR" "$BACKUP/rfn-detail-official-v1"

echo "============================================================"
echo " RFN DETAIL OFFICIEL SNCF RESEAU — V1"
echo " Dataset: fichier-de-formes-des-voies-du-reseau-ferre-national"
echo " Source : $SOURCE_URL"
echo "============================================================"
echo "Backup : $BACKUP"

echo "=== 1/5 Téléchargement du GeoJSON officiel ==="
curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 300 \
  "$SOURCE_URL" -o "$TMP/rfn.geojson"

python3 - "$TMP/rfn.geojson" <<'PY'
import json,sys,os
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
assert d.get('type')=='FeatureCollection', d.get('type')
n=len(d.get('features') or [])
print('features=',n,'taille=',round(os.path.getsize(p)/1024/1024,1),'Mo')
if not (9000 <= n <= 12000):
    raise SystemExit(f'ERREUR: nombre de features inattendu: {n}')
PY

echo "=== 2/5 Découpage spatial statique (pas de surcharge nationale) ==="
rm -rf "$TMP/out"
mkdir -p "$TMP/out/cells"
python3 - "$TMP/rfn.geojson" "$TMP/out" <<'PY'
import json,sys,math,os,datetime
from pathlib import Path
src=Path(sys.argv[1]); out=Path(sys.argv[2]); cells=out/'cells'
CELL=0.20
raw=json.load(open(src,encoding='utf-8'))
features=raw.get('features') or []

def iter_lines(g):
    if not g:return
    t=g.get('type'); c=g.get('coordinates') or []
    if t=='LineString': yield c
    elif t=='MultiLineString':
        for x in c: yield x

def key_for(a,b):
    lon=(float(a[0])+float(b[0]))/2; lat=(float(a[1])+float(b[1]))/2
    return (math.floor(lon/CELL),math.floor(lat/CELL))

def small_props(p):
    out={}
    for k,v in (p or {}).items():
        lk=k.lower()
        if any(x in lk for x in ('ligne','voie','type','code','rang','id','pk','lib','nom')):
            if isinstance(v,(str,int,float,bool)) or v is None: out[k]=v
    return out

bucket={}
segments=0
for f in features:
    props=small_props(f.get('properties') or {})
    for line in iter_lines(f.get('geometry')):
        if not line or len(line)<2: continue
        cur_key=None; run=[]
        for i in range(len(line)-1):
            a=line[i]; b=line[i+1]
            if len(a)<2 or len(b)<2: continue
            try:k=key_for(a,b)
            except Exception:continue
            if cur_key is None:
                cur_key=k; run=[a,b]
            elif k==cur_key:
                if run[-1]!=a: run.append(a)
                run.append(b)
            else:
                if len(run)>=2:
                    bucket.setdefault(cur_key,[]).append({'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':run}}); segments+=1
                cur_key=k; run=[a,b]
        if cur_key is not None and len(run)>=2:
            bucket.setdefault(cur_key,[]).append({'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':run}}); segments+=1

for (ix,iy),fs in bucket.items():
    p=cells/f'c_{ix}_{iy}.geojson'
    with open(p,'w',encoding='utf-8') as h:
        json.dump({'type':'FeatureCollection','features':fs},h,ensure_ascii=False,separators=(',',':'))
manifest={
  'version':1,
  'dataset':'fichier-de-formes-des-voies-du-reseau-ferre-national',
  'source':'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/fichier-de-formes-des-voies-du-reseau-ferre-national/exports/geojson',
  'cellSize':CELL,
  'minZoom':10,
  'features':len(features),
  'runs':segments,
  'cells':len(bucket),
  'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
json.dump(manifest,open(out/'manifest.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
PY

echo "=== 3/5 Installation des cellules + loader Leaflet ==="
rm -rf "$DATA_DIR"
mkdir -p "$(dirname "$DATA_DIR")"
cp -a "$TMP/out" "$DATA_DIR"

cat > "$LOADER" <<'JS'
(function(){
  if(window.LB_RFN_DETAIL_OFFICIAL_V1)return;
  const BASE='/map-v2/data/rfn-detail-official-v1';
  const state={map:null,enabled:false,manifest:null,layers:new Map(),control:null,renderer:null,busy:new Map()};
  function id(ix,iy){return `${ix}:${iy}`}
  function path(ix,iy){return `${BASE}/cells/c_${ix}_${iy}.geojson`}
  function style(){const z=state.map?.getZoom?.()||10;return {color:'#72dcff',weight:z>=14?2.0:z>=12?1.45:1.0,opacity:z>=13?.82:.58,interactive:false};}
  function wanted(){
    if(!state.enabled||!state.manifest||!state.map||state.map.getZoom()<state.manifest.minZoom)return new Map();
    const c=state.manifest.cellSize,b=state.map.getBounds().pad(.10),x0=Math.floor(b.getWest()/c)-1,x1=Math.floor(b.getEast()/c)+1,y0=Math.floor(b.getSouth()/c)-1,y1=Math.floor(b.getNorth()/c)+1,m=new Map();
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)m.set(id(x,y),[x,y]);return m;
  }
  function clear(){for(const l of state.layers.values())state.map.removeLayer(l);state.layers.clear();}
  async function loadCell(k,x,y){
    if(state.layers.has(k)||state.busy.has(k))return;const ctl=new AbortController();state.busy.set(k,ctl);
    try{const r=await fetch(path(x,y),{cache:'force-cache',signal:ctl.signal});if(!r.ok){if(r.status!==404)console.warn('[RFN detail]',r.status,path(x,y));return;}const g=await r.json();if(!state.enabled)return;const layer=L.geoJSON(g,{renderer:state.renderer,style});layer.addTo(state.map);state.layers.set(k,layer);}catch(e){if(e.name!=='AbortError')console.warn('[RFN detail]',e);}finally{state.busy.delete(k);}
  }
  function update(){
    if(!state.map||!state.manifest)return;
    const w=wanted();
    if(!state.enabled||state.map.getZoom()<state.manifest.minZoom){clear();return;}
    for(const [k,l] of [...state.layers.entries()])if(!w.has(k)){state.map.removeLayer(l);state.layers.delete(k)}
    for(const [k,[x,y]] of w.entries())loadCell(k,x,y);
  }
  function setEnabled(v){state.enabled=!!v;if(state.control){const b=state.control.getContainer().querySelector('button');if(b){b.classList.toggle('on',state.enabled);b.title=state.enabled?'Masquer le RFN détaillé':'Afficher le RFN détaillé';}}update();}
  async function install(map,opts={}){
    if(!map||!window.L||state.map)return;state.map=map;state.renderer=L.canvas({padding:.5});
    try{state.manifest=await fetch(`${BASE}/manifest.json?v=1`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`manifest ${r.status}`);return r.json()});}catch(e){console.error('[RFN detail] manifest',e);return;}
    const C=L.Control.extend({options:{position:opts.position||'bottomright'},onAdd(){const d=L.DomUtil.create('div','leaflet-bar lb-rfn-detail-control');const b=L.DomUtil.create('button','',d);b.type='button';b.innerHTML='RFN+';b.title='Afficher le RFN détaillé SNCF Réseau';b.style.cssText='width:44px;height:30px;border:0;background:#071722;color:#78e8ff;font:800 11px system-ui;cursor:pointer';L.DomEvent.disableClickPropagation(d);L.DomEvent.on(b,'click',e=>{L.DomEvent.stop(e);setEnabled(!state.enabled)});return d;}});state.control=new C().addTo(map);
    const css=document.createElement('style');css.textContent='.lb-rfn-detail-control button.on{background:#0f5565!important;color:#fff!important;box-shadow:inset 0 0 0 1px #7df5ff}.lb-rfn-detail-control{background:#071722!important}';document.head.appendChild(css);
    map.on('moveend zoomend',update);
    setEnabled(opts.autoEnable===true || /moorail-route-editor/.test(location.pathname));
    window.dispatchEvent(new CustomEvent('lb:rfn-detail-ready',{detail:{manifest:state.manifest}}));
  }
  window.LB_RFN_DETAIL_OFFICIAL_V1={install,setEnabled,get enabled(){return state.enabled},get manifest(){return state.manifest},getLoadedLayers(){return [...state.layers.values()]}};
})();
JS

python3 - "$PUBLIC" <<'PY'
from pathlib import Path
import sys
public=Path(sys.argv[1])
marker='<!-- LB_RFN_DETAIL_OFFICIAL_V1 -->'
block='''\n<!-- LB_RFN_DETAIL_OFFICIAL_V1 -->\n<script src="/map-v2/rfn-detail-official-v1.js?v=1"></script>\n<script>\n(function bootLbRfnDetail(){\n  try{\n    if(window.LB_RFN_DETAIL_OFFICIAL_V1 && typeof map !== 'undefined' && map && typeof map.getBounds === 'function'){\n      window.LB_RFN_DETAIL_OFFICIAL_V1.install(map,{autoEnable:/moorail-route-editor/.test(location.pathname)});\n      return;\n    }\n  }catch(e){}\n  setTimeout(bootLbRfnDetail,250);\n})();\n</script>\n'''
for name in ('france-v3-preview.html','moorail-route-editor.html'):
    p=public/name
    if not p.exists():
        print('absent:',name); continue
    s=p.read_text(encoding='utf-8')
    if marker in s:
        print('déjà injecté:',name); continue
    if '</body>' not in s.lower(): raise SystemExit(f'ERREUR </body> absent dans {name}')
    pos=s.lower().rfind('</body>')
    s=s[:pos]+block+s[pos:]
    p.write_text(s,encoding='utf-8')
    print('injecté:',name)
PY

chmod -R a+rX "$DATA_DIR"
chmod 0644 "$LOADER"
for name in france-v3-preview.html moorail-route-editor.html; do [ ! -f "$PUBLIC/$name" ] || chmod 0644 "$PUBLIC/$name"; done

echo "=== 4/5 Contrôles statiques ==="
python3 - "$DATA_DIR/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
assert 9000 <= m['features'] <= 12000,m
assert m['cells']>100,m
assert m['cellSize']==0.2,m
print('manifest OK:',m)
PY
node --check "$LOADER"

echo "=== 5/5 Contrôle par le serveur Map V2 ==="
curl -fsS --max-time 5 "http://127.0.0.1:3111/data/rfn-detail-official-v1/manifest.json?v=$STAMP" -o "$TMP/served-manifest.json"
python3 - "$TMP/served-manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
assert m.get('dataset')=='fichier-de-formes-des-voies-du-reseau-ferre-national',m
print('servi OK:',m['features'],'features /',m['cells'],'cellules')
PY
for name in france-v3-preview.html moorail-route-editor.html; do
  [ ! -f "$PUBLIC/$name" ] || curl -fsS --max-time 5 "http://127.0.0.1:3111/$name?v=$STAMP" | grep -q 'LB_RFN_DETAIL_OFFICIAL_V1'
done

cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
for name in france-v3-preview.html moorail-route-editor.html; do
  if [ -f '$BACKUP/'\"\$name\" ]; then cp -a '$BACKUP/'\"\$name\" '$PUBLIC/'\"\$name\"; fi
done
if [ -f '$BACKUP/rfn-detail-official-v1.js' ]; then cp -a '$BACKUP/rfn-detail-official-v1.js' '$LOADER'; else rm -f '$LOADER'; fi
if [ -d '$BACKUP/rfn-detail-official-v1' ]; then rm -rf '$DATA_DIR'; cp -a '$BACKUP/rfn-detail-official-v1' '$DATA_DIR'; else rm -rf '$DATA_DIR'; fi
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"
SUCCESS=1

echo
echo "============================================================"
echo " RFN DETAIL OFFICIEL INSTALLE"
echo "============================================================"
echo "Dataset exact : fichier-de-formes-des-voies-du-reseau-ferre-national"
echo "France V3     : https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Route Editor  : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Bouton        : RFN+ (en bas à droite)"
echo "Chargement    : uniquement à partir du zoom 10, cellules visibles seulement"
echo "Editor        : couche activée automatiquement"
echo "Backup        : $BACKUP"
echo "Rollback      : sudo bash $BACKUP/ROLLBACK.sh"
