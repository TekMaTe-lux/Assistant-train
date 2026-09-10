#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — production #carte en lecture seule sur le réseau ferroviaire.
# Objectif :
# - garder le core/UI/fonctions actuels ;
# - garder le réseau cyan via /api/map-v2/infrastructure?bbox=... ;
# - laisser le moteur historique retomber sur ce réseau pour le calcul des tracés ;
# - NE PLUS télécharger les ~67 Mo de moorail-live-v1/sections.json à chaque ouverture ;
# - NE PLUS télécharger network.json via la chaîne MooRail V8 au démarrage de #carte ;
# - ne toucher ni à France V3, ni aux datasets, ni au rollover, ni à la communauté, ni aux votes.

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/prod-readonly-network-fast-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-prod-readonly-fast-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup; return 0; fi
  echo >&2
  echo "ERREUR — rollback automatique..." >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE" || true
  [[ -f "$BACKUP/carte-preview.html" ]] && cp -a "$BACKUP/carte-preview.html" "$WRAPPER" || true
  cleanup
  echo "Rollback terminé." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$CORE" ]] || { echo "ERREUR: core absent: $CORE" >&2; exit 3; }
[[ -f "$WRAPPER" ]] || { echo "ERREUR: wrapper absent: $WRAPPER" >&2; exit 3; }
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 4; }
command -v node >/dev/null || { echo "ERREUR: node absent" >&2; exit 4; }

# On ne travaille que sur le socle actuellement restauré.
for token in \
  'LB_SERVICE_DAY_ROLLOVER_V1' \
  'LB_MOORAIL_LIVE_PATH_V44' \
  'LB_MOORAIL_VALIDATED_NETWORK_V8' \
  'LB_MOORAIL_SELECTED_ROUTE_V52' \
  'api/map-v2/infrastructure'; do
  grep -qF "$token" "$CORE" || { echo "ERREUR: socle inattendu, token absent: $token" >&2; exit 5; }
done

# L'ancien patch startup-safe ne doit pas être là.
if grep -qF 'LB_MAP_STARTUP_SAFE_V1' "$CORE"; then
  echo "ERREUR: STARTUP_SAFE encore présent. Rien n'est modifié." >&2
  exit 6
fi

# Vérifier que le serveur du réseau cyan répond AVANT toute modification.
curl -fsS --max-time 15 \
  'http://127.0.0.1:3111/api/map-v2/infrastructure?bbox=5.70,48.45,6.35,49.65' \
  -o "$TMP/infra.json"
python3 - "$TMP/infra.json" <<'PY'
import json,sys,os
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
fs=d.get('features') or []
assert d.get('type')=='FeatureCollection', d.get('type')
assert len(fs)>50, len(fs)
print('Réseau cyan serveur :',len(fs),'features /',round(os.path.getsize(p)/1024/1024,3),'Mo')
PY

mkdir -p "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"

echo "============================================================"
echo " LA BETAILLERE — #CARTE READ-ONLY / RESEAU LOCAL RAPIDE"
echo "============================================================"
echo "Backup : $BACKUP"
echo

cp -a "$CORE" "$TMP/core.html"
python3 - "$TMP/core.html" <<'PY'
from pathlib import Path
import sys,re
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_PROD_READONLY_NETWORK_FAST_V1 */'
if marker in s:
    print('Déjà patché')
    raise SystemExit(0)

# 1) Le chargement GTFS de production ne doit plus attendre le gros fichier MooRail.
needle='      await lbLoadMoorailOverrides();'
count=s.count(needle)
if count != 1:
    raise SystemExit(f'ERREUR: appel startup lbLoadMoorailOverrides trouvé {count} fois, attendu 1')
s=s.replace(needle, "      /* LB_PROD_READONLY_NETWORK_FAST_V1: pas de chargement global MooRail en production */", 1)

# 2) Garde-fou : même si un futur code appelle lbLoadMoorailOverrides(),
# la production reste en lecture seule sur l'infrastructure locale et ne télécharge pas sections.json.
pat=re.compile(r'(  async function lbLoadMoorailOverrides\(\)\{\n)')
m=pat.search(s)
if not m:
    raise SystemExit('ERREUR: fonction lbLoadMoorailOverrides introuvable')
short=(
"    /* LB_PROD_READONLY_NETWORK_FAST_V1 */\n"
"    lbMoorailLivePairs.clear();\n"
"    lbMoorailLiveLoaded=false;\n"
"    return;\n"
)
s=s[:m.end()]+short+s[m.end():]

# 3) Aucun changement au resolver/pathBetweenStops : avec lbMoorailLiveLoaded=false,
# les overrides MooRail renvoient null et le moteur historique retombe naturellement
# sur le réseau/infrastructure déjà chargé par la carte.

# Garde-fous fonctionnels.
for req in [
    'LB_SERVICE_DAY_ROLLOVER_V1',
    'LB_MOORAIL_LIVE_PATH_V44',
    'LB_MOORAIL_VALIDATED_NETWORK_V8',
    'LB_MOORAIL_SELECTED_ROUTE_V52',
    'api/map-v2/infrastructure',
    'lb-community-traveler-v1',
    'lb-community-traveler-compact-v2'
]:
    if req not in s:
        raise SystemExit('ERREUR: élément requis perdu: '+req)

# Il est normal que les URLs restent dans du code désormais inatteignable ;
# le garde-fou ci-dessus empêche toute exécution sur #carte.
if s.count(marker) < 2:
    raise SystemExit('ERREUR: garde-fou read-only incomplet')

p.write_text(s,encoding='utf-8')
PY

# Vérifie tous les scripts inline avant publication.
python3 - "$TMP/core.html" "$TMP" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import subprocess,sys
class P(HTMLParser):
    def __init__(self): super().__init__(); self.on=False; self.cur=[]; self.parts=[]
    def handle_starttag(self,t,a):
        if t=='script':
            d=dict(a)
            self.on='src' not in d and d.get('type','') not in ('application/json','application/ld+json')
            self.cur=[]
    def handle_data(self,d):
        if self.on:self.cur.append(d)
    def handle_endtag(self,t):
        if t=='script' and self.on:
            self.parts.append(''.join(self.cur)); self.on=False
q=P();q.feed(Path(sys.argv[1]).read_text(encoding='utf-8'))
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js'; f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode:
        raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript inline : OK —',len(q.parts),'bloc(s)')
PY

install -o root -g root -m 0644 "$TMP/core.html" "$CORE"

# Cache-bust uniquement le wrapper local.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
changed=0
# Cas courant : carte-core-preview.html?...&v=...
s2,n=re.subn(r'(carte-core-preview\.html\?[^"\']*?\bv=)[^"\'& ]+',r'\g<1>20260910-readonly-network-fast-v1',s,count=1)
if n:
    s=s2; changed=n
else:
    # Si pas de v=, l'ajouter sans toucher au reste de l'URL.
    s2,n=re.subn(r'(carte-core-preview\.html\?[^"\']+)(["\'])',r'\1&v=20260910-readonly-network-fast-v1\2',s,count=1)
    if n:
        s=s2; changed=n
if not changed:
    raise SystemExit('ERREUR: référence carte-core-preview.html introuvable dans wrapper')
p.write_text(s,encoding='utf-8')
PY

# Contrôles finaux locaux + servi.
grep -qF 'LB_PROD_READONLY_NETWORK_FAST_V1' "$CORE"
grep -qF 'api/map-v2/infrastructure' "$CORE"
grep -qF 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$CORE"

# Le seul appel exécutable startup a disparu.
if grep -F '      await lbLoadMoorailOverrides();' "$CORE" >/dev/null; then
  echo "ERREUR: appel startup lourd encore présent" >&2
  exit 7
fi

# Vérification du contenu servi sans redémarrage destructif.
curl -fsS --max-time 10 \
  "http://127.0.0.1:3111/carte-core-preview.html?v=$STAMP" \
  -o "$TMP/served.html"
grep -qF 'LB_PROD_READONLY_NETWORK_FAST_V1' "$TMP/served.html"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " OK — #CARTE REVIENT AU PRINCIPE READ-ONLY"
echo "============================================================"
echo "Réseau cyan / infrastructure : CONSERVE"
echo "Infrastructure par bbox      : OUI (~1.3 Mo sur le Sillon)"
echo "sections.json ~67 Mo startup : NON CHARGE"
echo "network.json via MooRail     : NON CHARGE AU STARTUP"
echo "Fallback réseau historique   : ACTIF"
echo "Rollover                     : INCHANGE"
echo "Communauté / pouces          : INCHANGES"
echo "France V3                    : NON TOUCHEE"
echo "Datasets MooRail             : NON TOUCHES"
echo "Service                      : NON REDÉMARRÉ"
echo "Backup                       : $BACKUP"
echo "Core SHA                     : $(sha256sum "$CORE" | awk '{print $1}')"
echo "============================================================"
