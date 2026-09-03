'use client';

// The one shared BOM table — Engineering, Procurement, Stores, Production and PM all see the same
// rows; what differs is `editableFields` (from BOM_FIELD_OWNERS via the server). The inline status
// select is the high-frequency action; everything else edits through a small dialog showing only
// the viewer's editable columns. Enforcement lives in the PATCH route — this UI is convenience.
import { useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import { BOM_STATUSES, STATUS_TONE, DEFAULT_PURCHASE_STATUS, DIMENSIONAL_CATEGORIES, visibleBomColumns, showPackingColumn } from '@/lib/bom-fields.mjs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import TraceabilityBadges from '@/components/TraceabilityBadges';
import ReceiveBomItemDialog from '@/components/ReceiveBomItemDialog';
import SearchableSelect from '@/components/SearchableSelect';
import CategoryFieldsBlock from '@/components/CategoryFieldsBlock';
import {
  ItemSearchField, CATEGORY_OPTIONS, defaultCategoryFields, finalizeCategoryFields, validateCategoryFields,
} from '@/components/BomLineFields';
import { categoryDisplaySpec } from '@/lib/section-shapes';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, XCircleIcon } from 'lucide-react';

// Real PMB data runs long (a hand-typed cell can be 400+ characters — see the CHIMNEY sheet's
// multi-size plate rows). table-fixed locks each column's width from the header, so overflowing
// nowrap text has nowhere to go but visually outside its own cell into the next one — this is what
// truncate (overflow-hidden + ellipsis) fixes. The tooltip only shows the full value when the text
// is actually cut off (scrollWidth > clientWidth, checked lazily on first hover, not for every cell
// up front — this table can have 300+ rows) rather than firing on every cell regardless of length.
function TruncatedCell({ value }) {
  const ref = useRef(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const text = value || '—';
  return (
    <Tooltip open={open && truncated} onOpenChange={o => {
      if (o && ref.current) setTruncated(ref.current.scrollWidth > ref.current.clientWidth);
      setOpen(o);
    }}>
      <TooltipTrigger asChild>
        <span ref={ref} className="block truncate">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-wrap">{text}</TooltipContent>
    </Tooltip>
  );
}

// Smart text field for the add/edit dialog — a real type-to-filter dropdown (SearchableSelect,
// this app's existing local-list combobox, already used by PrWorkspace/StoresWorkspace/
// SalesWorkspace) offering values already typed elsewhere on this BOM, while still accepting
// completely free text (SearchableSelect's displayValue/onTextChange hybrid mode — picking a
// suggestion and typing something new both just become "the current text"). Replaces a plain
// <input list="datalist-id">, whose unstyled native popup looked and behaved nothing like the rest
// of this app's own dropdowns. A hidden input mirrors the current text under the field's real
// `name` so the dialog's existing uncontrolled-FormData save path (saveDialog) needs no change —
// this field just becomes a nicer front end for the same named form value. Keyed by field+item id
// by the caller so it remounts (and re-reads defaultValue) fresh per edit session.
function SmartTextField({ field, defaultValue, options, required }) {
  const [text, setText] = useState(defaultValue || '');
  return (
    <>
      <SearchableSelect
        value={text} onChange={setText} displayValue={text} onTextChange={setText}
        options={options.map(v => ({ value: v, label: v }))}
        placeholder="Type or pick from existing…" inputClassName="h-9"
      />
      <input type="hidden" name={field} value={text} />
      {required && !text.trim() && <p className="text-xs text-destructive">Required.</p>}
    </>
  );
}

// D10 (Group 5 Bundle B, Phase 5.4) — cancellable at Enquiry/Comparison/Ordered, blocked once
// Transit (shipped). Mirrors the API route's own CANCELLABLE set (app/api/bom-items/[id]/cancel) —
// duplicated here only so the button can hide itself without a round trip; the route is the real
// gate.
const CANCELLABLE = new Set(['Enquiry', 'Comparison', 'Ordered']);

// Link-to-Item-Master — the fix for the real gap bulk import leaves behind: an exact-name match at
// import time (bom/import/route.js) auto-links most lines, but a line that misses it (typo,
// abbreviation, different formatting) had no edit path anywhere. Plain search-and-pick, deliberately
// no fuzzy auto-suggestion on top — same /api/items?search= idiom this codebase already has four
// independent copies of (PrWorkspace/StoresWorkspace/SalesWorkspace x2), not force-shared across a
// fifth different line shape, per this codebase's own documented reasoning for not sharing those.
// Server-side (app/api/bom-items/[id]/link-item) is the real gate — this is convenience UI, same
// division of responsibility as everything else in this file.
function LinkItemControl({ bomItemId, router }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function onType(v) {
    setQ(v);
    if (v.trim().length < 2) { setResults([]); return; }
    try { setResults(await api(`/api/items?search=${encodeURIComponent(v.trim())}`)); }
    catch { /* catalog search is best-effort, same idiom as every other copy of this widget */ }
  }

  async function pick(item) {
    setBusy(true);
    try {
      await api(`/api/bom-items/${bomItemId}/link-item`, { method: 'POST', body: { item_id: item.id } });
      showToast(`Linked to ${item.item_code || item.item_name}`);
      setOpen(false); setQ(''); setResults([]);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-info hover:underline">
        Link to Item Master
      </button>
    );
  }
  return (
    <div className="relative">
      <Input value={q} onChange={e => onType(e.target.value)} placeholder="Search catalog…" autoFocus
        className="h-7 w-56 text-xs" onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map(it => (
            // onMouseDown (not onClick) so the pick fires before the input's onBlur closes the dropdown.
            <button key={it.id} type="button" disabled={busy} onMouseDown={() => pick(it)}
              title={it.hsn_code ? `HSN ${it.hsn_code}` : undefined}
              className="flex w-full flex-col rounded-sm px-2 py-1 text-left text-xs hover:bg-muted">
              <span className="font-medium">{it.item_name}</span>
              <span className="text-muted-foreground">
                {it.item_code} · {it.uom}
                {(it.category || it.material_process_type) && ` · ${[it.category, it.material_process_type].filter(Boolean).join(' · ')}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Engineering/Design's item composer (create and edit — see useRichComposer below). Non-dimensional
// categories get a plain size/spec text box + this small unit dropdown instead of a bare free-text
// field; a dimensional category (plate, angle, ...) upgrades the whole row to CategoryFieldsBlock
// instead, which already carries its own per-dimension unit toggle.
const SIZE_UNITS = ['mm', 'inch', 'm', 'ft', 'NB', '—'];

let sizeRowKey = 1;
function emptySizeRow(categoryFields = {}) {
  return { key: sizeRowKey++, categoryFields, size_spec: '', unit: 'mm', qty_text: '' };
}

function safeParseCategoryFields(json) {
  if (!json) return {};
  try { return JSON.parse(json) || {}; } catch { return {}; }
}

// One size/spec + qty variant of the item being added. `category` is shared across every row on the
// form (it describes the *kind* of material, e.g. "these are all plates") — only each row's own
// dimensions/size differ, same as picking three different plate sizes of the same steel grade.
function SizeSpecRow({ row, index, total, category, onChange, onRemove, removable }) {
  const isDimensional = DIMENSIONAL_CATEGORIES.includes(category);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      {total > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Size/Spec #{index + 1}</span>
          {removable && (
            <Button type="button" size="icon-sm" variant="ghost" className="text-danger" aria-label="Remove this size/spec" onClick={onRemove}>
              <TrashIcon className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      {isDimensional ? (
        <CategoryFieldsBlock category={category} fields={row.categoryFields} onChange={categoryFields => onChange({ categoryFields })} />
      ) : (
        <div className="flex gap-2">
          <Input className="flex-1" placeholder="Size / Spec" value={row.size_spec} onChange={e => onChange({ size_spec: e.target.value })} />
          <Select value={row.unit} onValueChange={unit => onChange({ unit })}>
            <SelectTrigger className="h-9 w-20 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SIZE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Qty</Label>
        <Input placeholder="e.g. 2 Nos" value={row.qty_text} onChange={e => onChange({ qty_text: e.target.value })} />
      </div>
    </div>
  );
}

// Engineering/Design's item composer — catalog-aware description (auto-detects a dimensional
// category from the picked item, same as PrWorkspace's own Raise PR line), a manual category
// override, and repeatable size/spec+qty rows. Used for both create (editing.__new) and edit (an
// existing row) — see useRichComposer in BomTable. On create every row becomes its own bom_items
// POST, sharing description/MOC/category (no new schema: every downstream consumer already expects
// "one row = one packable variant"). On edit, row #1 PATCHes the existing row being edited (so
// editing a plain field never spawns a duplicate) and any further rows the user adds are new POSTs
// — the deliberate way to split a messy legacy row (e.g. three sizes jammed into one qty_text
// string, a real case found live) into proper separate rows, using the same UI either way. Row #1
// can never be removed while editing — it's not a draft row, it's the record being saved.
function AddItemForm({
  projectId, assemblies, otherFields, otherDefaults, otherOptions, canSetTraceability, canSetManufacturingFlag,
  existingItem, onDone, onCancel,
}) {
  const [description, setDescription] = useState(existingItem?.material_description || '');
  const [itemId, setItemId] = useState(existingItem?.item_id || null);
  const [uomHint, setUomHint] = useState('');
  const [moc, setMoc] = useState(existingItem?.moc || '');
  const [category, setCategory] = useState(existingItem?.category || '');
  const [sizeRows, setSizeRows] = useState(() => existingItem
    ? [{
        key: sizeRowKey++,
        categoryFields: safeParseCategoryFields(existingItem.category_fields_json),
        size_spec: DIMENSIONAL_CATEGORIES.includes(existingItem.category) ? '' : (existingItem.size_spec || ''),
        unit: 'mm',
        qty_text: existingItem.qty_text || '',
      }]
    : [emptySizeRow()]);
  const [traceability, setTraceability] = useState({
    requires_heat_no: !!existingItem?.requires_heat_no, requires_mtc: !!existingItem?.requires_mtc,
    requires_supplier_batch: !!existingItem?.requires_supplier_batch, requires_serial_no: !!existingItem?.requires_serial_no,
  });
  const [requiresManufacturing, setRequiresManufacturing] = useState(
    existingItem ? existingItem.requires_manufacturing !== 0 && existingItem.requires_manufacturing !== false : true);
  const [other, setOther] = useState(otherDefaults);
  const [saving, setSaving] = useState(false);

  // Same release-baseline freeze the plain dialog already enforced — a line's traceability/
  // manufacturing requirements shouldn't silently change after the BOM they belong to was released.
  const frozen = existingItem?.released_at_revision != null;
  const line = { material_description: description, item_id: itemId, uomHint };
  const TRACEABILITY_KEYS = ['requires_heat_no', 'requires_mtc', 'requires_supplier_batch', 'requires_serial_no'];

  function onLineChange(patch) {
    if ('material_description' in patch) setDescription(patch.material_description);
    if ('item_id' in patch) setItemId(patch.item_id);
    if ('uomHint' in patch) setUomHint(patch.uomHint);
    if ('category' in patch) {
      setCategory(patch.category);
      // A category change resets every row's own dimension fields — the old ones don't describe
      // the new shape (a plate's L/W/T means nothing once switched to "round").
      setSizeRows(rows => rows.map(r => ({ ...r, categoryFields: patch.categoryFields || {} })));
    }
    // The catalog's own detail_desc is only a starting suggestion for the first row's free-text
    // size/spec — ignored once the category is dimensional, where the row renders CategoryFieldsBlock
    // instead and this text has nowhere to go.
    if ('size_spec' in patch && !DIMENSIONAL_CATEGORIES.includes(patch.category ?? category)) {
      setSizeRows(rows => rows.map((r, i) => i === 0 ? { ...r, size_spec: patch.size_spec } : r));
    }
    const tKeys = TRACEABILITY_KEYS.filter(k => k in patch);
    if (tKeys.length) setTraceability(t => ({ ...t, ...Object.fromEntries(tKeys.map(k => [k, patch[k]])) }));
  }

  function updateRow(idx, patch) { setSizeRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r)); }
  function addRow() { setSizeRows(rows => [...rows, emptySizeRow(DIMENSIONAL_CATEGORIES.includes(category) ? {} : {})]); }
  function removeRow(idx) { setSizeRows(rows => rows.filter((_, i) => i !== idx)); }

  async function submit(e) {
    e.preventDefault();
    if (!description.trim()) return showToast('Description is required', 'error');
    const isDimensional = DIMENSIONAL_CATEGORIES.includes(category);
    if (isDimensional) {
      for (let i = 0; i < sizeRows.length; i++) {
        const err = validateCategoryFields(category, sizeRows[i].categoryFields);
        if (err) return showToast(`${sizeRows.length > 1 ? `Size/Spec #${i + 1} ` : 'Size/Spec '}${err}`, 'error');
      }
    }

    setSaving(true);
    try {
      let touched = 0;
      let created = 0;
      for (let i = 0; i < sizeRows.length; i++) {
        const row = sizeRows[i];
        const size_spec = isDimensional
          ? (categoryDisplaySpec(category, row.categoryFields) || '')
          : [row.size_spec.trim(), row.unit && row.unit !== '—' ? row.unit : ''].filter(Boolean).join(' ');
        const body = {
          material_description: description.trim(),
          moc: moc.trim(),
          size_spec,
          qty_text: row.qty_text,
          category: category || undefined,
          category_fields_json: isDimensional ? JSON.stringify(finalizeCategoryFields(category, row.categoryFields)) : undefined,
          ...other,
          ...(canSetTraceability && !frozen ? traceability : {}),
          ...(canSetManufacturingFlag && !frozen ? { requires_manufacturing: requiresManufacturing ? 1 : 0 } : {}),
        };
        let id;
        if (i === 0 && existingItem) {
          // Row #1 is the record being edited — PATCH it in place rather than creating a
          // duplicate. project_id is never a PATCH-able field (not in BOM_FIELD_OWNERS), so it's
          // deliberately left off this body, unlike the POST case below.
          await api(`/api/bom-items/${existingItem.id}`, { method: 'PATCH', body });
          id = existingItem.id;
          touched++;
        } else {
          const res = await api('/api/bom-items', { method: 'POST', body: { project_id: projectId, ...body } });
          id = res.id;
          touched++;
          created++;
        }
        // Best-effort — same idiom as LinkItemControl above. The catalog link is a convenience
        // (real Inventory matching), never load-bearing for the save itself; the row already
        // exists correctly whether or not this second call lands.
        if (itemId) {
          try { await api(`/api/bom-items/${id}/link-item`, { method: 'POST', body: { item_id: itemId } }); }
          catch { /* best-effort */ }
        }
      }
      showToast(created > 0 ? `Saved — ${created} new item${created === 1 ? '' : 's'} added` : (touched === 1 ? 'Item updated' : `${touched} items updated`));
      onDone();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <ItemSearchField line={line} onChange={onLineChange} />
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>MOC / Material Spec</Label>
          <Input value={moc} onChange={e => setMoc(e.target.value)} placeholder="e.g. IS 2062 E250" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Category</Label>
          <SearchableSelect
            className="w-full" value={category} options={CATEGORY_OPTIONS}
            onChange={v => onLineChange({ category: v, categoryFields: defaultCategoryFields(v) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {sizeRows.map((row, i) => (
          <SizeSpecRow
            key={row.key} row={row} index={i} total={sizeRows.length} category={category}
            onChange={patch => updateRow(i, patch)} onRemove={() => removeRow(i)}
            removable={!(existingItem && i === 0)}
          />
        ))}
        <Button type="button" size="sm" variant="ghost" className="w-fit text-muted-foreground" onClick={addRow}>
          <PlusIcon data-icon="inline-start" />Add another size/spec
        </Button>
      </div>

      {otherFields.map(f => (
        <div key={f} className="flex flex-col gap-1">
          <Label htmlFor={`bom-new-${f}`}>{FIELD_LABELS[f]}</Label>
          {f === 'assembly_id' ? (
            <select id="bom-new-assembly_id" value={other.assembly_id || ''} onChange={e => setOther(o => ({ ...o, assembly_id: e.target.value }))}
              className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="">— none —</option>
              {assemblies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <SearchableSelect
              value={other[f] || ''} displayValue={other[f] || ''} onTextChange={v => setOther(o => ({ ...o, [f]: v }))}
              onChange={v => setOther(o => ({ ...o, [f]: v }))} options={(otherOptions[f] || []).map(v => ({ value: v, label: v }))}
              placeholder="Type or pick from existing…" inputClassName="h-9"
            />
          )}
        </div>
      ))}

      {canSetTraceability && (
        <div className="flex flex-col gap-1.5">
          <Label>Traceability required at receipt</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {TRACEABILITY_FIELDS.map(f => (
              <label key={f} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={!!traceability[f]} disabled={frozen}
                  onChange={e => setTraceability(t => ({ ...t, [f]: e.target.checked }))} />
                {TRACEABILITY_LABELS[f]}
              </label>
            ))}
          </div>
          {frozen && <p className="text-xs text-muted-foreground">Frozen — reopen Release BOM to change these.</p>}
        </div>
      )}
      {canSetManufacturingFlag && (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={requiresManufacturing} disabled={frozen}
            onChange={e => setRequiresManufacturing(e.target.checked)} />
          Requires manufacturing
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </form>
  );
}

const FIELD_LABELS = {
  section: 'Section', group_label: 'Group', material_description: 'Description',
  moc: 'MOC / Material Spec', size_spec: 'Size / Spec', make: 'Make', qty_text: 'Qty',
  purchase_status: 'Status', pr_ref: 'PR No. & Date', po_ref: 'PO No. & Date',
  grn_ref: 'GRN No. & Date', grn_qty_text: 'GRN Qty', pending_qty_text: 'Pending Qty',
  bqtc_ref: 'BQ-TC', issued_ref: 'Issued', received_ref: 'Received',
  production_done: 'Prod. Done', remarks: 'Remarks', assembly_id: 'Assembly',
  received_heat_no: 'Heat No. (received)', received_mtc_no: 'MTC/Cert No. (received)',
  received_supplier_batch_no: 'Supplier Batch (received)', received_serial_no: 'Serial No. (received)',
};
// Same four names PrWorkspace.jsx's Raise PR checkboxes use — kept editable after creation too
// (gap found in review: previously these fell into the generic dialogFields text-input branch with
// no FIELD_LABELS entry, rendering as blank-labeled text boxes instead of checkboxes).
const TRACEABILITY_FIELDS = ['requires_heat_no', 'requires_mtc', 'requires_supplier_batch', 'requires_serial_no'];
const TRACEABILITY_LABELS = { requires_heat_no: 'Heat No.', requires_mtc: 'MTC', requires_supplier_batch: 'Supplier batch', requires_serial_no: 'Serial No.' };
// Visible data columns, in spreadsheet order (section/group render as divider rows instead).
const COLUMNS = ['moc', 'size_spec', 'make', 'qty_text', 'pr_ref', 'po_ref',
  'grn_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref',
  'production_done', 'remarks'];
// table-fixed (see the Table usage below) only respects the header row's widths, then applies
// them to every row in that column — these need to exist for every entry in COLUMNS or that
// column falls back to an even, too-narrow equal split alongside the others.
const COLUMN_WIDTHS = {
  moc: 'w-44', size_spec: 'w-40', make: 'w-28', qty_text: 'w-20', pr_ref: 'w-36', po_ref: 'w-36',
  grn_ref: 'w-36', grn_qty_text: 'w-24', pending_qty_text: 'w-28', bqtc_ref: 'w-24',
  issued_ref: 'w-28', received_ref: 'w-28', production_done: 'w-20', remarks: 'w-48',
};
// `onSaved` (optional): fires alongside router.refresh() after any successful mutation — additive,
// every existing caller keeps working unchanged (router.refresh() alone refreshes server-rendered
// props). Needed by callers whose `bom` is client-fetched local state instead (ReleaseBomTab, same
// as ProductionBomTab already is) — router.refresh() can't touch that state, so nothing but this
// callback ever tells them to refetch.
export default function BomTable({ projectId, bom, pendingIds = [], editableFields = [], department, canCancel = false, onSaved, assemblies = [], showItemCode = false, defaultAssemblyId, suggestionsFrom, layout = 'table' }) {
  const router = useRouter();
  useEntityHighlight(useSearchParams().get('highlight'));
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
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
  // Canonical Stores Receiving (Feature A) — Stores' own department view gets the Receive action in
  // the grn_ref column instead of a free-text field (removed from BOM_FIELD_OWNERS.Stores entirely,
  // so dialogFields below naturally no longer offers it). "Enforcement lives in the route" (see this
  // file's own header comment) — the real gate is requireAction in the /receive route; this is just
  // which department's view shows the button.
  const canReceive = department === 'Stores';
  const canStructure = editableFields.includes('material_description');
  const canSetTraceability = TRACEABILITY_FIELDS.some(f => editableFields.includes(f));
  const canSetManufacturingFlag = editableFields.includes('requires_manufacturing');
  // Dialog fields: the viewer's editable set, minus status, production_done, and requires_* (all
  // three get their own dedicated control — a plain text input is the wrong shape for a boolean;
  // requires_* specifically had been rendering as an unlabeled text box, a real bug found in review).
  // requires_manufacturing (Feature C) needs the same exclusion — found in a later review pass: left
  // out of this filter, it rendered as a second, generic text input sharing its `name` with the real
  // checkbox below, and FormData.get() always resolves to whichever field is first in the DOM (the
  // text input), so the checkbox's own checked state was silently never read at all.
  // `make` — Design/Engineering asked for it off this form entirely; ownership in BOM_FIELD_OWNERS is
  // unchanged, this only hides it here. `category`/`category_fields_json` are never plain-text
  // fields (a raw JSON blob box would be useless) — they render only through AddItemForm's own
  // CategoryFieldsBlock, below, for the create flow.
  const dialogFields = editableFields.filter(f =>
    f !== 'purchase_status' && f !== 'production_done' && f !== 'requires_manufacturing' && !TRACEABILITY_FIELDS.includes(f)
    && f !== 'make' && f !== 'category' && f !== 'category_fields_json');
  // The richer catalog-aware, category-adaptive, multi-size composer — Engineering/Design's own
  // create AND edit flow (AddItemForm branches internally on editing.__new vs an existing row).
  const useRichComposer = !!editing && canStructure;
  const otherFields = dialogFields.filter(f => !['material_description', 'moc', 'size_spec', 'qty_text'].includes(f));

  // Smart text input: native <datalist> suggestions from values already typed elsewhere — zero new
  // dependency, zero new backend, and purely additive (the field stays a plain <input>, so nothing
  // about validation/saving changes for any caller). No LLM, no fuzzy matching — just "what did
  // someone already type in this column." Suggestions draw from `suggestionsFrom` when the caller
  // passes it (NodeItemsTab passes the whole project's items, since a node's own filtered `bom` is
  // often empty right when suggestions matter most — a brand new node); every other caller doesn't
  // pass it, so this falls back to `bom` itself, unchanged.
  const SMART_TEXT_FIELDS = ['material_description', 'moc', 'size_spec', 'section', 'group_label', 'remarks'];
  const suggestionSource = suggestionsFrom || bom;
  const distinctValues = useMemo(() => {
    const out = {};
    for (const f of SMART_TEXT_FIELDS) {
      out[f] = [...new Set(suggestionSource.map(b => b[f]).filter(Boolean))].sort();
    }
    return out;
  }, [suggestionSource]);
  // The Actions column exists for edit/delete (dialogFields) OR the D10 cancel button — Design has
  // no editable fields at all (no BOM_FIELD_OWNERS entry) but still needs this column for Cancel.
  const hasActions = dialogFields.length > 0 || canCancel;

  const needle = q.trim().toLowerCase();
  const rows = bom.filter(b => {
    if (statusFilter !== 'all') {
      const st = b.purchase_status || DEFAULT_PURCHASE_STATUS; // blank counts as Enquiry
      if (st !== statusFilter) return false;
    }
    if (unlinkedOnly && b.item_id) return false;
    if (!needle) return true;
    // pr_no (round 3 Phase B, the real structured PR reference) alongside the legacy free-text
    // pr_ref — a row with pr_no set and no pr_ref (the normal case for anything raised through the
    // unified PR flow) would otherwise never match a search for its own visibly-displayed PR number.
    return ['material_description', 'moc', 'size_spec', 'make', 'group_label', 'pr_no', 'pr_ref', 'po_ref', 'grn_ref', 'remarks']
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
    // material_description used to be enforced by the plain <input required>; SmartTextField
    // renders its value through a hidden input instead (so it can stay a real search dropdown, not
    // native autocomplete), which browsers don't reliably validate — so this is the real check now.
    if (dialogFields.includes('material_description') && !body.material_description.trim()) {
      showToast('Description is required', 'error');
      return;
    }
    // Checkboxes need explicit boolean coercion, same reasoning as toggleProductionDone below —
    // a native checkbox's FormData value is 'on'/absent, not a value this table's other text fields
    // ever produce, and the PATCH route's NOT NULL boolean columns need 1/0, not that string.
    // released_at_revision is a UI hint only (it never clears on reopen, so it can be over-cautious
    // just after a legitimate reopen) — the server's live-milestone check is the real gate either way,
    // so simply not sending these fields here is always safe, never wrongly permissive.
    const frozen = editing?.released_at_revision != null;
    if (canSetTraceability && !frozen) {
      for (const f of TRACEABILITY_FIELDS) if (editableFields.includes(f)) body[f] = form.get(f) ? 1 : 0;
    }
    if (canSetManufacturingFlag && !frozen) {
      body.requires_manufacturing = form.get('requires_manufacturing') ? 1 : 0;
    }
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
        {/* Visible to every department viewing this table (plain display filter over data already
            shown); only the Link action itself, below, is Engineering-gated. */}
        <Button size="sm" variant={unlinkedOnly ? 'secondary' : 'outline'} className="h-8"
          onClick={() => setUnlinkedOnly(v => !v)}>
          Not linked to catalog
        </Button>
        <span className="text-xs text-muted-foreground tnum">{rows.length} of {bom.length} items</span>
        {/* Jump the wide table left/right without hunting for the scrollbar at the bottom of the page.
            Not needed in card layout — there's nothing to scroll, everything wraps instead. */}
        {layout === 'table' && (
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="Scroll table left" onClick={() => scrollByCols(-1)}>
              <ChevronLeftIcon />
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Scroll table right" onClick={() => scrollByCols(1)}>
              <ChevronRightIcon />
            </Button>
          </div>
        )}
        {canStructure && (
          <Button size="sm" variant="outline" className="ml-auto"
            onClick={() => setEditing({ __new: true, section: lastSection || '', assembly_id: defaultAssemblyId ?? '' })}>
            + Add item
          </Button>
        )}
      </div>

      {/* Card layout — a narrow embedded context (the BOM workspace's own Items tab) doesn't have
          room for the wide table's ~15 sticky/scrolling columns; wrapping key facts into a card
          that reflows, instead of forcing horizontal scroll, is the actual fix for "why does this
          look like Excel." Reuses every existing mutation/edit primitive (setEditing opens the
          exact same dialog, remove/cancelItem/setStatus are the same functions the table row used)
          — only the read-only *presentation* differs, nothing about how a save/delete happens. */}
      {layout === 'cards' ? (
        <div className="flex flex-col gap-2">
          {rendered.map(r => r.divider ? (
            <div key={r.key} className={`mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0 ${r.divider === 'group' ? 'pl-3 normal-case' : ''}`}>{r.label}</div>
          ) : (
            <div key={r.id} data-entity-code={`BM-${r.id}`} className="rounded-md border p-3 text-sm transition-colors hover:bg-muted/30">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {showItemCode && <span className="mr-1 text-[11px] tnum text-muted-foreground/70">BM-{r.id}</span>}
                    {r.material_description}
                  </p>
                  <TraceabilityBadges item={r} />
                  {canStructure && !r.item_id && <div className="mt-1"><LinkItemControl bomItemId={r.id} router={router} /></div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Purchase status is Procurement's own lifecycle — showing it here, before a BOM
                      is even released, is noise (every fresh line reads "Enquiry", telling Engineering
                      nothing). Only surface it once it's actually moved past the default, or for a
                      department that can act on it directly. */}
                  {canInlineStatus ? (
                    <Select value={r.purchase_status || 'none'} onValueChange={v => setStatus(r, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : r.purchase_status && r.purchase_status !== DEFAULT_PURCHASE_STATUS ? (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[r.purchase_status] || 'bg-muted text-muted-foreground ring-border'}`}>
                      {r.purchase_status}
                    </span>
                  ) : null}
                  {dialogFields.length > 0 && (
                    <Button size="icon-sm" variant="ghost" aria-label="Edit item" onClick={() => setEditing(r)}><PencilIcon className="size-3.5" /></Button>
                  )}
                  {canStructure && (
                    <Button size="icon-sm" variant="ghost" className="text-danger" aria-label="Delete item" onClick={() => remove(r)}><TrashIcon className="size-3.5" /></Button>
                  )}
                </div>
              </div>
              {columns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {columns.filter(c => r[c] != null && r[c] !== '').map(c => (
                    <span key={c}><span className="text-muted-foreground/70">{FIELD_LABELS[c]}:</span> {String(r[c])}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
      /* table-fixed is load-bearing, not decorative: the sticky offsets below (left-12,
          left-[19rem], left-[27rem]) are hardcoded assuming each column renders at exactly its
          declared w-* width. table-layout's default (auto) lets content shrink a column below
          that (e.g. "#" with single-digit rows), so the offsets stop matching reality and the
          scrolling columns physically overlap/bleed under the sticky ones instead of hiding
          cleanly behind them. Fixed layout forces the declared widths to actually be honored. */
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
              <TableRow key={r.id} data-entity-code={`BM-${r.id}`}>
                <TableCell className="sticky left-0 z-10 w-12 bg-background tnum text-muted-foreground">{bom.indexOf(r) + 1}</TableCell>
                <TableCell className="sticky left-12 z-10 w-64 min-w-64 max-w-64 break-words bg-background font-medium">
                  {/* Canonical entity code shown alongside the name — opt-in only (BOM workspace's
                      Items tab), every other caller of this shared table is unaffected. */}
                  {showItemCode && <span className="mr-1 text-[11px] tnum text-muted-foreground/70">BM-{r.id}</span>}
                  {r.material_description}
                  {/* Item Master identity (§3.2) — the catalog's own code, shown only when this
                      line is actually linked (item_id), never a free-typed value. */}
                  {(r.catalog_item_code || r.drawing_name || r.template_name) && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {[
                        r.catalog_item_code,
                        r.drawing_name && `Drg ${r.drawing_dg_no || `DWG-${String(r.drawing_id).padStart(4, '0')}`} · ${r.drawing_name}${r.drawing_revision ? ` (${r.drawing_revision})` : ''}`,
                        r.template_name && `via ${r.template_name}`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {/* Derived from selected_quote_id (§5a) — set via the Procurement workspace's
                      supplier selection, not editable here. */}
                  {r.selected_supplier_name && (
                    <div className="text-xs font-normal text-muted-foreground">Supplier: {r.selected_supplier_name}</div>
                  )}
                  {/* Traceability requirements — canonical renderer, shared with
                      ProcurementWorkspace.jsx and QcDocumentEditor.jsx (see TraceabilityBadges.jsx
                      for why: those screens never rendered BomTable at all, so the flag was
                      structurally invisible to them until extracted into one shared component). */}
                  <TraceabilityBadges item={r} />
                  {canStructure && !r.item_id && (
                    <div className="mt-1"><LinkItemControl bomItemId={r.id} router={router} /></div>
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
                  <TableCell key={c} className="overflow-hidden text-muted-foreground">
                    {c === 'production_done' ? (
                      // A requires_manufacturing=0 line never gets a production_done tick — it
                      // becomes packable the moment it's Received (Feature C, lib/data.js's
                      // getProjectBom). Without this, the column read as a blank "—", identical to a
                      // manufacturing line that's simply not done yet — no way to tell "skips
                      // Production entirely" from "still waiting on Production" at a glance.
                      !r.requires_manufacturing ? (
                        <span className="text-xs italic text-muted-foreground" title="No fabrication needed — packable as soon as it's Received.">
                          Direct to packing
                        </span>
                      ) : canToggleProductionDone ? (
                        <input type="checkbox" checked={!!r.production_done} aria-label="Production done"
                          onChange={e => toggleProductionDone(r, e.target.checked)} />
                      ) : (r.production_done ? 'Done' : '—')
                    ) : c === 'grn_ref' && r.receipt_id ? (
                      // Once a receipt is linked, grn_ref is derived from it and read-only here —
                      // the single-source-of-truth guarantee Feature A depends on. Print links reach
                      // the same tag PDF either scoped to just this line or the whole receipt.
                      <div className="flex flex-col gap-0.5 text-xs">
                        <TruncatedCell value={r.grn_ref} />
                        <div className="flex gap-2">
                          <a className="text-info hover:underline" target="_blank" rel="noreferrer"
                            href={`/api/stock-receipts/${r.receipt_id}/tag?bom_item_id=${r.id}`}>Tag (this item)</a>
                          <a className="text-info hover:underline" target="_blank" rel="noreferrer"
                            href={`/api/stock-receipts/${r.receipt_id}/tag`}>Full receipt</a>
                        </div>
                      </div>
                    ) : c === 'grn_ref' && canReceive && !['Received', 'Cancelled', 'In-Stock'].includes(r.purchase_status) ? (
                      <ReceiveBomItemDialog item={r} onDone={onSaved} />
                    ) : c === 'pr_ref' ? (
                      // round 3 Phase B — the real pr_no (+ its date) wins once a line went through
                      // the unified PR flow (bom_items.pr_item_id); the legacy free-text pr_ref only
                      // still matters for rows from before that flow existed.
                      <TruncatedCell value={r.pr_no ? `${r.pr_no} · ${formatDate(r.pr_created_at)}` : r.pr_ref} />
                    ) : <TruncatedCell value={r[c]} />}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
      </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.__new ? 'Add BOM item' : 'Edit BOM item'}</DialogTitle>
          </DialogHeader>
          {editing && useRichComposer ? (
            <AddItemForm
              projectId={projectId} assemblies={assemblies} otherFields={otherFields}
              // Always a string — POST /api/bom-items coerces any non-string field value to null
              // (matching a native <select>'s FormData.get(), always a string, which the old
              // generic dialog relied on implicitly). assembly_id in particular arrives here as a
              // raw number (defaultAssemblyId is node.id), so leaving it uncoerced would silently
              // drop the assembly link on every item added straight from a node's own Items tab —
              // a real bug caught live: two rows created without String() both had assembly_id null.
              otherDefaults={Object.fromEntries(otherFields.map(f => [f, editing[f] != null ? String(editing[f]) : '']))}
              otherOptions={distinctValues}
              canSetTraceability={canSetTraceability} canSetManufacturingFlag={canSetManufacturingFlag}
              existingItem={editing.__new ? null : editing}
              onDone={() => { setEditing(null); router.refresh(); onSaved?.(); }}
              onCancel={() => setEditing(null)}
            />
          ) : editing && (
            <form onSubmit={saveDialog} className="flex flex-col gap-3">
              {!editing.__new && !dialogFields.includes('material_description') && (
                <p className="text-sm text-muted-foreground">{editing.material_description}</p>
              )}
              {dialogFields.map(f => (
                <div key={f} className="flex flex-col gap-1">
                  <Label htmlFor={`bom-${f}`}>{FIELD_LABELS[f]}</Label>
                  {f === 'assembly_id' ? (
                    // Plain native <select> (not the Radix Select used elsewhere) so the
                    // uncontrolled FormData collection saveDialog already does for every other
                    // field keeps working unchanged for this one too — a name+value native
                    // control is all FormData needs.
                    <select id="bom-assembly_id" name="assembly_id" defaultValue={editing.assembly_id || ''}
                      className="h-9 rounded-md border bg-background px-3 text-sm">
                      <option value="">— none —</option>
                      {assemblies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : SMART_TEXT_FIELDS.includes(f) ? (
                    <SmartTextField field={f} defaultValue={editing[f]}
                      options={distinctValues[f]} required={f === 'material_description'} />
                  ) : (
                    <Input id={`bom-${f}`} name={f} defaultValue={editing[f] || ''} />
                  )}
                </div>
              ))}
              {canSetTraceability && (
                <div className="flex flex-col gap-1.5">
                  <Label>Traceability required at receipt</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {TRACEABILITY_FIELDS.map(f => (
                      <label key={f} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" name={f} defaultChecked={!!editing[f]}
                          disabled={editing.released_at_revision != null} />
                        {TRACEABILITY_LABELS[f]}
                      </label>
                    ))}
                  </div>
                  {editing.released_at_revision != null && (
                    <p className="text-xs text-muted-foreground">
                      Frozen — reopen Release BOM to change these.
                    </p>
                  )}
                </div>
              )}
              {canSetManufacturingFlag && (
                // Feature C — distinct from traceability above: whether this line ever needs
                // Production's own fabrication step. Same release-freeze governance, separate
                // checkbox since the semantics aren't traceability.
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="requires_manufacturing"
                    defaultChecked={editing.requires_manufacturing !== 0 && editing.requires_manufacturing !== false}
                    disabled={editing.released_at_revision != null} />
                  Requires manufacturing
                </label>
              )}
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
