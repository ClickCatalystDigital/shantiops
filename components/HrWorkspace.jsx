'use client';

// components/HrWorkspace.jsx — V3_CHANGES.md §12 Phase 3g/4f. Employees | Attendance | Leave |
// Shifts | Holidays | Recruitment, one workspace component with shared sidebar navigation
// as ProcurementWorkspace.jsx. Employee detail (onboarding checklist, leave balance, separation)
// opens in a right-side Sheet, same drawer pattern the Purchase Order view already uses.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet';
import { PlusIcon, CheckIcon, XIcon, UsersIcon, CalendarDaysIcon, Clock3Icon, UserPlusIcon, IndianRupeeIcon, ReceiptIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import PayrollWorkspace from '@/components/PayrollWorkspace';
import ExpensesWorkspace from '@/components/ExpensesWorkspace';

const ATTENDANCE_STATUSES = ['present', 'half', 'absent', 'leave'];
const APPLICANT_STAGES = ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'];

// ---------------------------------------------------------------------------------------------
// Employees tab
// ---------------------------------------------------------------------------------------------

// V3_CHANGES.md §13 — the field-depth gap-closure columns, grouped exactly as the spec names them
// (Personal / Address & Contact / Joining / Salary), shared between the New Employee dialog and
// the Employee detail Sheet's edit mode so the ~20 fields are defined once, not twice.
const EMPLOYEE_FIELD_GROUPS = [
  { label: 'Personal', fields: [
    { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'] },
    { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { key: 'photo_url', label: 'Photo URL', type: 'text' },
  ] },
  { label: 'Address & Contact', fields: [
    { key: 'current_address', label: 'Current address', type: 'textarea' },
    { key: 'permanent_address', label: 'Permanent address', type: 'textarea' },
    { key: 'personal_email', label: 'Personal email', type: 'text' },
    { key: 'emergency_contact_name', label: 'Emergency contact name', type: 'text' },
    { key: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'text' },
    { key: 'emergency_contact_relation', label: 'Relation', type: 'text' },
  ] },
  { label: 'Joining', fields: [
    { key: 'date_of_joining', label: 'Date of joining', type: 'date' },
    { key: 'reports_to', label: 'Reports to (manager)', type: 'employee-select' },
    { key: 'scheduled_confirmation_date', label: 'Scheduled confirmation', type: 'date' },
    { key: 'final_confirmation_date', label: 'Final confirmation', type: 'date' },
    { key: 'contract_end_date', label: 'Contract end date', type: 'date' },
    { key: 'notice_period_days', label: 'Notice period (days)', type: 'number' },
    { key: 'date_of_retirement', label: 'Date of retirement', type: 'date' },
  ] },
  { label: 'Salary', fields: [
    { key: 'salary_mode', label: 'Salary mode', type: 'text', placeholder: 'Bank Transfer / Cash' },
    { key: 'bank_name', label: 'Bank name', type: 'text' },
    { key: 'bank_account_no', label: 'Bank account no.', type: 'text' },
    { key: 'bank_ifsc', label: 'IFSC', type: 'text' },
    { key: 'ctc', label: 'Annual CTC', type: 'number' },
    { key: 'salary_currency', label: 'Currency', type: 'text', placeholder: 'INR' },
  ] },
];

function EmployeeFieldsForm({ values, onChange, employees = [], excludeId = null, readOnly = false }) {
  const set = (key, v) => onChange({ ...values, [key]: v });
  return (
    <div className="flex flex-col gap-4">
      {EMPLOYEE_FIELD_GROUPS.map(group => (
        <div key={group.label} className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
          {readOnly ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {group.fields.map(f => {
                const display = f.type === 'employee-select'
                  ? (values[`${f.key}_name`] || employees.find(e => e.id === values[f.key])?.name)
                  : values[f.key];
                return (
                  <div key={f.key}>
                    <span className="text-muted-foreground">{f.label}</span>
                    <div className="font-medium">{display || display === 0 ? display : '—'}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {group.fields.map(f => (
                <div key={f.key} className="grid gap-1.5">
                  <Label>{f.label}</Label>
                  {f.type === 'select' && (
                    <Select value={values[f.key] || ''} onValueChange={v => set(f.key, v)}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {f.type === 'employee-select' && (
                    <Select value={values[f.key] ? String(values[f.key]) : ''} onValueChange={v => set(f.key, Number(v))}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {employees.filter(e => e.id !== excludeId).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {f.type === 'textarea' && (
                    <Textarea value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={2} />
                  )}
                  {(f.type === 'text' || f.type === 'date' || f.type === 'number') && (
                    <Input type={f.type} value={values[f.key] ?? ''} placeholder={f.placeholder}
                      onChange={e => set(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Exit structure lives on employee_separation (§12 decision 6), edited inline once a separation
// has started — same flat key/label list idiom as EMPLOYEE_FIELD_GROUPS's per-group fields, just
// without the grouping (one section, not four).
const EXIT_FIELDS = [
  { key: 'resignation_letter_date', label: 'Resignation letter date', type: 'date' },
  { key: 'relieving_date', label: 'Relieving date', type: 'date' },
  { key: 'reason_for_leaving', label: 'Reason for leaving', type: 'textarea' },
  { key: 'new_workplace', label: 'New workplace', type: 'text' },
  { key: 'exit_interview_held_on', label: 'Exit interview held on', type: 'date' },
  { key: 'exit_interview_feedback', label: 'Exit interview feedback', type: 'textarea' },
  { key: 'encashment_amount', label: 'Leave encashment amount', type: 'number' },
];

function PlainFieldsForm({ fields, values, onChange, readOnly = false }) {
  const set = (key, v) => onChange({ ...values, [key]: v });
  if (readOnly) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {fields.map(f => (
          <div key={f.key}><span className="text-muted-foreground">{f.label}</span><div className="font-medium">{values[f.key] ?? '—'}</div></div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(f => (
        <div key={f.key} className="grid gap-1.5">
          <Label>{f.label}</Label>
          {f.type === 'textarea'
            ? <Textarea value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={2} />
            : <Input type={f.type} value={values[f.key] ?? ''}
                onChange={e => set(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
        </div>
      ))}
    </div>
  );
}

// Strips '' -> null (empty optional fields shouldn't overwrite with an empty string) before a
// PATCH/POST body goes out — every field above is optional.
function cleanFieldValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) out[k] = v === '' ? null : v;
  return out;
}

function AddEmployeeDialog({ designations, employmentTypes, employees, onClose, router }) {
  const [name, setName] = useState('');
  const [employeeType, setEmployeeType] = useState('staff');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [extra, setExtra] = useState({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/employees', {
        method: 'POST',
        body: {
          name: name.trim(), employee_type: employeeType, department: department || null,
          phone: phone || null, email: email || null, ...cleanFieldValues(extra),
        },
      });
      showToast('Employee added');
      router.refresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>New Employee</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={employeeType} onValueChange={setEmployeeType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="worker">Worker</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Department (optional)</Label><Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Production" /></div>
            <div className="grid gap-1.5"><Label>Phone (optional)</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Company email (optional)</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div>
          <EmployeeFieldsForm values={extra} onChange={setExtra} employees={employees} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Employee'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDetailSheet({ employeeId, employees, onClose, router }) {
  const [detail, setDetail] = useState(null);
  const [balances, setBalances] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [exitEditing, setExitEditing] = useState(false);
  const [exitValues, setExitValues] = useState({});
  const [history, setHistory] = useState({ leave: [], attendance: [], shifts: [] });
  const [newOnboardingTask, setNewOnboardingTask] = useState('');
  const [newSeparationTask, setNewSeparationTask] = useState('');
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    api(`/api/employees/${employeeId}`).then(setDetail).catch(err => showToast(err.message, 'error'));
    api(`/api/leave-allocations?employee_id=${employeeId}&year=${new Date().getFullYear()}`).then(setBalances).catch(() => {});
    Promise.all([
      api(`/api/leave-requests?employee_id=${employeeId}`).catch(() => []),
      api(`/api/attendance?employee_id=${employeeId}`).catch(() => []),
      api(`/api/shift-assignments?employee_id=${employeeId}`).catch(() => []),
    ]).then(([leave, attendance, shifts]) => setHistory({ leave, attendance, shifts }));
  }, [employeeId]);

  function startEdit() { setEditValues({ ...detail }); setEditing(true); }

  async function saveEdit() {
    setBusy(true);
    try {
      const body = {};
      for (const group of EMPLOYEE_FIELD_GROUPS) for (const f of group.fields) body[f.key] = editValues[f.key] === '' ? null : editValues[f.key];
      await api(`/api/employees/${employeeId}`, { method: 'PATCH', body });
      showToast('Employee updated');
      setDetail(await api(`/api/employees/${employeeId}`));
      setEditing(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  function startExitEdit() { setExitValues({ ...detail.separation }); setExitEditing(true); }

  async function saveExit() {
    setBusy(true);
    try {
      const body = { leave_encashed: exitValues.leave_encashed ? 1 : 0 };
      for (const f of EXIT_FIELDS) body[f.key] = exitValues[f.key] === '' ? null : exitValues[f.key];
      await api(`/api/employee-separation/${detail.separation.id}`, { method: 'PATCH', body });
      showToast('Exit details updated');
      setDetail(await api(`/api/employees/${employeeId}`));
      setExitEditing(false);
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function toggleOnboardingTask(task) {
    if (!detail?.onboarding) return;
    setBusy(true);
    try {
      await api(`/api/employee-onboarding/${detail.onboarding.id}/tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'pending' : 'done' } });
      const fresh = await api(`/api/employees/${employeeId}`);
      setDetail(fresh);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function addOnboardingTask() {
    if (!newOnboardingTask.trim() || !detail?.onboarding) return;
    setBusy(true);
    try {
      await api(`/api/employee-onboarding/${detail.onboarding.id}/tasks`, { method: 'POST', body: { task: newOnboardingTask.trim() } });
      setNewOnboardingTask('');
      setDetail(await api(`/api/employees/${employeeId}`));
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function addSeparationTask() {
    if (!newSeparationTask.trim() || !detail?.separation) return;
    setBusy(true);
    try {
      await api(`/api/employee-separation/${detail.separation.id}/tasks`, { method: 'POST', body: { task: newSeparationTask.trim() } });
      setNewSeparationTask('');
      setDetail(await api(`/api/employees/${employeeId}`));
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function generateSettlement() {
    setSettling(true);
    try {
      const res = await api(`/api/employee-separation/${detail.separation.id}/settlement`, { method: 'POST' });
      showToast(`Final settlement generated — net pay ${res.netPay}`);
      setDetail(await api(`/api/employees/${employeeId}`));
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSettling(false); }
  }

  async function startSeparation() {
    setBusy(true);
    try {
      await api('/api/employee-separation', { method: 'POST', body: { employee_id: employeeId } });
      const fresh = await api(`/api/employees/${employeeId}`);
      setDetail(fresh);
      showToast('Separation started');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function toggleSeparationTask(task) {
    if (!detail?.separation) return;
    setBusy(true);
    try {
      const res = await api(`/api/employee-separation/${detail.separation.id}/tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'pending' : 'done' } });
      const fresh = await api(`/api/employees/${employeeId}`);
      setDetail(fresh);
      router.refresh();
      if (res.completed) {
        showToast(res.offerLoginDeactivation ? 'Separation complete — this employee has a login. Deactivate it from Settings → Access Matrix.' : 'Separation complete');
      }
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{detail ? `${detail.employee_code} — ${detail.name}` : 'Loading…'}</SheetTitle>
        </SheetHeader>
        {detail && (
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Type</span><div className="font-medium capitalize">{detail.employee_type}</div></div>
              <div><span className="text-muted-foreground">Department</span><div className="font-medium">{detail.department || '—'}</div></div>
              <div><span className="text-muted-foreground">Designation</span><div className="font-medium">{detail.designation_name || '—'}</div></div>
              <div><span className="text-muted-foreground">Shift</span><div className="font-medium">{detail.currentShift?.shift_name || '—'}</div></div>
              <div><span className="text-muted-foreground">Status</span><div><Badge variant={detail.active ? 'default' : 'outline'}>{detail.active ? 'Active' : 'Exited'}</Badge></div></div>
            </div>

            {balances.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold">Leave balance ({new Date().getFullYear()})</div>
                <div className="flex flex-col gap-1 text-sm">
                  {balances.map(b => (
                    <div key={b.leave_type_id} className="flex justify-between"><span>{b.leave_type_name}</span><span className="tnum">{b.balance} / {b.allocated}</span></div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span>Details</span>
                {editing ? (
                  <span className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                    <Button size="sm" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button>
                )}
              </div>
              {editing
                ? <EmployeeFieldsForm values={editValues} onChange={setEditValues} employees={employees} excludeId={detail.id} />
                : <EmployeeFieldsForm values={detail} onChange={() => {}} employees={employees} readOnly />}
            </div>

            {detail.onboarding && (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>Onboarding</span><Badge variant={detail.onboarding.status === 'completed' ? 'default' : 'outline'}>{detail.onboarding.status}</Badge>
                </div>
                <div className="flex flex-col gap-1.5">
                  {detail.onboarding.tasks.map(t => (
                    <button key={t.id} disabled={busy} onClick={() => toggleOnboardingTask(t)}
                      className="flex items-center gap-2 rounded border px-2 py-1.5 text-left text-sm hover:bg-muted/50">
                      {t.status === 'done' ? <CheckIcon className="size-4 text-success" /> : <div className="size-4 rounded border" />}
                      <span className={t.status === 'done' ? 'text-muted-foreground line-through' : ''}>{t.task}</span>
                    </button>
                  ))}
                  <div className="flex gap-2">
                    <Input placeholder="Add a task…" value={newOnboardingTask} onChange={e => setNewOnboardingTask(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addOnboardingTask()} className="h-8 text-sm" />
                    <Button size="sm" variant="outline" disabled={busy} onClick={addOnboardingTask}><PlusIcon className="size-4" /></Button>
                  </div>
                </div>
              </div>
            )}

            {detail.active === 1 && !detail.separation && (
              <Button variant="outline" size="sm" onClick={startSeparation} disabled={busy}>Start Separation</Button>
            )}
            {detail.separation && (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>Separation</span><Badge variant={detail.separation.status === 'completed' ? 'default' : 'outline'}>{detail.separation.status}</Badge>
                </div>
                <div className="flex flex-col gap-1.5">
                  {detail.separation.tasks.map(t => (
                    <button key={t.id} disabled={busy} onClick={() => toggleSeparationTask(t)}
                      className="flex items-center gap-2 rounded border px-2 py-1.5 text-left text-sm hover:bg-muted/50">
                      {t.status === 'done' ? <CheckIcon className="size-4 text-success" /> : <div className="size-4 rounded border" />}
                      <span className={t.status === 'done' ? 'text-muted-foreground line-through' : ''}>{t.task}</span>
                    </button>
                  ))}
                  <div className="flex gap-2">
                    <Input placeholder="Add a task…" value={newSeparationTask} onChange={e => setNewSeparationTask(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addSeparationTask()} className="h-8 text-sm" />
                    <Button size="sm" variant="outline" disabled={busy} onClick={addSeparationTask}><PlusIcon className="size-4" /></Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full &amp; Final Settlement</span>
                  {detail.separation.settlement_slip_id ? (
                    <Button size="sm" variant="outline" asChild><a href={`/api/salary-slips/${detail.separation.settlement_slip_id}/pdf`} target="_blank" rel="noreferrer">View Settlement PDF</a></Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={settling || !detail.separation.relieving_date} onClick={generateSettlement}>
                      {settling ? 'Generating…' : 'Generate Final Settlement'}
                    </Button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Exit details</span>
                  {exitEditing ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setExitEditing(false)} disabled={busy}>Cancel</Button>
                      <Button size="sm" onClick={saveExit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={startExitEdit}>Edit</Button>
                  )}
                </div>
                <div className="mt-2">
                  {exitEditing ? (
                    <div className="flex flex-col gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={!!exitValues.leave_encashed} onCheckedChange={v => setExitValues({ ...exitValues, leave_encashed: v })} />
                        Leave encashed
                      </label>
                      <PlainFieldsForm fields={EXIT_FIELDS} values={exitValues} onChange={setExitValues} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="text-sm"><span className="text-muted-foreground">Leave encashed</span> <span className="font-medium">{detail.separation.leave_encashed ? 'Yes' : 'No'}</span></div>
                      <PlainFieldsForm fields={EXIT_FIELDS} values={detail.separation} readOnly />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-sm font-semibold">History</div>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave requests</div>
                  {history.leave.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                    <div className="flex max-h-40 flex-col divide-y overflow-y-auto text-sm">
                      {history.leave.map(r => (
                        <div key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                          <Badge variant="outline">{r.leave_type_name}</Badge>
                          <span className="text-muted-foreground">{r.from_date} → {r.to_date} ({r.days}d{r.half_day ? ', half-day' : ''})</span>
                          <Badge className="ml-auto capitalize" variant={r.status === 'approved' ? 'default' : 'outline'}>{r.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attendance</div>
                  {history.attendance.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                    <div className="flex max-h-40 flex-col divide-y overflow-y-auto text-sm">
                      {history.attendance.map(a => (
                        <div key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                          <span className="tnum">{a.date}</span>
                          <Badge variant="outline" className="capitalize">{a.status}</Badge>
                          {(a.in_time || a.out_time) && <span className="text-muted-foreground">{a.in_time || '—'} – {a.out_time || '—'}</span>}
                          {a.late_entry === 1 && <Badge variant="outline">Late</Badge>}
                          {a.early_exit === 1 && <Badge variant="outline">Early exit</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shift assignments</div>
                  {history.shifts.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                    <div className="flex max-h-40 flex-col divide-y overflow-y-auto text-sm">
                      {history.shifts.map(s => (
                        <div key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
                          <Badge variant="outline">{s.shift_name}</Badge>
                          <span className="text-muted-foreground">{s.from_date} → {s.to_date || 'ongoing'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EmployeesTab({ employees, designations, employmentTypes, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employees</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Employee</Button></CardAction>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No employees yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {employees.map(e => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelectedId(e.id)}>
                  <TableCell className="font-medium">{e.employee_code}</TableCell>
                  <TableCell>{e.name}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{e.employee_type}</TableCell>
                  <TableCell className="text-muted-foreground">{e.department || '—'}</TableCell>
                  <TableCell><Badge variant={e.active ? 'default' : 'outline'}>{e.active ? 'Active' : 'Exited'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddEmployeeDialog designations={designations} employmentTypes={employmentTypes} employees={employees} router={router} onClose={() => setDialogOpen(false)} />}
      {selectedId && <EmployeeDetailSheet employeeId={selectedId} employees={employees} router={router} onClose={() => setSelectedId(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Attendance tab
// ---------------------------------------------------------------------------------------------

function AttendanceRow({ a, today, busy, onMark }) {
  const [inTime, setInTime] = useState(a.in_time || '');
  const [outTime, setOutTime] = useState(a.out_time || '');
  const showTimes = a.status && a.status !== 'absent' && a.status !== 'leave';

  return (
    <TableRow>
      <TableCell className="font-medium">{a.name}</TableCell>
      <TableCell className="capitalize text-muted-foreground">{a.employee_type}</TableCell>
      <TableCell>
        <Select value={a.status || ''} onValueChange={v => onMark(a.employee_id, { status: v, in_time: inTime, out_time: outTime })} disabled={busy}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Unmarked" /></SelectTrigger>
          <SelectContent>{ATTENDANCE_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {showTimes && (
          <div className="flex items-center gap-1.5">
            <Input type="time" className="w-28" value={inTime} disabled={busy}
              onChange={e => setInTime(e.target.value)}
              onBlur={() => onMark(a.employee_id, { status: a.status, in_time: inTime, out_time: outTime })} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" className="w-28" value={outTime} disabled={busy}
              onChange={e => setOutTime(e.target.value)}
              onBlur={() => onMark(a.employee_id, { status: a.status, in_time: inTime, out_time: outTime })} />
            {a.late_entry === 1 && <Badge variant="outline">Late</Badge>}
            {a.early_exit === 1 && <Badge variant="outline">Early</Badge>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function AttendanceTab({ attendanceToday, today, router }) {
  const [busyId, setBusyId] = useState(null);

  async function mark(employeeId, fields) {
    setBusyId(employeeId);
    try {
      await api('/api/attendance', { method: 'POST', body: { employee_id: employeeId, date: today, ...fields } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Attendance — {today}</CardTitle></CardHeader>
      <CardContent>
        {attendanceToday.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No active employees.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>In – Out (optional)</TableHead></TableRow></TableHeader>
            <TableBody>
              {attendanceToday.map(a => (
                <AttendanceRow key={a.employee_id} a={a} today={today} busy={busyId === a.employee_id} onMark={mark} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Leave tab
// ---------------------------------------------------------------------------------------------

function NewLeaveRequestDialog({ employees, leaveTypes, onClose, router }) {
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [halfDayDate, setHalfDayDate] = useState('');
  const [approverId, setApproverId] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!employeeId || !leaveTypeId || !fromDate || !toDate) return showToast('All fields are required', 'error');
    setSaving(true);
    try {
      await api('/api/leave-requests', {
        method: 'POST',
        body: {
          employee_id: employeeId, leave_type_id: leaveTypeId, from_date: fromDate, to_date: toDate, reason,
          half_day: halfDay, half_day_date: halfDay ? (halfDayDate || fromDate) : null,
          approver_id: approverId || undefined,
        },
      });
      showToast('Leave request submitted');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Leave type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
              <SelectContent>{leaveTypes.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>From</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>To</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={halfDay} onCheckedChange={setHalfDay} />
            Half day
          </label>
          {halfDay && (
            <div className="grid gap-1.5"><Label>Half-day date</Label><Input type="date" value={halfDayDate || fromDate} onChange={e => setHalfDayDate(e.target.value)} /></div>
          )}
          <div className="grid gap-1.5">
            <Label>Approver (optional — defaults to reports-to manager)</Label>
            <Select value={approverId} onValueChange={setApproverId}>
              <SelectTrigger><SelectValue placeholder="Default (reports-to manager)" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTab({ employees, leaveTypes, pendingLeaveRequests, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function decide(id, status) {
    setBusyId(id);
    try {
      await api(`/api/leave-requests/${id}`, { method: 'PATCH', body: { status } });
      showToast(status === 'approved' ? 'Approved' : 'Rejected');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave Requests</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Request</Button></CardAction>
      </CardHeader>
      <CardContent>
        {pendingLeaveRequests.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No pending requests.</p> : (
          <div className="flex flex-col divide-y">
            {pendingLeaveRequests.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{r.employee_name}</span>
                <Badge variant="outline">{r.leave_type_name}</Badge>
                <span className="text-muted-foreground">{r.from_date} → {r.to_date} ({r.days}d{r.half_day ? ', half-day' : ''})</span>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')}><CheckIcon className="size-4" /></Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')}><XIcon className="size-4" /></Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <NewLeaveRequestDialog employees={employees} leaveTypes={leaveTypes} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Shifts + Holidays tabs
// ---------------------------------------------------------------------------------------------

function ShiftsTab({ shiftTypes, shiftAssignments, employees, router }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  async function addShiftType() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api('/api/shift-types', { method: 'POST', body: { name: name.trim(), start_time: start || null, end_time: end || null } });
      setName(''); setStart(''); setEnd('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Shift Types</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Shift name" value={name} onChange={e => setName(e.target.value)} />
            <Input type="time" value={start} onChange={e => setStart(e.target.value)} className="sm:w-32" />
            <Input type="time" value={end} onChange={e => setEnd(e.target.value)} className="sm:w-32" />
            <Button size="sm" onClick={addShiftType} disabled={saving}><PlusIcon /></Button>
          </div>
          <div className="flex flex-col divide-y">
            {shiftTypes.map(s => (
              <div key={s.id} className="flex justify-between py-2 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">{s.start_time || '—'} – {s.end_time || '—'}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {shiftAssignments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No shift assignments.</p> : (
            <div className="flex flex-col divide-y">
              {shiftAssignments.map(a => (
                <div key={a.id} className="flex justify-between py-2 text-sm">
                  <span className="font-medium">{a.employee_name}</span>
                  <Badge variant="outline">{a.shift_name}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HolidaysTab({ holidays, router }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!date) return showToast('Date is required', 'error');
    setSaving(true);
    try {
      await api('/api/holidays', { method: 'POST', body: { holiday_date: date, name: name || null } });
      setDate(''); setName('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Holiday Calendar</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="sm:w-44" />
          <Input placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
          <Button size="sm" onClick={add} disabled={saving}><PlusIcon />Add</Button>
        </div>
        <div className="flex flex-col divide-y">
          {holidays.map(h => (
            <div key={h.id} className="flex justify-between py-2 text-sm">
              <span className="tnum">{h.holiday_date}</span><span className="text-muted-foreground">{h.name || '—'}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Recruitment tab
// ---------------------------------------------------------------------------------------------

function NewOpeningDialog({ onClose, router }) {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return showToast('Title is required', 'error');
    setSaving(true);
    try {
      await api('/api/job-openings', { method: 'POST', body: { title: title.trim(), department: department || null } });
      showToast('Opening created');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Job Opening</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Department (optional)</Label><Input value={department} onChange={e => setDepartment(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Recruitment leftover: the "offered" column was a bare status label with no underlying
// job_offers record. This view/create panel closes that gap — offer_note stays free-text only,
// never a payroll figure (HARD BOUNDARY, same precedent lib/db.js's job_offers comment sets).
function OfferDialog({ applicant, onClose, router }) {
  const [offers, setOffers] = useState([]);
  const [offerNote, setOfferNote] = useState('');
  const [saving, setSaving] = useState(false);

  function load() { api(`/api/job-offers?applicant_id=${applicant.id}`).then(setOffers).catch(() => {}); }
  useEffect(load, [applicant.id]);

  async function createOffer() {
    setSaving(true);
    try {
      await api('/api/job-offers', { method: 'POST', body: { applicant_id: applicant.id, offer_note: offerNote || null } });
      setOfferNote('');
      load();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function setStatus(id, status) {
    setSaving(true);
    try {
      await api(`/api/job-offers/${id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Offer — {applicant.name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          {offers.map(o => (
            <div key={o.id} className="flex items-center gap-2 rounded border p-2 text-sm">
              <span className="flex-1">{o.offer_note || 'Offer'}</span>
              <Badge variant="outline" className="capitalize">{o.status}</Badge>
              {o.status === 'draft' && <Button size="sm" variant="outline" disabled={saving} onClick={() => setStatus(o.id, 'sent')}>Send</Button>}
              {o.status === 'sent' && (
                <>
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => setStatus(o.id, 'accepted')}>Accepted</Button>
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => setStatus(o.id, 'declined')}>Declined</Button>
                </>
              )}
            </div>
          ))}
          {offers.length === 0 && (
            <div className="flex flex-col gap-2">
              <Label>Offer note</Label>
              <Input value={offerNote} onChange={e => setOfferNote(e.target.value)} placeholder="Designation, CTC reference, start date, etc." />
              <Button size="sm" onClick={createOffer} disabled={saving}>{saving ? 'Creating…' : 'Create Offer'}</Button>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicantBoard({ opening, onBack, router }) {
  const [applicants, setApplicants] = useState([]);
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [offerApplicant, setOfferApplicant] = useState(null);

  function load() {
    api(`/api/job-applicants?job_opening_id=${opening.id}`).then(setApplicants).catch(() => {});
  }
  useEffect(load, [opening.id]);

  async function addApplicant() {
    if (!name.trim()) return;
    try {
      await api('/api/job-applicants', { method: 'POST', body: { job_opening_id: opening.id, name: name.trim() } });
      setName('');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function move(applicant, status) {
    setBusyId(applicant.id);
    try {
      const res = await api(`/api/job-applicants/${applicant.id}`, { method: 'PATCH', body: { status } });
      if (status === 'hired') {
        showToast(`Hired — employee ${res.employee_code} created`);
        router.refresh();
      }
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{opening.title} — Applicants</CardTitle>
        <CardAction><Button size="sm" variant="outline" onClick={onBack}>Back to Openings</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input placeholder="Applicant name" value={name} onChange={e => setName(e.target.value)} />
          <Button size="sm" onClick={addApplicant}><PlusIcon />Add</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {APPLICANT_STAGES.map(stage => (
            <div
              key={stage}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                const id = Number(e.dataTransfer.getData('text/plain'));
                const a = applicants.find(x => x.id === id);
                if (a) move(a, stage);
              }}
              className="flex min-h-[8rem] flex-col gap-2 rounded-lg border bg-muted/30 p-2"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage}</div>
              {applicants.filter(a => a.status === stage).map(a => (
                <div key={a.id} draggable={busyId !== a.id}
                  onDragStart={e => e.dataTransfer.setData('text/plain', String(a.id))}
                  onClick={() => stage === 'offered' && setOfferApplicant(a)}
                  className={`rounded-md border bg-background px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing ${stage === 'offered' ? 'cursor-pointer hover:bg-muted/50' : 'cursor-grab'}`}>
                  {a.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
      {offerApplicant && <OfferDialog applicant={offerApplicant} router={router} onClose={() => setOfferApplicant(null)} />}
    </Card>
  );
}

function RecruitmentTab({ jobOpenings, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  if (selected) return <ApplicantBoard opening={selected} onBack={() => setSelected(null)} router={router} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Openings</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Opening</Button></CardAction>
      </CardHeader>
      <CardContent>
        {jobOpenings.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No openings yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead><TableHead>Applicants</TableHead></TableRow></TableHeader>
            <TableBody>
              {jobOpenings.map(o => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => setSelected(o)}>
                  <TableCell className="font-medium">{o.title}</TableCell>
                  <TableCell className="text-muted-foreground">{o.department || '—'}</TableCell>
                  <TableCell><Badge variant={o.status === 'open' ? 'default' : 'outline'}>{o.status}</Badge></TableCell>
                  <TableCell className="tnum">{o.applicant_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <NewOpeningDialog router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export default function HrWorkspace({
  employees, designations, employmentTypes, leaveTypes, pendingLeaveRequests, holidays,
  shiftTypes, shiftAssignments, jobOpenings, attendanceToday, today,
  salaryStructures, salaryAssignments, payrollRuns, salarySlips, statutoryRates,
  ptSlabs, taxSlabs, employeeLoans, additionalSalary, expenseClaimTypes, expenseClaims, employeeAdvances,
}) {
  const router = useRouter();
  const [tab, setTab] = useState('employees');

  const navItems = [
    { key: 'employees', label: 'Employees', icon: UsersIcon },
    { key: 'attendance', label: 'Attendance', icon: CalendarDaysIcon },
    { key: 'leave', label: 'Leave', icon: CalendarDaysIcon },
    { key: 'shifts', label: 'Shifts', icon: Clock3Icon },
    { key: 'holidays', label: 'Holidays', icon: CalendarDaysIcon },
    { key: 'recruitment', label: 'Recruitment', icon: UserPlusIcon },
    { key: 'payroll', label: 'Payroll', icon: IndianRupeeIcon },
    { key: 'expenses', label: 'Expenses', icon: ReceiptIcon },
  ];

  return (
    <WorkspaceSidebar title="HR" icon={UsersIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'employees' && <EmployeesTab employees={employees} designations={designations} employmentTypes={employmentTypes} router={router} />}
      {tab === 'attendance' && <AttendanceTab attendanceToday={attendanceToday} today={today} router={router} />}
      {tab === 'leave' && <LeaveTab employees={employees} leaveTypes={leaveTypes} pendingLeaveRequests={pendingLeaveRequests} router={router} />}
      {tab === 'shifts' && <ShiftsTab shiftTypes={shiftTypes} shiftAssignments={shiftAssignments} employees={employees} router={router} />}
      {tab === 'holidays' && <HolidaysTab holidays={holidays} router={router} />}
      {tab === 'recruitment' && <RecruitmentTab jobOpenings={jobOpenings} router={router} />}
      {tab === 'payroll' && (
        <PayrollWorkspace nested
          employees={employees} payrollRuns={payrollRuns} salarySlips={salarySlips}
          salaryStructures={salaryStructures} salaryAssignments={salaryAssignments}
          statutoryRates={statutoryRates} ptSlabs={ptSlabs} taxSlabs={taxSlabs}
          additionalSalary={additionalSalary} router={router}
        />
      )}
      {tab === 'expenses' && (
        <ExpensesWorkspace nested
          employees={employees} expenseClaims={expenseClaims} expenseClaimTypes={expenseClaimTypes}
          employeeAdvances={employeeAdvances} employeeLoans={employeeLoans} router={router}
        />
      )}
    </WorkspaceSidebar>
  );
}
