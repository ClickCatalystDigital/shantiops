// components/RelatedItemsCard.jsx
'use client';

// Renders an entity's structural relations (lib/entity-refs.js's RELATIONS table) — the "which BOM
// item is this NCR about, which Work Order, which Job Card" that used to be either a raw unlinked
// number or not shown at all. Fetches once per (type, id) and degrades to nothing (not an empty
// error card) when there's nothing to show — same convention LinkifiedText already uses for an
// unresolved token.
import { useEffect, useState } from 'react';
import EntityRefLink from './EntityRefLink';
import { api } from '@/lib/client';

export default function RelatedItemsCard({ type, id, className }) {
  const [groups, setGroups] = useState(null); // null = loading, [] = nothing to show

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    if (!type || !id) { setGroups([]); return; }
    api(`/api/entity-refs/related?type=${type}&id=${id}`)
      .then(d => { if (!cancelled) setGroups(d.groups || []); })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, [type, id]);

  if (!groups || groups.length === 0) return null;

  return (
    <div className={className || 'flex flex-col gap-2 border-t pt-3'}>
      <p className="text-xs font-medium text-muted-foreground">Related</p>
      <div className="flex flex-col gap-1.5">
        {groups.map(g => (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{g.label}:</span>
            {g.items.map(item => (
              <EntityRefLink key={`${item.type}-${item.id}`} entityRef={item} className="font-medium text-primary hover:underline" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
