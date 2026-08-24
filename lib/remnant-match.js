// lib/remnant-match.js — automatic remnant-to-BOM matching, triggered when Design releases a BOM
// (app/api/projects/[id]/release-bom/route.js) and again whenever a single dimensional line is
// added to an already-released project (app/api/bom-items/route.js). Checks a BOM line's required
// material/profile/thickness/dimensions against available stock_pieces (lib/stock-pieces.js),
// reserves whatever fits (plate rotation allowed), and keeps the matched line out of Procurement —
// see lib/data.js's getSourcingItems, which already treats pending_review=1 as permanently hidden.
//
// Scope boundary (confirmed): only BOM lines that already carry a structured category +
// category_fields_json (entered through the PR/BOM composer) can be matched — the dominant
// bulk-Excel-import path writes pure free text and is unaffected, exactly as before this feature.
import { execute, queryAll } from './db';
import { splitQtyText, cloneBomItemForSplit } from './procurement';
import { normalizeMaterial } from './match-utils';

export { normalizeMaterial };

const THICKNESS_TOLERANCE_MM = 0.3;

function parseNum(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// A BOM line's required geometry, read from its category + category_fields_json (the "shape
// varies, read/written whole" JSON blob CALC-CHANGES2.md §F introduced). Returns null for anything
// that isn't a dimensional category or doesn't parse to real numbers — those lines are left
// untouched, the confirmed best-effort boundary.
export function parseDims(bomItem) {
  if (!bomItem?.category || !bomItem?.category_fields_json) return null;
  let f;
  try { f = JSON.parse(bomItem.category_fields_json); } catch { return null; }

  if (bomItem.category === 'plate') {
    const length_mm = parseNum(f.length), width_mm = parseNum(f.width), thickness_mm = parseNum(f.thickness);
    if (!(length_mm > 0 && width_mm > 0 && thickness_mm > 0)) return null;
    return { kind: 'plate', length_mm, width_mm, thickness_mm };
  }
  if (bomItem.category === 'ms_section' || bomItem.category === 'angle') {
    const length_mm = parseNum(f.length);
    const profile = normalizeMaterial(f.size || f.section_type || '');
    if (!(length_mm > 0) || !profile) return null;
    return { kind: 'linear', length_mm, profile };
  }
  return null;
}

// Available stock_pieces that satisfy a BOM line's material + profile/thickness + dimensions,
// sorted least-waste first. `inventory_items.spec` doubles as the linear profile designation
// (e.g. "ISMB 150", "50x50x6") — reused rather than adding a new column, same field Stores' item
// form already collects.
export async function findCandidates(bomItem) {
  const req = parseDims(bomItem);
  if (!req) return [];
  const reqMoc = normalizeMaterial(bomItem.moc);
  // A picked-from-catalog line already has a real identity (item_id) to match on even with moc
  // left blank; only a free-typed line with neither is an actual guess, and that's what this skips.
  if (!reqMoc && !bomItem.item_id) return [];

  const rows = await queryAll(
    `SELECT sp.*, i.moc AS inv_moc, i.spec AS inv_spec, i.item_id AS inv_item_id
       FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id
      WHERE sp.status = 'available' AND i.track_pieces = 1 AND i.category = ?`,
    [bomItem.category]
  );

  const scored = [];
  for (const p of rows) {
    // Item Master identity (§3.2's real join key, items.id) is the strong signal — checked before
    // dimensions and ahead of the free-text moc fallback. Both sides only carry item_id when
    // picked from the same catalog, so it's a real identity match, not a guess; either side
    // missing it (still the common case on free-typed rows) falls back to the moc string compare
    // exactly as before this round, so existing free-text workflows keep matching unchanged.
    const identityMatch = bomItem.item_id && p.inv_item_id && bomItem.item_id === p.inv_item_id;
    if (!identityMatch && normalizeMaterial(p.inv_moc) !== reqMoc) continue;
    if (req.kind === 'plate') {
      if (Math.abs(Number(p.thickness_mm) - req.thickness_mm) > THICKNESS_TOLERANCE_MM) continue;
      const straight = p.length_mm >= req.length_mm && p.width_mm >= req.width_mm;
      const rotated = p.length_mm >= req.width_mm && p.width_mm >= req.length_mm; // plate rotation allowed
      if (!straight && !rotated) continue;
      scored.push({ piece: p, waste: (p.length_mm * p.width_mm) - (req.length_mm * req.width_mm) });
    } else {
      if (normalizeMaterial(p.inv_spec) !== req.profile) continue; // section/angle profile must match exactly
      if (!(p.length_mm >= req.length_mm)) continue;
      scored.push({ piece: p, waste: p.length_mm - req.length_mm });
    }
  }
  scored.sort((a, b) => a.waste - b.waste); // least-waste (smallest sufficient piece) first
  return scored.map(s => s.piece);
}

// The core action: reserve up to the BOM line's required qty from available matching pieces.
// - No match at all: line is untouched, proceeds through the normal Stores-review/Procure path.
// - Full match: no row split needed, the line itself is force-gated (pending_review=1) so it never
//   satisfies getSourcingItems() even once release_bom is done.
// - Partial match: splits like reserveFromStock — original row keeps the unmet remainder (still
//   open, still reviewable/procurable by Stores), a cloned row carries the matched qty and is what
//   the reserved pieces point at.
// Each reservation UPDATE is a conditional `WHERE status='available'` — the same guard
// reserveFromStock's available-pool math relies on — so two lines racing for the same piece can
// never both win it, no wrapping transaction required (same non-transactional precedent
// reserveFromStock itself already uses at this codebase's scale).
export async function matchAndReserve(bomItem, username = 'system') {
  const req = parseDims(bomItem);
  if (!req) return { matched: 0 };

  const qtyMatch = String(bomItem.qty_text || '').match(/^\s*(\d+(?:\.\d+)?)/);
  const required = qtyMatch ? Number(qtyMatch[1]) : 0;
  if (!(required > 0)) return { matched: 0 };

  const candidates = await findCandidates(bomItem);
  if (!candidates.length) return { matched: 0 };

  const reservedIds = [];
  for (const c of candidates) {
    if (reservedIds.length >= required) break;
    const res = await execute("UPDATE stock_pieces SET status = 'reserved' WHERE id = ? AND status = 'available'", [c.id]);
    if (res.changes === 1) reservedIds.push(c.id);
  }
  const K = reservedIds.length;
  if (K === 0) return { matched: 0 };

  let targetBomItemId = bomItem.id;
  if (K < required) {
    const shortfall = required - K;
    const [remainingQtyText, reservedQtyText] = splitQtyText(bomItem.qty_text, shortfall, K);
    await execute('UPDATE bom_items SET qty_text = ? WHERE id = ?', [remainingQtyText, bomItem.id]);
    targetBomItemId = await cloneBomItemForSplit(bomItem, { qtyText: reservedQtyText, pendingReview: true });
  } else {
    await execute('UPDATE bom_items SET pending_review = 1 WHERE id = ?', [bomItem.id]);
  }
  for (const id of reservedIds) {
    await execute('UPDATE stock_pieces SET bom_item_id = ? WHERE id = ?', [targetBomItemId, id]);
  }
  return { matched: K, shortfall: Math.max(0, required - K), targetBomItemId };
}

// Every dimensional line on a project — the release-bom hook's entry point. Non-dimensional/
// free-text-only lines are skipped inside matchAndReserve (parseDims returns null), not filtered
// here, so a mixed BOM never needs special-casing at the call site.
export async function matchProjectBom(projectId, username = 'system') {
  const items = await queryAll(
    `SELECT * FROM bom_items WHERE project_id = ? AND category IN ('plate','ms_section','angle')`,
    [projectId]
  );
  const results = [];
  for (const item of items) {
    const r = await matchAndReserve(item, username);
    if (r.matched > 0) results.push({ bomItemId: item.id, ...r });
  }
  return results;
}
