// Sauvegarde : export de toutes les données dans un fichier JSON versionné, et import contrôlé.
// L'import est atomique : en cas d'erreur, rien n'est modifié.

import * as db from './db.js';
import { STORES, STORE_LABELS, SCHEMA_VERSION } from './schema.js';
import { SETTING_DEFAULTS, THEMES, setSetting, applyTheme, mirrorTheme } from './settings.js';
import { createFood, createRecipe, createJournalEntry, createGoal, createWeight } from './model.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { localDateKey, nowIso } from '../util/dates.js';

export const BACKUP_FORMAT = 'nutrinova-backup';
export const BACKUP_FORMAT_VERSION = 1;

// La table Ciqual (référence en lecture seule, Phase 3) n'est pas exportée : elle est fournie avec l'app.
export const BACKUP_STORES = Object.freeze([
  STORES.foods, STORES.recipes, STORES.journal, STORES.goals, STORES.weights, STORES.settings
]);

// Réglages propres à cet appareil (diagnostic, date de sauvegarde, table Ciqual) ou secrets (clé API) : jamais exportés.
const SETTINGS_EXCLUDED = new Set(['schemaVersion', 'firstLaunchAt', 'lastLaunchAt', 'launchCount', 'lastBackupAt', 'visionApiKey', 'ciqualVersion', 'ciqualMeta']);
const IMPORTABLE_SETTINGS = Object.freeze(Object.keys(SETTING_DEFAULTS).filter((k) => !SETTINGS_EXCLUDED.has(k)));
const WEIGH_KEYS = Object.freeze(['weighReminder', 'weighDay', 'weighTime']);

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

function countsOf(data) {
  const out = {};
  for (const s of BACKUP_STORES) out[s] = Array.isArray(data[s]) ? data[s].length : 0;
  return out;
}

// ---------- Export ----------

/** Lit toute la base et prépare le fichier. Renvoie { json, filename, size, counts }. */
export async function buildBackup() {
  const data = await db.run(BACKUP_STORES, 'readonly', async (tx) => {
    const out = {};
    for (const s of BACKUP_STORES) out[s] = await db.req(tx.objectStore(s).getAll());
    return out;
  });
  data.settings = data.settings
    .filter((r) => IMPORTABLE_SETTINGS.includes(r.key))
    .map(({ key, value }) => ({ key, value }));
  const counts = countsOf(data);
  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    app: APP_NAME,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    counts,
    data
  };
  const json = JSON.stringify(backup, null, 1);
  return {
    json,
    filename: `nutrinova-sauvegarde-${localDateKey()}.json`,
    size: new Blob([json]).size,
    counts
  };
}

export function backupFile(json, filename) {
  return new File([json], filename, { type: 'application/json' });
}

/** Vrai si le partage de fichier (feuille Partager d'iOS) est possible. */
export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/** Ouvre la feuille Partager. Renvoie 'shared' ou 'cancelled'. */
export async function shareBackup(file) {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

/** Repli : téléchargement classique du fichier. */
export function downloadBackup(json, filename) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function markBackupDone() {
  return setSetting('lastBackupAt', nowIso());
}

// ---------- Contrôle d'un fichier ----------

function keepUpdatedAt(record, source) {
  if (typeof source.updatedAt === 'string' && !Number.isNaN(Date.parse(source.updatedAt))) {
    record.updatedAt = source.updatedAt;
  }
  return record;
}

function asObject(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('élément mal formé.');
  return rec;
}

function requireId(rec) {
  if (typeof rec.id !== 'string' || !rec.id) throw new Error('identifiant manquant.');
  return rec.id;
}

const VALIDATORS = {
  foods(rec) {
    asObject(rec);
    requireId(rec);
    return keepUpdatedAt(createFood(rec), rec);
  },
  recipes(rec) {
    asObject(rec);
    requireId(rec);
    return keepUpdatedAt(createRecipe(rec), rec);
  },
  journal(rec) {
    asObject(rec);
    requireId(rec);
    if (typeof rec.foodId !== 'string' || !rec.foodId) throw new Error('aliment manquant.');
    const entry = createJournalEntry({
      id: rec.id,
      date: rec.date,
      meal: rec.meal,
      food: { id: rec.foodId, name: rec.nameSnapshot, brand: null, basis: rec.basis, per100: rec.per100Snapshot },
      quantity: rec.quantity,
      inputUnit: rec.inputUnit,
      inputValue: rec.inputValue,
      createdAt: rec.createdAt
    });
    return keepUpdatedAt(entry, rec);
  },
  goals(rec) {
    asObject(rec);
    requireId(rec);
    return createGoal(rec);
  },
  weights(rec) {
    asObject(rec);
    return createWeight(rec);
  },
  settings(rec) {
    asObject(rec);
    if (!IMPORTABLE_SETTINGS.includes(rec.key)) return null; // réglage ignoré
    const v = rec.value;
    const ok = v === null || ['string', 'number', 'boolean'].includes(typeof v);
    if (!ok) throw new Error(`réglage « ${rec.key} » invalide.`);
    if (rec.key === 'theme' && !THEMES.includes(v)) throw new Error(`thème inconnu « ${v} ».`);
    // Rappel de pesée (Phase 5) : une valeur vide d'une ancienne sauvegarde garde le réglage par défaut.
    if (WEIGH_KEYS.includes(rec.key) && v === null) return null;
    if (rec.key === 'weighReminder' && typeof v !== 'boolean') throw new Error('rappel de pesée invalide.');
    if (rec.key === 'weighDay' && !(Number.isInteger(v) && v >= 0 && v <= 6)) throw new Error(`jour de pesée invalide « ${v} ».`);
    if (rec.key === 'weighTime' && !(typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new Error(`heure de pesée invalide « ${v} ».`);
    return { key: rec.key, value: v };
  }
};

const KEY_OF = { foods: 'id', recipes: 'id', journal: 'id', goals: 'id', weights: 'date', settings: 'key' };

/**
 * Vérifie un objet de sauvegarde sans rien écrire.
 * Renvoie { meta, data, counts } avec des enregistrements normalisés, ou lève une BackupError.
 */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) {
    throw new BackupError('Ce fichier n\'est pas une sauvegarde nutrinova.');
  }
  if (!Number.isInteger(obj.formatVersion) || obj.formatVersion < 1) {
    throw new BackupError('Version de sauvegarde illisible.');
  }
  if (obj.formatVersion > BACKUP_FORMAT_VERSION || (Number.isInteger(obj.schemaVersion) && obj.schemaVersion > SCHEMA_VERSION)) {
    throw new BackupError('Cette sauvegarde vient d\'une version plus récente de nutrinova. Mettez l\'app à jour, puis réessayez.');
  }
  const src = obj.data;
  if (!src || typeof src !== 'object') throw new BackupError('Sauvegarde vide ou mal formée.');

  const data = {};
  for (const store of BACKUP_STORES) {
    const list = src[store] === undefined ? [] : src[store];
    if (!Array.isArray(list)) throw new BackupError(`${STORE_LABELS[store]} : section mal formée.`);
    const out = [];
    const seen = new Set();
    list.forEach((rec, i) => {
      let clean;
      try {
        clean = VALIDATORS[store](rec);
      } catch (err) {
        throw new BackupError(`${STORE_LABELS[store]}, élément ${i + 1} : ${err && err.message ? err.message : err}`);
      }
      if (clean === null) return;
      const key = clean[KEY_OF[store]];
      if (seen.has(key)) throw new BackupError(`${STORE_LABELS[store]} : élément en double (${key}).`);
      seen.add(key);
      out.push(clean);
    });
    data[store] = out;
  }

  const dates = new Set();
  for (const g of data.goals) {
    if (dates.has(g.effectiveFrom)) throw new BackupError(`Objectifs : deux objectifs à la même date (${g.effectiveFrom}).`);
    dates.add(g.effectiveFrom);
  }

  return {
    meta: {
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : null,
      schemaVersion: Number.isInteger(obj.schemaVersion) ? obj.schemaVersion : null
    },
    data,
    counts: countsOf(data)
  };
}

/** Lit le texte d'un fichier de sauvegarde. */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new BackupError('Ce fichier n\'est pas un JSON valide.');
  }
  return validateBackup(obj);
}

// ---------- Import ----------

/**
 * Écrit une sauvegarde validée.
 * - 'merge' : ajoute et remplace les éléments de même identifiant, sans rien supprimer ;
 * - 'replace' : efface les données actuelles (hors diagnostic de l'appareil) puis restaure.
 * Une seule transaction : en cas d'échec, la base reste inchangée.
 */
export async function applyBackup(parsed, mode) {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('Mode d\'import inconnu.');
  const { data } = parsed;
  const now = nowIso();
  await db.run(BACKUP_STORES, 'readwrite', async (tx) => {
    const os = (name) => tx.objectStore(name);
    if (mode === 'replace') {
      for (const s of [STORES.foods, STORES.recipes, STORES.journal, STORES.goals, STORES.weights]) os(s).clear();
      for (const key of IMPORTABLE_SETTINGS) os(STORES.settings).delete(key);
    }
    for (const f of data.foods) os(STORES.foods).put(f);
    for (const r of data.recipes) os(STORES.recipes).put(r);
    for (const e of data.journal) os(STORES.journal).put(e);
    for (const w of data.weights) os(STORES.weights).put(w);
    for (const s of data.settings) os(STORES.settings).put({ key: s.key, value: s.value, updatedAt: now });

    const goals = os(STORES.goals);
    const byDate = goals.index('effectiveFrom');
    for (const g of data.goals) {
      if (mode === 'merge') {
        // Une seule version d'objectif par date : celle du fichier remplace l'existante.
        const existing = await db.req(byDate.get(g.effectiveFrom));
        if (existing && existing.id !== g.id) goals.delete(existing.id);
      }
      goals.put(g);
    }
  });

  const themeRec = data.settings.find((s) => s.key === 'theme');
  if (themeRec || mode === 'replace') {
    const theme = themeRec ? themeRec.value : 'system';
    applyTheme(theme);
    mirrorTheme(theme);
  }
  return parsed.counts;
}
