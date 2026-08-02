'use client';

// The one shared BOM table — Engineering, Procurement, Stores, Production and PM all see the same
// rows; what differs is `editableFields` (from BOM_FIELD_OWNERS via the server). The inline status
// select is the high-frequency action; everything else edits through a small dialog showing only
// the viewer's editable columns. Enforcement lives in the PATCH route — this UI is convenience.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { BOM_STATUSES } from '@/lib/bom-fields.mjs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

const FIELD_LABELS = {
  section: 'Section', group_label: 'Group', material_description: 'Description',
  moc: 'MOC / Material Spec', size_spec: 'Size / Spec', make: 'Make', qty_text: 'Qty',
  purchase_status: 'Status', pr_ref: 'PR No. & Date', po_ref: 'PO No. & Date',
  grn_ref: 'GRN No. & Date', grn_qty_text: 'GRN Qty', pending_qty_text: 'Pending Qty',
  bqtc_ref: 'BQ-TC', issued_ref: 'Issued', received_ref: 'Received', remarks: 'Remarks',
};
// Visible data columns, in spreadsheet order (section/group render as divider rows instead).
const COLUMNS = ['moc', 'size_spec', 'make', 'qty_text', 'pr_ref', 'po_ref',
  'grn_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref', 'remarks'];
const STATUS_TONE = {
  CLOSED: 'bg-success/10 text-success ring-success/20',
  RECEIVED: 'bg-success/10 text-success ring-success/20',
  TRANSIT: 'bg-warning/10 text-warning ring-warning/20',
  CANCELLED: 'bg-danger/10 text-danger ring-danger/20',
};

export default function BomTable({ projectId, bom, pendingIds = [], editableFields = [] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null); // item row | {__new, section} | null
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);
  const packed = new Set(bom.map(b => b.id).filter(id => !pendingIds.includes(id)));

  // One column's worth of horizontal scroll per click — cheaper than hunting for the scrollbar
  // at the bottom of a long page.
  function scrollByCols(dir) {
    scrollerRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  }

  const canInlineStatus = editableFields.includes('purchase_status');
  const canStructure = editableFields.includes('material_description');
  // Dialog fields: the viewer's editable set, minus status (inline select covers it).
  const dialogFields = editableFields.filter(f => f !== 'purchase_status');

  const needle = q.trim().toLowerCase();
  const rows = bom.filter(b => {
    if (statusFilter !== 'all') {
      const st = b.purchase_status || 'PENDING'; // blank counts as pending
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
      rendered.push({ divider: 'section', label: section || 'BOM', key: `s-${section}` });
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
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.material_description}" from the BOM?`)) return;
    try {
      await api(`/api/bom-items/${item.id}`, { method: 'DELETE' });
      showToast('Item deleted');
      router.refresh();
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

      <Table ref={scrollerRef}>
          <TableHeader>
            <TableRow>
              {/* Sticky group: # · Description · Status · Packing · Actions. Fixed widths so the
                  left offsets stack (3+16=19, +8=27, +6=33rem). Status/Packing/Actions pin at md+
                  only — the full ~650px group would exceed a phone viewport. */}
              <TableHead className="sticky left-0 z-10 w-12 bg-background">#</TableHead>
              <TableHead className="sticky left-12 z-10 w-64 min-w-64 max-w-64 bg-background">Description</TableHead>
              <TableHead className="w-32 bg-background md:sticky md:left-[19rem] md:z-10">Status</TableHead>
              <TableHead className={`w-24 bg-background md:sticky md:left-[27rem] md:z-10 ${dialogFields.length ? '' : 'md:border-r'}`}>Packing</TableHead>
              {(dialogFields.length > 0) && <TableHead className="w-20 bg-background md:sticky md:left-[33rem] md:z-10 md:border-r" />}
              {COLUMNS.map(c => <TableHead key={c}>{FIELD_LABELS[c]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rendered.map((r, i) => r.divider ? (
              <TableRow key={r.key} className="hover:bg-transparent">
                <TableCell colSpan={COLUMNS.length + 4 + (dialogFields.length ? 1 : 0)}
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
                <TableCell className="sticky left-12 z-10 w-64 min-w-64 max-w-64 break-words bg-background font-medium">{r.material_description}</TableCell>
                <TableCell className="w-32 bg-background md:sticky md:left-[19rem] md:z-10">
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
                      {r.purchase_status || 'PENDING'}
                    </span>
                  )}
                </TableCell>
                <TableCell className={`w-24 bg-background md:sticky md:left-[27rem] md:z-10 ${dialogFields.length ? '' : 'md:border-r'}`}>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${packed.has(r.id) ? 'bg-success/10 text-success ring-success/20' : 'bg-warning/10 text-warning ring-warning/20'}`}>
                    {packed.has(r.id) ? 'Packed' : 'Pending'}
                  </span>
                </TableCell>
                {dialogFields.length > 0 && (
                  <TableCell className="w-20 whitespace-nowrap bg-background md:sticky md:left-[33rem] md:z-10 md:border-r">
                    <div className="flex items-center gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Edit item" onClick={() => setEditing(r)}>
                        <PencilIcon className="size-3.5" />
                      </Button>
                      {canStructure && (
                        <Button size="icon-sm" variant="ghost" className="text-danger" aria-label="Delete item" onClick={() => remove(r)}>
                          <TrashIcon className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
                {COLUMNS.map(c => (
                  <TableCell key={c} className="whitespace-nowrap text-muted-foreground">{r[c] || '—'}</TableCell>
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
