// Inward QC/Production Approval Workflow — one row, two independent reviewer slots. The server —
// never the client — determines which slot a caller fills: a real QC Head fills qc_*, a real
// Production Head fills production_*, anyone else 403s. A PM (who holds neither department by
// construction) may act as either, picking the slot via an explicit `role` in the body — defaults
// to 'qc' if omitted, since that's the overwhelmingly common PM-acting-as-reviewer case.
// Re-deciding an already-decided slot 400s. Each slot's own gate (qc.predispatch.decide /
// production.predispatch.decide) is checked before writing, in case the department's own action
// permission is ever configured differently from a bare Head check.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, departmentRole, isPM } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { execute, queryOne } from '@/lib/db';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const b = await req.json();
  if (!['approved', 'rejected'].includes(b.decision)) {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 });
  }
  const reason = b.reason ? String(b.reason).trim() || null : null;

  // isPM(user) must be checked FIRST: departmentRole(user, dept) returns 'head' unconditionally for
  // any PM in any department (lib/auth.js), so a naive isRealQcHead/isRealProductionHead check —
  // department access + role==='head' — is ALWAYS true for a PM regardless of which department. A
  // PM check placed after those would never be reached, silently forcing every PM into the QC slot
  // even when they explicitly pass role:'production' (a real bug, found and fixed before this ever
  // shipped: confirmed live that the isPM branch below was structurally dead code).
  let role = null;
  if (isPM(user)) role = b.role === 'production' ? 'production' : 'qc';
  else if (canAccessDepartment(user, 'QC') && departmentRole(user, 'QC') === 'head') role = 'qc';
  else if (canAccessDepartment(user, 'Production') && departmentRole(user, 'Production') === 'head') role = 'production';
  if (!role) return NextResponse.json({ error: 'Forbidden — this action requires the QC or Production Head' }, { status: 403 });

  const dept = role === 'qc' ? 'QC' : 'Production';
  if (!(await canPerformAction(user, dept, `${role}.predispatch.decide`))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const approval = await queryOne('SELECT * FROM pre_dispatch_approvals WHERE id = ?', [params.id]);
  if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (approval[`${role}_decision`]) {
    return NextResponse.json({ error: `Already decided by ${dept}` }, { status: 400 });
  }

  await execute(
    `UPDATE pre_dispatch_approvals
        SET ${role}_decision = ?, ${role}_decided_by = ?, ${role}_decided_at = CURRENT_TIMESTAMP, ${role}_reason = ?
      WHERE id = ?`,
    [b.decision, user.username, reason, approval.id]
  );

  // Overall status: rejected if either side has rejected; approved only once BOTH have approved
  // (independently of each other — one deciding never requires or waits on the other).
  const fresh = await queryOne('SELECT * FROM pre_dispatch_approvals WHERE id = ?', [approval.id]);
  let overall = 'pending';
  if (fresh.qc_decision === 'rejected' || fresh.production_decision === 'rejected') overall = 'rejected';
  else if (fresh.qc_decision === 'approved' && fresh.production_decision === 'approved') overall = 'approved';
  await execute('UPDATE pre_dispatch_approvals SET status = ? WHERE id = ?', [overall, approval.id]);

  await audit(`predispatch_${dept.toLowerCase()}_${b.decision}`, {
    actor: user.username,
    detail: `pre_dispatch_approvals ${approval.id} (packing list ${approval.packing_list_id})${reason ? ` — ${reason}` : ''}`,
  });

  try {
    if (overall === 'rejected' || overall === 'approved') {
      await notifyDepartment('Dispatch', {
        kind: 'predispatch_decided',
        title: overall === 'approved' ? 'Packing List approved for dispatch' : `Packing List rejected by ${dept}`,
        body: reason, project_id: approval.project_id, dedupe_key: `predispatch_decided:${approval.id}`,
      });
    }
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, role, status: overall });
}
