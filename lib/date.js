// lib/date.js — local-calendar-date ISO formatting.
// Never use `.toISOString().slice(0, 10)` for "today"/local dates: it converts through UTC
// first, which shifts the calendar day for any timezone that isn't UTC+0 (e.g. IST, UTC+5:30).
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "Today" gets asked for on the server too (the host runs UTC), so pin the factory's zone —
// otherwise between 00:00 and 05:30 IST the server thinks it's still yesterday and hides work
// that's due. en-CA formats as YYYY-MM-DD. Same reason to never use SQLite's date('now').
const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

export function todayISO() {
  return IST.format(new Date());
}

export function todayMonth() {
  return todayISO().slice(0, 7);
}

// The 42-day (6×7) Monday-start grid a month calendar renders. Exported so the server page and
// the client grid derive the same range from the same 'YYYY-MM' and can't drift apart.
export function monthGridDays(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // back up to Monday
  const days = [];
  const d = new Date(start);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// Inclusive ISO bounds of that grid — what the calendar queries BETWEEN.
export function monthGridBounds(month) {
  const days = monthGridDays(month);
  return [toISODate(days[0]), toISODate(days[41])];
}

// Shift a 'YYYY-MM' by n months.
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
