// app/api/quotations/[id]/convert/route.js — V3_CHANGES.md §12 decision 7, second use of the
// "accept → auto-create the next record" playbook. Copies header + lines from an accepted
// Quotation into a new Sale Order. so_no stays free text (bom_items.sale_order_no is a free-text
// copy of it today, not converted to an FK in this phase).
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.quotation.convert');
  if (actionDenied) return actionDenied;

  const quotation = await queryOne(
    `SELECT q.*, c.name AS customer_name FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`,
    [params.id]
  );
  if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (quotation.status !== 'accepted') {
    return NextResponse.json({ error: 'Only an accepted quotation can be converted' }, { status: 409 });
  }
  const items = await queryAll('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order', [params.id]);

  const seq = await nextCounterValue('sale_order_no', 0);
  const soNo = `SO-${seq}`;
  const b = await req.json().catch(() => ({}));
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];

  const { lastId } = await execute(
    `INSERT INTO sale_orders
       (so_no, customer_name, customer_id, opportunity_id, quotation_id, description, subtotal, tax_pct, tax_amount, total, company, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [soNo, quotation.customer_name, quotation.customer_id, quotation.opportunity_id, quotation.id,
      `Converted from ${quotation.quotation_no}`, quotation.subtotal, quotation.tax_pct, quotation.tax_amount, quotation.total, company, user.username]
  );
  const soId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      `INSERT INTO sale_order_items (sale_order_id, item_description, hsn_code, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [soId, it.item_description, it.hsn_code, it.qty, it.uom, it.rate, it.amount, sortOrder++]
    );
  }
  await audit('quotation_converted', { actor: user.username, detail: `${quotation.quotation_no} -> ${soNo}` });
  try {
    const note = { kind: 'sale_order_created', title: `New Sale Order: ${soNo}`, body: quotation.customer_name || null, dedupe_key: `so_created:${soId}` };
    await notifyDepartment('Design', note);
    await notifyPMs(note, { except: user.id });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ id: soId, so_no: soNo });
}
