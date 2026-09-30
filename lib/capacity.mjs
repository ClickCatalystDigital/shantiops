// lib/capacity.mjs — pure weekly load-vs-capacity maths for Planning -> Capacity. No DB.
//   node lib/capacity-selfcheck.mjs
// Each open Work Order operation's remaining minutes are spread evenly over the calendar days of its
// Work Order's window that are still ahead (today onward). Overdue windows land entirely in the
// current week (the work is still owed). No dates at all -> spread over the next 14 days, flagged.
const DAY = 86400000;
const d = iso => new Date(iso + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);

export function weekStart(isoDate) {
  const t = d(isoDate);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  return iso(t.getTime() - dow * DAY);
}

export function weeksFrom(today, count) {
  const w0 = d(weekStart(today)).getTime();
  return Array.from({ length: count }, (_, i) => iso(w0 + i * 7 * DAY));
}

export function weeklyCapacityMinutes(ws) {
  const shifts = ws.shifts_per_day ?? 1, hours = ws.hours_per_shift ?? 8, days = ws.working_days_per_week ?? 6;
  return Math.round(shifts * hours * 60 * days);
}

// -> [{ week, minutes }]   (only weeks inside `weeks`; minutes beyond the horizon are dropped)
export function spreadMinutes({ minutes, start, end, today, weeks }) {
  let s = start && start > today ? start : today;
  let e = end || null;
  let undated = false;
  if (!start && !end) { e = iso(d(today).getTime() + 13 * DAY); undated = true; }
  if (!e || e < s) e = s;                       // overdue or single-day: everything in its first week
  const days = Math.round((d(e) - d(s)) / DAY) + 1;
  const per = minutes / days, out = new Map();
  for (let i = 0; i < days; i++) {
    const w = weekStart(iso(d(s).getTime() + i * DAY));
    out.set(w, (out.get(w) || 0) + per);
  }
  return { undated, parts: weeks.filter(w => out.has(w)).map(w => ({ week: w, minutes: out.get(w) })) };
}

// ops: [{ workstation_id, minutes, wo_no, wo_id, start, end }], stations: [{id,name,...capacity fields}]
export function buildCapacity({ ops, stations, today, weekCount = 8 }) {
  const weeks = weeksFrom(today, weekCount);
  const byWs = new Map(stations.map(s => [s.id, {
    id: s.id, name: s.name, weekly_capacity: weeklyCapacityMinutes(s),
    buckets: weeks.map(w => ({ week: w, load: 0, wos: new Map() })),
  }]));
  let undatedOps = 0;
  for (const o of ops) {
    const row = byWs.get(o.workstation_id);
    if (!row) continue;
    const { parts, undated } = spreadMinutes({ minutes: o.minutes, start: o.start, end: o.end, today, weeks });
    if (undated) undatedOps++;
    for (const p of parts) {
      const b = row.buckets[weeks.indexOf(p.week)];
      b.load += p.minutes;
      const prev = b.wos.get(o.wo_id) || { wo_id: o.wo_id, wo_no: o.wo_no, minutes: 0 };
      prev.minutes += p.minutes; b.wos.set(o.wo_id, prev);
    }
  }
  const stationsOut = [...byWs.values()].map(r => ({
    ...r,
    buckets: r.buckets.map(b => ({
      week: b.week, load: Math.round(b.load), wos: [...b.wos.values()].map(w => ({ ...w, minutes: Math.round(w.minutes) })).sort((a, z) => z.minutes - a.minutes),
      utilisation: r.weekly_capacity ? b.load / r.weekly_capacity : 0, overloaded: b.load > r.weekly_capacity,
    })),
  }));
  const bottlenecks = stationsOut.flatMap(s => s.buckets.filter(b => b.overloaded).map(b => ({
    workstation_id: s.id, workstation: s.name, week: b.week, load: b.load, capacity: s.weekly_capacity,
  }))).sort((a, b) => a.week.localeCompare(b.week) || (b.load / b.capacity) - (a.load / a.capacity));
  return { weeks, stations: stationsOut, bottlenecks, undatedOps };
}
