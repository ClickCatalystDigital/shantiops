// lib/qty-units.mjs — quantity as "<number> <unit>" text, with the unit from one fixed list. Pure module (no DB /
// framework imports): shared by the PMB parser, the BOM composer dialog and their selfchecks
// (node lib/qty-units-selfcheck.mjs). bom_items.qty_text stays TEXT — ~10 consumers read its leading number — but
// it is now written in ONE canonical shape ("2 Nos", "8 Mtr") so the number and the unit can be shown separately.

// Curated from the real Item Master uom column (see components/BomTable.jsx): the units the qty dropdown offers.
export const QTY_UNITS = ['Nos', 'Kgs', 'Mtr', 'Sqm', 'Box', 'Ltr', 'Roll', 'Set', 'Pair', 'Bag', 'Pkt'];

const ALIASES = {
  no: 'Nos', nos: 'Nos', nr: 'Nos', nrs: 'Nos',
  kg: 'Kgs', kgs: 'Kgs',
  mtr: 'Mtr', mtrs: 'Mtr', mt: 'Mtr', mts: 'Mtr', meter: 'Mtr', meters: 'Mtr', metre: 'Mtr', metres: 'Mtr',
  ltr: 'Ltr', ltrs: 'Ltr', lit: 'Ltr', litre: 'Ltr', litres: 'Ltr', liter: 'Ltr', liters: 'Ltr',
  sqm: 'Sqm', 'sq m': 'Sqm', 'sq.m': 'Sqm', 'sq mtr': 'Sqm', 'sq mtrs': 'Sqm', 'sq.mtr': 'Sqm', 'sq. mtr': 'Sqm', sqmtr: 'Sqm', 'sq mt': 'Sqm',
  bag: 'Bag', bags: 'Bag', pkt: 'Pkt', pkts: 'Pkt', packet: 'Pkt', packets: 'Pkt',
  box: 'Box', boxes: 'Box', roll: 'Roll', rolls: 'Roll', set: 'Set', sets: 'Set', pair: 'Pair', pairs: 'Pair',
};

// "Nos." / "NO" / "Mtrs." -> the canonical unit, or null when the word is not a known unit.
export function normalizeUnit(raw) {
  return ALIASES[String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '')] || null;
}

// "2 Nos" / "2.0 Mtrs." / "3Nos" -> {num:'2', unit:'Nos'}; a lone number -> unit ''. Anything else (ranges, text,
// several values) -> null, so callers leave messy legacy text untouched. An unknown unit word is kept as typed.
export function splitQtyUnit(text) {
  const m = String(text ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z. ]*?)?\s*$/);
  if (!m) return null;
  const num = String(parseFloat(m[1]));
  const word = (m[2] || '').trim().replace(/\.+$/, '');
  if (!word) return { num, unit: '' };
  const known = normalizeUnit(word);
  if (known) return { num, unit: known };
  return /\s/.test(word) ? null : { num, unit: word }; // an unknown multi-word unit is not guessed at; one unknown word is kept as typed
}

// Canonical text for a single clean quantity; anything that is not one is returned unchanged.
export function formatQty(text) {
  const q = splitQtyUnit(text);
  return q ? `${q.num}${q.unit ? ' ' + q.unit : ''}` : text;
}

// "88 No      58 No" / "2 Nos 1 No 1 No" -> ['88 No','58 No'] / [...]. Returns null unless the WHOLE text is made of
// quantity tokens (a stray word or bracket means we cannot be sure what the numbers refer to).
export function qtyTokens(text) {
  const s = String(text ?? '');
  const re = /\d+(?:\.\d+)?\s*[A-Za-z]*\.?/g;
  const toks = s.match(re) || [];
  if (s.replace(re, '').trim()) return null;
  return toks.map(t => t.trim());
}
