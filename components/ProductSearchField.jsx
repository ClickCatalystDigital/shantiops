'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';

// Product Master (Phase 0b) — free-typed-with-suggestions against the already-fetched
// sales_products list (small master, no pagination, same local-filter idiom as distinctOptions'
// District/State fields elsewhere in this file — a live API search isn't warranted at this table's
// size). Picking a real row wires product_id for real linkage; free typing still works for a
// product that isn't in the master yet.
export default function ProductSearchField({ products, value, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const q = (value || '').trim().toLowerCase();
  const results = q.length < 1 ? [] : products.filter(p =>
    p.product_name.toLowerCase().includes(q) || (p.product_code || '').toLowerCase().includes(q) || (p.product_type || '').toLowerCase().includes(q)
  ).slice(0, 8);

  return (
    <div className="relative">
      <Input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search products, or type…" />
      {open && results.length > 0 && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.map(p => (
            <button key={p.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => { onPick(p); setOpen(false); }}>
              <span className="font-medium">{p.product_name}</span>
              <span className="text-xs text-muted-foreground">{[p.product_code, p.product_type].filter(Boolean).join(' · ') || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
