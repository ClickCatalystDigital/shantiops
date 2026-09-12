'use client';

// components/PoDeliveryLotsWorkspace.jsx — "Delivery Lots," a top-level Procurement sidebar tab,
// sibling to Purchase Orders/Status/Returns/Vendor Bills, sitting right after Purchase Orders in
// the nav (issue -> schedule delivery -> track status -> returns/bills). Deliberately NOT nested
// under Purchase Orders as a group/child (that shape — like Suppliers' Roster/Analysis — is for two
// views of one entity; this is "pick an issued PO, then record something against it," the exact
// same shape Returns and Vendor Bills already have as their own top-level tabs, not sub-tabs of
// Purchase Orders). Lets Procurement group ONE issued PO's items — across projects, across
// partial quantities — into one or more named delivery lots, each with its own expected date.
// Whatever's never put into a lot keeps showing supplier_quotes' own expected_delivery_date as a
// fallback ("keep the RFQ date" rule). Distinct from bom_item_expected_children/LotsEditor (Stores'
// own unit-routing reference, no qty, no date) — that feature is untouched and unrelated.
//
// Data model, spelled out since it's not obvious from the UI alone: a delivery lot belongs to
// exactly ONE purchase order (it's one physical shipment against that PO) — a lot can never span
// multiple POs. A single PO can have as many lots as it has separate expected shipments. One lot
// can cover several of that PO's items at once, including items on different projects.
//
// Only ISSUED purchase orders are offered here — a draft PO's lines aren't a real commitment yet,
// so there's nothing meaningful to schedule delivery against until the supplier actually has the
// order. The API enforces this too (not just the picker), so a stale/direct request can't bypass it.
import { useState, useEffect, useMemo } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';
import { EntityCode } from '@/components/EntityRefLink';
import { projectLabel } from '@/lib/project-label';

function ItemRefs({ item }) {
  return (
    <div className="flex flex-wrap gap-1">
      <EntityCode code={`BM-${item.bom_item_id}`} fallback={`BOM item #${item.bom_item_id}`} />
      {item.pr_no && <EntityCode code={item.pr_no} fallback={item.pr_no} />}
    </div>
  );
}

export default function PoDeliveryLotsWorkspace({ purchaseOrders }) {
  const [poId, setPoId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLot, setEditingLot] = useState(null);

  const issuedOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'issued'), [purchaseOrders]);
  const poOptions = useMemo(
    () => issuedOrders.map(po => ({ value: String(po.id), label: `${po.po_no} — ${po.supplier_name}` })),
    [issuedOrders]
  );

  function refetch(id) {
    api(`/api/purchase-orders/${id}/delivery-lots`)
      .then(setDetail)
      .catch(err => {
        showToast(err.message, 'error');
        setPoId(null);
        setDetail(null);
      });
  }

  useEffect(() => {
    if (!poId) { setDetail(null); return; }
    refetch(poId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  async function deleteLot(lotId) {
    if (!window.confirm('Delete this delivery lot?')) return;
    try {
      await api(`/api/purchase-orders/${poId}/delivery-lots/${lotId}`, { method: 'DELETE' });
      showToast('Lot deleted');
      refetch(poId);
    } catch (err) { showToast(err.message, 'error'); }
  }

  function openCreate() { setEditingLot(null); setDialogOpen(true); }
  function openEdit(lot) { setEditingLot(lot); setDialogOpen(true); }

  return (
    <div className="flex flex-col gap-4">
      {/* overflow-visible overrides Card's own baked-in overflow-hidden — without it the search
          dropdown below gets clipped at the card's bottom edge instead of floating over the page. */}
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Delivery Lots</CardTitle>
          <CardDescription>
            Pick an issued purchase order, then group its items into one or more expected
            deliveries. A lot belongs to this PO only; a PO can have as many lots as it has
            separate shipments, and one lot can cover several items — even across projects.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {issuedOrders.length ? (
            <SearchableSelect
              options={poOptions}
              value={poId ? String(poId) : ''}
              onChange={v => setPoId(v ? Number(v) : null)}
              placeholder="Search by PO number or supplier…"
              className="max-w-md"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No issued purchase orders yet — issue a PO first.</p>
          )}
        </CardContent>
      </Card>

      {poId && !detail && <p className="text-sm text-muted-foreground">Loading…</p>}

      {poId && detail && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
              <CardAction>
                <Button size="sm" onClick={openCreate}>+ Add Lot</Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Refs</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Total Qty</TableHead>
                    <TableHead>Allocated Qty</TableHead>
                    <TableHead>Unallocated Qty</TableHead>
                    <TableHead>Expected Delivery</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell><ItemRefs item={item} /></TableCell>
                      <TableCell>{projectLabel(item)}</TableCell>
                      <TableCell>{item.qty} {item.uom}</TableCell>
                      <TableCell>{item.allocated_qty} {item.uom}</TableCell>
                      <TableCell>{item.unallocated_qty} {item.uom}</TableCell>
                      <TableCell>
                        {item.unallocated_qty > 0
                          ? (item.rfq_expected_delivery_date ? formatDate(item.rfq_expected_delivery_date) : '—')
                          : <span className="text-muted-foreground">Fully scheduled</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Lots</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!detail.lots.length && <p className="text-sm text-muted-foreground">No delivery lots scheduled yet.</p>}
              {detail.lots.map(lot => (
                <div key={lot.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      {detail.lots.length > 1 && (
                        <span className="mr-1.5 text-xs font-medium text-muted-foreground">Lot {lot.lot_label}</span>
                      )}
                      <span className="font-medium">{formatDate(lot.expected_delivery_date)}</span>
                      {lot.notes && <span className="text-muted-foreground"> — {lot.notes}</span>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(lot)}>Edit</Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => deleteLot(lot.id)}>Delete</Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 border-t pt-2">
                    {lot.items.map(li => (
                      <div key={li.po_item_id} className="flex flex-wrap items-center gap-2 text-xs">
                        <EntityCode code={`BM-${li.bom_item_id}`} fallback={`BOM item #${li.bom_item_id}`} />
                        {li.pr_no && <EntityCode code={li.pr_no} fallback={li.pr_no} />}
                        <span className="text-foreground">{li.description}</span>
                        {li.project_no && <span className="text-muted-foreground">· {li.project_no}</span>}
                        <Badge variant="secondary" className="font-normal">{li.qty}</Badge>
                        {li.child_projects.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {li.child_projects.map(cp => (
                              <Badge key={cp.child_project_id} variant="outline">{cp.project_no}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {dialogOpen && (
        <LotDialog
          poId={poId}
          items={detail?.items || []}
          existingLotsCount={detail?.lots.length || 0}
          editingLot={editingLot}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); refetch(poId); }}
        />
      )}
    </div>
  );
}

// One item row inside the Add/Edit dialog — owns its own child-project fetch so the checkbox strip
// only loads once, the first time this item's qty goes above 0, and stays cached for the rest of
// the dialog's lifetime (this component instance doesn't remount just because qty changes).
function LotDialogItemRow({ item, remaining, qty, checkedChildIds, onQtyChange, onToggleChild }) {
  const [children, setChildren] = useState(null);

  useEffect(() => {
    if (!item.has_children || !(qty > 0) || children !== null) return;
    api(`/api/projects/${item.project_id}/split`)
      .then(d => setChildren(d.children || []))
      .catch(() => setChildren([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.has_children, item.project_id, qty > 0]);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span>{item.description}</span>
          <span className="text-xs text-muted-foreground">
            {projectLabel(item)} · {remaining} {item.uom} unallocated
          </span>
          <ItemRefs item={item} />
        </div>
        <Input type="number" min="0" max={remaining} step="any" className="w-28 shrink-0"
          value={qty || ''} onChange={e => onQtyChange(e.target.value)} placeholder="0" />
      </div>
      {item.has_children && qty > 0 && (
        <div className="rounded-md border border-dashed p-2 text-xs">
          <p className="mb-1 font-medium text-muted-foreground">Which units? (optional)</p>
          {children === null ? (
            <p className="text-muted-foreground">Loading units…</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {children.map(c => (
                <label key={c.id} className="flex items-center gap-1.5">
                  <Checkbox checked={checkedChildIds.includes(c.id)} onCheckedChange={() => onToggleChild(c.id)} />
                  {c.project_no}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LotDialog({ poId, items, existingLotsCount, editingLot, onClose, onSaved }) {
  const [expectedDate, setExpectedDate] = useState(editingLot?.expected_delivery_date || '');
  const [lotLabel, setLotLabel] = useState(editingLot?.lot_label || '');
  const [notes, setNotes] = useState(editingLot?.notes || '');
  const [qtyByItem, setQtyByItem] = useState(() => {
    const m = {};
    if (editingLot) for (const li of editingLot.items) m[li.po_item_id] = li.qty;
    return m;
  });
  const [childrenByItem, setChildrenByItem] = useState(() => {
    const m = {};
    if (editingLot) for (const li of editingLot.items) m[li.po_item_id] = li.child_projects.map(c => c.child_project_id);
    return m;
  });
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    return items
      .map(item => {
        const existingQty = editingLot?.items.find(li => li.po_item_id === item.id)?.qty || 0;
        const remaining = Math.round((item.unallocated_qty + existingQty) * 1e6) / 1e6;
        return { item, remaining };
      })
      .filter(r => r.remaining > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // "Label" only matters once there's more than one lot to tell apart — the common case (a PO with
  // exactly one delivery) never needs it and silently defaults to '1', same convention LotsEditor
  // already uses for the sibling Stores feature. editingLot counts as already-existing (not +1).
  const totalLotsAfterSave = existingLotsCount + (editingLot ? 0 : 1);
  const showLabel = totalLotsAfterSave > 1;

  function setQty(itemId, remaining, raw) {
    const v = Math.min(Math.max(0, Number(raw) || 0), remaining);
    setQtyByItem(m => ({ ...m, [itemId]: v }));
  }

  function toggleChild(itemId, childId) {
    setChildrenByItem(m => {
      const cur = m[itemId] || [];
      return { ...m, [itemId]: cur.includes(childId) ? cur.filter(id => id !== childId) : [...cur, childId] };
    });
  }

  const canSave = expectedDate && rows.some(({ item }) => (qtyByItem[item.id] || 0) > 0);

  async function save() {
    const payloadItems = rows
      .map(({ item }) => ({ po_item_id: item.id, qty: qtyByItem[item.id] || 0, child_project_ids: childrenByItem[item.id] || [] }))
      .filter(i => i.qty > 0);
    if (!expectedDate) { showToast('Pick an expected delivery date', 'error'); return; }
    if (!payloadItems.length) { showToast('Enter a quantity for at least one item', 'error'); return; }
    setSaving(true);
    try {
      const body = { lot_label: lotLabel || undefined, expected_delivery_date: expectedDate, notes: notes || undefined, items: payloadItems };
      if (editingLot) {
        await api(`/api/purchase-orders/${poId}/delivery-lots/${editingLot.id}`, { method: 'PATCH', body });
      } else {
        await api(`/api/purchase-orders/${poId}/delivery-lots`, { method: 'POST', body });
      }
      showToast(editingLot ? 'Lot updated' : 'Lot created');
      onSaved();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingLot ? 'Edit Delivery Lot' : 'Add Delivery Lot'}</DialogTitle>
          <DialogDescription>
            One lot is one expected shipment for this purchase order — set a quantity for every
            item it will include.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="mb-1.5 text-xs text-muted-foreground">Expected delivery date</Label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} required />
            </div>
            {showLabel && (
              <div className="w-32">
                <Label className="mb-1.5 text-xs text-muted-foreground">Label</Label>
                <Input value={lotLabel} onChange={e => setLotLabel(e.target.value)} placeholder={String(totalLotsAfterSave)} />
              </div>
            )}
          </div>
          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. courier reference, part shipment note" />
          </div>
          <div className="flex flex-col gap-2">
            {rows.map(({ item, remaining }) => (
              <LotDialogItemRow
                key={item.id}
                item={item}
                remaining={remaining}
                qty={qtyByItem[item.id] || 0}
                checkedChildIds={childrenByItem[item.id] || []}
                onQtyChange={raw => setQty(item.id, remaining, raw)}
                onToggleChild={childId => toggleChild(item.id, childId)}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
