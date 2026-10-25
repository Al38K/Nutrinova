// Recettes : calcul des valeurs (total, par portion, pour 100 g), enregistrement, suppression.
// Une recette enregistrée crée ou met à jour un aliment réutilisable (source « recipe »),
// lié à la recette par sourceRef = identifiant de la recette, dans la même transaction.
//
// Règles de calcul :
// - total = somme des ingrédients (valeur pour 100 × quantité / 100) ;
// - poids total cru = somme des quantités ; les ingrédients en ml sont comptés 1 ml = 1 g ;
// - poids final = poids cuit saisi, sinon poids cru ;
// - pour 100 g = total × 100 / poids final ; par portion = total / nombre de portions ;
// - un nutriment inconnu pour au moins un ingrédient reste inconnu (null) pour la recette :
//   la somme des seules valeurs connues serait fausse (trop basse), elle n'est jamais enregistrée.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createRecipe, createFood, LIMITS, ValidationError, newId } from './model.js';
import { NUTRIENT_KEYS, NUTRIENT_META, emptyNutrients, scaleNutrients, checkEnergyCoherence } from './nutrients.js';
import { isNum } from '../util/format.js';
import { normalizeName } from '../util/text.js';

// Poids final hors de cet intervalle par rapport au poids cru : avertissement (non bloquant).
export const COOKED_RATIO_MIN = 0.25;
export const COOKED_RATIO_MAX = 4;

const NUTRIENT_NAMES = { kcal: 'kcal', protein: 'protéines', carbs: 'glucides', fat: 'lipides', fiber: 'fibres', sugars: 'sucres', salt: 'sel', alcohol: 'alcool' };

// Nutriments principaux : leur absence est signalée en priorité.
export const CORE_KEYS = Object.freeze(['kcal', 'protein', 'carbs', 'fat']);

function sortByName(a, b) {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

/** Nom affiché d'un aliment dans une recette : « Nom — Marque ». */
export function foodDisplayName(food) {
  return food.brand ? `${food.name} — ${food.brand}` : food.name;
}

/** Valeurs apportées par un ingrédient (null conservés). */
export function ingredientNutrients(ing) {
  return scaleNutrients(ing.per100, ing.quantity);
}

/**
 * Calcule une recette (enregistrée ou en cours de saisie) : { ingredients, servings, cookedWeight }.
 * Renvoie :
 * - rawWeight : poids cru (g, ml comptés 1 ml = 1 g) ; finalWeight ; usesCookedWeight ; hasMl ;
 * - total, perServing, per100 : valeurs (null si inconnues) ; servingWeight : poids d'une portion ;
 * - missing[k] : indices des ingrédients sans valeur pour k ;
 * - errors : problèmes bloquants (poids final trop faible) ; warnings : remarques non bloquantes.
 */
export function computeRecipe({ ingredients = [], servings = 1, cookedWeight = null } = {}) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  let rawWeight = 0;
  let hasMl = false;
  for (const ing of list) {
    if (isNum(ing.quantity) && ing.quantity > 0) rawWeight += ing.quantity;
    if (ing.basis === 'ml') hasMl = true;
  }

  const total = emptyNutrients();
  const missing = {};
  for (const k of NUTRIENT_KEYS) {
    missing[k] = [];
    let sum = 0;
    list.forEach((ing, i) => {
      const v = ing.per100 ? ing.per100[k] : null;
      if (isNum(v) && isNum(ing.quantity)) sum += (v * ing.quantity) / 100;
      else missing[k].push(i);
    });
    total[k] = list.length && !missing[k].length ? sum : null;
  }

  const usesCookedWeight = isNum(cookedWeight) && cookedWeight > 0;
  const finalWeight = usesCookedWeight ? cookedWeight : (rawWeight > 0 ? rawWeight : null);
  const portions = Number.isInteger(servings) && servings >= 1 ? servings : null;

  const perServing = emptyNutrients();
  const per100 = emptyNutrients();
  for (const k of NUTRIENT_KEYS) {
    if (!isNum(total[k])) continue;
    if (portions) perServing[k] = total[k] / portions;
    if (finalWeight) {
      let v = (total[k] * 100) / finalWeight;
      // Écart d'arrondi des calculs en virgule flottante (ex. 100,000000001 g pour 100 g) : ramené au maximum.
      const max = NUTRIENT_META[k].max;
      if (v > max && v <= max * (1 + 1e-9)) v = max;
      per100[k] = v;
    }
  }
  const servingWeight = finalWeight && portions ? finalWeight / portions : null;

  const errors = [];
  const warnings = [];
  if (usesCookedWeight && list.length) {
    const over = NUTRIENT_KEYS.filter((k) => isNum(per100[k]) && per100[k] > NUTRIENT_META[k].max);
    if (over.length) {
      const k = over[0];
      const amount = k === 'kcal' ? `${Math.round(per100[k])} kcal` : `${Math.round(per100[k])} g de ${NUTRIENT_NAMES[k]}`;
      errors.push({
        code: 'cooked-too-low',
        message: `Poids final trop faible : la recette contiendrait ${amount} pour 100 g, ce qui est impossible. Vérifiez le poids cuit.`
      });
    } else {
      const mass = ['protein', 'carbs', 'fat', 'fiber', 'alcohol'].reduce((s, k) => s + (isNum(per100[k]) ? per100[k] : 0), 0);
      if (mass > 101) {
        errors.push({
          code: 'cooked-too-low',
          message: `Poids final trop faible : protéines, glucides, lipides et fibres dépasseraient ${Math.round(mass)} g pour 100 g, ce qui est impossible. Vérifiez le poids cuit.`
        });
      }
    }
    if (rawWeight > 0) {
      const ratio = cookedWeight / rawWeight;
      if (ratio < COOKED_RATIO_MIN || ratio > COOKED_RATIO_MAX) {
        warnings.push({
          code: 'cooked-ratio',
          ratio,
          message: `Le poids final (${Math.round(cookedWeight)} g) représente ${ratio < 1 ? `${Math.round(ratio * 100)} %` : `${Math.round(ratio * 10) / 10} fois`} le poids des ingrédients (${Math.round(rawWeight)} g). Vérifiez la pesée : c'est inhabituel, mais possible.`
        });
      }
    }
  }
  const coherence = checkEnergyCoherence(per100);
  if (coherence.status === 'mismatch') {
    warnings.push({ code: 'energy', coherence, message: 'Les calories de la recette s\'écartent de plus de 10 % du calcul à partir des macros : au moins un ingrédient a des valeurs incohérentes.' });
  }

  return {
    rawWeight,
    finalWeight,
    usesCookedWeight,
    hasMl,
    servings: portions,
    total,
    perServing,
    per100,
    servingWeight,
    missing,
    errors,
    warnings
  };
}

/** Aliment réutilisable correspondant à une recette (valeurs pour 100 g, portion = poids final / portions). */
export function recipeToFood(recipe, calc, existing = null) {
  const servingSize = isNum(calc.servingWeight) && calc.servingWeight > 0 && calc.servingWeight <= LIMITS.servingMax
    ? calc.servingWeight
    : null;
  return createFood({
    id: existing ? existing.id : (recipe.foodId || newId()),
    source: 'recipe',
    sourceRef: recipe.id,
    barcode: null,
    name: recipe.name,
    brand: null,
    basis: 'g',
    per100: calc.per100,
    servingSize,
    servingLabel: null,
    favorite: existing ? Boolean(existing.favorite) : false,
    useCount: existing && Number.isInteger(existing.useCount) ? existing.useCount : 0,
    lastUsedAt: existing ? existing.lastUsedAt || null : null,
    createdAt: existing ? existing.createdAt : recipe.createdAt
  });
}

/**
 * Ingrédient (forme de saisie) à partir d'un aliment.
 * food est gardé tant que l'aliment vient de Ciqual ou d'Open Food Facts : il sera ajouté à vos
 * aliments à l'enregistrement de la recette (une seule copie par source).
 */
export function ingredientFromFood(food, { quantity, inputUnit, inputValue }) {
  const external = food.source === 'ciqual' || food.source === 'off';
  return {
    foodId: food.id,
    food: external ? food : null,
    name: foodDisplayName(food),
    basis: food.basis || 'g',
    per100: food.per100,
    quantity,
    inputUnit,
    inputValue,
    servingSize: isNum(food.servingSize) && food.servingSize > 0 ? food.servingSize : null,
    servingLabel: food.servingLabel || null,
    sourceType: food.source
  };
}

/** Forme de saisie d'un ingrédient enregistré (taille de portion retrouvée à partir de la saisie). */
export function ingredientForEditing(ing) {
  return {
    ...ing,
    food: null,
    servingSize: ing.inputUnit === 'portion' && ing.inputValue > 0 ? ing.quantity / ing.inputValue : null,
    servingLabel: null,
    sourceType: null
  };
}

// ---------- Lecture ----------

export function getRecipe(id) {
  return db.get(STORES.recipes, id);
}

/** { recipe, food, calc } pour une recette, ou null si elle n'existe pas. */
export async function getRecipeBundle(id) {
  if (!id) return null;
  return db.run([STORES.recipes, STORES.foods], 'readonly', async (tx) => {
    const recipe = await db.req(tx.objectStore(STORES.recipes).get(id));
    if (!recipe) return null;
    const foods = tx.objectStore(STORES.foods);
    let food = recipe.foodId ? await db.req(foods.get(recipe.foodId)) : null;
    if (!food) food = await db.req(foods.index('source_ref').get(['recipe', recipe.id]));
    return { recipe, food: food || null, calc: computeRecipe(recipe) };
  });
}

/** Toutes les recettes, par nom, avec leur aliment et leur calcul. */
export async function listRecipes() {
  const { recipes, foods } = await db.run([STORES.recipes, STORES.foods], 'readonly', async (tx) => ({
    recipes: await db.req(tx.objectStore(STORES.recipes).getAll()),
    foods: await db.req(tx.objectStore(STORES.foods).index('source').getAll('recipe'))
  }));
  const byRef = new Map(foods.map((f) => [f.sourceRef, f]));
  return recipes
    .sort(sortByName)
    .map((recipe) => ({ recipe, food: byRef.get(recipe.id) || null, calc: computeRecipe(recipe) }));
}

/** Filtre par nom (chaque mot, sans accents). */
export function filterRecipes(bundles, query) {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (!words.length) return bundles;
  return bundles.filter((b) => {
    const text = normalizeName(b.recipe.name);
    return words.every((w) => text.includes(w));
  });
}

/**
 * Met à jour l'instantané des ingrédients à partir de vos aliments actuels (valeurs corrigées depuis).
 * Rien n'est enregistré : c'est l'enregistrement de la recette qui applique les nouvelles valeurs.
 * Renvoie { ingredients, updated, missing } : nombre d'ingrédients mis à jour, et dont l'aliment a été supprimé.
 */
export async function refreshIngredients(ingredients) {
  const ids = [...new Set(ingredients.map((i) => i.foodId))];
  const live = await db.run(STORES.foods, 'readonly', async (tx) => {
    const os = tx.objectStore(STORES.foods);
    const out = new Map();
    for (const id of ids) {
      const f = await db.req(os.get(id));
      if (f) out.set(id, f);
    }
    return out;
  });
  let updated = 0;
  let missing = 0;
  const next = ingredients.map((ing) => {
    const food = live.get(ing.foodId);
    if (!food) {
      missing += 1;
      return { ...ing, foodMissing: true };
    }
    const name = foodDisplayName(food);
    const basis = food.basis || 'g';
    const changed = name !== ing.name || basis !== ing.basis || JSON.stringify(food.per100) !== JSON.stringify(ing.per100);
    if (changed) updated += 1;
    const inputUnit = ing.inputUnit === 'portion' ? 'portion' : basis;
    return {
      ...ing,
      name,
      basis,
      per100: food.per100,
      inputUnit,
      sourceType: food.source,
      servingLabel: food.servingLabel || ing.servingLabel || null,
      foodMissing: false
    };
  });
  return { ingredients: next, updated, missing };
}

// ---------- Écriture ----------

function cleanIngredient(ing) {
  return {
    foodId: ing.foodId,
    name: ing.name,
    basis: ing.basis,
    per100: ing.per100,
    quantity: ing.quantity,
    inputUnit: ing.inputUnit,
    inputValue: ing.inputValue
  };
}

/**
 * Enregistre une recette (création ou modification) et son aliment réutilisable, en une transaction.
 * input : { id?, name, servings, cookedWeight, ingredients: [forme de saisie] }.
 * Les aliments Ciqual non encore enregistrés sont ajoutés à vos aliments au passage.
 * Lève une ValidationError si la saisie est invalide. Renvoie { recipe, food }.
 */
export async function saveRecipe(input) {
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (!ingredients.length) throw new ValidationError('ingredients', 'Ajoutez au moins un ingrédient.');
  // Validation complète avant la transaction (messages clairs en cas d'erreur de saisie).
  const draft = createRecipe({ ...input, id: input.id || 'nouvelle', ingredients: ingredients.map(cleanIngredient) });
  const preCalc = computeRecipe(draft);
  if (preCalc.errors.length) throw new ValidationError('cookedWeight', preCalc.errors[0].message);

  return db.run([STORES.recipes, STORES.foods], 'readwrite', async (tx) => {
    const foods = tx.objectStore(STORES.foods);
    const recipes = tx.objectStore(STORES.recipes);

    const resolved = [];
    for (const ing of ingredients) {
      let foodId = ing.foodId;
      const src = ing.food;
      if (src && (src.source === 'ciqual' || src.source === 'off')) {
        let current = await db.req(foods.get(src.id));
        if (!current && src.sourceRef) current = await db.req(foods.index('source_ref').get([src.source, String(src.sourceRef)]));
        if (current) {
          foodId = current.id;
        } else {
          const stored = createFood(src);
          foods.put(stored);
          foodId = stored.id;
        }
      }
      resolved.push({ ...cleanIngredient(ing), foodId });
    }

    const previous = input.id ? await db.req(recipes.get(input.id)) : null;
    const recipe = createRecipe({
      ...input,
      id: input.id || newId(),
      ingredients: resolved,
      foodId: previous ? previous.foodId : null,
      createdAt: previous ? previous.createdAt : undefined
    });

    let existing = recipe.foodId ? await db.req(foods.get(recipe.foodId)) : null;
    if (!existing) existing = await db.req(foods.index('source_ref').get(['recipe', recipe.id]));
    const calc = computeRecipe(recipe);
    const food = recipeToFood(recipe, calc, existing);
    if (recipe.ingredients.some((i) => i.foodId === food.id)) {
      throw new ValidationError('ingredients', 'Une recette ne peut pas être son propre ingrédient.');
    }
    recipe.foodId = food.id;
    recipes.put(recipe);
    foods.put(food);
    return { recipe, food };
  });
}

/**
 * Supprime une recette et son aliment. Les entrées du journal gardent leurs valeurs (instantanés) ;
 * les recettes qui l'utilisent comme ingrédient aussi. Renvoie { recipe, food } pour l'annulation.
 */
export function deleteRecipe(id) {
  return db.run([STORES.recipes, STORES.foods], 'readwrite', async (tx) => {
    const recipes = tx.objectStore(STORES.recipes);
    const foods = tx.objectStore(STORES.foods);
    const recipe = await db.req(recipes.get(id));
    if (!recipe) return null;
    let food = recipe.foodId ? await db.req(foods.get(recipe.foodId)) : null;
    if (!food) food = await db.req(foods.index('source_ref').get(['recipe', recipe.id]));
    recipes.delete(id);
    if (food) foods.delete(food.id);
    return { recipe, food: food || null };
  });
}

/** Annule une suppression. */
export function restoreRecipe({ recipe, food }) {
  return db.run([STORES.recipes, STORES.foods], 'readwrite', (tx) => {
    tx.objectStore(STORES.recipes).put(recipe);
    if (food) tx.objectStore(STORES.foods).put(food);
    return recipe;
  });
}
