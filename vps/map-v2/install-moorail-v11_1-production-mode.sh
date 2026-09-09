#!/usr/bin/env bash
set -euo pipefail

RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2/install-moorail-v11-production-mode.sh"
TMP="$(mktemp -d /tmp/moorail-v111.XXXXXX)"
BASE="$TMP/v11.sh"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL "$RAW?$(date +%s)" -o "$BASE"

python3 - "$BASE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')

s=s.replace('MOO RAIL V11 — MODE PRODUCTION / VALIDER + SUIVANT','MOO RAIL V11.1 — MODE PRODUCTION / RECOVERY',1)
s=s.replace('MOO RAIL V11 INSTALLE — MODE PRODUCTION ACTIF','MOO RAIL V11.1 INSTALLE — MODE PRODUCTION ACTIF',1)

# Runtime : après le refresh réseau, le service peut redémarrer/recharger brièvement.
# On attend explicitement que /health soit revenu avant de relire network/state.
anchor='validateLeg=async function(){'
helper=r'''/* LB_MOORAIL_PRODUCTION_RECOVERY_V111 */
async function lbProductionWaitMapV111(){
  for(let i=0;i<120;i++){
    try{
      const r=await fetch(`/api/map-v2/health?t=${Date.now()}`,{cache:'no-store'});
      if(r.ok){const h=await r.json();if(h?.ok)return h;}
    }catch(_){ }
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Map V2 indisponible après refresh réseau');
}

'''
if anchor not in s:raise SystemExit('ERREUR ancre validateLeg V11 absente')
s=s.replace(anchor,helper+anchor,1)

old="""    state.productionV11.lastRefreshMs=rd.durationMs;state.productionV11.lastValidated=sid;\n    await lbProductionReloadV11();"""
new="""    state.productionV11.lastRefreshMs=rd.durationMs;state.productionV11.lastValidated=sid;\n    await lbProductionWaitMapV111();\n    await lbProductionReloadV11();"""
if old not in s:raise SystemExit('ERREUR ancre refresh runtime V11 absente')
s=s.replace(old,new,1)

# Contrôle du JS généré.
needle="""for x in LB_MOORAIL_PRODUCTION_V11 lbProductionReloadV11 lbProductionNextV11 production-refresh 'Valider + suivant'; do"""
rep="""for x in LB_MOORAIL_PRODUCTION_V11 LB_MOORAIL_PRODUCTION_RECOVERY_V111 lbProductionReloadV11 lbProductionNextV11 production-refresh 'Valider + suivant'; do"""
if needle not in s:raise SystemExit('ERREUR liste contrôle JS V11 absente')
s=s.replace(needle,rep,1)

# Le test final ne doit plus échouer pendant un redémarrage/reload asynchrone.
old_final='''systemctl is-active --quiet "$TIMER"\ncurl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health\n'''
new_final='''systemctl is-active --quiet "$TIMER"\nFINAL_OK=0\nfor i in $(seq 1 60); do\n  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 3 http://127.0.0.1:3111/api/map-v2/health > "$TMP/health-final.json" 2>/dev/null; then\n    FINAL_OK=1\n    break\n  fi\n  echo "  attente récupération map $i/60..."\n  sleep 1\ndone\nif [[ "$FINAL_OK" != 1 ]]; then\n  echo "ERREUR: Map V2 ne revient pas après 60 s" >&2\n  journalctl -u "$SERVICE" -n 40 --no-pager || true\n  exit 7\nfi\ncat "$TMP/health-final.json"\necho\n'''
if old_final not in s:raise SystemExit('ERREUR contrôle health final V11 absent')
s=s.replace(old_final,new_final,1)

# Message final explicite.
s=s.replace(' - refresh network automatique côté serveur',' - refresh network automatique côté serveur\n - attente automatique si Map V2 recharge/redémarre après refresh',1)

p.write_text(s,encoding='utf-8')
print('Correctifs V11.1 injectés :')
print(' - attente runtime après production-refresh')
print(' - health final avec retry 60 s')
print(' - journal systemd seulement si vraie panne')
PY

bash -n "$BASE"
chmod 700 "$BASE"
exec bash "$BASE"
