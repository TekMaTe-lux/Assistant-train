#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/lb-rail-engine-v1"
MAPROOT="/opt/labetaillere-map-v2-src/map-v2"
STATE="$ROOT/state"
DATA="$ROOT/data"
TMPROOT="$ROOT/tmp"
BACKUPS="$DATA/backups"
MAP_BACKUPS="$MAPROOT/backups"
EDITOR_BACKUPS="$MAPROOT/data/route-editor/backups"
DB="$DATA/timetable-v3-france-preview.sqlite"
HEALTH="$STATE/moorail-global-hs-v7-health.json"
SNAPSHOT="$MAPROOT/public/data/france-v3-active-now.json"
GTFS_UNIT="lb-rail-v3-gtfs-update.service"
GTFS_TIMER="lb-rail-v3-gtfs-update.timer"
HOT_UNIT="lb-rail-v3-france-hot-snapshot-preview.service"
DROPIN="/etc/systemd/system/lb-rail-v3-gtfs-update.service.d/95-global-hs-v7.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"
PERSISTENT_REPORT="$STATE/moorail-global-hs-v7-report-latest.json"
MANIFEST="$STATE/moorail-purge-v1-$STAMP.json"

usage(){
  echo "Usage: sudo bash $0 --apply"
  echo "Cette commande SUPPRIME uniquement des temporaires/backups classés obsolètes par les garde-fous V1."
}

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "ERREUR: lancer avec sudo/root" >&2; exit 2; }
[[ "${1:-}" == "--apply" ]] || { usage; exit 2; }

exec 9>/var/lock/labetaillere-moorail-purge.lock
flock -n 9 || { echo "ERREUR: une autre purge est déjà en cours" >&2; exit 3; }

echo "===================================================================================================="
echo " LA BETAILLERE — PURGE MOO RAIL SAFE V1"
echo " Cible: anciens candidats/tmp + anciens backups moteur/map + historique éditeur, avec garde-fous."
echo "===================================================================================================="

for f in "$DB" "$HEALTH" "$SNAPSHOT" "$DROPIN"; do
  [[ -e "$f" ]] || { echo "ERREUR: fichier essentiel absent: $f" >&2; exit 4; }
done

grep -qF 'ExecStartPost=+/usr/bin/python3 /opt/lb-rail-engine-v1/app/moorail_global_hs_v7.py --apply --post-update' "$DROPIN" || {
  echo "ERREUR: le hook GTFS V7.3.1 root n'est pas installé comme attendu" >&2
  exit 4
}

if systemctl is-active --quiet "$GTFS_UNIT"; then
  echo "ERREUR: mise à jour GTFS en cours, purge refusée" >&2
  exit 5
fi
systemctl is-active --quiet "$HOT_UNIT" || { echo "ERREUR: snapshot France inactif" >&2; exit 5; }
systemctl is-active --quiet "$GTFS_TIMER" || { echo "ERREUR: timer GTFS inactif" >&2; exit 5; }

if pgrep -af 'gtfs_auto_update_v3\.py|moorail_global_hs_v7\.py|compiler_moorail|build_dataset.*moorail|moorail_.*candidate' >/tmp/moorail-purge-running.$$ 2>/dev/null; then
  echo "ERREUR: un calcul MooRail/GTFS semble tourner :" >&2
  cat /tmp/moorail-purge-running.$$ >&2
  rm -f /tmp/moorail-purge-running.$$
  exit 5
fi
rm -f /tmp/moorail-purge-running.$$ || true

python3 - "$DB" "$HEALTH" "$SNAPSHOT" <<'PY'
import json, sqlite3, sys
from pathlib import Path

dbpath, health_path, snap_path = map(Path, sys.argv[1:4])
health=json.loads(health_path.read_text(encoding='utf-8'))
assert health.get('status')=='ok', health
assert int(health.get('unresolved') or 0)==0, health
assert health.get('post_update') is True, health

db=sqlite3.connect(f'file:{dbpath}?mode=ro', uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
orph=db.execute('''SELECT COUNT(*) FROM trip_geometry g LEFT JOIN trips t ON t.trip_pk=g.trip_pk LEFT JOIN rail_paths p ON p.path_id=g.path_id WHERE t.trip_pk IS NULL OR p.path_id IS NULL''').fetchone()[0]
assert orph==0, orph
for n in ('8602','6702','9713','9203','9206','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    good=db.execute("""SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%'""",(n,)).fetchone()[0]
    if total:
        assert good==total,(n,good,total)
db.close()

snap=json.loads(snap_path.read_text(encoding='utf-8'))
assert snap.get('ok') is True, snap
assert int(snap.get('count') or 0)>0, snap
print('PRECHECK OK | health=ok | DB=ok | snapshot count=', snap.get('count'))
PY

echo "[1/5] Migration du report V7.3 hors de /tmp…"
python3 - "$HEALTH" "$PERSISTENT_REPORT" <<'PY'
import json, os, shutil, sys
from pathlib import Path
hpath=Path(sys.argv[1]); target=Path(sys.argv[2])
h=json.loads(hpath.read_text(encoding='utf-8'))
src=Path(str(h.get('report') or ''))
if src.is_file():
    target.parent.mkdir(parents=True,exist_ok=True)
    tmp=target.with_suffix('.tmp')
    shutil.copy2(src,tmp)
    os.replace(tmp,target)
    h['report']=str(target)
    htmp=hpath.with_suffix('.tmp')
    htmp.write_text(json.dumps(h,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    os.replace(htmp,hpath)
    print('Report migré:',src,'=>',target)
elif target.is_file():
    h['report']=str(target)
    htmp=hpath.with_suffix('.tmp')
    htmp.write_text(json.dumps(h,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    os.replace(htmp,hpath)
    print('Report déjà persistant:',target)
else:
    raise SystemExit(f'ERREUR: report V7.3 introuvable: {src}')
PY

echo "[2/5] Calcul de la purge et suppression…"
python3 - "$ROOT" "$MAPROOT" "$MANIFEST" <<'PY'
from pathlib import Path
import json, shutil, subprocess, sys, time

ROOT=Path(sys.argv[1])
MAP=Path(sys.argv[2])
MANIFEST=Path(sys.argv[3])
TMP=ROOT/'tmp'
BACKUPS=ROOT/'data/backups'
MAP_BACKUPS=MAP/'backups'
EDITOR_BACKUPS=MAP/'data/route-editor/backups'
now=time.time()
ALLOWED=(TMP,BACKUPS,MAP_BACKUPS,EDITOR_BACKUPS)

def kids(p):
    try: return list(p.iterdir())
    except FileNotFoundError: return []

def mtime(p):
    try: return p.lstat().st_mtime
    except FileNotFoundError: return 0

def newest(rows,n):
    return set(sorted(rows,key=mtime,reverse=True)[:n])

def bytes_(p):
    try:
        return int(subprocess.check_output(['du','-sb','--',str(p)],text=True,stderr=subprocess.DEVNULL).split()[0])
    except Exception:
        return 0

def human(n):
    v=float(n)
    for u in ('B','KiB','MiB','GiB','TiB'):
        if v<1024 or u=='TiB': return f'{v:.1f} {u}'
        v/=1024

def allowed_child(p):
    return any(p.parent == r for r in ALLOWED)

def remove_one(p):
    if not allowed_child(p):
        raise RuntimeError(f'REFUS chemin hors racine autorisée: {p}')
    if not p.exists() and not p.is_symlink():
        return
    if p.is_symlink() or p.is_file():
        p.unlink()
    elif p.is_dir():
        shutil.rmtree(p)
    else:
        raise RuntimeError(f'Type de fichier non prévu: {p}')

delete=[]; keep=[]

for p in kids(TMP):
    if now-mtime(p) > 1800:
        delete.append((p,'tmp/candidat MooRail >30 min'))
    else:
        keep.append((p,'tmp récent <30 min'))

allb=kids(BACKUPS)
keep_set=set()
keep_set |= newest([p for p in allb if p.name.startswith('global-hs-v7-')],2)
keep_set |= newest([p for p in allb if p.name.startswith('install-global-hs-v7_3-')],1)
keep_set |= newest([p for p in allb if p.name.startswith('timetable-v3-france.')],1)
keep_set |= newest([p for p in allb if p.name.startswith('timetable-v3-preview.')],1)
keep_set |= newest([p for p in allb if p.name.startswith('gtfs-guard-v73-')],1)

known_prefixes=(
    'global-hs-v7-','install-global-hs-v7','install-lgv-ouest-',
    'timetable-v3-france.','timetable-v3-preview.',
    'moorail-national-','moorail-v5-','ouigo-metz-stras-',
    'ice-lgv-est-','lgv-est-','auto-lgv-','gtfs-guard-v73-'
)
for p in allb:
    if p in keep_set:
        keep.append((p,'rollback moteur conservé'))
    elif p.name.startswith(known_prefixes):
        delete.append((p,'ancien backup moteur supersédé'))
    else:
        keep.append((p,'backup moteur non classé: conservé par prudence'))

mapb=kids(MAP_BACKUPS)
keep_map=newest(mapb,10)
for p in mapb:
    if now-mtime(p) <= 86400 or p in keep_map:
        keep.append((p,'backup map-v2 récent/conservé'))
    else:
        delete.append((p,'ancien backup map-v2 >24h'))

ed=kids(EDITOR_BACKUPS)
keep_ed=newest(ed,3)
for p in ed:
    if p in keep_ed:
        keep.append((p,'une des 3 dernières sauvegardes éditeur'))
    else:
        delete.append((p,'ancienne sauvegarde éditeur'))

seen=set(); unique=[]
for p,why in delete:
    key=str(p)
    if key not in seen:
        seen.add(key); unique.append((p,why))
delete=unique

before=sum(bytes_(p) for p,_ in delete)
manifest={
    'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    'delete_count':len(delete),
    'estimated_bytes':before,
    'estimated_human':human(before),
    'deleted':[{'path':str(p),'reason':why,'bytes':bytes_(p)} for p,why in delete],
    'kept':[{'path':str(p),'reason':why} for p,why in keep],
}
MANIFEST.parent.mkdir(parents=True,exist_ok=True)
MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

print(f'Cibles: {len(delete)} | estimation: {human(before)}')
for p,why in sorted(delete,key=lambda x:bytes_(x[0]),reverse=True)[:35]:
    print(f'  DELETE {human(bytes_(p)):>10}  {p}  [{why}]')
if len(delete)>35:
    print(f'  ... +{len(delete)-35} autres cibles, détail dans {MANIFEST}')

for p,why in delete:
    remove_one(p)

remaining=sum(bytes_(p) for p,_ in delete if p.exists() or p.is_symlink())
freed=max(0,before-remaining)
print('PURGE EFFECTUEE | récupéré estimé:',human(freed))
print('Manifest:',MANIFEST)
PY

echo "[3/5] Nettoyage léger des caches Python obsolètes…"
find "$ROOT/app" "$ROOT/geometry" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true

echo "[4/5] Contrôles après purge…"
python3 - "$DB" "$HEALTH" "$SNAPSHOT" "$PERSISTENT_REPORT" <<'PY'
import json, sqlite3, sys
from pathlib import Path

dbpath,hpath,spath,rpath=map(Path,sys.argv[1:5])
assert rpath.is_file()
h=json.loads(hpath.read_text(encoding='utf-8'))
assert h.get('status')=='ok'
assert int(h.get('unresolved') or 0)==0
assert h.get('post_update') is True
assert Path(h.get('report',''))==rpath

db=sqlite3.connect(f'file:{dbpath}?mode=ro',uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
orph=db.execute('''SELECT COUNT(*) FROM trip_geometry g LEFT JOIN trips t ON t.trip_pk=g.trip_pk LEFT JOIN rail_paths p ON p.path_id=g.path_id WHERE t.trip_pk IS NULL OR p.path_id IS NULL''').fetchone()[0]
assert orph==0
for n in ('8602','6702','9713','9203','9206','9264'):
    total=db.execute('SELECT COUNT(*) FROM trips WHERE number=?',(n,)).fetchone()[0]
    good=db.execute("""SELECT COUNT(*) FROM trips t JOIN trip_geometry g ON g.trip_pk=t.trip_pk WHERE t.number=? AND g.path_id LIKE 'p-global-hs-v7-%'""",(n,)).fetchone()[0]
    print(f'{n}: global={good}/{total}')
    if total: assert good==total
db.close()
s=json.loads(spath.read_text(encoding='utf-8'))
assert s.get('ok') is True and int(s.get('count') or 0)>0
print('POSTCHECK OK | health=ok | DB=ok | snapshot count=',s.get('count'))
PY

systemctl is-active --quiet "$HOT_UNIT"
systemctl is-active --quiet "$GTFS_TIMER"
systemctl reset-failed "$GTFS_UNIT" || true

if curl -fsS --max-time 10 https://vps.labetaillere.fr/map-v2/france-v3-preview.html -o /dev/null; then
  echo "HTTP france-v3-preview.html : OK"
else
  echo "WARN: contrôle HTTP externe impossible, fichiers locaux et services sont néanmoins validés" >&2
fi

echo "[5/5] Espace disque final…"
df -h /
echo
printf 'Taille engine : '; du -sh "$ROOT" 2>/dev/null | awk '{print $1}'
printf 'Taille map-v2 : '; du -sh "$MAPROOT" 2>/dev/null | awk '{print $1}'
printf 'TMP engine    : '; du -sh "$TMPROOT" 2>/dev/null | awk '{print $1}'
printf 'Backups eng.  : '; du -sh "$BACKUPS" 2>/dev/null | awk '{print $1}'
printf 'Backups map   : '; du -sh "$MAP_BACKUPS" 2>/dev/null | awk '{print $1}'
printf 'Backups édit. : '; du -sh "$EDITOR_BACKUPS" 2>/dev/null | awk '{print $1}'

echo
echo "===================================================================================================="
echo " OK — PURGE MOO RAIL SAFE V1 TERMINEE"
echo " Prod active, V7.3.1, DB, snapshot, sections et rollbacks récents conservés."
echo " Les ~1 Gio classés REVIEW (router-test/build-france/community-site-test) n'ont PAS été touchés."
echo " Report V7.3 persistant : $PERSISTENT_REPORT"
echo " Manifest de purge      : $MANIFEST"
echo "===================================================================================================="
