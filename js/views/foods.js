// Onglet Aliments : recherche (vos aliments, Ciqual, Open Food Facts), scan, création,
// favoris, historique, aliments personnalisés. Toucher un aliment ouvre sa fiche.

import { h, mount, setAppbar, iconEl, segmented, emptyState, toast } from '../ui.js';
import { listFoods, favoritesOf, recentsOf, setFavorite, deleteFood, restoreFood } from '../data/foods.js';
import { deleteRecipe, restoreRecipe } from '../data/recipes.js';
import { swipeToDelete, deleteWithUndo } from '../components/swipe.js';
import { ensureCiqual } from '../data/ciqual.js';
import { createFoodSearch, foodRow, localSub, group } from '../components/food-search.js';
import { openFoodSheet } from '../sheets/food-sheet.js';
import { openFoodForm } from '../sheets/food-form.js';
import { startScan, resolveOffHit } from '../sheets/scan-flow.js';
import { sourceLabel } from '../sheets/entry-sheet.js';
import { refresh } from '../router.js';

// Recherche et filtre conservés pendant la session (retour sur l'onglet, mise à jour après une modification).
const memo = { query: '', segment: null };

const SEGMENTS = [
  { value: 'favorites', label: 'Favoris' },
  { value: 'recent', label: 'Récents' },
  { value: 'custom', label: 'Perso' },
  { value: 'all', label: 'Tous' }
];

const EMPTY = {
  favorites: { title: 'Aucun favori', text: 'Ouvrez un aliment et touchez « Ajouter aux favoris », ou l\'étoile dans la feuille d\'ajout. Les favoris s\'affichent en premier quand vous ajoutez un aliment.' },
  recent: { title: 'Aucun aliment récent', text: 'Les aliments ajoutés au journal apparaissent ici, du plus récent au plus ancien.' },
  custom: { title: 'Aucun aliment personnel', text: 'Créez un aliment avec les valeurs de son étiquette. Il passera avant les autres sources dans la recherche et au scan.' },
  all: { title: 'Aucun aliment enregistré', text: 'Scannez un produit, cherchez un aliment ou créez le vôtre.' }
};

function byName(a, b) {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

export default {
  tab: 'foods',
  async render(root) {
    const foods = await listFoods();
    ensureCiqual().catch(() => { /* l'état d'erreur est affiché dans la recherche */ });
    if (!memo.segment) {
      memo.segment = favoritesOf(foods).length ? 'favorites' : recentsOf(foods, 1).length ? 'recent' : 'all';
    }

    const create = (name = '') => openFoodForm({ initialName: name, onSaved: (food) => { refresh(); openFoodSheet({ food, onChange: refresh }); } });

    setAppbar({
      title: 'Aliments',
      trailing: h('button', { type: 'button', class: 'appbar-btn', 'aria-label': 'Créer un aliment', onclick: () => create(memo.query.trim()) }, iconEl('plus'))
    });

    let search = null;

    const starBtn = (food) => {
      const btn = h('button', {
        type: 'button',
        class: `btn btn-plain btn-icon pick-side star-btn ${food.favorite ? 'is-fav' : ''}`,
        'aria-label': food.favorite ? `Retirer ${food.name} des favoris` : `Ajouter ${food.name} aux favoris`,
        'aria-pressed': String(Boolean(food.favorite)),
        onclick: async () => {
          btn.disabled = true;
          try {
            const saved = await setFavorite(food, !food.favorite);
            const i = foods.findIndex((f) => f.id === saved.id);
            if (i >= 0) foods[i] = saved; else foods.push(saved);
            toast(saved.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
            search.render();
          } catch (err) {
            btn.disabled = false;
            toast(`Favori non enregistré : ${err.message}`);
          }
        }
      }, iconEl(food.favorite ? 'starFill' : 'star'));
      return btn;
    };

    const open = async (kind, item) => {
      if (kind === 'off') {
        const res = await resolveOffHit(item);
        if (res) {
          refresh();
          openFoodSheet({ food: res.food, onChange: refresh, info: res.info });
        }
        return;
      }
      openFoodSheet({ food: item, onChange: refresh });
    };

    const side = (kind, item) => (kind === 'off' ? null : starBtn(item));

    /**
     * Glisser vers la gauche : supprime l'aliment de vos aliments (avec « Annuler »).
     * Un aliment issu d'une recette supprime la recette avec lui (sinon la recette perdrait son aliment).
     * Les entrées déjà dans le journal ne changent pas.
     */
    const swipeFood = (el, food) => swipeToDelete(el, {
      label: food.name,
      onDelete: () => (food.source === 'recipe' && food.sourceRef
        ? deleteWithUndo({
            remove: () => deleteRecipe(food.sourceRef),
            restore: restoreRecipe,
            message: `Recette supprimée : ${food.name}`,
            onDone: refresh
          })
        : deleteWithUndo({
            remove: () => deleteFood(food.id),
            restore: restoreFood,
            message: `Aliment supprimé : ${food.name}`,
            onDone: refresh
          }))
    });

    const row = (food, withSource = false) => swipeFood(foodRow({
      title: food.name,
      sub: withSource ? [sourceLabel(food), localSub(food)].filter(Boolean).join(' · ') : localSub(food),
      onMain: () => open('local', food),
      side: starBtn(food)
    }), food);

    const renderEmpty = (container) => {
      let list;
      if (memo.segment === 'favorites') list = favoritesOf(foods);
      else if (memo.segment === 'recent') list = recentsOf(foods, 60);
      else if (memo.segment === 'custom') list = foods.filter((f) => f.source === 'custom').sort(byName);
      else list = [...foods].sort(byName);

      const seg = segmented({
        label: 'Afficher',
        value: memo.segment,
        options: SEGMENTS,
        onChange: (v) => { memo.segment = v; search.render(); }
      });
      seg.classList.add('segmented-sm');
      container.append(seg);
      if (!list.length) {
        const e = EMPTY[memo.segment];
        container.append(emptyState({ iconName: memo.segment === 'favorites' ? 'star' : 'foods', title: e.title, text: e.text }));
        return;
      }
      const title = { favorites: 'Favoris', recent: 'Historique', custom: 'Aliments personnels', all: 'Tous vos aliments' }[memo.segment];
      container.append(group(`${title} (${list.length})`, list.map((f) => row(f, memo.segment === 'all' || memo.segment === 'recent'))));
    };

    search = createFoodSearch({
      getFoods: () => foods,
      side,
      open,
      renderEmpty,
      initialQuery: memo.query,
      onQuery: (q) => { memo.query = q; },
      wrapLocal: swipeFood,
      placeholder: 'Rechercher : pomme, riz, yaourt…'
    });

    const actions = h('div', { class: 'action-row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => startScan({ mode: 'browse', onDone: refresh }) }, iconEl('barcode'), 'Scanner'),
      h('button', { type: 'button', class: 'btn btn-tinted', onclick: () => create(memo.query.trim()) }, iconEl('plus'), 'Créer un aliment')
    );

    mount(root,
      search.bar,
      actions,
      search.results,
      h('p', { class: 'hint' }, 'Glissez un de vos aliments vers la gauche pour le supprimer (le journal garde ses entrées). Sources : vos aliments (prioritaires), table Ciqual de l\'ANSES (Licence Ouverte), Open Food Facts (licence ODbL). Une valeur inconnue reste « — », jamais 0.')
    );
    search.render();
    return () => search.destroy();
  }
};
