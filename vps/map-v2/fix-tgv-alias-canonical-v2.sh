#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$ROOT/backups/tgv-alias-canonical-v2-$STAMP"
TMP="$(mktemp -d /tmp/lb-tgv-alias-v2-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup; return 0; fi
  echo >&2
  echo "ERREUR — rollback automatique TGV alias V2..." >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE" || true
  [[ -f "$BACKUP/carte-preview.html" ]] && cp -a "$BACKUP/carte-preview.html" "$WRAPPER" || true
  cleanup
  echo "Rollback terminé." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$CORE" && -f "$WRAPPER" ]] || { echo "ERREUR: core/wrapper absent" >&2; exit 3; }
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 4; }
command -v node >/dev/null || { echo "ERREUR: node absent" >&2; exit 4; }

# Garde-fous : on restaure la logique historique déjà présente, on n'invente pas de nouvelles associations.
for token in \
  'TRAIN_NUMBER_EQUIVALENCE_GROUPS' \
  'function equivalentTrainNumbers' \
  'function mergeTrainsByNumber' \
  'function mergeCrossBorderTrains' \
  'function selectPrimaryTrainForMerge' \
  'function buildMergedTrain' \
  'function renderTrains' \
  'function ingestGeoJSONNetwork' \
  'function computeStopPath' \
  'async function loadNetworks'; do
  grep -qF "$token" "$CORE" || { echo "ERREUR: logique historique absente: $token" >&2; exit 5; }
done

# Les associations historiques demandées doivent bien être présentes AVANT toute écriture.
python3 - "$CORE" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace')
for a,b in [('2870','2871'),('2864','2865'),('2806','2807'),('2872','2873'),('2816','2817')]:
    if not re.search(r"['\"]%s['\"]\s*,\s*['\"]%s['\"]"%(a,b),s):
        raise SystemExit(f'ERREUR: association historique absente: {a}/{b}')
print('Associations historiques : OK (dont 2816/2817 et 2870/2871)')
PY

mkdir -p "$BACKUP"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$WRAPPER" "$BACKUP/carte-preview.html"

cp -a "$CORE" "$TMP/core.html"
python3 - "$TMP/core.html" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')

# ---------------------------------------------------------------------------
# 1) Retirer le correctif V1 erroné qui regroupait uniquement les numéros
# strictement identiques et pouvait recopier toute la géométrie HAFAS.
# ---------------------------------------------------------------------------
marker='/* LB_TGV_DEDUPE_SNCF_HAFAS_V1 */'
if marker in s:
    start=s.find(marker)
    # Le bloc V1 avait été injecté juste avant computeTrainDelayInfo.
    anchor='function computeTrainDelayInfo(train){'
    end=s.find(anchor,start)
    if end < 0:
        raise SystemExit('ERREUR: fin du bloc V1 introuvable')
    # Conserver l'indentation précédant la fonction suivante.
    line_start=s.rfind('\n',0,start)+1
    s=s[:line_start]+s[end:]

# Retirer l'appel V1 qui avait été ajouté au début de renderTrains.
s,n=re.subn(r'^\s*list\s*=\s*lbMergeEquivalentTgv\(list\);\s*\n','',s,flags=re.M)
if n>1:
    raise SystemExit(f'ERREUR: {n} appels V1 trouvés, refus de deviner')

# ---------------------------------------------------------------------------
# 2) Réutiliser LA logique historique de La Bétaillère :
# TRAIN_NUMBER_EQUIVALENCE_GROUPS + mergeCrossBorderTrains + mergeTrainsByNumber.
# Aucune nouvelle table d'association n'est créée ici.
# ---------------------------------------------------------------------------
new_marker='/* LB_TGV_ALIAS_CANONICAL_V2 */'
if new_marker not in s:
    helper=r'''

  /* LB_TGV_ALIAS_CANONICAL_V2 */
  function lbCanonicalCrossBorderRenderList(list){
    if(!Array.isArray(list) || list.length<2) return list;

    // Les trains issus du proxy CFL/HAFAS sont une SOURCE de complément,
    // jamais une deuxième circulation à afficher lorsqu'un SNCF équivalent existe.
    // On les présente au moteur de fusion historique comme source CFL afin que
    // selectPrimaryTrainForMerge() conserve SNCF comme circulation canonique.
    const prepared=list.map(train=>{
      if(!train || typeof train!=='object') return train;
      const src=String(train.source||'').toUpperCase();
      const mergedSrc=Array.isArray(train.mergedSources)
        ? train.mergedSources.map(x=>String(x||'').toUpperCase()) : [];
      const isHafas=src.includes('HAFAS') || mergedSrc.some(x=>x.includes('HAFAS'));
      const hasSncf=src.includes('SNCF') || mergedSrc.some(x=>x.includes('SNCF'));
      if(isHafas && !hasSncf){
        return {...train, source:'CFL', lbOriginalSource:train.source||'HAFAS', lbHafasComplement:true};
      }
      return train;
    });

    // Ordre historique de la carte : fusion transfrontalière puis fusion par
    // numéro/numéro équivalent. Les groupes 2816/2817, 2870/2871, etc. sont
    // déjà dans TRAIN_NUMBER_EQUIVALENCE_GROUPS depuis l'ancienne carte.
    return mergeTrainsByNumber(mergeCrossBorderTrains(prepared));
  }
'''
    anchor='function renderTrains(list){'
    idx=s.find(anchor)
    if idx<0:
        raise SystemExit('ERREUR: renderTrains introuvable')
    line_start=s.rfind('\n',0,idx)+1
    s=s[:line_start]+helper+'\n'+s[line_start:]

# Injecter la fusion finale au début de renderTrains : c'est nécessaire car
# les compléments HAFAS peuvent être ajoutés APRES trainsAt().
pat=re.compile(r'(function\s+renderTrains\s*\(list\)\s*\{\s*\n)')
m=pat.search(s)
if not m:
    raise SystemExit('ERREUR: signature renderTrains inattendue')
call='    list = lbCanonicalCrossBorderRenderList(list); /* LB_TGV_ALIAS_CANONICAL_V2 */\n'
# Eviter une double injection.
window=s[m.end():m.end()+300]
if 'lbCanonicalCrossBorderRenderList(list)' not in window:
    s=s[:m.end()]+call+s[m.end():]

# ---------------------------------------------------------------------------
# 3) Contrôles de non-régression.
# ---------------------------------------------------------------------------
for req in [
    'TRAIN_NUMBER_EQUIVALENCE_GROUPS',
    "['2816','2817']",
    "['2870','2871']",
    'function equivalentTrainNumbers',
    'function mergeTrainsByNumber',
    'function mergeCrossBorderTrains',
    'function selectPrimaryTrainForMerge',
    'function buildMergedTrain',
    'function ingestGeoJSONNetwork',
    'function computeStopPath',
    'async function loadNetworks',
    'LB_TGV_ALIAS_CANONICAL_V2',
    'LB_SIMPLE_CYAN_NETWORK_V1',
    'LB_SERVICE_DAY_ROLLOVER_V1'
]:
    if req not in s:
        raise SystemExit('ERREUR: élément requis perdu: '+req)

if 'lbMergeEquivalentTgv(list)' in s:
    raise SystemExit('ERREUR: ancien appel de fusion V1 encore actif')

# Le moteur historique préfère explicitement SNCF comme primaire.
if not re.search(r"source\s*===\s*['\"]SNCF['\"].{0,80}score\s*-=\s*2",s,re.S):
    raise SystemExit('ERREUR: préférence SNCF historique non détectée')

p.write_text(s,encoding='utf-8')
print('Patch TGV alias V2 préparé')
PY

# Valider tous les scripts inline avant publication.
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
q=P(); q.feed(Path(sys.argv[1]).read_text(encoding='utf-8'))
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js'; f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode:
        raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript inline : OK —',len(q.parts),'bloc(s)')
PY

install -o root -g root -m 0644 "$TMP/core.html" "$CORE"

# Cache-bust seulement le wrapper de production.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
pat=r'(carte-core-preview\.html\?[^"\']*?\bv=)[^"\'& ]+'
s2,n=re.subn(pat,r'\g<1>20260910-tgv-alias-canonical-v2',s,count=1)
if not n:
    pat2=r'(carte-core-preview\.html\?[^"\']+)(["\'])'
    s2,n=re.subn(pat2,r'\1&v=20260910-tgv-alias-canonical-v2\2',s,count=1)
if not n:
    raise SystemExit('ERREUR: iframe carte-core-preview introuvable')
p.write_text(s2,encoding='utf-8')
PY

# Contrôle du fichier servi.
curl -fsS --max-time 10 "http://127.0.0.1:3111/carte-core-preview.html?v=$STAMP" -o "$TMP/served.html"
grep -qF 'LB_TGV_ALIAS_CANONICAL_V2' "$TMP/served.html"
grep -qF "['2816','2817']" "$TMP/served.html"
grep -qF 'LB_SIMPLE_CYAN_NETWORK_V1' "$TMP/served.html"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " OK — TGV TRANSFRONTALIER = 1 SEULE CIRCULATION CANONIQUE"
echo "============================================================"
echo "2816 / 2817               : ASSOCIATION HISTORIQUE ACTIVE"
echo "2870 / 2871               : ASSOCIATION HISTORIQUE ACTIVE"
echo "Autres groupes historiques: CONSERVES"
echo "Circulation affichée       : SNCF PRIORITAIRE"
echo "CFL / HAFAS                : COMPLEMENT, PAS 2e CURSEUR"
echo "Réseau simple FR + CFL     : CONSERVE POUR LES PARCOURS"
echo "Réseau cyan                : CONSERVE"
echo "MooRail lourd startup      : TOUJOURS DESACTIVE"
echo "Rollover                   : INCHANGE"
echo "Communauté / pouces        : INCHANGES"
echo "France V3                  : NON TOUCHEE"
echo "Backup                     : $BACKUP"
echo "============================================================"
