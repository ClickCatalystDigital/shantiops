import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { syncQcPartsFromBom } from '@/lib/qc-bom-sync';
import { CORE_FIELDS } from '@/lib/qc-document-fields';

const HEADER_FIELDS = CORE_FIELDS.map(f => f.key);

// New statutory document. `series` is resolved from the project's real Model (projects.series), not
// hardcoded. Every series (SF included) auto-populates its Form IV A parts from the project's own
// BOM (see lib/qc-bom-sync.js) — SF used to seed a fixed 54-row template transcribed from one real
// sample boiler (Maker's No. SB-1037), but that baked one project's exact sizes/qty/part list into
// every other SF document regardless of what that boiler's BOM actually contains. QC can still
// add/remove parts by hand afterward either way.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  const project = await queryOne('SELECT id, company, series FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  // Defaults to the project's own company now (§2.6 fix) rather than always Shanti Boilers —
  // an explicit override in the request still wins if given.
  b.company = COMPANY_NAMES.includes(b.company) ? b.company : (project.company || COMPANY_NAMES[0]);
  // Real bug, fixed 2026-08-24: this used to hardcode 'SF' regardless of the project's actual model,
  // so lib/qc-folder-pdf.js's series-driven form-set selection never got the real series to read.
  // SF stays the fallback for legacy/unset projects — not a behavior change for existing users.
  const series = project.series || 'SF';

  // The UI gate (lib/qc-document-fields.js's `required`) is never the real enforcement — mirrored
  // here against the same list, same shape as the doc_id-only check this replaced.
  for (const f of CORE_FIELDS) {
    if (!String(b[f.key] || '').trim()) return NextResponse.json({ error: `${f.label} is required` }, { status: 400 });
  }

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
    // Bought-out Items (Mountings & Fittings) deliberately stay manual-sync-only for now (the
    // MountingsCard "Sync from BOM" button, lib/qc-bom-sync.js's syncMountingsFromBom) — not
    // auto-seeded at creation like Form IV A. See SYSTEM.md §5d for why.
    const partsSeeded = await syncQcPartsFromBom(tx, documentId, b.project_id);
    return { documentId, partsSeeded };
  });

  await audit('qc_document_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: documentId, project_id: b.project_id, doc_id: b.doc_id.trim() }),
  });
  return NextResponse.json({ id: documentId, series, partsSeeded });
}
