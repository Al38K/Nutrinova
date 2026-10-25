// Galerie du design system (Réglages › Design system) : sert à valider le rendu clair/sombre sur l'iPhone.
// Les chiffres affichés ici sont des exemples d'interface, pas des données nutritionnelles.

import { h, setAppbar, backButton, section, row, segmented, switchInput, field, banner, emptyState, ring, macroBar, toast, openSheet } from '../ui.js';
import { parseDecimal, formatNumber } from '../util/format.js';

const SWATCHES = [
  ['--brand', 'Marque'], ['--header-bg', 'Bandeau'], ['--kcal', 'Énergie'],
  ['--protein', 'Protéines'], ['--carbs', 'Glucides'], ['--fat', 'Lipides'],
  ['--success', 'Succès'], ['--warning', 'Alerte'], ['--danger', 'Erreur'],
  ['--bg', 'Fond'], ['--surface', 'Surface'], ['--surface-2', 'Champ'],
  ['--label', 'Texte'], ['--label-2', 'Texte 2'], ['--track', 'Piste']
];

const TYPE_SCALE = [
  ['t-large-title', 'Grand titre 34'],
  ['t-title-1', 'Titre 1 · 28'],
  ['t-title-2', 'Titre 2 · 22'],
  ['t-title-3', 'Titre 3 · 20'],
  ['t-headline', 'En-tête · 17 semi-gras'],
  ['t-body', 'Corps · 17'],
  ['t-callout', 'Accroche · 16'],
  ['t-subhead', 'Sous-titre · 15'],
  ['t-footnote', 'Note · 13'],
  ['t-caption', 'Légende · 12']
];

function card(title, ...children) {
  return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, title), ...children);
}

function decimalDemo() {
  const out = h('p', { class: 'hint' }, 'Tapez une quantité, par exemple 12,5.');
  const wrap = h('div', {});
  const build = (value = '', error = null) => field({
    label: 'Quantité',
    id: 'demo-qty',
    value,
    suffix: 'g',
    inputmode: 'decimal',
    placeholder: '0',
    error,
    onInput: (v) => {
      const n = parseDecimal(v);
      const wrapEl = wrap.querySelector('.input-wrap');
      if (Number.isNaN(n)) {
        wrapEl.classList.add('is-invalid');
        out.textContent = 'Nombre invalide.';
      } else {
        wrapEl.classList.remove('is-invalid');
        out.textContent = n === null ? 'Champ vide → valeur manquante (« — »).' : `Valeur lue : ${formatNumber(n, 3)}`;
      }
    }
  });
  wrap.append(build(), out);
  return wrap;
}

export default {
  tab: 'settings',
  render(root) {
    setAppbar({ title: 'Design system', leading: backButton('#/settings', 'Réglages') });

    root.append(
      banner({ text: 'Aperçu des composants. Les chiffres affichés sont des valeurs d\'exemple.' }),

      card('Couleurs', h('div', { class: 'swatches' }, SWATCHES.map(([token, label]) =>
        h('div', { class: 'swatch' },
          h('div', { class: 'swatch-chip', style: { background: `var(${token})` } }),
          h('span', {}, label)
        )))),

      card('Typographie', h('div', { class: 'stack' }, TYPE_SCALE.map(([cls, label]) => h('p', { class: cls }, label))),
        h('p', { class: 't-title-2 t-num', style: { marginTop: '12px' } }, '1 234 kcal — chiffres arrondis')),

      card('Anneau et barres (exemple)',
        h('div', { class: 'cluster', style: { justifyContent: 'space-around' } },
          ring({ value: 1240, goal: 2000, centerNumber: '760', centerLabel: 'kcal restantes', size: 150 }),
          ring({ value: 2150, goal: 2000, centerNumber: '−150', centerLabel: 'kcal en trop', size: 110, stroke: 10 }),
          ring({ value: null, goal: null, centerNumber: '—', centerLabel: 'sans objectif', size: 110, stroke: 10 })
        ),
        h('div', { style: { marginTop: '20px' } },
          macroBar({ kind: 'protein', label: 'Protéines', value: 62, goal: 120 }),
          macroBar({ kind: 'carbs', label: 'Glucides', value: 180, goal: 220 }),
          macroBar({ kind: 'fat', label: 'Lipides', value: 75, goal: 65 }),
          macroBar({ kind: 'protein', label: 'Valeur inconnue', value: null, goal: 120 })
        )
      ),

      card('Boutons', h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block' }, 'Ajouter au journal'),
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn-primary' }, 'Principal'),
          h('button', { type: 'button', class: 'btn btn-tinted' }, 'Teinté'),
          h('button', { type: 'button', class: 'btn btn-plain' }, 'Simple'),
          h('button', { type: 'button', class: 'btn btn-destructive' }, 'Supprimer'),
          h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Désactivé'),
          h('button', { type: 'button', class: 'btn btn-fab', 'aria-label': 'Ajouter', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' })
        )
      )),

      section({
        header: 'Listes',
        rows: [
          row({ title: 'Ligne simple', value: 'Valeur' }),
          row({ title: 'Avec sous-titre', subtitle: 'Texte secondaire', value: '125 g' }),
          row({ title: 'Avec icône et lien', iconName: 'database', href: '#/design' }),
          row({ title: 'Interrupteur', trailing: switchInput({ checked: true, label: 'Interrupteur' }) }),
          row({ title: 'Valeur manquante', value: '—' })
        ],
        footer: 'Pied de section : explication courte.'
      }),

      card('Contrôles', h('div', { class: 'stack' },
        segmented({
          label: 'Unité',
          options: [{ value: 'g', label: 'Grammes' }, { value: 'percent', label: 'Pourcentage' }],
          value: 'g',
          onChange: () => {}
        }),
        decimalDemo(),
        field({ label: 'Champ en erreur', id: 'demo-err', value: '-5', error: 'Nombre positif attendu.', inputmode: 'decimal', suffix: 'g' })
      )),

      card('Pastilles', h('div', { class: 'cluster' },
        h('span', { class: 'chip chip-brand' }, 'Favori'),
        h('span', { class: 'chip chip-protein' }, 'Protéines'),
        h('span', { class: 'chip chip-carbs' }, 'Glucides'),
        h('span', { class: 'chip chip-fat' }, 'Lipides'),
        h('span', { class: 'chip chip-success' }, 'Cohérent'),
        h('span', { class: 'chip chip-warning' }, 'Écart kcal > 10 %'),
        h('span', { class: 'chip chip-danger' }, 'Erreur'),
        h('span', { class: 'chip' }, 'Neutre')
      )),

      h('div', { class: 'stack' },
        banner({ title: 'Information', text: 'Message neutre.' }),
        banner({ kind: 'warning', title: 'Avertissement', text: 'Objectif calorique très bas.' }),
        banner({ kind: 'danger', title: 'Erreur', text: 'Produit introuvable.' }),
        banner({ kind: 'success', title: 'Succès', text: 'Sauvegarde effectuée.' })
      ),

      card('Retours', h('div', { class: 'cluster' },
        h('button', { type: 'button', class: 'btn btn-tinted', onclick: () => toast('Aliment ajouté au Déjeuner', { action: { label: 'Annuler', onClick: () => toast('Annulé') } }) }, 'Toast'),
        h('button', {
          type: 'button',
          class: 'btn btn-tinted',
          onclick: () => openSheet({
            title: 'Feuille modale',
            content: (close) => h('div', { class: 'stack' },
              h('p', {}, 'Utilisée pour saisir une quantité ou modifier une entrée.'),
              field({ label: 'Quantité', id: 'sheet-qty', inputmode: 'decimal', suffix: 'g', placeholder: '0' }),
              h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: close }, 'Valider')
            )
          })
        }, 'Feuille modale')
      )),

      card('État vide', emptyState({ iconName: 'foods', title: 'Aucun aliment', text: 'Scannez un produit ou créez un aliment personnalisé.' }))
    );
  }
};
