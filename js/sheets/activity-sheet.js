// Feuille de saisie d'une activité : calories dépensées, saisies à la main (montre, appareil…).
// L'app n'estime jamais ces calories elle-même.

import { h, openSheet, fieldControl, toast } from '../ui.js';
import { parseDecimal, formatNumber, isNum } from '../util/format.js';
import { formatDayLong } from '../util/dates.js';
import { ValidationError, LIMITS } from '../data/model.js';
import { saveActivity, deleteActivity, restoreActivity, ACTIVITY_SUGGESTIONS } from '../data/activities.js';

function toInputText(v) {
  return isNum(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '';
}

/** Supprime une activité avec « Annuler ». onDone() après suppression et après annulation. */
export async function removeActivity(activity, onDone) {
  let removed;
  try {
    removed = await deleteActivity(activity.id);
  } catch (err) {
    toast(`Suppression impossible : ${err.message}`);
    return;
  }
  if (onDone) onDone();
  toast(`Activité supprimée : ${activity.name}`, {
    duration: 5000,
    action: {
      label: 'Annuler',
      onClick: async () => {
        try {
          if (removed) await restoreActivity(removed);
        } catch (err) {
          toast(`Annulation impossible : ${err.message}`);
        }
        if (onDone) onDone();
      }
    }
  });
}

/**
 * Ajout (date) ou modification (activity) d'une activité. onDone() après enregistrement.
 */
export function openActivitySheet({ date, activity = null, onDone }) {
  const editing = Boolean(activity);
  const day = editing ? activity.date : date;

  const name = fieldControl({
    label: 'Activité',
    id: 'activity-name',
    value: editing ? activity.name : '',
    placeholder: 'ex. Marche rapide 45 min',
    maxlength: 80,
    enterkeyhint: 'next'
  });
  const kcal = fieldControl({
    label: 'Calories dépensées',
    id: 'activity-kcal',
    value: editing ? toInputText(activity.kcal) : '',
    inputmode: 'decimal',
    suffix: 'kcal',
    placeholder: 'ex. 250',
    autofocus: !editing,
    onInput: () => kcal.setError(null)
  });

  const chips = h('div', { class: 'cluster', role: 'group', 'aria-label': 'Suggestions' },
    ACTIVITY_SUGGESTIONS.map((s) => h('button', {
      type: 'button',
      class: 'chip chip-brand chip-btn',
      onclick: () => { name.input.value = s; kcal.input.focus(); }
    }, s))
  );

  openSheet({
    title: editing ? 'Modifier l\'activité' : 'Ajouter une activité',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, editing ? 'Enregistrer' : 'Ajouter');

      async function submit() {
        const v = parseDecimal(kcal.input.value);
        if (v === null) { kcal.setError('Saisissez les calories dépensées.'); kcal.input.focus(); return; }
        if (Number.isNaN(v) || v <= 0) { kcal.setError('Nombre positif attendu.'); kcal.input.focus(); return; }
        if (v > LIMITS.activityKcalMax) { kcal.setError(`Maximum ${formatNumber(LIMITS.activityKcalMax)} kcal par activité.`); return; }
        submitBtn.disabled = true;
        try {
          const saved = await saveActivity({ date: day, name: name.input.value, kcal: v }, activity);
          close();
          toast(editing ? 'Activité modifiée' : `Ajouté : ${saved.name}, ${formatNumber(saved.kcal)} kcal`);
          if (onDone) onDone();
        } catch (err) {
          submitBtn.disabled = false;
          if (err instanceof ValidationError) kcal.setError(err.message);
          else toast(`Enregistrement impossible : ${err.message}`);
        }
      }

      return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('p', { class: 't-footnote t-secondary' }, formatDayLong(day)),
        name.root,
        editing ? null : chips,
        kcal.root,
        h('p', { class: 'hint' }, 'Saisissez les calories indiquées par votre montre, votre appareil ou votre app de sport. Elles s\'ajoutent à votre objectif du jour ; les objectifs de macros ne changent pas.'),
        submitBtn,
        editing
          ? h('button', {
              type: 'button',
              class: 'btn btn-destructive btn-block',
              onclick: () => { close(); removeActivity(activity, onDone); }
            }, 'Supprimer l\'activité')
          : null
      );
    }
  });
}
