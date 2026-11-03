// lib/quickbooks-sync.js — QuickBooks Online Phase 2: customers, invoices and payments received; vendors, bills and
// bill payments.
// An invoice goes to QuickBooks when it is issued and a payment when it is recorded (autoSend, best-effort, in
// the background); a failure is kept with its reason and shown on the invoice and in the QuickBooks card with
// Retry (POST /api/quickbooks/send). Builders and matching rules: lib/quickbooks.mjs.
//
// The send history is one document per company (loadSyncDoc), keyed by document number + fingerprint so the
// public demo's nightly reset never re-sends seeded invoices nor mistakes a new invoice for an old one:
//   { realm_id, item_id, customers: {name: qboId}, invoices: {key: entry}, receipts: {key: entry} }
//   entry = { local_id, no, status: 'sent'|'failed', qbo_id, qbo_doc, ours, theirs, error, at }
// ponytail: one document per company, rewritten on every send; split it per record if it ever outgrows a demo.
import { queryOne, queryAll } from './db';
import { canAccessDepartment, isPM } from './auth';
import { qboConfig, qboCall, qboGet, connectionStatus, loadSyncDoc, saveSyncDoc } from './quickbooks';
import { fingerprint, syncKey, requestId, customerQuery, itemQuery, buildCustomer, buildInvoice, buildPayment, vendorQuery, buildVendor, buildBill, buildBillPayment } from './quickbooks.mjs';

// Who may send or retry: anyone who works with invoices or bills, demo visitors included (the target is the Intuit sandbox).
export const canSend = user => !!user && (isPM(user) || ['Sales', 'Marketing', 'Accounts', 'Procurement'].some(d => canAccessDepartment(user, d)));

const ITEM_NAME = 'SB Ops sales';
const INCOME_CODE = '4100'; // Sales Revenue → the QuickBooks income account on the item every line uses
const BANK_CODE = '1001';   // Bank & Cash → where payments are deposited and bills are paid from
const BILL_CODE = '1200';   // Raw Material Inventory → what an approved bill debits (lib/ledger.mjs vendorBillLines)

const invoiceFp = inv => fingerprint(inv.invoice_date, inv.total, inv.customer_id);
const receiptFp = r => fingerprint(r.receipt_date, r.amount, r.sales_invoice_id);
const billFp = b => fingerprint(b.bill_date, b.total, b.po_id);
const vendorPaymentFp = p => fingerprint(p.payment_date, p.amount, p.vendor_bill_id);

async function freshDoc(company, realm) {
  const rec = await loadSyncDoc(company);
  const data = rec?.data?.realm_id === realm ? rec.data : { realm_id: realm, customers: {}, invoices: {}, receipts: {} };
  for (const k of ['vendors', 'bills', 'vendor_payments']) data[k] ??= {}; // purchase side came later
  return { data, version: rec?.version };
}

// Read-modify-write of the history with compare-and-set; `change` mutates data.
async function updateDoc(company, realm, change) {
  for (let i = 0; i < 4; i++) {
    const { data, version } = await freshDoc(company, realm);
    change(data);
    if (await saveSyncDoc(company, data, version)) return data;
  }
  throw new Error('Could not save the QuickBooks send history; try again');
}

async function connected(company) {
  if (!qboConfig()) throw new Error('QuickBooks is not set up on this server');
  const conn = await connectionStatus(company);
  if (conn.status !== 'connected') throw new Error('QuickBooks is not connected for this company');
  return conn;
}

async function findOrCreate(company, query, entity, create) {
  const found = (await qboGet(company, '/query', { query }))?.QueryResponse?.[entity]?.[0];
  if (found) return String(found.Id);
  return String((await qboCall(company, 'POST', `/${entity.toLowerCase()}`, { body: create() }))[entity].Id);
}

async function customerId(company, doc, customer) {
  if (doc.customers[customer.name]) return doc.customers[customer.name];
  const id = await findOrCreate(company, customerQuery(customer.name), 'Customer', () => buildCustomer(customer));
  await updateDoc(company, doc.realm_id, d => { d.customers[customer.name] = id; });
  doc.customers[customer.name] = id;
  return id;
}

async function itemId(company, doc, conn) {
  if (doc.item_id) return doc.item_id;
  const income = conn.account_map[INCOME_CODE];
  if (!income) throw new Error('Map 4100 Sales Revenue to a QuickBooks income account first (Accounts → Company Entities)');
  const id = await findOrCreate(company, itemQuery(ITEM_NAME), 'Item', () => ({ Name: ITEM_NAME, Type: 'Service', IncomeAccountRef: { value: income } }));
  await updateDoc(company, doc.realm_id, d => { d.item_id = id; });
  doc.item_id = id;
  return id;
}

const record = (company, realm, bucket, key, entry) =>
  updateDoc(company, realm, d => { d[bucket][key] = { ...entry, at: new Date().toISOString() }; });

export async function sendInvoice(invoiceId) {
  const inv = await queryOne('SELECT * FROM sales_invoices WHERE id = ?', [invoiceId]);
  if (!inv) throw new Error('Invoice not found');
  if (!['issued', 'paid'].includes(inv.status)) throw new Error('Only an issued invoice goes to QuickBooks');
  const conn = await connected(inv.company);
  const key = syncKey(inv.invoice_no, invoiceFp(inv));
  const { data: doc } = await freshDoc(inv.company, conn.realm_id);
  if (doc.invoices[key]?.status === 'sent') return doc.invoices[key];
  const base = { local_id: inv.id, no: inv.invoice_no, ours: inv.total };
  try {
    const [customer, items] = await Promise.all([
      queryOne('SELECT * FROM customers WHERE id = ?', [inv.customer_id]),
      queryAll('SELECT * FROM sales_invoice_items WHERE sales_invoice_id = ? ORDER BY sort_order, id', [inv.id]),
    ]);
    if (!items.length) throw new Error('The invoice has no lines');
    const body = buildInvoice(inv, items, customer, { customerId: await customerId(inv.company, doc, customer), itemId: await itemId(inv.company, doc, conn) });
    const res = await qboCall(inv.company, 'POST', '/invoice', { params: { requestid: requestId(conn.realm_id, 'invoice', key), include: 'allowduplicatedocnum' }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.Invoice.Id), qbo_doc: res.Invoice.DocNumber, theirs: res.Invoice.TotalAmt, error: null };
    await record(inv.company, conn.realm_id, 'invoices', key, entry);
    return entry;
  } catch (err) {
    await record(inv.company, conn.realm_id, 'invoices', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

export async function sendReceipt(receiptId) {
  const r = await queryOne('SELECT * FROM customer_receipts WHERE id = ?', [receiptId]);
  if (!r) throw new Error('Payment not found');
  const conn = await connected(r.company);
  const key = syncKey(r.receipt_no, receiptFp(r));
  const { data: doc } = await freshDoc(r.company, conn.realm_id);
  if (doc.receipts[key]?.status === 'sent') return doc.receipts[key];
  const base = { local_id: r.id, no: r.receipt_no, ours: r.amount };
  try {
    const inv = await sendInvoice(r.sales_invoice_id); // a payment needs its invoice in QuickBooks first
    const customer = await queryOne('SELECT c.* FROM customers c JOIN sales_invoices i ON i.customer_id = c.id WHERE i.id = ?', [r.sales_invoice_id]);
    const body = buildPayment(r, { customerId: await customerId(r.company, doc, customer), invoiceId: inv.qbo_id, depositAccountId: conn.account_map[BANK_CODE] });
    const res = await qboCall(r.company, 'POST', '/payment', { params: { requestid: requestId(conn.realm_id, 'payment', key) }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.Payment.Id), theirs: res.Payment.TotalAmt, error: null };
    await record(r.company, conn.realm_id, 'receipts', key, entry);
    return entry;
  } catch (err) {
    await record(r.company, conn.realm_id, 'receipts', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

async function vendorId(company, doc, supplier) {
  if (doc.vendors[supplier.name]) return doc.vendors[supplier.name];
  const id = await findOrCreate(company, vendorQuery(supplier.name), 'Vendor', () => buildVendor(supplier));
  await updateDoc(company, doc.realm_id, d => { d.vendors[supplier.name] = id; });
  doc.vendors[supplier.name] = id;
  return id;
}
const supplierOfBill = billId => queryOne('SELECT s.* FROM suppliers s JOIN purchase_orders po ON po.supplier_id = s.id JOIN vendor_bills b ON b.po_id = po.id WHERE b.id = ?', [billId]);

export async function sendBill(billId) {
  const bill = await queryOne('SELECT * FROM vendor_bills WHERE id = ?', [billId]);
  if (!bill) throw new Error('Bill not found');
  if (!['approved', 'paid'].includes(bill.status)) throw new Error('Only an approved bill goes to QuickBooks');
  const conn = await connected(bill.company);
  const key = syncKey(bill.bill_no, billFp(bill));
  const { data: doc } = await freshDoc(bill.company, conn.realm_id);
  if (doc.bills[key]?.status === 'sent') return doc.bills[key];
  const base = { local_id: bill.id, no: bill.bill_no, ours: bill.total };
  try {
    const account = conn.account_map[BILL_CODE];
    if (!account) throw new Error('Map 1200 Raw Material Inventory to a QuickBooks account first (Accounts → Company Entities)');
    const [supplier, items] = await Promise.all([
      supplierOfBill(bill.id),
      queryAll('SELECT * FROM vendor_bill_items WHERE vendor_bill_id = ? ORDER BY sort_order, id', [bill.id]),
    ]);
    if (!supplier) throw new Error('The bill has no supplier');
    if (!items.length) throw new Error('The bill has no lines');
    const body = buildBill(bill, items, { vendorId: await vendorId(bill.company, doc, supplier), accountId: account });
    const res = await qboCall(bill.company, 'POST', '/bill', { params: { requestid: requestId(conn.realm_id, 'bill', key) }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.Bill.Id), qbo_doc: res.Bill.DocNumber, theirs: res.Bill.TotalAmt, error: null };
    await record(bill.company, conn.realm_id, 'bills', key, entry);
    return entry;
  } catch (err) {
    await record(bill.company, conn.realm_id, 'bills', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

export async function sendVendorPayment(paymentId) {
  const p = await queryOne('SELECT * FROM vendor_payments WHERE id = ?', [paymentId]);
  if (!p) throw new Error('Payment not found');
  const conn = await connected(p.company);
  const key = syncKey(p.payment_no, vendorPaymentFp(p));
  const { data: doc } = await freshDoc(p.company, conn.realm_id);
  if (doc.vendor_payments[key]?.status === 'sent') return doc.vendor_payments[key];
  const base = { local_id: p.id, no: p.payment_no, ours: p.amount };
  try {
    const bank = conn.account_map[BANK_CODE];
    if (!bank) throw new Error('Map 1001 Bank & Cash to a QuickBooks bank account first (Accounts → Company Entities)');
    const bill = await sendBill(p.vendor_bill_id); // a bill payment needs its bill in QuickBooks first
    const body = buildBillPayment(p, { vendorId: await vendorId(p.company, doc, await supplierOfBill(p.vendor_bill_id)), billId: bill.qbo_id, bankAccountId: bank });
    const res = await qboCall(p.company, 'POST', '/billpayment', { params: { requestid: requestId(conn.realm_id, 'billpayment', key) }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.BillPayment.Id), theirs: res.BillPayment.TotalAmt, error: null };
    await record(p.company, conn.realm_id, 'vendor_payments', key, entry);
    return entry;
  } catch (err) {
    await record(p.company, conn.realm_id, 'vendor_payments', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

const SENDERS = { invoice: sendInvoice, receipt: sendReceipt, bill: sendBill, vendor_payment: sendVendorPayment };
export const KINDS = Object.keys(SENDERS);
export const sendRecord = (kind, id) => SENDERS[kind](id);

// Called right after an invoice is issued / a payment is recorded. Never fails the user's own save: runs in the
// background where the runtime allows it, and a failure is already kept in the history with its reason.
export function autoSend(kind, id) {
  if (!qboConfig()) return;
  const job = sendRecord(kind, id).catch(() => {});
  const ctx = globalThis[Symbol.for('__cloudflare-context__')]?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(job);
  return job;
}

// For the screens: each invoice's state by local id (latest matching entry), and the failures to retry.
export async function syncState(companies) {
  const out = { invoices: {}, bills: {}, failures: [], sentToday: 0 };
  const today = new Date().toISOString().slice(0, 10);
  for (const company of companies) {
    const conn = await connectionStatus(company).catch(() => null);
    if (conn?.status !== 'connected') continue;
    const { data } = await freshDoc(company, conn.realm_id);
    const [invs, rcts] = await Promise.all([
      queryAll("SELECT id, invoice_no, invoice_date, total, customer_id FROM sales_invoices WHERE company = ? AND status IN ('issued', 'paid')", [company]),
      queryAll('SELECT id, receipt_no, receipt_date, amount, sales_invoice_id FROM customer_receipts WHERE company = ?', [company]),
    ]);
    for (const i of invs) {
      const e = data.invoices[syncKey(i.invoice_no, invoiceFp(i))];
      out.invoices[i.id] = e ? { status: e.status, no: e.no, qbo_doc: e.qbo_doc, ours: e.ours, theirs: e.theirs, error: e.error } : { status: 'not_sent' };
      if (e?.status === 'failed') out.failures.push({ kind: 'invoice', id: i.id, no: i.invoice_no, error: e.error, at: e.at });
    }
    for (const r of rcts) {
      const e = data.receipts[syncKey(r.receipt_no, receiptFp(r))];
      if (e?.status === 'failed') out.failures.push({ kind: 'receipt', id: r.id, no: r.receipt_no, error: e.error, at: e.at });
    }
    const [bills, vps] = await Promise.all([
      queryAll("SELECT id, bill_no, bill_date, total, po_id FROM vendor_bills WHERE company = ? AND status IN ('approved', 'paid')", [company]),
      queryAll('SELECT id, payment_no, payment_date, amount, vendor_bill_id FROM vendor_payments WHERE company = ?', [company]),
    ]);
    for (const b of bills) {
      const e = data.bills[syncKey(b.bill_no, billFp(b))];
      out.bills[b.id] = e ? { status: e.status, no: e.no, qbo_doc: e.qbo_doc, ours: e.ours, theirs: e.theirs, error: e.error } : { status: 'not_sent' };
      if (e?.status === 'failed') out.failures.push({ kind: 'bill', id: b.id, no: b.bill_no, error: e.error, at: e.at });
    }
    for (const v of vps) {
      const e = data.vendor_payments[syncKey(v.payment_no, vendorPaymentFp(v))];
      if (e?.status === 'failed') out.failures.push({ kind: 'vendor_payment', id: v.id, no: v.payment_no, error: e.error, at: e.at });
    }
    for (const e of [data.invoices, data.receipts, data.bills, data.vendor_payments].flatMap(Object.values)) if (e.status === 'sent' && e.at?.startsWith(today)) out.sentToday++;
  }
  return out;
}
