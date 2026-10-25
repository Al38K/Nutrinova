// Formulaire d'aliment : création d'un aliment personnalisé, ou modification d'un aliment existant
// (valeurs pour 100 g ou 100 ml). Un champ laissé vide = valeur inconnue (« — »), jamais 0.
// Modifier un aliment venant de Ciqual ou d'Open Food Facts en fait un aliment personnel.

import { h, openSheet, fieldControl, segmented, banner, toast } from '../ui.js';
import { parseDecimal, formatKcal, isNum } from '../util/format.js';
import { NUTRIENT_KEYS, NUTRIENT_META, checkEnergyCoherence } from '../data/nutrients.js';
import { ValidationError, SOURCE_LABELS } from '../data/model.js';
import { saveCustomFood, updateFood, isStored } from '../data/foods.js';
import { checkBarcode } from '../data/barcode.js';

// Ordre d'affichage, comme sur une étiquette nutritionnelle européenne.
const FIELD_ORDER = ['kcal', 'fat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'alcohol'];
const FIELD_LABELS = { ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, NUTRIENT_META[k].label])), kcal: 'Énergie' };

/** Nombre → texte saisissable (virgule, 3 décimales au plus). */
function toInputText(n) {
  if (!isNum(n)) return '';
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/**
 * Ouvre le formulaire.
 * - Création : { initialName, barcode, onSaved }.
 * - Modification ou complément : { food, onSaved } (aliment enregistré ou résultat de recherche).
 * onSaved(food) est appelé après l'enregistrement.
 */
export function openFoodForm({ food = null, initialName = '', barcode = '', onSaved } = {}) {
  const editing = Boolean(food);
  const state = { basis: food ? food.basis : 'g', saving: false };

  const name = fieldControl({ label: 'Nom *', id: 'food-name', value: food ? food.name : initialName, placeholder: 'ex. Yaourt nature', maxlength: 200, enterkeyhint: 'next' });
  const brand = fieldControl({ label: 'Marque', id: 'food-brand', value: food && food.brand ? food.brand : '', placeholder: 'facultatif', maxlength: 200, enterkeyhint: 'next' });
  const code = fieldControl({ label: 'Code-barres', id: 'food-barcode', value: food && food.barcode ? food.barcode : barcode, inputmode: 'numeric', placeholder: 'facultatif', maxlength: 18, enterkeyhint: 'next' });
  const nutrients = {};
  for (const k of FIELD_ORDER) {
    nutrients[k] = fieldControl({
      label: FIELD_LABELS[k],
      id: `food-${k}`,
      value: food ? toInputText(food.per100[k]) : '',
      inputmode: 'decimal',
      placeholder: '—',
      suffix: k === 'kcal' ? 'kcal' : 'g',
      enterkeyhint: 'next',
      onInput: () => checkLive()
    });
  }
  const servingSize = fieldControl({ label: 'Taille de portion', id: 'food-serving', value: food ? toInputText(food.servingSize) : '', inputmode: 'decimal', placeholder: 'facultatif', suffix: state.basis, enterkeyhint: 'next' });
  const servingLabel = fieldControl({ label: 'Nom de la portion', id: 'food-serving-label', value: food && food.servingLabel ? food.servingLabel : '', placeholder: 'ex. 1 pot', maxlength: 60 });
  const per100Title = h('h3', { class: 'section-header form-section' }, `Valeurs pour 100 ${state.basis}`);
  const coherence = h('div', { 'aria-live': 'polite' });

  function readNutrients() {
    const per100 = {};
    let invalid = false;
    for (const k of FIELD_ORDER) {
      const v = parseDecimal(nutrients[k].input.value);
      if (Number.isNaN(v)) {
        invalid = true;
        per100[k] = null;
      } else {
        per100[k] = v;
      }
    }
    return { per100, invalid };
  }

  function checkLive() {
    const { per100 } = readNutrients();
    const c = checkEnergyCoherence(per100);
    coherence.replaceChildren(c.status === 'mismatch'
      ? banner({
          kind: 'warning',
          title: 'Écart de calories supérieur à 10 %',
          text: `Énergie saisie : ${formatKcal(c.declared)}. Calcul à partir des macros : ${formatKcal(c.computed)}. Vérifiez l'étiquette. L'enregistrement reste possible, la valeur saisie est conservée.`
        })
      : '');
  }

  const basisControl = segmented({
    label: 'Unité de base',
    value: state.basis,
    options: [{ value: 'g', label: 'Solide (g)' }, { value: 'ml', label: 'Liquide (ml)' }],
    onChange: (b) => {
      state.basis = b;
      per100Title.textContent = `Valeurs pour 100 ${b}`;
      servingSize.setSuffix(b);
    }
  });

  const sourceNote = editing && food.source !== 'custom'
    ? banner({
        kind: 'info',
        text: `Cet aliment vient de ${SOURCE_LABELS[food.source] || 'une source externe'}. En l'enregistrant, il devient un aliment personnel avec vos valeurs. Le journal déjà saisi ne change pas.`
      })
    : null;

  openSheet({
    title: editing ? 'Modifier l\'aliment' : 'Nouvel aliment',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer l\'aliment');
      const formError = h('div', { 'aria-live': 'polite' });

      async function submit() {
        if (state.saving) return;
        formError.replaceChildren();
        for (const f of [name, brand, code, servingSize, servingLabel, ...Object.values(nutrients)]) f.setError(null);

        const { per100, invalid } = readNutrients();
        let hasError = invalid;
        for (const k of FIELD_ORDER) {
          if (Number.isNaN(parseDecimal(nutrients[k].input.value))) nutrients[k].setError('Nombre invalide.');
        }
        if (isNum(per100.sugars) && isNum(per100.carbs) && per100.sugars > per100.carbs) {
          nutrients.sugars.setError('Les sucres font partie des glucides : ils ne peuvent pas les dépasser.');
          hasError = true;
        }
        const size = parseDecimal(servingSize.input.value);
        if (Number.isNaN(size)) {
          servingSize.setError('Nombre invalide.');
          hasError = true;
        }
        let barcodeValue = null;
        if (code.input.value.trim()) {
          const res = checkBarcode(code.input.value);
          if (!res.ok) {
            code.setError(res.message);
            hasError = true;
          } else {
            barcodeValue = res.code;
          }
        }
        if (hasError) return;

        const input = {
          name: name.input.value,
          brand: brand.input.value,
          barcode: barcodeValue,
          basis: state.basis,
          per100,
          servingSize: size,
          servingLabel: servingLabel.input.value
        };
        state.saving = true;
        submitBtn.disabled = true;
        try {
          const saved = editing && await isStored(food)
            ? await updateFood(food, input)
            : await saveCustomFood(input);
          close();
          toast(`« ${saved.name} » enregistré`);
          if (onSaved) onSaved(saved);
        } catch (err) {
          state.saving = false;
          submitBtn.disabled = false;
          if (err instanceof ValidationError) {
            const map = { name, brand, barcode: code, servingSize, servingLabel };
            const key = String(err.field || '');
            const target = key.startsWith('per100.') ? nutrients[key.slice(7)] : map[key];
            if (target) target.setError(err.message);
            else formError.replaceChildren(banner({ kind: 'danger', text: err.message }));
          } else {
            formError.replaceChildren(banner({ kind: 'danger', text: `Enregistrement impossible : ${err.message}` }));
          }
        }
      }

      const form = h('form', {
        class: 'stack',
        novalidate: true,
        onsubmit: (e) => { e.preventDefault(); submit(); }
      },
        sourceNote,
        name.root,
        brand.root,
        h('div', {}, h('p', { class: 'field-label' }, 'Unité de base'), basisControl),
        per100Title,
        h('div', { class: 'form-grid' }, FIELD_ORDER.map((k) => nutrients[k].root)),
        h('p', { class: 'hint' }, 'Laissez vide une valeur que vous ne connaissez pas : elle sera affichée « — » et jamais comptée comme 0.'),
        coherence,
        h('h3', { class: 'section-header form-section' }, 'Portion (facultatif)'),
        h('div', { class: 'form-grid' }, servingSize.root, servingLabel.root),
        code.root,
        h('p', { class: 'hint' }, 'Avec son code-barres, l\'aliment sera reconnu au prochain scan, avant Open Food Facts.'),
        formError,
        submitBtn
      );
      checkLive();
      return form;
    }
  });
}
