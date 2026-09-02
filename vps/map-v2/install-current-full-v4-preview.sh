#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PUBLIC="$ROOT/public"
SOURCE_CORE="$PUBLIC/carte-core-preview.html"
SOURCE_WRAPPER="$PUBLIC/carte-preview.html"
DEST_CORE="$PUBLIC/carte-core-current-v4-preview.html"
DEST_WRAPPER="$PUBLIC/carte-current-v4-preview.html"
SNAPSHOT="$PUBLIC/v4-preview/data/snapshot.json"
LUX_URL="https://vps.labetaillere.fr/map-v2/tests/luxembourg-user-preview-v5-private-maplike-trainclick.html"
SERVICE="labetaillere-map-v2.service"
COMMIT="4ddc1b5a9c2f6507685b3f106d93a70607a3d5a5"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/lb-current-full-v4.XXXXXX)"
BACKUP="$ROOT/backups/current-full-v4-preview-$STAMP"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback de la preview intégrée..."
  if [[ -f "$BACKUP/$(basename "$DEST_CORE")" ]]; then
    cp -a "$BACKUP/$(basename "$DEST_CORE")" "$DEST_CORE"
  else
    rm -f "$DEST_CORE"
  fi
  if [[ -f "$BACKUP/$(basename "$DEST_WRAPPER")" ]]; then
    cp -a "$BACKUP/$(basename "$DEST_WRAPPER")" "$DEST_WRAPPER"
  else
    rm -f "$DEST_WRAPPER"
  fi
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi

for f in "$SOURCE_CORE" "$SNAPSHOT"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done

mkdir -p "$BACKUP"
[[ -f "$DEST_CORE" ]] && cp -a "$DEST_CORE" "$BACKUP/$(basename "$DEST_CORE")"
[[ -f "$DEST_WRAPPER" ]] && cp -a "$DEST_WRAPPER" "$BACKUP/$(basename "$DEST_WRAPPER")"

SOURCE_CORE_SHA_BEFORE="$(sha256sum "$SOURCE_CORE" | awk '{print $1}')"
SOURCE_WRAPPER_SHA_BEFORE=""
[[ -f "$SOURCE_WRAPPER" ]] && SOURCE_WRAPPER_SHA_BEFORE="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
SOURCE_SIZE="$(stat -c%s "$SOURCE_CORE")"

if (( SOURCE_SIZE < 300000 )); then
  echo "ERREUR : carte actuelle anormalement petite ($SOURCE_SIZE octets)" >&2
  exit 4
fi

echo "============================================================"
echo "PREVIEW INTEGREE — CARTE ACTUELLE + V4 + SHAPES CFL"
echo "============================================================"
echo "Base UI actuelle : $SOURCE_CORE"
echo "SHA base          : $SOURCE_CORE_SHA_BEFORE"
echo "Taille            : $SOURCE_SIZE octets"
echo

# ---------------------------------------------------------------------------
# 1) Rejouer le patch V4 audité, mais vers une NOUVELLE destination.
#    Le script canonique prend déjà carte-core-preview.html comme SOURCE :
#    on ne change donc que DEST. La production n'est jamais écrite.
# ---------------------------------------------------------------------------
echo "=== 1/5 Reconstruction depuis la carte ACTUELLE ==="
CANONICAL="$TMP/install-canonical.sh"
curl -fsSL \
  "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${COMMIT}/vps/map-v2/install-canonical-preview.sh" \
  -o "$CANONICAL"

python3 - "$CANONICAL" "$DEST_CORE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); dest=sys.argv[2]
text=p.read_text(encoding='utf-8')
old='DEST="/opt/labetaillere-map-v2-src/map-v2/public/carte-core-canonical-v4-preview.html"'
new=f'DEST="{dest}"'
if text.count(old) != 1:
    raise SystemExit(f"ERREUR: ancre DEST canonique trouvée {text.count(old)} fois")
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
PY
chmod 0755 "$CANONICAL"
bash "$CANONICAL"

[[ -f "$DEST_CORE" ]] || { echo "ERREUR : core intégré non généré" >&2; exit 5; }
CANONICAL_SHA="$(sha256sum "$DEST_CORE" | awk '{print $1}')"
echo "Core V4 reconstruit depuis l'UI actuelle : $CANONICAL_SHA"

# ---------------------------------------------------------------------------
# 2) Appliquer le correctif CFL V3 validé à CETTE nouvelle preview.
# ---------------------------------------------------------------------------
echo "=== 2/5 Shapes CFL + points techniques ==="
CFL="$TMP/install-cfl-v3.sh"
curl -fsSL \
  "https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${COMMIT}/vps/map-v2/install-cfl-official-motion-v3.sh" \
  -o "$CFL"

python3 - "$CFL" "$DEST_CORE" "$CANONICAL_SHA" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); dest=sys.argv[2]; sha=sys.argv[3]
text=p.read_text(encoding='utf-8')
old_preview='PREVIEW="$ROOT/public/carte-core-canonical-v4-preview.html"'
new_preview=f'PREVIEW="{dest}"'
old_sha='EXPECTED_SHA="ddfeca4d55da02ec4bd8efe5340cf4d4501861259a3cc5bc6072b9ca36f1a857"'
new_sha=f'EXPECTED_SHA="{sha}"'
if text.count(old_preview) != 1:
    raise SystemExit(f"ERREUR: ancre PREVIEW CFL trouvée {text.count(old_preview)} fois")
if text.count(old_sha) != 1:
    raise SystemExit(f"ERREUR: ancre SHA CFL trouvée {text.count(old_sha)} fois")
text=text.replace(old_preview,new_preview,1).replace(old_sha,new_sha,1)
p.write_text(text,encoding='utf-8')
PY
chmod 0755 "$CFL"
bash "$CFL"

# ---------------------------------------------------------------------------
# 3) Wrapper de test complet avec le pont de gare dynamique Luxembourg.
#    C'est la même logique que carte.html : carte <-> gare dynamique.
# ---------------------------------------------------------------------------
echo "=== 3/5 Wrapper complet + gare dynamique Luxembourg ==="
CACHE_BUST="$(date +%s)"
cat > "$TMP/carte-current-v4-preview.html" <<EOF
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <title>Carte La Bétaillère — Preview V4 complète</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020611}
    #mapV2{display:block;width:100%;height:100%;border:0;background:#020611}
    #lbMapBack{position:fixed;z-index:20;top:10px;left:10px;display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:7px 11px;border:1px solid rgba(49,231,242,.42);border-radius:10px;background:rgba(3,16,25,.94);color:#effcff;font:800 12px/1.1 Rajdhani,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.32);cursor:pointer}
    #lbMapBack[hidden]{display:none!important}
    #lbMapBack:hover,#lbMapBack:focus-visible{border-color:#31e7f2;outline:2px solid rgba(49,231,242,.22);outline-offset:2px}
    @media(max-width:700px){#lbMapBack{top:7px;left:7px;min-height:34px;padding:6px 9px;font-size:11px}}
  </style>
</head>
<body>
<button id="lbMapBack" type="button" hidden aria-label="Retour à la carte">← Retour à la carte</button>
<iframe id="mapV2" src="./carte-core-current-v4-preview.html?v=${CACHE_BUST}" title="Carte La Bétaillère" allow="geolocation"></iframe>
<script>
(()=>{
  const frame=document.getElementById('mapV2');
  const back=document.getElementById('lbMapBack');
  const MAP_URL='./carte-core-current-v4-preview.html?v=${CACHE_BUST}';
  const LUX_URL='${LUX_URL}';
  let view='map';
  function showMap(){
    if(view==='map') return;
    view='map'; back.hidden=true; frame.title='Carte La Bétaillère'; frame.src=MAP_URL;
  }
  function showLuxDynamic(){
    if(view==='lux') return;
    view='lux'; back.hidden=false; frame.title='Gare dynamique de Luxembourg'; frame.src=LUX_URL;
  }
  back.addEventListener('click',showMap);
  window.addEventListener('message',event=>{
    if(event.source===frame.contentWindow){
      if(event.data?.type==='lb:open-lux-dynamic'){ showLuxDynamic(); return; }
      if(window.parent!==window) window.parent.postMessage(event.data,'*');
      return;
    }
    if(window.parent!==window && event.source===window.parent){
      frame.contentWindow?.postMessage(event.data,'*');
    }
  });
})();
</script>
</body>
</html>
EOF
install -m 0644 "$TMP/carte-current-v4-preview.html" "$DEST_WRAPPER"

# ---------------------------------------------------------------------------
# 4) Contrôles : markers métier + conservation de marqueurs UI de la base.
# ---------------------------------------------------------------------------
echo "=== 4/5 Vérifications structurelles ==="
python3 - "$SOURCE_CORE" "$DEST_CORE" "$DEST_WRAPPER" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
dst=Path(sys.argv[2]).read_text(encoding='utf-8')
wrap=Path(sys.argv[3]).read_text(encoding='utf-8')

assert len(dst) >= len(src), (len(src),len(dst))
assert 'LB_CANONICAL_MAP_PREVIEW_V1' in dst
assert 'LB_CFL_OFFICIAL_MOTION_V3' in dst
assert 'sanitizeTechnicalCflStopTimes();' in dst
assert 'lbOfficialCflSegmentPath(trip_id, seq, i)' in dst
assert "CANONICAL_V4_SNAPSHOT_URL = './v4-preview/data/snapshot.json'" in dst
assert 'SELECTED_TRAIN_MISSING_GRACE_MS = 30000' in dst
assert 'BER_LUX_TERMINUS_DELAY_V9' in dst
assert 'BER_SNCF_FRANCE_AUTHORITY_V2_START' in dst

# Ces fonctions/éléments de l'interface actuelle doivent survivre à la fusion.
for needle in (
    'renderStationPanel',
    'renderTripPanel',
    'renderAxisStations',
    'lb:open-lux-dynamic',
):
    if needle in src:
        assert needle in dst, needle

assert 'carte-core-current-v4-preview.html' in wrap
assert 'luxembourg-user-preview-v5-private-maplike-trainclick.html' in wrap
assert 'lb:open-lux-dynamic' in wrap
print(f"Structure OK : base={len(src)} octets -> intégrée={len(dst)} octets")
PY

systemctl is-active --quiet "$SERVICE"
echo "service carte actif"

# ---------------------------------------------------------------------------
# 5) Protection absolue : la production ne doit avoir changé ni côté core,
#    ni côté wrapper existant.
# ---------------------------------------------------------------------------
echo "=== 5/5 Production intacte ==="
SOURCE_CORE_SHA_AFTER="$(sha256sum "$SOURCE_CORE" | awk '{print $1}')"
if [[ "$SOURCE_CORE_SHA_AFTER" != "$SOURCE_CORE_SHA_BEFORE" ]]; then
  echo "ERREUR CRITIQUE : carte-core-preview.html de production a changé" >&2
  exit 6
fi
if [[ -n "$SOURCE_WRAPPER_SHA_BEFORE" ]]; then
  SOURCE_WRAPPER_SHA_AFTER="$(sha256sum "$SOURCE_WRAPPER" | awk '{print $1}')"
  if [[ "$SOURCE_WRAPPER_SHA_AFTER" != "$SOURCE_WRAPPER_SHA_BEFORE" ]]; then
    echo "ERREUR CRITIQUE : carte-preview.html de production a changé" >&2
    exit 7
  fi
fi

echo "Production core : INTACTE ($SOURCE_CORE_SHA_AFTER)"
[[ -n "$SOURCE_WRAPPER_SHA_BEFORE" ]] && echo "Wrapper actuel  : INTACT ($SOURCE_WRAPPER_SHA_BEFORE)"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo "PREVIEW COMPLETE PRETE"
echo "============================================================"
echo "Carte actuelle UI       : conservée comme base"
echo "Data Engine V4          : activé"
echo "Shapes CFL officielles  : activées pour le mouvement"
echo "Points techniques CFL   : masqués côté voyageur"
echo "Gare dynamique Lux      : pont conservé"
echo "Production              : NON MODIFIEE"
echo
echo "URL : https://vps.labetaillere.fr/map-v2/carte-current-v4-preview.html"
echo "============================================================"
