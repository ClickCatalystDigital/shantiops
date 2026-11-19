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
import { todayISO } from '@/lib/date';
import { accountsSignOff } from '@/lib/predispatch.mjs';
import { paymentTypeLabel } from '@/lib/payment-types.mjs';
import { Input } from '@/components/ui/input';
import CertPicker from '@/components/CertPicker';
import { useParamSync } from '@/lib/use-entity-highlight';

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
  // Alert link ?highlight=IA-<id> opens that review.
  useParamSync('highlight', c => { const r = rows.find(x => `IA-${x.id}` === c); if (r) setOpenId(r.id); });
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

const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
// Accounts' view in the review: order value / received / due, how far paid, and the payments themselves.
function PaymentCard({ payment, logHref }) {
  if (!payment) return (
    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No sale order or invoice is linked to this list, so there is nothing to check payment against.</div>
  );
  const pct = payment.total > 0 ? Math.min(100, Math.round((payment.received / payment.total) * 100)) : 0;
  const paid = payment.balance <= 0;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium">
          {[payment.so_no && `Order ${payment.so_no}`, payment.invoice_no && `Invoice ${payment.invoice_no}`].filter(Boolean).join(' · ')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${paid ? 'bg-success/15 text-success' : payment.received > 0 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
          {paid ? 'Fully paid' : payment.received > 0 ? `${pct}% paid` : 'Unpaid'}
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x">
        {[['Order value', payment.total, ''], ['Received', payment.received, payment.received > 0 ? 'text-success' : 'text-muted-foreground'], ['Balance due', Math.max(0, payment.balance), paid ? 'text-success' : 'text-warning']].map(([label, v, tone]) => (
          <div key={label} className="px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={`text-sm font-semibold tabular-nums ${tone}`}>{inr(v)}</p>
          </div>
        ))}
      </div>
      <div className="h-1.5 bg-muted"><div className="h-full bg-success transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="divide-y border-t text-xs">
        {payment.payments.length === 0 && <p className="px-3 py-2 text-muted-foreground">No payment logged yet.</p>}
        {payment.payments.map(p => (
          <div key={`${p.source}-${p.id}`} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-20 shrink-0 text-muted-foreground">{p.received_on ? formatDate(p.received_on) : 'No date'}</span>
            {paymentTypeLabel(p.payment_type) && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{paymentTypeLabel(p.payment_type)}</span>}
            <span className="truncate text-muted-foreground">{p.mode || ''}</span>
            <span className="ml-auto font-medium tabular-nums">{inr(p.amount)}</span>
          </div>
        ))}
      </div>
      {logHref && (
        <div className="border-t px-3 py-1.5 text-right text-xs">
          <a className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" href={logHref} target="_blank" rel="noopener noreferrer">Open Payment Log</a>
        </div>
      )}
    </div>
  );
}

function PreDispatchDetailDialog({ id, canDecideQc, canDecideProduction, canDecideAccounts = false, onClose }) {
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-medium">{detail.packing.list.packing_no}</span> — {detail.packing.list.customer_name}
                <p className="text-xs text-muted-foreground">{detail.packing.items.length} item{detail.packing.items.length === 1 ? '' : 's'}</p>
              </div>
              {/* The reviewer checks the actual list before signing it off. */}
              <Button asChild variant="outline" size="sm">
                <a href={`/api/packing/${detail.packing.list.id}/pdf`} target="_blank" rel="noopener noreferrer">Download packing list</a>
              </Button>
            </div>
            {detail.qcRecords.length > 0 && (
              <div className="text-xs">
                <p className="mb-1 font-medium">QC records (context — not the gate itself)</p>
                {/* One line per test type, counted: a boiler has dozens of incoming inspections. */}
                {Object.entries(detail.qcRecords.reduce((m, q) => {
                  const t = (m[q.test_type] ||= {});
                  t[q.result || 'pending'] = (t[q.result || 'pending'] || 0) + 1;
                  return m;
                }, {})).map(([type, by]) => (
                  <div key={type}>{type}: {Object.entries(by).map(([r, n]) => `${n} ${r}`).join(', ')}</div>
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
              {detail.needsAccounts && (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-medium">Accounts decision</p>
                  <PaymentCard payment={detail.payment} logHref={detail.paymentLogHref} />
                  {a.accounts_decision ? (
                    <p className="mt-2 text-xs">
                      <Badge variant={a.accounts_decision === 'approved' ? 'default' : 'destructive'}>{a.accounts_decision}</Badge>{' '}
                      {a.accounts_decided_by} · {formatDate(a.accounts_decided_at)}{a.accounts_reason ? ` — ${a.accounts_reason}` : ''}
                    </p>
                  ) : <DecisionButtons canDecide={canDecideAccounts} busy={busy} onDecide={(d, r) => decide('accounts', d, r)} />}
                </div>
              )}
            </div>
            {detail.history.length > 1 && (
              <div className="rounded border p-2 text-xs">
                <p className="mb-1 font-medium">Prior cycles</p>
                {detail.history.slice(0, -1).map(h => (
                  <div key={h.id} className="border-b py-1 last:border-0">
                    <Badge variant={h.status === 'approved' ? 'default' : 'destructive'}>{h.status}</Badge>{' '}
                    QC: {h.qc_decision || '—'}{h.qc_reason ? ` (${h.qc_reason})` : ''} · Production: {h.production_decision || '—'}{h.production_reason ? ` (${h.production_reason})` : ''}{h.accounts_decision ? ` · Accounts: ${h.accounts_decision}${h.accounts_reason ? ` (${h.accounts_reason})` : ''}` : ''}
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

export function PreDispatchApprovalsPanel({ rows = [], canDecideQc = false, canDecideProduction = false, canDecideAccounts = false }) {
  const withAccounts = accountsSignOff();
  const [openId, setOpenId] = useState(null);
  // Alert link ?highlight=<packing no> opens that list's review.
  useParamSync('highlight', c => { const r = rows.find(x => x.packing_no === c); if (r) setOpenId(r.id); });
  return (
    <Card>
      <CardContent className="py-4">
        {!rows.length ? <p className="text-sm text-muted-foreground">No Packing Lists awaiting review.</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Packing List</TableHead><TableHead>Project</TableHead>
              <TableHead>QC</TableHead><TableHead>Production</TableHead>{withAccounts && <TableHead>Accounts</TableHead>}<TableHead>Submitted</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell>{r.packing_no}</TableCell>
                  <TableCell>{r.project_no || '—'}</TableCell>
                  <TableCell>{r.qc_decision || 'Pending'}</TableCell>
                  <TableCell>{r.production_decision || 'Pending'}</TableCell>
                  {withAccounts && <TableCell>{r.accounts_decision || 'Pending'}</TableCell>}
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
          canDecideAccounts={canDecideAccounts} onClose={() => setOpenId(null)} />
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
      showToast('Submitted for review');
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
                const status = r.approval_status === 'withdrawn' ? null : r.approval_status; // pulled back to draft = not submitted
                const badge = status && APPROVAL_BADGE[status];
                const canSubmit = !status || status === 'rejected';
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.packing_no}</TableCell>
                    <TableCell>{r.project_no || '—'}</TableCell>
                    <TableCell>
                      {badge ? <Badge variant={badge[0]}>{badge[1]}</Badge> : <Badge variant="secondary">Not submitted</Badge>}
                      {status && (r.qc_decision || r.production_decision || r.accounts_decision) && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          QC: {r.qc_decision || 'awaiting'} · Production: {r.production_decision || 'awaiting'}{accountsSignOff() ? ` · Accounts: ${r.accounts_decision || 'awaiting'}` : ''}
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

// ---------- Job Card stages (QC signs what Production finished) ----------

export function JobSheetApprovalsPanel({ rows }) {
  const router = useRouter();
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  useParamSync('q', setQ); // alert link: ?q=<job card no>
  const shown = rows.filter(r => !q.trim() || [r.job_number, r.jc_no, r.project_no, r.name].some(v => v?.toLowerCase().includes(q.trim().toLowerCase())));
  const days = d => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 864e5));
  return (
    <div className="flex flex-col gap-3">
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search job / project / stage…" className="w-full" />
      <Card><CardContent className="p-0">
        {shown.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No job card stages waiting for QC.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Project</TableHead><TableHead>Stage</TableHead>
              <TableHead>Fitter</TableHead><TableHead>Finished</TableHead><TableHead>Waiting</TableHead></TableRow></TableHeader>
            <TableBody>
              {shown.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSel(r)}>
                  <TableCell className="font-medium">{r.job_number || r.jc_no}<span className="ml-2 text-xs text-muted-foreground">{r.jc_no}</span></TableCell>
                  <TableCell>{r.project_no || '—'}</TableCell><TableCell>{r.name}</TableCell>
                  <TableCell>{r.fitter_name || '—'}</TableCell><TableCell>{formatDate(r.end_date)}</TableCell>
                  <TableCell><Badge variant="outline">{days(r.end_date)}d</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
      {sel && <JobSheetStageDialog row={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); router.refresh(); }} />}
    </div>
  );
}

function JobSheetStageDialog({ row, onClose, onDone }) {
  const [date, setDate] = useState(todayISO());
  const [certs, setCerts] = useState([]);
  const [certId, setCertId] = useState(null);
  const [pick, setPick] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/test-certificates${row.project_id ? `?project_id=${row.project_id}` : ''}`).then(setCerts).catch(() => {}); }, [row.project_id]);
  const cert = certs.find(c => c.id === certId);
  async function act(body, msg) {
    setBusy(true);
    try { await api(`/api/job-sheets/${row.sheet_id}/stages/${row.id}`, { method: 'PATCH', body }); showToast(msg); onDone(); }
    catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{row.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{row.job_number || row.jc_no} · {row.project_no || 'No project'} · finished {formatDate(row.end_date)}</p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">Inspection date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1 justify-start font-normal" onClick={() => setPick(true)}>
              {cert ? `${cert.certificate_no} · ${cert.cast_no}` : 'Link test certificate… (optional)'}</Button>
            {certId && <Button type="button" variant="ghost" onClick={() => setCertId(null)}>Clear</Button>}
          </div>
          <Textarea placeholder="Reason (required only to send back)" value={reason} onChange={e => setReason(e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="text-danger hover:text-danger" disabled={busy || !reason.trim()}
            onClick={() => act({ action: 'send_back', reason }, 'Sent back to Production')}>Send back</Button>
          <Button disabled={busy} onClick={() => act({ action: 'qc', inspection_date: date, test_certificate_id: certId }, 'Stage QC-signed')}>Approve</Button>
        </DialogFooter>
        <CertPicker open={pick} onOpenChange={setPick} title="Link test certificate" certificates={certs}
          project={row.project_id ? { id: row.project_id } : null} onPick={setCertId} />
      </DialogContent>
    </Dialog>
  );
}
