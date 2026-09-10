#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
COMPACT="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
VOTE="$PUBLIC/assets/lb-community-traveler-vote-v3.js"
DIALOG="$PUBLIC/assets/lb-community-signal-dialog-v1.js"
SOURCE_URL="${LB_DIALOG_SOURCE_URL:-https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/lb-community-signal-dialog-v1.js}"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
VERSION="20260910-signal-dialog-v1-${STAMP}"
BACKUP="$ROOT/map-v2/backups/community-signal-dialog-v1-$STAMP"
TMP_DIALOG="$(mktemp --suffix=.js)"
SUCCESS=0
DIALOG_EXISTED=0

cleanup(){ rm -f "$TMP_DIALOG"; }
rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR — rollback automatique" >&2
  [[ -f "$BACKUP/carte-core-preview.html" ]] && cp -a "$BACKUP/carte-core-preview.html" "$CORE"
  [[ -f "$BACKUP/lb-community-traveler-compact-v2.js" ]] && cp -a "$BACKUP/lb-community-traveler-compact-v2.js" "$COMPACT"
  [[ -f "$BACKUP/lb-community-traveler-vote-v3.js" ]] && cp -a "$BACKUP/lb-community-traveler-vote-v3.js" "$VOTE"
  if [[ "$DIALOG_EXISTED" -eq 1 && -f "$BACKUP/lb-community-signal-dialog-v1.js" ]]; then
    cp -a "$BACKUP/lb-community-signal-dialog-v1.js" "$DIALOG"
  elif [[ "$DIALOG_EXISTED" -eq 0 ]]; then
    rm -f "$DIALOG"
  fi
}
trap 'rollback; cleanup' EXIT

for f in "$CORE" "$COMPACT" "$VOTE"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

# Garde-fous : on travaille uniquement sur la pile communautaire actuellement auditée.
grep -q 'LB_COMMUNITY_VOTES_RACEFIX_V3_COMPACT' "$COMPACT" || { echo "ERREUR: racefix-v3 compact absent" >&2; exit 3; }
grep -q 'LB_COMMUNITY_NONOFFICIAL_UX_V4_PARENS_NO_COW_COMPACT' "$COMPACT" || { echo "ERREUR: UX V4 parenthèses sans vache absente" >&2; exit 4; }
grep -q 'LB_COMMUNITY_BADGE_BELOW_OFFICIAL_V3' "$COMPACT" || { echo "ERREUR: positionneur badge V3 absent" >&2; exit 5; }
grep -q 'LB_COMMUNITY_VOTES_RACEFIX_V3_VOTES' "$VOTE" || { echo "ERREUR: racefix-v3 vote absent" >&2; exit 6; }

install -d -m 0755 "$BACKUP" "$PUBLIC/assets"
cp -a "$CORE" "$BACKUP/carte-core-preview.html"
cp -a "$COMPACT" "$BACKUP/lb-community-traveler-compact-v2.js"
cp -a "$VOTE" "$BACKUP/lb-community-traveler-vote-v3.js"
if [[ -f "$DIALOG" ]]; then
  DIALOG_EXISTED=1
  cp -a "$DIALOG" "$BACKUP/lb-community-signal-dialog-v1.js"
fi

curl -fsSL --connect-timeout 10 --max-time 60 "${SOURCE_URL}?v=${STAMP}" -o "$TMP_DIALOG"
grep -q '__LB_COMMUNITY_SIGNAL_DIALOG_V1__' "$TMP_DIALOG" || { echo "ERREUR: asset dialogue téléchargé invalide" >&2; exit 7; }
if command -v node >/dev/null 2>&1; then node --check "$TMP_DIALOG"; fi
install -m 0644 "$TMP_DIALOG" "$DIALOG"

python3 - "$CORE" "$COMPACT" "$VOTE" "$VERSION" <<'PY'
from pathlib import Path
import re, sys

core_path = Path(sys.argv[1])
compact_path = Path(sys.argv[2])
vote_path = Path(sys.argv[3])
version = sys.argv[4]

core = core_path.read_text(encoding='utf-8')
compact = compact_path.read_text(encoding='utf-8')
vote = vote_path.read_text(encoding='utf-8')

# 1) Le badge communautaire possède désormais une position stable MÊME sans retard officiel.
#    On remplace seulement le helper de positionnement déjà installé en V3.
marker_tag = 'LB_COMMUNITY_BADGE_STABLE_NO_OFFICIAL_V1'
if marker_tag not in compact:
    pat = re.compile(
        r"  function positionCommunityDelayBelowOfficial\(marker, badge\)\{\n.*?\n  \}\n\n  function decorateMarkerBadges\(\)\{",
        re.S,
    )
    replacement = r'''  function positionCommunityDelayBelowOfficial(marker, badge){
    /* LB_COMMUNITY_BADGE_STABLE_NO_OFFICIAL_V1
       Un seul positionneur déterministe :
       - retard officiel présent -> juste en dessous ;
       - aucun retard officiel -> emplacement réservé sous le curseur.
       Ainsi les deux états ne se battent plus entre eux. */
    if (!marker || !badge) return;

    const markerRect = marker.getBoundingClientRect();
    if (!(markerRect.width > 0) || !(markerRect.height > 0)) return;

    const applyPosition = (left, top, minWidth = 0) => {
      badge.style.setProperty('position', 'absolute', 'important');
      badge.style.setProperty('left', `${Math.round(left)}px`, 'important');
      badge.style.setProperty('top', `${Math.round(top)}px`, 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');
      badge.style.setProperty('transform', 'none', 'important');
      badge.style.setProperty('width', 'auto', 'important');
      badge.style.setProperty('min-width', minWidth > 0 ? `${Math.round(minWidth)}px` : '0', 'important');
      badge.style.setProperty('max-width', 'none', 'important');
      badge.style.setProperty('z-index', '9', 'important');
    };

    const official = marker.querySelector('.train-delay-badge');
    if (official) {
      const officialRect = official.getBoundingClientRect();
      if (officialRect.width > 0 && officialRect.height > 0) {
        applyPosition(
          officialRect.left - markerRect.left,
          officialRect.bottom - markerRect.top + 2,
          officialRect.width
        );
        return;
      }
    }

    // Pas de retard officiel : ancrage sous le curseur, jamais sur la flèche.
    const badgeRect = badge.getBoundingClientRect();
    const badgeWidth = Math.max(1, Number(badgeRect.width || badge.offsetWidth || 1));
    applyPosition((markerRect.width - badgeWidth) / 2, markerRect.height + 3, 0);
  }

  function decorateMarkerBadges(){'''
    compact2, n = pat.subn(replacement, compact, count=1)
    if n != 1:
        raise SystemExit(f'ERREUR: helper de positionnement attendu exactement 1 fois, trouvé {n}')
    compact = compact2

# 2) L'ancien vote-v3 reste chargé comme filet de sécurité, mais ne réécrit plus la ligne
#    lorsque la nouvelle fiche par signalement est disponible. Cela retire la course DOM.
hand_tag = 'LB_COMMUNITY_SIGNAL_DIALOG_V1_HANDOFF'
if hand_tag not in vote:
    needle = "    if (!block || !sourceLine) return;\n"
    if vote.count(needle) != 1:
        raise SystemExit(f'ERREUR: point handoff vote-v3 attendu 1 fois, trouvé {vote.count(needle)}')
    repl = needle + "    // LB_COMMUNITY_SIGNAL_DIALOG_V1_HANDOFF: le dialogue gère les votes par signalement.\n" \
        + "    if (window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__) {\n" \
        + "      sourceLine.classList.remove('lb-community-source-line--votes');\n" \
        + "      return;\n" \
        + "    }\n"
    vote = vote.replace(needle, repl, 1)

# 3) Charger le dialogue AVANT vote-v3 : son flag est donc déjà présent quand vote-v3 démarre.
core = re.sub(
    r'\s*<script\b[^>]*\bid=["\']lb-community-signal-dialog-v1["\'][^>]*></script>',
    '', core, flags=re.I,
)
dialog_tag = f'<script defer id="lb-community-signal-dialog-v1" src="./assets/lb-community-signal-dialog-v1.js?v={version}"></script>'

vote_script = re.search(
    r'<script\b[^>]*\bid=["\']lb-community-traveler-vote-v3["\'][^>]*></script>',
    core, re.I,
)
if vote_script:
    core = core[:vote_script.start()] + dialog_tag + '\n' + core[vote_script.start():]
else:
    pos = core.lower().rfind('</body>')
    if pos < 0:
        raise SystemExit('ERREUR: ni vote-v3 ni </body> trouvés dans le core')
    core = core[:pos] + dialog_tag + '\n' + core[pos:]

# Cache-bust ciblé des deux assets modifiés.
core, n1 = re.subn(
    r'(lb-community-traveler-compact-v2\.js\?v=)[^"\']+',
    r'\g<1>' + version + '-compact', core,
)
core, n2 = re.subn(
    r'(lb-community-traveler-vote-v3\.js\?v=)[^"\']+',
    r'\g<1>' + version + '-vote', core,
)
if n1 < 1 or n2 < 1:
    raise SystemExit(f'ERREUR: cache-bust incomplet compact={n1} vote={n2}')

if core.count('id="lb-community-signal-dialog-v1"') != 1:
    raise SystemExit('ERREUR: le dialogue doit être référencé exactement une fois')
if marker_tag not in compact:
    raise SystemExit('ERREUR: position stable sans officiel absente')
if hand_tag not in vote:
    raise SystemExit('ERREUR: handoff vote-v3 absent')

compact_path.write_text(compact, encoding='utf-8')
vote_path.write_text(vote, encoding='utf-8')
core_path.write_text(core, encoding='utf-8')
PY

if command -v node >/dev/null 2>&1; then
  node --check "$COMPACT"
  node --check "$VOTE"
  node --check "$DIALOG"
fi

grep -q 'LB_COMMUNITY_BADGE_STABLE_NO_OFFICIAL_V1' "$COMPACT"
grep -q 'LB_COMMUNITY_SIGNAL_DIALOG_V1_HANDOFF' "$VOTE"
grep -q 'id="lb-community-signal-dialog-v1"' "$CORE"
grep -q '__LB_COMMUNITY_SIGNAL_DIALOG_V1__' "$DIALOG"

COUNT="$(grep -o 'id="lb-community-signal-dialog-v1"' "$CORE" | wc -l)"
[[ "$COUNT" = "1" ]] || { echo "ERREUR: dialogue présent $COUNT fois dans le core" >&2; exit 8; }

SUCCESS=1
trap cleanup EXIT

echo "============================================================"
echo " VOIX DU BETAIL — FICHE SIGNAL PAR SIGNAL V1 INSTALLÉE"
echo "============================================================"
echo "  ✓ les pouces ont disparu de la barre compacte"
echo "  ✓ clic sur (+N min) ouvre une fiche NON OFFICIELLE"
echo "  ✓ chaque signalement/gare possède ses propres votes"
echo "  ✓ l'auteur voit 'Supprimer mon signalement'"
echo "  ✓ DELETE existant conservé : sécurité ownership côté serveur inchangée"
echo "  ✓ badge carte stable même sans retard officiel"
echo "  ✓ ancien vote-v3 ne réécrit plus la ligne : course DOM neutralisée"
echo "  ✓ aucun GTFS / routage / base / backend modifié"
echo "  ✓ aucun service redémarré"
echo "Sauvegarde : $BACKUP"
echo "Recharge la carte puis clique sur un badge communautaire (+N min)."
