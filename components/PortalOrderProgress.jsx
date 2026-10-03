'use client';

// Order Progress stepper + the Drawings needing customer action, merged into one journey: the
// Design & Engineering row expands in place when clicked, rather than sending the customer to a
// separate card further down the page to find what the yellow icon is about.
import { Fragment, useState } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import PortalDrawingUploads from '@/components/PortalDrawingUploads';
import { todayISO } from '@/lib/date';
import { cn } from '@/lib/utils';
import { seriesLabel } from '@/lib/qc-extra-series.mjs';
import { CheckIcon, LoaderIcon, ClockIcon, ChevronDownIcon, DownloadIcon, FileTextIcon } from 'lucide-react';

const STATUS_LABEL = { under_review: 'Ready for your review', approved: 'Approved', as_built: 'As built' };

function DrawingRow({ drawing, onChanged, readOnly }) {
  const [comments, setComments] = useState(null); // null = not yet loaded
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const approved = !!drawing.customerApprovedAt;

  async function loadComments() {
    if (comments) return;
    try {
      setComments(await api(`/api/calc-drawings/${drawing.id}/comments`));
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function postComment() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/calc-drawings/${drawing.id}/comments`, { method: 'POST', body: { body: draft.trim() } });
      setDraft('');
      setComments(await api(`/api/calc-drawings/${drawing.id}/comments`));
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/calc-drawings/${drawing.id}/approve`, { method: 'POST' });
      showToast('Drawing approved');
      onChanged();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{drawing.dgNo && <span className="text-muted-foreground">{drawing.dgNo} · </span>}{drawing.name}</p>
          {drawing.description && <p className="text-xs text-muted-foreground">{drawing.description}</p>}
        </div>
        <Badge variant={approved ? 'default' : 'outline'}>
          {approved ? `Approved ${formatDate(drawing.customerApprovedAt)}` : (drawing.status === 'approved' || drawing.status === 'as_built') ? STATUS_LABEL.under_review : STATUS_LABEL[drawing.status] || drawing.status}
        </Badge>
      </div>

      {drawing.files?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {drawing.files.map(f => (
            <Button key={f.id} asChild variant="outline" size="sm">
              <a href={`/api/calc-drawings/${drawing.id}/files/${f.id}`} target="_blank" rel="noreferrer">{f.fileName} ↗</a>
            </Button>
          ))}
        </div>
      )}

      {!readOnly && <div className="flex flex-col gap-2">
        {comments === null ? (
          <button type="button" className="w-fit text-xs text-muted-foreground hover:underline" onClick={loadComments}>
            View comments
          </button>
        ) : (
          <>
            {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
            {comments.map(c => (
              <div key={c.id} className="text-xs">
                <span className="font-medium">{c.author_name}</span>{' '}
                <span className="text-muted-foreground">{formatDate(c.created_at)}</span>
                <p className="mt-0.5">{c.body}</p>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a comment…" className="min-h-16 text-sm" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" disabled={busy || !draft.trim()} onClick={postComment}>Comment</Button>
              {['under_review', 'approved', 'as_built'].includes(drawing.status) && !approved && (
                <Button size="sm" disabled={busy} onClick={approve}>Approve drawing</Button>
              )}
            </div>
          </>
        )}
      </div>}
    </div>
  );
}

// A plain document — QC certificate, packing list — with nothing for the customer to act on,
// unlike a drawing (no approve/comment). One consistent row style: icon, name, a Download button
// that forces a save instead of an in-browser preview.
function DocumentRow({ name, href, meta }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0"><div className="truncate text-sm font-medium">{name}</div>{meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}</div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <a href={href} download><DownloadIcon className="size-3.5" data-icon="inline-start" />Download</a>
      </Button>
    </div>
  );
}

function PhaseRow({ ph, index, expandable, expanded, onToggle }) {
  const icon = ph.status === 'done' ? <CheckIcon className="size-4" />
    : ph.status === 'awaiting_customer' ? <ClockIcon className="size-4" />
    : ph.status === 'in_progress' ? <LoaderIcon className="size-4" /> : index + 1;
  const circle = (
    <span className={cn(
      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs',
      ph.status === 'done' ? 'bg-success text-white'
        : ph.status === 'awaiting_customer' ? 'bg-warning text-white'
        : ph.status === 'in_progress' ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground'
    )}>
      {icon}
    </span>
  );
  // awaiting_customer intentionally reuses the "In progress" label — the color/icon/expand
  // affordance are the only new signal, no new copy.
  let statusText = ph.status === 'done' ? 'Completed'
    : ph.status === 'in_progress' || ph.status === 'awaiting_customer' ? 'In progress' : 'Upcoming';
  // Multi-unit split — a real per-unit count only present on an aggregate (split-order) phase;
  // undefined for every ordinary single-project order, which renders exactly as before this line.
  if (ph.unitProgress) statusText += ` (${ph.unitProgress.done} of ${ph.unitProgress.total} units)`;
  // Single order: real counts from the job card stages / QC documents while the stage is under way.
  if (ph.progress && ph.status === 'in_progress') statusText += ` (${ph.progress.done} of ${ph.progress.total} ${ph.progress.noun})`;

  if (!expandable) {
    return (
      <li className="flex items-center gap-3 py-2">
        {circle}
        <span className="flex-1 text-sm font-medium">{ph.label}</span>
        <span className="text-xs text-muted-foreground">{statusText}</span>
      </li>
    );
  }

  return (
    <li className="py-2">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        {circle}
        <span className="flex-1 text-sm font-medium">{ph.label}</span>
        <span className="text-xs text-muted-foreground">{statusText}</span>
        <ChevronDownIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
    </li>
  );
}

// "02 Oct 2026, 3:45 PM" — DB timestamps are UTC (no zone suffix), shown in IST.
const stamp = s => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const VisitRow = ({ v }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><CheckIcon className="size-4 shrink-0 text-success" /><span className="truncate">{v.description}</span></span>
    <span className="shrink-0 text-xs text-muted-foreground">{v.date ? formatDate(v.date) : ''}{v.time ? ` · ${v.time}` : ''}</span>
  </div>
);
const VisitBar = ({ done, total, remaining, title }) => (
  <div className="rounded-lg border p-3">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium">{title}{done} of {total} visits done</span>
      <span className="text-xs text-muted-foreground">{remaining} remaining</span>
    </div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
  </div>
);

// Visits done vs remaining. One boiler: a bar + its done visits. Split order: one block per unit
// (each unit has its own visits) — counts are never added across units.
function VisitsPanel({ summary, units, visits }) {
  if (summary) {
    return (
      <>
        <VisitBar {...summary} title="" />
        {visits.length === 0 && <p className="text-xs text-muted-foreground">No visit has been completed yet.</p>}
        {visits.map(v => <VisitRow key={v.id} v={v} />)}
      </>
    );
  }
  return units.map(u => {
    const mine = visits.filter(v => v.unitProjectNo === u.projectNo);
    return (
      <details key={u.projectNo} className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
          <span className="text-sm font-medium">{u.projectNo}</span>
          <span className="text-xs text-muted-foreground">{u.done} of {u.total} visits done · {u.remaining} remaining</span>
        </summary>
        <div className="flex flex-col gap-2 border-t p-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${u.total ? Math.round((u.done / u.total) * 100) : 0}%` }} /></div>
          {mine.length === 0 ? <p className="text-xs text-muted-foreground">No visit completed yet.</p> : mine.map(v => <VisitRow key={v.id} v={v} />)}
        </div>
      </details>
    );
  });
}

export default function PortalOrderProgress({ readOnly = false, projectId, customerDrawings = [], phases, drawings, qcCertificates = [], pendingCount = 0, packingLists = [], installationVisits = [], installationSummary = null, installationUnits = [], installationReports = [], pct }) {
  const [items, setItems] = useState(drawings);
  // One open section at a time, tracked by phase key — 'design' keeps its old default-collapsed
  // behavior, just generalized to any phase that has documents to show.
  const [openPhase, setOpenPhase] = useState(null);

  async function refreshOne(id) {
    // Re-fetching the full list is overkill for one field flip — flag it locally instead.
    setItems(prev => prev.map(d => d.id === id ? { ...d, customerApprovedAt: todayISO() } : d));
  }

  // Real, honest phase links only — a Sales Invoice has no phase in the data model (it can be
  // issued at booking, mid-project, or at dispatch), so it deliberately isn't here; see the
  // separate Billing card on the portal page instead of a fabricated mapping.
  const phaseDocs = {
    // Design stays open even with no drawings yet — the customer can send their own from here.
    design: items.length + (readOnly ? customerDrawings.length : 1),
    documentation: qcCertificates.length,
    packing: packingLists.length,
    pending: pendingCount,
    installation: installationSummary ? installationSummary.total : installationUnits.length,
    commissioning: installationReports.length,
  };

  return (
    <Card>
      <CardHeader><CardTitle>Order Progress — {pct}%</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ol className="flex flex-col">
          {phases.map((ph, i) => {
            const count = phaseDocs[ph.key] || 0;
            const expanded = openPhase === ph.key;
            return (
              <Fragment key={ph.key}>
                <PhaseRow ph={ph} index={i}
                  expandable={count > 0}
                  expanded={expanded} onToggle={() => setOpenPhase(v => v === ph.key ? null : ph.key)} />
                {ph.key === 'design' && expanded && (
                  <li className="flex flex-col gap-3 border-b py-3 pl-10">
                    {items.map(d => <DrawingRow key={d.id} drawing={d} readOnly={readOnly} onChanged={() => refreshOne(d.id)} />)}
                    <PortalDrawingUploads projectId={projectId} initial={customerDrawings} readOnly={readOnly} />
                  </li>
                )}
                {ph.key === 'documentation' && expanded && (
                  <li className="flex flex-col gap-3 border-b py-3 pl-10">
                    {qcCertificates.map(doc => (
                      <DocumentRow key={doc.id}
                        name={`${seriesLabel(doc.series)} — QC Documentation`}
                        meta={[doc.doc_id, doc.unitProjectNo].filter(Boolean).join(' · ')}
                        href={`/api/qc-documents/${doc.id}/pdf`} />
                    ))}
                  </li>
                )}
                {ph.key === 'pending' && expanded && (
                  <li className="flex flex-col gap-3 border-b py-3 pl-10">
                    <DocumentRow name="Items pending dispatch" meta={`${pendingCount} item${pendingCount === 1 ? '' : 's'} still to be sent`}
                      href={`/api/projects/${projectId}/pending-to-send/pdf`} />
                  </li>
                )}
                {ph.key === 'packing' && expanded && (
                  <li className="flex flex-col gap-3 border-b py-3 pl-10">
                    {/* Multi-unit split — units dispatched in the same real-world lot naturally cluster
                        here since each carries its own dispatch date; no separate lot-grouping UI yet,
                        see SB-1109 portal design note. */}
                    {packingLists.map(pl => (
                      <DocumentRow key={pl.id}
                        name={`Packing List — ${pl.packingNo}${pl.unitProjectNo ? ` (${pl.unitProjectNo}${pl.dispatchedAt ? `, ${formatDate(pl.dispatchedAt)}` : ''})` : ''}`}
                        href={`/api/packing/${pl.id}/pdf`} />
                    ))}
                  </li>
                )}
                {ph.key === 'installation' && expanded && (
                  <li className="flex flex-col gap-2 border-b py-3 pl-10"><VisitsPanel summary={installationSummary} units={installationUnits} visits={installationVisits} /></li>
                )}
                {ph.key === 'commissioning' && expanded && (
                  <li className="flex flex-col gap-3 border-b py-3 pl-10">
                    {/* Every report the Service team finalized and shared: Commissioning, Breakdown, ASC, Other. */}
                    {installationReports.map(r => (
                      <DocumentRow key={r.id}
                        name={`${r.callType === 'Commissioning' ? 'Commissioning Report' : `${r.callType} Report`} — ${r.docNo ? `${r.docNo} · Rev ${String(r.revision ?? 0).padStart(2, '0')}` : r.reportNo}${r.unitProjectNo ? ` (${r.unitProjectNo})` : ''}`}
                        meta={[r.date && `Report date ${formatDate(r.date)}`, r.sharedAt && `Shared ${stamp(r.sharedAt)}`].filter(Boolean).join(' · ')}
                        href={`/api/installation-reports/${r.id}/pdf`} />
                    ))}
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
