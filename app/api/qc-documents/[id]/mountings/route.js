import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Add one blank bought-out item row — the per-row twin of parts/route.js's POST. Was a bulk
// "send the whole rows array, we DELETE the lot and reinsert" replace behind an explicit Save
// button; every field here is optional (qc_mountings has no required columns), so a fresh row
// starts blank and is filled in via PATCH .../mountings/[mountingId] as the user edits it — each
// edit persists on its own, no separate Save step needed.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // New rows sort above existing ones — matches where "Add row" visually inserts it.
  const min = await queryOne('SELECT MIN(sort_order) AS n FROM qc_mountings WHERE document_id = ?', [params.id]);
  const sortOrder = (min?.n ?? 0) - 1;

  const res = await execute('INSERT INTO qc_mountings (document_id, sort_order) VALUES (?, ?)', [params.id, sortOrder]);
  const id = Number(res.lastId);

  await audit('qc_mounting_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), mounting_id: id }),
  });
  return NextResponse.json({ id });
}
