#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — restauration chirurgicale des parcours TGV de #carte.
# IMPORTANT :
# - ne touche PAS à france-v3-preview.html
# - ne touche PAS au rollover, GTFS lite, communauté, pouces, HAFAS/SNCF
# - restaure uniquement le comportement de routage TGV d'avant la greffe V8
# - isole les sections LIVE de production dans un snapshot stable pré-V8

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
MAP="$ROOT/map-v2"
PUBLIC="$MAP/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$MAP/backups/restore-prod-tgv-pre-v8-v1-$STAMP"
PROD_LIVE_DIR="$PUBLIC/data/moorail-live-prod-stable-v1"
PROD_LIVE="$PROD_LIVE_DIR/sections.json"
TMP="$(mktemp -d /tmp/lb-prod-tgv-prev8-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup; return 0; fi
  echo >&2
  echo "ERREUR — rollback automatique des parcours TGV..." >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE" || true
  [[ -f "$BACKUP/carte-preview.html" ]] && cp -a "$BACKUP/carte-preview.html" "$WRAPPER" || true
  if [[ -f "$BACKUP/prod-live-sections.json" ]]; then
    mkdir -p "$PROD_LIVE_DIR"
    cp -a "$BACKUP/prod-live-sections.json" "$PROD_LIVE"
  elif [[ -f "$BACKUP/prod-live-absent" ]]; then
    rm -f "$PROD_LIVE"
  fi
  cleanup
  echo "Rollback terminé." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$CORE" "$WRAPPER"; do [[ -f "$f" ]] || { echo "ERREUR: fichier absent: $f" >&2; exit 3; }; done
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 4; }
command -v node >/dev/null || { echo "ERREUR: node absent" >&2; exit 5; }

# Etat actuel attendu : bon socle restauré à 11:36 avec V44/V52 + V8/V85/V86.
for token in \
  'LB_SERVICE_DAY_ROLLOVER_V1' \
  'LB_MOORAIL_LIVE_PATH_V44' \
  'LB_MOORAIL_SELECTED_ROUTE_V52' \
  'LB_MOORAIL_VALIDATED_NETWORK_V8' \
  'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' \
  'LB_MOORAIL_SELECTED_NUMBER_V86'; do
  grep -qF "$token" "$CORE" || { echo "ERREUR: socle inattendu, token absent: $token" >&2; exit 6; }
done

# Le backup créé PAR l'installateur V8 contient l'état immédiatement AVANT V8.
# On prend le plus récent qui prouve V44 + V52, sans V8.
PREV8_DIR=""
while IFS= read -r d; do
  [[ -d "$d" ]] || continue
  c="$d/carte-core-preview.html"
  l="$d/live.json"
  [[ -f "$c" && -f "$l" ]] || continue
  if grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$c" \
     && grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$c" \
     && ! grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$c" \
     && ! grep -qF 'lbLoadMoorailV8Network' "$c"; then
    PREV8_DIR="$d"
    break
  fi
done < <(find "$MAP/backups" -mindepth 1 -maxdepth 1 -type d -name 'moorail-validated-sections-v8-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

[[ -n "$PREV8_DIR" ]] || {
  echo "ERREUR: snapshot pré-V8 V44/V52 introuvable. Rien n'est modifié." >&2
  exit 7
}

PREV8_CORE="$PREV8_DIR/carte-core-preview.html"
PREV8_LIVE="$PREV8_DIR/live.json"

# Validation JSON du snapshot avant écriture.
python3 - "$PREV8_LIVE" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
pairs=p.get('pairs') or []
assert isinstance(pairs,list) and pairs, 'snapshot LIVE vide/invalide'
coords=0
for x in pairs:
    c=x.get('coords') or x.get('coordinates') or []
    if isinstance(c,list) and len(c)>=2: coords += 1
print('Snapshot LIVE pré-V8 :',len(pairs),'paires,',coords,'avec géométrie')
PY

mkdir -p "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"
if [[ -f "$PROD_LIVE" ]]; then cp -a "$PROD_LIVE" "$BACKUP/prod-live-sections.json"; else touch "$BACKUP/prod-live-absent"; fi

mkdir -p "$PROD_LIVE_DIR"
cp -a "$PREV8_LIVE" "$PROD_LIVE"
chmod 0644 "$PROD_LIVE"

echo "============================================================"
echo " LA BETAILLERE — RETOUR PARCOURS TGV PRE-V8"
echo "============================================================"
echo "Snapshot pré-V8 : $PREV8_DIR"
echo "Backup actuel    : $BACKUP"
echo "Sections PROD    : $PROD_LIVE"
echo

# Patch en copie, puis validation avant publication.
cp -a "$CORE" "$TMP/core.html"
python3 - "$TMP/core.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

# 1) Production lit désormais une copie stable des sections LIVE d'avant V8.
old='/map-v2/data/moorail-live-v1/sections.json?v=${Date.now()}'
new='/map-v2/data/moorail-live-prod-stable-v1/sections.json?v=pre-v8-v44-v52'
if s.count(old) != 1:
    raise SystemExit(f'ERREUR: URL LIVE attendue {s.count(old)} fois, attendu 1')
s=s.replace(old,new,1)

# 2) Retirer le fallback par numéro V8.5/V8.6. Le V52 historique reprend la main.
marker='  /* LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85 */'
anchor='  async function drawSelectedTripRoute(trainId){'
a=s.find(marker); b=s.find(anchor,a+1)
if a < 0 or b < 0:
    raise SystemExit('ERREUR: bloc V8.5 introuvable')
s=s[:a]+s[b:]

# L'appel avait été redirigé vers V8.5 : retour au V52 historique.
old_call='      const lbMoorailSelected = lbMoorailSelectedRouteForTrainV85(trainId,seq);'
new_call='      const lbMoorailSelected = lbMoorailSelectedFullRoute(seq);'
if s.count(old_call) != 1:
    raise SystemExit(f'ERREUR: appel V8.5 trouvé {s.count(old_call)} fois')
s=s.replace(old_call,new_call,1)

# Nettoyage des deux ajouts d'état V8.5.
s=s.replace('  let lbMoorailV8TrainRoutes = {};\n','',1)
s=s.replace("      lbMoorailV8TrainRoutes=(p?.trainRoutes && typeof p.trainRoutes==='object')?p.trainRoutes:{};\n",'',1)

# 3) Retirer le resolver réseau V8 et remettre les deux appels V44 historiques.
marker='  /* LB_MOORAIL_VALIDATED_NETWORK_V8 */'
anchor='  function pathBetweenStops(stopA, stopB){'
a=s.find(marker); b=s.find(anchor,a+1)
if a < 0 or b < 0:
    raise SystemExit('ERREUR: bloc resolver V8 introuvable')
s=s[:a]+s[b:]

old1='    const moorail=lbMoorailResolvedPathBetweenStops(stopA,stopB);'
new1='    const moorail=lbMoorailPathBetweenStops(stopA,stopB);'
if s.count(old1) != 1:
    raise SystemExit(f'ERREUR: appel resolver principal trouvé {s.count(old1)} fois')
s=s.replace(old1,new1,1)

old2='      const path=lbMoorailResolvedPathBetweenStops(stopA,stopB);'
new2='      const path=lbMoorailPathBetweenStops(stopA,stopB);'
if s.count(old2) != 1:
    raise SystemExit(f'ERREUR: appel resolver V52 trouvé {s.count(old2)} fois')
s=s.replace(old2,new2,1)

# V8 avait ajouté les spines + chargement network.json au démarrage des overrides.
s=s.replace('  let lbMoorailV8Spines = [];\n','',1)
s=s.replace('      await lbLoadMoorailV8Network();\n','',1)

# Marqueur de l'opération, sans changer le reste du core.
if 'LB_PROD_TGV_PRE_V8_V1' not in s:
    s=s.replace('</head>','<!-- LB_PROD_TGV_PRE_V8_V1 -->\n</head>',1)

# Garde-fous : on garde le moteur historique et toutes les fonctions hors routage.
for req in ['LB_SERVICE_DAY_ROLLOVER_V1','LB_MOORAIL_LIVE_PATH_V44','LB_MOORAIL_SELECTED_ROUTE_V52','lb-community-traveler-v1','lb-community-traveler-compact-v2']:
    if req not in s: raise SystemExit('ERREUR: fonction requise perdue: '+req)
for bad in ['LB_MOORAIL_VALIDATED_NETWORK_V8','LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85','LB_MOORAIL_SELECTED_NUMBER_V86','lbLoadMoorailV8Network','lbMoorailResolvedPathBetweenStops','moorail-network-v8/network.json']:
    if bad in s: raise SystemExit('ERREUR: logique V8 encore active: '+bad)
if new not in s: raise SystemExit('ERREUR: snapshot PROD non raccordé')

p.write_text(s,encoding='utf-8')
PY

# Validation de tous les scripts inline avant publication.
python3 - "$TMP/core.html" "$TMP" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import subprocess,sys
class P(HTMLParser):
    def __init__(self): super().__init__(); self.on=False; self.cur=[]; self.parts=[]
    def handle_starttag(self,t,a):
        if t=='script':
            d=dict(a); self.on='src' not in d and d.get('type','') not in ('application/json','application/ld+json'); self.cur=[]
    def handle_data(self,d):
        if self.on:self.cur.append(d)
    def handle_endtag(self,t):
        if t=='script' and self.on:
            self.parts.append(''.join(self.cur)); self.on=False
q=P();q.feed(Path(sys.argv[1]).read_text(encoding='utf-8'))
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js'; f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode: raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript inline : OK (',len(q.parts),'blocs )')
PY

# Publier atomiquement le core validé.
install -o root -g root -m 0644 "$TMP/core.html" "$CORE"

# Cache-bust uniquement l'iframe de production.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s,n=re.subn(r'(carte-core-preview\.html\?lbEmbedded=1&v=)[^"\'&< ]+',r'\g<1>20260910-tgv-pre-v8-v1',s,count=1)
if n==0:
    s,n=re.subn(r'(carte-core-preview\.html\?[^"\']*?)(?:&v=[^"\'& ]+)?(["\'])',lambda m:m.group(1)+'&v=20260910-tgv-pre-v8-v1'+m.group(2),s,count=1)
if n==0: raise SystemExit('ERREUR: iframe carte-core-preview introuvable')
p.write_text(s,encoding='utf-8')
PY

# Contrôles finaux. France V3 et les datasets partagés ne sont jamais écrits.
grep -qF 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$CORE"
grep -qF 'LB_MOORAIL_SELECTED_ROUTE_V52' "$CORE"
grep -qF 'LB_PROD_TGV_PRE_V8_V1' "$CORE"
grep -qF 'moorail-live-prod-stable-v1/sections.json' "$CORE"
! grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$CORE"
! grep -qF 'lbLoadMoorailV8Network' "$CORE"
! grep -qF 'moorail-network-v8/network.json' "$CORE"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " OK — PARCOURS TGV PRODUCTION REVENUS AU MOTEUR PRE-V8"
echo "============================================================"
echo "Rollover / horaires        : INCHANGES"
echo "Moteur TGV LIVE V44        : CONSERVE"
echo "Tracé sélectionné V52      : CONSERVE"
echo "Resolver réseau V8         : RETIRE DE #carte"
echo "Fallback V8.5/V8.6         : RETIRE DE #carte"
echo "network.json national      : PLUS CHARGE PAR #carte"
echo "Sections TGV production    : SNAPSHOT PRE-V8 ISOLE"
echo "France V3                  : NON TOUCHEE"
echo "Communauté / pouces        : NON TOUCHES"
echo "HAFAS / SNCF               : NON TOUCHES"
echo "Backup rollback            : $BACKUP"
echo "Snapshot source            : $PREV8_DIR"
echo "Core SHA                   : $(sha256sum "$CORE" | awk '{print $1}')"
echo "============================================================"
