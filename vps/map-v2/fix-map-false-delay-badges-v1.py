#!/usr/bin/env python3
"""La Bétaillère — retire uniquement les faux badges de retard de la carte.

Dry-run par défaut. Avec --apply, ne modifie que carte-core-preview.html.
L'estimation d'arrivée BER_LUX_TERMINUS_DELAY_V9 / delayEstimated est protégée.
"""
import argparse, os, re, shutil, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

MARK='BER_FALSE_DELAY_BADGES_FIX_V1'

OLD_SCAN="""      for (let i=startSearchIdx;i<realtimeProfile.stops.length;i++){
        const st = realtimeProfile.stops[i];
        const minutes = Number.isFinite(st?.delayMinutes)
          ? st.delayMinutes
          : (Number.isFinite(st?.delaySec) ? st.delaySec/60 : null);
        if (minutes && minutes > 0){
          const meta = seq && seq[i] ? stopsById.get(seq[i].stop_id) : null;
          const entry = { value: minutes, original: meta?.name || st?.delaySource || null };
          const info = buildDelayInfo(entry, train);
          if (info) return info;
        }
      }
"""

NEW_SCAN="""      /* BER_FALSE_DELAY_BADGES_FIX_V1
       * Badge carte = uniquement l'arrêt pertinent pour la position du train.
       * Début de segment : gare précédente. Après 25 % : prochaine gare.
       * Jamais un retard trouvé plusieurs gares plus loin.
       */
      const lbBaseIdx = Math.max(
        0,
        Math.min(startSearchIdx, realtimeProfile.stops.length - 1)
      );
      const lbProgress = Number.isFinite(train.segmentProgress)
        ? Math.max(0, Math.min(1, train.segmentProgress))
        : 0;
      const lbRelevantIdx = lbProgress > 0.25
        ? Math.min(lbBaseIdx + 1, realtimeProfile.stops.length - 1)
        : lbBaseIdx;
      const lbStop = realtimeProfile.stops[lbRelevantIdx] || null;
      const lbMinutes = Number.isFinite(lbStop?.delayMinutes)
        ? lbStop.delayMinutes
        : (Number.isFinite(lbStop?.delaySec) ? lbStop.delaySec/60 : null);

      if (lbMinutes > 0){
        const lbMeta = seq && seq[lbRelevantIdx]
          ? stopsById.get(seq[lbRelevantIdx].stop_id)
          : null;
        const lbInfo = buildDelayInfo({
          value: lbMinutes,
          original: lbMeta?.name || lbStop?.delaySource || null
        }, train);
        if (lbInfo) return lbInfo;
      }

      // Un profil arrêt-par-arrêt existe et l'arrêt pertinent n'est pas en retard :
      // aucun fallback currentDelaySec / aucune gare future = aucun faux badge.
      return null;
"""


def patch_strict_per_station(s):
    a=s.find('function computeDelayInfoFromPerStation(perStation, train)')
    b=s.find('function computeTrainDelayInfo(train)',a)
    if a<0 or b<0:
        raise SystemExit('ERREUR: fonctions retard introuvables; aucune écriture')
    region=s[a:b]
    if 'BER STRICT STOP DELAY V1' in region or 'Il est interdit de récupérer le retard maximal' in region:
        return s
    rx=re.compile(
        r'\n\s*let fallback = null;\s*\n'
        r'\s*for \(const entry of perStation\.values\(\)\)\{.*?'
        r'\n\s*return fallback;', re.S)
    if len(rx.findall(region)) != 1:
        raise SystemExit('ERREUR: fallback inter-gares inattendu; aucune écriture')
    region=rx.sub(
        "\n\n    /* BER STRICT STOP DELAY V1\n"
        "     * Aucun retard pour l'arrêt concerné = aucun badge.\n"
        "     * Interdit de récupérer le retard d'une autre gare du parcours.\n"
        "     */\n"
        "    return null;",
        region, count=1)
    return s[:a]+region+s[b:]


def check_js(html):
    if not shutil.which('node'):
        raise SystemExit('ERREUR: node absent; aucune écriture')
    parts=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',html,re.S|re.I)
    if not parts:
        raise SystemExit('ERREUR: aucun JavaScript inline trouvé')
    with tempfile.TemporaryDirectory(prefix='lb-delay-check-') as td:
        for i,code in enumerate(parts):
            f=Path(td)/f'{i}.js'
            f.write_text(code,encoding='utf-8')
            q=subprocess.run(['node','--check',str(f)],capture_output=True,text=True,timeout=30)
            if q.returncode:
                raise SystemExit('ERREUR JS; aucune écriture:\n'+q.stderr)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root',default='/opt/labetaillere-map-v2-src')
    ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    path=Path(args.root)/'map-v2/public/carte-core-preview.html'
    if not path.exists():
        raise SystemExit(f'ERREUR: {path} introuvable')

    before=path.read_bytes()
    s=before.decode('utf-8')
    if MARK in s:
        print('Correctif déjà installé. Aucun changement.'); return

    # Garde-fous : la fonction d'estimation au terminus doit être présente avant ET après.
    for token in ('BER_LUX_TERMINUS_DELAY_V9','delayEstimated'):
        if token not in s:
            raise SystemExit('ERREUR: estimation terminus absente ('+token+'); aucune écriture')

    s=patch_strict_per_station(s)

    count=s.count(OLD_SCAN)
    if count != 1:
        raise SystemExit(f'ERREUR: balayage futur attendu {count} fois au lieu de 1; aucune écriture')
    s=s.replace(OLD_SCAN,NEW_SCAN,1)

    for token in (
        MARK,'BER_LUX_TERMINUS_DELAY_V9','delayEstimated',
        'computeRealtimeStopData','computeTrainDelayInfo','renderTripPanel',
        'iconForTrain','lb-community-traveler','lb-lux-station-entry-v2'
    ):
        if token not in s:
            raise SystemExit('ERREUR: invariant perdu ('+token+'); aucune écriture')

    if OLD_SCAN in s:
        raise SystemExit('ERREUR: balayage futur encore présent; aucune écriture')

    check_js(s)

    print('VÉRIFICATIONS OK')
    print('• faux badge d’une gare située plus loin : supprimé')
    print('• badge : arrêt lié à la position uniquement')
    print('• estimation du retard à la gare d’arrivée : CONSERVÉE')
    print('• GTFS / HAFAS / géométrie / trajets / communauté / votes : NON TOUCHÉS')

    if not args.apply:
        print('SIMULATION seulement — aucun fichier modifié. Ajouter --apply pour installer.')
        return

    stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup=Path(args.root)/'map-v2/backups'/('false-delay-badges-v1-'+stamp)
    backup.mkdir(parents=True)
    backup_file=backup/path.name
    shutil.copy2(path,backup_file)

    if path.read_bytes()!=before:
        raise SystemExit('ERREUR: carte modifiée pendant les contrôles; aucune écriture')

    tmp=path.with_name(path.name+'.tmp-false-delay')
    tmp.write_text(s,encoding='utf-8')
    os.chmod(tmp,path.stat().st_mode)
    os.replace(tmp,path)

    print('INSTALLÉ:',path)
    print('BACKUP:',backup_file)
    print('Aucun service redémarré. Aucun cache reconstruit.')

if __name__=='__main__':
    main()
