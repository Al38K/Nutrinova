// Onglet Journal — écran d'accueil : navigation entre les jours, anneau calorique,
// barres de macros (restant), 4 cartes repas. Tout se met à jour après chaque ajout,
// modification ou suppression.

import { h, mount, setAppbar, installBanner, iconEl, ring, macroBar, banner, section, row } from '../ui.js';
import { localDateKey, isDateKey, addDays, formatDayLong, dayTitle, daysSince } from '../util/dates.js';
import { formatNumber, formatKcal, isNum } from '../util/format.js';
import { MEALS } from '../data/model.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { getEntriesForDate, computeTotals, countEntries } from '../data/entries.js';
import { getGoalForDate, goalTargets, goalMacroSummary } from '../data/goals.js';
import { getSetting } from '../data/settings.js';
import { entryRow, macroLine, remainingCaption, partialNote } from '../components/journal-parts.js';
import { openFoodPicker } from '../sheets/food-picker.js';
import { openEntrySheet } from '../sheets/entry-sheet.js';
import { openExportSheet } from '../sheets/backup-sheets.js';
import { latestWeight, listWeights } from '../data/weights.js';
import { getReminder, reminderStatus } from '../data/reminder.js';
import { openWeightSheet, weighBanner } from '../sheets/weight-sheets.js';
import { refresh } from '../router.js';

const DEFAULT_BACKUP_REMINDER_DAYS = 7;

function dayNav(date, navigate) {
  const picker = h('input', {
    type: 'date',
    class: 'daynav-picker',
    value: date,
    'aria-label': 'Choisir une date',
    onchange: (e) => {
      const v = e.target.value;
      if (isDateKey(v) && v !== date) navigate(`journal/${v}`);
    }
  });
  return h('nav', { class: 'daynav', 'aria-label': 'Changer de jour' },
    h('a', { class: 'daynav-btn', href: `#/journal/${addDays(date, -1)}`, 'aria-label': 'Jour précédent' }, iconEl('chevronLeft')),
    h('div', { class: 'daynav-center' },
      h('span', { class: 'daynav-label' }, formatDayLong(date)),
      iconEl('calendar', 'daynav-cal'),
      picker
    ),
    h('a', { class: 'daynav-btn', href: `#/journal/${addDays(date, 1)}`, 'aria-label': 'Jour suivant' }, iconEl('chevronRight'))
  );
}

function hero(date, consumed, target) {
  const hasGoal = isNum(target);
  let centerNumber;
  let centerLabel;
  let ringValue = consumed;
  if (!isNum(consumed)) {
    centerNumber = '—';
    centerLabel = hasGoal ? 'kcal restantes' : 'kcal consommées';
    ringValue = null;
  } else if (hasGoal) {
    const r = Math.round(target - consumed);
    centerNumber = formatNumber(Math.abs(r));
    centerLabel = r >= 0 ? 'kcal restantes' : 'kcal en trop';
  } else {
    centerNumber = formatNumber(consumed);
    centerLabel = 'kcal consommées';
  }
  return h('a', { class: 'hero', href: `#/day/${date}`, 'aria-label': 'Détail du jour' },
    h('div', { class: 'hero-stat' },
      h('span', { class: 'hero-num' }, formatNumber(consumed)),
      h('span', { class: 'hero-lbl' }, 'Consommées')
    ),
    ring({ value: ringValue, goal: target, centerNumber, centerLabel, size: 148, stroke: 12, onBrand: true }),
    h('div', { class: 'hero-stat' },
      h('span', { class: 'hero-num' }, hasGoal ? formatNumber(target) : '—'),
      h('span', { class: 'hero-lbl' }, 'Objectif')
    )
  );
}

function macrosCard(values, targets) {
  return h('section', { class: 'card', 'aria-label': 'Macronutriments' },
    ['protein', 'carbs', 'fat'].map((k) => macroBar({
      kind: k,
      label: NUTRIENT_META[k].label,
      value: values[k],
      goal: targets[k],
      caption: remainingCaption(values[k], targets[k])
    }))
  );
}

function mealCard({ meal, date, data }) {
  const hasEntries = data.entries.length > 0;
  const head = h('div', { class: 'meal-head' },
    h('a', { class: 'meal-title-link', href: `#/meal/${date}/${meal.id}` },
      h('span', { class: 'meal-title' }, meal.label, iconEl('chevronRight', 'meal-chevron')),
      h('span', { class: 'meal-sub' }, hasEntries ? macroLine(data.values) : 'Aucun aliment')
    ),
    hasEntries ? h('span', { class: 'meal-kcal t-num' }, formatKcal(data.values.kcal)) : null,
    h('button', {
      type: 'button',
      class: 'btn btn-tinted btn-icon meal-add',
      'aria-label': `Ajouter un aliment : ${meal.label}`,
      onclick: () => openFoodPicker({ date, meal: meal.id, onDone: refresh })
    }, iconEl('plus'))
  );
  return h('section', { class: 'card meal-card', 'aria-label': meal.label },
    head,
    hasEntries
      ? h('div', { class: 'meal-entries' }, data.entries.map((e) => entryRow(e, (entry) => openEntrySheet({ entry, onDone: refresh }))))
      : null
  );
}

async function backupReminder(date, today) {
  if (date !== today) return null;
  const [total, lastBackupAt, reminderDays] = await Promise.all([
    countEntries(),
    getSetting('lastBackupAt'),
    getSetting('backupReminderDays')
  ]);
  if (!total) return null;
  const every = Number.isInteger(reminderDays) && reminderDays > 0 ? reminderDays : DEFAULT_BACKUP_REMINDER_DAYS;
  const since = daysSince(lastBackupAt);
  if (since !== null && since < every) return null;
  return banner({
    kind: 'info',
    title: since === null ? 'Aucune sauvegarde pour l\'instant' : `Dernière sauvegarde il y a ${formatNumber(since)} jours`,
    text: 'Vos données ne sont que sur cet iPhone. Enregistrez une copie dans Fichiers (iCloud Drive).',
    actions: h('button', {
      type: 'button',
      class: 'btn btn-tinted',
      onclick: () => openExportSheet({ onDone: refresh })
    }, 'Sauvegarder maintenant')
  });
}

/** Bannière de pesée (aujourd'hui seulement) : pesée prévue non saisie. Ne bloque jamais le Journal. */
async function weighReminder(date, today) {
  if (date !== today) return null;
  try {
    const [reminder, latest] = await Promise.all([getReminder(), latestWeight()]);
    const status = reminderStatus(reminder, latest ? latest.date : null);
    return weighBanner(status, async () => {
      const weights = await listWeights();
      openWeightSheet({ weights, onDone: refresh });
    });
  } catch (err) {
    console.warn('Rappel de pesée non évalué :', err);
    return null;
  }
}

export default {
  tab: 'journal',
  async render(root, { params, navigate }) {
    const today = localDateKey();
    const date = params[0] && isDateKey(params[0]) ? params[0] : today;

    setAppbar({
      title: dayTitle(date, today),
      trailing: date !== today
        ? h('a', { class: 'appbar-btn', href: '#/journal' }, 'Aujourd\'hui')
        : h('a', { class: 'appbar-btn', href: '#/goals', 'aria-label': 'Objectifs' }, iconEl('target'))
    });

    const [entries, goal, reminder, weighing] = await Promise.all([
      getEntriesForDate(date),
      getGoalForDate(date),
      backupReminder(date, today),
      weighReminder(date, today)
    ]);
    const totals = computeTotals(entries);
    const targets = goalTargets(goal);
    const day = totals.day;

    mount(root,
      installBanner(),
      weighing,
      reminder,
      dayNav(date, navigate),
      hero(date, day.values.kcal, targets.kcal),
      day.count ? partialNote(day.missing.kcal) : null,
      goal
        ? macrosCard(day.values, targets)
        : h('section', { class: 'card stack' },
            h('p', { class: 't-headline' }, 'Aucun objectif pour ce jour'),
            h('p', { class: 'hint' }, 'Définissez vos calories et vos macros pour suivre ce qu\'il vous reste à chaque repas.'),
            h('a', { class: 'btn btn-primary btn-block', href: '#/goals' }, iconEl('target'), 'Définir mes objectifs')
          ),
      MEALS.map((meal) => mealCard({ meal, date, data: totals.meals[meal.id] })),
      section({
        rows: [
          row({ title: 'Détail du jour', subtitle: 'Tous les nutriments, répartition par repas', iconName: 'chart', href: `#/day/${date}` }),
          row({ title: 'Objectifs', subtitle: goal ? `${formatKcal(goal.kcal)} · ${goalMacroSummary(goal)}` : 'Non définis', iconName: 'target', href: '#/goals' })
        ]
      })
    );
  }
};
