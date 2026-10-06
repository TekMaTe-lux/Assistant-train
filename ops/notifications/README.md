# Notifications serveur

Modules déployés dans /opt/labetaillere-auth le 6 octobre 2026.

Dans server.js, après la route GET /api/push/public-key, remplacer les anciennes routes subscribe/test par :

```js
require("./push-routes.cjs").register(app, db, auth, webpush);
```

Le démarrage ajoute settings_json à push_subscriptions et notified_episode_id à push_traffic_state. Sauvegarder SQLite avant migration. Installer les modules, redémarrer labetaillere-auth, puis remplacer les scanners. Utiliser /usr/bin/node, compatible avec better-sqlite3 installé.

Les deux scanners restent exécutés chaque minute par cron, avec les variables VAPID existantes et DRY_RUN=false. Ne jamais publier les clés, abonnements ou bases de données.

Sources : retards_nancymetzlux.json et siri_sx_alertes.json. Les données de plus de 15 minutes sont écartées. Les préférences sont propres à chaque appareil ; les anciennes inscriptions gardent les préférences utilisateur. Les alertes expirent après 120 secondes (favoris), 180 secondes (majeur), 60 secondes (test).

Le majeur demande deux scans consécutifs, conserve le délai de 90 minutes et réinitialise après 20 minutes de calme. Un épisode n’est marqué notifié qu’après un envoi réussi. Le test peut attendre 10 secondes afin de fermer la PWA.

Les scanners acceptent PUSH_DB_PATH et PUSH_RT_PATH pour les tests isolés ; le majeur accepte aussi PUSH_SIRI_PATH. DRY_RUN=true n’écrit pas l’état du majeur et n’envoie rien.

## Suivi et messages personnalisés (6 octobre 2026)

Installer aussi push-personalization.cjs avant de remplacer le scanner favoris. Le message indique le retard maximum sur le trajet entre les gares favorites, les valeurs annoncées au départ et à l’arrivée, et ouvre la fiche du train. Si les gares ne sont pas reconnues, le message garde le segment disponible sans inventer un trajet personnel. Le seuil de 10 minutes, la fenêtre utile et les 20 minutes anti-spam restent en place.

La migration ajoute push_traffic_deliveries : seuls les appareils ayant reçu une alerte majeure, toujours inscrits au même compte et toujours autorisés, reçoivent la fin d’alerte. Les endpoints sont identifiés par SHA-256. Après 20 minutes d’amélioration observée, sources RT et SIRI fraîches, le suivi précise que des retards et suppressions peuvent subsister. Une interruption du scanner ou des données périmées recommence la confirmation. Les échecs de transport peuvent être retentés sans répéter les envois réussis. La table est vidée à la fin de l’épisode.

Les incidents notifiés avant l’installation du suivi ne génèrent pas de message de fin, car leurs destinataires n’ont pas été suivis. Aucun envoi d’essai aux voyageurs lors du déploiement.

Test isolé avec SQLite temporaire et transport push simulé, sans réseau :

```sh
NODE_PATH=/opt/labetaillere-auth/node_modules /usr/bin/node test-followup.cjs
```

Le scanner favoris accepte maintenant PUSH_STATIC_PATH pour les fixtures isolées.
