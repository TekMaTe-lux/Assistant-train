# MooRail — complément BE/LU des origines et terminus

Déployé le 21/10/2026 uniquement sur la page MooRail `france-v3-preview.html`.

## Principe de sécurité

- Donnée principale : parcours `LU`/CFL tel que renvoyé par MooRail, avec tous ses arrêts, prévisions, retards, voies, statuts, tracés et statistiques **inchangés**.
- Enrichissement de présentation : une origine OU une destination plus complète provenant d'un trajet `BE`/SNCB (heure théorique et nom), seulement après validation stricte du rapprochement.
- Clé : `(serviceDate, number, luTripId)` ; vérification d'au moins deux gares communes dans l'ordre, horaires à ±3 min, confirmation du début et de la fin du segment LU, destination ou origine BE sur Luxembourg (LU), présence d'un terminus ou départ frontalier LU en Belgique ; cas ambigus rejetés.
- Aucun appel supplémentaire à la SNCB/HAFAS : l'index utilise les métadonnées MooRail et son service de détail local (`127.0.0.1:3124`). La carte charge seulement le petit JSON une fois lors de la première ouverture d'une fiche LU.
- La fiche affiche une phrase si elle montre une origine belge hors du tronçon d'arrêts LU : « Détail des arrêts affiché de Gouvy à Luxembourg ».
- Les fiches `BE`, `FR`, `NL` etc. ne sont pas modifiées. Un train `BE` comme l'IC 2134 dispose déjà directement de Luxembourg → Bruxelles-Midi dans MooRail.

## Fichiers

- Script générateur : `/opt/lb-rail-engine-v1/app/build_be_lu_endpoint_bridge.py` (code versionné sous `vps/moorail/build_be_lu_endpoint_bridge.py`).
- Index léger : `/opt/labetaillere-map-v2-src/map-v2/public/data/moorail-be-lu-endpoints-v1.json`.
- Affichage MooRail : `/opt/labetaillere-map-v2-src/map-v2/public/france-v3-preview.html` (code injecté avec `/tmp/moorail-be-lu-endpoints-patch.py`).
- Timer : `moorail-be-lu-endpoints.timer`, service : `moorail-be-lu-endpoints.service` ; 30 min.
- Sauvegarde : `/opt/labetaillere-map-v2-src/map-v2/backups/france-v3-preview.before-be-lu-endpoints-20261021.html`.

## Tests

- Générateur : test positif Liège → Gouvy → Luxembourg (5306), rejet du mauvais numéro/date, de la collision d'horaire, d'un trajet sans les gares communes ; 11 arrêts communs observés pour le train 5306.
- Fiche JavaScript : syntaxe vérifiée pour tous les blocs inline ; validation de sélection LU 5306 et rejet si source BE, mauvais numéro, mauvaise date ou mauvais `tripId`.
- Service, timer et endpoint HTTP validés ; services SNCF/CFL/SNCB tous actifs lors du déploiement.
- Indicateur réel initial : 1 correspondance vérifiée le 21 octobre 2026 ; une absence de correspondance ne modifie pas la fiche.

## Retour arrière

```sh
sudo cp -p /opt/labetaillere-map-v2-src/map-v2/backups/france-v3-preview.before-be-lu-endpoints-20261021.html /opt/labetaillere-map-v2-src/map-v2/public/france-v3-preview.html
sudo systemctl disable --now moorail-be-lu-endpoints.timer
```

Les autres services, leurs API et leurs fichiers n'ont pas besoin d'être redémarrés ou modifiés pour revenir en arrière.
