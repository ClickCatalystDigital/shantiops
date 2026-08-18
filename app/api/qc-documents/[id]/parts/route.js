import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// V2-CHANGES.md Group 2 — add a part row a document's exceptions need beyond the SF template's
// 54-part seed (client point 1: "make it possible to remove or adding new as well to manage
// exceptions"). Starts unlinked, same as every seeded row — the hard PDF gate (qc-documents/[id]/pdf)
// re-checks server-side regardless of how many parts a document ends up with.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!String(b.part_name || '').trim()) {
    return NextResponse.json({ error: 'Part name is required' }, { status: 400 });
  }

  const max = await queryOne('SELECT MAX(sort_order) AS n FROM qc_document_parts WHERE document_id = ?', [params.id]);
  const sortOrder = (max?.n ?? -1) + 1;

  const res = await execute(
    `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, b.part_no?.trim() || null, b.part_name.trim(), b.size_t?.trim() || null,
      b.size_w?.trim() || null, b.size_l?.trim() || null, b.qty?.trim() || null, sortOrder]);

  await audit('qc_document_part_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: Number(res.lastId), part_name: b.part_name.trim() }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
