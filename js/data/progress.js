// Onglet Suivi : calculs sur une période (journées terminées, aujourd'hui exclu).
// Règles :
// - une journée « saisie » a au moins une entrée au journal ; les autres ne comptent pas dans les moyennes ;
// - objectif du jour = objectif calorique en vigueur ce jour-là + calories dépensées (activité) ;
// - un total où au moins un aliment n'a pas la valeur est partiel (minimum) : signalé, jamais complété.

import { totalsOf } from './entries.js';
import { goalTargets } from './goals.js';
import { kcalBudget } from './activities.js';
import { addDays } from '../util/dates.js';
import { isNum } from '../util/format.js';

export const PROGRESS_PERIODS = Object.freeze([
  { id: 7, label: '7 jours' },
  { id: 30, label: '30 jours' },
  { id: 90, label: '90 jours' }
]);

/** Écart toléré autour de l'objectif calorique pour une journée « proche de l'objectif ». */
export const NEAR_TOLERANCE = 0.10;

/** Bornes d'une période de n journées terminées : { from, to } (to = hier). */
export function periodRange(days, today) {
  const to = addDays(today, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/** Objectif en vigueur à une date, parmi des objectifs triés par date d'effet croissante. */
export function goalAt(goalsAsc, date) {
  let found = null;
  for (const g of goalsAsc) {
    if (g.effectiveFrom <= date) found = g;
    else break;
  }
  return found;
}

/**
 * Une ligne par jour de la période : { date, count, totals, kcal, partial, burned, budget, targets, status }.
 * status : 'empty' (rien saisi) | 'partial' (kcal incomplètes) | 'under' | 'near' | 'over' | 'nogoal'.
 */
export function dailySeries({ from, to, entries, activities, goals }) {
  const goalsAsc = [...goals].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const burnedBy = new Map();
  for (const a of activities) burnedBy.set(a.date, (burnedBy.get(a.date) || 0) + (isNum(a.kcal) ? a.kcal : 0));

  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const list = byDate.get(d) || [];
    const totals = totalsOf(list);
    const goal = goalAt(goalsAsc, d);
    const targets = goalTargets(goal);
    const burned = burnedBy.get(d) || 0;
    const budget = kcalBudget(targets.kcal, burned);
    const kcal = list.length ? totals.values.kcal : null;
    const partial = list.length > 0 && totals.missing.kcal > 0;
    let status;
    if (!list.length) status = 'empty';
    else if (partial || !isNum(kcal)) status = 'partial';
    else if (!isNum(budget)) status = 'nogoal';
    else if (kcal < budget * (1 - NEAR_TOLERANCE)) status = 'under';
    else if (kcal > budget * (1 + NEAR_TOLERANCE)) status = 'over';
    else status = 'near';
    days.push({ date: d, count: list.length, totals, kcal, partial, burned, budget, targets, status });
  }
  return days;
}

function mean(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/**
 * Synthèse de la période.
 * - avg[k] : moyenne par journée saisie (null si aucune) ; partial[k] : au moins une journée incomplète pour k ;
 * - avgTargets[k] : objectif moyen des journées saisies (null si aucun objectif) ;
 * - counts : journées saisies, sous / proches / au-dessus de l'objectif, partielles, sans objectif.
 */
export function summarize(days) {
  const logged = days.filter((d) => d.count > 0);
  const keys = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'salt'];
  const avg = {};
  const partial = {};
  for (const k of keys) {
    const vals = logged.map((d) => d.totals.values[k]).filter(isNum);
    avg[k] = vals.length ? mean(vals) : null;
    partial[k] = logged.some((d) => d.totals.missing[k] > 0);
  }
  const avgTargets = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const vals = logged.map((d) => (k === 'kcal' ? d.budget : d.targets[k])).filter(isNum);
    avgTargets[k] = vals.length ? mean(vals) : null;
  }
  const count = (s) => days.filter((d) => d.status === s).length;
  const burnedDays = days.filter((d) => d.burned > 0);
  return {
    days: days.length,
    logged: logged.length,
    avg,
    partial,
    avgTargets,
    counts: { under: count('under'), near: count('near'), over: count('over'), partial: count('partial'), nogoal: count('nogoal') },
    burned: { total: burnedDays.reduce((s, d) => s + d.burned, 0), days: burnedDays.length }
  };
}
