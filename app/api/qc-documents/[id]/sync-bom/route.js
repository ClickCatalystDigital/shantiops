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

  const document = await queryOne('SELECT id, project_id, series FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (document.series === 'SF') {
    return NextResponse.json({ error: 'SF documents use the fixed statutory template, not BOM sync' }, { status: 400 });
  }

  const added = await withTransaction(tx => syncQcPartsFromBom(tx, document.id, document.project_id));
  return NextResponse.json({ added });
}
