// Recherche textuelle commune (vos aliments et table Ciqual).
// Chaque mot saisi doit apparaître dans le nom (sans accents ni majuscules) ; un mot au pluriel
// (« pommes », « choux ») trouve aussi le singulier. Les noms qui commencent par le premier mot
// et les noms courts passent devant.

import { normalizeName } from '../util/text.js';

/** Mots de la recherche, normalisés. */
export function queryWords(query) {
  return normalizeName(query).split(' ').filter(Boolean);
}

function findWord(text, word) {
  let idx = text.indexOf(word);
  if (idx >= 0) return { idx, len: word.length };
  if (word.length > 3 && /[sx]$/.test(word)) {
    const stem = word.slice(0, -1);
    idx = text.indexOf(stem);
    if (idx >= 0) return { idx, len: stem.length };
  }
  return null;
}

/** Score de pertinence d'un nom normalisé ; -1 si un mot manque. */
export function matchScore(nameNorm, words) {
  if (!words.length) return 0;
  const text = nameNorm || '';
  let score = 0;
  for (let i = 0; i < words.length; i += 1) {
    const hit = findWord(text, words[i]);
    if (!hit) return -1;
    if (hit.idx === 0) score += i === 0 ? 60 : 20;
    else if (text[hit.idx - 1] === ' ') score += 25;
    const end = hit.idx + hit.len;
    if (end === text.length || text[end] === ' ') score += 10;
  }
  return score - text.length / 8;
}

/** Aliments créés par vous (aliments personnalisés et recettes) : prioritaires dans la recherche. */
export function isPersonal(food) {
  return food.source === 'custom' || food.source === 'recipe';
}

/**
 * Vos aliments correspondant à la recherche. Ordre : aliments personnalisés et recettes d'abord,
 * puis favoris, puis pertinence, puis dernière utilisation.
 */
export function rankLocalFoods(foods, query) {
  const words = queryWords(query);
  if (!words.length) return [];
  const scored = [];
  for (const food of foods) {
    const score = matchScore(food.nameNorm, words);
    if (score >= 0) scored.push({ food, score });
  }
  scored.sort((a, b) => {
    const ca = isPersonal(a.food) ? 0 : 1;
    const cb = isPersonal(b.food) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if (Boolean(a.food.favorite) !== Boolean(b.food.favorite)) return a.food.favorite ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    const la = a.food.lastUsedAt || '';
    const lb = b.food.lastUsedAt || '';
    if (la !== lb) return la < lb ? 1 : -1;
    return a.food.name.localeCompare(b.food.name, 'fr', { sensitivity: 'base' });
  });
  return scored.map((s) => s.food);
}
