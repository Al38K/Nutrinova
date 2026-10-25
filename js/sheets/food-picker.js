// Choix d'un aliment à ajouter à un repas : recherche (vos aliments, Ciqual, Open Food Facts),
// scan du code-barres, favoris, recettes et historique, création d'un aliment personnalisé.
// Le « + » de chaque ligne ajoute directement la quantité par défaut (2 tapotements depuis le Journal).

import { h, openSheet, iconEl, toast } from '../ui.js';
import { MEAL_LABELS } from '../data/model.js';
import { listFoods, favoritesOf, recentsOf, compareFoods } from '../data/foods.js';
import { ensureCiqual } from '../data/ciqual.js';
import { openEntrySheet, quickAdd } from './entry-sheet.js';
import { openFoodForm } from './food-form.js';
import { startScan, resolveOffHit } from './scan-flow.js';
import { createFoodSearch, foodRow, localSub, group } from '../components/food-search.js';

const MAX_RECENTS = 20;
const MAX_RECIPES = 10;

export async function openFoodPicker({ date, meal, onDone }) {
  let foods;
  try {
    foods = await listFoods();
  } catch (err) {
    toast(`Liste des aliments indisponible : ${err.message}`);
    return;
  }
  ensureCiqual().catch(() => { /* l'état d'erreur est affiché dans la recherche */ });

  let search = null;
  openSheet({
    title: `Ajouter · ${MEAL_LABELS[meal]}`,
    closeLabel: 'Annuler',
    onClose: () => { if (search) search.destroy(); },
    content: (close) => {
      const pick = (food, info = null) => {
        close();
        openEntrySheet({ food, date, meal, onDone, info });
      };

      const quick = (food) => {
        close();
        quickAdd({ food, date, meal, onDone });
      };

      const plusBtn = (label, onClick) => h('button', {
        type: 'button',
        class: 'btn btn-tinted btn-icon pick-side',
        'aria-label': `Ajouter ${label}`,
        onclick: (e) => {
          e.currentTarget.disabled = true;
          onClick();
        }
      }, iconEl('plus'));

      const open = async (kind, item) => {
        if (kind === 'off') {
          const res = await resolveOffHit(item);
          if (res) pick(res.food, res.info);
          return;
        }
        pick(item);
      };

      const side = (kind, item) => {
        if (kind === 'off') {
          return plusBtn(item.name, async () => {
            const res = await resolveOffHit(item);
            if (res) quick(res.food);
          });
        }
        return plusBtn(item.name, () => quick(item));
      };

      const localRow = (food) => foodRow({
        title: food.name,
        sub: localSub(food),
        onMain: () => pick(food),
        side: side('local', food)
      });

      const renderEmpty = (container) => {
        const favs = favoritesOf(foods);
        // Recettes non favorites : les plus récemment utilisées d'abord, puis par nom.
        const recipes = foods
          .filter((f) => f.source === 'recipe' && !f.favorite)
          .sort(compareFoods)
          .slice(0, MAX_RECIPES);
        const shown = new Set([...favs, ...recipes].map((f) => f.id));
        const recents = recentsOf(foods, MAX_RECENTS).filter((f) => !shown.has(f.id));
        const parts = [];
        if (favs.length) parts.push(group('Favoris', favs.map(localRow)));
        if (recipes.length) parts.push(group('Vos recettes', recipes.map(localRow)));
        if (recents.length) parts.push(group('Récents', recents.map(localRow)));
        if (!parts.length) {
          parts.push(h('p', { class: 'hint' }, 'Recherchez un aliment (ex. « pomme », « riz cuit »), scannez un produit emballé ou créez votre propre aliment. Vos favoris, vos recettes et vos derniers aliments apparaîtront ici.'));
        } else {
          parts.push(h('p', { class: 'hint' }, 'Touchez un aliment pour choisir la quantité, ou « + » pour ajouter la quantité indiquée.'));
        }
        container.append(...parts);
      };

      search = createFoodSearch({ getFoods: () => foods, side, open, renderEmpty, placeholder: 'Aliment, plat, marque…' });

      const actions = h('div', { class: 'action-row' },
        h('button', {
          type: 'button',
          class: 'btn btn-primary',
          onclick: () => {
            close();
            startScan({ mode: 'add', date, meal, onDone });
          }
        }, iconEl('barcode'), 'Scanner'),
        h('button', {
          type: 'button',
          class: 'btn btn-tinted',
          onclick: () => {
            const name = search.input.value.trim();
            close();
            openFoodForm({ initialName: name, onSaved: (food) => openEntrySheet({ food, date, meal, onDone }) });
          }
        }, iconEl('plus'), 'Créer un aliment')
      );

      search.render();
      return h('div', { class: 'stack' }, search.bar, actions, search.results);
    }
  });
}
