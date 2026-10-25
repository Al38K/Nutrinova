/* nutrinova — service worker (hors ligne).
 * À CHAQUE LIVRAISON : la valeur VERSION doit être identique à APP_VERSION dans js/config.js.
 * Changer VERSION déclenche la mise à jour de l'app sur l'iPhone.
 */
const VERSION = '1.0.0';
const CACHE_PREFIX = 'nutrinova-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Liste exhaustive des fichiers de l'app (chemins relatifs à ce fichier).
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/config.js',
  './js/app.js',
  './js/router.js',
  './js/ui.js',
  './js/icons.js',
  './js/pwa.js',
  './js/util/dates.js',
  './js/util/format.js',
  './js/util/text.js',
  './js/data/db.js',
  './js/data/schema.js',
  './js/data/nutrients.js',
  './js/data/model.js',
  './js/data/settings.js',
  './js/data/storage.js',
  './js/data/selftest.js',
  './js/views/journal.js',
  './js/views/foods.js',
  './js/views/recipes.js',
  './js/views/weight.js',
  './js/views/settings.js',
  './js/views/design.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' contourne le cache HTTP de GitHub Pages (10 min) pour récupérer la vraie nouvelle version.
    await cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
  })());
  // Pas de skipWaiting automatique : l'app propose « Mettre à jour » pour ne pas recharger en pleine saisie.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Les requêtes vers d'autres sites (Open Food Facts en Phase 3) ne sont pas interceptées.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      return fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(req);
  })());
});
