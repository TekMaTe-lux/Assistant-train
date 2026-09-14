# Référence UI — Accueil La Bétaillère

Cette fiche fixe la direction graphique de l’accueil afin d’éviter les corrections contradictoires.

## 1. Principe général
- Bleu nuit / cyan = langage visuel principal.
- Vert / orange / rouge = uniquement pour un état ou une action sémantique.
- Pas d’effet « guirlande » : pas de gros aplats colorés concurrents.
- Même rayon, même fond et même bordure de base pour les contrôles interactifs.
- Les données restent lisibles avant les effets graphiques.

## 2. Bloc central
- Info trafic, Tableau et Ponctualité restent dans une coque visuelle commune.
- Les trois titres ont la même hauteur, la même police et la même taille.
- Info trafic est un état, pas un bouton : carte sombre + point coloré + texte d’état.
- Tableau utilise les contrôles standards de l’accueil.
- Les donuts conservent uniquement leurs couleurs de données.

## 3. La Voix du Bétail
- Ligne principale : « La Voix du Bétail » à gauche, FAQ à droite.
- Sous le titre : uniquement `Pseudo · Grade`.
- Ne jamais afficher l’image du grade dans l’entête.
- Ne jamais afficher les points dans cet entête.
- Le flux communautaire apparaît avant les actions Signaler / LIVE.
- Signaler et LIVE gardent leur fonction et leur couleur d’accent, mais partagent la même coque graphique.

## 4. Famille de boutons
- Fond sombre bleu-noir.
- Bordure cyan discrète.
- Rayon commun ≈ 12 px.
- Pas de glow permanent fort.
- Signaler : accent ambre seulement.
- LIVE : accent vert seulement.
- FAQ : contrôle compact neutre.
- Matin / Soir / Nancy-Metz / Metz-Nancy : même famille de contrôle.

## 5. Mobile / PWA
- Priorité à la lisibilité entre 360 et 430 px.
- Aucun titre ne doit être tronqué par un badge ou une action.
- Aucun élément ne doit dépasser horizontalement.
- Les zones tactiles importantes restent proches de 42 px de hauteur.
- Le clavier ne doit pas masquer le champ d’envoi.

## 6. Desktop
- Même langage visuel que mobile, avec davantage d’espace.
- Aucun style desktop ne doit diverger vers une autre palette ou une autre famille de boutons.

## 7. Sécurité de modification
- Ne jamais renommer les IDs métier pour une simple correction visuelle.
- Ne pas toucher aux handlers, API, flux LIVE ou logique de données pour une refonte CSS.
- Ajouter les changements visuels dans une couche réversible.
- Contrôler au minimum mobile étroit + mobile standard + desktop avant validation.
