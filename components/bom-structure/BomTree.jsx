'use client';

// components/bom-structure/BomTree.jsx — left pane of the BOM workspace (Phase 2): search box,
// filter chips, the "Unassigned" bucket, and the recursive node tree itself.
import { useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SearchableSelect from '@/components/SearchableSelect';
import BomTreeNode from './BomTreeNode';
import { groupByParent, expandedIdsForSearch, suggestNodeType } from '@/lib/bom-tree.mjs';
import { PlusIcon, SearchIcon } from 'lucide-react';

const FILTERS = [
  { key: 'missingDrawing', label: 'Missing drawing' },
  { key: 'pendingEcn', label: 'Pending ECN' },
];

export default function BomTree({
  assemblies, unassignedItems, selectedId, onSelect, expandedIds, onExpandedChange,
  onCreateTop, onQuickAddChild, onRename, onMoveUpDown, onMoveTo, onDuplicate, onDelete,
  pendingEcnBomItemIds, hideAddTop,
}) {
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [addingTop, setAddingTop] = useState(false);
  const [topDraft, setTopDraft] = useState('');

  const byId = useMemo(() => new Map(assemblies.map(a => [a.id, a])), [assemblies]);
  const childrenByParent = useMemo(() => groupByParent(assemblies), [assemblies]);
  const roots = childrenByParent.get(null) || [];
  // Real search on node-name creation: suggest names already used elsewhere in this project's own
  // tree (so "Feedwater Subsystem" doesn't drift into "Feed Water System" a level over), while still
  // taking any free-typed name — same hybrid pattern as the item-field SmartTextField.
  const nameOptions = useMemo(
    () => [...new Set(assemblies.map(a => a.name))].sort().map(n => ({ value: n, label: n })),
    [assemblies]
  );

  function toggleExpand(id) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onExpandedChange(next);
  }
  function toggleFilter(key) {
    const next = new Set(activeFilters);
    if (next.has(key)) next.delete(key); else next.add(key);
    setActiveFilters(next);
  }

  // Nodes matching an active filter, plus every one of their ancestors so the tree can reveal
  // where a match lives — same "search reveals location, never a flat unrelated list" principle
  // the search box below uses. OR across filters: a node matching any active filter stays visible.
  const filterMatchIds = useMemo(() => {
    if (activeFilters.size === 0) return null;
    const matches = new Set();
    for (const a of assemblies) {
      const isMatch =
        (activeFilters.has('missingDrawing') && !a.drawing_count) ||
        (activeFilters.has('pendingEcn') && (a.items || []).some(it => pendingEcnBomItemIds?.has(it.id)));
      if (isMatch) {
        let cur = a;
        while (cur) { matches.add(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : null; }
      }
    }
    return matches;
  }, [activeFilters, assemblies, byId, pendingEcnBomItemIds]);

  const searchExpandIds = useMemo(() => expandedIdsForSearch(query, assemblies, byId), [query, assemblies, byId]);
  const effectiveExpanded = useMemo(() => {
    if (searchExpandIds.size === 0) return expandedIds;
    return new Set([...expandedIds, ...searchExpandIds]);
  }, [expandedIds, searchExpandIds]);

  const visibleRoots = filterMatchIds ? roots.filter(r => filterMatchIds.has(r.id)) : roots;

  // Real names already used in this project's own tree are a fine local starting point, but a
  // brand-new tree has none — the actual meaningful source for "what would a node here be called"
  // is the same Item Master catalog the rest of the app already searches (BomLineFields.jsx's
  // ItemSearchField). Picking a match here just seeds the node's name; nothing links back to the
  // catalog item itself — a tree node is a structural grouping, not a bom_items row.
  async function searchCatalog(q) {
    const rows = await api(`/api/items?search=${encodeURIComponent(q)}`);
    return rows.map(it => ({
      value: it.item_name,
      label: [it.item_code, it.item_name, it.category && `(${it.category})`].filter(Boolean).join(' · ').replace(' · (', ' ('),
    }));
  }

  function submitTop() {
    const trimmed = topDraft.trim();
    if (trimmed) onCreateTop(trimmed, suggestNodeType(trimmed, 0));
    setTopDraft('');
    setAddingTop(false);
  }

  return (
    <div className="flex h-full flex-col gap-2 border-r p-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-8 pl-7 text-sm" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => toggleFilter(f.key)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${activeFilters.has(f.key) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleRoots.map((root, i) => (
          <BomTreeNode
            key={root.id} node={root} depth={0} childrenByParent={childrenByParent}
            expandedIds={effectiveExpanded} onToggleExpand={toggleExpand} selectedId={selectedId} onSelect={onSelect}
            onQuickAddChild={onQuickAddChild} onRename={onRename} onMoveUpDown={onMoveUpDown} onMoveTo={onMoveTo}
            onDuplicate={onDuplicate} onDelete={onDelete}
            isFirstSibling={i === 0} isLastSibling={i === visibleRoots.length - 1}
            nameOptions={nameOptions} searchCatalog={searchCatalog}
          />
        ))}

        {hideAddTop ? null : addingTop ? (
          <div className="mt-1 flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2">
            <SearchableSelect
              autoFocus
              value={topDraft} onChange={setTopDraft} displayValue={topDraft} onTextChange={setTopDraft}
              options={nameOptions} asyncOptions={searchCatalog}
              placeholder="New top-level node name — type, or search the item catalog…"
              inputClassName="h-9"
              onKeyDown={e => { if (e.key === 'Enter') submitTop(); if (e.key === 'Escape') { setTopDraft(''); setAddingTop(false); } }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {topDraft.trim() && <>Will be classified as <Badge variant="outline" className="text-[10px] font-normal">{suggestNodeType(topDraft, 0)}</Badge></>}
              </span>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setTopDraft(''); setAddingTop(false); }}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs" disabled={!topDraft.trim()} onClick={submitTop}>Add</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="mt-1 h-7 w-fit text-xs text-muted-foreground" onClick={() => setAddingTop(true)}>
            <PlusIcon className="size-3" />Add top-level node
          </Button>
        )}

        {!filterMatchIds && unassignedItems.length > 0 && (
          <button
            type="button"
            onClick={() => onSelect('unassigned')}
            className={`mt-2 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-muted/50 ${selectedId === 'unassigned' ? 'bg-muted' : ''}`}
          >
            Unassigned ({unassignedItems.length})
          </button>
        )}
      </div>
    </div>
  );
}
