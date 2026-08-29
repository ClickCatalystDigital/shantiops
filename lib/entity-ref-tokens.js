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
const TOKEN_RE = /\b(JC|WO|NCR|BM|DG|CS|PR|RFQ|FA|PL|LN|SR|INV|INW|GIR|GP|PO|QT|SO|PK|CN|DN|SI|VB)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/gi;

// Trailing punctuation ("," "." ")") is excluded from the character class itself, not trimmed
// after the fact — a sentence like "blocked by JC-1004, see DWG-3." is the normal case, not an
// edge case, and must link cleanly.
export function findEntityRefTokens(text) {
  if (!text) return [];
  return [...new Set((String(text).match(TOKEN_RE) || []))];
}

// The "@" mention picker's type-chip list (MentionTextarea.jsx) and the search route's valid-type
// guard (app/api/entity-refs/search/route.js, via lib/entity-refs.js's re-export) both need this
// same list — kept here, not duplicated in MentionTextarea.jsx, after finding the two had drifted:
// MentionTextarea.jsx's own hardcoded copy stopped at 8 entries from an early round and was never
// updated when PR/RFQ/PO/QT/SO/PK/FA/CN/DN/calc_sheet (and later SI/VB) were added to the real
// registry — those types were fully resolvable/taggable but never showed up as a chip to pick from
// in the first place. One list, in the pure (no-DB) module so the client component can import it
// directly instead of reaching into lib/entity-refs.js (which pulls in server-only DB code).
export const ENTITY_TYPES = [
  { type: 'job_card', label: 'Job Card' },
  { type: 'work_order', label: 'Work Order' },
  { type: 'bom_item', label: 'Material' },
  { type: 'drawing', label: 'Drawing' },
  { type: 'calc_sheet', label: 'Calc Sheet' },
  { type: 'ncr', label: 'NCR' },
  { type: 'grn', label: 'GRN' },
  { type: 'gir', label: 'Gate Inward (GIR)' },
  { type: 'gate_pass', label: 'Gate Pass' },
  { type: 'purchase_requisition', label: 'Purchase Requisition' },
  { type: 'rfq', label: 'RFQ' },
  { type: 'purchase_order', label: 'Purchase Order' },
  { type: 'quotation', label: 'Quotation' },
  { type: 'sale_order', label: 'Sale Order' },
  { type: 'packing_list', label: 'Packing List' },
  { type: 'fixed_asset', label: 'Fixed Asset' },
  { type: 'credit_note', label: 'Credit Note' },
  { type: 'debit_note', label: 'Debit Note' },
  { type: 'sales_invoice', label: 'Sales Invoice' },
  { type: 'vendor_bill', label: 'Vendor Bill' },
];
