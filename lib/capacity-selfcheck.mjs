// node lib/capacity-selfcheck.mjs
import assert from 'node:assert/strict';
import { weekStart, weeksFrom, weeklyCapacityMinutes, spreadMinutes, buildCapacity } from './capacity.mjs';

assert.equal(weekStart('2026-09-30'), '2026-09-28');           // Wed -> Monday
assert.equal(weekStart('2026-09-28'), '2026-09-28');
assert.deepEqual(weeksFrom('2026-09-30', 2), ['2026-09-28', '2026-10-05']);
assert.equal(weeklyCapacityMinutes({}), 8 * 60 * 6);            // defaults
assert.equal(weeklyCapacityMinutes({ shifts_per_day: 2, hours_per_shift: 8, working_days_per_week: 5 }), 4800);

const weeks = weeksFrom('2026-09-30', 4);
// 14 days ahead spreads evenly: 2026-09-30..10-13 -> Wed-Sun of wk0 (5d), full wk1 (7d), Mon-Tue wk2 (2d)
{
  const r = spreadMinutes({ minutes: 1400, start: '2026-09-30', end: '2026-10-13', today: '2026-09-30', weeks });
  const m = Object.fromEntries(r.parts.map(p => [p.week, Math.round(p.minutes)]));
  assert.deepEqual(m, { '2026-09-28': 500, '2026-10-05': 700, '2026-10-12': 200 });
  assert.equal(r.parts.reduce((s, p) => s + p.minutes, 0), 1400);   // nothing lost
}
// overdue window: all in the current week
{
  const r = spreadMinutes({ minutes: 300, start: '2026-09-01', end: '2026-09-10', today: '2026-09-30', weeks });
  assert.deepEqual(r.parts.map(p => [p.week, p.minutes]), [['2026-09-28', 300]]);
}
// started earlier, ends later: only the remaining window counts
{
  const r = spreadMinutes({ minutes: 600, start: '2026-09-01', end: '2026-10-04', today: '2026-09-30', weeks });
  assert.equal(r.parts.length, 1);          // 09-30..10-04 is all inside week 0
}
// no dates at all: flagged, spread over 14 days
assert.equal(spreadMinutes({ minutes: 140, today: '2026-09-30', weeks }).undated, true);

// overload + per-WO breakdown
{
  const c = buildCapacity({
    ops: [
      { workstation_id: 1, minutes: 2000, wo_no: 'WO-1', wo_id: 1, start: '2026-09-30', end: '2026-10-04' },
      { workstation_id: 1, minutes: 900, wo_no: 'WO-2', wo_id: 2, start: '2026-09-30', end: '2026-10-04' },
    ],
    stations: [{ id: 1, name: 'Weld Bay 1' }], today: '2026-09-30', weekCount: 2,
  });
  assert.equal(c.stations[0].buckets[0].load, 2900);
  assert.equal(c.stations[0].buckets[0].overloaded, true);       // 2900 > 2880
  assert.equal(c.stations[0].buckets[0].wos[0].wo_no, 'WO-1');
  assert.equal(c.bottlenecks.length, 1);
  assert.equal(c.stations[0].buckets[1].overloaded, false);
}
console.log('capacity selfcheck: ok');
