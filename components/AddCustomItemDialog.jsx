'use client';

// components/AddCustomItemDialog.jsx — Procurement's own "+ Add Item," for material that isn't
// linked to any PMB import or Purchase Requisition (the new "Custom Items" bucket in Enquiry/
// Selection). Modeled on the single-line composer already proven in PrWorkspace.jsx's LineCard —
// not BomTable.jsx's heavier multi-row AddItemForm (built for splitting one line across several
// size rows, disproportionate for a single ad hoc item here). Reuses the identical catalog-search/
// category/dimension pieces so picking a shape here behaves exactly like it does on /engineering.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import SearchableSelect from './SearchableSelect';
import QtyInput from './QtyInput';
import CategoryFieldsBlock, { OTHER_MOC, MOC_OPTIONS } from './CategoryFieldsBlock';
import {
  ItemSearchField, CATEGORY_OPTIONS, defaultCategoryFields, finalizeCategoryFields, validateCategoryFields,
} from './BomLineFields';
import { DIMENSIONAL_CATEGORIES } from '@/lib/bom-fields.mjs';
import { categoryDisplaySpec } from '@/lib/section-shapes';

export default function AddCustomItemDialog({ activeProjects = [], onClose, onCreated }) {
  const [line, setLine] = useState({
    material_description: '', moc: '', size_spec: '', category: '', categoryFields: {}, item_id: null,
  });
  const [qtyText, setQtyText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mocCustomOpen, setMocCustomOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function patchLine(patch) { setLine(l => ({ ...l, ...patch })); }
  const showSizeSpecInput = !(line.category && DIMENSIONAL_CATEGORIES.includes(line.category));

  async function submit() {
    if (!line.material_description.trim()) { showToast('A description is required', 'error'); return; }
    if (line.category) {
      const err = validateCategoryFields(line.category, line.categoryFields);
      if (err) { showToast(`${CATEGORY_OPTIONS.find(o => o.value === line.category)?.label || 'This category'} ${err}`, 'error'); return; }
    }
    setBusy(true);
    try {
      const finalizedFields = line.category ? finalizeCategoryFields(line.category, line.categoryFields) : null;
      const size_spec = line.category && DIMENSIONAL_CATEGORIES.includes(line.category)
        ? (categoryDisplaySpec(line.category, finalizedFields) || '')
        : line.size_spec;
      await api('/api/procurement/custom-items', {
        method: 'POST',
        body: {
          material_description: line.material_description.trim(),
          moc: line.moc || null,
          size_spec: size_spec || null,
          qty_text: qtyText || null,
          category: line.category || null,
          category_fields: finalizedFields,
          item_id: line.item_id || null,
          project_id: projectId ? Number(projectId) : null,
        },
      });
      showToast('Item added');
      onCreated();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Add a custom item</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <ItemSearchField line={line} onChange={patchLine} />

          <div className={`grid gap-3 ${showSizeSpecInput ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="flex flex-col gap-1.5">
              <Label>MOC (optional)</Label>
              <SearchableSelect value={mocCustomOpen ? '' : (line.moc || '')} placeholder="Type to search a material…"
                options={MOC_OPTIONS}
                onChange={v => {
                  if (v === OTHER_MOC) { setMocCustomOpen(true); return; }
                  setMocCustomOpen(false);
                  patchLine({ moc: v });
                }} />
              {mocCustomOpen && (
                <Input className="mt-1" value={line.moc} onChange={e => patchLine({ moc: e.target.value })}
                  placeholder="e.g. IS 2062 E250" autoFocus />
              )}
            </div>
            {showSizeSpecInput && (
              <div className="flex flex-col gap-1.5">
                <Label>Size / spec (optional)</Label>
                <Input value={line.size_spec} onChange={e => patchLine({ size_spec: e.target.value })} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Category (optional)</Label>
            <SearchableSelect className="w-56" value={line.category || ''} options={CATEGORY_OPTIONS}
              onChange={v => patchLine({
                category: v, categoryFields: defaultCategoryFields(v),
                ...(DIMENSIONAL_CATEGORIES.includes(v) ? { size_spec: '' } : {}),
              })} />
          </div>

          {line.category && (
            <CategoryFieldsBlock category={line.category} fields={line.categoryFields} mode="full"
              onChange={categoryFields => patchLine({ categoryFields })} />
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Quantity</Label>
            <QtyInput value={qtyText} onChange={setQtyText} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Project (optional)</Label>
            <SearchableSelect value={projectId} onChange={setProjectId}
              placeholder="No project — a general item"
              options={activeProjects.map(p => ({ value: String(p.id), label: `${p.project_no}${p.customer_name ? ` — ${p.customer_name}` : ''}` }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>Add Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
