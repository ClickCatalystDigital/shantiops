// lib/ledger.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5. Dependency-free, same precedent as
// lib/gst-calc.mjs: real calculation logic (double-entry balance validation, per-trigger account
// mapping, trial balance/P&L/balance-sheet rollups) lives here, never inline in a route.

export const ACCOUNT_CODES = {
  BANK_CASH: '1001',
  ACCOUNTS_RECEIVABLE: '1100',
  RAW_MATERIAL_INVENTORY: '1200',
  GST_INPUT_CREDIT: '1300',
  ACCOUNTS_PAYABLE: '2100',
  GST_OUTPUT_PAYABLE: '2200',
  TDS_PAYABLE: '2300',
  PF_PAYABLE: '2400',
  ESI_PAYABLE: '2500',
  PT_PAYABLE: '2600',
  OWNERS_EQUITY: '3100',
  SALES_REVENUE: '4100',
  MATERIAL_CONSUMED: '5100',
  SALARY_EXPENSE: '5200',
};

// [code, name, account_type] — seeded once per company by lib/db.js. Kept here so the seed and the
// posting line builders below share one source of truth for what each code means. AR/AP are single
// control accounts (not per-customer/vendor — customer/vendor detail comes from querying
// journal_entry_lines by source document, not from the chart of accounts). Raw Material Inventory
// is an asset: Vendor Bills post purchases into it. Consumption (material_issues) is NOT auto-posted
// out of it — material_issues carries qty but no unit cost anywhere in the schema, so valuing
// consumption would mean inventing a costing method (FIFO/weighted-average) that doesn't exist yet.
// Material Consumed (5100) is seeded and ready for that once a real costing source exists.
export const DEFAULT_CHART_OF_ACCOUNTS = [
  [ACCOUNT_CODES.BANK_CASH, 'Bank & Cash', 'asset'],
  [ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, 'Accounts Receivable', 'asset'],
  [ACCOUNT_CODES.RAW_MATERIAL_INVENTORY, 'Raw Material Inventory', 'asset'],
  [ACCOUNT_CODES.GST_INPUT_CREDIT, 'GST Input Credit', 'asset'],
  [ACCOUNT_CODES.ACCOUNTS_PAYABLE, 'Accounts Payable', 'liability'],
  [ACCOUNT_CODES.GST_OUTPUT_PAYABLE, 'GST Output Payable', 'liability'],
  [ACCOUNT_CODES.TDS_PAYABLE, 'TDS Payable', 'liability'],
  [ACCOUNT_CODES.PF_PAYABLE, 'PF Payable', 'liability'],
  [ACCOUNT_CODES.ESI_PAYABLE, 'ESI Payable', 'liability'],
  [ACCOUNT_CODES.PT_PAYABLE, 'Professional Tax Payable', 'liability'],
  [ACCOUNT_CODES.OWNERS_EQUITY, "Owner's Equity", 'equity'],
  [ACCOUNT_CODES.SALES_REVENUE, 'Sales Revenue', 'income'],
  [ACCOUNT_CODES.MATERIAL_CONSUMED, 'Material Consumed', 'expense'],
  [ACCOUNT_CODES.SALARY_EXPENSE, 'Salary Expense', 'expense'],
];

// Debit-normal account types carry a positive balance on the debit side; credit-normal on the
// credit side. Used to render a signed "balance" column instead of raw debit/credit totals.
const DEBIT_NORMAL_TYPES = new Set(['asset', 'expense']);

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Throws if a set of {debit, credit} lines doesn't balance — the one invariant every journal entry
// must hold. Rounds to 2dp first so floating-point noise doesn't false-fail.
export function assertBalanced(lines) {
  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry not balanced: debit ${totalDebit} != credit ${totalCredit}`);
  }
  return { totalDebit, totalCredit };
}

// --- Per-trigger posting line builders ------------------------------------------------------
// Pure: {accountCode, debit, credit}[], no DB access. The route calling these attaches
// company/source_type/source_id/description and hands the lines to lib/ledger-post.js.

export function salesInvoiceLines({ subtotal, taxAmount, total }) {
  return [
    { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: round2(total), credit: 0 },
    { accountCode: ACCOUNT_CODES.SALES_REVENUE, debit: 0, credit: round2(subtotal) },
    { accountCode: ACCOUNT_CODES.GST_OUTPUT_PAYABLE, debit: 0, credit: round2(taxAmount) },
  ].filter(l => l.debit || l.credit);
}

// sales_credit_notes stores one flat `amount`, no CGST/SGST/IGST split (same boundary as the
// source document) — reverses Revenue/AR in full rather than splitting out a GST portion that
// isn't tracked anywhere on the document itself.
export function salesCreditNoteLines({ amount }) {
  return [
    { accountCode: ACCOUNT_CODES.SALES_REVENUE, debit: round2(amount), credit: 0 },
    { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: 0, credit: round2(amount) },
  ];
}

export function vendorBillLines({ subtotal, taxAmount, tdsAmount, payableAmount }) {
  const lines = [
    { accountCode: ACCOUNT_CODES.RAW_MATERIAL_INVENTORY, debit: round2(subtotal), credit: 0 },
    { accountCode: ACCOUNT_CODES.GST_INPUT_CREDIT, debit: round2(taxAmount), credit: 0 },
    { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: 0, credit: round2(payableAmount) },
  ];
  if (tdsAmount) lines.push({ accountCode: ACCOUNT_CODES.TDS_PAYABLE, debit: 0, credit: round2(tdsAmount) });
  return lines.filter(l => l.debit || l.credit);
}

export function purchaseDebitNoteLines({ amount }) {
  return [
    { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: round2(amount), credit: 0 },
    { accountCode: ACCOUNT_CODES.RAW_MATERIAL_INVENTORY, debit: 0, credit: round2(amount) },
  ];
}

// --- AR/AP settlement (Phase 5 completion) -------------------------------------------------------
// A customer receipt is cash coming in against an already-recognized Accounts Receivable balance —
// Revenue/GST were already posted at invoice issue, this only moves the balance from AR to Bank.
export function customerReceiptLines({ amount }) {
  return [
    { accountCode: ACCOUNT_CODES.BANK_CASH, debit: round2(amount), credit: 0 },
    { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: 0, credit: round2(amount) },
  ];
}
// Mirror on the purchase side — a vendor payment settles Accounts Payable, already recognized at
// Vendor Bill approval.
export function vendorPaymentLines({ amount }) {
  return [
    { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: round2(amount), credit: 0 },
    { accountCode: ACCOUNT_CODES.BANK_CASH, debit: 0, credit: round2(amount) },
  ];
}

// --- Inventory consumption (Phase 5 completion) ---------------------------------------------------
// Material Issue moves value out of Raw Material Inventory into Material Consumed, at the item's
// weighted-average cost (lib/inventory-costing.mjs) — never a second inventory debit; the asset was
// already debited once, at Vendor Bill approval.
export function materialConsumptionLines({ amount }) {
  return [
    { accountCode: ACCOUNT_CODES.MATERIAL_CONSUMED, debit: round2(amount), credit: 0 },
    { accountCode: ACCOUNT_CODES.RAW_MATERIAL_INVENTORY, debit: 0, credit: round2(amount) },
  ];
}

// --- Manual Journal Entry reversal (Phase 5 completion) --------------------------------------------
// A posted journal entry is immutable; a correction reverses it — same accounts, debit and credit
// swapped on every line. Pure transform, so the caller (lib/ledger-post.js) just re-posts the result
// as a brand-new entry linked back via reversal_of_id.
export function reversedLines(lines) {
  return lines.map(l => ({ accountCode: l.account_code || l.accountCode, debit: l.credit || 0, credit: l.debit || 0 }));
}

// Employer cost (gross + employer PF/ESI share) hits Salary Expense; net pay leaves the bank;
// every statutory deduction (employee + employer share) lands in its own payable until remitted.
export function salarySlipLines({ grossEarnings, pfEmployee, pfEmployer, esiEmployee, esiEmployer, ptAmount, tdsAmount, netPay }) {
  const expense = round2((grossEarnings || 0) + (pfEmployer || 0) + (esiEmployer || 0));
  const lines = [
    { accountCode: ACCOUNT_CODES.SALARY_EXPENSE, debit: expense, credit: 0 },
    { accountCode: ACCOUNT_CODES.BANK_CASH, debit: 0, credit: round2(netPay || 0) },
  ];
  const payable = (code, amt) => { if (amt) lines.push({ accountCode: code, debit: 0, credit: round2(amt) }); };
  payable(ACCOUNT_CODES.PF_PAYABLE, (pfEmployee || 0) + (pfEmployer || 0));
  payable(ACCOUNT_CODES.ESI_PAYABLE, (esiEmployee || 0) + (esiEmployer || 0));
  payable(ACCOUNT_CODES.PT_PAYABLE, ptAmount);
  payable(ACCOUNT_CODES.TDS_PAYABLE, tdsAmount);
  return lines.filter(l => l.debit || l.credit);
}

// --- Reports -----------------------------------------------------------------------------------
// Pure rollups over already-joined rows ({account_code, account_name, account_type, debit,
// credit} per journal_entry_line). The route does the SQL join + date-range filter and hands rows
// in — no DB access here.

export function trialBalance(rows) {
  const byAccount = new Map();
  for (const r of rows) {
    if (!byAccount.has(r.account_code)) {
      byAccount.set(r.account_code, { account_code: r.account_code, account_name: r.account_name, account_type: r.account_type, debit: 0, credit: 0 });
    }
    const acc = byAccount.get(r.account_code);
    acc.debit = round2(acc.debit + (r.debit || 0));
    acc.credit = round2(acc.credit + (r.credit || 0));
  }
  const accounts = [...byAccount.values()]
    .map(a => ({ ...a, balance: DEBIT_NORMAL_TYPES.has(a.account_type) ? round2(a.debit - a.credit) : round2(a.credit - a.debit) }))
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
  const totalDebit = round2(accounts.reduce((s, a) => s + a.debit, 0));
  const totalCredit = round2(accounts.reduce((s, a) => s + a.credit, 0));
  return { accounts, totalDebit, totalCredit };
}

export function profitAndLoss(rows) {
  const tb = trialBalance(rows);
  const income = tb.accounts.filter(a => a.account_type === 'income');
  const expense = tb.accounts.filter(a => a.account_type === 'expense');
  const totalIncome = round2(income.reduce((s, a) => s + a.balance, 0));
  const totalExpense = round2(expense.reduce((s, a) => s + a.balance, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) };
}

// Cumulative as-of-date rows in, so net profit since inception rolls into equity as (unclosed)
// retained earnings — consistent with "no automated period-close" (Phase 5 non-goal): nothing ever
// posts a closing entry, this report just derives the equity plug live every time it's requested.
export function balanceSheet(rows) {
  const tb = trialBalance(rows);
  const assets = tb.accounts.filter(a => a.account_type === 'asset');
  const liabilities = tb.accounts.filter(a => a.account_type === 'liability');
  const equity = tb.accounts.filter(a => a.account_type === 'equity');
  const { netProfit } = profitAndLoss(rows);
  const totalAssets = round2(assets.reduce((s, a) => s + a.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, a) => s + a.balance, 0));
  const totalEquity = round2(equity.reduce((s, a) => s + a.balance, 0) + netProfit);
  return { assets, liabilities, equity, netProfit, totalAssets, totalLiabilities, totalEquity };
}

// REPORT-ENGINE-PLAN.md §10 — running-balance rollup over already-fetched {ref, date, debit,
// credit, kind} rows into a running balance, same "route/data layer queries, this layer rolls up"
// split as trialBalance(). Rows strictly before `from` fund the opening balance instead of being
// dropped — a party statement needs its running balance correct from day one, not reset at the
// window. Shared by Customer Ledger, Vendor Ledger, and Cash/Bank Book — all three are literally
// the same "chronological debit/credit rows -> running balance" shape, just against a different
// party or account; a second and third caller is what earned this the generic name over
// duplicating the ~10 lines per report.
export function runningLedger(rows, { from, to } = {}) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const opening = round2(sorted.filter((r) => from && r.date < from).reduce((s, r) => s + r.debit - r.credit, 0));
  const inRange = sorted.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
  let running = opening;
  const entries = inRange.map((r) => {
    running = round2(running + r.debit - r.credit);
    return { ...r, balance: running };
  });
  return { openingBalance: opening, closingBalance: running, entries };
}

// REPORT-ENGINE-PLAN.md §10 — AR/AP Aging. Pure bucketing over already-fetched
// {ref, party, date, dueDate, amount, settled} rows (lib/data.js does the query — outstanding
// invoices/bills joined against their receipts/payments) — shared by Receivables and Payables
// Aging, same reasoning as runningLedger above: identical algorithm, just customer vs. supplier.
// Rows that have settled in full (outstanding ~0) are dropped — an aging report only lists what's
// actually still owed.
const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'];
export function agingBuckets(rows, asOf) {
  const asOfMs = new Date(asOf).getTime();
  const items = rows
    .map((r) => {
      const outstanding = round2((r.amount || 0) - (r.settled || 0));
      const dueDate = r.dueDate || r.date;
      const daysOverdue = Math.floor((asOfMs - new Date(dueDate).getTime()) / 86400000);
      const bucket = daysOverdue > 90 ? '90+' : daysOverdue > 60 ? '61-90' : daysOverdue > 30 ? '31-60' : daysOverdue > 0 ? '1-30' : 'Current';
      return { ...r, outstanding, daysOverdue, bucket };
    })
    .filter((r) => Math.abs(r.outstanding) > 0.004);
  const totals = {};
  for (const b of AGING_BUCKETS) totals[b] = round2(items.filter((i) => i.bucket === b).reduce((s, i) => s + i.outstanding, 0));
  return { asOf, items, totals, total: round2(items.reduce((s, i) => s + i.outstanding, 0)) };
}
