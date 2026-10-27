// Partie « Mensurations » de l'onglet Corps : dernières mesures, courbe d'une mesure par période,
// historique (toucher pour modifier, glisser pour supprimer), choix des mesures suivies.

import { h, iconEl, emptyState, segmented } from '../ui.js';
import { formatNumber, isNum } from '../util/format.js';
import { formatDayLong, formatDayShort } from '../util/dates.js';
import { PERIODS, periodStart } from '../data/weights.js';
import { MEASURES, MEASURE_BY_ID, formatMeasure, seriesOf, latestById, deleteMeasurement, restoreMeasurement } from '../data/measurements.js';
import { weightChart } from './weight-chart.js';
import { swipeToDelete, deleteWithUndo } from './swipe.js';
import { openMeasureSheet, openTrackedSheet } from '../sheets/measure-sheets.js';
import { refresh } from '../router.js';

// Mesure et période affichées, conservées pendant la session.
const memo = { measure: null, period: '3m' };

/** « +1,5 cm », « −0,4 % » */
export function formatMeasureDelta(id, v) {
  if (!isNum(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${formatMeasure(id, Math.abs(r))}`;
}

function latestCard(list, shownIds) {
  const latest = latestById(list);
  const lastDate = list.length ? list[list.length - 1].date : null;
  const cells = shownIds.filter((id) => latest[id]).map((id) => {
    const { last, prev } = latest[id];
    const delta = prev ? last.value - prev.value : null;
    return h('div', { class: 'measure-cell' },
      h('span', { class: 'measure-name' }, MEASURE_BY_ID[id].short),
      h('span', { class: 'measure-value t-num' }, formatMeasure(id, last.value)),
      h('span', { class: 'measure-delta' }, delta === null
        ? (last.date === lastDate ? 'première mesure' : formatDayShort(last.date))
        : `${formatMeasureDelta(id, delta)}${last.date !== lastDate ? ` · ${formatDayShort(last.date)}` : ''}`)
    );
  });
  return h('section', { class: 'card stack', 'aria-label': 'Dernières mesures' },
    h('p', { class: 't-footnote t-secondary' }, `Dernières mesures · ${formatDayLong(lastDate)}`),
    cells.length ? h('div', { class: 'measure-grid' }, cells) : h('p', { class: 'hint' }, 'Aucune valeur pour les mesures suivies.'),
    h('p', { class: 'hint' }, 'Écart avec la mesure précédente de chaque tour.')
  );
}

function chartCard(list, ids, today) {
  const available = ids.filter((id) => seriesOf(list, id).length);
  if (!available.length) return null;
  if (!available.includes(memo.measure)) memo.measure = available[0];
  const host = h('div');
  const chips = h('div', { class: 'cluster measure-chips', role: 'group', 'aria-label': 'Mesure affichée' });
  function paint() {
    chips.replaceChildren(...available.map((id) => h('button', {
      type: 'button',
      class: `chip chip-btn ${id === memo.measure ? 'chip-brand is-selected' : ''}`,
      'aria-pressed': String(id === memo.measure),
      onclick: () => { memo.measure = id; paint(); }
    }, MEASURE_BY_ID[id].short)));
    const id = memo.measure;
    const start = periodStart(memo.period, today);
    const series = seriesOf(list, id).filter((p) => !start || p.date >= start);
    const m = MEASURE_BY_ID[id];
    if (series.length >= 2) {
      const first = series[0];
      const last = series[series.length - 1];
      host.replaceChildren(
        weightChart({
          points: series,
          domain: { from: start || first.date, to: start ? today : last.date },
          value: (p) => p.value,
          format: (v) => formatMeasure(id, v),
          title: `Courbe : ${m.label}`,
          pointLabel: 'Mesure',
          showAverage: false
        }),
        h('dl', { class: 'kv' },
          h('dt', {}, `Évolution (${PERIODS.find((p) => p.id === memo.period).label.toLowerCase()})`),
          h('dd', { class: 't-num' }, formatMeasureDelta(id, last.value - first.value)),
          h('dt', {}, 'Mesures'),
          h('dd', { class: 't-num' }, formatNumber(series.length))
        )
      );
    } else {
      host.replaceChildren(h('p', { class: 'hint wchart-empty' }, series.length
        ? 'Une seule mesure sur cette période : la courbe apparaîtra dès la deuxième.'
        : 'Aucune mesure sur cette période. Choisissez une période plus longue.'));
    }
  }
  paint();
  return h('section', { class: 'card stack', 'aria-label': 'Courbe des mensurations' },
    chips,
    segmented({
      label: 'Période',
      value: memo.period,
      options: PERIODS.map((p) => ({ value: p.id, label: p.label })),
      onChange: (v) => { memo.period = v; paint(); }
    }),
    host
  );
}

function historyList(list, onEdit) {
  const rows = [...list].reverse().map((m) => swipeToDelete(
    h('button', { type: 'button', class: 'entry-row', onclick: () => onEdit(m) },
      h('span', { class: 'entry-main' },
        h('span', { class: 'entry-name' }, formatDayLong(m.date)),
        h('span', { class: 'entry-sub' }, [
          MEASURES.filter((x) => isNum(m.values[x.id])).map((x) => `${x.short} ${formatMeasure(x.id, m.values[x.id])}`).join(' · '),
          m.note
        ].filter(Boolean).join(' — '))
      ),
      iconEl('chevronRight', 'row-chevron')
    ),
    {
      label: `les mesures du ${formatDayShort(m.date)}`,
      onDelete: () => deleteWithUndo({
        remove: () => deleteMeasurement(m.date),
        restore: restoreMeasurement,
        message: `Mesures du ${formatDayShort(m.date)} supprimées`,
        onDone: refresh
      })
    }
  ));
  return h('section', {},
    h('h2', { class: 'section-header' }, 'Historique'),
    h('div', { class: 'card meal-card' }, rows),
    h('p', { class: 'section-footer' }, 'Touchez une date pour modifier ses mesures. Glissez-la vers la gauche pour la supprimer.')
  );
}

/**
 * Contenu de la partie Mensurations. list : saisies triées ; tracked : mesures suivies.
 * Renvoie { nodes, add } : éléments à afficher et action « ajouter ».
 */
export function measuresView({ list, tracked, today }) {
  const add = () => openMeasureSheet({ list, tracked, onDone: refresh });
  const edit = (m) => openMeasureSheet({ list, tracked, measurement: m, onDone: refresh });
  const choose = h('button', {
    type: 'button',
    class: 'btn btn-plain btn-block',
    onclick: () => openTrackedSheet({ tracked, onDone: refresh })
  }, iconEl('settings'), `Mesures suivies : ${tracked.length ? tracked.map((id) => MEASURE_BY_ID[id].short).join(', ') : 'aucune'}`);

  if (!list.length) {
    return {
      add,
      nodes: [
        emptyState({
          iconName: 'weight',
          title: 'Aucune mensuration',
          text: 'Notez vos tours de taille, de hanches, de bras… toutes les 2 à 4 semaines : ils montrent les changements que la balance ne voit pas.',
          action: h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, iconEl('plus'), 'Ajouter des mesures')
        }),
        choose
      ]
    };
  }
  // Mesures affichées : celles suivies, plus celles déjà saisies (pour ne rien masquer).
  const shown = MEASURES.map((m) => m.id).filter((id) => tracked.includes(id) || seriesOf(list, id).length);
  return {
    add,
    nodes: [
      latestCard(list, shown),
      chartCard(list, shown, today),
      h('button', { type: 'button', class: 'btn btn-tinted btn-lg btn-block', onclick: add }, iconEl('plus'), 'Ajouter des mesures'),
      choose,
      historyList(list, edit)
    ]
  };
}
