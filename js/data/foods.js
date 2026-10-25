// Aliments locaux : liste pour la saisie rapide et création d'aliments personnalisés.
// (Scan, recherche Open Food Facts / Ciqual, modification et favoris : Phase 3.)

import * as db from './db.js';
import { STORES } from './schema.js';
import { createFood } from './model.js';
import { normalizeName } from '../util/text.js';

export function getFood(id) {
  return db.get(STORES.foods, id);
}

/** Ordre de la liste : favoris, puis les plus récemment utilisés, puis par nom. */
function compareFoods(a, b) {
  if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
  const la = a.lastUsedAt || '';
  const lb = b.lastUsedAt || '';
  if (la !== lb) return la < lb ? 1 : -1;
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

export async function listFoods() {
  const all = await db.getAll(STORES.foods);
  return all.sort(compareFoods);
}

/** Filtre local : chaque mot saisi doit apparaître dans le nom ou la marque (sans accents). */
export function filterFoods(foods, query) {
  const q = normalizeName(query);
  if (!q) return foods;
  const words = q.split(' ').filter(Boolean);
  return foods.filter((f) => words.every((w) => (f.nameNorm || '').includes(w)));
}

/** Crée un aliment personnalisé. Lève une ValidationError si la saisie est invalide. */
export async function saveCustomFood(input) {
  const food = createFood({ ...input, source: 'custom' });
  await db.put(STORES.foods, food);
  return food;
}
