// lib/entity-ref-tokens.js — the pure (no DB) half of lib/entity-refs.js's token grammar, split out
// so client components (LinkifiedText.jsx) can match tokens without pulling server-only DB code
// into the client bundle. lib/entity-refs.js re-exports this for server callers.
// Stock-piece codes have internal hyphens (root "PL-0007" plus a "-U1"/"-R1"/"-S1" suffix — see
// lib/stock-pieces.js), so the remainder allows internal hyphens, just not a trailing one (that's
// how the trailing-punctuation exclusion — "," "." ")" etc. — actually works: none of those
// characters are in the class, hyphen is, but only followed by another alphanumeric).
// Case-insensitive ('i') — someone typing "jc-1004" or "Gir-1004" should still link; the matched
// substring's original case is preserved here (needed to split the source text correctly) and
// normalized to uppercase only at resolve time (lib/entity-refs.js's resolveEntityRef).
const TOKEN_RE = /\b(JC|WO|NCR|BM|DG|CS|PL|LN|SR|INV|INW|GIR|GP)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/gi;

// Trailing punctuation ("," "." ")") is excluded from the character class itself, not trimmed
// after the fact — a sentence like "blocked by JC-1004, see DWG-3." is the normal case, not an
// edge case, and must link cleanly.
export function findEntityRefTokens(text) {
  if (!text) return [];
  return [...new Set((String(text).match(TOKEN_RE) || []))];
}
