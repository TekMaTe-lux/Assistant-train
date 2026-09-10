#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " LA BETAILLERE — COMMUNITY DELAY VOTES V4 / UTC FIX"
echo "============================================================"

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
JS="$PUBLIC/assets/lb-community-traveler-vote-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_DIR="$ROOT/map-v2/backups/community-delay-votes-v4-$STAMP"

[[ -f "$CORE" ]] || { echo "ERREUR: core introuvable: $CORE" >&2; exit 2; }
[[ -f "$JS" ]] || { echo "ERREUR: module V2 introuvable: $JS" >&2; exit 3; }

echo "[1/5] Sauvegarde…"
install -d -m 0755 "$BACKUP_DIR"
cp -a "$CORE" "$BACKUP_DIR/carte-core-preview.html"
cp -a "$JS" "$BACKUP_DIR/lb-community-traveler-vote-v2.js"

echo "[2/5] Correction de l'horodatage UTC de l'API…"
python3 - "$JS" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
old = """    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
"""
new = """    let text = String(value || '').trim();
    // L'API commentaires renvoie created_at en UTC sans suffixe de fuseau,
    // ex. \"2026-09-10 09:07:28\". Date.parse() l'interprète sinon comme
    // une heure locale et vieillit artificiellement le signalement de 2 h en France.
    if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(text)) {
      text = text.replace(' ', 'T') + 'Z';
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
"""
count = s.count(old)
print('Bloc parseTs trouvé :', count)
if count != 1:
    raise SystemExit('ERREUR: bloc parseTs attendu introuvable ou dupliqué; aucun patch appliqué')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
PY

if command -v node >/dev/null 2>&1; then
  echo "[3/5] Contrôle syntaxique Node…"
  if ! node --check "$JS"; then
    echo "ERREUR JS — rollback" >&2
    cp -a "$BACKUP_DIR/lb-community-traveler-vote-v2.js" "$JS"
    cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
    exit 4
  fi
else
  echo "[3/5] Node absent — contrôle syntaxique ignoré"
fi

echo "[4/5] Cache-bust du module dans le core…"
python3 - "$CORE" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
pat = r'(<script\s+id="lb-community-traveler-vote-v2"\s+src="\./assets/lb-community-traveler-vote-v2\.js\?v=)[^"]+("\s*></script>)'
s2, n = re.subn(pat, r'\g<1>20260910-5\g<2>', s, count=1, flags=re.I)
print('Balise V2 mise à jour :', n)
if n != 1:
    raise SystemExit('ERREUR: balise V2 introuvable; rollback requis')
p.write_text(s2, encoding='utf-8')
PY

grep -q "text = text.replace(' ', 'T') + 'Z'" "$JS" || {
  echo "ERREUR: correctif UTC absent — rollback" >&2
  cp -a "$BACKUP_DIR/lb-community-traveler-vote-v2.js" "$JS"
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 5
}
grep -q 'lb-community-traveler-vote-v2.js?v=20260910-5' "$CORE" || {
  echo "ERREUR: cache-bust absent — rollback" >&2
  cp -a "$BACKUP_DIR/lb-community-traveler-vote-v2.js" "$JS"
  cp -a "$BACKUP_DIR/carte-core-preview.html" "$CORE"
  exit 6
}

echo "[5/5] Vérification publique…"
SERVED_CORE="$(curl -fsSL "https://vps.labetaillere.fr/map-v2/carte-core-preview.html?t=$STAMP" || true)"
if grep -q 'lb-community-traveler-vote-v2.js?v=20260910-5' <<<"$SERVED_CORE"; then
  echo "Core public : OK / v=20260910-5"
else
  echo "ATTENTION: core public pas encore rafraîchi"
fi
TMP_PUBLIC="$(mktemp /tmp/lb-vote-v4-public.XXXXXX.js)"
HTTP="$(curl -sS -o "$TMP_PUBLIC" -w '%{http_code}' "https://vps.labetaillere.fr/map-v2/assets/lb-community-traveler-vote-v2.js?t=$STAMP" || true)"
if [[ "$HTTP" == "200" ]] && grep -q "text = text.replace(' ', 'T') + 'Z'" "$TMP_PUBLIC"; then
  echo "Module public: HTTP 200 / UTC FIX OK"
else
  echo "ATTENTION: module public non vérifié (HTTP $HTTP)"
fi
rm -f "$TMP_PUBLIC"

echo
echo "OK — V4 installée. Les created_at SQL sont maintenant interprétés en UTC."
echo "Sauvegarde : $BACKUP_DIR"
echo "Core        : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Module V2   : $(sha256sum "$JS" | awk '{print $1}')"
echo "Rollback    : cp '$BACKUP_DIR/lb-community-traveler-vote-v2.js' '$JS' && cp '$BACKUP_DIR/carte-core-preview.html' '$CORE'"
