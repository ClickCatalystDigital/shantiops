'use client';

// components/ExpensesWorkspace.jsx — HR completion bundle. Expense Claims | Advances | Loans, one
// workspace component mounted inside HrWorkspace.jsx with compact nested sidebar navigation. Workflow only — no GL posting
// happens anywhere in this file (HARD BOUNDARY); approving a claim just flips its status and, if
// it references an advance, bumps that advance's settled_amount (a running total, not a ledger).
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PlusIcon, CheckIcon, XIcon, TrashIcon, ReceiptIcon, IndianRupeeIcon, LandmarkIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------------------------
// Expense Claims
// ---------------------------------------------------------------------------------------------

function NewClaimDialog({ employees, expenseClaimTypes, employeeAdvances, onClose, router }) {
  const [employeeId, setEmployeeId] = useState('');
  const [claimDate, setClaimDate] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [items, setItems] = useState([{ expense_claim_type_id: '', expense_date: '', amount: '', description: '' }]);
  const [saving, setSaving] = useState(false);

  const openAdvances = employeeAdvances.filter(a => String(a.employee_id) === employeeId && a.status !== 'settled');

  function updateItem(i, patch) { setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function addItem() { setItems([...items, { expense_claim_type_id: '', expense_date: '', amount: '', description: '' }]); }
  function removeItem(i) { setItems(items.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!employeeId || !claimDate || !items.every(it => it.amount)) return showToast('Employee, date and item amounts are required', 'error');
    setSaving(true);
    try {
      await api('/api/expense-claims', {
        method: 'POST',
        body: { employee_id: employeeId, claim_date: claimDate, advance_id: advanceId || null, items: items.map(it => ({ ...it, amount: Number(it.amount) })) },
      });
      showToast('Claim submitted');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New Expense Claim</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={v => { setEmployeeId(v); setAdvanceId(''); }}>
                <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={claimDate} onChange={e => setClaimDate(e.target.value)} /></div>
          </div>
          {openAdvances.length > 0 && (
            <div className="grid gap-1.5">
              <Label>Settle against advance (optional)</Label>
              <Select value={advanceId} onValueChange={setAdvanceId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{openAdvances.map(a => <SelectItem key={a.id} value={String(a.id)}>#{a.id} — {a.purpose || 'Advance'} ({fmt(a.amount - a.settled_amount)} outstanding)</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Select value={it.expense_claim_type_id} onValueChange={v => updateItem(i, { expense_claim_type_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>{expenseClaimTypes.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Description" value={it.description} onChange={e => updateItem(i, { description: e.target.value })} />
                <Input type="number" placeholder="Amount" value={it.amount} onChange={e => updateItem(i, { amount: e.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => removeItem(i)} disabled={items.length === 1}><TrashIcon className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addItem}><PlusIcon />Add line</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseClaimsTab({ expenseClaims, employees, expenseClaimTypes, employeeAdvances, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function decide(id, status) {
    setBusyId(id);
    try {
      await api(`/api/expense-claims/${id}`, { method: 'PATCH', body: { status } });
      showToast(status === 'approved' ? 'Approved' : 'Rejected');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense Claims</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Claim</Button></CardAction>
      </CardHeader>
      <CardContent>
        {expenseClaims.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No expense claims yet.</p> : (
          <div className="flex flex-col divide-y">
            {expenseClaims.map(c => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{c.employee_name}</span>
                <span className="text-muted-foreground">{c.claim_date}</span>
                <span className="tnum">{fmt(c.total_amount)}</span>
                <Badge variant={c.status === 'approved' || c.status === 'paid' ? 'default' : 'outline'} className="capitalize">{c.status}</Badge>
                {c.status === 'submitted' && (
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => decide(c.id, 'approved')}><CheckIcon className="size-4" /></Button>
                    <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => decide(c.id, 'rejected')}><XIcon className="size-4" /></Button>
                  </span>
                )}
                {c.status === 'approved' && (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={busyId === c.id} onClick={() => decide(c.id, 'paid')}>Mark Paid</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <NewClaimDialog employees={employees} expenseClaimTypes={expenseClaimTypes} employeeAdvances={employeeAdvances} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------------------------

function NewAdvanceDialog({ employees, onClose, router }) {
  const [employeeId, setEmployeeId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!employeeId || !amount || !advanceDate) return showToast('Employee, amount and date are required', 'error');
    setSaving(true);
    try {
      await api('/api/employee-advances', { method: 'POST', body: { employee_id: employeeId, purpose, amount: Number(amount), advance_date: advanceDate } });
      showToast('Advance requested');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Employee Advance</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Purpose</Label><Input value={purpose} onChange={e => setPurpose(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={advanceDate} onChange={e => setAdvanceDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Request'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvancesTab({ employeeAdvances, employees, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function setStatus(id, status) {
    setBusyId(id);
    try {
      await api(`/api/employee-advances/${id}`, { method: 'PATCH', body: { status } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Advances</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Advance</Button></CardAction>
      </CardHeader>
      <CardContent>
        {employeeAdvances.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No advances yet.</p> : (
          <div className="flex flex-col divide-y">
            {employeeAdvances.map(a => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{a.employee_name}</span>
                <span className="text-muted-foreground">{a.purpose || '—'}</span>
                <span className="tnum">{fmt(a.amount)}</span>
                {a.settled_amount > 0 && <span className="text-muted-foreground">({fmt(a.settled_amount)} recovered)</span>}
                <Badge variant={a.status === 'settled' ? 'default' : 'outline'} className="capitalize">{a.status}</Badge>
                {a.status === 'requested' && <Button size="sm" variant="outline" className="ml-auto" disabled={busyId === a.id} onClick={() => setStatus(a.id, 'approved')}>Approve</Button>}
                {a.status === 'approved' && <Button size="sm" variant="outline" className="ml-auto" disabled={busyId === a.id} onClick={() => setStatus(a.id, 'paid')}>Mark Paid</Button>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <NewAdvanceDialog employees={employees} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------------------------

function NewLoanDialog({ employees, onClose, router }) {
  const [employeeId, setEmployeeId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestPct, setInterestPct] = useState('0');
  const [tenure, setTenure] = useState('');
  const [disbursedDate, setDisbursedDate] = useState('');
  const [saving, setSaving] = useState(false);

  const previewEmi = (() => {
    const p = Number(principal), r = Number(interestPct), n = Number(tenure);
    if (!p || !n) return null;
    if (!r) return p / n;
    const rate = r / 12 / 100;
    const factor = Math.pow(1 + rate, n);
    return (p * rate * factor) / (factor - 1);
  })();

  async function save() {
    if (!employeeId || !principal || !tenure || !disbursedDate) return showToast('Employee, principal, tenure and date are required', 'error');
    setSaving(true);
    try {
      const res = await api('/api/employee-loans', {
        method: 'POST',
        body: { employee_id: employeeId, purpose, principal_amount: Number(principal), interest_pct: Number(interestPct), tenure_months: Number(tenure), disbursed_date: disbursedDate },
      });
      showToast(`Loan disbursed — EMI ${fmt(res.emi_amount)}`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Employee Loan</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Purpose</Label><Input value={purpose} onChange={e => setPurpose(e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>Principal</Label><Input type="number" value={principal} onChange={e => setPrincipal(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Interest %/yr</Label><Input type="number" value={interestPct} onChange={e => setInterestPct(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Tenure (months)</Label><Input type="number" value={tenure} onChange={e => setTenure(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Disbursed date</Label><Input type="date" value={disbursedDate} onChange={e => setDisbursedDate(e.target.value)} /></div>
          {previewEmi != null && <p className="text-sm text-muted-foreground">Monthly EMI: <span className="tnum font-medium text-foreground">{fmt(previewEmi)}</span></p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Disburse'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoansTab({ employeeLoans, employees, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Loans</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Loan</Button></CardAction>
      </CardHeader>
      <CardContent>
        {employeeLoans.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No loans yet.</p> : (
          <div className="flex flex-col divide-y">
            {employeeLoans.map(l => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{l.employee_name}</span>
                <span className="text-muted-foreground">{l.purpose || '—'}</span>
                <span className="tnum">{fmt(l.principal_amount)}</span>
                <span className="text-muted-foreground">EMI {fmt(l.emi_amount)}</span>
                <span className="text-muted-foreground">outstanding {fmt(l.outstanding_principal)}</span>
                <Badge variant={l.status === 'active' ? 'default' : 'outline'} className="ml-auto capitalize">{l.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <NewLoanDialog employees={employees} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export default function ExpensesWorkspace({
  employees, expenseClaims, expenseClaimTypes, employeeAdvances, employeeLoans, router, nested = false,
}) {
  const [tab, setTab] = useState('claims');
  const navItems = [
    { key: 'claims', label: 'Expense Claims', icon: ReceiptIcon },
    { key: 'advances', label: 'Advances', icon: IndianRupeeIcon },
    { key: 'loans', label: 'Loans', icon: LandmarkIcon },
  ];

  return (
    <WorkspaceSidebar title="HR Expenses" icon={ReceiptIcon} items={navItems} activeKey={tab} onChange={setTab} nested={nested}>
      {tab === 'claims' && <ExpenseClaimsTab expenseClaims={expenseClaims} employees={employees} expenseClaimTypes={expenseClaimTypes} employeeAdvances={employeeAdvances} router={router} />}
      {tab === 'advances' && <AdvancesTab employeeAdvances={employeeAdvances} employees={employees} router={router} />}
      {tab === 'loans' && <LoansTab employeeLoans={employeeLoans} employees={employees} router={router} />}
    </WorkspaceSidebar>
  );
}
