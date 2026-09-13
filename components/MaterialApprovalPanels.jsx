'use client';

// components/MaterialApprovalPanels.jsx — the Inward + Pre-Dispatch QC/Production Approval
// Workflow's UI, lived here as three department-local panels rather than one standalone workspace.
// Per direct instruction: no shared cross-department Approvals page — QC/Production/Dispatch each
// reach their own slice from their own existing workspace's own sidebar, no project-page or
// packing-list-page actions. Superseded the retired /material-review route and
// MaterialReviewWorkspace.jsx (same backend routes/tables, zero change to the approval workflow
// itself — this file only relocates where the UI is reached from).
//
// InwardApprovalsPanel   — QC's own Approvals > Inward tab. QC decides; nobody else sees this tab.
// PreDispatchApprovalsPanel — QC's Approvals > Pre-Dispatch tab (QC decides its own slot) AND
//   Production's Approvals tab (Production decides its own slot) — same component, different
//   canDecideQc/canDecideProduction booleans depending on which department's page renders it, so a
//   dual-department user acts on each department's own decision only from that department's own
//   page, never both from one place.
// DispatchApprovalsPanel — Dispatch's own Approvals tab: Submit/Resubmit (the action that used to
//   live inline on PackingDetail.jsx) + read-only status for every packing list still 'packed'.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api, showToast, formatDate } from '@/lib/client';

function DecisionButtons({ canDecide, onDecide, busy }) {
  const [reason, setReason] = useState('');
  if (!canDecide) return <p className="text-xs text-muted-foreground">Only the department Head can decide.</p>;
  return (
    <div className="flex flex-col gap-2">
      <Textarea placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide('approved', reason)}>Approve</Button>
        <Button size="sm" variant="outline" className="text-danger hover:text-danger" disabled={busy}
          onClick={() => onDecide('rejected', reason)}>Reject</Button>
      </div>
    </div>
  );
}

// ---------- Inward ----------

function InwardDetailDialog({ id, canDecide, onClose }) {
  const router = useRouter();
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/api/inward-approvals/${id}`).then(setDetail).catch(err => showToast(err.message, 'error')); }, [id]);

  async function decide(decision, reason) {
    setBusy(true);
    try {
      await api(`/api/inward-approvals/${id}/decide`, { method: 'POST', body: { decision, reason: reason || undefined } });
      showToast(decision === 'approved' ? 'Approved — material is now usable stock' : 'Rejected');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function resubmit() {
    setBusy(true);
    try {
      await api(`/api/inward-approvals/${id}/resubmit`, { method: 'POST' });
      showToast('Resubmitted for review');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Inward Review</DialogTitle></DialogHeader>
        {!detail ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="flex flex-col gap-3 text-sm">
            <div><span className="font-medium">{detail.material_description}</span> · {detail.moc}</div>
            <div className="text-xs text-muted-foreground">
              {detail.project_no || 'No project'} — {detail.customer_name}<br />
              Received {detail.qty_received} on {formatDate(detail.received_at)} by {detail.received_by}
              {detail.lot_label ? ` · Lot ${detail.lot_label}` : ''}
            </div>
            {detail.pieces?.length > 0 && (
              <div className="text-xs">
                {detail.pieces.length} piece{detail.pieces.length === 1 ? '' : 's'} held: {detail.pieces.map(p => p.code || p.id).join(', ')}
              </div>
            )}
            {detail.history.length > 1 && (
              <div className="rounded border p-2 text-xs">
                <p className="mb-1 font-medium">Review history</p>
                {detail.history.slice(0, -1).map(h => (
                  <div key={h.id} className="border-b py-1 last:border-0">
                    <Badge variant={h.status === 'approved' ? 'default' : 'destructive'}>{h.status}</Badge>{' '}
                    {h.decided_by} on {formatDate(h.decided_at)}{h.reason ? ` — ${h.reason}` : ''}
                  </div>
                ))}
              </div>
            )}
            {detail.status === 'pending' && <DecisionButtons canDecide={canDecide} busy={busy} onDecide={decide} />}
            {detail.status === 'rejected' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-danger">Rejected{detail.reason ? ` — ${detail.reason}` : ''} by {detail.decided_by} on {formatDate(detail.decided_at)}</p>
                {canDecide && <Button size="sm" disabled={busy} onClick={resubmit}>Resubmit for review</Button>}
              </div>
            )}
            {detail.status === 'approved' && (
              <p className="text-xs text-success">Approved by {detail.decided_by} on {formatDate(detail.decided_at)}</p>
            )}
          </div>
        )}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InwardApprovalsPanel({ rows = [], canDecide = false }) {
  const [openId, setOpenId] = useState(null);
  return (
    <Card>
      <CardContent className="py-4">
        {!rows.length ? <p className="text-sm text-muted-foreground">No material awaiting inward review.</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Material</TableHead><TableHead>Project</TableHead>
              <TableHead>Qty</TableHead><TableHead>Received</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell>{r.material_description}</TableCell>
                  <TableCell>{r.project_no || '—'}</TableCell>
                  <TableCell>{r.qty_received}</TableCell>
                  <TableCell>{formatDate(r.received_at)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Review</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {openId != null && <InwardDetailDialog id={openId} canDecide={canDecide} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

// ---------- Pre-Dispatch ----------

function PreDispatchDetailDialog({ id, canDecideQc, canDecideProduction, onClose }) {
  const router = useRouter();
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/api/pre-dispatch-approvals/${id}`).then(setDetail).catch(err => showToast(err.message, 'error')); }, [id]);

  async function decide(role, decision, reason) {
    setBusy(true);
    try {
      await api(`/api/pre-dispatch-approvals/${id}/decide`, { method: 'POST', body: { role, decision, reason: reason || undefined } });
      showToast(decision === 'approved' ? 'Approved' : 'Rejected');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const a = detail?.approval;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Pre-Dispatch Review</DialogTitle></DialogHeader>
        {!detail ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <span className="font-medium">{detail.packing.list.packing_no}</span> — {detail.packing.list.customer_name}
              <p className="text-xs text-muted-foreground">{detail.packing.items.length} item{detail.packing.items.length === 1 ? '' : 's'}</p>
            </div>
            {detail.qcRecords.length > 0 && (
              <div className="text-xs">
                <p className="mb-1 font-medium">QC records (context — not the gate itself)</p>
                {detail.qcRecords.map(q => (
                  <div key={q.id}>{q.test_type}: {q.result}{q.dispatch_eligible ? ' · dispatch-eligible' : ''}</div>
                ))}
              </div>
            )}
            {detail.qcDocuments.length > 0 && (
              <div className="text-xs">
                <p className="mb-1 font-medium">Statutory documents</p>
                {detail.qcDocuments.map(d => <div key={d.id}>{d.doc_id} ({d.series}){d.customer_visible ? ' · shared' : ''}</div>)}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium">QC decision</p>
                {a.qc_decision ? (
                  <p className="text-xs">
                    <Badge variant={a.qc_decision === 'approved' ? 'default' : 'destructive'}>{a.qc_decision}</Badge>{' '}
                    {a.qc_decided_by} · {formatDate(a.qc_decided_at)}{a.qc_reason ? ` — ${a.qc_reason}` : ''}
                  </p>
                ) : <DecisionButtons canDecide={canDecideQc} busy={busy} onDecide={(d, r) => decide('qc', d, r)} />}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Production decision</p>
                {a.production_decision ? (
                  <p className="text-xs">
                    <Badge variant={a.production_decision === 'approved' ? 'default' : 'destructive'}>{a.production_decision}</Badge>{' '}
                    {a.production_decided_by} · {formatDate(a.production_decided_at)}{a.production_reason ? ` — ${a.production_reason}` : ''}
                  </p>
                ) : <DecisionButtons canDecide={canDecideProduction} busy={busy} onDecide={(d, r) => decide('production', d, r)} />}
              </div>
            </div>
            {detail.history.length > 1 && (
              <div className="rounded border p-2 text-xs">
                <p className="mb-1 font-medium">Prior cycles</p>
                {detail.history.slice(0, -1).map(h => (
                  <div key={h.id} className="border-b py-1 last:border-0">
                    <Badge variant={h.status === 'approved' ? 'default' : 'destructive'}>{h.status}</Badge>{' '}
                    QC: {h.qc_decision || '—'}{h.qc_reason ? ` (${h.qc_reason})` : ''} · Production: {h.production_decision || '—'}{h.production_reason ? ` (${h.production_reason})` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PreDispatchApprovalsPanel({ rows = [], canDecideQc = false, canDecideProduction = false }) {
  const [openId, setOpenId] = useState(null);
  return (
    <Card>
      <CardContent className="py-4">
        {!rows.length ? <p className="text-sm text-muted-foreground">No Packing Lists awaiting review.</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Packing List</TableHead><TableHead>Project</TableHead>
              <TableHead>QC</TableHead><TableHead>Production</TableHead><TableHead>Submitted</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell>{r.packing_no}</TableCell>
                  <TableCell>{r.project_no || '—'}</TableCell>
                  <TableCell>{r.qc_decision || 'Pending'}</TableCell>
                  <TableCell>{r.production_decision || 'Pending'}</TableCell>
                  <TableCell>{formatDate(r.submitted_at)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Review</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {openId != null && (
        <PreDispatchDetailDialog id={openId} canDecideQc={canDecideQc} canDecideProduction={canDecideProduction}
          onClose={() => setOpenId(null)} />
      )}
    </Card>
  );
}

// ---------- Dispatch ----------

const APPROVAL_BADGE = {
  pending: ['secondary', 'Pending review'],
  approved: ['default', 'Approved — ready to dispatch'],
  rejected: ['destructive', 'Rejected'],
};

// Dispatch's own Approvals tab — the Submit/Resubmit action that used to live inline on
// PackingDetail.jsx, plus read-only status for every packing list still 'packed' (once dispatched a
// list drops off this queue — see getDispatchApprovalQueue()'s own comment). Dispatch never decides
// either side, so the detail dialog it opens is always canDecideQc={false} canDecideProduction={false}.
export function DispatchApprovalsPanel({ rows = [] }) {
  const router = useRouter();
  const [openApprovalId, setOpenApprovalId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function submit(packingListId) {
    setBusyId(packingListId);
    try {
      await api(`/api/packing/${packingListId}/submit-for-approval`, { method: 'POST' });
      showToast('Submitted for QC/Production review');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardContent className="py-4">
        {!rows.length ? <p className="text-sm text-muted-foreground">No packing lists awaiting dispatch approval.</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Packing List</TableHead><TableHead>Project</TableHead>
              <TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map(r => {
                const status = r.approval_status;
                const badge = status && APPROVAL_BADGE[status];
                const canSubmit = !status || status === 'rejected';
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.packing_no}</TableCell>
                    <TableCell>{r.project_no || '—'}</TableCell>
                    <TableCell>
                      {badge ? <Badge variant={badge[0]}>{badge[1]}</Badge> : <Badge variant="secondary">Not submitted</Badge>}
                      {status && (r.qc_decision || r.production_decision) && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          QC: {r.qc_decision || 'awaiting'} · Production: {r.production_decision || 'awaiting'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {canSubmit && (
                        <Button size="sm" disabled={busyId === r.id} onClick={() => submit(r.id)}>
                          {busyId === r.id ? 'Submitting…' : status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
                        </Button>
                      )}
                      {r.approval_id != null && (
                        <Button size="sm" variant="ghost" onClick={() => setOpenApprovalId(r.approval_id)}>View</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {openApprovalId != null && (
        <PreDispatchDetailDialog id={openApprovalId} canDecideQc={false} canDecideProduction={false}
          onClose={() => setOpenApprovalId(null)} />
      )}
    </Card>
  );
}
