#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
FILE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.bak-status-visibility-modal-v1-${STAMP}"

if [[ ! -f "$FILE" ]]; then
  echo "ERREUR: fichier introuvable: $FILE" >&2
  exit 2
fi

for needle in 'cow-marker' 'cow-glyph' 'train-delay-badge--moderate' 'trip-panel' 'stop-time' 'stop-main' 'stop-name'; do
  if ! grep -q "$needle" "$FILE"; then
    echo "ERREUR: structure inattendue, sélecteur absent: $needle" >&2
    exit 3
  fi
done

cp -a "$FILE" "$BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

start = '<!-- LB_STATUS_VISIBILITY_MODAL_V1 START -->'
end = '<!-- LB_STATUS_VISIBILITY_MODAL_V1 END -->'

block = r'''<!-- LB_STATUS_VISIBILITY_MODAL_V1 START -->
<style id="lb-status-visibility-modal-v1">
/* Lisibilite des trains + modal compact. CSS uniquement: pas d'observer ni d'animation ajoutee. */
html body .cow-marker .cow-glyph{
  paint-order:stroke fill!important;
  -webkit-text-stroke:1.35px rgba(255,255,255,.98)!important;
  text-shadow:0 1px 1px rgba(0,8,18,.88)!important;
}
html body .cow-marker:has(.train-delay-badge--moderate) .cow-glyph{
  -webkit-text-stroke:.85px rgba(255,255,255,.98)!important;
  text-shadow:-2.15px 0 0 #ffd34d,2.15px 0 0 #ffd34d,0 -2.15px 0 #ffd34d,0 2.15px 0 #ffd34d,-1.55px -1.55px 0 #ffd34d,1.55px -1.55px 0 #ffd34d,-1.55px 1.55px 0 #ffd34d,1.55px 1.55px 0 #ffd34d,0 2.8px 2px rgba(0,8,18,.86)!important;
}
html body .cow-marker:has(.train-delay-badge--major) .cow-glyph{
  -webkit-text-stroke:.9px rgba(255,255,255,.98)!important;
  text-shadow:-2.45px 0 0 #ff9f32,2.45px 0 0 #ff9f32,0 -2.45px 0 #ff9f32,0 2.45px 0 #ff9f32,-1.75px -1.75px 0 #ff9f32,1.75px -1.75px 0 #ff9f32,-1.75px 1.75px 0 #ff9f32,1.75px 1.75px 0 #ff9f32,0 3px 2px rgba(0,8,18,.88)!important;
}
html body .cow-marker:has(.train-delay-badge--severe) .cow-glyph{
  -webkit-text-stroke:.95px rgba(255,255,255,.98)!important;
  text-shadow:-2.75px 0 0 #ff5d50,2.75px 0 0 #ff5d50,0 -2.75px 0 #ff5d50,0 2.75px 0 #ff5d50,-1.95px -1.95px 0 #ff5d50,1.95px -1.95px 0 #ff5d50,-1.95px 1.95px 0 #ff5d50,1.95px 1.95px 0 #ff5d50,0 3.2px 2px rgba(0,8,18,.9)!important;
}
html body .cow-marker.train-cancelled .cow-glyph,
html body .cow-marker:has(.train-delay-badge--cancelled) .cow-glyph{
  -webkit-text-stroke:1px rgba(255,255,255,.98)!important;
  text-shadow:-3px 0 0 #ff405c,3px 0 0 #ff405c,0 -3px 0 #ff405c,0 3px 0 #ff405c,-2.1px -2.1px 0 #ff405c,2.1px -2.1px 0 #ff405c,-2.1px 2.1px 0 #ff405c,2.1px 2.1px 0 #ff405c,0 3.4px 2px rgba(0,8,18,.92)!important;
}
html body .cow-marker.train-cancelled .cow-glyph--cancelled::after{
  font-size:.88em!important;
  font-weight:950!important;
  color:#fff!important;
  -webkit-text-stroke:1.55px #ff405c!important;
  text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 4px rgba(255,64,92,.9)!important;
  transform:translate(.08em,-.22em) scale(1.16)!important;
}
html body .cow-marker .train-delay-badge{border-width:1.5px!important;box-shadow:0 1px 2px rgba(0,8,18,.75)!important}
html body .cow-marker .train-delay-badge--moderate{border-color:#ffe07a!important}
html body .cow-marker .train-delay-badge--major{border-color:#ffc170!important}
html body .cow-marker .train-delay-badge--severe{border-color:#ff9b92!important}
html body .cow-marker .train-delay-badge--cancelled{border-color:#ff8aa0!important}

html body .trip-panel{
  box-sizing:border-box!important;
  width:min(438px,calc(100vw - 18px))!important;
  max-height:calc(100dvh - 18px)!important;
  padding:9px 10px!important;
  gap:5px!important;
  border-radius:14px!important;
  border:1px solid rgba(0,234,255,.38)!important;
  background:linear-gradient(150deg,rgba(2,9,22,.985),rgba(4,19,37,.975))!important;
  box-shadow:0 16px 38px rgba(0,0,0,.44)!important;
  color:#edfaff!important;
  font-family:Rajdhani,system-ui,-apple-system,"Segoe UI",sans-serif!important;
  overflow:hidden!important;
}
html body .trip-panel-header{padding:1px 1px 6px!important;border-bottom:1px solid rgba(0,234,255,.18)!important}
html body .trip-panel-title{gap:5px!important;font-size:14px!important;line-height:1.05!important;font-weight:850!important;color:#f2fdff!important}
html body .trip-panel-close{width:28px!important;height:28px!important;border:1px solid rgba(0,234,255,.28)!important;background:rgba(3,21,39,.92)!important;color:#eefcff!important}
html body .trip-panel-body{min-height:0!important;flex:1 1 auto!important;gap:4px!important;overflow-y:auto!important;overflow-x:hidden!important;padding-right:2px!important;scrollbar-width:thin!important;scrollbar-color:rgba(0,234,255,.42) rgba(7,24,39,.55)!important}
html body .trip-panel-summary{font-size:10.5px!important;line-height:1.14!important;color:#a9bfd2!important}
html body .trip-panel-delay,
html body .trip-panel-disruption{margin-top:2px!important;padding:4px 7px!important;border-radius:7px!important;font-size:9px!important;line-height:1.08!important}
html body .trip-progress{gap:3px!important}
html body .trip-progress-bar{height:5px!important}
html body .trip-progress-text{font-size:9px!important;line-height:1.05!important}
html body .trip-stops-title{font-size:9.5px!important;line-height:1.05!important;letter-spacing:.07em!important;color:#819ab4!important}
html body .trip-stops{min-height:0!important;gap:1px!important;overflow-y:auto!important;overflow-x:hidden!important;padding-right:1px!important}
html body .trip-stop{box-sizing:border-box!important;align-items:center!important;gap:4px!important;min-height:34px!important;padding:3px 0 3px 12px!important;border-bottom:1px solid rgba(0,234,255,.075)!important}
html body .trip-stop:last-child{border-bottom:0!important}
html body .trip-stop::before{left:0!important;top:50%!important;transform:translateY(-50%)!important;width:9px!important;height:9px!important}
html body .trip-stop.enroute::before{transform:translateY(-50%) scale(1.08)!important}
html body .trip-stop:not(:last-child)::after{left:4px!important;top:50%!important;bottom:-18px!important}
html body .stop-time{box-sizing:border-box!important;flex:0 0 101px!important;min-width:101px!important;max-width:101px!important;gap:0!important;align-items:flex-start!important;font-size:8.7px!important;line-height:1!important;letter-spacing:-.015em!important;font-variant-numeric:tabular-nums!important}
html body .stop-time .time-entry{box-sizing:border-box!important;display:flex!important;width:100%!important;min-width:0!important;align-items:baseline!important;justify-content:flex-start!important;gap:2px!important;margin:0!important;padding:0!important;white-space:nowrap!important;line-height:1.02!important}
html body .stop-time .time-entry-plan,
html body .stop-time .time-entry-rt{display:inline!important;margin:0!important;padding:0!important;white-space:nowrap!important;font-size:8.25px!important;line-height:1.02!important}
html body .stop-time .time-entry-rt{opacity:1!important}
html body .stop-time .time-entry-rt--delay{color:#ffad32!important;font-weight:850!important}
html body .stop-main{flex:1 1 auto!important;min-width:0!important;gap:1px!important}
html body .stop-name{min-width:0!important;max-width:100%!important;font-size:11.25px!important;line-height:1.02!important;font-weight:800!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:normal!important;word-break:normal!important;color:#edfaff!important}
html body .stop-note{font-size:7.8px!important;line-height:1!important;letter-spacing:.025em!important;white-space:normal!important}
html body .stop-note strong{color:#a0ff00!important;font-weight:850!important}

@media (max-width:600px){
  html body .trip-panel{left:5px!important;right:5px!important;bottom:5px!important;width:auto!important;max-height:min(76dvh,620px)!important;padding:8px!important}
  html body .stop-time{flex-basis:94px!important;min-width:94px!important;max-width:94px!important;font-size:8.25px!important}
  html body .stop-time .time-entry-plan,
  html body .stop-time .time-entry-rt{font-size:7.9px!important}
  html body .stop-name{font-size:10.8px!important}
}
</style>
<!-- LB_STATUS_VISIBILITY_MODAL_V1 END -->'''

pattern = re.compile(re.escape(start) + r'.*?' + re.escape(end), re.S)
if pattern.search(text):
    text, count = pattern.subn(block, text, count=1)
    action = 'remplace'
else:
    if '</head>' not in text:
        raise SystemExit('ERREUR: </head> absent')
    text = text.replace('</head>', block + '\n</head>', 1)
    count = 1
    action = 'ajoute'

if text.count(start) != 1 or text.count(end) != 1:
    raise SystemExit('ERREUR: bloc CSS duplique ou incomplet')

path.write_text(text, encoding='utf-8')
print(f'OK: bloc {action} ({count})')
PY

if ! grep -q 'LB_STATUS_VISIBILITY_MODAL_V1 START' "$FILE"; then
  echo "ERREUR: patch non trouve apres ecriture" >&2
  cp -a "$BACKUP" "$FILE"
  exit 4
fi

if [[ "$(grep -c 'id="lb-status-visibility-modal-v1"' "$FILE")" -ne 1 ]]; then
  echo "ERREUR: bloc CSS present plusieurs fois" >&2
  cp -a "$BACKUP" "$FILE"
  exit 5
fi

echo "=== SAUVEGARDE ==="
echo "$BACKUP"
echo
echo "=== CONTROLE ==="
sha256sum "$FILE"
grep -n 'LB_STATUS_VISIBILITY_MODAL_V1 START\|lb-status-visibility-modal-v1\|LB_STATUS_VISIBILITY_MODAL_V1 END' "$FILE"
echo
echo "OK: lisere de statut renforce + modal compact/non tronque installe."
