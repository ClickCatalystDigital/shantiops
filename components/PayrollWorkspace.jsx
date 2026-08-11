'use client';

// components/PayrollWorkspace.jsx — HR completion bundle. Payroll Runs | Salary Slips | Additional
// Salary | Structures | Statutory Settings, one workspace component mounted as a tab inside
// HrWorkspace.jsx (same multi-tab-in-one-file precedent as ProcurementWorkspace.jsx). Every number
// here is computed by lib/payroll.js and rendered as a stored fact — no arithmetic happens client
// side beyond simple display formatting.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { PlusIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------------------------
// Payroll Runs
// ---------------------------------------------------------------------------------------------

function RunPayrollDialog({ onClose, router }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setSaving(true);
    try {
      const res = await api('/api/payroll-runs', { method: 'POST', body: { period_month: Number(month), period_year: Number(year) } });
      setResult(res);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
        {result ? (
          <div className="text-sm">
            <p>Generated <strong>{result.generated}</strong> slip(s).</p>
            {result.errors?.length > 0 && (
              <div className="mt-2 text-destructive">
                {result.errors.length} employee(s) skipped (no active salary structure assignment):
                <ul className="list-disc pl-5">{result.errors.map(e => <li key={e.employee_id}>#{e.employee_id}: {e.error}</li>)}</ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5"><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(e.target.value)} /></div>
            </div>
          </div>
        )}
        <DialogFooter>
          {result ? <Button onClick={onClose}>Close</Button> : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={run} disabled={saving}>{saving ? 'Running…' : 'Run Payroll'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayrollRunsTab({ payrollRuns, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll Runs</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />Run Payroll</Button></CardAction>
      </CardHeader>
      <CardContent>
        {payrollRuns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payroll runs yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Slips</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {payrollRuns.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{MONTHS[r.period_month]} {r.period_year}</TableCell>
                  <TableCell className="tnum">{r.slip_count}</TableCell>
                  <TableCell><Badge variant={r.status === 'submitted' ? 'default' : 'outline'} className="capitalize">{r.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <RunPayrollDialog router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Salary Slips
// ---------------------------------------------------------------------------------------------

function SalarySlipSheet({ slipId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/api/salary-slips/${slipId}`).then(setDetail).catch(err => showToast(err.message, 'error')); }, [slipId]);

  async function setStatus(status) {
    setBusy(true);
    try {
      await api(`/api/salary-slips/${slipId}`, { method: 'PATCH', body: { status } });
      setDetail(await api(`/api/salary-slips/${slipId}`));
      showToast('Updated');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader><SheetTitle>{detail ? `${detail.employee_code} — ${MONTHS[detail.period_month]} ${detail.period_year}` : 'Loading…'}</SheetTitle></SheetHeader>
        {detail && (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Payment days</span><div className="font-medium tnum">{detail.payment_days} / {detail.working_days}</div></div>
              <div><span className="text-muted-foreground">Status</span><div><Badge variant={detail.status === 'paid' ? 'default' : 'outline'} className="capitalize">{detail.status}</Badge></div></div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {detail.components.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{c.component_type}</TableCell>
                    <TableCell className="text-right tnum">{fmt(c.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><span>Gross Earnings</span><span className="tnum">{fmt(detail.gross_earnings)}</span></div>
              <div className="flex justify-between"><span>Total Deductions</span><span className="tnum">{fmt(detail.total_deductions)}</span></div>
              <div className="flex justify-between font-semibold"><span>Net Pay</span><span className="tnum">{fmt(detail.net_pay)}</span></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild><a href={`/api/salary-slips/${slipId}/pdf`} target="_blank" rel="noreferrer">Download PDF</a></Button>
              {detail.status === 'draft' && <Button size="sm" disabled={busy} onClick={() => setStatus('submitted')}>Submit</Button>}
              {detail.status === 'submitted' && <Button size="sm" disabled={busy} onClick={() => setStatus('paid')}>Mark Paid</Button>}
            </div>
          </div>
        )}
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SalarySlipsTab({ salarySlips }) {
  const [selectedId, setSelectedId] = useState(null);
  return (
    <Card>
      <CardHeader><CardTitle>Salary Slips</CardTitle></CardHeader>
      <CardContent>
        {salarySlips.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No slips yet — run payroll to generate some.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Period</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Net Pay</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {salarySlips.map(s => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelectedId(s.id)}>
                  <TableCell className="font-medium">{s.employee_name}</TableCell>
                  <TableCell>{MONTHS[s.period_month]} {s.period_year}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{s.slip_type}</TableCell>
                  <TableCell className="text-right tnum">{fmt(s.net_pay)}</TableCell>
                  <TableCell><Badge variant={s.status === 'paid' ? 'default' : 'outline'} className="capitalize">{s.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {selectedId && <SalarySlipSheet slipId={selectedId} onClose={() => setSelectedId(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Additional Salary (arrears/bonus)
// ---------------------------------------------------------------------------------------------

function AddAdditionalSalaryDialog({ employees, onClose, router }) {
  const now = new Date();
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [componentType, setComponentType] = useState('earning');
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!employeeId || !name.trim() || !amount) return showToast('Employee, name and amount are required', 'error');
    setSaving(true);
    try {
      await api('/api/additional-salary', {
        method: 'POST',
        body: { employee_id: employeeId, name: name.trim(), component_type: componentType, amount: Number(amount), period_month: Number(month), period_year: Number(year), reason },
      });
      showToast('Added — will be folded into that period\'s slip');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Arrears / Bonus</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Diwali Bonus" /></div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={componentType} onValueChange={setComponentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="grid gap-1.5">
              <Label>Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdditionalSalaryTab({ additionalSalary, employees, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Additional Salary</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />Add</Button></CardAction>
      </CardHeader>
      <CardContent>
        {additionalSalary.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No one-off arrears/bonus lines yet.</p> : (
          <div className="flex flex-col divide-y">
            {additionalSalary.map(a => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{a.employee_name}</span>
                <Badge variant="outline">{a.name}</Badge>
                <span className="text-muted-foreground">{MONTHS[a.period_month]} {a.period_year}</span>
                <span className={`ml-auto tnum ${a.component_type === 'deduction' ? 'text-destructive' : ''}`}>{a.component_type === 'deduction' ? '−' : '+'}{fmt(a.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <AddAdditionalSalaryDialog employees={employees} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Salary Structures + Assignments
// ---------------------------------------------------------------------------------------------

function NewStructureDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/salary-structures', { method: 'POST', body: { name: name.trim() } });
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Salary Structure</DialogTitle></DialogHeader>
        <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Staff Standard" autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StructureDetailSheet({ structureId, onClose, router }) {
  const [detail, setDetail] = useState(null);
  const [name, setName] = useState('');
  const [componentType, setComponentType] = useState('earning');
  const [calcType, setCalcType] = useState('flat');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  function load() { api(`/api/salary-structures/${structureId}`).then(setDetail).catch(err => showToast(err.message, 'error')); }
  useEffect(load, [structureId]);

  async function addComponent() {
    if (!name.trim() || !value) return showToast('Name and value are required', 'error');
    setSaving(true);
    try {
      await api(`/api/salary-structures/${structureId}/components`, {
        method: 'POST',
        body: { name: name.trim(), component_type: componentType, calc_type: calcType, [calcType === 'flat' ? 'amount' : 'percent']: Number(value) },
      });
      setName(''); setValue('');
      load();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function removeComponent(id) {
    await api(`/api/salary-structures/${structureId}/components/${id}`, { method: 'DELETE' });
    load();
    router.refresh();
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader><SheetTitle>{detail?.name || 'Loading…'}</SheetTitle></SheetHeader>
        {detail && (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
            <p className="text-xs text-muted-foreground">"Basic" isn't listed here — it's set per employee when assigning this structure. Other lines are flat amounts or a percent of Basic.</p>
            <div className="flex flex-col divide-y">
              {detail.components.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="outline" className="capitalize">{c.component_type}</Badge>
                  <span className="ml-auto text-muted-foreground">{c.calc_type === 'percent_of_basic' ? `${c.percent}% of Basic` : fmt(c.amount)}</span>
                  <Button size="icon" variant="ghost" onClick={() => removeComponent(c.id)}>×</Button>
                </div>
              ))}
              {detail.components.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No component lines yet.</p>}
            </div>
            <div className="flex flex-col gap-2 rounded border p-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Add component</div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Name (e.g. HRA)" value={name} onChange={e => setName(e.target.value)} />
                <Select value={componentType} onValueChange={setComponentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={calcType} onValueChange={setCalcType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="flat">Flat amount</SelectItem><SelectItem value="percent_of_basic">% of Basic</SelectItem></SelectContent>
                </Select>
                <Input type="number" placeholder={calcType === 'flat' ? 'Amount' : 'Percent'} value={value} onChange={e => setValue(e.target.value)} />
              </div>
              <Button size="sm" onClick={addComponent} disabled={saving}><PlusIcon />Add</Button>
            </div>
          </div>
        )}
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AssignStructureDialog({ employees, salaryStructures, onClose, router }) {
  const [employeeId, setEmployeeId] = useState('');
  const [structureId, setStructureId] = useState('');
  const [base, setBase] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!employeeId || !structureId || !base || !fromDate) return showToast('All fields are required', 'error');
    setSaving(true);
    try {
      await api('/api/salary-structure-assignments', { method: 'POST', body: { employee_id: employeeId, salary_structure_id: structureId, base: Number(base), from_date: fromDate } });
      showToast('Structure assigned');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign Salary Structure</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Structure</Label>
            <Select value={structureId} onValueChange={setStructureId}>
              <SelectTrigger><SelectValue placeholder="Choose structure" /></SelectTrigger>
              <SelectContent>{salaryStructures.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Basic (monthly)</Label><Input type="number" value={base} onChange={e => setBase(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>From</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Assign'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StructuresTab({ salaryStructures, salaryAssignments, employees, router }) {
  const [newOpen, setNewOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Salary Structures</CardTitle>
          <CardAction><Button size="sm" onClick={() => setNewOpen(true)}><PlusIcon />New</Button></CardAction>
        </CardHeader>
        <CardContent>
          {salaryStructures.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No structures yet.</p> : (
            <div className="flex flex-col divide-y">
              {salaryStructures.map(s => (
                <button key={s.id} onClick={() => setSelectedId(s.id)} className="flex justify-between py-2 text-left text-sm hover:bg-muted/50">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant={s.active ? 'default' : 'outline'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardAction><Button size="sm" onClick={() => setAssignOpen(true)}><PlusIcon />Assign</Button></CardAction>
        </CardHeader>
        <CardContent>
          {salaryAssignments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No assignments yet.</p> : (
            <div className="flex flex-col divide-y">
              {salaryAssignments.map(a => (
                <div key={a.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{a.employee_name}</span>
                  <Badge variant="outline">{a.structure_name}</Badge>
                  <span className="ml-auto tnum text-muted-foreground">{fmt(a.base)}</span>
                  {!a.active && <Badge variant="outline">Inactive</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {newOpen && <NewStructureDialog router={router} onClose={() => setNewOpen(false)} />}
      {assignOpen && <AssignStructureDialog employees={employees} salaryStructures={salaryStructures} router={router} onClose={() => setAssignOpen(false)} />}
      {selectedId && <StructureDetailSheet structureId={selectedId} router={router} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Statutory Settings
// ---------------------------------------------------------------------------------------------

function RatesForm({ statutoryRates, router }) {
  const [values, setValues] = useState(statutoryRates);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setValues({ ...values, [k]: v });

  async function save() {
    setSaving(true);
    try {
      await api('/api/statutory-rates', { method: 'PATCH', body: values });
      showToast('Statutory rates updated');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  const fields = [
    ['pf_employee_pct', 'PF — Employee %'], ['pf_employer_pct', 'PF — Employer %'], ['pf_wage_ceiling', 'PF wage ceiling'],
    ['esi_employee_pct', 'ESI — Employee %'], ['esi_employer_pct', 'ESI — Employer %'], ['esi_wage_ceiling', 'ESI wage ceiling'],
    ['standard_monthly_hours', 'Standard monthly hours'], ['overtime_multiplier', 'Overtime multiplier'],
    ['standard_deduction', 'Standard deduction (annual)'], ['tds_rebate_income_threshold', 'TDS rebate threshold (annual)'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Statutory Rates</CardTitle>
        <CardAction><Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label}</Label>
            <Input type="number" value={values[key] ?? ''} onChange={e => set(key, Number(e.target.value))} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PtSlabsCard({ ptSlabs, router }) {
  const [state, setState] = useState('Telangana');
  const [minGross, setMinGross] = useState('');
  const [maxGross, setMaxGross] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!state || minGross === '' || amount === '') return;
    setSaving(true);
    try {
      await api('/api/professional-tax-slabs', { method: 'POST', body: { state, min_gross: Number(minGross), max_gross: maxGross === '' ? null : Number(maxGross), amount: Number(amount) } });
      setMinGross(''); setMaxGross(''); setAmount('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Professional Tax Slabs</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="State" value={state} onChange={e => setState(e.target.value)} className="sm:w-32" />
          <Input type="number" placeholder="Min gross" value={minGross} onChange={e => setMinGross(e.target.value)} />
          <Input type="number" placeholder="Max gross (blank = above)" value={maxGross} onChange={e => setMaxGross(e.target.value)} />
          <Input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {ptSlabs.map(s => (
            <div key={s.id} className="flex justify-between py-2 text-sm">
              <span>{s.state}: {fmt(s.min_gross)} – {s.max_gross ? fmt(s.max_gross) : 'above'}</span>
              <span className="tnum font-medium">{fmt(s.amount)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TaxSlabsCard({ taxSlabs, router }) {
  const [fy, setFy] = useState('2026-27');
  const [minIncome, setMinIncome] = useState('');
  const [maxIncome, setMaxIncome] = useState('');
  const [ratePct, setRatePct] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!fy || minIncome === '' || ratePct === '') return;
    setSaving(true);
    try {
      await api('/api/income-tax-slabs', { method: 'POST', body: { financial_year: fy, min_income: Number(minIncome), max_income: maxIncome === '' ? null : Number(maxIncome), rate_pct: Number(ratePct) } });
      setMinIncome(''); setMaxIncome(''); setRatePct('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Income Tax Slabs (new regime)</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Old tax regime isn't modeled here. Verify these against the actual Budget announcement — seeded figures are a best-known default, not guaranteed current.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="FY (e.g. 2026-27)" value={fy} onChange={e => setFy(e.target.value)} className="sm:w-28" />
          <Input type="number" placeholder="Min income" value={minIncome} onChange={e => setMinIncome(e.target.value)} />
          <Input type="number" placeholder="Max income (blank = above)" value={maxIncome} onChange={e => setMaxIncome(e.target.value)} />
          <Input type="number" placeholder="Rate %" value={ratePct} onChange={e => setRatePct(e.target.value)} />
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon /></Button>
        </div>
        <div className="flex flex-col divide-y">
          {taxSlabs.map(s => (
            <div key={s.id} className="flex justify-between py-2 text-sm">
              <span>{s.financial_year}: {fmt(s.min_income)} – {s.max_income ? fmt(s.max_income) : 'above'}</span>
              <span className="tnum font-medium">{s.rate_pct}%</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export default function PayrollWorkspace({
  employees, payrollRuns, salarySlips, salaryStructures, salaryAssignments,
  statutoryRates, ptSlabs, taxSlabs, additionalSalary, router,
}) {
  const [tab, setTab] = useState('runs');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex-col gap-4">
      <TabsList variant="line" className="w-full justify-start px-0">
        <TabsTrigger value="runs" className="flex-none">Payroll Runs</TabsTrigger>
        <TabsTrigger value="slips" className="flex-none">Salary Slips</TabsTrigger>
        <TabsTrigger value="additional" className="flex-none">Additional Salary</TabsTrigger>
        <TabsTrigger value="structures" className="flex-none">Structures</TabsTrigger>
        <TabsTrigger value="settings" className="flex-none">Statutory Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="runs"><PayrollRunsTab payrollRuns={payrollRuns} router={router} /></TabsContent>
      <TabsContent value="slips"><SalarySlipsTab salarySlips={salarySlips} /></TabsContent>
      <TabsContent value="additional"><AdditionalSalaryTab additionalSalary={additionalSalary} employees={employees} router={router} /></TabsContent>
      <TabsContent value="structures"><StructuresTab salaryStructures={salaryStructures} salaryAssignments={salaryAssignments} employees={employees} router={router} /></TabsContent>
      <TabsContent value="settings">
        <div className="flex flex-col gap-4">
          <RatesForm statutoryRates={statutoryRates} router={router} />
          <PtSlabsCard ptSlabs={ptSlabs} router={router} />
          <TaxSlabsCard taxSlabs={taxSlabs} router={router} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
