// lib/date.test.mjs — node --test lib/date.test.mjs. Week/year bounds are pure date math and the
// one place an off-by-one silently hides work from the calendar.
import test from 'node:test';
import assert from 'node:assert';
import { weekDays, weekBounds, shiftWeek, yearMonths, yearBounds, toISODate } from './date.js';

test('weekDays: Monday-start week containing a mid-week date', () => {
  // 2026-07-31 is a Friday.
  const days = weekDays('2026-07-31').map(toISODate);
  assert.deepStrictEqual(days, [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
    '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('weekDays: date that is itself a Monday', () => {
  const days = weekDays('2026-07-27').map(toISODate);
  assert.strictEqual(days[0], '2026-07-27');
  assert.strictEqual(days[6], '2026-08-02');
});

test('weekBounds matches the first/last day of weekDays', () => {
  assert.deepStrictEqual(weekBounds('2026-07-31'), ['2026-07-27', '2026-08-02']);
});

test('shiftWeek moves by exactly 7 days, forward and back', () => {
  assert.strictEqual(shiftWeek('2026-07-31', 1), '2026-08-07');
  assert.strictEqual(shiftWeek('2026-07-31', -1), '2026-07-24');
});

test('shiftWeek crosses a year boundary', () => {
  assert.strictEqual(shiftWeek('2025-12-29', 1), '2026-01-05');
});

test('yearMonths returns 12 months, January through December', () => {
  assert.deepStrictEqual(yearMonths(2026), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
  ]);
});

test('yearBounds spans Jan 1 to Dec 31', () => {
  assert.deepStrictEqual(yearBounds(2026), ['2026-01-01', '2026-12-31']);
});
