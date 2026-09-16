// app/api/gate-passes/[id]/route.js — status transitions on a Gate Pass. approve is gated by its
// own action key (stores.gatepass.approve, a distinct authority from write, matching STERP's
// explicit "approval" field); issue/mark-returned/cancel and per-item returned ticks are the
// ordinary write action. A single PATCH body carries one of: {action:'approve'|'issue'|'cancel'},
// {item_id, returned} for one line, or {edit: {...}} to fix a mistyped field — edit is draft-only,
// same "correct it before it's a real approved document" rule the rest of this app uses (e.g. a PO
// stays editable only while draft).
// Widened Stores-only -> Stores OR Dispatch alongside the route.js POST above, same reasoning.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const TRANSITIONS = {
  approve: { from: ['draft'], to: 'approved', actionKey: 'stores.gatepass.approve', stamp: true },
  issue: { from: ['approved'], to: 'issued', actionKey: 'stores.gatepass.write' },
  cancel: { from: ['draft', 'approved', 'issued'], to: 'cancelled', actionKey: 'stores.gatepass.write' },
};

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const deniedStores = requireDepartment(user, 'Stores');
  const deniedDispatch = requireDepartment(user, 'Dispatch');
  if (deniedStores && deniedDispatch) return deniedStores;
  const actingDept = canAccessDepartment(user, 'Stores') ? 'Stores' : 'Dispatch';

  const gp = await queryOne('SELECT * FROM gate_passes WHERE id = ?', [params.id]);
  if (!gp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  if (b.edit) {
    const actionDenied = await requireAction(user, actingDept, 'stores.gatepass.write');
    if (actionDenied) return actionDenied;
    if (gp.status !== 'draft') {
      return NextResponse.json({ error: `Cannot edit a gate pass once it's ${gp.status} — only draft passes are editable` }, { status: 409 });
    }
    const e = b.edit;
    const sets = [];
    const args = [];
    for (const f of ['party', 'responsible_person', 'purpose']) {
      if (f in e) { sets.push(`${f} = ?`); args.push(e[f] || null); }
    }
    if ('expected_return_date' in e) {
      sets.push('expected_return_date = ?');
      args.push(gp.type === 'returnable' ? (e.expected_return_date || null) : null);
    }
    const items = Array.isArray(e.items) ? e.items.filter(it => String(it.description || '').trim()) : null;
    if (items && !items.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    if (!sets.length && !items) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    await withTransaction(async (tx) => {
      if (sets.length) {
        await tx.execute({ sql: `UPDATE gate_passes SET ${sets.join(', ')} WHERE id = ?`, args: [...args, params.id] });
      }
      if (items) {
        await tx.execute({ sql: 'DELETE FROM gate_pass_items WHERE gate_pass_id = ?', args: [params.id] });
        for (const it of items) {
          await tx.execute({
            sql: 'INSERT INTO gate_pass_items (gate_pass_id, description, qty_text) VALUES (?, ?, ?)',
            args: [params.id, String(it.description).trim(), it.qty_text || null],
          });
        }
      }
    });
    await audit('gate_pass_updated', { actor: user.username, detail: `GP-${gp.gp_no}: edited` });
    return NextResponse.json({ ok: true });
  }

  // Per-item returned tick — no status transition of its own; once every item on an issued pass
  // is returned, the pass as a whole flips to 'returned'.
  if (b.item_id) {
    const actionDenied = await requireAction(user, actingDept, 'stores.gatepass.write');
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
  const actionDenied = await requireAction(user, actingDept, t.actionKey);
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
