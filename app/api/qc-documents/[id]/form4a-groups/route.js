import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

// Create a Form IV A manual lettered-section group — purely a QC-typed label sitting on top of the
// existing parts list (no BOM-assembly matching, no auto-sync, unlike qc_iiia_groups). See
// lib/qc-form4a-sections.mjs for why this replaced the old BOM-tree auto-derivation.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!String(b.name || '').trim()) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }

  const max = await queryOne('SELECT MAX(sort_order) AS n FROM qc_form4a_groups WHERE document_id = ?', [params.id]);
  const sortOrder = (max?.n ?? -1) + 1;

  const res = await execute(
    'INSERT INTO qc_form4a_groups (document_id, name, sort_order) VALUES (?, ?, ?)',
    [params.id, b.name.trim(), sortOrder]);

  return NextResponse.json({ id: Number(res.lastId) });
}
