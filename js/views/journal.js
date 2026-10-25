// Onglet Journal — écran d'accueil. Contenu complet en Phase 2 (4 repas, objectifs, anneau calorique).

import { h, setAppbar, emptyState, installBanner } from '../ui.js';
import { localDateKey, formatDayLong } from '../util/dates.js';

export default {
  tab: 'journal',
  render(root) {
    setAppbar({ title: 'Journal' });
    root.append(
      installBanner(),
      h('div', { class: 'card' },
        h('p', { class: 't-footnote t-secondary' }, 'Aujourd\'hui'),
        h('p', { class: 't-title-2' }, formatDayLong(localDateKey()))
      ),
      emptyState({
        iconName: 'journal',
        title: 'Journal des repas',
        text: 'Phase 2 : petit-déjeuner, déjeuner, dîner et snack, objectifs, anneau calorique et barres de macros mis à jour en temps réel.'
      })
    );
  }
};
