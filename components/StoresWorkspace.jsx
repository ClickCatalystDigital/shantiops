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
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusIcon, PencilIcon, PackageCheckIcon, UndoIcon, TruckIcon, PackageIcon, ClipboardListIcon, LayersIcon, AlertTriangleIcon, LogInIcon, FileOutputIcon, CheckIcon, XIcon, ListChecksIcon, SearchIcon, ChevronRightIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import CertPicker from '@/components/CertPicker';
import DimensionInput from '@/components/DimensionInput';
import SearchableSelect from '@/components/SearchableSelect';
import CategoryFieldsBlock, { OTHER_MOC, MOC_OPTIONS } from '@/components/CategoryFieldsBlock';
import { pieceDimsLabel } from '@/components/CutDialog';
import { normalizeWords } from '@/lib/match-utils';
import { pieceWeight } from '@/lib/piece-weight';
import {
  CATEGORY_LABEL, ROLLED_CATEGORIES, OTHER_SIZE, categoryDisplaySpec,
} from '@/lib/section-shapes';

function isLowStock(item) {
  return item.reorder_point != null && item.available <= item.reorder_point;
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
};

// A cut child's code suffix (rootCode()/cutPiece() in lib/stock-pieces.js) already names exactly
// what it is — U(sed)/R(emnant)/S(crap) — more precisely than its bare `status` alone can (a "used"
// child and the root piece post-cut are both just status='consumed'). Read straight from the code
// instead of re-deriving the same distinction from status+source.
function pieceKindLabel(p) {
  if (/-U\d+$/.test(p.code || '')) return 'Used';
  if (/-R\d+$/.test(p.code || '')) return 'Remnant';
  if (/-S\d+$/.test(p.code || '')) return 'Scrap';
  return null;
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

// Structured dims don't round-trip back from a saved flat `spec` string on edit — same pre-existing
// limitation the old SpecField had for plate/geometry shapes (inventory_items has no columns for
// length/width/thickness, only the derived string). Rolled/tee categories round-trip fine since
// their `fields.size` IS the spec string directly.
function initCategoryFields(category, spec) {
  if (category && (ROLLED_CATEGORIES.includes(category) || category === 'tee')) return { size: spec || '' };
  return {};
}

function ItemFormDialog({ item, onClose, router }) {
  const editing = !!item;
  const [description, setDescription] = useState(item?.description || '');
  const [spec, setSpec] = useState(item?.spec || '');
  const [categoryFields, setCategoryFields] = useState(() => initCategoryFields(item?.category, item?.spec));
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
  function pickCatalogItem(it) {
    setDescription(it.item_name);
    setSpec(it.detail_desc || '');
    setItemCode(it.item_code || '');
    setItemId(it.id);
    setCatalogUom(it.uom || null);
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
            <Label>Description<span className="text-danger"> *</span></Label>
            <Input value={description} onChange={e => onDescriptionChange(e.target.value)}
              onFocus={() => setCatalogOpen(catalogResults.length > 0)} onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
              placeholder="Search the item catalog, or just type a description" required autoFocus />
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
function AddPieceDialog({ inventoryItem, onClose, router, onAdded, certificates = [] }) {
  const kind = inventoryItem.category === 'plate' ? 'plate' : 'linear';
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [thickness, setThickness] = useState('');
  const [density, setDensity] = useState('7850');
  const [kgPerM, setKgPerM] = useState('');
  const [heatNo, setHeatNo] = useState('');
  const [certId, setCertId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const cert = certificates.find(c => c.id === certId);
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
      <DialogContent>
        <DialogHeader><DialogTitle>Add piece — {inventoryItem.description}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
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
// among every other piece on this inventory line.
// One group per originally-received piece (root, `parent_id == null`) — every cut child (used/
// remnant/scrap) nests under the root it came from, instead of one long flat list interleaving
// every receipt's pieces together. Children sorted oldest-cut-first (ascending id) for a natural
// "what happened to this piece" reading order.
function groupPiecesByRoot(pieces) {
  const childrenByParent = new Map();
  for (const p of pieces) {
    if (!p.parent_id) continue;
    if (!childrenByParent.has(p.parent_id)) childrenByParent.set(p.parent_id, []);
    childrenByParent.get(p.parent_id).push(p);
  }
  const groups = [];
  for (const p of pieces) {
    if (p.parent_id) continue;
    const children = (childrenByParent.get(p.id) || []).sort((a, b) => a.id - b.id);
    groups.push({ root: p, children });
  }
  return groups;
}

// Piece row shared by both the root and its expanded children — kept as one function so the two
// look consistent rather than two hand-maintained near-duplicates.
function PieceRow({ p, indent, kindLabel, busyId, onRelease, onReserve }) {
  return (
    <TableRow>
      <TableCell className={`font-medium ${indent ? 'pl-8' : ''}`}>{p.code}</TableCell>
      <TableCell className="text-muted-foreground">{pieceDimsLabel(p)}</TableCell>
      <TableCell className="tnum">{p.weight_kg} kg</TableCell>
      <TableCell className="text-muted-foreground">
        {p.heat_no || p.certificate_no ? [p.heat_no, p.certificate_no].filter(Boolean).join(' · ') : '—'}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {p.bom_description ? [p.project_no, p.bom_description, p.part_name].filter(Boolean).join(' · ') : '—'}
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
        {p.status === 'reserved' && (
          <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onRelease(p.id)}>Release</Button>
        )}
        {p.status === 'available' && (
          <Button size="sm" variant="outline" onClick={() => onReserve(p)}>Reserve</Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function PiecesDialog({ inventoryItem, onClose, router, certificates = [], projects = [] }) {
  const [pieces, setPieces] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reservingPiece, setReservingPiece] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

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
                        return <PieceRow key={root.id} p={root} busyId={busyId} onRelease={release} onReserve={setReservingPiece} />;
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
                            <TableCell className="text-muted-foreground">
                              {root.heat_no || root.certificate_no ? [root.heat_no, root.certificate_no].filter(Boolean).join(' · ') : '—'}
                            </TableCell>
                            <TableCell />
                            <TableCell colSpan={2} className="text-xs text-muted-foreground">
                              {children.length} piece{children.length === 1 ? '' : 's'} cut — {summary}
                            </TableCell>
                          </TableRow>
                          {isOpen && children.map(c => (
                            <PieceRow key={c.id} p={c} indent kindLabel={pieceKindLabel(c)} busyId={busyId} onRelease={release} onReserve={setReservingPiece} />
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
      {adding && <AddPieceDialog inventoryItem={inventoryItem} router={router} certificates={certificates} onClose={() => setAdding(false)} onAdded={load} />}
      {reservingPiece && (
        <ReservePieceDialog piece={reservingPiece} projects={projects} router={router}
          onClose={() => setReservingPiece(null)} onReserved={load} />
      )}
    </>
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
      <DialogContent>
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

function ReserveDialog({ request, inventoryItems, matches, onClose, router }) {
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [qty, setQty] = useState(leadingQty(request.qty_text));
  const [saving, setSaving] = useState(false);
  // Default to the possibleMatches() shortlist (already computed by the parent for the row's
  // badges) instead of every inventory item — a request has no guaranteed FK to one specific item,
  // so this is the best narrowing available; "show all" is the escape hatch for when the real match
  // isn't in the (imperfect, word-overlap-based) match set.
  const [showAll, setShowAll] = useState(matches.length === 0);
  const pickable = showAll ? inventoryItems : matches.map(m => m.item);

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
            <p className="text-xs text-muted-foreground">Requested: {request.qty_text || '—'}. Reserving less than requested splits the remainder to keep procuring.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={reserve} disabled={saving || !pickable.length}>{saving ? 'Reserving…' : 'Reserve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenRequestsCard({ openRequests, inventoryItems, router }) {
  const [reserveFor, setReserveFor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = openRequests.filter(r => !needle
    || r.material_description.toLowerCase().includes(needle)
    || (r.project_no || '').toLowerCase().includes(needle));

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
        {openRequests.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by description or project…" />}
        {openRequests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing open.</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No requests match.</p>
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
              {shown.map(r => {
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
                              {exact ? '✓' : '≈'} {item.item_code ? `${item.item_code} · ` : ''}{item.description} ({item.available} avail)
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.qty_text || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{requestLabel(r)}</TableCell>
                    <TableCell>
                      {r.reserved_piece_count > 0
                        ? <Badge className="border-info/30 bg-info-surface text-info" title="Cutting & Remnant Management matched this line to stock automatically — ready for Production to cut. No action needed here.">Remnant reserved</Badge>
                        : r.reserved_qty > 0
                        ? <Badge className="border-info/30 bg-info-surface text-info" title="Allocation Mode: Auto already reserved this from stock the moment the requirement was created. No action needed here.">Auto-reserved</Badge>
                        : r.pending_review
                        ? <Badge className="border-warning/30 bg-warning-surface text-warning" title="Not visible to Procurement yet — Reserve or Procure it.">Stores Review</Badge>
                        : <Badge variant="secondary">{r.purchase_status || 'Enquiry'}</Badge>}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      {!(r.reserved_piece_count > 0) && !(r.reserved_qty > 0) && (
                        <>
                          {/* Reserve is the default action — Stores shouldn't procure new material
                              when existing stock can cover the line, so Reserve gets the solid/
                              primary button and Procure (a real choice, not a fallback) is outline. */}
                          <Button size="sm" disabled={!inventoryItems.length} onClick={() => setReserveFor(r)}>
                            Reserve from stock
                          </Button>
                          {r.pending_review === 1 && (
                            <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => procure(r)}>
                              {busyId === r.id ? 'Sending…' : 'Procure'}
                            </Button>
                          )}
                        </>
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
        <ReserveDialog request={reserveFor} inventoryItems={inventoryItems} matches={possibleMatches(reserveFor, inventoryItems)}
          router={router} onClose={() => setReserveFor(null)} />
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
function ReorderSuggestionsCard({ reorderSuggestions, router }) {
  const [qtyById, setQtyById] = useState({});
  const [busyId, setBusyId] = useState(null);

  function suggestedQty(it) {
    const raw = Math.max(1, Math.ceil((it.reorder_point || 0) - it.available));
    return qtyById[it.id] ?? raw;
  }

  async function createRequest(it) {
    const qty = Number(suggestedQty(it));
    if (!qty || qty <= 0) return showToast('Enter a quantity', 'error');
    setBusyId(it.id);
    try {
      await api('/api/purchase-requisitions', {
        method: 'POST',
        body: {
          raised_by_dept: 'Stores',
          lines: [{ material_description: it.description, moc: it.moc, source: 'stock', inventory_item_id: it.id, qty }],
        },
      });
      showToast('Replenishment request created');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Reorder suggestions</CardTitle></CardHeader>
      <CardContent>
        {reorderSuggestions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing below its minimum right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Minimum</TableHead>
                <TableHead>Suggested qty</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reorderSuggestions.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.description}</TableCell>
                  <TableCell><Badge variant="destructive">{it.available}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{it.reorder_point}</TableCell>
                  <TableCell>
                    <Input type="number" className="w-24" value={suggestedQty(it)}
                      onChange={e => setQtyById({ ...qtyById, [it.id]: e.target.value })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" disabled={busyId === it.id} onClick={() => createRequest(it)}>
                      {busyId === it.id ? 'Creating…' : 'Create request'}
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

// STERP item 14, Formal GIR — Gate Inward Receipt. Standalone gate/security log, not part of the
// reserve/available inventory model above; Stores owns it because no separate gate department
// exists. grn_ref links back to the ordinary GRN paperwork once Procurement/Stores actually
// receives what came through the gate.
function GirFormDialog({ onClose, router }) {
  const [form, setForm] = useState({ vehicle_no: '', supplier_name: '', driver_name: '', material_ref: '', security_seal_ok: false, security_docs_ok: false, security_remarks: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await api('/api/gate-inward-receipts', { method: 'POST', body: form });
      showToast(`GIR-${result.gir_no} logged`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Gate Inward Receipt</DialogTitle></DialogHeader>
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
          <Button onClick={save} disabled={saving}>{saving ? 'Logging…' : 'Log entry'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GateInwardReceiptsCard({ gateInwardReceipts, router }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [grnById, setGrnById] = useState({});

  // Closing requires a GRN reference — the app-layer guard on the PATCH route (a close with no
  // grn_ref anywhere, existing or in this same call, 400s) so "closed" always means "actually
  // received," not just "gate entry acknowledged."
  async function close(g) {
    const grn_ref = grnById[g.id];
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
      <CardContent>
        {gateInwardReceipts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No gate entries logged yet.</p>
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
              {gateInwardReceipts.map(g => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">GIR-{g.gir_no}</TableCell>
                  <TableCell>{g.vehicle_no || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{g.supplier_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{g.driver_name || '—'}</TableCell>
                  <TableCell>
                    {g.security_seal_ok ? <Badge className="bg-success/10 text-success ring-success/20 mr-1">Seal</Badge> : null}
                    {g.security_docs_ok ? <Badge className="bg-success/10 text-success ring-success/20">Docs</Badge> : null}
                    {!g.security_seal_ok && !g.security_docs_ok && '—'}
                  </TableCell>
                  <TableCell>
                    {g.status === 'open' ? (
                      <Input className="w-32" placeholder="GRN ref" defaultValue={g.grn_ref || ''}
                        onChange={e => setGrnById({ ...grnById, [g.id]: e.target.value })} />
                    ) : (g.grn_ref || '—')}
                  </TableCell>
                  <TableCell><Badge variant={g.status === 'closed' ? 'secondary' : 'outline'}>{g.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {g.status === 'open' && (
                      <Button size="sm" variant="outline" disabled={busyId === g.id || !(grnById[g.id] ?? g.grn_ref)} onClick={() => close(g)}
                        title={(grnById[g.id] ?? g.grn_ref) ? undefined : 'Enter a GRN reference before closing'}>
                        Close
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && <GirFormDialog router={router} onClose={() => setAdding(false)} />}
    </Card>
  );
}

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

function GatePassFormDialog({ onClose, router }) {
  const [type, setType] = useState('returnable');
  const [party, setParty] = useState('');
  const [responsiblePerson, setResponsiblePerson] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [items, setItems] = useState([{ description: '', qty_text: '' }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, patch) {
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }

  async function save() {
    const cleanItems = items.filter(it => it.description.trim());
    if (!cleanItems.length) return showToast('Add at least one item', 'error');
    setSaving(true);
    try {
      const result = await api('/api/gate-passes', {
        method: 'POST',
        body: {
          type, party, responsible_person: responsiblePerson, purpose,
          expected_return_date: type === 'returnable' ? expectedReturnDate || null : null,
          items: cleanItems,
        },
      });
      showToast(`GP-${result.gp_no} created`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New Gate Pass</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
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
          <Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create gate pass'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GatePassesCard({ gatePasses, router }) {
  const [adding, setAdding] = useState(false);
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
                <TableRow key={gp.id}>
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
    </Card>
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
  { key: 'reorder', label: 'Reorder Suggestions', icon: AlertTriangleIcon, badge: counts.reorder || null },
  { key: 'gir', label: 'Gate Inward (GIR)', icon: LogInIcon },
  { key: 'gatepasses', label: 'Gate Passes', icon: FileOutputIcon, badge: counts.overdueGatePasses || null },
  { key: 'bom', label: 'BOM', icon: ListChecksIcon },
];

// Stores' own "close this project's BOM" action — mirrors ProcurementWorkspace.jsx's Status tab
// bulk pattern (project filter + checkbox-select + one bulk PATCH per selected line), but for the
// fields Stores actually owns (grn_ref/grn_qty_text, BOM_FIELD_OWNERS.Stores) instead of
// purchase_status. Filling in a GRN ref is itself what feeds checkMaterialsComplete's broadened
// "line done" check (lib/data.js) — Stores doesn't need purchase_status access to complete its half
// of the materials-complete handoff to Production/QC.
function BomGrnTab({ bomItems, router }) {
  const [project, setProject] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [grnRef, setGrnRef] = useState('');
  const [grnQty, setGrnQty] = useState('');
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
    if (!grnRef.trim()) return showToast('Enter a GRN reference', 'error');
    setBusy(true);
    setProgress({ done: 0, total: ids.length });
    let failed = 0;
    for (const id of ids) {
      try {
        await api(`/api/bom-items/${id}`, { method: 'PATCH', body: { grn_ref: grnRef.trim(), ...(grnQty.trim() ? { grn_qty_text: grnQty.trim() } : {}) } });
      } catch { failed++; }
      setProgress(p => ({ done: p.done + 1, total: p.total }));
    }
    setBusy(false);
    setProgress(null);
    setSelected(new Set());
    setGrnRef('');
    setGrnQty('');
    showToast(failed ? `${ids.length - failed} of ${ids.length} updated — ${failed} failed` : `${ids.length} line${ids.length === 1 ? '' : 's'} updated`,
      failed ? 'warning' : undefined);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>BOM — close received lines</CardTitle>
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
        <div className="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Input value={grnRef} onChange={e => setGrnRef(e.target.value)} placeholder="GRN ref" className="h-7 w-32 text-xs" disabled={busy} />
          <Input value={grnQty} onChange={e => setGrnQty(e.target.value)} placeholder="GRN qty (optional)" className="h-7 w-36 text-xs" disabled={busy} />
          <Button size="sm" className="h-7" disabled={busy} onClick={apply}>
            {busy ? `Updating ${progress?.done ?? 0}/${progress?.total ?? 0}…` : 'Apply'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
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
              <span className="w-28 shrink-0">Status</span>
              <span className="w-36 shrink-0">GRN Ref</span>
            </div>
            {shown.map(it => (
              <div key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Checkbox className="shrink-0" checked={selected.has(it.id)} onCheckedChange={v => toggleOne(it.id, !!v)} aria-label="Select item" />
                <span className="min-w-0 flex-1 truncate font-medium">{it.material_description}</span>
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
  const [lowOnly, setLowOnly] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const lowStockCount = inventoryItems.filter(isLowStock).length;
  const shown = (lowOnly ? inventoryItems.filter(isLowStock) : inventoryItems)
    .filter(it => !needle || it.description.toLowerCase().includes(needle) || (it.item_code || '').toLowerCase().includes(needle));

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
          {inventoryItems.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search by description or item code…" />}
          {inventoryItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No inventory items yet.</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {needle ? 'No items match.' : 'Nothing below its minimum right now.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>On-hand</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Minimum</TableHead>
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
                    <TableCell className="text-muted-foreground">{it.spec || '—'}</TableCell>
                    <TableCell>{it.on_hand}</TableCell>
                    <TableCell>
                      {it.available}
                      {isLowStock(it) && <Badge variant="destructive" className="ml-2">Low</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.location || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.reorder_point ?? '—'}</TableCell>
                    <TableCell className="flex justify-end gap-1">
                      {(DIMENSIONAL_CATEGORIES.some(c => c.value === it.category) || it.track_pieces) && (
                        <Button size="icon-sm" variant="ghost" title="Pieces" onClick={() => setPiecesFor(it)}><LayersIcon /></Button>
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
      {piecesFor && <PiecesDialog inventoryItem={piecesFor} router={router} certificates={certificates} projects={projects} onClose={() => setPiecesFor(null)} />}
    </div>
  );
}

export default function StoresWorkspace({
  inventoryItems, openRequests = [], activeReservations = [], projects = [],
  reorderSuggestions = [], gateInwardReceipts = [], gatePasses = [], certificates = [], bomItems = [],
}) {
  const router = useRouter();
  const [tab, setTab] = useState('inventory');
  const navItems = NAV_ITEMS({
    lowStock: inventoryItems.filter(isLowStock).length,
    requests: openRequests.length,
    reservations: activeReservations.length,
    reorder: reorderSuggestions.length,
    overdueGatePasses: gatePasses.filter(g => g.is_overdue).length,
  });

  return (
    <WorkspaceSidebar title="Inventory" icon={PackageIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'inventory' && (
        <InventoryTab inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} onNavigate={setTab} certificates={certificates} projects={projects} />
      )}
      {tab === 'requests' && (
        <OpenRequestsCard openRequests={openRequests} inventoryItems={inventoryItems} router={router} />
      )}
      {tab === 'reservations' && (
        <ActiveReservationsCard activeReservations={activeReservations} router={router} />
      )}
      {tab === 'issued' && <MaterialIssuesCard projects={projects} />}
      {tab === 'reorder' && <ReorderSuggestionsCard reorderSuggestions={reorderSuggestions} router={router} />}
      {tab === 'gir' && <GateInwardReceiptsCard gateInwardReceipts={gateInwardReceipts} router={router} />}
      {tab === 'gatepasses' && <GatePassesCard gatePasses={gatePasses} router={router} />}
      {tab === 'bom' && <BomGrnTab bomItems={bomItems} router={router} />}
    </WorkspaceSidebar>
  );
}
