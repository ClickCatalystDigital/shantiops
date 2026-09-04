// Multi-unit BOM split, Phase 6 (MULTI-UNIT-SPLIT-DESIGN.md §4 QC) — batch action: pick several
// child units + one shared set of boiler specs (design pressure, hydro test pressure, dimensions,
// etc. — genuinely identical across identical units of the same order), get one qc_documents header
// per child, each with its OWN maker's no / doc_id (auto-suffixed by the child's own unit_no, same
// numbering convention this app already uses for project_no itself) — never one shared identity.
// Per the guiding principle: batch action, individually-attributable statutory documents.
//
// Real, load-bearing detail: syncQcPartsFromBom(tx, documentId, projectId) is called with the
// MASTER's own project_id, not the child's — a child never has its own bom_items (confirmed
// architecture), but the master's own BOM line qty_text is already the per-unit figure (§5be — the
// aggregate ×unit_count total is a separate, additively-computed field, qty_text itself is never
// overwritten), so reading the master's BOM while writing parts against the child's document is
// exactly correct, not an approximation.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { syncQcPartsFromBom } from '@/lib/qc-bom-sync';
import { CORE_FIELDS } from '@/lib/qc-document-fields';

const HEADER_FIELDS = CORE_FIELDS.map(f => f.key);
// Shared across every child in the batch — everything except the two per-unit identity fields.
const SHARED_FIELDS = HEADER_FIELDS.filter(f => f !== 'makers_no' && f !== 'doc_id');

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const masterId = Number(b.master_project_id);
  const childIds = Array.isArray(b.child_project_ids) ? b.child_project_ids.map(Number).filter(Boolean) : [];
  const makersNoPrefix = String(b.makers_no_prefix || '').trim();
  const docIdPrefix = String(b.doc_id_prefix || '').trim();
  if (!masterId) return NextResponse.json({ error: 'master_project_id is required' }, { status: 400 });
  if (!childIds.length) return NextResponse.json({ error: 'Pick at least one unit' }, { status: 400 });
  if (!makersNoPrefix || !docIdPrefix) {
    return NextResponse.json({ error: "Maker's No. prefix and Document ID prefix are both required" }, { status: 400 });
  }
  // Only the identity fields (makers/doc-id prefixes above, company below) are hard-required —
  // every other CORE_FIELD (design/hydro/working pressure, dimensions, etc.) can be left blank and
  // filled in later, same relaxation as the single-document creation route and for the same reason:
  // the real engineering data for a real boiler often isn't known yet at creation time.

  const master = await queryOne('SELECT id, company, series, bom_release_revision FROM projects WHERE id = ?', [masterId]);
  if (!master) return NextResponse.json({ error: 'Master project not found' }, { status: 404 });

  const placeholders = childIds.map(() => '?').join(',');
  const children = await queryAll(
    `SELECT id, unit_no, series FROM projects WHERE id IN (${placeholders}) AND master_project_id = ? ORDER BY unit_no`,
    [...childIds, masterId]);
  if (children.length !== childIds.length) {
    return NextResponse.json({ error: 'One or more selected units are not children of this master project' }, { status: 400 });
  }

  const company = COMPANY_NAMES.includes(b.company) ? b.company : (master.company || COMPANY_NAMES[0]);
  const padWidth = Math.max(2, String(Math.max(...children.map(c => c.unit_no || 0))).length);

  const created = await withTransaction(async tx => {
    const rows = [];
    for (const child of children) {
      const suffix = String(child.unit_no ?? '').padStart(padWidth, '0');
      const values = { ...b, company, makers_no: `${makersNoPrefix}-${suffix}`, doc_id: `${docIdPrefix}-${suffix}` };
      const series = child.series || master.series || 'SF';
      const res = await tx.execute({
        sql: `INSERT INTO qc_documents (project_id, series, ${HEADER_FIELDS.join(', ')}, created_by, bom_release_revision_at_creation)
              VALUES (?, ?, ${HEADER_FIELDS.map(() => '?').join(', ')}, ?, ?)`,
        args: [child.id, series, ...HEADER_FIELDS.map(f => {
          const v = values[f];
          return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
        }), user.username, master.bom_release_revision ?? null],
      });
      const documentId = Number(res.lastInsertRowid);
      // Read the master's own BOM (per-unit qty_text, correct as-is — see file header), write parts
      // against this child's own document.
      const partsSeeded = await syncQcPartsFromBom(tx, documentId, master.id);
      rows.push({ child_project_id: child.id, id: documentId, makers_no: values.makers_no, doc_id: values.doc_id, partsSeeded });
    }
    return rows;
  });

  await audit('qc_document_batch_add', {
    actor: user.username, detail: `${created.length} statutory documents for master ${masterId} (${makersNoPrefix}-*)`,
  });
  return NextResponse.json({ ok: true, created });
}
