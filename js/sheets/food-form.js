// Création d'un aliment personnalisé (valeurs pour 100 g ou 100 ml).
// Un champ laissé vide = valeur inconnue (« — »), jamais 0.

import { h, openSheet, fieldControl, segmented, banner, toast } from '../ui.js';
import { parseDecimal, formatKcal, isNum } from '../util/format.js';
import { NUTRIENT_KEYS, NUTRIENT_META, checkEnergyCoherence } from '../data/nutrients.js';
import { ValidationError } from '../data/model.js';
import { saveCustomFood } from '../data/foods.js';

// Ordre d'affichage, comme sur une étiquette nutritionnelle européenne.
const FIELD_ORDER = ['kcal', 'fat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'alcohol'];
const FIELD_LABELS = { ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, NUTRIENT_META[k].label])), kcal: 'Énergie' };

/** Ouvre le formulaire. onSaved(food) est appelé après l'enregistrement. */
export function openFoodForm({ initialName = '', onSaved } = {}) {
  const state = { basis: 'g', saving: false };

  const name = fieldControl({ label: 'Nom *', id: 'food-name', value: initialName, placeholder: 'ex. Yaourt nature', maxlength: 200, enterkeyhint: 'next' });
  const brand = fieldControl({ label: 'Marque', id: 'food-brand', placeholder: 'facultatif', maxlength: 200, enterkeyhint: 'next' });
  const nutrients = {};
  for (const k of FIELD_ORDER) {
    nutrients[k] = fieldControl({
      label: FIELD_LABELS[k],
      id: `food-${k}`,
      inputmode: 'decimal',
      placeholder: '—',
      suffix: k === 'kcal' ? 'kcal' : 'g',
      enterkeyhint: 'next',
      onInput: () => checkLive()
    });
  }
  const servingSize = fieldControl({ label: 'Taille de portion', id: 'food-serving', inputmode: 'decimal', placeholder: 'facultatif', suffix: 'g', enterkeyhint: 'next' });
  const servingLabel = fieldControl({ label: 'Nom de la portion', id: 'food-serving-label', placeholder: 'ex. 1 pot', maxlength: 60 });
  const per100Title = h('h3', { class: 'section-header form-section' }, 'Valeurs pour 100 g');
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

  openSheet({
    title: 'Nouvel aliment',
    closeLabel: 'Annuler',
    content: (close) => {
      const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer l\'aliment');
      const formError = h('div', { 'aria-live': 'polite' });

      async function submit() {
        if (state.saving) return;
        formError.replaceChildren();
        for (const f of [name, brand, servingSize, servingLabel, ...Object.values(nutrients)]) f.setError(null);

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
        if (hasError) return;

        state.saving = true;
        submitBtn.disabled = true;
        try {
          const food = await saveCustomFood({
            name: name.input.value,
            brand: brand.input.value,
            basis: state.basis,
            per100,
            servingSize: size,
            servingLabel: servingLabel.input.value
          });
          close();
          toast(`« ${food.name} » enregistré`);
          if (onSaved) onSaved(food);
        } catch (err) {
          state.saving = false;
          submitBtn.disabled = false;
          if (err instanceof ValidationError) {
            const map = { name, brand, servingSize, servingLabel };
            const key = String(err.field || '');
            const target = key.startsWith('per100.') ? nutrients[key.slice(7)] : map[key];
            if (target) target.setError(err.message);
            else formError.replaceChildren(banner({ kind: 'danger', text: err.message }));
          } else {
            formError.replaceChildren(banner({ kind: 'danger', text: `Enregistrement impossible : ${err.message}` }));
          }
        }
      }

      return h('form', {
        class: 'stack',
        novalidate: true,
        onsubmit: (e) => { e.preventDefault(); submit(); }
      },
        name.root,
        brand.root,
        h('div', {}, h('p', { class: 'field-label' }, 'Unité de base'), basisControl),
        per100Title,
        h('div', { class: 'form-grid' }, FIELD_ORDER.map((k) => nutrients[k].root)),
        h('p', { class: 'hint' }, 'Laissez vide une valeur que vous ne connaissez pas : elle sera affichée « — » et jamais comptée comme 0.'),
        coherence,
        h('h3', { class: 'section-header form-section' }, 'Portion (facultatif)'),
        h('div', { class: 'form-grid' }, servingSize.root, servingLabel.root),
        formError,
        submitBtn
      );
    }
  });
}
