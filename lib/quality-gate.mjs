// lib/quality-gate.mjs — when an ITP point is cleared or blocked (docs/gulf-coast-asme-plan.md, Phase 1).
// Pure: the routes feed it one job card's rows, its linked inspection records, NCRs and the project's welds,
// and it answers from those every time. Nothing here is stored, so reopening a point re-blocks its
// dependents with no extra code.
//
// Point types: H hold (needs the customer's authorization recorded after QC signs), W witness (notice must
// be recorded before work starts), R review. Any other letter on the customer's form ("VT", "V") is treated
// as a review point until the customer says otherwise.

export const parseRequires = s => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
export const pointType = t => (['H', 'W', 'R'].includes(String(t || '').trim().toUpperCase()) ? String(t).trim().toUpperCase() : 'R');
const norm = s => String(s || '').trim().toUpperCase();

// Template check: every prerequisite must name a point that comes earlier, so a cycle is impossible.
export function requiresProblems(items) {
  const order = new Map(items.map((it, i) => [String(it.item_key), it.sort_order ?? i]));
  const out = [];
  const keys = new Set();
  items.forEach((it, i) => {
    const k = String(it.item_key || '').trim();
    if (!k) out.push(`Row ${i + 1}: point number is missing`);
    else if (keys.has(k)) out.push(`Point ${k} appears twice`);
    keys.add(k);
    for (const r of parseRequires(it.requires)) {
      if (!order.has(r)) out.push(`Point ${k} requires ${r}, which is not on this ITP`);
      else if (order.get(r) >= (it.sort_order ?? i)) out.push(`Point ${k} requires ${r}, which comes after it`);
    }
  });
  return out;
}

// Welds this point must be tested on: for a per-weld point, every weld whose NDE list names the method.
export function weldsFor(stage, welds = []) {
  if (!stage.per_weld || !stage.test_type) return [null];
  const t = norm(stage.test_type);
  return welds.filter(w => String(w.nde || '').split(/[,;\s/]+/).map(norm).includes(t));
}

// The latest record (highest id) for each (weld, test type) on this point. A retest supersedes, never edits.
export function latestRecords(stage, records = []) {
  const latest = new Map();
  for (const r of records) {
    if (r.job_sheet_stage_id !== stage.id) continue;
    const k = `${r.weld_id ?? ''}|${norm(r.test_type)}`;
    if (!latest.has(k) || latest.get(k).id < r.id) latest.set(k, r);
  }
  return [...latest.values()];
}

// Does this point have the passing tests it needs? Returns the welds still missing a pass, and the failures.
export function testState(stage, records = [], welds = []) {
  const latest = latestRecords(stage, records);
  const failed = latest.filter(r => r.result === 'fail');
  if (!stage.test_type) return { ok: failed.length === 0, missing: [], failed };
  const t = norm(stage.test_type);
  const need = weldsFor(stage, welds);
  const missing = [];
  for (const w of need) {
    const r = latest.find(x => norm(x.test_type) === t && (x.weld_id ?? null) === (w ? w.id : null));
    if (!r || r.result !== 'pass') missing.push(w ? w.weld_no : stage.test_type);
  }
  if (stage.per_weld && need.length === 0) missing.push(`no weld lists ${stage.test_type}`);
  return { ok: missing.length === 0 && failed.length === 0, missing, failed };
}

export const openNcrs = (stage, ncrs = []) => ncrs.filter(n => n.job_sheet_stage_id === stage.id && n.status !== 'closed');

// One point: why it is not cleared (empty list = cleared).
export function notClearedReasons(stage, records = [], ncrs = [], welds = []) {
  if (stage.not_applicable) return [];
  const out = [];
  const weldNo = id => welds.find(w => w.id === id)?.weld_no;
  for (const f of latestRecords(stage, records).filter(r => r.result === 'fail')) {
    out.push(`${f.test_type} failed${f.weld_id ? ` on weld ${weldNo(f.weld_id) || f.weld_id}` : ''}`);
  }
  for (const n of openNcrs(stage, ncrs)) out.push(`${n.ncr_no} ${n.status}`);
  if (!stage.qc_sign_by) out.push('not QC-signed');
  else if (pointType(stage.point_type) === 'H' && !stage.released_at) out.push('customer release not recorded');
  return out;
}

// Every point of one card: { id, item_key, cleared, reasons, blocked, blockedBy: [{item_key, name, reasons}] }.
export function gateStates(stages, records = [], ncrs = [], welds = []) {
  const byKey = new Map(stages.map(s => [String(s.item_key), s]));
  const reasons = new Map(stages.map(s => [s.id, notClearedReasons(s, records, ncrs, welds)]));
  return stages.map(s => {
    const blockedBy = parseRequires(s.requires).map(k => byKey.get(k)).filter(p => p && reasons.get(p.id).length)
      .map(p => ({ item_key: p.item_key, name: p.name, reasons: reasons.get(p.id) }));
    return { id: s.id, item_key: s.item_key, cleared: reasons.get(s.id).length === 0, reasons: reasons.get(s.id),
      blocked: blockedBy.length > 0, blockedBy };
  });
}

export const blockedMessage = g => g.blockedBy.map(b => `${b.item_key} ${b.name}: ${b.reasons.join(', ')}`).join('; ');

// Points still open before shipping (after_dispatch points, such as the final data package, are allowed).
export const openBeforeShipping = (stages, states) => stages.filter((s, i) => !s.after_dispatch && !states[i].cleared);
