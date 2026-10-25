// Répartition de l'énergie entre protéines, glucides et lipides (barre empilée + légende).
// Calculée à partir des grammes consommés (4 / 4 / 9 kcal par gramme). Rien n'est affiché
// si l'une des trois macros est inconnue.

import { h } from '../ui.js';
import { formatNumber, isNum } from '../util/format.js';
import { ENERGY_FACTORS } from '../data/nutrients.js';

const PARTS = [
  { key: 'protein', label: 'Protéines' },
  { key: 'carbs', label: 'Glucides' },
  { key: 'fat', label: 'Lipides' }
];

/** Pourcentages d'énergie des macros ; null si non calculable. */
export function energyShares(values) {
  if (!values || !PARTS.every((p) => isNum(values[p.key]))) return null;
  const kcal = PARTS.map((p) => values[p.key] * ENERGY_FACTORS[p.key]);
  const total = kcal.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return Object.fromEntries(PARTS.map((p, i) => [p.key, (kcal[i] / total) * 100]));
}

/** targetPercents facultatif : { protein, carbs, fat } en % (objectif) affiché dans la légende. */
export function energySplit(values, targetPercents = null) {
  const shares = energyShares(values);
  if (!shares) {
    return h('p', { class: 'hint' }, 'Répartition de l\'énergie : — (macros incomplètes ou nulles).');
  }
  const bar = h('div', { class: 'split', role: 'img', 'aria-label': PARTS.map((p) => `${p.label} ${formatNumber(shares[p.key])} %`).join(', ') },
    PARTS.map((p) => {
      const seg = h('span', { class: `split-${p.key}` });
      seg.style.width = `${shares[p.key]}%`;
      return seg;
    })
  );
  const legend = h('div', { class: 'split-legend' },
    PARTS.map((p) => h('span', {},
      h('span', { class: `dot split-${p.key}` }),
      `${p.label} ${formatNumber(shares[p.key])} %`,
      targetPercents && isNum(targetPercents[p.key]) ? h('span', { class: 't-secondary' }, ` (obj. ${formatNumber(targetPercents[p.key])} %)`) : null
    ))
  );
  return h('div', { class: 'split-wrap' }, bar, legend);
}
