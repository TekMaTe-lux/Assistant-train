#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
SERVICE="labetaillere-map-v2.service"
API="$ROOT/server/route-editor-api.mjs"
COMPILER="$ROOT/scripts/compile-moorail-validations-v2.py"
GENERATED="$ROOT/data/generated"
RUNTIME_BACKUPS="$ROOT/data/route-editor/backups"
HELPER="/usr/local/sbin/moorail-map-v2-restart"
SUDOERS="/etc/sudoers.d/moorail-map-v2-publish"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-publish-v4_3-$STAMP"
SUCCESS=0

rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V4.3..." >&2
  [[ ! -f "$BACKUP/route-editor-api.mjs" ]] || cp -a "$BACKUP/route-editor-api.mjs" "$API"
  [[ ! -f "$BACKUP/compile-moorail-validations-v2.py" ]] || cp -a "$BACKUP/compile-moorail-validations-v2.py" "$COMPILER"
  if [[ -f "$BACKUP/helper.absent" ]]; then rm -f "$HELPER"; elif [[ -f "$BACKUP/moorail-map-v2-restart" ]]; then cp -a "$BACKUP/moorail-map-v2-restart" "$HELPER"; fi
  if [[ -f "$BACKUP/sudoers.absent" ]]; then rm -f "$SUDOERS"; elif [[ -f "$BACKUP/moorail-map-v2-publish.sudoers" ]]; then cp -a "$BACKUP/moorail-map-v2-publish.sudoers" "$SUDOERS"; fi
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
}
trap 'rc=$?; trap - EXIT; rollback; exit $rc' EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ -f "$API" ]] || { echo "ERREUR API absente: $API" >&2; exit 3; }
[[ -f "$COMPILER" ]] || { echo "ERREUR compilateur absent: $COMPILER" >&2; exit 3; }
[[ -d "$GENERATED" ]] || { echo "ERREUR generated absent: $GENERATED" >&2; exit 3; }

PID="$(systemctl show -p MainPID --value "$SERVICE")"
SERVICE_USER="$(systemctl show -p User --value "$SERVICE" | xargs)"
if [[ -z "$SERVICE_USER" && "$PID" =~ ^[0-9]+$ && "$PID" -gt 0 ]]; then
  SERVICE_USER="$(ps -o user= -p "$PID" | xargs)"
fi
SERVICE_USER="${SERVICE_USER:-root}"
SERVICE_GROUP="$(systemctl show -p Group --value "$SERVICE" | xargs)"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}"

echo "============================================================"
echo " MOO RAIL V4.3 — PERMISSIONS PUBLICATION EN 1 CLIC"
echo "============================================================"
echo "Service user : $SERVICE_USER:$SERVICE_GROUP"
echo "Backup       : $BACKUP"

mkdir -p "$BACKUP"
cp -a "$API" "$BACKUP/route-editor-api.mjs"
cp -a "$COMPILER" "$BACKUP/compile-moorail-validations-v2.py"
if [[ -f "$HELPER" ]]; then cp -a "$HELPER" "$BACKUP/moorail-map-v2-restart"; else touch "$BACKUP/helper.absent"; fi
if [[ -f "$SUDOERS" ]]; then cp -a "$SUDOERS" "$BACKUP/moorail-map-v2-publish.sudoers"; else touch "$BACKUP/sudoers.absent"; fi

echo "=== 1/6 Backup runtime dans data/route-editor ==="
python3 - "$COMPILER" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old="backup = ROOT / f'backups/moorail-compile-v2-{stamp}'"
new="backup = ROOT / f'data/route-editor/backups/moorail-compile-v2-{stamp}'"
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('ERREUR: ancre backup compilateur introuvable')
p.write_text(s,encoding='utf-8')
PY
python3 -m py_compile "$COMPILER"

install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$RUNTIME_BACKUPS"

echo "=== 2/6 Droit minimal d'écriture data/generated ==="
if command -v setfacl >/dev/null 2>&1; then
  setfacl -m "u:${SERVICE_USER}:rwx" "$GENERATED"
  echo "ACL utilisateur ajoutée sur data/generated"
else
  chgrp "$SERVICE_GROUP" "$GENERATED"
  chmod g+rwx "$GENERATED"
  echo "Groupe $SERVICE_GROUP autorisé sur data/generated (setfacl absent)"
fi

# Vérification réelle sans toucher trips.json/paths.json.
sudo -u "$SERVICE_USER" /bin/sh -c "f='${GENERATED}/.moorail-write-test-$$'; : > \"\$f\" && rm -f \"\$f\""
sudo -u "$SERVICE_USER" /bin/sh -c "d='${RUNTIME_BACKUPS}/.moorail-dir-test-$$'; mkdir \"\$d\" && rmdir \"\$d\""
echo "Écriture runtime : OK"

echo "=== 3/6 Helper root limité pour le redémarrage ==="
cat > "$HELPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
UNIT="moorail-map-restart-$(date +%s%N)"
exec /usr/bin/systemd-run --quiet --unit="$UNIT" --on-active=1s /bin/systemctl restart labetaillere-map-v2.service
EOF
chown root:root "$HELPER"
chmod 0755 "$HELPER"

cat > "$SUDOERS" <<EOF
$SERVICE_USER ALL=(root) NOPASSWD: $HELPER
EOF
chmod 0440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null

echo "=== 4/6 API : utiliser le helper de redémarrage ==="
python3 - "$API" <<'PY'
from pathlib import Path
import sys,re
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
start=s.find('  function scheduleRestart() {')
end=s.find('\n\n  return function handleMoorailRouteEditor', start)
if start < 0 or end < 0:
    raise SystemExit('ERREUR: fonction scheduleRestart introuvable')
new='''  function scheduleRestart() {
    try {
      execFileSync('/usr/bin/sudo',['-n','/usr/local/sbin/moorail-map-v2-restart'],{stdio:'ignore',timeout:5000});
      return {scheduled:true,method:'sudo-helper'};
    } catch(error) {
      return {scheduled:false,error:error.message};
    }
  }'''
s=s[:start]+new+s[end:]
p.write_text(s,encoding='utf-8')
PY
node --check "$API"

echo "=== 5/6 Contrôles sous l'utilisateur du service ==="
# Diagnostic seulement : aucun --apply.
sudo -u "$SERVICE_USER" env MOORAIL_ROOT="$ROOT" /usr/bin/python3 "$COMPILER" --json >/tmp/moorail-v43-diagnostic.json
python3 - <<'PY'
import json
p=json.load(open('/tmp/moorail-v43-diagnostic.json',encoding='utf-8'))
assert p.get('ok') is True,p
print('Diagnostic compilateur : OK')
print('Variantes prêtes       :',p.get('totals',{}).get('routes'))
print('Circulations prêtes    :',p.get('totals',{}).get('trips'))
PY
sudo -u "$SERVICE_USER" sudo -n "$HELPER"
sleep 2

echo "=== 6/6 Redémarrage + health ==="
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/tmp/moorail-v43-health.json 2>/dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
python3 - <<'PY'
import json
h=json.load(open('/tmp/moorail-v43-health.json',encoding='utf-8'))
assert h.get('ok') is True,h
print('Map V2 health : OK',h)
PY

SUCCESS=1
trap - EXIT

echo
echo "============================================================"
echo " MOO RAIL V4.3 INSTALLE — PUBLICATION AUTORISEE"
echo "============================================================"
echo "Le bouton Publier peut maintenant :"
echo " - créer son backup runtime"
echo " - écrire trips.json / paths.json"
echo " - programmer le redémarrage Map V2 via helper root limité"
echo "Backup install : $BACKUP"
echo "============================================================"
