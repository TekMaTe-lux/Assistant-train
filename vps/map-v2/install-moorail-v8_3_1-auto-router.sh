#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v8_3-auto-router.sh"
TMP="$(mktemp -d /tmp/moorail-v831.XXXXXX)"
BASE="$TMP/install-v8_3.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }

echo "============================================================"
echo " MOO RAIL V8.3.1 — CORRECTIF INSTALLATEUR AUTO-ROUTER"
echo "============================================================"

echo "=== 1/4 Téléchargement V8.3 canonique ==="
curl -fsSL "$BASE_URL?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')

# 1) V8 canonique installe le marqueur LB_MOORAIL_VALIDATED_NETWORK_V8.
# Le V8.3 initial cherchait par erreur un nom qui n'existe pas.
old="grep -qF 'LB_MOORAIL_SAFE_COMPOSITION_V8' \"$f\""
new="grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' \"$f\""
if old not in s:
    raise SystemExit('ERREUR: ancre preflight V8.3 absente')
s=s.replace(old,new,1)

# 2) Les tableaux V6 finissent sans virgule sur leur dernier élément.
# V8.3 ajoutait SEA/834100 juste après, ce qui aurait produit un JS invalide.
old_core='''if adds:\n    new=m.group(1)+body.rstrip()+"\\n"+'\\n'.join(adds)+"\\n"+m.group(3)\n    s=s[:m.start()]+new+s[m.end():]'''
new_core='''if adds:\n    clean=body.rstrip()\n    if clean and not clean.endswith(','):\n        clean += ','\n    new=m.group(1)+clean+"\\n"+'\\n'.join(adds)+"\\n"+m.group(3)\n    s=s[:m.start()]+new+s[m.end():]'''
if old_core not in s:
    raise SystemExit('ERREUR: ancre ajout LB_LGV_CORE_CODES absente')
s=s.replace(old_core,new_core,1)

old_conn='''if "'5663'" not in body2:\n    new2=m2.group(1)+body2.rstrip()+"\\n  '5663'\\n"+m2.group(3)\n    s=s[:m2.start()]+new2+s[m2.end():]'''
new_conn='''if "'5663'" not in body2:\n    clean2=body2.rstrip()\n    if clean2 and not clean2.endswith(','):\n        clean2 += ','\n    new2=m2.group(1)+clean2+"\\n  '5663'\\n"+m2.group(3)\n    s=s[:m2.start()]+new2+s[m2.end():]'''
if old_conn not in s:
    raise SystemExit('ERREUR: ancre ajout LB_LGV_CONNECTOR_PREFIXES absente')
s=s.replace(old_conn,new_conn,1)

# 3) Rendre le preflight bavard : si un futur contrôle échoue, on saura lequel.
s=s.replace(
'''grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS"\ngrep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"''',
'''grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS" && echo "  OK éditeur V8"\ngrep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS" && echo "  OK routeur V6"''',1)
s=s.replace(
'''  grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$f"''',
'''  grep -qF 'LB_MOORAIL_VALIDATED_NETWORK_V8' "$f" && echo "  OK moteur V8 : $(basename "$f")"''',1)

p.write_text(s,encoding='utf-8')
print('Correctifs V8.3.1 injectés :')
print(' - marqueur preflight V8 corrigé')
print(' - insertion 566000/834100 avec virgules sûre')
print(' - insertion 5663 avec virgule sûre')
print(' - preflight rendu explicite')
PY

echo "=== 2/4 Contrôle syntaxique du wrapper corrigé ==="
bash -n "$BASE"
grep -qF "LB_MOORAIL_VALIDATED_NETWORK_V8" "$BASE"
! grep -qF "LB_MOORAIL_SAFE_COMPOSITION_V8" "$BASE"
grep -qF "clean=body.rstrip()" "$BASE"
grep -qF "clean2=body2.rstrip()" "$BASE"
echo "Installateur corrigé : OK"

echo "=== 3/4 Exécution V8.3 corrigée ==="
bash "$BASE"

echo "=== 4/4 Contrôles finaux V8.3.1 ==="
ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
JS="$ROOT/public/moorail-route-editor-stops.js"
REPORT="$ROOT/data/route-editor/moorail-v8-v6-auto-route-report.json"
NETWORK="$ROOT/public/data/moorail-network-v8/network.json"

grep -qF 'LB_MOORAIL_VALIDATED_SECTIONS_V8' "$JS"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
grep -qF "'566000'" "$JS"
grep -qF "'834100'" "$JS"
node --check "$JS"
python3 - "$REPORT" "$NETWORK" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding='utf-8'))
n=json.load(open(sys.argv[2],encoding='utf-8'))
assert r.get('version')=='8.3',r.get('version')
assert r.get('tasksConsidered',0)>100,r
assert r.get('applied',0)>0,r
assert n.get('version')==8,n.get('version')
print('Rapport auto-route :',r.get('applied'),'appliquées /',r.get('rejected'),'à revoir')
print('Réseau V8          :',n.get('stats'))
PY

echo
echo "============================================================"
echo " MOO RAIL V8.3.1 INSTALLE ET VALIDE"
echo "============================================================"
