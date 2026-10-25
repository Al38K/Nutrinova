// Onglet Réglages : apparence, état du stockage, contenu de la base, autotest, à propos.

import { h, setAppbar, section, row, segmented, installBanner, iconEl, toast } from '../ui.js';
import { getAllSettings, setSetting, applyTheme } from '../data/settings.js';
import { countAll } from '../data/db.js';
import { STORES, STORE_LABELS, SCHEMA_VERSION } from '../data/schema.js';
import { isStandalone, checkPersisted, estimateStorage } from '../data/storage.js';
import { runSelfTest } from '../data/selftest.js';
import { getServiceWorkerVersion } from '../pwa.js';
import { formatBytes, formatNumber } from '../util/format.js';
import { formatDateTime } from '../util/dates.js';
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

    const [settings, persisted, estimate, counts, swVersion] = await Promise.all([
      getAllSettings(),
      checkPersisted(),
      estimateStorage(),
      countAll(Object.values(STORES).filter((s) => s !== STORES.settings)),
      getServiceWorkerVersion()
    ]);
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

    root.append(
      installBanner(),
      appearance,
      section({
        header: 'Stockage sur cet iPhone',
        rows: storageRows,
        footer: 'Vos données restent sur cet iPhone et sont liées à l\'adresse de l\'app. Supprimer l\'icône efface les données : la sauvegarde (export) arrive en Phase 7.'
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
