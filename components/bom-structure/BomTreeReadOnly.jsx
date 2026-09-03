'use client';

// components/bom-structure/BomTreeReadOnly.jsx — a read-only, full-depth outline of a project's
// complete BOM hierarchy (every System/Subsystem/Assembly/Sub-assembly/Item down to the real
// bom_items leaves), shown as its own Card below the editable BomStructureWorkspace tree above it.
// Pure presentation over data the parent already fetched (assemblies/unassignedItems) — no fetch,
// no mutation, so it automatically reflects whatever the editor above last saved/reloaded.
import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronRightIcon, ChevronDownIcon, PackageIcon, ListTreeIcon, ScaleIcon, AlertTriangleIcon, SearchIcon, DownloadIcon, HistoryIcon,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { api, showToast } from '@/lib/client';
import { groupByParent, expandedIdsForSearch, itemMatchAncestorIds, matchingItemIds, matchingNodeNameIds } from '@/lib/bom-tree.mjs';
import { hasAmbiguousQty } from '@/lib/bom-structure.mjs';
import { TreeRail } from './BomTreeNode';

// A node's own items default OPEN (no click needed to see what's inside the component you're
// already looking at) — the real wall-of-text risk is the aggregate Unassigned bucket, which stays
// its own separate, positive-default toggle. This threshold is the one safety valve: a node with an
// unusually large number of its own directly-attached items (a flat structure someone never broke
// into sub-nodes) starts collapsed instead, same as before.
const ITEM_AUTO_COLLAPSE_THRESHOLD = 15;

function ItemRow({ item, node, ancestorLines, isLast, highlighted, isFirstMatch }) {
  const showRolled = item.rolled_qty != null && node.rollup_qty !== 1;
  const ambiguous = hasAmbiguousQty(item.qty_text);
  // Real pr_no (round 3 Phase B) wins over the legacy free-text pr_ref — same "structured value
  // preferred, free text as a pre-unified-PR-flow fallback" precedent as BomTable's own PR column.
  const prLabel = item.pr_no || item.pr_ref;
  return (
    <div
      data-bom-search-hit={isFirstMatch || undefined}
      className={`flex items-center gap-0 py-1 pl-1 pr-2 text-sm text-muted-foreground ${highlighted ? 'rounded bg-warning/15' : ''}`}
    >
      {ancestorLines.map((hasLine, i) => <TreeRail key={i} vertical={hasLine} />)}
      <TreeRail vertical elbow half={isLast} />
      <PackageIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="ml-1.5 min-w-0 flex-1 truncate">
        <span className="mr-1 text-[11px] tnum text-muted-foreground/70">
          BM-{item.id}
          {item.catalog_item_code && <> · {item.catalog_item_code}</>}
          {prLabel && <> · {prLabel}</>}
        </span>
        {item.material_description}
      </span>
      <span className="flex shrink-0 items-center gap-1 tnum">
        {ambiguous && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangleIcon className="size-3 shrink-0 text-warning" />
            </TooltipTrigger>
            <TooltipContent>Multiple values in this quantity — only the first number is used in the roll-up total.</TooltipContent>
          </Tooltip>
        )}
        {item.qty_text}
        {showRolled && <span className="text-muted-foreground/70"> → {item.rolled_qty} total</span>}
      </span>
    </div>
  );
}

function AssemblyRow({ node, depth, childrenByParent, collapsedIds, toggleCollapsed, itemsHiddenIds, toggleItems, ancestorLines, isLastSibling, matchedItemIds, firstMatchId, nodeNameMatchIds }) {
  const children = childrenByParent.get(node.id) || [];
  const items = node.items || [];
  const childrenShown = !collapsedIds.has(node.id) && children.length > 0;
  const itemsShown = !itemsHiddenIds.has(node.id) && items.length > 0;
  const hasToggle = children.length > 0 || items.length > 0;
  const nameMatched = nodeNameMatchIds?.has(node.id);

  // Items render before sub-assemblies — "what this node itself contains" first, "what's nested
  // deeper" after. A single combined slot list is what lets the rail lines below this row know
  // whether they're the true last thing rendered, regardless of which kind comes last.
  const slots = [
    ...(itemsShown ? items.map(it => ({ kind: 'item', it })) : []),
    ...(childrenShown ? children.map(c => ({ kind: 'node', c })) : []),
  ];

  const showQty = node.qty !== 1;
  const showRollup = node.rollup_qty !== node.qty;

  return (
    <div>
      <div
        data-bom-search-hit={firstMatchId === node.id || undefined}
        className={`group flex items-center gap-0 rounded-md py-1.5 pr-1 pl-1 text-sm ${nameMatched ? 'bg-warning/15' : ''}`}
      >
        {ancestorLines.map((hasLine, i) => <TreeRail key={i} vertical={hasLine} />)}
        {depth > 0 && <TreeRail vertical elbow half={isLastSibling} />}
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => toggleCollapsed(node.id)}
          aria-label={childrenShown ? 'Collapse' : 'Expand'}
          disabled={!children.length}
        >
          {children.length > 0 && (childrenShown ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />)}
        </button>
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{node.node_type || 'Assembly'}</Badge>
        {showQty && <span className="shrink-0 tnum text-xs text-muted-foreground">×{node.qty}</span>}
        {showRollup && <span className="shrink-0 text-xs text-muted-foreground/70">(×{node.rollup_qty} total)</span>}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => toggleItems(node.id)}
            className={`flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] ${itemsShown ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {itemsShown ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
            {items.length} item{items.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {node.weight_items_known > 0 && (
        <div
          className="flex items-center gap-1 pb-1 text-[11px] text-muted-foreground/80"
          style={{ paddingLeft: `${(ancestorLines.length + (depth > 0 ? 1 : 0)) * 1.25 + 1.25}rem` }}
        >
          <ScaleIcon className="size-3 shrink-0" />
          {node.weight_kg.toFixed(1)} kg cut so far ({node.weight_items_known} of {node.weight_items_total} items have recorded weight)
        </div>
      )}

      {slots.map((slot, i) => {
        const isLast = i === slots.length - 1;
        const childAncestorLines = [...ancestorLines, depth > 0 ? !isLastSibling : false];
        return slot.kind === 'item' ? (
          <ItemRow
            key={`item-${slot.it.id}`} item={slot.it} node={node} ancestorLines={childAncestorLines} isLast={isLast}
            highlighted={matchedItemIds?.has(slot.it.id)} isFirstMatch={firstMatchId === slot.it.id}
          />
        ) : (
          <AssemblyRow
            key={slot.c.id} node={slot.c} depth={depth + 1} childrenByParent={childrenByParent}
            collapsedIds={collapsedIds} toggleCollapsed={toggleCollapsed} itemsHiddenIds={itemsHiddenIds} toggleItems={toggleItems}
            ancestorLines={childAncestorLines} isLastSibling={isLast}
            matchedItemIds={matchedItemIds} firstMatchId={firstMatchId} nodeNameMatchIds={nodeNameMatchIds}
          />
        );
      })}
    </div>
  );
}

export default function BomTreeReadOnly({ assemblies, unassignedItems, project, pastReleases = [] }) {
  const [collapsedIds, setCollapsedIds] = useState(new Set());
  // Inverted default: a node's items render unless its id is in this set. Lazy initializer seeds
  // the one safety-valve exception (a node with an unusually large item count starts hidden) —
  // computed once from the assemblies this component mounts with. Relies on BomStructureWorkspace
  // keying this component by project id, so switching projects remounts it fresh rather than
  // carrying over a stale seed computed from a different project's tree.
  const [itemsHiddenIds, setItemsHiddenIds] = useState(() => new Set(
    assemblies.filter(a => (a.items?.length || 0) > ITEM_AUTO_COLLAPSE_THRESHOLD).map(a => a.id)
  ));
  // Collapsed by default, same as every node's own items — a project can easily have hundreds of
  // items still sitting unassigned while the tree is being built, and this card is meant to read as
  // a clean outline, not a dump of everything not yet organized.
  const [unassignedShown, setUnassignedShown] = useState(false);
  const [query, setQuery] = useState('');
  // §7 — '' means Live (the assemblies/unassignedItems props, always current). A past revision is
  // fetched on demand, not preloaded with every one of this project's releases — most opens of this
  // card never touch history. Picking "Live" again just clears frozenData, no re-fetch needed.
  const [viewingRevision, setViewingRevision] = useState('');
  const [frozenData, setFrozenData] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  useEffect(() => {
    if (!viewingRevision) { setFrozenData(null); return; }
    let cancelled = false;
    setLoadingSnapshot(true);
    api(`/api/projects/${project.id}/bom-releases/${viewingRevision}`)
      .then(res => { if (!cancelled) setFrozenData(res); })
      .catch(err => { if (!cancelled) { showToast(err.message, 'error'); setViewingRevision(''); } })
      .finally(() => !cancelled && setLoadingSnapshot(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingRevision]);

  // Everything below renders off these two, live or frozen — the render path itself has no idea
  // which one it's looking at, same "one rendering mode, a different data source" the plan called for.
  const displayAssemblies = frozenData ? frozenData.assemblies : assemblies;
  const displayUnassignedItems = frozenData ? frozenData.unassignedItems : unassignedItems;

  const childrenByParent = groupByParent(displayAssemblies);
  const roots = childrenByParent.get(null) || [];
  const byId = new Map(displayAssemblies.map(a => [a.id, a]));

  // Search reveals location, never hides non-matches — same principle the editable tree's own
  // search already uses. A hit forces its whole ancestor chain open (regardless of manual
  // collapse), and forces just the matching node's own items open (regardless of manual hide) —
  // computed as an override on top of the real collapsedIds/itemsHiddenIds state, not a second
  // source of truth, so clearing the query always returns to exactly what the user had set.
  //
  // Reveal-only search with no highlight or scroll reads as "did nothing" once most of the tree is
  // already expanded by default (this card's own default, unlike the editable tree's) — matched rows
  // get a highlight, and the first match gets a scrollIntoView (see the effect below), plus an
  // explicit "no matches" state when a real query finds nothing anywhere.
  const nameExpandIds = expandedIdsForSearch(query, displayAssemblies, byId);
  const nodeNameMatchIds = matchingNodeNameIds(query, displayAssemblies);
  const { expandIds: itemExpandIds, matchingNodeIds, matchedItemIds } = itemMatchAncestorIds(query, displayAssemblies, byId);
  const unassignedMatchIds = matchingItemIds(query, displayUnassignedItems);
  const searchExpandIds = query.trim() ? new Set([...nameExpandIds, ...itemExpandIds]) : new Set();
  const effectiveCollapsedIds = searchExpandIds.size === 0
    ? collapsedIds
    : new Set([...collapsedIds].filter(id => !searchExpandIds.has(id)));
  const effectiveItemsHiddenIds = matchingNodeIds.size === 0
    ? itemsHiddenIds
    : new Set([...itemsHiddenIds].filter(id => !matchingNodeIds.has(id)));
  const unassignedMatches = unassignedMatchIds.size > 0;
  const effectiveUnassignedShown = unassignedShown || unassignedMatches;
  // Scroll priority: an item match (the thing most likely being searched for in a large BOM) wins
  // over a node-name match, which wins over an unassigned-item match — arbitrary once more than one
  // kind exists in the same search, but keeps the target deterministic.
  const firstMatchId = matchedItemIds.size > 0 ? [...matchedItemIds][0]
    : nodeNameMatchIds.size > 0 ? [...nodeNameMatchIds][0]
    : (unassignedMatchIds.size > 0 ? [...unassignedMatchIds][0] : null);
  const hasQuery = query.trim().length > 0;
  const noMatchesFound = hasQuery && matchedItemIds.size === 0 && !unassignedMatches && nodeNameMatchIds.size === 0;

  // Scroll the first matched item into view — the reveal itself is silent otherwise (deliberately,
  // per the comment above), which on an already-mostly-expanded tree can look like nothing happened.
  useEffect(() => {
    if (!hasQuery) return;
    const el = document.querySelector('[data-bom-search-hit="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [query, hasQuery]);

  function toggleCollapsed(id) {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleItems(id) {
    setItemsHiddenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function expandAll() {
    setCollapsedIds(new Set());
    setItemsHiddenIds(new Set());
  }
  function collapseAll() {
    setCollapsedIds(new Set(displayAssemblies.map(a => a.id)));
    setItemsHiddenIds(new Set(displayAssemblies.filter(a => (a.items?.length || 0) > 0).map(a => a.id)));
  }

  // Still worth rendering (for the revision picker alone) if there's release history even when the
  // live tree is currently empty — an edge case (un-released and wiped clean), but the picker must
  // stay reachable whenever there's something in it to look at.
  if (assemblies.length === 0 && unassignedItems.length === 0 && pastReleases.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Final BOM</CardTitle>
        {project && (
          <CardDescription className="flex items-center gap-1.5">
            {project.project_no} · {project.customer_name}
            {project.series && <Badge variant="outline" className="text-[10px] font-normal">{project.series}</Badge>}
          </CardDescription>
        )}
        <CardAction className="flex items-center gap-2">
          {pastReleases.length > 0 && (
            <Select value={viewingRevision || 'live'} onValueChange={v => setViewingRevision(v === 'live' ? '' : v)}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live</SelectItem>
                {pastReleases.map(r => (
                  <SelectItem key={r.id} value={String(r.revision)}>
                    Rev {r.revision} · {new Date(r.created_at).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="outline" onClick={collapseAll}>Collapse all</Button>
          {project && (
            <a href={`/api/projects/${project.id}/bom-tree/pdf`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <DownloadIcon className="size-4" />PDF
            </a>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {viewingRevision && (
          <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            <HistoryIcon className="size-3.5 shrink-0" />
            Viewing revision {viewingRevision} — frozen at release, not live.
          </div>
        )}
        {loadingSnapshot ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading revision {viewingRevision}…</p>
        ) : (
        <>
        {(roots.length > 0 || displayUnassignedItems.length > 0) && (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-7 text-sm" placeholder="Search a node or item…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
        {roots.length === 0 && displayUnassignedItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ListTreeIcon className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No structure built yet.</p>
          </div>
        ) : noMatchesFound ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <SearchIcon className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No matches for "{query.trim()}".</p>
          </div>
        ) : (
          roots.map((root, i) => (
            <AssemblyRow
              key={root.id} node={root} depth={0} childrenByParent={childrenByParent}
              collapsedIds={effectiveCollapsedIds} toggleCollapsed={toggleCollapsed} itemsHiddenIds={effectiveItemsHiddenIds} toggleItems={toggleItems}
              ancestorLines={[]} isLastSibling={i === roots.length - 1}
              matchedItemIds={matchedItemIds} firstMatchId={firstMatchId} nodeNameMatchIds={nodeNameMatchIds}
            />
          ))
        )}

        {displayUnassignedItems.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <button
              type="button"
              onClick={() => setUnassignedShown(v => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
            >
              {effectiveUnassignedShown ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
              Unassigned ({displayUnassignedItems.length}) — not yet placed under any node above
            </button>
            {effectiveUnassignedShown && (
              <div className="mt-1">
                {displayUnassignedItems.map(it => (
                  <div
                    key={it.id}
                    data-bom-search-hit={firstMatchId === it.id || undefined}
                    className={`flex items-center gap-1.5 py-1 pl-1 pr-2 text-sm text-muted-foreground ${unassignedMatchIds.has(it.id) ? 'rounded bg-warning/15' : ''}`}
                  >
                    <PackageIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="mr-1 text-[11px] tnum text-muted-foreground/70">
                        BM-{it.id}
                        {it.catalog_item_code && <> · {it.catalog_item_code}</>}
                        {(it.pr_no || it.pr_ref) && <> · {it.pr_no || it.pr_ref}</>}
                      </span>
                      {it.material_description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
}
