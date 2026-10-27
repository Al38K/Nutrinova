// Feuilles d'export (sauvegarde) et d'import.

import { h, openSheet, toast, segmented, confirmDialog, iconEl } from '../ui.js';
import {
  buildBackup, backupFile, canShareFile, shareBackup, downloadBackup, markBackupDone,
  parseBackup, applyBackup, BackupError
} from '../data/backup.js';
import { STORES, STORE_LABELS } from '../data/schema.js';
import { formatBytes, formatNumber } from '../util/format.js';
import { formatDateTime } from '../util/dates.js';

function plural(n, word) {
  return `${formatNumber(n)} ${word}${n > 1 ? 's' : ''}`;
}

const SHOWN = [STORES.journal, STORES.foods, STORES.recipes, STORES.goals, STORES.weights, STORES.measurements, STORES.activities];

function countsList(counts) {
  return h('dl', { class: 'kv card' }, SHOWN.flatMap((s) => [
    h('dt', {}, STORE_LABELS[s]),
    h('dd', {}, formatNumber(counts[s] ?? 0))
  ]));
}

/** Prépare la sauvegarde puis propose « Enregistrer dans Fichiers » (feuille Partager) ou le téléchargement. */
export async function openExportSheet({ onDone } = {}) {
  let built;
  try {
    built = await buildBackup();
  } catch (err) {
    toast(`Export impossible : ${err.message}`);
    return;
  }
  const file = backupFile(built.json, built.filename);
  const shareable = canShareFile(file);

  openSheet({
    title: 'Sauvegarder',
    closeLabel: 'Annuler',
    content: (close) => {
      const finish = async (message) => {
        try { await markBackupDone(); } catch { /* la sauvegarde a eu lieu ; seule la date n'est pas notée */ }
        close();
        toast(message, { duration: 5000 });
        if (onDone) onDone();
      };

      const shareBtn = shareable
        ? h('button', {
            type: 'button',
            class: 'btn btn-primary btn-lg btn-block',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const result = await shareBackup(file);
                if (result === 'shared') await finish('Sauvegarde enregistrée');
              } catch (err) {
                toast(`Partage impossible : ${err.message}. Essayez « Télécharger le fichier ».`, { duration: 6000 });
              } finally {
                btn.disabled = false;
              }
            }
          }, iconEl('share'), 'Enregistrer dans Fichiers…')
        : null;

      const downloadBtn = h('button', {
        type: 'button',
        class: `btn btn-block ${shareable ? 'btn-plain' : 'btn-primary btn-lg'}`,
        onclick: () => {
          downloadBackup(built.json, built.filename);
          finish('Fichier téléchargé : app Fichiers › Téléchargements');
        }
      }, iconEl('download'), 'Télécharger le fichier');

      return h('div', { class: 'stack' },
        h('p', { class: 't-subhead' }, `Fichier « ${built.filename} » · ${formatBytes(built.size)}`),
        countsList(built.counts),
        shareBtn,
        downloadBtn,
        h('p', { class: 'hint' }, 'Dans le menu Partager, choisissez « Enregistrer dans Fichiers », puis iCloud Drive (ou un autre emplacement hors de l\'iPhone). Ce fichier contient toutes vos données : gardez-le en lieu sûr.')
      );
    }
  });
}

/** Lit un fichier choisi par l'utilisateur, le contrôle, puis propose l'import. */
export async function handleImportFile(file, { onDone } = {}) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    const message = err instanceof BackupError ? err.message : `Lecture du fichier impossible : ${err.message}`;
    toast(`Import refusé : ${message}`, { duration: 7000 });
    return;
  }
  openImportSheet(parsed, { onDone });
}

function openImportSheet(parsed, { onDone }) {
  let mode = 'merge';
  openSheet({
    title: 'Importer',
    closeLabel: 'Annuler',
    content: (close) => {
      const explain = h('p', { class: 'hint' });
      const importBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block' }, 'Importer');
      const sync = () => {
        explain.textContent = mode === 'merge'
          ? 'Ajoute le contenu du fichier. Un élément déjà présent (même identifiant) est remplacé par celui du fichier. Rien n\'est supprimé.'
          : 'Efface le journal, les aliments, les recettes, les objectifs, les pesées, les mensurations, les activités et les réglages actuels, puis restaure le fichier.';
        importBtn.className = `btn btn-lg btn-block ${mode === 'replace' ? 'btn-destructive' : 'btn-primary'}`;
      };

      importBtn.addEventListener('click', async () => {
        if (mode === 'replace') {
          const ok = await confirmDialog({
            title: 'Tout remplacer ?',
            text: 'Les données actuelles de cet iPhone seront effacées et remplacées par celles du fichier. Cette action est irréversible. Faites d\'abord une sauvegarde si vous avez un doute.',
            confirmLabel: 'Effacer et restaurer',
            destructive: true
          });
          if (!ok) return;
        }
        importBtn.disabled = true;
        try {
          const counts = await applyBackup(parsed, mode);
          close();
          toast(`Import terminé : ${plural(counts.journal, 'entrée')}, ${plural(counts.foods, 'aliment')}, ${plural(counts.goals, 'objectif')}`, { duration: 5000 });
          if (onDone) onDone();
        } catch (err) {
          importBtn.disabled = false;
          toast(`Import annulé, aucune donnée modifiée : ${err.message}`, { duration: 7000 });
        }
      });

      sync();
      return h('div', { class: 'stack' },
        h('p', { class: 't-subhead' },
          `Sauvegarde du ${formatDateTime(parsed.meta.exportedAt)}${parsed.meta.appVersion ? ` · nutrinova ${parsed.meta.appVersion}` : ''}`),
        countsList(parsed.counts),
        segmented({
          label: 'Mode d\'import',
          value: mode,
          options: [{ value: 'merge', label: 'Fusionner' }, { value: 'replace', label: 'Tout remplacer' }],
          onChange: (v) => { mode = v; sync(); }
        }),
        explain,
        importBtn
      );
    }
  });
}
