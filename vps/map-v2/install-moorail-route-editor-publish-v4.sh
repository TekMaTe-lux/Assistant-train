#!/usr/bin/env bash
set -euo pipefail

ROOT="${MOORAIL_ROOT:-/opt/labetaillere-map-v2-src/map-v2}"
PUBLIC="$ROOT/public"
SERVER_API="$ROOT/server/route-editor-api.mjs"
HTML="$PUBLIC/moorail-route-editor.html"
PAGE="$PUBLIC/moorail-route-editor-stops.html"
JS="$PUBLIC/moorail-route-editor-stops.js"
COMPILER="$ROOT/scripts/compile-moorail-validations-v2.py"
SERVICE="labetaillere-map-v2.service"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backups/route-editor-publish-v4-$STAMP"
TMP="$(mktemp -d /tmp/moorail-publish-v4.XXXXXX)"
RAW="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/main/vps/map-v2"
SUCCESS=0
RESTARTED=0

cleanup(){ rm -rf "$TMP"; }
rollback(){
  [[ "$SUCCESS" == 1 ]] && return 0
  echo "ROLLBACK MOO RAIL V4..." >&2
  for pair in \
    "$BACKUP/route-editor-api.mjs:$SERVER_API" \
    "$BACKUP/moorail-route-editor.html:$HTML" \
    "$BACKUP/moorail-route-editor-stops.html:$PAGE" \
    "$BACKUP/moorail-route-editor-stops.js:$JS" \
    "$BACKUP/compile-moorail-validations-v2.py:$COMPILER"; do
      src="${pair%%:*}"; dst="${pair#*:}"
      [[ -f "$src" ]] && cp -a "$src" "$dst"
  done
  [[ -f "$BACKUP/compiler.absent" ]] && rm -f "$COMPILER"
  if [[ "$RESTARTED" == 1 ]]; then systemctl restart "$SERVICE" >/dev/null 2>&1 || true; fi
}
finish(){ rc=$?; trap - EXIT; rollback; cleanup; exit "$rc"; }
trap finish EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
for f in "$SERVER_API" "$HTML" "$JS"; do [[ -f "$f" ]] || { echo "ERREUR fichier absent: $f" >&2; exit 3; }; done
mkdir -p "$BACKUP" "$ROOT/scripts"
cp -a "$SERVER_API" "$BACKUP/route-editor-api.mjs"
cp -a "$HTML" "$BACKUP/moorail-route-editor.html"
[[ ! -f "$PAGE" ]] || cp -a "$PAGE" "$BACKUP/moorail-route-editor-stops.html"
cp -a "$JS" "$BACKUP/moorail-route-editor-stops.js"
if [[ -f "$COMPILER" ]]; then cp -a "$COMPILER" "$BACKUP/compile-moorail-validations-v2.py"; else touch "$BACKUP/compiler.absent"; fi

echo "============================================================"
echo " MOO RAIL V4 — SECTIONS PARTAGEES + PUBLICATION EN 1 CLIC"
echo "============================================================"
echo "Backup : $BACKUP"

echo "=== 1/6 Téléchargement API V4 + compilateur V2 ==="
curl -fsSL "$RAW/route-editor/v4/route-editor-api-v4.mjs?$STAMP" -o "$TMP/api.mjs"
curl -fsSL "$RAW/compile-moorail-validations-v2.py?$STAMP" -o "$TMP/compiler.py"
node --check "$TMP/api.mjs"
python3 -m py_compile "$TMP/compiler.py"

echo "=== 2/6 Transformation interface V3.2 -> V4 ==="
python3 - "$HTML" "$JS" "$TMP/page.html" "$TMP/editor.js" <<'PY'
from pathlib import Path
import sys
html=Path(sys.argv[1]).read_text(encoding='utf-8')
js=Path(sys.argv[2]).read_text(encoding='utf-8')

# HTML : badge + bloc publication.
html=html.replace('V3 · ARRÊT → ARRÊT','V4 · PARTAGE + PUBLICATION')
html=html.replace('/map-v2/moorail-route-editor-stops.js?v=3','/map-v2/moorail-route-editor-stops.js?v=4')
block='''\n  <div class="block" id="publishBlock">\n    <h3>Publication France V3 Preview</h3>\n    <div id="publishSummary" class="status">Analyse de la variante…</div>\n    <div class="separator"></div>\n    <div class="help">Une section validée est réutilisée automatiquement par les autres TGV entre les mêmes gares, même dans le sens inverse. Une variante n'est publiée que si toutes ses étapes sont couvertes.</div>\n    <div class="separator"></div>\n    <div class="row">\n      <button id="publishCheck" class="btn">⟳ Analyser</button>\n      <button id="publishCurrent" class="btn good">🚀 Publier cette variante</button>\n      <button id="publishAll" class="btn warn">Publier toutes les variantes prêtes</button>\n    </div>\n    <div id="publishResult" class="help" style="margin-top:8px"></div>\n    <a id="publishLink" href="/map-v2/france-v3-preview.html" target="_blank" style="display:none;color:#63efff;font-size:11px">↗ Ouvrir France V3 Preview</a>\n  </div>\n'''
needle='''  <div class="block">\n    <h3>État</h3>'''
if 'id="publishBlock"' not in html:
    if needle not in html: raise SystemExit('ancre HTML Etat absente')
    html=html.replace(needle,block+'\n'+needle,1)

# JS : bibliothèque de sections partagées (direct + sens inverse).
anchor="function stopPair(){if(!state.route)return null;return [state.route.stops[state.legIndex],state.route.stops[state.legIndex+1]];}\n"
shared=r'''\nfunction findSharedSection(fromName,toName,preferredId){
  const sections=state.serverState?.sections||{};
  const exact=preferredId?sections[preferredId]:null;
  if(exact?.status==='validated')return {...exact,_shared:false,_reversed:false};
  let direct=null,reverse=null;
  for(const s of Object.values(sections)){
    if(!s||s.status!=='validated')continue;
    const a=s.stopFrom?.name,b=s.stopTo?.name;if(!a||!b)continue;
    if(norm(a)===norm(fromName)&&norm(b)===norm(toName)){
      if(!direct||String(s.updatedAt||'')>String(direct.updatedAt||''))direct=s;
    }else if(norm(a)===norm(toName)&&norm(b)===norm(fromName)){
      if(!reverse||String(s.updatedAt||'')>String(reverse.updatedAt||''))reverse=s;
    }
  }
  if(direct)return {...direct,_shared:true,_reversed:false};
  if(reverse)return {...reverse,_shared:true,_reversed:true,
    waypoints:[...(reverse.waypoints||[])].reverse(),coordinates:[...(reverse.coordinates||[])].reverse()};
  return null;
}
'''
if 'function findSharedSection' not in js:
    if anchor not in js: raise SystemExit('ancre stopPair absente')
    js=js.replace(anchor,anchor+shared,1)

old="const val=(r.sections||[]).filter(s=>state.serverState.sections?.[s.id]?.status==='validated').length;"
new="const val=(r.sections||[]).filter((s,i)=>findSharedSection(s.from?.name||r.stops[i]?.name,s.to?.name||r.stops[i+1]?.name,s.id)).length;"
if old in js: js=js.replace(old,new,1)
elif new not in js: raise SystemExit('ancre compteur routes absente')

old="const saved=state.serverState.sections?.[s.id]?.status==='validated';"
new="const shared=findSharedSection(s.from?.name||state.route.stops[i]?.name,s.to?.name||state.route.stops[i+1]?.name,s.id);const saved=!!shared;"
if old in js: js=js.replace(old,new,1)
elif new not in js: raise SystemExit('ancre saved leg absente')

old="b.innerHTML=`<b>${i+1}. ${esc(s.from?.name||state.route.stops[i]?.name)} → ${esc(s.to?.name||state.route.stops[i+1]?.name)}</b><span>${saved?'✓ validée':'à vérifier'}${state.serverState.sections?.[s.id]?.waypoints?.length?` · ${state.serverState.sections[s.id].waypoints.length} passage(s) imposé(s)`:''}</span>`;"
new="b.innerHTML=`<b>${i+1}. ${esc(s.from?.name||state.route.stops[i]?.name)} → ${esc(s.to?.name||state.route.stops[i+1]?.name)}</b><span>${saved?(shared?._shared?(shared?._reversed?'↔ réutilisée sens inverse':'↔ réutilisée'):'✓ validée'):'à vérifier'}${shared?.waypoints?.length?` · ${shared.waypoints.length} passage(s) imposé(s)`:''}</span>`;"
if old in js: js=js.replace(old,new,1)
elif new not in js: raise SystemExit('ancre rendu leg absente')

old="const saved=state.serverState.sections?.[sec.id];"
new="const saved=findSharedSection(pair[0].name,pair[1].name,sec.id);"
if old in js: js=js.replace(old,new,1)
elif new not in js: raise SystemExit('ancre activation saved absente')

# Rafraîchit automatiquement l'état publiable en changeant de variante.
old="state.route=r;state.legIndex=0;state.via=[];renderRoutes();renderLegs();await activateLeg(0);"
new="state.route=r;state.legIndex=0;state.via=[];renderRoutes();renderLegs();await activateLeg(0);await refreshPublishPreview();"
if old in js: js=js.replace(old,new,1)
elif new not in js: raise SystemExit('ancre selectRoute absente')

# Boutons publication.
old="$('validate').onclick=validateLeg;"
new="$('validate').onclick=validateLeg;\n$('publishCheck').onclick=()=>refreshPublishPreview();\n$('publishCurrent').onclick=()=>publishReady(false);\n$('publishAll').onclick=()=>publishReady(true);"
if old in js: js=js.replace(old,new,1)
elif "$('publishCurrent').onclick" not in js: raise SystemExit('ancre boutons absente')

# Après une validation, le statut de publication est recalculé.
old="renderRoutes();renderLegs();setStatus(`✓ Étape validée : ${esc(pair[0].name)} → ${esc(pair[1].name)}.`,`ok`);"
new="renderRoutes();renderLegs();refreshPublishPreview();setStatus(`✓ Étape validée : ${esc(pair[0].name)} → ${esc(pair[1].name)}.`,`ok`);"
if old in js: js=js.replace(old,new,1)

extra=r'''
async function refreshPublishPreview(){
  const box=$('publishSummary'),result=$('publishResult'),link=$('publishLink');
  if(!box||!state.route)return;
  box.className='status';box.textContent='Analyse de la variante…';if(result)result.textContent='';if(link)link.style.display='none';
  try{
    const r=await fetch(`${API}/publish-preview?routeId=${encodeURIComponent(state.route.id)}&t=${Date.now()}`,{cache:'no-store'});
    const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||r.status);
    const c=(d.candidates||[])[0];
    if(c){
      box.className='status ok';box.innerHTML=`✓ <b>PRÊT À PUBLIER</b><br>${c.trips} circulation(s) · ${c.km.toFixed(1)} km · ${c.sections} étape(s)<br>Trains : ${(c.numbers||[]).slice(0,18).join(', ')||'—'}`;
    }else{
      const s=(d.skipped||[])[0];box.className='status warn';box.innerHTML=`Pas encore publiable.${s?.missing?.length?`<br>Manque : ${s.missing.slice(0,3).map(esc).join('<br>')}`:''}`;
    }
  }catch(e){box.className='status bad';box.textContent=`Analyse publication impossible : ${e.message}`;}
}

async function publishReady(all){
  const box=$('publishSummary'),result=$('publishResult'),link=$('publishLink');
  if(!state.route&&!all)return;
  const label=all?'toutes les variantes actuellement prêtes':`la variante ${state.route.origin} → ${state.route.destination}`;
  if(!window.confirm(`Publier ${label} sur France V3 Preview ?\n\nUn backup trips.json / paths.json sera créé automatiquement.`))return;
  box.className='status warn';box.textContent='Publication en cours…';if(result)result.textContent='';if(link)link.style.display='none';
  try{
    const payload={confirm:'FRANCE_V3_PREVIEW'};if(!all)payload.routeId=state.route.id;
    const r=await fetch(`${API}/publish`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||r.status);
    const totals=d.report?.totals||{};
    box.className='status ok';box.innerHTML=`✓ Écrit et vérifié sur disque : <b>${totals.trips||0} circulation(s)</b> · ${totals.routes||0} variante(s).<br>Redémarrage de Map V2…`;
    if(result)result.textContent=(d.report?.candidates||[]).map(c=>`${c.signature} : ${c.trips} train(s)`).slice(0,6).join(' · ');
    await waitMapBack();
    box.innerHTML=`✓ <b>PUBLICATION TERMINÉE</b><br>${totals.trips||0} circulation(s) sont maintenant sur France V3 Preview.`;
    if(link){link.href=`/map-v2/france-v3-preview.html?moorail=${Date.now()}`;link.style.display='inline-block';}
    await reloadEditorState();
  }catch(e){box.className='status bad';box.textContent=`Publication impossible : ${e.message}`;}
}

async function waitMapBack(){
  await new Promise(r=>setTimeout(r,1200));
  let seenDown=false;
  for(let i=0;i<45;i++){
    try{const r=await fetch(`/api/map-v2/health?t=${Date.now()}`,{cache:'no-store'});if(r.ok){const h=await r.json();if(h.ok&&(seenDown||i>1))return;}}catch(e){seenDown=true;}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('Map V2 ne répond pas après publication');
}

async function reloadEditorState(){
  try{
    const [sv,cat]=await Promise.all([fetch(`${API}/state?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json()),fetch(`${API}/catalog?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json())]);
    state.serverState=sv||{sections:{}};state.catalog=cat.routes||state.catalog;renderRoutes();renderLegs();
  }catch(e){}
}
'''
if 'async function refreshPublishPreview' not in js:
    pos=js.rfind('})();')
    if pos<0: raise SystemExit('fin IIFE absente')
    js=js[:pos]+extra+'\n'+js[pos:]

Path(sys.argv[3]).write_text(html,encoding='utf-8')
Path(sys.argv[4]).write_text(js,encoding='utf-8')
PY
node --check "$TMP/editor.js"

echo "=== 3/6 Installation fichiers ==="
install -o root -g root -m 0644 "$TMP/api.mjs" "$SERVER_API"
install -o root -g root -m 0755 "$TMP/compiler.py" "$COMPILER"
install -o root -g root -m 0644 "$TMP/page.html" "$HTML"
install -o root -g root -m 0644 "$TMP/page.html" "$PAGE"
install -o root -g root -m 0644 "$TMP/editor.js" "$JS"

echo "=== 4/6 Redémarrage Map V2 ==="
RESTARTED=1
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 2 http://127.0.0.1:3111/api/map-v2/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet "$SERVICE"

echo "=== 5/6 Contrôles API + interface ==="
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor.html?v=$STAMP" -o "$TMP/served.html"
curl -fsS --max-time 8 "http://127.0.0.1:3111/moorail-route-editor-stops.js?v=$STAMP" -o "$TMP/served.js"
curl -fsS --max-time 20 "http://127.0.0.1:3111/api/map-v2/route-editor/publish-preview" -o "$TMP/publish.json"
curl -fsS --max-time 5 "http://127.0.0.1:3111/api/map-v2/route-editor/catalog" -o "$TMP/catalog.json"
python3 - "$TMP/served.html" "$TMP/served.js" "$TMP/publish.json" "$TMP/catalog.json" <<'PY'
from pathlib import Path
import json,sys
h=Path(sys.argv[1]).read_text(encoding='utf-8'); j=Path(sys.argv[2]).read_text(encoding='utf-8')
p=json.load(open(sys.argv[3],encoding='utf-8')); c=json.load(open(sys.argv[4],encoding='utf-8'))
assert 'V4 · PARTAGE + PUBLICATION' in h
assert 'publishCurrent' in h and 'publishAll' in h
assert 'findSharedSection' in j and 'publishReady' in j
assert p.get('ok') is True,p
assert isinstance(p.get('candidates'),list),p
assert c.get('ok') is True and int(c.get('version') or 0)>=4,c
print('Interface V4 : OK')
print('Sections partagées orientées :',c.get('sharedPairCount'))
print('Variantes prêtes via partage :',len(p.get('candidates') or []))
print('Circulations prêtes :',sum(x.get('trips',0) for x in p.get('candidates') or []))
for x in p.get('candidates') or []:
    if '2509' in [str(n) for n in x.get('numbers') or []]:
        print('TGV 2509 : PRÊT via',x.get('routeId'),x.get('signature'))
PY

echo "=== 6/6 Terminé ==="
SUCCESS=1
trap - EXIT
cleanup
cat > "$BACKUP/ROLLBACK.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/route-editor-api.mjs' '$SERVER_API'
cp -a '$BACKUP/moorail-route-editor.html' '$HTML'
[ ! -f '$BACKUP/moorail-route-editor-stops.html' ] || cp -a '$BACKUP/moorail-route-editor-stops.html' '$PAGE'
cp -a '$BACKUP/moorail-route-editor-stops.js' '$JS'
if [ -f '$BACKUP/compiler.absent' ]; then rm -f '$COMPILER'; elif [ -f '$BACKUP/compile-moorail-validations-v2.py' ]; then cp -a '$BACKUP/compile-moorail-validations-v2.py' '$COMPILER'; fi
systemctl restart '$SERVICE'
EOF
chmod 0755 "$BACKUP/ROLLBACK.sh"

echo
echo "============================================================"
echo " MOO RAIL V4 INSTALLE"
echo "============================================================"
echo "Page : https://vps.labetaillere.fr/map-v2/moorail-route-editor.html"
echo "Carte: https://vps.labetaillere.fr/map-v2/france-v3-preview.html"
echo "Backup: $BACKUP"
echo
echo "Nouveau :"
echo " - une section validée est partagée entre toutes les variantes"
echo " - le sens inverse est réutilisé automatiquement"
echo " - Paris->Nancy peut hériter de Nancy->Paris"
echo " - Epinal/Remiremont héritent des sections via Nancy déjà validées"
echo " - bouton Analyser"
echo " - bouton Publier cette variante"
echo " - bouton Publier toutes les variantes prêtes"
echo " - backup + vérification disque + redémarrage automatique"
echo "============================================================"
