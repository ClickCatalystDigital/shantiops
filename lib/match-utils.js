// lib/match-utils.js — shared free-text matching primitives, deliberately dependency-free (no ./db
// import) so client components can use them too, unlike lib/remnant-match.js which pulls in the DB
// client. normalizeWords originally lived only in StoresWorkspace.jsx (STORES-SALES-CHANGES.md §3.1);
// normalizeMaterial originally lived only in remnant-match.js — both moved here once lib/tc-match.js
// needed them from a client component, rather than copy-pasting either a third time.
export function normalizeWords(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
}

// Strips ALL punctuation/whitespace, not just collapsing it — engineering spec strings are the same
// spec regardless of how someone typed the separators ("SA516 Gr.70" vs "SA 516 GR 70" vs
// "SA-516-70" all -> "sa51670"). Verified live: a real certificate and a hand-typed BOM moc for the
// identical grade failed the old whitespace-only normalize and fell to the weaker fuzzy tier purely
// on formatting. This only tightens an existing exact-equality check to catch more true matches —
// it never turns into a substring/contains check, so it can't start matching things that aren't
// really the same spec.
export function normalizeMaterial(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// STORES_BACKLOG's own "Reserve-from-Stock has no server-side material match" gap, closed the way
// its own note points at: not an item_id-only hard filter (that column is still nullable/sparse on
// most real rows — would incorrectly block most legitimate reservations), but a check on whatever
// signals ARE already present on both sides. Deliberately fires only on ACTIVE disagreement, never
// on missing data — a bom_item/inventory_item pair with one or both fields blank is treated as
// "unknown, not provably wrong" and passes, same tolerance every other advisory-not-mandatory check
// in this codebase already uses. category is a real fixed taxonomy (plate/ms_section/angle/...), so
// two present-and-different values are unambiguous; moc is free text, so it goes through
// normalizeMaterial() first — the same strip-all-punctuation equality check lib/remnant-match.js and
// lib/tc-match.js already trust, never a fuzzy/substring comparison that could itself misfire.
// Exact catalog identity (item_id, same items(id) row) is stronger evidence than free-text
// category/moc — both are normally seeded from the same catalog defaults at pick time (§5bv) and
// can only disagree because one side was hand-edited afterward. Trust the id, not the stale text —
// same precedent lib/remnant-match.js's findCandidates() already set for its own moc check.
export function materialMismatchReason(bomItem, inventoryItem) {
  if (bomItem?.item_id && inventoryItem?.item_id && bomItem.item_id === inventoryItem.item_id) return null;
  if (bomItem?.category && inventoryItem?.category && bomItem.category !== inventoryItem.category) {
    return `category mismatch — requirement is "${bomItem.category}", stock is "${inventoryItem.category}"`;
  }
  if (bomItem?.moc && inventoryItem?.moc && normalizeMaterial(bomItem.moc) !== normalizeMaterial(inventoryItem.moc)) {
    return `material grade mismatch — requirement is "${bomItem.moc}", stock is "${inventoryItem.moc}"`;
  }
  return null;
}
