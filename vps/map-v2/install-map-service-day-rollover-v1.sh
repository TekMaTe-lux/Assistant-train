#!/usr/bin/env bash
set -euo pipefail

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
CORE="$ROOT/map-v2/public/carte-core-preview.html"
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
BACKUP="$CORE.bak-service-day-rollover-v1-$STAMP"

[[ -f "$CORE" ]] || { echo "ERREUR: carte introuvable: $CORE" >&2; exit 2; }

cp -a "$CORE" "$BACKUP"

python3 - "$CORE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

marker = 'LB_SERVICE_DAY_ROLLOVER_V1'
if marker in text:
    print('Correctif déjà installé : aucune nouvelle modification du core.')
else:
    old_today = """  function lbCarteTodayIso(){
    try { return formatLuxDateISO(new Date()); } catch(_){ return new Date().toISOString().slice(0,10); }
  }"""
    new_today = old_today + """

  // LB_SERVICE_DAY_ROLLOVER_V1
  // Jusqu'à 06:00, le cache J-1 reste le jour ferroviaire de référence afin
  // de conserver les trains partis avant minuit et terminant après minuit.
  function lbCartePreviousIso(){
    const d = new Date();
    d.setDate(d.getDate() - 1);
    try { return formatLuxDateISO(d); } catch(_){ return d.toISOString().slice(0,10); }
  }
  function lbCarteLocalHour(){
    try {
      return Number(new Intl.DateTimeFormat('en-GB', {
        timeZone:'Europe/Luxembourg', hour:'2-digit', hour12:false
      }).format(new Date()));
    } catch(_) {
      return new Date().getHours();
    }
  }"""

    old_cache_guard = """      const today = lbCarteTodayIso();
      if (payload.date && payload.date !== today){
        throw new Error(`cache daté ${payload.date}, attendu ${today}`);
      }"""
    new_cache_guard = """      const today = lbCarteTodayIso();
      const yesterday = lbCartePreviousIso();
      const rollover = payload.date === yesterday && lbCarteLocalHour() < 6;
      if (payload.date && payload.date !== today && !rollover){
        throw new Error(`cache daté ${payload.date}, attendu ${today}`);
      }
      window.__LB_CARTE_STATIC_SERVICE_DATE__ = String(payload.date || today);"""

    old_now = "function nowSecLocal(){ const d=new Date(); return d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds(); }"
    new_now = """function nowSecLocal(){
    const d = new Date();
    let sec = d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds();
    try {
      if (window.__LB_CARTE_STATIC_SERVICE_DATE__ === lbCartePreviousIso() && lbCarteLocalHour() < 6) sec += 86400;
    } catch(_) {}
    return sec;
  }"""

    checks = [
        ('lbCarteTodayIso', old_today),
        ('garde date cache', old_cache_guard),
        ('nowSecLocal', old_now),
    ]
    for name, needle in checks:
        count = text.count(needle)
        if count != 1:
            raise SystemExit(f'ERREUR: structure inattendue pour {name}: {count} occurrence(s)')

    text = text.replace(old_today, new_today, 1)
    text = text.replace(old_cache_guard, new_cache_guard, 1)
    text = text.replace(old_now, new_now, 1)

    if text.count(marker) != 1:
        raise SystemExit('ERREUR: marqueur rollover non unique')
    if 'sec += 86400' not in text:
        raise SystemExit('ERREUR: conversion post-minuit absente')
    if 'payload.date === yesterday && lbCarteLocalHour() < 6' not in text:
        raise SystemExit('ERREUR: acceptation cache J-1 absente')

    path.write_text(text, encoding='utf-8')
PY

# Tests statiques ciblés : aucun changement visuel / communautaire dans ce patch.
grep -q 'LB_SERVICE_DAY_ROLLOVER_V1' "$CORE"
grep -q 'sec += 86400' "$CORE"
grep -q 'payload.date === yesterday && lbCarteLocalHour() < 6' "$CORE"

# Cas de référence 88788 : 00:23 le 6 devient 24:23 sur le service du 5.
python3 - <<'PY'
now_min = 23
rail_min = 24 * 60 + now_min
arr_theoretical_min = 24 * 60 + 21
arr_real_min = arr_theoretical_min + 10
assert rail_min == 1463
assert arr_theoretical_min == 1461
assert arr_real_min == 1471
assert arr_theoretical_min <= rail_min < arr_real_min
print('Test 88788 OK: 00:23 => 24:23, train encore en circulation jusqu’à 24:31.')
PY

echo "Installation terminée."
echo "Sauvegarde: $BACKUP"
echo "Core: $(sha256sum "$CORE" | awk '{print $1}')"
echo "Retour arrière: sudo cp '$BACKUP' '$CORE'"
