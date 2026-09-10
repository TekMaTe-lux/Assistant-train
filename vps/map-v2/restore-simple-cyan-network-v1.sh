#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
ASSET="$PUBLIC/assets/lb-simple-cyan-network-v1.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/restore-simple-cyan-network-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-simple-cyan-v1-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup; return 0; fi
  echo >&2
  echo "ERREUR — rollback automatique..." >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE" || true
  [[ -f "$BACKUP/carte-preview.html" ]] && cp -a "$BACKUP/carte-preview.html" "$WRAPPER" || true
  if [[ -f "$BACKUP/lb-simple-cyan-network-v1.js" ]]; then
    cp -a "$BACKUP/lb-simple-cyan-network-v1.js" "$ASSET"
  elif [[ -f "$BACKUP/asset.absent" ]]; then
    rm -f "$ASSET"
  fi
  cleanup
  echo "Rollback terminé. Aucun dataset n'a été modifié." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$CORE" "$WRAPPER"; do [[ -f "$f" ]] || { echo "ERREUR: absent: $f" >&2; exit 3; }; done
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 4; }
command -v node >/dev/null || { echo "ERREUR: node absent" >&2; exit 4; }

for token in \
  'LB_SERVICE_DAY_ROLLOVER_V1' \
  'LB_MOORAIL_LIVE_PATH_V44' \
  'LB_MOORAIL_SELECTED_ROUTE_V52' \
  'api/map-v2/infrastructure'; do
  grep -qF "$token" "$CORE" || { echo "ERREUR: socle inattendu, manque: $token" >&2; exit 5; }
done
if grep -qF 'LB_MAP_STARTUP_SAFE_V1' "$CORE"; then
  echo "ERREUR: STARTUP_SAFE est revenu ; arrêt sans modification." >&2
  exit 5
fi

curl -fsS --max-time 15 \
  'http://127.0.0.1:3111/api/map-v2/infrastructure?bbox=5.70,48.45,6.35,49.65' \
  -o "$TMP/infra.json"
python3 - "$TMP/infra.json" <<'PY'
import json,os,sys
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
fs=d.get('features') or []
assert d.get('type')=='FeatureCollection',d.get('type')
assert len(fs)>50,len(fs)
print(f"Réseau simple FR+CFL : {len(fs)} tronçons / {os.path.getsize(p)/1048576:.3f} Mo")
PY

mkdir -p "$BACKUP" "$PUBLIC/assets"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"
if [[ -f "$ASSET" ]]; then cp -a "$ASSET" "$BACKUP/lb-simple-cyan-network-v1.js"; else touch "$BACKUP/asset.absent"; fi

cat > "$TMP/lb-simple-cyan-network-v1.js" <<'JS'
(()=>{
  'use strict';
  const MARK='LB_SIMPLE_CYAN_NETWORK_V1';
  if(window.__lbSimpleCyanNetworkV1)return;
  window.__lbSimpleCyanNetworkV1=true;

  let tries=0;
  function boot(){
    const map=window.__LB_MAP_INSTANCE;
    if(!window.L || !map || typeof map.getBounds!=='function'){
      if(++tries<80)setTimeout(boot,50);
      return;
    }

    let pane=map.getPane('lb-simple-rail');
    if(!pane){
      pane=map.createPane('lb-simple-rail');
      pane.style.zIndex='240';
      pane.style.pointerEvents='none';
    }

    const renderer=L.canvas({pane:'lb-simple-rail',padding:.30});
    const layer=L.geoJSON(null,{
      pane:'lb-simple-rail',
      renderer,
      interactive:false,
      style(feature){
        const p=feature?.properties||{};
        const kind=String(p.kind||'classic').toLowerCase();
        if(kind==='closed'){
          return {color:'#78909c',weight:1.0,opacity:.24,dashArray:'4 5'};
        }
        return {color:'#00dff2',weight:1.65,opacity:.72};
      }
    }).addTo(map);

    const cache=new Map();
    let abort=null, serial=0, timer=null;

    function bbox(){
      const b=map.getBounds();
      return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(5)).join(',');
    }
    function key(){
      const b=map.getBounds(),z=Math.max(6,Math.min(12,map.getZoom()));
      return `${z}|${[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(2)).join(',')}`;
    }
    async function refresh(){
      if(map.getZoom()<6){layer.clearLayers();return;}
      const k=key();
      const cached=cache.get(k);
      if(cached){
        layer.clearLayers().addData(cached);
        return;
      }
      const mine=++serial;
      if(abort)abort.abort();
      abort=new AbortController();
      try{
        const r=await fetch(`/api/map-v2/infrastructure?bbox=${bbox()}`,{
          signal:abort.signal,
          headers:{Accept:'application/json'},
          cache:'default'
        });
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        const data=await r.json();
        if(mine!==serial)return;
        cache.set(k,data);
        if(cache.size>6)cache.delete(cache.keys().next().value);
        layer.clearLayers().addData(data);
        console.info(`[${MARK}] réseau affiché`,(data?.features||[]).length,'tronçons');
      }catch(e){
        if(e?.name!=='AbortError')console.warn(`[${MARK}] infrastructure`,e);
      }
    }
    function schedule(ms){clearTimeout(timer);timer=setTimeout(refresh,ms);}

    map.on('moveend',()=>schedule(320));
    map.on('zoomend',()=>schedule(120));
    setTimeout(refresh,30);
    window.__LB_SIMPLE_CYAN_LAYER=layer;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
JS
node --check "$TMP/lb-simple-cyan-network-v1.js"

cp -a "$CORE" "$TMP/core.html"
python3 - "$TMP/core.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='LB_SIMPLE_CYAN_NETWORK_V1'

if marker in s:
    print('Réseau cyan déjà injecté dans le core.')
    p.write_text(s,encoding='utf-8')
    raise SystemExit(0)

m=re.search(r'((?:const|let|var)\s+map\s*=\s*L\.map\([\s\S]*?\);)',s)
if not m:
    raise SystemExit('ERREUR: déclaration Leaflet map introuvable')
s=s[:m.end()]+"\n  window.__LB_MAP_INSTANCE = map; /* LB_SIMPLE_CYAN_NETWORK_V1 */"+s[m.end():]

needle='      await lbLoadMoorailOverrides();'
n=s.count(needle)
if n==1:
    s=s.replace(needle,"      /* LB_SIMPLE_CYAN_NETWORK_V1: production = réseau simple, pas de préchargement MooRail global */",1)
elif n>1:
    raise SystemExit(f'ERREUR: {n} appels startup MooRail trouvés, refus de deviner')
else:
    print('INFO: aucun await lbLoadMoorailOverrides() à retirer (déjà absent).')

tag='<script defer id="lb-simple-cyan-network-v1" src="./assets/lb-simple-cyan-network-v1.js?v=20260910-1"></script>'
if '</body>' not in s:
    raise SystemExit('ERREUR: </body> introuvable')
s=s.replace('</body>',tag+'\n</body>',1)

for req in [
    'LB_SERVICE_DAY_ROLLOVER_V1',
    'LB_MOORAIL_LIVE_PATH_V44',
    'LB_MOORAIL_SELECTED_ROUTE_V52',
    'api/map-v2/infrastructure',
    'lb-community-traveler-v1',
    'lb-community-traveler-compact-v2',
    'LB_SIMPLE_CYAN_NETWORK_V1'
]:
    if req not in s:
        raise SystemExit('ERREUR: élément requis perdu: '+req)

p.write_text(s,encoding='utf-8')
PY

python3 - "$TMP/core.html" "$TMP" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import subprocess,sys
class P(HTMLParser):
    def __init__(self): super().__init__(); self.on=False; self.cur=[]; self.parts=[]
    def handle_starttag(self,t,a):
        if t=='script':
            d=dict(a); self.on='src' not in d and d.get('type','') not in ('application/json','application/ld+json'); self.cur=[]
    def handle_data(self,d):
        if self.on:self.cur.append(d)
    def handle_endtag(self,t):
        if t=='script' and self.on:
            self.parts.append(''.join(self.cur));self.on=False
q=P();q.feed(Path(sys.argv[1]).read_text(encoding='utf-8'))
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js';f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode: raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript inline : OK —',len(q.parts),'bloc(s)')
PY

install -o root -g root -m 0644 "$TMP/lb-simple-cyan-network-v1.js" "$ASSET"
install -o root -g root -m 0644 "$TMP/core.html" "$CORE"

python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
pat=r'(carte-core-preview\.html\?[^"\']*?\bv=)[^"\'& ]+'
s2,n=re.subn(pat,r'\g<1>20260910-simple-cyan-v1',s,count=1)
if not n:
    pat2=r'(carte-core-preview\.html\?[^"\']+)(["\'])'
    s2,n=re.subn(pat2,r'\1&v=20260910-simple-cyan-v1\2',s,count=1)
if not n: raise SystemExit('ERREUR: iframe carte-core-preview introuvable')
p.write_text(s2,encoding='utf-8')
PY

curl -fsS --max-time 10 "http://127.0.0.1:3111/carte-core-preview.html?v=$STAMP" -o "$TMP/served.html"
grep -qF 'LB_SIMPLE_CYAN_NETWORK_V1' "$TMP/served.html"
grep -qF 'lb-simple-cyan-network-v1.js' "$TMP/served.html"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " OK — RESEAU SIMPLE FRANCE + CFL REMIS SUR #CARTE"
echo "============================================================"
echo "Réseau cyan simple          : OUI"
echo "Source                      : /api/map-v2/infrastructure?bbox=..."
echo "Chargement initial Sillon   : ~1.3 Mo"
echo "MooRail sections ~67 Mo     : PLUS ATTENDU AU DEMARRAGE"
echo "Core/UI                     : CONSERVES"
echo "Rollover                    : CONSERVE"
echo "Communauté / pouces         : CONSERVES"
echo "France V3                   : NON TOUCHEE"
echo "Datasets / paths            : NON TOUCHES"
echo "Service                     : NON REDEMARRÉ"
echo "Backup rollback             : $BACKUP"
echo "============================================================"
