// Autotest, lancé depuis Réglages. Vérifie sur l'iPhone lui-même :
// structure de la base, écritures/relectures, index, transactions, calculs, validations,
// journal (ajout, modification, suppression), objectifs versionnés et contrôle des sauvegardes.
// Les enregistrements de test sont datés de janvier 1900 et supprimés à la fin, même en cas d'échec.

import * as db from './db.js';
import { SCHEMA, SCHEMA_VERSION, STORES } from './schema.js';
import { createFood, createJournalEntry, createRecipe, createGoal, createWeight, createCiqualItem, ValidationError } from './model.js';
import { scaleNutrients, sumNutrients, checkEnergyCoherence, normalizeNutrients, NutrientError } from './nutrients.js';
import { getSetting, THEMES } from './settings.js';
import { addEntry, updateEntry, deleteEntry, restoreEntry, computeTotals, resolveQuantity } from './entries.js';
import { getGoalForDate, saveGoal, goalTargets, goalWarnings } from './goals.js';
import { buildBackup, validateBackup, BackupError, BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './backup.js';
import { localDateKey, isDateKey, addDays } from '../util/dates.js';
import { normalizeName } from '../util/text.js';
import { parseDecimal, formatNutrient, formatGrams } from '../util/format.js';
import { APP_VERSION } from '../config.js';

const TEST_DATE = '1900-01-01';
const TEST_DATE_2 = '1900-01-10';
const TEST_IDS = {
  food: 'selftest-food',
  food2: 'selftest-food-rollback',
  entry: 'selftest-entry',
  entry2: 'selftest-entry-2',
  recipe: 'selftest-recipe',
  goal: 'selftest-goal',
  goal2: 'selftest-goal-2',
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
    tx.objectStore(STORES.journal).delete(TEST_IDS.entry2);
    tx.objectStore(STORES.recipes).delete(TEST_IDS.recipe);
    tx.objectStore(STORES.goals).delete(TEST_IDS.goal);
    tx.objectStore(STORES.goals).delete(TEST_IDS.goal2);
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
