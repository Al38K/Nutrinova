// Navigation basée sur l'ancre de l'adresse (#/journal, #/journal/2026-10-25, #/meal/2026-10-25/lunch…).
// Fonctionne sur GitHub Pages sans configuration serveur et hors ligne.
// Le nouvel écran est construit hors de la page puis affiché d'un coup : pas de clignotement
// lors d'un rafraîchissement après un ajout, une modification ou une suppression.

import { h, iconEl, renderFatal } from './ui.js';

let config = null;
let current = { route: null, key: null, cleanup: null };
let renderToken = 0;
const scrollMemory = new Map();

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [route, ...rest] = raw.split('/');
  return { route: route || '', params: rest.filter(Boolean) };
}

export function href(route) {
  return `#/${route}`;
}

export function navigate(route, { replace = false } = {}) {
  const target = href(route);
  if (replace) {
    history.replaceState(null, '', target);
    render();
  } else {
    location.hash = target;
  }
}

function renderTabbar(activeTab) {
  const bar = document.getElementById('tabbar');
  if (!bar.childElementCount) {
    for (const tab of config.tabs) {
      bar.append(h('a', {
        class: 'tab',
        href: href(tab.id),
        dataset: { tab: tab.id },
        onclick: (e) => {
          // Toucher l'onglet déjà affiché remonte en haut de la page (comportement iOS).
          // Depuis un autre jour du journal, l'onglet Journal ramène à aujourd'hui.
          if (location.hash === href(tab.id)) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      }, iconEl(tab.icon), h('span', {}, tab.label)));
    }
  }
  for (const a of bar.querySelectorAll('.tab')) {
    if (a.dataset.tab === activeTab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function render() {
  const { route, params } = parseHash();
  const view = config.views[route];
  if (!view) {
    navigate(config.defaultRoute, { replace: true });
    return;
  }
  const token = ++renderToken;
  const key = location.hash || href(route);
  if (current.key) scrollMemory.set(current.key, window.scrollY);

  renderTabbar(view.tab || route);
  const fresh = document.createElement('main');
  fresh.id = 'view';
  fresh.className = 'view';
  fresh.tabIndex = -1;

  let cleanup = null;
  try {
    cleanup = await view.render(fresh, { params, navigate });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    renderFatal(fresh, 'Cet écran n\'a pas pu s\'afficher', err);
  }
  if (token !== renderToken) {
    // Un autre écran a été demandé entre-temps : celui-ci est abandonné.
    if (typeof cleanup === 'function') cleanup();
    return;
  }
  if (typeof current.cleanup === 'function') {
    try { current.cleanup(); } catch { /* sans conséquence */ }
  }
  current = { route, key, cleanup: typeof cleanup === 'function' ? cleanup : null };
  document.getElementById('view').replaceWith(fresh);
  window.scrollTo(0, scrollMemory.get(key) || 0);
}

/** Réaffiche l'écran courant (après une modification de données), en gardant la position. */
export function refresh() {
  if (current.key) scrollMemory.set(current.key, window.scrollY);
  return render();
}

export function currentRoute() {
  return current.route;
}

/** config : { views: { id: view }, tabs: [{ id, label, icon }], defaultRoute } */
export function startRouter(cfg) {
  config = cfg;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', render);
  return render();
}
