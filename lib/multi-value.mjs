// lib/multi-value.mjs — one spreadsheet cell holding several values ("88 No      58 No" beside two sizes) -> one
// row per value. Pure module, shared by the PMB parser (at import) and the "split existing items" action.
import { formatQty, qtyTokens } from './qty-units.mjs';

// A cell can hold several values, one per line/gap ("88 No      58 No" beside two sizes). When the size cell has
// exactly as many segments as the quantity cell has quantities, each pair is its own BOM item — the same thing a person
// does by hand with "add another size". Everything else on the row (MOC, make, …) is copied to each item, or lined up
// when it has the same number of segments. Any mismatch returns null: the row stays ONE item (its quantity still flagged
// as ambiguous downstream) — never a guess.
// Values are separated by a line break or a run of spaces (authors align columns), but a value can also contain a
// small gap of its own ("… 3500 LG   (3rd PASS)"). So try the widest gap first and take the first threshold that yields
// exactly n segments.
const GAPS = [40, 25, 12, 6, 3, 2];
function segmentsInto(v, n) {
  const s = String(v ?? '');
  for (const k of GAPS) {
    const seg = s.split(new RegExp(`\\s*\\n\\s*|\\s{${k},}`)).map(x => x.trim()).filter(Boolean);
    if (seg.length === n) return seg.map(x => x.replace(/\s+/g, ' '));
  }
  return null;
}
export function splitVariants(rec) {
  const qtys = qtyTokens(rec.qty_text);
  if (!qtys || qtys.length < 2) return null;
  const n = qtys.length;
  const sizes = segmentsInto(rec.size_spec, n);
  if (!sizes) return null;
  const out = qtys.map((q, i) => ({ ...rec, size_spec: sizes[i], qty_text: formatQty(q) }));
  for (const f of ['moc', 'make', 'remarks']) {
    const seg = rec[f] ? segmentsInto(rec[f], n) : null;
    if (seg) out.forEach((v, i) => { v[f] = seg[i]; }); // lined up with the sizes; otherwise one value for the whole row, copied as-is
  }
  return out;
}

