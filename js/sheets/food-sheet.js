// Fiche d'un aliment : valeurs pour 100 g/ml, portion, source et licence, favori,
// ajout au journal, modification, suppression. Sert aussi pour un résultat Ciqual ou
// Open Food Facts pas encore enregistré (aperçu).

import { h, openSheet, toast, iconEl, banner, confirmDialog } from '../ui.js';
import { formatNutrient, formatNumber, isNum } from '../util/format.js';
import { localDateKey, formatDateTime } from '../util/dates.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { setFavorite, deleteFood, restoreFood, isStored } from '../data/foods.js';
import { suggestMeal } from '../data/entries.js';
import { offProductUrl } from '../data/off.js';
import { getCiqualState } from '../data/ciqual.js';
import { formatQty } from '../components/journal-parts.js';
import { openEntrySheet, dataWarnings, infoNotes, sourceLabel } from './entry-sheet.js';
import { openFoodForm } from './food-form.js';

const ROWS = ['kcal', 'fat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'alcohol'];
const LABELS = { kcal: 'Énergie', fat: 'Lipides', carbs: 'Glucides', sugars: 'dont sucres', fiber: 'Fibres', protein: 'Protéines', salt: 'Sel', alcohol: 'Alcool' };

function nutrientTable(food) {
  return h('table', { class: 'ntable' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, ''),
      h('th', { scope: 'col' }, `Pour 100 ${food.basis}`)
    )),
    h('tbody', {}, ROWS
      .filter((k) => k !== 'alcohol' || isNum(food.per100.alcohol))
      .map((k) => h('tr', {},
        h('th', { scope: 'row', class: k === 'sugars' ? 'ntable-sub' : '' }, LABELS[k] || NUTRIENT_META[k].label),
        h('td', {}, formatNutrient(k, food.per100[k]))
      )))
  );
}

function sourceBlock(food) {
  if (food.source === 'off') {
    return h('p', { class: 'hint' },
      'Données ',
      h('a', { href: offProductUrl(food.sourceRef || food.barcode), target: '_blank', rel: 'noopener' }, 'Open Food Facts', iconEl('external', 'inline-icon')),
      ', licence ODbL.',
      food.fetchedAt ? ` Fiche lue le ${formatDateTime(food.fetchedAt)}.` : ''
    );
  }
  if (food.source === 'ciqual') {
    const meta = getCiqualState().meta;
    return h('p', { class: 'hint' },
      `Source : ${sourceLabel(food)}, code ${food.sourceRef}. `,
      meta && meta.license ? `${meta.license}. ` : '',
      'Valeurs moyennes pour 100 g.'
    );
  }
  if (food.source === 'recipe') return h('p', { class: 'hint' }, 'Aliment issu d\'une recette.');
  return h('p', { class: 'hint' }, `Aliment personnel${food.createdAt ? `, créé le ${formatDateTime(food.createdAt)}` : ''}.`);
}

/**
 * Ouvre la fiche. onChange() est appelé après toute modification (favori, ajout, suppression).
 * info (facultatif) : remarques de lecture Open Food Facts.
 */
export async function openFoodSheet({ food, onChange, info = null }) {
  let current = food;
  let stored = false;
  try { stored = await isStored(food); } catch { stored = false; }

  openSheet({
    title: 'Aliment',
    closeLabel: 'OK',
    content: (close) => {
      const favBtn = h('button', { type: 'button', class: 'btn btn-tinted btn-block' });
      const paintFav = () => {
        favBtn.replaceChildren(iconEl(current.favorite ? 'starFill' : 'star', current.favorite ? 'star-on' : ''), current.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris');
      };
      favBtn.addEventListener('click', async () => {
        try {
          current = await setFavorite(current, !current.favorite);
          stored = true;
          paintFav();
          toast(current.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
          if (onChange) onChange();
        } catch (err) {
          toast(`Favori non enregistré : ${err.message}`);
        }
      });
      paintFav();

      const edit = () => {
        close();
        openFoodForm({ food: current, onSaved: (saved) => { if (onChange) onChange(); openFoodSheet({ food: saved, onChange }); } });
      };

      const remove = async () => {
        const ok = await confirmDialog({
          title: 'Supprimer cet aliment ?',
          text: 'Il disparaît de vos aliments, favoris et historique. Les entrées déjà dans le journal ne changent pas.',
          confirmLabel: 'Supprimer',
          destructive: true
        });
        if (!ok) return;
        try {
          const removed = await deleteFood(current.id);
          close();
          if (onChange) onChange();
          toast('Aliment supprimé', {
            action: {
              label: 'Annuler',
              onClick: async () => {
                try {
                  await restoreFood(removed);
                  if (onChange) onChange();
                } catch (err) {
                  toast(`Annulation impossible : ${err.message}`);
                }
              }
            }
          });
        } catch (err) {
          toast(`Suppression impossible : ${err.message}`);
        }
      };

      const serving = isNum(current.servingSize)
        ? h('p', { class: 't-subhead' }, `Portion : ${current.servingLabel ? `${current.servingLabel} = ` : ''}${formatQty(current.servingSize, current.basis)}`)
        : null;

      return h('div', { class: 'stack' },
        h('div', {},
          h('p', { class: 't-title-3' }, current.name),
          current.brand ? h('p', { class: 't-subhead t-secondary' }, current.brand) : null,
          h('div', { class: 'cluster', style: { marginTop: '8px' } },
            h('span', { class: 'chip chip-brand' }, sourceLabel(current) || 'Aliment'),
            current.barcode ? h('span', { class: 'chip' }, current.barcode) : null,
            current.lastUsedAt ? h('span', { class: 'chip' }, `Utilisé ${formatNumber(current.useCount || 0)} fois`) : null
          )
        ),
        infoNotes(info),
        dataWarnings(current.per100, current.basis, edit),
        h('div', { class: 'card' }, nutrientTable(current)),
        serving,
        h('button', {
          type: 'button',
          class: 'btn btn-primary btn-lg btn-block',
          onclick: () => {
            close();
            openEntrySheet({ food: current, date: localDateKey(), meal: suggestMeal(), onDone: onChange });
          }
        }, iconEl('plus'), 'Ajouter au journal'),
        favBtn,
        h('button', { type: 'button', class: 'btn btn-plain btn-block', onclick: edit }, iconEl('edit'), stored && current.source === 'custom' ? 'Modifier' : 'Modifier les valeurs'),
        stored ? h('button', { type: 'button', class: 'btn btn-destructive btn-block', onclick: remove }, iconEl('trash'), 'Supprimer de mes aliments') : null,
        !stored ? banner({ kind: 'info', text: 'Aperçu : cet aliment sera ajouté à vos aliments dès que vous l\'utiliserez ou le mettrez en favori.' }) : null,
        sourceBlock(current)
      );
    }
  });
}
