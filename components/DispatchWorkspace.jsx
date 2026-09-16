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
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, showToast, formatDate, formatMoney } from '@/lib/client';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import WorkspaceSidebar from './WorkspaceSidebar';
import DispatchBoard from './DispatchBoard';
import { DispatchApprovalsPanel } from './MaterialApprovalPanels';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import {
  PackageIcon, PackageCheckIcon, ClipboardListIcon, TruckIcon, FileTextIcon,
  SearchIcon, XIcon, ClipboardCheckIcon, FileOutputIcon, PlusIcon, CheckIcon,
  DownloadIcon, PencilIcon,
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

// Same "We pay"/"Customer pays" wording PackingDetail.jsx's own freight_paid_by select already
// uses — read-only here (freight stays editable only on the existing detail page, no second edit
// surface). Reuses freight_amount/freight_paid_by directly off the packing_lists row; no new field.
function FreightInfo({ amount, paidBy }) {
  if (!amount) return <span>No freight recorded</span>;
  const payerLabel = paidBy === 'us' ? 'We pay' : paidBy === 'customer' ? 'Customer pays' : 'Payer not set';
  return <span>Freight {formatMoney(amount)} · {payerLabel}</span>;
}

// Compact per-shipment paperwork status — same fields Documents' own fuller view reads
// (linked_invoice_no/invoice_no, eway_bill_no), condensed to one line for Deliveries' row.
function DocsStatus({ list }) {
  const hasInvoice = !!(list.linked_invoice_no || list.invoice_no);
  const hasEway = !!list.eway_bill_no;
  return (
    <span>
      Invoice {hasInvoice ? '✓' : <span className="font-medium text-danger">✗</span>} · E-Way Bill{' '}
      {hasEway ? '✓' : <span className="font-medium text-danger">✗</span>}
    </span>
  );
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
  // Project View redesign, Wave 1 — /dispatch had no per-project view at all (DispatchBoard's own
  // kanban has no project filter). Same free-text idiom DeliveriesTab/DocumentsTab already use,
  // just matched against project_no/customer_name instead of packing_no. getPackingLists() already
  // joins project_no per list — no new query.
  const [projectQ, setProjectQ] = useState('');

  function toggleStatus(key) {
    setFocusedStatus(cur => (cur === key ? null : key));
  }

  const needle = projectQ.trim().toLowerCase();
  const projectFiltered = needle
    ? lists.filter(l => (l.project_no || '').toLowerCase().includes(needle) || (l.customer_name || '').toLowerCase().includes(needle))
    : lists;
  // "Pending PDF" needs one specific project — surfaced only once the search has narrowed to
  // exactly one project's lists (the same route the project page's own PackingPanel already links,
  // never duplicated here).
  const matchedProjectIds = needle ? [...new Set(projectFiltered.map(l => l.project_id).filter(Boolean))] : [];
  const singleMatch = matchedProjectIds.length === 1
    ? projectFiltered.find(l => l.project_id === matchedProjectIds[0])
    : null;

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
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={projectQ} onChange={setProjectQ} placeholder="Search by project no. or customer…" />
        {singleMatch && (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/projects/${singleMatch.project_id}/pending-pdf`} target="_blank" rel="noreferrer">
              <DownloadIcon className="size-3.5" /> Pending PDF — {singleMatch.project_no}
            </a>
          </Button>
        )}
      </div>
      <div className="border-t pt-4">
        {focusedStatus && (
          <button type="button" onClick={() => setFocusedStatus(null)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted">
            Showing: {STAGE_LABEL[focusedStatus]} only <XIcon className="size-3" />
          </button>
        )}
        <DispatchBoard lists={projectFiltered} statusFilter={focusedStatus} />
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
                  {/* Disabled while ANY project's generate is in flight, not just this one — a
                      single busyProject value can only track one id at a time, so leaving other
                      projects' buttons live would let a second click race the first request. */}
                  <Button size="sm" disabled={!!busyProject} onClick={() => generate(group.project_id)}>
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
                    <div className="text-xs text-muted-foreground">
                      {[it.qty_text, it.size_spec].filter(Boolean).join(' · ') || '—'}
                      {it.qty_breakdown && ` (${it.qty_breakdown.label})`}
                    </div>
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
          {needle ? 'No lists match your search.' : 'Nothing awaiting confirmation — every dispatched shipment has been acknowledged. 🎉'}
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {sorted.map(l => (
            <Link key={l.id} href={`/packing/${l.id}`}
              className="flex flex-col gap-1.5 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{l.packing_no}</span>
                  {/* Project context — a project can have several packing lists (each an
                      independent shipment/lot); showing project_no here is what makes that
                      relationship visible without a separate "Lot" entity. */}
                  {l.project_no && <span className="text-xs text-muted-foreground">{l.project_no}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.customer_name} · Dispatched {formatDate(l.dispatched_at || l.created_at)}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <FreightInfo amount={l.freight_amount} paidBy={l.freight_paid_by} />
                  <DocsStatus list={l} />
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
          {needle
            ? 'No lists match your search.'
            : (anyFilterActive ? 'Nothing missing — every relevant shipment has its paperwork. 🎉' : 'No lists match this filter.')}
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {shown.map(l => (
            <Link key={l.id} href={`/packing/${l.id}`}
              className="flex flex-col gap-2 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.packing_no}</span>
                  {l.project_no && <span className="text-xs text-muted-foreground">{l.project_no}</span>}
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

// ---- Tab 5: Gate Passes (moved here from StoresWorkspace.jsx, Stores IA redesign — returnable/
// non-returnable material leaving/entering the gate is a Dispatch-owned activity; the backend write
// permission was widened from Stores-only to Stores-or-Dispatch alongside this move, see
// app/api/gate-passes/route.js and [id]/route.js) ----

// STERP item 15, Returnable / Non-Returnable Gate Pass. Overdue is computed server-side
// (lib/data.js getGatePasses, is_overdue) — never a client-side date check that could drift from
// what got saved.
const GATE_PASS_STATUS = {
  draft: { cls: '', label: 'Draft' },
  approved: { cls: 'bg-info/10 text-info ring-info/20', label: 'Approved' },
  issued: { cls: 'bg-warning/10 text-warning ring-warning/20', label: 'Issued' },
  returned: { cls: 'bg-success/10 text-success ring-success/20', label: 'Returned' },
  cancelled: { cls: 'bg-muted text-muted-foreground ring-border', label: 'Cancelled' },
};

// `editing` — the gate pass row being fixed (typo in party/responsible person/purpose/item text),
// or null to create a new one. Only ever passed for a still-draft pass (GatePassesCard's own Edit
// button is hidden past draft) — the server re-enforces the same status guard regardless.
function GatePassFormDialog({ editing, onClose, router }) {
  const [type, setType] = useState(editing?.type || 'returnable');
  const [party, setParty] = useState(editing?.party || '');
  const [responsiblePerson, setResponsiblePerson] = useState(editing?.responsible_person || '');
  const [purpose, setPurpose] = useState(editing?.purpose || '');
  const [expectedReturnDate, setExpectedReturnDate] = useState(editing?.expected_return_date || '');
  const [items, setItems] = useState(editing?.items?.length
    ? editing.items.map(it => ({ description: it.description, qty_text: it.qty_text || '' }))
    : [{ description: '', qty_text: '' }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, patch) {
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }

  async function save() {
    const cleanItems = items.filter(it => it.description.trim());
    if (!cleanItems.length) return showToast('Add at least one item', 'error');
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/gate-passes/${editing.id}`, {
          method: 'PATCH',
          body: { edit: { party, responsible_person: responsiblePerson, purpose, expected_return_date: expectedReturnDate, items: cleanItems } },
        });
        showToast(`GP-${editing.gp_no} updated`);
      } else {
        const result = await api('/api/gate-passes', {
          method: 'POST',
          body: {
            type, party, responsible_person: responsiblePerson, purpose,
            expected_return_date: type === 'returnable' ? expectedReturnDate || null : null,
            items: cleanItems,
          },
        });
        showToast(`GP-${result.gp_no} created`);
      }
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{editing ? `Edit GP-${editing.gp_no}` : 'New Gate Pass'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Type (returnable / non-returnable) is fixed at creation — it decides whether an expected
              return date even applies, and letting it flip mid-edit would leave a returnable pass's
              own return-tracking history (§ item returned flags) describing the wrong kind of pass. */}
          {!editing && (
            <div className="inline-flex w-fit rounded-lg border p-0.5">
              <button type="button" onClick={() => setType('returnable')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${type === 'returnable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Returnable
              </button>
              <button type="button" onClick={() => setType('non_returnable')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${type === 'non_returnable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Non-returnable
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Party / destination</Label>
              <Input value={party} onChange={e => setParty(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label>Responsible person</Label>
              <Input value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Purpose</Label>
              <Input value={purpose} onChange={e => setPurpose(e.target.value)} />
            </div>
            {type === 'returnable' && (
              <div className="grid gap-1.5">
                <Label>Expected return date</Label>
                <Input type="date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Items</Label>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Description" value={it.description} onChange={e => updateItem(i, { description: e.target.value })} />
                <Input placeholder="Qty" className="w-24" value={it.qty_text} onChange={e => updateItem(i, { qty_text: e.target.value })} />
              </div>
            ))}
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setItems([...items, { description: '', qty_text: '' }])}>
              <PlusIcon />Add item
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create gate pass')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GatePassesCard({ gatePasses }) {
  const router = useRouter();
  useEntityHighlight(useSearchParams().get('highlight'));
  const [adding, setAdding] = useState(false);
  const [editingGp, setEditingGp] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api(`/api/gate-passes/${id}`, { method: 'PATCH', body: { action } });
      showToast(`Gate pass ${action}d`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  async function toggleItem(gpId, item) {
    setBusyId(gpId);
    try {
      await api(`/api/gate-passes/${gpId}`, { method: 'PATCH', body: { item_id: item.id, returned: !item.returned } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gate Passes</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />New gate pass</Button></CardAction>
      </CardHeader>
      <CardContent>
        {gatePasses.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No gate passes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GP #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Return by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gatePasses.map(gp => (
                <TableRow key={gp.id} data-entity-code={`GP-${gp.gp_no}`}>
                  <TableCell className="font-medium">GP-{gp.gp_no}</TableCell>
                  <TableCell className="text-muted-foreground">{gp.type === 'returnable' ? 'Returnable' : 'Non-returnable'}</TableCell>
                  <TableCell>{gp.party || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{gp.responsible_person || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {gp.items.map(it => (
                        <div key={it.id} className="flex items-center gap-1.5 text-xs">
                          {gp.type === 'returnable' && gp.status === 'issued' ? (
                            <button type="button" disabled={busyId === gp.id} onClick={() => toggleItem(gp.id, it)}
                              className={it.returned ? 'text-success' : 'text-muted-foreground'} title="Toggle returned">
                              {it.returned ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
                            </button>
                          ) : null}
                          <span>{it.description}{it.qty_text ? ` · ${it.qty_text}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {gp.expected_return_date || '—'}
                    {gp.is_overdue ? <Badge variant="destructive" className="ml-2">Overdue</Badge> : null}
                  </TableCell>
                  <TableCell><Badge className={GATE_PASS_STATUS[gp.status]?.cls}>{GATE_PASS_STATUS[gp.status]?.label || gp.status}</Badge></TableCell>
                  <TableCell className="flex justify-end gap-1">
                    {gp.status === 'draft' && (
                      <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditingGp(gp)}>
                        <PencilIcon className="size-4" />
                      </Button>
                    )}
                    {/* asChild renders the <a> itself with button styling — a <Button> (a real
                        <button>) can't be nested inside an <a>, invalid HTML per the same rule
                        §5c's InfoButton note already flags for this codebase. */}
                    <Button asChild size="sm" variant="ghost" title="Download PDF">
                      <a href={`/api/gate-passes/${gp.id}/pdf`} target="_blank" rel="noopener noreferrer">
                        <DownloadIcon className="size-4" />
                      </a>
                    </Button>
                    {gp.status === 'draft' && (
                      <>
                        <Button size="sm" disabled={busyId === gp.id} onClick={() => act(gp.id, 'approve')}>Approve</Button>
                        <Button size="sm" variant="outline" disabled={busyId === gp.id} onClick={() => act(gp.id, 'cancel')}>Cancel</Button>
                      </>
                    )}
                    {gp.status === 'approved' && (
                      <>
                        <Button size="sm" disabled={busyId === gp.id} onClick={() => act(gp.id, 'issue')}>Issue</Button>
                        <Button size="sm" variant="outline" disabled={busyId === gp.id} onClick={() => act(gp.id, 'cancel')}>Cancel</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && <GatePassFormDialog router={router} onClose={() => setAdding(false)} />}
      {editingGp && <GatePassFormDialog editing={editingGp} router={router} onClose={() => setEditingGp(null)} />}
    </Card>
  );
}

// ---- Shell ----

export default function DispatchWorkspace({ lists, pendingItems, flowCounts, approvalQueue = [], gatePasses = [], initialTab }) {
  const [tab, setTab] = useState(['board', 'pending', 'deliveries', 'documents', 'approvals', 'gatepasses'].includes(initialTab) ? initialTab : 'board');
  // A one-shot seed for Documents' "Missing E-Way Bill" chip when arrived at via the Packing Lists
  // pill — DocumentsTab remounts fresh on every tab switch (conditionally rendered below), so this
  // only matters at the instant of that specific navigation, not as an ongoing controlled value.
  const [docsPrefilter, setDocsPrefilter] = useState(false);

  const pendingReadyCount = pendingItems.filter(it => it.readyForPacking).length;
  const awaitingAckCount = lists.filter(l => l.status === 'dispatched' && !l.delivery_ack_status).length;
  const missingEwayCount = lists.filter(l => ['packed', 'dispatched'].includes(l.status) && !l.eway_bill_no).length;
  // Not yet submitted or rejected — the two states Dispatch actually needs to act on from this tab;
  // "pending review"/"approved" are informational only, not counted as needing Dispatch's own action.
  const approvalActionCount = approvalQueue.filter(r => !r.approval_status || r.approval_status === 'rejected').length;
  const overdueGatePassesCount = gatePasses.filter(g => g.is_overdue).length;

  const navItems = [
    { key: 'board', label: 'Packing Lists', icon: PackageCheckIcon },
    { key: 'pending', label: 'Pending Items', icon: ClipboardListIcon, badge: pendingReadyCount || null },
    { key: 'deliveries', label: 'Deliveries', icon: TruckIcon, badge: awaitingAckCount || null },
    { key: 'documents', label: 'Documents', icon: FileTextIcon, badge: missingEwayCount || null },
    // Stores IA redesign — Gate Passes moved here from Stores (a returnable/non-returnable material
    // pass is a real Dispatch-owned gate activity, not an inventory concern).
    { key: 'gatepasses', label: 'Gate Passes', icon: FileOutputIcon, badge: overdueGatePassesCount || null },
    // Inward + Pre-Dispatch QC/Production Approval Workflow — Dispatch's own Submit/Resubmit +
    // status tab (the retired top-level /material-review page's Dispatch-facing read-only view,
    // plus the Submit/Resubmit action that used to live inline on PackingDetail.jsx).
    { key: 'approvals', label: 'Approvals', icon: ClipboardCheckIcon, badge: approvalActionCount || null },
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
      {tab === 'gatepasses' && <GatePassesCard gatePasses={gatePasses} />}
      {tab === 'approvals' && <DispatchApprovalsPanel rows={approvalQueue} />}
    </WorkspaceSidebar>
  );
}
