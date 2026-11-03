// lib/quickbooks.mjs — QuickBooks Online connection, pure parts (no DB, no fetch), so the self-check
// runs under plain node. Server side lives in lib/quickbooks.js.
//
// Endpoints come from Intuit's discovery documents
// (https://developer.api.intuit.com/.well-known/openid_sandbox_configuration, /openid_configuration)
// and Intuit's official Node SDK, github.com/intuit/oauth-jsclient (src/OAuthClient.js).
// Sandbox and production share the OAuth endpoints; only the API base differs.

export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
export const QBO_API_BASE = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
// ponytail: one minor version pinned for every call; raise it deliberately when a field needs it.
export const QBO_MINOR_VERSION = '75';
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
export const STATE_TTL_MS = 10 * 60 * 1000;

export function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: QBO_SCOPE, redirect_uri: redirectUri, state });
  return `${QBO_AUTHORIZE_URL}?${q}`;
}

// Intuit returns lifetimes in seconds: expires_in (access, 3600) and x_refresh_token_expires_in.
export function tokenTimes(resp, now = Date.now()) {
  const access = Number(resp?.expires_in);
  const refresh = Number(resp?.x_refresh_token_expires_in);
  if (!resp?.access_token || !resp?.refresh_token || !(access > 0)) throw new Error('QuickBooks returned an incomplete token response');
  return {
    access_expires_at: new Date(now + access * 1000).toISOString(),
    refresh_expires_at: refresh > 0 ? new Date(now + refresh * 1000).toISOString() : null,
  };
}

export function needsRefresh(conn, now = Date.now()) {
  return !conn?.access_expires_at || new Date(conn.access_expires_at).getTime() - now < REFRESH_SKEW_MS;
}

// The state cookie carries who started the connect and for which company. Checked on the callback.
export function checkState({ cookie, state, userId, now = Date.now() }) {
  if (!cookie || !state) return 'The connection request expired. Start again from Accounts.';
  if (cookie.state !== state) return 'The connection request did not match. Start again from Accounts.';
  if (cookie.userId !== userId) return 'Finish connecting while signed in as the person who started it.';
  if (!(cookie.exp > now)) return 'The connection request expired. Start again from Accounts.';
  return null;
}

// Query response for `select * from Account` → plain list, active accounts only.
export function normalizeAccounts(resp) {
  const rows = resp?.QueryResponse?.Account || [];
  return rows
    .filter(a => a.Active !== false)
    .map(a => ({ id: String(a.Id), name: a.FullyQualifiedName || a.Name, type: a.AccountType, subType: a.AccountSubType || null, number: a.AcctNum || null }))
    .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name));
}

// Which QuickBooks account types make sense for an SB Ops account type. Used to sort the dropdown
// and to warn, never to block: the accountant may know better.
const FIT = {
  asset: ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'],
  liability: ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'],
  equity: ['Equity'],
  income: ['Income', 'Other Income'],
  expense: ['Expense', 'Other Expense', 'Cost of Goods Sold'],
};
export function accountFits(localType, qboType) {
  return (FIT[localType] || []).includes(qboType);
}

// Validates an incoming map {code: qboAccountId|''} against the company's own codes and the
// QuickBooks account list. Blank = unmapped (allowed). Returns {rows, error}.
export function cleanAccountMap(map, localCodes, qboIds) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: 'Send the mapping as {code: accountId}' };
  const codes = new Set(localCodes.map(String));
  const ids = new Set(qboIds.map(String));
  const rows = [];
  for (const [code, raw] of Object.entries(map)) {
    if (!codes.has(code)) return { error: `Unknown account code ${code}` };
    const id = raw == null ? '' : String(raw).trim();
    if (id && !ids.has(id)) return { error: `QuickBooks account ${id} was not found; reload the list` };
    rows.push({ code, qbo_account_id: id || null });
  }
  return { rows };
}

// Suggested matches shown right after connecting, so the owner reviews a filled-in table instead of picking every
// row. First rule whose local pattern matches wins; an exact name match beats every rule. Sales tax is never
// suggested: QuickBooks' automated sales tax posts to its own agency accounts.
const SUGGEST = [
  [/sales tax|tax payable/i, () => false],
  [/bank charge/i, q => q.subType === 'BankCharges'],
  [/bank|cash/i, q => q.subType === 'Checking' || q.type === 'Bank'],
  [/receivable/i, q => q.type === 'Accounts Receivable'],
  [/payable/i, q => q.type === 'Accounts Payable'],
  [/inventory|raw material/i, q => q.subType === 'Inventory'],
  [/prepaid/i, q => q.subType === 'PrepaidExpenses'],
  [/equity|capital/i, q => q.subType === 'OpeningBalanceEquity'],
  [/depreciation exp/i, q => q.subType === 'Depreciation'],
  [/purchase|material|cost of goods|cogs/i, q => q.type === 'Cost of Goods Sold'],
  [/site|job|project/i, q => /^job expenses$/i.test(q.name)],
  [/sales|revenue|receipt|income/i, q => q.subType === 'SalesOfProductIncome'],
];
export function suggestAccountMap(localAccounts, qboAccounts) {
  const map = {};
  for (const a of localAccounts) {
    const exact = qboAccounts.find(q => q.name.toLowerCase() === a.name.toLowerCase() && accountFits(a.account_type, q.type));
    const rule = SUGGEST.find(([re]) => re.test(a.name));
    const hit = exact || (rule && qboAccounts.find(q => rule[1](q) && accountFits(a.account_type, q.type)));
    if (hit) map[a.code] = hit.id;
  }
  return map;
}

// ---------- Phase 2: sending records (lib/quickbooks-sync.js) ----------
// A record is matched to what was sent by its number plus a fingerprint, so the demo's nightly reset (which
// reuses numbers for new, different documents) never shows someone else's invoice as "In QuickBooks".
export const fingerprint = (...parts) => parts.map(p => String(p ?? '')).join('|');
export const syncKey = (no, fp) => `${no}#${fp}`;
// requestid makes a retried create idempotent at Intuit (same id = same result, no duplicate). Max 50 chars.
export function requestId(realm, kind, key) {
  let h = 0;
  for (const c of `${realm}:${kind}:${key}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return `sb-${kind}-${(h >>> 0).toString(36)}-${String(key).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`.slice(0, 50);
}
const q = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export const customerQuery = name => `select * from Customer where DisplayName = '${q(name)}'`;
export const itemQuery = name => `select * from Item where Name = '${q(name)}'`;

const addr = c => {
  const a = { Line1: c.address, Line2: c.address2, City: c.city, CountrySubDivisionCode: c.state_code || c.state, PostalCode: c.pin_code, Country: c.country };
  return Object.values(a).some(Boolean) ? Object.fromEntries(Object.entries(a).filter(([, v]) => v)) : undefined;
};
export function buildCustomer(c) {
  const body = { DisplayName: c.name.slice(0, 100), CompanyName: c.name.slice(0, 100) };
  if (c.email) body.PrimaryEmailAddr = { Address: c.email };
  if (c.phone) body.PrimaryPhone = { FreeFormNumber: c.phone };
  const a = addr(c);
  if (a) { body.BillAddr = a; body.ShipAddr = a; }
  return body;
}
// Lines carry TAX/NON only: with QuickBooks' automated sales tax the company's tax is worked out by QuickBooks
// from the ship-to address, so we never send tax amounts or post to its agency accounts.
export function buildInvoice(inv, items, customer, { customerId, itemId }) {
  const body = {
    CustomerRef: { value: customerId },
    DocNumber: String(inv.invoice_no).slice(0, 21),
    TxnDate: inv.invoice_date,
    Line: items.map(it => ({
      DetailType: 'SalesItemLineDetail',
      Amount: Math.round(Number(it.amount ?? (it.qty || 0) * (it.rate || 0)) * 100) / 100,
      Description: String(it.item_description || '').slice(0, 4000),
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        ...(it.qty ? { Qty: Number(it.qty) } : {}),
        ...(it.rate != null ? { UnitPrice: Number(it.rate) } : {}),
        TaxCodeRef: { value: Number(it.gst_rate_pct) > 0 ? 'TAX' : 'NON' },
      },
    })),
  };
  if (inv.due_date) body.DueDate = inv.due_date;
  const a = addr(customer);
  if (a) body.ShipAddr = a;
  if (customer.email) body.BillEmail = { Address: customer.email };
  return body;
}
export function buildPayment(r, { customerId, invoiceId, depositAccountId }) {
  const body = {
    CustomerRef: { value: customerId },
    TotalAmt: Number(r.amount),
    TxnDate: r.receipt_date,
    PaymentRefNum: String(r.reference || r.receipt_no).slice(0, 21),
    Line: [{ Amount: Number(r.amount), LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }] }],
  };
  if (depositAccountId) body.DepositToAccountRef = { value: depositAccountId };
  return body;
}

// ---------- Phase 2b: purchase side ----------
export const vendorQuery = name => `select * from Vendor where DisplayName = '${q(name)}'`;
export function buildVendor(s) {
  const body = { DisplayName: s.name.slice(0, 100), CompanyName: s.name.slice(0, 100) };
  if (s.email) body.PrimaryEmailAddr = { Address: s.email };
  if (s.phone) body.PrimaryPhone = { FreeFormNumber: s.phone };
  if (s.address) body.BillAddr = { Line1: String(s.address).slice(0, 500) };
  return body;
}
// Bill lines post to one account (what our ledger debits: raw material inventory). Sales tax paid on a purchase
// is part of the cost in the US, so it goes as its own line on the same account; QuickBooks adds no tax to bills.
export function buildBill(bill, items, { vendorId, accountId }) {
  const line = (Amount, Description) => ({ DetailType: 'AccountBasedExpenseLineDetail', Amount: Math.round(Amount * 100) / 100, Description: String(Description || '').slice(0, 4000), AccountBasedExpenseLineDetail: { AccountRef: { value: accountId } } });
  const lines = items.map(it => line(Number(it.amount ?? (it.qty || 0) * (it.rate || 0)), it.item_description));
  if (Number(bill.tax_amount) > 0) lines.push(line(Number(bill.tax_amount), 'Sales tax paid'));
  const body = { VendorRef: { value: vendorId }, DocNumber: String(bill.bill_no).slice(0, 21), TxnDate: bill.bill_date, Line: lines };
  if (bill.due_date) body.DueDate = bill.due_date;
  return body;
}
export function buildBillPayment(p, { vendorId, billId, bankAccountId }) {
  return {
    VendorRef: { value: vendorId },
    PayType: 'Check',
    CheckPayment: { BankAccountRef: { value: bankAccountId } },
    TotalAmt: Number(p.amount),
    TxnDate: p.payment_date,
    DocNumber: String(p.reference || p.payment_no).slice(0, 21),
    Line: [{ Amount: Number(p.amount), LinkedTxn: [{ TxnId: billId, TxnType: 'Bill' }] }],
  };
}
