// Dates au format 'AAAA-MM-JJ', toujours calculées dans le fuseau local de l'iPhone
// (jamais via toISOString, qui passe en UTC et peut décaler d'un jour le soir).

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDateKey(date) === value;
}

export function parseDateKey(key) {
  if (!isDateKey(key)) throw new TypeError(`Date invalide : ${key}`);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, days) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function nowIso() {
  return new Date().toISOString();
}

const longFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « Dimanche 25 octobre » */
export function formatDayLong(key) {
  return capitalize(longFormatter.format(parseDateKey(key)));
}

/** « 25 oct. 2026 » */
export function formatDayShort(key) {
  return shortFormatter.format(parseDateKey(key));
}

/** Horodatage ISO → « 25 oct. 2026, 14:05 » ; null → « — » */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d);
}
