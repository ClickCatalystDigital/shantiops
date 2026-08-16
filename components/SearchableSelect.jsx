'use client';

// Controlled searchable single-select over an in-memory list — a Popover trigger showing the current
// selection, a filter input, and a scrollable list. Modeled on CalcWorkspace's InlineSwitcher but
// controlled (visible value) and fed items directly. Used for the QC workspace's Series and Project
// pickers and CertForm's project add.
import { useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronsUpDownIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SearchableSelect({
  value, items = [], onChange,
  getKey = i => i.id, getLabel = i => i.label, getSub = () => null,
  placeholder = 'Search…', triggerPlaceholder = 'Select…',
  allOption = null,            // e.g. { label: 'All projects' } — selecting it calls onChange(null)
  className, disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = value != null ? items.find(i => String(getKey(i)) === String(value)) : null;
  const t = q.trim().toLowerCase();
  const filtered = items.filter(i => !t || getLabel(i).toLowerCase().includes(t) || (getSub(i) || '').toLowerCase().includes(t));

  function pick(key) { onChange(key); setOpen(false); setQ(''); }

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn('justify-between font-normal', className)}>
          <span className={cn('truncate', !selected && !allOption?.selectedLabel && 'text-muted-foreground')}>
            {selected ? getLabel(selected) : (value == null && allOption ? allOption.label : triggerPlaceholder)}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0">
        <div className="p-1">
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="h-8" />
        </div>
        <div className="max-h-64 overflow-auto p-1 pt-0">
          {allOption && !t && (
            <Row active={value == null} label={allOption.label} onClick={() => pick(null)} />
          )}
          {filtered.map(i => (
            <Row key={getKey(i)} active={String(getKey(i)) === String(value)}
              label={getLabel(i)} sub={getSub(i)} onClick={() => pick(getKey(i))} />
          ))}
          {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ active, label, sub, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60">
      <CheckIcon className={cn('mt-0.5 size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}
