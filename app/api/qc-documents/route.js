import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { SF_FORM_IVA_PARTS } from '@/lib/qc-template.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { syncQcPartsFromBom } from '@/lib/qc-bom-sync';

const HEADER_FIELDS = [
  'doc_id', 'makers_no', 'year_of_make', 'boiler_type', 'length_overall', 'internal_diameter',
  'design_pressure', 'hydro_test_pressure', 'heating_surface', 'evaporation_capacity', 'steam_temp',
  'drawing_no', 'company',
];

// New statutory document. `series` is resolved from the project's real Model (projects.series), not
// hardcoded — SF filings get the 54-part template auto-seeded (client-confirmed, §8 assumption 1) so
// a fresh SF document is immediately a real, linkable table; every other series (incl. HEADERS) seeds
// zero parts, since real non-SF jobs have genuinely different part lists per job — see the document's
// own Add Part UI instead.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  if (!String(b.doc_id || '').trim()) return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
  const project = await queryOne('SELECT id, company, series FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  // Defaults to the project's own company now (§2.6 fix) rather than always Shanti Boilers —
  // an explicit override in the request still wins if given.
  b.company = COMPANY_NAMES.includes(b.company) ? b.company : (project.company || COMPANY_NAMES[0]);
  // Real bug, fixed 2026-08-24: this used to hardcode 'SF' regardless of the project's actual model,
  // so lib/qc-folder-pdf.js's series-driven form-set selection never got the real series to read.
  // SF stays the fallback for legacy/unset projects — not a behavior change for existing users.
  const series = project.series || 'SF';

  const values = HEADER_FIELDS.map(f => {
    const v = b[f];
    return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
  });

  const { documentId, partsSeeded } = await withTransaction(async tx => {
    const res = await tx.execute({
      sql: `INSERT INTO qc_documents (project_id, series, ${HEADER_FIELDS.join(', ')}, created_by)
            VALUES (?, ?, ${HEADER_FIELDS.map(() => '?').join(', ')}, ?)`,
      args: [b.project_id, series, ...values, user.username],
    });
    const documentId = Number(res.lastInsertRowid);

    // The 54-part SF template only applies to SF filings — every other series (incl. HEADERS) has
    // genuinely different part counts/numbering per real job, so there's no fixed list to seed;
    // instead they're auto-populated from the project's BOM (client-confirmed) — see
    // lib/qc-bom-sync.js. QC can still add/remove parts by hand afterward either way.
    let partsSeeded;
    if (series === 'SF') {
      for (let i = 0; i < SF_FORM_IVA_PARTS.length; i++) {
        const p = SF_FORM_IVA_PARTS[i];
        await tx.execute({
          sql: `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [documentId, p.part_no, p.part_name, p.size_t, p.size_w, p.size_l, p.qty, i],
        });
      }
      partsSeeded = SF_FORM_IVA_PARTS.length;
    } else {
      partsSeeded = await syncQcPartsFromBom(tx, documentId, b.project_id);
    }
    return { documentId, partsSeeded };
  });

  await audit('qc_document_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: documentId, project_id: b.project_id, doc_id: b.doc_id.trim() }),
  });
  return NextResponse.json({ id: documentId, series, partsSeeded });
}
