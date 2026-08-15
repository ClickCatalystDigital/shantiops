// app/api/rfqs/route.js — create an RFQ (V2-CHANGES.md Phase 5.1, D1/D12/D13). Loose bom_items
// only in this phase (PR bundles are Phase 5.2 — rfq_items.pr_item_id stays unused here). Returns
// the full detail in one response (items + per-supplier portal link) so the client can render the
// draft preview immediately, no second round trip.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { execute, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getRfqDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // D12

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const b = await req.json();
  const bomItemIds = Array.isArray(b.bom_item_ids) ? b.bom_item_ids.map(Number).filter(Boolean) : [];
  const supplierIds = Array.isArray(b.supplier_ids) ? b.supplier_ids.map(Number).filter(Boolean) : [];
  if (!bomItemIds.length) return NextResponse.json({ error: 'Select at least one item' }, { status: 400 });
  if (!supplierIds.length) return NextResponse.json({ error: 'Pick at least one supplier' }, { status: 400 });

  // No client precedent for RFQ numbering (unlike po_no's real NNN/SB/YYYY-YY continuation) — a
  // plain incrementing id is enough.
  const seq = await nextCounterValue('rfq_no', 0);
  const rfqNo = `RFQ-${seq}`;
  const { lastId } = await execute(
    'INSERT INTO rfqs (rfq_no, status, created_by) VALUES (?, ?, ?)',
    [rfqNo, 'draft', user.username]
  );
  const rfqId = Number(lastId);

  for (const bomItemId of bomItemIds) {
    await execute('INSERT INTO rfq_items (rfq_id, bom_item_id) VALUES (?, ?)', [rfqId, bomItemId]);
  }
  for (const supplierId of supplierIds) {
    const token = crypto.randomBytes(24).toString('hex');
    await execute(
      'INSERT INTO rfq_suppliers (rfq_id, supplier_id, token, token_expires) VALUES (?, ?, ?, ?)',
      [rfqId, supplierId, token, Date.now() + TOKEN_TTL_MS]
    );
  }

  await audit('rfq_created', { actor: user.username, detail: `${rfqNo}: ${bomItemIds.length} item(s), ${supplierIds.length} supplier(s)` });
  const detail = await getRfqDetail(rfqId);
  return NextResponse.json(detail);
}

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const rows = await queryAll('SELECT * FROM rfqs ORDER BY created_at DESC');
  return NextResponse.json(rows);
}
