#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src/map-v2"
PUBLIC="$ROOT/public"
PROD_CORE="$PUBLIC/carte-core-preview.html"
CANDIDATE_CORE="$PUBLIC/carte-core-current-v4-preview.html"
PROD_WRAPPER="$PUBLIC/carte-preview.html"
SNAPSHOT="$PUBLIC/v4-preview/data/snapshot.json"
TRIPS="$ROOT/data/generated/trips.json"
PATHS="$ROOT/data/generated/paths.json"
BUILDER="$ROOT/scripts/build_dataset.py"
SERVICE="labetaillere-map-v2.service"
VERSION="20260902-v4-canonical-prod"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/promote-canonical-v4-production-$STAMP"
TMP="$(mktemp -d /tmp/lb-promote-v4.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo
  echo "ERREUR : rollback automatique de la carte de production..."
  [[ -f "$BACKUP/$(basename "$PROD_CORE")" ]] && cp -a "$BACKUP/$(basename "$PROD_CORE")" "$PROD_CORE"
  [[ -f "$BACKUP/$(basename "$PROD_WRAPPER")" ]] && cp -a "$BACKUP/$(basename "$PROD_WRAPPER")" "$PROD_WRAPPER"
  if [[ "$RESTARTED" -eq 1 ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
trap 'rollback; cleanup' EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR : lancer avec sudo/root" >&2
  exit 2
fi

for f in "$PROD_CORE" "$CANDIDATE_CORE" "$PROD_WRAPPER" "$SNAPSHOT" "$TRIPS" "$PATHS" "$BUILDER"; do
  [[ -f "$f" ]] || { echo "ERREUR : fichier absent: $f" >&2; exit 3; }
done

mkdir -p "$BACKUP"
cp -a "$PROD_CORE" "$PROD_WRAPPER" "$BACKUP/"

CORE_BEFORE="$(sha256sum "$PROD_CORE" | awk '{print $1}')"
WRAPPER_BEFORE="$(sha256sum "$PROD_WRAPPER" | awk '{print $1}')"
CANDIDATE_SHA="$(sha256sum "$CANDIDATE_CORE" | awk '{print $1}')"

echo "============================================================"
echo "BASCULE PRODUCTION — CARTE ACTUELLE + LOGIQUE CANONIQUE V4"
echo "============================================================"
echo "Backup          : $BACKUP"
echo "Core production : $CORE_BEFORE"
echo "Core candidat   : $CANDIDATE_SHA"
echo "Wrapper actuel  : $WRAPPER_BEFORE"
echo

echo "=== 1/6 Vérification de TOUTE la chaîne avant bascule ==="
# Moteur canonique V4 + mouvement CFL officiel + points techniques.
grep -q 'LB_CANONICAL_MAP_PREVIEW_V1' "$CANDIDATE_CORE" || { echo "ERREUR : moteur canonique V4 absent" >&2; exit 10; }
grep -q 'LB_CFL_OFFICIAL_MOTION_V3' "$CANDIDATE_CORE" || { echo "ERREUR : shapes CFL officielles absentes" >&2; exit 11; }
grep -q 'sanitizeTechnicalCflStopTimes' "$CANDIDATE_CORE" || { echo "ERREUR : filtre points techniques CFL absent" >&2; exit 12; }

# Snapshot V4 réellement exploitable.
python3 - "$SNAPSHOT" <<'PY'
import json,sys
p=sys.argv[1]
o=json.load(open(p,encoding='utf-8'))
api=o.get('apiVersion')
schema=str(o.get('schemaVersion') or '')
if str(api) != '4':
    raise SystemExit(f'apiVersion V4 invalide: {api!r}')
if 'canonical' not in schema.lower():
    raise SystemExit(f'schema canonique absent: {schema!r}')
print('Snapshot V4 OK:', 'apiVersion='+str(api), 'schemaVersion='+schema)
PY

# Le routage TGV V3 doit être durable ET présent dans le dataset partagé.
grep -q 'BER_TGV_REQUIRED_CONNECTOR_V3' "$BUILDER" || { echo "ERREUR : builder sans règle TGV 005341 V3" >&2; exit 14; }
python3 - "$TRIPS" "$PATHS" <<'PY'
import json,sys
trips=json.load(open(sys.argv[1],encoding='utf-8'))
paths=json.load(open(sys.argv[2],encoding='utf-8'))
rows=[t for t in trips.values() if str(t.get('number') or '')=='2870' and t.get('pathSource')=='BER_TGV_REQUIRED_005341_V3']
if not rows:
    raise SystemExit('2870 V3 absent du dataset')
ids={t.get('pathId') for t in rows}
for pid in ids:
    p=paths.get(pid) or {}
    if p.get('requiredConnector')!='005341' or p.get('forbiddenConnector')!='005340':
        raise SystemExit(f'path TGV V3 incohérent: {pid}')
print(f'TGV V3 OK: 2870={len(rows)} variantes ; paths={len(ids)} ; 005341 obligatoire')
PY

# L'interface reste le wrapper de production existant. On ne le reconstruira pas :
# seule l'URL interne du core sera cache-bustée. Cela préserve ses tableaux/tabs
# et toute sa logique actuelle, quelle que soit son implémentation interne.
grep -q 'carte-core-preview.html' "$PROD_WRAPPER" || { echo "ERREUR : wrapper production sans référence au core" >&2; exit 15; }
echo "Chaîne validée : wrapper actuel + V4 + CFL + TGV V3"

echo
echo "=== 2/6 Promotion du core V4 sur le nom de production ==="
install -m 0644 "$CANDIDATE_CORE" "$PROD_CORE"
cmp -s "$CANDIDATE_CORE" "$PROD_CORE" || { echo "ERREUR : copie core incomplète" >&2; exit 20; }
echo "Core production = candidat V4 ($CANDIDATE_SHA)"

echo
echo "=== 3/6 Cache-busting du wrapper SANS modifier son UI ==="
python3 - "$PROD_WRAPPER" "$VERSION" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); version=sys.argv[2]
text=p.read_text(encoding='utf-8')
pattern=re.compile(r"carte-core-preview\.html(?:\?[^\"'`\s<>]*)?")
matches=list(pattern.finditer(text))
if not matches:
    raise SystemExit('aucune URL carte-core-preview.html dans le wrapper')
replacement=f'carte-core-preview.html?lbEmbedded=1&v={version}'
patched,count=pattern.subn(replacement,text)
# En dehors de l'URL du core, le wrapper doit rester strictement identique.
neutral_before=pattern.sub('__LB_CORE__',text)
neutral_after=re.sub(r'carte-core-preview\.html\?lbEmbedded=1&v='+re.escape(version),'__LB_CORE__',patched)
if neutral_before != neutral_after:
    raise SystemExit('modification inattendue du wrapper hors URL core')
p.write_text(patched,encoding='utf-8')
print(f'Wrapper : {count} référence(s) core mise(s) à jour ; UI inchangée')
PY

grep -q "carte-core-preview.html?lbEmbedded=1&v=$VERSION" "$PROD_WRAPPER" || { echo "ERREUR : cache-bust non appliqué" >&2; exit 21; }

echo
echo "=== 4/6 Contrôles statiques APRÈS bascule ==="
grep -q 'LB_CANONICAL_MAP_PREVIEW_V1' "$PROD_CORE"
grep -q 'LB_CFL_OFFICIAL_MOTION_V3' "$PROD_CORE"
grep -q 'sanitizeTechnicalCflStopTimes' "$PROD_CORE"
CORE_AFTER="$(sha256sum "$PROD_CORE" | awk '{print $1}')"
[[ "$CORE_AFTER" == "$CANDIDATE_SHA" ]] || { echo "ERREUR : SHA core production différent du candidat" >&2; exit 23; }

# Vérifie que le wrapper n'a changé que par l'URL interne du core.
python3 - "$BACKUP/$(basename "$PROD_WRAPPER")" "$PROD_WRAPPER" <<'PY'
from pathlib import Path
import re,sys
before=Path(sys.argv[1]).read_text(encoding='utf-8')
after=Path(sys.argv[2]).read_text(encoding='utf-8')
pat=re.compile(r"carte-core-preview\.html(?:\?[^\"'`\s<>]*)?")
if pat.sub('__LB_CORE__',before) != pat.sub('__LB_CORE__',after):
    raise SystemExit('wrapper UI modifié hors URL core')
print('Wrapper UI : strictement conservé hors URL core')
PY

echo
echo "=== 5/6 Redémarrage + santé API carte ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >"$TMP/health.json" 2>/dev/null; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE" || { echo "ERREUR : service carte inactif" >&2; exit 30; }
python3 - "$TMP/health.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
if not p.get('ok'):
    raise SystemExit('health API map-v2 != ok')
print('API carte OK:', p)
PY

# Vérifie aussi que l'API choisit le dataset TGV V3 déjà installé.
python3 - <<'PY'
import json,urllib.parse,urllib.request
q=urllib.parse.urlencode({'stops':'Luxembourg|Thionville|Metz|Paris Est','profile':'tgv','number':'2870'})
with urllib.request.urlopen('http://127.0.0.1:3111/api/map-v2/match-path?'+q,timeout=5) as r:
    p=json.load(r)
pid=str(p.get('pathId') or '')
if not pid.startswith('p-ber3-'):
    raise SystemExit(f'API TGV encore sur un ancien path: {pid}')
print('API TGV V3 OK:', pid)
PY

echo
echo "=== 6/6 Vérification finale ==="
WRAPPER_AFTER="$(sha256sum "$PROD_WRAPPER" | awk '{print $1}')"
echo "Core production : $CORE_AFTER"
echo "Wrapper prod    : $WRAPPER_AFTER"
echo "Version core    : $VERSION"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo "LOGIQUE CANONIQUE V4 BRANCHEE EN PRODUCTION"
echo "============================================================"
echo "UI / tableaux actuels       : CONSERVES (wrapper inchangé)"
echo "Gare dynamique Luxembourg   : CONSERVEE par le flux UI actuel"
echo "Data Engine V4              : ACTIF"
echo "Autorité SNCF FR / CFL LU   : ACTIF"
echo "Shapes CFL officielles      : ACTIVES"
echo "Points techniques frontière : FILTRES"
echo "TGV Paris-Metz-Lux 005341   : ACTIF"
echo "Production core             : $CORE_AFTER"
echo "Rollback disponible         : $BACKUP"
echo "============================================================"
