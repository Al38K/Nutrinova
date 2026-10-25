// Onglet Recettes. Contenu complet en Phase 4.

import { setAppbar, emptyState } from '../ui.js';

export default {
  tab: 'recipes',
  render(root) {
    setAppbar({ title: 'Recettes' });
    root.append(emptyState({
      iconName: 'recipes',
      title: 'Vos recettes',
      text: 'Phase 4 : création à partir d\'ingrédients, macros totales, par portion et pour 100 g, poids cuit optionnel.'
    }));
  }
};
