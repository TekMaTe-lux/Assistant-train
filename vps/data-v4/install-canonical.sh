#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/data-v4"
TARGET="/opt/labetaillere-data-v4"
SERVICE="labetaillere-data-v4.service"
ENV_FILE="/etc/labetaillere-data-v4.env"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$TARGET/backups/canonical-$STAMP"
TMP="$(mktemp -d /tmp/lb-data-v4-canonical.XXXXXX)"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERREUR: lancer avec sudo/root" >&2
  exit 2
fi

mkdir -p "$BACKUP"
for f in server.py server-adapter-v2.py; do
  if [[ -f "$TARGET/$f" ]]; then
    cp -a "$TARGET/$f" "$BACKUP/$f"
  fi
done

curl -fsSL "$REPO_RAW/server.py?t=$STAMP" -o "$TMP/server.py"
curl -fsSL "$REPO_RAW/server-adapter-v2.py?t=$STAMP" -o "$TMP/server-adapter-v2.py"

python3 -m py_compile "$TMP/server.py" "$TMP/server-adapter-v2.py"
python3 "$TMP/server.py" --fixture-test
python3 "$TMP/server-adapter-v2.py" --adapter-fixture-test

# Test avec LES VRAIES sources avant de remplacer le service. Ce self-test
# construit aussi le cache GTFS local du jour : le redémarrage qui suit reste rapide.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
python3 "$TMP/server-adapter-v2.py" --self-test

install -m 0644 "$TMP/server.py" "$TARGET/server.py"
install -m 0644 "$TMP/server-adapter-v2.py" "$TARGET/server-adapter-v2.py"
install -d -o ubuntu -g ubuntu "$TARGET/state"

rollback(){
  echo "ROLLBACK vers $BACKUP" >&2
  for f in server.py server-adapter-v2.py; do
    if [[ -f "$BACKUP/$f" ]]; then
      cp -a "$BACKUP/$f" "$TARGET/$f"
    fi
  done
  systemctl restart "$SERVICE" || true
}

if ! systemctl restart "$SERVICE"; then
  rollback
  exit 3
fi

ok=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3120/api/v4/health -o "$TMP/health.json"; then
    if python3 - "$TMP/health.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
assert p.get('schemaVersion') == '4.1-canonical', p
assert p.get('status') in ('ok','degraded'), p
assert int(p.get('trainCount') or 0) > 0, p
print(json.dumps(p,ensure_ascii=False,indent=2))
PY
    then
      ok=1
      break
    fi
  fi
  sleep 1
done

if [[ "$ok" != 1 ]]; then
  echo "Le nouveau moteur n'a pas validé son healthcheck." >&2
  journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
  rollback
  exit 4
fi

# Vérification structurelle sans modifier le site ou la carte de production.
curl -fsS http://127.0.0.1:3120/api/v4/snapshot -o "$TMP/snapshot.json"
if ! python3 - "$TMP/snapshot.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1],encoding='utf-8'))
trains=s.get('trains') or []
assert s.get('schemaVersion') == '4.1-canonical'
assert trains
checked=0
for t in trains:
    for st in t.get('stops') or []:
        assert 'country' in st
        assert 'network' in st
        assert 'realtimeAuthority' in st
        assert isinstance(st.get('arrival'),dict)
        assert isinstance(st.get('departure'),dict)
        assert isinstance(st.get('delay'),dict)
        checked += 1
assert checked > 0
meta=s.get('meta') or {}
static=meta.get('staticTimetable') or {}
assert meta.get('staticTimetablePolicy') == 'local-gtfs-memory-index-v2', meta.get('staticTimetablePolicy')
requested=int(static.get('requestedTrains') or 0)
matched=int(static.get('matchedTrains') or 0)
if requested > 0:
    assert matched > 0, static
print(f"OK canonique: {len(trains)} trains / {checked} arrêts vérifiés")
print(
    "GTFS statique local: "
    f"{matched}/{requested} trains appariés · "
    f"{static.get('enrichedStops',0)} arrêts planifiés · "
    f"{static.get('derivedRealtimeFields',0)} heures RT dérivées · "
    f"cache={'réutilisé' if static.get('cacheReused') else 'construit'}"
)
for provider,info in (static.get('providers') or {}).items():
    print(
        f" - {provider.upper()}: "
        f"{info.get('matchedTrains',0)}/{info.get('requestedTrains',0)} trains · "
        f"{info.get('enrichedStops',0)} arrêts · "
        f"{info.get('tripCount',0)} trajets actifs · "
        f"{info.get('root') or 'racine inconnue'}"
    )
if static.get('indexErrors'):
    print("ATTENTION index GTFS:", static.get('indexErrors')[:5])
if static.get('errors'):
    print("ATTENTION appariement GTFS:", static.get('errors')[:8])
PY
then
  echo "La validation de l'index GTFS local a échoué." >&2
  journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
  rollback
  exit 5
fi

echo
echo "============================================================"
echo "DATA ENGINE V4 CANONIQUE INSTALLE"
echo "Backup : $BACKUP"
echo "Production web/carte : NON MODIFIEE"
echo "============================================================"
