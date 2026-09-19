# POC SNCF voies détaillées

Branche de test uniquement. Aucun fichier de production n'est modifié.

Objectif : ajouter les géométries détaillées des voies SNCF Réseau dans une couche séparée, puis tester la correspondance `gare + voie annoncée -> géométrie de voie` avant toute intégration au moteur de déplacement.

Garde-fous :
- `paths.json` reste l'autorité des parcours inter-gares.
- aucune modification de `carte-core.html` sur `main`.
- aucune activation automatique en production.
- validation d'abord sur Nancy, puis Metz et Thionville.
