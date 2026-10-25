// Table Ciqual de l'ANSES (aliments bruts et courants), embarquée dans l'app : data/ciqual.json.
// Au premier besoin, le fichier est copié dans la base locale (table « ciqual », lecture seule),
// puis gardé en mémoire pour une recherche instantanée, même hors ligne.
// Un aliment Ciqual n'est copié dans « vos aliments » que lorsqu'il est utilisé ou mis en favori.

import * as db from './db.js';
import { STORES } from './schema.js';
import { createCiqualItem, createFood } from './model.js';
import { NUTRIENT_KEYS } from './nutrients.js';
import { getSetting, setSetting } from './settings.js';
import { queryWords, matchScore } from './search.js';
import { CIQUAL_DATA_VERSION } from '../config.js';

export const CIQUAL_FILE = 'data/ciqual.json';
export const CIQUAL_FORMAT = 'nutrinova-ciqual';

const state = {
  status: 'idle',       // 'idle' | 'loading' | 'ready' | 'error'
  error: null,
  count: 0,
  meta: null,           // { version, published, source, license, url, rules }
  items: null           // éléments en mémoire
};
let readyPromise = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(getCiqualState()); } catch { /* écouteur fautif ignoré */ }
  }
}

export function onCiqualChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCiqualState() {
  return { status: state.status, error: state.error, count: state.count, meta: state.meta };
}

/** Lit et vérifie le fichier embarqué. Lève une erreur explicite si le fichier est absent ou abîmé. */
export function parseCiqualFile(data) {
  if (!data || data.format !== CIQUAL_FORMAT || !Array.isArray(data.items) || !Array.isArray(data.fields)) {
    throw new Error('Fichier Ciqual mal formé.');
  }
  const col = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  for (const f of ['code', 'name', 'group', ...NUTRIENT_KEYS]) {
    if (col[f] === undefined) throw new Error(`Fichier Ciqual : colonne « ${f} » manquante.`);
  }
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const items = data.items.map((row, i) => {
    try {
      const per100 = {};
      for (const k of NUTRIENT_KEYS) per100[k] = row[col[k]];
      const g = row[col.group];
      return createCiqualItem({
        code: String(row[col.code]),
        name: row[col.name],
        group: typeof g === 'number' ? groups[g] ?? null : g,
        per100
      });
    } catch (err) {
      throw new Error(`Fichier Ciqual, ligne ${i + 1} : ${err.message}`);
    }
  });
  return {
    meta: {
      version: String(data.version || ''),
      published: data.published || null,
      source: data.source || null,
      license: data.license || null,
      url: data.url || null,
      rules: data.rules || null
    },
    items
  };
}

async function importFile() {
  let res;
  try {
    res = await fetch(CIQUAL_FILE, { cache: 'no-cache' });
  } catch {
    throw new Error('Fichier Ciqual non téléchargé (connexion requise une première fois).');
  }
  if (!res.ok) throw new Error(`Fichier Ciqual introuvable (${res.status}).`);
  const parsed = parseCiqualFile(await res.json());
  if (parsed.meta.version !== CIQUAL_DATA_VERSION) {
    throw new Error(`Version du fichier Ciqual inattendue (${parsed.meta.version}).`);
  }
  await db.run([STORES.ciqual, STORES.settings], 'readwrite', (tx) => {
    const os = tx.objectStore(STORES.ciqual);
    os.clear();
    for (const item of parsed.items) os.put(item);
    const now = new Date().toISOString();
    tx.objectStore(STORES.settings).put({ key: 'ciqualVersion', value: CIQUAL_DATA_VERSION, updatedAt: now });
    tx.objectStore(STORES.settings).put({ key: 'ciqualMeta', value: JSON.stringify(parsed.meta), updatedAt: now });
  });
  return parsed;
}

/**
 * Prépare la table (copie dans la base au premier lancement ou après une mise à jour des données)
 * et la charge en mémoire. Appels multiples : une seule préparation.
 */
export function ensureCiqual() {
  if (readyPromise) return readyPromise;
  state.status = 'loading';
  state.error = null;
  emit();
  readyPromise = (async () => {
    const [version, count] = await Promise.all([getSetting('ciqualVersion'), db.count(STORES.ciqual)]);
    let items;
    let meta;
    if (version === CIQUAL_DATA_VERSION && count > 0) {
      items = await db.getAll(STORES.ciqual);
      try { meta = JSON.parse(await getSetting('ciqualMeta') || 'null'); } catch { meta = null; }
    } else {
      const parsed = await importFile();
      items = parsed.items;
      meta = parsed.meta;
    }
    state.items = items.filter((it) => !String(it.code).startsWith('SELFTEST'));
    state.count = state.items.length;
    state.meta = meta;
    state.status = 'ready';
    emit();
    return getCiqualState();
  })().catch((err) => {
    readyPromise = null;
    state.status = 'error';
    state.error = err && err.message ? err.message : String(err);
    emit();
    throw err;
  });
  return readyPromise;
}

/** Recherche dans la table chargée (vide tant qu'elle n'est pas prête). */
export function searchCiqual(query, { limit = 30, exclude = null } = {}) {
  if (state.status !== 'ready' || !state.items) return { items: [], total: 0 };
  const words = queryWords(query);
  if (!words.length) return { items: [], total: 0 };
  const scored = [];
  for (const it of state.items) {
    if (exclude && exclude.has(it.code)) continue;
    const s = matchScore(it.nameNorm, words);
    if (s >= 0) scored.push({ it, s });
  }
  scored.sort((a, b) => (b.s - a.s) || a.it.name.localeCompare(b.it.name, 'fr'));
  return { items: scored.slice(0, limit).map((x) => x.it), total: scored.length };
}

/** Aliment nutrinova (non enregistré) correspondant à un élément Ciqual. Valeurs pour 100 g. */
export function ciqualToFood(item) {
  return createFood({
    source: 'ciqual',
    sourceRef: item.code,
    name: item.name,
    brand: null,
    basis: 'g',
    per100: item.per100
  });
}

/** Libellé de la source, ex. « Ciqual 2025 (ANSES) ». */
export function ciqualLabel() {
  return state.meta && state.meta.version ? `Ciqual ${state.meta.version} (ANSES)` : 'Ciqual (ANSES)';
}
