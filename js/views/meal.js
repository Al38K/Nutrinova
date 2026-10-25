// Vue détaillée d'un repas : #/meal/AAAA-MM-JJ/lunch

import { h, mount, setAppbar, backButton, iconEl, emptyState, section, row } from '../ui.js';
import { localDateKey, isDateKey, dayTitle } from '../util/dates.js';
import { formatNumber, formatNutrient, isNum } from '../util/format.js';
import { MEAL_IDS, MEAL_LABELS } from '../data/model.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { getEntriesForDate, computeTotals } from '../data/entries.js';
import { entryRow, partialNote } from '../components/journal-parts.js';
import { energySplit } from '../components/energy-split.js';
import { openFoodPicker } from '../sheets/food-picker.js';
import { openEntrySheet } from '../sheets/entry-sheet.js';
import { refresh } from '../router.js';

const DETAIL_KEYS = ['protein', 'carbs', 'sugars', 'fat', 'fiber', 'salt', 'alcohol'];

function nutrientRows(values, incomplete) {
  return DETAIL_KEYS.map((k) => row({
    title: NUTRIENT_META[k].label,
    className: k === 'sugars' ? 'row-sub' : '',
    value: `${formatNutrient(k, values[k])}${incomplete.has(k) && isNum(values[k]) ? ' *' : ''}`
  }));
}

export default {
  tab: 'journal',
  async render(root, { params, navigate }) {
    const date = isDateKey(params[0]) ? params[0] : localDateKey();
    const mealId = MEAL_IDS.includes(params[1]) ? params[1] : null;
    if (!mealId) {
      navigate(`journal/${date}`, { replace: true });
      return;
    }
    const add = () => openFoodPicker({ date, meal: mealId, onDone: refresh });
    setAppbar({
      title: MEAL_LABELS[mealId],
      leading: backButton(`#/journal/${date}`, 'Journal'),
      trailing: h('button', { type: 'button', class: 'appbar-btn', 'aria-label': `Ajouter un aliment : ${MEAL_LABELS[mealId]}`, onclick: add }, iconEl('plus'))
    });

    const entries = await getEntriesForDate(date);
    const totals = computeTotals(entries);
    const meal = totals.meals[mealId];
    const dayKcal = totals.day.values.kcal;
    const share = isNum(meal.values.kcal) && isNum(dayKcal) && dayKcal > 0 ? (meal.values.kcal / dayKcal) * 100 : null;

    const head = h('div', {},
      h('p', { class: 't-footnote t-secondary' }, dayTitle(date)),
      h('p', { class: 't-title-2' }, MEAL_LABELS[mealId])
    );

    if (!meal.count) {
      mount(root, head, emptyState({
        iconName: 'journal',
        title: 'Aucun aliment',
        text: 'Ajoutez un aliment à ce repas.',
        action: h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, iconEl('plus'), 'Ajouter un aliment')
      }));
      return;
    }

    const anyIncomplete = DETAIL_KEYS.some((k) => meal.incomplete.has(k) && isNum(meal.values[k]));
    mount(root,
      head,
      h('section', { class: 'card stack' },
        h('div', { class: 'big-stat' },
          h('span', { class: 'big-stat-num t-num' }, formatNumber(meal.values.kcal)),
          h('span', { class: 'big-stat-unit' }, 'kcal'),
          share !== null ? h('span', { class: 'chip chip-brand' }, `${formatNumber(share)} % du jour`) : null
        ),
        energySplit(meal.values),
        partialNote(meal.missing.kcal)
      ),
      section({
        header: 'Nutriments du repas',
        rows: nutrientRows(meal.values, meal.incomplete),
        footer: anyIncomplete ? '* Total partiel : au moins un aliment n\'a pas cette valeur.' : null
      }),
      h('section', {},
        h('h2', { class: 'section-header' }, `Aliments (${meal.count})`),
        h('div', { class: 'list' }, meal.entries.map((e) => entryRow(e, (entry) => openEntrySheet({ entry, onDone: refresh })))),
        h('p', { class: 'section-footer' }, 'Touchez un aliment pour modifier la quantité, changer de repas ou le supprimer.')
      ),
      h('button', { type: 'button', class: 'btn btn-tinted btn-lg btn-block', onclick: add }, iconEl('plus'), 'Ajouter un aliment')
    );
  }
};
