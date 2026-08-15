// Move a stage between lanes (Kanban drag) or remove it from a milestone's instance list.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { fireHandoff } from '@/lib/notify';
import { todayISO } from '@/lib/date';

const STATUSES = ['open', 'current', 'closed'];

async function load(milestoneId, stageId) {
  const m = await queryOne(
    'SELECT id, department, status, actual_start, actual_end FROM milestones WHERE id = ?', [milestoneId]);
  const stage = m && await queryOne(
    'SELECT * FROM milestone_stages WHERE id = ? AND milestone_id = ?', [stageId, milestoneId]);
  return { m, stage };
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { m, stage } = await load(params.id, params.stageId);
  if (!m || !stage) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, m.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();

  if ('label' in b) {
    const label = String(b.label || '').trim();
    if (!label) return NextResponse.json({ error: 'A stage name is required' }, { status: 400 });
    await execute('UPDATE milestone_stages SET label = ? WHERE id = ?', [label, stage.id]);
    await audit('stage_renamed', { actor: user.username, detail: `milestone ${m.id} stage ${stage.id}: ${stage.label} -> ${label}` });
    return NextResponse.json({ ok: true });
  }

  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  await execute('UPDATE milestone_stages SET status = ? WHERE id = ?', [b.status, stage.id]);
  await audit('stage_status_change', {
    actor: user.username,
    detail: `milestone ${m.id} stage ${stage.id} (${stage.label}): ${stage.status} -> ${b.status}`,
  });

  // Auto-complete: once every stage under this milestone is Closed, the milestone itself closes —
  // the same handoff the drawer's Close button fires, so downstream still gets notified. Only
  // fires on the transition (mirrors the milestones PATCH route's own wasDone guard below) —
  // never re-fires on a milestone that was already done before this stage moved.
  const wasDone = !!(m.actual_end || m.status === 'done');
  if (!wasDone) {
    const siblings = await queryAll('SELECT status FROM milestone_stages WHERE milestone_id = ?', [m.id]);
    if (siblings.length && siblings.every(s => s.status === 'closed')) {
      const today = todayISO();
      await execute(
        `UPDATE milestones SET status = 'done', actual_start = COALESCE(actual_start, ?),
                actual_end = COALESCE(actual_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [today, today, m.id]
      );
      try { await fireHandoff(m.id, user.username); }
      catch (e) { await audit('handoff_failed', { actor: user.username, detail: `milestone ${m.id}: ${e}` }); }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { m, stage } = await load(params.id, params.stageId);
  if (!m || !stage) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, m.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await execute('DELETE FROM milestone_stages WHERE id = ?', [stage.id]);
  await audit('stage_removed', { actor: user.username, detail: `milestone ${m.id}: ${stage.label}` });
  return NextResponse.json({ ok: true });
}
