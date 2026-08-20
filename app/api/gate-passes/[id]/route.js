// app/api/gate-passes/[id]/route.js — status transitions on a Gate Pass. approve is gated by its
// own action key (stores.gatepass.approve, a distinct authority from write, matching STERP's
// explicit "approval" field); issue/mark-returned/cancel and per-item returned ticks are the
// ordinary write action. A single PATCH body carries one of: {action:'approve'|'issue'|'cancel'},
// or {item_id, returned} for one line — mark-returned-as-a-whole is just ticking every line.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const TRANSITIONS = {
  approve: { from: ['draft'], to: 'approved', actionKey: 'stores.gatepass.approve', stamp: true },
  issue: { from: ['approved'], to: 'issued', actionKey: 'stores.gatepass.write' },
  cancel: { from: ['draft', 'approved', 'issued'], to: 'cancelled', actionKey: 'stores.gatepass.write' },
};

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;

  const gp = await queryOne('SELECT * FROM gate_passes WHERE id = ?', [params.id]);
  if (!gp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  // Per-item returned tick — no status transition of its own; once every item on an issued pass
  // is returned, the pass as a whole flips to 'returned'.
  if (b.item_id) {
    const actionDenied = await requireAction(user, 'Stores', 'stores.gatepass.write');
    if (actionDenied) return actionDenied;
    if (!['issued', 'returned'].includes(gp.status)) {
      return NextResponse.json({ error: `Cannot tick a return before the pass is issued (currently ${gp.status})` }, { status: 409 });
    }
    const item = await queryOne('SELECT * FROM gate_pass_items WHERE id = ? AND gate_pass_id = ?', [b.item_id, params.id]);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    await execute('UPDATE gate_pass_items SET returned = ? WHERE id = ?', [b.returned ? 1 : 0, b.item_id]);

    const items = await queryAll('SELECT returned FROM gate_pass_items WHERE gate_pass_id = ?', [params.id]);
    const allReturned = items.length > 0 && items.every(i => i.returned);
    if (allReturned && gp.status === 'issued') {
      await execute("UPDATE gate_passes SET status = 'returned' WHERE id = ?", [params.id]);
    } else if (!allReturned && gp.status === 'returned') {
      await execute("UPDATE gate_passes SET status = 'issued' WHERE id = ?", [params.id]);
    }
    await audit('gate_pass_item_returned', { actor: user.username, detail: `GP-${gp.gp_no} item ${b.item_id}: returned=${!!b.returned}` });
    return NextResponse.json({ ok: true });
  }

  const t = TRANSITIONS[b.action];
  if (!t) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const actionDenied = await requireAction(user, 'Stores', t.actionKey);
  if (actionDenied) return actionDenied;
  if (!t.from.includes(gp.status)) return NextResponse.json({ error: `Cannot ${b.action} from ${gp.status}` }, { status: 409 });

  if (t.stamp) {
    await execute("UPDATE gate_passes SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?", [t.to, user.username, params.id]);
  } else {
    await execute('UPDATE gate_passes SET status = ? WHERE id = ?', [t.to, params.id]);
  }
  await audit('gate_pass_' + b.action, { actor: user.username, detail: `GP-${gp.gp_no} -> ${t.to}` });
  return NextResponse.json({ ok: true });
}
