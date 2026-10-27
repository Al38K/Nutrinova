// Onglet Corps : deux parties, Poids et Mensurations (choix en haut de l'écran).
// Poids : dernière pesée, courbe (pesées + moyenne mobile sur 7 jours) sur 1 mois, 3 mois,
// 1 an ou tout, statistiques de la période, rappel hebdomadaire, historique des pesées.
// Mensurations : voir components/measures-view.js.

import { h, mount, setAppbar, iconEl, emptyState, segmented, section, row } from '../ui.js';
import { formatNumber } from '../util/format.js';
import { localDateKey, formatDayLong, formatDayShort } from '../util/dates.js';
import { listWeights, movingAverage, periodStart, weightStats, deleteWeight, restoreWeights, PERIODS } from '../data/weights.js';
import { swipeToDelete, deleteWithUndo } from '../components/swipe.js';
import { getReminder, reminderStatus, reminderLabel } from '../data/reminder.js';
import { weightChart, formatKg } from '../components/weight-chart.js';
import { openWeightSheet, openReminderSheet, weighBanner } from '../sheets/weight-sheets.js';
import { refresh } from '../router.js';
import { listMeasurements, getTracked } from '../data/measurements.js';
import { measuresView } from '../components/measures-view.js';

// Période choisie et affichage de l'historique, conservés pendant la session.
const memo = { period: '3m', showAll: false, part: 'weight' };
const HISTORY_SHOWN = 20;

/** « +1,2 kg », « −0,4 kg », « 0,0 kg » */
function formatDelta(v) {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${formatKg(Math.abs(r))}`;
}

function periodLabel(id) {
  const p = PERIODS.find((x) => x.id === id);
  return p ? p.label : '';
}

function chartBlock(weights, avgByDate, today) {
  const start = periodStart(memo.period, today);
  const inPeriod = start ? weights.filter((w) => w.date >= start) : weights;
  const stats = weightStats(inPeriod);
  const body = [];

  if (inPeriod.length >= 2) {
    body.push(weightChart({
      points: inPeriod,
      average: inPeriod.map((w) => avgByDate.get(w.date)),
      domain: { from: start || inPeriod[0].date, to: start ? today : inPeriod[inPeriod.length - 1].date }
    }));
  } else {
    body.push(h('p', { class: 'hint wchart-empty' }, inPeriod.length
      ? 'Une seule pesée sur cette période : la courbe apparaîtra dès la deuxième.'
      : 'Aucune pesée sur cette période. Choisissez une période plus longue.'));
  }

  const kv = h('dl', { class: 'kv' },
    h('dt', {}, `Évolution (${periodLabel(memo.period).toLowerCase()})`),
    h('dd', { class: 't-num' }, stats.change === null ? '—' : formatDelta(stats.change)),
    h('dt', {}, 'Plus bas'),
    h('dd', { class: 't-num' }, stats.min ? `${formatKg(stats.min.weightKg)} · ${formatDayShort(stats.min.date)}` : '—'),
    h('dt', {}, 'Plus haut'),
    h('dd', { class: 't-num' }, stats.max ? `${formatKg(stats.max.weightKg)} · ${formatDayShort(stats.max.date)}` : '—'),
    h('dt', {}, 'Pesées'),
    h('dd', { class: 't-num' }, formatNumber(stats.count))
  );
  return h('div', { class: 'stack' }, ...body, kv);
}

function historyList(weights, onEdit) {
  const desc = [...weights].reverse();
  const shown = memo.showAll ? desc : desc.slice(0, HISTORY_SHOWN);
  const rows = shown.map((w) => {
    const i = weights.indexOf(w);
    const prev = i > 0 ? weights[i - 1] : null;
    const delta = prev ? w.weightKg - prev.weightKg : null;
    const r = delta === null ? null : Math.round(delta * 10) / 10;
    return swipeToDelete(h('button', { type: 'button', class: 'entry-row', onclick: () => onEdit(w) },
      h('span', { class: 'entry-main' },
        h('span', { class: 'entry-name' }, formatDayLong(w.date)),
        h('span', { class: 'entry-sub' }, [
          r === null ? 'Première pesée' : `${formatDelta(r)} depuis le ${formatDayShort(prev.date)}`,
          w.note
        ].filter(Boolean).join(' · '))
      ),
      h('span', { class: 'entry-kcal t-num weight-value' }, formatKg(w.weightKg)),
      iconEl('chevronRight', 'row-chevron')
    ), {
      label: `la pesée du ${formatDayShort(w.date)}`,
      onDelete: () => deleteWithUndo({
        remove: () => deleteWeight(w.date),
        restore: (removed) => restoreWeights([removed]),
        message: `Pesée du ${formatDayShort(w.date)} supprimée`,
        onDone: refresh
      })
    });
  });
  return h('section', {},
    h('h2', { class: 'section-header' }, 'Historique'),
    h('div', { class: 'card meal-card' }, rows),
    desc.length > HISTORY_SHOWN
      ? h('button', {
          type: 'button',
          class: 'btn btn-plain btn-block',
          onclick: () => { memo.showAll = !memo.showAll; refresh(); }
        }, memo.showAll ? 'Afficher moins' : `Afficher les ${formatNumber(desc.length)} pesées`)
      : null,
    h('p', { class: 'section-footer' }, 'Touchez une pesée pour la modifier. Glissez-la vers la gauche pour la supprimer.')
  );
}

export default {
  tab: 'weight',
  async render(root, { params = [], navigate } = {}) {
    const today = localDateKey();
    if (params[0] === 'mensurations') memo.part = 'measures';
    else if (params[0] === 'poids') memo.part = 'weight';
    const [weights, reminder, measures, tracked] = await Promise.all([
      listWeights(),
      getReminder(),
      listMeasurements().catch((err) => { console.warn('Mensurations non lues :', err); return []; }),
      getTracked().catch(() => [])
    ]);
    const latest = weights.length ? weights[weights.length - 1] : null;

    const add = () => openWeightSheet({ weights, onDone: refresh });
    const edit = (w) => openWeightSheet({ weights, weight: w, onDone: refresh });
    const mv = measuresView({ list: measures, tracked, today });
    const isMeasures = memo.part === 'measures';

    setAppbar({
      title: 'Corps',
      trailing: h('button', {
        type: 'button',
        class: 'appbar-btn',
        'aria-label': isMeasures ? 'Ajouter des mesures' : 'Ajouter une pesée',
        onclick: isMeasures ? mv.add : add
      }, iconEl('plus'))
    });

    const partControl = segmented({
      label: 'Partie affichée',
      value: memo.part,
      options: [{ value: 'weight', label: 'Poids' }, { value: 'measures', label: 'Mensurations' }],
      // L'adresse suit la partie affichée (#/weight/poids ou #/weight/mensurations).
      onChange: (v) => { memo.part = v; navigate(`weight/${v === 'measures' ? 'mensurations' : 'poids'}`, { replace: true }); }
    });

    if (isMeasures) {
      mount(root, partControl, mv.nodes);
      return;
    }

    const status = reminderStatus(reminder, latest ? latest.date : null);
    const reminderSection = section({
      header: 'Rappel',
      rows: [row({
        title: 'Rappel de pesée',
        subtitle: reminder.enabled ? 'Bannière dans l\'app · Calendrier en option' : 'Bannière désactivée',
        value: reminderLabel(reminder),
        iconName: 'bell',
        onClick: () => openReminderSheet({ onDone: refresh }),
        chevron: true
      })]
    });

    if (!weights.length) {
      mount(root,
        partControl,
        weighBanner(status, add),
        emptyState({
          iconName: 'weight',
          title: 'Aucune pesée',
          text: 'Saisissez votre poids chaque semaine : nutrinova trace la courbe et sa moyenne sur 7 jours.',
          action: h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, iconEl('plus'), 'Ajouter une pesée')
        }),
        reminderSection
      );
      return;
    }

    const avgByDate = new Map(movingAverage(weights).map((a) => [a.date, a]));
    const prev = weights.length > 1 ? weights[weights.length - 2] : null;
    const latestAvg = avgByDate.get(latest.date);

    const chartHost = h('div');
    const paintChart = () => chartHost.replaceChildren(chartBlock(weights, avgByDate, today));
    paintChart();

    mount(root,
      partControl,
      weighBanner(status, add),
      h('section', { class: 'card stack', 'aria-label': 'Dernière pesée' },
        h('p', { class: 't-footnote t-secondary' }, `Dernière pesée · ${formatDayLong(latest.date)}`),
        h('div', { class: 'big-stat' },
          h('span', { class: 'big-stat-num t-num' }, formatKg(latest.weightKg).replace(/ kg$/, '')),
          h('span', { class: 'big-stat-unit' }, 'kg'),
          prev ? h('span', { class: `chip ${latest.weightKg < prev.weightKg ? 'chip-success' : latest.weightKg > prev.weightKg ? 'chip-warning' : ''}` }, formatDelta(latest.weightKg - prev.weightKg)) : null
        ),
        h('p', { class: 'hint' }, [
          prev ? `${formatDelta(latest.weightKg - prev.weightKg)} depuis le ${formatDayShort(prev.date)}` : 'Première pesée',
          latestAvg && latestAvg.count > 1 ? `moyenne sur 7 jours : ${formatKg(latestAvg.value)}` : null
        ].filter(Boolean).join(' · '))
      ),
      h('section', { class: 'card stack', 'aria-label': 'Courbe du poids' },
        segmented({
          label: 'Période',
          value: memo.period,
          options: PERIODS.map((p) => ({ value: p.id, label: p.label })),
          onChange: (v) => { memo.period = v; paintChart(); }
        }),
        chartHost
      ),
      h('p', { class: 'hint' }, 'La moyenne sur 7 jours lisse les variations d\'un jour à l\'autre (eau, repas) quand vous vous pesez plusieurs fois par semaine. Avec une pesée par semaine, elle est égale à la pesée.'),
      reminderSection,
      historyList(weights, edit)
    );
  }
};
