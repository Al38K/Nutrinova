// Entrées du journal : lecture d'un jour, ajout, modification, suppression, totaux.
// Les valeurs nutritionnelles viennent de l'INSTANTANÉ enregistré dans l'entrée (per100Snapshot) :
// corriger un aliment plus tard ne modifie pas les jours passés.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createJournalEntry, createFood, MEAL_IDS } from './model.js';
import { scaleNutrients, sumNutrients, emptyNutrients, NUTRIENT_KEYS } from './nutrients.js';
import { isNum } from '../util/format.js';

const MEAL_ORDER = Object.freeze(Object.fromEntries(MEAL_IDS.map((id, i) => [id, i])));

function byMealThenTime(a, b) {
  const m = MEAL_ORDER[a.meal] - MEAL_ORDER[b.meal];
  if (m !== 0) return m;
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/** Entrées d'un jour ('AAAA-MM-JJ'), triées par repas puis par heure d'ajout. */
export async function getEntriesForDate(date) {
  const list = await db.getAllByIndex(STORES.journal, 'date', date);
  return list.sort(byMealThenTime);
}

/** Entrées entre deux dates incluses ('AAAA-MM-JJ'), toutes repas confondus. */
export function getEntriesBetween(from, to) {
  return db.getAllByIndex(STORES.journal, 'date', IDBKeyRange.bound(from, to));
}

export function getEntry(id) {
  return db.get(STORES.journal, id);
}

/** Nombre total d'entrées du journal (tous jours confondus). */
export function countEntries() {
  return db.count(STORES.journal);
}

/** Valeurs consommées pour une entrée (null conservés). */
export function entryNutrients(entry) {
  return scaleNutrients(entry.per100Snapshot, entry.quantity);
}

/**
 * Quantité résolue en g ou ml à partir de la saisie.
 * portion : valeur × taille de portion ; NaN si la portion est inconnue.
 */
export function resolveQuantity({ servingSize }, inputUnit, inputValue) {
  if (!isNum(inputValue)) return NaN;
  if (inputUnit === 'portion') return isNum(servingSize) ? inputValue * servingSize : NaN;
  return inputValue;
}

/**
 * Repas proposé selon l'heure (ajout depuis l'onglet Aliments) : avant 10 h 30 petit-déjeuner,
 * avant 14 h 30 déjeuner, avant 18 h snack, ensuite dîner. Modifiable dans la feuille de saisie.
 */
export function suggestMeal(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 630) return 'breakfast';
  if (minutes < 870) return 'lunch';
  if (minutes < 1080) return 'snack';
  return 'dinner';
}

/** Quantité proposée par défaut : 1 portion si l'aliment en a une, sinon 100 g ou 100 ml. */
export function defaultInput(food) {
  if (isNum(food.servingSize) && food.servingSize > 0) return { inputUnit: 'portion', inputValue: 1 };
  return { inputUnit: food.basis || 'g', inputValue: 100 };
}

/**
 * Ajoute une entrée et met à jour l'historique d'usage de l'aliment (compteur, dernière utilisation),
 * dans une seule transaction : tout est écrit, ou rien.
 * Un aliment pas encore enregistré (résultat Ciqual ou Open Food Facts) est enregistré au passage,
 * une seule fois par source et référence.
 */
export async function addEntry({ id, date, meal, food, quantity, inputUnit, inputValue }) {
  // Validation complète avant d'ouvrir la transaction (message clair en cas d'erreur de saisie).
  createJournalEntry({ id, date, meal, food, quantity, inputUnit, inputValue });
  return db.run([STORES.journal, STORES.foods], 'readwrite', async (tx) => {
    const foods = tx.objectStore(STORES.foods);
    let current = await db.req(foods.get(food.id));
    if (!current && food.source && food.source !== 'custom' && food.sourceRef) {
      current = await db.req(foods.index('source_ref').get([food.source, String(food.sourceRef)]));
    }
    const entry = createJournalEntry({
      id, date, meal, quantity, inputUnit, inputValue,
      food: { ...food, id: current ? current.id : food.id }
    });
    tx.objectStore(STORES.journal).put(entry);
    if (current) {
      foods.put({
        ...current,
        useCount: (Number.isInteger(current.useCount) ? current.useCount : 0) + 1,
        lastUsedAt: entry.createdAt
      });
    } else if (food.createdAt && food.nameNorm !== undefined) {
      foods.put(createFood({ ...food, useCount: 1, lastUsedAt: entry.createdAt }));
    }
    return entry;
  });
}

/**
 * Modifie une entrée (repas, quantité, unité de saisie). L'instantané nutritionnel est conservé tel quel.
 */
export async function updateEntry(entry, changes = {}) {
  const next = createJournalEntry({
    id: entry.id,
    date: changes.date ?? entry.date,
    meal: changes.meal ?? entry.meal,
    food: {
      id: entry.foodId,
      name: entry.nameSnapshot,
      brand: null,
      basis: entry.basis,
      per100: entry.per100Snapshot
    },
    quantity: changes.quantity ?? entry.quantity,
    inputUnit: changes.inputUnit ?? entry.inputUnit,
    inputValue: changes.inputValue ?? entry.inputValue,
    createdAt: entry.createdAt
  });
  await db.put(STORES.journal, next);
  return next;
}

/** Supprime une entrée et la renvoie (pour pouvoir annuler). */
export async function deleteEntry(id) {
  return db.run(STORES.journal, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.journal);
    const entry = await db.req(os.get(id));
    os.delete(id);
    return entry || null;
  });
}

/** Remet une entrée supprimée (annulation). */
export async function restoreEntry(entry) {
  await db.put(STORES.journal, entry);
  return entry;
}

function zeroNutrients() {
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = 0;
  return out;
}

/**
 * Totaux d'une liste d'entrées.
 * - aucune entrée : toutes les valeurs à 0 (rien n'a été mangé, ce n'est pas une donnée manquante) ;
 * - sinon : somme des valeurs connues ; incomplete = nutriments manquants dans au moins une entrée.
 * missing[k] = nombre d'entrées sans valeur pour le nutriment k.
 */
export function totalsOf(entries) {
  const missing = {};
  for (const k of NUTRIENT_KEYS) missing[k] = 0;
  if (!entries.length) {
    return { values: zeroNutrients(), incomplete: new Set(), missing, count: 0 };
  }
  const items = entries.map(entryNutrients);
  for (const n of items) {
    for (const k of NUTRIENT_KEYS) if (!isNum(n[k])) missing[k] += 1;
  }
  const { values, incomplete } = sumNutrients(items);
  return { values, incomplete, missing, count: entries.length };
}

/** Totaux du jour et de chaque repas. */
export function computeTotals(entries) {
  const meals = {};
  for (const id of MEAL_IDS) {
    const list = entries.filter((e) => e.meal === id);
    meals[id] = { entries: list, ...totalsOf(list) };
  }
  return { day: { entries, ...totalsOf(entries) }, meals };
}
