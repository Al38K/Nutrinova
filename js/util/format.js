// Formatage et lecture des nombres en français.
// Règle du projet : on arrondit UNIQUEMENT à l'affichage ; une valeur absente (null) s'affiche « — ».

export const MISSING = '—';

const formatters = new Map();
function nf(decimals) {
  if (!formatters.has(decimals)) {
    formatters.set(decimals, new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    }));
  }
  return formatters.get(decimals);
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Nombre → texte français (virgule décimale) ; null/undefined → « — ». */
export function formatNumber(value, decimals = 0) {
  return isNum(value) ? nf(decimals).format(value) : MISSING;
}

/** Énergie : entier. */
export function formatKcal(value) {
  return isNum(value) ? `${nf(0).format(value)} kcal` : MISSING;
}

/** Grammes : 1 décimale sous 10 g, entier au-delà. */
export function formatGrams(value) {
  if (!isNum(value)) return MISSING;
  const decimals = Math.abs(value) < 10 ? 1 : 0;
  return `${nf(decimals).format(value)} g`;
}

/** Valeur d'un nutriment selon sa clé ; le sel garde 2 décimales sous 1 g. */
export function formatNutrient(key, value) {
  if (!isNum(value)) return MISSING;
  if (key === 'kcal') return formatKcal(value);
  if (key === 'salt' && Math.abs(value) < 1) return `${nf(2).format(value)} g`;
  return formatGrams(value);
}

export function formatBytes(bytes) {
  if (!isNum(bytes)) return MISSING;
  if (bytes < 1024) return `${nf(0).format(bytes)} o`;
  if (bytes < 1024 * 1024) return `${nf(1).format(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${nf(1).format(bytes / (1024 * 1024))} Mo`;
  return `${nf(2).format(bytes / (1024 * 1024 * 1024))} Go`;
}

/**
 * Lit un nombre saisi au clavier français : « 12,5 », « 12.5 », « 1 250 ».
 * Renvoie null si le champ est vide, NaN si la saisie est invalide.
 */
export function parseDecimal(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  return Number(s);
}
