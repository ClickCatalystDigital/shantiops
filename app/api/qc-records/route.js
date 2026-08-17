import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

// Hydro Test ownership transferred QC -> Production (lib/milestones.js) — a new hydro-test record
// is Production's to create; everything else (radiography/NDE, MTC, freeform) stays QC's.
function canTouch(user, testType) {
  return /hydro/i.test(testType || '') ? canAccessDepartment(user, 'Production') : canAccessDepartment(user, 'QC');
}

// Logs a test/inspection — hydro test, radiography/NDE, material test certificate, etc.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const b = await req.json();
  if (!b.project_id || !b.test_type?.trim()) {
    return NextResponse.json({ error: 'project_id and test_type are required' }, { status: 400 });
  }
  if (!canTouch(user, b.test_type)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
