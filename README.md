# nutrinova

Application personnelle de suivi nutritionnel pour iPhone : journal des 4 repas, objectifs (calories et macros), calories dépensées (activité), scan des codes-barres, table Ciqual, recettes et suivi du poids.

C'est une application web installable (PWA), hébergée gratuitement sur GitHub Pages. Toutes les données personnelles restent sur l'iPhone. Elles ne sont jamais envoyées à GitHub. Seuls un code-barres ou un texte recherché sont envoyés à Open Food Facts.

Adresse de l'app : https://al38k.github.io/nutrinova/

## Installer sur l'iPhone

1. Ouvrez l'adresse ci-dessus dans **Safari**.
2. Touchez le bouton **Partager** (ou « … » puis Partager), puis **Sur l'écran d'accueil**.
3. Ouvrez toujours nutrinova depuis son icône. Sans installation, Safari peut effacer les données.
4. Au premier scan, autorisez l'accès à la caméra.

## Gestes et réglages utiles

- **Glisser vers la gauche** une recette (onglet Recettes), un ingrédient (modification d'une recette) ou une activité pour la supprimer. Un message « Annuler » permet de revenir en arrière pendant quelques secondes.
- **Activité** (carte en bas du Journal) : saisissez les calories dépensées indiquées par votre montre ou votre appareil. Elles s'ajoutent à l'objectif calorique du jour ; les objectifs de macros ne changent pas.
- **Carte des macros** : touchez « Fibres, sucres, sel, alcool » pour la déplier.
- **Apparence** (Réglages) : thème clair ou sombre, style Classique ou Verre, et couleur de l'app.

## Sauvegarder, restaurer, changer d'iPhone

- **Sauvegarder** : Réglages › Exporter mes données › Enregistrer dans Fichiers › iCloud Drive. Le fichier `nutrinova-sauvegarde-AAAA-MM-JJ.json` contient le journal, les aliments, les recettes, les objectifs, les pesées, les activités et les réglages.
- **Rappel** : une bannière s'affiche dans le Journal quand la dernière sauvegarde date de 7 jours ou plus. Sa croix la masque jusqu'au lendemain. Vous pouvez changer cette fréquence ou couper le rappel dans Réglages › Rappel de sauvegarde.
- **Restaurer ou changer d'iPhone** : installez l'app sur le nouvel iPhone, puis Réglages › Importer une sauvegarde › choisissez le fichier › Tout remplacer.
- **Attention** : supprimer l'icône de l'écran d'accueil efface les données de l'iPhone. Exportez-les avant.

## Mettre à jour l'app

1. Modifiez les fichiers dans le dépôt GitHub (branche `main`). GitHub Pages publie la nouvelle version en 1 à 2 minutes.
2. **Règle obligatoire** : à chaque livraison, augmentez la version au même endroit dans deux fichiers :
   - `APP_VERSION` dans `js/config.js` ;
   - `VERSION` dans `sw.js`.
3. Tout nouveau fichier de l'app doit être ajouté à la liste `APP_FILES` de `sw.js`. Sinon, il ne sera pas disponible hors ligne.
4. Sur l'iPhone, rouvrez l'app puis touchez **Mettre à jour** quand le message apparaît.
5. Vérifiez dans Réglages › À propos que les deux versions sont identiques. Lancez ensuite **l'autotest**, qui doit être réussi à 100 %.

Ne modifiez jamais une migration déjà livrée dans `js/data/schema.js`. Toute évolution de la base passe par une nouvelle version du schéma.

## Organisation des fichiers

| Dossier | Contenu |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | Page, installation sur l'écran d'accueil, mode hors ligne |
| `css/` | Design system (couleurs, typographie, composants, écrans) |
| `js/data/` | Base locale IndexedDB, modèle, calculs, sources (Ciqual, Open Food Facts), sauvegarde, autotest |
| `js/views/` | Écrans (Journal, Aliments, Recettes, Poids, Réglages…) |
| `js/sheets/`, `js/components/` | Feuilles de saisie et éléments d'interface partagés |
| `js/scanner/`, `vendor/` | Lecture des codes-barres (ZXing en WebAssembly) |
| `data/ciqual.json`, `tools/build-ciqual.py` | Table Ciqual embarquée et script qui la génère |

## Règles de calcul

- Les valeurs sont stockées pour 100 g ou 100 ml. Les quantités consommées valent : valeur ÷ 100 × quantité.
- Une valeur inconnue reste vide. Elle n'est jamais remplacée par 0 ni inventée, et les totaux concernés sont signalés partiels.
- Un écart de plus de 10 % entre les calories et 4 × P + 4 × G + 9 × L (+ 7 × alcool) est signalé, jamais corrigé.
- Les arrondis ne se font qu'à l'affichage.

## Sources et licences

- Table de composition nutritionnelle Ciqual, ANSES (licence ouverte Etalab).
- Open Food Facts, licence ODbL (données des contributeurs d'Open Food Facts).
- Lecture des codes-barres : ZXing (Apache 2.0), zxing-wasm et barcode-detector (MIT). Voir `vendor/barcode-detector/LICENSES.txt`.
