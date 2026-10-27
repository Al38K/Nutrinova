// Glisser vers la gauche pour supprimer (geste des listes iOS).
// - Glisser un peu : le bouton rouge « Supprimer » apparaît ; le toucher supprime.
// - Glisser loin (plus de la moitié de la ligne) : suppression immédiate.
// - Glisser vers la droite, toucher ailleurs ou faire défiler : la ligne se referme.
// La suppression elle-même (et son « Annuler ») est faite par l'appelant dans onDelete.
// Le bouton « Supprimer » reste un vrai bouton : accessible avec VoiceOver sans geste.

import { h, iconEl } from '../ui.js';

const ACTION_W = 88;        // largeur du bouton révélé (px)
const START_SLOP = 8;       // déplacement minimal avant de décider horizontal / vertical
const FULL_RATIO = 0.5;     // au-delà de cette fraction de la largeur : suppression directe

let openRow = null;         // une seule ligne ouverte à la fois

function closeOpenRow(except = null) {
  if (openRow && openRow !== except) openRow.close();
}

// Toucher ailleurs referme la ligne ouverte (comme dans Mail ou Rappels).
document.addEventListener('pointerdown', (e) => {
  if (openRow && !openRow.root.contains(e.target)) closeOpenRow();
}, { capture: true });

/**
 * Enveloppe une ligne (élément) dans un conteneur glissable.
 * opts : { label (nom lu par VoiceOver), onDelete() }.
 * Renvoie le conteneur, à insérer à la place de la ligne.
 */
export function swipeToDelete(content, { label, onDelete }) {
  const action = h('button', {
    type: 'button',
    class: 'swipe-action',
    'aria-label': `Supprimer ${label}`,
    tabindex: '-1',
    onclick: () => remove()
  }, iconEl('trash'), h('span', {}, 'Supprimer'));
  const front = h('div', { class: 'swipe-front' }, content);
  const root = h('div', { class: 'swipe' }, action, front);

  let x = 0;              // décalage actuel (≤ 0)
  let startX = 0;
  let startY = 0;
  let base = 0;
  let mode = null;        // null | 'h' (glisser) | 'v' (défilement)
  let pointerId = null;
  let moved = false;
  let removing = false;

  const width = () => root.getBoundingClientRect().width || 320;

  function setX(v, animate) {
    x = v;
    root.classList.toggle('is-animating', Boolean(animate));
    front.style.transform = v ? `translate3d(${v}px,0,0)` : '';
    // Le bouton occupe exactement la place libérée (il n'apparaît pas sous une ligne translucide).
    action.style.width = `${Math.max(0, -v)}px`;
    if (v < 0) action.style.visibility = 'visible';
    else if (!animate) action.style.visibility = 'hidden';
    else setTimeout(() => { if (x === 0) action.style.visibility = 'hidden'; }, 230);
    root.classList.toggle('is-open', v < 0);
    action.tabIndex = v < 0 ? 0 : -1;
  }

  const api = {
    root,
    close() {
      setX(0, true);
      if (openRow === api) openRow = null;
    }
  };

  function open() {
    closeOpenRow(api);
    setX(-ACTION_W, true);
    openRow = api;
  }

  function remove() {
    if (removing) return;
    removing = true;
    if (openRow === api) openRow = null;
    // Animation de sortie, puis l'appelant supprime et réaffiche la liste.
    setX(-width(), true);
    root.classList.add('is-removing');
    setTimeout(() => onDelete(), 180);
  }

  front.addEventListener('pointerdown', (e) => {
    if (removing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    base = x;
    mode = null;
    moved = false;
  });

  front.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || removing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!mode) {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (mode === 'h') {
        closeOpenRow(api);
        try { front.setPointerCapture(e.pointerId); } catch { /* sans conséquence */ }
      }
    }
    if (mode !== 'h') return;
    moved = true;
    let next = Math.min(0, base + dx);
    if (next > 0) next = 0;
    setX(next, false);
  });

  const end = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode !== 'h' || removing) { mode = null; return; }
    mode = null;
    if (-x > width() * FULL_RATIO) remove();
    else if (-x > ACTION_W / 2) open();
    else api.close();
  };
  front.addEventListener('pointerup', end);
  front.addEventListener('pointercancel', end);

  // Après un glissement, le « clic » de fin de geste ne doit pas ouvrir la ligne.
  // Ligne ouverte : un toucher la referme au lieu de l'ouvrir.
  front.addEventListener('click', (e) => {
    if (moved) {
      // Clic de fin de glissement : ignoré (la ligne reste ouverte ou fermée selon le geste).
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    } else if (root.classList.contains('is-open')) {
      e.preventDefault();
      e.stopPropagation();
      api.close();
    }
  }, { capture: true });

  return root;
}
