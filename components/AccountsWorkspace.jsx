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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LandmarkIcon, Building2Icon, PlusIcon, PercentIcon, ReceiptIcon, BookIcon, FileTextIcon, CheckIcon, XIcon, LockIcon, HistoryIcon, BoxIcon, RefreshCwIcon, IdCardIcon } from 'lucide-react';
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

// --- Company Entities (2026-08-22) — statutory/registration profile per legal entity. Extends
// (doesn't replace) the plain "Company Settings" tab above: same underlying company_settings row
// and PATCH route, now with per-field provenance (Sandbox-fetched vs manually corrected) and a
// GST refresh flow that can never silently overwrite a manual correction — the diff/confirm dialog
// below is the enforcement point (lib/company-entity.mjs's diffCompanyEntity(), same two-phase
// shape as Bank Reconciliation's Import Statement). PF/ESI/PT applicability stays computed here in
// Shanti Ops (lib/company-entity.mjs's computeApplicability()), never fetched, never delegated to
// statutory-rates-hub — company-specific facts belong with the company entity, not the national
// rate registry. --------------------------------------------------------------------------------

function ProvenanceTag({ source, updatedAt }) {
  if (!source) return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Not set</span>;
  const label = source === 'sandbox' ? 'Sandbox' : 'Manual';
  const date = updatedAt ? new Date(updatedAt).toLocaleDateString('en-IN') : null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${source === 'sandbox' ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'}`}>
      {label}{date ? ` · ${date}` : ''}
    </span>
  );
}

const GST_FIELD_LABELS = {
  legal_name: 'Legal Name', gstin: 'GSTIN', state: 'State', pan: 'PAN', trade_name: 'Trade Name',
  gst_status: 'GST Status', gst_taxpayer_type: 'Taxpayer Type', gst_registration_date: 'Registration Date', gst_constitution: 'Constitution',
};

function GstinRefreshDialog({ entity, onApplied }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState(null);
  const [selected, setSelected] = useState({});

  async function start() {
    setBusy(true);
    try {
      const res = await api(`/api/company-settings/${entity.id}/verify-gstin`, { method: 'POST', body: {} });
      setDiff(res.diff);
      const initial = {};
      res.diff.forEach(d => { initial[d.field] = d.status === 'new' || d.status === 'safe'; });
      setSelected(initial);
      setOpen(true);
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      const fields = Object.keys(selected).filter(k => selected[k]);
      const res = await api(`/api/company-settings/${entity.id}/verify-gstin`, { method: 'POST', body: { confirm: 1, fields } });
      showToast(`Updated ${res.applied.length || 0} field(s), plus the GST detail snapshot`);
      setOpen(false);
      onApplied();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  const actionable = diff?.filter(d => d.status !== 'unchanged') || [];
  return (
    <>
      <Button size="sm" variant="outline" onClick={start} disabled={busy}>
        <RefreshCwIcon data-icon="inline-start" />{busy && !open ? 'Checking…' : 'Refresh from GST'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>GST refresh — {entity.legal_name}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            {actionable.map(d => (
              <label key={d.field} className="flex items-start gap-2 rounded-md border p-2">
                <input type="checkbox" className="mt-1" checked={!!selected[d.field]} onChange={e => setSelected({ ...selected, [d.field]: e.target.checked })} />
                <span className="flex-1">
                  <span className="font-medium">{GST_FIELD_LABELS[d.field] || d.field}</span>
                  {d.status === 'manual-conflict' && <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">will overwrite a manual entry</span>}
                  {d.status === 'new' && <span className="ml-2 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">new</span>}
                  <div className="text-xs text-muted-foreground">
                    {d.current || '—'} <span className="mx-1">→</span> <span className="font-medium text-foreground">{d.fetched || '—'}</span>
                  </div>
                </span>
              </label>
            ))}
            {diff && !actionable.length && <p className="text-muted-foreground">Everything already matches the GST portal. The GST detail snapshot (jurisdiction, e-invoice status, etc.) will still refresh.</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Apply selected'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GstDetailCard({ entity, onApplied }) {
  const nba = entity.nature_of_business ? JSON.parse(entity.nature_of_business) : [];
  const adadr = entity.additional_business_premises ? JSON.parse(entity.additional_business_premises) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><IdCardIcon className="size-4" />GST Registration</CardTitle>
        <CardAction><GstinRefreshDialog entity={entity} onApplied={onApplied} /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {[
          ['GSTIN', entity.gstin, entity.gstin_source, entity.gstin_updated_at],
          ['Legal Name', entity.legal_name, entity.legal_name_source, entity.legal_name_updated_at],
          ['Trade Name', entity.trade_name, entity.trade_name_source, entity.trade_name_updated_at],
          ['PAN', entity.pan, entity.pan_source, entity.pan_updated_at],
          ['State', entity.state, entity.state_source, entity.state_updated_at],
          ['GST Status', entity.gst_status, entity.gst_status_source, entity.gst_status_updated_at],
          ['Taxpayer Type', entity.gst_taxpayer_type, entity.gst_taxpayer_type_source, entity.gst_taxpayer_type_updated_at],
          ['Registration Date', entity.gst_registration_date, entity.gst_registration_date_source, entity.gst_registration_date_updated_at],
          ['Constitution', entity.gst_constitution, entity.gst_constitution_source, entity.gst_constitution_updated_at],
        ].map(([label, value, source, updatedAt]) => (
          <div key={label} className="grid gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{label}</span>
              <ProvenanceTag source={source} updatedAt={updatedAt} />
            </div>
            <span className="text-sm">{value || '—'}</span>
          </div>
        ))}
        {entity.gst_extra_fetched_at && (
          <div className="col-span-full mt-2 grid gap-2 border-t pt-3 sm:grid-cols-2">
            <p className="col-span-full text-xs font-medium text-muted-foreground">
              GST detail snapshot — Sandbox · {new Date(entity.gst_extra_fetched_at).toLocaleDateString('en-IN')}
            </p>
            <div><span className="text-xs text-muted-foreground">Jurisdiction (State / Central)</span><p className="text-sm">{entity.gst_jurisdiction_state || '—'} / {entity.gst_jurisdiction_central || '—'}</p></div>
            <div><span className="text-xs text-muted-foreground">Cancellation Date</span><p className="text-sm">{entity.gst_cancellation_date || 'Not cancelled'}</p></div>
            <div><span className="text-xs text-muted-foreground">e-Invoice Enabled</span><p className="text-sm">{entity.einvoice_status || '—'}</p></div>
            <div><span className="text-xs text-muted-foreground">Nature of Business</span><p className="text-sm">{nba.join(', ') || '—'}</p></div>
            {!!adadr.length && (
              <div className="col-span-full"><span className="text-xs text-muted-foreground">Additional Places of Business</span>
                <ul className="list-disc pl-5 text-sm">{adadr.map((a, i) => <li key={i}>{[a.addr?.bno, a.addr?.st, a.addr?.loc, a.addr?.dst].filter(Boolean).join(', ')} — {a.ntr}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApplicabilityRow({ code, label, data, entity, registrationKey, registrationLabel, onSave }) {
  const [regValue, setRegValue] = useState(entity[registrationKey] || '');
  const [saving, setSaving] = useState(false);

  async function setOverride(v) {
    setSaving(true);
    try {
      await api('/api/company-settings', { method: 'PATCH', body: { id: entity.id, [`${code}_applicable_override`]: v } });
      onSave();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  async function saveReg() {
    setSaving(true);
    try {
      await api('/api/company-settings', { method: 'PATCH', body: { id: entity.id, [registrationKey]: regValue } });
      showToast('Saved');
      onSave();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  const selectValue = data.override === null ? 'auto' : data.override ? '1' : '0';
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${data.effective ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          {data.effective ? 'Applicable' : 'Not Applicable'}{data.override !== null && ' — Manual override'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Computed: {data.computed ? 'Applicable' : 'Not applicable'} — {data.reason}</p>
      <select className="h-8 w-56 rounded-md border bg-background px-2 text-xs" value={selectValue} disabled={saving}
        onChange={e => setOverride(e.target.value === 'auto' ? null : e.target.value === '1')}>
        <option value="auto">Auto (use computed value)</option>
        <option value="1">Override — Applicable</option>
        <option value="0">Override — Not Applicable</option>
      </select>
      <div className="flex gap-2">
        <Input placeholder={registrationLabel} value={regValue} onChange={e => setRegValue(e.target.value)} className="h-8 text-xs" />
        <Button size="sm" variant="outline" onClick={saveReg} disabled={saving}>Save</Button>
      </div>
    </div>
  );
}

function ApplicabilityCard({ entity, refreshKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api(`/api/company-settings/${entity.id}/applicability`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [entity.id]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>PF / ESI / Professional Tax</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <ApplicabilityRow code="pf" label="Provident Fund" data={data.pf} entity={entity} registrationKey="pf_establishment_code" registrationLabel="PF establishment code" onSave={load} />
        <ApplicabilityRow code="esi" label="ESI" data={data.esi} entity={entity} registrationKey="esi_employer_code" registrationLabel="ESI employer code" onSave={load} />
        <ApplicabilityRow code="pt" label="Professional Tax" data={data.pt} entity={entity} registrationKey="pt_registration_no" registrationLabel="PT registration no." onSave={load} />
      </CardContent>
    </Card>
  );
}

function CompanyEntitiesTab({ companies, router }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id);
  const entity = companies.find(c => c.id === companyId) || companies[0];
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => { router.refresh(); setRefreshKey(k => k + 1); };
  if (!entity) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {companies.map(c => (
          <Button key={c.id} size="sm" variant={companyId === c.id ? 'default' : 'outline'} onClick={() => setCompanyId(c.id)}>
            {c.legal_name}
          </Button>
        ))}
      </div>
      <GstDetailCard entity={entity} onApplied={refresh} />
      <ApplicabilityCard entity={entity} refreshKey={refreshKey} />
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
              <span>{r.section}{r.legacy_section ? ` (formerly ${r.legacy_section})` : ''}{r.description ? ` — ${r.description}` : ''} <span className="text-muted-foreground">from {r.effective_from}{r.threshold_amount ? `, threshold ${fmt(r.threshold_amount)}` : ''}</span></span>
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

  async function setCashFlowCategory(account, value) {
    try {
      await api(`/api/chart-of-accounts/${account.id}`, { method: 'PATCH', body: { cash_flow_category: value || null } });
      setAccounts(accounts.map(a => a.id === account.id ? { ...a, cash_flow_category: value || null } : a));
    } catch (err) { showToast(err.message, 'error'); }
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
        <p className="text-xs text-muted-foreground">
          Cash Flow category defaults by account type (Fixed Assets/Accumulated Depreciation →
          Investing, Equity → Financing, everything else → Operating) — override an individual
          account here only if it needs to land in a different section (e.g. a future loan account).
        </p>
        <div className="flex flex-col divide-y">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="tnum text-muted-foreground">{a.code}</span>
              <span className="flex-1 truncate px-2">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.account_type}</span>
              {a.code !== '1001' && (
                <select
                  className="h-7 w-28 shrink-0 rounded-md border bg-background px-1 text-xs"
                  value={a.cash_flow_category || ''}
                  onChange={e => setCashFlowCategory(a, e.target.value)}
                >
                  <option value="">Auto</option>
                  <option value="operating">Operating</option>
                  <option value="investing">Investing</option>
                  <option value="financing">Financing</option>
                </select>
              )}
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

// A posting dated on/before this date is rejected everywhere (lib/ledger-post.js's single choke
// point) — auto-posted documents, manual journals, and depreciation runs alike.
function PeriodLockCard({ company }) {
  const [lock, setLock] = useState(null);
  const [nextDate, setNextDate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setLock(await api(`/api/company-period-lock?company=${encodeURIComponent(company)}`)); }
    catch (err) { showToast(err.message, 'error'); }
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!nextDate) return;
    setSaving(true);
    try {
      await api('/api/company-period-lock', { method: 'PATCH', body: { company, locked_through: nextDate } });
      setNextDate('');
      load();
      showToast('Books locked through ' + nextDate);
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><LockIcon className="size-4" />Books lock</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No posting dated on or before this date is accepted — auto-posted documents, manual
          journals, and depreciation runs alike. Move it forward as each period closes.
        </p>
        <p className="text-sm">
          Currently locked through: <span className="font-medium">{lock?.locked_through || 'nothing locked yet'}</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} className="sm:w-40" />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Locking…' : 'Lock through this date'}</Button>
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
          <PeriodLockCard company={company} />
          <TrialBalanceCard company={company} />
          <ProfitLossCard company={company} />
          <BalanceSheetCard company={company} />
        </>
      )}
    </div>
  );
}

// --- Fixed Assets & depreciation ------------------------------------------------------------------

function FixedAssetsCard({ company }) {
  const [assets, setAssets] = useState([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [cost, setCost] = useState('');
  const [salvageValue, setSalvageValue] = useState('0');
  const [usefulLifeYears, setUsefulLifeYears] = useState('');
  const [method, setMethod] = useState('SLM');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setAssets(await api(`/api/fixed-assets?company=${encodeURIComponent(company)}`)); }
    catch (err) { showToast(err.message, 'error'); }
  }, [company]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!name || !purchaseDate || cost === '' || !usefulLifeYears) return;
    setSaving(true);
    try {
      await api('/api/fixed-assets', {
        method: 'POST',
        body: { company, name, category, purchase_date: purchaseDate, cost: Number(cost), salvage_value: Number(salvageValue) || 0, useful_life_years: Number(usefulLifeYears), method },
      });
      setName(''); setCategory(''); setPurchaseDate(''); setCost(''); setSalvageValue('0'); setUsefulLifeYears('');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BoxIcon className="size-4" />Fixed Assets</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Paid outright from Bank & Cash on creation. Depreciation (Schedule II SLM/WDV) runs
          separately, below.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="sm:w-40" />
          <Input placeholder="Category" value={category} onChange={e => setCategory(e.target.value)} className="sm:w-32" />
          <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="sm:w-36" />
          <Input type="number" placeholder="Cost" value={cost} onChange={e => setCost(e.target.value)} className="sm:w-28" />
          <Input type="number" placeholder="Salvage value" value={salvageValue} onChange={e => setSalvageValue(e.target.value)} className="sm:w-28" />
          <Input type="number" placeholder="Useful life (yrs)" value={usefulLifeYears} onChange={e => setUsefulLifeYears(e.target.value)} className="sm:w-32" />
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="sm:w-24"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="SLM">SLM</SelectItem><SelectItem value="WDV">WDV</SelectItem></SelectContent>
          </Select>
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {assets.filter(a => a.status !== 'disposed').map(a => (
            <FixedAssetRow key={a.id} asset={a} onDisposed={load} />
          ))}
          {!assets.filter(a => a.status !== 'disposed').length && <p className="py-2 text-sm text-muted-foreground">No fixed assets added yet.</p>}
        </div>
        {assets.some(a => a.status === 'disposed') && (
          <div className="flex flex-col divide-y pt-2">
            <p className="text-xs font-medium text-muted-foreground">Disposed</p>
            {assets.filter(a => a.status === 'disposed').map(a => (
              <div key={a.id} className="flex justify-between py-2 text-sm text-muted-foreground line-through">
                <span>{a.asset_no} — {a.name}</span>
                <span className="tnum">{fmt(a.disposal_amount)} on {a.disposed_at}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FixedAssetRow({ asset: a, onDisposed }) {
  const [disposing, setDisposing] = useState(false);
  const [disposalDate, setDisposalDate] = useState('');
  const [disposalAmount, setDisposalAmount] = useState('0');
  const [saving, setSaving] = useState(false);

  async function dispose() {
    if (!disposalDate) return;
    setSaving(true);
    try {
      await api(`/api/fixed-assets/${a.id}/dispose`, { method: 'POST', body: { disposal_date: disposalDate, disposal_amount: Number(disposalAmount) || 0 } });
      setDisposing(false);
      onDisposed();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex justify-between">
        <span>{a.asset_no} — {a.name}{a.category ? ` (${a.category})` : ''} <span className="text-muted-foreground">{a.method}, {a.useful_life_years}y from {a.purchase_date}</span></span>
        <span className="flex items-center gap-2">
          <span className="tnum">{fmt(a.cost)} <span className="text-muted-foreground">− {fmt(a.accumulated_depreciation)} dep.</span></span>
          <Button size="sm" variant="outline" onClick={() => setDisposing(d => !d)}>Dispose</Button>
        </span>
      </div>
      {disposing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="date" value={disposalDate} onChange={e => setDisposalDate(e.target.value)} className="sm:w-40" />
          <Input type="number" placeholder="Amount received (0 if scrapped/corrected)" value={disposalAmount} onChange={e => setDisposalAmount(e.target.value)} className="sm:w-64" />
          <Button size="sm" onClick={dispose} disabled={saving}>{saving ? 'Disposing…' : 'Confirm disposal'}</Button>
        </div>
      )}
    </div>
  );
}

function DepreciationRunCard({ company }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function run() {
    setRunning(true);
    try {
      const res = await api('/api/fixed-assets/depreciation-run', {
        method: 'POST', body: { company, period_year: Number(year), period_month: Number(month) },
      });
      setLastResult(res);
      showToast(res.alreadyRan ? 'Already ran for this period' : `Posted ${fmt(res.total)} across ${res.assetCount} asset(s)`);
    } catch (err) { showToast(err.message, 'error'); } finally { setRunning(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Run depreciation</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          One combined journal entry per period, all active assets summed. Safe to click twice —
          a period already run is a no-op, not a duplicate posting.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="number" placeholder="Year" value={year} onChange={e => setYear(e.target.value)} className="sm:w-24" />
          <Input type="number" placeholder="Month (1-12)" value={month} onChange={e => setMonth(e.target.value)} className="sm:w-28" />
          <Button size="sm" onClick={run} disabled={running}>{running ? 'Running…' : 'Run depreciation'}</Button>
        </div>
        {lastResult && !lastResult.alreadyRan && (
          <p className="text-sm">Posted <span className="tnum font-medium">{fmt(lastResult.total)}</span> across {lastResult.assetCount} asset(s).</p>
        )}
      </CardContent>
    </Card>
  );
}

function FixedAssetsTab({ companies }) {
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
          <FixedAssetsCard company={company} />
          <DepreciationRunCard company={company} />
        </>
      )}
    </div>
  );
}

// --- Audit Log (read-only view onto usb_audit — SYSTEM.md's "system-wide audit trail") -----------

function AuditLogTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      setRows(await api(`/api/audit-log${query}`));
    } catch (err) { showToast(err.message, 'error'); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><HistoryIcon className="size-4" />Audit Log</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Latest 200 by default. Every mutation across the app writes here — actor, action, detail, timestamp — insert-only.</p>
        <div className="flex gap-2">
          <Input placeholder="Search action / actor / detail" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
          <Button size="sm" variant="outline" onClick={load}>Search</Button>
        </div>
        <div className="flex flex-col divide-y">
          {rows.map(r => (
            <div key={r.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{r.action}</span>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <span className="text-muted-foreground">{r.actor}{r.detail ? ` — ${r.detail}` : ''}</span>
            </div>
          ))}
          {!rows.length && <p className="py-2 text-sm text-muted-foreground">Nothing found.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Bank reconciliation: manual tick-off of Bank & Cash ledger lines against the real statement -

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8 — statement import + auto-match, extending (not
// replacing) the manual tick-off below. Stateless: nothing is written until "Confirm & reconcile".
function ImportStatementCard({ company, accounts, onDone }) {
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
      fd.append('file', f); fd.append('company', company);
      setPreview(await api('/api/reports/bank-reconciliation/import', { method: 'POST', body: fd }));
    } catch (err) { showToast(err.message, 'error'); setFile(null); }
    setBusy(false);
    e.target.value = '';
  }

  async function confirmHigh() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('company', company); fd.append('confirm', '1');
      const res = await api('/api/reports/bank-reconciliation/import', { method: 'POST', body: fd });
      showToast(`${res.reconciled} lines auto-reconciled`);
      setPreview(null); setFile(null);
      onDone();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function reconcileLow(line) {
    try {
      await api(`/api/journal-entry-lines/${line.id}/reconcile`, { method: 'PATCH', body: { reconciled: true } });
      setPreview(p => ({ ...p, low: p.low.filter(m => m.line.id !== line.id) }));
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Statement</CardTitle>
        <CardAction>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={pick} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy && !preview ? 'Reading…' : 'Import statement (CSV/XLS)'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p className="text-xs">
          Auto-matches statement rows against unreconciled Bank & Cash lines (exact amount, within a
          few days). Only unambiguous matches reconcile automatically — everything else still needs
          a click below, same as the manual tick-off.
        </p>
      </CardContent>
      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Statement preview — {preview?.preview?.filename}</DialogTitle></DialogHeader>
          {preview && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">
                {preview.preview.totalRows} rows read (sheet "{preview.preview.sheetName}")
                {preview.preview.totalSkipped > 0 && <> · <span className="text-warning font-medium">{preview.preview.totalSkipped} rows skipped</span></>}
              </p>

              <div>
                <p className="mb-1 font-medium">Auto-matched ({preview.high.length})</p>
                <div className="flex flex-col divide-y">
                  {preview.high.map((m, i) => (
                    <div key={i} className="flex justify-between py-1 text-xs">
                      <span>{m.stmt.date} — {m.stmt.description || m.line.description}</span>
                      <span className="tnum">{fmt(m.stmt.amount)}</span>
                    </div>
                  ))}
                  {!preview.high.length && <p className="py-1 text-xs">None.</p>}
                </div>
              </div>

              {!!preview.low.length && (
                <div>
                  <p className="mb-1 font-medium">Needs review ({preview.low.length})</p>
                  <div className="flex flex-col divide-y">
                    {preview.low.map((m, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 text-xs">
                        <span>{m.stmt.date} — {m.stmt.description} <span className="text-muted-foreground">↔ ledger {m.line.entry_date} {m.line.description || m.line.source_type}</span></span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tnum">{fmt(m.stmt.amount)}</span>
                          <Button size="sm" variant="outline" onClick={() => reconcileLow(m.line)}>Reconcile</Button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!preview.unmatchedStatement.length && (
                <div>
                  <p className="mb-1 font-medium">Unmatched statement rows ({preview.unmatchedStatement.length})</p>
                  <div className="flex flex-col gap-2">
                    {preview.unmatchedStatement.map((row, i) => (
                      <QuickJeRow key={i} company={company} row={row} accounts={accounts} onDone={() => { setPreview(p => ({ ...p, unmatchedStatement: p.unmatchedStatement.filter((_, j) => j !== i) })); onDone(); }} />
                    ))}
                  </div>
                </div>
              )}

              {!!preview.unmatchedLedger.length && (
                <p className="text-xs text-muted-foreground">
                  {preview.unmatchedLedger.length} posted ledger line(s) not on this statement yet —
                  visible in the list below, untouched.
                </p>
              )}

              <DialogFooter>
                <Button variant="ghost" onClick={() => { setPreview(null); setFile(null); }}>Close</Button>
                <Button disabled={!preview.high.length || busy} onClick={confirmHigh}>
                  {busy ? 'Reconciling…' : `Confirm & reconcile ${preview.high.length}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function QuickJeRow({ company, row, accounts, onDone }) {
  const [accountCode, setAccountCode] = useState('5400');
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    try {
      await api('/api/reports/bank-reconciliation/quick-je', {
        method: 'POST',
        body: { company, date: row.date, amount: row.amount, description: row.description, accountCode },
      });
      showToast('Journal entry posted and reconciled');
      onDone();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex-1 truncate">{row.date} — {row.description || '—'}</span>
      <span className="tnum shrink-0">{fmt(row.amount)}</span>
      <select className="h-8 w-48 rounded-md border bg-background px-2 text-xs" value={accountCode} onChange={e => setAccountCode(e.target.value)}>
        {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={saving} onClick={create}>{saving ? '…' : 'Create JE'}</Button>
    </div>
  );
}

function BankReconciliationTab({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const load = useCallback(() => {
    api(`/api/reports/bank-reconciliation?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
    api(`/api/chart-of-accounts?company=${encodeURIComponent(company)}`).then(setAccounts).catch(() => {});
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
      <ImportStatementCard company={company} accounts={accounts} onDone={load} />
      <Card>
        <CardHeader><CardTitle>Bank & Cash reconciliation</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Tick each line off against the real bank statement, or use Import Statement above to
            auto-match most of them first.
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
    { key: 'company-entities', label: 'Company Entities', icon: IdCardIcon },
    { key: 'rates', label: 'GST & TDS Rates', icon: PercentIcon },
    { key: 'ledger', label: 'General Ledger', icon: BookIcon },
    { key: 'fixed-assets', label: 'Fixed Assets', icon: BoxIcon },
    { key: 'gst-returns', label: 'GST Returns', icon: FileTextIcon },
    { key: 'bank-reconciliation', label: 'Bank Reconciliation', icon: LandmarkIcon },
    { key: 'audit-log', label: 'Audit Log', icon: HistoryIcon },
  ];

  return (
    <WorkspaceSidebar title="Accounts" icon={LandmarkIcon} items={navItems} activeKey={tab} onChange={setTab} nested={nested}>
      {tab === 'settings' && <SettingsTab companies={companies} router={router} />}
      {tab === 'company-entities' && <CompanyEntitiesTab companies={companies} router={router} />}
      {tab === 'rates' && <RatesTab gstRates={gstRates} tdsRates={tdsRates} router={router} />}
      {tab === 'ledger' && <LedgerTab companies={companies} />}
      {tab === 'fixed-assets' && <FixedAssetsTab companies={companies} />}
      {tab === 'gst-returns' && <GstReturnsTab companies={companies} />}
      {tab === 'bank-reconciliation' && <BankReconciliationTab companies={companies} />}
      {tab === 'audit-log' && <AuditLogTab />}
    </WorkspaceSidebar>
  );
}
