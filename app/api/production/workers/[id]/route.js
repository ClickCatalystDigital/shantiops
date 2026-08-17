// Edit a worker, or deactivate one. No hard delete: workers go inactive so their attendance
// history survives. Scoped to employee_type='worker' AND department='Production' so this endpoint
// can only ever touch shop-floor rows, never a staff HR record — those stay HR-only via
// PATCH /api/employees/[id].
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const EDITABLE = ['name', 'trade', 'active'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const worker = await queryOne(
    "SELECT id, name FROM employees WHERE id = ? AND employee_type = 'worker' AND department = 'Production'",
    [params.id]
  );
  if (!worker) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('name') && !String(b.name || '').trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    if (k === 'active') { changed.active = b.active ? 1 : 0; continue; }
    const v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    changed[k] = v === '' ? null : v;
  }
  await execute(
    `UPDATE employees SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...Object.values(changed), params.id]
  );
  await audit('worker_updated', { actor: user.username, detail: `#${params.id} · ${worker.name}` });
  return NextResponse.json({ ok: true });
}
