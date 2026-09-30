// lib/plan-coverage.mjs — pure "can we cover this BOM line?" engine behind Planning -> Material Plan.
// No DB, no framework imports (same split as lib/bom-structure.mjs), so it self-checks under plain node:
//   node lib/plan-coverage-selfcheck.mjs
// lib/plan-coverage.js gathers the rows; this only decides.
//
// Each BOM row is self-contained: a Reserve/match split leaves a reserved clone (its own required
// qty, already covered) and a remainder row (qty_text rewritten to the shortfall, qty_resolved=1),
// so rows sum to the original requirement and need no grouping. Free stock is ONE pool per inventory
// item, handed to lines in need-by order, so the same units are never promised twice.

const OPEN_ORDER = ['Ordered', 'Transit'];
const DONE = ['Received', 'In-Stock'];
const EPS = 1e-6;

export const PLAN_STATUS = {
  in_hand:  { label: 'In hand',       tone: 'success' },
  covered:  { label: 'Covered',       tone: 'success' },
  held_qc:  { label: 'Held for QC',   tone: 'warning' },
  on_order: { label: 'On order',      tone: 'info' },
  late:     { label: 'Late',          tone: 'danger' },
  sourcing: { label: 'Sourcing',      tone: 'warning' },
  decision: { label: 'Needs decision', tone: 'danger' },
  unreleased: { label: 'BOM not released', tone: 'info' },
  check_qty: { label: 'Check qty',    tone: 'warning' },
};

function pieceFits(line, p, thicknessTol) {
  const d = line.dims;
  if (!d) return false;
  if (p.owner_project_id != null && p.owner_project_id !== line.project_id) return false;
  const identity = line.item_id && p.inv_item_id && line.item_id === p.inv_item_id;
  if (!identity && (line.reqMoc || '') !== (p.invMocNorm || '')) return false;
  if (d.kind === 'plate') {
    if (Math.abs(Number(p.thickness_mm) - d.thickness_mm) > thicknessTol) return false;
    const straight = p.length_mm >= d.length_mm && p.width_mm >= d.width_mm;
    const rotated = p.length_mm >= d.width_mm && p.width_mm >= d.length_mm;
    return straight || rotated;
  }
  if ((p.invSpecNorm || '') !== d.profile) return false;
  return p.length_mm >= d.length_mm;
}

function waste(line, p) {
  const d = line.dims;
  return d.kind === 'plate' ? p.length_mm * p.width_mm - d.length_mm * d.width_mm : p.length_mm - d.length_mm;
}

// Walk lots in date order until `qty` is covered; the date that completes coverage is when the line
// is whole. null = some of it has no date at all.
function onOrderDate(qty, lots, unscheduledQty, unscheduledDate) {
  let need = qty, last = null, undated = false;
  for (const l of lots) {
    if (need <= EPS) break;
    need -= l.qty; last = l.date;
  }
  if (need > EPS) {
    if (unscheduledQty > EPS && unscheduledDate) last = unscheduledDate > (last || '') ? unscheduledDate : last;
    else undated = true;
  }
  return undated ? null : last;
}

export function computePlan({ lines, pools = {}, pieces = [], today, thicknessTol = 0.3 }) {
  const order = [...lines].sort((a, b) =>
    (a.needBy || '9999').localeCompare(b.needBy || '9999') || a.id - b.id);
  const pool = { ...pools };
  const itemDemand = {};           // inventory_item_id -> units still needing stock (for ATP / Inventory view)
  const claimed = new Set();
  const rows = [];

  for (const l of order) {
    const base = {
      id: l.id, project_id: l.project_id, item_id: l.item_id ?? null, needBy: l.needBy || null,
      required: l.required, ambiguous: !!l.ambiguous, purchase_status: l.purchase_status,
      pending_review: !!l.pending_review, poolKey: l.poolKey ?? null,
      secured: 0, free: 0, remnant: 0, remnant_piece_id: null, remnant_piece_code: null,
      incoming: 0, incoming_date: null, held_qc: 0, short: 0,
    };
    const R = l.required;
    if (DONE.includes(l.purchase_status)) {
      rows.push({ ...base, secured: R ?? 0, status: 'in_hand', action: null });
      continue;
    }
    if (!(R > 0)) { rows.push({ ...base, status: 'check_qty', action: null }); continue; }

    const secured = Math.min(R, Math.max(l.received || 0, (l.reservedNet || 0) + (l.reservedPieces || 0)));
    let rem = R - secured;

    if (rem > EPS && l.poolKey != null) itemDemand[l.poolKey] = (itemDemand[l.poolKey] || 0) + rem;

    let free = 0;
    if (rem > EPS && l.poolKey != null) {
      free = Math.min(rem, Math.max(0, pool[l.poolKey] || 0));
      pool[l.poolKey] = (pool[l.poolKey] || 0) - free;
      rem -= free;
    }

    let remnant = 0, firstPiece = null;
    if (rem > EPS && l.dims) {
      const fits = pieces.filter(p => !claimed.has(p.id) && pieceFits(l, p, thicknessTol))
        .sort((a, b) => waste(l, a) - waste(l, b));
      const take = Math.min(Math.ceil(rem), fits.length);
      for (const p of fits.slice(0, take)) claimed.add(p.id);
      remnant = take;
      firstPiece = fits[0] || null;
      rem -= Math.min(rem, take);
    }

    let incoming = 0, incomingDate = null;
    if (rem > EPS && (OPEN_ORDER.includes(l.purchase_status) || (l.poQty || 0) > 0)) {
      const open = (l.poQty || 0) > 0 ? Math.max(0, l.poQty - (l.received || 0)) : rem;
      incoming = Math.min(rem, open);
      if (incoming > EPS) {
        incomingDate = onOrderDate(incoming, l.lots || [], l.unscheduledQty || 0, l.unscheduledDate || null);
        rem -= incoming;
      } else incoming = 0;
    }

    const heldQc = Math.min(l.qcHeldQty || 0, l.received || 0);
    const short = rem > EPS ? Math.round(rem * 1e6) / 1e6 : 0;

    let status, action = null;
    if (short > 0 && l.released === false) {
      // Procurement can't see this line until Design releases the BOM, so nothing is "late" yet.
      status = 'unreleased';
    } else if (short > 0) {
      status = l.pending_review ? 'decision' : 'sourcing';
      action = l.pending_review ? 'decide' : 'chase_procurement';
    } else if (incoming > 0) {
      status = incomingDate && l.needBy && incomingDate > l.needBy ? 'late' : 'on_order';
      action = status === 'late' ? 'expedite' : null;
    } else if (heldQc > EPS) {
      status = 'held_qc'; action = 'chase_qc';
    } else {
      status = 'covered';
    }
    // Stock/remnant that is available but not yet reserved to this line is the one thing a planner
    // can turn into a commitment right now.
    if ((free > EPS || remnant > 0) && short <= 0 && status === 'covered') action = 'reserve';
    if ((free > EPS || remnant > 0) && short > 0) action = 'reserve';

    rows.push({
      ...base, secured, free, remnant, incoming, incoming_date: incomingDate, held_qc: heldQc, short,
      remnant_piece_id: firstPiece?.id ?? null, remnant_piece_code: firstPiece?.code ?? null,
      status, action,
    });
  }

  const items = {};
  for (const k of Object.keys({ ...pools, ...itemDemand })) {
    const avail = pools[k] || 0;
    items[k] = { available: avail, planned_demand: itemDemand[k] || 0, atp: pool[k] ?? avail };
  }

  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const urgentCut = today && rows.length ? addDays(today, 7) : null;
  for (const r of rows) r.urgent = !!(urgentCut && r.needBy && r.needBy <= urgentCut && ['sourcing', 'decision', 'late'].includes(r.status));
  return { rows, items, counts };
}

// Stores' Demand view collapses the nine engine statuses into three states (+ a late flag and an owner
// for "needs action"). Pure mapping — the engine itself stays the single coverage calculation.
export function demandState(r) {
  switch (r.status) {
    case 'in_hand': case 'covered': return { state: 'covered', late: false, owner: null };
    case 'on_order': return { state: 'on_order', late: false, owner: null };
    case 'late': return { state: 'on_order', late: true, owner: null };
    case 'held_qc': return { state: 'needs_action', late: false, owner: 'QC' };
    case 'sourcing': return { state: 'needs_action', late: false, owner: 'Procurement' };
    case 'decision': case 'check_qty': return { state: 'needs_action', late: false, owner: 'Stores' };
    case 'unreleased': return { state: 'unreleased', late: false, owner: null };
    default: return { state: 'needs_action', late: false, owner: 'Stores' };
  }
}

// Per-project roll-up of line counts. Health: any needs-action line -> red, else any on-order -> yellow,
// else green; a project with only unreleased lines is 'unreleased' (never scored).
export function summarizeProject(rows) {
  const c = { covered: 0, on_order: 0, needs_action: 0, unreleased: 0, late: 0 };
  for (const r of rows) {
    const d = demandState(r);
    c[d.state]++;
    if (d.late) c.late++;
  }
  const health = c.needs_action ? 'red' : c.on_order ? 'yellow' : c.covered ? 'green' : 'unreleased';
  return { lines: rows.length, ...c, health };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
