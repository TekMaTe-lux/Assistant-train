# LB Data Engine V4

Service d'agrégation unique pour La Bétaillère.

## Pourquoi

Le front ne doit plus interroger et réconcilier lui-même plusieurs JSON/API. Ce service récupère les sources, les met en cache, ajoute provenance/fraîcheur, normalise les trains et expose un contrat stable.

## Pré-requis

- Node.js 18+
- accès réseau aux sources actuelles
- service stats existant sur `127.0.0.1:3099` ou variable `LB_STATS_BASE`

## Démarrage de test

```bash
LB_DATA_PORT=3120 node server.mjs
```

Puis :

```bash
curl -s http://127.0.0.1:3120/api/v4/health | jq
curl -s http://127.0.0.1:3120/api/v4/trains | jq '.trains[0]'
curl -s http://127.0.0.1:3120/api/v4/trains/88742 | jq
```

## Variables

```text
LB_DATA_HOST=127.0.0.1
LB_DATA_PORT=3120
LB_SOURCE_TTL_MS=12000
LB_SOURCE_TIMEOUT_MS=7000
LB_CORS_ORIGIN=https://www.labetaillere.fr
LB_STATS_BASE=http://127.0.0.1:3099
LB_SOURCE_SNCF_RT=https://vps.labetaillere.fr/gtfs/retards_nancymetzlux.json
LB_SOURCE_CFL_RT=https://vps.labetaillere.fr/gtfs/retards_cfl.json
LB_SOURCE_CFL_ARRIVALS=https://vps.labetaillere.fr/gtfs/retards_cfl_arrivals.json
LB_SOURCE_TRAFFIC=https://vps.labetaillere.fr/gtfs/siri_sx_alertes.json
LB_SOURCE_COMPOSITIONS=https://www.labetaillere.fr/Compotrains.json
```

## Endpoints

- `/api/v4/health`
- `/api/v4/snapshot`
- `/api/v4/trains`
- `/api/v4/trains/:number`
- `/api/v4/traffic`
- `/api/v4/map`
- `/api/v4/stats/overview`

## Règles de migration

1. Ne pas arrêter les endpoints historiques.
2. Déployer V4 en parallèle.
3. Comparer pendant plusieurs journées les sorties V4 et historiques.
4. Brancher un composant du front à la fois sur `LBData`.
5. Une fois toutes les vues alimentées par V4, supprimer les fetchs historiques côté navigateur.
6. Les sources métier restent isolées dans le moteur ; aucun nouveau widget ne doit requêter directement SNCF/CFL/GTFS/SIRI.

## Important

Les alias de numéros SNCF/CFL servent uniquement à enrichir une circulation (par exemple une voie CFL). Ils ne fusionnent pas aveuglément deux circulations en une seule identité métier.
