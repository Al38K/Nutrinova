// Schéma IndexedDB de nutrinova (base "nutri").
// Toute évolution future = SCHEMA_VERSION + 1 et une nouvelle entrée dans MIGRATIONS.
// Les migrations existantes ne sont JAMAIS modifiées une fois livrées.

export const SCHEMA_VERSION = 3;

export const STORES = Object.freeze({
  foods: 'foods',
  ciqual: 'ciqual',
  recipes: 'recipes',
  journal: 'journal',
  goals: 'goals',
  weights: 'weights',
  activities: 'activities',
  measurements: 'measurements',
  settings: 'settings'
});

export const STORE_LABELS = Object.freeze({
  foods: 'Aliments',
  ciqual: 'Table Ciqual',
  recipes: 'Recettes',
  journal: 'Entrées du journal',
  goals: 'Objectifs',
  weights: 'Pesées',
  activities: 'Activités',
  measurements: 'Mensurations',
  settings: 'Réglages'
});

// Description déclarative (sert aussi à l'autotest pour vérifier la structure réelle).
export const SCHEMA = Object.freeze({
  foods: {
    keyPath: 'id',
    indexes: {
      barcode: { keyPath: 'barcode' },
      nameNorm: { keyPath: 'nameNorm' },
      source: { keyPath: 'source' },
      source_ref: { keyPath: ['source', 'sourceRef'] },
      lastUsedAt: { keyPath: 'lastUsedAt' },
      useCount: { keyPath: 'useCount' }
    }
  },
  ciqual: {
    keyPath: 'code',
    indexes: {
      nameNorm: { keyPath: 'nameNorm' },
      group: { keyPath: 'group' }
    }
  },
  recipes: {
    keyPath: 'id',
    indexes: {
      foodId: { keyPath: 'foodId' },
      updatedAt: { keyPath: 'updatedAt' }
    }
  },
  journal: {
    keyPath: 'id',
    indexes: {
      date: { keyPath: 'date' },
      date_meal: { keyPath: ['date', 'meal'] },
      foodId: { keyPath: 'foodId' }
    }
  },
  goals: {
    keyPath: 'id',
    indexes: {
      effectiveFrom: { keyPath: 'effectiveFrom', unique: true }
    }
  },
  weights: {
    keyPath: 'date',
    indexes: {}
  },
  // v2 (v1.6.0) : calories dépensées saisies à la main (sport, activité).
  activities: {
    keyPath: 'id',
    indexes: {
      date: { keyPath: 'date' }
    }
  },
  // v3 (v1.7.0) : mensurations, une saisie par jour (clé = date).
  measurements: {
    keyPath: 'date',
    indexes: {}
  },
  settings: {
    keyPath: 'key',
    indexes: {}
  }
});

function createStoreFromSchema(db, name) {
  const def = SCHEMA[name];
  const store = db.createObjectStore(name, { keyPath: def.keyPath });
  for (const [indexName, idx] of Object.entries(def.indexes)) {
    store.createIndex(indexName, idx.keyPath, { unique: Boolean(idx.unique) });
  }
}

// Tables créées par chaque version (la v1 ne doit pas créer les tables ajoutées plus tard).
const V1_STORES = ['foods', 'ciqual', 'recipes', 'journal', 'goals', 'weights', 'settings'];

const MIGRATIONS = {
  // v1 : création des tables d'origine.
  1(db) {
    for (const name of V1_STORES) {
      if (!db.objectStoreNames.contains(name)) createStoreFromSchema(db, name);
    }
  },
  // v2 (v1.6.0) : table des activités. Les données existantes ne sont pas touchées.
  2(db) {
    if (!db.objectStoreNames.contains('activities')) createStoreFromSchema(db, 'activities');
  },
  // v3 (v1.7.0) : table des mensurations. Les données existantes ne sont pas touchées.
  3(db) {
    if (!db.objectStoreNames.contains('measurements')) createStoreFromSchema(db, 'measurements');
  }
};

/** Appelé par indexedDB.open lors d'une création ou d'une montée de version. */
export function upgrade(db, oldVersion, tx) {
  for (let v = oldVersion + 1; v <= SCHEMA_VERSION; v += 1) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new Error(`Migration manquante pour la version ${v}`);
    migrate(db, tx);
  }
}
