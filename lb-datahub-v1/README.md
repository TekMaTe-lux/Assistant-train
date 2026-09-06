# LB DataHub v1 — socle statique France

Ce dossier prépare le futur moteur ferroviaire commun à **La Bétaillère** et **MooTrain**.

## Règle de sécurité

Cette V1 est volontairement **parallèle et non destructive** :

- ne modifie pas `/opt/labetaillere-map-v2-src/map-v2/public/` ;
- ne modifie pas `carte-core-preview.html` ;
- ne modifie pas `carte-preview.html` ;
- ne redémarre aucun service ;
- ne remplace aucun GTFS actuel ;
- ne télécharge pas automatiquement les gros fichiers de voies.

Le premier objectif est uniquement de mesurer et comprendre le socle Open Data France avant de construire `FR_STATIC_ENGINE_V1`.

## Les 8 couches inventoriées

1. `fichier-de-formes-des-voies-du-reseau-ferre-national` — géométrie fine des voies ;
2. `formes-des-lignes-du-rfn` — squelette national léger ;
3. `lignes-par-type` — ligne/raccordement/embranchement/desserte ;
4. `liste-des-gares` — référentiel RFN, UIC, ligne et PK ;
5. `gares-de-voyageurs` — référentiel voyageurs Gares & Connexions ;
6. `liste-des-quais` — caractéristiques/localisation disponible des quais ;
7. `regime-dexploitation-des-lignes` — DV/VU/BANAL ;
8. `vitesse-maximale-nominale-sur-ligne` — garde-fou de plausibilité.

Le registre détaillé est dans `config/fr-static-sources.json`.

## Architecture visée

```text
SNCF OPEN DATA
      │
      ├── lignes RFN ───────────────► couche nationale légère
      ├── voies RFN ────────────────► couche géométrique fine
      ├── lignes/type/régime/vmax ──► couche topologique
      ├── gares/quais ──────────────► couche stations
      │
      └──────────────────────────────► FR_STATIC_ENGINE_V1
                                          │
                                          ├── infrastructure versionnée
                                          ├── station-layout
                                          └── futures tuiles MVT/PMTiles

GTFS SNCF ──────────────────────────► couche horaires séparée
calendar/calendar_dates ────────────► index de jours J/J+1 séparé
```

Important : **l'infrastructure, le GTFS et les index de jours ne doivent jamais être dupliqués les uns dans les autres.**

## Audit automatique

Le script `tools/audit_fr_static_sources.py` interroge uniquement l'API publique SNCF Explore v2.1.

Il relève pour chaque source :

- disponibilité ;
- nombre d'enregistrements lorsque l'API le fournit ;
- liste des champs ;
- clés de jointure détectées ;
- clés attendues manquantes ;
- formats d'export exposés ;
- pièces jointes et tailles lorsqu'elles sont annoncées ;
- latence de l'API de métadonnées ;
- matrice des clés communes entre les huit datasets.

Il ne prélève qu'un enregistrement de chaque dataset et ne télécharge pas les gros exports.

## Exécution sûre sur le VPS

Le checkout VPS pouvant être partiel, ne pas faire de `git reset --hard`.

```bash
cd /opt/labetaillere-map-v2-src || exit 1
set -u

git fetch origin main

AUDIT_ROOT="/tmp/lb-datahub-v1-audit"
rm -rf "$AUDIT_ROOT"
mkdir -p "$AUDIT_ROOT/config" "$AUDIT_ROOT/tools" "$AUDIT_ROOT/out"

git show origin/main:lb-datahub-v1/config/fr-static-sources.json \
  > "$AUDIT_ROOT/config/fr-static-sources.json"

git show origin/main:lb-datahub-v1/tools/audit_fr_static_sources.py \
  > "$AUDIT_ROOT/tools/audit_fr_static_sources.py"

python3 -m py_compile "$AUDIT_ROOT/tools/audit_fr_static_sources.py"

python3 "$AUDIT_ROOT/tools/audit_fr_static_sources.py" \
  --config "$AUDIT_ROOT/config/fr-static-sources.json" \
  --out "$AUDIT_ROOT/out"

printf '\n=== RAPPORT ===\n'
cat "$AUDIT_ROOT/out/report.md"
```

Tout est créé sous `/tmp/lb-datahub-v1-audit`. Aucun fichier de production n'est écrit.

## Clés de jointure à confirmer par l'audit

### Infrastructure ↔ infrastructure

Priorité :

```text
CODE_LIGNE + RG_TRONCON
```

Puis, pour une position ferroviaire à l'intérieur d'une ligne :

```text
PK / PKD / PKF
```

`IDGAIA` et `IDRESEAU` sont conservés comme identifiants complémentaires lorsque disponibles.

### Gare ↔ gare

Priorité :

```text
CODE_UIC
```

Le futur rapprochement avec GTFS devra normaliser les variantes éventuelles du code UIC sans modifier la donnée source originale.

### Gare ↔ ligne/voie

Priorité :

```text
CODE_LIGNE + RG_TRONCON + PK
```

La géométrie sert ensuite de contrôle spatial, pas de clé unique.

## Limites connues dès la conception

- les voies RFN fines n'incluent pas exhaustivement les voies de service situées en gare ;
- les quais ne garantissent pas un mapping direct `numéro de voie -> rail` ;
- les `station-overrides` actuels de La Bétaillère restent donc une couche premium indispensable ;
- la vitesse nominale n'est jamais une vitesse réelle de train ;
- aucune donnée Open Data statique ne doit être utilisée comme information de sécurité ferroviaire ou d'exploitation réelle.

## Étape suivante après l'audit

Aucune production n'est modifiée automatiquement.

Après lecture du rapport, la prochaine étape sera de définir le schéma exact de `FR_STATIC_ENGINE_V1` :

```text
infra-lite      -> zoom France
infra-detail    -> zoom régional/local
stations        -> gares/quais/référentiels
station-layout  -> voies de gare + overrides La Bétaillère
timetable       -> GTFS précompilé séparément
day-index       -> service_date -> liste de trip_id actifs
```

Seulement après validation de ce schéma viendront les tests de compilation, puis J/J+1, puis une carte laboratoire.
