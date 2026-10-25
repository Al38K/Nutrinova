// Service worker : enregistrement, mise à jour proposée à l'utilisateur, version hors ligne.

import { toast } from './ui.js';

let registration = null;
let reloading = false;
let updateToastShown = false;

function showUpdateToast(worker) {
  if (updateToastShown) return;
  updateToastShown = true;
  toast('Nouvelle version disponible', {
    duration: 0,
    action: {
      label: 'Mettre à jour',
      onClick: () => worker.postMessage({ type: 'SKIP_WAITING' })
    }
  });
}

function watch(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      // « installed » avec un contrôleur existant = mise à jour prête (pas une première installation).
      if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(nw);
    });
  });
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    watch(registration);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Ne recharge que si l'utilisateur a demandé la mise à jour.
      if (reloading || !updateToastShown) return;
      reloading = true;
      location.reload();
    });
    // Recherche de mise à jour à chaque retour au premier plan (au plus une fois par minute).
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) {
        lastCheck = Date.now();
        registration.update().catch(() => {});
      }
    });
    return registration;
  } catch (err) {
    console.warn('Service worker non enregistré :', err);
    return null;
  }
}

/** Version annoncée par le service worker actif, ou null (inactif / délai dépassé). */
export async function getServiceWorkerVersion(timeoutMs = 1500) {
  if (!('serviceWorker' in navigator)) return null;
  const reg = registration || await navigator.serviceWorker.getRegistration('./').catch(() => null);
  const worker = reg && reg.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && e.data.version ? e.data.version : null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}
