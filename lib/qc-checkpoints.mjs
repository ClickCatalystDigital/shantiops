// lib/qc-checkpoints.mjs — QC's real per-document checkpoint completeness (milestone-automation
// plan §C). "Form exists" is never treated as "form complete" — every checkpoint here requires
// actual field/certificate completeness, not mere presence. Pure: given already-fetched rows,
// which of the 4 core checkpoint concepts apply to this document (model- and presence-aware, never
// a flat /5), and is each one actually complete. No DB here — lib/data.js does the I/O.
//   node lib/qc-checkpoints-selfcheck.mjs
import { modelConfig } from './qc-models.js';
import { QC_HEADER_FIELDS } from './qc-document-fields.js';

const REQUIRED_HEADER_KEYS = QC_HEADER_FIELDS.filter(f => f.required).map(f => f.key);

// Which of the 4 core concepts apply to this document. Header/3A/4A follow the project's model
// (MODEL_CONFIG); a model always files at least a Form III equivalent, so "header" always applies.
// Bought-out is deliberately presence-based, not model-based — the real folder PDF renders the
// mounting section whenever a document has any mounting rows at all, regardless of model (confirmed
// against lib/qc-folder-pdf.js), so a document with zero mountings never gets penalized for a
// checkpoint that genuinely doesn't apply to it.
export function applicableCheckpoints(series, mountingCount) {
  const { forms } = modelConfig(series);
  const out = ['header']; // every model files at least II1, III, or XVII
  if (forms.includes('IIIA')) out.push('form3a');
  if (forms.includes('IVA')) out.push('form4a');
  if (mountingCount > 0) out.push('boughtout');
  return out;
}

// doc: { headerValues: {key: value}, iiiaGroupCount, iiiaPartsAllLinked, ivaPartCount,
//        ivaPartsAllLinked, mountingCount, mountingsAllLinked }
export function checkpointComplete(kind, doc) {
  switch (kind) {
    case 'header':
      return REQUIRED_HEADER_KEYS.every(k => {
        const v = doc.headerValues?.[k];
        return v !== null && v !== undefined && String(v).trim() !== '';
      });
    // 0 groups = not complete (firm rule — a model that doesn't require 3A never reaches this
    // branch at all, since applicableCheckpoints() already excludes it).
    case 'form3a':
      return (doc.iiiaGroupCount || 0) > 0 && !!doc.iiiaPartsAllLinked;
    case 'form4a':
      return (doc.ivaPartCount || 0) > 0 && !!doc.ivaPartsAllLinked;
    case 'boughtout':
      return (doc.mountingCount || 0) > 0 && !!doc.mountingsAllLinked;
    default:
      return false;
  }
}

// One document's full summary — {applicable, completeCount, totalCount, allComplete}.
export function checkpointSummary(series, doc) {
  const applicable = applicableCheckpoints(series, doc.mountingCount || 0);
  const completeCount = applicable.filter(k => checkpointComplete(k, doc)).length;
  return { applicable, completeCount, totalCount: applicable.length, allComplete: applicable.length > 0 && completeCount === applicable.length };
}

// Derives the summary from an already-fetched document + its parts/mountings/groups (the exact
// shape getQcDocumentDetail() returns) instead of a second, independently-timed DB read. A caller
// that's about to RENDER from the same parts/mountings (e.g. the PDF route) must gate off this same
// snapshot, not a fresh query — otherwise the gate could observe a moment strictly newer than what's
// actually rendered, and pass while the rendered document itself is still stale/incomplete. Pure —
// no DB here, same discipline as the rest of this file.
export function checkpointSummaryFromDetail(document, parts, mountings, groups) {
  const iiiaParts = parts.filter(p => p.iiia_group_id);
  return checkpointSummary(document.series, {
    headerValues: document,
    iiiaGroupCount: groups.length,
    iiiaPartsAllLinked: iiiaParts.every(p => p.test_certificate_id),
    ivaPartCount: parts.length,
    ivaPartsAllLinked: parts.length > 0 && parts.every(p => p.test_certificate_id),
    mountingCount: mountings.length,
    mountingsAllLinked: mountings.length > 0 && mountings.every(m => m.test_certificate_id),
  });
}
