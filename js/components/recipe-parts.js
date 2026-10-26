// Éléments d'affichage partagés par la fiche d'une recette et l'éditeur.

import { h, banner, iconEl } from '../ui.js';
import { formatNumber, formatKcal, isNum } from '../util/format.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { ingredientNutrients, CORE_KEYS } from '../data/recipes.js';
import { formatQty, macroLine } from './journal-parts.js';

const TABLE_KEYS = ['kcal', 'protein', 'carbs', 'sugars', 'fat', 'fiber', 'salt', 'alcohol'];
const SECONDARY_KEYS = ['fiber', 'sugars', 'salt'];
const NAMES = { kcal: 'énergie', protein: 'protéines', carbs: 'glucides', fat: 'lipides', fiber: 'fibres', sugars: 'sucres', salt: 'sel', alcohol: 'alcool' };

/** Nombre pour un tableau (unité dans l'en-tête de ligne) : kcal entier, g à 1 décimale sous 10, sel à 2 sous 1. */
function num(key, v) {
  if (!isNum(v)) return '—';
  if (key === 'kcal') return formatNumber(v, 0);
  if (key === 'salt' && Math.abs(v) < 1) return formatNumber(v, 2);
  return formatNumber(v, Math.abs(v) < 10 ? 1 : 0);
}

/** Tableau Total / Portion / 100 g. L'alcool n'apparaît que s'il est connu. */
export function recipeTable(calc) {
  const keys = TABLE_KEYS.filter((k) => k !== 'alcohol' || (isNum(calc.total.alcohol) && calc.total.alcohol > 0));
  return h('table', { class: 'ntable recipe-table' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, ''),
      h('th', { scope: 'col' }, 'Total'),
      h('th', { scope: 'col' }, 'Portion'),
      h('th', { scope: 'col' }, '100 g')
    )),
    h('tbody', {}, keys.map((k) => h('tr', {},
      h('th', { scope: 'row', class: k === 'sugars' ? 'ntable-sub' : '' }, k === 'kcal' ? 'Énergie (kcal)' : `${NUTRIENT_META[k].label} (g)`),
      h('td', {}, num(k, calc.total[k])),
      h('td', {}, num(k, calc.perServing[k])),
      h('td', {}, num(k, calc.per100[k]))
    )))
  );
}

/** « Ingrédients : 1 250 g · Final : 980 g (pesé cuit) · Portion : 245 g » */
export function weightsLine(calc) {
  const parts = [];
  parts.push(`Ingrédients : ${formatQty(calc.rawWeight, 'g')}`);
  if (calc.usesCookedWeight) parts.push(`Poids final pesé : ${formatQty(calc.finalWeight, 'g')}`);
  if (isNum(calc.servingWeight)) parts.push(`Portion : ${formatQty(calc.servingWeight, 'g')}`);
  return parts.join(' · ');
}

/** Ingrédients sans valeur pour au moins un nutriment principal : [{ index, name, keys }]. */
export function missingCore(ingredients, calc) {
  const byIndex = new Map();
  for (const k of CORE_KEYS) {
    for (const i of calc.missing[k]) {
      if (!byIndex.has(i)) byIndex.set(i, []);
      byIndex.get(i).push(k);
    }
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, keys]) => ({ index, name: ingredients[index] ? ingredients[index].name || 'Ingrédient sans nom' : '?', keys }));
}

/**
 * Bannières : poids final impossible (bloquant), valeurs inconnues, remarques non bloquantes.
 * context : 'edit' (éditeur) ou 'view' (fiche).
 */
export function recipeNotices(ingredients, calc, context = 'view') {
  const out = [];
  for (const e of calc.errors) out.push(banner({ kind: 'danger', title: 'Poids final impossible', text: e.message }));

  const core = missingCore(ingredients, calc);
  if (core.length) {
    const detail = core.map((m) => `« ${m.name} » : ${m.keys.map((k) => NAMES[k]).join(', ')}`).join(' ; ');
    out.push(banner({
      kind: 'warning',
      title: core.length > 1 ? `Valeurs inconnues pour ${core.length} ingrédients` : 'Valeur inconnue pour 1 ingrédient',
      text: `${detail}. La recette affiche « — » pour ces nutriments : un total partiel serait trop bas. ${context === 'edit'
        ? 'Touchez l\'ingrédient puis « Compléter les valeurs ».'
        : 'Modifiez la recette pour compléter les valeurs des ingrédients.'}`
    }));
  }
  // Fibres, sucres, sel : la pastille « … : inconnu » de chaque ingrédient indique lequel compléter.
  const secondary = SECONDARY_KEYS.filter((k) => calc.missing[k].length && ingredients.length);
  if (secondary.length) {
    const several = secondary.length > 1;
    out.push(banner({
      kind: 'info',
      title: `${secondary.map((k) => NAMES[k]).join(', ').replace(/^./, (c) => c.toUpperCase())} : « — » dans la recette`,
      text: `${several ? 'Ces valeurs manquent' : 'Cette valeur manque'} pour au moins un ingrédient (pastille « inconnu »). Une somme des seules valeurs connues serait trop basse. ${context === 'edit'
        ? 'Touchez l\'ingrédient, puis « Compléter les valeurs » : saisissez la valeur de l\'étiquette, même 0 g.'
        : 'Pour compléter : Modifier, touchez l\'ingrédient, puis « Compléter les valeurs ».'}`
    }));
  }
  for (const w of calc.warnings) {
    out.push(banner({ kind: 'warning', title: w.code === 'energy' ? 'Écart de calories supérieur à 10 %' : 'Poids final inhabituel', text: w.message }));
  }
  if (calc.hasMl) {
    out.push(h('p', { class: 'hint' }, 'Les ingrédients mesurés en ml sont comptés 1 ml = 1 g dans le poids de la recette.'));
  }
  return out;
}

/** Ligne d'ingrédient : nom, quantité, macros, kcal. onClick facultatif (éditeur). */
export function ingredientRow(ing, onClick = null) {
  const n = ingredientNutrients(ing);
  const incomplete = !ing.per100 || CORE_KEYS.some((k) => !isNum(ing.per100[k]));
  const unknownSecondary = ing.per100 ? SECONDARY_KEYS.filter((k) => !isNum(ing.per100[k])).map((k) => NAMES[k]) : [];
  const qty = ing.inputUnit === 'portion'
    ? `${formatNumber(ing.inputValue, 2)} portion${ing.inputValue > 1 ? 's' : ''} (${formatQty(ing.quantity, ing.basis)})`
    : formatQty(ing.quantity, ing.basis);
  const flags = [
    ing.foodMissing ? h('span', { class: 'chip chip-inline' }, 'aliment supprimé') : null,
    incomplete ? h('span', { class: 'chip chip-warning chip-inline' }, 'valeurs incomplètes') : null,
    !incomplete && unknownSecondary.length ? h('span', { class: 'chip chip-inline' }, `${unknownSecondary.join(', ')} : inconnu${unknownSecondary.length > 1 ? 's' : ''}`) : null
  ];
  const content = [
    h('span', { class: 'entry-main' },
      h('span', { class: 'entry-name' }, ing.name || 'Ingrédient sans nom'),
      h('span', { class: 'entry-sub' }, `${qty} · ${macroLine(n)}`, flags)
    ),
    h('span', { class: 'entry-kcal t-num' }, formatKcal(n.kcal)),
    onClick ? iconEl('chevronRight', 'row-chevron') : null
  ];
  return onClick
    ? h('button', { type: 'button', class: 'entry-row', onclick: onClick }, content)
    : h('div', { class: 'entry-row' }, content);
}
