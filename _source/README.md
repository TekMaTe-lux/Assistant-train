# Source de production de La Bétaillère

## Règle simple

**Modifier `_source/index.html`, pas le `index.html` à la racine.**

Le fichier racine est la version publique minifiée générée automatiquement.

### En local

```bash
python3 _source/build_prod.py
```

Le script :
- retire les commentaires HTML de développement ;
- compacte le HTML en une ligne ;
- vérifie quelques marqueurs structurels ;
- remplace `index.html` seulement si le build est valide.

### Sur GitHub

Une action GitHub surveille les changements de `_source/index.html` et de
`_source/build_prod.py`. Elle reconstruit `index.html` et committe le résultat.

Le dossier `_source` commence par un underscore afin de rester hors du site
généré par Jekyll/GitHub Pages.
