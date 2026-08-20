'use client';

// QC's test/inspection log — hydro test, radiography/NDE, material test certificates (MTC), one
// row per test. Whole-row QC ownership (unlike the BOM's field-level scoping): no other department
// needs to write part of a QC record.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { PlusIcon, XIcon } from 'lucide-react';

const RESULT_TONE = {
  pass: 'bg-success/10 text-success ring-success/20',
  fail: 'bg-danger/10 text-danger ring-danger/20',
  pending: 'bg-warning/10 text-warning ring-warning/20',
};

function ResultPill({ value, onChange, disabled }) {
  if (disabled) {
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${RESULT_TONE[value]}`}>{value}</span>;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-6 w-24 rounded-full px-2 text-xs capitalize ring-1 ring-inset ${RESULT_TONE[value]}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="pass">Pass</SelectItem>
        <SelectItem value="fail">Fail</SelectItem>
      </SelectContent>
    </Select>
  );
}

function AddRecordDialog({ projectId, router, defaultTestType, linkField, linkOptions }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ test_type: defaultTestType || '', reference_no: '', result: 'pending', inspector: '', tested_on: '', notes: '', [linkField || '_link']: '' });

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function submit() {
    if (!form.test_type.trim()) return showToast('Test type is required', 'error');
    setBusy(true);
    try {
      const body = { project_id: projectId, ...form };
      if (linkField && body[linkField]) body[linkField] = Number(body[linkField]);
      await api('/api/qc-records', { method: 'POST', body });
      showToast('Record added');
      setForm({ test_type: defaultTestType || '', reference_no: '', result: 'pending', inspector: '', tested_on: '', notes: '', [linkField || '_link']: '' });
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon data-icon="inline-start" />Add record</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add QC record</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Test type</Label>
            {defaultTestType ? (
              <Input value={form.test_type} disabled />
            ) : (
              <Input value={form.test_type} onChange={set('test_type')} placeholder="Hydro test, Radiography, MTC…" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Reference / cert no.</Label>
              <Input value={form.reference_no} onChange={set('reference_no')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Result</Label>
              <Select value={form.result} onValueChange={v => setForm(f => ({ ...f, result: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="pass">Pass</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Inspector</Label>
              <Input value={form.inspector} onChange={set('inspector')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tested on</Label>
              <Input type="date" value={form.tested_on} onChange={set('tested_on')} />
            </div>
          </div>
          {linkField && linkOptions && (
            <div className="flex flex-col gap-1.5">
              <Label>{linkField === 'work_order_id' ? 'Work Order' : linkField === 'assembly_id' ? 'Assembly' : 'Linked to'}</Label>
              <Select value={form[linkField]} onValueChange={v => setForm(f => ({ ...f, [linkField]: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {linkOptions.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add record'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QcPanel({
  projectId, records = [], canEdit = false, title = 'QC Records', defaultTestType = null,
  reworkMilestoneId = null, linkField = null, linkOptions = null, showDispatchToggle = false,
}) {
  const router = useRouter();
  const [reworking, setReworking] = useState(null);
  const linkLabel = id => linkOptions?.find(o => String(o.id) === String(id))?.label;

  async function setResult(id, result) {
    try {
      await api(`/api/qc-records/${id}`, { method: 'PATCH', body: { result } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function toggleDispatchEligible(id, value) {
    try {
      await api(`/api/qc-records/${id}`, { method: 'PATCH', body: { dispatch_eligible: value } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function remove(id) {
    try {
      await api(`/api/qc-records/${id}`, { method: 'DELETE' });
      showToast('QC record removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // A failed record can spin up a rework card directly instead of someone re-navigating to Job
  // Card and re-picking the milestone by hand — reworkMilestoneId is only ever passed for the
  // hydro-test instance of this panel (Production owns both the milestone and the rework path).
  async function createRework(record) {
    setReworking(record.id);
    try {
      await api('/api/job-cards', {
        method: 'POST',
        body: { milestone_id: reworkMilestoneId, qc_record_id: record.id, notes: `Rework — failed ${record.test_type}${record.reference_no ? ` (${record.reference_no})` : ''}` },
      });
      showToast('Rework card created on the Job Card board');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setReworking(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {canEdit && <CardAction><AddRecordDialog projectId={projectId} router={router} defaultTestType={defaultTestType} linkField={linkField} linkOptions={linkOptions} /></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {records.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {defaultTestType ? `No ${defaultTestType.toLowerCase()} records logged yet.` : 'No tests logged yet — hydro test, radiography/NDE, material test certificates.'}
          </p>
        )}
        {records.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="font-medium">{r.test_type}</span>
            {r.reference_no && <span className="text-muted-foreground">{r.reference_no}</span>}
            {linkField && r[linkField] && linkLabel(r[linkField]) && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{linkLabel(r[linkField])}</span>
            )}
            <ResultPill value={r.result} disabled={!canEdit} onChange={v => setResult(r.id, v)} />
            {showDispatchToggle && (
              <button type="button" disabled={!canEdit}
                onClick={() => canEdit && toggleDispatchEligible(r.id, !r.dispatch_eligible)}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${r.dispatch_eligible ? 'bg-success/10 text-success ring-success/20' : 'bg-muted text-muted-foreground ring-border'}`}>
                {r.dispatch_eligible ? 'Dispatch eligible' : 'Not dispatch eligible'}
              </button>
            )}
            {canEdit && reworkMilestoneId && r.result === 'fail' && (
              <Button size="sm" variant="outline" disabled={reworking === r.id} onClick={() => createRework(r)}>
                {reworking === r.id ? 'Creating…' : 'Create rework card'}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              {r.inspector && <span>{r.inspector}</span>}
              {r.tested_on && <span className="tnum">{formatDate(r.tested_on)}</span>}
              {canEdit && (
                <Button size="icon-sm" variant="ghost" aria-label="Remove record" onClick={() => remove(r.id)}>
                  <XIcon />
                </Button>
              )}
            </span>
            {r.notes && <p className="w-full text-xs text-muted-foreground">{r.notes}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
