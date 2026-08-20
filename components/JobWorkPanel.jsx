'use client';

// STERP item 33 (§5p) — Job-Work Inspection: material sent to an outside job worker. Same
// whole-row-ownership shape as QcPanel, just its own fields (sent/received qty+date, variance
// computed live in lib/data.js) instead of test_type/reference_no.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
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

const EMPTY = { job_worker_name: '', job_worker_contact: '', sent_date: '', expected_return_date: '', sent_qty: '', received_qty: '', received_date: '', result: 'pending', notes: '' };

function AddDialog({ projectId, router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function submit() {
    if (!form.job_worker_name.trim()) return showToast('Job worker name is required', 'error');
    setBusy(true);
    try {
      await api('/api/job-work-inspections', { method: 'POST', body: { project_id: projectId, ...form } });
      showToast('Job-work inspection added');
      setForm(EMPTY);
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon data-icon="inline-start" />Send material</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Job-Work Inspection</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Job worker</Label>
              <Input value={form.job_worker_name} onChange={set('job_worker_name')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Contact</Label>
              <Input value={form.job_worker_contact} onChange={set('job_worker_contact')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Sent date</Label>
              <Input type="date" value={form.sent_date} onChange={set('sent_date')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Expected return</Label>
              <Input type="date" value={form.expected_return_date} onChange={set('expected_return_date')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Sent qty</Label>
              <Input type="number" value={form.sent_qty} onChange={set('sent_qty')} />
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
              <Label>Received qty</Label>
              <Input type="number" value={form.received_qty} onChange={set('received_qty')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Received date</Label>
              <Input type="date" value={form.received_date} onChange={set('received_date')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function JobWorkPanel({ projectId, records = [], canEdit = false }) {
  const router = useRouter();

  async function setResult(id, result) {
    try {
      await api(`/api/job-work-inspections/${id}`, { method: 'PATCH', body: { result } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function remove(id) {
    try {
      await api(`/api/job-work-inspections/${id}`, { method: 'DELETE' });
      showToast('Removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job-Work Inspection</CardTitle>
        {canEdit && <CardAction><AddDialog projectId={projectId} router={router} /></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {records.length === 0 && <p className="text-sm text-muted-foreground">No material sent to outside job workers yet.</p>}
        {records.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="font-medium">{r.job_worker_name}</span>
            {r.sent_qty != null && <span className="tnum text-muted-foreground">Sent {r.sent_qty}</span>}
            {r.received_qty != null && <span className="tnum text-muted-foreground">Received {r.received_qty}</span>}
            {r.variance_qty != null && r.variance_qty !== 0 && (
              <span className="tnum text-warning">Variance {r.variance_qty}</span>
            )}
            <ResultPill value={r.result} disabled={!canEdit} onChange={v => setResult(r.id, v)} />
            <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              {r.expected_return_date && <span className="tnum">Due {formatDate(r.expected_return_date)}</span>}
              {canEdit && (
                <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => remove(r.id)}>
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
