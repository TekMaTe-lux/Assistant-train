# La Bétaillère V4 — Command Center

## Objectif

Faire de labetaillere.fr un tableau de commande ferroviaire cohérent, rapide, accessible et immédiatement identifiable, sans modifier la logique métier des moteurs ferroviaires pendant la migration UI.

## Principes non négociables

1. Une seule source de vérité côté données : `LB Data Engine`.
2. Un seul contrat de données normalisé pour le front, la carte, les favoris, les fiches trains, le LIVE et les statistiques.
3. Un seul design system : tokens, composants, états et mouvements partagés.
4. Un seul moteur de modales et de panneaux.
5. Une seule famille de composants Train : compact, favorite, full.
6. Une seule sémantique d'états : on-time, delay, cancelled, partial, planned, live, unknown.
7. Pas de couleur comme unique porteur d'information.
8. Mobile d'abord, desktop cockpit ensuite.
9. Animations courtes et fonctionnelles, désactivables via `prefers-reduced-motion`.
10. Aucune régression des données SNCF/CFL/GTFS/HAFAS pendant la refonte visuelle.

## Inventaire actuel à consolider

Le dépôt contient plusieurs générations de style simultanées :

- `assets/lb-legacy.css` (~680 Ko)
- `assets/lb-design-system-v3.css`
- `assets/lb-mobile-v4.css`
- styles trafic séparés
- styles inline historiques dans `index.html`
- composants ayant leurs propres règles de modale, de carte, de badge et de formulaire

La V4 ne doit pas devenir une couche supplémentaire permanente. Elle sert de cible ; les couches historiques seront supprimées progressivement une fois chaque famille migrée.

## Architecture cible

```text
SNCF / GTFS / GTFS-RT / SIRI SX / CFL HAFAS / voies / compos / affluence / stats
                            │
                            ▼
                    LB DATA ENGINE V4
              normalisation + cache + fusion + qualité
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
         snapshot        endpoints      événements
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                     LB DATA CLIENT
                            │
       ┌──────────┬─────────┼──────────┬──────────┐
       ▼          ▼         ▼          ▼          ▼
     Accueil    Tableau    Carte     Favoris     Stats
       │          │         │          │          │
       └──────────┴─────────┴──────────┴──────────┘
                            ▼
                  DESIGN SYSTEM V4
```

## Contrat Train V4

Toutes les vues doivent recevoir la même forme d'objet.

```js
{
  id: "88742:2026-08-27",
  number: "88742",
  serviceDate: "2026-08-27",
  operator: "SNCF",
  line: "L90",
  origin: { id, name, plannedTime, realtimeTime, platform },
  destination: { id, name, plannedTime, realtimeTime, platform },
  status: "delay",
  delayMinutes: 12,
  cancelled: false,
  partial: false,
  live: true,
  position: { lat, lon, bearing, source, confidence },
  composition: { code, units, capacity, source, confidence },
  occupancy: { percent, level, source, confidence },
  stops: [],
  disruptions: [],
  provenance: [],
  updatedAt: "..."
}
```

## Endpoints V4 cibles

Tous sont dérivés du même moteur et non de logiques séparées.

- `GET /api/v4/snapshot`
- `GET /api/v4/trains`
- `GET /api/v4/trains/:number?date=YYYY-MM-DD`
- `GET /api/v4/stations/:id`
- `GET /api/v4/traffic`
- `GET /api/v4/map`
- `GET /api/v4/stats/overview`
- `GET /api/v4/stats/train/:number`
- `GET /api/v4/health`

Chaque réponse comporte `updatedAt`, `stale`, `sources` et `confidence` lorsque pertinent.

## Design V4

### Identité

- fond nuit ferroviaire presque noir ;
- cyan électrique = interaction / sélection ;
- blanc froid = information primaire ;
- vert = nominal ;
- ambre = attention ;
- orange = retard ;
- rouge = suppression / interruption ;
- violet uniquement pour données communautaires ;
- grille et repères inspirés d'un pupitre de commande, sans surcharge décorative.

### Typographie

- Orbitron : titres courts, numéros de train, métriques et badges ;
- Rajdhani : texte, tableaux, formulaires et informations voyageur ;
- tailles centralisées par tokens ;
- aucun composant ne définit arbitrairement sa propre échelle typographique.

### Familles de composants

- `lb-panel`
- `lb-card`
- `lb-button`
- `lb-icon-button`
- `lb-status`
- `lb-badge`
- `lb-kpi`
- `lb-field`
- `lb-table`
- `lb-modal`
- `lb-sheet`
- `lb-train-card`
- `lb-train-route`
- `lb-platform`
- `lb-occupancy`
- `lb-alert`
- `lb-empty-state`
- `lb-skeleton`

## Train UI unique

Le même langage visuel doit servir partout.

### Compact

Numéro + origine → destination + état + retard + voie.

### Favorite

Compact + composition + affluence + prochain horaire + action fiche.

### Full

Favorite + parcours complet + perturbations + provenance + actions.

Une donnée ne doit jamais être calculée différemment selon la vue ; seule la présentation change.

## Modales

Toutes les modales passent par le même contrôleur :

- `role=dialog` / `aria-modal=true` ;
- titre accessible ;
- focus initial ;
- piège à focus ;
- fermeture Échap ;
- clic backdrop si autorisé ;
- restauration du focus ;
- page arrière `inert` ;
- scroll interne ;
- animation identique ;
- mode sheet sur petit écran quand pertinent.

## Performance

À éliminer pendant la migration :

- empilements de `backdrop-filter` ;
- ombres multiples sur des centaines de lignes ;
- animations permanentes ;
- MutationObservers globaux non nécessaires ;
- lectures/écritures DOM alternées dans des boucles ;
- fetchs identiques lancés par plusieurs widgets ;
- recalculs séparés d'une même information train.

Le Data Client doit dédupliquer les requêtes et diffuser les mises à jour aux composants abonnés.

## Accessibilité

Cible : WCAG 2.2 AA / RGAA.

- focus visible partout ;
- cible tactile de préférence 44 px ;
- graphiques avec résumé textuel ;
- affluence accompagnée d'un libellé ;
- informations live dans des régions adaptées ;
- alternative à la carte par liste/tableau/fiches ;
- contraste testé ;
- aucune information transmise uniquement par la couleur.

## Migration

### Phase A — socle
- tokens V4
- composants V4
- contrôleur modal unique
- Data Client / contrat V4
- page preview isolée

### Phase B — composants train
- fiche train
- favoris
- tableau
- badges voies / retards / composition / affluence

### Phase C — pages
- accueil cockpit
- recherche
- LIVE
- statistiques
- compte / préférences

### Phase D — carte
- contrôles
- panneaux
- fiche train
- cohérence visuelle avec le site

### Phase E — nettoyage
- suppression des règles legacy devenues inutiles
- suppression des scripts correctifs remplacés
- audit clavier/VoiceOver/NVDA
- test mobile
- mesure performance

## Règle de déploiement

La branche `refonte-v4-command-center` reste isolée tant que les tests de non-régression métier ne sont pas passés. La bascule finale doit être unique côté utilisateur, même si l'implémentation est découpée en commits vérifiables.
