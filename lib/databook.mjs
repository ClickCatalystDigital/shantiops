// lib/databook.mjs — Data Book rules (docs/gulf-coast-asme-plan.md, Phase 1c). Pure: the line sources, how
// complete a book is, and the release manifest. A template is a customer's table of contents; a project's book
// copies its lines, so editing a template later never changes a book already started.
//
// A line's source says where its pages come from. Anything other than 'upload' is built from records the app
// already holds; every line also accepts uploaded PDFs (e.g. the signed data report next to the prepared one).
export const SOURCES = {
  upload: 'Uploaded files',
  itp_release: 'ITP release summary (from the traveler)',
  asme_package: 'Data report package (prepared for review)',
  wps: 'WPS documents of the welds used',
  wpq: 'Welder qualification records of the welders used',
  weld_map: 'Weld map (from the weld register)',
  stencil_map: 'Welder stamp map (from the weld register)',
  bom: 'Bill of material',
  mtr: 'Material test reports linked to the project',
  trace_map: 'Material trace map',
};
// Inspection lines read inspection records of one test type, e.g. 'inspection:RT'.
export const sourceLabel = s => (String(s || '').startsWith('inspection:') ? `Inspection records: ${s.slice(11)}` : SOURCES[s] || s);
export const isKnownSource = s => !!SOURCES[s] || /^inspection:\S.{0,40}$/.test(String(s || ''));

const t = v => String(v ?? '').trim();
// Clean a template's lines: [{key, section, label, source}]; keys unique, sources known.
export function cleanLines(raw = []) {
  const errors = [];
  const seen = new Set();
  const lines = raw.map((r, i) => {
    const l = { key: t(r.key), section: t(r.section), label: t(r.label), source: t(r.source) || 'upload' };
    if (!l.key) errors.push(`Line ${i + 1}: no key`);
    else if (seen.has(l.key)) errors.push(`Line ${i + 1}: key ${l.key} used twice`);
    seen.add(l.key);
    if (!l.label) errors.push(`Line ${i + 1}: no description`);
    if (!isKnownSource(l.source)) errors.push(`Line ${i + 1}: unknown source ${l.source}`);
    return l;
  });
  return { lines, errors };
}

// lines: the book's lines (each may carry state 'na' + note). counts: { [key]: { auto, files } } from the database.
// A line is included when it has content, n/a when QC said so (with a note), otherwise missing.
export function completeness(lines, counts = {}) {
  const rows = lines.map(l => {
    const c = counts[l.key] || { auto: 0, files: 0 };
    const state = l.state === 'na' ? 'na' : c.auto + c.files > 0 ? 'included' : 'missing';
    return { ...l, auto: c.auto, files: c.files, status: state };
  });
  const n = s => rows.filter(r => r.status === s).length;
  return { rows, included: n('included'), missing: n('missing'), na: n('na'), total: rows.length };
}

// Why a book can't be released yet (empty = ok). openPoints: what still stops shipping (ITP points, NCRs).
export function releaseProblems(summary, openPoints = []) {
  const out = [];
  for (const r of summary.rows) if (r.status === 'missing') out.push(`${r.section ? `${r.section} · ` : ''}${r.label} is missing`);
  for (const p of openPoints) out.push(`Open: ${p}`);
  return out;
}

// The release manifest: every file and record that went into the PDF, with hashes, in book order. Stable for the
// same inputs, so two releases of identical content produce identical manifests.
export function buildManifest(parts) {
  return parts.map(p => ({ key: p.key, label: p.label, status: p.status,
    items: [...(p.items || [])].map(i => ({ kind: i.kind, ref: String(i.ref ?? ''), sha256: i.sha256 || null, pages: i.pages ?? null })) }));
}
