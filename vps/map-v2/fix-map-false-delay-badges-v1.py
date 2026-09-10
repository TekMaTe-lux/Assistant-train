#!/usr/bin/env python3
"""La Bétaillère — retire les faux badges de retard sur la carte.

Ne touche qu'à carte-core-preview.html. Dry-run par défaut, --apply pour écrire.
Conserve explicitement BER_LUX_TERMINUS_DELAY_V9 et delayEstimated.
"""
import argparse, os, re, shutil, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

MARK='BER_FALSE_DELAY_BADGES_FIX_V1'


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root',default='/opt/labetaillere-map-v2-src')
    ap.add_argument('--apply',action='store_true')
    a=ap.parse_args()
    p=Path(a.root)/'map-v2/public/carte-core-preview.html'
    if not p.exists(): raise SystemExit(f'ERREUR: {p} introuvable')
    s=p.read_text(encoding='utf-8')
    if MARK in s:
        print('Déjà installé. Aucun changement.'); return
    if 'BER_LUX_TERMINUS_DELAY_V9' not in s or 'delayEstimated' not in s:
        raise SystemExit('ERREUR: estimation terminus attendue absente; aucune écriture')

    original=s

    # 1) L'ancien fallback allait chercher le retard maximal dans une autre gare.
    a1=s.find('function computeDelayInfoFromPerStation(perStation, train)')
    b1=s.find('function computeTrainDelayInfo(train)',a1)
    if a1<0 or b1<0: raise SystemExit('ERREUR: fonctions retard introuvables')
    r=s[a1:b1]
    fallback=re.compile(r'\n\s*let fallback = null;\s*\n\s*for \(const entry of perStation\.values\(\)\)\{.*?\n\s*return fallback;\s*',re.S)
    if fallback.search(r):
        r=fallback.sub("\n    /* BER STRICT STOP DELAY V1 — jamais le retard d'une autre gare */\n    return null;\n  }\n  ",r,count=1)
    elif 'BER STRICT STOP DELAY V1' not in r and 'Il est interdit de récupérer le retard maximal' not in r:
        raise SystemExit('ERREUR: structure computeDelayInfoFromPerStation inattendue')
    s=s[:a1]+r+s[b1:]

    # 2) Le bug actuel parcourt tous les arrêts futurs et prend le premier +N.
    a2=s.find('function computeTrainDelayInfo(train)')
    b2=s.find('function findSncfDisruptionForTrain',a2)
    if a2<0 or b2<0: raise SystemExit('ERREUR: computeTrainDelayInfo introuvable')
    r=s[a2:b2]
    scan=re.compile(
        r'\n\s*for \(let i=startSearchIdx;i<realtimeProfile\.stops\.length;i\+\+\)\{.*?\n\s*\}\n\s*\}',
        re.S)
    m=scan.search(r)
    if not m:
        scan=re.compile(r'\n\s*for \(let i\s*=\s*startSearchIdx\s*;\s*i\s*<\s*realtimeProfile\.stops\.length\s*;\s*i\+\+\s*\)\s*\{.*?if \(info\) return info;\s*\n\s*\}\n\s*\}',re.S)
        m=scan.search(r)
    if not m:
        raise SystemExit('ERREUR: balayage des gares futures introuvable; aucune écriture')

    strict='''
      /* BER_FALSE_DELAY_BADGES_FIX_V1
       * Badge = uniquement l'arrêt lié à la position du train.
       * Début du segment: arrêt précédent; après 25%: prochain arrêt.
       * Jamais une gare plus loin sur le parcours.
       */
      const lbBaseIdx=Math.max(0,Math.min(startSearchIdx,realtimeProfile.stops.length-1));
      const lbProgress=Number.isFinite(train.segmentProgress)
        ? Math.max(0,Math.min(1,train.segmentProgress)) : 0;
      const lbIdx=lbProgress>0.25
        ? Math.min(lbBaseIdx+1,realtimeProfile.stops.length-1) : lbBaseIdx;
      const lbStop=realtimeProfile.stops[lbIdx] || null;
      const lbMinutes=Number.isFinite(lbStop?.delayMinutes)
        ? lbStop.delayMinutes
        : (Number.isFinite(lbStop?.delaySec) ? lbStop.delaySec/60 : null);
      if (lbMinutes>0){
        const lbMeta=seq && seq[lbIdx] ? stopsById.get(seq[lbIdx].stop_id) : null;
        const lbInfo=buildDelayInfo({value:lbMinutes,original:lbMeta?.name || lbStop?.delaySource || null},train);
        if (lbInfo) return lbInfo;
      }
      // Profil temps réel disponible et arrêt pertinent à l'heure/inconnu : aucun faux badge.
      return null;
    }'''
    r=scan.sub('\n'+strict,r,count=1)
    s=s[:a2]+r+s[b2:]

    # Invariants : estimation terminus et éléments essentiels intacts.
    for token in ['BER_LUX_TERMINUS_DELAY_V9','delayEstimated','computeRealtimeStopData','renderTripPanel','iconForTrain','lb-community-traveler']:
        if token not in s: raise SystemExit('ERREUR: invariant perdu: '+token)
    if MARK not in s: raise SystemExit('ERREUR: marqueur correctif absent')

    # Vérification syntaxe JS des scripts inline.
    if shutil.which('node'):
        parts=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',s,re.S|re.I)
        with tempfile.TemporaryDirectory() as td:
            for i,code in enumerate(parts):
                f=Path(td)/f'{i}.js'; f.write_text(code,encoding='utf-8')
                q=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
                if q.returncode: raise SystemExit('ERREUR JS: '+q.stderr)
    else:
        raise SystemExit('ERREUR: node absent; aucune écriture')

    print('OK simulation: faux badges supprimés.')
    print('Conservé: estimation retard terminus BER_LUX_TERMINUS_DELAY_V9 / delayEstimated.')
    print('Non touché: GTFS, HAFAS, trajets, géométrie, communauté, votes.')
    if not a.apply:
        print('Aucun fichier modifié. Relancer avec --apply.'); return

    stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup=Path(a.root)/'map-v2/backups'/('false-delay-badges-v1-'+stamp)
    backup.mkdir(parents=True)
    shutil.copy2(p,backup/p.name)
    if p.read_text(encoding='utf-8')!=original:
        raise SystemExit('ERREUR: fichier modifié pendant le contrôle; aucune écriture')
    tmp=p.with_name(p.name+'.tmp-false-delay')
    tmp.write_text(s,encoding='utf-8')
    os.chmod(tmp,p.stat().st_mode)
    os.replace(tmp,p)
    print('INSTALLÉ:',p)
    print('BACKUP:',backup/p.name)
    print('Aucun service redémarré, aucun cache reconstruit.')

if __name__=='__main__': main()
