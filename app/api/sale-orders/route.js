// app/api/sale-orders/route.js — V2-CHANGES.md Group 6 Phase 6.1 (D14). Stores references one via
// ?search= when raising a source='sas' request (Phase 6.4). Mirrors app/api/suppliers/route.js's
// shape.
// so_no used to be free text Sales typed by hand here — inconsistent with the quotation→convert
// path (app/api/quotations/[id]/convert/route.js), which always minted SO-{seq}. Fixed (entity-ref
// tagging round): this path now mints too, off the same shared 'sale_order_no' counter, so every
// sale order gets a real SO-{seq} number regardless of which path created it.
import { NextResponse } from 'next/server';
import { checkSalesPerson } from '@/lib/sales-people';
import { execute, queryAll, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSaleOrders } from '@/lib/data';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

const TRACK_STATUSES = ['Pending', 'Ready', 'WIP', 'Dispatched', 'Closed'];

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
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];

  // Payment Tracker "Add order": the user supplies their own Order ID (SAS-/NIBR-/SB-… scheme) plus
  // the tracker fields. Without so_no this is exactly the old behavior (mint SO-{seq}).
  const custom = String(b.so_no ?? '').replace(/\s+/g, ' ').trim();
  if (custom && await queryOne('SELECT id FROM sale_orders WHERE so_no = ?', [custom])) {
    return NextResponse.json({ error: `Order ID ${custom} already exists` }, { status: 409 });
  }
  const trackStatus = b.track_status ?? 'Pending';
  if (!TRACK_STATUSES.includes(trackStatus)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  const total = b.total === undefined || b.total === '' ? 0 : Number(b.total);
  if (!(total >= 0)) return NextResponse.json({ error: 'Order value must be a number' }, { status: 400 });
  if (b.order_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.order_date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  // Plan 1i — checked before the order number is taken.
  const person = await checkSalesPerson(b.sales_person, { allowLegacy: true, label: 'Sales Person' });
  if (person.error) return NextResponse.json({ error: person.error }, { status: 400 });
  const soNo = custom || `SO-${await nextCounterValue('sale_order_no', 0)}`;

  // Phase 2 — PO/Sale-Order wizard's Step 1 (Gap #34: a real row exists the moment Continue fires,
  // not only at final Submit, so a closed tab/crashed browser never loses the whole form).
  const createAs = ['PO', 'RFD', 'Approved'].includes(b.create_as) ? b.create_as : 'PO';

  const { lastId } = await execute(
    `INSERT INTO sale_orders (so_no, customer_name, customer_id, description, company, created_by, total, order_date, track_status, status, sales_person_override, remarks, create_as, branch_id, order_stage, lead_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [soNo, b.customer_name || null, b.customer_id || null, b.description || null, company, user.username, total, b.order_date || null, trackStatus,
     ['Dispatched', 'Closed'].includes(trackStatus) ? 'fulfilled' : 'open', person.value, String(b.remarks ?? '').trim() || null,
     createAs, b.branch_id || null, b.order_stage || null, b.lead_id || null]
  );
  await audit('sale_order_created', { actor: user.username, detail: soNo });
  try {
    const note = { kind: 'sale_order_created', title: `New Sale Order: ${soNo}`, body: b.customer_name || null, dedupe_key: `so_created:${lastId}` };
    await notifyDepartment('Design', note);
    await notifyPMs(note, { except: user.id });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ id: Number(lastId), so_no: soNo });
}
