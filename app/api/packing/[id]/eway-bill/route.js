// app/api/packing/[id]/eway-bill/route.js — the "Generate E-Way Bill" trigger, same explicit-
// action shape as ../freight/route.js. Idempotency guard mirrors that route's idea (check before
// write): eway_bill_no IS NOT NULL is the "already done" signal here, since there's no
// journal_entries-style existing-entry check to lean on for this one.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { generateEwayBill } from '@/lib/eway-bill';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.eway_bill.generate');
  if (actionDenied) return actionDenied;

  const list = await queryOne(
    `SELECT pl.id, pl.packing_no, pl.eway_bill_no, p.company
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`,
    [params.id]
  );
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (list.eway_bill_no) {
    return NextResponse.json({ error: 'An e-way bill is already set on this packing list. Regeneration/cancellation isn’t built yet — edit the field directly if this is a correction.' }, { status: 409 });
  }
  if (!list.company) return NextResponse.json({ error: 'This packing list has no project/company linked — cannot generate.' }, { status: 400 });

  const credRow = await queryOne('SELECT credentials FROM eway_bill_credentials WHERE company = ?', [list.company]);
  const credentials = credRow ? JSON.parse(credRow.credentials) : null;

  try {
    const result = await generateEwayBill({ company: list.company, credentials, payload: { packingListId: list.id, packingNo: list.packing_no } });
    await execute('UPDATE packing_lists SET eway_bill_no = ?, eway_bill_date = ? WHERE id = ?', [result.ewayBillNo, result.date, params.id]);
    return NextResponse.json({ ok: true, ewayBillNo: result.ewayBillNo, date: result.date });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
