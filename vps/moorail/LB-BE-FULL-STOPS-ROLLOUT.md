# La Bétaillère — intégration des arrêts belges complets et destinations en gare

Déploiement : 21 octobre 2026. Cette fonctionnalité concerne **La Bétaillère**, sa carte, le module « En gare » de l'accueil et les fiches trains ouvertes sur le site. Elle n'est pas limitée à MooRail.

## Mise en œuvre

- `vps/map-v2/lb-be-extension-helper-v1.js` : validateur conservateur de la correspondance BE↔CFL et extraction des seuls arrêts belges qui manquent au parcours CFL. Clé date/numéro, 2 gares et horaires cohérents (3 si catégorie différente), sens et étendue du parcours, rejet des ambiguïtés et des faux doublons ; prise en compte des numéros CFL avec zéro initial.
- `vps/map-v2/lb-cfl-detail-v1.js` : fiche de la carte, stations belges prévues avant/après la liste CFL existante. Les prévisions et voies CFL restent inchangées, aucune donnée de LIVE n'est inventée pour les arrêts belges.
- `assets/lux-train-sheet.js` : fiche du site principal, ajout de lignes belges prévues autour de la liste des arrêts CFL.
- `assets/lb-home-station-board-v3.js` : colonne provenance/destination de « En gare » enrichie après chargement facultatif d'un JSON léger, sans ralentir l'affichage immédiat ni changer les retards/voies.
- `/map-v2/carte-core-preview.html` (VPS) : modification locale des lignes de destination/provenance dans les gares de la carte et du résumé du train sélectionné, avec correspondance validée. Le fichier historique de la carte n'a pas été remplacé sur GitHub ; le correctif de déploiement a été effectué sur une copie, validé puis sauvegardé sur le VPS.
- `/map-v2/carte-preview.html` (VPS) : versionnement de l'iframe pour le rafraîchissement du cache.
- `index.html`, `assets/home-major-alerts.js`, `service-worker.js` : changement de versions JS / cache PWA v174.
- Cache BE léger `/map-v2/data/lb-be-international-ends-v1.json` alimenté à partir de MooRail, mise à jour 30 min. Aucun nouveau polling SNCB ni CFL par visiteur.

## Résultats réels testés (21/10/2026)

| Train | Parcours CFL initial | Parcours complet dans les fiches |
| --- | ---: | ---: |
| IC 5311, Liège-Guillemins → Luxembourg | 12 arrêts | 21 (9 belges ajoutés) |
| IC 2134, Luxembourg → Bruxelles-Midi | 3 arrêts | 16 (13 belges ajoutés) |
| RB 5086, Athus → Luxembourg | 11 arrêts | 11, inchangé |

- Chromium : fiches détaillées sur la carte PASS pour ces trois trains.
- Chromium : **versions publiques** des scripts fiches du site principal PASS pour ces trois trains.
- Chromium : pont de la carte « gare Luxembourg / arrivées » et IC 5311 → provenance **Liège-Guillemins** PASS.
- Chromium : **version publique** du module « En gare » → provenance **Liège-Guillemins** PASS.
- Test de syntaxe : 42 scripts inline de la carte, scripts JS individuels.
- Les empreintes SHA-256 du serveur SNCF stats et de l'historique GTFS-RT sont inchangées.
- Les services `labetaillere-map-v2`, `labetaillere-stats`, `labetaillere-data-v4`, les timers CFL et le générateur BE sont actifs.

## Sauvegardes/retour arrière

Les copies suivantes ont été créées **avant** le déploiement du parcours complet :

- `/opt/labetaillere-map-v2-src/map-v2/backups/carte-core-preview.before-full-be-stops-20261021.html`
- `/opt/labetaillere-map-v2-src/map-v2/backups/carte-preview.before-full-be-stops-20261021.html`
- `/opt/labetaillere-map-v2-src/map-v2/backups/lb-cfl-detail-v1.before-full-be-stops-20261021.js`
- `/opt/labetaillere-map-v2-src/map-v2/backups/lb-be-extension-helper-v1.before-full-be-stops-20261021.js`

Restaurer ces quatre copies en cas de retour arrière **côté carte seulement** ; pas besoin de redémarrer ni de modifier un collecteur. Côté site et « En gare », restaurer les révisions antérieures des fichiers mentionnés depuis GitHub. Le minuteur BE peut être désactivé indépendamment : `sudo systemctl disable --now lb-be-international-ends.timer`.

## Limites

Les horaires belges ajoutés sont **prévus** : ils ne sont pas accompagnés de retards, suppressions, quais/voies ou causes LIVE belges sans source directement fiable. Une correspondance absente ou ambiguë conserve intégralement les données CFL d'origine. Les autres pays, trains SNCF et statistiques historiques SNCF ne sont pas modifiés.
