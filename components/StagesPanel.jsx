'use client';

// Workflow Stages — a reusable checklist layer under a milestone (Open → Current → Closed),
// scoped to one department on one project. Kanban pools every stage across all of this
// department's milestones on this project into one board (a Design head sees all ~4 milestones'
// stages together, each card labeled with its milestone); Manage picks one milestone and edits
// just that milestone's own stage list — never the template (see lib/db.js for why).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const LANES = [
  { key: 'open', label: 'Open' },
  { key: 'current', label: 'Current' },
  { key: 'closed', label: 'Closed' },
];

export default function StagesPanel({ department, milestones, stages, stageTemplates = [], canManage = false }) {
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
      <CardHeader><CardTitle>Stages — {department}</CardTitle></CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab} className="flex-col gap-4">
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            {canManage && <TabsTrigger value="manage">Manage</TabsTrigger>}
          </TabsList>
          <TabsContent value="kanban">
            <Kanban stages={stages} onMove={move} />
          </TabsContent>
          {canManage && (
            <TabsContent value="manage">
              <Manage milestones={milestones} stages={stages} stageTemplates={stageTemplates} router={router} />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
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

function Manage({ milestones, stages, stageTemplates, router }) {
  const [selectedId, setSelectedId] = useState(milestones[0]?.id ?? null);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = milestones.find(m => m.id === selectedId);
  const mine = stages.filter(s => s.milestone_id === selectedId).sort((a, b) => a.sort_order - b.sort_order);
  const template = selected ? stageTemplates.filter(t => t.milestone_key === selected.milestone_key) : [];

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
  const applyTemplate = () => run(async () => {
    await api(`/api/milestones/${selectedId}/stages`, { method: 'POST', body: { apply_template: true } });
    showToast('Template applied');
  });
  const remove = stageId => run(() => api(`/api/milestones/${selectedId}/stages/${stageId}`, { method: 'DELETE' }));

  if (!milestones.length) return <p className="text-sm text-muted-foreground">No milestones in this department yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      <Select value={selectedId ? String(selectedId) : undefined} onValueChange={v => setSelectedId(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {milestones.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.milestone_label}</SelectItem>)}
        </SelectContent>
      </Select>

      {mine.length === 0 && template.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>Template available: {template.map(t => t.label).join(', ')}</span>
          <Button size="sm" disabled={busy} onClick={applyTemplate}>Apply template</Button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {mine.map(s => (
          <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
            <span>{s.label}</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => remove(s.id)}
            >
              Remove
            </button>
          </div>
        ))}
        {mine.length === 0 && <p className="text-sm text-muted-foreground">No stages on this milestone yet.</p>}
      </div>

      <form onSubmit={addStage} className="flex gap-2">
        <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New stage name" />
        <Button type="submit" disabled={busy || !newLabel.trim()}>Add</Button>
      </form>
    </div>
  );
}
