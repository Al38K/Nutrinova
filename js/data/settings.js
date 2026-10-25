// Réglages persistés dans la table "settings" : { key, value, updatedAt }.
// Seules les clés déclarées ici sont acceptées (évite les fautes de frappe silencieuses).

import * as db from './db.js';
import { STORES, SCHEMA_VERSION } from './schema.js';
import { THEME_STORAGE_KEY } from '../config.js';
import { nowIso } from '../util/dates.js';

export const SETTING_DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  theme: 'system',            // 'system' | 'light' | 'dark'
  lastBackupAt: null,         // Phase 7
  backupReminderDays: null,   // Phase 7
  weighDay: null,             // Phase 5
  weighTime: null,            // Phase 5
  offAttributionAck: false,   // Phase 3 : information Open Food Facts lue
  ciqualVersion: null,        // Phase 3 : version de la table Ciqual copiée dans la base
  ciqualMeta: null,           // Phase 3 : description de la table Ciqual (JSON)
  photoConsentAt: null,       // Phase 6
  visionProvider: null,       // Phase 6
  visionApiKey: null,         // Phase 6
  firstLaunchAt: null,        // diagnostic de persistance
  lastLaunchAt: null,
  launchCount: 0
});

export const THEMES = Object.freeze(['system', 'light', 'dark']);

function assertKey(key) {
  if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) {
    throw new Error(`Réglage inconnu : ${key}`);
  }
}

export async function getSetting(key) {
  assertKey(key);
  const rec = await db.get(STORES.settings, key);
  return rec ? rec.value : SETTING_DEFAULTS[key];
}

export async function setSetting(key, value) {
  assertKey(key);
  if (key === 'theme' && !THEMES.includes(value)) throw new Error(`Thème inconnu : ${value}`);
  await db.put(STORES.settings, { key, value, updatedAt: nowIso() });
  if (key === 'theme') {
    mirrorTheme(value);
    applyTheme(value);
  }
  return value;
}

export async function getAllSettings() {
  const rows = await db.getAll(STORES.settings);
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, r.key)) out[r.key] = r.value;
  }
  return out;
}

/** Applique le thème à la page : 'system' suit le réglage clair/sombre de l'iPhone. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const colors = { light: '#0B7A6A', dark: '#0B4F46' };
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') || '';
    const systemValue = media.includes('dark') ? colors.dark : colors.light;
    meta.setAttribute('content', theme === 'light' || theme === 'dark' ? colors[theme] : systemValue);
  }
}

/** Copie du thème dans localStorage pour l'appliquer avant le premier affichage. */
export function mirrorTheme(theme) {
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem(THEME_STORAGE_KEY, theme);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch { /* localStorage indisponible : sans conséquence */ }
}

/**
 * À chaque lancement : écrit schemaVersion, incrémente le compteur d'ouvertures,
 * mémorise la première et la dernière ouverture. Le tout dans une seule transaction.
 */
export async function recordLaunch() {
  const now = nowIso();
  return db.run(STORES.settings, 'readwrite', async (tx) => {
    const os = tx.objectStore(STORES.settings);
    const [countRec, firstRec] = await Promise.all([
      db.req(os.get('launchCount')),
      db.req(os.get('firstLaunchAt'))
    ]);
    const launchCount = (countRec && Number.isInteger(countRec.value) ? countRec.value : 0) + 1;
    const firstLaunchAt = firstRec && firstRec.value ? firstRec.value : now;
    os.put({ key: 'launchCount', value: launchCount, updatedAt: now });
    os.put({ key: 'firstLaunchAt', value: firstLaunchAt, updatedAt: now });
    os.put({ key: 'lastLaunchAt', value: now, updatedAt: now });
    os.put({ key: 'schemaVersion', value: SCHEMA_VERSION, updatedAt: now });
    return { launchCount, firstLaunchAt, lastLaunchAt: now };
  });
}
