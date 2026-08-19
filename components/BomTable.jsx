'use client';

// The one shared BOM table — Engineering, Procurement, Stores, Production and PM all see the same
// rows; what differs is `editableFields` (from BOM_FIELD_OWNERS via the server). The inline status
// select is the high-frequency action; everything else edits through a small dialog showing only
// the viewer's editable columns. Enforcement lives in the PATCH route — this UI is convenience.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { BOM_STATUSES, STATUS_TONE, DEFAULT_PURCHASE_STATUS, visibleBomColumns, showPackingColumn } from '@/lib/bom-fields.mjs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { ChevronLeftIcon, ChevronRightIcon, XCircleIcon } from 'lucide-react';

// D10 (Group 5 Bundle B, Phase 5.4) — cancellable at Enquiry/Comparison/Ordered, blocked once
// Transit (shipped). Mirrors the API route's own CANCELLABLE set (app/api/bom-items/[id]/cancel) —
// duplicated here only so the button can hide itself without a round trip; the route is the real
// gate.
const CANCELLABLE = new Set(['Enquiry', 'Comparison', 'Ordered']);

const FIELD_LABELS = {
  section: 'Section', group_label: 'Group', material_description: 'Description',
  moc: 'MOC / Material Spec', size_spec: 'Size / Spec', make: 'Make', qty_text: 'Qty',
  purchase_status: 'Status', pr_ref: 'PR No. & Date', po_ref: 'PO No. & Date',
  grn_ref: 'GRN No. & Date', grn_qty_text: 'GRN Qty', pending_qty_text: 'Pending Qty',
  bqtc_ref: 'BQ-TC', issued_ref: 'Issued', received_ref: 'Received',
  production_done: 'Prod. Done', remarks: 'Remarks',
};
// Visible data columns, in spreadsheet order (section/group render as divider rows instead).
const COLUMNS = ['moc', 'size_spec', 'make', 'qty_text', 'pr_ref', 'po_ref',
  'grn_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref',
  'production_done', 'remarks'];
// table-fixed (see the Table usage below) only respects the header row's widths, then applies
// them to every row in that column — these need to exist for every entry in COLUMNS or that
// column falls back to an even, too-narrow equal split alongside the others.
const COLUMN_WIDTHS = {
  moc: 'w-36', size_spec: 'w-28', make: 'w-20', qty_text: 'w-16', pr_ref: 'w-32', po_ref: 'w-32',
  grn_ref: 'w-32', grn_qty_text: 'w-20', pending_qty_text: 'w-24', bqtc_ref: 'w-20',
  issued_ref: 'w-24', received_ref: 'w-24', production_done: 'w-20', remarks: 'w-40',
};
// `onSaved` (optional): fires alongside router.refresh() after any successful mutation — additive,
// every existing caller keeps working unchanged (router.refresh() alone refreshes server-rendered
// props). Needed by callers whose `bom` is client-fetched local state instead (ReleaseBomTab, same
// as ProductionBomTab already is) — router.refresh() can't touch that state, so nothing but this
// callback ever tells them to refetch.
export default function BomTable({ projectId, bom, pendingIds = [], editableFields = [], department, canCancel = false, onSaved }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null); // item row | {__new, section} | null
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);
  const packed = new Set(bom.map(b => b.id).filter(id => !pendingIds.includes(id)));
  const columns = visibleBomColumns(department, COLUMNS);
  const showPacking = showPackingColumn(department);
  const actionsLeft = showPacking ? 'md:left-[33rem]' : 'md:left-[27rem]';

  // One column's worth of horizontal scroll per click — cheaper than hunting for the scrollbar
  // at the bottom of a long page.
  function scrollByCols(dir) {
    scrollerRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  }

  const canInlineStatus = editableFields.includes('purchase_status');
  const canToggleProductionDone = editableFields.includes('production_done');
  const canStructure = editableFields.includes('material_description');
  // Dialog fields: the viewer's editable set, minus status and production_done (both get their own
  // inline control — a text-input dialog is the wrong shape for a boolean toggle).
  const dialogFields = editableFields.filter(f => f !== 'purchase_status' && f !== 'production_done');
  // The Actions column exists for edit/delete (dialogFields) OR the D10 cancel button — Design has
  // no editable fields at all (no BOM_FIELD_OWNERS entry) but still needs this column for Cancel.
  const hasActions = dialogFields.length > 0 || canCancel;

  const needle = q.trim().toLowerCase();
  const rows = bom.filter(b => {
    if (statusFilter !== 'all') {
      const st = b.purchase_status || DEFAULT_PURCHASE_STATUS; // blank counts as Enquiry
      if (st !== statusFilter) return false;
    }
    if (!needle) return true;
    return ['material_description', 'moc', 'size_spec', 'make', 'group_label', 'pr_ref', 'po_ref', 'grn_ref', 'remarks']
      .some(f => String(b[f] || '').toLowerCase().includes(needle));
  });

  // Preserve sort_order; emit divider rows when section / group_label change.
  const rendered = [];
  let lastSection, lastGroup;
  for (const b of rows) {
    const section = b.section || '';
    if (section !== lastSection) {
      // Pre-existing bug, fixed in passing: a section name that reappears non-contiguously
      // (BOILER -> BOM -> MOUNTINGS -> BOILER again) used to collide on the same `s-${section}`
      // key across separate divider rows — React's "two children with the same key" warning,
      // caught live while verifying Bundle B on a Design view. `b.id` (the first row of this new
      // run) makes every occurrence unique, same fix the group divider below already had.
      rendered.push({ divider: 'section', label: section || 'BOM', key: `s-${section}-${b.id}` });
      lastSection = section; lastGroup = undefined;
    }
    if ((b.group_label || '') !== lastGroup) {
      lastGroup = b.group_label || '';
      if (lastGroup) rendered.push({ divider: 'group', label: lastGroup, key: `g-${section}-${lastGroup}-${b.id}` });
    }
    rendered.push(b);
  }

  async function setStatus(item, value) {
    try {
      await api(`/api/bom-items/${item.id}`, { method: 'PATCH', body: { purchase_status: value === 'none' ? '' : value } });
      router.refresh();
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // Production's own signal that a line is fabricated — Dispatch can only pull it onto a packing
  // list once this is set (getProjectBom's readyForPacking).
  async function toggleProductionDone(item, checked) {
    try {
      await api(`/api/bom-items/${item.id}`, { method: 'PATCH', body: { production_done: checked ? 1 : 0 } });
      router.refresh();
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function saveDialog(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const body = {};
    for (const f of dialogFields) body[f] = String(form.get(f) ?? '');
    setBusy(true);
    try {
      if (editing.__new) {
        await api('/api/bom-items', { method: 'POST', body: { project_id: projectId, ...body } });
        showToast('Item added');
      } else {
        await api(`/api/bom-items/${editing.id}`, { method: 'PATCH', body });
        showToast('Item updated');
      }
      setEditing(null);
      router.refresh();
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.material_description}" from the BOM?`)) return;
    try {
      await api(`/api/bom-items/${item.id}`, { method: 'DELETE' });
      showToast('Item deleted');
      router.refresh();
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function cancelItem(item) {
    if (!window.confirm(`Cancel "${item.material_description}"? This can't be undone.`)) return;
    try {
      await api(`/api/bom-items/${item.id}/cancel`, { method: 'POST' });
      showToast('Item cancelled');
      router.refresh();
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, PO, GRN…"
          className="h-8 w-56" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tnum">{rows.length} of {bom.length} items</span>
        {/* Jump the wide table left/right without hunting for the scrollbar at the bottom of the page. */}
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Scroll table left" onClick={() => scrollByCols(-1)}>
            <ChevronLeftIcon />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Scroll table right" onClick={() => scrollByCols(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
        {canStructure && (
          <Button size="sm" variant="outline" className="ml-auto"
            onClick={() => setEditing({ __new: true, section: lastSection || '' })}>
            + Add item
          </Button>
        )}
      </div>

      {/* table-fixed is load-bearing, not decorative: the sticky offsets below (left-12,
          left-[19rem], left-[27rem]) are hardcoded assuming each column renders at exactly its
          declared w-* width. table-layout's default (auto) lets content shrink a column below
          that (e.g. "#" with single-digit rows), so the offsets stop matching reality and the
          scrolling columns physically overlap/bleed under the sticky ones instead of hiding
          cleanly behind them. Fixed layout forces the declared widths to actually be honored. */}
      <Table ref={scrollerRef} className="table-fixed">
          <TableHeader>
            <TableRow>
              {/* Sticky group: # · Description · Status · Packing · Actions. Fixed widths so the
                  left offsets stack (3+16=19, +8=27, +6=33rem). Status/Packing/Actions pin at md+
                  only — the full ~650px group would exceed a phone viewport. Packing (Dispatch's
                  column, not Procurement's job) drops out for a scoped department (§5c) — Actions
                  then shifts left to 27rem to close the gap. */}
              <TableHead className="sticky left-0 z-10 w-12 bg-background">#</TableHead>
              <TableHead className="sticky left-12 z-10 w-64 min-w-64 max-w-64 bg-background">Description</TableHead>
              <TableHead className={`w-32 bg-background md:sticky md:left-[19rem] md:z-10 ${!showPacking && !hasActions ? 'md:border-r' : ''}`}>Status</TableHead>
              {showPacking && (
                <TableHead className={`w-24 bg-background md:sticky md:left-[27rem] md:z-10 ${hasActions ? '' : 'md:border-r'}`}>Packing</TableHead>
              )}
              {hasActions && <TableHead className={`w-20 bg-background md:sticky ${actionsLeft} md:z-10 md:border-r`} />}
              {columns.map(c => <TableHead key={c} className={COLUMN_WIDTHS[c] || 'w-28'}>{FIELD_LABELS[c]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rendered.map((r, i) => r.divider ? (
              <TableRow key={r.key} className="hover:bg-transparent">
                <TableCell colSpan={columns.length + (showPacking ? 4 : 3) + (hasActions ? 1 : 0)}
                  className={r.divider === 'section'
                    ? 'bg-muted/50 font-semibold'
                    : 'pl-6 text-xs font-medium uppercase tracking-wide text-muted-foreground'}>
                  {/* sticky-left so section/assembly headings stay readable mid horizontal scroll */}
                  <span className="sticky left-2 inline-block max-w-[80vw]">{r.label}</span>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={r.id}>
                <TableCell className="sticky left-0 z-10 w-12 bg-background tnum text-muted-foreground">{bom.indexOf(r) + 1}</TableCell>
                <TableCell className="sticky left-12 z-10 w-64 min-w-64 max-w-64 break-words bg-background font-medium">
                  {r.material_description}
                  {/* Item Master identity (§3.2) — the catalog's own code, shown only when this
                      line is actually linked (item_id), never a free-typed value. */}
                  {(r.catalog_item_code || r.drawing_name || r.template_name) && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {[
                        r.catalog_item_code,
                        r.drawing_name && `Drg DWG-${String(r.drawing_id).padStart(4, '0')} · ${r.drawing_name}${r.drawing_revision ? ` (${r.drawing_revision})` : ''}`,
                        r.template_name && `via ${r.template_name}`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {/* Derived from selected_quote_id (§5a) — set via the Procurement workspace's
                      supplier selection, not editable here. */}
                  {r.selected_supplier_name && (
                    <div className="text-xs font-normal text-muted-foreground">Supplier: {r.selected_supplier_name}</div>
                  )}
                </TableCell>
                <TableCell className={`w-32 bg-background md:sticky md:left-[19rem] md:z-10 ${!showPacking && !hasActions ? 'md:border-r' : ''}`}>
                  {canInlineStatus ? (
                    <Select value={r.purchase_status || 'none'} onValueChange={v => setStatus(r, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[r.purchase_status] || 'bg-muted text-muted-foreground ring-border'}`}>
                      {r.purchase_status || DEFAULT_PURCHASE_STATUS}
                    </span>
                  )}
                </TableCell>
                {showPacking && (
                  <TableCell className={`w-24 bg-background md:sticky md:left-[27rem] md:z-10 ${hasActions ? '' : 'md:border-r'}`}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${packed.has(r.id) ? 'bg-success/10 text-success ring-success/20' : 'bg-warning/10 text-warning ring-warning/20'}`}>
                      {packed.has(r.id) ? 'Packed' : 'Pending'}
                    </span>
                  </TableCell>
                )}
                {hasActions && (
                  <TableCell className={`w-20 whitespace-nowrap bg-background md:sticky ${actionsLeft} md:z-10 md:border-r`}>
                    <div className="flex items-center gap-1">
                      {dialogFields.length > 0 && (
                        <Button size="icon-sm" variant="ghost" aria-label="Edit item" onClick={() => setEditing(r)}>
                          <PencilIcon className="size-3.5" />
                        </Button>
                      )}
                      {canStructure && (
                        <Button size="icon-sm" variant="ghost" className="text-danger" aria-label="Delete item" onClick={() => remove(r)}>
                          <TrashIcon className="size-3.5" />
                        </Button>
                      )}
                      {/* D10 — Eng/Design cancel directly, no Procurement accept step. Hidden once
                          the item is past Ordered (Transit+), or already terminal. */}
                      {canCancel && CANCELLABLE.has(r.purchase_status || DEFAULT_PURCHASE_STATUS) && (
                        <Button size="icon-sm" variant="ghost" className="text-danger" aria-label="Cancel item" onClick={() => cancelItem(r)}>
                          <XCircleIcon className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
                {columns.map(c => (
                  <TableCell key={c} className="whitespace-nowrap text-muted-foreground">
                    {c === 'production_done' ? (
                      canToggleProductionDone ? (
                        <input type="checkbox" checked={!!r.production_done} aria-label="Production done"
                          onChange={e => toggleProductionDone(r, e.target.checked)} />
                      ) : (r.production_done ? 'Done' : '—')
                    ) : (r[c] || '—')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.__new ? 'Add BOM item' : 'Edit BOM item'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveDialog} className="flex flex-col gap-3">
              {!editing.__new && !dialogFields.includes('material_description') && (
                <p className="text-sm text-muted-foreground">{editing.material_description}</p>
              )}
              {dialogFields.map(f => (
                <div key={f} className="flex flex-col gap-1">
                  <Label htmlFor={`bom-${f}`}>{FIELD_LABELS[f]}</Label>
                  <Input id={`bom-${f}`} name={f} defaultValue={editing[f] || ''}
                    required={f === 'material_description'} />
                </div>
              ))}
              <DialogFooter>
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
