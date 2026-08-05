'use client';

// Extracted from ProcurementWorkspace.jsx (V2-CHANGES.md Phase 5.1) so the public supplier portal
// (RfqPortalForm.jsx) can reuse it without importing the whole authenticated workspace bundle —
// no behavior change from the original inline version.
import { useState } from 'react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const PAYMENT_TERM_PRESETS = ['LC', 'Advance %', 'After Delivery', 'PDC', 'COD'];
const ADVANCE_PCTS = Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}%`);

export default function PaymentTermsField({ value, advancePct, onChange, onAdvancePctChange }) {
  const [custom, setCustom] = useState(!PAYMENT_TERM_PRESETS.includes(value) && !!value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Payment terms</Label>
      {custom ? (
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Custom terms" autoFocus />
      ) : (
        <Select value={value} onValueChange={v => onChange(v)}>
          <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{PAYMENT_TERM_PRESETS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {value === 'Advance %' && !custom && (
        <Select value={advancePct} onValueChange={onAdvancePctChange}>
          <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="Which %?" /></SelectTrigger>
          <SelectContent>{ADVANCE_PCTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <button type="button" className="w-fit text-xs text-primary hover:underline"
        onClick={() => { setCustom(c => !c); onChange(''); }}>
        {custom ? 'Pick from list' : '+ Add new option'}
      </button>
    </div>
  );
}
