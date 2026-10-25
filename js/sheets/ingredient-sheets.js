// Feuilles de l'éditeur de recette : choix d'un ingrédient (recherche, scan, favoris, création)
// et saisie de sa quantité. Rien n'est enregistré ici : l'éditeur garde la recette en cours
// jusqu'à « Enregistrer ».

import { h, openSheet, fieldControl, segmented, banner, toast, iconEl } from '../ui.js';
import { parseDecimal, formatNumber, formatKcal, formatGrams, isNum } from '../util/format.js';
import { scaleNutrients, hasNoCoreData, checkEnergyCoherence } from '../data/nutrients.js';
import { LIMITS } from '../data/model.js';
import { listFoods, favoritesOf, recentsOf, getFood } from '../data/foods.js';
import { ensureCiqual } from '../data/ciqual.js';
import { ingredientFromFood } from '../data/recipes.js';
import { createFoodSearch, foodRow, localSub, group } from '../components/food-search.js';
import { formatQty } from '../components/journal-parts.js';
import { startScan, resolveOffHit } from './scan-flow.js';
import { openFoodForm } from './food-form.js';
import { sourceLabel } from './entry-sheet.js';

const MAX_RECENTS = 20;

/** Nombre → texte saisissable au clavier français (virgule, 2 décimales max). */
function toInputText(n) {
  if (!isNum(n)) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * Choix d'un ingrédient. excludeFoodId : aliment de la recette elle-même (une recette ne peut pas
 * se contenir). onPick(food) reçoit l'aliment choisi (enregistré, ou résultat Ciqual non enregistré).
 */
export async function openIngredientPicker({ excludeFoodId = null, onPick }) {
  let foods;
  try {
    foods = (await listFoods()).filter((f) => f.id !== excludeFoodId);
  } catch (err) {
    toast(`Liste des aliments indisponible : ${err.message}`);
    return;
  }
  ensureCiqual().catch(() => { /* l'état d'erreur est affiché dans la recherche */ });

  let search = null;
  openSheet({
    title: 'Ajouter un ingrédient',
    closeLabel: 'Annuler',
    onClose: () => { if (search) search.destroy(); },
    content: (close) => {
      const pick = (food) => {
        close();
        onPick(food);
      };

      const open = async (kind, item) => {
        if (kind === 'off') {
          const res = await resolveOffHit(item);
          if (res) pick(res.food);
          return;
        }
        pick(item);
      };

      const localRow = (food) => foodRow({
        title: food.name,
        badge: food.favorite ? iconEl('starFill', 'row-star') : null,
        sub: localSub(food),
        onMain: () => pick(food)
      });

      const renderEmpty = (container) => {
        const favs = favoritesOf(foods);
        const recents = recentsOf(foods, MAX_RECENTS).filter((f) => !f.favorite);
        const parts = [];
        if (favs.length) parts.push(group('Favoris', favs.map(localRow)));
        if (recents.length) parts.push(group('Récents', recents.map(localRow)));
        parts.push(h('p', { class: 'hint' }, 'Cherchez un ingrédient (ex. « riz cru », « huile d\'olive »), scannez un produit emballé ou créez votre propre aliment. Choisissez de préférence l\'aliment cru si vous pesez le plat cuit.'));
        container.append(...parts);
      };

      search = createFoodSearch({ getFoods: () => foods, side: () => null, open, renderEmpty, placeholder: 'Ingrédient, marque…' });

      const actions = h('div', { class: 'action-row' },
        h('button', {
          type: 'button',
          class: 'btn btn-primary',
          onclick: () => {
            close();
            startScan({ mode: 'pick', onPick });
          }
        }, iconEl('barcode'), 'Scanner'),
        h('button', {
          type: 'button',
          class: 'btn btn-tinted',
          onclick: () => {
            const name = search.input.value.trim();
            close();
            openFoodForm({ initialName: name, onSaved: (food) => onPick(food) });
          }
        }, iconEl('plus'), 'Créer un aliment')
      );

      search.render();
      return h('div', { class: 'stack' }, search.bar, actions, search.results);
    }
  });
}

/** Avertissement sur les valeurs d'un ingrédient (jamais corrigées automatiquement). */
function ingredientWarning(per100, basis, onFix) {
  const fixBtn = onFix ? h('button', { type: 'button', class: 'btn btn-tinted', onclick: onFix }, iconEl('edit'), 'Compléter les valeurs') : null;
  if (!per100 || hasNoCoreData(per100)) {
    return banner({
      kind: 'warning',
      title: 'Valeurs nutritionnelles inconnues',
      text: 'La recette affichera « — » pour l\'énergie et les macros tant que cet aliment n\'est pas complété.',
      actions: fixBtn
    });
  }
  const names = { kcal: 'énergie', protein: 'protéines', carbs: 'glucides', fat: 'lipides' };
  const missing = Object.keys(names).filter((k) => !isNum(per100[k]));
  if (missing.length) {
    return banner({
      kind: 'warning',
      title: `${missing.length > 1 ? 'Valeurs manquantes' : 'Valeur manquante'} : ${missing.map((k) => names[k]).join(', ')}`,
      text: 'La recette affichera « — » pour ces nutriments tant que cet aliment n\'est pas complété.',
      actions: fixBtn
    });
  }
  const c = checkEnergyCoherence(per100);
  if (c.status === 'mismatch') {
    return banner({
      kind: 'warning',
      title: 'Écart de calories supérieur à 10 %',
      text: `Calories indiquées : ${formatKcal(c.declared)} pour 100 ${basis}. Calcul à partir des macros : ${formatKcal(c.computed)}. La valeur indiquée est conservée.`,
      actions: onFix ? h('button', { type: 'button', class: 'btn btn-tinted', onclick: onFix }, iconEl('edit'), 'Corriger les valeurs') : null
    });
  }
  return null;
}

/**
 * Quantité d'un ingrédient.
 * - Ajout : { food, onSave } ; initialInput { inputUnit, inputValue } facultatif (quantité déjà saisie).
 * - Modification : { ingredient, onSave, onRemove } ; avec food en plus, l'ingrédient prend les valeurs
 *   de cet aliment (après « Compléter les valeurs »), en gardant la quantité saisie.
 * onSave(ingrédient) reçoit la forme de saisie complète.
 */
export function openIngredientSheet({ food = null, ingredient = null, initialInput = null, onSave, onRemove = null }) {
  const editing = Boolean(ingredient);
  const ctx = food
    ? {
        name: food.brand ? `${food.name} — ${food.brand}` : food.name,
        sourceLabel: sourceLabel(food),
        basis: food.basis || 'g',
        per100: food.per100,
        servingSize: isNum(food.servingSize) && food.servingSize > 0 ? food.servingSize : null,
        servingLabel: food.servingLabel ? `Portion (${food.servingLabel.replace(/\s*\(.*\)\s*$/, '')})` : 'Portion',
        sourceType: food.source
      }
    : {
        name: ingredient.name || 'Ingrédient',
        sourceLabel: ingredient.foodMissing ? 'Aliment supprimé de vos aliments : valeurs gardées dans la recette' : null,
        basis: ingredient.basis,
        per100: ingredient.per100,
        servingSize: ingredient.servingSize,
        servingLabel: ingredient.servingLabel ? `Portion (${ingredient.servingLabel.replace(/\s*\(.*\)\s*$/, '')})` : 'Portion',
        sourceType: ingredient.sourceType
      };

  let initial;
  if (editing) initial = { inputUnit: ingredient.inputUnit, inputValue: ingredient.inputValue };
  else if (initialInput) initial = { inputUnit: initialInput.inputUnit, inputValue: initialInput.inputValue };
  else if (ctx.servingSize) initial = { inputUnit: 'portion', inputValue: 1 };
  else initial = { inputUnit: ctx.basis, inputValue: 100 };
  // Une portion n'est utilisable que si sa taille est connue.
  if (initial.inputUnit === 'portion' && !ctx.servingSize) initial = { inputUnit: ctx.basis, inputValue: ingredient ? ingredient.quantity : 100 };
  if (initial.inputUnit !== 'portion' && initial.inputUnit !== ctx.basis) initial = { inputUnit: ctx.basis, inputValue: initial.inputValue };

  const state = { unit: initial.inputUnit };
  const unitWord = ctx.basis === 'ml' ? 'ml' : 'g';
  const suffixFor = (unit) => (unit === 'portion' ? 'portion(s)' : unitWord);
  const preview = h('div', { class: 'entry-preview', 'aria-live': 'polite' });

  const qty = fieldControl({
    label: 'Quantité dans la recette',
    id: 'ingredient-qty',
    value: toInputText(initial.inputValue),
    inputmode: 'decimal',
    suffix: suffixFor(state.unit),
    autofocus: true,
    onInput: () => update()
  });

  function currentQuantity() {
    const v = parseDecimal(qty.input.value);
    if (v === null || Number.isNaN(v) || v <= 0) return { v, quantity: NaN };
    const quantity = state.unit === 'portion' ? (ctx.servingSize ? v * ctx.servingSize : NaN) : v;
    return { v, quantity };
  }

  function update() {
    const { v, quantity } = currentQuantity();
    qty.setError(Number.isNaN(v) ? 'Nombre invalide.' : null);
    const n = isNum(quantity) ? scaleNutrients(ctx.per100, quantity) : null;
    preview.replaceChildren(
      h('p', { class: 'entry-preview-kcal t-num' }, n ? formatKcal(n.kcal) : '—'),
      h('p', { class: 'hint' }, isNum(quantity) ? `pour ${formatQty(quantity, ctx.basis)}` : 'Saisissez une quantité'),
      h('div', { class: 'cluster' },
        h('span', { class: 'chip chip-protein' }, `P ${n ? formatGrams(n.protein) : '—'}`),
        h('span', { class: 'chip chip-carbs' }, `G ${n ? formatGrams(n.carbs) : '—'}`),
        h('span', { class: 'chip chip-fat' }, `L ${n ? formatGrams(n.fat) : '—'}`)
      )
    );
  }

  const unitControl = ctx.servingSize
    ? segmented({
        label: 'Unité',
        value: state.unit,
        options: [
          { value: ctx.basis, label: ctx.basis === 'ml' ? 'Millilitres' : 'Grammes' },
          { value: 'portion', label: ctx.servingLabel }
        ],
        onChange: (unit) => {
          if (unit === state.unit) return;
          const v = parseDecimal(qty.input.value);
          if (isNum(v) && v > 0) qty.input.value = toInputText(unit === 'portion' ? v / ctx.servingSize : v * ctx.servingSize);
          state.unit = unit;
          qty.setSuffix(suffixFor(unit));
          update();
        }
      })
    : null;

  openSheet({
    title: editing ? 'Modifier l\'ingrédient' : 'Ajouter à la recette',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, editing ? 'Enregistrer' : 'Ajouter à la recette');

      function submit() {
        const { v, quantity } = currentQuantity();
        if (v === null || Number.isNaN(v) || v <= 0) {
          qty.setError('Saisissez une quantité positive.');
          return;
        }
        if (!isNum(quantity)) {
          qty.setError('Taille de portion inconnue : saisissez la quantité en grammes.');
          return;
        }
        if (quantity > LIMITS.quantityMax) {
          qty.setError(`Maximum ${formatNumber(LIMITS.quantityMax)} ${unitWord} par ingrédient.`);
          return;
        }
        const values = { quantity, inputUnit: state.unit, inputValue: v };
        const ing = food ? ingredientFromFood(food, values) : { ...ingredient, ...values };
        close();
        onSave(ing);
      }

      // « Compléter les valeurs » : modifie l'aliment (il devient un aliment personnel), puis revient ici.
      const canFix = ctx.sourceType !== 'recipe' && !(ingredient && ingredient.foodMissing && !food);
      const fix = !canFix ? null : async () => {
        let target = food;
        if (!target && ingredient) target = ingredient.food || await getFood(ingredient.foodId).catch(() => null);
        if (!target) {
          toast('Aliment introuvable : il a été supprimé de vos aliments.');
          return;
        }
        const { quantity, v } = currentQuantity();
        close();
        openFoodForm({
          food: target,
          onSaved: (saved) => {
            const keep = isNum(quantity)
              ? { quantity, inputUnit: state.unit, inputValue: v }
              : (ingredient ? { quantity: ingredient.quantity, inputUnit: ingredient.inputUnit, inputValue: ingredient.inputValue } : null);
            openIngredientSheet({
              food: saved,
              ingredient: editing ? { ...ingredient, ...(keep || {}) } : null,
              initialInput: editing ? null : keep,
              onSave,
              onRemove
            });
          }
        });
      };

      const removeBtn = editing && onRemove
        ? h('button', {
            type: 'button',
            class: 'btn btn-destructive btn-block',
            onclick: () => { close(); onRemove(); }
          }, iconEl('trash'), 'Retirer de la recette')
        : null;

      const form = h('form', {
        class: 'stack',
        novalidate: true,
        onsubmit: (e) => { e.preventDefault(); submit(); }
      },
        h('div', {},
          h('p', { class: 't-headline' }, ctx.name),
          h('p', { class: 'hint' }, [
            ctx.sourceLabel,
            ctx.per100 ? `Pour 100 ${ctx.basis} : ${formatKcal(ctx.per100.kcal)} · P ${formatGrams(ctx.per100.protein)} · G ${formatGrams(ctx.per100.carbs)} · L ${formatGrams(ctx.per100.fat)}` : 'Valeurs inconnues'
          ].filter(Boolean).join(' · '))
        ),
        ingredientWarning(ctx.per100, ctx.basis, fix),
        qty.root,
        unitControl,
        preview,
        ctx.basis === 'ml' ? h('p', { class: 'hint' }, 'Dans le poids de la recette, 1 ml compte pour 1 g.') : null,
        submitBtn,
        removeBtn
      );
      update();
      return form;
    }
  });
}
