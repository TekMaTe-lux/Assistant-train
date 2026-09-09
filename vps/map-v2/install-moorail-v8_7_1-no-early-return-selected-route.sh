#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d /tmp/moorail-v871.XXXXXX)"
BASE="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
CANON="$TMP/install-v87.sh"

cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }

echo "============================================================"
echo " MOO RAIL V8.7.1 — CORRECTIF CONTROLE STRUCTUREL V8.7"
echo "============================================================"

echo "=== 1/4 Téléchargement V8.7 canonique ==="
curl -fsSL "$BASE/install-moorail-v8_7-no-early-return-selected-route.sh?$STAMP" -o "$CANON"
chmod 700 "$CANON"

echo "=== 2/4 Correction du contrôle : vérifier les COPIES patchées, pas les originaux ==="
python3 - "$CANON" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old='''echo "=== 3/7 CONTROLE STRUCTUREL ==="\npython3 - "${CORES[@]}" <<'PY'\n'''
new='''echo "=== 3/7 CONTROLE STRUCTUREL ==="\n# V8.7.1 : le contrôle doit porter sur les fichiers déjà patchés dans $TMP/cores.\n# L'ancienne V8.7 contrôlait par erreur les fichiers actifs encore inchangés,\n# ce qui provoquait un AssertionError puis un rollback avant l'installation.\npython3 - \\\n  "$TMP/cores/carte-core-canonical-v4-preview.html" \\\n  "$TMP/cores/carte-core-preview.html" <<'PY'\n'''
if old not in s:
    raise SystemExit('ERREUR: bloc de contrôle structurel V8.7 attendu introuvable')
s=s.replace(old,new,1)
s=s.replace(' MOO RAIL V8.7 — SUPPRESSION DU EARLY RETURN TRIP-ID',' MOO RAIL V8.7.1 — SUPPRESSION DU EARLY RETURN TRIP-ID',1)
s=s.replace(' MOO RAIL V8.7 INSTALLE ET VALIDE',' MOO RAIL V8.7.1 INSTALLE ET VALIDE',1)
p.write_text(s,encoding='utf-8')
print('Correctif appliqué : contrôle structurel -> $TMP/cores/*')
PY

# Refuse de continuer si la mauvaise invocation subsiste.
if grep -qF 'python3 - "${CORES[@]}"' "$CANON"; then
  echo "ERREUR: ancien contrôle structurel encore présent" >&2
  exit 3
fi
grep -qF '"$TMP/cores/carte-core-canonical-v4-preview.html"' "$CANON"
grep -qF '"$TMP/cores/carte-core-preview.html"' "$CANON"

echo "=== 3/4 Contrôle syntaxique du script corrigé ==="
bash -n "$CANON"
echo "Installateur corrigé : OK"

echo "=== 4/4 Exécution V8.7.1 ==="
bash "$CANON"
RC=$?
if [[ "$RC" -ne 0 ]]; then
  echo "ERREUR: V8.7.1 a échoué avec RC=$RC" >&2
  exit "$RC"
fi

echo
echo "============================================================"
echo " MOO RAIL V8.7.1 WRAPPER TERMINE AVEC SUCCES"
echo "============================================================"
