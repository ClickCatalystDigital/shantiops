// POST /api/trade-requests/accept { ids: [..], customer_id? } — Sales accepts one or more open trade
// requests as ONE new SAS order: mints the next SAS-<n>, creates the sale order with one item per
// request (rate 0 until Sales prices it), links each request to it, and tells the people who raised
// them. The customer comes from the Sale Order a request names, or is picked by Sales.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { splitQtyUnit } from '@/lib/qty-units.mjs';
import { todayISO } from '@/lib/date';
import { audit } from '@/lib/usb';
import { notifyUser } from '@/lib/notify';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  for (const key of ['sales.trade_request.write', 'sales.saleorder.create']) {
    const d = await requireAction(user, 'Sales', key);
    if (d) return d;
  }

  const b = await req.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))];
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one trade request' }, { status: 400 });
  const rows = await queryAll(`SELECT * FROM trade_requests WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (rows.length !== ids.length) return NextResponse.json({ error: 'A trade request was not found' }, { status: 404 });
  const notOpen = rows.filter(r => r.status !== 'open');
  if (notOpen.length) return NextResponse.json({ error: `${notOpen.map(r => r.tr_no).join(', ')} is not open any more` }, { status: 409 });

  // Customer + company: explicit pick, else the sale order the requests refer to.
  let customer = null; let company = null;
  if (b.customer_id) {
    customer = await queryOne('SELECT id, name FROM customers WHERE id = ? AND active = 1', [Number(b.customer_id)]);
    if (!customer) return NextResponse.json({ error: 'That customer was not found' }, { status: 400 });
  }
  const refNos = [...new Set(rows.map(r => r.sale_order_no).filter(Boolean))];
  for (const no of refNos) {
    const so = await queryOne('SELECT customer_id, customer_name, company FROM sale_orders WHERE so_no = ?', [no]);
    if (so) {
      company = company || so.company;
      if (!customer && so.customer_id) customer = { id: so.customer_id, name: so.customer_name };
    }
  }
  if (!customer) return NextResponse.json({ error: 'Pick the customer for this order — the requests name no known sale order' }, { status: 400 });

  const result = await withTransaction(async tx => {
    // Next SAS number = highest plain "SAS-<digits>" in use + 1 (orders also exist as SAS-12R1 etc.).
    const mx = await tx.execute("SELECT MAX(CAST(SUBSTR(so_no, 5) AS INTEGER)) AS m FROM sale_orders WHERE so_no GLOB 'SAS-[0-9]*'");
    const soNo = `SAS-${Number(mx.rows[0].m || 0) + 1}`;
    const description = `Trade request${rows.length > 1 ? 's' : ''} ${rows.map(r => r.tr_no).join(', ')}`;
    const ins = await tx.execute({
      sql: `INSERT INTO sale_orders (so_no, customer_name, customer_id, description, company, created_by, total, order_date, track_status, status, create_as)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'Pending', 'open', 'PO')`,
      args: [soNo, customer.name, customer.id, description, company || 'Shanti Boilers', user.username, todayISO()],
    });
    const orderId = Number(ins.lastInsertRowid);
    let sort = 0;
    for (const r of rows) {
      const q = splitQtyUnit(r.qty_text);
      const text = [r.material_description, r.moc, r.size_spec].filter(Boolean).join(' · ');
      await tx.execute({
        sql: 'INSERT INTO sale_order_items (sale_order_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?, ?, ?, ?, 0, 0, ?)',
        args: [orderId, text, q ? Number(q.num) : null, q?.unit || null, sort++],
      });
      await tx.execute({
        sql: "UPDATE trade_requests SET status = 'accepted', sas_sale_order_id = ?, sas_so_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [orderId, soNo, r.id],
      });
    }
    return { orderId, soNo };
  });

  await audit('trade_request_to_sas', { actor: user.username, detail: `${rows.map(r => r.tr_no).join(', ')} -> ${result.soNo}` });
  try { // best effort — whoever raised each request hears it was accepted
    for (const r of rows) {
      const raiser = await queryOne('SELECT id FROM users WHERE username = ?', [r.raised_by]);
      if (raiser) await notifyUser(raiser.id, { kind: 'trade_request', title: `${r.tr_no} accepted as ${result.soNo}`, body: r.material_description, dedupe_key: `trade_accept:${r.id}` });
    }
  } catch { /* non-fatal */ }
  return NextResponse.json({ id: result.orderId, so_no: result.soNo });
}
