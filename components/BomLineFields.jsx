'use client';

// Phase 1 nav refactor (SYSTEM.md Engineering/Requests reorg) — extracted out of PrWorkspace.jsx
// verbatim. These were already shared module-scope functions between Raise PR's LineCard and the
// Templates editor in that one file; this just makes that sharing importable so BomTemplateManager
// (used from both Engineering and Requests) doesn't need a second implementation.
import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { TrashIcon, PlusIcon } from 'lucide-react';
import { api } from '@/lib/client';
import { DIMENSIONAL_CATEGORIES } from '@/lib/bom-fields.mjs';
import { CATEGORY_LABEL, GEOMETRY_SHAPES, ROLLED_CATEGORIES, OTHER_SIZE, DEFAULT_DENSITY, geometrySizeLabel } from '@/lib/section-shapes';

// Density only matters for the shapes weight is computed from geometry for (plate + everything in
// GEOMETRY_SHAPES) — rolled sections/tee already carry their own kg/m (picked or typed), no density
// involved. Seeded at 7850 (mild steel) the moment one of those categories is picked, editable from
// there — this is the client's own plate formula (L x W x T x "specified weight") made real: a
// different material is a different number here, not a different formula.
export function defaultCategoryFields(category) {
  return category === 'plate' || GEOMETRY_SHAPES[category] ? { density: String(DEFAULT_DENSITY) } : {};
}

// Traceability requirement defaults (Inventory Identity & Traceability, Phase 1). Category can
// never be the enforcement mechanism (a plate can be pressure-critical on one project and
// structural filler on another) — this is only ever a starting suggestion Engineering can override
// per line, before the field even reaches bom_items. A catalog pick's own default_requires_* wins
// when the item has any set; the category fallback below only applies to free-text lines (no
// item_id), since a catalog row with all-zero defaults legitimately means "this material has none."
export function defaultTraceabilityFromItem(item) {
  const any = item.default_requires_heat_no || item.default_requires_mtc || item.default_requires_supplier_batch || item.default_requires_serial_no;
  if (!any) return null;
  return {
    requires_heat_no: !!item.default_requires_heat_no, requires_mtc: !!item.default_requires_mtc,
    requires_supplier_batch: !!item.default_requires_supplier_batch, requires_serial_no: !!item.default_requires_serial_no,
  };
}
export function defaultTraceabilityFromCategory(category) {
  return DIMENSIONAL_CATEGORIES.includes(category)
    ? { requires_heat_no: true, requires_mtc: true, requires_supplier_batch: false, requires_serial_no: false }
    : { requires_heat_no: false, requires_mtc: false, requires_supplier_batch: false, requires_serial_no: false };
}
export const TRACEABILITY_FLAG_LABELS = {
  requires_heat_no: 'Heat No.', requires_mtc: 'MTC', requires_supplier_batch: 'Supplier batch', requires_serial_no: 'Serial No.',
};

// Ten categories is one too many to scan by eye every time — SearchableSelect (type to filter)
// everywhere this list is picked from, not just a plain Select.
export const CATEGORY_OPTIONS = [
  { value: '', label: 'Uncategorized' },
  ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
];

// Item Master's `group_name` (e.g. "MS PLATES", "SQUARE RODS", "FLANGES") suggests a category on
// pick — confident keyword matches only, same "don't invent, only match" precedent as
// lib/calc-import.mjs/applyTemplate. No default-to-'standard' guess: most groups (CABLE, TOOLS,
// ASSET, ...) aren't a physical-material shape at all, so guessing wrong there is worse than
// leaving it for the user to pick.
export function guessCategory(groupName) {
  const g = (groupName || '').toUpperCase();
  if (g.includes('PLATE') || g.includes('SHEET')) return 'plate';
  if (/\bFLAT\b|\bHOOP\b/.test(g)) return 'flat';
  if (/\bROUND\b|\bROD\b/.test(g)) return 'round';
  if (/\bSQUARE\b/.test(g)) return 'square';
  if (/OCTAGON/.test(g)) return 'octagonal';
  if (g.includes('ANGLE')) return 'angle';
  if (/CHANNEL/.test(g)) return 'channel';
  if (/BEAM|JOIST/.test(g)) return 'beam';
  if (/\bTEE\b/.test(g)) return 'tee';
  return '';
}

// category_fields as typed/picked -> what actually gets stored. Geometry categories get their
// `size` (what lib/remnant-match.js's parseDims compares against Stores' stock) generated from the
// dimensions, not typed — see lib/section-shapes.js's geometrySizeLabel, the same generator
// Stores' own item form uses. Rolled/tee categories get a defensive strip of the OTHER_SIZE
// sentinel — RaisePrTab's submit() blocks on it via validateCategoryFields before this ever runs,
// but NewTemplateDialog.save() has no such gate, so "picked Other, left it blank" would otherwise
// persist the literal sentinel token into a template's category_fields_json.
export function finalizeCategoryFields(category, fields) {
  if (GEOMETRY_SHAPES[category]) return { ...fields, size: geometrySizeLabel(category, fields) };
  if ((ROLLED_CATEGORIES.includes(category) || category === 'tee') && fields.size === OTHER_SIZE) {
    return { ...fields, size: '' };
  }
  return fields;
}

// A line's own dimensions describe what was *bought* — this is optionally how it's meant to be
// *cut*: one purchased plate can become several separately-named fabricated parts (e.g. a real
// Form IV A sample lists SHELL BELT-I/IIA/IIB, three named shell segments sharing one purchased
// plate). Stored on the BOM/template line (bom_items.named_parts_json), so it's defined once —
// especially on a template item, where it then carries into every project built from that boiler
// model — rather than left to whoever fills the statutory form by hand each time. Purely optional;
// collapsed by default so a line that doesn't need this stays exactly as simple as it is today.
// Downstream: lib/qc-bom-sync.js syncs one qc_document_parts row per named part here instead of one
// generic row per BOM line, then reconciles each against whichever stock_pieces row Production tags
// with that same name at Cut time (components/WorkersPanel.jsx's CutDialog).
export function NamedPartsEditor({ parts, onChange }) {
  const [open, setOpen] = useState(parts.length > 0);
  function update(idx, patch) { onChange(parts.map((p, i) => i === idx ? { ...p, ...patch } : p)); }
  function add() { onChange([...parts, { name: '', qty: 1 }]); setOpen(true); }
  function remove(idx) { onChange(parts.filter((_, i) => i !== idx)); }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" className="w-fit text-muted-foreground" onClick={add}>
        <PlusIcon data-icon="inline-start" />Named parts (optional — for QC statutory forms)
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed p-2.5">
      <Label className="text-xs">Named parts (optional — for QC statutory forms)</Label>
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="flex-1" placeholder="e.g. SHELL BELT-I" value={p.name} onChange={e => update(i, { name: e.target.value })} />
          <Input type="number" min="1" step="1" className="w-20 shrink-0" placeholder="Qty" value={p.qty ?? ''} onChange={e => update(i, { qty: e.target.value })} />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => remove(i)}><TrashIcon className="size-4" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={add}><PlusIcon data-icon="inline-start" />Add part</Button>
    </div>
  );
}

// Search-as-you-type over the Item Master catalog (GET /api/items) — picking a match autofills the
// description/spec fields; typing straight through without picking anything is just free text, the
// lean fallback the client asked for.
export function ItemSearchField({ line, onChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  async function onType(v) {
    // §3.2 — hand-editing after a pick invalidates the catalog link; the description no longer
    // provably matches the row item_id pointed at, so the tie is dropped rather than left stale.
    onChange({ material_description: v, item_id: null });
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setResults(rows);
      setOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }

  function pick(item) {
    const category = guessCategory(item.group_name);
    onChange({
      material_description: item.item_name, size_spec: item.detail_desc || '', uomHint: item.uom || '',
      item_id: item.id,
      ...(category && { category, categoryFields: defaultCategoryFields(category) }),
      // Traceability requirements: the item master's own recommendation wins when it has one set;
      // otherwise fall back to the category default (or all-off, for a non-dimensional/uncategorized
      // pick) — always seeded fresh on pick, same as category itself, editable from there.
      ...(defaultTraceabilityFromItem(item) || defaultTraceabilityFromCategory(category)),
    });
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label>Item description {line.uomHint && <span className="font-normal text-muted-foreground">(UoM: {line.uomHint})</span>}</Label>
      <Input value={line.material_description} onChange={e => onType(e.target.value)}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search the item catalog, or just type a description" />
      {line.item_id && <p className="text-xs text-success">✓ Linked to catalog — real matching against Inventory now possible for this line.</p>}
      {open && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.map(it => (
            <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">{it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
