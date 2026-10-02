// PATCH /api/sales-team/[id] { role?: 'head'|'member', active?: boolean } — Sales Head / PM only.
// Touches only the Sales entry of department_roles. Not yourself (no headless team, no lock-out),
// and active can't be switched for someone who also has another department.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead, parseDepartmentRoles } from '@/lib/auth';
import { salesTarget, salesDeptsOnly } from '@/lib/sales-team';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { target, error, status } = await salesTarget(params.id);
  if (error) return NextResponse.json({ error }, { status });
  if (target.id === user.id) return NextResponse.json({ error: 'You can not change your own role or access here' }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const sets = []; const args = []; const done = [];
  if (b.role !== undefined) {
    if (!['head', 'member'].includes(b.role)) return NextResponse.json({ error: 'Role must be head or member' }, { status: 400 });
    const roles = { ...parseDepartmentRoles(target.department_roles), Sales: b.role === 'head' ? 'head' : 'designer' };
    sets.push('department_roles = ?'); args.push(JSON.stringify(roles)); done.push(`Sales -> ${b.role}`);
  }
  if (b.active !== undefined) {
    if (!salesDeptsOnly(target.departments)) return NextResponse.json({ error: 'This person also has other departments — a PM manages their access in Settings' }, { status: 400 });
    sets.push('active = ?'); args.push(b.active ? 1 : 0); done.push(b.active ? 'reactivated' : 'deactivated');
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(target.id);
  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('sales_team_member_edit', { actor: user.username, detail: `${target.username}: ${done.join(', ')}` });
  return NextResponse.json({ ok: true });
}
