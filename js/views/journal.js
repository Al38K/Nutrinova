// Onglet Journal — écran d'accueil : navigation entre les jours, anneau calorique,
// barres de macros (restant), 4 cartes repas. Tout se met à jour après chaque ajout,
// modification ou suppression.

import { h, mount, setAppbar, installBanner, iconEl, ring, macroBar, banner, section, row, toast } from '../ui.js';
import { localDateKey, isDateKey, addDays, formatDayLong, dayTitle } from '../util/dates.js';
import { formatNumber, formatKcal, formatNutrient, isNum } from '../util/format.js';
import { MEALS } from '../data/model.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { getEntriesForDate, computeTotals, deleteEntry, restoreEntry } from '../data/entries.js';
import { getGoalForDate, goalTargets, goalMacroSummary } from '../data/goals.js';
import { getSetting, setSetting } from '../data/settings.js';
import { entryRow, remainingCaption, partialNote } from '../components/journal-parts.js';
import { openFoodPicker } from '../sheets/food-picker.js';
import { openEntrySheet } from '../sheets/entry-sheet.js';
import { openExportSheet } from '../sheets/backup-sheets.js';
import { backupReminderStatus, countPersonalData } from '../data/backup.js';
import { latestWeight, listWeights } from '../data/weights.js';
import { getReminder, reminderStatus } from '../data/reminder.js';
import { openWeightSheet, weighBanner } from '../sheets/weight-sheets.js';
import { getActivitiesForDate, burnedKcal, kcalBudget } from '../data/activities.js';
import { openActivitySheet, removeActivity } from '../sheets/activity-sheet.js';
import { swipeToDelete, deleteWithUndo } from '../components/swipe.js';
import { refresh } from '../router.js';

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

/**
 * Bandeau calorique : consommées · anneau (restantes) · dépensées.
 * Restant = objectif + calories dépensées (activité) − consommées.
 */
function hero(date, consumed, target, burned) {
  const hasGoal = isNum(target);
  const budget = kcalBudget(target, burned);
  let centerNumber;
  let centerLabel;
  let ringValue = consumed;
  if (!isNum(consumed)) {
    centerNumber = '—';
    centerLabel = hasGoal ? 'kcal restantes' : 'kcal consommées';
    ringValue = null;
  } else if (hasGoal) {
    const r = Math.round(budget - consumed);
    centerNumber = formatNumber(Math.abs(r));
    centerLabel = r >= 0 ? 'kcal restantes' : 'kcal en trop';
  } else {
    centerNumber = formatNumber(consumed);
    centerLabel = 'kcal consommées';
  }
  const goalLine = hasGoal
    ? (burned > 0
        ? `Objectif ${formatNumber(target)} + ${formatNumber(burned)} kcal d'activité = ${formatNumber(budget)} kcal`
        : `Objectif ${formatNumber(target)} kcal`)
    : 'Aucun objectif pour ce jour';
  return h('a', { class: 'hero', href: `#/day/${date}`, 'aria-label': `Détail du jour. ${goalLine}` },
    h('div', { class: 'hero-stat' },
      h('span', { class: 'hero-num' }, formatNumber(consumed)),
      h('span', { class: 'hero-lbl' }, 'Consommées')
    ),
    ring({ value: ringValue, goal: budget, centerNumber, centerLabel, size: 148, stroke: 12, onBrand: true }),
    h('div', { class: 'hero-stat' },
      h('span', { class: 'hero-num' }, formatNumber(burned)),
      h('span', { class: 'hero-lbl' }, 'Dépensées')
    ),
    h('p', { class: 'hero-foot' }, goalLine)
  );
}

// Carte des macros dépliée ou non : mémorisée sur cet iPhone (simple confort d'affichage).
const MACROS_OPEN_KEY = 'nutrinova.macrosOpen';
function readMacrosOpen() {
  try { return localStorage.getItem(MACROS_OPEN_KEY) === '1'; } catch { return false; }
}
function writeMacrosOpen(open) {
  try { localStorage.setItem(MACROS_OPEN_KEY, open ? '1' : '0'); } catch { /* sans conséquence */ }
}

const EXTRA_KEYS = ['fiber', 'sugars', 'salt', 'alcohol'];

/**
 * Carte des macros : protéines, glucides, lipides (restant), puis, en dépliant,
 * fibres, sucres, sel et alcool consommés (sans objectif).
 */
function macrosCard(day, targets) {
  const { values, missing } = day;
  let open = readMacrosOpen();
  const extra = h('dl', { class: 'kv macro-extra', id: 'macro-extra' },
    EXTRA_KEYS.flatMap((k) => [
      h('dt', { class: k === 'sugars' ? 'kv-sub' : '' }, NUTRIENT_META[k].label),
      h('dd', {}, `${formatNutrient(k, values[k])}${missing[k] && isNum(values[k]) ? ' *' : ''}`)
    ])
  );
  const anyPartial = EXTRA_KEYS.some((k) => missing[k] && isNum(values[k]));
  const note = anyPartial ? h('p', { class: 'hint macro-extra-note' }, '* Total partiel : au moins un aliment n\'a pas cette valeur.') : null;
  const label = h('span', {});
  const chevron = iconEl('chevronDown', 'macro-toggle-chevron');
  const toggle = h('button', {
    type: 'button',
    class: 'macro-toggle',
    'aria-controls': 'macro-extra',
    onclick: () => { open = !open; writeMacrosOpen(open); sync(); }
  }, label, chevron);
  const card = h('section', { class: 'card macros-card', 'aria-label': 'Macronutriments' },
    ['protein', 'carbs', 'fat'].map((k) => macroBar({
      kind: k,
      label: NUTRIENT_META[k].label,
      value: values[k],
      goal: targets[k],
      caption: remainingCaption(values[k], targets[k])
    })),
    extra,
    note,
    toggle
  );
  function sync() {
    extra.hidden = !open;
    if (note) note.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    label.textContent = open ? 'Moins de nutriments' : 'Fibres, sucres, sel, alcool';
    card.classList.toggle('is-open', open);
  }
  sync();
  return card;
}

/** Carte Activité : calories dépensées saisies à la main, ajoutées à l'objectif du jour. */
function activityCard(date, activities, burned) {
  const add = () => openActivitySheet({ date, onDone: refresh });
  const head = h('div', { class: 'meal-head' },
    h('div', { class: 'meal-title-link' },
      h('span', { class: 'meal-title' }, iconEl('flame', 'activity-icon'), 'Activité'),
      activities.length ? null : h('span', { class: 'meal-sub' }, 'Calories dépensées, ajoutées à l\'objectif')
    ),
    activities.length ? h('span', { class: 'meal-kcal t-num' }, `${formatNumber(burned)} kcal`) : null,
    h('button', { type: 'button', class: 'btn btn-tinted btn-icon meal-add', 'aria-label': 'Ajouter une activité', onclick: add }, iconEl('plus'))
  );
  return h('section', { class: 'card meal-card activity-card', 'aria-label': 'Activité' },
    head,
    activities.length
      ? h('div', { class: 'meal-entries' }, activities.map((a) => swipeToDelete(
          h('button', {
            type: 'button',
            class: 'entry-row entry-row-compact',
            onclick: () => openActivitySheet({ activity: a, onDone: refresh })
          },
            h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, a.name)),
            h('span', { class: 'entry-kcal t-num' }, `${formatNumber(a.kcal)} kcal`)
          ),
          { label: a.name, onDelete: () => removeActivity(a, refresh) }
        )))
      : null
  );
}

/** Entrée du journal glissable vers la gauche pour la supprimer (avec « Annuler »). */
function swipeEntry(rowEl, entry) {
  return swipeToDelete(rowEl, {
    label: entry.nameSnapshot,
    onDelete: () => deleteWithUndo({
      remove: () => deleteEntry(entry.id),
      restore: restoreEntry,
      message: `Supprimé : ${entry.nameSnapshot}`,
      onDone: refresh
    })
  });
}

/**
 * Carte repas : titre, kcal du repas, bouton +, et la liste des aliments (nom et kcal seulement).
 * Toucher le titre ouvre la vue Repas : quantités, macros et nutriments de chaque aliment.
 */
function mealCard({ meal, date, data }) {
  const hasEntries = data.entries.length > 0;
  const head = h('div', { class: 'meal-head' },
    h('a', { class: 'meal-title-link', href: `#/meal/${date}/${meal.id}`, 'aria-label': `${meal.label} : détail du repas` },
      h('span', { class: 'meal-title' }, meal.label, iconEl('chevronRight', 'meal-chevron')),
      hasEntries ? null : h('span', { class: 'meal-sub' }, 'Aucun aliment')
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
      ? h('div', { class: 'meal-entries' }, data.entries.map((e) => swipeEntry(entryRow(e, (entry) => openEntrySheet({ entry, onDone: refresh }), { compact: true }), e)))
      : null
  );
}

/** Bannière de sauvegarde (aujourd'hui seulement), selon la fréquence choisie dans Réglages. */
async function backupReminder(date, today) {
  if (date !== today) return null;
  try {
    const [dataCount, lastBackupAt, reminderDays, hiddenOn] = await Promise.all([
      countPersonalData(),
      getSetting('lastBackupAt'),
      getSetting('backupReminderDays'),
      getSetting('backupBannerHiddenOn')
    ]);
    const { due, since } = backupReminderStatus({ lastBackupAt, reminderDays, dataCount, hiddenOn });
    if (!due) return null;
    return banner({
      kind: 'info',
      title: since === null ? 'Aucune sauvegarde pour l\'instant' : `Dernière sauvegarde il y a ${formatNumber(since)} jours`,
      text: 'Vos données ne sont que sur cet iPhone. Enregistrez une copie dans Fichiers (iCloud Drive). Fréquence du rappel : Réglages › Rappel de sauvegarde.',
      actions: h('button', {
        type: 'button',
        class: 'btn btn-tinted',
        onclick: () => openExportSheet({ onDone: refresh })
      }, 'Sauvegarder maintenant'),
      onClose: () => {
        setSetting('backupBannerHiddenOn', today).catch((err) => console.warn('Fermeture non enregistrée :', err));
        toast('Rappel masqué jusqu\'à demain');
      }
    });
  } catch (err) {
    console.warn('Rappel de sauvegarde non évalué :', err);
    return null;
  }
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

    const [entries, goal, reminder, weighing, activities] = await Promise.all([
      getEntriesForDate(date),
      getGoalForDate(date),
      backupReminder(date, today),
      weighReminder(date, today),
      getActivitiesForDate(date).catch((err) => { console.warn('Activités non lues :', err); return []; })
    ]);
    const burned = burnedKcal(activities);
    const totals = computeTotals(entries);
    const targets = goalTargets(goal);
    const day = totals.day;

    mount(root,
      installBanner(),
      weighing,
      reminder,
      dayNav(date, navigate),
      hero(date, day.values.kcal, targets.kcal, burned),
      day.count ? partialNote(day.missing.kcal) : null,
      goal
        ? macrosCard(day, targets)
        : h('section', { class: 'card stack' },
            h('p', { class: 't-headline' }, 'Aucun objectif pour ce jour'),
            h('p', { class: 'hint' }, 'Définissez vos calories et vos macros pour suivre ce qu\'il vous reste à chaque repas.'),
            h('a', { class: 'btn btn-primary btn-block', href: '#/goals' }, iconEl('target'), 'Définir mes objectifs')
          ),
      MEALS.map((meal) => mealCard({ meal, date, data: totals.meals[meal.id] })),
      activityCard(date, activities, burned),
      section({
        rows: [
          row({ title: 'Détail du jour', subtitle: 'Tous les nutriments, répartition par repas', iconName: 'chart', href: `#/day/${date}` }),
          row({ title: 'Objectifs', subtitle: goal ? `${formatKcal(goal.kcal)} · ${goalMacroSummary(goal)}` : 'Non définis', iconName: 'target', href: '#/goals' })
        ]
      })
    );
  }
};
