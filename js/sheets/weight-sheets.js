// Feuilles de l'onglet Poids : saisie ou modification d'une pesée, réglage du rappel hebdomadaire
// (bannière dans l'app + événement récurrent pour l'app Calendrier).

import { h, openSheet, fieldControl, banner, toast, iconEl, switchInput } from '../ui.js';
import { parseDecimal, formatNumber, isNum } from '../util/format.js';
import { localDateKey, isDateKey, formatDayLong } from '../util/dates.js';
import { ValidationError, LIMITS } from '../data/model.js';
import { saveWeight, deleteWeight, restoreWeights, previousWeight, hasAtMostOneDecimal, BIG_CHANGE_KG } from '../data/weights.js';
import { getReminder, saveReminder, buildReminderIcs, nextOccurrence, DAY_LABELS, ICS_FILENAME } from '../data/reminder.js';
import { formatKg } from '../components/weight-chart.js';

/** 70.4 → « 70,4 » */
function toInputText(v) {
  return isNum(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '';
}

/**
 * Saisie d'une pesée. weights : toutes les pesées (triées), pour signaler un remplacement
 * ou un écart inhabituel. weight : pesée à modifier (facultatif). onDone() après enregistrement.
 */
export function openWeightSheet({ weights = [], weight = null, onDone }) {
  const editing = Boolean(weight);
  const today = localDateKey();
  const byDate = new Map(weights.map((w) => [w.date, w]));
  const latest = weights.length ? weights[weights.length - 1] : null;

  const date = fieldControl({ label: 'Date', id: 'weight-date', type: 'date', value: editing ? weight.date : today, onInput: () => { date.setError(null); update(); } });
  date.input.max = today;
  const kg = fieldControl({
    label: 'Poids',
    id: 'weight-kg',
    value: editing ? toInputText(weight.weightKg) : '',
    inputmode: 'decimal',
    suffix: 'kg',
    placeholder: latest ? `ex. ${toInputText(latest.weightKg)}` : 'ex. 70,4',
    autofocus: true,
    enterkeyhint: 'done',
    onInput: () => { kg.setError(null); update(); }
  });
  const note = fieldControl({ label: 'Note', id: 'weight-note', value: editing && weight.note ? weight.note : '', placeholder: 'facultatif (ex. après le sport)', maxlength: LIMITS.noteMax });
  const notices = h('div', { class: 'stack', 'aria-live': 'polite' });

  function update() {
    const d = date.input.value;
    const v = parseDecimal(kg.input.value);
    const parts = [];
    const existing = isDateKey(d) ? byDate.get(d) : null;
    if (existing && (!editing || existing.date !== weight.date)) {
      parts.push(banner({
        kind: 'warning',
        text: `Une pesée existe déjà le ${formatDayLong(d).toLowerCase()} (${formatKg(existing.weightKg)}) : elle sera remplacée. Une seule pesée par jour.`
      }));
    }
    if (isNum(v) && isDateKey(d)) {
      const prev = previousWeight(weights.filter((w) => !editing || w.date !== weight.date), d);
      if (prev && Math.abs(v - prev.weightKg) > BIG_CHANGE_KG) {
        parts.push(banner({
          kind: 'info',
          text: `Écart de ${formatNumber(Math.abs(v - prev.weightKg), 1)} kg avec la pesée du ${formatDayLong(prev.date).toLowerCase()} (${formatKg(prev.weightKg)}). Vérifiez la saisie ; l'enregistrement reste possible.`
        }));
      }
    }
    notices.replaceChildren(...parts);
  }

  openSheet({
    title: editing ? 'Modifier la pesée' : 'Nouvelle pesée',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer');
      let saving = false;

      async function submit() {
        if (saving) return;
        date.setError(null);
        kg.setError(null);
        note.setError(null);
        const d = date.input.value;
        const v = parseDecimal(kg.input.value);
        let invalid = false;
        if (!isDateKey(d)) { date.setError('Choisissez une date.'); invalid = true; }
        else if (d > today) { date.setError('La date ne peut pas être dans le futur.'); invalid = true; }
        if (v === null) { kg.setError('Saisissez votre poids.'); invalid = true; }
        else if (Number.isNaN(v)) { kg.setError('Nombre invalide.'); invalid = true; }
        else if (!hasAtMostOneDecimal(v)) { kg.setError('Une décimale au maximum (ex. 70,4).'); invalid = true; }
        if (invalid) return;
        saving = true;
        submitBtn.disabled = true;
        try {
          const { replaced } = await saveWeight(
            { date: d, weightKg: v, note: note.input.value },
            { originalDate: editing ? weight.date : null, today }
          );
          close();
          if (onDone) onDone();
          toast(replaced ? 'Pesée remplacée' : editing ? 'Pesée modifiée' : 'Pesée enregistrée');
        } catch (err) {
          saving = false;
          submitBtn.disabled = false;
          if (err instanceof ValidationError) {
            const target = { date, weightKg: kg, note }[err.field];
            if (target) target.setError(err.message);
            else kg.setError(err.message);
          } else {
            toast(`Enregistrement impossible : ${err.message}`);
          }
        }
      }

      const deleteBtn = editing
        ? h('button', {
            type: 'button',
            class: 'btn btn-destructive btn-block',
            onclick: async () => {
              try {
                const removed = await deleteWeight(weight.date);
                close();
                if (onDone) onDone();
                toast('Pesée supprimée', {
                  action: {
                    label: 'Annuler',
                    onClick: async () => {
                      try {
                        await restoreWeights([removed]);
                        if (onDone) onDone();
                      } catch (err) {
                        toast(`Annulation impossible : ${err.message}`);
                      }
                    }
                  }
                });
              } catch (err) {
                toast(`Suppression impossible : ${err.message}`);
              }
            }
          }, iconEl('trash'), 'Supprimer la pesée')
        : null;

      const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'form-grid' }, kg.root, date.root),
        notices,
        note.root,
        h('p', { class: 'hint' }, 'En kilogrammes, une décimale. Pour comparer d\'une semaine à l\'autre, pesez-vous dans les mêmes conditions (au réveil, avant de manger).'),
        submitBtn,
        deleteBtn
      );
      update();
      return form;
    }
  });
}

// ---------- Rappel hebdomadaire ----------

/** Bannière « pesée à faire » (status : résultat de reminderStatus) ; null si rien à faire. */
export function weighBanner(status, onWeigh) {
  if (!status || !status.due) return null;
  return banner({
    kind: 'info',
    title: status.isToday ? 'C\'est le jour de la pesée' : `Pesée du ${formatDayLong(localDateKey(status.occurrence)).toLowerCase()} à faire`,
    text: 'Saisissez votre poids pour suivre votre courbe.',
    actions: h('button', { type: 'button', class: 'btn btn-tinted', onclick: onWeigh }, iconEl('plus'), 'Saisir mon poids')
  });
}

function appUrl() {
  return `${location.origin}${location.pathname}#/weight`;
}

function icsFile(reminder) {
  const text = buildReminderIcs(reminder, { appUrl: appUrl() });
  return { text, file: new File([text], ICS_FILENAME, { type: 'text/calendar' }) };
}

function canShare(file) {
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

function download(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = ICS_FILENAME;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const nextFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Réglage du rappel : actif ou non, jour, heure ; ajout de l'événement récurrent au Calendrier. */
export async function openReminderSheet({ onDone } = {}) {
  let reminder;
  try {
    reminder = await getReminder();
  } catch (err) {
    toast(`Rappel illisible : ${err.message}`);
    return;
  }
  const state = { ...reminder };

  openSheet({
    title: 'Rappel de pesée',
    closeLabel: 'OK',
    content: () => {
      const summary = h('p', { class: 'hint', 'aria-live': 'polite' });
      const daySelect = h('select', {
        class: 'input select',
        id: 'reminder-day',
        onchange: (e) => { state.day = Number(e.target.value); persist(); }
      }, DAY_LABELS.map((label, i) => h('option', { value: String(i), selected: i === state.day || null }, label)));
      const timeInput = h('input', {
        class: 'input',
        id: 'reminder-time',
        type: 'time',
        value: state.time,
        step: '300',
        onchange: (e) => {
          if (/^\d{2}:\d{2}$/.test(e.target.value)) { state.time = e.target.value; persist(); } else e.target.value = state.time;
        }
      });
      const enabled = switchInput({ checked: state.enabled, label: 'Rappel dans l\'app', onChange: (v) => { state.enabled = v; persist(); } });
      const calendarBlock = h('div', { class: 'stack' });

      function paint() {
        summary.textContent = state.enabled
          ? `Prochaine pesée : ${nextFmt.format(nextOccurrence(state))}. Une bannière s'affiche dans le Journal et l'onglet Poids à partir de ce moment, jusqu'à la saisie du poids.`
          : 'Bannière désactivée. L\'événement du Calendrier, s\'il a été ajouté, continue de vous prévenir.';
      }

      async function persist() {
        paint();
        try {
          await saveReminder(state);
          if (onDone) onDone();
        } catch (err) {
          toast(`Rappel non enregistré : ${err.message}`);
        }
      }

      const addBtn = h('button', {
        type: 'button',
        class: 'btn btn-primary btn-lg btn-block',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const { text, file } = icsFile(state);
          if (!canShare(file)) {
            download(text);
            toast('Fichier téléchargé : ouvrez-le depuis l\'app Fichiers › Téléchargements', { duration: 6000 });
            return;
          }
          btn.disabled = true;
          try {
            await navigator.share({ files: [file] });
          } catch (err) {
            if (!err || err.name !== 'AbortError') {
              toast(`Partage impossible : ${err.message}. Essayez « Télécharger le fichier ».`, { duration: 6000 });
            }
          } finally {
            btn.disabled = false;
          }
        }
      }, iconEl('calendar'), 'Ajouter au Calendrier…');

      const downloadBtn = h('button', {
        type: 'button',
        class: 'btn btn-plain btn-block',
        onclick: () => {
          download(icsFile(state).text);
          toast('Fichier téléchargé : app Fichiers › Téléchargements', { duration: 5000 });
        }
      }, iconEl('download'), 'Télécharger le fichier .ics');

      calendarBlock.append(
        h('p', { class: 't-headline' }, 'Notification sur l\'iPhone'),
        h('p', { class: 'hint' }, 'nutrinova ne peut pas envoyer de notification elle-même (il faudrait un serveur). L\'app Calendrier de l\'iPhone, elle, le peut : ajoutez-y un événement chaque semaine, avec une alerte à l\'heure choisie.'),
        addBtn,
        downloadBtn,
        h('p', { class: 'hint' }, 'Dans le menu Partager, choisissez « Calendrier » s\'il est proposé. Sinon, « Enregistrer dans Fichiers », puis ouvrez le fichier depuis l\'app Fichiers et touchez « Ajouter tout ». Si vous changez le jour ou l\'heure, supprimez l\'ancien événement « Pesée hebdomadaire » du Calendrier avant d\'ajouter le nouveau.')
      );

      paint();
      return h('div', { class: 'stack' },
        h('div', { class: 'list' },
          h('label', { class: 'row' },
            h('span', { class: 'row-main' },
              h('span', { class: 'row-title' }, 'Bannière dans l\'app'),
              h('span', { class: 'row-subtitle' }, 'Journal et onglet Poids')
            ),
            enabled
          )
        ),
        h('div', { class: 'form-grid' },
          h('label', { class: 'field', for: 'reminder-day' }, h('span', { class: 'field-label' }, 'Jour'), h('span', { class: 'input-wrap' }, daySelect)),
          h('label', { class: 'field', for: 'reminder-time' }, h('span', { class: 'field-label' }, 'Heure'), h('span', { class: 'input-wrap' }, timeInput))
        ),
        summary,
        h('div', { class: 'card' }, calendarBlock)
      );
    }
  });
}
