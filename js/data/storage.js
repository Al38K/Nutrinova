// État du stockage de l'appareil : persistance, espace utilisé, mode « app installée ».

const state = {
  persisted: null,       // true | false | null (API indisponible)
  requestedAt: null
};

/** Demande la persistance du stockage (à chaque lancement). Ne lève jamais d'erreur. */
export async function requestPersistence() {
  state.requestedAt = new Date().toISOString();
  try {
    if (!navigator.storage) { state.persisted = null; return state.persisted; }
    if (typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted()) {
      state.persisted = true;
      return true;
    }
    if (typeof navigator.storage.persist === 'function') {
      state.persisted = await navigator.storage.persist();
      return state.persisted;
    }
    state.persisted = null;
  } catch {
    state.persisted = null;
  }
  return state.persisted;
}

export async function checkPersisted() {
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      state.persisted = await navigator.storage.persisted();
    }
  } catch { /* garde la dernière valeur connue */ }
  return state.persisted;
}

/** { usage, quota } en octets, ou null si l'API n'est pas disponible. */
export async function estimateStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage ?? null, quota: quota ?? null };
    }
  } catch { /* indisponible */ }
  return null;
}

/** Vrai si l'app est ouverte depuis l'icône de l'écran d'accueil (et non dans un onglet Safari). */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

export function getStorageState() {
  return { ...state };
}
