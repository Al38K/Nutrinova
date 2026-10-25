// Onglet Réglages : objectifs, sauvegarde (export/import), apparence, état du stockage,
// contenu de la base, autotest, à propos.

import { h, mount, setAppbar, section, row, segmented, installBanner, iconEl, toast } from '../ui.js';
import { getAllSettings, setSetting, applyTheme } from '../data/settings.js';
import { countAll, getAllByIndex } from '../data/db.js';
import { ensureCiqual, getCiqualState } from '../data/ciqual.js';
import { OFF_SITE } from '../data/off.js';
import { STORES, STORE_LABELS, SCHEMA_VERSION } from '../data/schema.js';
import { isStandalone, checkPersisted, estimateStorage } from '../data/storage.js';
import { runSelfTest } from '../data/selftest.js';
import { getGoalForDate, goalMacroSummary } from '../data/goals.js';
import { getServiceWorkerVersion } from '../pwa.js';
import { formatBytes, formatNumber, formatKcal } from '../util/format.js';
import { formatDateTime, localDateKey, daysSince } from '../util/dates.js';
import { openExportSheet, handleImportFile } from '../sheets/backup-sheets.js';
import { openReminderSheet } from '../sheets/weight-sheets.js';
import { getReminder, reminderLabel } from '../data/reminder.js';
import { refresh } from '../router.js';
import { APP_VERSION } from '../config.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' }
];

function persistLabel(p) {
  if (p === true) return 'Accordé';
  if (p === false) return 'Non accordé';
  return 'Non disponible';
}

function selfTestCard() {
  const results = h('div', { class: 'stack' });
  const summary = h('p', { class: 't-headline' }, 'Autotest');
  const card = h('div', { class: 'card', hidden: true, 'aria-live': 'polite' }, summary, results);

  const start = async (btn) => {
    btn.disabled = true;
    card.hidden = false;
    summary.textContent = 'Autotest en cours…';
    results.replaceChildren();
    try {
      const swVersion = await getServiceWorkerVersion();
      const { ok, results: list } = await runSelfTest({
        swVersion,
        onProgress: (r) => {
          results.append(h('div', { class: `test-row ${r.ok ? 'test-ok' : 'test-ko'}` },
            iconEl(r.ok ? 'check' : 'cross'),
            h('span', {},
              h('span', {}, r.name),
              h('span', { class: 'test-detail' }, r.detail || '')
            )
          ));
        }
      });
      const passed = list.filter((r) => r.ok).length;
      summary.textContent = ok
        ? `Autotest réussi : ${passed}/${list.length}`
        : `Autotest : ${list.length - passed} échec(s) sur ${list.length}`;
      summary.style.color = ok ? 'var(--success)' : 'var(--danger)';
    } catch (err) {
      summary.textContent = `Autotest interrompu : ${err.message}`;
      summary.style.color = 'var(--danger)';
    } finally {
      btn.disabled = false;
    }
  };
  return { card, start };
}

export default {
  tab: 'settings',
  async render(root) {
    setAppbar({ title: 'Réglages' });

    const [settings, persisted, estimate, counts, swVersion, goal, offCached, weighReminder] = await Promise.all([
      getAllSettings(),
      checkPersisted(),
      estimateStorage(),
      countAll(Object.values(STORES).filter((s) => s !== STORES.settings)),
      getServiceWorkerVersion(),
      getGoalForDate(localDateKey()),
      getAllByIndex(STORES.foods, 'source', 'off').then((l) => l.length).catch(() => null),
      getReminder().catch(() => null),
      ensureCiqual().catch(() => null)
    ]);
    const ciqual = getCiqualState();
    const standalone = isStandalone();
    const test = selfTestCard();

    const appearance = h('section', {},
      h('h2', { class: 'section-header' }, 'Apparence'),
      h('div', { class: 'list', style: { padding: '8px' } },
        segmented({
          label: 'Thème',
          options: THEME_OPTIONS,
          value: settings.theme,
          onChange: async (value) => {
            applyTheme(value); // effet immédiat, l'enregistrement suit
            try {
              await setSetting('theme', value);
            } catch (err) {
              toast(`Thème non enregistré : ${err.message}`);
            }
          }
        })
      ),
      h('p', { class: 'section-footer' }, '« Système » suit le mode clair/sombre de l\'iPhone.')
    );

    const storageRows = [
      row({ title: 'App installée', value: standalone ? 'Oui' : 'Non (onglet Safari)' }),
      row({ title: 'Stockage persistant', value: persistLabel(persisted) }),
      row({ title: 'Espace utilisé', value: estimate ? formatBytes(estimate.usage) : '—' }),
      row({ title: 'Ouvertures de l\'app', value: formatNumber(settings.launchCount) }),
      row({ title: 'Première ouverture', value: formatDateTime(settings.firstLaunchAt) })
    ];

    const dbRows = Object.entries(counts).map(([store, n]) =>
      row({ title: STORE_LABELS[store], value: formatNumber(n) }));

    const testButton = h('button', {
      type: 'button',
      class: 'row row-action',
      onclick: (e) => test.start(e.currentTarget)
    }, 'Lancer l\'autotest');

    const lastBackup = settings.lastBackupAt;
    const since = daysSince(lastBackup);
    const fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json',
      class: 'sr-only',
      onchange: async (e) => {
        const input = e.currentTarget;
        const file = input.files && input.files[0];
        try {
          if (file) await handleImportFile(file, { onDone: refresh });
        } finally {
          input.value = '';
        }
      }
    });

    const ciqualRow = row({
      title: 'Table Ciqual (ANSES)',
      subtitle: ciqual.status === 'ready'
        ? `Aliments courants · version ${ciqual.meta && ciqual.meta.version ? ciqual.meta.version : '—'}`
        : ciqual.status === 'error' ? `Indisponible : ${ciqual.error}` : 'En préparation…',
      value: ciqual.status === 'ready' ? `${formatNumber(ciqual.count)} aliments` : '—'
    });
    const offRow = h('a', { class: 'row', href: OFF_SITE, target: '_blank', rel: 'noopener' },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, 'Open Food Facts'),
        h('span', { class: 'row-subtitle' }, 'Produits du commerce · licence ODbL')
      ),
      h('span', { class: 'row-value' }, offCached === null ? '—' : `${formatNumber(offCached)} en cache`),
      iconEl('external', 'row-chevron')
    );

    mount(root,
      installBanner(),
      section({
        header: 'Objectifs',
        rows: [row({
          title: 'Objectifs journaliers',
          subtitle: goal ? goalMacroSummary(goal) : 'Calories et macros',
          value: goal ? formatKcal(goal.kcal) : 'Non définis',
          iconName: 'target',
          href: '#/goals'
        })]
      }),
      section({
        header: 'Suivi du poids',
        rows: [row({
          title: 'Rappel de pesée',
          subtitle: weighReminder && !weighReminder.enabled ? 'Bannière désactivée' : 'Bannière dans l\'app · Calendrier en option',
          value: weighReminder ? reminderLabel(weighReminder) : '—',
          iconName: 'bell',
          onClick: () => openReminderSheet({ onDone: refresh }),
          chevron: true
        })]
      }),
      section({
        header: 'Sauvegarde',
        rows: [
          row({
            title: 'Dernière sauvegarde',
            value: lastBackup ? `${formatDateTime(lastBackup)}${since !== null && since >= 1 ? ` (${formatNumber(since)} j)` : ''}` : 'Jamais'
          }),
          h('button', { type: 'button', class: 'row row-action', onclick: () => openExportSheet({ onDone: refresh }) }, 'Exporter mes données'),
          h('label', { class: 'row row-action' }, 'Importer une sauvegarde', fileInput)
        ],
        footer: 'L\'export crée un fichier JSON avec le journal, les aliments, les recettes, les objectifs, les pesées et les réglages. Enregistrez-le dans Fichiers (iCloud Drive). Un rappel s\'affiche dans le Journal après 7 jours sans sauvegarde.'
      }),
      appearance,
      section({
        header: 'Sources des données',
        rows: [ciqualRow, offRow],
        footer: `${ciqual.meta && ciqual.meta.source ? ciqual.meta.source : 'ANSES, table de composition nutritionnelle des aliments Ciqual'}${ciqual.meta && ciqual.meta.license ? `, ${ciqual.meta.license}` : ''}. Open Food Facts : données des contributeurs d'Open Food Facts, licence ODbL. Lecture des codes-barres : ZXing (licence Apache 2.0), zxing-wasm et barcode-detector (licence MIT).`
      }),
      section({
        header: 'Stockage sur cet iPhone',
        rows: storageRows,
        footer: 'Vos données restent sur cet iPhone et sont liées à l\'adresse de l\'app. Supprimer l\'icône efface les données : exportez-les régulièrement.'
      }),
      section({ header: `Contenu de la base (schéma v${SCHEMA_VERSION})`, rows: dbRows }),
      section({
        header: 'Vérifications',
        rows: [testButton],
        footer: 'Teste la base de données, les calculs et le mode hors ligne directement sur cet appareil. Les données de test sont supprimées à la fin.'
      }),
      test.card,
      section({
        header: 'Développement',
        rows: [row({ title: 'Design system', subtitle: 'Couleurs, typographie, composants', iconName: 'palette', href: '#/design' })]
      }),
      section({
        header: 'À propos',
        rows: [
          row({ title: 'Version', value: APP_VERSION }),
          row({ title: 'Version hors ligne', value: swVersion || 'Inactive' }),
          row({ title: 'Adresse', value: `${location.host}${location.pathname}` })
        ]
      })
    );
  }
};
