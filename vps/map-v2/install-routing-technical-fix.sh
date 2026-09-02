#!/usr/bin/env bash
set -euo pipefail

# Déploiement V2 du correctif de routage.
# Le cœur audité est figé sur le commit d'origine ; on ne corrige ici que
# l'ancre trop générique de la preview et le redémarrage inutile au rollback.
CORE_COMMIT="cb854d334208e0e983f80167f3e2c00f3996a608"
CORE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${CORE_COMMIT}/vps/map-v2/install-routing-technical-fix.sh"
TMP="$(mktemp -d /tmp/lb-routing-installer-v2.XXXXXX)"
CORE="$TMP/core.sh"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$CORE_URL" -o "$CORE"

python3 - "$CORE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

old = '''rep(
    "      rebuildStaticMergeData();\\n      prepareStationMetadata();\\n      renderAxisStations();",
    "      sanitizeTechnicalRailStopTimes();\\n      rebuildStaticMergeData();\\n      prepareStationMetadata();\\n      renderAxisStations();",
    "cache statique"
)'''
new = '''rep(
    "      rebuildStaticMergeData();\\n"
    "      prepareStationMetadata();\\n"
    "      renderAxisStations();\\n\\n"
    "      const c = payload.counters || {};",
    "      sanitizeTechnicalRailStopTimes();\\n"
    "      rebuildStaticMergeData();\\n"
    "      prepareStationMetadata();\\n"
    "      renderAxisStations();\\n\\n"
    "      const c = payload.counters || {};",
    "cache statique ciblé"
)'''

count = text.count(old)
if count != 1:
    raise SystemExit(f"ERREUR wrapper V2: bloc cache de l'installeur trouvé {count} fois")
text = text.replace(old, new, 1)

# Sur un échec avant l'étape service, aucun fichier consommé par le processus
# n'a besoin d'un restart. Cela évite un redémarrage inutile pendant un rollback.
old_rollback = '  systemctl restart "$SERVICE" >/dev/null 2>&1 || true\n'
new_rollback = '''  if [[ -f "$TMP/service-restarted" ]]; then
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
'''
count = text.count(old_rollback)
if count != 1:
    raise SystemExit(f"ERREUR wrapper V2: restart rollback trouvé {count} fois")
text = text.replace(old_rollback, new_rollback, 1)

old_restart = 'systemctl restart "$SERVICE"\nsleep 2\n'
new_restart = 'touch "$TMP/service-restarted"\nsystemctl restart "$SERVICE"\nsleep 2\n'
count = text.count(old_restart)
if count != 1:
    raise SystemExit(f"ERREUR wrapper V2: restart principal trouvé {count} fois")
text = text.replace(old_restart, new_restart, 1)

# Contrôles de structure avant d'exécuter quoi que ce soit sur le VPS.
assert 'cache statique ciblé' in text
assert 'const c = payload.counters || {};' in text
assert 'touch "$TMP/service-restarted"' in text
path.write_text(text, encoding="utf-8")
print("Installeur V2 préparé : ancre cache statique ciblée")
PY

chmod 0755 "$CORE"
bash "$CORE"
