// lib/multi-value.mjs — one spreadsheet cell holding several values ("88 No      58 No" beside two sizes) -> one
// row per value. Pure module, shared by the PMB parser (at import) and the "split existing items" action.
import { formatQty, qtyTokens } from './qty-units.mjs';

// A "{LABEL} SIZE :" cell bundles several complete "TH x W x L - QTY UNIT" pieces into one size_spec, with no
// qty_text of its own — real client pattern (2026-09, STF-IBR-057/060), confirmed and directed by the user:
// "PLATE SIZE :", size_spec = "10 X 500 X 1200 - 1 Nos   12 X 1500 X 2000 - 1 Nos   16 X 1100 X 1100 - 1 Nos".
// Unlike splitVariants (a size list + a matching-length qty list in two separate cells), each piece here already
// carries its own trailing "- qty unit" — matched directly off that shape. Checked before classifyConfigRow: this
// is always real, multi-piece material, never configuration, regardless of whether MOC happens to be blank.
// A trailing "-N/M"-style fragment after the leading quantity digit (a real client oddity, "2 -1/2 Nos") is a
// mixed-number fraction mangled by a stray hyphen instead of a space ("2 1/2" = 2.5, not 2) — added to the whole
// number, never dropped: 2 + 1/2 = 2.5, preserved exactly as "2.5 Nos".
//
// size_spec is written "{TH} MM THK X {W} X {L}" — thickness first, per direct instruction, but marked "MM THK"
// so it can actually be found: keyDim('plate', ..., 'line') (lib/item-attributes.mjs) requires the thickness
// number to sit next to "thk"/"thick" — even the app's own composer-generated plate text ("2000 x 1000 x 10
// mm", thickness last, no "thk" word) does not parse on the line side; that convention only works in practice
// because a composer-created line also carries structured category_fields_json, which the PMB importer never
// populates for any dimensional category (a longstanding, already-documented scope boundary, not something
// this fix should change). Confirmed live: "10 MM THK X 500 X 1200" resolves to t10, matching the plain
// "MS PLATES 10 MM" catalog family unambiguously (gradeMatches correctly rules out BQ PLATE/SS families).
const LABELED_SIZE_LIST_LABELS = [/^plate\s*size\s*:?$/i];
const SIZE_CLAUSE = /(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+)\/(\d+))?\s*([A-Za-z]+)/g;

export function splitLabeledSizeList(rec) {
  const desc = String(rec.material_description ?? '').trim();
  if (!LABELED_SIZE_LIST_LABELS.some(re => re.test(desc))) return null;
  const clauses = [...String(rec.size_spec ?? '').matchAll(SIZE_CLAUSE)];
  if (clauses.length < 2) return null; // a single clause isn't a bundle — leave it to the normal path
  const label = desc.replace(/\s*size\s*:?$/i, '').trim().toUpperCase(); // "PLATE SIZE :" -> "PLATE"
  return clauses.map(([, th, w, l, whole, fracNum, fracDen, unit]) => {
    const qty = fracNum ? parseFloat(whole) + parseInt(fracNum, 10) / parseInt(fracDen, 10) : whole;
    return { ...rec, material_description: label, size_spec: `${th} MM THK X ${w} X ${l}`, qty_text: formatQty(`${qty} ${unit}`) };
  });
}

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


// Bundles splitVariants leaves alone because the values sit one space apart, or the row has a single quantity — each
// shape below is a real, repeated PMB pattern a person split by hand (2026-10-06, STF-IBR-055..059). Tried ONLY after
// splitVariants returns null, so every row that already split keeps splitting exactly as before. Narrow on purpose:
// the whole size cell must be made of the pattern's clauses (nothing left over), otherwise the row stays one item.
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const INCH = String.raw`(?:\d+\s)?\d+(?:\/\d+)?"`;
// size clauses that pair one-to-one with the quantities in the quantity cell
const PAIRED_CLAUSES = [
  new RegExp(String.raw`${INCH}\s*[-xX]\s*${INCH}`, 'g'),                         // bolts: 5/8" - 2 1/2" 1/2" - 2"
  /IS(?:MC|A|MB|JC)\s*\d+\s*x\s*\d+(?:\s*x\s*\d+\s*(?:thk|th|t)?)?/gi,           // sections: ISMC 100x50 ISA50x50
  /B\d+\s*-\s*\d+(?:\.\d+)?"/gi,                                                  // pulleys: B3 - 8" B3- 7"
];
const ROD = /[øΦ]?\s*(\d+(?:\.\d+)?)\s*(?:x|dia)\s*(\d+(?:\.\d+)?)\s*lg\.?/gi;   // ø100 x 115 Lg/ 63dia 900 lg
const OWN_QTY = /(\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(?:mm\s*)?thk\.?)\s*-\s*(\d+(?:\.\d+)?)\s*([a-z]+)\.?/gi;
const onlySeparators = s => !s.replace(/[\s\/,;]+/g, '');

export function splitKnownBundles(rec) {
  const size = String(rec.size_spec ?? '');
  const desc = one(rec.material_description);
  const qtyText = one(rec.qty_text);

  // 1. one size clause per quantity
  const qtys = qtyTokens(rec.qty_text);
  if (qtys && qtys.length >= 2) {
    for (const re of PAIRED_CLAUSES) {
      const m = size.match(re) || [];
      if (m.length === qtys.length && onlySeparators(size.replace(re, ''))) {
        return qtys.map((q, i) => ({ ...rec, size_spec: one(m[i]), qty_text: formatQty(q) }));
      }
    }
    return null;
  }

  // 2. SHAFT: "1 Set" = the rods listed in the size cell, one of each
  if (/^shaft$/i.test(desc) && /^1\s*(set|nos?)?\.?$/i.test(qtyText)) {
    const rods = [...size.matchAll(ROD)];
    if (rods.length >= 2 && onlySeparators(size.replace(ROD, ''))) {
      return rods.map(([, d, l]) => ({ ...rec, size_spec: `ø${d} x ${l} Lg`, qty_text: '1 Nos' }));
    }
  }

  // 3. no quantity of its own: every clause carries it ("1850 x 1850 x 12 THK - 1 Nos   1850 x 2500 x 10 THK - 1 Nos")
  if (!/\d/.test(qtyText)) {
    const cl = [...size.matchAll(OWN_QTY)];
    if (cl.length >= 2 && onlySeparators(size.replace(OWN_QTY, ''))) {
      return cl.map(([, s, n, unit]) => ({ ...rec, size_spec: one(s), qty_text: formatQty(`${n} ${unit}`) }));
    }
  }
  return null;
}
