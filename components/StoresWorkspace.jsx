'use client';

// V2-CHANGES.md Group 6 Phase 6.2/6.3 — Stores' inventory workbench. `available` (on_hand minus
// every active reservation, computed in getInventoryItems) is what the low-stock flag reads, not
// raw on_hand — that's the number Stores can actually still promise to a new request.
//
// Reserve -> Issue is a real two-step (D9), not a single decrement: Reserve commits stock against
// one request (reduces `available`, on_hand untouched) so no other request — bom, stock, or sas —
// can be promised the same units; Issue is the actual hand-out moment (on_hand decrements, the
// request's bom_item goes terminal In-Stock). Release undoes an unissued Reserve.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusIcon, PencilIcon, PackageCheckIcon, UndoIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

function isLowStock(item) {
  return item.reorder_point != null && item.available <= item.reorder_point;
}

// Sentinel-project rows (source='stock'/'sas', Phase 6.4) have no real project_no to show.
function requestLabel(item) {
  if (item.source === 'sas') return `SO #${item.sale_order_no || '—'}`;
  if (item.source === 'stock') return 'Stock';
  return item.project_no;
}

function leadingQty(qtyText) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : '1';
}

function ItemFormDialog({ item, onClose, router }) {
  const editing = !!item;
  const [description, setDescription] = useState(item?.description || '');
  const [spec, setSpec] = useState(item?.spec || '');
  const [onHand, setOnHand] = useState(item?.on_hand ?? 0);
  const [location, setLocation] = useState(item?.location || '');
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point ?? '');
  const [itemCode, setItemCode] = useState(item?.item_code || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!description.trim()) return showToast('Description is required', 'error');
    setSaving(true);
    try {
      const body = {
        description: description.trim(), spec: spec.trim() || null, on_hand: onHand,
        location: location.trim() || null, reorder_point: reorderPoint === '' ? null : reorderPoint,
        item_code: itemCode.trim() || null,
      };
      if (editing) await api(`/api/inventory-items/${item.id}`, { method: 'PATCH', body });
      else await api('/api/inventory-items', { method: 'POST', body });
      showToast(editing ? 'Item updated' : 'Item added');
      router.refresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit inventory item' : 'New inventory item'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label>Spec (optional)</Label>
            <Input value={spec} onChange={e => setSpec(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Item code (optional)</Label>
            <Input value={itemCode} onChange={e => setItemCode(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>On-hand</Label>
            <Input type="number" value={onHand} onChange={e => setOnHand(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Reorder point (optional)</Label>
            <Input type="number" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Location (optional)</Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Add item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReserveDialog({ request, inventoryItems, onClose, router }) {
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [qty, setQty] = useState(leadingQty(request.qty_text));
  const [saving, setSaving] = useState(false);

  async function reserve() {
    if (!inventoryItemId) return showToast('Choose an inventory item', 'error');
    setSaving(true);
    try {
      const result = await api(`/api/inventory-items/${inventoryItemId}/reserve`, {
        method: 'POST', body: { bom_item_id: request.id, qty },
      });
      showToast(result.shortfall > 0
        ? `Reserved ${result.reservedQty} — ${result.shortfall} short, still procuring`
        : `Reserved ${result.reservedQty}`);
      router.refresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reserve from stock — {request.material_description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Inventory item</Label>
            <Select value={inventoryItemId} onValueChange={setInventoryItemId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {inventoryItems.map(i => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.description} · {i.available} available</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Quantity</Label>
            <Input type="number" value={qty} onChange={e => setQty(e.target.value)} />
            <p className="text-xs text-muted-foreground">Requested: {request.qty_text || '—'}. Reserving less than requested splits the remainder to keep procuring.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={reserve} disabled={saving || !inventoryItems.length}>{saving ? 'Reserving…' : 'Reserve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenRequestsCard({ openRequests, inventoryItems, router }) {
  const [reserveFor, setReserveFor] = useState(null);
  return (
    <Card>
      <CardHeader><CardTitle>Open requests</CardTitle></CardHeader>
      <CardContent>
        {openRequests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Project / Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openRequests.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.material_description}</TableCell>
                  <TableCell className="text-muted-foreground">{r.qty_text || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{requestLabel(r)}</TableCell>
                  <TableCell><Badge variant="secondary">{r.purchase_status || 'Enquiry'}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={!inventoryItems.length} onClick={() => setReserveFor(r)}>
                      Reserve from stock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {reserveFor && (
        <ReserveDialog request={reserveFor} inventoryItems={inventoryItems} router={router} onClose={() => setReserveFor(null)} />
      )}
    </Card>
  );
}

function ActiveReservationsCard({ activeReservations, router }) {
  const [busyId, setBusyId] = useState(null);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api(`/api/inventory-reservations/${id}/${action}`, { method: 'POST' });
      showToast(action === 'issue' ? 'Issued — item marked In-Stock' : 'Reservation released');
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Active reservations</CardTitle></CardHeader>
      <CardContent>
        {activeReservations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No active reservations.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Reserved for</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Project / Source</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeReservations.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.inventory_description}</TableCell>
                  <TableCell className="text-muted-foreground">{r.material_description}</TableCell>
                  <TableCell>{r.qty}</TableCell>
                  <TableCell className="text-muted-foreground">{requestLabel(r)}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" disabled={busyId === r.id} onClick={() => act(r.id, 'issue')}>
                      <PackageCheckIcon />Issue
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, 'release')}>
                      <UndoIcon />Release
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function StoresWorkspace({ inventoryItems, openRequests = [], activeReservations = [] }) {
  const router = useRouter();
  const [dialogItem, setDialogItem] = useState(undefined); // undefined = closed, null = add, {} = edit
  const lowStockCount = inventoryItems.filter(isLowStock).length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            Inventory
            {lowStockCount > 0 && <Badge variant="destructive" className="ml-2">{lowStockCount} low stock</Badge>}
          </CardTitle>
          <CardAction>
            <Button size="sm" onClick={() => setDialogItem(null)}><PlusIcon />New item</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {inventoryItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No inventory items yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>On-hand</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Reorder pt.</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryItems.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.description}</TableCell>
                    <TableCell className="text-muted-foreground">{it.spec || '—'}</TableCell>
                    <TableCell>{it.on_hand}</TableCell>
                    <TableCell>
                      {it.available}
                      {isLowStock(it) && <Badge variant="destructive" className="ml-2">Low</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.location || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.reorder_point ?? '—'}</TableCell>
                    <TableCell>
                      <Button size="icon-sm" variant="ghost" onClick={() => setDialogItem(it)}><PencilIcon /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {dialogItem !== undefined && (
          <ItemFormDialog item={dialogItem} router={router} onClose={() => setDialogItem(undefined)} />
        )}
      </Card>

      <OpenRequestsCard openRequests={openRequests} inventoryItems={inventoryItems} router={router} />
      <ActiveReservationsCard activeReservations={activeReservations} router={router} />
    </div>
  );
}
