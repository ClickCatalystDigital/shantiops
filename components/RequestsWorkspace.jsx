'use client';

// The Requests tab (§4.0) — the acceptance inbox for new-item requests and the existing
// cancel-request flow (reused, not migrated). The two direction-split incident feeds moved to the
// Operations Procurement view (V2-CHANGES.md Group 4b). Everything here operates on data
// DepartmentPanel/Operations already fetch elsewhere — no new query shape.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, showToast, formatDate, formatMoney } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

function NewItemRequest({ r, router }) {
  const [busy, setBusy] = useState(false);

  async function resolve(action) {
    setBusy(true);
    try {
      await api(`/api/procurement-requests/${r.id}`, { method: 'PATCH', body: { action } });
      showToast(action === 'accept' ? 'Accepted — now in Procurement' : 'Rejected');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.material_description}</p>
        <p className="truncate text-xs text-muted-foreground">
          <Link href={`/projects/${r.project_id}`} className="text-primary hover:underline">{r.project_no}</Link>
          {' · from '}{r.from_department}
          {r.qty_text && ` · ${r.qty_text}`}
          {r.size_spec && ` · ${r.size_spec}`}
          {r.pr_ref && ` · PR ${r.pr_ref}`}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('reject')}>Reject</Button>
      <Button size="sm" disabled={busy} onClick={() => resolve('accept')}>Accept</Button>
    </div>
  );
}

// Detail overlay for one cancel-request (§ Phase 4 point 6) — before, accepting was a bare
// checkbox with zero context. Shows what Procurement is actually giving up: the selected supplier
// (if any), an issued PO (if any), and every other quote that was logged but not picked — the
// "offers from other suppliers who were rejected" the redesign asked for. `item`/`quotes`/`poInfo`
// come pre-fetched from app/requests/page.js (getBomItemsByIds/getItemQuotes/getBomItemPoInfo).
function CancelRequestDetail({ task, item, quotes, poInfo, onClose, onAccept, busy }) {
  const selectedQuote = quotes.find(q => q.id === item?.selected_quote_id);
  const otherQuotes = quotes.filter(q => q.id !== item?.selected_quote_id);

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item?.material_description || task.title}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Requested by <span className="font-medium text-foreground">{task.from_department}</span></p>
            <p className="text-xs text-muted-foreground">{task.title}</p>
          </div>
          {item && (
            <p className="text-xs text-muted-foreground">
              {item.moc || '—'} · {item.size_spec || '—'} · {item.qty_text || '—'}
              {item.pr_ref && ` · PR ${item.pr_ref}`}
            </p>
          )}

          <div className="rounded-md border p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected supplier</p>
            {selectedQuote ? (
              <p>{selectedQuote.supplier_name} · {formatMoney(selectedQuote.unit_price)}
                {selectedQuote.payment_terms && ` · ${selectedQuote.payment_terms}`}</p>
            ) : (
              <p className="text-muted-foreground">No supplier selected yet.</p>
            )}
          </div>

          {poInfo.length > 0 && (
            <div className="rounded-md border p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Purchase order</p>
              {poInfo.map(po => (
                <p key={po.id}>
                  {po.po_no} · <Badge variant="outline">{po.status}</Badge>
                  {po.issued_at && ` · issued ${formatDate(po.issued_at)}`}
                </p>
              ))}
            </div>
          )}

          {otherQuotes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Other offers ({otherQuotes.length})
              </p>
              <div className="flex flex-col gap-1">
                {otherQuotes.map(q => (
                  <p key={q.id} className="text-xs text-muted-foreground">
                    {q.supplier_name} · {formatMoney(q.unit_price)}{q.payment_terms && ` · ${q.payment_terms}`}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Not yet</Button>
          <Button variant="destructive" disabled={busy} onClick={onAccept}>
            {busy ? 'Cancelling…' : 'Accept & cancel item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelRequests({ tasks, itemById, quotesById, poById, router }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState(null);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => (s.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id))));
  }
  async function acceptIds(ids) {
    setBusy(true);
    try {
      await api('/api/production/tasks/accept-cancellations', { method: 'POST', body: { task_ids: ids } });
      showToast(`${ids.length} item${ids.length !== 1 ? 's' : ''} cancelled`);
      setSelected(new Set());
      setDetailTaskId(null);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">No cancel requests waiting.</p>;

  const detailTask = tasks.find(t => t.id === detailTaskId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={selected.size === tasks.length} onCheckedChange={toggleAll} />
          Select all
        </label>
        <Button size="sm" disabled={busy || !selected.size} onClick={() => acceptIds([...selected])}>
          Accept selected{selected.size ? ` (${selected.size})` : ''}
        </Button>
      </div>
      <div className="flex flex-col divide-y">
        {tasks.map(t => (
          <div key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
            <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline"
              onClick={() => setDetailTaskId(t.id)}>
              {t.title}
            </button>
            {t.project_id && (
              <Link href={`/projects/${t.project_id}`} className="shrink-0 text-xs text-primary hover:underline">Project</Link>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">from {t.from_department}</span>
          </div>
        ))}
      </div>
      {detailTask && (
        <CancelRequestDetail task={detailTask} item={itemById[detailTask.bom_item_id]}
          quotes={quotesById[detailTask.bom_item_id] || []} poInfo={poById[detailTask.bom_item_id] || []}
          onClose={() => setDetailTaskId(null)} onAccept={() => acceptIds([detailTask.id])} busy={busy} />
      )}
    </div>
  );
}

export default function RequestsWorkspace({
  requests, cancelRequests, cancelItemById = {}, cancelQuotesById = {}, cancelPoById = {},
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>New-item requests</CardTitle></CardHeader>
        <CardContent className="flex flex-col divide-y pt-0">
          {requests.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nothing waiting.</p>}
          {requests.map(r => <NewItemRequest key={r.id} r={r} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cancel requests</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <CancelRequests tasks={cancelRequests} itemById={cancelItemById}
            quotesById={cancelQuotesById} poById={cancelPoById} router={router} />
        </CardContent>
      </Card>
    </div>
  );
}
