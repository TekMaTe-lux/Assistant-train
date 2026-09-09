#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
NETWORK="$PUBLIC/data/moorail-network-v8/network.json"
LIVE="$PUBLIC/data/moorail-live-v1/sections.json"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-v8_6-selected-number-$STAMP"
TMP="$(mktemp -d /tmp/moorail-v86.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V8.6..." >&2
  for n in carte-core-canonical-v4-preview.html carte-core-preview.html; do
    [[ -f "$BACKUP/$n" ]] && cp -a "$BACKUP/$n" "$PUBLIC/$n" || true
  done
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$NETWORK" "$LIVE"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done

CORES=()
for n in carte-core-canonical-v4-preview.html carte-core-preview.html; do
  f="$PUBLIC/$n"
  [[ -f "$f" ]] || continue
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' "$f" || continue
  grep -qF 'function lbMoorailSelectedTrainNumberV85(trainId)' "$f" || continue
  CORES+=("$f")
done
[[ ${#CORES[@]} -gt 0 ]] || { echo "ERREUR: cores V8.5 introuvables" >&2; exit 4; }

echo "============================================================"
echo " MOO RAIL V8.6 — NUMERO DU TRAIN SELECTIONNE"
echo "============================================================"

echo "=== 0/6 PRE-FLIGHT ==="
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health.json"
python3 - "$TMP/health.json" "$NETWORK" "$LIVE" <<'PY'
import json,sys,unicodedata
h=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]));l=json.load(open(sys.argv[3]))
assert h.get('ok') is True,h
r=(n.get('trainRoutes') or {}).get('2656') or []
assert r,'trainRoutes[2656] absent'
def norm(s):
 s=unicodedata.normalize('NFKD',str(s or ''));return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()
pairs={(norm(x.get('from')),norm(x.get('to'))) for x in (l.get('pairs') or [])}
var=next((v for v in r if [x.get('name') for x in v.get('stops') or []]==['Metz','Meuse TGV','Paris Est']),None)
assert var,var
ss=[x.get('name') for x in var['stops']]
assert all((norm(a),norm(b)) in pairs for a,b in zip(ss,ss[1:])),ss
print('Health :',h)
print('2656 données : OK |',' → '.join(ss))
print('2656 sections LIVE : OK')
PY

echo "=== 1/6 BACKUP ==="
mkdir -p "$BACKUP"
for f in "${CORES[@]}"; do cp -a "$f" "$BACKUP/$(basename "$f")"; done

echo "=== 2/6 PATCH NUMERO : numberDigits/numberKey/numberRaw/headsign ==="
mkdir -p "$TMP/cores"
for f in "${CORES[@]}"; do
  out="$TMP/cores/$(basename "$f")"
  cp -a "$f" "$out"
  python3 - "$out" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_SELECTED_NUMBER_V86 */'
if marker in s:
    print('Déjà V8.6 :',p)
    raise SystemExit(0)
pat=re.compile(r"  function lbMoorailSelectedTrainNumberV85\(trainId\)\{.*?\n  \}\n\n  function lbMoorailSelectedFromNamedStopsV85",re.S)
m=pat.search(s)
if not m: raise SystemExit('ERREUR fonction numero V8.5 introuvable')
new=r'''  /* LB_MOORAIL_SELECTED_NUMBER_V86 */
  function lbMoorailSelectedTrainNumberV85(trainId){
    let d=null;
    try{ d=trainDataById.get(trainId) || (typeof buildStaticPanelTrainData==='function'?buildStaticPanelTrainData(trainId):null); }catch(_){ d=null; }

    // Le panneau de la carte utilise couramment numberDigits/numberKey/numberRaw.
    // V8.5 ne lisait pas ces champs : un TGV pouvait donc afficher « 2656 »
    // dans la bulle tout en restant introuvable par le moteur de tracé.
    try{
      if(typeof trainNumberFromData==='function'){
        const n=String(trainNumberFromData(d)||'').match(/[0-9]{2,6}/)?.[0];
        if(n){ console.info('[MOO RAIL V8.6] numéro via trainNumberFromData',n); return n; }
      }
    }catch(_){}

    const vals=[
      d?.numberDigits,d?.numberKey,d?.numberRaw,d?.number,
      d?.trainNumber,d?.train_number,d?.trip_short_name,d?.tripShortName,
      d?.headsign,d?.name,d?.id,trainId
    ];
    for(const raw of vals){
      const text=String(raw||'').trim();
      let m=text.match(/^\D*([0-9]{2,6})\D*$/);
      if(!m)m=text.match(/(?:^|[^0-9])([0-9]{2,6})(?:[^0-9]|$)/);
      if(m){ console.info('[MOO RAIL V8.6] numéro sélectionné',m[1],{trainId,data:d}); return m[1]; }
    }
    console.warn('[MOO RAIL V8.6] numéro introuvable',{trainId,data:d});
    return '';
  }

  function lbMoorailSelectedFromNamedStopsV85'''
s=s[:m.start()]+new+s[m.end():]
p.write_text(s,encoding='utf-8')
PY
  grep -qF 'LB_MOORAIL_SELECTED_NUMBER_V86' "$out"
  grep -qF 'd?.numberDigits,d?.numberKey,d?.numberRaw' "$out"
done

echo "=== 3/6 CONTROLE STRUCTURE + INSTALLATION ==="
for f in "${CORES[@]}"; do
  out="$TMP/cores/$(basename "$f")"
  grep -qF 'LB_MOORAIL_SELECTED_ROUTE_BY_NUMBER_V85' "$out"
  grep -qF 'lbMoorailSelectedRouteForTrainV85(trainId,seq)' "$out"
  install -o root -g root -m 0644 "$out" "$f"
done

echo "=== 4/6 RESTART ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 5/6 PRODUIT SERVI ==="
for f in "${CORES[@]}"; do
  n="$(basename "$f")"
  curl -fsS --max-time 8 "http://127.0.0.1:3111/$n?v=$STAMP" > "$TMP/served-$n"
  grep -qF 'LB_MOORAIL_SELECTED_NUMBER_V86' "$TMP/served-$n"
  grep -qF 'numberDigits,d?.numberKey,d?.numberRaw' "$TMP/served-$n"
  echo "  SERVI : $n"
done

echo "=== 6/6 HEALTH FINAL ==="
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health

echo
SUCCESS=1
trap - EXIT
cleanup

echo "============================================================"
echo " MOO RAIL V8.6 INSTALLE ET VALIDE"
echo "============================================================"
echo "Le tracé sélectionné sait maintenant lire les mêmes champs"
echo "de numéro que ceux utilisés pour afficher le train dans la carte."
echo "Cas cible : TGV 2656 -> trainRoutes[2656] -> sections LIVE."
echo "Backup : $BACKUP"
echo "============================================================"
