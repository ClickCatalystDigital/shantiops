'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { categoryOf, DEPARTMENTS, DELAY_CATEGORIES } from '@/lib/milestones';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatusBadge from './StatusBadge';

const STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
const FIELDS = ['assignee', 'department', 'status', 'planned_start', 'planned_end', 'actual_start',
  'actual_end', 'delay_category', 'delay_reason', 'vendor', 'po_no', 'material_ready', 'qc_ok', 'notes'];

// IST, not UTC: a plain toISOString().slice(0,10) rolls the date over 5.5h early for the factory
// (see lib/date.js). This matters here specifically — the Start/Close buttons send actual_start/
// actual_end explicitly in the body, bypassing the server's own auto-stamp fallback.
const today = todayISO;

function Field({ label, children }) {
  return <div className="flex flex-col gap-1.5"><Label>{label}</Label>{children}</div>;
}

export default function MilestoneDrawer({ milestone, head = false, onClose }) {
  const router = useRouter();
  const cat = categoryOf(milestone.milestone_key);
  const [f, setF] = useState(() => {
    const init = {};
    FIELDS.forEach(k => { init[k] = milestone[k] ?? ''; });
    return init;
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    const body = { ...f, material_ready: f.material_ready ? 1 : 0, qc_ok: f.qc_ok ? 1 : 0 };
    try {
      await api(`/api/milestones/${milestone.id}`, { method: 'PATCH', body });
      showToast('Milestone updated');
      onClose();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }

  const body = head
    ? <HeadBody milestone={milestone} onClose={onClose} router={router} />
    : (
      <>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee"><Input value={f.assignee} onChange={e => set('assignee', e.target.value)} /></Field>
            <Field label="Department">
              <Select value={f.department || undefined} onValueChange={v => set('department', v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Status">
            <Select value={f.status || undefined} onValueChange={v => set('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned Start"><Input type="date" value={f.planned_start} onChange={e => set('planned_start', e.target.value)} /></Field>
            <Field label="Planned End"><Input type="date" value={f.planned_end} onChange={e => set('planned_end', e.target.value)} /></Field>
            <Field label="Actual Start"><Input type="date" value={f.actual_start} onChange={e => set('actual_start', e.target.value)} /></Field>
            <Field label="Actual End"><Input type="date" value={f.actual_end} onChange={e => set('actual_end', e.target.value)} /></Field>
          </div>

          {cat === 'procurement' && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Vendor"><Input value={f.vendor} onChange={e => set('vendor', e.target.value)} /></Field>
                <Field label="PO No"><Input value={f.po_no} onChange={e => set('po_no', e.target.value)} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!f.material_ready} onCheckedChange={v => set('material_ready', v)} /> Material received / ready
              </label>
            </>
          )}
          {cat === 'qc' && (
            <>
              <Separator />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!f.qc_ok} onCheckedChange={v => set('qc_ok', v)} /> QC passed
              </label>
            </>
          )}

          <Separator />
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">If delayed</div>
          <Field label="Delay Category">
            <Select value={f.delay_category || undefined} onValueChange={v => set('delay_category', v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{DELAY_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Delay Reason"><Input value={f.delay_reason} onChange={e => set('delay_reason', e.target.value)} placeholder="e.g. Pump vendor delay" /></Field>
          <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
        <SheetFooter>
          <Button className="w-full" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </SheetFooter>
      </>
    );

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{milestone.milestone_label}</SheetTitle>
            <StatusBadge m={milestone} />
          </div>
          <SheetDescription>{milestone.department} · {cat}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

// Reduced view for functional heads: read-only schedule + Start / Close (late close asks why).
function HeadBody({ milestone: m, onClose, router }) {
  const [busy, setBusy] = useState(false);
  const [lateClose, setLateClose] = useState(false);
  const [delay, setDelay] = useState({ delay_category: m.delay_category || '', delay_reason: m.delay_reason || '' });
  const started = !!m.actual_start || m.status === 'in_progress' || m.status === 'done';
  const done = !!m.actual_end || m.status === 'done';
  const isLate = m.planned_end && today() > m.planned_end;

  async function patch(body, msg) {
    setBusy(true);
    try {
      await api(`/api/milestones/${m.id}`, { method: 'PATCH', body });
      showToast(msg); onClose(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  const start = () => patch({ status: 'in_progress', actual_start: today() }, 'Milestone started');
  function close() {
    if (isLate && !lateClose) { setLateClose(true); return; }
    const body = { status: 'done', actual_end: today() };
    if (isLate) { body.delay_category = delay.delay_category; body.delay_reason = delay.delay_reason; }
    patch(body, 'Milestone closed');
  }

  const RO = ({ label, value }) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="rounded-md bg-muted px-3 py-2 text-sm tnum">{value || '—'}</span>
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <RO label="Assignee" value={m.assignee} />
          <RO label="Department" value={m.department} />
          <RO label="Planned Start" value={m.planned_start} />
          <RO label="Planned End" value={m.planned_end} />
          <RO label="Actual Start" value={m.actual_start} />
          <RO label="Actual End" value={m.actual_end} />
        </div>
        {lateClose && (
          <>
            <Separator />
            <div className="text-sm font-medium text-warning">This is closing late — why?</div>
            <Field label="Delay Category">
              <Select value={delay.delay_category || undefined} onValueChange={v => setDelay(d => ({ ...d, delay_category: v }))}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{DELAY_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Delay Reason">
              <Input value={delay.delay_reason} onChange={e => setDelay(d => ({ ...d, delay_reason: e.target.value }))} placeholder="e.g. MS plate shortage" />
            </Field>
          </>
        )}
      </div>
      <SheetFooter>
        {!done && !started && <Button className="w-full" disabled={busy} onClick={start}>Start</Button>}
        {!done && started && <Button className="w-full" disabled={busy} onClick={close}>{lateClose ? 'Confirm Close (late)' : 'Close'}</Button>}
        {done && <p className="w-full text-center text-sm text-muted-foreground">This milestone is complete.</p>}
      </SheetFooter>
    </>
  );
}
