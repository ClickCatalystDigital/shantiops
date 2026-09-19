'use client';

// components/bom-structure/SaveBomAsTemplateDialog.jsx — captures a project's ENTIRE current BOM
// (every top-level root + full descendants) as one whole-BOM Structure Template. Same Dialog shape
// as SaveAsTemplateDialog.jsx, minus the level picker — a whole-BOM template is always level=System
// (the only level "Build from Templates" applies at the project root), so there's nothing to choose.
//
// Two modes: "Create new" (the original form, unchanged) and "Update existing" — the safe way to
// change a whole-BOM template (the sandbox editor can't: it only tracks one root). Update replaces the
// template's content with this project's current BOM and raises its version; the template keeps its
// name/series/description, and BOMs already built from it are never touched.
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SearchableSelect from '@/components/SearchableSelect';
import { AlertTriangleIcon } from 'lucide-react';

export default function SaveBomAsTemplateDialog({ rootCount, nodeCount = 0, itemCount = 0, unassignedCount = 0, onClose, onSave }) {
  const [mode, setMode] = useState('create'); // 'create' | 'update'
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState(null); // whole-BOM templates that can be updated (null = loading)
  const [targetId, setTargetId] = useState('');

  // Only whole-BOM templates (several systems) — those are the ones the sandbox editor cannot update.
  useEffect(() => {
    api('/api/bom-structure-templates?level=System')
      .then(list => setExisting(list.filter(t => t.root_count > 1)))
      .catch(() => setExisting([]));
  }, []);

  const target = existing?.find(t => String(t.id) === targetId);
  const canSubmit = mode === 'create' ? !!name.trim() : !!target;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSave(mode === 'create'
        ? { name: name.trim(), series: series.trim() || null, description: description.trim() || null }
        : { overwrite_template_id: target.id });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save entire BOM as a template</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="inline-flex rounded-md border p-0.5 text-sm">
            {[['create', 'Create new template'], ['update', 'Update existing template']].map(([key, label]) => (
              <button
                key={key} type="button" onClick={() => setMode(key)}
                className={`flex-1 rounded px-3 py-1.5 ${mode === key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'create' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Captures all {rootCount} top-level node{rootCount === 1 ? '' : 's'} of this project's current BOM, with every
                descendant and item, as one reusable package — appears in "Build from Templates" alongside single-System templates.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label>Template name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. SF-500kg/hr Complete Package" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Model / series (optional)</Label>
                <Input value={series} onChange={e => setSeries(e.target.value)} placeholder="e.g. SF" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Description (optional)</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
              </div>
            </>
          ) : existing === null ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : existing.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There is no whole-BOM template to update yet — create one first.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Template to update</Label>
                <SearchableSelect
                  value={targetId} onChange={setTargetId} placeholder="Pick a whole-BOM template…"
                  options={existing.map(t => ({
                    value: String(t.id),
                    label: `${t.name} · v${t.version} · ${t.root_count} systems · ${t.item_count} items`,
                  }))}
                  displayValue={target ? `${target.name} · v${target.version}` : undefined}
                />
              </div>
              {target && (
                <div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 text-sm">
                  <span>
                    <span className="text-muted-foreground">Now: </span>{target.root_count} systems · {target.node_count} nodes · {target.item_count} items
                  </span>
                  <span>
                    <span className="text-muted-foreground">After: </span>{rootCount} systems · {nodeCount} nodes · {itemCount} items
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Version v{target.version} → v{target.version + 1} (unchanged if the content is identical).
                    Projects already built from this template are not changed; new applies use the updated content.
                    The previous content is not kept.
                  </span>
                </div>
              )}
              {unassignedCount > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{unassignedCount} unassigned item{unassignedCount === 1 ? '' : 's'} in this BOM won't be included — only items placed on a node are saved.</span>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? 'Saving…' : mode === 'create' ? 'Save template' : 'Update template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
