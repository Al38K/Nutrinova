// Rappel de pesée hebdomadaire.
// Une PWA sans serveur ne peut pas programmer de notification : le rappel combine
// 1) une bannière dans l'app (Journal et Poids) dès que la pesée prévue n'a pas été saisie ;
// 2) un événement récurrent pour l'app Calendrier (fichier .ics), dont l'alerte est une vraie notification iOS.
// Réglages : weighReminder (bool), weighDay (0 = dimanche … 6 = samedi), weighTime ('HH:MM').

import * as db from './db.js';
import { STORES } from './schema.js';
import { getSetting, SETTING_DEFAULTS } from './settings.js';
import { localDateKey } from '../util/dates.js';
import { APP_NAME } from '../config.js';

export const DAY_LABELS = Object.freeze(['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']);
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const ICS_UID = 'nutrinova-pesee-hebdomadaire@nutrinova';
export const ICS_FILENAME = 'nutrinova-rappel-pesee.ics';

export function isTime(v) {
  return typeof v === 'string' && TIME_RE.test(v);
}

export function isWeekday(v) {
  return Number.isInteger(v) && v >= 0 && v <= 6;
}

/** Réglage complet et valide (valeurs par défaut pour ce qui manque). */
export function normalizeReminder({ enabled, day, time } = {}) {
  return {
    enabled: typeof enabled === 'boolean' ? enabled : SETTING_DEFAULTS.weighReminder,
    day: isWeekday(day) ? day : SETTING_DEFAULTS.weighDay,
    time: isTime(time) ? time : SETTING_DEFAULTS.weighTime
  };
}

export async function getReminder() {
  const [enabled, day, time] = await Promise.all([getSetting('weighReminder'), getSetting('weighDay'), getSetting('weighTime')]);
  return normalizeReminder({ enabled, day, time });
}

/** Enregistre les trois réglages du rappel en une transaction. */
export async function saveReminder(input) {
  if (!isWeekday(input.day)) throw new Error('Jour de pesée invalide.');
  if (!isTime(input.time)) throw new Error('Heure de pesée invalide (format HH:MM).');
  const r = normalizeReminder(input);
  const now = new Date().toISOString();
  await db.run(STORES.settings, 'readwrite', (tx) => {
    const os = tx.objectStore(STORES.settings);
    os.put({ key: 'weighReminder', value: r.enabled, updatedAt: now });
    os.put({ key: 'weighDay', value: r.day, updatedAt: now });
    os.put({ key: 'weighTime', value: r.time, updatedAt: now });
  });
  return r;
}

/** « 10 h », « 7 h 30 » */
export function timeLabel(time) {
  const [hh, mm] = time.split(':');
  return mm === '00' ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
}

/** « Dimanche à 10 h » */
export function reminderLabel(r) {
  return `${DAY_LABELS[r.day]} à ${timeLabel(r.time)}`;
}

function atTime(date, time) {
  const [hh, mm] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0);
}

/** Dernière échéance (jour et heure du rappel) passée ou égale à now. */
export function lastOccurrence(r, now = new Date()) {
  const back = (now.getDay() - r.day + 7) % 7;
  let d = atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back), r.time);
  if (d > now) d = atTime(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7), r.time);
  return d;
}

/** Prochaine échéance strictement après now. */
export function nextOccurrence(r, now = new Date()) {
  const last = lastOccurrence(r, now);
  return atTime(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7), r.time);
}

/**
 * La pesée prévue est-elle à faire ? Oui si le rappel est actif et qu'aucune pesée n'a été saisie
 * depuis le jour de la dernière échéance (une pesée saisie le jour même, même avant l'heure, compte).
 * latestDate : date de la pesée la plus récente ('AAAA-MM-JJ') ou null.
 * Renvoie { due, occurrence (Date), occurrenceKey, isToday }.
 */
export function reminderStatus(r, latestDate, now = new Date()) {
  const occurrence = lastOccurrence(r, now);
  const occurrenceKey = localDateKey(occurrence);
  const due = Boolean(r.enabled) && !(latestDate && latestDate >= occurrenceKey);
  return { due, occurrence, occurrenceKey, isToday: occurrenceKey === localDateKey(now) };
}

// ---------- Fichier calendrier (.ics, RFC 5545) ----------

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Décalage UTC (minutes) d'un fuseau à une date ; null si le navigateur ne sait pas le calculer. */
export function tzOffsetMinutes(timeZone, date) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    if (!part) return null;
    if (part.value === 'GMT' || part.value === 'UTC') return 0;
    const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(part.value);
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === '-' ? -minutes : minutes;
  } catch {
    return null;
  }
}

function fmtOffset(min) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}

function hhmmss(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
}

/**
 * Définition du fuseau pour le fichier .ics :
 * - fuseau sans heure d'été : décalage fixe ;
 * - fuseau européen avec heure d'été : règles de l'Union européenne (dernier dimanche de mars et d'octobre, 01:00 UTC) ;
 * - autre cas : null → heure « flottante » (heure locale de l'iPhone, sans fuseau).
 */
export function vtimezone(timeZone, year = new Date().getFullYear()) {
  if (!timeZone) return null;
  const winter = tzOffsetMinutes(timeZone, new Date(Date.UTC(year, 0, 15)));
  const summer = tzOffsetMinutes(timeZone, new Date(Date.UTC(year, 6, 15)));
  if (winter === null || summer === null) return null;
  if (winter === summer) {
    return [
      'BEGIN:VTIMEZONE', `TZID:${timeZone}`,
      'BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${fmtOffset(winter)}`, `TZOFFSETTO:${fmtOffset(winter)}`, 'END:STANDARD',
      'END:VTIMEZONE'
    ];
  }
  if (!timeZone.startsWith('Europe/') || summer <= winter) return null;
  return [
    'BEGIN:VTIMEZONE', `TZID:${timeZone}`,
    'BEGIN:DAYLIGHT', `DTSTART:19700329T${hhmmss(60 + winter)}`, 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    `TZOFFSETFROM:${fmtOffset(winter)}`, `TZOFFSETTO:${fmtOffset(summer)}`, 'END:DAYLIGHT',
    'BEGIN:STANDARD', `DTSTART:19701025T${hhmmss(60 + summer)}`, 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    `TZOFFSETFROM:${fmtOffset(summer)}`, `TZOFFSETTO:${fmtOffset(winter)}`, 'END:STANDARD',
    'END:VTIMEZONE'
  ];
}

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Coupe une ligne à 75 octets (RFC 5545 §3.1), sans casser un caractère accentué. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // les lignes suivantes commencent par une espace
    if (size + n > limit) {
      parts.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function localStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Contenu du fichier .ics : événement de 10 min, chaque semaine au jour et à l'heure choisis,
 * avec une alerte à l'heure de l'événement. Première occurrence : la prochaine échéance.
 * opts : { now, timeZone, appUrl }.
 */
export function buildReminderIcs(r, { now = new Date(), timeZone = deviceTimeZone(), appUrl = null } = {}) {
  const start = nextOccurrence(r, now);
  const end = new Date(start.getTime() + 10 * 60000);
  const tz = vtimezone(timeZone, start.getFullYear());
  const tzParam = tz ? `;TZID=${timeZone}` : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//Rappel de pesee//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(tz || []),
    'BEGIN:VEVENT',
    `UID:${ICS_UID}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART${tzParam}:${localStamp(start)}`,
    `DTEND${tzParam}:${localStamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[r.day]}`,
    `SUMMARY:${escapeText('Pesée hebdomadaire · nutrinova')}`,
    `DESCRIPTION:${escapeText('Pesez-vous (de préférence au réveil, dans les mêmes conditions), puis saisissez le poids dans nutrinova, onglet Poids.')}`,
    appUrl ? `URL:${appUrl}` : null,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('Pesée hebdomadaire')}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
