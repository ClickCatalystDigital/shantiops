import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requirePM, canApproveUser, isAdmin } from '@/lib/auth';
import { audit } from '@/lib/usb';

// PM-only: toggle a functional head's department access (access matrix), active status, and/or
// approve a pending self-registration. Approval additionally requires the hierarchy check —
// requirePM alone isn't enough (a manager can't approve another manager, see canApproveUser).
export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;
  const b = await req.json();

  const sets = [];
  const args = [];
  const auditActions = [];
  if (Array.isArray(b.departments)) {
    sets.push('departments = ?'); args.push(b.departments.join(',') || null);
    auditActions.push(['access_matrix_edit', `departments -> ${b.departments.join(',') || '(none)'}`]);
  }
  if ('active' in b) {
    sets.push('active = ?'); args.push(b.active ? 1 : 0);
    auditActions.push([b.active ? 'user_reactivated' : 'user_deactivated', '']);
  }
  if ('safe_pass' in b) {
    // Stricter than the requirePM check above this route already passed — only admin, not
    // manager/executive, may grant/revoke the onboarding bypass.
    if (!isAdmin(user)) return NextResponse.json({ error: 'Only admin can grant safe pass' }, { status: 403 });
    sets.push('safe_pass = ?'); args.push(b.safe_pass ? 1 : 0);
    auditActions.push([b.safe_pass ? 'safe_pass_granted' : 'safe_pass_revoked', '']);
  }
  if (b.approve) {
    const target = await queryOne('SELECT id, username, role FROM users WHERE id = ?', [params.id]);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canApproveUser(user, target)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    sets.push('pending = 0');
    await audit('user_approved', { actor: user.username, detail: `${target.username} (${target.role})` });
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  args.push(params.id);
  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args);
  if (auditActions.length) {
    const target = await queryOne('SELECT username FROM users WHERE id = ?', [params.id]);
    for (const [action, extra] of auditActions) {
      await audit(action, { actor: user.username, detail: `${target?.username}${extra ? ' · ' + extra : ''}` });
    }
  }
  return NextResponse.json({ ok: true });
}

// Reject a pending registration — only ever deletes rows that are still pending, and only when
// the approval hierarchy allows it (a manager can never delete an established/admin account).
export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const target = await queryOne('SELECT id, username, role, pending FROM users WHERE id = ?', [params.id]);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!target.pending) return NextResponse.json({ error: 'Only pending registrations can be rejected' }, { status: 400 });
  if (!canApproveUser(user, target)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await execute('DELETE FROM users WHERE id = ?', [params.id]);
  await audit('user_rejected', { actor: user.username, detail: `${target.username} (${target.role})` });
  return NextResponse.json({ ok: true });
}
