import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requirePM, canApproveUser, isAdmin, canManageDesignAccess, hasActiveDesignResponsibility, isPM, parseDepartmentRoles } from '@/lib/auth';
import { audit } from '@/lib/usb';

// PM-only: toggle a functional head's department access (access matrix), active status, and/or
// approve a pending self-registration. Approval additionally requires the hierarchy check —
// requirePM alone isn't enough (a manager can't approve another manager, see canApproveUser).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  const designSelfManage = (await hasActiveDesignResponsibility(user, 'head')) && !isPM(user);
  if (denied && !designSelfManage) return denied;
  const b = await req.json();
  if (designSelfManage && ('active' in b || 'safe_pass' in b || b.approve)) {
    return NextResponse.json({ error: 'Design Heads may only manage Design access' }, { status: 403 });
  }
  const managedEmployee = designSelfManage
    ? await queryOne("SELECT id, department, active FROM employees WHERE user_id = ? AND department = 'Design' AND active = 1", [params.id])
    : null;
  if (designSelfManage && !managedEmployee) return NextResponse.json({ error: 'Only an active HR Design employee can be managed' }, { status: 400 });

  const sets = [];
  const args = [];
  const auditActions = [];
  if (Array.isArray(b.departments)) {
    if (designSelfManage && b.departments.some(d => d !== 'Design')) return NextResponse.json({ error: 'Design Heads can only manage Design access' }, { status: 403 });
    sets.push('departments = ?'); args.push(b.departments.join(',') || null);
    auditActions.push(['access_matrix_edit', `departments -> ${b.departments.join(',') || '(none)'}`]);
  }
  if (b.departmentRoles !== undefined) {
    if (!canManageDesignAccess(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const roles = parseDepartmentRoles(b.departmentRoles);
    const supported = ['Design', 'Engineering'];
    if (designSelfManage && Object.keys(roles).some(dept => dept !== 'Design')) return NextResponse.json({ error: 'Design Heads can only manage Design access' }, { status: 403 });
    for (const [dept, requested] of Object.entries(roles)) {
      if (!supported.includes(dept) || !['head', 'designer'].includes(requested)) return NextResponse.json({ error: 'Invalid department responsibility' }, { status: 400 });
      if (requested === 'head' && !['admin', 'manager', 'executive'].includes(user.role)) return NextResponse.json({ error: 'Only admin, manager, or executive can assign a department head' }, { status: 403 });
    }
    const employee = managedEmployee || await queryOne('SELECT id, department, active FROM employees WHERE user_id = ?', [params.id]);
    if (!employee || !employee.active) return NextResponse.json({ error: 'User must be an active HR employee' }, { status: 400 });
    if (designSelfManage && roles.Design !== 'designer') return NextResponse.json({ error: 'Only admin, manager, or executive can assign a Design Head' }, { status: 403 });
    if (!designSelfManage) {
      const target = await queryOne('SELECT departments FROM users WHERE id = ?', [params.id]);
      const currentDepartments = Array.isArray(b.departments)
        ? b.departments
        : String(target?.departments || '').split(',').filter(Boolean);
      const mergedDepartments = [...new Set([...currentDepartments, ...Object.keys(roles)])];
      if (mergedDepartments.length !== currentDepartments.length || mergedDepartments.some(d => !currentDepartments.includes(d))) {
        if (Array.isArray(b.departments)) {
          // Keep the explicit matrix update intact; responsibility assignment cannot silently
          // grant a second department from this combined request.
          return NextResponse.json({ error: 'Grant department access before assigning its responsibility' }, { status: 400 });
        }
        sets.push('departments = ?'); args.push(mergedDepartments.join(','));
      }
    }
    sets.push('department_roles = ?'); args.push(JSON.stringify(roles));
    auditActions.push(['department_responsibility_edit', Object.entries(roles).map(([dept, role]) => `${dept} -> ${role}`).join(', ')]);
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
  if (Array.isArray(b.departments)) {
    await execute('UPDATE employees SET access_departments = ? WHERE user_id = ?', [b.departments.join(',') || null, params.id]);
  }
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
  const user = await getFreshSessionUser();
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
