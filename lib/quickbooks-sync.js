// lib/quickbooks-sync.js — QuickBooks Online Phase 2, sales side: customers, invoices and payments received.
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
import { fingerprint, syncKey, requestId, customerQuery, itemQuery, buildCustomer, buildInvoice, buildPayment } from './quickbooks.mjs';

// Who may send or retry: anyone who works with invoices, demo visitors included (the target is the Intuit sandbox).
export const canSend = user => !!user && (isPM(user) || ['Sales', 'Marketing', 'Accounts'].some(d => canAccessDepartment(user, d)));

const ITEM_NAME = 'SB Ops sales';
const INCOME_CODE = '4100'; // Sales Revenue → the QuickBooks income account on the item every line uses
const BANK_CODE = '1001';   // Bank & Cash → where payments are deposited

const invoiceFp = inv => fingerprint(inv.invoice_date, inv.total, inv.customer_id);
const receiptFp = r => fingerprint(r.receipt_date, r.amount, r.sales_invoice_id);

async function freshDoc(company, realm) {
  const rec = await loadSyncDoc(company);
  const data = rec?.data?.realm_id === realm ? rec.data : { realm_id: realm, customers: {}, invoices: {}, receipts: {} };
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

// Called right after an invoice is issued / a payment is recorded. Never fails the user's own save: runs in the
// background where the runtime allows it, and a failure is already kept in the history with its reason.
export function autoSend(kind, id) {
  if (!qboConfig()) return;
  const job = (kind === 'invoice' ? sendInvoice(id) : sendReceipt(id)).catch(() => {});
  const ctx = globalThis[Symbol.for('__cloudflare-context__')]?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(job);
  return job;
}

// For the screens: each invoice's state by local id (latest matching entry), and the failures to retry.
export async function syncState(companies) {
  const out = { invoices: {}, failures: [], sentToday: 0 };
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
    for (const e of [...Object.values(data.invoices), ...Object.values(data.receipts)]) if (e.status === 'sent' && e.at?.startsWith(today)) out.sentToday++;
  }
  return out;
}
