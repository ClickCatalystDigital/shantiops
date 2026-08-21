'use client';

// components/AccountsWorkspace.jsx — Accounts' own workspace, same shared-sidebar shape as
// HrWorkspace/PayrollWorkspace. Phase 0 (ACCOUNTING-IMPLEMENTATION-PLAN.md) only needs Company
// Settings; later phases add tabs here (GST/TDS masters in Phase 1, Sales Invoice in Phase 2, ...).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LandmarkIcon, Building2Icon, PlusIcon, PercentIcon, ReceiptIcon, BookIcon, FileTextIcon, CheckIcon, XIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import TrialBalanceCard, { AccountRow, fmt } from '@/components/reports/TrialBalanceCard';
import ProfitLossCard from '@/components/reports/ProfitLossCard';
import BalanceSheetCard from '@/components/reports/BalanceSheetCard';

const FIELDS = [
  ['gstin', 'GSTIN'], ['pan', 'PAN'], ['state', 'State'], ['state_code', 'State code'],
  ['invoice_prefix', 'Invoice series prefix'], ['registered_address', 'Registered address'],
];

function CompanyCard({ company, router }) {
  const [values, setValues] = useState(company);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setValues({ ...values, [k]: v });
  const isPlaceholder = !values.gstin && !values.pan;

  async function save() {
    setSaving(true);
    try {
      await api('/api/company-settings', { method: 'PATCH', body: values });
      showToast('Company settings updated');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2Icon className="size-4" />{values.legal_name}</CardTitle>
        <CardAction><Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {isPlaceholder && (
          <p className="col-span-full rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
            GSTIN/PAN/address not confirmed yet — placeholder row. Fill these in before this entity's
            documents are used for real filing.
          </p>
        )}
        {FIELDS.map(([key, label]) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label}</Label>
            <Input value={values[key] ?? ''} onChange={e => set(key, e.target.value)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsTab({ companies, router }) {
  return (
    <div className="flex flex-col gap-4">
      {companies.map(c => <CompanyCard key={c.id} company={c} router={router} />)}
    </div>
  );
}

function GstRatesCard({ gstRates, router }) {
  const [hsnCode, setHsnCode] = useState('');
  const [description, setDescription] = useState('');
  const [ratePct, setRatePct] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!hsnCode || ratePct === '' || !effectiveFrom) return;
    setSaving(true);
    try {
      await api('/api/gst-rates', { method: 'POST', body: { hsn_code: hsnCode, description, rate_pct: Number(ratePct), effective_from: effectiveFrom } });
      setHsnCode(''); setDescription(''); setRatePct(''); setEffectiveFrom('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><PercentIcon className="size-4" />GST Rates</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">HSN → rate lookup. No rows means every document still falls back to its own hand-typed flat %.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="HSN code" value={hsnCode} onChange={e => setHsnCode(e.target.value)} className="sm:w-28" />
          <Input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
          <Input type="number" placeholder="Rate %" value={ratePct} onChange={e => setRatePct(e.target.value)} className="sm:w-24" />
          <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="sm:w-40" />
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {gstRates.map(r => (
            <div key={r.id} className="flex justify-between py-2 text-sm">
              <span>{r.hsn_code}{r.description ? ` — ${r.description}` : ''} <span className="text-muted-foreground">from {r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ''}</span></span>
              <span className="tnum font-medium">{r.rate_pct}%</span>
            </div>
          ))}
          {!gstRates.length && <p className="py-2 text-sm text-muted-foreground">No rates added yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function TdsRatesCard({ tdsRates, router }) {
  const [section, setSection] = useState('');
  const [description, setDescription] = useState('');
  const [ratePct, setRatePct] = useState('');
  const [threshold, setThreshold] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!section || ratePct === '' || !effectiveFrom) return;
    setSaving(true);
    try {
      await api('/api/vendor-tds-rates', {
        method: 'POST',
        body: { section, description, rate_pct: Number(ratePct), threshold_amount: threshold === '' ? null : Number(threshold), effective_from: effectiveFrom },
      });
      setSection(''); setDescription(''); setRatePct(''); setThreshold(''); setEffectiveFrom('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ReceiptIcon className="size-4" />Vendor TDS Rates</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Flat section rate per bill — no per-vendor cumulative threshold tracking yet (that needs Vendor Bills to exist first, Phase 3).</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Section (194C)" value={section} onChange={e => setSection(e.target.value)} className="sm:w-28" />
          <Input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
          <Input type="number" placeholder="Rate %" value={ratePct} onChange={e => setRatePct(e.target.value)} className="sm:w-24" />
          <Input type="number" placeholder="Threshold" value={threshold} onChange={e => setThreshold(e.target.value)} className="sm:w-28" />
          <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="sm:w-40" />
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {tdsRates.map(r => (
            <div key={r.id} className="flex justify-between py-2 text-sm">
              <span>{r.section}{r.description ? ` — ${r.description}` : ''} <span className="text-muted-foreground">from {r.effective_from}{r.threshold_amount ? `, threshold ${fmt(r.threshold_amount)}` : ''}</span></span>
              <span className="tnum font-medium">{r.rate_pct}%</span>
            </div>
          ))}
          {!tdsRates.length && <p className="py-2 text-sm text-muted-foreground">No rates added yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RatesTab({ gstRates, tdsRates, router }) {
  return (
    <div className="flex flex-col gap-4">
      <GstRatesCard gstRates={gstRates} router={router} />
      <TdsRatesCard tdsRates={tdsRates} router={router} />
    </div>
  );
}

function ChartOfAccountsCard({ company }) {
  const [accounts, setAccounts] = useState([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('asset');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setAccounts(await api(`/api/chart-of-accounts?company=${encodeURIComponent(company)}`)); }
    catch (err) { showToast(err.message, 'error'); }
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!code || !name) return;
    setSaving(true);
    try {
      await api('/api/chart-of-accounts', { method: 'POST', body: { company, code, name, account_type: accountType } });
      setCode(''); setName('');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Chart of Accounts</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Code" value={code} onChange={e => setCode(e.target.value)} className="sm:w-24" />
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <select className="rounded-md border bg-background px-2 text-sm sm:w-32" value={accountType} onChange={e => setAccountType(e.target.value)}>
            {['asset', 'liability', 'equity', 'income', 'expense'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {accounts.map(a => (
            <div key={a.id} className="flex justify-between py-1.5 text-sm">
              <span className="tnum text-muted-foreground">{a.code}</span>
              <span className="flex-1 px-2">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.account_type}</span>
            </div>
          ))}
          {!accounts.length && <p className="py-2 text-sm text-muted-foreground">No accounts.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Manual Journal Entry: draft -> post, immutable once posted, corrections via reversal --------

function JournalEntryLineRow({ line, accounts, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <select className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={line.accountCode} onChange={e => onChange({ ...line, accountCode: e.target.value })}>
        <option value="">Account…</option>
        {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
      </select>
      <Input type="number" placeholder="Debit" value={line.debit} onChange={e => onChange({ ...line, debit: e.target.value, credit: e.target.value ? '' : line.credit })} className="w-28" />
      <Input type="number" placeholder="Credit" value={line.credit} onChange={e => onChange({ ...line, credit: e.target.value, debit: e.target.value ? '' : line.debit })} className="w-28" />
      <Button size="icon-sm" variant="ghost" onClick={onRemove}><XIcon className="size-3" /></Button>
    </div>
  );
}

function NewJournalEntryDialog({ company, accounts, onCreated }) {
  const [open, setOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(currentPeriod() + '-01');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }]);
  const [saving, setSaving] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  async function save() {
    setSaving(true);
    try {
      await api('/api/journal-entries', { method: 'POST', body: { company, entry_date: entryDate, description, lines } });
      showToast('Journal entry saved as draft');
      setOpen(false);
      setDescription('');
      setLines([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }]);
      onCreated();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><PlusIcon /> New Journal Entry</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>New Manual Journal Entry (draft)</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className="w-40" />
              <Input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              {lines.map((l, i) => (
                <JournalEntryLineRow key={i} line={l} accounts={accounts}
                  onChange={nl => setLines(lines.map((x, j) => j === i ? nl : x))}
                  onRemove={() => setLines(lines.filter((_, j) => j !== i))} />
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, { accountCode: '', debit: '', credit: '' }])}>
              <PlusIcon /> Add line
            </Button>
            <div className={`flex justify-between text-sm font-medium ${balanced ? '' : 'text-danger'}`}>
              <span>Debit {fmt(totalDebit)} / Credit {fmt(totalCredit)}</span>
              {!balanced && <span>Must balance</span>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!balanced || saving} onClick={save}>{saving ? 'Saving…' : 'Save draft'}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManualJournalCard({ company }) {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const load = useCallback(() => {
    api(`/api/journal-entries?company=${encodeURIComponent(company)}&source_type=manual`).then(setEntries).catch(err => showToast(err.message, 'error'));
    api(`/api/chart-of-accounts?company=${encodeURIComponent(company)}`).then(setAccounts).catch(() => {});
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function post(id) {
    try { await api(`/api/journal-entries/${id}`, { method: 'PATCH', body: { action: 'post' } }); load(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function reverse(id) {
    try { await api(`/api/journal-entries/${id}/reverse`, { method: 'POST' }); showToast('Reversal posted'); load(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function del(id) {
    try { await api(`/api/journal-entries/${id}`, { method: 'DELETE' }); load(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Journal Entries</CardTitle>
        <CardAction><NewJournalEntryDialog company={company} accounts={accounts} onCreated={load} /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {entries.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="truncate">
              JE #{e.source_id} — {e.description || '—'} <span className="text-muted-foreground">{e.entry_date}</span>
              {e.reversal_of_id && <span className="ml-2 text-xs text-muted-foreground">(reversal)</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{e.status}</span>
              {e.status === 'draft' && <Button size="sm" variant="outline" onClick={() => post(e.id)}>Post</Button>}
              {e.status === 'draft' && <Button size="icon-sm" variant="ghost" onClick={() => del(e.id)}><XIcon className="size-3" /></Button>}
              {e.status === 'posted' && <Button size="sm" variant="outline" onClick={() => reverse(e.id)}>Reverse</Button>}
            </span>
          </div>
        ))}
        {!entries.length && <p className="py-2 text-sm text-muted-foreground">No manual journal entries yet.</p>}
      </CardContent>
    </Card>
  );
}

// --- AR/AP settlement — customer receipts against Sales Invoices, vendor payments against Vendor
// Bills. Lightweight Accounts-side UI (pick from the existing invoice/bill list) rather than new
// surface on SalesWorkspace/ProcurementWorkspace.

function ReceiptsPaymentsCard({ company }) {
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [receiptAmount, setReceiptAmount] = useState('');
  const [billId, setBillId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api('/api/sales-invoices').then(all => setInvoices(all.filter(i => i.company === company && ['issued', 'paid'].includes(i.status)))).catch(() => {});
    api('/api/vendor-bills').then(all => setBills(all.filter(b => b.company === company && ['approved', 'paid'].includes(b.status)))).catch(() => {});
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function recordReceipt() {
    if (!invoiceId || !receiptAmount) return;
    setSaving(true);
    try {
      const res = await api(`/api/sales-invoices/${invoiceId}/receipts`, { method: 'POST', body: { amount: Number(receiptAmount) } });
      showToast(`Receipt recorded — balance due ₹${fmt(res.balance_due)}`);
      setInvoiceId(''); setReceiptAmount(''); load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  async function recordPayment() {
    if (!billId || !paymentAmount) return;
    setSaving(true);
    try {
      const res = await api(`/api/vendor-bills/${billId}/payments`, { method: 'POST', body: { amount: Number(paymentAmount) } });
      showToast(`Payment recorded — balance due ₹${fmt(res.balance_due)}`);
      setBillId(''); setPaymentAmount(''); load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>AR / AP settlement</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={invoiceId} onChange={e => setInvoiceId(e.target.value)}>
            <option value="">Record receipt against invoice…</option>
            {invoices.map(i => <option key={i.id} value={i.id}>{i.invoice_no} — {i.customer_name} — {fmt(i.total)}</option>)}
          </select>
          <Input type="number" placeholder="Amount" value={receiptAmount} onChange={e => setReceiptAmount(e.target.value)} className="sm:w-32" />
          <Button size="sm" onClick={recordReceipt} disabled={saving}>Receive</Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={billId} onChange={e => setBillId(e.target.value)}>
            <option value="">Record payment against bill…</option>
            {bills.map(b => <option key={b.id} value={b.id}>{b.bill_no} — {b.supplier_name} — {fmt(b.payable_amount)}</option>)}
          </select>
          <Input type="number" placeholder="Amount" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="sm:w-32" />
          <Button size="sm" onClick={recordPayment} disabled={saving}>Pay</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LedgerTab({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {companies.map(c => (
          <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
            {c.legal_name}
          </Button>
        ))}
      </div>
      {company && (
        <>
          <ChartOfAccountsCard company={company} />
          <ManualJournalCard company={company} />
          <ReceiptsPaymentsCard company={company} />
          <TrialBalanceCard company={company} />
          <ProfitLossCard company={company} />
          <BalanceSheetCard company={company} />
        </>
      )}
    </div>
  );
}

// --- Bank reconciliation: manual tick-off of Bank & Cash ledger lines against the real statement -

function BankReconciliationTab({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api(`/api/reports/bank-reconciliation?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function toggle(line) {
    try {
      await api(`/api/journal-entry-lines/${line.id}/reconcile`, { method: 'PATCH', body: { reconciled: !line.reconciled } });
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {companies.map(c => (
          <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
            {c.legal_name}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Bank & Cash reconciliation</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Tick each line off against the real bank statement. No statement import — this is the
            manual reconciliation workflow, not a bank-account master.
          </p>
          {data && (
            <>
              <div className="flex justify-between text-sm font-medium">
                <span>Reconciled balance</span><span className="tnum">{fmt(data.reconciledBalance)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span>Unreconciled balance</span><span className="tnum">{fmt(data.unreconciledBalance)}</span>
              </div>
              <div className="flex flex-col divide-y">
                {data.lines.map(l => (
                  <label key={l.id} className="flex cursor-pointer items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <input type="checkbox" checked={!!l.reconciled} onChange={() => toggle(l)} />
                      {l.entry_date} — {l.description || l.source_type}
                    </span>
                    <span className="tnum shrink-0">{l.debit ? `+${fmt(l.debit)}` : `-${fmt(l.credit)}`}</span>
                  </label>
                ))}
                {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No Bank & Cash postings yet.</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- GST Returns (current model: GSTR-1/1A/IFF outward, GSTR-2B/IMS-based ITC reconciliation
// inward, both feeding GSTR-3B — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, 2026-08-20
// terminology pass. Not the old GSTR-1/2/3 model.) ---------------------------------------------

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

function GstFilingButton({ company, period, returnType, label }) {
  const [saving, setSaving] = useState(false);
  async function markFiled() {
    setSaving(true);
    try {
      await api('/api/gst-filings', { method: 'POST', body: { company, period, return_type: returnType } });
      showToast(`${label} marked filed for ${period}`);
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return <Button size="sm" variant="outline" onClick={markFiled} disabled={saving}>{saving ? 'Saving…' : `Mark ${label} filed`}</Button>;
}

function Gstr1Card({ company, period }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api(`/api/reports/gstr1?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>GSTR-1 / IFF — outward supplies</CardTitle>
        <CardAction className="flex gap-2">
          <GstFilingButton company={company} period={period} returnType="GSTR1" label="GSTR-1" />
          <GstFilingButton company={company} period={period} returnType="IFF" label="IFF" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          IFF is the same data as GSTR-1, filed monthly instead of quarterly under QRMP — pick
          whichever your company actually files this period.
        </p>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">B2B summary (by customer GSTIN)</p>
          {data.b2b.map(g => (
            <div key={g.customer_gstin || g.customer_name} className="flex justify-between py-1 text-sm">
              <span>{g.customer_name} <span className="text-muted-foreground">({g.customer_gstin || 'no GSTIN'}) · {g.invoice_count} inv.</span></span>
              <span className="tnum">{fmt(g.taxable)} + {fmt(g.cgst + g.sgst + g.igst)} tax</span>
            </div>
          ))}
          {!data.b2b.length && <p className="py-2 text-sm text-muted-foreground">No issued/paid invoices this period.</p>}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">HSN summary</p>
          {data.hsn.map(h => (
            <div key={h.hsn_code || 'unspecified'} className="flex justify-between py-1 text-sm">
              <span>{h.hsn_code || 'Unspecified'} <span className="text-muted-foreground">qty {fmt(h.qty)}</span></span>
              <span className="tnum">{fmt(h.taxable)} + {fmt(h.cgst + h.sgst + h.igst)} tax</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total taxable / tax</span>
          <span className="tnum">{fmt(data.totalTaxable)} / {fmt(data.totalTax)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Gstr2bUpload({ company, period, onDone }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('company', company); fd.append('period', period);
      const { preview } = await api('/api/gstr2b/upload', { method: 'POST', body: fd });
      setPreview(preview);
    } catch (err) { showToast(err.message, 'error'); setFile(null); }
    setBusy(false);
    e.target.value = '';
  }

  async function confirm() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('company', company); fd.append('period', period); fd.append('confirm', '1');
      const res = await api('/api/gstr2b/upload', { method: 'POST', body: fd });
      showToast(`Imported ${res.inserted} GSTR-2B lines${res.skipped ? ` (${res.skipped} rows skipped)` : ''}`);
      setPreview(null); setFile(null);
      onDone();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  const replacing = preview?.existingUploadRows > 0;
  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={pick} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy && !preview ? 'Reading…' : 'Upload GSTR-2B (portal export)'}
      </Button>
      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>GSTR-2B preview — {preview?.filename}</DialogTitle></DialogHeader>
          {preview && (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                {preview.totalRows} B2B lines detected (sheet "{preview.sheetName}")
                {preview.totalSkipped > 0 && <> · <span className="text-warning font-medium">{preview.totalSkipped} rows skipped</span></>}
              </p>
              {replacing && (
                <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
                  This will replace the {preview.existingUploadRows} previously uploaded lines for {period} (manual lines are untouched).
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button disabled={busy} onClick={confirm}>{busy ? 'Importing…' : `Import ${preview.totalRows} lines`}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Gstr2bManualAddRow({ company, period, onAdded }) {
  const [gstin, setGstin] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [taxableValue, setTaxableValue] = useState('');
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!invoiceNo) return;
    setSaving(true);
    try {
      await api('/api/gstr2b', {
        method: 'POST',
        body: {
          company, period, supplier_gstin: gstin || null, invoice_no: invoiceNo,
          taxable_value: Number(taxableValue) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0, igst: Number(igst) || 0,
          itc_availability: 'Yes',
        },
      });
      setGstin(''); setInvoiceNo(''); setTaxableValue(''); setCgst(''); setSgst(''); setIgst('');
      onAdded();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input placeholder="Supplier GSTIN" value={gstin} onChange={e => setGstin(e.target.value)} className="sm:w-40" />
      <Input placeholder="Invoice no." value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} className="sm:w-32" />
      <Input type="number" placeholder="Taxable" value={taxableValue} onChange={e => setTaxableValue(e.target.value)} className="sm:w-24" />
      <Input type="number" placeholder="CGST" value={cgst} onChange={e => setCgst(e.target.value)} className="sm:w-20" />
      <Input type="number" placeholder="SGST" value={sgst} onChange={e => setSgst(e.target.value)} className="sm:w-20" />
      <Input type="number" placeholder="IGST" value={igst} onChange={e => setIgst(e.target.value)} className="sm:w-20" />
      <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
    </div>
  );
}

function Gstr2bCard({ company, period }) {
  const [lines, setLines] = useState([]);
  const load = useCallback(() => {
    api(`/api/gstr2b?company=${encodeURIComponent(company)}&period=${period}`).then(setLines).catch(err => showToast(err.message, 'error'));
  }, [company, period]);
  useEffect(() => { load(); }, [load]);

  async function action(id, ims_status) {
    try { await api(`/api/gstr2b/${id}`, { method: 'PATCH', body: { ims_status } }); load(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GSTR-2B — inward ITC statement</CardTitle>
        <CardAction><Gstr2bUpload company={company} period={period} onDone={load} /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Uploaded from the GST portal's own GSTR-2B download — external reconciliation evidence,
          not a replacement for the company's own Vendor Bills. Accept/reject each line here (IMS);
          an untouched "pending" line is deemed accepted on the portal before the GSTR-3B due date.
        </p>
        <Gstr2bManualAddRow company={company} period={period} onAdded={load} />
        <div className="flex flex-col divide-y">
          {lines.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="truncate">
                {l.supplier_name || l.supplier_gstin || '—'} <span className="text-muted-foreground">{l.invoice_no}</span>
                {l.itc_availability === 'No' && <span className="ml-2 text-xs text-danger">ITC not available{l.itc_reason ? `: ${l.itc_reason}` : ''}</span>}
              </span>
              <span className="tnum shrink-0">{fmt(l.taxable_value)} + {fmt((l.igst || 0) + (l.cgst || 0) + (l.sgst || 0))}</span>
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{l.ims_status}{l.source === 'manual' ? ' · manual' : ''}</span>
              <span className="flex shrink-0 gap-1">
                <Button size="icon-sm" variant="outline" onClick={() => action(l.id, 'accepted')} title="Accept"><CheckIcon className="size-3" /></Button>
                <Button size="icon-sm" variant="outline" onClick={() => action(l.id, 'rejected')} title="Reject"><XIcon className="size-3" /></Button>
              </span>
            </div>
          ))}
          {!lines.length && <p className="py-2 text-sm text-muted-foreground">No GSTR-2B lines for this period yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ItcReconciliationCard({ company, period }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/itc-reconciliation?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>ITC reconciliation</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between"><span>GSTR-2B lines matched to a Vendor Bill</span><span className="tnum">{data.matchedCount} / {data.lines.length}</span></div>
        <div className="flex justify-between"><span>Eligible ITC</span><span className="tnum font-medium">{fmt(data.eligibleItc)}</span></div>
        <div className="flex justify-between"><span>Excluded (not available / rejected)</span><span className="tnum">{fmt(data.excludedItc)}</span></div>
        {data.unmatchedVendorBills.length > 0 && (
          <div className="mt-2 rounded-md border border-warning/20 bg-warning/10 p-2 text-xs text-warning">
            {data.unmatchedVendorBills.length} Vendor Bill(s) this period have no matching GSTR-2B line yet: {data.unmatchedVendorBills.map(b => b.bill_no).join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Gstr3bCard({ company, period }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/gstr3b?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>GSTR-3B</CardTitle>
        <CardAction><GstFilingButton company={company} period={period} returnType="GSTR3B" label="GSTR-3B" /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between"><span>Outward tax (GSTR-1)</span><span className="tnum">{fmt(data.outwardTax)}</span></div>
        <div className="flex justify-between"><span>Eligible ITC</span><span className="tnum">{fmt(data.eligibleItc)}</span></div>
        <div className="flex justify-between border-t pt-2 font-medium">
          <span>{data.netPayable > 0 ? 'Net payable' : 'ITC carried forward'}</span>
          <span className="tnum">{fmt(data.netPayable > 0 ? data.netPayable : data.itcCarriedForward)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function GstReturnsTab({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [period, setPeriod] = useState(currentPeriod());
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {companies.map(c => (
          <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
            {c.legal_name}
          </Button>
        ))}
        <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40" />
      </div>
      {company && period && (
        <>
          <Gstr1Card company={company} period={period} />
          <Gstr2bCard company={company} period={period} />
          <ItcReconciliationCard company={company} period={period} />
          <Gstr3bCard company={company} period={period} />
        </>
      )}
    </div>
  );
}

export default function AccountsWorkspace({ companies, gstRates = [], tdsRates = [], nested = false }) {
  const router = useRouter();
  const [tab, setTab] = useState('settings');
  const navItems = [
    { key: 'settings', label: 'Company Settings', icon: LandmarkIcon },
    { key: 'rates', label: 'GST & TDS Rates', icon: PercentIcon },
    { key: 'ledger', label: 'General Ledger', icon: BookIcon },
    { key: 'gst-returns', label: 'GST Returns', icon: FileTextIcon },
    { key: 'bank-reconciliation', label: 'Bank Reconciliation', icon: LandmarkIcon },
  ];

  return (
    <WorkspaceSidebar title="Accounts" icon={LandmarkIcon} items={navItems} activeKey={tab} onChange={setTab} nested={nested}>
      {tab === 'settings' && <SettingsTab companies={companies} router={router} />}
      {tab === 'rates' && <RatesTab gstRates={gstRates} tdsRates={tdsRates} router={router} />}
      {tab === 'ledger' && <LedgerTab companies={companies} />}
      {tab === 'gst-returns' && <GstReturnsTab companies={companies} />}
      {tab === 'bank-reconciliation' && <BankReconciliationTab companies={companies} />}
    </WorkspaceSidebar>
  );
}
