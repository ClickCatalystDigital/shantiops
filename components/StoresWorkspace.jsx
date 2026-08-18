'use client';

// V2-CHANGES.md Group 6 Phase 6.2/6.3 — Stores' inventory workbench. `available` (on_hand minus
// every active reservation, computed in getInventoryItems) is what the low-stock flag reads, not
// raw on_hand — that's the number Stores can actually still promise to a new request.
//
// Reserve -> Issue is a real two-step (D9), not a single decrement: Reserve commits stock against
// one request (reduces `available`, on_hand untouched) so no other request — bom, stock, or sas —
// can be promised the same units; Issue is the actual hand-out moment (on_hand decrements, the
// request's bom_item goes terminal In-Stock). Release undoes an unissued Reserve.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusIcon, PencilIcon, PackageCheckIcon, UndoIcon, TruckIcon, PackageIcon, ClipboardListIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

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

// STORES-SALES-CHANGES.md §3.1 — the cheap win: plain keyword overlap, a non-binding nudge, never
// auto-reserves. §3.2 built the real fix on top: when both sides were picked from the item catalog
// (ItemSearchField / Stores' New Item dialog), request.item_id === inventory row's item_id is an
// actual match, not a guess — possibleMatches() below prefers that whenever it exists.
function normalizeWords(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
}
// STORES-SALES-CHANGES.md §2c — Stores' entire workspace used to be three plain, disconnected
// tables with no "here's what needs your attention today" signal and no cross-referencing between
// them. This is that signal: a one-glance summary computed from the same three lists already on
// the page (no new query, no new schema). Each chip switches to the sidebar tab it counts — the
// workspace moved to WorkspaceSidebar's tabbed sections, so an anchor-jump to an on-page div id
// no longer reaches a section that isn't mounted on the current tab.
function TodaySummary({ inventoryItems, openRequests, activeReservations, onNavigate }) {
  const lowStock = inventoryItems.filter(isLowStock).length;
  const withMatch = openRequests.filter(r => possibleMatches(r, inventoryItems).length > 0).length;
  const chips = [
    { tab: 'requests', dot: 'bg-warning', value: openRequests.length, label: 'open request' + (openRequests.length === 1 ? '' : 's') },
    { tab: 'requests', dot: 'bg-info', value: withMatch, label: 'with a possible match' },
    { tab: 'inventory', dot: 'bg-danger', value: lowStock, label: 'low stock' },
    { tab: 'reservations', dot: 'bg-success', value: activeReservations.length, label: 'ready to issue' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <button key={c.label} type="button" onClick={() => onNavigate(c.tab)}
          className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-muted/50">
          <span className={`size-2 rounded-full ${c.dot}`} />
          <span className="font-semibold tnum">{c.value}</span>
          <span className="text-muted-foreground">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

function possibleMatches(request, inventoryItems) {
  if (request.item_id) {
    const exact = inventoryItems.filter(it => it.item_id === request.item_id && it.available > 0);
    if (exact.length) return exact.slice(0, 2).map(item => ({ item, exact: true }));
  }
  const reqWords = new Set(normalizeWords(request.material_description));
  if (!reqWords.size) return [];
  return inventoryItems
    .map(it => ({ item: it, score: normalizeWords(it.description).filter(w => reqWords.has(w)).length }))
    .filter(m => m.score > 0 && m.item.available > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(m => ({ item: m.item, exact: false }));
}

function ItemFormDialog({ item, onClose, router }) {
  const editing = !!item;
  const [description, setDescription] = useState(item?.description || '');
  const [spec, setSpec] = useState(item?.spec || '');
  const [onHand, setOnHand] = useState(item?.on_hand ?? 0);
  const [location, setLocation] = useState(item?.location || '');
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point ?? '');
  const [itemCode, setItemCode] = useState(item?.item_code || '');
  const [itemId, setItemId] = useState(item?.item_id || null);
  const [saving, setSaving] = useState(false);
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  // §3.2 catalog wiring — same search endpoint/idiom as PrWorkspace's ItemSearchField, so a
  // picked-from-catalog inventory row and a picked-from-catalog BOM/PR line can share item_id for
  // real (not fuzzy-keyword) matching. Hand-editing after a pick clears the link, same reasoning.
  async function onDescriptionChange(v) {
    setDescription(v);
    setItemId(null);
    if (v.trim().length < 2) { setCatalogResults([]); setCatalogOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setCatalogResults(rows);
      setCatalogOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }
  function pickCatalogItem(it) {
    setDescription(it.item_name);
    setSpec(it.detail_desc || '');
    setItemCode(it.item_code || '');
    setItemId(it.id);
    setCatalogOpen(false);
  }

  async function save() {
    if (!description.trim()) return showToast('Description is required', 'error');
    setSaving(true);
    try {
      const body = {
        description: description.trim(), spec: spec.trim() || null, on_hand: onHand,
        location: location.trim() || null, reorder_point: reorderPoint === '' ? null : reorderPoint,
        item_code: itemCode.trim() || null, item_id: itemId,
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
          <div className="relative col-span-2 grid gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={e => onDescriptionChange(e.target.value)}
              onFocus={() => setCatalogOpen(catalogResults.length > 0)} onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
              placeholder="Search the item catalog, or just type a description" autoFocus />
            {itemId && <p className="text-xs text-success">✓ Linked to catalog — real matching against BOM/PR lines now possible for this item.</p>}
            {catalogOpen && (
              <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {catalogResults.map(it => (
                  <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
                    onMouseDown={() => pickCatalogItem(it)}>
                    <span className="font-medium">{it.item_name}</span>
                    <span className="text-xs text-muted-foreground">{it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}</span>
                  </button>
                ))}
              </div>
            )}
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
  const [busyId, setBusyId] = useState(null);

  // Manual-mode gate (STORES-SALES-CHANGES.md) — a pending_review line hasn't been sent to
  // Procurement yet; Procure is the explicit "no, buy it" decision. Reserve already works
  // unmodified on these rows (reserveFromStock never checked purchase_status/pending_review).
  async function procure(r) {
    setBusyId(r.id);
    try {
      await api(`/api/bom-items/${r.id}/procure`, { method: 'POST' });
      showToast('Sent to Procurement');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

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
              {openRequests.map(r => {
                const matches = possibleMatches(r, inventoryItems);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.material_description}
                      {matches.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {matches.map(({ item, exact }) => (
                            <Badge key={item.id} variant="outline"
                              className={exact ? 'border-success/30 bg-success-surface text-xs font-normal text-success' : 'text-xs font-normal text-muted-foreground'}
                              title={exact ? 'Same catalog item — a real match, not a guess.' : 'Non-binding keyword overlap — confirm before reserving.'}>
                              {exact ? '✓' : '≈'} {item.description} ({item.available} avail)
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.qty_text || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{requestLabel(r)}</TableCell>
                    <TableCell>
                      {r.pending_review
                        ? <Badge className="border-warning/30 bg-warning-surface text-warning" title="Not visible to Procurement yet — Reserve or Procure it.">Stores Review</Badge>
                        : <Badge variant="secondary">{r.purchase_status || 'Enquiry'}</Badge>}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={!inventoryItems.length} onClick={() => setReserveFor(r)}>
                        Reserve from stock
                      </Button>
                      {r.pending_review === 1 && (
                        <Button size="sm" disabled={busyId === r.id} onClick={() => procure(r)}>
                          {busyId === r.id ? 'Sending…' : 'Procure'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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

// STORES-SALES-CHANGES.md — Stores already had server-side permission to log a material issue
// (app/api/material-issues/route.js's canIssue allows Stores OR Production) but no UI to use it —
// only Production's own panel (WorkersPanel.jsx's ProductionBomTab) called this endpoint. This is
// that missing UI, same endpoint, same shape, simplified (no fabrication-progress bars — that's
// Production's own concern, not Stores'). Distinct from the Reserve→Issue action above: that one
// finalizes a *stock* reservation (decrements on_hand, marks the line In-Stock); this one just logs
// that material physically left Stores for WIP — it doesn't touch on_hand or purchase_status.
function MaterialIssuesCard({ projects }) {
  const [projectId, setProjectId] = useState('');
  const [bom, setBom] = useState(null);
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ bom_item_id: '', qty: '' });
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    const [{ items }, iss] = await Promise.all([
      api(`/api/projects/${projectId}/bom`),
      api(`/api/material-issues?project_id=${projectId}`),
    ]);
    setBom(items); setIssues(iss);
  }

  useEffect(() => {
    if (!projectId) { setBom(null); setIssues(null); return; }
    let cancelled = false;
    setLoading(true);
    loadAll().catch(err => !cancelled && showToast(err.message, 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function logIssue() {
    if (!form.bom_item_id) return showToast('Pick a BOM item', 'error');
    const qty = Number(form.qty);
    if (!qty || qty <= 0) return showToast('Enter a quantity', 'error');
    setBusy(true);
    try {
      await api('/api/material-issues', { method: 'POST', body: { bom_item_id: Number(form.bom_item_id), qty } });
      showToast('Material issue logged');
      setForm({ bom_item_id: '', qty: '' });
      await loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Material issued to WIP</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {!projectId ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Pick a project to log material leaving Stores for WIP.</p>
        ) : loading || !bom ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Select value={form.bom_item_id} onValueChange={v => setForm({ ...form, bom_item_id: v })}>
                <SelectTrigger className="w-72"><SelectValue placeholder="BOM item" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {bom.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.material_description} {b.size_spec ? `· ${b.size_spec}` : ''}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <Input type="number" min="0" placeholder="Qty" className="w-24" value={form.qty}
                onChange={e => setForm({ ...form, qty: e.target.value })} />
              <Button size="sm" onClick={logIssue} disabled={busy}><TruckIcon />Log issue</Button>
            </div>
            {issues?.length > 0 && (
              <div className="flex flex-col gap-1 pt-1">
                {issues.slice(0, 8).map(i => (
                  <div key={i.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{i.material_description}</span>
                    <span className="tnum">qty {i.qty} · {i.issued_by}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
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

// STORES-SALES-CHANGES.md — Manual is the only mode that's actually built (the Reserve/Procure
// buttons on Open requests below). Auto (matching lines reserve themselves the moment a BOM/SAS
// line releases) is deliberately not built yet — today's only match signal is the possible-match
// badge's plain keyword overlap, not safe to auto-commit physical stock against. This toggle is
// UI-only: picking Auto doesn't change any real behavior, it just shows that it's not ready. Real
// Auto mode is worth building once §3.2's item_code catalog gives a trustworthy exact-match signal.
function ReservationModeToggle() {
  const [mode, setMode] = useState('manual');
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-lg border p-0.5">
        <button type="button" onClick={() => setMode('manual')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Manual
        </button>
        <button type="button" onClick={() => setMode('auto')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'auto' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Auto
        </button>
      </div>
      {mode === 'auto' && (
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Auto mode — coming soon. Matching lines will reserve themselves automatically once item-code matching lands; for now everything below still works the Manual way.
        </div>
      )}
    </div>
  );
}

// STORES-SALES-CHANGES.md follow-up — the workspace outgrew one long scrolling page (today
// chips, Inventory, Open requests, Active reservations, Material issued, all stacked). Same
// sidebar-workspace pattern as Production's Job Card panel (WorkersPanel.jsx): one section per
// tab, Inventory as the default landing tab since the mode toggle + today-summary glance belong
// somewhere and Inventory is what Stores opens to most.
const NAV_ITEMS = (counts) => [
  { key: 'inventory', label: 'Inventory', icon: PackageIcon, badge: counts.lowStock || null },
  { key: 'requests', label: 'Open Requests', icon: ClipboardListIcon, badge: counts.requests || null },
  { key: 'reservations', label: 'Active Reservations', icon: PackageCheckIcon, badge: counts.reservations || null },
  { key: 'issued', label: 'Material Issued to WIP', icon: TruckIcon },
];

function InventoryTab({ inventoryItems, openRequests, activeReservations, onNavigate }) {
  const router = useRouter();
  const [dialogItem, setDialogItem] = useState(undefined); // undefined = closed, null = add, {} = edit
  const lowStockCount = inventoryItems.filter(isLowStock).length;

  return (
    <div className="flex flex-col gap-6">
      <ReservationModeToggle />
      <TodaySummary inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} onNavigate={onNavigate} />
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
    </div>
  );
}

export default function StoresWorkspace({ inventoryItems, openRequests = [], activeReservations = [], projects = [] }) {
  const router = useRouter();
  const [tab, setTab] = useState('inventory');
  const navItems = NAV_ITEMS({
    lowStock: inventoryItems.filter(isLowStock).length,
    requests: openRequests.length,
    reservations: activeReservations.length,
  });

  return (
    <WorkspaceSidebar title="Inventory" icon={PackageIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'inventory' && (
        <InventoryTab inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} onNavigate={setTab} />
      )}
      {tab === 'requests' && (
        <OpenRequestsCard openRequests={openRequests} inventoryItems={inventoryItems} router={router} />
      )}
      {tab === 'reservations' && (
        <ActiveReservationsCard activeReservations={activeReservations} router={router} />
      )}
      {tab === 'issued' && <MaterialIssuesCard projects={projects} />}
    </WorkspaceSidebar>
  );
}
