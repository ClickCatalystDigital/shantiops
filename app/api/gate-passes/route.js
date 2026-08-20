// app/api/gate-passes/route.js — STERP item 15. Returnable / Non-Returnable Gate Pass: item list,
// expected return date (returnable only), responsible person, approval, and returned/overdue
// status (overdue derived, see getGatePasses). GET is isInternal-gated, writes are Stores-only —
// approval is a separate action key (stores.gatepass.approve), not folded into write, since
// STERP explicitly calls out approval as its own step.
import { NextResponse } from 'next/server';
import { execute, withTransaction, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGatePasses } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getGatePasses());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.gatepass.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const type = b.type === 'returnable' ? 'returnable' : 'non_returnable';
  const items = Array.isArray(b.items) ? b.items.filter(i => String(i.description || '').trim()) : [];
  if (!items.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });

  const gpNo = await nextCounterValue('gate_pass_no');
  const id = await withTransaction(async (tx) => {
    const result = await tx.execute({
      sql: `INSERT INTO gate_passes (gp_no, type, party, responsible_person, purpose, expected_return_date, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [gpNo, type, b.party || null, b.responsible_person || null, b.purpose || null,
        type === 'returnable' ? (b.expected_return_date || null) : null, user.username],
    });
    const gpId = Number(result.lastInsertRowid);
    for (const it of items) {
      await tx.execute({
        sql: `INSERT INTO gate_pass_items (gate_pass_id, description, qty_text) VALUES (?, ?, ?)`,
        args: [gpId, String(it.description).trim(), it.qty_text || null],
      });
    }
    return gpId;
  });

  await audit('gate_pass_created', { actor: user.username, detail: `GP-${gpNo} (${type}): ${b.party || ''}` });
  return NextResponse.json({ id, gp_no: gpNo });
}
