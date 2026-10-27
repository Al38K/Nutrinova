// Calories par jour sur une période (SVG natif) : une barre par journée saisie, l'objectif du jour
// (objectif + activité) en trait. Couleur : proche de l'objectif (±10 %), en dessous, au-dessus,
// partiel (au moins un aliment sans calories : la barre est un minimum). Jour sans saisie : pas de barre.
// Toucher ou glisser sur le graphique affiche le détail du jour.

import { h } from '../ui.js';
import { formatNumber, isNum } from '../util/format.js';
import { formatDayLong } from '../util/dates.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 190;
const M = { l: 40, r: 8, t: 12, b: 24 };

function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
}

function niceMax(v) {
  if (!(v > 0)) return 1000;
  const steps = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000];
  return steps.find((x) => x >= v * 1.08) || Math.ceil(v / 5000) * 5000;
}

const STATUS_TEXT = {
  near: 'proche de l\'objectif',
  under: 'en dessous de l\'objectif',
  over: 'au-dessus de l\'objectif',
  partial: 'total partiel (aliment sans calories)',
  nogoal: 'sans objectif',
  empty: 'rien de saisi'
};

const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** days : lignes de dailySeries. Renvoie un élément (lecture du jour choisi + graphique + légende). */
export function kcalChart(days) {
  const n = days.length;
  const values = days.flatMap((d) => [d.kcal, d.budget]).filter(isNum);
  const yMax = niceMax(Math.max(0, ...values));
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const slot = plotW / n;
  const barW = Math.max(1.5, Math.min(26, slot * 0.68));
  const xOf = (i) => M.l + slot * i + slot / 2;
  const yOf = (v) => M.t + (1 - v / yMax) * plotH;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kchart-svg', role: 'img' });
  const logged = days.filter((d) => d.count > 0).length;
  svg.setAttribute('aria-label', `Calories par jour : ${logged} journées saisies sur ${n}.`);

  // Grille : 0, moitié, maximum
  for (const v of [0, yMax / 2, yMax]) {
    const y = yOf(v);
    svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'wchart-grid' }));
    const t = s('text', { x: M.l - 6, y: y + 3.5, 'text-anchor': 'end', class: 'wchart-label' });
    t.textContent = formatNumber(v);
    svg.append(t);
  }

  // Barres
  days.forEach((d, i) => {
    const x = xOf(i);
    if (d.count === 0 || !isNum(d.kcal)) {
      svg.append(s('circle', { cx: x, cy: yOf(0) - 1.5, r: Math.min(1.6, barW / 2), class: 'kchart-empty' }));
      return;
    }
    const y = yOf(Math.min(d.kcal, yMax));
    const hgt = Math.max(1, yOf(0) - y);
    svg.append(s('rect', { x: x - barW / 2, y, width: barW, height: hgt, rx: Math.min(4, barW / 2), class: `kchart-bar is-${d.status}` }));
  });

  // Objectif du jour : trait en escalier (interrompu sans objectif)
  let path = '';
  let open = false;
  days.forEach((d, i) => {
    if (!isNum(d.budget)) { open = false; return; }
    const y = yOf(Math.min(d.budget, yMax)).toFixed(1);
    const x0 = (M.l + slot * i).toFixed(1);
    const x1 = (M.l + slot * (i + 1)).toFixed(1);
    path += `${open ? 'L' : 'M'}${x0},${y}L${x1},${y}`;
    open = true;
  });
  if (path) svg.append(s('path', { d: path, class: 'kchart-goal' }));

  // Dates : début, milieu, fin
  for (const [i, anchor] of [[0, 'start'], [Math.floor((n - 1) / 2), 'middle'], [n - 1, 'end']]) {
    const t = s('text', { x: anchor === 'start' ? M.l : anchor === 'end' ? W - M.r : xOf(i), y: H - 6, 'text-anchor': anchor, class: 'wchart-label' });
    const [y, m, dd] = days[i].date.split('-').map(Number);
    t.textContent = shortFmt.format(new Date(y, m - 1, dd));
    svg.append(t);
  }

  // Sélection
  const guide = s('rect', { y: M.t, height: plotH, width: Math.max(slot, 2), class: 'kchart-select' });
  svg.insertBefore(guide, svg.firstChild);
  const readout = h('p', { class: 'wchart-readout', 'aria-live': 'polite' });
  function select(i) {
    const d = days[i];
    guide.setAttribute('x', M.l + slot * i);
    readout.replaceChildren(
      h('span', { class: 'wchart-readout-date' }, formatDayLong(d.date)),
      h('span', { class: 'wchart-readout-value t-num' }, d.count ? `${formatNumber(d.kcal)} kcal${d.partial ? ' min.' : ''}` : '—'),
      h('span', { class: 'wchart-readout-avg' }, [
        isNum(d.budget) ? `objectif ${formatNumber(d.budget)} kcal${d.burned > 0 ? ` (dont ${formatNumber(d.burned)} d'activité)` : ''}` : 'aucun objectif',
        STATUS_TEXT[d.status]
      ].join(' · '))
    );
  }
  const hit = s('rect', { x: M.l, y: 0, width: plotW, height: H, class: 'wchart-hit' });
  svg.append(hit);
  let pressed = false;
  const pick = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const sx = ((e.clientX - rect.left) * W) / rect.width;
    select(Math.max(0, Math.min(n - 1, Math.floor((sx - M.l) / slot))));
  };
  hit.addEventListener('pointerdown', (e) => { pressed = true; pick(e); });
  hit.addEventListener('pointermove', (e) => { if (pressed || e.pointerType === 'mouse') pick(e); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) hit.addEventListener(type, () => { pressed = false; });

  let lastLogged = -1;
  days.forEach((d, i) => { if (d.count) lastLogged = i; });
  select(lastLogged >= 0 ? lastLogged : n - 1);

  const key = (cls, label) => h('span', {}, h('span', { class: `kchart-key ${cls}` }), label);
  return h('div', { class: 'wchart kchart' },
    readout,
    svg,
    h('div', { class: 'wchart-legend kchart-legend', 'aria-hidden': 'true' },
      key('is-near', '±10 %'),
      key('is-under', 'En dessous'),
      key('is-over', 'Au-dessus'),
      key('is-partial', 'Partiel'),
      key('kchart-key-goal', 'Objectif')
    )
  );
}
