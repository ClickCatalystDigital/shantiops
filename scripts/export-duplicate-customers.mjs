// One-off export — item 5 of the 2026-09-30 punch list: enrich the existing possible-duplicate-
// customers list (docs/legacy-crm-possible-duplicates.csv, one row per organization variant,
// grouped by "name key") with order/product/payment data so the user can decide which rows are
// really the same company without opening each one in the app.
import fs from 'fs';
import { createClient } from '@libsql/client';
import XLSX from 'xlsx';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const dupes = parseCsv(fs.readFileSync('docs/legacy-crm-possible-duplicates.csv', 'utf8'));

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// Pull every customer once, keyed by exact name, plus their orders/quotations/payments in bulk
// (way cheaper than 1,315 round trips).
const customers = (await db.execute(
  'SELECT id, name, party_code, gst_no, city, state, phone, account_manager, products_of_interest, source FROM customers'
)).rows;
const byName = new Map(customers.map(c => [c.name, c]));

const orders = (await db.execute('SELECT id, customer_id, so_no, order_date, total, company FROM sale_orders WHERE customer_id IS NOT NULL')).rows;
const ordersByCustomer = new Map();
for (const o of orders) {
  if (!ordersByCustomer.has(o.customer_id)) ordersByCustomer.set(o.customer_id, []);
  ordersByCustomer.get(o.customer_id).push(o);
}

const payments = (await db.execute(`
  SELECT so.customer_id, SUM(p.amount) total, COUNT(*) n
    FROM sale_order_payments p JOIN sale_orders so ON so.id = p.sale_order_id
   WHERE so.customer_id IS NOT NULL
   GROUP BY so.customer_id
`)).rows;
const paymentsByCustomer = new Map(payments.map(r => [r.customer_id, r]));

const quotations = (await db.execute('SELECT customer_id, COUNT(*) n, SUM(total) total FROM quotations WHERE customer_id IS NOT NULL GROUP BY customer_id')).rows;
const quotationsByCustomer = new Map(quotations.map(r => [r.customer_id, r]));

const sheet = dupes.map(d => {
  const c = byName.get(d.organization);
  const custOrders = c ? (ordersByCustomer.get(c.id) || []) : [];
  const pay = c ? paymentsByCustomer.get(c.id) : null;
  const quo = c ? quotationsByCustomer.get(c.id) : null;
  return {
    'Name Key (grouping)': d['name key'],
    Organization: d.organization,
    'Customer ID': c?.id ?? '',
    'Customer Code': c?.party_code ?? d.code ?? '',
    'GST No.': c?.gst_no ?? '',
    District: d.district,
    City: c?.city ?? '',
    State: c?.state ?? '',
    Phone: c?.phone ?? '',
    'A/C Manager': d.managers || c?.account_manager || '',
    'Products of Interest': c?.products_of_interest ?? '',
    'Data Source': c?.source ?? '',
    'No. of Orders': custOrders.length,
    'Order Numbers': custOrders.map(o => o.so_no).join('; '),
    'Order Dates': custOrders.map(o => o.order_date).filter(Boolean).sort().join('; '),
    'Total Order Value': custOrders.reduce((s, o) => s + (o.total || 0), 0) || '',
    'Companies Ordered From': [...new Set(custOrders.map(o => o.company).filter(Boolean))].join('; '),
    'Payments Received': pay?.total ?? '',
    'No. of Payments': pay?.n ?? '',
    'No. of Quotations': quo?.n ?? '',
    'Total Quotation Value': quo?.total ?? '',
  };
});

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Possible duplicates (1315)');
const out = 'docs/possible-duplicate-customers-2026-09-30.xlsx';
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`wrote ${out}: ${sheet.length} rows, ${sheet.filter(r => r['Customer ID']).length} matched to a real customer row`);
db.close();
