'use client';

// The Requests tab (§4.0/§4.0b) — the acceptance gate for new-item requests, the existing
// cancel-request flow (reused, not migrated), and the two split Tickets feeds moved here from
// Operations. Everything here operates on data DepartmentPanel/Operations already fetch elsewhere —
// no new query shape beyond the two additions in app/requests/page.js.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import TicketsPanel from './TicketsPanel';

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

function CancelRequests({ tasks, router }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => (s.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id))));
  }
  async function accept() {
    if (!selected.size) return;
    setBusy(true);
    try {
      await api('/api/production/tasks/accept-cancellations', { method: 'POST', body: { task_ids: [...selected] } });
      showToast(`${selected.size} item${selected.size !== 1 ? 's' : ''} cancelled`);
      setSelected(new Set());
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">No cancel requests waiting.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={selected.size === tasks.length} onCheckedChange={toggleAll} />
          Select all
        </label>
        <Button size="sm" disabled={busy || !selected.size} onClick={accept}>
          Accept selected{selected.size ? ` (${selected.size})` : ''}
        </Button>
      </div>
      <div className="flex flex-col divide-y">
        {tasks.map(t => (
          <label key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
            <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.project_id && (
              <Link href={`/projects/${t.project_id}`} className="shrink-0 text-xs text-primary hover:underline">Project</Link>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">from {t.from_department}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function RequestsWorkspace({ requests, cancelRequests, raisedByProcurement, raisedForProcurement }) {
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
          <CancelRequests tasks={cancelRequests} router={router} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <TicketsPanel title="Raised by Procurement" department="Procurement" canRaise showDepartment
          tasks={raisedByProcurement} />
        <TicketsPanel title="Raised for Procurement" department="Procurement"
          tasks={raisedForProcurement} />
      </div>
    </div>
  );
}
