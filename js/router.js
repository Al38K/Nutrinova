// Navigation par onglets basée sur l'ancre de l'adresse (#/journal, #/foods…).
// Fonctionne sur GitHub Pages sans configuration serveur et hors ligne.

import { h, iconEl, renderFatal } from './ui.js';

let config = null;
let current = { route: null, cleanup: null };
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
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) render();
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
          // Toucher l'onglet déjà ouvert remonte en haut de la page (comportement iOS).
          if (tab.id === current.route) {
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

  if (current.route) scrollMemory.set(current.route, window.scrollY);
  if (typeof current.cleanup === 'function') {
    try { current.cleanup(); } catch { /* sans conséquence */ }
  }
  current = { route, cleanup: null };

  renderTabbar(view.tab || route);
  const container = document.getElementById('view');
  const fresh = document.createElement('main');
  fresh.id = 'view';
  fresh.className = 'view';
  fresh.tabIndex = -1;
  container.replaceWith(fresh);

  try {
    const cleanup = await view.render(fresh, { params, navigate });
    if (token !== renderToken) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    current.cleanup = cleanup || null;
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    renderFatal(fresh, 'Cet écran n\'a pas pu s\'afficher', err);
  }
  window.scrollTo(0, scrollMemory.get(route) || 0);
}

/** Rafraîchit l'écran courant (après une modification de données). */
export function refresh() {
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
