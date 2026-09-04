// Multi-unit BOM split, Phase 4 (MULTI-UNIT-SPLIT-DESIGN.md §5.2) — the optional link from received
// material to a specific child unit. Deliberately a separate action from receiving (POST
// .../receive): a receipt never implies a child is complete, and allocating never creates a new
// procurement requirement — this is a pure bookkeeping/traceability step over stock that has already
// arrived, bounded only by what's genuinely available (received - already allocated), never by the
// line's own required quantity.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, queryAll } from '@/lib/db';
import { audit } from '@/lib/usb';
import { getAssemblyRollupMap } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const item = await queryOne('SELECT id, project_id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const allocations = await queryAll(
    `SELECT a.id, a.child_project_id, a.qty_allocated, a.allocated_by, a.allocated_at, p.project_no, p.unit_no
       FROM bom_item_child_allocations a JOIN projects p ON p.id = a.child_project_id
      WHERE a.bom_item_id = ? ORDER BY p.unit_no`, [params.id]);
  return NextResponse.json({ allocations });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.bom.allocate');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  const [received, alreadyAllocated] = await Promise.all([
    queryOne('SELECT COALESCE(SUM(qty_received), 0) AS total FROM bom_item_receipts WHERE bom_item_id = ?', [item.id]),
    queryOne('SELECT COALESCE(SUM(qty_allocated), 0) AS total FROM bom_item_child_allocations WHERE bom_item_id = ?', [item.id]),
  ]);
  const available = Number(received.total || 0) - Number(alreadyAllocated.total || 0);

  // Bundle path — pick N children in one action, one qty split 1-per-child (auto-computed from the
  // line's own per-unit rollup, never hand-typed). All-or-nothing: rejected outright if the bundle
  // doesn't fully fit, rather than silently allocating to as many children as fit and picking winners.
  if (Array.isArray(b.child_project_ids)) {
    const ids = [...new Set(b.child_project_ids.map(Number).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ error: 'Pick at least one unit' }, { status: 400 });

    const placeholders = ids.map(() => '?').join(',');
    const children = await queryAll(
      `SELECT id, project_no FROM projects WHERE id IN (${placeholders}) AND master_project_id = ?`,
      [...ids, item.project_id]);
    if (children.length !== ids.length) {
      return NextResponse.json({ error: 'One or more selected units are not children of this BOM line\'s own project' }, { status: 400 });
    }

    const rollupById = await getAssemblyRollupMap(item.project_id);
    const perUnit = itemRollupQty(item.qty_text, item.assembly_id, rollupById, 1, !!item.qty_resolved) ?? 1;
    const total = perUnit * children.length;
    if (total > available) {
      return NextResponse.json(
        { error: `Only ${available} available — ${children.length} units × ${perUnit} needs ${total}` }, { status: 400 });
    }

    for (const child of children) {
      await execute(
        `INSERT INTO bom_item_child_allocations (bom_item_id, child_project_id, qty_allocated, allocated_by)
         VALUES (?, ?, ?, ?)`,
        [item.id, child.id, perUnit, user.username]);
    }
    await audit('bom_item_allocated', {
      actor: user.username,
      detail: `bom_item #${item.id} -> ${children.length} units @ ${perUnit} each`,
    });
    return NextResponse.json({ ok: true, created: children.length, per_unit_qty: perUnit, available_after: available - total });
  }

  const childId = Number(b.child_project_id);
  const qty = Number(b.qty_allocated);
  if (!(qty > 0)) return NextResponse.json({ error: 'Enter a valid quantity to allocate' }, { status: 400 });

  const child = await queryOne('SELECT id, master_project_id, project_no FROM projects WHERE id = ?', [childId]);
  if (!child) return NextResponse.json({ error: 'Child project not found' }, { status: 404 });
  // The only real trust check here: a line can only be allocated to a genuine child OF THIS LINE'S
  // OWN project — never a stray project id someone happens to pass in.
  if (child.master_project_id !== item.project_id) {
    return NextResponse.json({ error: 'That project is not a child unit of this BOM line\'s own project' }, { status: 400 });
  }
  if (qty > available) {
    return NextResponse.json({ error: `Only ${available} available to allocate` }, { status: 400 });
  }

  const ins = await execute(
    `INSERT INTO bom_item_child_allocations (bom_item_id, child_project_id, qty_allocated, allocated_by)
     VALUES (?, ?, ?, ?)`,
    [item.id, childId, qty, user.username]);

  await audit('bom_item_allocated', {
    actor: user.username,
    detail: `bom_item #${item.id} -> ${child.project_no}: ${qty}`,
  });
  return NextResponse.json({ ok: true, id: Number(ins.lastId), available_after: available - qty });
}
