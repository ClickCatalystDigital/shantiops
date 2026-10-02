'use client';

// Pick several projects with a search box. Nothing picked = every project (so "no filter" and
// "select all" show the same rows). `options`: [{ id, label, sub? }]. `value`: Set of ids.
import { useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { FilterIcon, SearchIcon } from 'lucide-react';

export default function ProjectMultiFilter({ options, value, onChange, className }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => `${o.label} ${o.sub || ''}`.toLowerCase().includes(needle)) : options;
  const allShownPicked = shown.length > 0 && shown.every(o => value.has(o.id));

  function toggle(id) {
    const next = new Set(value);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  }
  function toggleShown() {
    const next = new Set(value);
    shown.forEach(o => (allShownPicked ? next.delete(o.id) : next.add(o.id)));
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <FilterIcon className="size-3.5" />
          {value.size === 0 ? 'All projects' : `${value.size} project${value.size === 1 ? '' : 's'}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[92vw] p-0">
        <div className="relative border-b p-2">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search project or customer…" className="h-8 pl-8 text-sm" />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-xs">
          <button type="button" onClick={toggleShown} className="font-medium text-primary hover:underline">
            {allShownPicked ? 'Unselect shown' : `Select all shown (${shown.length})`}
          </button>
          {value.size > 0 && <button type="button" onClick={() => onChange(new Set())} className="text-muted-foreground hover:underline">Clear</button>}
        </div>
        <div className="max-h-72 overflow-y-auto border-t p-1">
          {shown.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">No project matches.</p>}
          {shown.map(o => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
              <Checkbox checked={value.has(o.id)} onCheckedChange={() => toggle(o.id)} />
              <span className="min-w-0 flex-1 truncate">{o.label}{o.sub && <span className="text-muted-foreground"> · {o.sub}</span>}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
