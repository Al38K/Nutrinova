// Vos aliments (table « foods ») : aliments personnalisés, produits Open Food Facts déjà consultés
// (cache local) et aliments Ciqual déjà utilisés. Lecture, recherche par code-barres,
// création, modification, favoris, suppression.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createFood } from './model.js';
import { canonicalBarcode } from './barcode.js';
import { normalizeName } from '../util/text.js';

export function getFood(id) {
  return db.get(STORES.foods, id);
}

/** Ordre par défaut : favoris, puis les plus récemment utilisés, puis par nom. */
export function compareFoods(a, b) {
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

/** Favoris, par nom. */
export function favoritesOf(foods) {
  return foods.filter((f) => f.favorite).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/** Historique : aliments déjà ajoutés au journal, du plus récent au plus ancien. */
export function recentsOf(foods, limit = 30) {
  return foods
    .filter((f) => f.lastUsedAt)
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0))
    .slice(0, limit);
}

/** Filtre simple (chaque mot dans le nom ou la marque, sans accents). */
export function filterFoods(foods, query) {
  const q = normalizeName(query);
  if (!q) return foods;
  const words = q.split(' ').filter(Boolean);
  return foods.filter((f) => words.every((w) => (f.nameNorm || '').includes(w)));
}

/**
 * Aliments enregistrés portant ce code-barres (forme canonique).
 * Ordre : aliments personnalisés d'abord, puis le plus récemment utilisé.
 */
export async function findFoodsByBarcode(code) {
  const canonical = canonicalBarcode(code);
  if (!canonical) return [];
  const list = await db.getAllByIndex(STORES.foods, 'barcode', canonical);
  return list.sort((a, b) => {
    const ca = a.source === 'custom' ? 0 : 1;
    const cb = b.source === 'custom' ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return compareFoods(a, b);
  });
}

/** Aliment déjà enregistré pour une source externe (ex. ['ciqual', '13039']), ou undefined. */
export function findBySource(source, sourceRef) {
  if (!source || !sourceRef) return Promise.resolve(undefined);
  return db.getFirstByIndex(STORES.foods, 'source_ref', [source, String(sourceRef)]);
}

/** Crée un aliment personnalisé. Lève une ValidationError si la saisie est invalide. */
export async function saveCustomFood(input) {
  const food = createFood({ ...input, source: 'custom', sourceRef: null, barcode: canonicalBarcode(input.barcode) });
  await db.put(STORES.foods, food);
  return food;
}

/**
 * Modifie un aliment (formulaire). Un aliment venant de Ciqual ou d'Open Food Facts devient
 * un aliment personnel : ses valeurs ne sont plus celles de la source. L'identifiant, les favoris
 * et l'historique sont conservés ; le journal n'est pas modifié (instantanés).
 */
export async function updateFood(existing, input) {
  const food = createFood({
    ...input,
    id: existing.id,
    source: 'custom',
    sourceRef: null,
    barcode: canonicalBarcode(input.barcode),
    favorite: existing.favorite,
    useCount: existing.useCount,
    lastUsedAt: existing.lastUsedAt,
    fetchedAt: null,
    createdAt: existing.createdAt
  });
  await db.put(STORES.foods, food);
  return food;
}

/**
 * Enregistre un aliment venant d'une source externe (Ciqual, Open Food Facts) s'il ne l'est pas déjà,
 * et applique des changements (ex. { favorite: true }). Une seule copie par source et référence.
 * Pour Open Food Facts, une fiche plus récente remplace les valeurs en cache.
 */
export async function upsertSourceFood(food, changes = {}) {
  return db.run(STORES.foods, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.foods);
    let current = await db.req(os.get(food.id));
    if (!current && food.source !== 'custom' && food.sourceRef) {
      current = await db.req(os.index('source_ref').get([food.source, String(food.sourceRef)]));
    }
    let next;
    if (current) {
      const refresh = food.source === 'off' && current.source === 'off' && food.fetchedAt && food.fetchedAt !== current.fetchedAt;
      next = createFood({
        ...(refresh ? { ...food } : current),
        id: current.id,
        favorite: current.favorite,
        useCount: current.useCount,
        lastUsedAt: current.lastUsedAt,
        createdAt: current.createdAt,
        ...changes
      });
    } else {
      next = createFood({ ...food, ...changes });
    }
    os.put(next);
    return next;
  });
}

/** Ajoute ou retire des favoris (enregistre l'aliment au besoin). Renvoie l'aliment à jour. */
export function setFavorite(food, favorite) {
  return upsertSourceFood(food, { favorite: Boolean(favorite) });
}

/** Supprime un aliment de vos aliments. Le journal garde ses entrées (instantanés). */
export function deleteFood(id) {
  return db.run(STORES.foods, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.foods);
    const food = await db.req(os.get(id));
    os.delete(id);
    return food || null;
  });
}

/** Remet un aliment supprimé (annulation). */
export async function restoreFood(food) {
  await db.put(STORES.foods, food);
  return food;
}

/** Vrai si l'aliment est déjà dans la base (et non un résultat de recherche non enregistré). */
export async function isStored(food) {
  if (!food || !food.id) return false;
  return Boolean(await db.get(STORES.foods, food.id));
}
