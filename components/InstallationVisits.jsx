'use client';

// Installation → Visits. One table of visits per project; date and time are separate columns, the
// four default visits are seeded server-side the first time a project is opened. Table on desktop,
// cards on phones. Edit happens in a minimal Sheet.
import { useEffect, useState, useCallback } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, UsersIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';

export const projectOptions = (projects) => projects.map(p => ({ value: String(p.id), label: `${p.project_no}${p.customer_name ? ` · ${p.customer_name}` : ''}` }));

function TeamPicker({ team, value, onChange }) {
  const set = new Set((value || '').split(',').filter(Boolean));
  const toggle = (u) => { set.has(u) ? set.delete(u) : set.add(u); onChange([...set].join(',')); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start font-normal">
          <UsersIcon data-icon="inline-start" />{set.size ? `${set.size} selected` : 'Select team members'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {team.length === 0 && <p className="p-2 text-xs text-muted-foreground">No users have Installation access yet.</p>}
          {team.map(u => (
            <label key={u.username} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/40">
              <Checkbox checked={set.has(u.username)} onCheckedChange={() => toggle(u.username)} />
              <span className="truncate">{u.display_name || u.username}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VisitSheet({ visit, projectId, team, onClose, onSaved }) {
  const [f, setF] = useState({
    description: visit?.description || '', visit_date: visit?.visit_date || '', visit_time: visit?.visit_time || '',
    visited_by: visit?.visited_by || '', status: visit?.status || 'planned',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    if (!f.description.trim()) return showToast('Description is required', 'error');
    setSaving(true);
    try {
      if (visit) await api(`/api/installation-visits/${visit.id}`, { method: 'PATCH', body: f });
      else await api('/api/installation-visits', { method: 'POST', body: { ...f, project_id: projectId } });
      onSaved();
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader><SheetTitle>{visit ? `Edit visit ${visit.seq}` : 'Add visit'}</SheetTitle></SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          <div className="grid gap-1.5"><Label>Description</Label><Input value={f.description} onChange={e => set('description', e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={f.visit_date} onChange={e => set('visit_date', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Time</Label><Input type="time" value={f.visit_time} onChange={e => set('visit_time', e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Who visited</Label><TeamPicker team={team} value={f.visited_by} onChange={v => set('visited_by', v)} /></div>
          <div className="flex gap-2">
            {[['planned', 'Planned'], ['done', 'Done']].map(([k, l]) => (
              <Button key={k} type="button" variant={f.status === k ? 'default' : 'outline'} className="flex-1" onClick={() => set('status', k)}>{l}</Button>
            ))}
          </div>
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function InstallationVisits({ projects, team }) {
  const [projectId, setProjectId] = useState('');
  const [visits, setVisits] = useState(null);
  const [planned, setPlanned] = useState(4);
  const [overview, setOverview] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (new) | visit
  const names = Object.fromEntries(team.map(u => [u.username, u.display_name || u.username]));
  const who = (v) => (v.visited_by || '').split(',').filter(Boolean).map(u => names[u] || u).join(', ') || '—';

  const load = useCallback(async (id) => {
    if (!id) return setVisits(null);
    setVisits(null);
    try { const r = await api(`/api/installation-visits?project_id=${id}`); setVisits(r.rows); setPlanned(r.planned); } catch (err) { showToast(err.message, 'error'); }
  }, []);
  useEffect(() => { load(projectId); }, [projectId, load]);
  useEffect(() => {
    if (projectId) return;
    api('/api/installation-visits?overview=1').then(setOverview).catch(err => showToast(err.message, 'error'));
  }, [projectId]);
  async function savePlanned(v) {
    const n = Math.max(0, Math.min(50, Math.floor(Number(v)) || 0));
    setPlanned(n);
    try { await api('/api/installation-visits/plan', { method: 'PATCH', body: { project_id: projectId, planned_visits: n } }); } catch (err) { showToast(err.message, 'error'); }
  }
  const done = (visits || []).filter(v => v.status === 'done').length;
  const remaining = Math.max(planned - done, 0);

  async function remove(v) {
    if (!window.confirm(`Delete visit "${v.description}"?`)) return;
    try { await api(`/api/installation-visits/${v.id}`, { method: 'DELETE' }); load(projectId); } catch (err) { showToast(err.message, 'error'); }
  }
  const status = (v) => <Badge variant={v.status === 'done' ? 'default' : 'outline'}>{v.status === 'done' ? 'Done' : 'Planned'}</Badge>;
  const actions = (v) => (
    <div className="flex justify-end gap-1">
      <Button size="icon" variant="ghost" onClick={() => setEditing(v)} aria-label="Edit"><PencilIcon /></Button>
      <Button size="icon" variant="ghost" onClick={() => remove(v)} aria-label="Delete"><TrashIcon /></Button>
    </div>
  );

  const remainingBadge = (r) => <Badge variant={r > 0 ? 'outline' : 'default'}>{r} remaining</Badge>;
  return (
    <div className="flex flex-col gap-4">
      {/* Picker lives outside the Card: Card is overflow-hidden and would clip the dropdown list. */}
      <div className="max-w-2xl">
        <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Search a project…" options={projectOptions(projects)} />
      </div>
      {!projectId ? (
        <Card>
          <CardHeader><CardTitle>Visits by project</CardTitle></CardHeader>
          <CardContent>
            {overview === null ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Done</TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader>
                    <TableBody>{overview.map(o => (
                      <TableRow key={o.project_id} className="cursor-pointer" onClick={() => setProjectId(String(o.project_id))}>
                        <TableCell className="font-medium">{o.project_no}</TableCell>
                        <TableCell>{o.customer_name}</TableCell>
                        <TableCell className="tnum text-right">{o.planned}</TableCell>
                        <TableCell className="tnum text-right">{o.done}</TableCell>
                        <TableCell className="text-right">{remainingBadge(Math.max(o.planned - o.done, 0))}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
                <div className="grid gap-2 md:hidden">
                  {overview.map(o => (
                    <button key={o.project_id} type="button" className="rounded-xl border p-3 text-left" onClick={() => setProjectId(String(o.project_id))}>
                      <div className="flex items-center justify-between gap-2"><span className="font-medium">{o.project_no}</span>{remainingBadge(Math.max(o.planned - o.done, 0))}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{o.customer_name} · {o.done} of {o.planned} done</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
      <Card>
      <CardHeader>
        <CardTitle>Visits</CardTitle>
        <CardAction><Button size="sm" onClick={() => setEditing({})}><PlusIcon data-icon="inline-start" />Add visit</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">Done {done} / {planned}</Badge>
          {remainingBadge(remaining)}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Planned visits
            <Input type="number" min={0} max={50} className="h-8 w-16" key={planned} defaultValue={planned} onBlur={e => Number(e.target.value) !== planned && savePlanned(e.target.value)} />
          </label>
        </div>
        {visits === null ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Description</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Who visited</TableHead><TableHead>Status</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
                <TableBody>{visits.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="tnum text-muted-foreground">{v.seq}</TableCell>
                    <TableCell className="whitespace-normal font-medium">{v.description}</TableCell>
                    <TableCell>{v.visit_date ? formatDate(v.visit_date) : '—'}</TableCell>
                    <TableCell className="tnum">{v.visit_time || '—'}</TableCell>
                    <TableCell className="whitespace-normal">{who(v)}</TableCell>
                    <TableCell>{status(v)}</TableCell>
                    <TableCell>{actions(v)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
            <div className="grid gap-2 md:hidden">
              {visits.map(v => (
                <div key={v.id} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium"><span className="mr-1.5 text-muted-foreground">{v.seq}.</span>{v.description}</div>
                    {status(v)}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {v.visit_date ? formatDate(v.visit_date) : 'No date'}{v.visit_time ? ` · ${v.visit_time}` : ''} · {who(v)}
                  </div>
                  <div className="mt-1">{actions(v)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
      </Card>
      )}
      {editing && <VisitSheet visit={editing.id ? editing : null} projectId={projectId} team={team}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(projectId); }} />}
    </div>
  );
}
