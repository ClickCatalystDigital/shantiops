'use client';

// Extracted from PrWorkspace.jsx so components/StoresWorkspace.jsx's "New Item" form can capture
// dimensions/MOC the exact same way a BOM/PR line does, instead of a narrower parallel
// implementation. Generic props (category/fields/onChange) — no PR-specific coupling.
import { Input } from './ui/input';
import { Label } from './ui/label';
import DimensionInput from './DimensionInput';
import SearchableSelect from './SearchableSelect';
import {
  GEOMETRY_SHAPES, ROLLED_CATEGORIES, OTHER_SIZE, STANDARD_SECTIONS, DEFAULT_DENSITY, STANDARD_MOC,
  categoryWeightKg,
} from '@/lib/section-shapes';

function round2(n) { return Math.round(n * 100) / 100; }

// Same "pick from a curated list, free text as the escape hatch" treatment as Size — MOC is the
// literal text lib/remnant-match.js's matching compares, so "MS" vs "Mild Steel" typed two ways is
// a real, silent cause of missed matches, same class of problem the size lists already fixed.
export const OTHER_MOC = '__other_moc__';
export const MOC_OPTIONS = [...STANDARD_MOC.map(m => ({ value: m, label: m })), { value: OTHER_MOC, label: 'Other / custom' }];

// The category's own fields — dimensions (geometry shapes), a size pick + kg/m (rolled sections),
// size + kg/m (tee, no preset table), or item ref + qty (standard) — plus, for anything with real
// weight, a live computed label right under the grid so the number is visible while filling the
// form instead of only after saving.
export default function CategoryFieldsBlock({ category, fields, onChange }) {
  const set = patch => onChange({ ...fields, ...patch });

  if (category === 'standard') {
    return (
      <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-2.5">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Item master reference</Label>
          <Input value={fields.item_master_ref || ''} onChange={e => set({ item_master_ref: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Qty<span className="text-danger"> *</span></Label>
          <Input type="number" min="0" step="any" required value={fields.qty || ''} onChange={e => set({ qty: e.target.value })} />
        </div>
      </div>
    );
  }

  const weightKg = categoryWeightKg(category, fields);
  const weightLabel = weightKg > 0 ? `${round2(weightKg)} kg` : '—';

  if (category === 'plate' || GEOMETRY_SHAPES[category]) {
    const dims = category === 'plate'
      ? [{ key: 'length', label: 'Length' }, { key: 'width', label: 'Width' }, { key: 'thickness', label: 'Thickness' }]
      : GEOMETRY_SHAPES[category].dims;
    const presets = GEOMETRY_SHAPES[category]?.sizePresets;
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-2.5">
        {presets && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Quick pick a stocked size</Label>
            <SearchableSelect className="w-48" value="" placeholder="Type to search a size…"
              onChange={label => set(presets.find(p => p.label === label)?.values || {})}
              options={presets.map(p => ({ value: p.label, label: p.label }))} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {dims.map(d => (
            <div key={d.key} className="flex flex-col gap-1.5">
              <Label className="text-xs">{d.label}<span className="text-danger"> *</span></Label>
              <DimensionInput required valueMm={fields[d.key] || ''} onChangeMm={v => set({ [d.key]: v })} />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Density (kg/m³)</Label>
            <Input type="number" min="0" step="any" value={fields.density ?? ''}
              onChange={e => set({ density: e.target.value })} placeholder={String(DEFAULT_DENSITY)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Estimated weight: <span className="tnum font-medium text-foreground">{weightLabel}</span></p>
      </div>
    );
  }

  if (ROLLED_CATEGORIES.includes(category) || category === 'tee') {
    const presets = STANDARD_SECTIONS[category] || [];
    const isOther = fields.size === OTHER_SIZE || (!!fields.size && !presets.some(p => p.size === fields.size));
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-2.5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Size<span className="text-danger"> *</span></Label>
            {presets.length > 0 ? (
              <SearchableSelect value={isOther ? OTHER_SIZE : (fields.size || '')} placeholder="Type to search a size…"
                onChange={v => v === OTHER_SIZE
                  ? set({ size: OTHER_SIZE, kg_per_m: '' })
                  : set({ size: v, kg_per_m: String(presets.find(p => p.size === v)?.kg_per_m ?? '') })}
                options={[...presets.map(p => ({ value: p.size, label: p.size })), { value: OTHER_SIZE, label: 'Other / custom size' }]} />
            ) : (
              <Input required value={fields.size === OTHER_SIZE ? '' : fields.size || ''} onChange={e => set({ size: e.target.value })} placeholder="e.g. Tee 50x50x6" />
            )}
          </div>
          {presets.length > 0 && isOther && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Custom size</Label>
              <Input required value={fields.size === OTHER_SIZE ? '' : fields.size || ''} onChange={e => set({ size: e.target.value })} placeholder="e.g. ISMB 150" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Weight per metre (kg/m){(isOther || presets.length === 0) && <span className="text-danger"> *</span>}</Label>
            <Input type="number" min="0" step="any" required={isOther || presets.length === 0}
              value={fields.kg_per_m || ''} onChange={e => set({ kg_per_m: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Length<span className="text-danger"> *</span></Label>
            <DimensionInput required valueMm={fields.length || ''} onChangeMm={v => set({ length: v })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Estimated weight: <span className="tnum font-medium text-foreground">{weightLabel}</span></p>
      </div>
    );
  }

  return null;
}
