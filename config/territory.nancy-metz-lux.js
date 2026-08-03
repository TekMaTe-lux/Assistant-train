/*
 * Configuration de territoire.
 * Cette petite couche permet de réutiliser l'app shell sur un autre corridor
 * sans dupliquer la navigation, les libellés et l'identité visuelle.
 */
window.LB_TERRITORY_CONFIG = Object.freeze({
  id: "nancy-metz-thionville-luxembourg",
  brand: "La Bétaillère",
  territory: "Nancy · Metz · Thionville · Luxembourg",
  shortTerritory: "Nancy · Metz · Lux",
  language: "fr",
  theme: {
    primary: "#31e7f2",
    background: "#030b13",
    success: "#33d884",
    warning: "#ff943d",
    danger: "#ff4e5c"
  },
  pages: {
    home: {
      title: "Bonjour le bétail",
      description: "L’essentiel du corridor en un coup d’œil."
    },
    search: {
      eyebrow: "Préparer",
      title: "Trouver ma bétaillère",
      description: "Tableau rapide, fiche train ou recherche de trajet."
    },
    carte: {
      eyebrow: "Maintenant",
      title: "Le réseau en direct",
      description: "Trains, retards et situation du corridor sur la carte."
    },
    favoris: {
      eyebrow: "Mon quotidien",
      title: "Mes bétaillères favorites",
      description: "Mes trains du matin et du soir, avec leur état réel."
    },
    stats: {
      eyebrow: "Comprendre",
      title: "Fiabilité du réseau",
      description: "Ponctualité, perturbations et comparaisons depuis janvier 2026."
    },
    loisirs: {
      eyebrow: "La communauté",
      title: "L’univers BER",
      description: "Vidéos, bingo et jeux de La Bétaillère."
    }
  }
});

/*
 * Coeur v4 — couche progressive.
 * Elle est chargée depuis la configuration pour éviter de toucher au gros
 * index.html et rester simple à désactiver en cas de régression.
 */
(function loadBetaillereCoreV4() {
  if (typeof document === "undefined") return;

  if (!document.getElementById("lbCoreV4Styles")) {
    const stylesheet = document.createElement("link");
    stylesheet.id = "lbCoreV4Styles";
    stylesheet.rel = "stylesheet";
    stylesheet.href = "./assets/lb-core-v4.css?v=1";
    document.head.append(stylesheet);
  }

  if (!document.getElementById("lbCoreV4Script")) {
    const script = document.createElement("script");
    script.id = "lbCoreV4Script";
    script.src = "./assets/lb-core-v4.js?v=1";
    script.async = false;
    document.head.append(script);
  }
})();
