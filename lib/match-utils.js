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
