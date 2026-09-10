#!/usr/bin/env bash
set -Eeuo pipefail

# La Bétaillère — réparation d'urgence de #carte
# Objectif : revenir au core local rapide pré-J/J+1 / pré-MooRail V8,
# conserver la communauté + les pouces actuels, ne pas toucher à France V3.

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
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$MAP/backups/emergency-fast-map-v1-$STAMP"
TMP="$(mktemp -d /tmp/lb-emergency-fast-map-XXXXXX)"
SUCCESS=0

cleanup_tmp(){ rm -rf "$TMP"; }
rollback(){
  local rc=$?
  if [[ "$SUCCESS" -eq 1 ]]; then cleanup_tmp; return 0; fi
  echo >&2
  echo "ERREUR — restauration automatique de l'état d'avant ce correctif..." >&2
  for f in "$CORE" "$WRAPPER" "$BUILDER" "$CACHE" "$V1" "$V2" "$VOTE"; do
    [[ -e "$BACKUP/$(basename "$f")" ]] && cp -a "$BACKUP/$(basename "$f")" "$f" || true
  done
  cleanup_tmp
  echo "Rollback terminé." >&2
  exit "$rc"
}
trap rollback EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$CORE" "$WRAPPER" "$BUILDER" "$V1" "$V2" "$VOTE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier absent: $f" >&2; exit 3; }
done
command -v python3 >/dev/null || { echo "ERREUR: python3 absent" >&2; exit 4; }
command -v node >/dev/null || { echo "ERREUR: node absent" >&2; exit 5; }

mkdir -p "$BACKUP"
for f in "$CORE" "$WRAPPER" "$BUILDER" "$V1" "$V2" "$VOTE"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done
[[ -f "$CACHE" ]] && cp -a "$CACHE" "$BACKUP/$(basename "$CACHE")"

# Point de retour sûr : V1 jour ferroviaire présent, V2 absent, et aucune couche V8.
CORE_OLD=""
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  if grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$candidate" \
     && ! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$candidate" \
     && ! grep -q 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$candidate" \
     && ! grep -q 'lbLoadMoorailV8Network' "$candidate"; then
    CORE_OLD="$candidate"; break
  fi
done < <(find "$PUBLIC" -maxdepth 1 -type f -name 'carte-core-preview.html.bak-service-day-rollover-v2-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

BUILDER_OLD=""
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  if ! grep -q 'LB_SERVICE_DAY_CACHE_WINDOW_V2' "$candidate"; then BUILDER_OLD="$candidate"; break; fi
done < <(find "$(dirname "$BUILDER")" -maxdepth 1 -type f -name 'build-map-lite-cache.py.bak-service-day-rollover-v2-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

[[ -n "$CORE_OLD" && -f "$CORE_OLD" ]] || { echo "ERREUR: sauvegarde core rapide pré-V2/pré-V8 introuvable" >&2; exit 6; }
[[ -n "$BUILDER_OLD" && -f "$BUILDER_OLD" ]] || { echo "ERREUR: builder rapide pré-V2 introuvable" >&2; exit 7; }

echo "============================================================"
echo " LA BETAILLERE — REPARATION #CARTE RAPIDE"
echo "============================================================"
echo "Core rapide : $CORE_OLD"
echo "Builder      : $BUILDER_OLD"
echo "Backup       : $BACKUP"
echo

# Capturer seulement les raccordements communautaires actuels.
python3 - "$CORE" "$TMP/preserve.json" <<'PY'
from pathlib import Path
import json,re,sys
s=Path(sys.argv[1]).read_text(encoding='utf-8')
ids=['lb-community-traveler-v1','lb-community-traveler-compact-v2','lb-community-traveler-vote-v3','lb-lux-station-entry-v2']
out={'scripts':{},'styles':{}}
for ident in ids:
    m=re.search(r'<script\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</script>',s,re.I|re.S)
    if m: out['scripts'][ident]=m.group(0)
for ident in ['lb-community-marker-stack-css-v1']:
    m=re.search(r'<style\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</style>',s,re.I|re.S)
    if m: out['styles'][ident]=m.group(0)
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
print('Communauté capturée:', ', '.join(out['scripts']) or 'aucun script')
PY

# Retour au moteur local léger. Aucun --force, aucune DB France V3 touchée.
cp -a "$CORE_OLD" "$CORE"
cp -a "$BUILDER_OLD" "$BUILDER"
python3 -m py_compile "$BUILDER"
python3 "$BUILDER"
[[ -s "$CACHE" ]] || { echo "ERREUR: cache léger non reconstruit" >&2; exit 8; }

# Réinjecter communauté + pouces actuels, sans réinjecter MooRail V8.
python3 - "$CORE" "$TMP/preserve.json" <<'PY'
from pathlib import Path
import json,re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
keep=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
for ident,tag in keep.get('scripts',{}).items():
    pat=re.compile(r'<script\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</script>\s*',re.I|re.S)
    s=pat.sub('',s)
    pos=s.lower().rfind('</body>')
    if pos<0: raise SystemExit('ERREUR: </body> absent')
    s=s[:pos]+tag+'\n'+s[pos:]
if 'lb-community-traveler-vote-v3' not in keep.get('scripts',{}):
    tag='<script defer id="lb-community-traveler-vote-v3" src="./assets/lb-community-traveler-vote-v3.js?v=20260910-fast-restore-v1"></script>'
    pos=s.lower().rfind('</body>'); s=s[:pos]+tag+'\n'+s[pos:]
for ident,tag in keep.get('styles',{}).items():
    pat=re.compile(r'<style\b[^>]*\bid=["\']'+re.escape(ident)+r'["\'][^>]*>.*?</style>\s*',re.I|re.S)
    s=pat.sub('',s)
    pos=s.lower().rfind('</head>')
    if pos<0: raise SystemExit('ERREUR: </head> absent')
    s=s[:pos]+tag+'\n'+s[pos:]
for forbidden in ['LB_SERVICE_DAY_ROLLOVER_V2','LB_MOORAIL_VALIDATED_NETWORK_V8','lbLoadMoorailV8Network','moorail-route-v8/network.json','LB_MAP_STARTUP_SAFE_V1']:
    if forbidden in s: raise SystemExit('ERREUR: logique lourde encore présente: '+forbidden)
if 'LB_SERVICE_DAY_ROLLOVER_V1' not in s: raise SystemExit('ERREUR: moteur journalier rapide V1 absent')
for required in ['lb-community-traveler-v1','lb-community-traveler-compact-v2','lb-community-traveler-vote-v3']:
    if required not in s: raise SystemExit('ERREUR: communauté/pouces absents: '+required)
s=s.replace('</head>','<!-- LB_EMERGENCY_FAST_MAP_V1 -->\n</head>',1)
p.write_text(s,encoding='utf-8')
PY

# Cache-bust uniquement l'iframe du core dans le wrapper.
python3 - "$WRAPPER" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
new,n=re.subn(r'(carte-core-preview\.html\?lbEmbedded=1&v=)[^"\'&< ]+',r'\g<1>20260910-emergency-fast-v1',s,count=1)
if n==0:
    new,n=re.subn(r'(carte-core-preview\.html\?[^"\']*?)(?:&v=[^"\'& ]+)?(["\'])',lambda m:m.group(1)+'&v=20260910-emergency-fast-v1'+m.group(2),s,count=1)
if n==0: raise SystemExit('ERREUR: iframe carte-core-preview introuvable dans le wrapper')
p.write_text(new,encoding='utf-8')
PY

# Vérification JavaScript avant validation.
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
s=Path(sys.argv[1]).read_text(encoding='utf-8'); q=P(); q.feed(s)
for i,code in enumerate(q.parts):
    f=Path(sys.argv[2])/f'inline-{i}.js'; f.write_text(code,encoding='utf-8')
    r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if r.returncode: raise SystemExit(f'ERREUR JS inline {i}: {r.stderr}')
print('JavaScript inline core: OK')
PY
node --check "$V1"
node --check "$V2"
node --check "$VOTE"

grep -q 'LB_EMERGENCY_FAST_MAP_V1' "$CORE"
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
! grep -q 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE"
! grep -q 'lbLoadMoorailV8Network' "$CORE"
! grep -q 'moorail-route-v8/network.json' "$CORE"
grep -q 'lb-community-traveler-vote-v3' "$CORE"

# Nettoyage prudent : seulement transitoires anciens + copies DB moorail-v5 répétées.
# Ne touche jamais à timetable-v3-france-preview.sqlite, France V3, RFN ou network.json.
bytes_before=$(df --output=used -B1 / | tail -1 | tr -d ' ')
if [[ -d /opt/lb-rail-engine-v1/tmp ]]; then
  find /opt/lb-rail-engine-v1/tmp -xdev -mindepth 1 -mmin +1440 -print -delete 2>/dev/null || true
fi
find /tmp -maxdepth 1 -mindepth 1 -type d -mmin +360 \
  \( -iname '*moorail*' -o -iname '*global-hs*' -o -iname '*lgv*' -o -iname '*rfn*' \) \
  -print -exec rm -rf -- {} + 2>/dev/null || true
BKP=/opt/lb-rail-engine-v1/data/backups
if [[ -d "$BKP" ]]; then
  mapfile -t old_v5 < <(find "$BKP" -maxdepth 1 -type f -name 'moorail-v5-*.sqlite' -printf '%T@ %p\n' 2>/dev/null | sort -nr | tail -n +4 | cut -d' ' -f2-)
  for f in "${old_v5[@]:-}"; do [[ -n "$f" && -f "$f" ]] && { echo "PURGE backup V5: $f"; rm -f -- "$f"; }; done
fi
bytes_after=$(df --output=used -B1 / | tail -1 | tr -d ' ')
freed=$(( bytes_before > bytes_after ? bytes_before - bytes_after : 0 ))

SUCCESS=1
trap - EXIT
cleanup_tmp

echo
echo "============================================================"
echo " OK — #CARTE REVENUE AU MOTEUR LOCAL RAPIDE"
echo "============================================================"
echo "Moteur journalier V1       : OUI"
echo "J/J+1 V2 dans #carte       : NON"
echo "MooRail V8 network startup : NON"
echo "network.json au démarrage  : NON"
echo "Communauté                 : CONSERVEE"
echo "Pouces / votes             : CONSERVES"
echo "France V3 / DB nationale   : NON TOUCHEE"
echo "Backup complet             : $BACKUP"
printf 'Espace libéré prudent      : %.1f MiB\n' "$(awk -v b="$freed" 'BEGIN{print b/1024/1024}')"
echo "Core SHA                   : $(sha256sum "$CORE" | awk '{print $1}')"
echo "Cache léger                : $(stat -c%s "$CACHE") octets"
echo "============================================================"
