// One-off export — item 3 of the 2026-09-30 punch list: every Sale Order with no customer_id link,
// with every column that might help someone recognize who the customer actually is.
import fs from 'fs';
import { createClient } from '@libsql/client';
import XLSX from 'xlsx';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const orders = (await db.execute(`
  SELECT so.id, so.so_no, so.customer_name, so.company, so.order_date, so.created_at, so.created_by,
         so.sales_person_override, so.status, so.track_status, so.total, so.bill_value, so.remarks,
         so.invoice_ref, so.quotation_id, so.opportunity_id, so.lead_id,
         so.address_type, so.order_address, so.contact_person, so.contact_mobile, so.branch_id
    FROM sale_orders so
   WHERE so.customer_id IS NULL
   ORDER BY so.company, so.customer_name, so.order_date
`)).rows;

const orderIds = orders.map(o => o.id);
const paymentsByOrder = new Map();
for (let i = 0; i < orderIds.length; i += 400) {
  const chunk = orderIds.slice(i, i + 400);
  const rows = (await db.execute({
    sql: `SELECT sale_order_id, SUM(amount) total, COUNT(*) n FROM sale_order_payments WHERE sale_order_id IN (${chunk.map(() => '?').join(',')}) GROUP BY sale_order_id`,
    args: chunk,
  })).rows;
  for (const r of rows) paymentsByOrder.set(r.sale_order_id, r);
}

const sheet = orders.map(o => ({
  'Order No.': o.so_no,
  Company: o.company,
  'Customer Name (as written on the order)': o.customer_name,
  'Order Date': o.order_date,
  'Order Total': o.total,
  'Bill Value': o.bill_value,
  'Payments Received': paymentsByOrder.get(o.id)?.total ?? 0,
  'No. of Payments Logged': paymentsByOrder.get(o.id)?.n ?? 0,
  Status: o.status,
  'Current Stage': o.track_status,
  'Sales Person': o.sales_person_override,
  'Created By (import)': o.created_by,
  'Created At': o.created_at,
  Remarks: o.remarks,
  'Invoice Ref': o.invoice_ref,
  'Linked Quotation ID': o.quotation_id,
  'Linked Enquiry ID': o.lead_id,
  'Contact Person': o.contact_person,
  'Contact Mobile': o.contact_mobile,
  'Order Address': o.order_address,
  'Branch ID': o.branch_id,
  'Internal Order ID': o.id,
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), `Orders w-o customer (${sheet.length})`);
const out = 'docs/orders-without-customer-2026-09-30.xlsx';
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`wrote ${out}: ${sheet.length} rows`);
db.close();
