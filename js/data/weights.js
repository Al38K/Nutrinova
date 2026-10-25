// Pesées (table « weights », clé = date 'AAAA-MM-JJ') : une pesée par jour, en kg.
// Lecture, enregistrement (avec changement de date), suppression, moyenne mobile, périodes, statistiques.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createWeight, ValidationError } from './model.js';
import { addDays, isDateKey, localDateKey, parseDateKey } from '../util/dates.js';
import { isNum } from '../util/format.js';

export const MOVING_AVERAGE_DAYS = 7;

/** Écart avec la pesée précédente au-delà duquel la saisie est signalée (non bloquant). */
export const BIG_CHANGE_KG = 3;

export const PERIODS = Object.freeze([
  { id: '1m', label: '1 mois', months: 1 },
  { id: '3m', label: '3 mois', months: 3 },
  { id: '1y', label: '1 an', months: 12 },
  { id: 'all', label: 'Tout', months: null }
]);

function byDate(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/** Vrai si la valeur a au plus une décimale (70 ; 70,4 — pas 70,45). */
export function hasAtMostOneDecimal(v) {
  return isNum(v) && Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
}

/** Toutes les pesées, de la plus ancienne à la plus récente. */
export async function listWeights() {
  const all = await db.getAll(STORES.weights);
  return all.sort(byDate);
}

export function getWeight(date) {
  return db.get(STORES.weights, date);
}

/** Pesée la plus récente, ou null. */
export function latestWeight() {
  return db.run(STORES.weights, 'readonly', async (tx) => {
    const cursor = await db.req(tx.objectStore(STORES.weights).openCursor(null, 'prev'));
    return cursor ? cursor.value : null;
  });
}

/**
 * Enregistre une pesée. Une seule pesée par jour : une pesée existante à la même date est remplacée.
 * originalDate : date de la pesée modifiée (si la date change, l'ancienne est supprimée dans la même transaction).
 * Lève une ValidationError si la saisie est invalide (date future, poids hors limites, plus d'une décimale).
 * Renvoie { weight, replaced } : replaced = pesée écrasée à la nouvelle date (autre que celle modifiée), ou null.
 */
export async function saveWeight({ date, weightKg, note }, { originalDate = null, today = localDateKey() } = {}) {
  if (isDateKey(date) && date > today) throw new ValidationError('date', 'La date ne peut pas être dans le futur.');
  if (isNum(weightKg) && !hasAtMostOneDecimal(weightKg)) {
    throw new ValidationError('weightKg', 'Une décimale au maximum (ex. 70,4).');
  }
  const draft = createWeight({ date, weightKg, note }); // validation avant la transaction
  return db.run(STORES.weights, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.weights);
    const original = originalDate ? await db.req(os.get(originalDate)) : null;
    const existing = await db.req(os.get(draft.date));
    if (original && originalDate !== draft.date) os.delete(originalDate);
    const weight = { ...draft, createdAt: (original || existing || draft).createdAt };
    os.put(weight);
    const replaced = existing && originalDate !== draft.date ? existing : null;
    return { weight, replaced };
  });
}

/** Supprime une pesée et la renvoie (pour l'annulation). */
export function deleteWeight(date) {
  return db.run(STORES.weights, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.weights);
    const w = await db.req(os.get(date));
    os.delete(date);
    return w || null;
  });
}

/** Remet une ou plusieurs pesées (annulation). */
export function restoreWeights(list) {
  return db.putMany(STORES.weights, list.filter(Boolean));
}

/**
 * Moyenne mobile sur `days` jours calendaires : pour chaque pesée, moyenne des pesées
 * des `days` derniers jours, elle comprise. weights triées par date croissante.
 * Renvoie [{ date, value, count }].
 */
export function movingAverage(weights, days = MOVING_AVERAGE_DAYS) {
  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    sum += weights[i].weightKg;
    const from = addDays(weights[i].date, -(days - 1));
    while (weights[start].date < from) {
      sum -= weights[start].weightKg;
      start += 1;
    }
    const count = i - start + 1;
    out.push({ date: weights[i].date, value: sum / count, count });
  }
  return out;
}

/** Même jour, n mois plus tôt (le 31 mars − 1 mois = 28 ou 29 février). */
export function monthsBefore(key, months) {
  const d = parseDateKey(key);
  const target = new Date(d.getFullYear(), d.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return localDateKey(target);
}

/** Premier jour d'une période ('1m', '3m', '1y', 'all') ; null pour « Tout ». */
export function periodStart(periodId, today = localDateKey()) {
  const p = PERIODS.find((x) => x.id === periodId);
  if (!p || p.months === null) return null;
  return monthsBefore(today, p.months);
}

/**
 * Statistiques d'une liste de pesées (triées) : première, dernière, évolution, plus bas, plus haut.
 * Évolution = dernière − première (null s'il y a moins de 2 pesées).
 */
export function weightStats(list) {
  if (!list.length) return { count: 0, first: null, last: null, change: null, min: null, max: null };
  let min = list[0];
  let max = list[0];
  for (const w of list) {
    if (w.weightKg < min.weightKg) min = w;
    if (w.weightKg > max.weightKg) max = w;
  }
  const first = list[0];
  const last = list[list.length - 1];
  return {
    count: list.length,
    first,
    last,
    change: list.length > 1 ? last.weightKg - first.weightKg : null,
    min,
    max
  };
}

/** Pesée précédant une date (la plus récente avant elle), dans une liste triée ; null si aucune. */
export function previousWeight(weights, date) {
  let prev = null;
  for (const w of weights) {
    if (w.date >= date) break;
    prev = w;
  }
  return prev;
}
