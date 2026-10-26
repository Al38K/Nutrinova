// Courbe du poids en SVG natif (sans bibliothèque) : pesées (points + trait fin) et moyenne
// mobile sur 7 jours (trait épais). Axe horizontal proportionnel aux dates : un trou de deux
// semaines sans pesée se voit. Toucher ou glisser le doigt sur la courbe affiche la pesée la plus proche.

import { h } from '../ui.js';
import { formatNumber } from '../util/format.js';
import { parseDateKey, formatDayLong } from '../util/dates.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 200;
const M = { l: 38, r: 14, t: 14, b: 26 };
const DAY_MS = 86400000;

function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
}

function dayNum(key) {
  return Math.round(parseDateKey(key).getTime() / DAY_MS);
}

function niceStep(span) {
  for (const step of [0.2, 0.5, 1, 2, 5, 10, 20, 50]) if (span / step <= 5) return step;
  return 100;
}

const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });

/** « 70,4 kg » : une décimale, toujours affichée. */
export function formatKg(v) {
  return Number.isFinite(v) ? `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} kg` : '—';
}

/**
 * points : pesées de la période (triées) ; average : moyenne mobile pour ces mêmes dates ;
 * domain : { from, to } dates 'AAAA-MM-JJ' de l'axe horizontal.
 * Renvoie un élément (lecture de la pesée choisie + graphique).
 */
export function weightChart({ points, average, domain }) {
  let x0 = dayNum(domain.from);
  let x1 = dayNum(domain.to);
  if (x1 - x0 < 6) { x0 -= 3; x1 += 3; }
  const values = [...points.map((p) => p.weightKg), ...average.map((a) => a.value)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, 0.4);
  lo -= pad;
  hi += pad;
  const step = niceStep(hi - lo);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;

  const px = (key) => M.l + ((dayNum(key) - x0) / (x1 - x0)) * (W - M.l - M.r);
  const py = (v) => M.t + (1 - (v - yMin) / (yMax - yMin)) * (H - M.t - M.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wchart-svg', role: 'img' });
  const first = points[0];
  const last = points[points.length - 1];
  svg.setAttribute('aria-label', `Courbe du poids : ${points.length} pesées, de ${formatKg(first.weightKg)} le ${formatDayLong(first.date)} à ${formatKg(last.weightKg)} le ${formatDayLong(last.date)}.`);

  // Grille horizontale et graduations
  const ticks = Math.round((yMax - yMin) / step);
  const decimals = step < 1 ? 1 : 0;
  for (let i = 0; i <= ticks; i += 1) {
    const v = yMin + i * step;
    const y = py(v);
    svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'wchart-grid' }));
    const t = s('text', { x: M.l - 6, y: y + 3.5, 'text-anchor': 'end', class: 'wchart-label' });
    t.textContent = formatNumber(v, decimals);
    svg.append(t);
  }

  // Dates : début, milieu, fin
  const spanDays = x1 - x0;
  const fmt = spanDays > 300 ? monthFmt : shortFmt;
  const xLabels = [
    { day: x0, anchor: 'start' },
    { day: Math.round((x0 + x1) / 2), anchor: 'middle' },
    { day: x1, anchor: 'end' }
  ];
  for (const xl of xLabels) {
    const x = M.l + ((xl.day - x0) / (x1 - x0)) * (W - M.l - M.r);
    const t = s('text', { x, y: H - 6, 'text-anchor': xl.anchor, class: 'wchart-label' });
    t.textContent = fmt.format(new Date(xl.day * DAY_MS + 12 * 3600000));
    svg.append(t);
  }

  // Pesées : trait fin et points
  const rawD = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.date).toFixed(1)},${py(p.weightKg).toFixed(1)}`).join('');
  if (points.length > 1) svg.append(s('path', { d: rawD, class: 'wchart-raw' }));
  for (const p of points) svg.append(s('circle', { cx: px(p.date), cy: py(p.weightKg), r: 2.6, class: 'wchart-dot' }));

  // Moyenne mobile
  if (average.length > 1) {
    const avgD = average.map((a, i) => `${i ? 'L' : 'M'}${px(a.date).toFixed(1)},${py(a.value).toFixed(1)}`).join('');
    svg.append(s('path', { d: avgD, class: 'wchart-avg' }));
  }

  // Sélection
  const guide = s('line', { y1: M.t, y2: H - M.b, class: 'wchart-guide' });
  const mark = s('circle', { r: 5, class: 'wchart-mark' });
  svg.append(guide, mark);

  const readout = h('p', { class: 'wchart-readout', 'aria-live': 'polite' });
  function select(i) {
    const p = points[i];
    const a = average[i];
    const x = px(p.date);
    guide.setAttribute('x1', x);
    guide.setAttribute('x2', x);
    mark.setAttribute('cx', x);
    mark.setAttribute('cy', py(p.weightKg));
    // replaceChildren écrirait « null » en texte : seuls les éléments présents sont passés.
    readout.replaceChildren(...[
      h('span', { class: 'wchart-readout-date' }, formatDayLong(p.date)),
      h('span', { class: 'wchart-readout-value t-num' }, formatKg(p.weightKg)),
      a && a.count > 1 ? h('span', { class: 'wchart-readout-avg' }, `moyenne 7 j : ${formatKg(a.value)} (${a.count} pesées)`) : null
    ].filter(Boolean));
  }

  // Zone tactile : toucher ou glisser horizontalement ; le défilement vertical de la page reste possible.
  const hit = s('rect', { x: M.l - 10, y: 0, width: W - M.l - M.r + 20, height: H, class: 'wchart-hit' });
  svg.append(hit);
  let pressed = false;
  const pick = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const sx = ((e.clientX - rect.left) * W) / rect.width;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(px(p.date) - sx);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    select(best);
  };
  hit.addEventListener('pointerdown', (e) => { pressed = true; pick(e); });
  hit.addEventListener('pointermove', (e) => { if (pressed || e.pointerType === 'mouse') pick(e); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) hit.addEventListener(type, () => { pressed = false; });

  select(points.length - 1);

  return h('div', { class: 'wchart' },
    readout,
    svg,
    h('div', { class: 'wchart-legend', 'aria-hidden': 'true' },
      h('span', {}, h('span', { class: 'wchart-key wchart-key-dot' }), 'Pesée'),
      h('span', {}, h('span', { class: 'wchart-key wchart-key-avg' }), 'Moyenne sur 7 jours')
    )
  );
}
