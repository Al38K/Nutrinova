// Modèle de données de nutrinova : constantes, fabriques et validation des enregistrements.
// Chaque fabrique renvoie un objet complet et valide, ou lève une ValidationError (message en français).

import { normalizeNutrients, NutrientError } from './nutrients.js';
import { isDateKey, nowIso } from '../util/dates.js';
import { normalizeName, cleanLabel } from '../util/text.js';
import { isNum } from '../util/format.js';

export const SOURCES = Object.freeze(['custom', 'off', 'ciqual', 'recipe']);
export const SOURCE_LABELS = Object.freeze({
  custom: 'Personnalisé',
  off: 'Open Food Facts',
  ciqual: 'Ciqual (ANSES)',
  recipe: 'Recette'
});
export const BASES = Object.freeze(['g', 'ml']);
export const INPUT_UNITS = Object.freeze(['g', 'ml', 'portion']);
export const GOAL_MODES = Object.freeze(['grams', 'percent']);

export const MEALS = Object.freeze([
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'lunch', label: 'Déjeuner' },
  { id: 'dinner', label: 'Dîner' },
  { id: 'snack', label: 'Snack' }
]);
export const MEAL_IDS = Object.freeze(MEALS.map((m) => m.id));
export const MEAL_LABELS = Object.freeze(Object.fromEntries(MEALS.map((m) => [m.id, m.label])));

export const LIMITS = Object.freeze({
  nameMax: 200,
  noteMax: 200,
  quantityMax: 10000,     // g ou ml pour une entrée de journal
  servingMax: 5000,       // g ou ml pour une portion
  kcalGoalMax: 10000,
  weightMinKg: 20,
  weightMaxKg: 500,
  servingsMax: 100,
  ingredientsMax: 60,
  cookedWeightMax: 100000, // g, poids final d'une recette
  activityKcalMax: 5000   // kcal dépensées pour une activité
});

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

// ---------- Utilitaires ----------

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function oneOf(field, value, allowed, label) {
  if (!allowed.includes(value)) throw new ValidationError(field, `${label} invalide : « ${value} ».`);
  return value;
}

function requiredText(field, value, label, max = LIMITS.nameMax) {
  const s = cleanLabel(value, max);
  if (!s) throw new ValidationError(field, `${label} obligatoire.`);
  return s;
}

function optionalText(value, max = LIMITS.nameMax) {
  const s = cleanLabel(value, max);
  return s || null;
}

function positiveOrNull(field, value, label, max) {
  if (value === null || value === undefined || value === '') return null;
  if (!isNum(value) || value <= 0) throw new ValidationError(field, `${label} : nombre positif attendu.`);
  if (max !== undefined && value > max) throw new ValidationError(field, `${label} : maximum ${max}.`);
  return value;
}

function requiredPositive(field, value, label, max) {
  const v = positiveOrNull(field, value, label, max);
  if (v === null) throw new ValidationError(field, `${label} obligatoire.`);
  return v;
}

function isoOrNull(field, value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(field, 'Horodatage invalide.');
  }
  return value;
}

function dateKey(field, value, label = 'Date') {
  if (!isDateKey(value)) throw new ValidationError(field, `${label} invalide (format attendu AAAA-MM-JJ).`);
  return value;
}

function nutrientsOrThrow(per100) {
  try {
    return normalizeNutrients(per100);
  } catch (err) {
    if (err instanceof NutrientError) throw new ValidationError(`per100.${err.key}`, err.message);
    throw err;
  }
}

/** Codes EAN-8, UPC-E, UPC-A, EAN-13, GTIN-14 : chiffres uniquement, 6 à 14. */
export function normalizeBarcode(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/\s/g, '');
  if (!/^\d{6,14}$/.test(s)) throw new ValidationError('barcode', 'Code-barres invalide : 6 à 14 chiffres attendus.');
  return s;
}

/** Texte de recherche : nom + marque, normalisés. */
export function searchText(name, brand) {
  return normalizeName([name, brand].filter(Boolean).join(' '));
}

// ---------- Aliments ----------

export function createFood(input = {}) {
  const now = nowIso();
  const name = requiredText('name', input.name, 'Nom de l\'aliment');
  const brand = optionalText(input.brand);
  const servingSize = positiveOrNull('servingSize', input.servingSize, 'Taille de portion', LIMITS.servingMax);
  const servingLabel = optionalText(input.servingLabel, 60);
  if (servingLabel && servingSize === null) {
    throw new ValidationError('servingSize', 'Une portion nommée doit avoir un poids ou un volume.');
  }
  const useCount = input.useCount ?? 0;
  if (!Number.isInteger(useCount) || useCount < 0) throw new ValidationError('useCount', 'Compteur d\'utilisation invalide.');
  return {
    id: input.id || newId(),
    source: oneOf('source', input.source ?? 'custom', SOURCES, 'Source'),
    sourceRef: input.sourceRef == null || input.sourceRef === '' ? null : String(input.sourceRef),
    barcode: normalizeBarcode(input.barcode),
    name,
    brand,
    nameNorm: searchText(name, brand),
    basis: oneOf('basis', input.basis ?? 'g', BASES, 'Unité de base'),
    per100: nutrientsOrThrow(input.per100),
    servingSize,
    servingLabel,
    favorite: Boolean(input.favorite),
    useCount,
    lastUsedAt: isoOrNull('lastUsedAt', input.lastUsedAt),
    fetchedAt: isoOrNull('fetchedAt', input.fetchedAt),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

/** Entrée de la table Ciqual (lecture seule, importée en Phase 3). */
export function createCiqualItem(input = {}) {
  const name = requiredText('name', input.name, 'Nom');
  return {
    code: requiredText('code', input.code, 'Code Ciqual', 20),
    name,
    nameNorm: normalizeName(name),
    group: optionalText(input.group),
    per100: nutrientsOrThrow(input.per100)
  };
}

// ---------- Recettes ----------

/**
 * Ingrédient d'une recette, avec un INSTANTANÉ de l'aliment (nom, unité de base, valeurs pour 100) :
 * la recette reste calculable même si l'aliment est supprimé plus tard.
 * quantity = quantité résolue en g ou ml ; inputUnit/inputValue = saisie d'origine (ex. 2 portions).
 * per100 null = valeurs inconnues (ancien format sans instantané).
 */
export function createIngredient(ing, i = 0) {
  const n = i + 1;
  const f = (k) => `ingredients.${i}.${k}`;
  if (!ing || typeof ing.foodId !== 'string' || !ing.foodId) {
    throw new ValidationError(f('foodId'), `Ingrédient ${n} : aliment manquant.`);
  }
  const basis = oneOf(f('basis'), ing.basis ?? 'g', BASES, `Ingrédient ${n} : unité`);
  const quantity = requiredPositive(f('quantity'), ing.quantity, `Ingrédient ${n} : quantité`, LIMITS.quantityMax);
  const inputUnit = oneOf(f('inputUnit'), ing.inputUnit ?? basis, INPUT_UNITS, `Ingrédient ${n} : unité de saisie`);
  if (inputUnit !== 'portion' && inputUnit !== basis) {
    throw new ValidationError(f('inputUnit'), `Ingrédient ${n} : cet aliment se mesure en ${basis}, pas en ${inputUnit}.`);
  }
  const inputValue = requiredPositive(f('inputValue'), ing.inputValue ?? quantity, `Ingrédient ${n} : valeur saisie`, LIMITS.quantityMax);
  let per100 = null;
  if (ing.per100 !== null && ing.per100 !== undefined) {
    try {
      per100 = normalizeNutrients(ing.per100);
    } catch (err) {
      if (err instanceof NutrientError) throw new ValidationError(f(`per100.${err.key}`), `Ingrédient ${n} : ${err.message}`);
      throw err;
    }
  }
  return {
    foodId: ing.foodId,
    name: optionalText(ing.name),
    basis,
    per100,
    quantity,
    inputUnit,
    inputValue
  };
}

export function createRecipe(input = {}) {
  const now = nowIso();
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (ingredients.length > LIMITS.ingredientsMax) {
    throw new ValidationError('ingredients', `${LIMITS.ingredientsMax} ingrédients au maximum par recette.`);
  }
  const cleanIngredients = ingredients.map((ing, i) => createIngredient(ing, i));
  const servings = input.servings ?? 1;
  if (!Number.isInteger(servings) || servings < 1 || servings > LIMITS.servingsMax) {
    throw new ValidationError('servings', `Nombre de portions : entier entre 1 et ${LIMITS.servingsMax}.`);
  }
  return {
    id: input.id || newId(),
    name: requiredText('name', input.name, 'Nom de la recette'),
    ingredients: cleanIngredients,
    servings,
    cookedWeight: positiveOrNull('cookedWeight', input.cookedWeight, 'Poids final', LIMITS.cookedWeightMax),
    foodId: input.foodId || null,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

// ---------- Journal ----------

/**
 * Crée une entrée de journal avec un INSTANTANÉ des valeurs nutritionnelles de l'aliment :
 * corriger l'aliment plus tard ne modifie pas les jours passés.
 * quantity = quantité résolue en g ou ml (unité de base de l'aliment).
 */
export function createJournalEntry(input = {}) {
  const now = nowIso();
  const food = input.food;
  if (!food || typeof food.id !== 'string') throw new ValidationError('foodId', 'Aliment manquant.');
  const basis = oneOf('basis', food.basis ?? 'g', BASES, 'Unité de base');
  const inputUnit = oneOf('inputUnit', input.inputUnit ?? basis, INPUT_UNITS, 'Unité de saisie');
  if (inputUnit !== 'portion' && inputUnit !== basis) {
    throw new ValidationError('inputUnit', `Cet aliment se mesure en ${basis}, pas en ${inputUnit}.`);
  }
  return {
    id: input.id || newId(),
    date: dateKey('date', input.date),
    meal: oneOf('meal', input.meal, MEAL_IDS, 'Repas'),
    foodId: food.id,
    nameSnapshot: requiredText('nameSnapshot', food.brand ? `${food.name} — ${food.brand}` : food.name, 'Nom'),
    per100Snapshot: nutrientsOrThrow(food.per100),
    basis,
    quantity: requiredPositive('quantity', input.quantity, 'Quantité', LIMITS.quantityMax),
    inputUnit,
    inputValue: requiredPositive('inputValue', input.inputValue ?? input.quantity, 'Valeur saisie', LIMITS.quantityMax),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

// ---------- Objectifs ----------

/**
 * Objectif versionné : il s'applique à partir de effectiveFrom, jusqu'au suivant.
 * mode 'grams' : protein/carbs/fat en g ; mode 'percent' : en % de l'énergie (somme = 100).
 * Les macros peuvent rester null (objectif calorique seul).
 */
export function createGoal(input = {}) {
  const mode = oneOf('mode', input.mode ?? 'grams', GOAL_MODES, 'Mode');
  const macroMax = mode === 'percent' ? 100 : 2000;
  const macro = (k, label) => {
    const v = input[k];
    if (v === null || v === undefined || v === '') return null;
    if (!isNum(v) || v < 0 || v > macroMax) throw new ValidationError(k, `${label} : valeur entre 0 et ${macroMax} attendue.`);
    return v;
  };
  const goal = {
    id: input.id || newId(),
    effectiveFrom: dateKey('effectiveFrom', input.effectiveFrom, 'Date d\'effet'),
    kcal: requiredPositive('kcal', input.kcal, 'Objectif calorique', LIMITS.kcalGoalMax),
    mode,
    protein: macro('protein', 'Protéines'),
    carbs: macro('carbs', 'Glucides'),
    fat: macro('fat', 'Lipides')
  };
  if (mode === 'percent') {
    const parts = [goal.protein, goal.carbs, goal.fat];
    if (parts.every(isNum)) {
      const total = parts.reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.5) {
        throw new ValidationError('percent', `La répartition doit totaliser 100 % (actuellement ${Math.round(total * 10) / 10} %).`);
      }
    } else if (parts.some(isNum)) {
      throw new ValidationError('percent', 'En pourcentage, renseignez les trois macros ou aucune.');
    }
  }
  return goal;
}

// ---------- Pesées ----------

/** Une pesée par jour : la clé est la date, une nouvelle saisie le même jour remplace l'ancienne. */
export function createWeight(input = {}) {
  return {
    date: dateKey('date', input.date),
    weightKg: assertWeightRange(requiredPositive('weightKg', input.weightKg, 'Poids')),
    note: optionalText(input.note, LIMITS.noteMax),
    createdAt: input.createdAt || nowIso()
  };
}

export function assertWeightRange(weightKg) {
  if (!isNum(weightKg) || weightKg < LIMITS.weightMinKg || weightKg > LIMITS.weightMaxKg) {
    throw new ValidationError('weightKg', `Poids : entre ${LIMITS.weightMinKg} et ${LIMITS.weightMaxKg} kg.`);
  }
  return weightKg;
}

// ---------- Activités (v1.6.0) ----------

/**
 * Calories dépensées saisies à la main (montre, appareil de sport…). Jamais estimées par l'app.
 * Elles s'ajoutent à l'objectif calorique du jour.
 */
export function createActivity(input = {}) {
  const now = nowIso();
  return {
    id: input.id || newId(),
    date: dateKey('date', input.date),
    name: cleanLabel(input.name, 80) || 'Activité',
    kcal: requiredPositive('kcal', input.kcal, 'Calories dépensées', LIMITS.activityKcalMax),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}
