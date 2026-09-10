#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — réparation production V2
# - remet exactement J/J+1 depuis le backup créé avant emergency-fast-v1
# - restaure le dernier core local PRE-V8 (MooRail national exclu de #carte)
# - conserve les assets communauté/pouces actuels
# - ne touche PAS à france-v3-preview.html ni à sa DB/ses données
# - aucune purge disque

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
MAP="$ROOT/map-v2"
PUBLIC="$MAP/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
BUILDER="$MAP/scripts/build-map-lite-cache.py"
CACHE="$PUBLIC/data/carte_static_lite_today.json"
V1="$PUBLIC/assets/lb-community-traveler-v1.js"
V2="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
VOTE="$PUBLIC/assets/lb-community-traveler-vote-v3.js"

# Backup annoncé par la sortie de repair-production-map-fast-v1.sh.
EMERGENCY_BACKUP="${LB_EMERGENCY_BACKUP:-$MAP/backups/emergency-fast-map-v1-20260910-122629-351357306}"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
ROLLBACK="$MAP/backups/repair-production-map-fast-v2-$STAMP"
TMP="$(mktemp -d /tmp/lb-prod-fast-v2-XXXXXX)"
SUCCESS=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup; return 0; fi
  echo >&2
  echo "ERREUR — rollback automatique V2..." >&2
  for f in "$CORE" "$WRAPPER" "$BUILDER" "$CACHE" "$V1" "$V2" "$VOTE"; do
    b="$ROLLBACK/$(basename "$f")"
    [[ -f "$b" ]] && cp -a "$b" "$f" || true
  done
  cleanup
  echo "Rollback V2 terminé." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$CORE" "$WRAPPER" "$BUILDER" "$V1" "$V2" "$VOTE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier actuel absent: $f" >&2; exit 3; }
done
for name in carte-core-preview.html carte-preview.html build-map-lite-cache.py lb-community-traveler-v1.js lb-community-traveler-compact-v2.js lb-community-traveler-vote-v3.js; do
  [[ -f "$EMERGENCY_BACKUP/$name" ]] || { echo "ERREUR: backup pré-réparation incomplet: $EMERGENCY_BACKUP/$name" >&2; exit 4; }
done

mkdir -p "$ROLLBACK"
for f in "$CORE" "$WRAPPER" "$BUILDER" "$V1" "$V2" "$VOTE"; do cp -a "$f" "$ROLLBACK/$(basename "$f")"; done
[[ -f "$CACHE" ]] && cp -a "$CACHE" "$ROLLBACK/$(basename "$CACHE")"

# Le backup emergency contient exactement l'état d'avant la mauvaise restauration :
# on s'en sert pour récupérer J/J+1, wrapper et assets actuels.
cp -a "$EMERGENCY_BACKUP/carte-preview.html" "$WRAPPER"
cp -a "$EMERGENCY_BACKUP/build-map-lite-cache.py" "$BUILDER"
cp -a "$EMERGENCY_BACKUP/lb-community-traveler-v1.js" "$V1"
cp -a "$EMERGENCY_BACKUP/lb-community-traveler-compact-v2.js" "$V2"
cp -a "$EMERGENCY_BACKUP/lb-community-traveler-vote-v3.js" "$VOTE"
[[ -f "$EMERGENCY_BACKUP/carte_static_lite_today.json" ]] && cp -a "$EMERGENCY_BACKUP/carte_static_lite_today.json" "$CACHE"

# On capture seulement les raccordements communauté/pouces actuels du core pré-emergency.
python3 - "$EMERGENCY_BACKUP/carte-core-preview.html" "$TMP/community.json" <<'PY'
from pathlib import Path
import json,re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
out={'scripts':{},'styles':{}}
for ident in ['lb-community-traveler-v1','lb-community-traveler-compact-v2','lb-community-traveler-vote-v3','lb-lux-station-entry-v2']:
    m=re.search(r'<script\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</script>',s,re.I|re.S)
    if m: out['scripts'][ident]=m.group(0)
for ident in ['lb-community-marker-stack-css-v1']:
    m=re.search(r'<style\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</style>',s,re.I|re.S)
    if m: out['styles'][ident]=m.group(0)
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
print('Raccordements conservés:', ', '.join(out['scripts']))
PY

# Chercher le dernier core sauvegardé JUSTE AVANT l'installation MooRail V8.
# Critères obligatoires : J/J+1 V2 déjà présent, ancien moteur local présent,
# aucune couche réseau nationale V8.
PRE_V8=""
while IFS= read -r candidate; do
  [[ -n "$candidate" && -f "$candidate" ]] || continue
  if grep -qF 'LB_SERVICE_DAY_ROLLOVER_V2' "$candidate" \
     && grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$candidate" \
     && ! grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$candidate" \
     && ! grep -qF 'lbLoadMoorailV8Network' "$candidate" \
     && ! grep -qF 'moorail-network-v8/network.json' "$candidate"; then
    PRE_V8="$candidate"
    break
  fi
done < <(
  find "$MAP/backups" -mindepth 2 -maxdepth 2 -type f -path '*/moorail-validated-sections-v8-*/carte-core-preview.html' \
    -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-
)

# Fallback : certains installateurs avaient sauvegardé directement près du core.
if [[ -z "$PRE_V8" ]]; then
  while IFS= read -r candidate; do
    [[ -n "$candidate" && -f "$candidate" ]] || continue
    if grep -qF 'LB_SERVICE_DAY_ROLLOVER_V2' "$candidate" \
       && grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$candidate" \
       && ! grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$candidate" \
       && ! grep -qF 'lbLoadMoorailV8Network' "$candidate"; then
      PRE_V8="$candidate"; break
    fi
  done < <(find "$PUBLIC" -maxdepth 1 -type f -name 'carte-core-preview.html.bak-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)
fi

[[ -n "$PRE_V8" ]] || {
  echo "ERREUR: aucun core PRE-V8 avec J/J+1 V2 n'a été trouvé." >&2
  echo "Aucune approximation : arrêt et rollback." >&2
  exit 5
}

echo "============================================================"
echo " LA BETAILLERE — PRODUCTION RAPIDE V2"
echo "============================================================"
echo "Etat J/J+1 exact : $EMERGENCY_BACKUP"
echo "Core local pré-V8: $PRE_V8"
echo "Rollback V2       : $ROLLBACK"
echo

cp -a "$PRE_V8" "$CORE"

# Réinjecter uniquement les modules communauté/pouces actuels.
python3 - "$CORE" "$TMP/community.json" <<'PY'
from pathlib import Path
import json,re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
keep=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
for ident,tag in keep.get('scripts',{}).items():
    pat=re.compile(r'<script\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</script>\s*',re.I|re.S)
    s=pat.sub('',s)
    pos=s.lower().rfind('</body>')
    if pos < 0: raise SystemExit('ERREUR: </body> absent')
    s=s[:pos]+tag+'\n'+s[pos:]
for ident,tag in keep.get('styles',{}).items():
    pat=re.compile(r'<style\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</style>\s*',re.I|re.S)
    s=pat.sub('',s)
    pos=s.lower().rfind('</head>')
    if pos < 0: raise SystemExit('ERREUR: </head> absent')
    s=s[:pos]+tag+'\n'+s[pos:]

# Garde-fous architecturaux : J/J+1 OUI, France-V3/MooRail national NON.
required=['LB_SERVICE_DAY_ROLLOVER_V2','LB_MOORAIL_LIVE_PATH_V44','lb-community-traveler-v1','lb-community-traveler-compact-v2','lb-community-traveler-vote-v3']
for token in required:
    if token not in s: raise SystemExit('ERREUR: fonction requise absente: '+token)
for token in ['LB_MOORAIL_VALIDATED_NETWORK_V8','lbLoadMoorailV8Network','moorail-network-v8/network.json','LB_MOORAIL_SELECTED_ROUTE_V52','LB_MOORAIL_SELECTED_ROUTE_V55']:
    if token in s: raise SystemExit('ERREUR: couche nationale encore présente: '+token)
s=s.replace('</head>','<!-- LB_PRODUCTION_LOCAL_PRE_V8_V2 -->\n</head>',1)
p.write_text(s,encoding='utf-8')
PY

# Le builder J/J+1 doit bien être revenu. Ne pas reconstruire à l'aveugle :
# on restaure le cache exact pré-emergency s'il existe, sinon seulement alors on reconstruit.
grep -qF 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$BUILDER" || {
  echo "ERREUR: builder J/J+1 V2 non restauré" >&2; exit 6;
}
python3 -m py_compile "$BUILDER"
if [[ ! -s "$CACHE" ]]; then python3 "$BUILDER"; fi
[[ -s "$CACHE" ]] || { echo "ERREUR: cache J/J+1 absent" >&2; exit 7; }

# Cache-bust du core uniquement. Aucun changement france-v3.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
s,n=re.subn(r'(carte-core-preview\.html\?lbEmbedded=1&v=)[^"\'&< ]+',r'\g<1>20260910-prod-local-prev8-v2',s,count=1)
if n==0:
    s,n=re.subn(r'(carte-core-preview\.html\?[^"\']*?)(?:&v=[^"\'& ]+)?(["\'])',lambda m:m.group(1)+'&v=20260910-prod-local-prev8-v2'+m.group(2),s,count=1)
if n==0: raise SystemExit('ERREUR: iframe du core introuvable')
p.write_text(s,encoding='utf-8')
PY

# Validation JS.
python3 - "$CORE" "$TMP" <<'PY'
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
        if t=='script' and self.on:self.parts.append(''.join(self.cur)); self.on=False
q=P(); q.feed(Path(sys.argv[1]).read_text(encoding='utf-8'))
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js'; f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode: raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript core: OK')
PY
node --check "$V1"
node --check "$V2"
node --check "$VOTE"

# Contrôles finaux lisibles.
grep -qF 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE"
grep -qF 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$BUILDER"
grep -qF 'LB_MOORAIL_LIVE_PATH_V44' "$CORE"
! grep -qF 'lbLoadMoorailV8Network' "$CORE"
! grep -qF 'moorail-network-v8/network.json' "$CORE"
! grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$CORE"

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " OK — PRODUCTION SEPAREE DE FRANCE V3"
echo "============================================================"
echo "J/J+1                    : OUI — RESTAURE"
echo "Rollover minuit          : OUI"
echo "Moteur local pré-V8      : OUI"
echo "MooRail network V8 prod  : NON"
echo "network.json prod        : NON"
echo "France V3                : NON TOUCHEE"
echo "Communauté               : CONSERVEE"
echo "Pouces                    : CONSERVES"
echo "Purge disque              : AUCUNE"
echo "Core pré-V8 utilisé       : $PRE_V8"
echo "Backup rollback           : $ROLLBACK"
echo "Core SHA                  : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Cache J/J+1               : $(stat -c%s "$CACHE") octets"
echo "============================================================"
