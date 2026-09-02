'use client';

// components/bom-structure/BomStructureWorkspace.jsx — the BOM workspace (Phase 2): two-pane
// tree+detail replacing the old flat BomStructureTab. Owns all data fetching and mutation
// handlers; child components are presentational + local UI state only.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { LayersIcon } from 'lucide-react';
import BomTree from './BomTree';
import BomNodeDetail from './BomNodeDetail';
import MoveAssemblyDialog from './MoveAssemblyDialog';
import ReleaseReadinessPanel from './ReleaseReadinessPanel';
import { nodePath } from '@/lib/bom-tree.mjs';

export default function BomStructureWorkspace({ projects }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [assemblies, setAssemblies] = useState(null);
  const [projectBom, setProjectBom] = useState(null);
  const [releaseStatus, setReleaseStatus] = useState(null);
  const [pendingEcnBomItemIds, setPendingEcnBomItemIds] = useState(new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [movingNode, setMovingNode] = useState(null);
  const [releasing, setReleasing] = useState(false);

  function loadStructure(pid) {
    return api(`/api/bom-assemblies?project_id=${pid}`).then(setAssemblies).catch(err => showToast(err.message, 'error'));
  }
  function loadProjectBom(pid) {
    return api(`/api/projects/${pid}/bom?all=1`).then(res => setProjectBom(res.items)).catch(err => showToast(err.message, 'error'));
  }
  function loadReleaseStatus(pid) {
    return api(`/api/projects/${pid}/release-bom`).then(setReleaseStatus).catch(err => showToast(err.message, 'error'));
  }
  function loadPendingEcns(pid) {
    api(`/api/engineering-change-notes?project_id=${pid}`)
      .then(notes => setPendingEcnBomItemIds(new Set(notes.filter(n => n.status === 'pending' && n.bom_item_id).map(n => n.bom_item_id))))
      .catch(() => {});
  }

  useEffect(() => {
    if (!projectId) { setAssemblies(null); setProjectBom(null); setReleaseStatus(null); setSelectedId(null); return; }
    setSelectedId(null);
    loadStructure(projectId);
    loadProjectBom(projectId);
    loadReleaseStatus(projectId);
    loadPendingEcns(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function reloadStructure() { return loadStructure(projectId); }
  function reloadAll() {
    loadStructure(projectId);
    loadProjectBom(projectId);
    loadReleaseStatus(projectId);
    loadPendingEcns(projectId);
    router.refresh();
  }

  async function createTop(name, nodeType) {
    try {
      await api('/api/bom-assemblies', { method: 'POST', body: { project_id: Number(projectId), name, parent_id: null, node_type: nodeType } });
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function quickAddChild(parentId, name, nodeType) {
    try {
      await api('/api/bom-assemblies', { method: 'POST', body: { project_id: Number(projectId), name, parent_id: parentId, node_type: nodeType } });
      setExpandedIds(prev => new Set([...prev, parentId]));
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function renameNode(node, newName) {
    try {
      await api(`/api/bom-assemblies/${node.id}`, { method: 'PATCH', body: { name: newName } });
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function moveUpDown(node, dir) {
    try {
      await api(`/api/bom-assemblies/${node.id}`, { method: 'PATCH', body: { move: dir } });
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function moveTo(node, newParentId) {
    await api(`/api/bom-assemblies/${node.id}`, { method: 'PATCH', body: { parent_id: newParentId } });
    reloadStructure();
  }
  async function duplicateNode(node) {
    try {
      const res = await api(`/api/bom-assemblies/${node.id}/duplicate`, { method: 'POST' });
      showToast(`Duplicated — ${res.nodeCount} node(s), ${res.itemCount} item(s)`);
      await reloadStructure();
      setSelectedId(res.id);
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function deleteNode(node) {
    if (!window.confirm(`Delete "${node.name}"? Items under it become unassigned (not deleted). Sub-assemblies must be removed first.`)) return;
    try {
      await api(`/api/bom-assemblies/${node.id}`, { method: 'DELETE' });
      if (selectedId === node.id) setSelectedId(null);
      reloadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function saveQty(node, qty) {
    try {
      await api(`/api/bom-assemblies/${node.id}`, { method: 'PATCH', body: { qty } });
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function saveNodeType(node, nodeType) {
    try {
      await api(`/api/bom-assemblies/${node.id}`, { method: 'PATCH', body: { node_type: nodeType } });
      reloadStructure();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function release() {
    setReleasing(true);
    try {
      await api(`/api/projects/${projectId}/release-bom`, { method: 'POST' });
      showToast('BOM released');
      await loadReleaseStatus(projectId);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setReleasing(false); }
  }

  const byId = assemblies ? new Map(assemblies.map(a => [a.id, a])) : new Map();
  const unassignedItems = (projectBom || []).filter(r => !r.assembly_id);
  const selectedNode = selectedId != null && selectedId !== 'unassigned' ? byId.get(selectedId) : null;
  const assembliesFlat = (assemblies || []).map(a => ({ id: a.id, name: a.name, parent_id: a.parent_id }));

  const selectedProject = projects.find(p => String(p.id) === projectId);

  return (
    <Card className="min-h-[32rem]">
      <CardHeader>
        <CardTitle>BOMs</CardTitle>
        <CardDescription>
          {selectedProject ? (
            <span className="flex items-center gap-1.5">
              {selectedProject.project_no} · {selectedProject.customer_name}
              {selectedProject.series && <Badge variant="outline" className="text-[10px] font-normal">{selectedProject.series}</Badge>}
            </span>
          ) : (
            'Build assemblies, link drawings and calc sheets, and review release readiness.'
          )}
        </CardDescription>
        <CardAction>
          <Select value={projectId || undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pick a project" /></SelectTrigger>
            <SelectContent>
              {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      {!projectId ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground">Pick a project to view or build its BOM structure.</p>
      ) : !assemblies || !projectBom ? (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <Skeleton className="h-[4.5rem] w-full rounded-md" />
          <div className="grid min-h-[28rem] grid-cols-1 gap-0 overflow-hidden rounded-md border md:grid-cols-[24rem_1fr] lg:grid-cols-[28rem_1fr]">
            <div className="flex flex-col gap-2 border-r p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="mt-2 h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-1/2" />
            </div>
            <div className="flex items-center justify-center p-6">
              <span className="text-sm text-muted-foreground">Loading this project's BOM…</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <ReleaseReadinessPanel status={releaseStatus} onRelease={release} releasing={releasing} />
          <ResizablePanelGroup direction="horizontal" className="min-h-[28rem] overflow-hidden rounded-md border">
          <ResizablePanel defaultSize="30" minSize="18" maxSize="50">
            <BomTree
              assemblies={assemblies} unassignedItems={unassignedItems} selectedId={selectedId} onSelect={setSelectedId}
              expandedIds={expandedIds} onExpandedChange={setExpandedIds}
              onCreateTop={createTop} onQuickAddChild={quickAddChild} onRename={renameNode} onMoveUpDown={moveUpDown}
              onMoveTo={setMovingNode} onDuplicate={duplicateNode} onDelete={deleteNode}
              pendingEcnBomItemIds={pendingEcnBomItemIds}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="70" minSize="40">
            {selectedNode ? (
              <BomNodeDetail
                node={selectedNode} path={nodePath(selectedNode.id, byId)} projectId={Number(projectId)}
                projectBom={projectBom} assemblies={assembliesFlat} unassignedItems={unassignedItems}
                onSaveQty={saveQty} onSaveNodeType={saveNodeType} onRename={renameNode} onMoveTo={setMovingNode}
                onDuplicate={duplicateNode} onDelete={deleteNode} onSaved={reloadAll} onLinkChange={reloadAll}
              />
            ) : selectedId === 'unassigned' ? (
              <div className="flex h-full flex-col gap-1 overflow-y-auto p-4">
                <h2 className="text-lg font-semibold leading-tight">Unassigned items</h2>
                <p className="mb-2 text-xs text-muted-foreground">Not yet assigned to any node in the structure — still fully usable BOM lines.</p>
                <div className="flex flex-col divide-y rounded-md border">
                  {unassignedItems.map(it => (
                    <div key={it.id} className="px-3 py-2 text-sm transition-colors hover:bg-muted/40">
                      <span className="text-muted-foreground">BM-{it.id} · </span>{it.material_description}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <LayersIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Select a node in the tree to view or edit it.</p>
              </div>
            )}
          </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {movingNode && (
        <MoveAssemblyDialog
          node={movingNode} assemblies={assemblies}
          onClose={() => setMovingNode(null)}
          onMove={newParentId => moveTo(movingNode, newParentId)}
        />
      )}
    </Card>
  );
}
