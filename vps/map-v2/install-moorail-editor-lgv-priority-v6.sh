#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
JS="$PUBLIC/moorail-route-editor-stops.js"
HTML="$PUBLIC/moorail-route-editor.html"
RFN="$PUBLIC/data/moorail-rfn-game-v2"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/moorail-editor-lgv-v6-$STAMP"
TMP="$(mktemp -d /tmp/moorail-lgv-v6.XXXXXX)"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V6..." >&2
  [[ -f "$BACKUP/moorail-route-editor-stops.js" ]] && cp -a "$BACKUP/moorail-route-editor-stops.js" "$JS" || true
  [[ -f "$BACKUP/moorail-route-editor.html" ]] && cp -a "$BACKUP/moorail-route-editor.html" "$HTML" || true
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$JS" "$HTML"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done
[[ -d "$RFN/cells" ]] || { echo "ERREUR cellules RFN absentes: $RFN/cells" >&2; exit 3; }

mkdir -p "$BACKUP"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"

echo "============================================================"
echo " MOO RAIL V6 — ROUTAGE TGV : PRIORITE AUX LGV"
echo "============================================================"
echo "Backup : $BACKUP"

echo "=== 1/6 Audit RFN Ouest : les vraies LGV existent-elles ? ==="
python3 - "$RFN/cells" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1])
# Ouest : Atlantique branche Tours/Le Mans + BPL Rennes.
codes={
 '431000':'LGV Atlantique tronc/Tours',
 '429000':'LGV Atlantique branche Le Mans',
 '408000':'LGV Bretagne-Pays de la Loire',
}
counts={k:0 for k in codes}
files={k:0 for k in codes}
lgv_text=0
for p in root.glob('c_*.geojson'):
    try:s=p.read_text(encoding='utf-8',errors='ignore')
    except:continue
    up=s.upper()
    if 'LGV' in up: lgv_text += up.count('LGV')
    for code in codes:
        # accepte 431000 ou 431 000
        pat=code[:3]+r'\s*'+code[3:]
        n=len(re.findall(r'(?<!\d)'+pat+r'(?!\d)',s))
        if n:
            counts[code]+=n; files[code]+=1
print('Occurrences RFN contenant LGV :',lgv_text)
for code,label in codes.items():
    print(f' {code} {label}: occurrences={counts[code]} fichiers={files[code]}')
print('CORE_PRESENT',all(counts[k]>0 for k in codes))
PY

echo "=== 2/6 Pourquoi l'ancien éditeur se trompe ==="
echo "Ancien moteur : coût = distance physique uniquement."
echo "Sur Rennes/Le Mans/Massy, la ligne classique peut être géométriquement"
echo "plus courte que la LGV : Dijkstra la choisit donc même pour un TGV."

echo "=== 3/6 Patch moteur : coût temps TGV + surlignage LGV ==="
python3 - "$JS" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); s=p.read_text(encoding='utf-8')
marker='/* LB_MOORAIL_LGV_ROUTER_V6 */'
if marker in s:
    print('Déjà patché :',p)
    raise SystemExit(0)

anchor="const RFN='/map-v2/data/moorail-rfn-game-v2';"
if anchor not in s: raise SystemExit('ERREUR ancre RFN absente')
helper=r'''

/* LB_MOORAIL_LGV_ROUTER_V6 */
// Numéros RFN des principales LGV. L'éditeur ne traite que des trains GV,
// donc le coût doit approcher un temps de parcours et non la distance brute.
const LB_LGV_CORE_CODES = [
  '005000', // LGV Est
  '014000', // Rhin-Rhône
  '216000','226000', // LGV Nord
  '431000','429000', // LGV Atlantique
  '408000', // LGV Bretagne-Pays de la Loire
  '752000', // LGV Sud-Est
  '834000'  // LGV Méditerranée
];
const LB_LGV_CONNECTOR_PREFIXES = [
  '0053','0143','2163','2263','4313','4293','4083','7523','8343'
];
function lbPropsText(props){
  try{return JSON.stringify(props||{}).toUpperCase();}catch(_){return '';}
}
function lbHasRailCode(txt,code){
  const a=code.slice(0,3),b=code.slice(3);
  return new RegExp(`(^|[^0-9])${a}\\s*${b}([^0-9]|$)`).test(txt);
}
function lbRailCodesInProps(props){
  const txt=lbPropsText(props),out=[];
  for(const c of LB_LGV_CORE_CODES)if(lbHasRailCode(txt,c))out.push(c);
  // Raccordements : détecte les numéros complets commençant par le préfixe.
  const nums=txt.match(/(^|[^0-9])([0-9]{6})(?=[^0-9]|$)/g)||[];
  for(const raw of nums){
    const n=(raw.match(/[0-9]{6}/)||[])[0];
    if(n&&LB_LGV_CONNECTOR_PREFIXES.some(p=>n.startsWith(p)))out.push(n);
  }
  return [...new Set(out)];
}
function lbIsLgvProps(props){
  const txt=lbPropsText(props);
  if(/\bLGV\b|GRANDE VITESSE|LIGNE NOUVELLE/.test(txt))return true;
  return lbRailCodesInProps(props).length>0;
}
function lbRoutingCostMeters(seg,physicalMeters){
  // Approximation temporelle : voie classique ~160 km/h, LGV ~300 km/h.
  // Le facteur 0.34 donne assez de priorité à la LGV sans interdire les
  // raccordements/approches classiques nécessaires pour rejoindre une gare.
  return lbIsLgvProps(seg?.props) ? physicalMeters*0.34 : physicalMeters;
}
'''
s=s.replace(anchor,anchor+helper,1)

old="const layer=L.geoJSON(g,{renderer:railRenderer,pane:'rfn',interactive:false,style:{color:'#4bdcf4',weight:1.15,opacity:.46}}).addTo(map);state.railLayers.set(k,layer);"
new="const layer=L.geoJSON(g,{renderer:railRenderer,pane:'rfn',interactive:false,style:f=>lbIsLgvProps(f?.properties)?{color:'#ffe866',weight:2.7,opacity:.92}:{color:'#4bdcf4',weight:1.15,opacity:.42}}).addTo(map);state.railLayers.set(k,layer);"
if old in s:s=s.replace(old,new,1)
elif "style:f=>lbIsLgvProps" not in s: raise SystemExit('ERREUR ancre style RFN absente')

old="const a=node(s.a),b=node(s.b),w=distanceLL(s.a,s.b);s.aKey=a;s.bKey=b;s.w=w;\n    adj.get(a).push({to:b,w,seg:s});adj.get(b).push({to:a,w,seg:s});"
new="const a=node(s.a),b=node(s.b),w=distanceLL(s.a,s.b),cost=lbRoutingCostMeters(s,w);s.aKey=a;s.bKey=b;s.w=w;s.cost=cost;s.isLgv=lbIsLgvProps(s.props);\n    adj.get(a).push({to:b,w:cost,meters:w,seg:s});adj.get(b).push({to:a,w:cost,meters:w,seg:s});"
if old not in s: raise SystemExit('ERREUR ancre buildGraph absente')
s=s.replace(old,new,1)

old="links.push({node:q.s.aKey,cost:q.s.w*q.t+q.d});links.push({node:q.s.bKey,cost:q.s.w*(1-q.t)+q.d});"
new="links.push({node:q.s.aKey,cost:(q.s.cost||q.s.w)*q.t+q.d});links.push({node:q.s.bKey,cost:(q.s.cost||q.s.w)*(1-q.t)+q.d});"
if old in s:s=s.replace(old,new,1)
elif "(q.s.cost||q.s.w)" not in s: raise SystemExit('ERREUR ancre anchorAt absente')

# Message utilisateur : explique clairement ce qui est jaune vif.
needle="el.rfnInfo.textContent=`RFN détaillé : ${mf.features||'?'} objets · cellules ${mf.cells||'?'} · zoom ${mf.minZoom||10}+`;"
repl="el.rfnInfo.textContent=`RFN détaillé : ${mf.features||'?'} objets · mode TGV/LGV V6 · LGV en jaune vif`;"
if needle in s:s=s.replace(needle,repl,1)

# Aide de l'étape : ne plus présenter le via comme mécanisme normal de routage.
needle="Départ et arrivée sont fixes. Si le chemin jaune est faux, clique seulement sur un point de passage obligatoire (par exemple le raccord de Pagny)."
repl="Départ et arrivée sont fixes. V6 privilégie automatiquement les LGV (jaune vif). Ajoute un passage seulement pour imposer un raccordement précis si nécessaire."
s=s.replace(needle,repl)

p.write_text(s,encoding='utf-8')
print('Patché :',p)
PY
node --check "$JS"

echo "=== 4/6 Interface : version V6 ==="
python3 - "$HTML" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text(encoding='utf-8')
s=s.replace('V5 · GTFS LIVE + PARTAGE','V6 · ROUTAGE LGV + GTFS LIVE')
s=s.replace('V5.1 · GTFS LIVE + PARTAGE','V6 · ROUTAGE LGV + GTFS LIVE')
s=re.sub(r'/map-v2/moorail-route-editor-stops\.js\?v=[^"\']+', '/map-v2/moorail-route-editor-stops.js?v=6', s)
p.write_text(s,encoding='utf-8')
PY

echo "=== 5/6 Contrôles + redémarrage ==="
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$JS"
grep -qF "'431000','429000'" "$JS"
grep -qF "'408000'" "$JS"
grep -qF 'lbRoutingCostMeters' "$JS"
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 10 http://127.0.0.1:3111/moorail-route-editor-stops.js -o "$TMP/editor.js"
grep -qF 'LB_MOORAIL_LGV_ROUTER_V6' "$TMP/editor.js"
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health)"
echo "Health : $HEALTH"

echo "=== 6/6 Important : validations Ouest existantes ==="
echo "Les sections déjà validées restent intactes."
echo "Si elles ont été enregistrées avec l'ancien routeur distance-only,"
echo "ouvre-les dans l'éditeur : V6 recalculera le chemin avec priorité LGV."
echo "Ne clique Valider qu'après contrôle visuel du nouveau tracé."

SUCCESS=1
trap - EXIT
cleanup

echo
echo "============================================================"
echo " MOO RAIL V6 INSTALLE — ROUTAGE LGV PRIORITAIRE"
echo "============================================================"
echo "LGV Ouest ciblées :"
echo " - 431000 / 429000 : LGV Atlantique"
echo " - 408000          : LGV Bretagne-Pays de la Loire"
echo "Les LGV sont surlignées en jaune vif dans l'éditeur."
echo "Le calcul privilégie désormais un coût proche du temps TGV,"
echo "et non la seule distance géométrique."
echo "Backup : $BACKUP"
echo "============================================================"
