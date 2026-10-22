/* Photos des gares — La Bétaillère.
 * Déposer les fichiers WebP dans /var/www/html/assets/gares/ sur le VPS.
 * Ajouter une entrée par gare, par exemple 'luxembourg': 'luxembourg.webp'.
 * Identifiant = nom de gare en minuscules, sans accents, espaces remplacés par -.
 * Sans entrée, photo générique. En cas d'image personnalisée indisponible,
 * retour automatique à quai-default.webp, sans bloquer le LIVE. */
window.LB_STATION_HERO_PHOTOS={
  baseUrl:'https://vps.labetaillere.fr/assets/gares/',
  defaultFile:'quai-default.webp',
  byStation:{
    // 'luxembourg':'luxembourg.webp',
    // 'metz':'metz.webp',
    // 'nancy':'nancy.webp'
  }
};
