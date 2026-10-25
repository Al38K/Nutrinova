// Feuille de saisie d'une quantité : ajout d'un aliment au journal, ou modification d'une entrée.

import { h, openSheet, fieldControl, segmented, banner, toast, iconEl } from '../ui.js';
import { parseDecimal, formatNumber, formatKcal, formatGrams, isNum } from '../util/format.js';
import { scaleNutrients, checkEnergyCoherence, hasNoCoreData } from '../data/nutrients.js';
import { MEALS, MEAL_LABELS, LIMITS, ValidationError, SOURCE_LABELS } from '../data/model.js';
import { addEntry, updateEntry, deleteEntry, restoreEntry, resolveQuantity, defaultInput } from '../data/entries.js';
import { setFavorite } from '../data/foods.js';
import { ciqualLabel } from '../data/ciqual.js';
import { formatQty } from '../components/journal-parts.js';
import { openFoodForm } from './food-form.js';

const MEAL_SHORT = Object.freeze({ breakfast: 'Petit-déj.', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Snack' });

/** Nombre → texte saisissable au clavier français (virgule, 2 décimales max, sans séparateur de milliers). */
function toInputText(n) {
  if (!isNum(n)) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

function per100Line(per100, basis) {
  return `Pour 100 ${basis} : ${formatKcal(per100.kcal)} · P ${formatGrams(per100.protein)} · G ${formatGrams(per100.carbs)} · L ${formatGrams(per100.fat)}`;
}

/** Libellé de la source d'un aliment. */
export function sourceLabel(food) {
  if (!food) return null;
  if (food.source === 'ciqual') return ciqualLabel();
  if (food.source === 'off') return 'Open Food Facts (ODbL)';
  return SOURCE_LABELS[food.source] || null;
}

/**
 * Avertissements liés aux valeurs de l'aliment (jamais corrigées automatiquement).
 * onFix : action « Compléter les valeurs » (null en modification d'entrée : l'instantané est figé).
 */
export function dataWarnings(per100, basis, onFix = null) {
  const fixBtn = (label) => (onFix
    ? h('button', { type: 'button', class: 'btn btn-tinted', onclick: onFix }, iconEl('edit'), label)
    : null);
  if (hasNoCoreData(per100)) {
    return banner({
      kind: 'warning',
      title: 'Valeurs nutritionnelles inconnues',
      text: 'Cette entrée sera comptée comme manquante : les totaux du jour seront signalés partiels. Saisissez les valeurs de l\'étiquette.',
      actions: fixBtn('Compléter les valeurs')
    });
  }
  if (!isNum(per100.kcal)) {
    return banner({
      kind: 'warning',
      title: 'Calories inconnues',
      text: 'Cette entrée ne comptera pas dans le total des calories : il sera signalé partiel.',
      actions: fixBtn('Compléter les valeurs')
    });
  }
  const missing = ['protein', 'carbs', 'fat'].filter((k) => !isNum(per100[k]));
  if (missing.length) {
    const names = { protein: 'protéines', carbs: 'glucides', fat: 'lipides' };
    const several = missing.length > 1;
    return banner({
      kind: 'warning',
      title: `${several ? 'Valeurs manquantes' : 'Valeur manquante'} : ${missing.map((k) => names[k]).join(', ')}`,
      text: several ? 'Les totaux de ces macros seront signalés partiels.' : 'Le total de cette macro sera signalé partiel.',
      actions: fixBtn('Compléter les valeurs')
    });
  }
  const c = checkEnergyCoherence(per100);
  if (c.status === 'mismatch') {
    return banner({
      kind: 'warning',
      title: 'Écart de calories supérieur à 10 %',
      text: `Calories indiquées : ${formatKcal(c.declared)} pour 100 ${basis}. Calcul à partir des macros : ${formatKcal(c.computed)}. Vérifiez l'étiquette ; la valeur indiquée est conservée.`,
      actions: fixBtn('Corriger les valeurs')
    });
  }
  return null;
}

/** Remarques sur la lecture d'une fiche Open Food Facts (valeurs écartées, conversions). */
export function infoNotes(info) {
  if (!info) return null;
  const parts = [];
  if (info.issues && info.issues.length) {
    parts.push(banner({ kind: 'warning', title: 'Valeur incohérente dans la fiche', text: info.issues.join(' ') }));
  }
  if (info.derived && info.derived.length) {
    parts.push(h('p', { class: 'hint' }, `Calcul : ${info.derived.join(', ')}.`));
  }
  return parts.length ? parts : null;
}

function undoAddToast(entry, onDone) {
  toast(`Ajouté : ${MEAL_LABELS[entry.meal]}`, {
    action: {
      label: 'Annuler',
      onClick: async () => {
        try {
          await deleteEntry(entry.id);
          if (onDone) onDone();
        } catch (err) {
          toast(`Annulation impossible : ${err.message}`);
        }
      }
    }
  });
}

/** Ajout immédiat avec la quantité par défaut (1 portion ou 100 g/ml) — saisie en 2 tapotements. */
export async function quickAdd({ food, date, meal, onDone }) {
  const { inputUnit, inputValue } = defaultInput(food);
  const quantity = resolveQuantity(food, inputUnit, inputValue);
  try {
    const entry = await addEntry({ date, meal, food, quantity, inputUnit, inputValue });
    if (onDone) onDone();
    undoAddToast(entry, onDone);
  } catch (err) {
    toast(`Ajout impossible : ${err.message}`);
  }
}

/** Libellé de la quantité par défaut d'un aliment : « 1 pot (125 g) » ou « 100 g ». */
export function defaultInputLabel(food) {
  const { inputUnit, inputValue } = defaultInput(food);
  if (inputUnit === 'portion') {
    const qty = formatQty(food.servingSize, food.basis);
    const label = food.servingLabel || '';
    if (!label) return `1 portion (${qty})`;
    if (label.includes('(')) return label;                    // « 1 pot (125 g) »
    return /^\d/.test(label) ? `${label} (${qty})` : `1 ${label} (${qty})`; // « 1 pot » ou « pot »
  }
  return formatQty(inputValue, food.basis);
}

/**
 * Ouvre la feuille de quantité.
 * Ajout : { food, date, meal, onDone, info }. Modification : { entry, onDone }.
 * info (facultatif) : remarques de lecture Open Food Facts { issues, derived }.
 */
export function openEntrySheet({ food, entry, date, meal, onDone, info = null }) {
  const editing = Boolean(entry);
  let current = food || null;
  const ctx = editing
    ? {
        name: entry.nameSnapshot,
        sourceLabel: null,
        basis: entry.basis,
        per100: entry.per100Snapshot,
        servingSize: entry.inputUnit === 'portion' && entry.inputValue > 0 ? entry.quantity / entry.inputValue : null,
        servingLabel: 'Portion'
      }
    : {
        name: food.brand ? `${food.name} — ${food.brand}` : food.name,
        sourceLabel: sourceLabel(food),
        basis: food.basis,
        per100: food.per100,
        servingSize: isNum(food.servingSize) ? food.servingSize : null,
        servingLabel: food.servingLabel ? `Portion (${food.servingLabel.replace(/\s*\(.*\)\s*$/, '')})` : 'Portion'
      };

  const initial = editing
    ? { inputUnit: entry.inputUnit, inputValue: entry.inputValue }
    : defaultInput(food);
  const state = { unit: initial.inputUnit, meal: editing ? entry.meal : meal, saving: false };
  const unitWord = ctx.basis === 'ml' ? 'ml' : 'g';
  const suffixFor = (unit) => (unit === 'portion' ? 'portion(s)' : unitWord);

  const preview = h('div', { class: 'entry-preview', 'aria-live': 'polite' });

  const qty = fieldControl({
    label: 'Quantité consommée',
    id: 'entry-qty',
    value: toInputText(initial.inputValue),
    inputmode: 'decimal',
    suffix: suffixFor(state.unit),
    autofocus: true,
    enterkeyhint: 'done',
    onInput: () => update()
  });

  function currentQuantity() {
    const v = parseDecimal(qty.input.value);
    if (v === null || Number.isNaN(v) || v <= 0) return { v, quantity: NaN };
    return { v, quantity: resolveQuantity(ctx, state.unit, v) };
  }

  function update() {
    const { v, quantity } = currentQuantity();
    if (Number.isNaN(v)) qty.setError('Nombre invalide.');
    else qty.setError(null);
    const n = isNum(quantity) ? scaleNutrients(ctx.per100, quantity) : null;
    preview.replaceChildren(
      h('p', { class: 'entry-preview-kcal t-num' }, n ? formatKcal(n.kcal) : '—'),
      h('p', { class: 'hint' }, isNum(quantity) ? `pour ${formatQty(quantity, ctx.basis)}` : 'Saisissez une quantité'),
      h('div', { class: 'cluster' },
        h('span', { class: 'chip chip-protein' }, `P ${n ? formatGrams(n.protein) : '—'}`),
        h('span', { class: 'chip chip-carbs' }, `G ${n ? formatGrams(n.carbs) : '—'}`),
        h('span', { class: 'chip chip-fat' }, `L ${n ? formatGrams(n.fat) : '—'}`)
      )
    );
  }

  const unitControl = isNum(ctx.servingSize) && ctx.servingSize > 0
    ? segmented({
        label: 'Unité',
        value: state.unit,
        options: [
          { value: ctx.basis, label: ctx.basis === 'ml' ? 'Millilitres' : 'Grammes' },
          { value: 'portion', label: ctx.servingLabel }
        ],
        onChange: (unit) => {
          if (unit === state.unit) return;
          const v = parseDecimal(qty.input.value);
          if (isNum(v) && v > 0) {
            const converted = unit === 'portion' ? v / ctx.servingSize : v * ctx.servingSize;
            qty.input.value = toInputText(converted);
          }
          state.unit = unit;
          qty.setSuffix(suffixFor(unit));
          update();
        }
      })
    : null;

  const mealControl = segmented({
    label: 'Repas',
    value: state.meal,
    options: MEALS.map((m) => ({ value: m.id, label: MEAL_SHORT[m.id] })),
    onChange: (m) => { state.meal = m; }
  });
  mealControl.classList.add('segmented-sm');

  openSheet({
    title: editing ? 'Modifier l\'entrée' : 'Ajouter au journal',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, editing ? 'Enregistrer' : 'Ajouter');

      async function submit() {
        if (state.saving) return;
        const { v, quantity } = currentQuantity();
        if (v === null || Number.isNaN(v) || v <= 0) {
          qty.setError('Saisissez une quantité positive.');
          return;
        }
        if (!isNum(quantity)) {
          qty.setError('Taille de portion inconnue : saisissez la quantité en grammes.');
          return;
        }
        if (quantity > LIMITS.quantityMax) {
          qty.setError(`Maximum ${formatNumber(LIMITS.quantityMax)} ${unitWord} par entrée.`);
          return;
        }
        state.saving = true;
        submitBtn.disabled = true;
        try {
          if (editing) {
            await updateEntry(entry, { meal: state.meal, quantity, inputUnit: state.unit, inputValue: v });
            close();
            if (onDone) onDone();
            toast('Entrée modifiée');
          } else {
            const added = await addEntry({ date, meal: state.meal, food: current, quantity, inputUnit: state.unit, inputValue: v });
            close();
            if (onDone) onDone();
            undoAddToast(added, onDone);
          }
        } catch (err) {
          state.saving = false;
          submitBtn.disabled = false;
          if (err instanceof ValidationError) qty.setError(err.message);
          else toast(`Enregistrement impossible : ${err.message}`);
        }
      }

      const deleteBtn = editing
        ? h('button', {
            type: 'button',
            class: 'btn btn-destructive btn-block',
            onclick: async () => {
              try {
                const removed = await deleteEntry(entry.id);
                close();
                if (onDone) onDone();
                toast('Entrée supprimée', {
                  action: {
                    label: 'Annuler',
                    onClick: async () => {
                      try {
                        await restoreEntry(removed);
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
          }, 'Supprimer l\'entrée')
        : null;

      // Favori (ajout seulement) : enregistre l'aliment au besoin.
      let favBtn = null;
      if (!editing) {
        const paintFav = () => {
          favBtn.replaceChildren(iconEl(current.favorite ? 'starFill' : 'star'));
          favBtn.classList.toggle('is-fav', Boolean(current.favorite));
          favBtn.setAttribute('aria-label', current.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris');
          favBtn.setAttribute('aria-pressed', String(Boolean(current.favorite)));
        };
        favBtn = h('button', {
          type: 'button',
          class: 'btn btn-plain btn-icon star-btn',
          onclick: async () => {
            try {
              current = await setFavorite(current, !current.favorite);
              paintFav();
              toast(current.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
            } catch (err) {
              toast(`Favori non enregistré : ${err.message}`);
            }
          }
        });
        paintFav();
      }

      const fix = editing ? null : () => {
        close();
        openFoodForm({
          food: current,
          onSaved: (saved) => openEntrySheet({ food: saved, date, meal: state.meal, onDone })
        });
      };

      const form = h('form', {
        class: 'stack',
        novalidate: true,
        onsubmit: (e) => { e.preventDefault(); submit(); }
      },
        h('div', { class: 'entry-head' },
          h('div', { class: 'entry-head-main' },
            h('p', { class: 't-headline' }, ctx.name),
            h('p', { class: 'hint' }, [ctx.sourceLabel, per100Line(ctx.per100, ctx.basis)].filter(Boolean).join(' · '))
          ),
          favBtn
        ),
        infoNotes(info),
        dataWarnings(ctx.per100, ctx.basis, fix),
        qty.root,
        unitControl,
        preview,
        h('div', {}, h('p', { class: 'field-label' }, 'Repas'), mealControl),
        submitBtn,
        deleteBtn
      );
      update();
      return form;
    }
  });
}
