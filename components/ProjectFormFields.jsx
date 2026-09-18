'use client';

// Shared by NewProjectForm and EditProjectDialog — the project identity + model-spec fields, kept
// in one place so both stay in sync (four model-spec fields + the live preview label, 2026-09-18).
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/SearchableSelect';
import { QC_SERIES } from '@/lib/qc-series';
import { modelConfig } from '@/lib/qc-models';

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

export default function ProjectFormFields({ f, setF, customers = [] }) {
  // BOILER- prefix only makes sense for models the folder generator itself treats as a boiler
  // (lib/qc-models.js) — PRS/HEADERS are a different equipment noun, so no preview is shown for
  // them yet rather than showing a misleading literal "BOILER-" label.
  const cfg = f.series ? modelConfig(f.series) : null;
  const preview = cfg?.noun === 'Boiler'
    ? `BOILER-${f.series}-${f.model_design || '—'}-${f.model_capacity || '—'}-${f.model_pressure || '—'}`
    : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Model Category</Label>
          <Select modal={false} value={f.series || undefined} onValueChange={s => setF({ ...f, series: s })}>
            <SelectTrigger><SelectValue placeholder="Equipment model" /></SelectTrigger>
            <SelectContent>{QC_SERIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Order Date</Label>
          <Input type="date" value={f.order_date} onChange={e => setF({ ...f, order_date: e.target.value })} />
        </div>
      </div>

      {preview && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">{preview}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <ModelDesignField value={f.model_design} onChange={v => setF({ ...f, model_design: v })} />
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

      <div className="flex flex-col gap-1.5">
        <Label>Project No <span className="text-muted-foreground">(blank = auto)</span></Label>
        <Input value={f.project_no} onChange={e => setF({ ...f, project_no: e.target.value })}
          placeholder="STF-IBR-045-CF-400-15" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Customer *</Label>
        {customers.length > 0 && (
          <SearchableSelect
            value={f.customer_id}
            onChange={id => {
              const c = customers.find(x => String(x.id) === id);
              setF({ ...f, customer_id: id, customer_name: c?.name || f.customer_name });
            }}
            options={customers.map(c => ({ value: String(c.id), label: c.name }))}
            placeholder="Pick an existing customer (optional)"
          />
        )}
        <Input required value={f.customer_name}
          onChange={e => setF({ ...f, customer_name: e.target.value, customer_id: '' })}
          placeholder="Or type a customer name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })}
          placeholder="3 TPH Solid Fuel Boiler" />
      </div>
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
    </>
  );
}
