// lib/service-expense.mjs — pure rules for the Service department's Cash Requests and Travel
// Allowance forms (no DB, no framework — importable by the browser form and the API, so the live
// totals on screen and the authoritative ones saved on the server are the same code).
// Selfcheck: node lib/service-expense-selfcheck.mjs

export const STATUS_LABEL = {
  pending_manager: 'With Manager',
  pending_executive: 'Approved by PM · with Executive',
  with_accounts: 'Approved · with Accounts',
  settled: 'Settled',
  rejected: 'Rejected',
};

// Table name -> columns that count as "filled in" and the money column.
export const TRAVEL_TABLES = {
  travel: ['dep_date', 'dep_time', 'dep_place', 'arr_date', 'arr_time', 'arr_place', 'mode', 'class', 'amount'],
  lodging: ['date', 'amount'],
  boarding: ['date', 'place', 'amount'],
  conveyance: ['date', 'from', 'to', 'mode', 'km', 'amount'],
  other: ['date', 'type', 'particulars', 'amount'],
};

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
export const money = num;

// Rows the user actually touched (a blank starter row is dropped).
export function cleanRows(rows, cols) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => Object.fromEntries(cols.map(c => [c, c === 'amount' ? num(r?.[c]) : String(r?.[c] ?? '').trim()])))
    .filter(r => cols.some(c => (c === 'amount' ? r[c] > 0 : r[c] !== '')));
}

export const sumRows = rows => Math.round((rows || []).reduce((s, r) => s + num(r.amount), 0) * 100) / 100;

// Tour Summary (the last table of the paper form). Generated, never typed.
export function tourSummary(d, advance = 0) {
  const lines = [
    ['Travel Account', sumRows(d.travel)],
    ['Lodging', sumRows(d.lodging)],
    ['TA / DA Journey Allowance', sumRows(d.boarding)],
    ['Conveyance', sumRows(d.conveyance)],
    ['Other Expenses', sumRows(d.other)],
  ];
  const total = Math.round(lines.reduce((s, [, a]) => s + a, 0) * 100) / 100;
  const adv = num(advance);
  return { lines, total, advance: adv, balance: Math.round((total - adv) * 100) / 100 };
}

// Indian number system, rupees + paise: 1,25,000 -> "Rupees One Lakh Twenty Five Thousand Only".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = n => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = n => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${below100(n % 100)}`;
export function amountInWords(amount) {
  const a = num(amount);
  if (!a) return '';
  const rupees = Math.floor(a);
  const paise = Math.round((a - rupees) * 100);
  const parts = [];
  const crore = Math.floor(rupees / 10000000), lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000), rest = rupees % 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  const r = parts.join(' ') || 'Zero';
  return `Rupees ${r}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
}

// Customer chips: [{type:'db'|'other', id?, name}] — trimmed, deduped (case-insensitive), db ids numeric.
export function cleanCustomers(list) {
  const seen = new Set(), out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const name = String(c?.name ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(c.type === 'db' && Number(c.id) ? { type: 'db', id: Number(c.id), name } : { type: 'other', name });
  }
  return out;
}

const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

// Validate + normalise a submitted form. Returns { error } or { data, amount, customers }.
export function normalizeRequest(kind, body) {
  const date = isoDate(body.date);
  if (!date) return { error: 'Date is required' };
  if (kind === 'cash') {
    const amount = num(body.amount);
    const purpose = String(body.purpose || '').trim();
    const customers = cleanCustomers(body.customers);
    if (!amount) return { error: 'Amount is required' };
    if (!purpose) return { error: 'Purpose is required' };
    if (!customers.length) return { error: 'Add at least one customer' };
    return { data: { date, amount, purpose }, amount, customers };
  }
  if (kind === 'travel') {
    const purpose = String(body.purpose || '').trim();
    const customers = cleanCustomers([body.place]);
    if (!purpose) return { error: 'Purpose of visit is required' };
    if (!customers.length) return { error: 'Place of visit (customer) is required' };
    const data = { date, purpose, place: customers[0], chargeable: body.chargeable === 'no' ? 'no' : 'yes',
      party_name: String(body.party_name || customers[0].name).trim(), remarks: String(body.remarks || '').trim() };
    for (const [t, cols] of Object.entries(TRAVEL_TABLES)) data[t] = cleanRows(body[t], cols);
    const total = tourSummary(data).total;
    if (!total) return { error: 'Fill in at least one expense row' };
    return { data, amount: total, customers };
  }
  return { error: 'Unknown request type' };
}

// Cash requests that can fund a travel claim for `customerKey` (lowercased name): approved, not yet
// linked, naming that customer. `shared` = the other customers on the same request.
export function eligibleAdvances(cashRows, customerName) {
  const key = String(customerName || '').trim().toLowerCase();
  if (!key) return [];
  return cashRows
    .filter(r => ['with_accounts', 'settled'].includes(r.status) && !r.used_by)
    .filter(r => (r.customers || []).some(c => c.name.toLowerCase() === key))
    .map(r => ({ id: r.id, req_no: r.req_no, amount: r.amount, purpose: r.purpose,
      shared: r.customers.filter(c => c.name.toLowerCase() !== key).map(c => c.name) }));
}
