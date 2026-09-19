# SNCF voies détaillées — POC

Ce dossier sert uniquement à préparer et valider la couche de voies détaillées SNCF Réseau.

Principe d'intégration sécurisé :
1. conserver `paths.json` / le moteur actuel comme autorité pour les parcours inter-gares ;
2. charger une couche de voies détaillées séparée uniquement à fort zoom ;
3. tester la correspondance `station + numéro de voie` sur Nancy ;
4. ne router un train sur une voie détaillée que si la correspondance est certaine ;
5. sinon revenir automatiquement au tracé existant ;
6. étendre ensuite à Metz puis Thionville.

Source cible : `fichier-de-formes-des-voies-du-reseau-ferre-national`, SNCF Réseau. Géométries LineString/MultiLineString, WGS84 disponible, précision annoncée 1 à 10 m. Les voies de service situées en gare ne sont pas exhaustives.

Aucun fichier de production n'est modifié par ce POC.
