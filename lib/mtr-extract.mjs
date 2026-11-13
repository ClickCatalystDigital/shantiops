// lib/mtr-extract.mjs — batch MTR intake (docs/gulf-coast-asme-plan.md, Phase 1b). Pure: the prompt and the
// clean-up of what the model returns. One PDF can carry several heats; each becomes one line, and on
// accept each line becomes one test_certificates row sharing the PDF. Strength is kept with the unit the
// mill printed (MPa, ksi, psi…): nothing is converted. A person reviews every line before it is saved.
export const PROMPT_VERSION = 'mtr-batch-1';
export const MTR_PROMPT = `You are reading a document that may be a steel Material Test Report (MTR) / Mill Test Certificate.
Return ONE JSON object, no prose, no markdown:
{
  "doc_type": "mtr" | "other",          // "other" if this is not a material test report
  "confidence": number,                  // 0 to 1, how sure you are of the values overall
  "certificate_no": string|null,
  "steel_maker": string|null,            // the mill
  "certificate_date": string|null,       // YYYY-MM-DD
  "material_spec": string|null,          // e.g. "SA-516 Gr.70", "SA-106 Gr.B"
  "lines": [                             // one entry PER HEAT (and per plate/piece if listed separately)
    { "heat_no": string, "plate_no": string|null, "product": string|null, "size": string|null,
      "chem_c": string|null, "chem_mn": string|null, "chem_p": string|null, "chem_s": string|null, "chem_si": string|null,
      "ys": string|null, "uts": string|null, "strength_unit": string|null,   // exactly as printed: MPa, ksi, psi, N/mm2
      "elongation": string|null, "material_spec": string|null }
  ]
}
Use null for anything not printed. Never guess or convert units. Copy numbers exactly as printed.`;

const t = v => (v === undefined || v === null ? '' : String(v).trim());
const n = v => t(v) || null;

// The model's answer → { doc_type, confidence, header, lines, errors }. Lines without a heat number are dropped
// with an error (a certificate row can't exist without one); duplicates (same heat + plate) are merged.
export function normalizeExtract(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const docType = t(r.doc_type).toLowerCase() === 'other' ? 'other' : 'mtr';
  const conf = Number(r.confidence);
  const header = {
    certificate_no: n(r.certificate_no), steel_maker: n(r.steel_maker),
    certificate_date: /^\d{4}-\d{2}-\d{2}$/.test(t(r.certificate_date)) ? t(r.certificate_date) : null,
    material_spec: n(r.material_spec),
  };
  const errors = [];
  const seen = new Map();
  for (const [i, l] of (Array.isArray(r.lines) ? r.lines : []).entries()) {
    const heat = t(l?.heat_no);
    if (!heat) { errors.push(`Line ${i + 1}: no heat number`); continue; }
    const key = `${heat}|${t(l.plate_no)}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      heat_no: heat, plate_no: n(l.plate_no), product: n(l.product), size: n(l.size),
      chem_c: n(l.chem_c), chem_mn: n(l.chem_mn), chem_p: n(l.chem_p), chem_s: n(l.chem_s), chem_si: n(l.chem_si),
      ys: n(l.ys), uts: n(l.uts), strength_unit: n(l.strength_unit), elongation: n(l.elongation),
      material_spec: n(l.material_spec) || header.material_spec,
    });
  }
  const lines = [...seen.values()];
  if (docType === 'mtr' && !lines.length) errors.push('No heats found');
  return { doc_type: docType, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null, header, lines, errors };
}

// A reviewed line + header → the test_certificates fields. Strength goes in with its unit ("485 MPa"),
// so a value printed in ksi is never read as MPa later.
export function lineToCertificate(header, l) {
  const withUnit = v => (t(v) ? `${t(v)}${t(l.strength_unit) ? ` ${t(l.strength_unit)}` : ''}` : null);
  return {
    certificate_no: t(header.certificate_no), cast_no: t(l.heat_no), heat_no: t(l.heat_no), plate_no: n(l.plate_no),
    material_spec: t(l.material_spec || header.material_spec), steel_maker: t(header.steel_maker),
    certificate_date: n(header.certificate_date),
    chem_c: n(l.chem_c), chem_mn: n(l.chem_mn), chem_p: n(l.chem_p), chem_s: n(l.chem_s), chem_si: n(l.chem_si),
    ys: withUnit(l.ys), uts: withUnit(l.uts), elongation: n(l.elongation),
  };
}

// What still stops a reviewed line from being saved.
export function lineProblems(header, l) {
  const c = lineToCertificate(header, l);
  const out = [];
  if (!c.certificate_no) out.push('certificate no.');
  if (!c.cast_no) out.push('heat no.');
  if (!c.material_spec) out.push('material spec');
  if (!c.steel_maker) out.push('mill');
  return out;
}
