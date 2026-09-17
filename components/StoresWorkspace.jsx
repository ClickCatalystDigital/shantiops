'use client';

// V2-CHANGES.md Group 6 Phase 6.2/6.3 — Stores' inventory workbench. `available` (on_hand minus
// every active reservation, computed in getInventoryItems) is what the low-stock flag reads, not
// raw on_hand — that's the number Stores can actually still promise to a new request.
//
// Reserve -> Issue is a real two-step (D9), not a single decrement: Reserve commits stock against
// one request (reduces `available`, on_hand untouched) so no other request — bom, stock, or sas —
// can be promised the same units; Issue is the actual hand-out moment (on_hand decrements, the
// request's bom_item goes terminal In-Stock). Release undoes an unissued Reserve.
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusIcon, PencilIcon, PackageCheckIcon, UndoIcon, TruckIcon, PackageIcon, ClipboardListIcon, LayersIcon, LogInIcon, SearchIcon, ChevronRightIcon, BoxesIcon, HashIcon, ArrowRightLeftIcon, Share2Icon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { derivePurchaseStage } from '@/lib/bom-fields.mjs';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import CertPicker from '@/components/CertPicker';
import AllocationPanel from '@/components/AllocationPanel';
import ChildRoutingPanel from '@/components/ChildRoutingPanel';
import DimensionInput from '@/components/DimensionInput';
import SearchableSelect from '@/components/SearchableSelect';
import CategoryFieldsBlock, { OTHER_MOC, MOC_OPTIONS } from '@/components/CategoryFieldsBlock';
import { pieceDimsLabel } from '@/components/CutDialog';
import { pieceKindLabel, groupPiecesByRoot } from '@/components/PieceLineage';
import ReceiptPicker from '@/components/ReceiptPicker';
import ReceiveBomItemDialog from '@/components/ReceiveBomItemDialog';
import { normalizeWords, materialMismatchReason } from '@/lib/match-utils';
import { pieceWeight } from '@/lib/piece-weight';
import { todayISO, toISODate } from '@/lib/date';
import {
  CATEGORY_LABEL, ROLLED_CATEGORIES, OTHER_SIZE, categoryDisplaySpec,
} from '@/lib/section-shapes';
import { defaultCategoryFields } from '@/components/BomLineFields';

function isLowStock(item) {
  return item.reorder_point != null && item.available <= item.reorder_point;
}

// Inventory dimensional model (gentle-snuggling-wozniak.md §4.1) — reuses the exact same
// categoryDisplaySpec() formatter a BOM line's own spec already renders through, against the
// new inventory_items.category_fields_json column, instead of a second dimensional schema. Falls
// back to the pre-existing flattened `spec` string for a legacy row with no structured dims yet —
// nothing is lost for un-migrated data.
function inventoryDimensions(it) {
  if (it.category_fields_json) {
    try {
      const fields = JSON.parse(it.category_fields_json) || {};
      const label = categoryDisplaySpec(it.category, fields);
      if (label) return label;
    } catch { /* malformed, fall through to the flattened string */ }
  }
  return it.spec || '—';
}

// Cutting & Remnant Management — plate/section stock, layered on top of the plain on_hand number
// above (lib/stock-pieces.js). category mirrors bom_items' own taxonomy (components/PrWorkspace.jsx
// CATEGORY_LABEL) — the profile-family key lib/remnant-match.js matches a BOM line against.
// Same taxonomy the PR/BOM composer's category dropdown uses (lib/section-shapes.js) — 'standard'
// excluded, it's a BOM-only "item master reference + qty" tag, not a physical stockable shape.
const DIMENSIONAL_CATEGORIES = Object.entries(CATEGORY_LABEL)
  .filter(([value]) => value !== 'standard')
  .map(([value, label]) => ({ value, label }));

const PIECE_STATUS = {
  available: { cls: 'bg-success/10 text-success ring-success/20', label: 'Available' },
  reserved: { cls: 'bg-warning/10 text-warning ring-warning/20', label: 'Reserved' },
  consumed: { cls: 'bg-muted text-muted-foreground ring-border', label: 'Consumed' },
  scrap: { cls: 'bg-danger/10 text-danger ring-danger/20', label: 'Scrap' },
  // A freshly cut remnant (Phase 2, design 18.4) — not yet reservable/matchable until Stores
  // confirms the physical piece is actually back on the shelf, same open->confirmed idea GIR uses.
  // Label reads as a location signal (gentle-snuggling-wozniak.md §9), not a bare status word — the
  // only real "where is this piece" cue that exists on a piece today.
  pending_receipt: { cls: 'bg-info/10 text-info ring-info/20', label: 'Cut — pending Stores' },
};

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
// STORES-SALES-CHANGES.md §2c — Stores' entire workspace used to be three plain, disconnected
// tables with no "here's what needs your attention today" signal and no cross-referencing between
// them. This is that signal: a one-glance summary computed from the same three lists already on
// the page (no new query, no new schema). Each chip switches to the sidebar tab it counts — the
// workspace moved to WorkspaceSidebar's tabbed sections, so an anchor-jump to an on-page div id
// no longer reaches a section that isn't mounted on the current tab.
function TodaySummary({ inventoryItems, openRequests, activeReservations, onNavigate, onShowLowStock }) {
  const lowStock = inventoryItems.filter(isLowStock).length;
  const withMatch = openRequests.filter(r => possibleMatches(r, inventoryItems).length > 0).length;
  const chips = [
    { tab: 'requests', dot: 'bg-warning', value: openRequests.length, label: 'open request' + (openRequests.length === 1 ? '' : 's') },
    { tab: 'requests', dot: 'bg-info', value: withMatch, label: 'with a possible match' },
    // Below-minimum chip doubles as the Inventory table's filter switch (onShowLowStock), not
    // just a tab jump — previously it navigated to Inventory (already the default tab) and did
    // nothing else, so clicking it never actually narrowed anything.
    { tab: 'inventory', dot: 'bg-danger', value: lowStock, label: 'low stock', onClick: onShowLowStock },
    { tab: 'reservations', dot: 'bg-success', value: activeReservations.length, label: 'ready to issue' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <button key={c.label} type="button" onClick={() => { onNavigate(c.tab); c.onClick?.(); }}
          className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-muted/50">
          <span className={`size-2 rounded-full ${c.dot}`} />
          <span className="font-semibold tnum">{c.value}</span>
          <span className="text-muted-foreground">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

// Phase 4 (QC statutory-forms plan) — the reverse of possibleMatches() above: given one fixed
// inventory item, which open BOM requests could it fulfill. Same exact-item_id-first, then
// keyword-overlap fallback (no `available` filter — that's a property of the OTHER side there,
// meaningless here since we already have one specific inventory item in hand).
function matchingOpenRequests(inventoryItem, openRequests) {
  if (inventoryItem.item_id) {
    const exact = openRequests.filter(r => r.item_id === inventoryItem.item_id);
    if (exact.length) return exact;
  }
  const words = new Set(normalizeWords(inventoryItem.description));
  if (!words.size) return [];
  return openRequests
    .map(r => ({ r, score: normalizeWords(r.material_description).filter(w => words.has(w)).length }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(m => m.r);
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

// Prefer the item's own structured category_fields_json (real dims, round-trips exactly). Falls
// back to reconstructing a rolled/tee item's `fields.size` from the flat spec string — the one
// case that round-trips even without structured data, since fields.size IS the spec string. A
// legacy plate/geometry row saved before category_fields_json existed still won't round-trip its
// individual L/W/T back out of the flattened string — expected for un-migrated data, not a bug.
function initCategoryFields(category, spec, categoryFieldsJson) {
  if (categoryFieldsJson) {
    try {
      const parsed = JSON.parse(categoryFieldsJson);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* malformed, fall through */ }
  }
  if (category && (ROLLED_CATEGORIES.includes(category) || category === 'tee')) return { size: spec || '' };
  return {};
}

function ItemFormDialog({ item, onClose, router }) {
  const editing = !!item;
  const [description, setDescription] = useState(item?.description || '');
  const [spec, setSpec] = useState(item?.spec || '');
  const [categoryFields, setCategoryFields] = useState(() => initCategoryFields(item?.category, item?.spec, item?.category_fields_json));
  const [onHand, setOnHand] = useState(item?.on_hand ?? 0);
  const [location, setLocation] = useState(item?.location || '');
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point ?? '');
  const [itemCode, setItemCode] = useState(item?.item_code || '');
  const [itemId, setItemId] = useState(item?.item_id || null);
  const [category, setCategory] = useState(item?.category || '');
  const [moc, setMoc] = useState(item?.moc || '');
  const [mocCustomOpen, setMocCustomOpen] = useState(() => !!item?.moc && !MOC_OPTIONS.some(o => o.value === item.moc));
  const [saving, setSaving] = useState(false);
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogUom, setCatalogUom] = useState(item?.item_id ? item?.catalog_uom : null);

  // §3.2 catalog wiring — same search endpoint/idiom as PrWorkspace's ItemSearchField, so a
  // picked-from-catalog inventory row and a picked-from-catalog BOM/PR line can share item_id for
  // real (not fuzzy-keyword) matching. Hand-editing after a pick clears the link, same reasoning.
  async function onDescriptionChange(v) {
    setDescription(v);
    setItemId(null);
    setCatalogUom(null);
    if (v.trim().length < 2) { setCatalogResults([]); setCatalogOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setCatalogResults(rows);
      setCatalogOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }
  // Mirrors ItemSearchField.pick() (components/BomLineFields.jsx) — the Item Master's own
  // structured dimensional/MOC defaults were already correctly consumed on the BOM side; this was
  // the one real reuse gap (gentle-snuggling-wozniak.md §4/§9): Stores' own New Item pick ignored
  // them entirely and only ever seeded free-text `spec` from `detail_desc`. requires_manufacturing
  // is deliberately NOT carried over — it's a bom_items-line concept (Production routing for one
  // BOM line), inventory_items has no equivalent column.
  function pickCatalogItem(it) {
    const category = it.bom_category || '';
    let itemDefaultDims = {};
    if (it.default_category_fields_json) {
      try { itemDefaultDims = JSON.parse(it.default_category_fields_json) || {}; } catch { /* malformed, ignore */ }
    }
    setDescription(it.item_name);
    // A dimensional category derives its spec from Length/Width/Thickness entered next — seeding it
    // from the catalog's free-text detail_desc here would freeze stale text in place, same reasoning
    // ItemSearchField.pick() uses.
    setSpec(DIMENSIONAL_CATEGORIES.some(c => c.value === category) ? '' : (it.detail_desc || ''));
    setItemCode(it.item_code || '');
    setItemId(it.id);
    setCatalogUom(it.uom || null);
    if (category) {
      setCategory(category);
      setCategoryFields({ ...defaultCategoryFields(category), ...itemDefaultDims });
    }
    // Never clobber a blank — a generic gasket/fitting item legitimately has no default MOC.
    if (it.default_moc) setMoc(it.default_moc);
    setCatalogOpen(false);
  }

  async function save() {
    if (!description.trim()) return showToast('Description is required', 'error');
    setSaving(true);
    try {
      const finalSpec = category ? (categoryDisplaySpec(category, categoryFields) || null)
        : ((spec === OTHER_SIZE ? '' : spec).trim() || null);
      const body = {
        description: description.trim(), spec: finalSpec, on_hand: onHand,
        location: location.trim() || null, reorder_point: reorderPoint === '' ? null : reorderPoint,
        item_code: itemCode.trim() || null, item_id: itemId,
        category: category || null, moc: moc.trim() || null,
        // The structured dims themselves — `spec` above is just their flattened display string.
        // Dimensions column (inventoryDimensions()) reads this back through categoryDisplaySpec().
        category_fields_json: category && Object.keys(categoryFields).length ? JSON.stringify(categoryFields) : null,
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
      {/* CategoryFieldsBlock's own DimensionInput (a dimensional category's mm/m unit toggle) is a
          raw Select whose popup portals outside this DialogContent — same outside-click guard as
          ReceiveBomItemDialog.jsx. Widened (sm: prefix required — a bare max-w-* has no effect
          against DialogContent's own default sm:max-w-sm, tailwind-merge only dedupes within the
          same variant scope) — CategoryFieldsBlock's dimensional grid (Size/Weight/Length) was
          cramped at the default 384px, squeezing the Length number input down to almost nothing. */}
      <DialogContent className="sm:max-w-2xl"
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{editing ? 'Edit inventory item' : 'New inventory item'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative col-span-2 grid gap-1.5">
            <Label>Description<span className="text-danger"> *</span></Label>
            <Input value={description} onChange={e => onDescriptionChange(e.target.value)}
              onFocus={() => setCatalogOpen(catalogResults.length > 0)} onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
              placeholder="Search the item catalog, or just type a description" required autoFocus />
            {itemId && <p className="text-xs text-success">✓ Linked to catalog — real matching against BOM/PR lines now possible for this item.</p>}
            {catalogOpen && (
              <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {catalogResults.map(it => (
                  <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
                    title={it.hsn_code ? `HSN ${it.hsn_code}` : undefined} onMouseDown={() => pickCatalogItem(it)}>
                    <span className="font-medium">{it.item_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}
                      {(it.category || it.material_process_type) && ` · ${[it.category, it.material_process_type].filter(Boolean).join(' · ')}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Item code (optional)</Label>
            <Input value={itemCode} onChange={e => setItemCode(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Category (optional)</Label>
            <SearchableSelect value={category || ''} placeholder="Not dimensional"
              options={[{ value: '', label: 'Not dimensional' }, ...DIMENSIONAL_CATEGORIES]}
              onChange={v => { setCategory(v); setSpec(''); setCategoryFields({}); }} />
          </div>
          {category ? (
            <div className="col-span-2"><CategoryFieldsBlock category={category} fields={categoryFields} onChange={setCategoryFields} /></div>
          ) : (
            <div className="grid gap-1.5">
              <Label>Spec (optional)</Label>
              <Input value={spec} onChange={e => setSpec(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Material / grade {category ? <span className="text-danger">*</span> : '(optional)'}</Label>
            <SearchableSelect value={mocCustomOpen ? '' : (moc || '')} placeholder="Type to search a material…"
              options={MOC_OPTIONS}
              onChange={v => {
                if (v === OTHER_MOC) { setMocCustomOpen(true); return; }
                setMocCustomOpen(false);
                setMoc(v);
              }} />
            {mocCustomOpen && (
              <Input className="mt-1" value={moc} onChange={e => setMoc(e.target.value)}
                placeholder="e.g. IS 2062 E250" required={!!category} autoFocus />
            )}
          </div>
          {category && <p className="col-span-2 text-xs text-muted-foreground">
            Category + material let Production's Cut action auto-match remnants against this line when a BOM releases. Add plate/section pieces from the Inventory table after saving.
          </p>}
          <div className="grid gap-1.5">
            <Label>On-hand{item?.track_pieces ? ' (piece count)' : ''}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="any" value={onHand} onChange={e => setOnHand(e.target.value)} disabled={!!item?.track_pieces} />
              {catalogUom && <span className="shrink-0 text-xs text-muted-foreground">{catalogUom}</span>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Minimum stock level (optional)</Label>
            <Input type="number" min="0" step="any" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} />
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

// Receiving new dimensional stock (a bought plate/section, not a remnant — those are created by
// Production's Cut action instead). kind follows the inventory line's own category: plate is its
// own shape (L×W×T×density); every other category (lib/section-shapes.js's taxonomy) is "linear" —
// cut by length, weight = length × kg/m, since a non-rectangular profile's cross-section isn't
// L×W×T.
function AddPieceDialog({ inventoryItem, onClose, router, onAdded, certificates = [], openRequests = [] }) {
  const kind = inventoryItem.category === 'plate' ? 'plate' : 'linear';
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [thickness, setThickness] = useState('');
  const [density, setDensity] = useState('7850');
  const [kgPerM, setKgPerM] = useState('');
  const [heatNo, setHeatNo] = useState('');
  const [certId, setCertId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  // Phase 4 (QC statutory-forms plan) — optional: which open BOM requirement this receipt fulfills,
  // so lib/stock-pieces.js's receivePiece() can actually enforce that line's requires_heat_no/
  // requires_mtc flags (previously dead code — this dialog never sent bom_item_id at all).
  const [bomItemId, setBomItemId] = useState(null);
  const [saving, setSaving] = useState(false);
  const cert = certificates.find(c => c.id === certId);
  const matches = useMemo(() => matchingOpenRequests(inventoryItem, openRequests), [inventoryItem, openRequests]);
  const weightKg = pieceWeight({
    kind, length_mm: length, width_mm: width, thickness_mm: thickness,
    density: kind === 'plate' ? density : null, kg_per_m: kind === 'linear' ? kgPerM : null,
  });

  async function save() {
    setSaving(true);
    try {
      const result = await api('/api/stock-pieces', {
        method: 'POST',
        body: {
          inventory_item_id: inventoryItem.id, kind,
          length_mm: Number(length),
          width_mm: kind === 'plate' ? Number(width) : null,
          thickness_mm: kind === 'plate' ? Number(thickness) : null,
          density: kind === 'plate' ? Number(density) : null,
          kg_per_m: kind === 'linear' ? Number(kgPerM) : null,
          heat_no: heatNo.trim() || null,
          test_certificate_id: certId,
          receipt_id: receiptId || undefined,
          bom_item_id: bomItemId || undefined,
        },
      });
      showToast(`${result.code} added — ${result.weight_kg} kg`);
      await onAdded?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      {/* Nested Selects (ReceiptPicker's own) portal outside this DialogContent, so a click
          inside their popup reads as "outside" and closes this dialog too — same guard as
          ReceiveBomItemDialog.jsx/CertForm.jsx's SheetContent. */}
      <DialogContent
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Add piece — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <ReceiptPicker value={receiptId} onChange={setReceiptId} />
          </div>
          {matches.length > 0 && (
            <div className="col-span-2 grid gap-1.5">
              <Label>Receiving against an open BOM request? (optional)</Label>
              <SearchableSelect value={bomItemId ? String(bomItemId) : ''} onChange={v => setBomItemId(v ? Number(v) : null)}
                options={[{ value: '', label: 'Not linked to a specific request' },
                  ...matches.map(r => ({ value: String(r.id), label: `${r.material_description} · ${requestLabel(r)}` }))]} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Length</Label>
            <DimensionInput valueMm={length} onChangeMm={setLength} autoFocus />
          </div>
          {kind === 'plate' ? (
            <>
              <div className="grid gap-1.5">
                <Label>Width</Label>
                <DimensionInput valueMm={width} onChangeMm={setWidth} />
              </div>
              <div className="grid gap-1.5">
                <Label>Thickness</Label>
                <DimensionInput valueMm={thickness} onChangeMm={setThickness} />
              </div>
              <div className="grid gap-1.5">
                <Label>Density (kg/m³)</Label>
                <Input type="number" min="0" step="any" value={density} onChange={e => setDensity(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label>Weight per metre (kg/m)</Label>
              <Input type="number" min="0" step="any" value={kgPerM} onChange={e => setKgPerM(e.target.value)} />
            </div>
          )}
          <div className="col-span-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Estimated weight </span>
            <span className="tnum font-medium">{weightKg > 0 ? `${Math.round(weightKg * 100) / 100} kg` : '—'}</span>
          </div>
          <div className="grid gap-1.5">
            <Label>Heat No.</Label>
            <Input value={heatNo} onChange={e => setHeatNo(e.target.value)} placeholder="e.g. H-4471" />
          </div>
          <div className="grid gap-1.5 col-span-2">
            <Label>Test certificate</Label>
            {cert ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{cert.certificate_no} · {cert.cast_no}</span>
                <Button size="sm" variant="ghost" onClick={() => { setCertId(null); }}>Remove</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Link test certificate</Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add piece'}</Button>
        </DialogFooter>
      </DialogContent>
      <CertPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Link test certificate"
        certificates={certificates}
        onPick={id => {
          setCertId(id);
          const picked = certificates.find(c => c.id === id);
          if (picked?.cast_no && !heatNo) setHeatNo(picked.cast_no);
        }}
      />
    </Dialog>
  );
}

// The observer side of Cutting & Remnant Management (Production owns Cut; Stores just sees the
// outcome): every piece under one inventory line, its lineage-derived status, and a Release action
// for a 'reserved' piece whose BOM line got cancelled/edited before Production ever cut it.
// Cut children (used/remnant/scrap) point back at their source piece via parent_id but load flat,
// sorted id DESC — regroup client-side so a piece's lineage reads together instead of scattered
// among every other piece on this inventory line. groupPiecesByRoot/pieceKindLabel now live in
// components/PieceLineage.jsx (gap-closure round, 2026-08-26) — shared with Production's read-only
// lineage view (CutDialog.jsx), single source of truth for both.

// Stores/Inventory hardening Phase 4 + this app's final Phase 0-7 audit — a piece is transferable
// (Ownership Transfer, lib/stock-pieces.js's transferPieceOwnership) whenever it isn't already
// terminal or still awaiting its own QC inward review — the exact same set the backend guard itself
// enforces (mirrored here only to decide whether to show the button, never trusted as the real
// gate — the route re-checks this identically).
const TRANSFERABLE_STATUSES = new Set(['available', 'reserved', 'pending_receipt']);

// Piece row shared by both the root and its expanded children — kept as one function so the two
// look consistent rather than two hand-maintained near-duplicates.
// pl-8/12/16 for depth 1/2/3+ — depth 1 matches the old fixed pl-8 exactly (byte-identical for the
// common single-generation case), deeper generations get progressively more indent instead of
// flattening to the same level. Capped rather than scaling forever — a lineage chain deep enough to
// need more than 3 visual levels is vanishingly rare and would just crowd the table.
const PIECE_INDENT_CLASSES = ['', 'pl-8', 'pl-12', 'pl-16'];
function PieceRow({ p, depth = 0, kindLabel, busyId, onRelease, onReserve, onConfirmReceipt, onTransfer }) {
  const indentClass = PIECE_INDENT_CLASSES[Math.min(depth, PIECE_INDENT_CLASSES.length - 1)];
  return (
    <TableRow>
      <TableCell className={`font-medium ${indentClass}`}>{p.code}</TableCell>
      <TableCell className="text-muted-foreground">{pieceDimsLabel(p)}</TableCell>
      <TableCell className="tnum">{p.weight_kg} kg</TableCell>
      {/* Phase 8 — unit_cost (Phase 6's own per-piece cost, set at Vendor Bill approval) had zero
          UI anywhere before this; "—" for a never-priced piece (manual Stores receive, or no bill
          recorded yet), same "not every consumption is costed" tolerance the rest of this app uses. */}
      <TableCell className="tnum text-muted-foreground">{p.unit_cost != null ? formatMoney(p.unit_cost) : '—'}</TableCell>
      <TableCell className="text-muted-foreground">
        {p.heat_no || p.certificate_no ? [p.heat_no, p.certificate_no].filter(Boolean).join(' · ') : '—'}
        {/* Receipt provenance (S5) — which delivery this piece actually arrived on, folded into the
            same cell rather than a new column (table is already wide). A cut child never has one of
            its own (inherits traceability by copy, not via a receipt) — correctly renders nothing. */}
        {(p.receipt_inward_batch_no || p.receipt_supplier_name) && (
          <div className="text-xs">{[p.receipt_inward_batch_no, p.receipt_supplier_name].filter(Boolean).join(' · ')}</div>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {p.bom_description
          ? [p.project_no, p.bom_description, p.part_name, (p.pr_no || p.pr_ref) ? `PR ${p.pr_no || p.pr_ref}` : null]
            .filter(Boolean).join(' · ')
          : '—'}
        {/* Phase 8 — owner_project_no was never joined out anywhere before this session; Ownership
            (who this piece belongs to) is a different fact from the "For" line above (the
            RESERVATION project) — shown only when actually set, matching every other muted-detail
            line in this row. */}
        {p.owner_project_no && <div className="text-xs">Owned by {p.owner_project_no}</div>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {/* Scrap's kindLabel and status label are both literally "Scrap" — showing both is just
              a duplicated badge, not two pieces of information. Suppress the redundant one. */}
          {kindLabel && kindLabel !== PIECE_STATUS[p.status]?.label && (
            <Badge variant="outline" className="text-muted-foreground">{kindLabel}</Badge>
          )}
          <Badge className={PIECE_STATUS[p.status]?.cls}>{PIECE_STATUS[p.status]?.label || p.status}</Badge>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {p.status === 'reserved' && (
            <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onRelease(p.id)}>Release</Button>
          )}
          {p.status === 'available' && (
            <Button size="sm" variant="outline" onClick={() => onReserve(p)}>Reserve</Button>
          )}
          {p.status === 'pending_receipt' && (
            <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onConfirmReceipt(p.id)}>Confirm receipt</Button>
          )}
          {TRANSFERABLE_STATUSES.has(p.status) && (
            <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => onTransfer(p)}>Transfer</Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PiecesDialog({ inventoryItem, onClose, router, certificates = [], projects = [], openRequests = [] }) {
  const [pieces, setPieces] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reservingPiece, setReservingPiece] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [transferringPiece, setTransferringPiece] = useState(null);

  async function load() {
    setPieces(await api(`/api/stock-pieces?inventory_item_id=${inventoryItem.id}`));
  }
  useEffect(() => { load().catch(err => showToast(err.message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function release(id) {
    setBusyId(id);
    try {
      await api(`/api/stock-pieces/${id}/release`, { method: 'POST' });
      showToast('Piece released back to stock');
      await load();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  async function confirmReceipt(id) {
    setBusyId(id);
    try {
      await api(`/api/stock-pieces/${id}/confirm-receipt`, { method: 'POST' });
      showToast('Receipt confirmed — remnant is now available');
      await load();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const groups = pieces ? groupPiecesByRoot(pieces) : [];

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader><DialogTitle>Pieces — {inventoryItem.description}</DialogTitle></DialogHeader>
          {!pieces ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setAdding(true)}><PlusIcon />Add piece</Button>
              </div>
              {pieces.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No pieces yet.</p>
              ) : (
                // min-w-0 is load-bearing here, not decorative — Table already wraps itself in
                // overflow-x-auto (components/ui/table.jsx), but a flex/grid item's default
                // min-width is its content's max-content size, so without min-w-0 this div (and
                // everything above it up to DialogContent) grows to fit the table's full width
                // instead of clipping it, which is what was pushing "Add piece" outside the
                // visible dialog card.
                <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Dimensions</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Heat/Cert</TableHead>
                      <TableHead>For</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map(({ root, children }) => {
                      if (children.length === 0) {
                        // Never cut — just a plain, non-expandable row, same as before.
                        return <PieceRow key={root.id} p={root} busyId={busyId} onRelease={release} onReserve={setReservingPiece} onConfirmReceipt={confirmReceipt} onTransfer={setTransferringPiece} />;
                      }
                      const isOpen = expanded.has(root.id);
                      const counts = children.reduce((acc, c) => {
                        const label = pieceKindLabel(c) || PIECE_STATUS[c.status]?.label || c.status;
                        acc[label] = (acc[label] || 0) + 1;
                        return acc;
                      }, {});
                      const summary = Object.entries(counts).map(([label, n]) => `${n} ${label.toLowerCase()}`).join(', ');
                      return (
                        <Fragment key={root.id}>
                          <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(root.id)}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1.5">
                                <ChevronRightIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                {root.code}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{pieceDimsLabel(root)}</TableCell>
                            <TableCell className="tnum">{root.weight_kg} kg</TableCell>
                            <TableCell />
                            <TableCell className="text-muted-foreground">
                              {root.heat_no || root.certificate_no ? [root.heat_no, root.certificate_no].filter(Boolean).join(' · ') : '—'}
                              {(root.receipt_inward_batch_no || root.receipt_supplier_name) && (
                                <div className="text-xs">{[root.receipt_inward_batch_no, root.receipt_supplier_name].filter(Boolean).join(' · ')}</div>
                              )}
                            </TableCell>
                            <TableCell />
                            <TableCell colSpan={2} className="text-xs text-muted-foreground">
                              {children.length} piece{children.length === 1 ? '' : 's'} cut — {summary}
                            </TableCell>
                          </TableRow>
                          {isOpen && children.map(c => (
                            <PieceRow key={c.id} p={c} depth={c.depth} kindLabel={pieceKindLabel(c)} busyId={busyId} onRelease={release} onReserve={setReservingPiece} onConfirmReceipt={confirmReceipt} onTransfer={setTransferringPiece} />
                          ))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {adding && <AddPieceDialog inventoryItem={inventoryItem} router={router} certificates={certificates} openRequests={openRequests} onClose={() => setAdding(false)} onAdded={load} />}
      {reservingPiece && (
        <ReservePieceDialog piece={reservingPiece} projects={projects} router={router}
          onClose={() => setReservingPiece(null)} onReserved={load} />
      )}
      {transferringPiece && (
        <TransferOwnershipDialog piece={transferringPiece} projects={projects} router={router}
          onClose={() => setTransferringPiece(null)} onTransferred={load} />
      )}
    </>
  );
}

// Batch receiving (S2, gap-closure round 2026-08-26) — the bulk/consumable sibling to
// AddPieceDialog above: bolts, gaskets, electrodes — a decrementing qty pool, never a per-unit
// piece. Mirrors AddPieceDialog's shape closely (ReceiptPicker + CertPicker reused identically).
function BatchesDialog({ inventoryItem, onClose, router, certificates = [] }) {
  const [batches, setBatches] = useState(null);
  const [adding, setAdding] = useState(false);

  function load() {
    return api(`/api/inventory-batches?inventory_item_id=${inventoryItem.id}`).then(setBatches).catch(err => showToast(err.message, 'error'));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Batches — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" />Receive batch</Button></div>
        {batches === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No batches yet.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Qty</TableHead><TableHead>Heat / Supplier Batch</TableHead><TableHead>Cert</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {batches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="tnum">{b.qty}</TableCell>
                  <TableCell className="text-muted-foreground">{[b.heat_no, b.supplier_batch_no].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{b.certificate_no || '—'}</TableCell>
                  <TableCell><Badge className={PIECE_STATUS[b.status]?.cls}>{PIECE_STATUS[b.status]?.label || b.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
      {adding && <ReceiveBatchDialog inventoryItem={inventoryItem} certificates={certificates} router={router} onClose={() => setAdding(false)} onAdded={load} />}
    </Dialog>
  );
}

function ReceiveBatchDialog({ inventoryItem, onClose, router, onAdded, certificates = [] }) {
  const [qty, setQty] = useState('');
  const [heatNo, setHeatNo] = useState('');
  const [supplierBatchNo, setSupplierBatchNo] = useState('');
  const [certId, setCertId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  const [saving, setSaving] = useState(false);
  const cert = certificates.find(c => c.id === certId);

  async function save() {
    if (!(Number(qty) > 0)) return showToast('Enter a valid quantity', 'error');
    setSaving(true);
    try {
      await api('/api/inventory-batches', {
        method: 'POST',
        body: {
          inventory_item_id: inventoryItem.id, qty: Number(qty),
          heat_no: heatNo.trim() || undefined, supplier_batch_no: supplierBatchNo.trim() || undefined,
          test_certificate_id: certId || undefined, receipt_id: receiptId || undefined,
        },
      });
      showToast('Batch received');
      await onAdded?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      {/* Nested Select popups portal outside this DialogContent — same outside-click guard as
          ReceiveBomItemDialog.jsx. */}
      <DialogContent
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Receive batch — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <ReceiptPicker value={receiptId} onChange={setReceiptId} />
          <div className="grid gap-1.5">
            <Label>Quantity</Label>
            <Input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Heat No. (optional)</Label>
              <Input value={heatNo} onChange={e => setHeatNo(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Supplier batch no. (optional)</Label>
              <Input value={supplierBatchNo} onChange={e => setSupplierBatchNo(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Test certificate (optional)</Label>
            {cert ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{cert.certificate_no} · {cert.cast_no}</span>
                <Button size="sm" variant="ghost" onClick={() => setCertId(null)}>Remove</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Link test certificate</Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Receiving…' : 'Receive'}</Button>
        </DialogFooter>
      </DialogContent>
      <CertPicker open={pickerOpen} onOpenChange={setPickerOpen} title="Link test certificate" certificates={certificates} onPick={setCertId} />
    </Dialog>
  );
}

// Serial receiving (S3, gap-closure round 2026-08-26) — the discrete-equipment sibling: valves,
// pumps, instruments — one row per physical unit, an ERP-generated SR-#### code alongside the
// manufacturer's own serial number (kept as two clearly separate columns, never confused).
function SerialsDialog({ inventoryItem, onClose, router, certificates = [] }) {
  const [serials, setSerials] = useState(null);
  const [adding, setAdding] = useState(false);

  function load() {
    return api(`/api/inventory-serials?inventory_item_id=${inventoryItem.id}`).then(setSerials).catch(err => showToast(err.message, 'error'));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Serials — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" />Receive serial</Button></div>
        {serials === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : serials.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No serials yet.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Code</TableHead><TableHead>Serial No.</TableHead><TableHead>Cert</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {serials.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.code}</TableCell>
                  <TableCell className="text-muted-foreground">{s.serial_no || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{s.certificate_no || '—'}</TableCell>
                  <TableCell><Badge className={PIECE_STATUS[s.status]?.cls}>{PIECE_STATUS[s.status]?.label || s.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
      {adding && <ReceiveSerialDialog inventoryItem={inventoryItem} certificates={certificates} router={router} onClose={() => setAdding(false)} onAdded={load} />}
    </Dialog>
  );
}

function ReceiveSerialDialog({ inventoryItem, onClose, router, onAdded, certificates = [] }) {
  const [serialNo, setSerialNo] = useState('');
  const [certId, setCertId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  const [saving, setSaving] = useState(false);
  const cert = certificates.find(c => c.id === certId);

  async function save() {
    setSaving(true);
    try {
      const result = await api('/api/inventory-serials', {
        method: 'POST',
        body: {
          inventory_item_id: inventoryItem.id, serial_no: serialNo.trim() || undefined,
          test_certificate_id: certId || undefined, receipt_id: receiptId || undefined,
        },
      });
      showToast(`${result.code} received`);
      await onAdded?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      {/* Nested Select popups portal outside this DialogContent — same outside-click guard as
          ReceiveBomItemDialog.jsx. */}
      <DialogContent
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Receive serial — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <ReceiptPicker value={receiptId} onChange={setReceiptId} />
          <div className="grid gap-1.5">
            <Label>Manufacturer serial no. (optional)</Label>
            <Input value={serialNo} onChange={e => setSerialNo(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label>Test certificate (optional)</Label>
            {cert ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{cert.certificate_no} · {cert.cast_no}</span>
                <Button size="sm" variant="ghost" onClick={() => setCertId(null)}>Remove</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Link test certificate</Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Receiving…' : 'Receive'}</Button>
        </DialogFooter>
      </DialogContent>
      <CertPicker open={pickerOpen} onOpenChange={setPickerOpen} title="Link test certificate" certificates={certificates} onPick={setCertId} />
    </Dialog>
  );
}

// Stores' manual counterpart to the automatic remnant match (lib/remnant-match.js) — pick a
// project, then one of its open BOM lines, for a specific available piece. Same project->BOM-line
// select shape as MaterialIssuesCard above, reused here instead of a new pattern.
function ReservePieceDialog({ piece, projects, onClose, onReserved, router }) {
  const [projectId, setProjectId] = useState('');
  const [bomItems, setBomItems] = useState(null);
  const [bomItemId, setBomItemId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) { setBomItems(null); setBomItemId(''); return; }
    setBomItems(null);
    setBomItemId('');
    api(`/api/projects/${projectId}/bom?all=1`)
      .then(({ items }) => setBomItems(items))
      .catch(err => showToast(err.message, 'error'));
  }, [projectId]);

  async function reserve() {
    if (!bomItemId) return showToast('Pick a BOM line', 'error');
    setSaving(true);
    try {
      await api(`/api/stock-pieces/${piece.id}/reserve`, {
        method: 'POST', body: { project_id: Number(projectId), bom_item_id: Number(bomItemId) },
      });
      showToast('Piece reserved');
      await onReserved?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      {/* Nested Select popups (Project, BOM line) portal outside this DialogContent — same
          outside-click guard as ReceiveBomItemDialog.jsx. */}
      <DialogContent
        onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Reserve {piece.code} — {pieceDimsLabel(piece)}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a project…" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          {projectId && (
            <div className="grid gap-1.5">
              <Label>BOM line</Label>
              <Select value={bomItemId} onValueChange={setBomItemId} disabled={!bomItems}>
                <SelectTrigger className="w-full"><SelectValue placeholder={bomItems ? 'Choose a BOM line…' : 'Loading…'} /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {(bomItems || []).length === 0 && bomItems && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No BOM lines on this project</div>
                  )}
                  {(bomItems || []).map(b => <SelectItem key={b.id} value={String(b.id)}>{b.material_description}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={reserve} disabled={saving || !bomItemId}>{saving ? 'Reserving…' : 'Reserve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Phase 8 — the first real UI for Ownership Transfer (lib/stock-pieces.js's transferPieceOwnership,
// Stores/Inventory hardening Phase 4). Explicit, auditable per the backend's own design: a real
// business case (material bought for one project genuinely needed by another) — never a bare
// checkbox toggle, always a named target + a reason, matching the route's own required-reason
// guard. `null` target = the common/unowned pool, same convention transferPieceOwnership() itself
// uses for "unassign."
const COMMON_POOL_OPTION = { value: '', label: 'Common pool (unowned)' };
function TransferOwnershipDialog({ piece, projects, onClose, onTransferred, router }) {
  const [toProjectId, setToProjectId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const options = [COMMON_POOL_OPTION, ...projects.map(p => ({ value: String(p.id), label: `${p.project_no} · ${p.customer_name}` }))];

  async function transfer() {
    if (!reason.trim()) return showToast('A reason is required', 'error');
    setSaving(true);
    try {
      await api(`/api/stock-pieces/${piece.id}/transfer-ownership`, {
        method: 'POST', body: { to_project_id: toProjectId || undefined, reason: reason.trim() },
      });
      showToast('Ownership transferred');
      await onTransferred?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer {piece.code} — {pieceDimsLabel(piece)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Currently owned by {piece.owner_project_no || 'the common pool (unowned)'}.
          </p>
          <div className="grid gap-1.5">
            <Label>Transfer to</Label>
            <SearchableSelect value={toProjectId} onChange={setToProjectId} options={options} placeholder="Search project…" className="w-full" />
          </div>
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why is this material moving?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={transfer} disabled={saving}>{saving ? 'Transferring…' : 'Transfer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReserveDialog({ request, inventoryItems, matches, onClose, router, defaultQty }) {
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

// Redesign (2026-09-14, direct feedback: "why is this so obscure") — same data and actions as
// before, four real fixes: (1) card title now matches the nav label ("Open requests" told nobody
// this was Material Demand), (2) grouped by project instead of one flat cross-project table, since
// that's the unit a Stores head actually thinks in, (3) already-covered lines (auto-reserved /
// remnant-matched) visually recede — small, muted, no action row — instead of sitting at the same
// weight as a line that genuinely needs a decision, (4) a line needing a real decision gets a
// left accent stripe so it reads at a glance, not just from a small badge buried in a cell.
// Required/Reserved/Outstanding numbers for one Material Demand row — reserve_qty already reflects
// this line's own rollup multiplier (rolled_qty, lib/bom-structure.mjs), so the two are directly
// comparable. required is null only when qty_text doesn't parse at all (rare); the caller falls
// back to the old binary covered/uncovered treatment in that case, same as before this pass.
function reservationProgress(r) {
  const required = r.rolled_qty ?? null;
  const reserved = r.reserved_qty || 0;
  if (required == null) return { required, reserved, outstanding: null };
  return { required, reserved, outstanding: Math.max(0, required - reserved) };
}

function OpenRequestsCard({ openRequests, inventoryItems, router }) {
  const [reserveFor, setReserveFor] = useState(null);
  const [reserveQty, setReserveQty] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const reservableInventoryItems = inventoryItems.filter(it => it.tracking_mode !== 'piece' && it.tracking_mode !== 'serial');
  const needle = q.trim().toLowerCase();
  const shown = openRequests.filter(r => !needle
    || r.material_description.toLowerCase().includes(needle)
    || (r.project_no || '').toLowerCase().includes(needle));

  async function procure(r) {
    setBusyId(r.id);
    try {
      await api(`/api/bom-items/${r.id}/procure`, { method: 'POST' });
      showToast('Sent to Procurement');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  const groups = new Map();
  shown.forEach(r => {
    const key = requestLabel(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material Demand</CardTitle>
        <p className="text-sm text-muted-foreground">What's currently needed, and whether it can be filled from stock or needs a decision.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {openRequests.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by description or project…" />}
        {openRequests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing open.</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No requests match.</p>
        ) : (
          [...groups.entries()].map(([label, rows]) => (
            <div key={label} className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="flex flex-col divide-y rounded-md border">
                {rows.map(r => {
                  const matches = possibleMatches(r, reservableInventoryItems);
                  const remnantMatched = r.reserved_piece_count > 0;
                  const { required, reserved, outstanding } = reservationProgress(r);
                  // Three states, not two: nothing reserved yet needs a decision; some-but-not-all
                  // needs "reserve the rest" (previously read identically to fully reserved); fully
                  // covered needs no action. A remnant match is always the fully-covered state —
                  // Cutting & Remnant Management reserves the whole requirement or none of it.
                  const fullyCovered = remnantMatched || (required != null ? outstanding <= 0 && reserved > 0 : reserved > 0);
                  const partiallyReserved = !fullyCovered && reserved > 0;
                  const needsDecision = !fullyCovered && !partiallyReserved;
                  return (
                    <div key={r.id}
                      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm ${needsDecision ? 'border-l-2 border-l-warning' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.material_description}</span>
                          {r.source === 'stock' && <Badge variant="outline" className="border-dashed text-[10px]">Build Stock</Badge>}
                          {!r.requires_manufacturing && (
                            <span className="text-xs text-muted-foreground" title="Bought-out — skips Production, packable the moment it's received.">
                              · Direct to packing
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground tnum">
                          {r.qty_text || '—'}{r.qty_breakdown && ` (${r.qty_breakdown.label})`}
                        </span>
                        {partiallyReserved && required != null && (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tnum">
                            <span>Required <span className="font-medium text-foreground">{required}</span></span>
                            <span>Reserved <span className="font-medium text-foreground">{reserved}</span></span>
                            <span>Outstanding <span className="font-medium text-warning">{outstanding}</span></span>
                          </div>
                        )}
                        {matches.length > 0 && needsDecision && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {matches.map(({ item, exact }) => (
                              <Badge key={item.id} variant="outline"
                                className={exact ? 'border-success/30 bg-success-surface text-[10px] font-normal text-success' : 'text-[10px] font-normal text-muted-foreground'}
                                title={exact ? 'Same catalog item — a real match, not a guess.' : 'Non-binding keyword overlap — confirm before reserving.'}>
                                {exact ? '✓' : '≈'} {item.item_code ? `${item.item_code} · ` : ''}{item.description} ({item.available} avail)
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {fullyCovered ? (
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <Badge className="border-info/30 bg-info-surface text-[10px] text-info">Reserved</Badge>
                          {/* A bom_item's reserved_qty is a SUM across however many reservations
                              exist against it — no single "source" to attribute at this level (see
                              Ready to Issue, one row per real reservation, for that detail). Remnant
                              matches are always a distinct, unambiguous mechanism, so that one case
                              still gets its own label. */}
                          {remnantMatched && <span className="text-[10px] text-muted-foreground">Remnant match</span>}
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          {r.pending_review ? <Badge className="border-warning/30 bg-warning-surface text-[10px] text-warning">Stores Review</Badge>
                            : <Badge variant="secondary" className="text-[10px]">{r.purchase_status || 'Enquiry'}</Badge>}
                          <Button size="sm" disabled={!reservableInventoryItems.length}
                            onClick={() => { setReserveFor(r); setReserveQty(partiallyReserved ? outstanding : null); }}>
                            {partiallyReserved ? 'Reserve remaining' : 'Reserve from stock'}
                          </Button>
                          {r.pending_review === 1 && (
                            <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => procure(r)}>
                              {busyId === r.id ? 'Sending…' : 'Procure'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
      {reserveFor && (
        <ReserveDialog request={reserveFor} inventoryItems={reservableInventoryItems} matches={possibleMatches(reserveFor, reservableInventoryItems)}
          router={router} defaultQty={reserveQty} onClose={() => { setReserveFor(null); setReserveQty(null); }} />
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
// Redesign (2026-09-14) — this used to hard-gate the whole screen behind "pick a project first,"
// which is backwards for a daily "what left the building today" glance. Now defaults to a
// cross-project recent log (GET /api/material-issues with no filter); logging a new issue is its
// own explicit, secondary action that reveals the project/BOM-item picker instead of blocking the
// whole card.
function MaterialIssuesCard({ projects }) {
  const [recent, setRecent] = useState(null);
  const [logging, setLogging] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [bom, setBom] = useState(null);
  const [form, setForm] = useState({ bom_item_id: '', qty: '' });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  async function loadRecent() {
    setRecent(await api('/api/material-issues'));
  }
  useEffect(() => { loadRecent().catch(err => showToast(err.message, 'error')); }, []);

  useEffect(() => {
    if (!projectId) { setBom(null); return; }
    api(`/api/projects/${projectId}/bom`).then(({ items }) => setBom(items)).catch(err => showToast(err.message, 'error'));
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
      setLogging(false); setProjectId('');
      await loadRecent();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issued to WIP</CardTitle>
        <p className="text-sm text-muted-foreground">What's left Stores for the shop floor, most recent first.</p>
        <CardAction>
          <Button size="sm" variant={logging ? 'outline' : 'default'} onClick={() => setLogging(l => !l)}>
            <TruckIcon />{logging ? 'Cancel' : 'Log an issue'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {logging && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            {projectId && (
              <div className="flex flex-wrap gap-2">
                {!bom ? <p className="text-sm text-muted-foreground">Loading…</p> : (
                  <>
                    <Select value={form.bom_item_id} onValueChange={v => setForm({ ...form, bom_item_id: v })}>
                      <SelectTrigger className="w-72"><SelectValue placeholder="BOM item" /></SelectTrigger>
                      <SelectContent><SelectGroup>
                        {bom.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.material_description} {b.size_spec ? `· ${b.size_spec}` : ''}</SelectItem>)}
                      </SelectGroup></SelectContent>
                    </Select>
                    <Input type="number" min="0" placeholder="Qty" className="w-24" value={form.qty}
                      onChange={e => setForm({ ...form, qty: e.target.value })} />
                    <Button size="sm" onClick={logIssue} disabled={busy}>Log issue</Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {recent !== null && recent.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <SearchBox value={q} onChange={setQ} placeholder="Search by material or project…" />
            <div className="grid gap-1"><Label className="text-xs">From</Label>
              <Input type="date" className="h-8 w-36 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
            <div className="grid gap-1"><Label className="text-xs">To</Label>
              <Input type="date" className="h-8 w-36 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          </div>
        )}
        {recent === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing issued yet — logging an issue, or Stores releasing a Material Indent, adds it here.
          </p>
        ) : (() => {
          const needle = q.trim().toLowerCase();
          const shown = recent.filter(i => {
            if (needle && !(i.material_description || '').toLowerCase().includes(needle)
              && !(i.project_no || '').toLowerCase().includes(needle)) return false;
            const d = String(i.issued_at || '').slice(0, 10);
            if (fromDate && d < fromDate) return false;
            if (toDate && d > toDate) return false;
            return true;
          });
          return shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No issues match.</p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {shown.map(i => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{i.material_description}</span>
                    <div className="text-xs text-muted-foreground">{i.project_no} · {i.customer_name}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">qty {i.qty} · {i.issued_by} · {formatDate(i.issued_at)}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

// Grouped by project, same pattern as Material Demand above — "Ready to Issue" instead of "Active
// reservations" (jargon that didn't say what to do here; every one of these rows is committed
// stock waiting on a single click to actually hand it over).
function ActiveReservationsCard({ activeReservations, inventoryItems, router }) {
  const [busyId, setBusyId] = useState(null);
  const invById = useMemo(() => new Map(inventoryItems.map(it => [it.id, it])), [inventoryItems]);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api(`/api/inventory-reservations/${id}/${action}`, { method: 'POST' });
      showToast(action === 'issue' ? 'Issued — item marked In-Stock' : 'Reservation unreserved');
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const groups = new Map();
  activeReservations.forEach(r => {
    const key = requestLabel(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ready to Issue</CardTitle>
        <p className="text-sm text-muted-foreground">Stock already committed — issuing hands it over and closes the line.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {activeReservations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing committed yet — reserving stock against a request in Material Demand puts it here, ready to hand over.
          </p>
        ) : (
          [...groups.entries()].map(([label, rows]) => (
            <div key={label} className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="flex flex-col divide-y rounded-md border">
                {rows.map(r => {
                  const item = invById.get(r.inventory_item_id);
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 border-l-2 border-l-success px-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.inventory_description}</span>
                          {item?.item_code && <span className="text-xs text-muted-foreground">{item.item_code}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.material_description}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tnum">
                          <span>Required <span className="font-medium text-foreground">{r.qty_text || '—'}</span></span>
                          <span>Reserved <span className="font-medium text-foreground">{r.qty}</span></span>
                          {item && <span>On-hand <span className="font-medium text-foreground">{item.on_hand}</span></span>}
                          {item && <span>Available now <span className="font-medium text-foreground">{item.available}</span></span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          Source: {r.source === 'auto' ? 'Automatic' : 'Manual'}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" disabled={busyId === r.id} onClick={() => act(r.id, 'issue')}>
                          <PackageCheckIcon />Issue
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, 'release')}>
                          <UndoIcon />Unreserve
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// Material Indent hard gate (Feature B, 2026-09-02) — the queue of what Production has raised and
// is waiting on Stores to release. Fetched client-side (this tab has no server-supplied prop, same
// pattern ProductionBomTab/CutStockTab already use for their own on-mount fetches) rather than
// threading a new prop through app/stores/page.js for a list that changes constantly anyway.
function IndentItemRow({ indent, item, onDone, selectable, selected, onToggle }) {
  const [qty, setQty] = useState('');
  const isPiece = item.tracking_mode === 'piece';
  const [pieces, setPieces] = useState(isPiece ? null : false);
  const [pieceId, setPieceId] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = item.qty_requested - item.qty_released;

  useEffect(() => {
    if (!isPiece || !item.inventory_item_id) return;
    api(`/api/stock-pieces?inventory_item_id=${item.inventory_item_id}`)
      .then(rows => setPieces(rows.filter(p => p.status === 'available')))
      .catch(() => setPieces([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.inventory_item_id]);

  async function release() {
    const q = Number(qty);
    if (!q || q <= 0) return showToast('Enter a quantity', 'error');
    if (q > remaining) return showToast(`Only ${remaining} remaining`, 'error');
    setBusy(true);
    try {
      await api(`/api/material-indents/${indent.id}/items/${item.id}/release`, { method: 'POST', body: { qty: q } });
      showToast('Released');
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function reservePieceAction() {
    if (!pieceId) return showToast('Choose a piece', 'error');
    setBusy(true);
    try {
      await api(`/api/material-indents/${indent.id}/items/${item.id}/reserve-piece`, { method: 'POST', body: { piece_id: Number(pieceId) } });
      showToast('Piece reserved — Production can now cut it');
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
      {selectable && (
        <Checkbox className="shrink-0" checked={selected} onCheckedChange={v => onToggle(item.id, !!v)} aria-label="Select item" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium">{item.bom_description || item.inventory_description || `Item #${item.inventory_item_id}`}</span>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tnum">
          <span>Required <span className="font-medium text-foreground">{item.qty_requested}</span></span>
          <span>Released <span className="font-medium text-foreground">{item.qty_released}</span></span>
          <span>Remaining <span className="font-medium text-foreground">{remaining}</span></span>
        </div>
      </div>
      <Badge variant="outline">{item.status}</Badge>
      {['open', 'partially_released'].includes(item.status) && (
        pieces && Array.isArray(pieces) ? (
          <>
            <Select value={pieceId} onValueChange={setPieceId}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Choose a piece" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {pieces.length === 0
                  ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No available pieces</div>
                  : pieces.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {pieceDimsLabel(p)} · {p.weight_kg} kg</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <Button size="sm" disabled={busy} onClick={reservePieceAction}>Reserve piece</Button>
          </>
        ) : pieces === false ? (
          <>
            <Input type="number" min="0" max={remaining} placeholder={`Qty (≤${remaining})`} className="h-8 w-28 text-xs"
              value={qty} onChange={e => setQty(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={release}>Release</Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )
      )}
    </div>
  );
}

function IndentsCard({ router }) {
  const [indents, setIndents] = useState(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  async function load() {
    const rows = await api('/api/material-indents');
    setIndents(rows.filter(i => ['open', 'partially_released'].includes(i.status)));
  }

  useEffect(() => { load().catch(err => showToast(err.message, 'error')); }, []);

  const needle = q.trim().toLowerCase();
  const shown = (indents || []).filter(indent => !needle
    || indent.indent_no.toLowerCase().includes(needle)
    || (indent.project_no || '').toLowerCase().includes(needle)
    || (indent.requested_by || '').toLowerCase().includes(needle)
    || indent.items.some(it => (it.bom_description || it.inventory_description || '').toLowerCase().includes(needle)));

  // Bulk release only ever covers scalar/batch lines still open — a piece-tracked line always needs
  // a specific physical piece chosen by hand (this row's own Reserve-piece action), so it's excluded
  // here the same way BomGrnTab's own bulk-receive excludes what genuinely needs a human decision.
  const selectableIds = shown.flatMap(indent =>
    indent.items.filter(it => ['open', 'partially_released'].includes(it.status) && it.tracking_mode !== 'piece').map(it => it.id));
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));

  function toggleOne(id, checked) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAllShown() {
    setSelected(new Set(allSelected ? [] : selectableIds));
  }

  async function releaseSelected() {
    const ids = new Set(selected);
    if (!ids.size) return showToast('Select at least one line', 'error');
    setBusy(true);
    setProgress({ done: 0, total: ids.size });
    let failed = 0;
    for (const indent of shown) {
      for (const item of indent.items) {
        if (!ids.has(item.id)) continue;
        const remaining = item.qty_requested - item.qty_released;
        try {
          await api(`/api/material-indents/${indent.id}/items/${item.id}/release`, { method: 'POST', body: { qty: remaining } });
        } catch { failed++; }
        setProgress(p => ({ done: p.done + 1, total: p.total }));
      }
    }
    setBusy(false);
    setProgress(null);
    setSelected(new Set());
    showToast(failed ? `${ids.size - failed} of ${ids.size} released — ${failed} failed (release individually to see why)` : `${ids.size} line${ids.size === 1 ? '' : 's'} released`,
      failed ? 'warning' : undefined);
    load();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material Indents</CardTitle>
        <p className="text-sm text-muted-foreground">What Production has requested — release a line to hand the material over.</p>
      </CardHeader>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-y bg-muted/40 px-4 py-3 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" className="h-7" disabled={busy} onClick={releaseSelected}>
            {busy ? `Releasing ${progress?.done ?? 0}/${progress?.total ?? 0}…` : 'Release selected (full qty)'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <CardContent className="flex flex-col gap-3 pt-4">
        {indents === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : indents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No open indents.</p>
        ) : (
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Search by indent, project, or item…" />
            {selectableIds.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Checkbox className="shrink-0" checked={allSelected} onCheckedChange={toggleAllShown} aria-label="Select all shown" />
                Select all releasable lines
              </label>
            )}
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No indents match.</p>
            ) : shown.map(indent => (
              <div key={indent.id} className="rounded-md border bg-muted/20 py-3">
                <div className="mb-1 flex items-center gap-2 px-3 text-sm">
                  <span className="font-semibold">{indent.indent_no}</span>
                  <span className="text-muted-foreground">{indent.project_no || '—'} · raised by {indent.requested_by}</span>
                  <a href={`/api/material-indents/${indent.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs underline">PDF</a>
                </div>
                <div className="flex flex-col divide-y px-3">
                  {indent.items.filter(it => ['open', 'partially_released'].includes(it.status)).map(item => (
                    <IndentItemRow key={item.id} indent={indent} item={item}
                      selectable={item.tracking_mode !== 'piece'}
                      selected={selected.has(item.id)}
                      onToggle={toggleOne}
                      onDone={() => { load(); router.refresh(); }} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Allocation Mode redesign (2026-08-20) — real now, not a stub: persisted in app_settings (one
// global row, see lib/procurement.js getAllocationMode/setAllocationMode), read on mount and
// written through PATCH /api/settings/allocation-mode. Auto is the default and the recommended
// mode — it reserves an exact catalog-identity match (item_id, the same real signal
// possibleMatches()'s green "✓" badge already trusts) automatically the moment a BOM/SAS line is
// created, splitting on partial availability exactly like Cutting & Remnant Management already
// does for dimensional stock; only a genuine shortfall (or an unmatched line) ever reaches
// Procurement or needs a Stores decision. Manual keeps the original always-review behavior.
function ReservationModeToggle({ router }) {
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

// STERP item 9, Auto-Indent Suggestions — the action on top of the below-minimum filter/badge
// (already in the Inventory tab): a derived list (lib/data.js getReorderSuggestions, no new
// table), each row one click from becoming a real Build-stock request via the same
// purchase-requisitions endpoint the Inventory tab's existing stock-request flow already uses.
// Nothing is auto-created — this is the suggestion, the click is the approval.
// Stores IA redesign: ReorderSuggestionsCard moved to components/PrWorkspace.jsx (Purchase
// Requests → Reorder Suggestions) — raising a replenishment request is a Purchase-Requests-owned
// action even though the trigger signal (below reorder point) is Stores' own inventory data.

// Multi-unit split orders needing a Stores decision, plus the actual allocate/route work itself —
// both now live here, not on the project's own page (often 180+ BOM lines, a real trip for a daily
// task). Queue-first: pick an order that needs attention, work it inline (AllocationPanel then
// ChildRoutingPanel, in the real order Stores does the work — allocate, then route), "Back to
// queue" refreshes the server-fetched list so a just-finished order's counts aren't stale.
function AllocationRoutingSection({ splitOrders, router }) {
  const [selected, setSelected] = useState(null); // {id, project_no, customer_name} | null

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <div>
            <Button size="sm" variant="ghost" className="-ml-2 mb-1"
              onClick={() => { setSelected(null); router.refresh(); }}>&larr; Back to queue</Button>
            <h2 className="text-lg font-semibold">{selected.project_no}</h2>
            <p className="text-sm text-muted-foreground">{selected.customer_name}</p>
          </div>
        </div>
        <AllocationPanel projectId={selected.id} />
        <ChildRoutingPanel projectId={selected.id} />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Split-Order Allocation</CardTitle>
        <p className="text-sm text-muted-foreground">Multi-unit orders — which physical unit gets which material, and whether it goes to Production or Dispatch.</p>
      </CardHeader>
      <CardContent>
        {splitOrders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No split orders need attention right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Units</TableHead>
                <TableHead>Needs allocation</TableHead>
                <TableHead>Needs routing</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {splitOrders.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.project_no}</TableCell>
                  <TableCell className="text-muted-foreground">{o.customer_name}</TableCell>
                  <TableCell>{o.unit_count}</TableCell>
                  <TableCell>
                    {o.unallocated_lines > 0 ? <Badge variant="destructive">{o.unallocated_lines} line{o.unallocated_lines === 1 ? '' : 's'}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {o.unrouted_ready_cells > 0 ? <Badge variant="destructive">{o.unrouted_ready_cells} unit{o.unrouted_ready_cells === 1 ? '' : 's'}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(o)}>Manage</Button>
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

// STERP item 14, Formal GIR — Gate Inward Receipt. Standalone gate/security log, not part of the
// reserve/available inventory model above; Stores owns it because no separate gate department
// exists. grn_ref links back to the ordinary GRN paperwork once Procurement/Stores actually
// receives what came through the gate.
// `editing` — the GIR row being fixed (a mistyped vehicle/supplier/driver/material-ref/security
// field), or null to log a new entry. Only ever passed while the GIR is still 'open' (the card's
// own Edit button is hidden once closed) — the server re-enforces the same guard regardless.
function GirFormDialog({ editing, onClose, router }) {
  const [form, setForm] = useState(editing ? {
    vehicle_no: editing.vehicle_no || '', supplier_name: editing.supplier_name || '',
    driver_name: editing.driver_name || '', material_ref: editing.material_ref || '',
    security_seal_ok: !!editing.security_seal_ok, security_docs_ok: !!editing.security_docs_ok,
    security_remarks: editing.security_remarks || '',
  } : { vehicle_no: '', supplier_name: '', driver_name: '', material_ref: '', security_seal_ok: false, security_docs_ok: false, security_remarks: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/gate-inward-receipts/${editing.id}`, { method: 'PATCH', body: { edit: true, ...form } });
        showToast(`GIR-${editing.gir_no} updated`);
      } else {
        const result = await api('/api/gate-inward-receipts', { method: 'POST', body: form });
        showToast(`GIR-${result.gir_no} logged`);
      }
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? `Edit GIR-${editing.gir_no}` : 'New Gate Inward Receipt'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Vehicle no.</Label>
            <Input value={form.vehicle_no} onChange={e => setForm({ ...form, vehicle_no: e.target.value })} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label>Supplier</Label>
            <Input value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Driver</Label>
            <Input value={form.driver_name} onChange={e => setForm({ ...form, driver_name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Material reference</Label>
            <Input value={form.material_ref} onChange={e => setForm({ ...form, material_ref: e.target.value })} placeholder="PO / DC / BOM ref" />
          </div>
          <div className="col-span-2 flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.security_seal_ok} onChange={e => setForm({ ...form, security_seal_ok: e.target.checked })} />
              Seal intact
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.security_docs_ok} onChange={e => setForm({ ...form, security_docs_ok: e.target.checked })} />
              Documents verified
            </label>
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Security remarks (optional)</Label>
            <Input value={form.security_remarks} onChange={e => setForm({ ...form, security_remarks: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (editing ? 'Saving…' : 'Logging…') : (editing ? 'Save changes' : 'Log entry')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GateInwardReceiptsCard({ gateInwardReceipts, router }) {
  useEntityHighlight(useSearchParams().get('highlight'));
  const [adding, setAdding] = useState(false);
  const [editingGir, setEditingGir] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [grnById, setGrnById] = useState({});
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = gateInwardReceipts.filter(g => !needle
    || String(g.gir_no).includes(needle)
    || (g.vehicle_no || '').toLowerCase().includes(needle)
    || (g.supplier_name || '').toLowerCase().includes(needle)
    || (g.driver_name || '').toLowerCase().includes(needle)
    || (g.material_ref || '').toLowerCase().includes(needle));

  // Closing requires a GRN reference — the app-layer guard on the PATCH route (a close with no
  // grn_ref anywhere, existing or in this same call, 400s) so "closed" always means "actually
  // received," not just "gate entry acknowledged."
  async function close(g) {
    // Same precedence as the input's own defaultValue/disabled logic below — if the user never
    // touched the field, fall back to the GIR's own stored value, then to a linked receipt's.
    const grn_ref = grnById[g.id] ?? g.grn_ref ?? g.linked_receipts?.[0]?.grn_ref;
    setBusyId(g.id);
    try {
      await api(`/api/gate-inward-receipts/${g.id}`, { method: 'PATCH', body: { close: true, ...(grn_ref ? { grn_ref } : {}) } });
      showToast('GIR closed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gate Inward Receipts</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />New GIR</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {gateInwardReceipts.length > 0 && (
          <SearchBox value={q} onChange={setQ} placeholder="Search by GIR #, vehicle, supplier, driver, or material ref…" />
        )}
        {gateInwardReceipts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No gate entries logged yet.</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No gate entries match.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GIR #</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Security</TableHead>
                <TableHead>GRN ref</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(g => (
                <TableRow key={g.id} data-entity-code={`GIR-${g.gir_no}`}>
                  <TableCell className="font-medium">GIR-{g.gir_no}</TableCell>
                  <TableCell>{g.vehicle_no || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{g.supplier_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{g.driver_name || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {g.security_seal_ok
                        ? <Badge className="bg-success/10 text-success ring-success/20">Seal ✓</Badge>
                        : <Badge className="bg-warning/10 text-warning ring-warning/20">Seal pending</Badge>}
                      {g.security_docs_ok
                        ? <Badge className="bg-success/10 text-success ring-success/20">Docs ✓</Badge>
                        : <Badge className="bg-warning/10 text-warning ring-warning/20">Docs missing</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {/* A linked receipt (made via ReceiptPicker.jsx when Stores actually received the
                        material) is shown here so Close can pull a real reference instead of always
                        needing separate free-text entry — the two logs stay independent concepts,
                        but this makes the existing cross-reference between them visible. */}
                    {g.linked_receipts?.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {g.linked_receipts.map(r => (
                          <Badge key={r.id} variant="outline" className="text-[10px] font-normal"
                            title="A Stores receipt already references this gate entry">
                            {r.inward_batch_no}{r.supplier_name ? ` · ${r.supplier_name}` : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {g.status === 'open' ? (
                      <Input className="w-32" placeholder="GRN ref"
                        defaultValue={g.grn_ref || g.linked_receipts?.[0]?.grn_ref || ''}
                        onChange={e => setGrnById({ ...grnById, [g.id]: e.target.value })} />
                    ) : (g.grn_ref || '—')}
                  </TableCell>
                  <TableCell><Badge variant={g.status === 'closed' ? 'secondary' : 'outline'}>{g.status}</Badge></TableCell>
                  <TableCell className="flex justify-end gap-1">
                    {g.status === 'open' && (
                      <>
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditingGir(g)}>
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button size="sm" variant="outline"
                          disabled={busyId === g.id || !(grnById[g.id] ?? g.grn_ref ?? g.linked_receipts?.[0]?.grn_ref)}
                          onClick={() => close(g)}
                          title={(grnById[g.id] ?? g.grn_ref ?? g.linked_receipts?.[0]?.grn_ref) ? undefined : 'Enter a GRN reference before closing'}>
                          Close
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && <GirFormDialog router={router} onClose={() => setAdding(false)} />}
      {editingGir && <GirFormDialog editing={editingGir} router={router} onClose={() => setEditingGir(null)} />}
    </Card>
  );
}

// Stores IA redesign: GatePassFormDialog/GatePassesCard/GATE_PASS_STATUS moved to
// components/DispatchWorkspace.jsx (Dispatch → Gate Passes) — a returnable/non-returnable material
// pass is a Dispatch-owned gate activity, not a Stores inventory concern. The backend write
// permission was widened from Stores-only to Stores-or-Dispatch alongside this move (see
// app/api/gate-passes/route.js).

// Stores IA redesign: BACKLOG/BacklogTab moved to components/PlanningWorkspace.jsx (Production →
// Planning → Backlog, "Stores / Material Identity" section) — a technical-debt log isn't a daily
// operational task, so it no longer sits in Stores' own nav a Stores employee scrolls past daily.

// Stores IA redesign (per the spec: RECEIVE -> STOCK -> FULFILL DEMAND -> PRODUCTION / ISSUE ->
// DISPATCH) — the sidebar now exposes business activities, not every underlying process concept.
// No standalone BOM tab (its bulk-receive-by-project mode folded into Receive a Delivery, see
// ReceiveDeliveryTab below); Reorder Suggestions moved to Purchase Requests; Gate Passes moved to
// Dispatch; Backlog moved to Planning. Ready to Issue and Allocation & Routing stay two separate
// tabs, deliberately not merged — Multi-Unit Orders is rare and reads clearer as its own section
// than folded into Fulfillment's everyday Reserve->Issue flow. Grouped with labeled dividers
// (WorkspaceSidebar's divider.label), matching the spec's exact STOCK / FULFILLMENT / PRODUCTION /
// RECEIVING section order.
const NAV_ITEMS = (counts) => [
  { key: 'divider-stock', divider: true, label: 'Stock' },
  { key: 'inventory', label: 'Inventory', icon: PackageIcon, badge: counts.lowStock || null },
  { key: 'divider-fulfillment', divider: true, label: 'Fulfillment' },
  { key: 'requests', label: 'Material Demand', icon: ClipboardListIcon, badge: counts.requests || null },
  // Renamed from "Active Reservations" — the card underneath has always said "Ready to Issue," a
  // nav/screen naming mismatch fixed here rather than by changing the card's own already-correct,
  // action-oriented title.
  { key: 'reservations', label: 'Ready to Issue', icon: PackageCheckIcon, badge: counts.reservations || null },
  { key: 'divider-production', divider: true, label: 'Production' },
  { key: 'indents', label: 'Material Indents', icon: BoxesIcon },
  { key: 'issued', label: 'Issued to WIP', icon: TruckIcon },
  { key: 'divider-receiving', divider: true, label: 'Receiving' },
  { key: 'gir', label: 'Gate Inward', icon: LogInIcon },
  { key: 'receive', label: 'Receive a Delivery', icon: SearchIcon, badge: counts.pendingInward || null },
  // Routing decoupled from receiving (gentle-snuggling-wozniak.md §5/§8) — a fully-received,
  // routing-eligible line lands here instead of asking for Production/Dispatch at receive time.
  { key: 'allocate', label: 'Allocate', icon: ArrowRightLeftIcon, badge: counts.allocate || null },
  // Multi-unit split orders (master + N child projects) are a genuinely different workflow from
  // everything above — was previously stacked under "Allocation & Reservations", reading as the
  // same thing as plain Reserve→Issue. Its own labeled section so it's only ever reached when a
  // real split order actually needs it.
  { key: 'divider-multi', divider: true, label: 'Multi-Unit Orders' },
  { key: 'split-allocation', label: 'Allocation & Routing', icon: Share2Icon, badge: counts.splitOrders || null },
];

// Stores' own "close this project's BOM" action — mirrors ProcurementWorkspace.jsx's Status tab
// bulk pattern (project filter + checkbox-select + one bulk action per selected line). Feature A
// (canonical Stores Receiving, 2026-09-02): grn_ref/grn_qty_text are no longer directly PATCHable by
// Stores at all — this now bulk-applies one real receipt (supplier/GRN/invoice, via ReceiptPicker)
// across every selected line through POST /api/bom-items/[id]/receive, the same atomic action the
// per-line "Receive" button on BomTable.jsx uses. Each line receives at its own existing qty_text
// (the common no-shortfall case); a line needing a different received quantity, or one gated by a
// requires_heat_no/mtc/etc. flag, is better handled one at a time via BomTable's own Receive dialog
// — this bulk tool reports it as a per-line failure (same tally pattern as before) rather than
// growing per-line quantity/traceability inputs here.
// Unified delivery/lot-centric receiving, Phase 3b — the "reachable without picking a project
// first" entry point the plan calls out as genuinely missing: BomGrnTab below only works once a
// project is already chosen from its own dropdown. This is a plain search across every open line
// (material description, project number, or PR number), reusing ReceiveBomItemDialog unchanged —
// the actual receive/routing/split mechanics live there, this is purely a discovery surface.
const DATE_FILTERS = [
  { value: 'all', label: 'All dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'custom', label: 'Custom range…' },
];

// Real, previously-invisible gap: once Stores receives something and QC holds it for inward review
// (Inward + Pre-Dispatch Approval Workflow), the material simply disappears from every Stores
// screen — getPendingInwardApprovals() already existed and already backs QC's own Approvals →
// Inward tab, but nothing on Stores' own side ever read it, so "why can't I use this, did I even
// receive it" had no answer here. Read-only by design (the decision stays QC's, unchanged) — same
// warning pill BomTable.jsx's own "Pending QC review" badge already uses, so it reads as the same
// signal wherever it shows up.
function AwaitingQcClearanceCard({ pendingInwardApprovals }) {
  if (!pendingInwardApprovals.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Awaiting QC clearance</CardTitle>
        <p className="text-sm text-muted-foreground">Received, but not yet usable — QC needs to sign off before this can be reserved or routed.</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y rounded-md border">
          {pendingInwardApprovals.map(a => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Pending QC review</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.material_description}</div>
                <div className="text-xs text-muted-foreground">
                  {a.project_no ? `${a.project_no} · ` : ''}{a.qty_received} received{a.received_by ? ` by ${a.received_by}` : ''}
                  {a.received_at ? ` · ${formatDate(a.received_at)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiveDeliveryTab({ bomItems, pendingInwardApprovals = [], router }) {
  // Stores IA redesign — "Bulk by project" folds in BomGrnTab's multi-select/one-receipt action
  // (below), the one real capability neither this search-first flow nor the project-page BomTable
  // reproduces (both are one line at a time). Two modes on the same Receiving destination instead
  // of a separate "BOM" nav tab — no functionality lost, no ERP-technical label in the sidebar.
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  // Was: "All dates" (the select's own default value) permanently read as "nothing chosen yet" —
  // browsing required a search term even though the option's whole point is "no date filter." An
  // explicit engaged flag separates the true untouched landing state from a deliberate pick of any
  // option, "All dates" included, so selecting it always shows every open line.
  const [dateEngaged, setDateEngaged] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // A line still in Enquiry/Comparison has no supplier chosen and nothing has actually been
  // ordered — nothing can plausibly be "arriving" yet. Only Ordered (supplier/PO selected) or
  // Transit (PO issued) lines are real candidates. purchase_status is an editable, often-stale
  // column (see lib/bom-fields.mjs's own header comment) — derivePurchaseStage() is what every
  // other summary view already uses instead of trusting it directly.
  const open = bomItems.filter(it => ['Ordered', 'Transit'].includes(derivePurchaseStage(it)));
  const q = query.trim().toLowerCase();

  // Lot-aware date filter (attachDeliveryLotDates, lib/data.js) — a standalone browse mode, not
  // just a narrower search: with a filter picked, results show even with an empty search box, so
  // "what's due today" is answerable without already knowing a material name.
  const today = todayISO();
  const weekEnd = toISODate(new Date(Date.now() + 7 * 86400000));
  const matchesDate = it => {
    if (dateFilter === 'custom') {
      if (!it.nearest_expected_delivery) return false;
      if (fromDate && it.nearest_expected_delivery < fromDate) return false;
      if (toDate && it.nearest_expected_delivery > toDate) return false;
      return true;
    }
    if (!it.nearest_expected_delivery) return false;
    if (dateFilter === 'overdue') return it.nearest_expected_delivery < today;
    if (dateFilter === 'today') return it.nearest_expected_delivery === today;
    return it.nearest_expected_delivery >= today && it.nearest_expected_delivery <= weekEnd; // week
  };
  const dateFiltered = dateFilter === 'all' ? open : open.filter(matchesDate);
  const results = q
    ? dateFiltered.filter(it =>
        (it.material_description || '').toLowerCase().includes(q) ||
        (it.project_no || '').toLowerCase().includes(q) ||
        (it.pr_no || '').toLowerCase().includes(q) ||
        (it.po_ref || '').toLowerCase().includes(q))
    : (dateEngaged ? dateFiltered : []);
  const showPrompt = !dateEngaged && !q;

  return (
    <div className="flex flex-col gap-3">
      <AwaitingQcClearanceCard pendingInwardApprovals={pendingInwardApprovals} />
      <div className="inline-flex w-fit rounded-lg border p-0.5">
        <button type="button" onClick={() => setMode('search')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'search' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Search
        </button>
        <button type="button" onClick={() => setMode('bulk')}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === 'bulk' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Bulk by project
        </button>
      </div>
      {mode === 'bulk' ? <BomGrnTab bomItems={bomItems} router={router} /> : (
        <Card>
          <CardHeader><CardTitle>Receive a Delivery</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex gap-2">
              <Input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search by material, project, PR, or PO number…" autoFocus className="flex-1" />
              {/* The Select's own controlled value stays '' (unset) until dateEngaged — Radix only
                  fires onValueChange on a genuine value change, so if the control's real value
                  already equalled 'all' by default, re-picking the visually-preselected "All
                  dates" option (the realistic first click, since it's the default) would be a
                  silent no-op and never engage; onClick on the item doesn't reliably help either,
                  since Radix can close the popover before a native click completes on it —
                  verified live, both of those still left the bug reachable. Starting genuinely
                  unset means every first pick, "All dates" included, is a real '' -> value
                  transition and always fires. The placeholder keeps "All dates" visible as the
                  displayed default in the meantime. */}
              <Select value={dateEngaged ? dateFilter : ''} onValueChange={v => {
                setDateFilter(v);
                // Custom needs a from/to pick + Apply first; every other option (All dates
                // included) is a complete choice the moment it's picked.
                if (v !== 'custom') setDateEngaged(true);
              }}>
                <SelectTrigger className="h-9 w-40 shrink-0 text-xs"><SelectValue placeholder="All dates" /></SelectTrigger>
                <SelectContent>
                  {DATE_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {dateFilter === 'custom' && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
                <div className="grid gap-1"><Label className="text-xs">From</Label>
                  <Input type="date" className="h-8 w-36 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
                <div className="grid gap-1"><Label className="text-xs">To</Label>
                  <Input type="date" className="h-8 w-36 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
                <Button size="sm" className="h-8" onClick={() => setDateEngaged(true)}>Apply</Button>
              </div>
            )}
            {showPrompt ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Start typing to find what arrived.</p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No open lines match.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {results.map(it => {
                  const dates = it.all_expected_dates || [];
                  const title = dates.length > 1 ? dates.map(formatDate).join(', ') : undefined;
                  // Procurement's own context (make/supplier/PO) — already fetched via getSourcingItems(),
                  // just never surfaced on this screen before. Stores confirms the right make/supplier
                  // arrived without opening the Receive dialog first.
                  const procParts = [
                    it.make && `Make: ${it.make}`,
                    it.selected_supplier_name && `Supplier: ${it.selected_supplier_name}`,
                    it.po_ref && `PO: ${it.po_ref}`,
                  ].filter(Boolean);
                  return (
                    <div key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{it.material_description}</p>
                        {procParts.length > 0 && (
                          <p className="truncate text-[11px] text-muted-foreground">{procParts.join(' · ')}</p>
                        )}
                      </div>
                      <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">{it.project_no}</span>
                      <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{derivePurchaseStage(it)}</span>
                      <span className="w-36 shrink-0 truncate text-xs text-muted-foreground" title={title}>
                        {it.nearest_expected_delivery
                          ? `Exp. ${formatDate(it.nearest_expected_delivery)}${dates.length > 1 ? ` (+${dates.length - 1})` : ''}`
                          : '—'}
                      </span>
                      <ReceiveBomItemDialog item={it} onDone={() => setQuery('')} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BomGrnTab({ bomItems, router }) {
  const [project, setProject] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [receiptId, setReceiptId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const projects = useMemo(() => [...new Set(bomItems.map(it => it.project_no))].sort(), [bomItems]);
  const shown = project === 'all' ? [] : bomItems.filter(it => it.project_no === project);
  const shownIds = shown.map(it => it.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selected.has(id));

  function toggleOne(id, checked) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected(new Set(allShownSelected ? [] : shownIds));
  }

  async function apply() {
    const ids = [...selected];
    if (!ids.length) return showToast('Select at least one line', 'error');
    if (!receiptId) return showToast('Choose or create a receipt', 'error');
    setBusy(true);
    setProgress({ done: 0, total: ids.length });
    let failed = 0;
    for (const id of ids) {
      const it = bomItems.find(b => b.id === id);
      try {
        await api(`/api/bom-items/${id}/receive`, {
          method: 'POST',
          body: { qty_text: it?.qty_text || '1', receipt: { existing_receipt_id: receiptId } },
        });
      } catch { failed++; }
      setProgress(p => ({ done: p.done + 1, total: p.total }));
    }
    setBusy(false);
    setProgress(null);
    setSelected(new Set());
    setReceiptId(null);
    showToast(failed ? `${ids.length - failed} of ${ids.length} received — ${failed} failed (try them individually via Receive on the BOM table)` : `${ids.length} line${ids.length === 1 ? '' : 's'} received`,
      failed ? 'warning' : undefined);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk receive by project</CardTitle>
        <CardAction>
          <Select value={project} onValueChange={p => { setProject(p); setSelected(new Set()); }}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Choose a project…" /></SelectTrigger>
            <SelectContent>
              {projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 border-y bg-muted/40 px-4 py-3 text-sm">
          <span className="font-medium">{selected.size} selected — receiving all against one receipt</span>
          <ReceiptPicker value={receiptId} onChange={setReceiptId} requireInvoice />
          <div className="flex gap-2">
            <Button size="sm" className="h-7" disabled={busy} onClick={apply}>
              {busy ? `Receiving ${progress?.done ?? 0}/${progress?.total ?? 0}…` : 'Receive selected'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}
      <CardContent className="flex flex-col divide-y pt-4">
        {project === 'all' ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Choose a project to see its BOM.</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No BOM lines for that project.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Checkbox className="shrink-0" checked={allShownSelected} onCheckedChange={toggleAllShown} aria-label="Select all shown" />
              <span className="flex-1">Part Description</span>
              <span className="w-32 shrink-0">Make</span>
              <span className="w-28 shrink-0">Status</span>
              <span className="w-36 shrink-0">GRN Ref</span>
            </div>
            {shown.map(it => (
              <div key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Checkbox className="shrink-0" checked={selected.has(it.id)} onCheckedChange={v => toggleOne(it.id, !!v)} aria-label="Select item" />
                <span className="min-w-0 flex-1 truncate font-medium">{it.material_description}</span>
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{it.make || '—'}</span>
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{it.purchase_status || 'Enquiry'}</span>
                <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">{it.grn_ref || '—'}</span>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Stores' Allocate screen (gentle-snuggling-wozniak.md §5/§8/§9) — the queue that closes the loop
// once routing was decoupled from receiving: every fully-received, routing-eligible line lands
// here, unrouted, until Stores picks Production or Dispatch. "Default" is a deliberately separate,
// subtly-styled final column — the catalog's own manufacturing default (items.
// default_requires_manufacturing), the SAME field Engineering's Item Master edit UI already
// writes, correctable here too when Stores notices it's wrong. It answers a genuinely different
// question than routing ("what's the material's learned default for FUTURE orders" vs. "what
// happens to THIS received line") and never touches this line's own frozen requires_manufacturing.
function AllocateTab({ items: initialItems, router }) {
  const [items, setItems] = useState(initialItems);
  // Stores UI pass — was pre-selecting every row by default (261 selected on load, no deliberate
  // action taken); nothing here is safe to bulk-apply sight-unseen. Empty default, the header
  // checkbox (toggleAll below) is the explicit way to select everything.
  const [selected, setSelected] = useState(() => new Set());
  // Per-row staged values, keyed by bom_item id — routing always has a value (mutually exclusive,
  // pre-filled from this line's own frozen requires_manufacturing, matching the old Receive
  // dialog's pre-fill exactly); defaultValue only means something for a catalog-linked row.
  const [rowState, setRowState] = useState(() => Object.fromEntries(initialItems.map(it => [it.id, {
    routing: it.requires_manufacturing ? 'production' : 'dispatch',
    defaultValue: !!it.default_requires_manufacturing,
  }])));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  // Rows where routing succeeded but the Default write failed (§8's partial-failure handling) —
  // kept visible with their own "Retry Default" action even though they've already left the
  // unrouted queue, instead of silently losing the correction.
  const [partial, setPartial] = useState([]);

  useEffect(() => { setItems(initialItems); setSelected(new Set()); }, [initialItems]);

  function setRouting(id, routing) {
    setRowState(prev => ({ ...prev, [id]: { ...prev[id], routing } }));
  }
  function setDefaultValue(id, defaultValue) {
    setRowState(prev => ({ ...prev, [id]: { ...prev[id], defaultValue } }));
  }
  function toggleOne(id, checked) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  const allSelected = items.length > 0 && items.every(it => selected.has(it.id));
  function toggleAll() { setSelected(new Set(allSelected ? [] : items.map(it => it.id))); }

  async function retryDefault(row) {
    try {
      await api(`/api/item-master/${row.itemId}`, { method: 'PATCH', body: { default_requires_manufacturing: row.defaultValue } });
      setPartial(prev => prev.filter(p => p.id !== row.id));
      showToast('Default corrected');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function apply() {
    const ids = items.map(it => it.id).filter(id => selected.has(id));
    if (!ids.length) return showToast('Select at least one line', 'error');
    setBusy(true);
    setProgress({ done: 0, total: ids.length });
    const routedIds = []; // fully removed from the unrouted queue (routing succeeded)
    const newPartial = [];
    let routingFailed = 0;
    for (const id of ids) {
      const it = items.find(x => x.id === id);
      const row = rowState[id];
      // Routing and Default are independent writes — one failing never blocks or skips the other
      // (§8's partial-failure handling); both are attempted whenever both were changed.
      let routingOk = false;
      try {
        await api(`/api/bom-items/${id}/route-self`, { method: 'POST', body: { routed_to: row.routing } });
        routingOk = true;
      } catch { routingOk = false; }
      if (routingOk) routedIds.push(id); else routingFailed++;

      // Default is only ever attempted for a catalog-linked row whose staged value actually
      // differs from what's already on the catalog item — never a redundant write.
      const defaultChanged = it.item_id && row.defaultValue !== !!it.default_requires_manufacturing;
      if (defaultChanged) {
        try {
          await api(`/api/item-master/${it.item_id}`, { method: 'PATCH', body: { default_requires_manufacturing: row.defaultValue } });
        } catch {
          // Only worth tracking as a distinct "needs retry" row when routing succeeded — otherwise
          // the whole row (Default checkbox included) is already back in the main queue for a
          // normal retry, no separate escape hatch needed.
          if (routingOk) newPartial.push({ id, itemId: it.item_id, material_description: it.material_description, defaultValue: row.defaultValue });
        }
      }
      setProgress(p => ({ done: p.done + 1, total: p.total }));
    }
    setBusy(false);
    setProgress(null);
    setItems(prev => prev.filter(it => !routedIds.includes(it.id)));
    setSelected(prev => { const next = new Set(prev); routedIds.forEach(id => next.delete(id)); return next; });
    if (newPartial.length) setPartial(prev => [...prev, ...newPartial]);
    const fullyOk = routedIds.length - newPartial.length;
    const parts = [];
    if (fullyOk > 0) parts.push(`${fullyOk} fully applied`);
    if (newPartial.length) parts.push(`${newPartial.length} routed but Default failed (see below)`);
    if (routingFailed) parts.push(`${routingFailed} failed`);
    showToast(parts.join(' · ') || 'Nothing applied', (newPartial.length || routingFailed) ? 'warning' : undefined);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {partial.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Needs a retry — Default didn't save</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y pt-2">
            {partial.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{p.material_description}</span>
                <span className="shrink-0 text-xs text-muted-foreground">Default → {p.defaultValue ? 'Yes' : 'No'}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => retryDefault(p)}>Retry Default</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Allocate</CardTitle>
          <p className="text-sm text-muted-foreground">
            Received material waiting to be routed to Production or Dispatch. "Default" corrects the
            catalog's own manufacturing default for future orders — it doesn't change this line.
          </p>
        </CardHeader>
        <CardContent className="pt-4">
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting to be routed.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-1 py-2">
                <span className="text-sm font-medium">{selected.size} selected</span>
                <Button size="sm" className="h-7" disabled={busy || !selected.size} onClick={apply}>
                  {busy ? `Applying ${progress?.done ?? 0}/${progress?.total ?? 0}…` : 'Apply Allocations'}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" /></TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="w-36">Project</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead className="w-24 text-center">Production</TableHead>
                    <TableHead className="w-24 text-center">Dispatch</TableHead>
                    <TableHead className="w-28 text-center text-muted-foreground" title="This line's own frozen value, set by Engineering — read-only here, never editable from Allocate">Requires Mfg</TableHead>
                    <TableHead className="w-28 text-center text-muted-foreground" title="Corrects the catalog item's own learned default for FUTURE orders — has no effect on this line's routing or readiness">Catalog Default</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(it => {
                    const row = rowState[it.id] || {};
                    return (
                      <TableRow key={it.id}>
                        <TableCell><Checkbox checked={selected.has(it.id)} onCheckedChange={v => toggleOne(it.id, !!v)} aria-label="Select item" /></TableCell>
                        <TableCell className="max-w-0 truncate">{it.material_description}</TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground">{it.project_no}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{it.qty_breakdown?.label || it.qty_text}</TableCell>
                        <TableCell className="text-center">
                          <Checkbox checked={row.routing === 'production'} onCheckedChange={v => v && setRouting(it.id, 'production')} aria-label="Route to Production" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox checked={row.routing === 'dispatch'} onCheckedChange={v => v && setRouting(it.id, 'dispatch')} aria-label="Route to Dispatch" />
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs font-normal">{it.requires_manufacturing ? 'Yes' : 'No'}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {it.item_id ? (
                            <Checkbox checked={!!row.defaultValue} onCheckedChange={v => setDefaultValue(it.id, !!v)}
                              className="opacity-70" aria-label="Catalog manufacturing default" />
                          ) : (
                            <span className="text-xs text-muted-foreground" title="Not catalog-linked — no catalog default to correct">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Shared "premium/minimal" search treatment — pill-shaped, muted fill, inline icon — distinct from
// Procurement's plain top-bar `<Input>` since this sits inside a card, not a page-level search row.
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative mb-3 max-w-sm">
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 rounded-full border-transparent bg-muted/50 pl-10 shadow-none transition-colors focus-visible:border-input focus-visible:bg-background" />
    </div>
  );
}

function InventoryTab({ inventoryItems, openRequests, activeReservations, onNavigate, certificates, projects }) {
  const router = useRouter();
  const [dialogItem, setDialogItem] = useState(undefined); // undefined = closed, null = add, {} = edit
  const [piecesFor, setPiecesFor] = useState(null);
  const [batchesFor, setBatchesFor] = useState(null);
  const [serialsFor, setSerialsFor] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [trackingFilter, setTrackingFilter] = useState('all');
  const [q, setQ] = useState('');
  const [codeMatchId, setCodeMatchId] = useState(null);
  const needle = q.trim().toLowerCase();
  const lowStockCount = inventoryItems.filter(isLowStock).length;
  // Matches description, INV-#### (item_code), and IM-#### (catalog_item_code) directly — all three
  // already sit on every row. A physical piece (PL-/LN-) or serial (SR-) code doesn't, since pieces
  // live in a separate per-item table; codeMatchId (below) is the smart fallback for those.
  const localMatches = it => it.description.toLowerCase().includes(needle)
    || (it.item_code || '').toLowerCase().includes(needle)
    || (it.catalog_item_code || '').toLowerCase().includes(needle);
  // A small, deliberate subset of the possible filters (category, tracking, low-stock) — search
  // already reaches grade-ish text loosely, and the on-hand/reserved/available column below makes
  // availability obvious without its own filter, so those two aren't duplicated as dropdowns too.
  const trackingOptions = [...new Set(inventoryItems.map(it => it.tracking_mode || 'scalar'))].sort();
  const filtered = (lowOnly ? inventoryItems.filter(isLowStock) : inventoryItems)
    .filter(it => categoryFilter === 'all' || (it.category || '') === categoryFilter)
    .filter(it => trackingFilter === 'all' || (it.tracking_mode || 'scalar') === trackingFilter)
    .filter(it => !needle || localMatches(it));
  // Smart code search (2026-08-26) — if nothing matched locally and the query looks like a real
  // identifier (contains a hyphen, e.g. "PL-0045"), ask the server whether that exact code belongs
  // to a piece/serial/catalog item elsewhere, and surface just that one line if so. Deliberately
  // exact-match only (lib/data.js's findInventoryItemIdByCode) — never a fuzzy guess.
  useEffect(() => {
    if (filtered.length > 0 || !needle.includes('-') || needle.length < 4) { setCodeMatchId(null); return; }
    let cancelled = false;
    api(`/api/inventory-items/lookup-code?code=${encodeURIComponent(q.trim())}`)
      .then(({ inventory_item_id }) => { if (!cancelled) setCodeMatchId(inventory_item_id); })
      .catch(() => { if (!cancelled) setCodeMatchId(null); });
    return () => { cancelled = true; };
  }, [needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = filtered.length > 0 || !codeMatchId ? filtered : inventoryItems.filter(it => it.id === codeMatchId);

  return (
    <div className="flex flex-col gap-6">
      <ReservationModeToggle router={router} />
      <TodaySummary inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations}
        onNavigate={onNavigate} onShowLowStock={() => setLowOnly(true)} />
      <Card>
        <CardHeader>
          <CardTitle>
            Inventory
            {lowStockCount > 0 && <Badge variant="destructive" className="ml-2">{lowStockCount} low stock</Badge>}
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            {lowStockCount > 0 && (
              <Button size="sm" variant={lowOnly ? 'secondary' : 'outline'} onClick={() => setLowOnly(v => !v)}>
                {lowOnly ? 'Showing below minimum' : 'Below minimum only'}
              </Button>
            )}
            <Button size="sm" onClick={() => setDialogItem(null)}><PlusIcon />New item</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {inventoryItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <SearchBox value={q} onChange={setQ} placeholder="Search by description, item code, or a PL-/LN-/SR-/IM- code…" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  <SelectItem value="">Not dimensional</SelectItem>
                  {DIMENSIONAL_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={trackingFilter} onValueChange={setTrackingFilter}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tracking</SelectItem>
                  {trackingOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {filtered.length === 0 && codeMatchId && (
            <p className="pb-2 text-xs text-muted-foreground">
              No direct match — showing the stock line that owns piece/serial/catalog code "{q.trim()}".
            </p>
          )}
          {inventoryItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No inventory items yet.</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {needle || categoryFilter !== 'all' || trackingFilter !== 'all' ? 'No items match.' : 'Nothing below its minimum right now.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Dimensions</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Minimum</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Avg. Cost</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">{it.item_code || '—'}</span>
                      {it.description}
                      {it.catalog_item_code && <div className="text-xs font-normal text-muted-foreground">{it.catalog_item_code}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.moc || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{inventoryDimensions(it)}</TableCell>
                    <TableCell>
                      {/* On-hand/Reserved/Available as one visible hierarchy — was two bare numbers
                          side by side, leaving Reserved (the actual gap between them) to be
                          mentally subtracted every time. */}
                      <div className="flex flex-col gap-0.5 text-xs tnum">
                        <span>On-hand <span className="font-medium text-foreground">{it.on_hand}</span></span>
                        <span>Reserved <span className="font-medium text-foreground">{it.on_hand - it.available}</span></span>
                        <span className="flex items-center gap-1">
                          Available <span className="font-medium text-foreground">{it.available}</span>
                          {isLowStock(it) && <Badge variant="destructive" className="text-[10px]">Low</Badge>}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.location || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.reorder_point ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.tracking_mode || 'scalar'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.avg_cost ? formatMoney(it.avg_cost) : '—'}</TableCell>
                    <TableCell className="flex justify-end gap-1">
                      {(DIMENSIONAL_CATEGORIES.some(c => c.value === it.category) || it.track_pieces) && (
                        <Button size="icon-sm" variant="ghost" title="Pieces" onClick={() => setPiecesFor(it)}><LayersIcon /></Button>
                      )}
                      {/* Batch/Serial receiving (S2/S3, gap-closure round 2026-08-26) — hidden once a
                          line is already piece-tracked (a different, mutually exclusive model,
                          lib/tracking-mode.js); shown for everything else, since tracking_mode
                          auto-adopts on first receive rather than needing an explicit picker. */}
                      {!it.track_pieces && (
                        <>
                          <Button size="icon-sm" variant="ghost" title="Batches" onClick={() => setBatchesFor(it)}><BoxesIcon /></Button>
                          <Button size="icon-sm" variant="ghost" title="Serials" onClick={() => setSerialsFor(it)}><HashIcon /></Button>
                        </>
                      )}
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
      {piecesFor && <PiecesDialog inventoryItem={piecesFor} router={router} certificates={certificates} projects={projects} openRequests={openRequests} onClose={() => setPiecesFor(null)} />}
      {batchesFor && <BatchesDialog inventoryItem={batchesFor} router={router} certificates={certificates} onClose={() => setBatchesFor(null)} />}
      {serialsFor && <SerialsDialog inventoryItem={serialsFor} router={router} certificates={certificates} onClose={() => setSerialsFor(null)} />}
    </div>
  );
}

export default function StoresWorkspace({
  inventoryItems, openRequests = [], activeReservations = [], projects = [],
  gateInwardReceipts = [], certificates = [], bomItems = [],
  splitOrders = [], pendingInwardApprovals = [], unroutedItems = [],
  initialTab,
}) {
  const router = useRouter();
  const navItems = NAV_ITEMS({
    lowStock: inventoryItems.filter(isLowStock).length,
    requests: openRequests.length,
    reservations: activeReservations.length,
    splitOrders: splitOrders.length,
    pendingInward: pendingInwardApprovals.length,
    allocate: unroutedItems.length,
  });
  // Deep-link tab selection (Part B) — same server-prop pattern QcWorkspace.jsx already proved
  // out; `?tab=gir` were dead query strings before this (nothing read them).
  const [tab, setTab] = useState(navItems.some(i => i.key === initialTab) ? initialTab : 'inventory');

  return (
    <WorkspaceSidebar title="Inventory" icon={PackageIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'inventory' && (
        <InventoryTab inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} onNavigate={setTab} certificates={certificates} projects={projects} />
      )}
      {tab === 'requests' && (
        <OpenRequestsCard openRequests={openRequests} inventoryItems={inventoryItems} router={router} />
      )}
      {tab === 'indents' && <IndentsCard router={router} />}
      {tab === 'reservations' && (
        <ActiveReservationsCard activeReservations={activeReservations} inventoryItems={inventoryItems} router={router} />
      )}
      {tab === 'issued' && <MaterialIssuesCard projects={projects} />}
      {tab === 'gir' && <GateInwardReceiptsCard gateInwardReceipts={gateInwardReceipts} router={router} />}
      {tab === 'receive' && <ReceiveDeliveryTab bomItems={bomItems} pendingInwardApprovals={pendingInwardApprovals} router={router} />}
      {tab === 'allocate' && <AllocateTab items={unroutedItems} router={router} />}
      {tab === 'split-allocation' && <AllocationRoutingSection splitOrders={splitOrders} router={router} />}
    </WorkspaceSidebar>
  );
}
