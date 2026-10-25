// Point d'entrée : thème, base locale, persistance, service worker, navigation.

import { openDb } from './data/db.js';
import { getSetting, applyTheme, mirrorTheme, recordLaunch } from './data/settings.js';
import { requestPersistence } from './data/storage.js';
import { registerServiceWorker } from './pwa.js';
import { startRouter } from './router.js';
import { renderFatal, toast } from './ui.js';
import { ensureCiqual } from './data/ciqual.js';

import journal from './views/journal.js';
import foods from './views/foods.js';
import recipes from './views/recipes.js';
import recipe from './views/recipe.js';
import recipeEdit from './views/recipe-edit.js';
import weight from './views/weight.js';
import settings from './views/settings.js';
import design from './views/design.js';
import meal from './views/meal.js';
import day from './views/day.js';
import goals from './views/goals.js';

const TABS = [
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'foods', label: 'Aliments', icon: 'foods' },
  { id: 'recipes', label: 'Recettes', icon: 'recipes' },
  { id: 'weight', label: 'Poids', icon: 'weight' },
  { id: 'settings', label: 'Réglages', icon: 'settings' }
];

const VIEWS = { journal, foods, recipes, recipe, 'recipe-edit': recipeEdit, weight, settings, design, meal, day, goals };

async function boot() {
  // Le service worker s'enregistre même si la base échoue : l'app reste mise à jour.
  registerServiceWorker();

  try {
    await openDb();
  } catch (err) {
    console.error(err);
    renderFatal(document.getElementById('view'), 'La base de données locale est inaccessible', err);
    return;
  }

  try {
    const theme = await getSetting('theme');
    applyTheme(theme);
    mirrorTheme(theme);
  } catch (err) {
    console.warn('Thème non lu :', err);
  }

  // Ces deux opérations ne bloquent jamais l'affichage en cas d'échec.
  await recordLaunch().catch((err) => console.warn('Compteur d\'ouvertures non enregistré :', err));
  requestPersistence();

  window.addEventListener('nutri:db-versionchange', () => {
    toast('Une nouvelle version a modifié la base. Rechargez l\'app.', {
      duration: 0,
      action: { label: 'Recharger', onClick: () => location.reload() }
    });
  });

  await startRouter({ views: VIEWS, tabs: TABS, defaultRoute: 'journal' });

  // Table Ciqual préparée en arrière-plan, après le premier affichage (environ 1 s la première fois).
  setTimeout(() => {
    ensureCiqual().catch((err) => console.warn('Table Ciqual non préparée :', err));
  }, 800);
}

boot();
