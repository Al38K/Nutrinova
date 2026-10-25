// Vue détaillée d'un jour : #/day/AAAA-MM-JJ
// Bilan consommé / objectif / reste, tous les nutriments, répartition de l'énergie, détail par repas.

import { h, mount, setAppbar, backButton, section, row } from '../ui.js';
import { localDateKey, isDateKey, dayTitle, formatDayLong, formatDayShort } from '../util/dates.js';
import { formatNumber, isNum } from '../util/format.js';
import { MEALS } from '../data/model.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { getEntriesForDate, computeTotals } from '../data/entries.js';
import { getGoalForDate, goalTargets, goalPercents, goalMacroSummary } from '../data/goals.js';
import { partialNote } from '../components/journal-parts.js';
import { energySplit } from '../components/energy-split.js';

const MAIN_KEYS = ['kcal', 'protein', 'carbs', 'fat'];
const OTHER_KEYS = ['sugars', 'fiber', 'salt', 'alcohol'];

/** Nombre pour un tableau (unité dans l'en-tête) : kcal entier, g à 1 décimale sous 10, sel à 2 sous 1. */
function num(key, v) {
  if (!isNum(v)) return '—';
  if (key === 'kcal') return formatNumber(v, 0);
  if (key === 'salt' && Math.abs(v) < 1) return formatNumber(v, 2);
  return formatNumber(v, Math.abs(v) < 10 ? 1 : 0);
}

function mark(totals, key) {
  return totals.count && totals.incomplete.has(key) && isNum(totals.values[key]) ? ' *' : '';
}

function unitOf(key) {
  return key === 'kcal' ? 'kcal' : 'g';
}

function balanceTable(totals, targets) {
  const rows = MAIN_KEYS.map((k) => {
    const v = totals.values[k];
    const t = targets[k];
    const rest = isNum(t) && isNum(v) ? t - v : null;
    const over = isNum(rest) && Math.round(rest) < 0;
    return h('tr', {},
      h('th', { scope: 'row' }, k === 'kcal' ? 'Énergie (kcal)' : `${NUTRIENT_META[k].label} (g)`),
      h('td', {}, `${num(k, v)}${mark(totals, k)}`),
      h('td', {}, num(k, t)),
      h('td', { class: over ? 'is-over' : '' }, isNum(rest) ? (over ? `+${num(k, -rest)}` : num(k, rest)) : '—')
    );
  });
  return h('table', { class: 'ntable' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, ''),
      h('th', { scope: 'col' }, 'Consommé'),
      h('th', { scope: 'col' }, 'Objectif'),
      h('th', { scope: 'col' }, 'Reste')
    )),
    h('tbody', {}, rows)
  );
}

function otherTable(totals) {
  return h('table', { class: 'ntable' },
    h('tbody', {}, OTHER_KEYS.map((k) => h('tr', {},
      h('th', { scope: 'row' }, `${NUTRIENT_META[k].label} (${unitOf(k)})`),
      h('td', {}, `${num(k, totals.values[k])}${mark(totals, k)}`)
    )))
  );
}

function mealsTable(totals) {
  const dayKcal = totals.day.values.kcal;
  return h('table', { class: 'ntable ntable-compact' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Repas'),
      h('th', { scope: 'col' }, 'kcal'),
      h('th', { scope: 'col' }, 'P'),
      h('th', { scope: 'col' }, 'G'),
      h('th', { scope: 'col' }, 'L'),
      h('th', { scope: 'col' }, '%')
    )),
    h('tbody', {}, MEALS.map((m) => {
      const t = totals.meals[m.id];
      const share = t.count && isNum(t.values.kcal) && isNum(dayKcal) && dayKcal > 0 ? (t.values.kcal / dayKcal) * 100 : null;
      return h('tr', {},
        h('th', { scope: 'row' }, h('a', { href: `#/meal/${totals.date}/${m.id}` }, m.label)),
        h('td', {}, `${num('kcal', t.values.kcal)}${mark(t, 'kcal')}`),
        h('td', {}, num('protein', t.values.protein)),
        h('td', {}, num('carbs', t.values.carbs)),
        h('td', {}, num('fat', t.values.fat)),
        h('td', {}, share !== null ? formatNumber(share) : '—')
      );
    }))
  );
}

export default {
  tab: 'journal',
  async render(root, { params }) {
    const date = isDateKey(params[0]) ? params[0] : localDateKey();
    setAppbar({ title: 'Détail du jour', leading: backButton(`#/journal/${date}`, 'Journal') });

    const [entries, goal] = await Promise.all([getEntriesForDate(date), getGoalForDate(date)]);
    const totals = computeTotals(entries);
    totals.date = date;
    const day = totals.day;
    const targets = goalTargets(goal);
    const anyIncomplete = [...MAIN_KEYS, ...OTHER_KEYS].some((k) => mark(day, k));
    const title = dayTitle(date);

    mount(root,
      h('div', {},
        h('p', { class: 't-footnote t-secondary' }, title === formatDayLong(date) ? 'Bilan' : title),
        h('p', { class: 't-title-2' }, formatDayLong(date))
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Bilan du jour'),
        balanceTable(day, targets),
        day.count ? partialNote(day.missing.kcal) : h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Aucun aliment saisi ce jour-là.')
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Répartition de l\'énergie'),
        energySplit(day.values, goal ? goalPercents(goal) : null)
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Autres nutriments'),
        otherTable(day)
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Par repas'),
        mealsTable(totals),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, 'P, G, L en grammes. % = part des calories du jour.')
      ),
      anyIncomplete ? h('p', { class: 'hint' }, '* Total partiel : au moins un aliment n\'a pas cette valeur ; le chiffre affiché est un minimum.') : null,
      section({
        header: 'Objectif appliqué',
        rows: [goal
          ? row({ title: `Depuis le ${formatDayShort(goal.effectiveFrom)}`, subtitle: `${formatNumber(goal.kcal)} kcal · ${goalMacroSummary(goal)}`, iconName: 'target', href: '#/goals' })
          : row({ title: 'Aucun objectif pour ce jour', iconName: 'target', href: '#/goals' })]
      })
    );
  }
};
