#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
SERVER="$ROOT/server/server.mjs"
API_FILE="$ROOT/server/route-editor-api.mjs"
PAGE="$ROOT/public/moorail-route-editor.html"
STORE="$ROOT/data/route-editor"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-v1-$STAMP"
RAW="${MOORAIL_API_RAW:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/route-editor/route-editor-api.mjs}"
NO_RESTART="${MOORAIL_NO_RESTART:-0}"

[ -f "$SERVER" ] || { echo "ERREUR: $SERVER introuvable" >&2; exit 1; }
mkdir -p "$BACKUP" "$STORE"
cp -a "$SERVER" "$BACKUP/server.mjs"
[ ! -f "$API_FILE" ] || cp -a "$API_FILE" "$BACKUP/route-editor-api.mjs.previous"
[ ! -f "$PAGE" ] || cp -a "$PAGE" "$BACKUP/moorail-route-editor.html.previous"

if [[ "$RAW" == http* ]]; then curl -fsSL "$RAW?$(date +%s)" -o "$API_FILE"; else curl -fsSL "$RAW" -o "$API_FILE"; fi
cat > /tmp/moorail-route-editor-v1.html.gz.b64 <<'__HTML_B64__'
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
rk/81b4deSS/IXsk/vN4/x84ntgQL28AAA==
__HTML_B64__
base64 -d /tmp/moorail-route-editor-v1.html.gz.b64 | gzip -dc > "$PAGE"
rm -f /tmp/moorail-route-editor-v1.html.gz.b64

python3 - "$SERVER" <<'__PATCH__'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
if '// MOORAIL_ROUTE_EDITOR_V1_IMPORT' not in s:
    a="// MOORAIL_ROUTE_EDITOR_V1_IMPORT\nimport { createMoorailRouteEditorHandler } from './route-editor-api.mjs';\n"
    if s.startswith('#!'):
        i=s.find('\n')+1; s=s[:i]+a+s[i:]
    else: s=a+s
if '// MOORAIL_ROUTE_EDITOR_V1_INIT' not in s:
    n='const server = http.createServer((req, res) => {'
    if n not in s: raise SystemExit('ERREUR: création serveur HTTP introuvable')
    a="""// MOORAIL_ROUTE_EDITOR_V1_INIT
const moorailRouteEditorHandler =
  createMoorailRouteEditorHandler({
    trips,
    send,
    storeDir: path.resolve(process.cwd(), 'data/route-editor')
  });

"""
    s=s.replace(n,a+n,1)
if '// MOORAIL_ROUTE_EDITOR_V1_HOOK' not in s:
    n="  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);"
    if n not in s: n="const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);"
    if n not in s: raise SystemExit('ERREUR: analyse URL introuvable')
    ind=n[:len(n)-len(n.lstrip())]
    s=s.replace(n,n+'\n'+ind+'// MOORAIL_ROUTE_EDITOR_V1_HOOK\n'+ind+'if (moorailRouteEditorHandler(req, res, url)) return;',1)
p.write_text(s,encoding='utf-8')
__PATCH__

chmod 0644 "$SERVER" "$API_FILE" "$PAGE"
chown -R ubuntu:ubuntu "$STORE" "$API_FILE" "$PAGE" 2>/dev/null || true
node --check "$API_FILE"
node --check "$SERVER"

cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/server.mjs' '$SERVER'
if [ -f '$BACKUP/route-editor-api.mjs.previous' ]; then cp -a '$BACKUP/route-editor-api.mjs.previous' '$API_FILE'; else rm -f '$API_FILE'; fi
if [ -f '$BACKUP/moorail-route-editor.html.previous' ]; then cp -a '$BACKUP/moorail-route-editor.html.previous' '$PAGE'; else rm -f '$PAGE'; fi
sudo systemctl restart labetaillere-map-v2.service
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

if [ "$NO_RESTART" = "1" ]; then
  echo "Installation test sans redémarrage."
  exit 0
fi

sudo systemctl restart labetaillere-map-v2.service
sleep 1
sudo systemctl is-active --quiet labetaillere-map-v2.service
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
curl -fsS http://127.0.0.1:3111/api/map-v2/route-editor/catalog -o "$TMP"
python3 - "$TMP" <<'__CHECK__'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') is True
r=d.get('routes') or []
print(f"OK catalogue: {len(r)} variantes grande vitesse")
for x in r[:8]:
    p=x.get('progress') or {}
    print(f"- {x.get('origin')} -> {x.get('destination')} : {p.get('validated',0)}/{p.get('total',0)} sections · {x.get('tripCount',0)} trips")
__CHECK__
curl -fsS http://127.0.0.1:3111/moorail-route-editor.html -o /dev/null

echo
echo "MOO RAIL ROUTE EDITOR V1 OK"
echo "https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Backup: $BACKUP"
echo "Rollback: sudo bash $BACKUP/ROLLBACK.sh"
echo "Les validations restent isolées de la production dans $STORE"
