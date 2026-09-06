#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
V2="$ROOT/map-v2/public/assets/lb-community-traveler-compact-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP_CORE="${CORE}.bak-community-badge-v3-${STAMP}"
BACKUP_V2="${V2}.bak-community-badge-v3-${STAMP}"
SUCCESS=0

rollback(){
  if [[ "$SUCCESS" -eq 1 ]]; then return; fi
  echo "ERREUR — restauration automatique" >&2
  [[ -f "$BACKUP_CORE" ]] && cp -a "$BACKUP_CORE" "$CORE"
  [[ -f "$BACKUP_V2" ]] && cp -a "$BACKUP_V2" "$V2"
}
trap rollback EXIT

for f in "$CORE" "$V2"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

grep -q 'LB_COMMUNITY_MARKER_STACK_CSS_V1' "$CORE" || { echo "ERREUR: couche communautaire attendue absente du core" >&2; exit 3; }
grep -q 'function decorateMarkerBadges' "$V2" || { echo "ERREUR: decorateMarkerBadges absent" >&2; exit 4; }
grep -q 'lb-map-traveler-delay-community' "$V2" || { echo "ERREUR: classe retard communautaire absente" >&2; exit 5; }

cp -a "$CORE" "$BACKUP_CORE"
cp -a "$V2" "$BACKUP_V2"

python3 - "$V2" "$CORE" <<'PY'
from pathlib import Path
import re, sys

v2_path = Path(sys.argv[1])
core_path = Path(sys.argv[2])
v2 = v2_path.read_text(encoding='utf-8')
core = core_path.read_text(encoding='utf-8')

tag = 'LB_COMMUNITY_BADGE_BELOW_OFFICIAL_V3'

if tag not in v2:
    # Un seul rafraîchissement de placement par frame, même si beaucoup de trains
    # sont reconstruits dans la même boucle. Aucun polling et aucun observateur global.
    if 'let markerDecorateFrame = 0;' not in v2:
        needle = '  let decorateQueued = false;\n'
        if needle not in v2:
            raise SystemExit('ERREUR: point insertion markerDecorateFrame absent')
        v2 = v2.replace(needle, needle + '  let markerDecorateFrame = 0;\n', 1)

    helper = r'''
  /* LB_COMMUNITY_BADGE_BELOW_OFFICIAL_V3
     Le retard communautaire est ancré au rectangle RÉEL du badge officiel.
     On ne touche ni à la flèche, ni au numéro de train, ni au badge présence. */
  function positionCommunityDelayBelowOfficial(marker, badge){
    if (!marker || !badge) return;
    const official = marker.querySelector('.train-delay-badge');
    if (!official) return;

    const markerRect = marker.getBoundingClientRect();
    const officialRect = official.getBoundingClientRect();
    if (!(officialRect.width > 0) || !(officialRect.height > 0)) return;

    const left = Math.round(officialRect.left - markerRect.left);
    const top = Math.round(officialRect.bottom - markerRect.top + 2);
    const minWidth = Math.max(1, Math.round(officialRect.width));

    badge.style.setProperty('position', 'absolute', 'important');
    badge.style.setProperty('left', `${left}px`, 'important');
    badge.style.setProperty('top', `${top}px`, 'important');
    badge.style.setProperty('right', 'auto', 'important');
    badge.style.setProperty('bottom', 'auto', 'important');
    badge.style.setProperty('transform', 'none', 'important');
    badge.style.setProperty('width', 'auto', 'important');
    badge.style.setProperty('min-width', `${minWidth}px`, 'important');
    badge.style.setProperty('max-width', 'none', 'important');
    badge.style.setProperty('z-index', '9', 'important');
  }
'''
    marker = '  function decorateMarkerBadges(){\n'
    if marker not in v2:
        raise SystemExit('ERREUR: point insertion helper absent')
    v2 = v2.replace(marker, helper + '\n' + marker, 1)

    # Après la finition violette, positionner le badge sous le retard officiel.
    needle = "      badge.classList.add('lb-map-traveler-delay-community');\n"
    repl = needle + '      positionCommunityDelayBelowOfficial(marker, badge);\n'
    if needle not in v2:
        raise SystemExit('ERREUR: classe community introuvable dans decorateMarkerBadges')
    v2 = v2.replace(needle, repl, 1)

    scheduler = r'''
  function scheduleMarkerDecorate(){
    if (markerDecorateFrame) return;
    markerDecorateFrame = requestAnimationFrame(() => {
      markerDecorateFrame = 0;
      try { decorateMarkerBadges(); }
      catch (error) { console.warn('[LB community badge v3]', error); }
    });
  }
'''
    install_marker = '  function installMarkerHook(){\n'
    if install_marker not in v2:
        raise SystemExit('ERREUR: installMarkerHook absent')
    v2 = v2.replace(install_marker, scheduler + '\n' + install_marker, 1)

    # Accepter aussi bien le V2 d'origine que la version optimisée déjà déployée.
    candidates = [
        '      queueMicrotask(() => requestAnimationFrame(decorateMarkerBadges));\n',
        '      // LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône.\n',
    ]
    replaced = False
    for old in candidates:
        if old in v2:
            v2 = v2.replace(old, '      scheduleMarkerDecorate();\n', 1)
            replaced = True
            break
    if not replaced and '      scheduleMarkerDecorate();\n' not in v2:
        raise SystemExit('ERREUR: hook de rafraîchissement marqueur introuvable')

# Cache-busting du seul asset V2 modifié.
core, count = re.subn(
    r'(id="lb-community-traveler-compact-v2" src="\./assets/lb-community-traveler-compact-v2\.js\?v=)[^"]+("[^>]*></script>)',
    r'\g<1>20260906-stack3\2',
    core,
    count=1,
)
if count != 1:
    raise SystemExit('ERREUR: référence V2 dans le core introuvable')

# Garde-fous ciblés.
for expected in (
    tag,
    'positionCommunityDelayBelowOfficial(marker, badge);',
    'scheduleMarkerDecorate();',
    "badge.style.setProperty('position', 'absolute', 'important');",
):
    if expected not in v2:
        raise SystemExit(f'ERREUR: garde-fou V3 absent: {expected}')
if core.count('20260906-stack3') != 1:
    raise SystemExit('ERREUR: cache-bust V3 non unique')

v2_path.write_text(v2, encoding='utf-8')
core_path.write_text(core, encoding='utf-8')
PY

node --check "$V2"
grep -q 'LB_COMMUNITY_BADGE_BELOW_OFFICIAL_V3' "$V2"
grep -q 'positionCommunityDelayBelowOfficial(marker, badge);' "$V2"
grep -q 'scheduleMarkerDecorate();' "$V2"
grep -q '20260906-stack3' "$CORE"

echo "Installation terminée."
echo "- Badge communautaire: ancré par mesure DOM sous le badge officiel"
echo "- Flèche train: non modifiée"
echo "- Badge retard officiel: non modifié"
echo "- Badge présence: non modifié"
echo "- Polling/observer global: aucun"
echo "- Repositionnement: coalescé à 1 fois max par frame"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "V2:   $(sha256sum "$V2" | awk '{print $1}')"

SUCCESS=1
trap - EXIT
