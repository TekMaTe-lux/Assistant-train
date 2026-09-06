#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/labetaillere-map-v2-src"
SOURCE="$ROOT/vps/home/build_train_static_today.py"
TARGET="/opt/gtfs/build_train_static_today.py"
BACKUP="$TARGET.bak.$(date +%Y%m%d-%H%M%S)"

test -f "$SOURCE"
test -f "$TARGET"
python3 -m py_compile "$SOURCE"
cp -a "$TARGET" "$BACKUP"
install -m 755 "$SOURCE" "$TARGET"
python3 "$TARGET"

python3 - <<'PY'
import json
path = "/var/www/gtfs/train_static_today.json"
with open(path, encoding="utf-8") as stream:
    data = json.load(stream)
assert isinstance(data.get("trains"), dict)
assert isinstance(data.get("next_trains"), dict)
assert data.get("next_horizon_days") == 14
row = data["next_trains"].get("88501")
if row:
    assert len(str(row.get("service_date", ""))) == 8
    assert row.get("departure") and row.get("arrival")
    print("88501 prochaine circulation:", row["service_date"], row["departure"], "→", row["arrival"])
else:
    print("AVERTISSEMENT: 88501 absent de l'horizon GTFS de 14 jours")
print("Cache favoris J/prochain OK:", len(data["trains"]), len(data["next_trains"]))
PY

echo "Installation LB_FAVORITES_NEXT_SERVICE_V1 terminée. Sauvegarde: $BACKUP"
