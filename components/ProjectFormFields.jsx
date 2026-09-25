'use client';

// Shared by NewProjectForm and EditProjectDialog — the project identity + model-spec fields, kept
// in one place so both stay in sync. `saleOrders` (optional, New-only) renders a Sale Order picker
// next to Company — Edit never passes it, since linking a Sale Order after creation (PATCH already
// supports it) doesn't replay the Scope-of-Supply auto-population POST /api/projects does at
// creation time, so showing the picker there would imply behavior Edit doesn't actually have.
import CustomerPicker from '@/components/CustomerPicker';
import SaleOrderPicker from '@/components/SaleOrderPicker';
import { api } from '@/lib/client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/SearchableSelect';
import { QC_SERIES } from '@/lib/qc-series';
import { modelConfig } from '@/lib/qc-models';
import { formatMoney } from '@/lib/format';

// Kept as presets, not a rigid enum — model_design is free text on the wire (DB column has no
// CHECK), same "pick from a list or type your own" escape hatch this codebase already uses for
// MOC/drawing-type fields.
const MODEL_DESIGN_PRESETS = ['WB', 'SWB', 'DB'];

function ModelDesignField({ value, onChange }) {
  const [custom, setCustom] = useState(!!value && !MODEL_DESIGN_PRESETS.includes(value));
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Model Design</Label>
      {custom ? (
        <Input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="Custom" />
      ) : (
        <Select modal={false} value={value || undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{MODEL_DESIGN_PRESETS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <button type="button" className="w-fit text-xs text-primary hover:underline"
        onClick={() => { setCustom(c => !c); onChange(''); }}>
        {custom ? 'Pick from list' : '+ Custom'}
      </button>
    </div>
  );
}

// Customers are searched through the API (CustomerPicker); the `customers` prop is no longer needed.
export default function ProjectFormFields({ f, setF, customers = [], saleOrderPicker = null }) {
  // BOILER- prefix only makes sense for models the folder generator itself treats as a boiler
  // (lib/qc-models.js) — PRS/HEADERS are a different equipment noun, so no preview is shown for
  // them yet rather than showing a misleading literal "BOILER-" label.
  const cfg = f.series ? modelConfig(f.series) : null;
  const preview = cfg?.noun === 'Boiler'
    ? `BOILER-${f.series}-${f.model_design || '—'}-${f.model_capacity || '—'}-${f.model_pressure || '—'}`
    : null;
  const showSaleOrder = !!saleOrderPicker;
  const [soNote, setSoNote] = useState('');
  // Picking an order fills what Sales already recorded: customer (with its id), company, order
  // date, and a description from the order's product lines. Typed values are only replaced when
  // blank (description/date), so picking an order never wipes something the user wrote.
  async function pickOrder(id, row) {
    if (!id) { setF(prev => ({ ...prev, sale_order_id: '', sale_order_label: '' })); setSoNote(''); return; }
    const label = row ? [row.so_no, row.customer_name].filter(Boolean).join(' · ') : f.sale_order_label;
    setF(prev => ({ ...prev, sale_order_id: id, sale_order_label: label }));
    try {
      const so = await api(`/api/sale-orders/${id}`);
      const lines = so.items?.length ? so.items : (so.prefill_items || []);
      const desc = lines.map(l => [l.qty ? `${l.qty}${l.uom ? ' ' + l.uom : ''} ×` : null, l.item_description].filter(Boolean).join(' ')).filter(Boolean).join('; ');
      setF(prev => ({
        ...prev,
        customer_name: so.customer_name || prev.customer_name,
        customer_id: so.customer_id ? String(so.customer_id) : prev.customer_id,
        company: so.company || prev.company,
        order_date: prev.order_date || so.order_date || '',
        description: prev.description || desc.slice(0, 500),
      }));
      const onOther = row?.linked_project && row.linked_project !== f.project_no ? `Already on ${row.linked_project}. ` : '';
      setSoNote(onOther + (saleOrderPicker !== 'new' ? '' : so.items?.length ? `${so.items.length} order line(s) will be copied into the Scope of Supply.`
        : 'This order has no line items yet — the Scope of Supply starts empty.'));
    } catch (e) { setSoNote(''); }
  }

  return (
    <>
      <div className={showSaleOrder ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-1.5'}>
        {showSaleOrder && (
          <div className="flex flex-col gap-1.5">
            <Label>Sale Order</Label>
            <SaleOrderPicker value={f.sale_order_id} label={f.sale_order_label || ''} onChange={pickOrder} />
            {soNote && <p className="text-xs text-muted-foreground">{soNote}</p>}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>Company</Label>
          <Select modal={false} value={f.company} onValueChange={c => setF({ ...f, company: c })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Shanti Boilers">Shanti Boilers</SelectItem>
              <SelectItem value="Shanti Techno Fab">Shanti Techno Fab</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Model Category</Label>
          <Select modal={false} value={f.series || undefined} onValueChange={s => setF({ ...f, series: s })}>
            <SelectTrigger><SelectValue placeholder="Equipment model" /></SelectTrigger>
            <SelectContent>{QC_SERIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <ModelDesignField value={f.model_design} onChange={v => setF({ ...f, model_design: v })} />
      </div>

      {preview && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">{preview}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Model Capacity</Label>
          <Input type="number" step="any" value={f.model_capacity}
            onChange={e => setF({ ...f, model_capacity: e.target.value })} placeholder="350" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Model Pressure</Label>
          <Input type="number" step="any" value={f.model_pressure}
            onChange={e => setF({ ...f, model_pressure: e.target.value })} placeholder="10.54" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Order Date</Label>
          <Input type="date" value={f.order_date} onChange={e => setF({ ...f, order_date: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Project No <span className="text-muted-foreground">(blank = auto)</span></Label>
          <Input value={f.project_no} onChange={e => setF({ ...f, project_no: e.target.value })}
            placeholder="STF-IBR-045-CF-400-15" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Customer *</Label>
        <CustomerPicker value={f.customer_id} name={f.customer_name}
          onChange={(id, n) => setF({ ...f, customer_id: id, customer_name: n || f.customer_name })}
          onTextChange={text => setF({ ...f, customer_name: text, customer_id: '' })}
          placeholder="Search or type a customer name" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })}
          placeholder="3 TPH Solid Fuel Boiler" />
      </div>
    </>
  );
}
