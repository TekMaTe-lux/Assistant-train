#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
V1="$ROOT/map-v2/public/assets/lb-community-traveler-v1.js"
V2="$ROOT/map-v2/public/assets/lb-community-traveler-compact-v2.js"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"

for f in "$CORE" "$V1" "$V2"; do
  [[ -f "$f" ]] || { echo "ERREUR: fichier introuvable: $f" >&2; exit 2; }
done

auto_backup(){
  local f="$1"
  cp -a "$f" "$f.bak-community-fast-marker-stack-v1-$STAMP"
}
auto_backup "$CORE"
auto_backup "$V1"
auto_backup "$V2"

python3 - "$V1" "$V2" "$CORE" <<'PY'
from pathlib import Path
import re
import sys

v1_path, v2_path, core_path = map(Path, sys.argv[1:4])
v1 = v1_path.read_text(encoding='utf-8')
v2 = v2_path.read_text(encoding='utf-8')
core = core_path.read_text(encoding='utf-8')

# 1) V1 : le marqueur est déjà construit avec le snapshot courant. Inutile de
# rescanner tous les .cow-marker après chaque iconForTrain().
needle_refresh = "        queueMicrotask(scheduleMarkerRefresh);\n"
if needle_refresh in v1:
    v1 = v1.replace(
        needle_refresh,
        "        // LB_COMMUNITY_FAST_MARKER_STACK_V1: pas de rescan global par icône.\n",
        1,
    )
elif 'LB_COMMUNITY_FAST_MARKER_STACK_V1: pas de rescan global par icône.' not in v1:
    raise SystemExit('ERREUR: hook iconForTrain V1 introuvable')

# 2) V1 : produire directement le badge violet final dans le HTML des nouvelles icônes.
old_html = '''      ? `<span class="lb-map-traveler-delay" title="Retard annoncé par les voyageurs : +${item.delayMin} min" aria-label="Retard voyageurs plus ${item.delayMin} minutes">(🐮 +${item.delayMin})</span>`'''
new_html = '''      ? `<span class="lb-map-traveler-delay lb-map-traveler-delay-community" title="Retard signalé par la communauté : +${item.delayMin} min (* = communauté)" aria-label="Retard communautaire de ${item.delayMin} minutes">+${item.delayMin}min*</span>`'''
if old_html in v1:
    v1 = v1.replace(old_html, new_html, 1)
elif new_html not in v1:
    raise SystemExit('ERREUR: HTML badge V1 introuvable')

# 3) V1 : même rendu lors d'un snapshot communautaire (rafraîchissement rare/ciblé).
old_class = "        delay.className = 'lb-map-traveler-delay';\n"
new_class = "        delay.className = 'lb-map-traveler-delay lb-map-traveler-delay-community';\n"
if old_class in v1:
    v1 = v1.replace(old_class, new_class, 1)
elif new_class not in v1:
    raise SystemExit('ERREUR: classe delay V1 introuvable')

old_text = "        delay.textContent = `(🐮 +${item.delayMin})`;\n"
new_text = "        delay.textContent = `+${item.delayMin}min*`;\n"
if old_text in v1:
    v1 = v1.replace(old_text, new_text, 1)
elif new_text not in v1:
    raise SystemExit('ERREUR: texte delay V1 introuvable')

# 4) V2 : inutile de rescanner tous les marqueurs après CHAQUE iconForTrain.
# Les nouvelles icônes sortent déjà en violet via V1 ; les snapshots continuent
# d'appeler scheduleDecorate() pour mettre à jour les changements communautaires.
needle_v2 = "      queueMicrotask(() => requestAnimationFrame(decorateMarkerBadges));\n"
if needle_v2 in v2:
    v2 = v2.replace(
        needle_v2,
        "      // LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône.\n",
        1,
    )
elif 'LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône.' not in v2:
    raise SystemExit('ERREUR: hook iconForTrain V2 introuvable')

# 5) CSS pur : retard officiel à droite, retard communautaire EXACTEMENT dessous.
# Important : on remplace aussi une ancienne version du bloc au lieu de la laisser
# en place. Cela évite qu'un vieux CSS conserve le badge violet sous la flèche.
style_marker = 'LB_COMMUNITY_MARKER_STACK_CSS_V1'
css = r'''
<style id="lb-community-marker-stack-css-v1">
/* LB_COMMUNITY_MARKER_STACK_CSS_V1
   SNCF = colonne droite / ligne 1 ; communauté = même colonne / ligne 2.
   Le badge présence reste géré séparément et n'est pas déplacé. */
html body .cow-marker:has(> .train-delay-badge):has(> .lb-map-traveler-delay-community){
  display:grid!important;
  grid-template-columns:auto auto max-content!important;
  grid-template-rows:auto auto!important;
  column-gap:var(--marker-gap,4px)!important;
  row-gap:2px!important;
  align-items:center!important;
  overflow:visible!important;
}
html body .cow-marker:has(> .train-delay-badge):has(> .lb-map-traveler-delay-community) > .cow-glyph{
  grid-column:1!important;
  grid-row:1 / span 2!important;
  align-self:center!important;
}
html body .cow-marker:has(> .train-delay-badge):has(> .lb-map-traveler-delay-community) > .train-num{
  grid-column:2!important;
  grid-row:1 / span 2!important;
  align-self:center!important;
}
html body .cow-marker:has(> .train-delay-badge):has(> .lb-map-traveler-delay-community) > .train-delay-badge{
  grid-column:3!important;
  grid-row:1!important;
  position:relative!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  transform:none!important;
  margin-left:0!important;
  margin-right:0!important;
  justify-self:stretch!important;
  align-self:end!important;
  box-sizing:border-box!important;
  z-index:7!important;
}
html body .cow-marker:has(> .train-delay-badge):has(> .lb-map-traveler-delay-community) > .lb-map-traveler-delay-community{
  grid-column:3!important;
  grid-row:2!important;
  position:static!important;
  inset:auto!important;
  left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  transform:none!important;
  width:100%!important;
  min-width:100%!important;
  max-width:none!important;
  min-height:10px!important;
  height:auto!important;
  box-sizing:border-box!important;
  margin:0!important;
  padding:1px 3px!important;
  border:1px solid rgba(183,140,255,.68)!important;
  border-radius:4px!important;
  background:rgba(61,34,91,.94)!important;
  color:#f3ebff!important;
  font-size:7.5px!important;
  font-weight:900!important;
  line-height:1!important;
  box-shadow:0 0 4px rgba(183,140,255,.18)!important;
  justify-self:stretch!important;
  align-self:start!important;
  z-index:8!important;
}
/* Sans retard officiel, conserver le placement historique près de la flèche. */
html body .cow-marker:not(:has(> .train-delay-badge)) > .lb-map-traveler-delay-community{
  border-color:rgba(183,140,255,.68)!important;
  background:rgba(61,34,91,.94)!important;
  color:#f3ebff!important;
  font-size:7.5px!important;
  min-height:10px!important;
  padding:1px 3px!important;
  box-shadow:0 0 4px rgba(183,140,255,.18)!important;
}
</style>
'''
style_pattern = re.compile(
    r'<style\s+id=["\']lb-community-marker-stack-css-v1["\'][^>]*>.*?</style>',
    re.S | re.I,
)
if style_pattern.search(core):
    core = style_pattern.sub(css.strip(), core, count=1)
else:
    lower = core.lower()
    pos = lower.rfind('</head>')
    if pos < 0:
        raise SystemExit('ERREUR: </head> absent du core')
    core = core[:pos] + css + '\n' + core[pos:]

# 6) Cache-busting uniquement des deux assets communautaires modifiés.
core = re.sub(
    r'(id="lb-community-traveler-v1" src="\./assets/lb-community-traveler-v1\.js\?v=)[^"]+("[^>]*></script>)',
    r'\g<1>20260906-fast2\2',
    core,
)
core = re.sub(
    r'(id="lb-community-traveler-compact-v2" src="\./assets/lb-community-traveler-compact-v2\.js\?v=)[^"]+("[^>]*></script>)',
    r'\g<1>20260906-fast2\2',
    core,
)

# Garde-fous : ne jamais réintroduire le script lourd précédent.
if 'lb-map-visual-stability-v1' in core:
    raise SystemExit('ERREUR: ancien script visual-stability encore raccordé')
if 'LB_SERVICE_DAY_ROLLOVER_V1' not in core:
    raise SystemExit('ERREUR: correctif jour ferroviaire absent ; arrêt par sécurité')
if core.count(style_marker) != 1:
    raise SystemExit('ERREUR: CSS marker stack non unique')
if core.count('id="lb-community-marker-stack-css-v1"') != 1:
    raise SystemExit('ERREUR: style marker stack dupliqué')
if 'queueMicrotask(scheduleMarkerRefresh);' in v1:
    raise SystemExit('ERREUR: rescan global V1 encore présent')
if 'requestAnimationFrame(decorateMarkerBadges)' in v2:
    raise SystemExit('ERREUR: rescan global V2 encore présent')

v1_path.write_text(v1, encoding='utf-8')
v2_path.write_text(v2, encoding='utf-8')
core_path.write_text(core, encoding='utf-8')
PY

node --check "$V1"
node --check "$V2"

# Vérifications fonctionnelles/statistiques ciblées.
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: pas de rescan global par icône' "$V1"
grep -q 'LB_COMMUNITY_FAST_MARKER_STACK_V1: rendu déjà final, aucun rescan par icône' "$V2"
grep -q 'LB_COMMUNITY_MARKER_STACK_CSS_V1' "$CORE"
grep -q 'grid-row:2!important' "$CORE"
grep -q 'position:static!important' "$CORE"
grep -q 'lb-community-traveler-v1.js?v=20260906-fast2' "$CORE"
grep -q 'lb-community-traveler-compact-v2.js?v=20260906-fast2' "$CORE"

echo "Installation terminée."
echo "- Jour ferroviaire conservé: oui"
echo "- Rescan global par iconForTrain V1: supprimé"
echo "- Rescan global par iconForTrain V2: supprimé"
echo "- Badge SNCF: ligne droite haute"
echo "- Badge communautaire: même colonne, ligne juste dessous"
echo "- Badge présence: non déplacé"
echo "- Mesure DOM pour l'alignement SNCF: aucune"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "V1:   $(sha256sum "$V1" | awk '{print $1}')"
echo "V2:   $(sha256sum "$V2" | awk '{print $1}')"
