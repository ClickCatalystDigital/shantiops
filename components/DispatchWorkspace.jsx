'use client';

// Dispatch's own sidebar workspace, replacing the bare kanban — matches the established
// StoresWorkspace.jsx/ProcurementWorkspace.jsx pattern (WorkspaceSidebar, one file per workspace).
// Four tabs: Packing Lists (default, the kanban + a stat-pill row), Pending Items (cross-project
// action queue), Deliveries (post-dispatch acknowledgment follow-up), Documents (invoice/e-way-bill
// compliance sweep). Reports are deliberately not linked from here — they already have their own
// nav location (/reports?dept=Dispatch).
//
// Terminology, kept strictly separate throughout this file: the packing-list lifecycle is always
// Draft -> Ready -> Dispatched (a list's own status). BOM-item eligibility is always Ready to Pack /
// Waiting (whether a line qualifies to be pulled into a list). Never mixed.
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, showToast, formatDate } from '@/lib/client';
import WorkspaceSidebar from './WorkspaceSidebar';
import DispatchBoard from './DispatchBoard';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  PackageIcon, PackageCheckIcon, ClipboardListIcon, TruckIcon, FileTextIcon,
  SearchIcon, XIcon,
} from 'lucide-react';

const STAGE_LABEL = { draft: 'Draft', packed: 'Ready', dispatched: 'Dispatched' };
const STAGE_BADGE_CLASS = {
  draft: 'border-warning/30 bg-warning-surface text-warning',
  packed: 'border-info/30 bg-info-surface text-info',
  dispatched: 'border-success/30 bg-success-surface text-success',
};
function StageBadge({ status }) {
  return <Badge variant="outline" className={STAGE_BADGE_CLASS[status]}>{STAGE_LABEL[status] || status}</Badge>;
}

const ACK_LABEL = { accepted: 'Accepted', damaged: 'Damaged', discrepancy: 'Discrepancy' };
const ACK_BADGE_CLASS = {
  accepted: 'border-success/30 bg-success-surface text-success',
  damaged: 'border-danger/30 bg-danger-surface text-danger',
  discrepancy: 'border-danger/30 bg-danger-surface text-danger',
};
function AckBadge({ status }) {
  if (!status) return <Badge variant="outline" className="border-warning/30 bg-warning-surface text-warning">Awaiting Confirmation</Badge>;
  return <Badge variant="outline" className={ACK_BADGE_CLASS[status]}>{ACK_LABEL[status] || status}</Badge>;
}

// Same clickable-stat-pill treatment as StoresWorkspace.jsx's TodaySummary — reused verbatim so the
// whole app speaks one "glanceable dashboard" visual language rather than a second one per department.
function StatPill({ dot, value, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-muted/50">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="font-semibold tnum">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </button>
  );
}

// Same pill-shaped search input every workspace uses (StoresWorkspace.jsx's SearchBox).
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative max-w-sm">
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 rounded-full border-transparent bg-muted/50 pl-10 shadow-none transition-colors focus-visible:border-input focus-visible:bg-background" />
    </div>
  );
}

// ---- Tab 1: Packing Lists (default) ----

function PackingListsTab({ lists, flowCounts, pendingReadyCount, awaitingAckCount, missingEwayCount, onNavigate }) {
  const [focusedStatus, setFocusedStatus] = useState(null);

  function toggleStatus(key) {
    setFocusedStatus(cur => (cur === key ? null : key));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <StatPill dot="bg-warning" value={flowCounts.pending} label="Draft" onClick={() => toggleStatus('draft')} />
        <StatPill dot="bg-info" value={flowCounts.ready} label="Ready" onClick={() => toggleStatus('packed')} />
        <StatPill dot="bg-success" value={flowCounts.dispatched} label="Dispatched" onClick={() => toggleStatus('dispatched')} />
        <StatPill dot="bg-success" value={pendingReadyCount} label="Ready to Pack" onClick={() => onNavigate('pending')} />
        <StatPill dot="bg-warning" value={awaitingAckCount} label="Delivery Follow-up" onClick={() => onNavigate('deliveries')} />
        <StatPill dot="bg-danger" value={missingEwayCount} label="Missing E-Way Bills" onClick={() => onNavigate('documents', { missingEway: true })} />
      </div>
      <div className="border-t pt-4">
        {focusedStatus && (
          <button type="button" onClick={() => setFocusedStatus(null)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted">
            Showing: {STAGE_LABEL[focusedStatus]} only <XIcon className="size-3" />
          </button>
        )}
        <DispatchBoard lists={lists} statusFilter={focusedStatus} />
      </div>
    </div>
  );
}

// ---- Tab 2: Pending Items ----

function PendingItemsTab({ items }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [busyProject, setBusyProject] = useState(null);

  const needle = q.trim().toLowerCase();
  const filtered = items.filter(it => !needle
    || it.material_description.toLowerCase().includes(needle)
    || it.project_no.toLowerCase().includes(needle)
    || it.customer_name.toLowerCase().includes(needle));

  const byProject = useMemo(() => {
    const map = new Map();
    filtered.forEach(it => {
      if (!map.has(it.project_id)) {
        map.set(it.project_id, { project_id: it.project_id, project_no: it.project_no, customer_name: it.customer_name, items: [] });
      }
      map.get(it.project_id).items.push(it);
    });
    return [...map.values()];
  }, [filtered]);

  async function generate(projectId) {
    setBusyProject(projectId);
    try {
      const { items: n } = await api('/api/packing/from-bom', { method: 'POST', body: { project_id: projectId } });
      showToast(`Draft packing list created (${n} item${n === 1 ? '' : 's'})`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyProject(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by description or project…" />}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing pending — every BOM line is either packed or not yet ready.</p>
      ) : byProject.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No items match your search.</p>
      ) : byProject.map(group => {
        const readyCount = group.items.filter(it => it.readyForPacking).length;
        return (
          <Card key={group.project_id}>
            <CardHeader>
              <CardTitle className="text-sm">{group.project_no} · {group.customer_name}</CardTitle>
              {readyCount > 0 && (
                <CardAction>
                  <Button size="sm" disabled={busyProject === group.project_id} onClick={() => generate(group.project_id)}>
                    {busyProject === group.project_id ? 'Generating…' : 'Generate Draft Packing List'}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-col divide-y pt-0">
              {group.items.map(it => (
                <div key={it.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{it.material_description}</div>
                    <div className="text-xs text-muted-foreground">{[it.qty_text, it.size_spec].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  {it.readyForPacking
                    ? <Badge variant="outline" className="shrink-0 border-success/30 bg-success-surface text-success">Ready to pack</Badge>
                    : <Badge variant="outline" className="shrink-0 text-muted-foreground">Waiting</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---- Tab 3: Deliveries (strictly post-dispatch) ----

function DeliveriesTab({ lists }) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const dispatched = lists.filter(l => l.status === 'dispatched');
  const needle = q.trim().toLowerCase();
  const searched = dispatched.filter(l => !needle
    || (l.customer_name || '').toLowerCase().includes(needle)
    || (l.packing_no || '').toLowerCase().includes(needle));
  const shown = showAll ? searched : searched.filter(l => !l.delivery_ack_status);
  const sorted = [...shown].sort((a, b) =>
    new Date(b.dispatched_at || b.created_at) - new Date(a.dispatched_at || a.created_at));

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit rounded-full border bg-muted/50 p-0.5 text-sm">
        <button type="button" onClick={() => setShowAll(false)}
          className={`rounded-full px-3 py-1 transition-colors ${!showAll ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'}`}>
          Awaiting Confirmation
        </button>
        <button type="button" onClick={() => setShowAll(true)}
          className={`rounded-full px-3 py-1 transition-colors ${showAll ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'}`}>
          All
        </button>
      </div>
      {dispatched.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by packing no. or customer…" />}
      {dispatched.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing dispatched yet.</p>
      ) : sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {showAll ? 'No lists match your search.' : 'Nothing awaiting confirmation — every dispatched shipment has been acknowledged. 🎉'}
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {sorted.map(l => (
            <Link key={l.id} href={`/packing/${l.id}`}
              className="flex flex-col gap-1.5 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{l.packing_no}</div>
                <div className="text-xs text-muted-foreground">
                  {l.customer_name} · Dispatched {formatDate(l.dispatched_at || l.created_at)}
                </div>
              </div>
              <AckBadge status={l.delivery_ack_status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Tab 4: Documents (compliance-gap sweep, packed+dispatched only) ----

function ChipToggle({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? 'border-danger/30 bg-danger-surface text-danger' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>
      {children}
    </button>
  );
}

function DocumentsTab({ lists, initialMissingEway = false }) {
  const [q, setQ] = useState('');
  const [missingInvoice, setMissingInvoice] = useState(false);
  const [missingEway, setMissingEway] = useState(initialMissingEway);

  const relevant = lists.filter(l => ['packed', 'dispatched'].includes(l.status));
  const needle = q.trim().toLowerCase();
  let shown = relevant.filter(l => !needle
    || (l.customer_name || '').toLowerCase().includes(needle)
    || (l.packing_no || '').toLowerCase().includes(needle));
  if (missingInvoice) shown = shown.filter(l => !l.sales_invoice_id && !l.invoice_no);
  if (missingEway) shown = shown.filter(l => !l.eway_bill_no);
  const anyFilterActive = missingInvoice || missingEway;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <ChipToggle active={missingInvoice} onClick={() => setMissingInvoice(v => !v)}>Missing Invoice</ChipToggle>
        <ChipToggle active={missingEway} onClick={() => setMissingEway(v => !v)}>Missing E-Way Bill</ChipToggle>
      </div>
      {relevant.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by packing no. or customer…" />}
      {relevant.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing packed or dispatched yet — documents apply once a list is ready to ship.</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {anyFilterActive ? 'Nothing missing — every relevant shipment has its paperwork. 🎉' : 'No lists match this filter.'}
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {shown.map(l => (
            <Link key={l.id} href={`/packing/${l.id}`}
              className="flex flex-col gap-2 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{l.packing_no}</span>
                  <StageBadge status={l.status} />
                </div>
                <div className="text-xs text-muted-foreground">{l.customer_name}</div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm sm:text-right">
                <div>
                  <div className="text-xs text-muted-foreground">Invoice</div>
                  <div className={l.linked_invoice_no || l.invoice_no ? '' : 'font-medium text-danger'}>
                    {l.linked_invoice_no || l.invoice_no || 'Missing'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">E-Way Bill</div>
                  <div className={l.eway_bill_no ? '' : 'font-medium text-danger'}>
                    {l.eway_bill_no ? `${l.eway_bill_no}${l.eway_bill_date ? ' · ' + formatDate(l.eway_bill_date) : ''}` : 'Missing'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Shell ----

export default function DispatchWorkspace({ lists, pendingItems, flowCounts, initialTab }) {
  const [tab, setTab] = useState(['board', 'pending', 'deliveries', 'documents'].includes(initialTab) ? initialTab : 'board');
  // A one-shot seed for Documents' "Missing E-Way Bill" chip when arrived at via the Packing Lists
  // pill — DocumentsTab remounts fresh on every tab switch (conditionally rendered below), so this
  // only matters at the instant of that specific navigation, not as an ongoing controlled value.
  const [docsPrefilter, setDocsPrefilter] = useState(false);

  const pendingReadyCount = pendingItems.filter(it => it.readyForPacking).length;
  const awaitingAckCount = lists.filter(l => l.status === 'dispatched' && !l.delivery_ack_status).length;
  const missingEwayCount = lists.filter(l => ['packed', 'dispatched'].includes(l.status) && !l.eway_bill_no).length;

  const navItems = [
    { key: 'board', label: 'Packing Lists', icon: PackageCheckIcon },
    { key: 'pending', label: 'Pending Items', icon: ClipboardListIcon, badge: pendingReadyCount || null },
    { key: 'deliveries', label: 'Deliveries', icon: TruckIcon, badge: awaitingAckCount || null },
    { key: 'documents', label: 'Documents', icon: FileTextIcon, badge: missingEwayCount || null },
  ];

  // Sidebar clicks always land clean (no stale pre-filter from an earlier pill click); pill clicks
  // go through onPillNavigate below, which may also seed a pre-filter.
  function onSidebarChange(key) {
    setDocsPrefilter(false);
    setTab(key);
  }
  function onPillNavigate(key, opts) {
    setDocsPrefilter(!!opts?.missingEway);
    setTab(key);
  }

  return (
    <WorkspaceSidebar title="Dispatch" icon={PackageIcon} items={navItems} activeKey={tab} onChange={onSidebarChange}>
      {tab === 'board' && (
        <PackingListsTab lists={lists} flowCounts={flowCounts} pendingReadyCount={pendingReadyCount}
          awaitingAckCount={awaitingAckCount} missingEwayCount={missingEwayCount} onNavigate={onPillNavigate} />
      )}
      {tab === 'pending' && <PendingItemsTab items={pendingItems} />}
      {tab === 'deliveries' && <DeliveriesTab lists={lists} />}
      {tab === 'documents' && <DocumentsTab lists={lists} initialMissingEway={docsPrefilter} />}
    </WorkspaceSidebar>
  );
}
