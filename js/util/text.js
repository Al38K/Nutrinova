// Normalisation de texte pour la recherche : minuscules, sans accents, sans ponctuation.
// « Crème brûlée — Œuf » → « creme brulee oeuf »

const LIGATURES = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss' };

export function normalizeName(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[œŒæÆß]/g, (c) => LIGATURES[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** Nettoie un libellé saisi : espaces superflus retirés, longueur bornée. */
export function cleanLabel(value, maxLength = 200) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
