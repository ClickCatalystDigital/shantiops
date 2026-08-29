// app/api/sale-orders/route.js — V2-CHANGES.md Group 6 Phase 6.1 (D14). Stores references one via
// ?search= when raising a source='sas' request (Phase 6.4). Mirrors app/api/suppliers/route.js's
// shape.
// so_no used to be free text Sales typed by hand here — inconsistent with the quotation→convert
// path (app/api/quotations/[id]/convert/route.js), which always minted SO-{seq}. Fixed (entity-ref
// tagging round): this path now mints too, off the same shared 'sale_order_no' counter, so every
// sale order gets a real SO-{seq} number regardless of which path created it.
import { NextResponse } from 'next/server';
import { execute, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSaleOrders } from '@/lib/data';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const search = new URL(req.url).searchParams.get('search');
  if (search) {
    const rows = await queryAll(
      "SELECT * FROM sale_orders WHERE so_no LIKE ? ORDER BY created_at DESC LIMIT 20",
      [`%${search}%`]
    );
    return NextResponse.json(rows);
  }
  return NextResponse.json(await getSaleOrders());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.saleorder.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const soNo = `SO-${await nextCounterValue('sale_order_no', 0)}`;
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];

  const { lastId } = await execute(
    'INSERT INTO sale_orders (so_no, customer_name, description, company, created_by) VALUES (?, ?, ?, ?, ?)',
    [soNo, b.customer_name || null, b.description || null, company, user.username]
  );
  await audit('sale_order_created', { actor: user.username, detail: soNo });
  try {
    const note = { kind: 'sale_order_created', title: `New Sale Order: ${soNo}`, body: b.customer_name || null, dedupe_key: `so_created:${lastId}` };
    await notifyDepartment('Design', note);
    await notifyPMs(note, { except: user.id });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ id: Number(lastId), so_no: soNo });
}
