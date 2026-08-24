'use client';

// Number + unit, instead of a single free-text "4 Nos" box the user has to type correctly every
// time. qty_text stays exactly the same "<number> <unit>" string everywhere downstream (bom_items/
// pr_item_projects, lib/procurement.js's splitQtyText, BomTable's Qty column, PDFs, ...) — this only
// decomposes/recomposes it at entry, same "keep the canonical storage shape, improve just the entry
// UI" idiom DimensionInput already uses for mm/m.
import { useState } from 'react';
import { Input } from './ui/input';
import SearchableSelect from './SearchableSelect';
import { cn } from '@/lib/utils';

const UOM_OPTIONS = ['Nos', 'Kgs', 'Mtrs', 'Set', 'Ltrs'];
const OTHER_UOM = '__other_uom__';

function parse(value) {
  const m = String(value || '').match(/^\s*([\d.]*)\s*(.*)$/);
  return { qty: m ? m[1] : '', unit: m ? m[2].trim() : '' };
}

export default function QtyInput({ value, onChange, className }) {
  const { qty, unit } = parse(value);
  // Local, not derived from `unit` itself — so picking "Other" can reveal the custom box without
  // ever writing a sentinel token into the real qty_text (no stray-sentinel cleanup needed anywhere
  // downstream, unlike the size pickers' OTHER_SIZE approach).
  const [customOpen, setCustomOpen] = useState(false);
  const isPreset = UOM_OPTIONS.includes(unit);
  const showCustom = customOpen || (!!unit && !isPreset);

  function set(nextQty, nextUnit) {
    onChange(nextUnit ? `${nextQty} ${nextUnit}`.trim() : (nextQty || '').trim());
  }

  return (
    <div className={cn('flex gap-1.5', className)}>
      <Input type="number" min="0" step="any" className="w-24 shrink-0" placeholder="Qty"
        value={qty} onChange={e => set(e.target.value, unit)} />
      <SearchableSelect className="w-28 shrink-0" placeholder="Unit" value={showCustom ? '' : unit}
        options={[...UOM_OPTIONS.map(u => ({ value: u, label: u })), { value: OTHER_UOM, label: 'Other…' }]}
        onChange={v => {
          if (v === OTHER_UOM) { setCustomOpen(true); return; }
          setCustomOpen(false);
          set(qty, v);
        }} />
      {showCustom && (
        <Input className="w-24 shrink-0" placeholder="Unit" value={unit} onChange={e => set(qty, e.target.value)} />
      )}
    </div>
  );
}
