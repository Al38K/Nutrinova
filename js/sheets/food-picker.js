// Choix d'un aliment à ajouter à un repas : aliments déjà enregistrés (favoris et récents en tête),
// filtre local, création d'un aliment personnalisé. Le « + » de chaque ligne ajoute directement
// la quantité par défaut (2 tapotements depuis le Journal).
// Scan du code-barres et recherche Open Food Facts / Ciqual : Phase 3.

import { h, openSheet, fieldControl, iconEl, toast } from '../ui.js';
import { formatKcal, isNum } from '../util/format.js';
import { scaleNutrients } from '../data/nutrients.js';
import { MEAL_LABELS } from '../data/model.js';
import { listFoods, filterFoods } from '../data/foods.js';
import { defaultInput, resolveQuantity } from '../data/entries.js';
import { openEntrySheet, quickAdd, defaultInputLabel } from './entry-sheet.js';
import { openFoodForm } from './food-form.js';

const MAX_ROWS = 150;

export async function openFoodPicker({ date, meal, onDone }) {
  let foods;
  try {
    foods = await listFoods();
  } catch (err) {
    toast(`Liste des aliments indisponible : ${err.message}`);
    return;
  }

  openSheet({
    title: `Ajouter · ${MEAL_LABELS[meal]}`,
    closeLabel: 'Annuler',
    content: (close) => {
      const list = h('div', { class: 'pick-list' });
      const info = h('p', { class: 'hint' });

      const createFood = (initialName) => {
        close();
        openFoodForm({
          initialName,
          onSaved: (food) => openEntrySheet({ food, date, meal, onDone })
        });
      };

      const foodRow = (food) => {
        const def = defaultInput(food);
        const q = resolveQuantity(food, def.inputUnit, def.inputValue);
        const n = scaleNutrients(food.per100, q);
        const label = defaultInputLabel(food);
        return h('div', { class: 'pick-row' },
          h('button', {
            type: 'button',
            class: 'pick-main',
            onclick: () => {
              close();
              openEntrySheet({ food, date, meal, onDone });
            }
          },
            h('span', { class: 'pick-name' }, food.name),
            h('span', { class: 'pick-sub' }, [food.brand, label, isNum(n.kcal) ? formatKcal(n.kcal) : 'kcal inconnues'].filter(Boolean).join(' · '))
          ),
          h('button', {
            type: 'button',
            class: 'btn btn-tinted btn-icon pick-side',
            'aria-label': `Ajouter ${food.name}, ${label}`,
            onclick: (e) => {
              e.currentTarget.disabled = true;
              close();
              quickAdd({ food, date, meal, onDone });
            }
          }, iconEl('plus'))
        );
      };

      const search = fieldControl({
        label: 'Rechercher dans vos aliments',
        id: 'picker-search',
        placeholder: 'Nom ou marque',
        enterkeyhint: 'search',
        onInput: (value) => renderList(value)
      });

      function renderList(query = '') {
        const found = filterFoods(foods, query);
        if (!foods.length) {
          list.hidden = true;
          info.textContent = 'Aucun aliment enregistré pour l\'instant. Créez votre premier aliment avec les valeurs de son étiquette.';
          return;
        }
        list.hidden = found.length === 0;
        list.replaceChildren(...found.slice(0, MAX_ROWS).map(foodRow));
        if (!found.length) info.textContent = `Aucun aliment ne correspond à « ${query.trim()} ».`;
        else if (found.length > MAX_ROWS) info.textContent = `${MAX_ROWS} premiers résultats sur ${found.length} : précisez la recherche.`;
        else info.textContent = 'Touchez un aliment pour choisir la quantité, ou « + » pour ajouter la quantité indiquée.';
      }

      renderList();
      return h('div', { class: 'stack' },
        foods.length ? search.root : null,
        h('button', {
          type: 'button',
          class: 'btn btn-tinted btn-block',
          onclick: () => createFood(search.input.value.trim())
        }, iconEl('plus'), 'Créer un aliment'),
        info,
        list,
        h('p', { class: 'hint' }, 'Scan du code-barres et recherche dans Open Food Facts et la table Ciqual : prochaine phase.')
      );
    }
  });
}
