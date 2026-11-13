// lib/welding.mjs — input checks for the welding registers (pure).
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const PROCESSES = ['SMAW', 'GTAW', 'GMAW', 'FCAW', 'SAW'];

// {SMAW: {qualified_on, last_weld}} -> cleaned, or { error }
export function cleanProcesses(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const p = String(k).trim().toUpperCase();
    if (!p) continue;
    for (const f of ['qualified_on', 'last_weld']) if (v?.[f] && !ISO.test(v[f])) return { error: `${p}: ${f.replace('_', ' ')} must be a date` };
    out[p] = { qualified_on: v?.qualified_on || null, last_weld: v?.last_weld || null };
  }
  return { processes: out };
}

// A weld welded on `date` by these stamps with this process moves each welder's last weld forward, never back.
export function bumpLastWeld(processes, process, date) {
  if (!process || !date || !processes[process]) return processes;
  const cur = processes[process].last_weld;
  return cur && cur >= date ? processes : { ...processes, [process]: { ...processes[process], last_weld: date } };
}
