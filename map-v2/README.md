# Carte globale V2 — projet parallèle

Cette version ne remplace **aucun** fichier de la carte actuelle. Elle vit entièrement dans `map-v2/` et utilise son propre port, ses propres données générées et sa propre page.

## Objectif

- garder les filtres TER / TGV / CFL et le mode « Sillon lorrain » ;
- pouvoir dézoomer vers la France entière ;
- distinguer les LGV des lignes classiques ;
- calculer un parcours ferroviaire cohérent selon le type de train et la vitesse des lignes ;
- afficher tout le parcours au clic ;
- déplacer le train sur **la même géométrie** que celle affichée ;
- ne transmettre au navigateur que les trains et lignes présents dans la zone visible.

## Ce que cette première version fait

Le prétraitement VPS assemble quatre sources :

1. GTFS SNCF : trains, arrêts, horaires et jours de circulation ;
2. lignes RFN par statut : squelette du graphe ferroviaire ;
3. lignes LGV : identification des LGV ;
4. vitesses maximales : choix d'un itinéraire fondé sur un temps de parcours théorique plutôt que sur la seule distance.

Le navigateur ne calcule aucun itinéraire. Il demande seulement :

- `/api/map-v2/infrastructure?bbox=...` pour le fond ferroviaire visible ;
- `/api/map-v2/trains?bbox=...` pour les trains visibles ;
- `/api/map-v2/paths/:pathId` quand un train est sélectionné ;
- `/api/map-v2/trips/:tripId` pour les gares et horaires du train.

## Installation de test sur le VPS

Les commandes sont volontairement détaillées pour pouvoir être exécutées une par une.

```bash
cd /opt
sudo mkdir -p labetaillere-map-v2
sudo chown "$USER":"$USER" labetaillere-map-v2
cd labetaillere-map-v2
```

Copier ensuite le dossier `map-v2/` dans ce répertoire, puis :

```bash
python3 scripts/download_sources.py --output data/sources
python3 scripts/build_dataset.py \
  --gtfs data/sources/sncf-gtfs.zip \
  --network data/sources/lignes-par-statut.geojson \
  --lgv data/sources/lignes-lgv.geojson \
  --speed data/sources/vitesses.geojson \
  --output data/generated
```

Le premier calcul national peut prendre du temps. Pour valider d'abord le principe sur Nancy–Metz–Luxembourg :

```bash
python3 scripts/build_dataset.py \
  --gtfs data/sources/sncf-gtfs.zip \
  --network data/sources/lignes-par-statut.geojson \
  --lgv data/sources/lignes-lgv.geojson \
  --speed data/sources/vitesses.geojson \
  --output data/generated \
  --bbox 5.70,48.45,6.35,49.65
```

Pour conserver les parcours complets des trains qui traversent le sillon, y compris
les TGV poursuivant vers Strasbourg, Lyon ou Montpellier, construire le réseau
national mais filtrer uniquement les circulations par leur passage dans la zone :

```bash
python3 scripts/build_dataset.py \
  --gtfs data/sources/sncf-gtfs.zip \
  --network data/sources/lignes-par-statut.geojson \
  --lgv data/sources/lignes-lgv.geojson \
  --speed data/sources/vitesses.geojson \
  --output data/generated \
  --trip-bbox 5.70,48.45,6.35,49.65
```

Contrairement à `--bbox`, `--trip-bbox` ne coupe pas les gares situées hors du
rectangle. Il limite seulement la liste aux trains qui traversent ce rectangle.

Lancer le serveur de test :

```bash
MAP_V2_PORT=3110 MAP_V2_DATA="$PWD/data/generated" node server/server.mjs
```

Puis ouvrir :

```text
http://ADRESSE_DU_VPS:3110/carte-v2.html
```

## Test sans risque

Cette version utilise par défaut le port `3110`. Elle ne remplace ni le service actuel, ni le port 3099, ni `carte.html`.

Le branchement à `labetaillere.fr` ne devra être fait qu'après validation visuelle et fonctionnelle.

## Temps réel

Sans fichier temps réel, les positions sont animées à partir des horaires théoriques. Pour appliquer un retard global par numéro de train, définir :

```bash
MAP_V2_REALTIME_FILE=/chemin/vers/retards_carte.json
```

L'adaptateur accepte plusieurs formes JSON simples et reste isolé dans `server/realtime-adapter.mjs`. Le branchement exact sur le cache actuel sera la prochaine étape, une fois un échantillon réel du fichier vérifié.

## Limites connues de ce socle

- Les données ouvertes ne constituent pas un GPS public : la position reste estimée.
- La topologie RFN peut contenir des extrémités presque jointives. Le constructeur applique un raccordement spatial prudent, mais un contrôle des parcours atypiques restera nécessaire.
- Le profil TER pénalise fortement les LGV ; le profil TGV privilégie les lignes rapides. Les exceptions devront être fournies par une géométrie SNCF/Navitia mise en cache lorsqu'elle existe.
- Le Luxembourg sera raccordé au second lot avec le graphe CFL déjà présent dans le projet actuel.

## Fichiers importants

- `scripts/download_sources.py` : téléchargement des sources officielles ;
- `scripts/build_dataset.py` : construction du graphe, des parcours et du calendrier ;
- `server/server.mjs` : API cartographique par zone ;
- `server/realtime-adapter.mjs` : lecture optionnelle des retards ;
- `public/carte-v2.html`, `public/app.js`, `public/styles.css` : nouvelle carte indépendante.
