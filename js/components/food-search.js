// Recherche d'aliments commune au choix d'un aliment (Journal) et à l'onglet Aliments.
// Ordre des résultats : vos aliments (personnalisés d'abord), puis aliments courants Ciqual
// (sur l'iPhone, instantané), puis, sur demande, produits du commerce Open Food Facts.

import { h, iconEl, banner } from '../ui.js';
import { formatKcal, isNum } from '../util/format.js';
import { scaleNutrients } from '../data/nutrients.js';
import { defaultInput, resolveQuantity } from '../data/entries.js';
import { rankLocalFoods, queryWords } from '../data/search.js';
import { searchCiqual, getCiqualState, onCiqualChange, ciqualToFood } from '../data/ciqual.js';
import { searchOffProducts, OffError } from '../data/off.js';
import { ensureOffNotice } from '../sheets/scan-flow.js';
import { defaultInputLabel } from '../sheets/entry-sheet.js';

const MAX_LOCAL = 40;
const MAX_CIQUAL = 25;

/** Ligne de liste : zone principale (bouton) + action à droite facultative. */
export function foodRow({ title, sub, onMain, side = null, badge = null }) {
  return h('div', { class: 'pick-row' },
    h('button', { type: 'button', class: 'pick-main', onclick: onMain },
      h('span', { class: 'pick-name' }, badge, title),
      sub ? h('span', { class: 'pick-sub' }, sub) : null
    ),
    side
  );
}

/** Sous-titre d'un aliment enregistré : marque · quantité par défaut · kcal. */
export function localSub(food) {
  const def = defaultInput(food);
  const q = resolveQuantity(food, def.inputUnit, def.inputValue);
  const n = scaleNutrients(food.per100, q);
  return [food.brand, defaultInputLabel(food), isNum(n.kcal) ? formatKcal(n.kcal) : 'kcal inconnues'].filter(Boolean).join(' · ');
}

export function group(title, rows, footer = null) {
  return h('section', { class: 'result-group' },
    h('h3', { class: 'section-header' }, title),
    h('div', { class: 'pick-list' }, rows),
    footer ? h('p', { class: 'section-footer' }, footer) : null
  );
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * opts :
 * - getFoods() : vos aliments (tableau à jour) ;
 * - side(kind, item) : élément à droite de chaque ligne (kind = 'local' | 'ciqual' | 'off') ;
 * - open(kind, item) : toucher une ligne ;
 * - renderEmpty(container) : contenu quand la recherche est vide ;
 * - initialQuery, onQuery(q) : mémorisation de la recherche par l'écran appelant ;
 * - wrapLocal(rowEl, food) facultatif : enveloppe les lignes « Vos aliments » (ex. glisser pour supprimer).
 * Renvoie { bar, results, input, render(), destroy() } : barre de recherche et zone de résultats,
 * à placer par l'écran appelant.
 */
export function createFoodSearch(opts) {
  let query = opts.initialQuery || '';
  let off = { q: null, status: 'idle', hits: [], error: null };
  const results = h('div', { class: 'search-results' });

  const input = h('input', {
    type: 'search',
    class: 'input',
    value: query,
    placeholder: opts.placeholder || 'Rechercher un aliment',
    'aria-label': 'Rechercher un aliment',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search'
  });
  const clearBtn = h('button', {
    type: 'button',
    class: 'searchbar-clear',
    'aria-label': 'Effacer la recherche',
    hidden: !query,
    onclick: () => {
      input.value = '';
      onInput();
      input.focus();
    }
  }, iconEl('close'));

  const onInputNow = () => {
    query = input.value;
    clearBtn.hidden = !query;
    if (opts.onQuery) opts.onQuery(query);
    render();
  };
  const onInput = debounce(onInputNow, 120);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onInputNow();
      input.blur(); // referme le clavier pour voir les résultats
    }
  });

  const bar = h('label', { class: 'searchbar' }, iconEl('search', 'searchbar-icon'), input, clearBtn);

  async function runOff(q, excluded) {
    if (!(await ensureOffNotice())) return;
    off = { q, status: 'loading', hits: [], error: null };
    render();
    try {
      const hits = await searchOffProducts(q);
      if (off.q !== q) return;
      off = { q, status: 'done', hits: hits.filter((x) => !excluded.has(x.code)), error: null };
    } catch (err) {
      if (off.q !== q) return;
      off = { q, status: 'error', hits: [], error: err instanceof OffError ? err.message : `Recherche impossible : ${err.message}` };
    }
    render();
  }

  function offSection(q, localCodes) {
    if (off.q !== q) off = { q, status: 'idle', hits: [], error: null };
    const title = 'Produits du commerce · Open Food Facts';
    if (off.status === 'idle') {
      return h('section', { class: 'result-group' },
        h('h3', { class: 'section-header' }, title),
        h('button', {
          type: 'button',
          class: 'btn btn-tinted btn-block',
          onclick: () => runOff(q, localCodes)
        }, iconEl('search'), `Rechercher « ${q.trim()} »`),
        h('p', { class: 'section-footer' }, 'Pour un produit emballé, le scan du code-barres est plus fiable que la recherche par nom.')
      );
    }
    if (off.status === 'loading') {
      return h('section', { class: 'result-group' },
        h('h3', { class: 'section-header' }, title),
        h('div', { class: 'loading-row' }, h('div', { class: 'spinner' }), 'Recherche dans Open Food Facts…')
      );
    }
    if (off.status === 'error') {
      return h('section', { class: 'result-group' },
        h('h3', { class: 'section-header' }, title),
        banner({
          kind: 'warning',
          text: off.error,
          actions: h('button', { type: 'button', class: 'btn btn-tinted', onclick: () => runOff(q, localCodes) }, 'Réessayer')
        })
      );
    }
    if (!off.hits.length) {
      return h('section', { class: 'result-group' },
        h('h3', { class: 'section-header' }, title),
        h('p', { class: 'hint' }, 'Aucun produit trouvé. Essayez avec la marque, ou scannez le code-barres.')
      );
    }
    return group(title, off.hits.map((hit) => foodRow({
      title: hit.name,
      sub: [hit.brand, hit.quantity, isNum(hit.kcal) ? `${formatKcal(hit.kcal)} / 100 ${hit.basis}` : 'kcal inconnues'].filter(Boolean).join(' · '),
      onMain: () => opts.open('off', hit),
      side: opts.side('off', hit)
    })), 'Données Open Food Facts, licence ODbL.');
  }

  function render() {
    const q = query.trim();
    if (q.length < 2 || !queryWords(q).length) {
      results.replaceChildren();
      opts.renderEmpty(results);
      return;
    }
    const foods = opts.getFoods();
    const local = rankLocalFoods(foods, q);
    const localCiqual = new Set(foods.filter((f) => f.source === 'ciqual' && f.sourceRef).map((f) => f.sourceRef));
    const localCodes = new Set(foods.filter((f) => f.barcode).map((f) => f.barcode));
    const parts = [];

    if (local.length) {
      const wrap = opts.wrapLocal || ((el) => el);
      parts.push(group('Vos aliments', local.slice(0, MAX_LOCAL).map((food) => wrap(foodRow({
        title: food.name,
        badge: food.favorite ? iconEl('starFill', 'row-star') : null,
        sub: localSub(food),
        onMain: () => opts.open('local', food),
        side: opts.side('local', food)
      }), food)), local.length > MAX_LOCAL ? `${MAX_LOCAL} premiers sur ${local.length}.` : null));
    }

    const cs = getCiqualState();
    let ciqualCount = 0;
    if (cs.status === 'ready') {
      const { items, total } = searchCiqual(q, { limit: MAX_CIQUAL, exclude: localCiqual });
      ciqualCount = items.length;
      if (items.length) {
        parts.push(group('Aliments courants · Ciqual', items.map((item) => {
          const food = ciqualToFood(item);
          return foodRow({
            title: item.name,
            sub: ['100 g', isNum(item.per100.kcal) ? formatKcal(item.per100.kcal) : 'kcal inconnues', item.group].filter(Boolean).join(' · '),
            onMain: () => opts.open('ciqual', food),
            side: opts.side('ciqual', food)
          });
        }), total > items.length ? `${items.length} premiers sur ${total} : précisez la recherche.` : null));
      }
    } else if (cs.status === 'error') {
      parts.push(h('p', { class: 'hint' }, `Table Ciqual indisponible : ${cs.error}`));
    } else {
      parts.push(h('div', { class: 'loading-row' }, h('div', { class: 'spinner' }), 'Préparation de la table Ciqual…'));
    }

    if (!local.length && !ciqualCount && cs.status === 'ready') {
      parts.push(h('p', { class: 'hint' }, `Rien ne correspond à « ${q} » dans vos aliments ni dans la table Ciqual.`));
    }
    parts.push(offSection(q, localCodes));
    results.replaceChildren(...parts);
  }

  const unsubscribe = onCiqualChange(() => {
    if (query.trim().length >= 2) render();
  });

  return {
    bar,
    results,
    input,
    render,
    destroy: unsubscribe
  };
}
