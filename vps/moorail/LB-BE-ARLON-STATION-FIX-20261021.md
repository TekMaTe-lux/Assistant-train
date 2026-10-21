# Correction des fiches de gare BE/LU — Arlon (21 octobre 2026)

## Constat

Dans « Gare d’Arlon », le tronçon GTFS CFL avait pour point de départ/terminus Arlon et ignorait la continuité belge dans le calcul des mouvements : un IC venant de Bruxelles ne figurait pas dans les **Arrivées**, un IC vers Bruxelles ne figurait pas dans les **Départs**.

La destination **Luxembourg** des IC 211x partant d’Arlon était bien exacte et devait rester inchangée.

Second problème : pour l’IC 2134, le flux CFL prévoit l’**arrivée** à Arlon à **11 h 31** mais la source SNCB prévoit le **départ** d’Arlon à **11 h 36**. Il s’agit de deux mouvements distincts, pas d’une mauvaise identité.

Enfin, la métadonnée MooRail évolue plus vite que l’index belge de La Bétaillère, auparavant rafraîchi toutes les 30 minutes ; l’IC 2137 était déjà présent dans MooRail mais absent de l’index utilisé par les fiches de gare.

## Correctifs

- `vps/map-v2/lb-be-extension-helper-v1.js` : autorise jusqu’à 6 minutes de différence **seulement au stop Arlon** du service international, sous contrôle de la date, du numéro, du sens, des autres gares communes et de l’unicité de correspondance. Expose `boundaryArrivalTime` / `boundaryDepartureTime` directement à partir du train belge.
- `/opt/labetaillere-map-v2-src/map-v2/public/carte-core-preview.html` : la fonction `stationBoardRows` peut afficher une arrivée programmée en amont de l’origine CFL (Bruxelles → Arlon) ou un départ programmé après le terminus CFL (Arlon → Bruxelles), **uniquement** si le parcours belge complet a été validé. Utilise à Arlon l’horaire côté SNCB pour le mouvement belge. Conserve les horaires, retards, voies, suppressions et autres mouvements CFL existants.
- Les mouvements belges ajoutés ont `bePlannedOnly:true`, `realtime:null`, `track:null` et sont étiquetés **« Horaire prévu »** au lieu de « À l’heure ».
- Le pont `lb:station-board:response` transmet ce statut à « En gare ».
- `assets/lb-home-station-board-v3.js` : « En gare » affiche « Horaire prévu » pour ces lignes, sans les faire passer pour des circulations observées.
- `lb-be-international-ends.timer` passe de 30 à **10 min** ; le script ne fait aucun nouvel appel API externe et utilise les données MooRail existantes.
- Le cache navigateur du complément belge se renouvelle tous les **10 min** (carte et module « En gare »).
- Versions : carte iframe `20261021-arlon-gare5`, PWA `v176`, module En gare `20261021-arlon5`.

## Tests observés

Tests navigateur Chromium le 21/10/2026, après déploiement :

- **Arlon, Arrivées** : IC 2111, Bruxelles-Midi → Arlon **14 h 29**, `bePlannedOnly:true`, sans voie ni retard temps réel inventés.
- **Arlon, Départs** : IC 2111 → Luxembourg **14 h 29**, circulation CFL inchangée.
- **Arlon, Arrivées** : IC 2134 depuis Luxembourg **11 h 31**, mouvement CFL inchangé (test d’horaire simulé).
- **Arlon, Départs** : IC 2134 → Bruxelles-Midi **11 h 36**, horaire belge prévu (test d’horaire simulé).
- **Arlon, Départs** : IC 2137 → Bruxelles-Midi **14 h 36**, confirmé par **test sur l’URL publique de la carte** après reconstitution de l’index.
- **Arlon, Départs** : RB 5914 reste Luxembourg, sans prolongement belge fictif.
- Validation de syntaxe de **42 scripts inline** de la carte. État des services `labetaillere-map-v2`, `labetaillere-data-v4`, `labetaillere-stats`, timer BE : `active` ; empreintes du serveur et de l’archive statistiques SNCF inchangées.

## Sauvegardes

Les sauvegardes préalables sont dans `/opt/labetaillere-map-v2-src/map-v2/backups/` :

- `carte-core-preview.before-arlon-gare-20261021.html`
- `carte-preview.before-arlon-gare-20261021.html`
- `lb-be-extension-helper-v1.before-arlon-gare-20261021.js`
- `carte-core-preview.before-arlon-ttl-20261021.html`
- `carte-preview.before-arlon-ttl-20261021.html`

Pour revenir avant les mouvements belges d’Arlon, restaurer le premier trio de fichiers. Les composants GitHub du site principal ont leurs révisions antérieures en historique.

## Limite explicite

Les trains sans service belge vérifiable ne sont pas prolongés artificiellement : par exemple, tous les services CFL Arlon–Luxembourg ne proviennent pas de Bruxelles. Les informations belges ajoutées sont des **horaires prévus**, indépendants des données LIVE CFL.
