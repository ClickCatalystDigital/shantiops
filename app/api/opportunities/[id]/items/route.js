// app/api/opportunities/[id]/items/route.js — V3_CHANGES.md §12 Phase 1d. Bulk replace, not
// per-row CRUD: PUT sends the full current line list, server deletes+reinserts inside one
// transaction-equivalent pair of statements. Simpler than per-row endpoints for a small, editable
// grid UI where the user edits several rows then hits Save once.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM opportunity_items WHERE opportunity_id = ? ORDER BY sort_order, id', [params.id]));
}

export async function PUT(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const opp = await queryOne('SELECT * FROM opportunities WHERE id = ?', [params.id]);
  if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessDepartment(user, opp.owner_dept)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const actionDenied = await requireAction(user, opp.owner_dept, 'crm.opportunity.write');
  if (actionDenied) return actionDenied;

  const { items } = await req.json();
  if (!Array.isArray(items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });

  await execute('DELETE FROM opportunity_items WHERE opportunity_id = ?', [params.id]);
  let sortOrder = 0;
  let total = 0;
  for (const it of items) {
    const desc = String(it.item_description || '').trim();
    if (!desc) continue;
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const amount = qty * rate;
    total += amount;
    await execute(
      `INSERT INTO opportunity_items (opportunity_id, item_description, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [params.id, desc, qty, it.uom || null, rate, amount, sortOrder++]
    );
  }
  // Line items become the authoritative value once any exist — keeps value_num in sync so the
  // pipeline tile's openValue math (lib/data.js getOpportunityPipelineCounts) doesn't need to change.
  if (sortOrder > 0) {
    await execute('UPDATE opportunities SET value_num = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [total, params.id]);
  }
  return NextResponse.json({ ok: true, total });
}
