// Autotest du socle, lancé depuis Réglages. Vérifie sur l'iPhone lui-même :
// structure de la base, écritures/relectures, index, transactions, calculs et validations.
// Les enregistrements de test sont datés 1900-01-01 et supprimés à la fin, même en cas d'échec.

import * as db from './db.js';
import { SCHEMA, SCHEMA_VERSION, STORES } from './schema.js';
import { createFood, createJournalEntry, createRecipe, createGoal, createWeight, createCiqualItem, ValidationError } from './model.js';
import { scaleNutrients, sumNutrients, checkEnergyCoherence, normalizeNutrients, NutrientError } from './nutrients.js';
import { getSetting, THEMES } from './settings.js';
import { localDateKey, isDateKey, addDays } from '../util/dates.js';
import { normalizeName } from '../util/text.js';
import { parseDecimal, formatNutrient, formatGrams } from '../util/format.js';
import { APP_VERSION } from '../config.js';

const TEST_DATE = '1900-01-01';
const TEST_IDS = {
  food: 'selftest-food',
  food2: 'selftest-food-rollback',
  entry: 'selftest-entry',
  recipe: 'selftest-recipe',
  goal: 'selftest-goal',
  ciqual: 'SELFTEST'
};

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
  await db.run(Object.values(STORES), 'readwrite', (tx) => {
    tx.objectStore(STORES.foods).delete(TEST_IDS.food);
    tx.objectStore(STORES.foods).delete(TEST_IDS.food2);
    tx.objectStore(STORES.journal).delete(TEST_IDS.entry);
    tx.objectStore(STORES.recipes).delete(TEST_IDS.recipe);
    tx.objectStore(STORES.goals).delete(TEST_IDS.goal);
    tx.objectStore(STORES.weights).delete(TEST_DATE);
    tx.objectStore(STORES.ciqual).delete(TEST_IDS.ciqual);
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
    name: 'Structure de la base (7 tables, clés, index)',
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
      const sv = await getSetting('schemaVersion');
      assertEq(sv, SCHEMA_VERSION, 'Version du schéma enregistrée');
      let threw = false;
      try { await getSetting('cleInconnue'); } catch { threw = true; }
      assert(threw, 'Une clé inconnue doit être refusée');
      const launches = await getSetting('launchCount');
      return `thème « ${theme} », ${launches} ouverture(s)`;
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
