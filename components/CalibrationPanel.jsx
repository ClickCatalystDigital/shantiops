'use client';

// STERP items 34/35 (§5p) — Instrument + Jigs/Fixtures Calibration. Not project-scoped (equipment,
// not a project record) — lives on the QC workspace's own Calibration tab, not a project tab.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { PlusIcon, XIcon } from 'lucide-react';

const STATUS_TONE = {
  ok: 'bg-success/10 text-success ring-success/20',
  due_soon: 'bg-warning/10 text-warning ring-warning/20',
  expired: 'bg-danger/10 text-danger ring-danger/20',
  blocked: 'bg-muted text-muted-foreground ring-border',
};
const STATUS_LABEL = { ok: 'OK', due_soon: 'Due soon', expired: 'Expired', blocked: 'Blocked' };
const TYPE_LABEL = { instrument: 'Instrument', jig_fixture: 'Jig / Fixture' };

const EMPTY = { type: 'instrument', name: '', identifier: '', schedule_months: '', certificate_ref: '', last_calibrated_on: '', due_date: '' };

function AddDialog({ router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function submit() {
    if (!form.name.trim()) return showToast('Name is required', 'error');
    setBusy(true);
    try {
      await api('/api/calibration-items', { method: 'POST', body: form });
      showToast('Calibration item added');
      setForm(EMPTY);
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon data-icon="inline-start" />Add item</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add calibration item</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instrument">Instrument</SelectItem>
                  <SelectItem value="jig_fixture">Jig / Fixture</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Identifier / tag no.</Label>
              <Input value={form.identifier} onChange={set('identifier')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={set('name')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Schedule (months)</Label>
              <Input type="number" value={form.schedule_months} onChange={set('schedule_months')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Certificate ref</Label>
              <Input value={form.certificate_ref} onChange={set('certificate_ref')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Last calibrated</Label>
              <Input type="date" value={form.last_calibrated_on} onChange={set('last_calibrated_on')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={set('due_date')} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CalibrationPanel({ items = [], canEdit = false }) {
  const router = useRouter();

  async function toggleBlocked(id, blocked) {
    try {
      await api(`/api/calibration-items/${id}`, { method: 'PATCH', body: { blocked } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function remove(id) {
    try {
      await api(`/api/calibration-items/${id}`, { method: 'DELETE' });
      showToast('Removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration</CardTitle>
        {canEdit && <CardAction><AddDialog router={router} /></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No instruments or jigs/fixtures on the calibration register yet.</p>}
        {items.map(it => (
          <div key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="font-medium">{it.name}</span>
            <span className="text-xs text-muted-foreground">{TYPE_LABEL[it.type]}</span>
            {it.identifier && <span className="text-muted-foreground">{it.identifier}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[it.status]}`}>{STATUS_LABEL[it.status]}</span>
            <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              {it.due_date && <span className="tnum">Due {formatDate(it.due_date)}</span>}
              {canEdit && (
                <>
                  <button type="button" className="underline underline-offset-2" onClick={() => toggleBlocked(it.id, !it.blocked)}>
                    {it.blocked ? 'Unblock' : 'Block'}
                  </button>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => remove(it.id)}>
                    <XIcon />
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
