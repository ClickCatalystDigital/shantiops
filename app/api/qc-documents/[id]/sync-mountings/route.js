import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { syncMountingsFromBom } from '@/lib/qc-bom-sync';

// Manual re-sync for the Bought-out Items table — same "additive only" contract as
// sync-bom/route.js's Form IV A sync (see lib/qc-bom-sync.js).
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
  // Same master-BOM resolution as sync-bom/route.js — a split child never has its own bom_items.
  const bomProjectId = document.master_project_id || document.project_id;

  const added = await withTransaction(tx => syncMountingsFromBom(tx, document.id, bomProjectId));
  return NextResponse.json({ added });
}
