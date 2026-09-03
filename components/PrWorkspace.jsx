'use client';

// Group 5 Bundle A — the unified PR flow (D3, unify decision 2026-08-04). One shared page for
// Engineering/Design/Stores (whichever departments the viewer holds): bundle 1-or-more item lines,
// split each across one or more projects with its own qty, submit. Materializes straight to
// bom_items on Enquiry — no acceptance gate. Kept deliberately lean per the client's steer
// ("if they don't like it, we can make changes later") — no PR history/list view yet.
//
// V2-CHANGES.md Group 6 Phase 6.4 — Stores-only, a per-line source selector (bom/stock, D7).
// Eng/Design stay bom-only (their lines never show the picker, always source='bom'). 'stock' builds
// existing inventory (no project, a numeric qty for the Received-time increment, Phase 6.3).
// 'sas' (trade against a Sale Order) used to be raisable from here too, Stores-initiated — per
// STORES-SALES-CHANGES.md, SAS is now Sales-only (components/SalesWorkspace.jsx's own "Request
// from Stores" dialog), so it's deliberately not offered in this picker anymore.
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { TrashIcon, PlusIcon, ClipboardListIcon, LayoutTemplateIcon, CheckIcon, DownloadIcon, UndoIcon } from 'lucide-react';
import WorkspaceSidebar from './WorkspaceSidebar';
import BomTable from './BomTable';
import DimensionInput from './DimensionInput';
import SearchableSelect from './SearchableSelect';
import QtyInput from './QtyInput';
import CategoryFieldsBlock, { OTHER_MOC, MOC_OPTIONS } from './CategoryFieldsBlock';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import {
  CATEGORY_LABEL, GEOMETRY_SHAPES, ROLLED_CATEGORIES, OTHER_SIZE, STANDARD_SECTIONS, categoryDisplaySpec,
} from '@/lib/section-shapes';
import BomTemplateManager from './BomTemplateManager';
import {
  NamedPartsEditor, ItemSearchField, CATEGORY_OPTIONS, defaultCategoryFields, finalizeCategoryFields,
  defaultTraceabilityFromCategory, TRACEABILITY_FLAG_LABELS,
} from './BomLineFields';

// Phase 1 nav reorg (SYSTEM.md): defaultCategoryFields/defaultTraceabilityFrom*/TRACEABILITY_FLAG_LABELS/
// CATEGORY_OPTIONS/guessCategory/finalizeCategoryFields/NamedPartsEditor/ItemSearchField moved to
// ./BomLineFields (shared with BomTemplateManager.jsx, which also needs them and previously had no
// way to import them). Nothing here changed behavior, only location.

let nextKey = 1;
function emptyLine() {
  return {
    key: nextKey++, source: 'bom', material_description: '', moc: '', size_spec: '', uomHint: '',
    projects: [{ key: nextKey++, project_id: '', qty_text: '', drawing_id: '', drawingOptions: null }],
    inventory_item_id: '', qty: '',
    category: '', categoryFields: {}, namedParts: [],
    item_id: null, // §3.2 — set only when picked from the catalog search; cleared on any hand-edit
    requires_heat_no: false, requires_mtc: false, requires_supplier_batch: false, requires_serial_no: false,
    requires_manufacturing: true, // Feature C — default checked; no category signal confident enough to infer this
  };
}

// CALC-CHANGES2.md §F — category tags a "project material" line with its physical shape, plus a
// small set of category-specific dimension fields (category_fields_json — same "shape varies,
// read/written whole" idiom calc_tables/calc_snapshots already use, not a wide sparse column set).
// Optional: a line can stay uncategorized, same as it does today. CATEGORY_LABEL/GEOMETRY_SHAPES/
// ROLLED_CATEGORIES live in lib/section-shapes.js — shared with Stores' matching inventory-item
// picker (components/StoresWorkspace.jsx) so a BOM line's size and a stock item's spec are always
// generated the same way, which is what lib/remnant-match.js's plain-text matching relies on.

// Weight-per-metre needed before a category's weight can be shown/validated: computed straight
// from geometry for GEOMETRY_SHAPES categories (no input, never wrong), picked from
// STANDARD_SECTIONS or typed by hand for ROLLED_CATEGORIES/tee.
function validateCategoryFields(category, fields) {
  if (category === 'standard') return Number(fields.qty) > 0 ? null : 'needs a quantity';
  if (category === 'plate') {
    return (Number(fields.length) > 0 && Number(fields.width) > 0 && Number(fields.thickness) > 0)
      ? null : 'needs its length/width/thickness filled in';
  }
  if (GEOMETRY_SHAPES[category]) {
    return GEOMETRY_SHAPES[category].dims.every(d => Number(fields[d.key]) > 0) ? null : 'needs its dimensions filled in';
  }
  if (ROLLED_CATEGORIES.includes(category) || category === 'tee') {
    if (!fields.size || fields.size === OTHER_SIZE) return 'needs a size';
    if (!(Number(fields.kg_per_m) > 0)) return 'needs a weight per metre (kg/m)';
    if (!(Number(fields.length) > 0)) return 'needs a length';
    return null;
  }
  return null;
}

const SOURCE_LABEL = { bom: 'Project material', stock: 'Build stock' };

function LineCard({ line, index, projects, inventoryItems, showSourcePicker, onChange, onRemove, removable }) {
  // A ref mirror of the latest `line`, read only by the async drawing fetch below — without it,
  // the fetch's post-await update would close over the `line` from the render that kicked it off
  // and silently roll back any edit (e.g. the project pick itself) made to the same line while the
  // fetch was in flight. Every synchronous handler still reads `line` directly as before.
  const lineRef = useRef(line);
  lineRef.current = line;
  // Local, not derived from `line.moc` on every render — so picking "Other" reveals the custom box
  // without ever writing a sentinel token into the real field (unlike the size pickers' OTHER_SIZE,
  // which needs defensive stripping elsewhere because it round-trips through the value itself).
  // Initialized (not just defaulted to false) from whether the line already has a non-preset moc —
  // a catalog pick or a template can seed one before this ever renders.
  const [mocCustomOpen, setMocCustomOpen] = useState(() => !!line.moc && !MOC_OPTIONS.some(o => o.value === line.moc));

  function setLine(patch) { onChange({ ...line, ...patch }); }
  function setProject(pkey, patch) {
    setLine({ projects: line.projects.map(p => p.key === pkey ? { ...p, ...patch } : p) });
  }
  function addProject() { setLine({ projects: [...line.projects, { key: nextKey++, project_id: '', qty_text: '', drawing_id: '', drawingOptions: null }] }); }
  function removeProject(pkey) { setLine({ projects: line.projects.filter(p => p.key !== pkey) }); }

  // Drawing linking (2026-08-19) — "where applicable", never required. Fetched lazily per project
  // row since a drawing is inherently project-specific and a line can split across several.
  // Best-effort: /api/calc-drawings is Design/Engineering-gated (lib/calc.js), so a Stores user
  // raising a line simply never sees the picker — same "no error, just skip" precedent as every
  // other best-effort fetch in this file.
  async function onProjectChange(pkey, projectId) {
    setProject(pkey, { project_id: projectId, drawing_id: '', drawingOptions: null });
    if (!projectId) return;
    let drawingOptions = [];
    try { ({ drawings: drawingOptions } = await api(`/api/calc-drawings?project_id=${projectId}`)); } catch { /* best-effort */ }
    const current = lineRef.current;
    onChange({ ...current, projects: current.projects.map(p => p.key === pkey ? { ...p, drawingOptions } : p) });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      {/* This numbers the lines within the current submission only, so it's always known and
          correct — the eventual BOM row number a line lands on depends on how many items the
          target project already has (and anyone else raising a PR against it concurrently), which
          this form has no reliable way to predict before Raise PR actually runs. */}
      <span className="text-xs font-medium text-muted-foreground">Item {index}</span>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1"><ItemSearchField line={line} onChange={setLine} /></div>
        {removable && (
          <Button size="icon-sm" variant="ghost" className="mt-6 shrink-0" onClick={onRemove}><TrashIcon className="size-4" /></Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>MOC {line.category ? <span className="text-danger">*</span> : '(optional)'}</Label>
          <SearchableSelect value={mocCustomOpen ? '' : (line.moc || '')} placeholder="Type to search a material…"
            options={MOC_OPTIONS}
            onChange={v => {
              if (v === OTHER_MOC) { setMocCustomOpen(true); return; }
              setMocCustomOpen(false);
              setLine({ moc: v });
            }} />
          {mocCustomOpen && (
            <Input className="mt-1" value={line.moc} onChange={e => setLine({ moc: e.target.value })}
              placeholder="e.g. IS 2062 E250" required={!!line.category} autoFocus />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Size / spec (optional)</Label>
          <Input value={line.size_spec} onChange={e => setLine({ size_spec: e.target.value })} />
        </div>
      </div>

      {showSourcePicker && (
        <div className="flex flex-col gap-1.5">
          <Label>Kind</Label>
          <Select value={line.source} onValueChange={v => setLine({ source: v })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SOURCE_LABEL).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {line.source === 'bom' && (
        <div className="flex flex-col gap-1.5">
          <Label>Category (optional)</Label>
          <SearchableSelect className="w-56" value={line.category || ''} options={CATEGORY_OPTIONS}
            onChange={v => setLine({
              category: v, categoryFields: defaultCategoryFields(v),
              // Category-based traceability default only for a free-text line — a catalog pick's
              // own default_requires_* (set at ItemSearchField.pick, above) already won and must not
              // be silently overridden by a later category tweak on the same line.
              ...(!line.item_id && defaultTraceabilityFromCategory(v)),
            })} />
        </div>
      )}

      {line.source === 'bom' && line.category && (
        // Size/spec (bom_items.size_spec) is what every downstream department actually sees in the
        // Master BOM table — category_fields_json (dims/size/kg_per_m/density) drives weight + stock
        // matching but is never itself displayed there. Suggest it from the dimensions so the two
        // don't silently diverge, but only while it's still blank — a value the user already typed
        // (or already edited) is never overwritten.
        <CategoryFieldsBlock category={line.category} fields={line.categoryFields}
          onChange={categoryFields => setLine({
            categoryFields,
            size_spec: line.size_spec || categoryDisplaySpec(line.category, categoryFields),
          })} />
      )}

      {line.source === 'bom' && (
        // Traceability requirements — a per-line, per-project judgment (Engineering's call, per
        // BOM_FIELD_OWNERS), never a catalog-level constant. Pre-checked from the catalog pick or
        // category default above, but always editable here regardless of where the line came from.
        <div className="flex flex-col gap-1.5">
          <Label>Traceability required at receipt (optional)</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Object.entries(TRACEABILITY_FLAG_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={!!line[key]} onChange={e => setLine({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      {line.source === 'bom' && (
        // Feature C — distinct from the traceability block above: whether this line ever needs
        // Production's own fabrication step at all (a bought-out item, e.g., doesn't). Deliberately
        // no category-based default — no confident signal exists for it, unlike the four flags
        // above's dimensional-category fallback; ships as a plain checkbox, default checked.
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={!!line.requires_manufacturing}
            onChange={e => setLine({ requires_manufacturing: e.target.checked })} />
          Requires manufacturing
        </label>
      )}

      {line.source === 'bom' && line.category && (
        <NamedPartsEditor parts={line.namedParts || []} onChange={namedParts => setLine({ namedParts })} />
      )}

      {line.source === 'bom' && (
        <div className="flex flex-col gap-1.5">
          <Label>Projects &amp; quantity<span className="text-danger"> *</span></Label>
          {line.projects.map(p => (
            <div key={p.key} className="flex items-center gap-2">
              <Select value={p.project_id} onValueChange={v => onProjectChange(p.key, v)}>
                <SelectTrigger className="w-48" aria-invalid={!p.project_id}><SelectValue placeholder="Project…" /></SelectTrigger>
                <SelectContent>
                  {projects.map(pr => <SelectItem key={pr.id} value={String(pr.id)}>{pr.project_no}</SelectItem>)}
                </SelectContent>
              </Select>
              <QtyInput value={p.qty_text} onChange={v => setProject(p.key, { qty_text: v })} />
              {p.drawingOptions?.length > 0 && (
                <Select value={p.drawing_id} onValueChange={v => setProject(p.key, { drawing_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Drawing (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No drawing</SelectItem>
                    {p.drawingOptions.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.dgNo || `DWG-${String(d.id).padStart(4, '0')}`} · {d.name}{d.revision ? ` · ${d.revision}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {line.projects.length > 1 && (
                <Button size="icon-sm" variant="ghost" onClick={() => removeProject(p.key)}><TrashIcon className="size-4" /></Button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-fit" onClick={addProject}>
            <PlusIcon data-icon="inline-start" />Add project
          </Button>
        </div>
      )}

      {line.source === 'stock' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Inventory item</Label>
            <Select value={line.inventory_item_id} onValueChange={v => setLine({ inventory_item_id: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {inventoryItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Quantity to build</Label>
            <Input type="number" value={line.qty} onChange={e => setLine({ qty: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// Moved in from the Templates tab so using one doesn't mean leaving Raise PR — the Templates tab
// itself is unchanged (creating/managing templates is still its own concern). Same
// /api/bom-templates(/apply) endpoints, just a compact modal instead of a separate page.
// A PR template carries no project (that's the whole point — the same lines can feed any number
// of projects, chosen at Raise PR time, not baked in). "Using" one is never a direct write: it
// loads the template's items into the Raise PR form below, fully editable, and nothing happens to
// the database until Raise PR actually runs — same real /api/purchase-requisitions flow as typing
// every line by hand. Converts a bom_template_items row into an emptyLine()-shaped line one field
// at a time, checked against both shapes: material_description/moc/size_spec/category/item_id copy
// straight across (both sides already use identical names); categoryFields comes back out of the
// stored JSON string the same way finalizeCategoryFields' result went in; the one projects row
// starts with project_id blank (nothing to prefill) and qty_text seeded from the template item's
// own qty_text as an editable starting suggestion.
function templateItemToLine(it) {
  return {
    key: nextKey++, source: 'bom',
    material_description: it.material_description || '', moc: it.moc || '', size_spec: it.size_spec || '', uomHint: '',
    projects: [{ key: nextKey++, project_id: '', qty_text: it.qty_text || '', drawing_id: '', drawingOptions: null }],
    inventory_item_id: '', qty: '',
    category: it.category || '', categoryFields: it.category_fields_json ? JSON.parse(it.category_fields_json) : {},
    namedParts: it.named_parts_json ? JSON.parse(it.named_parts_json) : [],
    item_id: it.item_id || null,
  };
}

function isBlankLine(l) {
  return !l.material_description.trim() && !l.moc.trim() && !l.category
    && l.projects.every(p => !p.project_id && !p.qty_text.trim());
}

// Replaces the form outright only when it's still the untouched single default blank line — once
// there's real content, merging means appending, same "Template A -> apply -> Template B -> apply"
// precedent BOM-template apply already established (never silently discards what's there).
function mergeTemplateItemsIntoLines(existingLines, items) {
  const newLines = items.map(templateItemToLine);
  if (existingLines.length === 1 && isBlankLine(existingLines[0])) return newLines;
  return [...existingLines, ...newLines];
}

function PrTemplatePicker({ onClose, onPick }) {
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api('/api/bom-templates?kind=pr').then(setTemplates).catch(err => showToast(err.message, 'error')); }, []);

  async function use() {
    if (!templateId) return showToast('Choose a template', 'error');
    setLoading(true);
    try {
      const full = await api(`/api/bom-templates/${templateId}`);
      onPick(full.items);
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setLoading(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Use a PR template</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger><SelectValue placeholder={templates === null ? 'Loading…' : 'Choose a template'} /></SelectTrigger>
            <SelectContent><SelectGroup>
              {templates?.length === 0
                ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No PR templates yet</div>
                : templates?.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.item_count} item{t.item_count === 1 ? '' : 's'}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Adds this template's items to the form below — nothing is submitted until you Raise PR.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={loading || !templates?.length} onClick={use}>{loading ? 'Loading…' : 'Use template'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Release BOM's own template action (§ new) — a BOM template applied while already looking at one
// project's BOM, so the project is fixed (no picker, unlike TemplatesTab's own Apply which starts
// with no project context at all). Same apply mechanics as ApplyTemplateDialog below, just scoped.
function ApplyBomTemplateDialog({ projectId, onClose, router, onApplied }) {
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => { api('/api/bom-templates?kind=bom').then(setTemplates).catch(err => showToast(err.message, 'error')); }, []);

  async function apply(confirm = false) {
    if (!templateId) return showToast('Choose a template', 'error');
    setApplying(true);
    try {
      const res = await api(`/api/bom-templates/${templateId}/apply`, { method: 'POST', body: { project_id: projectId, confirm } });
      if (res.needsConfirm) {
        setApplying(false);
        if (window.confirm(`This project already has: ${res.duplicates.join(', ')}. Add this template's items anyway?`)) await apply(true);
        return;
      }
      showToast(`${res.inserted} item(s) added to the project's BOM`);
      router.refresh();
      await onApplied?.();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setApplying(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Apply a BOM template</DialogTitle></DialogHeader>
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger><SelectValue placeholder={templates === null ? 'Loading…' : 'Choose a template'} /></SelectTrigger>
          <SelectContent><SelectGroup>
            {templates?.length === 0
              ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No BOM templates yet</div>
              : templates?.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.item_count} item{t.item_count === 1 ? '' : 's'}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={applying || !templates?.length} onClick={() => apply(false)}>{applying ? 'Applying…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Exported so components/EngineeringWorkspace.jsx can render this same tab from a second entry
// point (its own sidebar) without nesting a second full WorkspaceSidebar shell — PrWorkspace's own
// usage below is unchanged either way.
export function RaisePrTab({ departments, projects, inventoryItems = [], prTemplatePrefill, onPrefillConsumed }) {
  const router = useRouter();
  const [dept, setDept] = useState(departments[0] || '');
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const showSourcePicker = dept === 'Stores';

  // Templates tab's "Use in Raise PR" hands its items down through the parent (PrWorkspace) as
  // prTemplatePrefill, since that action starts on a different tab — this is the other half of
  // that handoff, consumed exactly once (onPrefillConsumed clears it so switching tabs away and
  // back doesn't re-apply it). "Use template" below (this tab's own button) skips this prop
  // entirely — it's already here, so it merges straight into `lines` via the same helper.
  useEffect(() => {
    if (!prTemplatePrefill) return;
    setLines(ls => mergeTemplateItemsIntoLines(ls, prTemplatePrefill));
    onPrefillConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prTemplatePrefill]);

  function updateLine(key, next) { setLines(ls => ls.map(l => l.key === key ? next : l)); }
  function addLine() { setLines(ls => [...ls, emptyLine()]); }
  function removeLine(key) { setLines(ls => ls.filter(l => l.key !== key)); }

  async function submit() {
    if (!dept) return showToast('Pick a department', 'error');
    for (const l of lines) {
      if (!l.material_description.trim()) return showToast('Every line needs a description', 'error');
      const source = showSourcePicker ? l.source : 'bom';
      if (source === 'bom' && l.projects.some(p => !p.project_id || !p.qty_text.trim())) {
        return showToast('Every project split needs a project and a quantity', 'error');
      }
      if (source === 'stock' && (!l.inventory_item_id || !l.qty || Number(l.qty) <= 0)) {
        return showToast('Pick an inventory item and a quantity to build', 'error');
      }
      if (source === 'bom' && l.category) {
        if (!l.moc.trim()) return showToast(`${CATEGORY_LABEL[l.category]} needs an MOC — that's what remnant matching checks against`, 'error');
        const err = validateCategoryFields(l.category, l.categoryFields);
        if (err) return showToast(`${CATEGORY_LABEL[l.category]} ${err}`, 'error');
      }
    }
    setBusy(true);
    try {
      const res = await api('/api/purchase-requisitions', {
        method: 'POST',
        body: {
          raised_by_dept: dept,
          lines: lines.map(l => {
            const source = showSourcePicker ? l.source : 'bom';
            const base = {
              material_description: l.material_description, moc: l.moc || undefined, size_spec: l.size_spec || undefined, source, item_id: l.item_id || undefined,
              requires_heat_no: l.requires_heat_no || undefined, requires_mtc: l.requires_mtc || undefined,
              requires_supplier_batch: l.requires_supplier_batch || undefined, requires_serial_no: l.requires_serial_no || undefined,
              // Unlike the four flags above (default false, safe to omit when unchecked),
              // requires_manufacturing defaults TRUE — an explicit `false` must always be sent, or
              // the server's own NOT NULL DEFAULT 1 would silently override an intentional uncheck.
              requires_manufacturing: source === 'bom' ? !!l.requires_manufacturing : undefined,
            };
            if (source === 'stock') return { ...base, inventory_item_id: Number(l.inventory_item_id), qty: Number(l.qty) };
            return {
              ...base, category: l.category || undefined, category_fields: l.category ? finalizeCategoryFields(l.category, l.categoryFields) : undefined,
              named_parts: l.category && l.namedParts?.length ? l.namedParts : undefined,
              projects: l.projects.map(p => ({ project_id: Number(p.project_id), qty_text: p.qty_text, drawing_id: p.drawing_id ? Number(p.drawing_id) : undefined })),
            };
          }),
        },
      });
      showToast(`${res.pr_no} raised — ${res.bom_item_ids.length} item(s) on Enquiry now`);
      setLines([emptyLine()]);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raise a purchase requisition</CardTitle>
        <CardAction><Button size="sm" variant="outline" onClick={() => setPickingTemplate(true)}><LayoutTemplateIcon data-icon="inline-start" />Use template</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {departments.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label>Raising as</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {lines.map((l, i) => (
          <LineCard key={l.key} index={i + 1} line={l} projects={projects} inventoryItems={inventoryItems}
            showSourcePicker={showSourcePicker} onChange={next => updateLine(l.key, next)}
            onRemove={() => removeLine(l.key)} removable={lines.length > 1} />
        ))}
        <Button size="sm" variant="outline" className="w-fit" onClick={addLine}>
          <PlusIcon data-icon="inline-start" />Add another item
        </Button>
        <Button disabled={busy} onClick={submit} className="w-fit">
          {busy ? 'Raising…' : 'Raise PR'}
        </Button>
      </CardContent>
      {pickingTemplate && (
        <PrTemplatePicker onClose={() => setPickingTemplate(false)}
          onPick={items => setLines(ls => mergeTemplateItemsIntoLines(ls, items))} />
      )}
    </Card>
  );
}

// Release BOM = a deliberate, whole-project action ("everything's ready together"), not something
// inferred from the first item landing on the BOM — a project's BOM usually gets built up
// piecemeal over days (app/api/projects/[id]/release-bom's own comment explains why). This tab is
// just that button plus enough status to know whether it's already been pressed.
// The full, manageable BOM table (search/edit/delete — same BomTable every other department
// panel uses) plus Release/PDF/Un-release, top right, so reviewing what a template or PR added and
// acting on the release are the same screen instead of a summary-only tab pointing elsewhere.
// Exported for the same reason RaisePrTab is above — Engineering's own sidebar renders this
// directly.
export function ReleaseBomTab({ projects, departments = [] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState(null); // { bomCount, released, templatesApplied, milestoneId } | null
  const [bom, setBom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [unreleasing, setUnreleasing] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const editableFields = departments.flatMap(d => BOM_FIELD_OWNERS[d] || []);

  function loadStatus() {
    return api(`/api/projects/${projectId}/release-bom`).then(setStatus);
  }
  function loadBom() {
    return api(`/api/projects/${projectId}/bom?all=1`).then(res => setBom(res.items));
  }
  useEffect(() => {
    if (!projectId) { setStatus(null); setBom(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([loadStatus(), loadBom()])
      .catch(err => !cancelled && showToast(err.message, 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function release() {
    setReleasing(true);
    try {
      await api(`/api/projects/${projectId}/release-bom`, { method: 'POST' });
      showToast('BOM released');
      await Promise.all([loadStatus(), loadBom()]);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setReleasing(false); }
  }

  // Reuses the existing generic milestone reopen (POST /api/milestones/[id]/reopen, already how
  // any closed milestone gets sent back for rework — components/TicketsPanel.jsx's "Send back"
  // action). Nothing new to build: release_bom is a milestone like any other, so the same one-way-
  // undo mechanism already applies. Revision counters are never rolled back (same "counters only
  // move forward" precedent as project_no/po_no/pr_no) — releasing again after this gets a fresh,
  // higher revision number, the old one stays in the audit trail via bom_items.released_at_revision.
  async function unrelease() {
    const reason = window.prompt('Why is this BOM being un-released? (sent to Design/Engineering)');
    if (!reason || !reason.trim()) return;
    setUnreleasing(true);
    try {
      await api(`/api/milestones/${status.milestoneId}/reopen`, { method: 'POST', body: { reason: reason.trim() } });
      showToast('BOM un-released — back to Not started');
      await loadStatus();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setUnreleasing(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Release BOM</CardTitle>
        {status && (
          <CardAction className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setApplyingTemplate(true)}>
              <LayoutTemplateIcon data-icon="inline-start" />Apply template
            </Button>
            <a href={`/api/projects/${projectId}/bom/pdf`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <DownloadIcon className="size-4" />PDF
            </a>
            {status.released ? (
              <>
                <span className="flex items-center gap-1 text-sm text-success"><CheckIcon className="size-4" />Released</span>
                <Button size="sm" variant="outline" disabled={unreleasing} onClick={unrelease}>
                  <UndoIcon className="size-4" />{unreleasing ? 'Un-releasing…' : 'Un-release'}
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={releasing || !status.bomCount} onClick={release}>
                {releasing ? 'Releasing…' : 'Release BOM'}
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {!projectId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Pick a project to review, manage, and release its BOM.</p>
        ) : loading || !status || !bom ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 rounded-md border p-3">
              <span className="text-sm">
                {status.bomCount} BOM item{status.bomCount === 1 ? '' : 's'} · {status.drawingLinked} drawing{status.drawingLinked === 1 ? '' : 's'} linked
                {status.bomCount - status.drawingLinked > 0 && ` · ${status.bomCount - status.drawingLinked} not linked`}
              </span>
              {!status.released && <span className="text-xs text-muted-foreground">Releasing now makes this revision {status.nextRevision} — Production's baseline.</span>}
              {status.templatesApplied?.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  <LayoutTemplateIcon className="size-3.5" />Templates on this BOM:
                  {status.templatesApplied.map(t => (
                    <Badge key={t.name} variant="outline" className="font-normal">{t.name} · {t.n}</Badge>
                  ))}
                </div>
              )}
            </div>
            {/* Search/edit/delete before releasing — same BomTable every department panel already
                uses, so a line added by a template, a PR, or typed by hand looks and behaves
                identically here; "via <template>" (BomTable's own inline label) is how a
                template-sourced line stays distinguishable in the same list, not a separate view. */}
            <BomTable projectId={Number(projectId)} bom={bom} editableFields={editableFields} department="Engineering" onSaved={loadBom} />
          </>
        )}
      </CardContent>
      {applyingTemplate && (
        <ApplyBomTemplateDialog projectId={Number(projectId)} router={router}
          onClose={() => setApplyingTemplate(false)} onApplied={() => Promise.all([loadStatus(), loadBom()])} />
      )}
    </Card>
  );
}

// Phase 1 nav reorg (SYSTEM.md): emptyTemplateItem/TemplateItemsEditor/TemplateFormDialog/
// ApplyTemplateDialog/TemplateSection/TemplatesTab moved to ./BomTemplateManager.jsx, which now
// renders the "PR Templates"/"BOM Templates" sections from both Engineering and Requests (see
// PrWorkspace below and EngineeringWorkspace.jsx). Nothing here changed behavior, only location.

export default function PrWorkspace({ departments, projects, inventoryItems = [], initialTab }) {
  // Purchase Requests is the default landing tab (a deliberate UX change from the old default,
  // "Templates" — see SYSTEM.md's Phase 1 plan for why). Release BOM was briefly dropped from this
  // sidebar on the theory that the BOM workspace's own Release button (Engineering tab) made it
  // redundant here — reinstated after that read as "where did it go" rather than a cleaner nav, per
  // direct feedback. Both buttons fire the exact same POST route, so nothing was ever duplicated at
  // the data layer, only the entry point.
  const [tab, setTab] = useState(['raise', 'templates', 'release'].includes(initialTab) ? initialTab : 'raise');
  const [prTemplatePrefill, setPrTemplatePrefill] = useState(null);
  // Release BOM only shows for a viewer who can actually release (canRelease() in
  // app/api/projects/[id]/release-bom/route.js requires Design or Engineering) — a Stores-only head
  // used to see the tab, click it, and get stuck on a permanent "Loading…" screen once the status
  // check 403'd. Same conditional-visibility shape showBomTemplatesHere already uses below.
  const canReleaseBom = departments.some(d => ['Design', 'Engineering'].includes(d));
  const navItems = [
    { key: 'raise', label: 'Purchase Requests', icon: ClipboardListIcon },
    ...(canReleaseBom ? [{ key: 'release', label: 'Release BOM', icon: CheckIcon }] : []),
    { key: 'templates', label: 'PR Templates', icon: LayoutTemplateIcon },
  ];
  // Stores heads have Requests access but not Engineering access (where BOM Templates now
  // primarily lives) — the app's own help docs already describe Stores applying BOM templates, so
  // this keeps that working rather than silently dropping it. Design/Engineering heads use the
  // Engineering tab instead; this never renders for them.
  const showBomTemplatesHere = departments.includes('Stores') && !departments.some(d => ['Design', 'Engineering'].includes(d));

  function useInRaisePr(items) {
    setPrTemplatePrefill(items);
    setTab('raise');
  }

  return (
    <WorkspaceSidebar title="Requests" icon={ClipboardListIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'raise' && (
        <RaisePrTab departments={departments} projects={projects} inventoryItems={inventoryItems}
          prTemplatePrefill={prTemplatePrefill} onPrefillConsumed={() => setPrTemplatePrefill(null)} />
      )}
      {tab === 'release' && <ReleaseBomTab projects={projects} departments={departments} />}
      {tab === 'templates' && (
        <div className="flex flex-col gap-4">
          <BomTemplateManager kind="pr" title="PR Templates" projects={projects} onUseInRaisePr={useInRaisePr} />
          {showBomTemplatesHere && <BomTemplateManager kind="bom" title="BOM Templates" projects={projects} />}
        </div>
      )}
    </WorkspaceSidebar>
  );
}
