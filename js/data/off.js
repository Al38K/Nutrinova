// Open Food Facts : lecture d'une fiche produit par code-barres et recherche par nom.
// Base collaborative ouverte, licence ODbL (https://world.openfoodfacts.org).
// Règles respectées :
// - limites de requêtes : 15 lectures de fiche et 10 recherches par minute (contrôlées ici, côté app) ;
// - pas de recherche « à chaque lettre » : la recherche part seulement sur demande ;
// - aucune valeur n'est inventée : un nutriment absent ou impossible reste vide (null).
// Seuls le code-barres ou le texte recherché quittent l'iPhone.

import { createFood } from './model.js';
import { NUTRIENT_KEYS, NUTRIENT_META } from './nutrients.js';
import { canonicalBarcode } from './barcode.js';
import { cleanLabel } from '../util/text.js';
import { isNum, formatNumber } from '../util/format.js';
import { nowIso } from '../util/dates.js';
import { APP_NAME, APP_VERSION } from '../config.js';

export const OFF_SITE = 'https://world.openfoodfacts.org';
const OFF_API = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_LEGACY_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const OFF_SEARCH = 'https://search.openfoodfacts.org/search';
const TIMEOUT_MS = 12000;

const PRODUCT_FIELDS = [
  'code', 'product_name', 'product_name_fr', 'generic_name', 'generic_name_fr', 'brands',
  'quantity', 'product_quantity_unit', 'serving_size', 'serving_quantity', 'serving_quantity_unit',
  'nutrition_data_per', 'no_nutrition_data', 'nutriments'
].join(',');

const SEARCH_FIELDS = [
  'code', 'product_name', 'product_name_fr', 'brands', 'quantity',
  'product_quantity_unit', 'serving_quantity_unit', 'nutrition_data_per', 'nutriments'
].join(',');

// Kilojoules → kilocalories (1 kcal = 4,184 kJ). Sodium → sel : × 2,5 (règlement UE 1169/2011).
// Alcool : Open Food Facts l'exprime en % vol ; 1 % vol = 0,789 g d'éthanol pour 100 ml.
const KJ_PER_KCAL = 4.184;
const SALT_PER_SODIUM = 2.5;
const ETHANOL_DENSITY = 0.789;

export class OffError extends Error {
  /** kind : 'offline' | 'timeout' | 'network' | 'rate' | 'server' | 'notfound' | 'invalid' */
  constructor(kind, message, waitSeconds = 0) {
    super(message);
    this.name = 'OffError';
    this.kind = kind;
    this.waitSeconds = waitSeconds;
  }
}

// ---------- Limites de requêtes (fenêtre glissante d'une minute) ----------

const windows = { product: { max: 15, times: [] }, search: { max: 10, times: [] } };

function takeSlot(kind) {
  const w = windows[kind];
  const now = Date.now();
  w.times = w.times.filter((t) => now - t < 60000);
  if (w.times.length >= w.max) {
    const wait = Math.ceil((60000 - (now - w.times[0])) / 1000);
    const what = kind === 'search' ? '10 recherches' : '15 fiches produit';
    throw new OffError('rate', `Limite d'Open Food Facts atteinte (${what} par minute). Réessayez dans ${wait} s.`, wait);
  }
  w.times.push(now);
}

async function getJson(url, { allow404 = false } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OffError('offline', 'Pas de connexion internet.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new OffError('timeout', 'Open Food Facts ne répond pas (délai dépassé).');
    throw new OffError('network', 'Open Food Facts est injoignable. Vérifiez la connexion.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status === 503) {
    throw new OffError('rate', 'Open Food Facts est saturé ou limite les requêtes. Réessayez dans une minute.', 60);
  }
  if (res.status === 404 && allow404) {
    try { return await res.json(); } catch { return { status: 0 }; }
  }
  if (!res.ok) throw new OffError('server', `Open Food Facts a répondu avec une erreur (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new OffError('server', 'Réponse d\'Open Food Facts illisible.');
  }
}

function appParams() {
  return `app_name=${encodeURIComponent(APP_NAME)}&app_version=${encodeURIComponent(APP_VERSION)}`;
}

// ---------- Lecture des champs ----------

function firstText(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Moteur de recherche : { fr: '…', main: '…', en: '…' }
      const t = firstText(v.fr, v.main, ...Object.values(v));
      if (t) return t;
    }
  }
  return null;
}

function brandOf(brands) {
  if (Array.isArray(brands)) return brands.find((b) => typeof b === 'string' && b.trim()) || null;
  if (typeof brands === 'string') return brands.split(',').map((s) => s.trim()).find(Boolean) || null;
  return null;
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Unité de base, selon la règle d'Open Food Facts : valeurs « pour 100 ml » si les données sont
 * indiquées pour 100 ml, ou si le produit (à défaut, la portion) se mesure en ml ; sinon pour 100 g.
 */
export function offBasis(p) {
  if (p.nutrition_data_per === '100ml') return 'ml';
  const unit = (p.product_quantity_unit || p.serving_quantity_unit || '').toLowerCase();
  return unit === 'ml' ? 'ml' : 'g';
}

/**
 * Nutriments pour 100 g ou 100 ml à partir de l'objet « nutriments » d'Open Food Facts.
 * Renvoie { per100, issues } : une valeur impossible (négative, au-delà du maximum) est écartée
 * et signalée dans issues, jamais corrigée.
 */
export function offNutrients(nutriments) {
  const n = nutriments && typeof nutriments === 'object' ? nutriments : {};
  const issues = [];
  const derived = [];
  const raw = {
    kcal: num(n['energy-kcal_100g']),
    protein: num(n.proteins_100g),
    carbs: num(n.carbohydrates_100g),
    fat: num(n.fat_100g),
    fiber: num(n.fiber_100g),
    sugars: num(n.sugars_100g),
    salt: num(n.salt_100g),
    alcohol: null
  };
  if (raw.kcal === null) {
    const kj = num(n['energy-kj_100g']) ?? num(n.energy_100g);
    if (kj !== null) {
      raw.kcal = kj / KJ_PER_KCAL;
      derived.push('énergie convertie depuis les kJ');
    }
  }
  if (raw.salt === null) {
    const sodium = num(n.sodium_100g);
    if (sodium !== null) {
      raw.salt = sodium * SALT_PER_SODIUM;
      derived.push('sel calculé depuis le sodium');
    }
  }
  const alcohol = num(n.alcohol_100g);
  if (alcohol !== null) {
    const unit = String(n.alcohol_unit || '% vol').toLowerCase();
    raw.alcohol = unit === 'g' ? alcohol : alcohol * ETHANOL_DENSITY;
  }
  const per100 = {};
  for (const k of NUTRIENT_KEYS) {
    const v = raw[k];
    if (v === null || v === undefined) { per100[k] = null; continue; }
    if (v < 0 || v > NUTRIENT_META[k].max) {
      per100[k] = null;
      issues.push(`${NUTRIENT_META[k].label} : ${formatNumber(v, 1)} ${NUTRIENT_META[k].unit} pour 100 est impossible, valeur ignorée.`);
      continue;
    }
    per100[k] = v;
  }
  return { per100, issues, derived };
}

/**
 * Transforme une fiche Open Food Facts en aliment nutrinova (non enregistré).
 * Renvoie { food, issues, derived, noData }.
 */
export function offToFood(product, requestedCode) {
  const p = product || {};
  const code = canonicalBarcode(p.code || requestedCode);
  if (!code) throw new OffError('invalid', 'Fiche Open Food Facts sans code-barres exploitable.');
  const basis = offBasis(p);
  const { per100, issues, derived } = offNutrients(p.nutriments);
  const name = cleanLabel(firstText(p.product_name_fr, p.product_name, p.generic_name_fr, p.generic_name), 200)
    || `Produit ${code}`;
  const brand = cleanLabel(brandOf(p.brands), 200) || null;

  let servingSize = null;
  let servingLabel = null;
  const sq = num(p.serving_quantity);
  const su = String(p.serving_quantity_unit || 'g').toLowerCase();
  if (isNum(sq) && sq > 0 && sq <= 5000 && su === basis) {
    servingSize = sq;
    // « 1 pot (125 g) » est gardé comme nom de portion ; « 125 g » seul n'apporte rien.
    const label = cleanLabel(p.serving_size, 60);
    servingLabel = label && !/^[\d\s.,]+\s*(g|ml|cl|l|kg)?$/i.test(label) ? label : null;
  }

  const food = createFood({
    source: 'off',
    sourceRef: code,
    barcode: code,
    name,
    brand,
    basis,
    per100,
    servingSize,
    servingLabel,
    fetchedAt: nowIso()
  });
  const noData = p.no_nutrition_data === 'on' || NUTRIENT_KEYS.every((k) => per100[k] === null);
  return { food, issues, derived, noData };
}

// ---------- Requêtes ----------

/**
 * Fiche produit par code-barres.
 * Renvoie { found: true, food, issues, derived, noData } ou { found: false, code }.
 */
export async function fetchOffProduct(barcode) {
  const code = canonicalBarcode(barcode);
  if (!code) throw new OffError('invalid', 'Code-barres invalide.');
  takeSlot('product');
  const url = `${OFF_API}${code}.json?fields=${PRODUCT_FIELDS}&lc=fr&${appParams()}`;
  const data = await getJson(url, { allow404: true });
  if (!data || data.status !== 1 || !data.product) return { found: false, code };
  return { found: true, ...offToFood(data.product, code) };
}

/** Résumé d'un résultat de recherche (affichage de la liste). */
export function offHitSummary(hit) {
  const code = canonicalBarcode(hit && hit.code);
  if (!code) return null;
  const basis = offBasis(hit);
  const { per100 } = offNutrients(hit.nutriments);
  return {
    code,
    name: cleanLabel(firstText(hit.product_name_fr, hit.product_name), 200) || `Produit ${code}`,
    brand: cleanLabel(brandOf(hit.brands), 200) || null,
    quantity: typeof hit.quantity === 'string' ? cleanLabel(hit.quantity, 40) : null,
    basis,
    kcal: per100.kcal
  };
}

function cleanQuery(q) {
  // Le moteur de recherche interprète certains caractères (: " ( ) …) : on ne garde que le texte.
  return String(q || '').replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * Recherche par nom (20 résultats au plus). Moteur de recherche d'Open Food Facts,
 * avec repli sur l'ancienne recherche si le premier ne répond pas.
 */
export async function searchOffProducts(query) {
  const q = cleanQuery(query);
  if (q.length < 2) return [];
  takeSlot('search');
  let hits;
  try {
    const url = `${OFF_SEARCH}?q=${encodeURIComponent(q)}&langs=fr&page_size=20&fields=${SEARCH_FIELDS}`;
    const data = await getJson(url);
    if (!data || !Array.isArray(data.hits)) throw new OffError('server', 'Réponse de recherche inattendue.');
    hits = data.hits;
  } catch (err) {
    if (err instanceof OffError && (err.kind === 'offline' || err.kind === 'rate')) throw err;
    const url = `${OFF_LEGACY_SEARCH}?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&lc=fr&fields=${SEARCH_FIELDS}&${appParams()}`;
    const data = await getJson(url);
    hits = data && Array.isArray(data.products) ? data.products : [];
  }
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const s = offHitSummary(hit);
    if (!s || seen.has(s.code)) continue;
    seen.add(s.code);
    out.push(s);
  }
  return out;
}

/** Adresse de la fiche sur le site Open Food Facts. */
export function offProductUrl(code) {
  return `${OFF_SITE}/product/${encodeURIComponent(code)}`;
}
