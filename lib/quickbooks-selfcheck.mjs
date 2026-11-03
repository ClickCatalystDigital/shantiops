// node lib/quickbooks-selfcheck.mjs
import assert from 'node:assert/strict';
import { authorizeUrl, tokenTimes, needsRefresh, checkState, normalizeAccounts, accountFits, cleanAccountMap, QBO_SCOPE } from './quickbooks.mjs';

const u = new URL(authorizeUrl({ clientId: 'abc', redirectUri: 'http://localhost:3000/api/quickbooks/callback', state: 's1' }));
assert.equal(u.origin + u.pathname, 'https://appcenter.intuit.com/connect/oauth2');
assert.equal(u.searchParams.get('scope'), QBO_SCOPE);
assert.equal(u.searchParams.get('response_type'), 'code');
assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:3000/api/quickbooks/callback');

const now = Date.UTC(2026, 10, 3);
const t = tokenTimes({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8726400 }, now);
assert.equal(t.access_expires_at, new Date(now + 3600e3).toISOString());
assert.equal(t.refresh_expires_at, new Date(now + 8726400e3).toISOString());
assert.throws(() => tokenTimes({ access_token: 'a', expires_in: 3600 }, now));

assert.equal(needsRefresh({ access_expires_at: new Date(now + 60e3).toISOString() }, now), true);
assert.equal(needsRefresh({ access_expires_at: new Date(now + 30 * 60e3).toISOString() }, now), false);
assert.equal(needsRefresh({}, now), true);

const cookie = { state: 's1', userId: 7, exp: now + 1000 };
assert.equal(checkState({ cookie, state: 's1', userId: 7, now }), null);
assert.match(checkState({ cookie, state: 'x', userId: 7, now }), /did not match/);
assert.match(checkState({ cookie, state: 's1', userId: 8, now }), /signed in/);
assert.match(checkState({ cookie, state: 's1', userId: 7, now: now + 2000 }), /expired/);
assert.match(checkState({ cookie: null, state: 's1', userId: 7, now }), /expired/);

const accts = normalizeAccounts({ QueryResponse: { Account: [
  { Id: 2, Name: 'Sales', AccountType: 'Income', Active: true },
  { Id: 1, Name: 'Checking', AccountType: 'Bank' },
  { Id: 3, Name: 'Old', AccountType: 'Bank', Active: false },
] } });
assert.deepEqual(accts.map(a => a.id), ['1', '2']);
assert.equal(accountFits('asset', 'Bank'), true);
assert.equal(accountFits('income', 'Bank'), false);

assert.deepEqual(cleanAccountMap({ 1001: '1', 4100: '' }, ['1001', '4100'], ['1', '2']).rows,
  [{ code: '1001', qbo_account_id: '1' }, { code: '4100', qbo_account_id: null }]);
assert.match(cleanAccountMap({ 9999: '1' }, ['1001'], ['1']).error, /Unknown/);
assert.match(cleanAccountMap({ 1001: '99' }, ['1001'], ['1']).error, /not found/);
assert.match(cleanAccountMap([], ['1001'], ['1']).error, /mapping/);

console.log('quickbooks selfcheck ok');

const { suggestAccountMap } = await import('./quickbooks.mjs');
const qbo = [
  { id: '35', name: 'Checking', type: 'Bank', subType: 'Checking' },
  { id: '84', name: 'Accounts Receivable (A/R)', type: 'Accounts Receivable' },
  { id: '33', name: 'Accounts Payable (A/P)', type: 'Accounts Payable' },
  { id: '79', name: 'Sales of Product Income', type: 'Income', subType: 'SalesOfProductIncome' },
  { id: '80', name: 'Cost of Goods Sold', type: 'Cost of Goods Sold' },
  { id: '58', name: 'Job Expenses', type: 'Expense' },
  { id: '8', name: 'Bank Charges', type: 'Expense', subType: 'BankCharges' },
  { id: '89', name: 'Board of Equalization Payable', type: 'Other Current Liability', subType: 'GlobalTaxPayable' },
];
assert.deepEqual(suggestAccountMap([
  { code: 'bank', name: 'Bank', account_type: 'asset' },
  { code: 'ar', name: 'Accounts receivable', account_type: 'asset' },
  { code: 'ap', name: 'Accounts payable', account_type: 'liability' },
  { code: 'tax', name: 'Sales Tax Payable', account_type: 'liability' },
  { code: 'sales', name: 'Pay application receipts', account_type: 'income' },
  { code: 'buy', name: 'Purchases', account_type: 'expense' },
  { code: 'site', name: 'Site expenses', account_type: 'expense' },
  { code: 'fee', name: 'Bank Charges', account_type: 'expense' },
], qbo), { bank: '35', ar: '84', ap: '33', sales: '79', buy: '80', site: '58', fee: '8' });
console.log('quickbooks suggestions ok');

const m = await import('./quickbooks.mjs');
assert.equal(m.customerQuery("O'Neil Boilers"), "select * from Customer where DisplayName = 'O\\'Neil Boilers'");
const rid = m.requestId('9341', 'invoice', 'AB/25-26/0001#x');
assert.ok(rid.length <= 50 && rid === m.requestId('9341', 'invoice', 'AB/25-26/0001#x') && rid !== m.requestId('9341', 'invoice', 'AB/25-26/0002#x'));
const cust = { name: 'Greenfield Foods', email: 'ap@greenfield.test', city: 'Dayton', state_code: 'OH', pin_code: '45402', country: 'US', address: '1 Main St' };
assert.deepEqual(m.buildCustomer(cust).BillAddr, { Line1: '1 Main St', City: 'Dayton', CountrySubDivisionCode: 'OH', PostalCode: '45402', Country: 'US' });
const inv = m.buildInvoice({ invoice_no: 'AB-0001', invoice_date: '2026-11-03', due_date: '2026-12-03' },
  [{ item_description: 'Boiler', qty: 1, rate: 1000, amount: 1000, gst_rate_pct: 7.25 }, { item_description: 'Freight', qty: 1, rate: 50, amount: 50, gst_rate_pct: 0 }],
  cust, { customerId: '58', itemId: '19' });
assert.deepEqual(inv.Line.map(l => [l.Amount, l.SalesItemLineDetail.TaxCodeRef.value]), [[1000, 'TAX'], [50, 'NON']]);
assert.equal(inv.CustomerRef.value, '58');
assert.equal(inv.ShipAddr.CountrySubDivisionCode, 'OH');
const pay = m.buildPayment({ amount: 500, receipt_date: '2026-11-04', receipt_no: 'AB/RCT/1' }, { customerId: '58', invoiceId: '130', depositAccountId: '35' });
assert.deepEqual(pay.Line[0].LinkedTxn, [{ TxnId: '130', TxnType: 'Invoice' }]);
assert.equal(pay.DepositToAccountRef.value, '35');
console.log('quickbooks phase 2 builders ok');
