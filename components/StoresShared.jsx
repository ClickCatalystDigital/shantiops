'use client';

// Shared bits of the Stores screens (moved out of StoresWorkspace.jsx so the new project-first Demand
// tab and the old card use ONE copy): request labels, the keyword/catalog match hints, the Reserve
// dialog and the match/allocation-mode settings popover.
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SearchIcon, SettingsIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { cn } from '@/lib/utils';
import { normalizeWords, materialMismatchReason } from '@/lib/match-utils';

export function requestLabel(item) {
  if (item.source === 'sas') return `SO #${item.sale_order_no || '—'}`;
  if (item.source === 'stock') return 'Stock';
  return item.project_no;
}

export function leadingQty(qtyText) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : '1';
}

export function possibleMatches(request, inventoryItems) {
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

export function ReserveDialog({ request, inventoryItems, matches, onClose, router, defaultQty }) {
  const [inventoryItemId, setInventoryItemId] = useState('');
  // rolled_qty already reflects any Local Quantity multiplier on the item's own BOM-tree node —
  // falls back to a plain leading-number parse for rows the server hasn't annotated (e.g. non-'bom'
  // source stock/SAS lines with no assembly_id at all). defaultQty (Material Demand's "Reserve
  // remaining" action) overrides both — the outstanding amount, not the whole requirement.
  const [qty, setQty] = useState(defaultQty ?? request.rolled_qty ?? leadingQty(request.qty_text));
  const [saving, setSaving] = useState(false);
  // Default to the possibleMatches() shortlist (already computed by the parent for the row's
  // badges) instead of every inventory item — a request has no guaranteed FK to one specific item,
  // so this is the best narrowing available; "show all" is the escape hatch for when the real match
  // isn't in the (imperfect, word-overlap-based) match set.
  const [showAll, setShowAll] = useState(matches.length === 0);
  const pickable = showAll ? inventoryItems : matches.map(m => m.item);
  // Same check the server enforces (lib/procurement.js's reserveFromStock) — surfaced here so a
  // real conflict (picked via "Show all items", since the shortlist above is already filtered to
  // plausible matches) is visible before Reserve is clicked, not only as a rejected round-trip.
  const selectedItem = pickable.find(i => String(i.id) === inventoryItemId);
  const mismatch = selectedItem ? materialMismatchReason(request, selectedItem) : null;

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
      {/* The Inventory item Select's popup portals outside this DialogContent — same outside-click
          guard as ReceiveBomItemDialog.jsx. */}
      <DialogContent
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Reserve from stock — {request.material_description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Inventory item</Label>
              {!showAll && matches.length > 0 && (
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowAll(true)}>
                  Show all items
                </button>
              )}
            </div>
            <Select value={inventoryItemId} onValueChange={setInventoryItemId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {pickable.map(i => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.item_code ? `${i.item_code} · ` : ''}{i.description} · {i.available} available</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Quantity</Label>
            <Input type="number" value={qty} onChange={e => setQty(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Requested: {request.qty_text || '—'}{request.qty_breakdown ? ` (${request.qty_breakdown.label})` : ''}. Reserving less than requested splits the remainder to keep procuring.
            </p>
          </div>
          {mismatch && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              This stock doesn't match the requirement — {mismatch}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={reserve} disabled={saving || !pickable.length || !!mismatch}>{saving ? 'Reserving…' : 'Reserve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlateThicknessToleranceField() {
  const [mm, setMm] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/settings/remnant-tolerances').then(r => setMm(r.plate?.thickness_mm ?? 0.3)).catch(() => setMm(0.3));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api('/api/settings/remnant-tolerances', { method: 'PATCH', body: { plate_thickness_mm: Number(mm) } });
      showToast(`Plate thickness tolerance set to ${mm}mm`);
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  if (mm === null) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plate thickness tolerance</Label>
      <p className="text-xs text-muted-foreground">
        How close a stock plate's thickness may be to a line's required thickness and still auto-match. Length/width
        always require an exact physical fit — two smaller pieces welded together is a manual decision, never automatic.
      </p>
      <div className="flex items-center gap-2">
        <Input type="number" min="0" step="0.1" value={mm} onChange={e => setMm(e.target.value)} className="h-8 w-20" />
        <span className="text-sm text-muted-foreground">mm</span>
        <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

// The single cog for Demand, in three small tabs: what this screen does, how new requirements are
// reserved (Automatic vs Stores Review), and how strictly stock is matched.
export function MatchSettingsPopover({ router }) {
  const [tab, setTab] = useState('about');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Demand settings" aria-label="Demand settings">
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[26rem] max-w-[92vw] flex-col gap-3 p-4">
        <Tabs value={tab} onValueChange={setTab} className="gap-3">
          <TabsList className="grid h-9 w-full grid-cols-3">
            <TabsTrigger value="about">About</TabsTrigger>
            <TabsTrigger value="mode">Reserve mode</TabsTrigger>
            <TabsTrigger value="matching">Matching</TabsTrigger>
          </TabsList>
          <TabsContent value="about" className="flex flex-col gap-2 text-sm">
            <p className="font-medium">What this screen is</p>
            <p className="text-muted-foreground">
              Every project that is about to start, and what it still needs from Stores. Each line is <span className="font-medium text-foreground">Covered</span> (stock or
              delivery is sorted), <span className="font-medium text-foreground">On order</span> (a purchase order is coming) or <span className="font-medium text-foreground">Needs action</span> with the
              department that has to move.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li><span className="font-medium text-foreground">Reserve</span> sets stock aside for the line. It leaves Stores later, when Production's indent is released or the packing list is dispatched.</li>
              <li><span className="font-medium text-foreground">Raise PR</span> asks Procurement to buy what stock can't cover.</li>
              <li><span className="font-medium text-foreground">Ask</span> sends a task to the department that owns the next step.</li>
            </ul>
          </TabsContent>
          <TabsContent value="mode" className="text-sm">
            <ReservationModeToggle router={router} />
          </TabsContent>
          <TabsContent value="matching" className="flex flex-col gap-3 text-sm">
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li><span className="font-medium text-foreground">Bought items</span> (nuts, bolts, fittings): matched by exact catalog item only — no guessing.</li>
              <li><span className="font-medium text-foreground">Plate</span>: same grade, thickness within the tolerance below, and one piece big enough on its own (rotation allowed).</li>
              <li><span className="font-medium text-foreground">Angle / beam / channel / pipe</span>: same profile (e.g. ISA 50x50x5) and enough length. Nothing to loosen.</li>
            </ul>
            <div className="border-t pt-3"><PlateThicknessToleranceField /></div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

export function ReservationModeToggle({ router }) {
  const [mode, setMode] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/settings/allocation-mode').then(r => setMode(r.mode)).catch(() => setMode('auto'));
  }, []);

  async function choose(next) {
    if (next === mode || saving) return;
    setSaving(true);
    try {
      await api('/api/settings/allocation-mode', { method: 'PATCH', body: { mode: next } });
      setMode(next);
      showToast(`Allocation Mode set to ${next === 'auto' ? 'Automatic' : 'Stores Review / Manual'}`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  if (mode === null) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-lg border p-0.5">
        <button type="button" disabled={saving} onClick={() => choose('auto')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'auto' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Automatic
        </button>
        <button type="button" disabled={saving} onClick={() => choose('manual')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Stores Review / Manual
        </button>
      </div>
      <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {mode === 'auto'
          ? 'Automatic (recommended) — matching lines reserve themselves the moment a requirement is created; only a shortfall ever reaches Procurement. You can still override or release any allocation below.'
          : 'Stores Review / Manual — every new BOM/SAS requirement waits for you to Reserve or Procure it individually.'}
      </div>
    </div>
  );
}

// className replaces the default wrapper (room under it, capped width); pass "flex-1 min-w-0" to make it
// share a toolbar row and take the free horizontal space.
export function SearchBox({ value, onChange, placeholder, className }) {
  return (
    <div className={cn('relative', className ?? 'mb-3 max-w-sm')}>
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="h-9 rounded-full border-transparent bg-muted/50 pl-10 shadow-none transition-colors focus-visible:border-input focus-visible:bg-background" />
    </div>
  );
}
