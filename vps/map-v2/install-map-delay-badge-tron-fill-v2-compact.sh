#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-delay-badge-tron-fill-v2-compact-${STAMP}"
EMBEDDED_JS="/tmp/lb-delay-badge-tron-fill-v2-${STAMP}.js"
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

for needle in \
  'LB_MARKER_BADGE_FIX_V2 START' \
  'LB_STATUS_VISIBILITY_MODAL_V1 START' \
  'LB_PARTIAL_GHOST_V2_JS START' \
  'train-delay-badge--moderate' \
  'train-delay-badge--major' \
  'train-delay-badge--severe' \
  'train-delay-badge--cancelled'; do
  grep -q "$needle" "$FILE" || { echo "ERREUR: structure inattendue, élément absent: $needle" >&2; exit 3; }
done

echo "=== VERSION AVANT ==="
sha256sum "$FILE"

echo
echo "=== SAUVEGARDE ==="
cp -p "$FILE" "$BACKUP"
echo "$BACKUP"

echo
echo "=== INSTALLATION ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re,sys

path=Path(sys.argv[1])
text=path.read_text(encoding='utf-8')

# Retire uniquement les overrides visuels TRON précédents afin de ne rien empiler.
for start,end in (
    ('<!-- LB_DELAY_BADGE_LIGHT_V1 START -->','<!-- LB_DELAY_BADGE_LIGHT_V1 END -->'),
    ('<!-- LB_DELAY_BADGE_TRON_FILL_V1 START -->','<!-- LB_DELAY_BADGE_TRON_FILL_V1 END -->'),
    ('<!-- LB_DELAY_BADGE_TRON_FILL_V2_CSS START -->','<!-- LB_DELAY_BADGE_TRON_FILL_V2_CSS END -->'),
    ('<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS START -->','<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS END -->'),
):
    text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\s*','',text,flags=re.S)

css_start='<!-- LB_DELAY_BADGE_TRON_FILL_V2_CSS START -->'
css_end='<!-- LB_DELAY_BADGE_TRON_FILL_V2_CSS END -->'
js_start='<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS START -->'
js_end='<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS END -->'

css=r'''
/* V2 COMPACT — petit badge TRON plein, sans contour.
   On ne touche pas au triangle, au lisere, au moteur retard ni au fantome. */
html body .cow-marker .train-delay-badge{
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  box-sizing:border-box!important;
  width:auto!important;
  min-width:0!important;
  max-width:none!important;
  height:10px!important;
  min-height:10px!important;
  padding:0 3px!important;
  margin-left:1px!important;
  border:0!important;
  outline:0!important;
  border-radius:3px!important;
  box-shadow:none!important;
  font-size:6.25px!important;
  font-weight:900!important;
  line-height:10px!important;
  letter-spacing:0!important;
  white-space:nowrap!important;
  text-transform:none!important;
}

/* Retard leger : jaune chaud */
html body .cow-marker .train-delay-badge--moderate{
  background:rgba(255,190,58,.97)!important;
  color:#101820!important;
}
/* Retard moyen : orange */
html body .cow-marker .train-delay-badge--major{
  background:rgba(238,119,48,.96)!important;
  color:#121820!important;
}
/* Gros retard : rouge/bordeaux proche de la suppression */
html body .cow-marker .train-delay-badge--severe{
  background:rgba(176,49,71,.96)!important;
  color:#fff5f7!important;
}
/* Suppression : couleur actuelle conservee */
html body .cow-marker .train-delay-badge--cancelled{
  background:rgba(128,32,52,.92)!important;
  color:#ffe4ef!important;
  text-transform:uppercase!important;
  letter-spacing:.02em!important;
}

/* Unite min, volontairement plus petite et en minuscules. */
html body .cow-marker .train-delay-badge--moderate::after,
html body .cow-marker .train-delay-badge--major::after,
html body .cow-marker .train-delay-badge--severe::after{
  content:' min'!important;
  display:inline!important;
  margin-left:.5px!important;
  font-size:5.25px!important;
  font-weight:800!important;
  line-height:10px!important;
  text-transform:lowercase!important;
  opacity:.92!important;
}
html body .cow-marker .train-delay-badge--cancelled::after{
  content:none!important;
  display:none!important;
}

@media(max-width:720px){
  html body .cow-marker .train-delay-badge{
    height:9px!important;
    min-height:9px!important;
    padding:0 2px!important;
    border-radius:3px!important;
    font-size:5.75px!important;
    line-height:9px!important;
  }
  html body .cow-marker .train-delay-badge--moderate::after,
  html body .cow-marker .train-delay-badge--major::after,
  html body .cow-marker .train-delay-badge--severe::after{
    font-size:4.9px!important;
    line-height:9px!important;
  }
}
'''

js=r'''
(()=>{
  'use strict';
  if(window.__LB_DELAY_BADGE_TRON_FILL_V2__) return;
  window.__LB_DELAY_BADGE_TRON_FILL_V2__=true;

  function normalizeBadge(el){
    if(!(el instanceof Element)) return;
    if(!el.classList.contains('train-delay-badge')) return;
    if(el.classList.contains('train-delay-badge--cancelled')) return;

    /* Le moteur peut produire +1MIN / +10 MIN selon les versions.
       On garde uniquement la valeur numerique ; le CSS ajoute « min » en minuscules. */
    const raw=String(el.textContent||'').trim();
    const m=raw.match(/([+-]?\d+)/);
    if(!m) return;
    const wanted=m[1].startsWith('-') ? m[1] : (m[1].startsWith('+') ? m[1] : `+${m[1]}`);
    if(el.textContent!==wanted) el.textContent=wanted;
  }

  function scan(root=document){
    root.querySelectorAll?.('.cow-marker .train-delay-badge').forEach(normalizeBadge);
  }

  scan();
  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued) return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      try{scan()}catch(_){}
    });
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
})();
'''

def insert(source,block,closing):
    if closing not in source:
        raise SystemExit(f'ERREUR: {closing} introuvable')
    return source.replace(closing,block+'\n'+closing,1)

css_block=f'{css_start}\n<style id="lb-delay-badge-tron-fill-v2-css">\n{css}\n</style>\n{css_end}'
js_block=f'{js_start}\n<script id="lb-delay-badge-tron-fill-v2-js">\n{js}\n</script>\n{js_end}'
text=insert(text,css_block,'</head>')
text=insert(text,js_block,'</body>')

for marker in (css_start,css_end,js_start,js_end):
    if text.count(marker)!=1:
        raise SystemExit(f'ERREUR: marqueur duplique/incomplet: {marker}')

path.write_text(text,encoding='utf-8')
print('✅ badge TRON V2 compact installe')
PY

echo
echo "=== CONTRÔLES ==="
grep -q 'LB_DELAY_BADGE_TRON_FILL_V2_CSS START' "$FILE"
grep -q 'LB_DELAY_BADGE_TRON_FILL_V2_JS START' "$FILE"
grep -q 'height:10px!important' "$FILE"
grep -q 'font-size:6.25px!important' "$FILE"
grep -q "content:' min'!important" "$FILE"
grep -q 'background:rgba(128,32,52,.92)!important' "$FILE"
# Briques fonctionnelles intactes.
grep -q 'LB_MARKER_BADGE_FIX_V2 START' "$FILE"
grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"
grep -q 'LB_PARTIAL_GHOST_V2_JS START' "$FILE"
echo "✅ badge reduit a 10px (9px mobile)"
echo "✅ texte reduit a 6.25px"
echo "✅ unite « min » en minuscules"
echo "✅ couleur suppression conservee"
echo "✅ liseres / triangles / logique retard conserves"

python3 - "$FILE" "$EMBEDDED_JS" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(encoding='utf-8')
m=re.search(r'<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS START -->\s*<script[^>]*>(.*?)</script>\s*<!-- LB_DELAY_BADGE_TRON_FILL_V2_JS END -->',text,re.S)
if not m: raise SystemExit('ERREUR: JS V2 introuvable')
Path(sys.argv[2]).write_text(m.group(1).strip()+'\n',encoding='utf-8')
PY
if command -v node >/dev/null 2>&1; then
  node --check "$EMBEDDED_JS" >/dev/null
  echo "✅ JavaScript embarque valide"
fi

echo
echo "=== HASH APRÈS ==="
AFTER="$(sha256sum "$FILE" | awk '{print $1}')"
echo "$AFTER  $FILE"

echo
echo "=== VERSION SERVIE ==="
SERVED=""
for i in 1 2 3; do
  SERVED="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$(date +%s)-$i" | sha256sum | awk '{print $1}')" || true
  echo "Essai $i : $SERVED"
  [[ "$SERVED" == "$AFTER" ]] && break
  sleep 1
done
[[ "$SERVED" == "$AFTER" ]] && echo "✅ HTTP = local" || echo "⚠️ HTTP pas encore synchronise"

SUCCESS=1
trap - EXIT

echo
echo "✅ BADGE TRON V2 COMPACT INSTALLE"
echo "Sauvegarde : $BACKUP"
