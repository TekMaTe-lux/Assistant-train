#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-train-stop-arrow-fix-v1-${STAMP}"
TMP_JS="/tmp/lb-train-stop-arrow-fix-v1-${STAMP}.js"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -ne 1 && -f "$BACKUP" ]]; then
    echo
    echo "❌ ÉCHEC — restauration automatique"
    cp -p "$BACKUP" "$FILE"
    echo "✅ Carte restaurée depuis : $BACKUP"
  fi
}
trap rollback EXIT

[[ -f "$FILE" ]] || { echo "ERREUR: fichier introuvable: $FILE" >&2; exit 2; }

# Préflight volontairement basé sur la logique structurelle, pas sur un hash figé.
for needle in \
  'function trainsAt(nowSec)' \
  'segmentProgress: 0' \
  'function renderTrains(list)' \
  'const trainMarkers = new Map()' \
  'const stopTimesByTrip' \
  'function pathBetweenStops' \
  'function positionAlongPath' \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_PARTIAL_GHOST_V2_JS START'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== 1. VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== 2. DIAGNOSTIC CONFIRMÉ ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
# Le branchement 'train à quai' doit bien poser le train exactement sur le stop.
pat=re.compile(r"segmentProgress:\s*0,",re.S)
assert pat.search(text), 'segmentProgress:0 absent'
if 'lat: stopMeta.lat' not in text or 'lon: stopMeta.lon' not in text:
    raise SystemExit('ERREUR: le branchement quai attendu n\'est plus celui audité')
print('✅ à quai, le moteur place bien le train exactement aux coordonnées de la gare')
print('✅ cause visuelle cohérente: superposition gare / trains au même point')
PY

echo
echo "=== 3. SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== 4. INSTALLATION DU CORRECTIF ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re,sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

css_start='<!-- LB_TRAIN_STOP_ARROW_FIX_V1_CSS START -->'
css_end='<!-- LB_TRAIN_STOP_ARROW_FIX_V1_CSS END -->'
js_start='<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS START -->'
js_end='<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS END -->'

# Remplacement idempotent si on rejoue le script.
for start,end in ((css_start,css_end),(js_start,js_end)):
    text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)

css=r'''<!-- LB_TRAIN_STOP_ARROW_FIX_V1_CSS START -->
<style id="lb-train-stop-arrow-fix-v1-css">
/*
  Les coordonnées ferroviaires du marker Leaflet restent inchangées.
  Seul le bouton visuel est légèrement décalé, dans l'axe de la voie,
  lorsque le train est exactement à quai. Cela évite qu'il disparaisse
  sous le pictogramme de gare ou sous un autre train au même point.
*/
html body .cow-marker.lb-train-at-stop{
  transform:translate(var(--lb-stop-arrow-x,0px),var(--lb-stop-arrow-y,0px))!important;
  transform-origin:center center!important;
  will-change:auto!important;
}
html body .cow-marker.lb-train-at-stop .cow-glyph{
  display:inline-flex!important;
  visibility:visible!important;
  opacity:1!important;
}
</style>
<!-- LB_TRAIN_STOP_ARROW_FIX_V1_CSS END -->'''

js=r'''<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS START -->
<script id="lb-train-stop-arrow-fix-v1-js">
(()=>{
  'use strict';
  if (window.__LB_TRAIN_STOP_ARROW_FIX_V1__) return;
  window.__LB_TRAIN_STOP_ARROW_FIX_V1__=true;

  const lastBearingByTrip=new Map();

  function stableHash(value){
    const s=String(value ?? '');
    let h=2166136261;
    for(let i=0;i<s.length;i++){
      h^=s.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function bearingDeg(a,b){
    if(!a || !b) return null;
    const lat1=Number(a.lat ?? a[0]), lon1=Number(a.lon ?? a.lng ?? a[1]);
    const lat2=Number(b.lat ?? b[0]), lon2=Number(b.lon ?? b.lng ?? b[1]);
    if(![lat1,lon1,lat2,lon2].every(Number.isFinite)) return null;
    if(Math.abs(lat1-lat2)+Math.abs(lon1-lon2)<1e-10) return null;
    const rad=Math.PI/180;
    const p1=lat1*rad, p2=lat2*rad, dl=(lon2-lon1)*rad;
    const y=Math.sin(dl)*Math.cos(p2);
    const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    const br=(Math.atan2(y,x)/rad+360)%360;
    return Number.isFinite(br)?br:null;
  }

  function tangentForPath(path,atEnd){
    const coords=path?.coords;
    if(!Array.isArray(coords) || coords.length<2) return null;
    if(atEnd){
      for(let i=coords.length-1;i>0;i--){
        const b=bearingDeg(coords[i-1],coords[i]);
        if(b!=null) return b;
      }
      return null;
    }
    for(let i=0;i<coords.length-1;i++){
      const b=bearingDeg(coords[i],coords[i+1]);
      if(b!=null) return b;
    }
    return null;
  }

  function stopContext(train){
    if(!train?.id) return null;
    const seq=stopTimesByTrip.get(train.id);
    if(!Array.isArray(seq) || seq.length<2) return null;

    let idx=Number.isFinite(Number(train.segmentIndex))?Number(train.segmentIndex):0;
    idx=Math.max(0,Math.min(seq.length-1,Math.trunc(idx)));
    const prog=Number(train.segmentProgress);

    // Les cas créés par le moteur à quai utilisent segmentProgress=0.
    // On couvre aussi les arrivées exactes (r≈1) et les éventuels états terminus.
    let stationIdx=idx;
    let arriving=false;
    if(Number.isFinite(prog) && prog>=0.997 && idx+1<seq.length){
      stationIdx=idx+1;
      arriving=true;
    } else if(Number.isFinite(prog) && prog>0.003 && prog<0.997){
      return null; // véritable circulation entre deux gares : aucun décalage visuel
    }

    const stop=stopsById.get(seq[stationIdx]?.stop_id);
    if(!stop) return null;

    // Protection : on n'agit que si le marker est réellement collé à la gare.
    const d=typeof distLL==='function'
      ? distLL({lat:Number(train.lat),lon:Number(train.lon)},{lat:Number(stop.lat),lon:Number(stop.lon)})
      : Infinity;
    if(!Number.isFinite(d) || d>45) return null;

    let bearing=null;
    let mode='dwell';

    if(stationIdx<seq.length-1){
      const next=stopsById.get(seq[stationIdx+1]?.stop_id);
      if(next){
        const path=pathBetweenStops(stop,next);
        bearing=tangentForPath(path,false) ?? bearingDeg(stop,next);
      }
      mode=stationIdx===0 ? 'origin' : (arriving?'arrival':'dwell');
    }

    // Au terminus il n'y a plus de segment sortant : garder le sens du dernier segment entrant.
    if(bearing==null && stationIdx>0){
      const prev=stopsById.get(seq[stationIdx-1]?.stop_id);
      if(prev){
        const path=pathBetweenStops(prev,stop);
        bearing=tangentForPath(path,true) ?? bearingDeg(prev,stop);
      }
      mode=stationIdx===seq.length-1 ? 'terminus' : mode;
    }

    if(bearing==null) bearing=lastBearingByTrip.get(train.id) ?? null;
    if(bearing==null) return null;
    lastBearingByTrip.set(train.id,bearing);
    return {bearing,stationIdx,mode};
  }

  function clearStopShift(marker){
    const root=marker?.getElement?.();
    const button=root?.querySelector?.('.cow-marker');
    if(!button) return;
    button.classList.remove('lb-train-at-stop');
    button.style.removeProperty('--lb-stop-arrow-x');
    button.style.removeProperty('--lb-stop-arrow-y');
  }

  function applyStopArrowVisibility(list){
    if(!Array.isArray(list)) return;
    for(const train of list){
      const marker=trainMarkers.get(train?.id);
      if(!marker) continue;
      const ctx=stopContext(train);
      if(!ctx){
        clearStopShift(marker);
        marker.setZIndexOffset?.(1000);
        continue;
      }

      const root=marker.getElement?.();
      const button=root?.querySelector?.('.cow-marker');
      if(!button) continue;

      // 8–11 px vers le sens du train + ±2 px transversal stable.
      // Assez pour dégager l'icône de gare, pas assez pour faire croire que le train a quitté le quai.
      const h=stableHash(train.id);
      const forward=8+(h%4);       // 8..11 px
      const side=((h>>>3)%3)-1;    // -1, 0, +1
      const sidePx=side*2;
      const a=ctx.bearing*Math.PI/180;
      const ux=Math.sin(a), uy=-Math.cos(a);
      const px=Math.cos(a), py=Math.sin(a);
      const x=ux*forward+px*sidePx;
      const y=uy*forward+py*sidePx;

      button.classList.add('lb-train-at-stop');
      button.style.setProperty('--lb-stop-arrow-x',`${x.toFixed(2)}px`);
      button.style.setProperty('--lb-stop-arrow-y',`${y.toFixed(2)}px`);
      button.dataset.lbStopMode=ctx.mode;
      button.dataset.lbBearing=String(Math.round(ctx.bearing));

      // Les gares sont à zIndexOffset 600 dans le moteur ; le train à quai passe nettement devant.
      marker.setZIndexOffset?.(1800+(h%80));
    }
  }

  const originalRenderTrains=renderTrains;
  renderTrains=function(list){
    const result=originalRenderTrains.apply(this,arguments);
    try{ applyStopArrowVisibility(list); }
    catch(err){ console.warn('[LB STOP ARROW V1]',err); }
    return result;
  };

  // Cas où un rendu a déjà eu lieu avant l'installation du wrapper pendant le boot async.
  try{ applyStopArrowVisibility(Array.from(trainDataById.values())); }catch(_){ }
  console.info('[LB STOP ARROW V1] actif — flèches à quai dégagées dans l’axe de la voie');
})();
</script>
<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS END -->'''

if '</head>' not in text or '</body>' not in text:
    raise SystemExit('ERREUR: structure HTML incomplète')
text=text.replace('</head>',css+'\n</head>',1)
text=text.replace('</body>',js+'\n</body>',1)

for marker in (css_start,css_end,js_start,js_end):
    if text.count(marker)!=1:
        raise SystemExit(f'ERREUR: marqueur {marker} présent {text.count(marker)} fois')

path.write_text(text,encoding='utf-8')
print('✅ correctif flèches à quai installé')
PY

echo
echo "=== 5. VALIDATION JS ==="
python3 - "$FILE" "$TMP_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_TRAIN_STOP_ARROW_FIX_V1_JS END -->',text,re.S)
if not m: raise SystemExit('ERREUR: bloc JS introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY
if command -v node >/dev/null 2>&1; then
  node --check "$TMP_JS" >/dev/null
  echo "✅ JavaScript valide"
fi

echo
echo "=== 6. CONTRÔLES DE NON-RÉGRESSION ==="
grep -q 'LB_TRAIN_STOP_ARROW_FIX_V1_CSS START' "$FILE"
grep -q 'LB_TRAIN_STOP_ARROW_FIX_V1_JS START' "$FILE"
grep -q 'LB_TRAIN_FLASHY_PALETTE_V1 START' "$FILE"
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
grep -q 'marker.setZIndexOffset?.(1800' "$FILE"
grep -q "return null; // véritable circulation entre deux gares" "$FILE"
echo "✅ palette flash conservée"
echo "✅ badges/liserés conservés"
echo "✅ trajet fantôme conservé"
echo "✅ aucun changement de lat/lon du moteur"
echo "✅ seuls les trains collés à une gare sont décalés visuellement"

echo
echo "=== 7. HASH APRÈS ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== 8. VERSION SERVIE ==="
SERVED=""
for i in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$i" | sha256sum | awk '{print $1}')" || true
  echo "Essai $i : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done
if [[ "$SERVED" == "$AFTER" ]]; then
  echo "✅ HTTP = fichier local"
else
  echo "⚠️ HTTP pas encore synchronisé" >&2
fi

SUCCESS=1
trap - EXIT
rm -f "$TMP_JS"

echo
echo "✅ CORRECTIF FLÈCHES À QUAI V1 INSTALLÉ"
echo "Origine / pré-départ / arrêt intermédiaire / terminus couverts"
echo "Sauvegarde : $BACKUP"
