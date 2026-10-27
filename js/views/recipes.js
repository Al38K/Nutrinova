// Onglet Recettes : liste des recettes, recherche, création, ajout rapide d'une portion au journal.

import { h, mount, setAppbar, iconEl, emptyState, banner, toast } from '../ui.js';
import { formatKcal, formatNumber, isNum } from '../util/format.js';
import { localDateKey } from '../util/dates.js';
import { listRecipes, filterRecipes, deleteRecipe, restoreRecipe, CORE_KEYS } from '../data/recipes.js';
import { suggestMeal } from '../data/entries.js';
import { foodRow, group } from '../components/food-search.js';
import { quickAdd } from '../sheets/entry-sheet.js';
import { hasPendingDraft } from './recipe-edit.js';
import { swipeToDelete } from '../components/swipe.js';
import { refresh } from '../router.js';

// Recherche conservée pendant la session.
const memo = { query: '' };
const SEARCH_FROM = 6; // la barre de recherche apparaît à partir de 6 recettes

/**
 * Supprime une recette (et son aliment) avec « Annuler ». Les entrées du journal gardent leurs valeurs.
 */
async function removeRecipe(recipe) {
  let removed;
  try {
    removed = await deleteRecipe(recipe.id);
  } catch (err) {
    toast(`Suppression impossible : ${err.message}`);
    refresh();
    return;
  }
  refresh();
  toast(`Recette supprimée : ${recipe.name}`, {
    duration: 6000,
    action: {
      label: 'Annuler',
      onClick: async () => {
        try {
          if (removed) await restoreRecipe(removed);
          toast('Recette restaurée');
        } catch (err) {
          toast(`Annulation impossible : ${err.message}`);
        }
        refresh();
      }
    }
  });
}

function subtitle({ recipe, calc }) {
  const parts = [`${formatNumber(recipe.servings)} portion${recipe.servings > 1 ? 's' : ''}`];
  parts.push(isNum(calc.perServing.kcal) ? `${formatKcal(calc.perServing.kcal)} / portion` : 'kcal inconnues');
  if (CORE_KEYS.some((k) => calc.missing[k].length)) parts.push('valeurs incomplètes');
  return parts.join(' · ');
}

export default {
  tab: 'recipes',
  async render(root, { navigate }) {
    const create = () => navigate('recipe-edit/new');
    setAppbar({
      title: 'Recettes',
      trailing: h('button', { type: 'button', class: 'appbar-btn', 'aria-label': 'Créer une recette', onclick: create }, iconEl('plus'))
    });

    const bundles = await listRecipes();
    const draftBanner = hasPendingDraft('new')
      ? banner({
          kind: 'info',
          title: 'Nouvelle recette en cours',
          text: 'Elle n\'est pas encore enregistrée.',
          actions: h('button', { type: 'button', class: 'btn btn-tinted', onclick: create }, 'Reprendre')
        })
      : null;

    if (!bundles.length) {
      mount(root, draftBanner, emptyState({
        iconName: 'recipes',
        title: 'Aucune recette',
        text: 'Composez un plat à partir de ses ingrédients : nutrinova calcule les calories et les macros au total, par portion et pour 100 g. La recette devient un aliment à ajouter au journal en 2 tapotements.',
        action: h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, iconEl('plus'), 'Créer une recette')
      }));
      return;
    }

    const plusBtn = (b) => h('button', {
      type: 'button',
      class: 'btn btn-tinted btn-icon pick-side',
      'aria-label': `Ajouter 1 portion de ${b.recipe.name} au journal`,
      disabled: !b.food || null,
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        await quickAdd({ food: b.food, date: localDateKey(), meal: suggestMeal(), onDone: null });
        btn.disabled = false;
      }
    }, iconEl('plus'));

    const results = h('div', { class: 'search-results' });
    const paint = () => {
      const list = filterRecipes(bundles, memo.query);
      if (!list.length) {
        results.replaceChildren(h('p', { class: 'hint' }, `Aucune recette ne correspond à « ${memo.query.trim()} ».`));
        return;
      }
      results.replaceChildren(group(`Vos recettes (${list.length})`, list.map((b) => swipeToDelete(foodRow({
        title: b.recipe.name,
        badge: b.food && b.food.favorite ? iconEl('starFill', 'row-star') : null,
        sub: subtitle(b),
        onMain: () => navigate(`recipe/${b.recipe.id}`),
        side: plusBtn(b)
      }), { label: b.recipe.name, onDelete: () => removeRecipe(b.recipe) }))));
    };

    let searchbar = null;
    if (bundles.length >= SEARCH_FROM) {
      const input = h('input', {
        type: 'search',
        class: 'input',
        value: memo.query,
        placeholder: 'Rechercher une recette',
        'aria-label': 'Rechercher une recette',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
        oninput: (e) => { memo.query = e.target.value; clear.hidden = !memo.query; paint(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }
      });
      const clear = h('button', {
        type: 'button',
        class: 'searchbar-clear',
        'aria-label': 'Effacer la recherche',
        hidden: !memo.query,
        onclick: () => { input.value = ''; memo.query = ''; clear.hidden = true; paint(); input.focus(); }
      }, iconEl('close'));
      searchbar = h('label', { class: 'searchbar' }, iconEl('search', 'searchbar-icon'), input, clear);
    } else {
      memo.query = '';
    }

    mount(root,
      draftBanner,
      searchbar,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: create }, iconEl('plus'), 'Nouvelle recette'),
      results,
      h('p', { class: 'hint' }, '« + » ajoute 1 portion aujourd\'hui, au repas proposé selon l\'heure. Glissez une recette vers la gauche pour la supprimer : les entrées déjà dans le journal sont conservées.')
    );
    paint();
  }
};
