// app/api/material-issues/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 completion adds
// weighted-average costing (lib/inventory-costing.mjs) + GL posting (Material Consumed / Raw
// Material Inventory) on top of the existing Stores -> WIP record below; everything about how an
// issue itself is logged is unchanged.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getInventoryItemForBomItem } from '@/lib/data';
import { consumptionCost } from '@/lib/inventory-costing.mjs';
import { materialConsumptionLines } from '@/lib/ledger.mjs';
import { postJournalEntry } from '@/lib/ledger-post';
import { audit } from '@/lib/usb';
import { todayISO } from '@/lib/date';

function canIssue(user) {
  return canAccessDepartment(user, 'Stores') || canAccessDepartment(user, 'Production');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const bomItemId = params.get('bom_item_id');
  const projectId = params.get('project_id');
  if (bomItemId) {
    return NextResponse.json(await queryAll(
      'SELECT * FROM material_issues WHERE bom_item_id = ? ORDER BY issued_at DESC', [bomItemId]
    ));
  }
  if (projectId) {
    return NextResponse.json(await queryAll(
      `SELECT mi.*, b.material_description, b.moc, b.size_spec
         FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
        WHERE b.project_id = ? ORDER BY mi.issued_at DESC LIMIT 100`,
      [projectId]
    ));
  }
  return NextResponse.json({ error: 'bom_item_id or project_id is required' }, { status: 400 });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const bomItemId = Number(b.bom_item_id);
  const qty = Number(b.qty);
  if (!bomItemId) return NextResponse.json({ error: 'BOM item is required' }, { status: 400 });
  if (!qty || qty <= 0) return NextResponse.json({ error: 'Enter a quantity' }, { status: 400 });

  // Weighted-average costing (2026-08-20 decision — the only valuation method in the app, see
  // lib/inventory-costing.mjs). Only possible when the BOM line was actually picked from the item
  // catalog and that item is a tracked inventory_items row; otherwise the issue is logged with no
  // cost, same as it always was before this pass, not guessed at.
  const inventoryItem = await getInventoryItemForBomItem(bomItemId);
  const unitCost = inventoryItem ? inventoryItem.avg_cost : null;
  const totalCost = inventoryItem ? consumptionCost({ qty, avgCost: unitCost }) : null;

  const { lastId } = await execute(
    `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, notes, unit_cost, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [bomItemId, b.job_card_id ? Number(b.job_card_id) : null, qty, user.username, String(b.notes || '').trim() || null, unitCost, totalCost]
  );
  const issueId = Number(lastId);
  await audit('material_issued', { actor: user.username, detail: `bom_item #${bomItemId} · qty ${qty}${totalCost != null ? ` · cost ${totalCost}` : ''}` });

  let costed = false;
  if (inventoryItem && totalCost > 0) {
    await execute('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [qty, inventoryItem.id]);
    const bomItem = await queryOne(
      `SELECT p.company FROM bom_items b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
      [bomItemId]
    );
    if (bomItem?.company) {
      await postJournalEntry({
        company: bomItem.company,
        entryDate: todayISO(),
        sourceType: 'material_issue',
        sourceId: issueId,
        description: `Material Issue #${issueId}`,
        lines: materialConsumptionLines({ amount: totalCost }),
        createdBy: user.username,
      });
      costed = true;
    }
  }

  return NextResponse.json({ id: issueId, costed, unit_cost: unitCost, total_cost: totalCost });
}
