// Composants d'interface réutilisables. Le texte est toujours inséré comme texte (jamais en HTML),
// ce qui protège contre les noms de produits malformés venant d'Open Food Facts.

import { icon } from './icons.js';
import { isNum, formatNumber } from './util/format.js';
import { isStandalone } from './data/storage.js';

/** Crée un élément DOM : h('div', { class: 'card', onclick: fn }, 'texte', enfant). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // réservé aux icônes internes
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Icône interne sous forme d'élément. */
export function iconEl(name, cls) {
  const span = document.createElement('span');
  span.innerHTML = icon(name);
  const svg = span.firstElementChild;
  if (svg && cls) svg.setAttribute('class', cls);
  return svg || span;
}

// ---------- Bandeau supérieur ----------

export function setAppbar({ title, leading = null, trailing = null }) {
  document.getElementById('appbar-title').textContent = title;
  const lead = document.getElementById('appbar-leading');
  const trail = document.getElementById('appbar-trailing');
  lead.replaceChildren(...(leading ? [leading] : []));
  trail.replaceChildren(...(trailing ? [trailing] : []));
  document.title = title === 'nutrinova' ? 'nutrinova' : `${title} · nutrinova`;
}

export function backButton(href, label = 'Retour') {
  return h('a', { class: 'appbar-btn', href, 'aria-label': label }, iconEl('chevronLeft'), h('span', {}, label));
}

// ---------- Listes groupées ----------

/** Section iOS : en-tête, liste de lignes, pied de section. */
export function section({ header, footer, rows = [], id }) {
  return h('section', { id },
    header ? h('h2', { class: 'section-header' }, header) : null,
    h('div', { class: 'list' }, rows),
    footer ? h('p', { class: 'section-footer' }, footer) : null
  );
}

/**
 * Ligne de liste. href → lien ; onClick → bouton ; sinon ligne statique.
 * { title, subtitle, value, iconName, iconBg, chevron, trailing }
 */
export function row({ title, subtitle, value, iconName, iconBg, href, onClick, chevron, trailing, className = '' }) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  const attrs = { class: `row ${iconName ? 'has-icon' : ''} ${className}`.trim() };
  if (href) attrs.href = href;
  if (onClick) { attrs.type = 'button'; attrs.onclick = onClick; }
  return h(tag, attrs,
    iconName ? h('span', { class: 'row-icon', style: iconBg ? { background: iconBg } : null }, iconEl(iconName)) : null,
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, title),
      subtitle ? h('span', { class: 'row-subtitle' }, subtitle) : null
    ),
    value !== undefined && value !== null ? h('span', { class: 'row-value' }, value) : null,
    trailing || null,
    chevron || href ? iconEl('chevronRight', 'row-chevron') : null
  );
}

// ---------- Bannières, états vides ----------

export function banner({ kind = 'info', title, text, actions }) {
  const iconName = kind === 'warning' ? 'warning' : kind === 'danger' ? 'cross' : kind === 'success' ? 'check' : 'info';
  return h('div', { class: `banner ${kind !== 'info' ? `banner-${kind}` : ''}`, role: kind === 'danger' ? 'alert' : 'status' },
    iconEl(iconName),
    h('div', { class: 'banner-body' },
      title ? h('p', { class: 'banner-title' }, title) : null,
      text ? h('p', {}, text) : null,
      actions || null
    )
  );
}

export function emptyState({ iconName, title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, iconEl(iconName)),
    h('p', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action ? h('div', { class: 'empty-actions' }, action) : null
  );
}

// ---------- Contrôles ----------

/** Contrôle segmenté. options : [{ value, label }] ; onChange(value). */
export function segmented({ options, value, onChange, label }) {
  const root = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const buttons = options.map((opt) => h('button', {
    type: 'button',
    'aria-pressed': String(opt.value === value),
    onclick: () => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === btnFor(opt.value)));
      onChange(opt.value);
    }
  }, opt.label));
  const btnFor = (v) => buttons[options.findIndex((o) => o.value === v)];
  root.append(...buttons);
  return root;
}

export function switchInput({ checked = false, onChange, label }) {
  return h('input', {
    type: 'checkbox',
    role: 'switch',
    class: 'switch',
    'aria-label': label,
    checked: checked || null,
    onchange: (e) => onChange && onChange(e.target.checked)
  });
}

/** Champ texte/numérique. inputmode="decimal" affiche le pavé numérique avec virgule sur iPhone. */
export function field({ label, id, value = '', placeholder, suffix, inputmode, type = 'text', onInput, error }) {
  const input = h('input', {
    class: 'input',
    id,
    type,
    value,
    placeholder,
    inputmode,
    autocomplete: 'off',
    enterkeyhint: 'done',
    oninput: onInput ? (e) => onInput(e.target.value, e) : null
  });
  return h('label', { class: 'field', for: id },
    h('span', { class: 'field-label' }, label),
    h('span', { class: `input-wrap ${error ? 'is-invalid' : ''}` }, input, suffix ? h('span', { class: 'input-suffix' }, suffix) : null),
    error ? h('span', { class: 'field-error' }, error) : null
  );
}

// ---------- Anneau et barres ----------

/**
 * Anneau de progression. value et goal en kcal ; centre = texte libre.
 * Si goal est inconnu, l'anneau reste vide (aucune valeur inventée).
 */
export function ring({ value, goal, centerNumber, centerLabel, size = 168, stroke = 14, onBrand = false }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = isNum(value) && isNum(goal) && goal > 0 ? value / goal : 0;
  const shown = Math.min(Math.max(ratio, 0), 1);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls, offset) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('class', cls);
    el.setAttribute('cx', size / 2);
    el.setAttribute('cy', size / 2);
    el.setAttribute('r', r);
    el.setAttribute('stroke-width', stroke);
    if (offset !== undefined) {
      el.setAttribute('stroke-dasharray', c);
      el.setAttribute('stroke-dashoffset', offset);
    }
    return el;
  };
  svg.append(mk('ring-track'));
  if (shown > 0) svg.append(mk('ring-value', c * (1 - shown)));
  return h('div', {
    class: `ring ${ratio > 1 ? 'is-over' : ''} ${onBrand ? 'ring-on-brand' : ''}`,
    style: { '--ring-size': `${size}px` },
    role: 'img',
    'aria-label': `${centerNumber} ${centerLabel}`
  },
    svg,
    h('div', { class: 'ring-center' },
      h('span', { class: 'ring-number' }, centerNumber),
      h('span', { class: 'ring-label' }, centerLabel)
    )
  );
}

/** Barre de macro : kind = 'protein' | 'carbs' | 'fat'. Valeurs en g ; null → « — ». */
export function macroBar({ kind, label, value, goal }) {
  const ratio = isNum(value) && isNum(goal) && goal > 0 ? value / goal : 0;
  const fill = h('div', { class: 'bar-fill' });
  fill.style.width = `${Math.min(ratio, 1) * 100}%`;
  const valueText = `${formatNumber(value, 0)} / ${formatNumber(goal, 0)} g`;
  return h('div', { class: `macro macro-${kind} ${ratio > 1 ? 'is-over' : ''}` },
    h('div', { class: 'macro-head' },
      h('span', { class: 'macro-name' }, label),
      h('span', { class: 'macro-value' }, valueText)
    ),
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(isNum(goal) ? goal : 0), 'aria-valuenow': String(isNum(value) ? value : 0) }, fill)
  );
}

// ---------- Toasts ----------

/** Message temporaire en bas d'écran. action : { label, onClick }. duration 0 = reste affiché. */
export function toast(message, { action, duration = 3000 } = {}) {
  const host = document.getElementById('toast-host');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-text' }, message));
  const dismiss = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  if (action) {
    el.append(h('button', { type: 'button', class: 'btn', onclick: () => { dismiss(); action.onClick(); } }, action.label));
  }
  host.append(el);
  if (duration > 0) setTimeout(dismiss, duration);
  return { dismiss };
}

// ---------- Feuille modale ----------

/**
 * Feuille modale en bas d'écran (élément <dialog>, Safari 15.4+).
 * content : élément ou fonction(close) → élément. Renvoie { close }.
 */
export function openSheet({ title, content, onClose }) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => dialog.close();
  dialog.append(
    h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('span'),
      h('h2', { class: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'btn btn-plain', onclick: close }, 'OK')
    ),
    h('div', { class: 'sheet-body' }, typeof content === 'function' ? content(close) : content)
  );
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (onClose) onClose(); });
  document.body.append(dialog);
  dialog.showModal();
  return { close };
}

/** Rappel d'installation, affiché tant que l'app est ouverte dans un onglet Safari. */
export function installBanner() {
  if (isStandalone()) return null;
  return banner({
    kind: 'warning',
    title: 'Installez nutrinova sur l\'écran d\'accueil',
    text: 'Sans installation, Safari peut effacer vos données. Dans Safari : bouton Partager (ou « … » puis Partager), puis « Sur l\'écran d\'accueil ». Ouvrez ensuite l\'app depuis son icône.'
  });
}

// ---------- Erreur bloquante ----------

export function renderFatal(container, title, err) {
  container.replaceChildren(h('div', { class: 'fatal' },
    h('div', { class: 'empty-icon', style: { margin: '0 auto 16px', background: 'var(--danger-soft)', color: 'var(--danger)' } }, iconEl('warning')),
    h('p', { class: 't-title-3' }, title),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Fermez complètement l\'app puis rouvrez-la. Si le problème persiste, copiez le détail ci-dessous.'),
    h('pre', {}, `${err && err.name ? err.name : 'Erreur'} : ${err && err.message ? err.message : String(err)}${err && err.cause ? `\nCause : ${err.cause.name} — ${err.cause.message}` : ''}`)
  ));
}
