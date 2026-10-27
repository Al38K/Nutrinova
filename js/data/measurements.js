// Mensurations (table « measurements », clé = date 'AAAA-MM-JJ') : une saisie par jour,
// avec les tours mesurés ce jour-là (en cm, une décimale) et, en option, la masse grasse (%).
// Une mesure non saisie reste absente : jamais 0, jamais devinée.

import * as db from './db.js';
import { STORES } from './schema.js';
import { ValidationError } from './model.js';
import { getSetting, setSetting } from './settings.js';
import { isDateKey, localDateKey, nowIso } from '../util/dates.js';
import { cleanLabel } from '../util/text.js';
import { isNum } from '../util/format.js';

export const MEASURES = Object.freeze([
  { id: 'waist', label: 'Tour de taille', short: 'Taille', unit: 'cm', min: 30, max: 250, hint: 'au niveau du nombril, ventre relâché' },
  { id: 'hips', label: 'Tour de hanches', short: 'Hanches', unit: 'cm', min: 40, max: 250, hint: 'à l\'endroit le plus large des fesses' },
  { id: 'chest', label: 'Tour de poitrine', short: 'Poitrine', unit: 'cm', min: 40, max: 250, hint: 'à hauteur des mamelons, bras le long du corps' },
  { id: 'arm', label: 'Tour de bras', short: 'Bras', unit: 'cm', min: 10, max: 100, hint: 'à mi-hauteur, bras détendu, toujours le même côté' },
  { id: 'thigh', label: 'Tour de cuisse', short: 'Cuisse', unit: 'cm', min: 20, max: 150, hint: 'à l\'endroit le plus large, toujours le même côté' },
  { id: 'calf', label: 'Tour de mollet', short: 'Mollet', unit: 'cm', min: 15, max: 100, hint: 'à l\'endroit le plus large' },
  { id: 'neck', label: 'Tour de cou', short: 'Cou', unit: 'cm', min: 20, max: 80, hint: 'sous la pomme d\'Adam' },
  { id: 'bodyFat', label: 'Masse grasse', short: 'Masse grasse', unit: '%', min: 2, max: 75, hint: 'valeur indiquée par votre balance ou votre professionnel de santé' }
]);
export const MEASURE_IDS = Object.freeze(MEASURES.map((m) => m.id));
export const MEASURE_BY_ID = Object.freeze(Object.fromEntries(MEASURES.map((m) => [m.id, m])));
export const DEFAULT_TRACKED = Object.freeze(['waist', 'hips', 'chest', 'arm', 'thigh']);

/** « 82,5 cm », « 24,1 % » */
export function formatMeasure(id, v) {
  if (!isNum(v)) return '—';
  const m = MEASURE_BY_ID[id];
  const n = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v);
  return `${n} ${m ? m.unit : ''}`.trim();
}

/** Réglage « mensurations suivies » (texte 'waist,hips') → liste ordonnée d'identifiants connus. */
export function parseTracked(text) {
  if (typeof text !== 'string') return [...DEFAULT_TRACKED];
  const ids = text.split(',').map((s) => s.trim()).filter((id) => MEASURE_IDS.includes(id));
  return MEASURE_IDS.filter((id) => ids.includes(id));
}

/** Vrai si le texte du réglage est valide (identifiants connus, séparés par des virgules ; vide accepté). */
export function isTrackedText(text) {
  if (typeof text !== 'string') return false;
  if (!text) return true;
  return text.split(',').every((id) => MEASURE_IDS.includes(id));
}

export async function getTracked() {
  return parseTracked(await getSetting('measuresTracked'));
}

export function saveTracked(ids) {
  const clean = MEASURE_IDS.filter((id) => ids.includes(id));
  return setSetting('measuresTracked', clean.join(','));
}

function oneDecimal(v) {
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
}

/**
 * Crée une saisie de mensurations valide, ou lève une ValidationError (field = identifiant de la mesure).
 * values : { waist: 82.5, … } ; les valeurs vides sont ignorées ; au moins une mesure est obligatoire.
 */
export function createMeasurement(input = {}) {
  if (!isDateKey(input.date)) throw new ValidationError('date', 'Date invalide (format attendu AAAA-MM-JJ).');
  const values = {};
  const src = input.values && typeof input.values === 'object' ? input.values : {};
  for (const [id, raw] of Object.entries(src)) {
    if (raw === null || raw === undefined || raw === '') continue;
    const m = MEASURE_BY_ID[id];
    if (!m) continue; // mesure inconnue : ignorée
    if (!isNum(raw)) throw new ValidationError(id, `${m.label} : nombre attendu.`);
    if (raw < m.min || raw > m.max) throw new ValidationError(id, `${m.label} : entre ${m.min} et ${m.max} ${m.unit}.`);
    if (!oneDecimal(raw)) throw new ValidationError(id, `${m.label} : une décimale au maximum.`);
    values[id] = raw;
  }
  if (!Object.keys(values).length) throw new ValidationError('values', 'Saisissez au moins une mesure.');
  const now = nowIso();
  return {
    date: input.date,
    values,
    note: cleanLabel(input.note, 200) || null,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function byDate(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/** Toutes les saisies, de la plus ancienne à la plus récente. */
export async function listMeasurements() {
  return (await db.getAll(STORES.measurements)).sort(byDate);
}

/**
 * Enregistre une saisie (une par jour). originalDate : date de la saisie modifiée
 * (si la date change, l'ancienne est supprimée dans la même transaction).
 * Renvoie { measurement, replaced } : replaced = saisie écrasée à la nouvelle date, ou null.
 */
export async function saveMeasurement({ date, values, note }, { originalDate = null, today = localDateKey() } = {}) {
  if (isDateKey(date) && date > today) throw new ValidationError('date', 'La date ne peut pas être dans le futur.');
  const draft = createMeasurement({ date, values, note });
  return db.run(STORES.measurements, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.measurements);
    const original = originalDate ? await db.req(os.get(originalDate)) : null;
    const existing = await db.req(os.get(draft.date));
    if (original && originalDate !== draft.date) os.delete(originalDate);
    const measurement = { ...draft, createdAt: (original || existing || draft).createdAt };
    os.put(measurement);
    return { measurement, replaced: existing && originalDate !== draft.date ? existing : null };
  });
}

export function deleteMeasurement(date) {
  return db.run(STORES.measurements, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.measurements);
    const m = await db.req(os.get(date));
    os.delete(date);
    return m || null;
  });
}

export async function restoreMeasurement(m) {
  await db.put(STORES.measurements, m);
  return m;
}

/** Série d'une mesure : [{ date, value }] dans l'ordre des dates (saisies où elle figure). */
export function seriesOf(list, id) {
  return list.filter((m) => isNum(m.values[id])).map((m) => ({ date: m.date, value: m.values[id] }));
}

/** Dernière valeur de chaque mesure et valeur précédente : { id: { last, prev } }. */
export function latestById(list) {
  const out = {};
  for (const id of MEASURE_IDS) {
    const s = seriesOf(list, id);
    if (s.length) out[id] = { last: s[s.length - 1], prev: s.length > 1 ? s[s.length - 2] : null };
  }
  return out;
}
