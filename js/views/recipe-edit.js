// Éditeur de recette : #/recipe-edit/new (création) ou #/recipe-edit/<id> (modification).
// La recette en cours est gardée en mémoire (brouillon) tant qu'elle n'est pas enregistrée ou
// abandonnée : changer d'onglet puis revenir ne perd rien. Rien n'est écrit avant « Enregistrer ».

import { h, mount, setAppbar, iconEl, banner, toast, fieldControl, confirmDialog, emptyState } from '../ui.js';
import { parseDecimal, formatNumber, formatKcal, formatGrams, isNum } from '../util/format.js';
import { LIMITS, ValidationError } from '../data/model.js';
import { getRecipeBundle, refreshIngredients, ingredientForEditing, computeRecipe, saveRecipe } from '../data/recipes.js';
import { formatQty } from '../components/journal-parts.js';
import { recipeTable, weightsLine, recipeNotices, ingredientRow } from '../components/recipe-parts.js';
import { openIngredientPicker, openIngredientSheet } from '../sheets/ingredient-sheets.js';

// Brouillons par clé ('new' ou identifiant de la recette).
const drafts = new Map();

/** Vrai si une recette non enregistrée attend (clé 'new' ou identifiant). */
export function hasPendingDraft(key = 'new') {
  const d = drafts.get(key);
  return Boolean(d && d.dirty);
}

/** Abandonne un brouillon (ex. après suppression de la recette). */
export function clearDraft(key) {
  drafts.delete(key);
}

/** Nombre → texte saisissable (virgule, 1 décimale au plus). */
function toInputText(n) {
  if (!isNum(n)) return '';
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function newDraft() {
  return { key: 'new', id: null, foodId: null, name: '', servingsText: '1', cookedText: '', ingredients: [], dirty: false, notes: null, leftAt: null };
}

/** Portions saisies : entier entre 1 et le maximum, sinon null. */
function parseServings(text) {
  const v = parseDecimal(text);
  return Number.isInteger(v) && v >= 1 && v <= LIMITS.servingsMax ? v : null;
}

function parseCooked(text) {
  const v = parseDecimal(text);
  if (v === null) return { value: null, error: null };
  if (Number.isNaN(v)) return { value: null, error: 'Nombre invalide.' };
  if (v <= 0) return { value: null, error: 'Poids positif attendu.' };
  if (v > LIMITS.cookedWeightMax) return { value: null, error: `Maximum ${formatNumber(LIMITS.cookedWeightMax)} g.` };
  return { value: v, error: null };
}

async function loadDraft(key) {
  if (key === 'new') return newDraft();
  const bundle = await getRecipeBundle(key);
  if (!bundle) return null;
  const r = bundle.recipe;
  const refreshed = await refreshIngredients(r.ingredients.map(ingredientForEditing));
  return {
    key,
    id: r.id,
    foodId: r.foodId,
    name: r.name,
    servingsText: String(r.servings),
    cookedText: toInputText(r.cookedWeight),
    ingredients: refreshed.ingredients,
    dirty: refreshed.updated > 0,
    notes: { updated: refreshed.updated, missing: refreshed.missing },
    leftAt: null
  };
}

export default {
  tab: 'recipes',
  async render(root, { params, navigate }) {
    const key = params[0] && params[0] !== 'new' ? params[0] : 'new';
    const backRoute = key === 'new' ? 'recipes' : `recipe/${key}`;

    let draft = drafts.get(key);
    const resumed = Boolean(draft && draft.dirty && draft.leftAt);
    if (!draft) {
      draft = await loadDraft(key);
      if (!draft) {
        setAppbar({ title: 'Recette', leading: h('a', { class: 'appbar-btn', href: '#/recipes' }, iconEl('chevronLeft'), h('span', {}, 'Recettes')) });
        mount(root, emptyState({
          iconName: 'recipes',
          title: 'Recette introuvable',
          text: 'Elle a peut-être été supprimée.',
          action: h('a', { class: 'btn btn-primary', href: '#/recipes' }, 'Voir les recettes')
        }));
        return null;
      }
      drafts.set(key, draft);
    }
    if (draft) draft.leftAt = null;

    let saving = false;
    const markDirty = () => { draft.dirty = true; };

    // ---------- Annuler / Enregistrer ----------
    const cancel = async () => {
      if (draft.dirty) {
        const ok = await confirmDialog({
          title: 'Abandonner les modifications ?',
          text: key === 'new' ? 'La recette ne sera pas créée.' : 'La recette enregistrée reste inchangée.',
          confirmLabel: 'Abandonner',
          destructive: true
        });
        if (!ok) return;
      }
      drafts.delete(key);
      navigate(backRoute, { replace: true });
    };

    const saveTop = h('button', { type: 'button', class: 'appbar-btn appbar-btn-strong', onclick: () => save() }, 'Enregistrer');
    setAppbar({
      title: key === 'new' ? 'Nouvelle recette' : 'Modifier',
      leading: h('button', { type: 'button', class: 'appbar-btn', onclick: cancel }, 'Annuler'),
      trailing: saveTop
    });

    // ---------- Champs ----------
    const nameField = fieldControl({
      label: 'Nom de la recette *',
      id: 'recipe-name',
      value: draft.name,
      placeholder: 'ex. Chili con carne',
      maxlength: LIMITS.nameMax,
      enterkeyhint: 'next',
      onInput: (v) => { draft.name = v; markDirty(); nameField.setError(null); }
    });

    const servingsField = fieldControl({
      label: 'Nombre de portions',
      id: 'recipe-servings',
      value: draft.servingsText,
      inputmode: 'numeric',
      suffix: 'portion(s)',
      onInput: (v) => { draft.servingsText = v; markDirty(); checkServings(); paintSummary(); }
    });
    const stepBtn = (delta, label) => h('button', {
      type: 'button',
      class: 'btn btn-tinted btn-icon stepper-btn',
      'aria-label': label,
      onclick: () => {
        const cur = parseServings(draft.servingsText) || 1;
        const next = Math.min(LIMITS.servingsMax, Math.max(1, cur + delta));
        draft.servingsText = String(next);
        servingsField.input.value = draft.servingsText;
        markDirty();
        checkServings();
        paintSummary();
      }
    }, h('span', { 'aria-hidden': 'true', class: 'stepper-sign' }, delta > 0 ? '+' : '−'));
    function checkServings() {
      servingsField.setError(parseServings(draft.servingsText) ? null : `Nombre entier entre 1 et ${LIMITS.servingsMax}.`);
    }

    const cookedField = fieldControl({
      label: 'Poids final cuit (facultatif)',
      id: 'recipe-cooked',
      value: draft.cookedText,
      inputmode: 'decimal',
      placeholder: 'non pesé',
      suffix: 'g',
      onInput: (v) => { draft.cookedText = v; markDirty(); cookedField.setError(parseCooked(v).error); paintSummary(); }
    });
    const cookedHint = h('p', { class: 'hint' });

    // ---------- Ingrédients ----------
    const ingHeader = h('h2', { class: 'section-header' });
    const ingList = h('div', { class: 'list' });
    const ingEmpty = h('p', { class: 'hint' }, 'Aucun ingrédient pour l\'instant. Pesez chaque ingrédient, de préférence cru.');

    function paintIngredients() {
      ingHeader.textContent = `Ingrédients (${draft.ingredients.length})`;
      ingList.replaceChildren(...draft.ingredients.map((ing, i) => ingredientRow(ing, () => editIngredient(i))));
      ingList.hidden = !draft.ingredients.length;
      ingEmpty.hidden = draft.ingredients.length > 0;
    }

    const changed = () => {
      markDirty();
      formError.replaceChildren();
      paintIngredients();
      paintSummary();
    };

    const addIngredient = () => openIngredientPicker({
      excludeFoodId: draft.foodId,
      onPick: (food) => openIngredientSheet({
        food,
        onSave: (ing) => {
          draft.ingredients.push(ing);
          changed();
          toast(`Ajouté : ${ing.name}`);
        }
      })
    });

    function editIngredient(i) {
      const current = draft.ingredients[i];
      if (!current) return;
      openIngredientSheet({
        ingredient: current,
        onSave: (ing) => {
          const idx = draft.ingredients.indexOf(current);
          if (idx >= 0) draft.ingredients[idx] = ing;
          changed();
        },
        onRemove: () => {
          const idx = draft.ingredients.indexOf(current);
          if (idx < 0) return;
          draft.ingredients.splice(idx, 1);
          changed();
          toast('Ingrédient retiré', {
            action: {
              label: 'Annuler',
              onClick: () => {
                draft.ingredients.splice(Math.min(idx, draft.ingredients.length), 0, current);
                changed();
              }
            }
          });
        }
      });
    }

    // ---------- Résumé calculé en direct ----------
    const summary = h('section', { class: 'card stack', 'aria-live': 'polite' });
    const notices = h('div', { class: 'stack' });

    function currentCalc() {
      return computeRecipe({
        ingredients: draft.ingredients,
        servings: parseServings(draft.servingsText),
        cookedWeight: parseCooked(draft.cookedText).value
      });
    }

    function paintSummary() {
      const calc = currentCalc();
      cookedHint.textContent = draft.ingredients.length
        ? `Pesez le plat terminé, sans le récipient. Vide : poids des ingrédients (${formatQty(calc.rawWeight, 'g')}).`
        : 'Pesez le plat terminé, sans le récipient. Vide : poids total des ingrédients.';
      if (!draft.ingredients.length) {
        summary.replaceChildren(
          h('h2', { class: 'card-title' }, 'Valeurs calculées'),
          h('p', { class: 'hint' }, 'Ajoutez des ingrédients : les calories et les macros s\'affichent ici au total, par portion et pour 100 g.')
        );
        notices.replaceChildren();
        return;
      }
      const ps = calc.perServing;
      summary.replaceChildren(
        h('h2', { class: 'card-title' }, 'Valeurs calculées'),
        h('div', { class: 'big-stat' },
          h('span', { class: 'big-stat-num t-num' }, isNum(ps.kcal) ? formatNumber(ps.kcal) : '—'),
          h('span', { class: 'big-stat-unit' }, 'kcal / portion')
        ),
        h('div', { class: 'cluster' },
          h('span', { class: 'chip chip-protein' }, `P ${formatGrams(ps.protein)}`),
          h('span', { class: 'chip chip-carbs' }, `G ${formatGrams(ps.carbs)}`),
          h('span', { class: 'chip chip-fat' }, `L ${formatGrams(ps.fat)}`)
        ),
        h('p', { class: 'hint' }, weightsLine(calc)),
        recipeTable(calc)
      );
      notices.replaceChildren(...recipeNotices(draft.ingredients, calc, 'edit'));
    }

    // ---------- Enregistrement ----------
    const formError = h('div', { 'aria-live': 'polite' });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: () => save() }, 'Enregistrer la recette');

    function setBusy(busy) {
      saving = busy;
      saveBtn.disabled = busy;
      saveTop.disabled = busy;
    }

    async function save() {
      if (saving) return;
      formError.replaceChildren();
      nameField.setError(null);
      let firstInvalid = null;
      if (!draft.name.trim()) {
        nameField.setError('Donnez un nom à la recette.');
        firstInvalid = firstInvalid || nameField.root;
      }
      const servings = parseServings(draft.servingsText);
      if (!servings) {
        checkServings();
        firstInvalid = firstInvalid || servingsField.root;
      }
      const cooked = parseCooked(draft.cookedText);
      if (cooked.error) {
        cookedField.setError(cooked.error);
        firstInvalid = firstInvalid || cookedField.root;
      }
      if (!draft.ingredients.length) {
        formError.replaceChildren(banner({ kind: 'danger', text: 'Ajoutez au moins un ingrédient.' }));
        firstInvalid = firstInvalid || formError;
      }
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      setBusy(true);
      try {
        const { recipe } = await saveRecipe({
          id: draft.id,
          name: draft.name,
          servings,
          cookedWeight: cooked.value,
          ingredients: draft.ingredients
        });
        drafts.delete(key);
        toast(`« ${recipe.name} » enregistrée`);
        navigate(`recipe/${recipe.id}`, { replace: true });
      } catch (err) {
        setBusy(false);
        const target = err instanceof ValidationError
          ? ({ name: nameField, servings: servingsField, cookedWeight: cookedField })[String(err.field || '')]
          : null;
        if (target) {
          target.setError(err.message);
          target.root.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          formError.replaceChildren(banner({ kind: 'danger', text: err instanceof ValidationError ? err.message : `Enregistrement impossible : ${err.message}` }));
          formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    // ---------- Bandeaux d'information ----------
    const info = [];
    if (resumed) {
      info.push(banner({
        kind: 'info',
        title: 'Modifications non enregistrées reprises',
        text: 'Enregistrez la recette, ou touchez « Annuler » pour abandonner ces modifications.'
      }));
    }
    if (draft.notes && (draft.notes.updated || draft.notes.missing)) {
      const parts = [];
      if (draft.notes.updated) {
        parts.push(`${draft.notes.updated} ingrédient${draft.notes.updated > 1 ? 's ont' : ' a'} des valeurs différentes dans vos aliments (corrigées depuis) : elles sont reprises ici et seront appliquées à l'enregistrement.`);
      }
      if (draft.notes.missing) {
        parts.push(`${draft.notes.missing} ingrédient${draft.notes.missing > 1 ? 's ne sont' : ' n\'est'} plus dans vos aliments : ${draft.notes.missing > 1 ? 'leurs' : 'ses'} valeurs enregistrées dans la recette sont conservées.`);
      }
      info.push(banner({ kind: 'info', text: parts.join(' ') }));
    }

    mount(root,
      info,
      nameField.root,
      h('section', {},
        ingHeader,
        ingList,
        ingEmpty,
        h('button', { type: 'button', class: 'btn btn-tinted btn-lg btn-block ingredient-add', onclick: addIngredient }, iconEl('plus'), 'Ajouter un ingrédient')
      ),
      h('section', { class: 'card stack' },
        h('h2', { class: 'card-title' }, 'Portions et poids'),
        h('div', { class: 'stepper' }, stepBtn(-1, 'Une portion de moins'), servingsField.root, stepBtn(1, 'Une portion de plus')),
        cookedField.root,
        cookedHint
      ),
      summary,
      notices,
      formError,
      saveBtn,
      h('p', { class: 'hint' }, 'Les valeurs sont calculées à partir des ingrédients, sans arrondi (arrondies seulement à l\'affichage). La recette enregistrée devient un aliment : vous l\'ajoutez au journal par portion ou en grammes.')
    );
    paintIngredients();
    checkServings();
    paintSummary();

    // Quitter l'écran (autre onglet) garde le brouillon ; il sera signalé au retour.
    return () => { if (drafts.get(key) === draft) draft.leftAt = Date.now(); };
  }
};
