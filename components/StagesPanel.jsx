'use client';

// Workflow Stages — a reusable checklist layer under a milestone (Open → Current → Closed),
// scoped to one department on one project. Kanban pools every stage across all of this
// department's milestones on this project into one board (a Design head sees all ~4 milestones'
// stages together, each card labeled with its milestone); Manage picks one milestone, shapes its
// own stage list, and — separately — can save/edit named, reusable templates for that milestone
// type (see lib/db.js for the model: one default per (department, milestone_key) auto-copies onto
// every new project's matching milestone; any template can also be applied on demand).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const LANES = [
  { key: 'open', label: 'Open' },
  { key: 'current', label: 'Current' },
  { key: 'closed', label: 'Closed' },
];

export default function StagesPanel({
  department, milestones, stages, stageTemplates = [], stageTemplateItems = [], canManage = false,
}) {
  const router = useRouter();
  const [tab, setTab] = useState('kanban');

  if (!stages.length && !canManage) return null; // nothing to see, no rights to add anything either

  async function move(stage, status) {
    if (stage.status === status) return;
    try {
      await api(`/api/milestones/${stage.milestone_id}/stages/${stage.id}`, { method: 'PATCH', body: { status } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <Tabs value={tab} onValueChange={setTab} className="contents">
        <CardHeader>
          <CardTitle>Stages — {department}</CardTitle>
          <CardAction>
            <TabsList>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              {canManage && <TabsTrigger value="manage">Manage</TabsTrigger>}
            </TabsList>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TabsContent value="kanban">
            <Kanban stages={stages} onMove={move} />
          </TabsContent>
          {canManage && (
            <TabsContent value="manage">
              <Manage department={department} milestones={milestones} stages={stages}
                stageTemplates={stageTemplates} stageTemplateItems={stageTemplateItems} router={router} />
            </TabsContent>
          )}
        </CardContent>
      </Tabs>
    </Card>
  );
}

function Kanban({ stages, onMove }) {
  if (!stages.length) {
    return <p className="text-sm text-muted-foreground">No stages yet.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {LANES.map(lane => (
        <div
          key={lane.key}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            const stageId = Number(e.dataTransfer.getData('text/plain'));
            const stage = stages.find(s => s.id === stageId);
            if (stage) onMove(stage, lane.key);
          }}
          className="flex min-h-[8rem] flex-col gap-2 rounded-lg border bg-muted/30 p-2"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lane.label}</div>
          {stages.filter(s => s.status === lane.key).map(s => (
            <div
              key={s.id}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', String(s.id))}
              className="cursor-grab rounded-md border bg-background px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing"
            >
              <div>{s.label}</div>
              <Badge variant="outline" className="mt-1">{s.milestone_label}</Badge>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Click-to-edit label, shared by the instance stage list and the template editor below.
function EditableRow({ label, onRename, busy }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);

  if (editing) {
    const commit = () => {
      const v = value.trim();
      if (v && v !== label) onRename(v);
      setEditing(false);
    };
    return (
      <Input
        autoFocus value={value} onChange={e => setValue(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="h-7 min-w-0 flex-1 text-sm"
      />
    );
  }
  return (
    <button
      type="button" disabled={busy} onClick={() => { setValue(label); setEditing(true); }}
      className="min-w-0 flex-1 truncate text-left hover:underline"
    >
      {label}
    </button>
  );
}

function Manage({ department, milestones, stages, stageTemplates, stageTemplateItems, router }) {
  const [selectedId, setSelectedId] = useState(milestones[0]?.id ?? null);
  const [templateId, setTemplateId] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = milestones.find(m => m.id === selectedId);
  const mine = stages.filter(s => s.milestone_id === selectedId).sort((a, b) => a.sort_order - b.sort_order);
  const templatesForType = selected ? stageTemplates.filter(t => t.milestone_key === selected.milestone_key) : [];
  const effectiveTemplateId = templatesForType.some(t => t.id === templateId)
    ? templateId
    : (templatesForType.find(t => t.is_default) || templatesForType[0])?.id ?? null;
  const selectedTemplate = templatesForType.find(t => t.id === effectiveTemplateId);
  const templateItems = stageTemplateItems
    .filter(i => i.template_id === effectiveTemplateId)
    .sort((a, b) => a.sort_order - b.sort_order);

  async function run(fn) {
    setBusy(true);
    try { await fn(); router.refresh(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const addStage = e => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    run(async () => {
      await api(`/api/milestones/${selectedId}/stages`, { method: 'POST', body: { label } });
      setNewLabel('');
    });
  };
  const renameStage = (stageId, label) => run(() =>
    api(`/api/milestones/${selectedId}/stages/${stageId}`, { method: 'PATCH', body: { label } }));
  const removeStage = stageId => run(() =>
    api(`/api/milestones/${selectedId}/stages/${stageId}`, { method: 'DELETE' }));

  const saveAsTemplate = () => {
    const name = window.prompt('Name this template (e.g. "Standard", "Fast-track")');
    if (!name || !name.trim()) return;
    run(async () => {
      const res = await api('/api/stage-templates', {
        method: 'POST',
        body: { department, milestone_key: selected.milestone_key, name: name.trim(), items: mine.map(s => s.label) },
      });
      setTemplateId(res.id);
      showToast('Template saved');
    });
  };
  const applyTemplate = () => run(async () => {
    await api(`/api/milestones/${selectedId}/stages`, { method: 'POST', body: { apply_template_id: effectiveTemplateId } });
    showToast('Template applied');
  });
  const addTemplateItem = e => {
    e.preventDefault();
    const label = newItemLabel.trim();
    if (!label || !effectiveTemplateId) return;
    run(async () => {
      await api(`/api/stage-templates/${effectiveTemplateId}/items`, { method: 'POST', body: { label } });
      setNewItemLabel('');
    });
  };
  const renameTemplateItem = (itemId, label) => run(() =>
    api(`/api/stage-templates/${effectiveTemplateId}/items/${itemId}`, { method: 'PATCH', body: { label } }));
  const moveTemplateItem = (itemId, direction) => run(() =>
    api(`/api/stage-templates/${effectiveTemplateId}/items/${itemId}`, { method: 'PATCH', body: { direction } }));
  const removeTemplateItem = itemId => run(() =>
    api(`/api/stage-templates/${effectiveTemplateId}/items/${itemId}`, { method: 'DELETE' }));
  const renameTemplate = name => run(() =>
    api(`/api/stage-templates/${effectiveTemplateId}`, { method: 'PATCH', body: { name } }));
  const setDefaultTemplate = () => run(() =>
    api(`/api/stage-templates/${effectiveTemplateId}`, { method: 'PATCH', body: { is_default: true } }));
  const deleteTemplate = () => {
    if (!window.confirm(`Delete template "${selectedTemplate?.name}"? This can't be undone.`)) return;
    run(async () => {
      await api(`/api/stage-templates/${effectiveTemplateId}`, { method: 'DELETE' });
      setTemplateId(null);
    });
  };

  if (!milestones.length) return <p className="text-sm text-muted-foreground">No milestones in this department yet.</p>;

  return (
    <div className="flex flex-col gap-5">
      <Select value={selectedId ? String(selectedId) : undefined}
        onValueChange={v => { setSelectedId(Number(v)); setTemplateId(null); }}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {milestones.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.milestone_label}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This milestone's stages</h4>
          {mine.length > 0 && (
            <button type="button" className="text-xs text-primary hover:underline" disabled={busy} onClick={saveAsTemplate}>
              Save as template
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {mine.map(s => (
            <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <EditableRow label={s.label} busy={busy} onRename={label => renameStage(s.id, label)} />
              <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                disabled={busy} onClick={() => removeStage(s.id)}>
                Remove
              </button>
            </div>
          ))}
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No stages yet.</p>}
        </div>
        <form onSubmit={addStage} className="flex gap-2">
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New stage name" />
          <Button type="submit" disabled={busy || !newLabel.trim()}>Add</Button>
        </form>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Templates for {selected?.milestone_label}
        </h4>
        {templatesForType.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved templates yet — shape this milestone's stages above, then Save as template.
          </p>
        ) : (
          <>
            <Select value={effectiveTemplateId ? String(effectiveTemplateId) : undefined}
              onValueChange={v => setTemplateId(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {templatesForType.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}{t.is_default ? ' ★' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <EditableRow label={selectedTemplate.name} busy={busy} onRename={renameTemplate} />
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {selectedTemplate.is_default
                  ? <span className="text-muted-foreground">Default</span>
                  : <button type="button" className="text-muted-foreground hover:text-foreground" disabled={busy} onClick={setDefaultTemplate}>Set default</button>}
                <button type="button" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={deleteTemplate}>Delete</button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {templateItems.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <EditableRow label={it.label} busy={busy} onRename={label => renameTemplateItem(it.id, label)} />
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <button type="button" disabled={busy || idx === 0} className="disabled:opacity-30" onClick={() => moveTemplateItem(it.id, 'up')}>↑</button>
                    <button type="button" disabled={busy || idx === templateItems.length - 1} className="disabled:opacity-30" onClick={() => moveTemplateItem(it.id, 'down')}>↓</button>
                    <button type="button" className="hover:text-destructive" disabled={busy} onClick={() => removeTemplateItem(it.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={addTemplateItem} className="flex gap-2">
              <Input value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)} placeholder="Add stage to template" />
              <Button type="submit" variant="outline" disabled={busy || !newItemLabel.trim()}>Add</Button>
            </form>

            {mine.length === 0 ? (
              <Button size="sm" disabled={busy} onClick={applyTemplate}>Apply to this milestone</Button>
            ) : (
              <p className="text-xs text-muted-foreground">Remove this milestone's current stages above to apply a different template.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
