import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { syncQcPartsFromBom } from '@/lib/qc-bom-sync';

// Manual re-sync — BOM lines can be added/edited after a document is created, so this lets QC pull
// in whatever's newly qualifying without retyping it. Only ever adds; never touches or removes an
// existing part (see lib/qc-bom-sync.js).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne(
    `SELECT qd.id, qd.project_id, p.master_project_id
       FROM qc_documents qd JOIN projects p ON p.id = qd.project_id
      WHERE qd.id = ?`, [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Same master-BOM resolution the creation route and batch-children use — a split child never has
  // its own bom_items rows, the whole BOM lives only on the master.
  const bomProjectId = document.master_project_id || document.project_id;

  const added = await withTransaction(tx => syncQcPartsFromBom(tx, document.id, bomProjectId));
  return NextResponse.json({ added });
}
