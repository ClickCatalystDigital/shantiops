// lib/tc-match.js — TC (test_certificates) <-> QC part suggestion, following the same shape as
// lib/remnant-match.js and StoresWorkspace.jsx's possibleMatches(): exact identity wins outright,
// free-text falls back to keyword-overlap scoring, everything here is non-binding until a human
// clicks "Use this certificate" (app/api/qc-documents/[id]/link-parts).
//
// Scope boundary (same as remnant-match.js's own): a QC part only gets suggestions once it's linked
// to a bom_item_id (Step 1 of the plan) — an unlinked part has no material spec of its own to match
// against, so it gets [] rather than a guess.
import { normalizeMaterial, normalizeWords } from './match-utils';

const SIZE_TOLERANCE_MM = 1;

function parseSize(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// qc_document_parts.size_t/w/l and test_certificates.size_t/w/l are the same shape on both sides
// (same columns, same units) — a free, independent signal that doesn't depend on the BOM-item link
// or on category_fields_json ever having been filled in.
function sizeMatches(part, cert) {
  const dims = [['size_t', part.size_t, cert.size_t], ['size_w', part.size_w, cert.size_w], ['size_l', part.size_l, cert.size_l]];
  let compared = 0;
  for (const [, pv, cv] of dims) {
    const p = parseSize(pv), c = parseSize(cv);
    if (p == null || c == null) continue;
    compared++;
    if (Math.abs(p - c) > SIZE_TOLERANCE_MM) return false;
  }
  return compared > 0; // only counts as a match if at least one dimension was actually comparable
}

const CONFIDENCE_THRESHOLD = 0.75;
const PROMOTION_COUNT_FLOOR = 3;

function confidence(a) {
  return (a.approval_count + 1) / (a.approval_count + a.rejection_count + 2);
}

// approvals: rows from tc_item_match_approvals scoped to bomItem.inventory_item_id (caller's job to
// fetch — this function is pure, no DB access, same as remnant-match.js's parseDims/findCandidates split).
export function suggestCertificates(part, bomItem, certificates, approvals = []) {
  if (!bomItem) return [];
  const reqMoc = normalizeMaterial(bomItem.moc);
  const reqMake = normalizeMaterial(bomItem.make);
  if (!reqMoc) return []; // free-typed line with no real spec — nothing honest to match against

  // Scope to this bomItem's inventory_item_id *before* keying by spec|maker — two different Item
  // Master rows can legitimately share the same (material_spec, steel_maker) pattern (the plan's own
  // "ambiguous item" case), and a plain spec|maker key would silently collide their confidence
  // scores otherwise (last-write-wins into the Map, picking whichever row happened to sort last).
  const ownApprovals = bomItem.inventory_item_id
    ? approvals.filter(a => a.inventory_item_id === bomItem.inventory_item_id)
    : [];
  const promotedKeys = new Set(
    ownApprovals
      .filter(a => a.approval_count >= PROMOTION_COUNT_FLOOR && confidence(a) >= CONFIDENCE_THRESHOLD)
      .map(a => `${a.material_spec}|${a.steel_maker}`)
  );
  const confidenceByKey = new Map(ownApprovals.map(a => [`${a.material_spec}|${a.steel_maker}`, confidence(a)]));

  const reqWords = new Set(normalizeWords(`${bomItem.material_description || ''} ${bomItem.size_spec || ''}`));

  const scored = [];
  for (const c of certificates) {
    const certMoc = normalizeMaterial(c.material_spec);
    const certMake = normalizeMaterial(c.steel_maker);
    const key = `${certMoc}|${certMake}`;
    const promoted = promotedKeys.has(key);
    // Maker only gates the exact tier when the BOM line actually recorded one (bom_items.make) —
    // most bulk-imported lines won't have it, and that absence must not silently downgrade a real
    // material-spec match to fuzzy.
    const exact = certMoc === reqMoc && (!reqMake || certMake === reqMake);

    let tier = null, score = 0;
    if (promoted) { tier = 'promoted'; score = 3 + confidenceByKey.get(key); }
    else if (exact) { tier = 'exact'; score = 2 + (sizeMatches(part, c) ? 0.5 : 0); }
    else {
      const overlap = normalizeWords(`${c.material_spec || ''} ${c.steel_maker || ''}`).filter(w => reqWords.has(w)).length;
      if (overlap > 0) { tier = 'fuzzy'; score = overlap / 10 + (sizeMatches(part, c) ? 0.5 : 0); }
    }
    if (tier) scored.push({ certificate: c, tier, exact: tier !== 'fuzzy', score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 2);
}

// BOM item <-> QC part suggestion — Step 1's "Link to BOM item" is otherwise a plain dropdown over
// every BOM line in the project, unassisted, while everything downstream of it now gets ranked
// suggestions. Same normalizeWords idiom as the fuzzy tier above, just the other match direction.
//
// MIN_SHARED_WORDS=2 is load-bearing, not a tuning knob: a boiler-parts template's vocabulary
// ("Shell Plate", "End Plate") is generic enough that a single shared word like "plate" matches
// nearly every plate-type BOM line with zero discriminating power — verified live, where "Shell
// Plate" tied 1-1 against both a plain "MS PLATE" (moc "MS", no Item Master link) and the actual
// boiler-grade "BQ PLATE ... SA 516 GR 70 ... FORM IV TC" line, and a naive best-score-wins pick
// silently took the wrong one. Ties are refused outright (return null) for the same reason — picking
// arbitrarily between two equally-weak candidates is exactly the fabricated match the rest of this
// module goes out of its way to avoid.
//
// Deliberately text-only (part_name vs material_description) — no size fields on either side. Also
// verified live: a part's required cut dimension (qc_document_parts.size_w, e.g. "2000.0") isn't the
// same kind of number as a BOM line's raw stock size (bom_items.size_spec, e.g. "2000 X 6000 X 10
// THK") — they coincided often enough on round numbers to clear the word-count threshold on their
// own, which is a category error dressed up as a second matching word, not a real signal.
const MIN_SHARED_WORDS = 2;

export function suggestBomItem(part, bomItems) {
  if (part.bom_item_id) return null; // already linked — nothing to suggest
  const partWords = new Set(normalizeWords(part.part_name));
  if (!partWords.size) return null;
  let best = null, bestScore = 0, tied = false;
  for (const b of bomItems) {
    const score = normalizeWords(b.material_description).filter(w => partWords.has(w)).length;
    if (score > bestScore) { best = b; bestScore = score; tied = false; }
    else if (score === bestScore && score > 0) { tied = true; }
  }
  if (bestScore < MIN_SHARED_WORDS || tied) return null;
  return best;
}
