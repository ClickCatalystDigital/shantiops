'use client';

// Item Master number (IM-…) and inventory number (INV-…) for BOM lines, shown on the Stores and
// Dispatch tables the way the Inventory tab shows them. One lookup per screen (POST
// /api/bom-items/codes), cached by id so re-renders and filters don't refetch.
import { useEffect, useState } from 'react';

const cache = {}; // bom_item id -> { item, inv } | null (looked up, has none)

export function useItemCodes(ids) {
  const [, bump] = useState(0);
  const key = [...new Set((ids || []).filter(Boolean).map(Number))].sort((a, b) => a - b).join(',');
  useEffect(() => {
    const missing = key ? key.split(',').map(Number).filter(id => !(id in cache)) : [];
    if (!missing.length) return;
    let live = true;
    fetch('/api/bom-items/codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: missing }) })
      .then(r => (r.ok ? r.json() : {}))
      .then(map => { for (const id of missing) cache[id] = map[id] || null; if (live) bump(n => n + 1); })
      .catch(() => {});
    return () => { live = false; };
  }, [key]);
  return cache;
}

// For search boxes: does this line's item / inventory number contain the (lowercased) needle?
export function codeHit(codes, id, needle) {
  const c = codes[id];
  return !!c && `${c.item || ''} ${c.inv || ''}`.toLowerCase().includes(needle);
}

export function ItemCodes({ codes, id, className = '' }) {
  const c = codes[id];
  if (!c) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground ${className}`}>
      {c.item && <span className="rounded bg-muted px-1.5 py-0.5" title="Item Master number">{c.item}</span>}
      {c.inv && <span className="rounded bg-muted px-1.5 py-0.5" title="Inventory number">{c.inv}</span>}
    </span>
  );
}
