'use client';

// components/bom-structure/BomNodeDetail.jsx — right pane: breadcrumb, node actions, and the
// Overview/Items/Drawings/Calculations/History tabs.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ChevronRightIcon, FolderInputIcon, CopyIcon, TrashIcon, BookmarkPlusIcon,
  LayoutGridIcon, PackageIcon, FileTextIcon, HistoryIcon,
} from 'lucide-react';
import NodeOverviewTab from './NodeOverviewTab';
import NodeItemsTab from './NodeItemsTab';
import NodeDrawingsTab from './NodeDrawingsTab';
import NodeHistoryTab from './NodeHistoryTab';
import SaveAsTemplateDialog from './SaveAsTemplateDialog';

export default function BomNodeDetail({
  node, path, projectId, projectBom, assemblies, unassignedItems, byId,
  onSaveQty, onSaveNodeType, onRename, onMoveTo, onDuplicate, onDelete, onSaved, onLinkChange,
  onApplyTemplate, onSaveAsTemplate,
}) {
  const [tab, setTab] = useState('overview');
  const TAB_DEFS = [
    { key: 'overview', label: 'Overview', icon: LayoutGridIcon },
    { key: 'items', label: 'Items', icon: PackageIcon, count: node.items?.length },
    { key: 'drawings', label: 'Drawings', icon: FileTextIcon, count: node.drawing_count },
    { key: 'history', label: 'History', icon: HistoryIcon },
  ];
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);
  const [saving, setSaving] = useState(false);
  // ponytail: a ref, not state — Enter fires commitRename, then the Input unmounting (renaming
  // flips false) synchronously fires a native blur on the still-focused element, calling
  // commitRename a second time with a stale closure. State can't guard against that reliably
  // (the blur handler may be bound from a render before the guard flips); a ref mutates
  // synchronously and is shared across every closure, so it can't race.
  const committingRef = useRef(false);

  function startRename() { setNameDraft(node.name); setRenaming(true); }
  async function commitRename() {
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

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {path.slice(0, -1).map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {p}<ChevronRightIcon className="size-3" />
              </span>
            ))}
          </div>
          {renaming ? (
            <Input
              autoFocus disabled={saving} className="h-7 max-w-xs text-lg font-semibold"
              value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            />
          ) : (
            <h2 className="cursor-text text-lg font-semibold leading-tight" title="Double-click to rename" onDoubleClick={startRename}>
              {node.name}
            </h2>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {TAB_DEFS.map(t => (
            <Tooltip key={t.key}><TooltipTrigger asChild>
              <Button
                size="icon-sm" variant={tab === t.key ? 'secondary' : 'ghost'}
                onClick={() => setTab(t.key)} aria-label={t.label} className="relative"
              >
                <t.icon />
                {t.count > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">{t.count > 9 ? '9+' : t.count}</span>}
              </Button>
            </TooltipTrigger><TooltipContent>{t.label}{t.count > 0 ? ` (${t.count})` : ''}</TooltipContent></Tooltip>
          ))}
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => onMoveTo(node)} aria-label="Move to…"><FolderInputIcon /></Button>
          </TooltipTrigger><TooltipContent>Move to…</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => onDuplicate(node)} aria-label="Duplicate"><CopyIcon /></Button>
          </TooltipTrigger><TooltipContent>Duplicate</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => setSavingAsTemplate(true)} aria-label="Save as template"><BookmarkPlusIcon /></Button>
          </TooltipTrigger><TooltipContent>Save as template</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => onDelete(node)} aria-label="Delete"><TrashIcon /></Button>
          </TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="overview" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <NodeOverviewTab node={node} byId={byId}
            onSaveQty={q => onSaveQty(node, q)} onSaveNodeType={t => onSaveNodeType(node, t)}
            onApplyTemplate={templateIds => onApplyTemplate(node, templateIds)} />
        </TabsContent>
        <TabsContent value="items" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <NodeItemsTab projectId={projectId} node={node} path={path} projectBom={projectBom} assemblies={assemblies}
            unassignedItems={unassignedItems} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="drawings" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <NodeDrawingsTab projectId={projectId} node={node} onLinkChange={onLinkChange} />
        </TabsContent>
        <TabsContent value="history" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <NodeHistoryTab node={node} />
        </TabsContent>
      </Tabs>

      {savingAsTemplate && (
        <SaveAsTemplateDialog
          node={node} byId={byId}
          onClose={() => setSavingAsTemplate(false)}
          onSave={payload => onSaveAsTemplate(node, payload)}
        />
      )}
    </div>
  );
}
