#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-}"
ROOT="/opt/lb-rail-engine-v1"
MAP="/opt/labetaillere-map-v2-src/map-v2"
STATE="$ROOT/state"
DB="$ROOT/data/timetable-v3-france-preview.sqlite"
HEALTH="$STATE/moorail-global-hs-v7-health.json"
SNAP="$MAP/public/data/france-v3-active-now.json"
HOT="lb-rail-v3-france-hot-snapshot-preview.service"
GTFS="lb-rail-v3-gtfs-update.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
MANIFEST="$STATE/moorail-review-purge-v2-$STAMP.json"
TEST_HTML="$MAP/public/france-v3-moorail-router-test.html"

TARGETS=(
  "$ROOT/router-test"
  "$ROOT/geometry/build-france-v1"
  "$MAP/public/community-site-test-v1"
  "$MAP/public/community-site-test-v1.bak-20260905-120942-374778042"
  "$MAP/public/data/moorail-router-test-backup-20260908-075944"
  "$MAP/public/data/moorail-router-test-current"
)

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ "$MODE" == "--apply" || "$MODE" == "--dry-run" ]] || {
  echo "Usage: sudo bash $0 --dry-run|--apply" >&2
  exit 2
}

human() { numfmt --to=iec-i --suffix=B "${1:-0}" 2>/dev/null || echo "${1:-0} B"; }
sizeb() { du -sb -- "$1" 2>/dev/null | awk '{print $1}' || echo 0; }

precheck() {
  echo "===================================================================================================="
  echo " LA BETAILLERE — PURGE REVIEW SAFE V2"
  echo " Supprime uniquement les anciens jeux de test identifiés par l'audit V2."
  echo "===================================================================================================="

  systemctl is-active --quiet "$HOT" || { echo "ERREUR: snapshot France inactif" >&2; exit 3; }
  if systemctl is-active --quiet "$GTFS"; then
    echo "ERREUR: mise à jour GTFS en cours, purge refusée" >&2
    exit 3
  fi

  python3 - "$DB" "$HEALTH" "$SNAP" <<'PY'
import json, sqlite3, sys
from pathlib import Path

dbpath, hp, sp = map(Path, sys.argv[1:4])
assert dbpath.exists(), dbpath
assert hp.exists(), hp
assert sp.exists(), sp

h=json.loads(hp.read_text(encoding='utf-8'))
assert h.get('status')=='ok', h
assert int(h.get('unresolved') or 0)==0, h
assert h.get('post_update') is True, h

s=json.loads(sp.read_text(encoding='utf-8'))
assert s.get('ok') is True, s
assert int(s.get('count') or 0)>0, s

db=sqlite3.connect(f'file:{dbpath}?mode=ro', uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
orph=db.execute('''SELECT COUNT(*) FROM trip_geometry g LEFT JOIN trips t ON t.trip_pk=g.trip_pk LEFT JOIN rail_paths p ON p.path_id=g.path_id WHERE t.trip_pk IS NULL OR p.path_id IS NULL''').fetchone()[0]
assert orph==0, orph
for n in ('8602','6702','9713','9203','9206','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    gp=db.execute("""SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%'""",(n,)).fetchone()[0]
    if total:
        assert gp==total,(n,gp,total)
db.close()
print('PRECHECK OK | health=ok | DB=ok | snapshot count=',s.get('count'))
PY

  # Aucun process ne doit avoir sa ligne de commande dans une cible.
  for t in "${TARGETS[@]}"; do
    if ps -eo pid,args --no-headers | grep -F -- "$t" | grep -v -E 'grep -F|purge-moorail-review-safe-v2' >/dev/null; then
      echo "ERREUR: processus actif référence $t" >&2
      ps -eo pid,args --no-headers | grep -F -- "$t" | grep -v grep >&2 || true
      exit 4
    fi
  done

  # Refus si systemd/nginx/apache référence une cible.
  for t in "${TARGETS[@]}"; do
    b="$(basename "$t")"
    if grep -RIlF -- "$b" /etc/systemd/system /lib/systemd/system /etc/nginx /etc/apache2 2>/dev/null | grep -v '^$' >/dev/null; then
      echo "ERREUR: référence système trouvée pour $b" >&2
      grep -RInF -- "$b" /etc/systemd/system /lib/systemd/system /etc/nginx /etc/apache2 2>/dev/null | head -30 >&2 || true
      exit 4
    fi
  done

  # La seule référence applicative admise est la page de test elle-même.
  refs="$(grep -RIlE 'moorail-router-test-current|moorail-router-test-backup-20260908-075944|community-site-test-v1|build-france-v1|/router-test' "$MAP/public" "$MAP/scripts" "$ROOT/app" 2>/dev/null || true)"
  if [[ -n "$refs" ]]; then
    bad="$(printf '%s\n' "$refs" | grep -vFx "$TEST_HTML" || true)"
    if [[ -n "$bad" ]]; then
      echo "ERREUR: références applicatives inattendues trouvées:" >&2
      printf '%s\n' "$bad" >&2
      exit 4
    fi
  fi
}

precheck

TOTAL=0
EXISTING=()
for t in "${TARGETS[@]}"; do
  if [[ -e "$t" ]]; then
    s="$(sizeb "$t")"
    TOTAL=$((TOTAL+s))
    EXISTING+=("$t")
  fi
done
if [[ -e "$TEST_HTML" ]]; then
  s="$(sizeb "$TEST_HTML")"
  TOTAL=$((TOTAL+s))
fi

echo
echo "Cibles REVIEW réellement présentes : ${#EXISTING[@]}"
for t in "${EXISTING[@]}"; do
  printf '  %-10s %s\n' "$(human "$(sizeb "$t")")" "$t"
done
[[ -e "$TEST_HTML" ]] && printf '  %-10s %s [page de test devenue orpheline]\n' "$(human "$(sizeb "$TEST_HTML")")" "$TEST_HTML"
echo "TOTAL estimé : $(human "$TOTAL")"

python3 - "$MANIFEST" "$MODE" "$TOTAL" "$TEST_HTML" "${TARGETS[@]}" <<'PY'
import json, os, sys, datetime
from pathlib import Path
out=Path(sys.argv[1]); mode=sys.argv[2]; total=int(sys.argv[3]); test=sys.argv[4]; targets=sys.argv[5:]
rows=[]
for p in targets+[test]:
    q=Path(p)
    rows.append({'path':p,'exists':q.exists()})
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':mode,'estimatedBytes':total,'targets':rows},indent=2),encoding='utf-8')
print('Manifest:',out)
PY

if [[ "$MODE" == "--dry-run" ]]; then
  echo
echo "DRY-RUN TERMINE — rien supprimé."
  exit 0
fi

echo
echo "Suppression du lot REVIEW…"
for t in "${EXISTING[@]}"; do
  case "$t" in
    "$ROOT/router-test"|"$ROOT/geometry/build-france-v1"|"$MAP/public/community-site-test-v1"|"$MAP/public/community-site-test-v1.bak-20260905-120942-374778042"|"$MAP/public/data/moorail-router-test-backup-20260908-075944"|"$MAP/public/data/moorail-router-test-current")
      rm -rf --one-file-system -- "$t"
      ;;
    *) echo "ERREUR whitelist: $t" >&2; exit 6;;
  esac
done
[[ -e "$TEST_HTML" ]] && rm -f -- "$TEST_HTML"

# Postcheck identique, sans toucher aux services.
python3 - "$DB" "$HEALTH" "$SNAP" <<'PY'
import json, sqlite3, sys
from pathlib import Path
D,H,S=map(Path,sys.argv[1:4])
h=json.loads(H.read_text()); s=json.loads(S.read_text())
assert h.get('status')=='ok' and int(h.get('unresolved') or 0)==0 and h.get('post_update') is True
assert s.get('ok') is True and int(s.get('count') or 0)>0
db=sqlite3.connect(f'file:{D}?mode=ro',uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for n in ('8602','6702','9713','9203','9206','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    gp=db.execute("""SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%'""",(n,)).fetchone()[0]
    print(f'{n}: global={gp}/{total}')
    if total: assert gp==total
db.close()
print('POSTCHECK OK | health=ok | DB=ok | snapshot count=',s.get('count'))
PY
systemctl is-active --quiet "$HOT"
curl -fsS --max-time 10 https://vps.labetaillere.fr/map-v2/france-v3-preview.html >/dev/null && echo "HTTP france-v3-preview.html : OK"

echo
echo "Espace disque final :"
df -h /
echo "Taille engine : $(du -sh "$ROOT" 2>/dev/null | awk '{print $1}')"
echo "Taille map-v2 : $(du -sh "$MAP" 2>/dev/null | awk '{print $1}')"

echo
echo "===================================================================================================="
echo " OK — PURGE REVIEW SAFE V2 TERMINEE"
echo " Anciens jeux router/build/community de test supprimés."
echo " Prod V7.3.1, DB, snapshot, sections, sources et rollbacks récents inchangés."
echo " Manifest : $MANIFEST"
echo "===================================================================================================="
