// Objectifs journaliers versionnés : un objectif s'applique à partir de sa date d'effet,
// jusqu'au suivant. Changer d'objectif ne réécrit donc pas l'historique.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createGoal } from './model.js';
import { ENERGY_FACTORS, MACRO_KEYS, ENERGY_TOLERANCE } from './nutrients.js';
import { isNum, formatNumber } from '../util/format.js';

/** En dessous de ce seuil, l'objectif calorique est signalé comme anormalement bas (non bloquant). */
export const LOW_KCAL_THRESHOLD = 1200;

/** Objectif en vigueur à une date : le plus récent dont la date d'effet est ≤ date. null si aucun. */
export function getGoalForDate(date) {
  return db.run(STORES.goals, 'readonly', async (tx) => {
    const index = tx.objectStore(STORES.goals).index('effectiveFrom');
    const cursor = await db.req(index.openCursor(IDBKeyRange.upperBound(date), 'prev'));
    return cursor ? cursor.value : null;
  });
}

/** Tous les objectifs, du plus récent au plus ancien. */
export async function listGoals() {
  const all = await db.getAll(STORES.goals);
  return all.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
}

/**
 * Enregistre un objectif. S'il en existe déjà un à la même date d'effet, il est remplacé.
 * Lève une ValidationError (message en français) si la saisie est invalide.
 */
export async function saveGoal(input) {
  const draft = createGoal(input); // validation avant d'ouvrir la transaction
  return db.run(STORES.goals, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.goals);
    const existing = await db.req(os.index('effectiveFrom').get(draft.effectiveFrom));
    const goal = existing ? { ...draft, id: existing.id } : draft;
    os.put(goal);
    return goal;
  });
}

/** Supprime un objectif et le renvoie (pour l'annulation). */
export function deleteGoal(id) {
  return db.run(STORES.goals, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.goals);
    const goal = await db.req(os.get(id));
    os.delete(id);
    return goal || null;
  });
}

/** Remet un objectif supprimé (annulation). */
export async function restoreGoal(goal) {
  await db.put(STORES.goals, goal);
  return goal;
}

/**
 * Cibles en grammes (et kcal) d'un objectif.
 * Mode pourcentage : g = kcal × % ÷ 100 ÷ (4 kcal/g pour protéines et glucides, 9 pour lipides).
 * Une macro non définie reste null.
 */
export function goalTargets(goal) {
  const out = { kcal: null, protein: null, carbs: null, fat: null };
  if (!goal) return out;
  out.kcal = isNum(goal.kcal) ? goal.kcal : null;
  for (const k of MACRO_KEYS) {
    const v = goal[k];
    if (!isNum(v)) continue;
    out[k] = goal.mode === 'percent'
      ? (isNum(goal.kcal) ? (goal.kcal * v) / 100 / ENERGY_FACTORS[k] : null)
      : v;
  }
  return out;
}

/** Part de l'énergie (en %) apportée par chaque macro d'un objectif. null si non calculable. */
export function goalPercents(goal) {
  const out = { protein: null, carbs: null, fat: null };
  if (!goal || !isNum(goal.kcal) || goal.kcal <= 0) return out;
  for (const k of MACRO_KEYS) {
    const v = goal[k];
    if (!isNum(v)) continue;
    out[k] = goal.mode === 'percent' ? v : (v * ENERGY_FACTORS[k] * 100) / goal.kcal;
  }
  return out;
}

/** Énergie apportée par des macros en grammes ; null si l'une manque. */
export function energyOfMacros(grams) {
  if (!grams || !MACRO_KEYS.every((k) => isNum(grams[k]))) return null;
  return MACRO_KEYS.reduce((sum, k) => sum + grams[k] * ENERGY_FACTORS[k], 0);
}

/**
 * Avertissements non bloquants sur un objectif (saisi ou enregistré).
 * [{ kind: 'warning'|'info', code, text }]
 */
export function goalWarnings(goal) {
  const out = [];
  if (!goal || !isNum(goal.kcal)) return out;
  if (goal.kcal < LOW_KCAL_THRESHOLD) {
    out.push({
      kind: 'warning',
      code: 'low-kcal',
      text: `Objectif très bas : moins de ${formatNumber(LOW_KCAL_THRESHOLD)} kcal par jour. Un apport aussi faible ne devrait être suivi qu'avec l'avis d'un professionnel de santé.`
    });
  }
  if (goal.mode === 'grams') {
    const energy = energyOfMacros(goal);
    if (energy !== null && goal.kcal > 0 && Math.abs(energy - goal.kcal) / goal.kcal > ENERGY_TOLERANCE) {
      out.push({
        kind: 'info',
        code: 'macro-energy',
        text: `Vos macros représentent ${formatNumber(energy)} kcal, soit un écart de plus de 10 % avec l'objectif de ${formatNumber(goal.kcal)} kcal.`
      });
    }
  }
  return out;
}

/** Résumé court d'un objectif : « P 25 % · G 50 % · L 25 % » ou « P 120 g · … ». */
export function goalMacroSummary(goal) {
  if (!goal) return '';
  const unit = goal.mode === 'percent' ? ' %' : ' g';
  const parts = [['P', goal.protein], ['G', goal.carbs], ['L', goal.fat]]
    .filter(([, v]) => isNum(v))
    .map(([l, v]) => `${l} ${formatNumber(v, 1)}${unit}`);
  return parts.length ? parts.join(' · ') : 'Macros libres';
}
