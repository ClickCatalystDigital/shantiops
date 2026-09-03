'use client';

// components/bom-structure/BomTreeNode.jsx — one row in the BOM workspace tree (Phase 2). Renders
// itself, an inline quick-add-child affordance, and recurses into its children when expanded.
// Presentational + local-only UI state (inline rename/quick-add inputs); all real mutations go
// through callbacks owned by BomTree/BomStructureWorkspace, which own the actual API calls.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import SearchableSelect from '@/components/SearchableSelect';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronRightIcon, ChevronDownIcon, PlusIcon, MoreHorizontalIcon, PencilIcon, FolderInputIcon,
  CopyIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon,
} from 'lucide-react';
import { SOFT_DEPTH_WARNING, suggestNodeType } from '@/lib/bom-tree.mjs';

// One indent column, doubling as a tree connector guide — replaces plain paddingLeft indentation
// with real ├─/└─-style lines so a nested node's ancestry is visible at a glance, not just implied
// by whitespace. `vertical` draws the line at all (blank spacer otherwise); `half` stops it at
// mid-height (the "└" case — this is the last child, nothing continues below); `elbow` also draws
// the horizontal stub connecting the line over to this row's own content.
export function TreeRail({ vertical, half, elbow }) {
  return (
    <div className="relative w-5 shrink-0 self-stretch">
      {vertical && (
        <div className={`absolute left-1/2 w-px -translate-x-1/2 bg-border ${half ? 'top-0 h-1/2' : 'inset-y-0'}`} />
      )}
      {elbow && <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-border" />}
    </div>
  );
}

export default function BomTreeNode({
  node, depth, childrenByParent, expandedIds, onToggleExpand, selectedId, onSelect,
  onQuickAddChild, onRename, onMoveUpDown, onMoveTo, onDuplicate, onDelete,
  isFirstSibling, isLastSibling, ancestorLines = [], nameOptions = [], searchCatalog,
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);
  const [saving, setSaving] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState('');
  // ponytail: ref, not state — same Enter-then-blur double-fire this app's rename UI hits
  // everywhere (see BomNodeDetail.jsx); a ref can't race a stale-closure blur handler.
  const committingRef = useRef(false);

  const children = childrenByParent.get(node.id) || [];
  const expanded = expandedIds.has(node.id);
  const itemCount = node.items?.length || 0;
  const selected = selectedId === node.id;

  function startRename() { setNameDraft(node.name); setRenaming(true); }
  async function submitRename() {
    if (committingRef.current) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === node.name) { setRenaming(false); return; }
    committingRef.current = true;
    setSaving(true);
    try {
      await onRename(node, trimmed);
    } finally {
      committingRef.current = false;
      setSaving(false);
      setRenaming(false);
    }
  }
  function submitChild() {
    const trimmed = childDraft.trim();
    if (trimmed) onQuickAddChild(node.id, trimmed, suggestNodeType(trimmed, depth + 1));
    setChildDraft('');
    setAddingChild(false);
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-0 rounded-md py-1.5 pr-1 pl-1 text-sm transition-colors hover:bg-muted/50 ${selected ? 'bg-primary/10 ring-1 ring-inset ring-primary/20' : ''}`}
      >
        {ancestorLines.map((hasLine, i) => <TreeRail key={i} vertical={hasLine} />)}
        {depth > 0 && <TreeRail vertical elbow half={isLastSibling} />}
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => onToggleExpand(node.id)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {(children.length > 0 || itemCount > 0) && (expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />)}
        </button>

        {renaming ? (
          <Input
            autoFocus
            disabled={saving}
            className="h-6 flex-1 px-1.5 py-0 text-sm"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setNameDraft(node.name); setRenaming(false); } }}
          />
        ) : (
          <button
            type="button"
            className="flex flex-1 items-center gap-1.5 truncate text-left"
            onClick={() => onSelect(node.id)}
            onDoubleClick={startRename}
            title={node.name}
          >
            <span className="truncate">{node.name}</span>
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{node.node_type || 'Assembly'}</Badge>
            {depth >= SOFT_DEPTH_WARNING && (
              <span className="text-[10px] text-muted-foreground" title="This tree is getting quite deep">deep</span>
            )}
          </button>
        )}

        <span className="shrink-0 text-xs text-muted-foreground">
          {itemCount > 0 && `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          {node.drawing_count > 0 && ` · ${node.drawing_count} dwg`}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => onMoveUpDown(node, 'up')} disabled={isFirstSibling} aria-label="Move up">
            <ArrowUpIcon className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => onMoveUpDown(node, 'down')} disabled={isLastSibling} aria-label="Move down">
            <ArrowDownIcon className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => setAddingChild(true)} aria-label="Add child">
            <PlusIcon className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="size-6" aria-label="More actions">
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={startRename}><PencilIcon />Rename</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMoveTo(node)}><FolderInputIcon />Move to…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(node)}><CopyIcon />Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger" onClick={() => onDelete(node)}><TrashIcon />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {addingChild && (
        <div
          className="mt-1 flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2"
          style={{ marginLeft: `${(depth + 1) * 1.25 + 0.25}rem` }}
        >
          <SearchableSelect
            autoFocus
            value={childDraft} onChange={setChildDraft} displayValue={childDraft} onTextChange={setChildDraft}
            options={nameOptions} asyncOptions={searchCatalog}
            placeholder="New sub-assembly name — type, or search the item catalog…"
            inputClassName="h-9"
            onKeyDown={e => { if (e.key === 'Enter') submitChild(); if (e.key === 'Escape') { setChildDraft(''); setAddingChild(false); } }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {childDraft.trim() && <>Will be classified as <Badge variant="outline" className="text-[10px] font-normal">{suggestNodeType(childDraft, depth + 1)}</Badge></>}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setChildDraft(''); setAddingChild(false); }}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" disabled={!childDraft.trim()} onClick={submitChild}>Add</Button>
            </div>
          </div>
        </div>
      )}

      {expanded && children.map((child, i) => (
        <BomTreeNode
          key={child.id} node={child} depth={depth + 1} childrenByParent={childrenByParent}
          expandedIds={expandedIds} onToggleExpand={onToggleExpand} selectedId={selectedId} onSelect={onSelect}
          onQuickAddChild={onQuickAddChild} onRename={onRename} onMoveUpDown={onMoveUpDown} onMoveTo={onMoveTo}
          onDuplicate={onDuplicate} onDelete={onDelete}
          isFirstSibling={i === 0} isLastSibling={i === children.length - 1}
          ancestorLines={[...ancestorLines, !isLastSibling]} nameOptions={nameOptions} searchCatalog={searchCatalog}
        />
      ))}
    </div>
  );
}
