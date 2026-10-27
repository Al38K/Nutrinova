// Onglet Suivi : évolution sur 7, 30 ou 90 journées terminées (aujourd'hui exclu).
// Calories par jour face à l'objectif, moyennes des macros, activité, poids et mensurations.

import { h, mount, setAppbar, segmented, iconEl, macroBar, emptyState } from '../ui.js';
import { formatNumber, formatNutrient, isNum } from '../util/format.js';
import { localDateKey, addDays, formatDayShort } from '../util/dates.js';
import { NUTRIENT_META } from '../data/nutrients.js';
import { getEntriesBetween } from '../data/entries.js';
import { listGoals } from '../data/goals.js';
import { getActivitiesBetween } from '../data/activities.js';
import { listWeights, movingAverage } from '../data/weights.js';
import { listMeasurements, getTracked, seriesOf, MEASURES, formatMeasure } from '../data/measurements.js';
import { PROGRESS_PERIODS, periodRange, dailySeries, summarize } from '../data/progress.js';
import { kcalChart } from '../components/kcal-chart.js';
import { energySplit } from '../components/energy-split.js';
import { weightChart, formatKg } from '../components/weight-chart.js';
import { formatMeasureDelta } from '../components/measures-view.js';
import { refresh } from '../router.js';

// Période choisie, conservée pendant la session.
const memo = { days: 7 };

function signed(v, fmt) {
  if (!isNum(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${fmt(Math.abs(r))}`;
}

function caloriesCard(days, sum) {
  const { avg, avgTargets, counts, partial } = sum;
  const diff = isNum(avg.kcal) && isNum(avgTargets.kcal) ? avg.kcal - avgTargets.kcal : null;
  const judged = counts.under + counts.near + counts.over;
  return h('section', { class: 'card stack', 'aria-label': 'Calories' },
    h('h2', { class: 'card-title' }, 'Calories'),
    kcalChart(days),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Moyenne consommée'),
      h('dd', { class: 't-num' }, isNum(avg.kcal) ? `${formatNumber(avg.kcal)} kcal / jour${partial.kcal ? ' *' : ''}` : '—'),
      h('dt', {}, 'Objectif moyen'),
      h('dd', { class: 't-num' }, isNum(avgTargets.kcal) ? `${formatNumber(avgTargets.kcal)} kcal` : 'aucun objectif'),
      h('dt', {}, 'Écart moyen'),
      h('dd', { class: `t-num ${isNum(diff) && diff > 0 ? 'text-warning' : ''}` }, isNum(diff) ? `${signed(diff, (v) => formatNumber(v))} kcal` : '—'),
      h('dt', {}, 'Journées saisies'),
      h('dd', { class: 't-num' }, `${formatNumber(sum.logged)} / ${formatNumber(sum.days)}`),
      h('dt', {}, 'Proches de l\'objectif (±10 %)'),
      h('dd', { class: 't-num' }, judged ? `${formatNumber(counts.near)} / ${formatNumber(judged)}` : '—'),
      h('dt', {}, 'En dessous · au-dessus'),
      h('dd', { class: 't-num' }, judged ? `${formatNumber(counts.under)} · ${formatNumber(counts.over)}` : '—')
    ),
    counts.partial ? h('p', { class: 'hint partial-note' }, `${counts.partial} journée${counts.partial > 1 ? 's' : ''} avec un aliment sans calories : non comptée${counts.partial > 1 ? 's' : ''} dans « proches / en dessous / au-dessus ».`) : null,
    h('p', { class: 'hint' }, 'Moyennes sur les journées saisies seulement. L\'objectif du jour inclut les calories dépensées (activité).')
  );
}

function macrosCard(sum) {
  const { avg, avgTargets, partial } = sum;
  const star = (k) => (partial[k] && isNum(avg[k]) ? ' *' : '');
  return h('section', { class: 'card stack', 'aria-label': 'Macronutriments' },
    h('h2', { class: 'card-title' }, 'Macros · moyenne par jour'),
    h('div', {}, ['protein', 'carbs', 'fat'].map((k) => macroBar({
      kind: k,
      label: NUTRIENT_META[k].label,
      value: avg[k],
      goal: avgTargets[k],
      caption: isNum(avg[k]) && isNum(avgTargets[k])
        ? `${Math.round((avg[k] / avgTargets[k]) * 100)} % de l'objectif moyen${star(k)}`
        : (isNum(avg[k]) ? `Pas d'objectif${star(k)}` : '—')
    }))),
    energySplit(avg),
    h('dl', { class: 'kv' }, ['fiber', 'sugars', 'salt'].flatMap((k) => [
      h('dt', {}, k === 'sugars' ? 'Sucres' : NUTRIENT_META[k].label),
      h('dd', { class: 't-num' }, `${formatNutrient(k, avg[k])}${star(k)}`)
    ])),
    ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'salt'].some((k) => star(k))
      ? h('p', { class: 'hint' }, '* Au moins un aliment n\'a pas cette valeur : la moyenne est un minimum.')
      : null
  );
}

function activityCard(sum) {
  if (!sum.burned.days) return null;
  return h('section', { class: 'card stack', 'aria-label': 'Activité' },
    h('h2', { class: 'card-title' }, 'Activité'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Calories dépensées'),
      h('dd', { class: 't-num' }, `${formatNumber(sum.burned.total)} kcal`),
      h('dt', {}, 'Jours actifs'),
      h('dd', { class: 't-num' }, `${formatNumber(sum.burned.days)} / ${formatNumber(sum.days)}`),
      h('dt', {}, 'Moyenne par jour actif'),
      h('dd', { class: 't-num' }, `${formatNumber(sum.burned.total / sum.burned.days)} kcal`)
    )
  );
}

function weightCard(weights, from, today) {
  const inPeriod = weights.filter((w) => w.date >= from && w.date <= today);
  const avgByDate = new Map(movingAverage(weights).map((a) => [a.date, a]));
  const body = [];
  if (inPeriod.length >= 2) {
    body.push(weightChart({
      points: inPeriod,
      average: inPeriod.map((w) => avgByDate.get(w.date)),
      domain: { from, to: today }
    }));
    const first = inPeriod[0];
    const last = inPeriod[inPeriod.length - 1];
    body.push(h('dl', { class: 'kv' },
      h('dt', {}, `Du ${formatDayShort(first.date)} au ${formatDayShort(last.date)}`),
      h('dd', { class: 't-num' }, `${formatKg(first.weightKg)} → ${formatKg(last.weightKg)}`),
      h('dt', {}, 'Évolution'),
      h('dd', { class: 't-num' }, signed(last.weightKg - first.weightKg, formatKg))
    ));
  } else {
    body.push(h('p', { class: 'hint' }, inPeriod.length
      ? `Une seule pesée sur la période (${formatKg(inPeriod[0].weightKg)} le ${formatDayShort(inPeriod[0].date)}).`
      : 'Aucune pesée sur la période.'));
  }
  return h('section', { class: 'card stack', 'aria-label': 'Poids' },
    h('h2', { class: 'card-title' }, 'Poids'),
    ...body,
    h('a', { class: 'btn btn-plain btn-block', href: '#/weight/poids' }, 'Voir le détail du poids', iconEl('chevronRight'))
  );
}

function measuresCard(list, tracked, from, today) {
  const ids = MEASURES.map((m) => m.id).filter((id) => tracked.includes(id) || seriesOf(list, id).length);
  const rows = [];
  for (const id of ids) {
    const s = seriesOf(list, id).filter((p) => p.date >= from && p.date <= today);
    if (!s.length) continue;
    const m = MEASURES.find((x) => x.id === id);
    const first = s[0];
    const last = s[s.length - 1];
    rows.push(
      h('dt', {}, m.short),
      h('dd', { class: 't-num' }, s.length > 1
        ? `${formatMeasure(id, first.value)} → ${formatMeasure(id, last.value)} (${formatMeasureDelta(id, last.value - first.value)})`
        : `${formatMeasure(id, last.value)} · une mesure`)
    );
  }
  return h('section', { class: 'card stack', 'aria-label': 'Mensurations' },
    h('h2', { class: 'card-title' }, 'Mensurations'),
    rows.length ? h('dl', { class: 'kv kv-wide' }, rows) : h('p', { class: 'hint' }, 'Aucune mesure sur la période.'),
    h('a', { class: 'btn btn-plain btn-block', href: '#/weight/mensurations' }, 'Voir les mensurations', iconEl('chevronRight'))
  );
}

export default {
  tab: 'progress',
  async render(root) {
    setAppbar({ title: 'Suivi' });
    const today = localDateKey();
    const { from, to } = periodRange(memo.days, today);
    // Poids et mensurations : la période inclut aujourd'hui (une pesée du jour compte).
    const bodyFrom = addDays(today, -memo.days);

    const [entries, goals, activities, weights, measures, tracked] = await Promise.all([
      getEntriesBetween(from, to),
      listGoals(),
      getActivitiesBetween(from, to).catch(() => []),
      listWeights(),
      listMeasurements().catch(() => []),
      getTracked().catch(() => [])
    ]);
    const days = dailySeries({ from, to, entries, activities, goals });
    const sum = summarize(days);

    const period = segmented({
      label: 'Période',
      value: memo.days,
      options: PROGRESS_PERIODS.map((p) => ({ value: p.id, label: p.label })),
      onChange: (v) => { memo.days = v; refresh(); }
    });
    const range = h('p', { class: 'hint progress-range' }, `Du ${formatDayShort(from)} au ${formatDayShort(to)} · journées terminées, aujourd'hui non compté.`);

    mount(root,
      period,
      range,
      sum.logged
        ? [caloriesCard(days, sum), macrosCard(sum), activityCard(sum)]
        : emptyState({
            iconName: 'trend',
            title: 'Rien de saisi sur la période',
            text: 'Le suivi compare chaque journée terminée à votre objectif. Ajoutez vos repas dans le Journal : les courbes apparaîtront dès le lendemain.',
            action: h('a', { class: 'btn btn-primary', href: '#/journal' }, 'Ouvrir le Journal')
          }),
      weightCard(weights, bodyFrom, today),
      measuresCard(measures, tracked, bodyFrom, today)
    );
  }
};
