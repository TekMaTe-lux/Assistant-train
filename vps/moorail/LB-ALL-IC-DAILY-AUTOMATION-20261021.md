# La Bétaillère — IC Belgique/Luxembourg automatiques

Déploiement du 21 octobre 2026. Cette évolution complète les **fiches et tableaux de gare La Bétaillère** (carte et module « En gare »), sans changer MooRail, les moteurs LIVE, les statistiques SNCF ou les positions animées.

## Source et calendrier

- Source : `/opt/lb-rail-engine-v1/data/be/timetable-be-v1.sqlite`, base locale du GTFS officiel SNCB, déjà construite par `moorail-be-sncb-static-update.timer` chaque nuit (vers 02:17 UTC lors du déploiement).
- Générateur : `/opt/lb-rail-engine-v1/app/build_be_international_lb_index.py`, versionné dans ce dépôt sous `vps/moorail/build_be_international_lb_index.py`.
- Actualisation : `lb-be-international-ends.timer` toutes les **10 minutes**. Une exécution de génération a pris **0,37–0,55 seconde** et ~26–28 Mo de RAM en test.
- Index public : `https://vps.labetaillere.fr/map-v2/data/lb-be-international-ends-v1.json`. Environ **690 Ko brut**, **72 Ko gzip**. Quatre dates de service lorsque le GTFS les contient : veille / aujourd'hui / J+1 / J+2. Le cache navigateur de la carte et du module « En gare » se renouvelle toutes les dix minutes.
- Aucun accès supplémentaire aux API HAFAS/CFL/SNCB ; le référentiel est extrait du fichier SQLite local.

## Périmètre IC

Sont retenus **tous les IC officiels SNCB dont le trajet dessert Arlon, Gouvy, Athus ou Luxembourg (LU)**, même si leur circulation n'est pas encore présente dans la carte LIVE. Les trains qui ne traversent pas le Luxembourg (par exemple IC 2135 Arlon → Bruxelles-Midi ou 5326 Gouvy → Liège) sont eux aussi affichés dans les tableaux des gares accessibles sur la carte.

D'autres trains locaux belges peuvent être enrichis lorsqu'ils ont une réelle extension internationale (notamment certains L Libramont ↔ Luxembourg), sans ajouter artificiellement des destinations aux services réellement locaux.

Le rapprochement des trajets CFL/BELUX reste conservateur (service date, numéro, horaires et stations communes, ordre du parcours, garde spéciale Arlon jusqu'à six minutes pour distinguer arrivée/départ). Le LIVE CFL reste maître sur son tronçon ; les mouvements BE-only utilisent `bePlannedOnly:true`, `realtime:null`, `track:null` et le libellé **« Horaire prévu »**. Un trajet entièrement belge ouvre une fiche spécifique des arrêts prévus, distincte du LIVE.

## Audit complet

- Service **21/10/2026** : **81 IC officiels SNCB** desservant la zone ; **81 indexés**.
- Contrôle navigateur Chromium sur la journée entière : **212 mouvements de gare attendus, 212 trouvés**, répartis en Arlon (71/71), Gouvy (70/70) et Luxembourg (71/71).
- Parmi les parcours CFL dont le numéro correspond à un IC belge : **60 prolongements vérifiés**, **11 parcours locaux réellement terminés à Arlon ou Gouvy** (non prolongés). Les autres IC belges sans segment CFL sont également repris.
- Cas fonctionnels : IC 2135 départ Arlon → Bruxelles-Midi, fiche belge 14 arrêts ; IC 5326 départ Gouvy → Liège-Guillemins ; IC 2111 Bruxelles → Arlon → Luxembourg, IC 2138 Arlon → Bruxelles, IC 5337 Gouvy → Liège.
- Vérification **post-publication** de la carte via son API de tableaux : IC 2115 (arrivée Arlon depuis Bruxelles), IC 2138 (départ vers Bruxelles) et IC 5322 (arrivée Gouvy depuis Liège), tous correctement `bePlannedOnly` quand il n'existe pas de suivi LIVE BE. Le RB 5915 vers Luxembourg conserve son statut et sa voie CFL.
- Vérification de **« En gare »** avec l'asset public du site et sa source de carte synchronisée : recherche Arlon / Arrivées / « Plus de trains » → IC 2115, Bruxelles-Midi, « Horaire prévu » : **PASS**.
- Vérification de syntaxe : **42 blocs script** de la carte ; services map, Data V4, Stats, CFL et timer BE actifs. Empreintes des fichiers du serveur Stats et historique SNCF inchangées.

## Vérification automatique

Le générateur compare les **IC attendus dans la base GTFS pour chaque date** et les **IC effectivement inclus dans l'index**. Si une date courante manque, si aucune circulation n'est produite ou si un IC attendu est absent, la génération échoue **sans remplacer le dernier JSON valide**. Le 21/10/2026, les quatre dates disponibles ont chacune **81 IC attendus et 81 indexés**.

Les modifications sur la carte sont limitées au rendu des gares et aux fiches d'horaires BE-only. Elles n'altèrent ni le fonctionnement du jeu, ni les données SNCF, ni les flux temps réel CFL, ni la position des trains.

## Sauvegardes et restauration

Sous `/opt/labetaillere-map-v2-src/map-v2/backups/` :

- `build_be_international_lb_index.before-be-all-ic-20261021.py`
- `lb-be-international-ends-v1.before-be-all-ic-20261021.json`
- `carte-core-preview.before-be-all-ic-20261021.html`
- `carte-preview.before-be-all-ic-20261021.html`
- `build_be_international_lb_index.before-coverage-guard-20261021.py`

Pour revenir entièrement à la version pré-déploiement, restaurer les quatre premiers fichiers à leurs chemins initiaux, puis recalculer ou conserver l'ancien index selon la version de la carte ; la minuterie peut rester identique. Ne pas restaurer ni modifier le serveur de statistiques SNCF.

Limite : ces horaires belges ne sont **pas** des observations réelles. La base SNCB est alimentée quotidiennement ; si une mise à jour du GTFS échoue ou omet les données du jour, le générateur conserve les dernières données validées plutôt que d'inventer des résultats.
