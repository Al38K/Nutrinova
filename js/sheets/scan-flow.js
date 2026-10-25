// Enchaînement après un scan ou un choix dans Open Food Facts :
// 1. vos aliments (aliments personnalisés d'abord) ; 2. Open Food Facts ; 3. création manuelle.
// La fiche récupérée est gardée sur l'iPhone (cache) : le prochain scan du même produit
// fonctionne sans connexion et sans nouvelle requête.

import { h, openSheet, toast, banner } from '../ui.js';
import { getSetting, setSetting } from '../data/settings.js';
import { canonicalBarcode } from '../data/barcode.js';
import { findFoodsByBarcode, upsertSourceFood } from '../data/foods.js';
import { fetchOffProduct, OffError, OFF_SITE } from '../data/off.js';
import { openScanner, openManualBarcode } from '../scanner/scanner.js';
import { openFoodForm } from './food-form.js';
import { openEntrySheet } from './entry-sheet.js';
import { openFoodSheet } from './food-sheet.js';

/**
 * Information affichée avant la première requête vers Open Food Facts.
 * Renvoie une Promise<boolean> : true si l'utilisateur continue.
 */
export async function ensureOffNotice() {
  let ack = false;
  try { ack = await getSetting('offAttributionAck'); } catch { ack = false; }
  if (ack) return true;
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title: 'Open Food Facts',
      closeLabel: 'Annuler',
      onClose: () => { if (!answered) resolve(false); },
      content: (close) => h('div', { class: 'stack' },
        h('p', { class: 't-subhead' }, 'Les produits du commerce viennent d\'Open Food Facts, une base de données collaborative et ouverte, publiée sous licence ODbL.'),
        h('p', { class: 't-subhead' }, 'Pour l\'interroger, nutrinova envoie seulement le code-barres scanné ou le texte recherché. Votre journal et vos autres données restent sur l\'iPhone.'),
        banner({ kind: 'warning', text: 'Les fiches sont remplies par des bénévoles et peuvent contenir des erreurs ou des valeurs manquantes : comparez avec l\'étiquette. Une valeur absente reste vide, jamais devinée.' }),
        h('p', { class: 'hint' }, h('a', { href: OFF_SITE, target: '_blank', rel: 'noopener' }, 'world.openfoodfacts.org')),
        h('button', {
          type: 'button',
          class: 'btn btn-primary btn-lg btn-block',
          onclick: async () => {
            answered = true;
            try { await setSetting('offAttributionAck', true); } catch { /* sera redemandé */ }
            close();
            resolve(true);
          }
        }, 'J\'ai compris, continuer')
      )
    });
  });
}

/**
 * Affiche l'aliment trouvé : feuille de quantité (ajout au journal), fiche (onglet Aliments),
 * ou choix d'un ingrédient de recette (mode 'pick').
 */
function present(food, ctx, info) {
  if (ctx.mode === 'pick') {
    ctx.onPick(food, info);
  } else if (ctx.mode === 'add') {
    openEntrySheet({ food, date: ctx.date, meal: ctx.meal, onDone: ctx.onDone, info });
  } else {
    openFoodSheet({ food, onChange: ctx.onDone, info });
  }
}

function createFromCode(code, ctx) {
  openFoodForm({ barcode: code, onSaved: (food) => present(food, ctx, null) });
}

function notFoundSheet(code, ctx) {
  openSheet({
    title: 'Produit introuvable',
    closeLabel: 'Fermer',
    content: (close) => h('div', { class: 'stack' },
      h('p', { class: 't-subhead' }, `Le code ${code} n'est ni dans vos aliments ni dans Open Food Facts.`),
      h('p', { class: 'hint' }, 'Créez l\'aliment avec les valeurs de l\'étiquette : il sera reconnu dès le prochain scan.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: () => { close(); createFromCode(code, ctx); } }, 'Créer l\'aliment'),
      h('button', { type: 'button', class: 'btn btn-plain btn-block', onclick: () => { close(); startScan(ctx); } }, 'Scanner un autre produit')
    )
  });
}

function errorSheet(err, code, ctx) {
  const message = err instanceof OffError ? err.message : `Erreur inattendue : ${err && err.message ? err.message : err}`;
  openSheet({
    title: 'Fiche non récupérée',
    closeLabel: 'Fermer',
    content: (close) => h('div', { class: 'stack' },
      banner({ kind: 'warning', text: message }),
      h('p', { class: 'hint' }, `Code ${code}. Vous pouvez réessayer, ou créer l'aliment avec les valeurs de l'étiquette.`),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: () => { close(); handleBarcode(code, ctx); } }, 'Réessayer'),
      h('button', { type: 'button', class: 'btn btn-tinted btn-block', onclick: () => { close(); createFromCode(code, ctx); } }, 'Créer l\'aliment')
    )
  });
}

/**
 * Cherche un code-barres : vos aliments, puis Open Food Facts.
 * ctx : { mode: 'add' | 'browse' | 'pick', date, meal, onDone, onPick }
 */
export async function handleBarcode(rawCode, ctx) {
  const code = canonicalBarcode(rawCode);
  if (!code) {
    toast('Code-barres illisible.');
    return;
  }
  let local = [];
  try {
    local = await findFoodsByBarcode(code);
  } catch (err) {
    toast(`Lecture de vos aliments impossible : ${err.message}`);
  }
  if (local.length) {
    present(local[0], ctx, null);
    return;
  }
  if (!(await ensureOffNotice())) return;
  const pending = toast('Recherche dans Open Food Facts…', { duration: 0 });
  try {
    const res = await fetchOffProduct(code);
    pending.dismiss();
    if (!res.found) {
      notFoundSheet(code, ctx);
      return;
    }
    const saved = await upsertSourceFood(res.food);
    present(saved, ctx, { issues: res.issues, derived: res.derived, noData: res.noData });
  } catch (err) {
    pending.dismiss();
    errorSheet(err, code, ctx);
  }
}

/**
 * Choix d'un produit dans les résultats de recherche Open Food Facts : la fiche complète
 * est relue (valeurs à jour), gardée sur l'iPhone, puis renvoyée. null si échec (message affiché).
 */
export async function resolveOffHit(hit) {
  const pending = toast('Lecture de la fiche…', { duration: 0 });
  try {
    const res = await fetchOffProduct(hit.code);
    pending.dismiss();
    if (!res.found) {
      toast('Cette fiche n\'existe plus dans Open Food Facts.');
      return null;
    }
    const food = await upsertSourceFood(res.food);
    return { food, info: { issues: res.issues, derived: res.derived, noData: res.noData } };
  } catch (err) {
    pending.dismiss();
    toast(err instanceof OffError ? err.message : `Lecture impossible : ${err.message}`, { duration: 6000 });
    return null;
  }
}

/** Ouvre le lecteur ; le code lu (ou saisi) est recherché. */
export function startScan(ctx) {
  const onCode = (code) => handleBarcode(code, ctx);
  openScanner({ onCode, onManual: () => openManualBarcode({ onCode }) });
}
