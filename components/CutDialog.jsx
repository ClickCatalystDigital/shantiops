'use client';

// Extracted from WorkersPanel.jsx so a stock piece can be cut two ways: against a BOM line
// (existing Production flow, unchanged) or standalone (Planning's Cut tab, no project/BOM line —
// cutPiece() already treats both as optional). Same extraction precedent as CategoryFieldsBlock.jsx.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select';
import { PlusIcon, TrashIcon } from 'lucide-react';
import DimensionInput from '@/components/DimensionInput';
import { pieceWeight } from '@/lib/piece-weight';

function parseNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) { return Math.round(n * 100) / 100; }

export function pieceDimsLabel(p) {
  if (p.status === 'scrap') return '—'; // scrap is a residual weight only, never a real shape
  return p.kind === 'plate' ? `${p.length_mm}×${p.width_mm}×${p.thickness_mm} mm` : `${p.length_mm} mm`;
}

// Weight preview — the operator sees the scrap number update live as they type; the server
// recomputes and is the real source of truth at submit. Shares lib/piece-weight.js's pieceWeight
// with every other weight preview in the app (Production's Cut dialog, the PR/BOM composer,
// Stores' Add piece dialog) instead of a second hand-maintained copy of the formula.
function previewWeight(source, row) {
  return pieceWeight({ kind: source.kind, ...row, density: source.density, kg_per_m: source.kg_per_m });
}

// The BOM line's own required dims (category_fields_json — CALC-CHANGES2.md §F) prefill the first
// "Used" row, whether or not lib/remnant-match.js actually found a piece for it: the requirement is
// the same either way, matching just decides which source piece (if any) already covers it.
function requiredDimsFromBomItem(b) {
  if (!b.category_fields_json) return {};
  try {
    const f = JSON.parse(b.category_fields_json);
    return b.category === 'plate'
      ? { length_mm: f.length || '', width_mm: f.width || '', thickness_mm: f.thickness || '' }
      : { length_mm: f.length || '' };
  } catch { return {}; }
}

// `partOptions` (only ever passed for the "Used" rows — a remnant isn't a finished named part) —
// the named-part breakdown Design attached to this BOM line (bom_items.named_parts_json), so the
// operator can say which physical piece fulfills which named part right where they're already
// declaring dimensions. Optional and per-row: not every used piece needs one, and a line with no
// breakdown at all just doesn't get the column.
function DimRows({ label, kind, rows, setRows, partOptions }) {
  function update(idx, field, value) {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows([...rows, {}])}><PlusIcon />Add</Button>
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
      {rows.map((r, idx) => (
        <div key={idx} className="flex flex-wrap items-center gap-2">
          <DimensionInput placeholder="Length" className="w-40 shrink-0" valueMm={r.length_mm ?? ''} onChangeMm={v => update(idx, 'length_mm', v)} />
          {kind === 'plate' && (
            <>
              <DimensionInput placeholder="Width" className="w-40 shrink-0" valueMm={r.width_mm ?? ''} onChangeMm={v => update(idx, 'width_mm', v)} />
              <DimensionInput placeholder="Thickness" className="w-44 shrink-0" valueMm={r.thickness_mm ?? ''} onChangeMm={v => update(idx, 'thickness_mm', v)} />
            </>
          )}
          {partOptions?.length > 0 && (
            <Select value={r.part_name || ''} onValueChange={v => update(idx, 'part_name', v)}>
              <SelectTrigger className="w-44 shrink-0"><SelectValue placeholder="Part (optional)" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {partOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          )}
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setRows(rows.filter((_, i) => i !== idx))}><TrashIcon /></Button>
        </div>
      ))}
    </div>
  );
}

// Cutting & Remnant Management's shop-floor moment — the operator declares what was used and what
// usable remnant they kept; everything else (weight, scrap, the remnant going back into stock,
// lineage) is computed server-side (lib/stock-pieces.js's cutPiece). Two ways in: `bomItem` (a line
// lib/remnant-match.js may have already reserved a piece for — Production's BOM/Issue-material
// flow) or `initialSource` (a piece already picked by the caller, no BOM line at all — Planning's
// standalone Cut tab). Exactly one of the two is ever passed; cutPiece() itself treats
// project_id/bom_item_id as fully optional, so the standalone path needs no backend changes.
export default function CutDialog({ bomItem = null, initialSource = null, projectId, onClose, router, onDone }) {
  const namedParts = useMemo(() => {
    if (!bomItem?.named_parts_json) return [];
    try { return JSON.parse(bomItem.named_parts_json).map(p => p.name).filter(Boolean); } catch { return []; }
  }, [bomItem?.named_parts_json]);
  const [reservedPieces, setReservedPieces] = useState(bomItem ? null : []); // null = loading (bomItem mode only)
  const [inventoryOptions, setInventoryOptions] = useState(null);
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [availablePieces, setAvailablePieces] = useState(null);
  const [sourcePieceId, setSourcePieceId] = useState(initialSource ? String(initialSource.id) : '');
  const [source, setSource] = useState(initialSource || null);
  const [used, setUsed] = useState([bomItem ? requiredDimsFromBomItem(bomItem) : {}]);
  const [remnants, setRemnants] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bomItem) return; // standalone mode already has its source — nothing to look up
    api(`/api/stock-pieces?bom_item_id=${bomItem.id}`).then(rows => {
      const reserved = rows.filter(p => p.status === 'reserved');
      setReservedPieces(reserved);
      if (reserved.length === 1) { setSourcePieceId(String(reserved[0].id)); setSource(reserved[0]); }
    }).catch(err => showToast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInventoryOptions() {
    const rows = await api('/api/inventory-items');
    setInventoryOptions(rows.filter(i => i.category === bomItem.category));
  }

  async function pickInventoryItem(id) {
    setInventoryItemId(id);
    setSourcePieceId(''); setSource(null);
    const rows = await api(`/api/stock-pieces?inventory_item_id=${id}`);
    setAvailablePieces(rows.filter(p => p.status === 'available'));
  }

  function pickSourcePiece(id, pool) {
    setSourcePieceId(id);
    setSource((pool || []).find(p => String(p.id) === id) || null);
  }

  const usedWeight = source ? used.reduce((s, r) => s + previewWeight(source, r), 0) : 0;
  const remnantWeight = source ? remnants.reduce((s, r) => s + previewWeight(source, r), 0) : 0;
  const scrapWeight = source ? Math.max(0, round2(source.weight_kg - usedWeight - remnantWeight)) : 0;
  const overBudget = !!source && (usedWeight + remnantWeight) > source.weight_kg + 0.01;

  async function submit() {
    if (!source) return showToast('Pick a source piece', 'error');
    setSaving(true);
    try {
      const toDims = (rows, withPart) => rows.filter(r => parseNum(r.length_mm) > 0).map(r => ({
        length_mm: parseNum(r.length_mm), width_mm: parseNum(r.width_mm), thickness_mm: parseNum(r.thickness_mm),
        ...(withPart && r.part_name ? { part_name: r.part_name } : {}),
      }));
      await api(`/api/stock-pieces/${sourcePieceId}/cut`, {
        method: 'POST',
        body: {
          used: toDims(used, true), remnants: toDims(remnants),
          ...(projectId ? { project_id: projectId } : {}),
          ...(bomItem ? { bom_item_id: bomItem.id } : {}),
        },
      });
      showToast('Cut recorded');
      await onDone?.();
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>Cut — {bomItem ? bomItem.material_description : source?.item_description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4">
          {bomItem && (reservedPieces === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : reservedPieces.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>Source piece</Label>
              {reservedPieces.length === 1 ? (
                <p className="text-sm">
                  {reservedPieces[0].code} — {pieceDimsLabel(reservedPieces[0])} · {reservedPieces[0].weight_kg} kg{' '}
                  <span className="text-muted-foreground">(reserved for this line)</span>
                </p>
              ) : (
                <Select value={sourcePieceId} onValueChange={v => pickSourcePiece(v, reservedPieces)}>
                  <SelectTrigger><SelectValue placeholder="Choose a reserved piece" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {reservedPieces.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {pieceDimsLabel(p)} · {p.weight_kg} kg</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">No remnant was auto-matched for this line — pick a source piece manually.</p>
              {inventoryOptions === null ? (
                <Button size="sm" variant="outline" onClick={loadInventoryOptions}>Find stock</Button>
              ) : (
                <>
                  <Select value={inventoryItemId} onValueChange={pickInventoryItem}>
                    <SelectTrigger><SelectValue placeholder="Stock line" /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {inventoryOptions.length === 0
                        ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching stock line</div>
                        : inventoryOptions.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description} {i.spec ? `· ${i.spec}` : ''}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                  {availablePieces && (
                    <Select value={sourcePieceId} onValueChange={v => pickSourcePiece(v, availablePieces)}>
                      <SelectTrigger><SelectValue placeholder="Piece" /></SelectTrigger>
                      <SelectContent><SelectGroup>
                        {availablePieces.length === 0
                          ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No available pieces</div>
                          : availablePieces.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {pieceDimsLabel(p)} · {p.weight_kg} kg</SelectItem>)}
                      </SelectGroup></SelectContent>
                    </Select>
                  )}
                </>
              )}
            </div>
          ))}

          {source && (
            <>
              <DimRows label={bomItem ? 'Used (→ this project)' : 'Used'} kind={source.kind} rows={used} setRows={setUsed} partOptions={namedParts} />
              <DimRows label="Kept as remnant (→ stock)" kind={source.kind} rows={remnants} setRows={setRemnants} />
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm tnum">
                <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span>{source.weight_kg} kg</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Used</span><span>{round2(usedWeight)} kg</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remnant</span><span>{round2(remnantWeight)} kg</span></div>
                <div className="flex justify-between font-medium"><span>Scrap (auto)</span><span>{overBudget ? '—' : `${scrapWeight} kg`}</span></div>
              </div>
              {overBudget && <p className="text-xs text-danger">Used + remnant exceeds the source piece — reduce a dimension.</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !source || overBudget}>{saving ? 'Cutting…' : 'Cut'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
