import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { todayISO } from '@/lib/date';
import { fireHandoff } from '@/lib/notify';

// Whitelisted columns — never interpolate a client-supplied column name into SQL.
const EDITABLE = ['assignee', 'department', 'planned_start', 'planned_end', 'actual_start', 'actual_end',
  'status', 'delay_reason', 'delay_category', 'vendor', 'po_no', 'material_ready', 'qc_ok', 'notes'];
// Functional heads own execution, not schedule: they may only stamp actuals/status/why-late.
const HEAD_EDITABLE = ['actual_start', 'actual_end', 'status', 'delay_reason', 'delay_category'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();

  // Fetched unconditionally (not just for heads) so the audit entry can name the project/milestone.
  // status/actual_end are read too so we can tell a real close from a no-op re-save below.
  const m = await queryOne(
    'SELECT project_id, milestone_key, department, status, actual_end FROM milestones WHERE id = ?',
    [params.id]);
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // "Done" is ambiguous by design — every read treats actual_end || status==='done' as done, so the
  // handoff hook below uses the same predicate. Gating on the request body instead would miss the
  // bulk-edit grid (which PATCHes {actual_end} alone, no status) and would re-fire on the drawer's
  // save (which resends every field, status included, on a pure no-op re-save).
  const wasDone = !!(m.actual_end || m.status === 'done');

  let allowed = EDITABLE;
  if (isHead(user)) {
    // A head may only act on milestones in a department they're granted, and only on execution fields.
    if (!canAccessDepartment(user, m.department)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    allowed = HEAD_EDITABLE;
  }

  const sets = [];
  const args = [];
  const changed = [];
  for (const f of allowed) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); changed.push(f); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  // Setting a status of 'done' with no actual_end auto-stamps today.
  if (b.status === 'done' && !('actual_end' in b)) {
    sets.push('actual_end = COALESCE(actual_end, ?)');
    args.push(todayISO());
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('milestone_edit', {
    actor: user.username,
    detail: `project ${m.project_id} · ${m.milestone_key} · ${changed.join(',')}`,
  });

  // The one choke point for the handoff: this route is the ONLY milestone write path, so this
  // covers the drawer AND the bulk-edit grid (which bypasses the drawer entirely). A notification
  // failure must never lose the milestone save the user actually asked for.
  try {
    const after = await queryOne('SELECT status, actual_end FROM milestones WHERE id = ?', [params.id]);
    if (!wasDone && (after?.actual_end || after?.status === 'done')) {
      await fireHandoff(params.id, user.username);
    }
  } catch (e) {
    await audit('handoff_failed', { actor: user.username, detail: `milestone ${params.id}: ${e}` });
  }
  return NextResponse.json({ ok: true });
}
