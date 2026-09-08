#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
TARGET="$PUBLIC/moorail-route-editor.html"
V2PAGE="$PUBLIC/moorail-tgv-game-v2.html"
JS="$PUBLIC/moorail-tgv-game-v2.js"
RFN_DIR="$PUBLIC/data/moorail-rfn-game-v2"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/tgv-game-v2_1-$STAMP"
TMP="$(mktemp -d /tmp/moorail-tgv-game-v21.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/v2"
OFFICIAL="https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/fichier-de-formes-des-voies-du-reseau-ferre-national/exports/geojson"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [ "$SUCCESS" = 1 ]; then return; fi
  echo "ROLLBACK TGV GAME V2.1..." >&2
  [ ! -f "$BACKUP/moorail-route-editor.html" ] || cp -a "$BACKUP/moorail-route-editor.html" "$TARGET"
  [ ! -f "$BACKUP/moorail-tgv-game-v2.html" ] || cp -a "$BACKUP/moorail-tgv-game-v2.html" "$V2PAGE"
  [ ! -f "$BACKUP/moorail-tgv-game-v2.js" ] || cp -a "$BACKUP/moorail-tgv-game-v2.js" "$JS"
  if [ -d "$BACKUP/moorail-rfn-game-v2" ]; then
    rm -rf "$RFN_DIR"
    cp -a "$BACKUP/moorail-rfn-game-v2" "$RFN_DIR"
  elif [ -L "$RFN_DIR" ] || [ -d "$RFN_DIR" ]; then
    rm -rf "$RFN_DIR"
  fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[ "${EUID:-$(id -u)}" -eq 0 ] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
mkdir -p "$BACKUP" "$PUBLIC/data"
for f in "$TARGET" "$V2PAGE" "$JS"; do [ ! -f "$f" ] || cp -a "$f" "$BACKUP/$(basename "$f")"; done
[ ! -d "$RFN_DIR" ] || cp -a "$RFN_DIR" "$BACKUP/moorail-rfn-game-v2"
if [ -f "$TARGET" ] && [ ! -f "$PUBLIC/moorail-route-editor-v1-legacy.html" ]; then cp -a "$TARGET" "$PUBLIC/moorail-route-editor-v1-legacy.html"; fi

echo "============================================================"
echo " MOO RAIL TGV GAME V2.1 — RFN DETAIL AUTODETECT"
echo "============================================================"
echo "Backup : $BACKUP"

SOURCE_KIND=""
SOURCE_PATH=""
SOURCE_URL=""

# 1) Réutiliser un jeu déjà découpé et servi par Map V2.
echo "=== 1/6 Recherche du RFN détaillé déjà installé ==="
python3 - "$PUBLIC" "$TMP/found.txt" <<'PY'
from pathlib import Path
import json,sys
public=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2])
found=[]
for p in public.rglob('manifest.json'):
    try:
        d=json.load(open(p,encoding='utf-8'))
    except Exception:
        continue
    n=int(d.get('features') or d.get('records') or 0)
    cell=float(d.get('cellSize') or 0)
    cells=p.parent/'cells'
    if 8500 <= n <= 13000 and cell > 0 and cells.is_dir():
        count=sum(1 for _ in cells.glob('*.geojson'))
        if count>20:
            found.append((n,count,p))
if found:
    found.sort(key=lambda x:(-x[0],-x[1]))
    n,c,p=found[0]
    rel='/' + str(p.parent.relative_to(public)).replace('\\','/')
    out.write_text(f"manifest\n{p}\n{rel}\n{n}\n{c}\n",encoding='utf-8')
    print(f"Trouvé: {p} ({n} objets, {c} cellules)")
PY

if [ -s "$TMP/found.txt" ]; then
  mapfile -t FOUND < "$TMP/found.txt"
  if [ "${FOUND[0]:-}" = "manifest" ]; then
    SOURCE_KIND="manifest"
    SOURCE_PATH="${FOUND[1]}"
    SOURCE_URL="${FOUND[2]}"
  fi
fi

# 2) Sinon chercher un GeoJSON détaillé déjà présent sur le VPS.
if [ -z "$SOURCE_KIND" ]; then
  echo "Aucun manifest compatible trouvé; recherche d'un GeoJSON RFN détaillé..."
  python3 - "$ROOT" "/opt/lb-rail-engine-v1" "$TMP/raw-found.txt" <<'PY'
from pathlib import Path
import json,sys,os
roots=[Path(x) for x in sys.argv[1:3] if Path(x).exists()]
out=Path(sys.argv[3]); candidates=[]
patterns=('rfn','voie','track','rail')
for root in roots:
    for p in root.rglob('*.geojson'):
        name=p.name.lower()
        if not any(x in name for x in patterns): continue
        try:
            if p.stat().st_size < 2_000_000: continue
            d=json.load(open(p,encoding='utf-8'))
            fs=d.get('features') or []
            n=len(fs)
            if 8500 <= n <= 13000:
                candidates.append((n,p.stat().st_size,p))
        except Exception:
            pass
if candidates:
    candidates.sort(key=lambda x:(-x[0],-x[1]))
    n,size,p=candidates[0]
    out.write_text(str(p),encoding='utf-8')
    print(f"GeoJSON trouvé: {p} ({n} objets, {size/1024/1024:.1f} Mo)")
PY
  if [ -s "$TMP/raw-found.txt" ]; then
    SOURCE_KIND="geojson"
    SOURCE_PATH="$(cat "$TMP/raw-found.txt")"
  fi
fi

# 3) Dernier recours : télécharger le GeoJSON officiel exact.
if [ -z "$SOURCE_KIND" ]; then
  echo "Aucune source locale exploitable trouvée : téléchargement du GeoJSON officiel SNCF Réseau..."
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 300 "$OFFICIAL" -o "$TMP/rfn.geojson"
  SOURCE_KIND="geojson"
  SOURCE_PATH="$TMP/rfn.geojson"
fi

echo "Source retenue : $SOURCE_KIND $SOURCE_PATH ${SOURCE_URL:-}"

# Si on a déjà des cellules publiques, ne pas recopier plusieurs dizaines de Mo :
# créer un alias symbolique stable /data/moorail-rfn-game-v2.
if [ "$SOURCE_KIND" = "manifest" ]; then
  SRC_DIR="$(dirname "$SOURCE_PATH")"
  rm -rf "$RFN_DIR"
  ln -s "$SRC_DIR" "$RFN_DIR"
  echo "Alias créé : $RFN_DIR -> $SRC_DIR"
else
  echo "=== 2/6 Création des cellules cliquables du jeu ==="
  rm -rf "$TMP/out"
  mkdir -p "$TMP/out/cells"
  python3 - "$SOURCE_PATH" "$TMP/out" <<'PY'
import json,sys,math,datetime
from pathlib import Path
src=Path(sys.argv[1]); out=Path(sys.argv[2]); cells=out/'cells'; CELL=.20
raw=json.load(open(src,encoding='utf-8')); features=raw.get('features') or []
if not (8500 <= len(features) <= 13000):
    raise SystemExit(f"ERREUR: source détaillée inattendue: {len(features)} features")

def iter_lines(g):
    if not g:return
    t=g.get('type'); c=g.get('coordinates') or []
    if t=='LineString': yield c
    elif t=='MultiLineString':
        for x in c: yield x

def small_props(p):
    o={}
    for k,v in (p or {}).items():
        lk=k.lower()
        if any(x in lk for x in ('ligne','voie','track','code','rang','id','pk','lib','nom','type')):
            if isinstance(v,(str,int,float,bool)) or v is None:o[k]=v
    return o

def key_for(a,b):
    lon=(float(a[0])+float(b[0]))/2; lat=(float(a[1])+float(b[1]))/2
    return math.floor(lon/CELL),math.floor(lat/CELL)

bucket={}; runs=0
for f in features:
    props=small_props(f.get('properties') or {})
    for line in iter_lines(f.get('geometry')):
        if len(line)<2:continue
        cur=None; run=[]
        for i in range(len(line)-1):
            a,b=line[i],line[i+1]
            if len(a)<2 or len(b)<2:continue
            k=key_for(a,b)
            if cur is None:cur=k;run=[a,b]
            elif k==cur:
                if run[-1]!=a:run.append(a)
                run.append(b)
            else:
                if len(run)>=2:
                    bucket.setdefault(cur,[]).append({'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':run}});runs+=1
                cur=k;run=[a,b]
        if cur is not None and len(run)>=2:
            bucket.setdefault(cur,[]).append({'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':run}});runs+=1
for (x,y),fs in bucket.items():
    json.dump({'type':'FeatureCollection','features':fs},open(cells/f'c_{x}_{y}.geojson','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
manifest={'version':2,'dataset':'fichier-de-formes-des-voies-du-reseau-ferre-national','cellSize':CELL,'minZoom':10,'features':len(features),'runs':runs,'cells':len(bucket),'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
json.dump(manifest,open(out/'manifest.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(json.dumps(manifest,indent=2,ensure_ascii=False))
PY
  rm -rf "$RFN_DIR"
  cp -a "$TMP/out" "$RFN_DIR"
fi
chmod -R a+rX "$RFN_DIR" 2>/dev/null || true

# Contrôle de la source canonique du jeu.
echo "=== 3/6 Contrôle du RFN canonique du jeu ==="
python3 - "$RFN_DIR/manifest.json" <<'PY'
import json,sys,os
m=json.load(open(sys.argv[1],encoding='utf-8'))
n=int(m.get('features') or 0); c=int(m.get('cells') or 0)
assert 8500 <= n <= 13000,m
assert c>20,m
print(f"RFN jeu OK : {n} objets / {c} cellules / cellSize={m.get('cellSize')}")
PY

# Installer la page et adapter le JS au chemin canonique V2.1.
echo "=== 4/6 Installation du TGV Game V2.1 ==="
curl -fsSL "$BASE/moorail-tgv-game-v2.html?$STAMP" -o "$TMP/page.html"
curl -fsSL "$BASE/moorail-tgv-game-v2.js?$STAMP" -o "$TMP/game.js"
python3 - "$TMP/page.html" "$TMP/game.js" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8').replace('V2 · RFN DÉTAILLÉ','V2.1 · RFN DÉTAILLÉ')
p.write_text(s,encoding='utf-8')
j=Path(sys.argv[2]); s=j.read_text(encoding='utf-8').replace("const RFN = '/map-v2/data/rfn-detail-official-v1';","const RFN = '/map-v2/data/moorail-rfn-game-v2';")
j.write_text(s,encoding='utf-8')
PY
grep -q 'V2.1 · RFN DÉTAILLÉ' "$TMP/page.html"
grep -q "const RFN = '/map-v2/data/moorail-rfn-game-v2';" "$TMP/game.js"
grep -q 'pagny-lgv-straight' "$TMP/game.js"
grep -q 'pagny-lgv-nancy' "$TMP/game.js"
grep -q 'pagny-lgv-metz' "$TMP/game.js"
grep -q "mode==='transition'" "$TMP/game.js"
grep -q 'forbiddenSegments' "$TMP/game.js"
node --check "$TMP/game.js"
install -o root -g root -m 0644 "$TMP/page.html" "$V2PAGE"
install -o root -g root -m 0644 "$TMP/page.html" "$TARGET"
install -o root -g root -m 0644 "$TMP/game.js" "$JS"

echo "=== 5/6 Contrôle via Map V2 ==="
curl -fsS --max-time 5 "http://127.0.0.1:3111/data/moorail-rfn-game-v2/manifest.json?v=$STAMP" -o "$TMP/served-manifest.json"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
curl -fsS --max-time 5 "http://127.0.0.1:3111/moorail-tgv-game-v2.js?v=$STAMP" -o "$TMP/served.js"
grep -q 'V2.1 · RFN DÉTAILLÉ' "$TMP/served.html"
grep -q '/map-v2/data/moorail-rfn-game-v2' "$TMP/served.js"
python3 - "$TMP/served-manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8')); assert int(m.get('features') or 0)>=8500,m; print('manifest servi OK:',m.get('features'),'objets')
PY
curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
python3 - "$TMP/health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1],encoding='utf-8'));assert h.get('ok') is True,h;print('Map V2 health : OK',h)
PY

SUCCESS=1
cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[ ! -f '$BACKUP/moorail-route-editor.html' ] || cp -a '$BACKUP/moorail-route-editor.html' '$TARGET'
[ ! -f '$BACKUP/moorail-tgv-game-v2.html' ] || cp -a '$BACKUP/moorail-tgv-game-v2.html' '$V2PAGE'
[ ! -f '$BACKUP/moorail-tgv-game-v2.js' ] || cp -a '$BACKUP/moorail-tgv-game-v2.js' '$JS'
if [ -d '$BACKUP/moorail-rfn-game-v2' ]; then rm -rf '$RFN_DIR'; cp -a '$BACKUP/moorail-rfn-game-v2' '$RFN_DIR'; else rm -rf '$RFN_DIR'; fi
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo "=== 6/6 TERMINE ==="
echo
echo "============================================================"
echo " MOO RAIL TGV GAME V2.1 — INSTALLE"
echo "============================================================"
echo "Page    : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "RFN jeu : /map-v2/data/moorail-rfn-game-v2/"
echo "Backup  : $BACKUP"
echo "Legacy  : https://vps.labetaillere.fr/map-v2/moorail-route-editor-v1-legacy.html"
echo
echo "Le jeu utilise maintenant un RFN détaillé canonique indépendant du nom de ton installation actuelle."
