// Accès IndexedDB (wrapper maison, sans dépendance).
// - Une seule connexion partagée, rouverte automatiquement si iOS la coupe (app restée longtemps en arrière-plan).
// - Chaque opération est une transaction ; run() permet des écritures multi-tables atomiques.

import { DB_NAME } from '../config.js';
import { SCHEMA_VERSION, upgrade } from './schema.js';

export class DbError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DbError';
    if (cause) this.cause = cause;
  }
}

let dbPromise = null;

function emit(type, detail) {
  try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* hors fenêtre */ }
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new DbError('IndexedDB n\'est pas disponible sur ce navigateur. Ouvrez nutrinova dans Safari, hors navigation privée.'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    } catch (err) {
      reject(new DbError('Impossible d\'ouvrir la base locale.', err));
      return;
    }
    request.onupgradeneeded = (event) => {
      try {
        upgrade(request.result, event.oldVersion, request.transaction);
      } catch (err) {
        request.transaction.abort();
        reject(new DbError('Échec de la mise à jour de la base locale.', err));
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        // Une version plus récente de l'app veut migrer la base (autre onglet) : on libère la connexion.
        db.close();
        dbPromise = null;
        emit('nutri:db-versionchange');
      };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(new DbError('Impossible d\'ouvrir la base locale.', request.error));
    };
    request.onblocked = () => {
      emit('nutri:db-blocked');
    };
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function isConnectionLost(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return err.name === 'InvalidStateError'
    || err.name === 'UnknownError'
    || /connection.*(lost|closed)|database.*closed|closing/i.test(msg);
}

function resetConnection() {
  if (dbPromise) {
    dbPromise.then((db) => { try { db.close(); } catch { /* déjà fermée */ } }).catch(() => {});
  }
  dbPromise = null;
}

/** Transforme une IDBRequest en Promise. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Exécute `work(tx)` dans une transaction. La Promise est résolue quand la transaction est
 * VALIDÉE (oncomplete), avec la valeur renvoyée par `work`. Si `work` lève une erreur,
 * la transaction est annulée et rien n'est écrit.
 * Important : dans `work`, n'attendre (await) que des requêtes IndexedDB, sinon Safari ferme la transaction.
 */
export async function run(storeNames, mode, work) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const attempt = async () => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(names, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let result;
      let failed = false;
      tx.oncomplete = () => { if (!failed) resolve(result); };
      tx.onerror = () => { failed = true; reject(tx.error || new DbError('Erreur de transaction')); };
      tx.onabort = () => { failed = true; reject(tx.error || new DbError('Transaction annulée')); };
      let out;
      try {
        out = work(tx);
      } catch (err) {
        failed = true;
        try { tx.abort(); } catch { /* déjà terminée */ }
        reject(err);
        return;
      }
      Promise.resolve(out).then(
        (value) => { result = value; },
        (err) => {
          failed = true;
          try { tx.abort(); } catch { /* déjà terminée */ }
          reject(err);
        }
      );
    });
  };
  try {
    return await attempt();
  } catch (err) {
    if (isConnectionLost(err)) {
      resetConnection();
      return attempt();
    }
    throw err;
  }
}

// ---------- Opérations simples ----------

export function get(store, key) {
  return run(store, 'readonly', (tx) => req(tx.objectStore(store).get(key)));
}

export function getAll(store, query, count) {
  return run(store, 'readonly', (tx) => req(tx.objectStore(store).getAll(query, count)));
}

export function getAllByIndex(store, indexName, query, count) {
  return run(store, 'readonly', (tx) => req(tx.objectStore(store).index(indexName).getAll(query, count)));
}

export function getFirstByIndex(store, indexName, query) {
  return run(store, 'readonly', (tx) => req(tx.objectStore(store).index(indexName).get(query)));
}

export function count(store, query) {
  return run(store, 'readonly', (tx) => req(tx.objectStore(store).count(query)));
}

export function put(store, value) {
  return run(store, 'readwrite', (tx) => req(tx.objectStore(store).put(value)));
}

export function putMany(store, values) {
  return run(store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    return values.length;
  });
}

export function del(store, key) {
  return run(store, 'readwrite', (tx) => req(tx.objectStore(store).delete(key)));
}

export function clear(store) {
  return run(store, 'readwrite', (tx) => req(tx.objectStore(store).clear()));
}

/** Nombre d'enregistrements par table. */
export async function countAll(storeNames) {
  return run(storeNames, 'readonly', async (tx) => {
    const out = {};
    for (const name of storeNames) {
      out[name] = await req(tx.objectStore(name).count());
    }
    return out;
  });
}

/** Structure réelle de la base (tables, clés, index) — utilisée par l'autotest. */
export async function describe() {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, 'readonly');
  const stores = {};
  for (const name of names) {
    const os = tx.objectStore(name);
    const indexes = {};
    for (const idxName of Array.from(os.indexNames)) {
      const idx = os.index(idxName);
      indexes[idxName] = { keyPath: idx.keyPath, unique: idx.unique };
    }
    stores[name] = { keyPath: os.keyPath, indexes };
  }
  return { name: db.name, version: db.version, stores };
}
