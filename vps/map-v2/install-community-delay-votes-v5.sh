#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " LA BETAILLERE — COMMUNITY VOTES V5 / MOBILE + PERF"
echo "============================================================"

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
ASSET_DIR="$PUBLIC/assets"
TARGET="$ASSET_DIR/lb-community-traveler-vote-v3.js"
SOURCE_URL="${LB_VOTE_SOURCE_URL:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/c8845251a5fa322c11c0af8204a2c5e0726c78f3/vps/map-v2/lb-community-traveler-vote-v3.js}"
VERSION="20260910-6"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/map-v2/backups/community-delay-votes-v5-$STAMP"
TMP_JS="$(mktemp /tmp/lb-community-delay-vote-v3.XXXXXX.js)"
SUCCESS=0

cleanup(){ rm -f "$TMP_JS"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR : rollback automatique..." >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE"
  if [[ -f "$BACKUP/lb-community-traveler-vote-v3.js" ]]; then
    cp -a "$BACKUP/lb-community-traveler-vote-v3.js" "$TARGET"
  else
    rm -f "$TARGET"
  fi
}
trap 'rollback; cleanup' EXIT

[[ -f "$CORE" ]] || { echo "ERREUR: core introuvable: $CORE" >&2; exit 2; }
install -d -m 0755 "$ASSET_DIR" "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
[[ -f "$TARGET" ]] && cp -a "$TARGET" "$BACKUP/lb-community-traveler-vote-v3.js"
[[ -f "$ASSET_DIR/lb-community-traveler-vote-v2.js" ]] && cp -a "$ASSET_DIR/lb-community-traveler-vote-v2.js" "$BACKUP/lb-community-traveler-vote-v2.js"

echo "[1/6] Téléchargement V3 optimisée…"
curl -fsSL "${SOURCE_URL}?v=$STAMP" -o "$TMP_JS"
grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V3__' "$TMP_JS" || { echo "ERREUR: mauvais module téléchargé" >&2; exit 3; }
grep -q "text = text.replace(' ', 'T') + 'Z'" "$TMP_JS" || { echo "ERREUR: correctif UTC absent" >&2; exit 4; }
grep -q "grid-template-areas:'title status actions' 'source source source'" "$TMP_JS" || { echo "ERREUR: correctif mobile absent" >&2; exit 5; }

if command -v node >/dev/null 2>&1; then
  echo "[2/6] Contrôle syntaxique Node…"
  node --check "$TMP_JS"
else
  echo "[2/6] Node absent — contrôle syntaxique ignoré"
fi

echo "[3/6] Installation atomique du module…"
install -m 0644 "$TMP_JS" "$TARGET"

echo "[4/6] Branchement dans le core…"
python3 - "$CORE" "$VERSION" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); version=sys.argv[2]
s=p.read_text(encoding='utf-8')
marker=f'<script id="lb-community-traveler-vote-v3" src="./assets/lb-community-traveler-vote-v3.js?v={version}"></script>'

# Retire uniquement nos modules de vote successifs, jamais V1/V2 communautaires historiques.
s=re.sub(r'\s*<script\s+id="lb-community-traveler-vote-v[123]"\s+src="[^"]+"\s*></script>', '', s, flags=re.I)
compact=re.search(r'<script\s+id="lb-community-traveler-compact-v2"\s+src="\./assets/lb-community-traveler-compact-v2\.js\?v=[^"]+"\s*></script>',s,flags=re.I)
if compact:
    pos=compact.end(); s=s[:pos]+'\n'+marker+s[pos:]
else:
    closing=s.lower().rfind('</body>')
    if closing<0: raise SystemExit('ERREUR: compact-v2 et </body> absents')
    s=s[:closing]+marker+'\n'+s[closing:]
p.write_text(s,encoding='utf-8')
PY

COUNT="$(grep -c 'id="lb-community-traveler-vote-v3"' "$CORE" || true)"
[[ "$COUNT" = "1" ]] || { echo "ERREUR: nombre de balises V3=$COUNT" >&2; exit 6; }
grep -q "lb-community-traveler-vote-v3.js?v=$VERSION" "$CORE" || { echo "ERREUR: src V3 absent" >&2; exit 7; }

if command -v node >/dev/null 2>&1; then node --check "$TARGET"; fi

echo "[5/6] Vérification des optimisations…"
grep -q "Aucune API communautaire n'est appelée tant qu'un retard voyageur n'est pas ouvert" "$TARGET"
grep -q "@media (max-width:700px), (pointer:coarse)" "$TARGET"
grep -q "width:21px!important" "$TARGET"
echo "- API votes au démarrage : SUPPRIMÉE"
echo "- UTC commentaires          : OK"
echo "- pouces mobile             : 21 px / ligne pleine largeur"

echo "[6/6] Vérification publique…"
SERVED_CORE="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$STAMP" || true)"
if grep -q "lb-community-traveler-vote-v3.js?v=$VERSION" <<<"$SERVED_CORE"; then
  echo "Core public   : OK / $VERSION"
else
  echo "ATTENTION: core public pas encore rafraîchi"
fi
TMP_PUBLIC="$(mktemp /tmp/lb-vote-v5-public.XXXXXX.js)"
HTTP="$(curl -sS -o "$TMP_PUBLIC" -w '%{http_code}' "https://vps.labetaillere.fr/map-v2/assets/lb-community-traveler-vote-v3.js?t=$STAMP" || true)"
if [[ "$HTTP" == "200" ]] && grep -q '__LB_COMMUNITY_TRAVELER_VOTE_V3__' "$TMP_PUBLIC"; then
  echo "Module public : HTTP 200 / V3 OK"
else
  echo "ATTENTION: module public non vérifié (HTTP $HTTP)"
fi
rm -f "$TMP_PUBLIC"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "OK — V5 installée. Votes chargés à la demande, pouces mobile renforcés."
echo "Sauvegarde : $BACKUP"
echo "Core        : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module V3   : $(sha256sum "$TARGET" | awk '{print $1}')"
echo "Rollback    : cp '$BACKUP/carte-core-preview.html' '$CORE'"
