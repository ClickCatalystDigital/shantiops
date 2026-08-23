'use client';

// Non-Conformance Report register + raise/disposition/close dialogs (plan §5e). RaiseNcrDialog is
// exported standalone so both QC (QcPanel.jsx, from a failed test row) and Production
// (WorkersPanel.jsx, from a job card) can raise one — same access decision as POST /api/ncrs
// ("QC and Production"), and the UI has to actually reach both, not just the API.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangleIcon } from 'lucide-react';

const SEVERITY_TONE = {
  minor: 'bg-muted text-muted-foreground ring-border',
  major: 'bg-warning/10 text-warning ring-warning/20',
  critical: 'bg-danger/10 text-danger ring-danger/20',
};
const STATUS_TONE = {
  open: 'bg-warning/10 text-warning ring-warning/20',
  dispositioned: 'bg-info/10 text-info ring-info/20',
  closed: 'bg-success/10 text-success ring-success/20',
};
const DISPOSITION_LABEL = { rework: 'Rework', repair: 'Repair', scrap: 'Scrap', use_as_is: 'Use as-is' };

// Reusable raise dialog — pass whichever single link this NCR is against (qcRecordId, jobCardId,
// bomItemId, workOrderId, or a bare projectId for a field-found defect with no upstream link yet).
export function RaiseNcrDialog({ open, onOpenChange, projectId, qcRecordId, jobCardId, bomItemId, workOrderId, onRaised }) {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!description.trim()) return showToast('Description is required', 'error');
    setBusy(true);
    try {
      await api('/api/ncrs', {
        method: 'POST',
        body: {
          project_id: projectId, qc_record_id: qcRecordId, job_card_id: jobCardId,
          bom_item_id: bomItemId, work_order_id: workOrderId, description, severity,
        },
      });
      showToast('NCR raised');
      setDescription(''); setSeverity('minor');
      onOpenChange(false);
      await onRaised?.();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise NCR</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minor">Minor</SelectItem>
                <SelectItem value="major">Major</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Raising…' : 'Raise NCR'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DispositionDialog({ ncr, onClose, router }) {
  const [disposition, setDisposition] = useState('rework');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const notesRequired = ['scrap', 'use_as_is'].includes(disposition);

  async function submit() {
    if (notesRequired && !notes.trim()) return showToast('Notes are required for scrap / use-as-is', 'error');
    setBusy(true);
    try {
      await api(`/api/ncrs/${ncr.id}/disposition`, {
        method: 'POST', body: { disposition, disposition_notes: notes },
      });
      showToast('NCR dispositioned');
      onClose();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Disposition {ncr.ncr_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{ncr.description}</p>
          <div className="flex flex-col gap-1.5">
            <Label>Disposition</Label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!ncr.job_card_id ? null : (
                  <>
                    <SelectItem value="rework">Rework</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                  </>
                )}
                <SelectItem value="scrap">Scrap</SelectItem>
                <SelectItem value="use_as_is">Use as-is</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes {notesRequired && <span className="text-danger">*</span>}</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Disposition'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NcrPanel({ ncrs = [], canDisposition = false }) {
  const router = useRouter();
  const [dispositioning, setDispositioning] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function close(id) {
    setBusyId(id);
    try {
      await api(`/api/ncrs/${id}/close`, { method: 'POST' });
      showToast('NCR closed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader><CardTitle>NCR Register</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y">
        {ncrs.length === 0 && <p className="text-sm text-muted-foreground">No NCRs raised.</p>}
        {ncrs.map(n => (
          <div key={n.id} className="flex flex-col gap-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangleIcon className="size-4 text-muted-foreground" />
              <span className="font-medium">{n.ncr_no}</span>
              <span className="text-muted-foreground">{n.project_no}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_TONE[n.severity]}`}>{n.severity}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[n.status]}`}>
                {n.status === 'dispositioned' ? `Dispositioned — ${DISPOSITION_LABEL[n.disposition] || n.disposition}` : n.status}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tnum">{formatDate(n.raised_at)}</span>
            </div>
            <p className="text-muted-foreground">{n.description}</p>
            {canDisposition && n.status === 'open' && (
              <Button size="sm" variant="outline" className="self-start" onClick={() => setDispositioning(n)}>Disposition</Button>
            )}
            {canDisposition && n.status === 'dispositioned' && (
              <Button size="sm" variant="outline" className="self-start" disabled={busyId === n.id} onClick={() => close(n.id)}>Close</Button>
            )}
          </div>
        ))}
      </CardContent>
      {dispositioning && <DispositionDialog ncr={dispositioning} router={router} onClose={() => setDispositioning(null)} />}
    </Card>
  );
}
