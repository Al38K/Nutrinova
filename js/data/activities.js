// Activités (table « activities ») : calories dépensées saisies à la main, par jour.
// Elles augmentent les calories disponibles du jour : restant = objectif + dépensées − consommées.
// Les objectifs de macros ne changent pas.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createActivity } from './model.js';
import { isNum } from '../util/format.js';

export const ACTIVITY_SUGGESTIONS = Object.freeze(['Marche', 'Course', 'Vélo', 'Natation', 'Musculation']);

/** Activités d'un jour, dans l'ordre de saisie. */
export async function getActivitiesForDate(date) {
  const list = await db.getAllByIndex(STORES.activities, 'date', date);
  return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Total des calories dépensées (0 s'il n'y a rien). */
export function burnedKcal(list) {
  return (list || []).reduce((sum, a) => sum + (isNum(a.kcal) ? a.kcal : 0), 0);
}

/** Calories disponibles du jour : objectif + dépensées ; null sans objectif. */
export function kcalBudget(goalKcal, burned) {
  return isNum(goalKcal) ? goalKcal + (isNum(burned) ? burned : 0) : null;
}

/** Crée ou modifie une activité. Lève une ValidationError si la saisie est invalide. */
export async function saveActivity(input, existing = null) {
  const activity = createActivity({ ...input, id: existing ? existing.id : input.id, createdAt: existing ? existing.createdAt : undefined });
  await db.put(STORES.activities, activity);
  return activity;
}

/** Supprime une activité et la renvoie (pour l'annulation). */
export function deleteActivity(id) {
  return db.run(STORES.activities, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.activities);
    const a = await db.req(os.get(id));
    os.delete(id);
    return a || null;
  });
}

export async function restoreActivity(activity) {
  await db.put(STORES.activities, activity);
  return activity;
}
