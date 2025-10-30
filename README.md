# Assistant-train
Train essai

## Cache partagé SNCF

Le proxy `api/trainsauv.js` ne se contente plus de relayer les appels vers l'API SNCF :
il peut maintenant persister chaque réponse JSON dans un fichier hébergé sur GitHub. Ce
stockage commun permet à tous les visiteurs du site de profiter d'un cache partagé,
même si leur navigateur n'a jamais interrogé l'API auparavant.

### Configuration requise

Définissez les variables d'environnement suivantes sur l'hébergement (Vercel, Netlify, etc.) :

| Variable | Description |
| --- | --- |
| `SNCF_KEY` | Clé API SNCF (déjà utilisée par le proxy). |
| `GITHUB_TOKEN` | Jeton GitHub avec les droits `repo` pour mettre à jour le fichier de cache. |
| `GITHUB_OWNER` / `GITHUB_REPO` | Cible du dépôt qui contiendra le fichier JSON. |
| `GITHUB_CACHE_PATH` | (optionnel) Emplacement du fichier, par défaut `data/shared-sncf-cache.json`. |
| `GITHUB_CACHE_BRANCH` | (optionnel) Branche à mettre à jour, par défaut `main`. |
| `SNCF_CACHE_TTL_SECONDS` | (optionnel) Durée de vie par défaut des entrées (secondes). |
| `SNCF_CACHE_MAX_ENTRIES` | (optionnel) Nombre maximal d'entrées mémorisées avant purge. |

À chaque requête, la fonction serverless :

1. Cherche une réponse fraîche dans le fichier GitHub.
2. Retourne un `X-Sncf-Cache-State: HIT` en cas de réutilisation.
3. À défaut, interroge l'API SNCF, renvoie la réponse puis met à jour le fichier via l'API GitHub
   (`X-Sncf-Cache-State: MISS`).

Les clients front-end (via `sncf-api-manager.js`) exploitent automatiquement ce proxy et
transmettent la politique de rafraîchissement calculée localement pour aligner la durée
de vie du cache partagé sur celle du cache navigateur.
