import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

// QC logs a test/inspection — hydro test, radiography/NDE, material test certificate, etc.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const b = await req.json();
  if (!b.project_id || !b.test_type?.trim()) {
    return NextResponse.json({ error: 'project_id and test_type are required' }, { status: 400 });
  }
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const result = ['pass', 'fail', 'pending'].includes(b.result) ? b.result : 'pending';
  const res = await execute(
    `INSERT INTO qc_records (project_id, test_type, reference_no, result, inspector, tested_on, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, b.test_type.trim(), b.reference_no?.trim() || null, result,
      b.inspector?.trim() || null, b.tested_on || null, b.notes?.trim() || null, user.username]);

  await audit('qc_record_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_record_id: Number(res.lastId), project_id: b.project_id, test_type: b.test_type.trim() }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
