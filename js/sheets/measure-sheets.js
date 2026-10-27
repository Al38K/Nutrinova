// Feuilles des mensurations : saisie ou modification d'une série de mesures, choix des mesures suivies.

import { h, openSheet, fieldControl, toast, switchInput } from '../ui.js';
import { parseDecimal, isNum } from '../util/format.js';
import { localDateKey, formatDayLong } from '../util/dates.js';
import { ValidationError } from '../data/model.js';
import { MEASURES, MEASURE_BY_ID, saveMeasurement, latestById, saveTracked, formatMeasure } from '../data/measurements.js';

function toInputText(v) {
  return isNum(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '';
}

/**
 * Saisie (measurement absent) ou modification d'une série de mesures.
 * list : toutes les saisies (pour proposer les dernières valeurs et signaler un remplacement) ;
 * tracked : mesures suivies (affichées) ; une mesure déjà saisie mais non suivie reste affichée en modification.
 */
export function openMeasureSheet({ list = [], measurement = null, tracked, onDone }) {
  const editing = Boolean(measurement);
  const today = localDateKey();
  const byDate = new Map(list.map((m) => [m.date, m]));
  const latest = latestById(list);
  const ids = MEASURES.map((m) => m.id).filter((id) => tracked.includes(id) || (editing && isNum(measurement.values[id])));

  const date = fieldControl({ label: 'Date', id: 'measure-date', type: 'date', value: editing ? measurement.date : today, onInput: () => { date.setError(null); paintReplace(); } });
  date.input.max = today;
  const fields = {};
  for (const id of ids) {
    const m = MEASURE_BY_ID[id];
    const last = latest[id] ? latest[id].last.value : null;
    fields[id] = fieldControl({
      label: m.short,
      id: `measure-${id}`,
      value: editing ? toInputText(measurement.values[id]) : '',
      inputmode: 'decimal',
      suffix: m.unit,
      placeholder: isNum(last) ? toInputText(last) : '—',
      onInput: () => { fields[id].setError(null); formError.textContent = ''; }
    });
  }
  const note = fieldControl({ label: 'Note', id: 'measure-note', value: editing && measurement.note ? measurement.note : '', placeholder: 'facultatif', maxlength: 200 });
  const formError = h('p', { class: 'field-error', 'aria-live': 'polite' });
  const replaceHint = h('p', { class: 'hint text-warning', hidden: true });

  function paintReplace() {
    const d = date.input.value;
    const other = byDate.get(d);
    const replacing = other && (!editing || d !== measurement.date);
    replaceHint.hidden = !replacing;
    if (replacing) replaceHint.textContent = `Des mesures existent déjà le ${formatDayLong(d)} : elles seront remplacées.`;
  }

  openSheet({
    title: editing ? 'Modifier les mesures' : 'Nouvelles mesures',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer');

      async function submit() {
        const values = {};
        let bad = false;
        for (const id of ids) {
          const v = parseDecimal(fields[id].input.value);
          if (v === null) continue;
          if (Number.isNaN(v)) { fields[id].setError('Nombre invalide.'); bad = true; continue; }
          values[id] = v;
        }
        if (bad) return;
        if (!date.input.value) { date.setError('Choisissez une date.'); return; }
        submitBtn.disabled = true;
        try {
          const { replaced } = await saveMeasurement(
            { date: date.input.value, values, note: note.input.value },
            { originalDate: editing ? measurement.date : null, today }
          );
          close();
          toast(replaced ? 'Mesures remplacées' : editing ? 'Mesures modifiées' : 'Mesures enregistrées');
          if (onDone) onDone();
        } catch (err) {
          submitBtn.disabled = false;
          if (err instanceof ValidationError) {
            if (fields[err.field]) fields[err.field].setError(err.message);
            else if (err.field === 'date') date.setError(err.message);
            else formError.textContent = err.message;
          } else {
            toast(`Enregistrement impossible : ${err.message}`);
          }
        }
      }

      paintReplace();
      return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
        date.root,
        replaceHint,
        ids.length
          ? h('div', { class: 'form-grid' }, ids.map((id) => fields[id].root))
          : h('p', { class: 'hint' }, 'Aucune mensuration suivie : choisissez-les dans l\'onglet Corps › Mensurations.'),
        h('p', { class: 'hint' }, 'Laissez vide ce que vous n\'avez pas mesuré. En gris : votre dernière valeur. Mesurez au réveil, avec un ruban souple, sans serrer.'),
        note.root,
        formError,
        submitBtn
      );
    }
  });
}

/** Choix des mensurations suivies (affichées dans la saisie et dans les courbes). */
export function openTrackedSheet({ tracked, onDone }) {
  const selected = new Set(tracked);
  openSheet({
    title: 'Mensurations suivies',
    content: () => h('div', { class: 'stack' },
      h('div', { class: 'list' }, MEASURES.map((m) => h('label', { class: 'row' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, m.label),
          h('span', { class: 'row-subtitle' }, `${m.unit === '%' ? '%' : 'cm'} · ${m.hint}`)
        ),
        switchInput({
          checked: selected.has(m.id),
          label: m.label,
          onChange: async (on) => {
            if (on) selected.add(m.id); else selected.delete(m.id);
            try {
              await saveTracked([...selected]);
              if (onDone) onDone();
            } catch (err) {
              toast(`Réglage non enregistré : ${err.message}`);
            }
          }
        })
      ))),
      h('p', { class: 'hint' }, 'Les mesures déjà saisies sont conservées même si vous ne les suivez plus.')
    )
  });
}

export { formatMeasure };
