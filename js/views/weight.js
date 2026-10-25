// Onglet Poids. Contenu complet en Phase 5.

import { setAppbar, emptyState } from '../ui.js';

export default {
  tab: 'weight',
  render(root) {
    setAppbar({ title: 'Poids' });
    root.append(emptyState({
      iconName: 'weight',
      title: 'Suivi du poids',
      text: 'Phase 5 : saisie des pesées, rappel hebdomadaire et courbe avec moyenne sur 7 jours.'
    }));
  }
};
