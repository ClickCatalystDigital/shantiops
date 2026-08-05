// app/api/rfq/[token]/route.js — the supplier portal's own API (V2-CHANGES.md Phase 5.1, D12).
// Public: no session, no requireDepartment — mirrors the public-route precedent of
// POST /api/register. The token itself is the auth; every write re-validates it (and its expiry)
// server-side, never trusting that the page loaded before expiry.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getRfqByToken } from '@/lib/data';
import { advancePurchaseStatus } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const rs = await getRfqByToken(params.token);
  if (!rs) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rs.token_expires && rs.token_expires < Date.now()) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
  }
  return NextResponse.json(rs);
}

// Body: { lines: [{ rfq_item_id, unit_price, uom, payment_terms, expected_delivery_date, remarks }] }
export async function POST(req, { params }) {
  const rs = await getRfqByToken(params.token);
  if (!rs) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rs.token_expires && rs.token_expires < Date.now()) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
  }
  if (rs.responded_at) return NextResponse.json({ error: 'A quote has already been submitted for this RFQ' }, { status: 409 });

  const b = await req.json();
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const validItemIds = new Set(rs.items.map(it => it.rfq_item_id));
  const priced = lines.filter(l => validItemIds.has(Number(l.rfq_item_id)) && Number(l.unit_price) > 0);
  if (!priced.length) return NextResponse.json({ error: 'Enter at least one price' }, { status: 400 });

  const itemById = Object.fromEntries(rs.items.map(it => [it.rfq_item_id, it]));
  const ids = [];
  for (const line of priced) {
    const it = itemById[Number(line.rfq_item_id)];
    const { lastId } = await execute(
      `INSERT INTO supplier_quotes
        (supplier_id, bom_item_id, project_id, unit_price, uom, expected_delivery_date, payment_terms, quote_source, notes)
       VALUES (?, ?, (SELECT project_id FROM bom_items WHERE id = ?), ?, ?, ?, ?, 'portal', ?)`,
      [rs.supplier_id, it.bom_item_id, it.bom_item_id, Number(line.unit_price), line.uom || null,
        line.expected_delivery_date || null, line.payment_terms || null, line.remarks || null]
    );
    ids.push(Number(lastId));
    await advancePurchaseStatus(it.bom_item_id, 'Comparison');
  }

  await execute('UPDATE rfq_suppliers SET responded_at = CURRENT_TIMESTAMP WHERE id = ?', [rs.id]);
  await audit('rfq_quote_submitted', { actor: `supplier:${rs.supplier_id}`, detail: `rfq ${rs.rfq_id}: ${ids.length} item(s)` });
  return NextResponse.json({ ok: true, ids });
}
