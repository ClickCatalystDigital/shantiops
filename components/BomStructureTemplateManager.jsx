'use client';

// components/BomStructureTemplateManager.jsx — the "Structure Templates" tab: manages
// hierarchy-level BOM templates (see BOM-related session notes / SYSTEM.md once folded in).
// Deliberately not folded into BomTemplateManager.jsx — that component's whole shape (a flat
// TemplateItemsEditor row list) doesn't fit a tree; this is a new, lightweight component instead,
// reusing the same visual language (Card, divided list rows, Badge) so it reads as the same family
// of screen. No "Apply" button lives here at all — applying only ever happens from where you're
// actually building a tree (a node's own Overview tab, or the tree pane's "Build from Templates"),
// this list is purely for managing what templates exist. Content is never hand-edited inline here
// either — the pencil icon opens the real tree editor on a throwaway sandbox node (the sentinel
// "system" project every stock/SAS bom_items row already uses, §5e) so both viewing and fixing a
// template reuse 100% of the real BomStructureWorkspace, zero new nested-editing UI.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PencilIcon, PenLineIcon, TrashIcon, LayoutTemplateIcon } from 'lucide-react';
import BomStructureWorkspace from './bom-structure/BomStructureWorkspace';
import DeleteTemplateDialog from './DeleteTemplateDialog';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NODE_TYPE_SUGGESTIONS } from '@/lib/bom-tree.mjs';

// "6 nodes in 1 project" — shared by the row badge and the delete dialog so the wording can't drift.
function structureUsage(t) {
  if (!(t.used_nodes > 0)) return null;
  return `${t.used_nodes} node${t.used_nodes === 1 ? '' : 's'} in ${t.used_projects} project${t.used_projects === 1 ? '' : 's'}`;
}

// Rename only — a template is linked to BOMs by id, so a new name changes what is displayed, never any BOM.
// The server rejects an empty or duplicate name (same level + model); the message shows inline.
function RenameDialog({ template, onClose, onRenamed }) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = name.trim() && name.trim() !== template.name;
  async function submit() {
    if (!changed) return;
    setBusy(true); setError('');
    try {
      await api(`/api/bom-structure-templates/${template.id}`, { method: 'PATCH', body: { name: name.trim() } });
      showToast('Template renamed');
      onRenamed();
      onClose();
    } catch (err) { setError(err.message || 'Could not rename the template.'); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename template</DialogTitle>
          <DialogDescription>Only the name changes. BOMs already built from this template are not affected.</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={e => setName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && submit()} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !changed}>{busy ? 'Saving…' : 'Rename'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Read-only "where is this template used" — one row per node it built, real projects only. Applied BOMs
// are independent copies: this is for judging impact before updating/removing, nothing here edits them.
function UsageDialog({ template, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/bom-structure-templates/${template.id}/usage`).then(setData).catch(err => { showToast(err.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Where “{template.name}” is used</DialogTitle>
          <DialogDescription>
            These BOMs were built from this template and keep their own copy — updating or removing the template never changes them.
          </DialogDescription>
        </DialogHeader>
        {data === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border">
            {data.nodes.map(n => (
              <div key={n.node_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/engineering?tab=structure&project=${n.project_id}`} className="font-medium text-primary hover:underline">
                    {n.project_no}{n.customer_name ? ` · ${n.customer_name}` : ''}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">Node: {n.node_name}</span>
                </div>
                <span className={`shrink-0 text-xs ${n.version != null && n.version < data.currentVersion ? 'text-warning' : 'text-muted-foreground'}`}>
                  {n.version != null ? `v${n.version}` : 'before versioning'}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function BomStructureTemplateManager() {
  const [templates, setTemplates] = useState(null);
  const [levelFilter, setLevelFilter] = useState('All');
  const [session, setSession] = useState(null); // {templateId, name, projectId, nodeId}
  const [deleting, setDeleting] = useState(null); // the template whose bin was clicked
  const [renaming, setRenaming] = useState(null); // the template whose rename icon was clicked
  const [viewingUsage, setViewingUsage] = useState(null); // the template whose "Used on…" was clicked
  const [openingId, setOpeningId] = useState(null); // guards a rapid double-click leaking a second, untracked sandbox node

  function reload() {
    api('/api/bom-structure-templates').then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(reload, []);

  async function toggleDefault(t) {
    try {
      await api(`/api/bom-structure-templates/${t.id}`, { method: 'PATCH', body: { is_default: !t.is_default } });
      reload();
    } catch (err) { showToast(err.message, 'error'); }
  }
  // Throws on failure so DeleteTemplateDialog can show the reason inline. The server archives (instead
  // of deleting) a template already used on BOM nodes — same request, `archived` says which happened.
  async function remove(t) {
    const res = await api(`/api/bom-structure-templates/${t.id}`, { method: 'DELETE' });
    showToast(res.archived ? 'Template removed — existing BOMs are unchanged' : 'Template deleted');
    reload();
  }
  async function openEditor(t) {
    if (openingId) return; // a rapid double-click would otherwise create two sandbox nodes, only one ever tracked/cleaned
    setOpeningId(t.id);
    try {
      const res = await api(`/api/bom-structure-templates/${t.id}/edit-session`, { method: 'POST' });
      setSession({ templateId: t.id, name: t.name, projectId: res.projectId, nodeId: res.nodeId });
    } catch (err) { showToast(err.message, 'error'); } finally { setOpeningId(null); }
  }
  async function updateTemplate() {
    try {
      const res = await api(`/api/bom-assemblies/${session.nodeId}/save-as-template`, {
        method: 'POST', body: { name: session.name, overwrite_template_id: session.templateId },
      });
      showToast(`Template updated — ${res.nodeCount} node(s), ${res.itemCount} item(s)`);
      await discard(false);
      reload();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function discard(showMessage = true) {
    try {
      // cascade=1: really delete the whole sandbox subtree + its items (not the generic
      // un-link-then-block-on-children behavior) — safe here specifically because this always
      // targets the sentinel project's own throwaway node, never a real project's BOM.
      await api(`/api/bom-assemblies/${session.nodeId}?cascade=1`, { method: 'DELETE' });
    } catch { /* best-effort cleanup — a stray sandbox node is harmless, hidden on the sentinel project */ }
    setSession(null);
    if (showMessage) showToast('Discarded');
  }

  if (session) {
    const sandboxProjects = [{ id: session.projectId, project_no: 'Template sandbox', customer_name: session.name }];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <LayoutTemplateIcon className="size-4 text-primary" />Editing template: {session.name}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => discard()}>Discard</Button>
            <Button size="sm" onClick={updateTemplate}>Update Template</Button>
          </div>
        </div>
        <BomStructureWorkspace
          projects={sandboxProjects} projectId={String(session.projectId)} onProjectIdChange={() => {}}
          showReleased onShowReleasedChange={() => {}}
          initialSelectedId={session.nodeId} hideRelease hideRootActions
        />
      </div>
    );
  }

  const visible = levelFilter === 'All' ? templates : (templates || []).filter(t => t.level === levelFilter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Structure Templates</CardTitle>
        <CardDescription>Reusable BOM structure captured from real nodes — "Save as template" on any node builds one; apply from a node's Overview tab or the tree's "Build from Templates."</CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 px-6 pb-6">
        <div className="flex flex-wrap gap-1.5">
          {['All', ...NODE_TYPE_SUGGESTIONS].map(l => (
            <button
              key={l} type="button" onClick={() => setLevelFilter(l)}
              className={`rounded-full border px-2.5 py-1 text-xs ${levelFilter === l ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {templates === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No templates{levelFilter !== 'All' ? ` at the ${levelFilter} level` : ''} yet — save one from a real node's action row (the bookmark icon) in the BOMs tab.
          </p>
        ) : (
          <div className="flex flex-col divide-y rounded-md border">
            {visible.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {t.name}
                    <Badge variant="outline" className="text-[10px] font-normal">v{t.version ?? 1}</Badge>
                    <button type="button" onClick={() => toggleDefault(t)} title={t.is_default ? 'Default — click to unset' : 'Set as default'} className={t.is_default ? 'text-warning' : 'text-muted-foreground/40 hover:text-warning'}>★</button>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {t.root_count > 1
                      ? <Badge className="text-[10px] font-normal">Complete BOM · {t.root_count} systems</Badge>
                      : <Badge variant="outline" className="text-[10px] font-normal">{t.level}</Badge>}
                    {t.series ? <Badge variant="outline" className="text-[10px] font-normal">{t.series}</Badge> : <span className="text-[10px]">Any model</span>}
                    <span>{t.node_count} node{t.node_count === 1 ? '' : 's'} · {t.item_count} item{t.item_count === 1 ? '' : 's'}</span>
                  </span>
                  {t.source_project_no && <span className="text-xs text-muted-foreground">{t.source_project_no}</span>}
                  {t.used_nodes > 0 && (
                    <button type="button" onClick={() => setViewingUsage(t)} className="w-fit text-left text-xs text-muted-foreground underline decoration-dotted hover:text-primary">
                      Used on {structureUsage(t)}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="icon-sm" variant="ghost" className="text-muted-foreground" onClick={() => setRenaming(t)} aria-label="Rename" title="Rename"><PenLineIcon /></Button>
                  {t.root_count > 1 ? (
                    <Tooltip><TooltipTrigger asChild>
                      <span><Button size="icon-sm" variant="ghost" className="text-primary" disabled aria-label="View / edit"><PencilIcon /></Button></span>
                    </TooltipTrigger><TooltipContent>Whole-BOM templates can't be edited here — open the project whose BOM is right and use Save Entire BOM as Template → Update existing template</TooltipContent></Tooltip>
                  ) : (
                    <Button size="icon-sm" variant="ghost" className="text-primary" onClick={() => openEditor(t)} disabled={!!openingId} aria-label="View / edit"><PencilIcon /></Button>
                  )}
                  <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => setDeleting(t)} aria-label="Delete"><TrashIcon /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {renaming && <RenameDialog template={renaming} onClose={() => setRenaming(null)} onRenamed={reload} />}
      {viewingUsage && <UsageDialog template={viewingUsage} onClose={() => setViewingUsage(null)} />}
      {deleting && (
        <DeleteTemplateDialog
          name={deleting.name} usage={structureUsage(deleting)}
          onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)}
        />
      )}
    </Card>
  );
}
