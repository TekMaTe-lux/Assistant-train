#!/usr/bin/env bash
set -euo pipefail

# La Bétaillère — audit LECTURE SEULE avant fenêtre de validation/suppression.
# Ne modifie aucun fichier, aucune base, aucun service et n'envoie aucun DELETE/POST.

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
COMPACT="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
VOTES="$PUBLIC/assets/lb-community-traveler-vote-v3.js"

echo "============================================================"
echo " AUDIT COMMUNAUTE — SIGNAL PAR SIGNAL / PROPRIETAIRE V1"
echo " LECTURE SEULE"
echo "============================================================"

echo
echo "=== 1. CARTE ACTUELLE ==="
for f in "$CORE" "$COMPACT" "$VOTES"; do
  if [[ -f "$f" ]]; then
    printf '%-64s ' "$f"
    sha256sum "$f" | awk '{print $1}'
  else
    echo "ABSENT : $f"
  fi
done

if [[ -f "$COMPACT" ]]; then
  echo "Marqueurs UX :"
  for m in LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT LB_COMMUNITY_NONOFFICIAL_UX_V4_PARENS_NO_COW_COMPACT LB_COMMUNITY_BADGE_BELOW_OFFICIAL_V3; do
    grep -q "$m" "$COMPACT" && echo "  OUI  $m" || echo "  NON  $m"
  done
fi
if [[ -f "$VOTES" ]]; then
  echo "Marqueurs votes :"
  for m in LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES LB_COMMUNITY_NONOFFICIAL_UX_V2_VOTES; do
    grep -q "$m" "$VOTES" && echo "  OUI  $m" || echo "  NON  $m"
  done
fi

echo
echo "=== 2. API SIGNALEMENTS — SCHEMA PUBLIC (AUCUNE SESSION) ==="
TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT
set +e
HTTP="$(curl -ksS --max-time 8 -o "$TMP_JSON" -w '%{http_code}' 'https://vps.labetaillere.fr/api/comments?scope=signals')"
RC=$?
set -e
echo "HTTP : ${HTTP:-?}  curl_rc=$RC"
if [[ "$RC" -eq 0 && -s "$TMP_JSON" ]]; then
python3 - "$TMP_JSON" <<'PY'
import json,sys
p=sys.argv[1]
try:
    d=json.load(open(p,encoding='utf-8'))
except Exception as e:
    print('JSON illisible:',e); raise SystemExit
if isinstance(d,list): arr=d
elif isinstance(d,dict):
    arr=next((d[k] for k in ('comments','signals','items','data','results') if isinstance(d.get(k),list)),[])
    print('cles racine:', ', '.join(sorted(map(str,d.keys()))))
else: arr=[]
print('nombre items:',len(arr))
if arr and isinstance(arr[0],dict):
    print('cles item[0]:', ', '.join(sorted(map(str,arr[0].keys()))))
    interesting=('id','train_number','trainNumber','station','delay_min','delayMin','upvotes','downvotes','my_vote','myVote','user_id','userId','author_id','authorId','owner_id','ownerId','is_owner','isOwner','is_mine','isMine','can_delete','canDelete','created_at','createdAt')
    print('champs ownership presents:', ', '.join(k for k in interesting if k in arr[0]) or 'AUCUN')
PY
fi

echo
echo "=== 3. METHODES HTTP ANNONCEES (LECTURE SEULE) ==="
set +e
curl -ksS --max-time 8 -X OPTIONS -D - -o /dev/null 'https://vps.labetaillere.fr/api/comments/probe-nonexistent' \
  | awk 'BEGIN{IGNORECASE=1} /^HTTP\// || /^allow:/ || /^access-control-allow-methods:/'
set -e

echo
echo "=== 4. PROCESSUS / SERVICES SUSPECTS ==="
(systemctl list-units --type=service --all --no-legend 2>/dev/null || true) \
  | grep -Ei 'labetaillere|comment|community|node|api|express' \
  | head -n 80 || true

echo "-- ports --"
(ss -lntp 2>/dev/null || true) | grep -E ':(80|443|3000|3001|3010|3099|3100|3111|4000|5000|8000|8080)\b' || true

echo
echo "=== 5. FICHIERS BACKEND QUI CONTIENNENT /api/comments OU scope=signals ==="
CAND="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$CAND"' EXIT

# On limite volontairement aux petits fichiers texte de code et aux répertoires applicatifs.
SEARCH_DIRS=()
for d in /opt /home/ubuntu /var/www; do [[ -d "$d" ]] && SEARCH_DIRS+=("$d"); done

find "${SEARCH_DIRS[@]}" \
  -xdev \
  \( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/backups/*' -o -path '*/cache/*' \) -prune -o \
  -type f -size -3M \
  \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.py' \) \
  -print0 2>/dev/null \
| xargs -0 -r grep -IlE '/api/comments|scope=signals|comments/.+vote' 2>/dev/null \
| sort -u | head -n 80 > "$CAND" || true

if [[ ! -s "$CAND" ]]; then
  echo "Aucun candidat trouvé."
else
  cat "$CAND"
fi

echo
echo "=== 6. EXTRAITS DE ROUTES (MAX 8 LIGNES PAR FICHIER) ==="
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  # Ignore les assets front connus pour faire ressortir le vrai serveur.
  case "$f" in
    "$PUBLIC"/*|*/node_modules/*|*/backups/*) continue;;
  esac
  echo "--- $f"
  grep -nEi '/api/comments|scope=signals|comments/.+vote|router\.(get|post|delete|patch)|app\.(get|post|delete|patch)' "$f" 2>/dev/null \
    | head -n 8 \
    | sed -E 's/(secret|token|password|passwd|authorization)[[:space:]]*[:=][^,; ]+/\1=<REDACTED>/Ig' || true
done < "$CAND"

echo
echo "=== 7. INDICES BASE DE DONNEES / PROPRIETAIRE (LECTURE SEULE) ==="
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  case "$f" in "$PUBLIC"/*|*/node_modules/*|*/backups/*) continue;; esac
  if grep -qiE 'user_id|author_id|owner_id|created_by|comment_votes|CREATE TABLE.*comment' "$f" 2>/dev/null; then
    echo "--- $f"
    grep -nEi 'user_id|author_id|owner_id|created_by|comment_votes|CREATE TABLE.*comment' "$f" 2>/dev/null \
      | head -n 12 \
      | sed -E 's/(secret|token|password|passwd|authorization)[[:space:]]*[:=][^,; ]+/\1=<REDACTED>/Ig' || true
  fi
done < "$CAND"

echo
echo "============================================================"
echo " FIN AUDIT — AUCUNE MODIFICATION EFFECTUEE"
echo "============================================================"
echo "Copie-colle cette sortie : elle suffit pour construire le correctif sécurisé."
