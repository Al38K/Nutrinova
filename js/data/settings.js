// Réglages persistés dans la table "settings" : { key, value, updatedAt }.
// Seules les clés déclarées ici sont acceptées (évite les fautes de frappe silencieuses).

import * as db from './db.js';
import { STORES, SCHEMA_VERSION } from './schema.js';
import { THEME_STORAGE_KEY } from '../config.js';
import { nowIso } from '../util/dates.js';

export const SETTING_DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  theme: 'system',            // 'system' | 'light' | 'dark'
  style: 'classic',           // v1.6 : 'classic' | 'glass' (verre translucide)
  accent: 'teal',             // v1.6 : couleur de l'app (voir ACCENTS)
  lastBackupAt: null,         // date de la dernière sauvegarde (propre à l'appareil)
  backupReminderDays: 7,      // Phase 7 : rappel de sauvegarde, en jours (0 = désactivé)
  backupBannerHiddenOn: null, // v1.6 : bannière de sauvegarde fermée ce jour-là ('AAAA-MM-JJ', propre à l'appareil)
  weighReminder: true,        // Phase 5 : rappel de pesée actif
  weighDay: 0,                // Phase 5 : jour de pesée (0 = dimanche … 6 = samedi)
  weighTime: '10:00',         // Phase 5 : heure de pesée (HH:MM)
  offAttributionAck: false,   // Phase 3 : information Open Food Facts lue
  ciqualVersion: null,        // Phase 3 : version de la table Ciqual copiée dans la base
  ciqualMeta: null,           // Phase 3 : description de la table Ciqual (JSON)
  firstLaunchAt: null,        // diagnostic de persistance
  lastLaunchAt: null,
  launchCount: 0
});

export const THEMES = Object.freeze(['system', 'light', 'dark']);
export const STYLES = Object.freeze(['classic', 'glass']);
export const ACCENTS = Object.freeze([
  { id: 'teal', label: 'Émeraude', swatch: '#0B7A6A' },
  { id: 'blue', label: 'Océan', swatch: '#0A63C9' },
  { id: 'indigo', label: 'Indigo', swatch: '#5145CD' },
  { id: 'berry', label: 'Framboise', swatch: '#B8235A' },
  { id: 'graphite', label: 'Graphite', swatch: '#3A3A3C' }
]);
export const ACCENT_IDS = Object.freeze(ACCENTS.map((a) => a.id));
const STORAGE_KEYS = { theme: THEME_STORAGE_KEY, style: 'nutrinova.style', accent: 'nutrinova.accent' };

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
  if (key === 'style' && !STYLES.includes(value)) throw new Error(`Style inconnu : ${value}`);
  if (key === 'accent' && !ACCENT_IDS.includes(value)) throw new Error(`Couleur inconnue : ${value}`);
  await db.put(STORES.settings, { key, value, updatedAt: nowIso() });
  if (key === 'theme' || key === 'style' || key === 'accent') applyAppearance({ [key]: value }, { mirror: true });
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

/**
 * Applique l'apparence à la page (seules les clés fournies changent) :
 * - theme : 'system' (suit le réglage clair/sombre de l'iPhone), 'light', 'dark' ;
 * - style : 'classic' ou 'glass' (verre translucide, inspiré de Liquid Glass) ;
 * - accent : couleur de l'app (ACCENT_IDS).
 * mirror : recopie aussi dans localStorage, pour appliquer l'apparence avant le premier affichage.
 */
export function applyAppearance({ theme, style, accent } = {}, { mirror = false } = {}) {
  const root = document.documentElement;
  if (theme !== undefined) {
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }
  if (style !== undefined) {
    if (style === 'glass') root.setAttribute('data-style', 'glass');
    else root.removeAttribute('data-style');
  }
  if (accent !== undefined) {
    if (ACCENT_IDS.includes(accent) && accent !== 'teal') root.setAttribute('data-accent', accent);
    else root.removeAttribute('data-accent');
  }
  if (mirror) {
    const values = { theme, style, accent };
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      try {
        const isDefault = v === SETTING_DEFAULTS[k];
        if (isDefault) localStorage.removeItem(STORAGE_KEYS[k]);
        else localStorage.setItem(STORAGE_KEYS[k], v);
      } catch { /* localStorage indisponible : sans conséquence */ }
    }
  }
  updateThemeColor();
}

/** Couleur de la barre d'état et du sélecteur d'apps : celle du bandeau supérieur affiché. */
export function updateThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--header-bg').trim();
  if (!color) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color);
}

// Thème « Système » : la couleur du bandeau change quand l'iPhone passe en clair ou en sombre.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateThemeColor());
} catch { /* ancien navigateur : sans conséquence */ }

/** Compatibilité : applique seulement le thème clair/sombre. */
export function applyTheme(theme) {
  applyAppearance({ theme });
}

/** Compatibilité : recopie seulement le thème dans localStorage. */
export function mirrorTheme(theme) {
  applyAppearance({ theme }, { mirror: true });
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
