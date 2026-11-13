// lib/itp-template.mjs — cleaning one ITP template's points before save (pure, shared by the routes and the seed).
import { requiresProblems } from './quality-gate.mjs';

const t = v => String(v ?? '').trim();
export function cleanItems(raw = []) {
  const items = raw.map((r, i) => ({
    sort_order: i + 1, section: t(r.section), item_key: t(r.item_key), name: t(r.name),
    doc_code: t(r.doc_code).toUpperCase() || null, point_type: t(r.point_type).toUpperCase() || null,
    requires: t(r.requires) || null, test_type: t(r.test_type) || null,
    per_weld: r.per_weld ? 1 : 0, qc_only: r.qc_only ? 1 : 0, after_dispatch: r.after_dispatch ? 1 : 0,
  }));
  const errors = [];
  items.forEach((it, i) => { if (!it.section || !it.name) errors.push(`Row ${i + 1}: section and description are required`); });
  items.forEach((it, i) => { if (it.per_weld && !it.test_type) errors.push(`Row ${i + 1}: a per-weld point needs a test type`); });
  return { items, errors: [...errors, ...requiresProblems(items)] };
}
