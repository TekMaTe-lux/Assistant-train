#!/usr/bin/env bash
set +e

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
STATE="$ROOT/data/route-editor/moorail-route-editor-state-v1.json"
LIVE="$ROOT/public/data/moorail-live-v1/sections.json"
NETWORK="$ROOT/public/data/moorail-network-v8/network.json"
JS="$ROOT/public/moorail-route-editor-stops.js"
SERVICE="labetaillere-map-v2.service"
A="TGV Haute Picardie"
B="Aéroport Charles de Gaulle 2 TGV"

echo "============================================================"
echo " MOO RAIL V10.1 — AUDIT STATUT BRIQUE HAUTE-PICARDIE ↔ CDG"
echo " AUCUNE MODIFICATION"
echo "============================================================"

systemctl is-active --quiet "$SERVICE" && echo "✅ service map actif" || echo "❌ service map inactif"
curl -fsS --max-time 5 http://127.0.0.1:3111/api/map-v2/health || true
echo

python3 - "$STATE" "$LIVE" "$NETWORK" "$JS" "$A" "$B" <<'PY'
import json,sys,unicodedata,re
STATE,LIVE,NETWORK,JS,A,B=sys.argv[1:]
st=json.load(open(STATE,encoding='utf-8'))
live=json.load(open(LIVE,encoding='utf-8'))
net=json.load(open(NETWORK,encoding='utf-8'))
js=open(JS,encoding='utf-8').read()

def n(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()

def same(a,b):return n(a)==n(b)

print('=== 1/6 NETWORK TASK ===')
tasks=[]
for t in net.get('tasks') or []:
    a=(t.get('from') or {}).get('name');b=(t.get('to') or {}).get('name')
    if (same(a,A) and same(b,B)) or (same(a,B) and same(b,A)):
        tasks.append(t)
for t in tasks:
    print('sectionId       :',t.get('sectionId'))
    print('status          :',t.get('status'))
    print('sourceSectionId :',t.get('sourceSectionId'))
    print('routeId         :',t.get('routeId'))
    print('impactToday     :',t.get('impactToday'))
    print('trains          :',', '.join(map(str,t.get('trainNumbers') or [])))
    print()
if not tasks:print('❌ aucune task trouvée')

print('=== 2/6 STATE ===')
for t in tasks:
    sid=str(t.get('sectionId') or '')
    src=str(t.get('sourceSectionId') or '')
    for label,key in [('canonical',sid),('source',src)]:
        if not key:continue
        x=(st.get('sections') or {}).get(key)
        print(label,key,':', 'PRÉSENT' if x else 'ABSENT')
        if x:
            print('  status    :',x.get('status'))
            print('  source    :',x.get('source'))
            print('  engine    :',x.get('validationEngine'))
            print('  updatedAt :',x.get('updatedAt'))
            print('  points    :',len(x.get('coordinates') or []))

print('\n=== 3/6 LIVE ===')
for t in tasks:
    sid=str(t.get('sectionId') or '')
    byid=[x for x in live.get('pairs') or [] if str(x.get('sectionId') or '')==sid]
    byname=[x for x in live.get('pairs') or [] if ((same(x.get('from'),A) and same(x.get('to'),B)) or (same(x.get('from'),B) and same(x.get('to'),A)))]
    print('par sectionId',sid,':',len(byid),'entrée(s)')
    print('par noms              :',len(byname),'entrée(s)')
    for x in byname[:4]:
        print(' ',x.get('from'),'→',x.get('to'),'|',x.get('sectionId'),'| points',len(x.get('coords') or []))

print('\n=== 4/6 LOGIQUE UI ===')
print('networkStatus fallback vers r.networkStatus :', "return r?.networkStatus||'TODO';" in js)
print('V10.1 sectionLive par ID exact              :', "String(x?.sectionId||'')===String(sec.id)" in js)
print('V10.1 validated par STATE canonical exact   :', "state.serverState?.sections?.[sec.id]?.status==='validated'" in js)

print('\n=== 5/6 SIMULATION DU TEXTE V10.1 ===')
for t in tasks:
    sid=str(t.get('sectionId') or '')
    saved=(st.get('sections') or {}).get(sid)
    validated=bool(saved and saved.get('status')=='validated')
    sectionLive=any(str(x.get('sectionId') or '')==sid for x in live.get('pairs') or [])
    networkValidated=str(t.get('status') or '')=='VALIDATED_V8'
    print('sid              :',sid)
    print('networkValidated :',networkValidated)
    print('validated STATE  :',validated)
    print('sectionLive      :',sectionLive)
    if sectionLive: txt='✅ BRIQUE V8 DÉJÀ LIVE'
    elif validated: txt='✓ Brique V8 validée'
    else: txt='⚠️ Brique non validée'
    print('V10.1 afficherait:',txt)

print('\n=== 6/6 VERDICT ===')
if not tasks:
    print('❌ impossible de conclure : task absente')
else:
    t=tasks[0];sid=str(t.get('sectionId') or '')
    saved=(st.get('sections') or {}).get(sid)
    validated=bool(saved and saved.get('status')=='validated')
    sectionLive=any(str(x.get('sectionId') or '')==sid for x in live.get('pairs') or [])
    networkValidated=str(t.get('status') or '')=='VALIDATED_V8'
    if networkValidated and not validated and not sectionLive:
        print('❌ DESYNCHRONISATION CONFIRMÉE : network.json dit VALIDATED_V8, mais STATE et LIVE ne contiennent pas la brique canonique.')
        print('La carte verte vient du fallback networkStatus ; le panneau publication est plus strict et dit donc « non validée ».')
    elif networkValidated and validated and not sectionLive:
        print('❌ EXPORT LIVE MANQUANT : STATE est validé mais sections.json ne contient pas la brique.')
    elif networkValidated and validated and sectionLive:
        print('⚠️ Les trois sources sont cohérentes. Si le navigateur affiche encore « non validée », c’est un état frontend ancien/cache à corriger.')
    elif not networkValidated and validated and sectionLive:
        print('⚠️ network.json est en retard mais STATE/LIVE sont corrects ; le prochain refresh réseau doit le remettre à jour.')
    else:
        print('ℹ️ état mixte : network=',networkValidated,'state=',validated,'live=',sectionLive)
PY
RC=$?

echo
echo "AUCUNE MODIFICATION EFFECTUEE."
exit "$RC"
