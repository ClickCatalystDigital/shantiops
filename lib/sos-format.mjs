// Scope of Supply wording helpers shared by the PDF and the project-page card.
// A product description often ends with "EXCLUSIONS : …" (the client spells it EXCLUSSION too) —
// shown as its own line so what is supplied and what is left out read separately.
export function splitExclusions(text) {
  // Wingdings bullets pasted from Word arrive as &#61692; / private-use characters — show a plain bullet.
  const t = String(text || '').replace(/&#\d+;|[\uF000-\uF8FF]/g, '•').replace(/\s+/g, ' ').trim();
  const m = t.match(/\b(?:note\s*:\s*)?(EXCLU[S]*IONS?)\s*[:\-]\s*/i);
  if (!m) return { body: t, exclusions: '' };
  return { body: t.slice(0, m.index).trim().replace(/[;,.\s]+$/, ''), exclusions: t.slice(m.index + m[0].length).trim() };
}

// "HSN 84021200 · GST 0%" -> "84021200"
export function hsnFrom(spec) {
  return String(spec || '').match(/HSN\s*(\d{4,8})/i)?.[1] || '';
}

// What the Description cell shows for one line: the product name, its type and the full wording
// (falling back to the line text itself when no product is linked).
export function sosLine(it) {
  const name = it.product_name || it.description || '';
  const { body, exclusions } = splitExclusions(it.product_description);
  return { name, type: it.product_type || '', body, exclusions, hsn: it.hsn_code || hsnFrom(it.spec) };
}
