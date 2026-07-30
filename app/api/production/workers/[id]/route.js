// Edit a worker, or deactivate one. No DELETE: workers go inactive so their worker_days history
// survives — same reasoning as machines.active on the security side.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

const EDITABLE = ['name', 'trade', 'active'];

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const worker = await queryOne('SELECT id FROM workers WHERE id = ?', [params.id]);
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
    `UPDATE workers SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]
  );
  return NextResponse.json({ ok: true });
}
