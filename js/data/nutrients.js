// Nutriments : valeurs pour 100 g ou 100 ml, en grammes (kcal pour l'énergie).
// Convention du projet : une valeur inconnue vaut null — jamais 0, jamais inventée.

import { isNum } from '../util/format.js';

export const NUTRIENT_KEYS = Object.freeze(['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'salt', 'alcohol']);
export const MACRO_KEYS = Object.freeze(['protein', 'carbs', 'fat']);

export const NUTRIENT_META = Object.freeze({
  kcal: { label: 'Énergie', short: 'kcal', unit: 'kcal', max: 1000 },
  protein: { label: 'Protéines', short: 'Prot.', unit: 'g', max: 100 },
  carbs: { label: 'Glucides', short: 'Gluc.', unit: 'g', max: 100 },
  fat: { label: 'Lipides', short: 'Lip.', unit: 'g', max: 100 },
  fiber: { label: 'Fibres', short: 'Fibres', unit: 'g', max: 100 },
  sugars: { label: 'dont sucres', short: 'Sucres', unit: 'g', max: 100 },
  salt: { label: 'Sel', short: 'Sel', unit: 'g', max: 100 },
  alcohol: { label: 'Alcool', short: 'Alcool', unit: 'g', max: 100 }
});

// Coefficients d'Atwater utilisés par l'étiquetage UE (règlement 1169/2011, annexe XIV), en kcal/g.
export const ENERGY_FACTORS = Object.freeze({ protein: 4, carbs: 4, fat: 9, alcohol: 7, fiber: 2 });
export const ENERGY_TOLERANCE = 0.10;

export class NutrientError extends Error {
  constructor(key, message) {
    super(message);
    this.name = 'NutrientError';
    this.key = key;
  }
}

export function emptyNutrients() {
  const out = {};
  for (const k of NUTRIENT_KEYS) out[k] = null;
  return out;
}

/**
 * Valide et normalise un objet de nutriments pour 100 g/ml.
 * '' / null / undefined → null. Nombre négatif, non numérique ou au-delà du maximum physique → erreur.
 * Les clés inconnues sont ignorées.
 */
export function normalizeNutrients(input = {}) {
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) {
    const raw = input ? input[k] : undefined;
    if (raw === null || raw === undefined || raw === '') continue;
    const v = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(v)) throw new NutrientError(k, `${NUTRIENT_META[k].label} : valeur non numérique.`);
    if (v < 0) throw new NutrientError(k, `${NUTRIENT_META[k].label} : valeur négative impossible.`);
    if (v > NUTRIENT_META[k].max) {
      throw new NutrientError(k, `${NUTRIENT_META[k].label} : ${v} ${NUTRIENT_META[k].unit} pour 100 dépasse le maximum possible (${NUTRIENT_META[k].max}).`);
    }
    out[k] = v;
  }
  return out;
}

/** Valeurs consommées = valeur pour 100 × quantité / 100. Les null restent null. */
export function scaleNutrients(per100, quantity) {
  const out = emptyNutrients();
  if (!isNum(quantity) || quantity < 0) return out;
  for (const k of NUTRIENT_KEYS) {
    const v = per100 ? per100[k] : null;
    out[k] = isNum(v) ? (v * quantity) / 100 : null;
  }
  return out;
}

/**
 * Somme d'une liste de nutriments.
 * - values[k] : somme des valeurs connues ; null si aucune valeur connue.
 * - incomplete : clés pour lesquelles au moins un élément est inconnu (le total est alors un minimum).
 */
export function sumNutrients(list) {
  const values = emptyNutrients();
  const incomplete = new Set();
  for (const item of list || []) {
    for (const k of NUTRIENT_KEYS) {
      const v = item ? item[k] : null;
      if (isNum(v)) values[k] = (values[k] ?? 0) + v;
      else incomplete.add(k);
    }
  }
  return { values, incomplete };
}

/**
 * Énergie recalculée à partir des macros. null si protéines, glucides ou lipides inconnus.
 * Alcool et fibres comptés seulement s'ils sont connus.
 */
export function energyFromMacros(n) {
  if (!n || !isNum(n.protein) || !isNum(n.carbs) || !isNum(n.fat)) return null;
  let kcal = n.protein * ENERGY_FACTORS.protein + n.carbs * ENERGY_FACTORS.carbs + n.fat * ENERGY_FACTORS.fat;
  if (isNum(n.alcohol)) kcal += n.alcohol * ENERGY_FACTORS.alcohol;
  if (isNum(n.fiber)) kcal += n.fiber * ENERGY_FACTORS.fiber;
  return kcal;
}

/**
 * Contrôle de cohérence kcal déclarées vs kcal recalculées. Ne corrige rien : signale seulement.
 * status : 'ok' | 'mismatch' (écart > 10 %) | 'unknown' (données insuffisantes)
 */
export function checkEnergyCoherence(n, tolerance = ENERGY_TOLERANCE) {
  const declared = n ? n.kcal : null;
  const computed = energyFromMacros(n);
  if (!isNum(declared) || computed === null) {
    return { status: 'unknown', declared: isNum(declared) ? declared : null, computed, deviation: null };
  }
  if (declared === 0) {
    const status = computed === 0 ? 'ok' : 'mismatch';
    return { status, declared, computed, deviation: computed === 0 ? 0 : Infinity };
  }
  const deviation = Math.abs(computed - declared) / declared;
  return { status: deviation > tolerance ? 'mismatch' : 'ok', declared, computed, deviation };
}

/** Vrai si aucune des 4 valeurs principales n'est connue. */
export function hasNoCoreData(n) {
  return !n || ['kcal', ...MACRO_KEYS].every((k) => !isNum(n[k]));
}
