// Fiche d'une recette : #/recipe/<id>
// Valeurs par portion, totales et pour 100 g, ingrédients, ajout au journal, favori, modification, suppression.

import { h, mount, setAppbar, backButton, iconEl, banner, toast, confirmDialog, emptyState } from '../ui.js';
import { formatNumber, formatGrams, isNum } from '../util/format.js';
import { localDateKey } from '../util/dates.js';
import { getRecipeBundle, deleteRecipe, restoreRecipe } from '../data/recipes.js';
import { setFavorite } from '../data/foods.js';
import { suggestMeal } from '../data/entries.js';
import { formatQty } from '../components/journal-parts.js';
import { energySplit } from '../components/energy-split.js';
import { recipeTable, weightsLine, recipeNotices, ingredientRow } from '../components/recipe-parts.js';
import { openEntrySheet } from '../sheets/entry-sheet.js';
import { clearDraft } from './recipe-edit.js';
import { refresh, currentRoute } from '../router.js';

export default {
  tab: 'recipes',
  async render(root, { params, navigate }) {
    const id = params[0];
    const back = backButton('#/recipes', 'Recettes');
    const bundle = id ? await getRecipeBundle(id) : null;
    if (!bundle) {
      setAppbar({ title: 'Recette', leading: back });
      mount(root, emptyState({
        iconName: 'recipes',
        title: 'Recette introuvable',
        text: 'Elle a peut-être été supprimée.',
        action: h('a', { class: 'btn btn-primary', href: '#/recipes' }, 'Voir les recettes')
      }));
      return;
    }
    const { recipe, food, calc } = bundle;
    const edit = () => navigate(`recipe-edit/${recipe.id}`);
    setAppbar({
      title: 'Recette',
      leading: back,
      trailing: h('button', { type: 'button', class: 'appbar-btn', onclick: edit }, 'Modifier')
    });

    // ---------- Favori ----------
    let favBtn = null;
    if (food) {
      favBtn = h('button', {
        type: 'button',
        class: `btn btn-plain btn-icon star-btn ${food.favorite ? 'is-fav' : ''}`,
        'aria-label': food.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
        'aria-pressed': String(Boolean(food.favorite)),
        onclick: async () => {
          favBtn.disabled = true;
          try {
            const saved = await setFavorite(food, !food.favorite);
            toast(saved.favorite ? 'Ajoutée aux favoris' : 'Retirée des favoris');
            refresh();
          } catch (err) {
            favBtn.disabled = false;
            toast(`Favori non enregistré : ${err.message}`);
          }
        }
      }, iconEl(food.favorite ? 'starFill' : 'star'));
    }

    // ---------- Suppression ----------
    const remove = async () => {
      const ok = await confirmDialog({
        title: 'Supprimer cette recette ?',
        text: 'Elle disparaît de vos recettes et de vos aliments. Les entrées déjà dans le journal ne changent pas.',
        confirmLabel: 'Supprimer',
        destructive: true
      });
      if (!ok) return;
      try {
        const removed = await deleteRecipe(recipe.id);
        clearDraft(recipe.id);
        navigate('recipes', { replace: true });
        toast('Recette supprimée', {
          action: {
            label: 'Annuler',
            onClick: async () => {
              try {
                if (removed) await restoreRecipe(removed);
                if (currentRoute() === 'recipes') refresh();
              } catch (err) {
                toast(`Annulation impossible : ${err.message}`);
              }
            }
          }
        });
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`);
      }
    };

    const addToJournal = () => {
      if (!food) return;
      openEntrySheet({ food, date: localDateKey(), meal: suggestMeal(), onDone: refresh });
    };

    const ps = calc.perServing;
    const chips = [
      h('span', { class: 'chip chip-brand' }, `${formatNumber(recipe.servings)} portion${recipe.servings > 1 ? 's' : ''}`),
      isNum(calc.servingWeight) ? h('span', { class: 'chip' }, `${formatQty(calc.servingWeight, 'g')} / portion`) : null,
      h('span', { class: 'chip' }, calc.usesCookedWeight ? 'Poids cuit pesé' : 'Poids cru'),
      food && food.lastUsedAt ? h('span', { class: 'chip' }, `Ajoutée ${formatNumber(food.useCount || 0)} fois`) : null
    ];

    mount(root,
      h('div', { class: 'entry-head' },
        h('div', { class: 'entry-head-main' },
          h('p', { class: 't-title-2' }, recipe.name),
          h('div', { class: 'cluster', style: { marginTop: '8px' } }, chips)
        ),
        favBtn
      ),
      !food ? banner({
        kind: 'warning',
        title: 'Aliment de la recette manquant',
        text: 'Touchez « Modifier » puis « Enregistrer » pour le recréer : la recette pourra de nouveau être ajoutée au journal.'
      }) : null,
      h('section', { class: 'card stack' },
        h('div', { class: 'big-stat' },
          h('span', { class: 'big-stat-num t-num' }, isNum(ps.kcal) ? formatNumber(ps.kcal) : '—'),
          h('span', { class: 'big-stat-unit' }, 'kcal / portion')
        ),
        h('div', { class: 'cluster' },
          h('span', { class: 'chip chip-protein' }, `P ${formatGrams(ps.protein)}`),
          h('span', { class: 'chip chip-carbs' }, `G ${formatGrams(ps.carbs)}`),
          h('span', { class: 'chip chip-fat' }, `L ${formatGrams(ps.fat)}`)
        ),
        energySplit(ps)
      ),
      h('button', {
        type: 'button',
        class: 'btn btn-primary btn-lg btn-block',
        disabled: !food || null,
        onclick: addToJournal
      }, iconEl('plus'), 'Ajouter au journal'),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Valeurs nutritionnelles'),
        recipeTable(calc),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, weightsLine(calc))
      ),
      recipeNotices(recipe.ingredients, calc, 'view'),
      h('section', {},
        h('h2', { class: 'section-header' }, `Ingrédients (${recipe.ingredients.length})`),
        h('div', { class: 'list' }, recipe.ingredients.map((ing) => ingredientRow(ing))),
        h('p', { class: 'section-footer' }, 'Valeurs des ingrédients enregistrées avec la recette. Corriger un aliment ne change la recette qu\'après « Modifier » puis « Enregistrer ».')
      ),
      h('button', { type: 'button', class: 'btn btn-tinted btn-block', onclick: edit }, iconEl('edit'), 'Modifier la recette'),
      h('button', { type: 'button', class: 'btn btn-destructive btn-block', onclick: remove }, iconEl('trash'), 'Supprimer la recette'),
      h('p', { class: 'hint' }, 'Ajoutée au journal, la recette garde les valeurs du moment : la modifier ensuite ne change pas les jours déjà saisis. Elle apparaît aussi dans la recherche d\'aliments et dans « Vos recettes » lors de l\'ajout à un repas.')
    );
  }
};
