// Éléments d'affichage partagés par le Journal, la vue Repas et la vue Jour.

import { h } from '../ui.js';
import { formatNumber, formatKcal, formatGrams, isNum } from '../util/format.js';
import { entryNutrients } from '../data/entries.js';

/** Quantité avec son unité : « 125 g », « 2,5 ml », « — ». */
export function formatQty(quantity, basis = 'g') {
  if (!isNum(quantity)) return '—';
  return `${formatNumber(quantity, Math.abs(quantity) < 10 ? 1 : 0)} ${basis}`;
}

/** Quantité saisie d'une entrée : « 125 g » ou « 2 portions (250 g) ». */
export function quantityLabel(entry) {
  if (entry.inputUnit === 'portion') {
    const n = entry.inputValue;
    return `${formatNumber(n, 2)} portion${n > 1 ? 's' : ''} (${formatQty(entry.quantity, entry.basis)})`;
  }
  return formatQty(entry.quantity, entry.basis);
}

/** « P 5,2 g · G 12 g · L 3,1 g » ; une valeur inconnue s'affiche « — ». */
export function macroLine(n) {
  return `P ${formatGrams(n.protein)} · G ${formatGrams(n.carbs)} · L ${formatGrams(n.fat)}`;
}

/** Ligne d'entrée du journal (bouton) : nom, quantité, macros, kcal. */
export function entryRow(entry, onClick) {
  const n = entryNutrients(entry);
  return h('button', {
    type: 'button',
    class: 'entry-row',
    onclick: () => onClick(entry)
  },
    h('span', { class: 'entry-main' },
      h('span', { class: 'entry-name' }, entry.nameSnapshot),
      h('span', { class: 'entry-sub' }, `${quantityLabel(entry)} · ${macroLine(n)}`)
    ),
    h('span', { class: 'entry-kcal t-num' }, formatKcal(n.kcal))
  );
}

/** Texte « X g restants » / « X g en trop » / « Pas d'objectif ». */
export function remainingCaption(value, goal, unit = 'g') {
  if (!isNum(goal)) return 'Pas d\'objectif';
  if (!isNum(value)) return '—';
  const r = Math.round(goal - value);
  return r >= 0
    ? `${formatNumber(r)} ${unit} restant${r > 1 ? 's' : ''}`
    : `${formatNumber(-r)} ${unit} en trop`;
}

/** Note de bas de carte quand un total est partiel. */
export function partialNote(missingCount, what = 'calories') {
  if (!missingCount) return null;
  return h('p', { class: 'hint partial-note' },
    `Total partiel : ${missingCount} aliment${missingCount > 1 ? 's' : ''} sans ${what} connues. Le total affiché est un minimum.`);
}
