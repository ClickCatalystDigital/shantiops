'use client';

// One numeric input + an mm/m unit toggle, used everywhere a length/width/thickness/diameter is
// entered (the PR/BOM composer, Production's Cut dialog, Stores' Add piece dialog). The canonical
// value always stays in mm — every consumer (DB columns, pieceWeight, parseDims) works in mm — only
// the displayed/typed unit changes, so this is presentation-only, no payload shape changes anywhere.
import { useState } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';

const UNIT_TO_MM = { mm: 1, m: 1000 };

export default function DimensionInput({ valueMm, onChangeMm, placeholder, className, required, autoFocus }) {
  const [unit, setUnit] = useState('mm');
  const shown = valueMm === '' || valueMm == null ? '' : String(Number(valueMm) / UNIT_TO_MM[unit]);

  function handleChange(v) {
    onChangeMm(v === '' ? '' : String(Number(v) * UNIT_TO_MM[unit]));
  }

  return (
    <div className={cn('flex gap-1.5', className)}>
      <Input type="number" min="0" step="any" required={required} autoFocus={autoFocus}
        placeholder={placeholder} value={shown} onChange={e => handleChange(e.target.value)} />
      <Select value={unit} onValueChange={setUnit}>
        <SelectTrigger className="w-[4.5rem] shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="mm">mm</SelectItem>
          <SelectItem value="m">m</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
