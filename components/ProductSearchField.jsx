'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';

// Product Master (Phase 0b) — free-typed-with-suggestions against the already-fetched
// sales_products list (small master, no pagination, same local-filter idiom as distinctOptions'
// District/State fields elsewhere in this file — a live API search isn't warranted at this table's
// size). Picking a real row wires product_id for real linkage; free typing still works for a
// product that isn't in the master yet.
// The suggestion list is drawn on <body> at the input's screen position (fixed), so a scrolling
// dialog/sheet around the field never clips it. z-[60] sits above dialog/sheet overlays and
// pointer-events-auto survives the modal's body lock (same two Radix gotchas FloatingPdfPanel notes).
export default function ProductSearchField({ products, value, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const ref = useRef(null);
  const q = (value || '').trim().toLowerCase();
  const results = q.length < 1 ? [] : products.filter(p =>
    p.product_name.toLowerCase().includes(q) || (p.product_code || '').toLowerCase().includes(q) || (p.product_type || '').toLowerCase().includes(q)
  ).slice(0, 8);
  const show = open && results.length > 0;

  useEffect(() => {
    if (!show) return;
    const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setBox({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 280) }); };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [show]);

  return (
    <div className="relative" ref={ref}>
      <Input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search products, or type…" />
      {show && box && createPortal(
        <div className="pointer-events-auto fixed z-[60] max-h-72 overflow-y-auto rounded-md border bg-popover shadow-md"
          style={{ left: box.left, top: box.top, width: box.width }}>
          {results.map(p => (
            <button key={p.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => { onPick(p); setOpen(false); }}>
              <span className="font-medium">{p.product_name}</span>
              <span className="text-xs text-muted-foreground">{[p.product_code, p.product_type].filter(Boolean).join(' · ') || '—'}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
