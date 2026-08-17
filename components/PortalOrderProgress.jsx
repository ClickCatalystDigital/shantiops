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
import { cn } from '@/lib/utils';
import { CheckIcon, LoaderIcon, ClockIcon, ChevronDownIcon } from 'lucide-react';

const STATUS_LABEL = { under_review: 'Ready for your review', approved: 'Approved', as_built: 'As built' };

function DrawingRow({ drawing, onChanged }) {
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
          <p className="text-sm font-medium">{drawing.name}</p>
          {drawing.description && <p className="text-xs text-muted-foreground">{drawing.description}</p>}
        </div>
        <Badge variant={approved ? 'default' : 'outline'}>
          {approved ? `Approved ${formatDate(drawing.customerApprovedAt)}` : STATUS_LABEL[drawing.status] || drawing.status}
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

      <div className="flex flex-col gap-2">
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
              {drawing.status === 'under_review' && !approved && (
                <Button size="sm" disabled={busy} onClick={approve}>Approve drawing</Button>
              )}
            </div>
          </>
        )}
      </div>
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
  const statusText = ph.status === 'done' ? 'Completed'
    : ph.status === 'in_progress' || ph.status === 'awaiting_customer' ? 'In progress' : 'Upcoming';

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

export default function PortalOrderProgress({ phases, drawings, pct }) {
  const [items, setItems] = useState(drawings);
  const [expanded, setExpanded] = useState(false);

  async function refreshOne(id) {
    // Re-fetching the full list is overkill for one field flip — flag it locally instead.
    setItems(prev => prev.map(d => d.id === id ? { ...d, customerApprovedAt: new Date().toISOString() } : d));
  }

  return (
    <Card>
      <CardHeader><CardTitle>Order Progress — {pct}%</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ol className="flex flex-col">
          {phases.map((ph, i) => (
            <Fragment key={ph.key}>
              <PhaseRow ph={ph} index={i}
                expandable={ph.key === 'design' && items.length > 0}
                expanded={expanded} onToggle={() => setExpanded(v => !v)} />
              {ph.key === 'design' && expanded && items.length > 0 && (
                <li className="flex flex-col gap-3 border-b py-3 pl-10">
                  {items.map(d => <DrawingRow key={d.id} drawing={d} onChanged={() => refreshOne(d.id)} />)}
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
