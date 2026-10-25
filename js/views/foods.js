// Onglet Aliments. Contenu complet en Phase 3 (scan, recherche, aliments personnalisés, favoris).

import { setAppbar, emptyState } from '../ui.js';

export default {
  tab: 'foods',
  render(root) {
    setAppbar({ title: 'Aliments' });
    root.append(emptyState({
      iconName: 'foods',
      title: 'Vos aliments',
      text: 'Phase 3 : scan du code-barres, recherche Open Food Facts et Ciqual, aliments personnalisés, historique et favoris.'
    }));
  }
};
