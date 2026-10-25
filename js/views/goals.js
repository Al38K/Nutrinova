// Réglage des objectifs journaliers : #/goals
// Calories + macros en grammes ou en % de l'énergie. Chaque objectif a une date d'effet :
// les jours précédents gardent l'objectif qui était en vigueur.

import { h, mount, setAppbar, iconEl, fieldControl, segmented, banner, toast, confirmDialog } from '../ui.js';
import { localDateKey, isDateKey, formatDayShort } from '../util/dates.js';
import { parseDecimal, formatNumber, formatKcal, isNum } from '../util/format.js';
import { ValidationError } from '../data/model.js';
import { ENERGY_FACTORS, MACRO_KEYS, NUTRIENT_META } from '../data/nutrients.js';
import { getGoalForDate, listGoals, saveGoal, deleteGoal, goalTargets, goalPercents, goalWarnings, goalMacroSummary, energyOfMacros } from '../data/goals.js';
import { refresh } from '../router.js';

function toInputText(n, decimals = 1) {
  if (!isNum(n)) return '';
  const f = 10 ** decimals;
  return String(Math.round(n * f) / f).replace('.', ',');
}

function backControl(navigate) {
  return h('button', {
    type: 'button',
    class: 'appbar-btn',
    onclick: () => (history.length > 1 ? history.back() : navigate('journal'))
  }, iconEl('chevronLeft'), h('span', {}, 'Retour'));
}

export default {
  tab: 'journal',
  async render(root, { navigate }) {
    setAppbar({ title: 'Objectifs', leading: backControl(navigate) });

    const today = localDateKey();
    const [current, goals] = await Promise.all([getGoalForDate(today), listGoals()]);
    const state = { mode: current ? current.mode : 'grams', saving: false };

    const from = fieldControl({ label: 'S\'applique à partir du', id: 'goal-from', type: 'date', value: today });
    const kcal = fieldControl({ label: 'Calories par jour', id: 'goal-kcal', inputmode: 'numeric', suffix: 'kcal', placeholder: 'ex. 2000', onInput: () => updateSummary() });
    const macros = {};
    for (const k of MACRO_KEYS) {
      macros[k] = fieldControl({
        label: NUTRIENT_META[k].label,
        id: `goal-${k}`,
        inputmode: 'decimal',
        suffix: state.mode === 'percent' ? '%' : 'g',
        placeholder: '—',
        onInput: () => updateSummary()
      });
    }
    const summary = h('div', { class: 'stack', 'aria-live': 'polite' });
    const formError = h('div', { 'aria-live': 'polite' });

    function fill(goal) {
      from.input.value = goal && goal.effectiveFrom > today ? goal.effectiveFrom : today;
      kcal.input.value = goal ? toInputText(goal.kcal, 0) : '';
      for (const k of MACRO_KEYS) macros[k].input.value = goal ? toInputText(goal[k]) : '';
      setMode(goal ? goal.mode : 'grams', false);
    }

    function readDraft() {
      const draft = { effectiveFrom: from.input.value, kcal: parseDecimal(kcal.input.value), mode: state.mode };
      for (const k of MACRO_KEYS) draft[k] = parseDecimal(macros[k].input.value);
      return draft;
    }

    function updateSummary() {
      const d = readDraft();
      const parts = [];
      const allMacros = MACRO_KEYS.every((k) => isNum(d[k]));
      if (state.mode === 'percent') {
        const known = MACRO_KEYS.filter((k) => isNum(d[k]));
        if (known.length) {
          const total = known.reduce((s, k) => s + d[k], 0);
          const off = allMacros && Math.abs(total - 100) > 0.5;
          parts.push(h('p', { class: `t-subhead ${off ? 'text-warning' : ''}` }, `Total : ${formatNumber(total, 1)} % ${allMacros ? (off ? '— doit faire 100 %' : '✓') : '(renseignez les trois)'}`));
        }
        if (isNum(d.kcal) && d.kcal > 0 && allMacros) {
          const t = goalTargets({ ...d });
          parts.push(h('p', { class: 'hint' }, `Soit ${MACRO_KEYS.map((k) => `${NUTRIENT_META[k].label.toLowerCase()} ${formatNumber(t[k])} g`).join(', ')} par jour.`));
        }
      } else if (allMacros) {
        const energy = energyOfMacros(d);
        const pct = isNum(d.kcal) && d.kcal > 0 ? goalPercents({ ...d }) : null;
        parts.push(h('p', { class: 'hint' },
          `Vos macros représentent ${formatNumber(energy)} kcal${pct ? ` (${MACRO_KEYS.map((k) => `${NUTRIENT_META[k].short} ${formatNumber(pct[k])} %`).join(' · ')})` : ''}.`));
      }
      for (const w of goalWarnings({ ...d, kcal: isNum(d.kcal) ? d.kcal : null })) {
        parts.push(banner({ kind: w.kind === 'warning' ? 'warning' : 'info', text: w.text }));
      }
      summary.replaceChildren(...parts);
    }

    function setMode(mode, convert) {
      if (convert && mode !== state.mode) {
        const k0 = parseDecimal(kcal.input.value);
        for (const k of MACRO_KEYS) {
          const v = parseDecimal(macros[k].input.value);
          if (!isNum(k0) || k0 <= 0 || !isNum(v)) continue;
          const next = mode === 'percent'
            ? (v * ENERGY_FACTORS[k] * 100) / k0
            : (k0 * v) / 100 / ENERGY_FACTORS[k];
          macros[k].input.value = toInputText(next, mode === 'percent' ? 1 : 0);
        }
      }
      state.mode = mode;
      for (const k of MACRO_KEYS) macros[k].setSuffix(mode === 'percent' ? '%' : 'g');
      modeControl.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 'grams' : 'percent') === mode)));
      updateSummary();
    }

    const modeControl = segmented({
      label: 'Unité des macros',
      value: state.mode,
      options: [{ value: 'grams', label: 'Grammes' }, { value: 'percent', label: '% des calories' }],
      onChange: (m) => setMode(m, true)
    });

    async function submit() {
      if (state.saving) return;
      formError.replaceChildren();
      for (const f of [from, kcal, ...Object.values(macros)]) f.setError(null);
      const d = readDraft();
      let invalid = false;
      if (!isDateKey(d.effectiveFrom)) { from.setError('Choisissez une date.'); invalid = true; }
      if (Number.isNaN(d.kcal)) { kcal.setError('Nombre invalide.'); invalid = true; }
      for (const k of MACRO_KEYS) if (Number.isNaN(d[k])) { macros[k].setError('Nombre invalide.'); invalid = true; }
      if (invalid) return;
      state.saving = true;
      saveBtn.disabled = true;
      try {
        const saved = await saveGoal(d);
        toast(saved.effectiveFrom > today
          ? `Objectif enregistré, appliqué à partir du ${formatDayShort(saved.effectiveFrom)}`
          : 'Objectif enregistré');
        refresh();
      } catch (err) {
        state.saving = false;
        saveBtn.disabled = false;
        if (err instanceof ValidationError) {
          const target = { kcal, effectiveFrom: from, protein: macros.protein, carbs: macros.carbs, fat: macros.fat }[err.field];
          if (target) target.setError(err.message);
          else formError.replaceChildren(banner({ kind: 'danger', text: err.message }));
        } else {
          formError.replaceChildren(banner({ kind: 'danger', text: `Enregistrement impossible : ${err.message}` }));
        }
      }
    }

    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer l\'objectif');

    const form = h('form', { class: 'card stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
      kcal.root,
      h('div', {}, h('p', { class: 'field-label' }, 'Macros'), modeControl),
      h('div', { class: 'form-grid form-grid-3' }, MACRO_KEYS.map((k) => macros[k].root)),
      h('p', { class: 'hint' }, 'Les macros sont facultatives : laissez-les vides pour un objectif calorique seul.'),
      summary,
      from.root,
      h('p', { class: 'hint' }, 'Les jours précédant cette date gardent leur ancien objectif. Une date future programme un changement.'),
      formError,
      saveBtn
    );

    const historyRows = goals.map((g) => {
      const status = current && g.id === current.id ? 'En cours' : g.effectiveFrom > today ? 'À venir' : null;
      const t = goalTargets(g);
      const detail = g.mode === 'percent' && MACRO_KEYS.every((k) => isNum(t[k]))
        ? ` (${MACRO_KEYS.map((k) => `${formatNumber(t[k])} g`).join(' / ')})`
        : '';
      return h('div', { class: 'pick-row' },
        h('button', {
          type: 'button',
          class: 'pick-main',
          onclick: () => {
            fill(g);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            toast('Valeurs chargées dans le formulaire');
          }
        },
          h('span', { class: 'pick-name' },
            `Depuis le ${formatDayShort(g.effectiveFrom)}`,
            status ? h('span', { class: `chip ${status === 'En cours' ? 'chip-brand' : ''} chip-inline` }, status) : null
          ),
          h('span', { class: 'pick-sub' }, `${formatKcal(g.kcal)} · ${goalMacroSummary(g)}${detail}`)
        ),
        h('button', {
          type: 'button',
          class: 'btn btn-plain btn-icon pick-side text-danger',
          'aria-label': `Supprimer l'objectif du ${formatDayShort(g.effectiveFrom)}`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Supprimer cet objectif ?',
              text: `Les jours à partir du ${formatDayShort(g.effectiveFrom)} utiliseront l'objectif précédent, s'il existe.`,
              confirmLabel: 'Supprimer',
              destructive: true
            });
            if (!ok) return;
            try {
              await deleteGoal(g.id);
              toast('Objectif supprimé');
              refresh();
            } catch (err) {
              toast(`Suppression impossible : ${err.message}`);
            }
          }
        }, iconEl('trash'))
      );
    });

    mount(root,
      current
        ? h('section', { class: 'card' },
            h('p', { class: 't-footnote t-secondary' }, 'Objectif en cours'),
            h('p', { class: 't-title-2 t-num' }, formatKcal(current.kcal)),
            h('p', { class: 'hint' }, `${goalMacroSummary(current)} · depuis le ${formatDayShort(current.effectiveFrom)}`)
          )
        : banner({ title: 'Aucun objectif en cours', text: 'Renseignez au moins vos calories journalières.' }),
      h('section', {}, h('h2', { class: 'section-header' }, current ? 'Nouvel objectif' : 'Définir un objectif'), form),
      goals.length
        ? h('section', {},
            h('h2', { class: 'section-header' }, 'Historique'),
            h('div', { class: 'pick-list' }, historyRows),
            h('p', { class: 'section-footer' }, 'Touchez un objectif pour recharger ses valeurs dans le formulaire.')
          )
        : null
    );

    fill(current);
  }
};
