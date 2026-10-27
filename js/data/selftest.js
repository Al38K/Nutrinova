// Autotest, lancé depuis Réglages. Vérifie sur l'iPhone lui-même :
// structure de la base, écritures/relectures, index, transactions, calculs, validations,
// journal (ajout, modification, suppression), objectifs versionnés, contrôle des sauvegardes,
// codes-barres, lecture des fiches Open Food Facts (exemples), vos aliments, la table Ciqual, les recettes,
// les pesées, la moyenne mobile, le rappel de pesée (échéances, fichier calendrier) et le rappel de sauvegarde.
// Les enregistrements de test sont datés de janvier 1900 et supprimés à la fin, même en cas d'échec.

import * as db from './db.js';
import { SCHEMA, SCHEMA_VERSION, STORES } from './schema.js';
import { createFood, createJournalEntry, createRecipe, createGoal, createWeight, createCiqualItem, createActivity, ValidationError } from './model.js';
import { saveActivity, getActivitiesForDate, deleteActivity, restoreActivity, burnedKcal, kcalBudget } from './activities.js';
import { scaleNutrients, sumNutrients, checkEnergyCoherence, normalizeNutrients, NutrientError } from './nutrients.js';
import { getSetting, THEMES, STYLES, ACCENT_IDS } from './settings.js';
import { addEntry, updateEntry, deleteEntry, restoreEntry, computeTotals, resolveQuantity } from './entries.js';
import { getGoalForDate, saveGoal, goalTargets, goalWarnings } from './goals.js';
import { buildBackup, validateBackup, BackupError, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupReminderStatus, reminderEvery } from './backup.js';
import { checkBarcode, canonicalBarcode, expandUpcE } from './barcode.js';
import { offToFood, offHitSummary } from './off.js';
import { rankLocalFoods, queryWords, matchScore } from './search.js';
import { setFavorite, updateFood, deleteFood, restoreFood, findFoodsByBarcode, findBySource } from './foods.js';
import { ensureCiqual, searchCiqual, getCiqualState, ciqualToFood } from './ciqual.js';
import { computeRecipe, saveRecipe, deleteRecipe, restoreRecipe, getRecipeBundle, ingredientFromFood } from './recipes.js';
import { saveWeight, deleteWeight, restoreWeights, listWeights, movingAverage, monthsBefore, periodStart, weightStats, hasAtMostOneDecimal } from './weights.js';
import { lastOccurrence, nextOccurrence, reminderStatus, buildReminderIcs, vtimezone, normalizeReminder } from './reminder.js';
import { localDateKey, isDateKey, addDays } from '../util/dates.js';
import { normalizeName } from '../util/text.js';
import { parseDecimal, formatNutrient, formatGrams } from '../util/format.js';
import { APP_VERSION } from '../config.js';

const TEST_DATE = '1900-01-01';
const TEST_DATE_2 = '1900-01-10';
const TEST_DATE_3 = '1900-01-02';
const TEST_IDS = {
  food: 'selftest-food',
  food2: 'selftest-food-rollback',
  entry: 'selftest-entry',
  entry2: 'selftest-entry-2',
  recipe: 'selftest-recipe',
  recipe2: 'selftest-recipe-2',
  goal: 'selftest-goal',
  goal2: 'selftest-goal-2',
  ciqual: 'SELFTEST',
  custom: 'selftest-custom',
  offFood: 'selftest-off'
};
const TEST_REFS = { ciqual: 'SELFTEST-C', off: 'SELFTEST-OFF' };

class AssertError extends Error {}
function assert(cond, message) {
  if (!cond) throw new AssertError(message);
}
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertError(`${label} : obtenu ${a}, attendu ${e}`);
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}
function expectThrow(fn, ErrorType, label) {
  try {
    fn();
  } catch (err) {
    if (err instanceof ErrorType) return err;
    throw new AssertError(`${label} : mauvaise erreur (${err && err.name})`);
  }
  throw new AssertError(`${label} : aucune erreur levée`);
}

async function cleanup() {
  await db.run(Object.values(STORES), 'readwrite', async (tx) => {
    const foods = tx.objectStore(STORES.foods);
    for (const id of [TEST_IDS.custom, TEST_IDS.offFood]) foods.delete(id);
    for (const ref of [['ciqual', TEST_REFS.ciqual], ['off', TEST_REFS.off], ['recipe', TEST_IDS.recipe2]]) {
      const keys = await db.req(foods.index('source_ref').getAllKeys(ref));
      for (const k of keys) foods.delete(k);
    }
    const journal = tx.objectStore(STORES.journal);
    for (const d of [TEST_DATE, TEST_DATE_2]) {
      const keys = await db.req(journal.index('date').getAllKeys(d));
      for (const k of keys) journal.delete(k);
    }
    tx.objectStore(STORES.foods).delete(TEST_IDS.food);
    tx.objectStore(STORES.foods).delete(TEST_IDS.food2);
    tx.objectStore(STORES.journal).delete(TEST_IDS.entry);
    tx.objectStore(STORES.journal).delete(TEST_IDS.entry2);
    tx.objectStore(STORES.recipes).delete(TEST_IDS.recipe);
    tx.objectStore(STORES.recipes).delete(TEST_IDS.recipe2);
    tx.objectStore(STORES.goals).delete(TEST_IDS.goal);
    tx.objectStore(STORES.goals).delete(TEST_IDS.goal2);
    tx.objectStore(STORES.weights).delete(TEST_DATE);
    tx.objectStore(STORES.weights).delete(TEST_DATE_2);
    tx.objectStore(STORES.weights).delete(TEST_DATE_3);
    tx.objectStore(STORES.ciqual).delete(TEST_IDS.ciqual);
    const acts = tx.objectStore(STORES.activities);
    for (const d of [TEST_DATE, TEST_DATE_2]) {
      const keys = await db.req(acts.index('date').getAllKeys(d));
      for (const k of keys) acts.delete(k);
    }
  });
}

function testFood(overrides = {}) {
  return createFood({
    id: TEST_IDS.food,
    source: 'custom',
    name: 'Autotest nutrinova',
    brand: 'Test',
    barcode: '00000000',
    basis: 'g',
    per100: { kcal: 100, protein: 10, carbs: null, fat: null },
    ...overrides
  });
}

const TESTS = [
  {
    name: 'Structure de la base (tables, clés, index)',
    async run() {
      const info = await db.describe();
      assertEq(info.version, SCHEMA_VERSION, 'Version de la base');
      for (const [store, def] of Object.entries(SCHEMA)) {
        const real = info.stores[store];
        assert(real, `Table manquante : ${store}`);
        assertEq(real.keyPath, def.keyPath, `Clé de ${store}`);
        for (const [idx, idef] of Object.entries(def.indexes)) {
          assert(real.indexes[idx], `Index manquant : ${store}.${idx}`);
          assertEq(real.indexes[idx].keyPath, idef.keyPath, `Index ${store}.${idx}`);
        }
      }
      assertEq(Object.keys(info.stores).length, Object.keys(SCHEMA).length, 'Nombre de tables');
      return `${Object.keys(info.stores).length} tables, schéma v${info.version}`;
    }
  },
  {
    name: 'Aliment : écriture, relecture, valeurs manquantes conservées',
    async run() {
      await db.put(STORES.foods, testFood());
      const back = await db.get(STORES.foods, TEST_IDS.food);
      assert(back, 'Aliment non relu');
      assertEq(back.per100.protein, 10, 'Protéines');
      assert(back.per100.fat === null, 'Une valeur absente doit rester vide (null), pas 0');
      const byName = await db.getAllByIndex(STORES.foods, 'nameNorm', 'autotest nutrinova test');
      assert(byName.some((f) => f.id === TEST_IDS.food), 'Recherche par nom normalisé');
      const byBarcode = await db.getAllByIndex(STORES.foods, 'barcode', '00000000');
      assert(byBarcode.some((f) => f.id === TEST_IDS.food), 'Recherche par code-barres');
      return 'lecture, index nom et code-barres OK';
    }
  },
  {
    name: 'Journal : instantané nutritionnel et index jour/repas',
    async run() {
      const food = testFood();
      const entry = createJournalEntry({ id: TEST_IDS.entry, date: TEST_DATE, meal: 'snack', food, quantity: 150, inputUnit: 'g', inputValue: 150 });
      await db.put(STORES.journal, entry);
      // On corrige l'aliment : l'entrée passée ne doit pas changer.
      await db.put(STORES.foods, testFood({ per100: { kcal: 100, protein: 20 } }));
      const back = await db.get(STORES.journal, TEST_IDS.entry);
      assertEq(back.per100Snapshot.protein, 10, 'Instantané après correction de l\'aliment');
      const consumed = scaleNutrients(back.per100Snapshot, back.quantity);
      assert(approx(consumed.protein, 15), `150 g à 10 g/100 g = 15 g (obtenu ${consumed.protein})`);
      assert(consumed.fat === null, 'Lipides inconnus → inconnus après calcul');
      const n = await db.count(STORES.journal, undefined);
      assert(n >= 1, 'Comptage du journal');
      const byMeal = await db.getAllByIndex(STORES.journal, 'date_meal', [TEST_DATE, 'snack']);
      assertEq(byMeal.length, 1, 'Entrées du Snack du 1900-01-01');
      const byDay = await db.getAllByIndex(STORES.journal, 'date', TEST_DATE);
      assertEq(byDay.length, 1, 'Entrées du jour');
      return 'instantané conservé, 150 g → 15 g de protéines';
    }
  },
  {
    name: 'Recette, objectif, pesée, Ciqual : écriture et relecture',
    async run() {
      await db.put(STORES.recipes, createRecipe({ id: TEST_IDS.recipe, name: 'Recette test', ingredients: [{ foodId: TEST_IDS.food, quantity: 200 }], servings: 2 }));
      await db.put(STORES.goals, createGoal({ id: TEST_IDS.goal, effectiveFrom: TEST_DATE, kcal: 2000, mode: 'percent', protein: 25, carbs: 50, fat: 25 }));
      await db.put(STORES.weights, createWeight({ date: TEST_DATE, weightKg: 70.4 }));
      await db.put(STORES.weights, createWeight({ date: TEST_DATE, weightKg: 70.1 })); // même jour → remplace
      await db.put(STORES.ciqual, createCiqualItem({ code: TEST_IDS.ciqual, name: 'Élément test', per100: { kcal: null } }));
      const [r, g, w, c] = await Promise.all([
        db.get(STORES.recipes, TEST_IDS.recipe),
        db.getFirstByIndex(STORES.goals, 'effectiveFrom', TEST_DATE),
        db.get(STORES.weights, TEST_DATE),
        db.get(STORES.ciqual, TEST_IDS.ciqual)
      ]);
      assertEq(r && r.servings, 2, 'Portions de la recette');
      assert(r.cookedWeight === null, 'Poids cuit non saisi = vide');
      assertEq(g && g.kcal, 2000, 'Objectif calorique');
      assertEq(w && w.weightKg, 70.1, 'Une pesée par jour (la dernière remplace)');
      assert(c && c.per100.kcal === null, 'Ciqual : valeur absente conservée');
      return '4 tables OK';
    }
  },
  {
    name: 'Transaction annulée : rien n\'est écrit',
    async run() {
      let rejected = false;
      try {
        await db.run([STORES.foods, STORES.journal], 'readwrite', (tx) => {
          tx.objectStore(STORES.foods).put(testFood({ id: TEST_IDS.food2 }));
          throw new Error('échec volontaire');
        });
      } catch {
        rejected = true;
      }
      assert(rejected, 'La transaction aurait dû échouer');
      const back = await db.get(STORES.foods, TEST_IDS.food2);
      assert(back === undefined, 'L\'écriture partielle a été conservée');
      return 'écriture partielle annulée';
    }
  },
  {
    name: 'Réglages : lecture et clés contrôlées',
    async run() {
      const theme = await getSetting('theme');
      assert(THEMES.includes(theme), `Thème invalide : ${theme}`);
      const [style, accent] = await Promise.all([getSetting('style'), getSetting('accent')]);
      assert(STYLES.includes(style) && ACCENT_IDS.includes(accent), `Apparence invalide : ${style} / ${accent}`);
      const sv = await getSetting('schemaVersion');
      assertEq(sv, SCHEMA_VERSION, 'Version du schéma enregistrée');
      let threw = false;
      try { await getSetting('cleInconnue'); } catch { threw = true; }
      assert(threw, 'Une clé inconnue doit être refusée');
      const launches = await getSetting('launchCount');
      return `thème « ${theme} », style « ${style} », couleur « ${accent} », ${launches} ouverture(s)`;
    }
  },
  {
    name: 'Calculs nutritionnels (règle des null, somme, cohérence kcal)',
    async run() {
      const s = sumNutrients([{ kcal: 100, protein: 5 }, { kcal: 50, protein: null }]);
      assertEq(s.values.kcal, 150, 'Somme kcal');
      assertEq(s.values.protein, 5, 'Somme protéines (valeurs connues)');
      assert(s.incomplete.has('protein'), 'Total protéines signalé incomplet');
      assert(s.values.fat === null, 'Aucun lipide connu → total inconnu');
      // 10 g P + 20 g G + 5 g L = 40 + 80 + 45 = 165 kcal
      assertEq(checkEnergyCoherence({ kcal: 170, protein: 10, carbs: 20, fat: 5 }).status, 'ok', 'Écart 3 %');
      assertEq(checkEnergyCoherence({ kcal: 250, protein: 10, carbs: 20, fat: 5 }).status, 'mismatch', 'Écart 34 %');
      assertEq(checkEnergyCoherence({ kcal: 250, protein: 10, carbs: null, fat: 5 }).status, 'unknown', 'Macro manquante');
      expectThrow(() => normalizeNutrients({ protein: -1 }), NutrientError, 'Valeur négative');
      expectThrow(() => normalizeNutrients({ fat: 'abc' }), NutrientError, 'Valeur non numérique');
      expectThrow(() => normalizeNutrients({ carbs: 120 }), NutrientError, 'Plus de 100 g pour 100 g');
      assertEq(normalizeNutrients({ fiber: '' }).fiber, null, 'Champ vide → null');
      return 'somme, null, cohérence ±10 %';
    }
  },
  {
    name: 'Validation des saisies',
    async run() {
      expectThrow(() => createWeight({ date: TEST_DATE, weightKg: 10 }), ValidationError, 'Poids hors limites');
      expectThrow(() => createGoal({ effectiveFrom: TEST_DATE, kcal: 2000, mode: 'percent', protein: 30, carbs: 30, fat: 30 }), ValidationError, 'Pourcentages ≠ 100');
      expectThrow(() => createFood({ name: '  ' }), ValidationError, 'Nom vide');
      expectThrow(() => createFood({ name: 'X', barcode: '12AB' }), ValidationError, 'Code-barres invalide');
      expectThrow(() => createJournalEntry({ date: TEST_DATE, meal: 'snack', food: testFood(), quantity: 100, inputUnit: 'ml' }), ValidationError, 'ml pour un aliment en g');
      expectThrow(() => createJournalEntry({ date: '1900-13-01', meal: 'snack', food: testFood(), quantity: 100 }), ValidationError, 'Date impossible');
      expectThrow(() => createJournalEntry({ date: TEST_DATE, meal: 'brunch', food: testFood(), quantity: 100 }), ValidationError, 'Repas inconnu');
      return '7 refus attendus obtenus';
    }
  },
  {
    name: 'Nombres, dates et texte en français',
    async run() {
      assertEq(parseDecimal('12,5'), 12.5, 'Virgule décimale');
      assertEq(parseDecimal('1 250'), 1250, 'Espace des milliers');
      assertEq(parseDecimal(''), null, 'Champ vide');
      assert(Number.isNaN(parseDecimal('12,5,3')), 'Saisie invalide');
      assertEq(formatNutrient('protein', null), '—', 'Valeur absente affichée « — »');
      assertEq(formatGrams(4.25).replace(/\s/g, ' '), '4,3 g', 'Arrondi à l\'affichage');
      assertEq(localDateKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05', 'Date locale à 23 h 30');
      assertEq(addDays('2026-02-28', 1), '2026-03-01', 'Passage de mois');
      assert(!isDateKey('2026-02-30'), '30 février refusé');
      assertEq(normalizeName('Crème brûlée — Œuf'), 'creme brulee oeuf', 'Normalisation');
      return `aujourd'hui = ${localDateKey()}`;
    }
  },
  {
    name: 'Journal : ajout, modification, suppression, annulation',
    async run() {
      const food = testFood();
      await db.put(STORES.foods, food);
      const added = await addEntry({ id: TEST_IDS.entry2, date: TEST_DATE, meal: 'lunch', food, quantity: 200, inputUnit: 'g', inputValue: 200 });
      const usedFood = await db.get(STORES.foods, TEST_IDS.food);
      assert(usedFood.useCount >= 1 && usedFood.lastUsedAt === added.createdAt, 'Historique d\'usage de l\'aliment mis à jour');
      const moved = await updateEntry(added, { meal: 'dinner', quantity: 50, inputValue: 50 });
      const back = await db.get(STORES.journal, TEST_IDS.entry2);
      assertEq([back.meal, back.quantity], ['dinner', 50], 'Repas et quantité modifiés');
      assertEq(back.per100Snapshot.protein, 10, 'Instantané conservé après modification');
      assertEq(back.createdAt, added.createdAt, 'Date de création conservée');
      const removed = await deleteEntry(TEST_IDS.entry2);
      assert(removed && removed.id === moved.id, 'Entrée supprimée renvoyée pour annulation');
      assert((await db.get(STORES.journal, TEST_IDS.entry2)) === undefined, 'Entrée bien supprimée');
      await restoreEntry(removed);
      assert(await db.get(STORES.journal, TEST_IDS.entry2), 'Annulation de la suppression');
      assertEq(resolveQuantity({ servingSize: 125 }, 'portion', 2), 250, '2 portions de 125 g');
      assert(Number.isNaN(resolveQuantity({ servingSize: null }, 'portion', 1)), 'Portion inconnue refusée');
      return 'ajout, déplacement vers le Dîner, suppression puis annulation';
    }
  },
  {
    name: 'Totaux du jour et des repas (valeurs manquantes)',
    async run() {
      const nul = { fiber: null, sugars: null, salt: null, alcohol: null };
      const totals = computeTotals([
        { meal: 'breakfast', quantity: 200, per100Snapshot: { kcal: 50, protein: 3, carbs: 5, fat: 1, ...nul } },
        { meal: 'breakfast', quantity: 50, per100Snapshot: { kcal: null, protein: 10, carbs: null, fat: null, ...nul } },
        { meal: 'dinner', quantity: 100, per100Snapshot: { kcal: 200, protein: 20, carbs: 0, fat: 12, ...nul } }
      ]);
      const bf = totals.meals.breakfast;
      assert(approx(bf.values.kcal, 100), `Petit-déjeuner : 200 g à 50 kcal = 100 kcal (obtenu ${bf.values.kcal})`);
      assert(approx(bf.values.protein, 11), 'Protéines du petit-déjeuner = 6 + 5 g');
      assert(bf.incomplete.has('kcal') && bf.missing.kcal === 1, 'Total kcal signalé partiel (1 entrée sans kcal)');
      assertEq(totals.meals.lunch.values.kcal, 0, 'Repas vide = 0, pas une valeur manquante');
      assert(totals.meals.lunch.incomplete.size === 0, 'Repas vide non signalé partiel');
      assert(approx(totals.day.values.kcal, 300), 'Total du jour = 300 kcal');
      assertEq(totals.day.count, 3, 'Nombre d\'entrées du jour');
      assertEq(totals.day.values.fiber, null, 'Fibres toutes inconnues → inconnues');
      return 'somme par repas et par jour, totaux partiels signalés';
    }
  },
  {
    name: 'Objectifs : version en vigueur à une date, % → grammes',
    async run() {
      // Objectif v1 au 1900-01-01 (créé par le test 4) : 2000 kcal, 25/50/25 %.
      const g1 = await getGoalForDate('1900-01-05');
      assert(g1 && g1.id === TEST_IDS.goal, 'Objectif du 1900-01-01 en vigueur le 1900-01-05');
      await saveGoal({ id: TEST_IDS.goal2, effectiveFrom: TEST_DATE_2, kcal: 1800, mode: 'grams', protein: 120, carbs: 180, fat: 60 });
      assertEq((await getGoalForDate(TEST_DATE_2)).id, TEST_IDS.goal2, 'Nouvel objectif en vigueur à sa date');
      assertEq((await getGoalForDate('1900-01-09')).id, TEST_IDS.goal, 'La veille garde l\'ancien objectif');
      const again = await saveGoal({ effectiveFrom: TEST_DATE_2, kcal: 1900, mode: 'grams', protein: 120, carbs: 180, fat: 60 });
      assertEq(again.id, TEST_IDS.goal2, 'Même date d\'effet → objectif remplacé, pas dupliqué');
      const t = goalTargets(g1);
      assert(approx(t.protein, 125) && approx(t.carbs, 250) && approx(t.fat, 500 / 9), `25/50/25 % de 2000 kcal = 125/250/55,6 g (obtenu ${t.protein}/${t.carbs}/${t.fat})`);
      assert(goalWarnings({ kcal: 1000, mode: 'grams' }).some((w) => w.code === 'low-kcal'), 'Alerte objectif très bas');
      assert(!goalWarnings({ kcal: 2000, mode: 'grams' }).some((w) => w.code === 'low-kcal'), 'Pas d\'alerte à 2000 kcal');
      return 'historique respecté, conversion % → g exacte';
    }
  },
  {
    name: 'Sauvegarde : contrôle des fichiers et export de vos données',
    async run() {
      const sample = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        data: {
          foods: [testFood()],
          journal: [createJournalEntry({ id: 'x', date: TEST_DATE, meal: 'snack', food: testFood(), quantity: 30 })],
          goals: [createGoal({ id: 'g', effectiveFrom: TEST_DATE, kcal: 2000 })],
          settings: [{ key: 'theme', value: 'dark' }, { key: 'launchCount', value: 99 }]
        }
      };
      const ok = validateBackup(sample);
      assertEq([ok.counts.foods, ok.counts.journal, ok.counts.goals, ok.counts.settings], [1, 1, 1, 1], 'Contenu reconnu (réglage d\'appareil ignoré)');
      expectThrow(() => validateBackup({ ...sample, format: 'autre' }), BackupError, 'Fichier étranger refusé');
      expectThrow(() => validateBackup({ ...sample, schemaVersion: SCHEMA_VERSION + 1 }), BackupError, 'Version future refusée');
      const bad = { ...sample.data.journal[0], quantity: -5 };
      expectThrow(() => validateBackup({ ...sample, data: { ...sample.data, journal: [bad] } }), BackupError, 'Quantité négative refusée');
      const built = await buildBackup();
      const reread = validateBackup(JSON.parse(built.json));
      assertEq(reread.counts.journal, built.counts.journal, 'Votre export actuel se relit sans perte');
      return `export actuel valide (${built.counts.journal} entrées, ${built.counts.foods} aliments)`;
    }
  },
  {
    name: 'Codes-barres : contrôle du chiffre final et forme canonique',
    async run() {
      assert(checkBarcode('3017620422003').ok, 'EAN-13 valide accepté');
      assert(!checkBarcode('3017620422004').ok, 'Faute de frappe détectée');
      assert(checkBarcode('96385074').ok, 'EAN-8 valide accepté');
      assert(!checkBarcode('30176A').ok, 'Lettres refusées');
      assertEq(canonicalBarcode('034000470693'), '0034000470693', 'UPC-A → EAN-13');
      assertEq(canonicalBarcode('0034000470693'), '0034000470693', 'EAN-13 inchangé');
      assertEq(canonicalBarcode('00096385074'), '96385074', 'Zéros superflus retirés (EAN-8)');
      assertEq(expandUpcE('04252614'), '042100005264', 'UPC-E → UPC-A');
      return 'EAN-13, EAN-8, UPC-A, UPC-E';
    }
  },
  {
    name: 'Open Food Facts : lecture des fiches (exemples)',
    async run() {
      // Fiche pour 100 g (valeurs reprises d'un exemple de la documentation Open Food Facts).
      const a = offToFood({
        code: '4260392550101', product_name: 'test_default', brands: 'Marque A, Marque B',
        product_quantity_unit: 'g', serving_size: '10 g', serving_quantity: 10, serving_quantity_unit: 'g',
        nutrition_data_per: '100g',
        nutriments: { 'energy-kcal_100g': 140.5, proteins_100g: 4.5, carbohydrates_100g: 10.5, fat_100g: 8.5, fiber_100g: 2, sugars_100g: 12.5, salt_100g: 0.0502 }
      });
      assertEq([a.food.basis, a.food.per100.kcal, a.food.per100.protein, a.food.per100.salt], ['g', 140.5, 4.5, 0.0502], 'Valeurs pour 100 g');
      assertEq([a.food.brand, a.food.servingSize, a.food.barcode, a.food.source], ['Marque A', 10, '4260392550101', 'off'], 'Marque, portion, code, source');
      assert(a.food.per100.alcohol === null, 'Alcool absent → vide');
      // Boisson vendue en ml, énergie en kJ seulement, sodium sans sel.
      const b = offToFood({ code: '5449000000996', product_name_fr: 'Boisson test', product_quantity_unit: 'ml', nutriments: { 'energy-kj_100g': 180, sodium_100g: 0.004 } });
      assertEq(b.food.basis, 'ml', 'Produit en ml → valeurs pour 100 ml');
      assert(approx(b.food.per100.kcal, 180 / 4.184) && approx(b.food.per100.salt, 0.01), 'kJ → kcal, sodium → sel');
      assert(b.food.per100.protein === null && b.derived.length === 2, 'Conversions signalées, protéines vides');
      // Fiche sans valeurs : rien n'est inventé.
      const c = offToFood({ code: '3017620422003', nutriments: {} });
      assert(c.noData && c.food.per100.kcal === null, 'Fiche sans valeurs → toutes vides');
      assertEq(c.food.name, 'Produit 3017620422003', 'Nom absent → « Produit + code »');
      // Valeur impossible écartée et signalée, jamais corrigée.
      const d = offToFood({ code: '96385074', product_name: 'X', nutriments: { fat_100g: 250, proteins_100g: 3 } });
      assert(d.food.per100.fat === null && d.issues.length === 1 && d.food.per100.protein === 3, 'Lipides 250 g/100 g écartés');
      // Bière : alcool en % vol → grammes (× 0,789) ; données « pour 100 ml ».
      const e = offToFood({ code: '12345670', product_name: 'Bière', nutrition_data_per: '100ml', nutriments: { alcohol_100g: 5, 'energy-kcal_100g': 43 } });
      assert(e.food.basis === 'ml' && approx(e.food.per100.alcohol, 3.945), '5 % vol = 3,9 g d\'alcool pour 100 ml');
      const s = offHitSummary({ code: '34000470693', product_name: { main: 'Main', fr: 'Nom FR' }, brands: ['Marque'], nutriments: { 'energy-kcal_100g': 99 } });
      assertEq([s.code, s.name, s.brand, s.kcal], ['0034000470693', 'Nom FR', 'Marque', 99], 'Résultat de recherche');
      return '7 cas (g, ml, kJ, sodium, alcool, vide, impossible)';
    }
  },
  {
    name: 'Vos aliments : priorité, favori, modification, suppression',
    async run() {
      const off = createFood({ id: TEST_IDS.offFood, source: 'off', sourceRef: TEST_REFS.off, barcode: '96385074', name: 'Autotest pomme', per100: { kcal: 50, protein: 0.3, carbs: 11, fat: 0.2 } });
      const custom = createFood({ id: TEST_IDS.custom, source: 'custom', barcode: '96385074', name: 'Autotest pomme perso', per100: { kcal: 52 } });
      await db.putMany(STORES.foods, [off, custom]);
      const ranked = rankLocalFoods([off, custom], 'Autotest pommes');
      assertEq(ranked.map((f) => f.id), [TEST_IDS.custom, TEST_IDS.offFood], 'Aliment personnalisé en tête (pluriel accepté)');
      assert(matchScore('pomme pulpe et peau crue', queryWords('pomme crue')) > matchScore('compote de pomme crue', queryWords('pomme crue')), 'Nom commençant par le mot cherché en premier');
      const byCode = await findFoodsByBarcode('0000096385074');
      assertEq(byCode[0] && byCode[0].id, TEST_IDS.custom, 'Scan : aliment personnalisé prioritaire');
      const fav = await setFavorite(off, true);
      assert(fav.favorite && fav.id === TEST_IDS.offFood, 'Mis en favori');
      const edited = await updateFood(fav, { name: 'Autotest pomme corrigée', basis: 'g', per100: { kcal: 55 }, barcode: '96385074' });
      assertEq([edited.id, edited.source, edited.favorite], [TEST_IDS.offFood, 'custom', true], 'Modifié : devient personnel, favori conservé');
      const removed = await deleteFood(TEST_IDS.offFood);
      assert(removed && !(await db.get(STORES.foods, TEST_IDS.offFood)), 'Supprimé');
      await restoreFood(removed);
      assert(await db.get(STORES.foods, TEST_IDS.offFood), 'Suppression annulée');
      return 'personnalisé prioritaire, favori, modification, suppression';
    }
  },
  {
    name: 'Ajout d\'un aliment Ciqual ou Open Food Facts : enregistré une seule fois',
    async run() {
      const mk = () => createFood({ source: 'ciqual', sourceRef: TEST_REFS.ciqual, name: 'Autotest Ciqual', per100: { kcal: 40, protein: 1, carbs: 8, fat: 0.2 } });
      const e1 = await addEntry({ date: TEST_DATE, meal: 'lunch', food: mk(), quantity: 150, inputUnit: 'g', inputValue: 150 });
      const e2 = await addEntry({ date: TEST_DATE, meal: 'dinner', food: mk(), quantity: 80, inputUnit: 'g', inputValue: 80 });
      const stored = await findBySource('ciqual', TEST_REFS.ciqual);
      assert(stored, 'Aliment enregistré au premier ajout');
      assertEq([e1.foodId, e2.foodId], [stored.id, stored.id], 'Les deux entrées pointent vers la même copie');
      assertEq(stored.useCount, 2, 'Historique : 2 utilisations');
      const keys = await db.run(STORES.foods, 'readonly', (tx) => db.req(tx.objectStore(STORES.foods).index('source_ref').getAllKeys(['ciqual', TEST_REFS.ciqual])));
      assertEq(keys.length, 1, 'Une seule copie');
      return '2 ajouts, 1 aliment enregistré';
    }
  },
  {
    name: 'Recettes : total, portion, 100 g, poids cuit, valeurs manquantes',
    async run() {
      const nul = { fiber: null, sugars: null, salt: null, alcohol: null };
      const a = { foodId: 'a', name: 'A', basis: 'g', per100: { kcal: 100, protein: 10, carbs: 0, fat: 5, ...nul }, quantity: 200, inputUnit: 'g', inputValue: 200 };
      const b = { foodId: 'b', name: 'B', basis: 'ml', per100: { kcal: 50, protein: 3, carbs: 5, fat: 2, fiber: 0, sugars: 5, salt: 0.1, alcohol: 0 }, quantity: 100, inputUnit: 'ml', inputValue: 100 };
      const raw = computeRecipe({ ingredients: [a, b], servings: 2 });
      assertEq(raw.rawWeight, 300, 'Poids cru : 200 g + 100 ml comptés 100 g');
      assert(raw.hasMl, 'Ingrédient en ml signalé');
      assert(approx(raw.total.kcal, 250) && approx(raw.total.protein, 23) && approx(raw.total.fat, 12), `Total 250 kcal, 23 g P, 12 g L (obtenu ${raw.total.kcal})`);
      assert(approx(raw.perServing.kcal, 125) && approx(raw.servingWeight, 150), 'Par portion : 125 kcal pour 150 g');
      assert(approx(raw.per100.kcal, 250 / 3), 'Pour 100 g (poids cru) : 83,3 kcal');
      assert(raw.total.fiber === null && raw.per100.fiber === null, 'Fibres inconnues pour un ingrédient → inconnues pour la recette, jamais une somme partielle');
      assertEq(raw.missing.fiber, [0], 'Ingrédient sans fibres identifié');
      const cooked = computeRecipe({ ingredients: [a, b], servings: 2, cookedWeight: 250 });
      assert(approx(cooked.per100.kcal, 100) && approx(cooked.servingWeight, 125), 'Poids cuit 250 g : 100 kcal/100 g, portion 125 g');
      assert(approx(cooked.perServing.kcal, 125), 'Le poids cuit ne change pas les valeurs par portion');
      assert(computeRecipe({ ingredients: [a, b], servings: 1, cookedWeight: 10 }).errors.length === 1, 'Poids cuit impossible refusé');
      assert(computeRecipe({ ingredients: [a], servings: 1, cookedWeight: 1000 }).warnings.some((w) => w.code === 'cooked-ratio'), 'Poids final 5 fois le poids cru : avertissement');
      expectThrow(() => createRecipe({ name: 'X', ingredients: [{ ...a, quantity: -1 }] }), ValidationError, 'Quantité négative refusée');
      expectThrow(() => createRecipe({ name: 'X', ingredients: [{ ...b, inputUnit: 'g' }] }), ValidationError, 'Grammes pour un ingrédient en ml refusés');
      expectThrow(() => createRecipe({ name: 'X', servings: 0, ingredients: [a] }), ValidationError, '0 portion refusée');
      return '200 g + 100 ml → 250 kcal, 125 kcal/portion, 100 kcal/100 g cuit';
    }
  },
  {
    name: 'Recettes : enregistrement, aliment réutilisable, journal, suppression',
    async run() {
      const base = testFood({ per100: { kcal: 100, protein: 10, carbs: 0, fat: 5 } });
      await db.put(STORES.foods, base);
      const ciq = createFood({ source: 'ciqual', sourceRef: TEST_REFS.ciqual, name: 'Autotest Ciqual', per100: { kcal: 40, protein: 1, carbs: 8, fat: 0.2 } });
      const input = {
        id: TEST_IDS.recipe2,
        name: 'Autotest recette',
        servings: 4,
        cookedWeight: 400,
        ingredients: [
          ingredientFromFood(base, { quantity: 200, inputUnit: 'g', inputValue: 200 }),
          ingredientFromFood(ciq, { quantity: 300, inputUnit: 'g', inputValue: 300 })
        ]
      };
      const first = await saveRecipe(input);
      const rf = first.food;
      assertEq([rf.source, rf.sourceRef, rf.basis, first.recipe.foodId], ['recipe', TEST_IDS.recipe2, 'g', rf.id], 'Aliment lié à la recette');
      // 200 + 120 = 320 kcal ; 400 g cuits → 80 kcal pour 100 g ; portion 100 g
      assert(approx(rf.per100.kcal, 80) && approx(rf.servingSize, 100), `80 kcal/100 g, portion 100 g (obtenu ${rf.per100.kcal}, ${rf.servingSize})`);
      const storedCiq = await findBySource('ciqual', TEST_REFS.ciqual);
      assert(storedCiq && first.recipe.ingredients[1].foodId === storedCiq.id, 'Ingrédient Ciqual relié à vos aliments');
      await setFavorite(rf, true);
      const again = await saveRecipe({ ...input, servings: 2, cookedWeight: null });
      assertEq(again.food.id, rf.id, 'Modification : même aliment');
      assert(again.food.favorite, 'Favori conservé après modification');
      assert(approx(again.food.per100.kcal, 64) && approx(again.food.servingSize, 250), '500 g crus : 64 kcal/100 g, portion 250 g');
      const keys = await db.run(STORES.foods, 'readonly', (tx) => db.req(tx.objectStore(STORES.foods).index('source_ref').getAllKeys(['ciqual', TEST_REFS.ciqual])));
      assertEq(keys.length, 1, 'Ingrédient Ciqual enregistré une seule fois');
      const entry = await addEntry({ date: TEST_DATE, meal: 'dinner', food: again.food, quantity: again.food.servingSize, inputUnit: 'portion', inputValue: 1 });
      assert(approx(scaleNutrients(entry.per100Snapshot, entry.quantity).kcal, 160), '1 portion au journal = 160 kcal');
      let selfRefused = false;
      try {
        await saveRecipe({ ...input, ingredients: [...input.ingredients, ingredientFromFood(again.food, { quantity: 50, inputUnit: 'g', inputValue: 50 })] });
      } catch (err) {
        selfRefused = err instanceof ValidationError;
      }
      assert(selfRefused, 'Une recette ne peut pas être son propre ingrédient');
      const backup = validateBackup({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, data: { recipes: [again.recipe], foods: [again.food] } });
      assertEq(backup.data.recipes[0].ingredients[1].per100.kcal, 40, 'Sauvegarde : valeurs des ingrédients conservées');
      const removed = await deleteRecipe(TEST_IDS.recipe2);
      assert(!(await getRecipeBundle(TEST_IDS.recipe2)) && !(await db.get(STORES.foods, rf.id)), 'Recette et aliment supprimés ensemble');
      assert(await db.get(STORES.journal, entry.id), 'Entrée du journal conservée après suppression');
      await restoreRecipe(removed);
      const back = await getRecipeBundle(TEST_IDS.recipe2);
      assert(back && back.food && back.food.id === rf.id, 'Suppression annulée');
      return 'aliment lié, valeurs recalculées, 1 portion = 160 kcal, suppression annulable';
    }
  },
  {
    name: 'Pesées : une par jour, changement de date, suppression, annulation',
    async run() {
      const today = '1900-01-31';
      const a = await saveWeight({ date: TEST_DATE, weightKg: 72.4 }, { today });
      assertEq(a.weight.weightKg, 72.4, 'Pesée enregistrée');
      const b = await saveWeight({ date: TEST_DATE, weightKg: 72.1, note: 'au réveil' }, { today });
      assert(b.replaced && b.replaced.weightKg === 72.4, 'Même jour : la nouvelle pesée remplace l\'ancienne (signalé)');
      assertEq(b.weight.createdAt, a.weight.createdAt, 'Date de création conservée');
      await saveWeight({ date: TEST_DATE_2, weightKg: 71.6 }, { today });
      const moved = await saveWeight({ date: TEST_DATE_3, weightKg: 72.0 }, { originalDate: TEST_DATE, today });
      assert(moved.replaced === null, 'Changement de date vers un jour libre : rien d\'écrasé');
      assert(!(await db.get(STORES.weights, TEST_DATE)) && (await db.get(STORES.weights, TEST_DATE_3)), 'L\'ancienne date est libérée');
      const over = await saveWeight({ date: TEST_DATE_2, weightKg: 71.9 }, { originalDate: TEST_DATE_3, today });
      assert(over.replaced && over.replaced.weightKg === 71.6, 'Changement de date vers un jour déjà pesé : remplacement signalé');
      let refused = 0;
      for (const bad of [{ date: '1900-02-01', weightKg: 70 }, { date: TEST_DATE, weightKg: 70.25 }, { date: TEST_DATE, weightKg: 15 }]) {
        try { await saveWeight(bad, { today }); } catch (err) { if (err instanceof ValidationError) refused += 1; }
      }
      assertEq(refused, 3, 'Date future, 2 décimales, 15 kg refusés');
      assert(hasAtMostOneDecimal(70.4) && hasAtMostOneDecimal(70) && !hasAtMostOneDecimal(70.45), 'Une décimale au maximum');
      const removed = await deleteWeight(TEST_DATE_2);
      assert(removed && !(await db.get(STORES.weights, TEST_DATE_2)), 'Pesée supprimée');
      await restoreWeights([removed]);
      assertEq((await db.get(STORES.weights, TEST_DATE_2)).weightKg, 71.9, 'Suppression annulée');
      const all = await listWeights();
      const mine = all.filter((w) => w.date < '1900-12-31').map((w) => w.date);
      assertEq(mine, [TEST_DATE_2], 'Liste triée par date');
      return 'remplacement, déplacement, refus, suppression annulable';
    }
  },
  {
    name: 'Courbe : moyenne mobile sur 7 jours, périodes, statistiques',
    async run() {
      const w = (date, weightKg) => ({ date, weightKg });
      const list = [w('2026-01-01', 80), w('2026-01-03', 79), w('2026-01-07', 78), w('2026-01-08', 77), w('2026-01-20', 76)];
      const avg = movingAverage(list);
      assert(approx(avg[2].value, 79) && avg[2].count === 3, 'Le 7 janvier : moyenne du 1er au 7 = 79 kg (3 pesées)');
      assert(approx(avg[3].value, 78) && avg[3].count === 3, 'Le 8 janvier : le 1er sort de la fenêtre → (79+78+77)/3 = 78');
      assert(approx(avg[4].value, 76) && avg[4].count === 1, 'Pesée isolée : moyenne = pesée');
      assertEq(monthsBefore('2026-03-31', 1), '2026-02-28', '31 mars − 1 mois = 28 février');
      assertEq(monthsBefore('2024-03-31', 1), '2024-02-29', 'Année bissextile');
      assertEq(periodStart('1y', '2026-10-25'), '2025-10-25', 'Période 1 an');
      assertEq(periodStart('all', '2026-10-25'), null, 'Période « Tout »');
      const st = weightStats(list);
      assert(approx(st.change, -4) && st.min.weightKg === 76 && st.max.weightKg === 80 && st.count === 5, 'Évolution −4 kg, min 76, max 80');
      assertEq(weightStats([list[0]]).change, null, 'Une seule pesée : pas d\'évolution');
      return 'fenêtre de 7 jours calendaires, mois courts, statistiques';
    }
  },
  {
    name: 'Rappel de pesée : échéances et fichier calendrier',
    async run() {
      const r = normalizeReminder({ enabled: true, day: 0, time: '10:00' });
      const sat = new Date(2026, 9, 24, 18, 0); // samedi 24 octobre 2026
      assertEq(localDateKey(lastOccurrence(r, sat)), '2026-10-18', 'Samedi : dernière échéance = dimanche précédent');
      assertEq(localDateKey(nextOccurrence(r, sat)), '2026-10-25', 'Samedi : prochaine = demain');
      const sun9 = new Date(2026, 9, 25, 9, 0);
      const sun11 = new Date(2026, 9, 25, 11, 0);
      assertEq(localDateKey(lastOccurrence(r, sun9)), '2026-10-18', 'Dimanche 9 h : pas encore l\'heure');
      assertEq(localDateKey(lastOccurrence(r, sun11)), '2026-10-25', 'Dimanche 11 h : échéance du jour');
      assert(reminderStatus(r, '2026-10-18', sun11).due, 'Dimanche 11 h sans pesée du jour : bannière');
      assert(reminderStatus(r, '2026-10-18', sun11).isToday, 'Bannière « jour de la pesée »');
      assert(!reminderStatus(r, '2026-10-25', sun11).due, 'Pesée saisie le jour même : pas de bannière');
      assert(reminderStatus(r, '2026-10-27', new Date(2026, 9, 28, 8, 0)).due === false, 'Pesée faite mardi après l\'échéance : pas de bannière');
      assert(!reminderStatus({ ...r, enabled: false }, null, sun11).due, 'Rappel désactivé : pas de bannière');
      const ics = buildReminderIcs(r, { now: sat, timeZone: 'Europe/Paris', appUrl: 'https://exemple.test/#/weight' });
      assert(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=SU\r\n'), 'Récurrence chaque dimanche');
      assert(ics.includes('BEGIN:VALARM') && ics.includes('TRIGGER:PT0M'), 'Alerte à l\'heure de l\'événement');
      assert(/DTSTART(;TZID=Europe\/Paris)?:20261025T100000\r\n/.test(ics), 'Premier événement : dimanche 25 octobre 2026 à 10 h');
      assert(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'Lignes de 75 octets au plus');
      const tz = vtimezone('Europe/Paris', 2026);
      if (tz) {
        assert(tz.includes('TZOFFSETTO:+0200') && tz.includes('TZOFFSETTO:+0100'), 'Heure d\'été et d\'hiver de Paris');
        assert(ics.includes('TZID:Europe/Paris'), 'Fuseau inclus dans le fichier');
      }
      const tzLocal = vtimezone(Intl.DateTimeFormat().resolvedOptions().timeZone, 2026);
      return `fuseau de l'iPhone : ${Intl.DateTimeFormat().resolvedOptions().timeZone} (${tzLocal ? 'défini dans le fichier' : 'heure locale flottante'})`;
    }
  },
  {
    name: 'Rappel de sauvegarde : fréquence, données à protéger, import',
    async run() {
      const now = Date.parse('2026-10-26T12:00:00Z');
      const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
      const st = (lastBackupAt, reminderDays, dataCount = 5) => backupReminderStatus({ lastBackupAt, reminderDays, dataCount, now });
      assert(st(null, 7).due && st(null, 7).since === null, 'Jamais sauvegardé, des données : rappel');
      assert(!st(null, 7, 0).due, 'Aucune donnée : pas de rappel');
      assert(!st(daysAgo(6), 7).due, 'Sauvegarde il y a 6 jours, rappel à 7 : pas encore');
      assert(st(daysAgo(7), 7).due && st(daysAgo(7), 7).since === 7, 'Sauvegarde il y a 7 jours : rappel');
      assert(st(daysAgo(3), 3).due && !st(daysAgo(10), 14).due, 'Fréquences 3 et 14 jours');
      assert(!st(daysAgo(100), 0).due, 'Rappel désactivé (0) : jamais de bannière');
      assertEq([reminderEvery(null), reminderEvery(30), reminderEvery(-1)], [7, 30, 7], 'Réglage absent ou invalide → 7 jours');
      const base = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION };
      const ok = validateBackup({ ...base, data: { settings: [{ key: 'backupReminderDays', value: 14 }] } });
      assertEq(ok.data.settings, [{ key: 'backupReminderDays', value: 14 }], 'Fréquence importée');
      assertEq(validateBackup({ ...base, data: { settings: [{ key: 'backupReminderDays', value: null }] } }).data.settings.length, 0, 'Ancienne sauvegarde (vide) : réglage par défaut conservé');
      expectThrow(() => validateBackup({ ...base, data: { settings: [{ key: 'backupReminderDays', value: 9 }] } }), BackupError, 'Fréquence inconnue refusée');
      assertEq(validateBackup({ ...base, data: { settings: [{ key: 'visionApiKey', value: 'x' }] } }).data.settings.length, 0, 'Réglage inconnu ignoré');
      return 'rappel à 7 jours par défaut, désactivable, contrôlé à l\'import';
    }
  },
  {
    name: 'Activité : calories dépensées, objectif du jour, sauvegarde',
    async run() {
      const a = await saveActivity({ date: TEST_DATE, name: 'Marche', kcal: 250 });
      const b = await saveActivity({ date: TEST_DATE, name: '', kcal: 120.5 });
      assertEq(b.name, 'Activité', 'Nom vide → « Activité »');
      const list = await getActivitiesForDate(TEST_DATE);
      // Deux saisies dans la même milliseconde : ordre libre, on compare sans tenir compte de l'ordre.
      assertEq(list.map((x) => x.kcal).sort((p, q) => p - q), [120.5, 250], 'Activités du jour');
      assert(approx(burnedKcal(list), 370.5), 'Total dépensé = 370,5 kcal');
      assertEq(burnedKcal([]), 0, 'Aucune activité = 0');
      assertEq([kcalBudget(2000, 370.5), kcalBudget(null, 300)], [2370.5, null], 'Objectif + activité ; sans objectif : rien');
      const edited = await saveActivity({ date: TEST_DATE, name: 'Marche rapide', kcal: 300 }, a);
      assertEq([edited.id, edited.createdAt, edited.kcal], [a.id, a.createdAt, 300], 'Modification : même activité');
      const removed = await deleteActivity(b.id);
      assertEq((await getActivitiesForDate(TEST_DATE)).length, 1, 'Activité supprimée');
      await restoreActivity(removed);
      assertEq((await getActivitiesForDate(TEST_DATE)).length, 2, 'Suppression annulée');
      expectThrow(() => createActivity({ date: TEST_DATE, kcal: 0 }), ValidationError, '0 kcal refusé');
      expectThrow(() => createActivity({ date: TEST_DATE, kcal: 6000 }), ValidationError, 'Plus de 5 000 kcal refusé');
      expectThrow(() => createActivity({ date: TEST_DATE }), ValidationError, 'Calories absentes refusées');
      const base = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION };
      const ok = validateBackup({ ...base, data: { activities: [edited] } });
      assertEq(ok.counts.activities, 1, 'Activité reconnue dans une sauvegarde');
      expectThrow(() => validateBackup({ ...base, data: { activities: [{ ...edited, kcal: -5 }] } }), BackupError, 'Activité invalide refusée à l\'import');
      assertEq(validateBackup({ ...base, schemaVersion: 1, data: { journal: [] } }).counts.activities, 0, 'Ancienne sauvegarde (sans activités) acceptée');
      return '250 + 120,5 kcal, objectif 2 000 → 2 370,5 kcal disponibles';
    }
  },
  {
    name: 'Table Ciqual : chargée et cherchable hors ligne',
    async run() {
      await ensureCiqual();
      const st = getCiqualState();
      assert(st.count >= 3000, `Table incomplète : ${st.count} aliments`);
      const { items } = searchCiqual('pomme crue', { limit: 5 });
      assert(items.length > 0, 'Recherche « pomme crue » sans résultat');
      const f = ciqualToFood(items[0]);
      assertEq([f.source, f.basis, f.sourceRef], ['ciqual', 'g', items[0].code], 'Conversion en aliment');
      const withKcal = items.filter((it) => it.per100.kcal !== null).length;
      return `${st.count} aliments (version ${st.meta && st.meta.version}), « ${items[0].name} » ${withKcal ? 'avec' : 'sans'} énergie`;
    }
  }
];

/**
 * Lance tous les tests. onProgress(result) est appelé après chaque test.
 * swVersion : version annoncée par le service worker (ou null s'il n'est pas actif).
 */
export async function runSelfTest({ swVersion = null, onProgress } = {}) {
  const results = [];
  const push = (r) => { results.push(r); if (onProgress) onProgress(r); };
  try {
    await cleanup();
    for (const t of TESTS) {
      const started = performance.now();
      try {
        const detail = await t.run();
        push({ name: t.name, ok: true, detail, ms: Math.round(performance.now() - started) });
      } catch (err) {
        push({ name: t.name, ok: false, detail: err && err.message ? err.message : String(err) });
      }
    }
    if (swVersion !== null) {
      push({
        name: 'Version hors ligne identique à la version de l\'app',
        ok: swVersion === APP_VERSION,
        detail: `app ${APP_VERSION} / hors ligne ${swVersion}`
      });
    } else {
      push({ name: 'Mode hors ligne actif', ok: false, detail: 'Service worker inactif : rouvrez l\'app une fois connecté.' });
    }
  } finally {
    try {
      await cleanup();
    } catch (err) {
      push({ name: 'Nettoyage des données de test', ok: false, detail: err.message });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
