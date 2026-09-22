// app/api/bom-items/[id]/delivery-followups/route.js — Procurement's own timestamped reason log
// for an overdue delivery (Overdues tab). Keyed to the bom_item itself, not a po_delivery_lots row
// — an overdue item never scheduled into a named lot (the RFQ-date-fallback case
// getOverdueDeliveries()/attachDeliveryLotDates() both cover) has no lot id to attach a note to.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const item = await queryOne('SELECT id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const rows = await queryAll(
    'SELECT id, note, created_by, created_at FROM delivery_followups WHERE bom_item_id = ? ORDER BY created_at DESC, id DESC',
    [params.id]);
  return NextResponse.json(rows);
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.delivery_followup.write');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!String(b.note || '').trim()) {
    return NextResponse.json({ error: 'A note is required' }, { status: 400 });
  }
  const res = await execute(
    'INSERT INTO delivery_followups (bom_item_id, note, created_by) VALUES (?, ?, ?)',
    [params.id, b.note.trim(), user.username]
  );
  return NextResponse.json({ id: Number(res.lastId) });
}
