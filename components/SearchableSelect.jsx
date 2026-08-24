'use client';

// A type-to-filter dropdown for a local list of options — Category and Size pickers (PrWorkspace's
// CategoryFieldsBlock/LineCard, StoresWorkspace's ItemFormDialog/SpecField) went from a handful of
// items to lists as long as 25 (ISA angle sizes) or 23 (flat bar combos); a plain Select forces
// scrolling through all of them with no way to type "50" and jump straight to it. Same
// type-then-pick-from-a-list-below interaction this codebase already uses for the item catalog
// (ItemSearchField in this file, StoresWorkspace/SalesWorkspace's own copies) — reused here for a
// local `options` array instead of a server search, not a second interaction pattern to learn.
import { useState } from 'react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

export default function SearchableSelect({ value, onChange, options, placeholder = 'Search…', className }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function pick(opt) {
    onChange(opt.value);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        value={open ? query : (selected?.label || '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={selected?.label || placeholder}
      />
      {open && (
        <div className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-1.5 text-sm text-muted-foreground">No match</div>
          ) : filtered.map(o => (
            <button key={o.value} type="button" onMouseDown={() => pick(o)}
              className={cn(
                'flex w-full items-center px-2.5 py-1.5 text-left text-sm hover:bg-muted/40',
                o.value === value && 'bg-muted/60 font-medium'
              )}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
