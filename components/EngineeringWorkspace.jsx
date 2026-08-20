'use client';

// components/EngineeringWorkspace.jsx — Engineering's cross-project workspace (STERP items 16-19,
// SYSTEM.md §5o): BOM Structure (multi-level assemblies + roll-up drill-down), Where-Used,
// Common/Uncommon, and Engineering Change Notes. Per-project BOM *editing* stays on the project
// page (Engineering's BomPanel/BomTable) — this is the cross-project oversight surface, same split
// InstallationWorkspace draws between the project-page milestone action and its own workspace.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LayersIcon, SearchIcon, Repeat2Icon, FileEditIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

// Same labeling convention as ProcurementWorkspace.jsx's projectLabel — a stock/sas BOM row's
// project_id points at the sentinel system project, not a real one; "Stock"/"SO #..." reads better
// than the sentinel's literal placeholder project_no.
function projectLabel(r) {
  if (!r.project_is_system) return r.project_no;
  if (r.source === 'sas') return `SO #${r.sale_order_no || '—'}`;
  if (r.source === 'stock') return 'Stock';
  return r.project_no;
}

const ITEMS = [
  { key: 'structure', label: 'BOM Structure', icon: LayersIcon },
  { key: 'where_used', label: 'Where-Used', icon: SearchIcon },
  { key: 'common_uncommon', label: 'Common / Uncommon', icon: Repeat2Icon },
  { key: 'ecn', label: 'Change Notes', icon: FileEditIcon },
];

// ---------- BOM Structure ----------

function AssemblyForm({ projectId, assemblies, onClose, router }) {
  const [form, setForm] = useState({ name: '', qty: '1', parent_id: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/bom-assemblies', {
        method: 'POST',
        body: { project_id: projectId, name: form.name, qty: Number(form.qty) || 1, parent_id: form.parent_id || null },
      });
      showToast('Assembly created');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New assembly / sub-assembly</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Drive sub-assembly" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label>Qty per parent</Label>
            <Input type="number" min="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Parent assembly (optional — blank = top level)</Label>
            <Select value={form.parent_id || 'none'} onValueChange={v => setForm({ ...form, parent_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— top level —</SelectItem>
                {assemblies.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssemblyNode({ a, byParent, depth = 0, onDelete }) {
  const children = byParent.get(a.id) || [];
  return (
    <>
      <TableRow>
        <TableCell style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }} className="font-medium">
          {a.name}
        </TableCell>
        <TableCell className="tnum text-muted-foreground">×{a.qty}</TableCell>
        <TableCell className="tnum text-muted-foreground">{a.rollup_qty}</TableCell>
        <TableCell className="text-muted-foreground">{a.items.length} item{a.items.length !== 1 ? 's' : ''}</TableCell>
        <TableCell>
          <Button size="icon-sm" variant="ghost" className="text-danger" aria-label="Delete assembly" onClick={() => onDelete(a)}>
            <TrashIcon className="size-3.5" />
          </Button>
        </TableCell>
      </TableRow>
      {a.items.map(it => (
        <TableRow key={`item-${it.id}`} className="hover:bg-transparent">
          <TableCell style={{ paddingLeft: `${(depth + 1) * 1.5 + 0.75}rem` }} className="text-sm text-muted-foreground">
            {it.material_description}
          </TableCell>
          <TableCell className="tnum text-xs text-muted-foreground">{it.qty_text || '—'}</TableCell>
          <TableCell className="tnum text-xs text-muted-foreground">{it.rolled_qty ?? '—'}</TableCell>
          <TableCell colSpan={2} />
        </TableRow>
      ))}
      {children.map(c => <AssemblyNode key={c.id} a={c} byParent={byParent} depth={depth + 1} onDelete={onDelete} />)}
    </>
  );
}

function BomStructureTab({ projects }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [structure, setStructure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function load(id) {
    setProjectId(id);
    if (!id) return setStructure(null);
    setLoading(true);
    try { setStructure(await api(`/api/bom-assemblies?project_id=${id}`)); }
    catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  }

  async function remove(a) {
    if (!window.confirm(`Delete "${a.name}"? Items under it become unassigned (not deleted).`)) return;
    try {
      await api(`/api/bom-assemblies/${a.id}`, { method: 'DELETE' });
      showToast('Assembly deleted');
      load(projectId);
    } catch (err) { showToast(err.message, 'error'); }
  }

  const top = structure?.filter(a => !a.parent_id) || [];
  const byParent = new Map();
  for (const a of structure || []) {
    if (!a.parent_id) continue;
    if (!byParent.has(a.parent_id)) byParent.set(a.parent_id, []);
    byParent.get(a.parent_id).push(a);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>BOM Structure</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Select value={projectId || undefined} onValueChange={load}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pick a project" /></SelectTrigger>
            <SelectContent>
              {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
          {projectId && <Button size="sm" variant="outline" onClick={() => setShowForm(true)}><PlusIcon /> Assembly</Button>}
        </CardAction>
      </CardHeader>
      <CardContent>
        {!projectId ? (
          <p className="text-sm text-muted-foreground">Pick a project to view or build its assembly tree.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assemblies yet. Create one, then assign BOM items to it from the project's Engineering panel
            (Edit item → Assembly).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assembly / item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Roll-up</TableHead>
                <TableHead>Items</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map(a => <AssemblyNode key={a.id} a={a} byParent={byParent} onDelete={remove} />)}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {showForm && <AssemblyForm projectId={projectId} assemblies={structure || []} onClose={() => { setShowForm(false); load(projectId); }} router={router} />}
    </Card>
  );
}

// ---------- Where-Used ----------

function WhereUsedTab() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try { setRows(await api(`/api/where-used?q=${encodeURIComponent(q)}`)); }
    catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Where-Used List</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={search} className="flex gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a part description…" className="max-w-sm" />
          <Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
        </form>
        {rows && (rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>MOC</TableHead>
                <TableHead>Size/Spec</TableHead>
                <TableHead>Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{projectLabel(r)}{r.customer_name ? ` · ${r.customer_name}` : ''}</TableCell>
                  <TableCell>{r.material_description}</TableCell>
                  <TableCell className="text-muted-foreground">{r.moc || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.size_spec || '—'}</TableCell>
                  <TableCell className="tnum text-muted-foreground">{r.qty_text || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Common / Uncommon ----------

function CommonUncommonTab({ partUsage }) {
  const [filter, setFilter] = useState('all');
  const rows = partUsage.filter(r => filter === 'all' || r.classification === filter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Common / Uncommon Parts</CardTitle>
        <CardAction>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parts</SelectItem>
              <SelectItem value="common">Common only</SelectItem>
              <SelectItem value="uncommon">Uncommon only</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>Used in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.identity_key}>
                <TableCell className="font-medium">{r.material_description}{r.catalog_item_code && <span className="ml-2 text-xs text-muted-foreground">{r.catalog_item_code}</span>}</TableCell>
                <TableCell className="tnum text-muted-foreground">{r.project_count}</TableCell>
                <TableCell>
                  <Badge variant={r.classification === 'common' ? 'default' : 'secondary'}>{r.classification}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.project_nos.join(', ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- Engineering Change Notes ----------

function EcnForm({ projects, onClose, router }) {
  const [form, setForm] = useState({ project_id: '', field_changed: '', old_value: '', new_value: '', reason: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.field_changed.trim()) return showToast('Field changed is required', 'error');
    if (!form.reason.trim()) return showToast('Reason is required', 'error');
    setSaving(true);
    try {
      await api('/api/engineering-change-notes', { method: 'POST', body: form });
      showToast('Change note raised');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a Change Note</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Select value={form.project_id || undefined} onValueChange={v => setForm({ ...form, project_id: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Field changed</Label>
            <Input value={form.field_changed} onChange={e => setForm({ ...form, field_changed: e.target.value })}
              placeholder="e.g. size_spec, moc, material_description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Old value</Label><Input value={form.old_value} onChange={e => setForm({ ...form, old_value: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>New value</Label><Input value={form.new_value} onChange={e => setForm({ ...form, new_value: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Raise'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ECN_STATUS_CLS = {
  pending: '', approved: 'bg-success/10 text-success ring-success/20', rejected: 'bg-danger/10 text-danger ring-danger/20',
};

function EcnTab({ projects, changeNotes, canApprove }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  async function decide(note, status) {
    try {
      await api(`/api/engineering-change-notes/${note.id}`, { method: 'PATCH', body: { status } });
      showToast(`Change note ${status}`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineering Change Notes</CardTitle>
        <CardAction><Button size="sm" onClick={() => setShowForm(true)}><PlusIcon /> Raise ECN</Button></CardAction>
      </CardHeader>
      <CardContent>
        {changeNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No change notes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Old → New</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {changeNotes.map(n => (
                <TableRow key={n.id}>
                  <TableCell>{n.project_no}</TableCell>
                  <TableCell className="font-medium">{n.field_changed}{n.material_description && <div className="text-xs text-muted-foreground">{n.material_description}</div>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{n.old_value || '—'} → {n.new_value || '—'}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={n.reason}>{n.reason}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ECN_STATUS_CLS[n.status]}`}>{n.status}</span>
                  </TableCell>
                  <TableCell className="tnum text-xs text-muted-foreground">{n.effective_revision ?? '—'}</TableCell>
                  <TableCell>
                    {n.status === 'pending' && canApprove && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => decide(n, 'approved')}>Approve</Button>
                        <Button size="sm" variant="outline" className="text-danger" onClick={() => decide(n, 'rejected')}>Reject</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {showForm && <EcnForm projects={projects} onClose={() => setShowForm(false)} router={router} />}
    </Card>
  );
}

// ---------- Shell ----------

export default function EngineeringWorkspace({ projects, changeNotes, partUsage, canApproveEcn = false, initialTab }) {
  const [tab, setTab] = useState(ITEMS.some(i => i.key === initialTab) ? initialTab : 'structure');

  return (
    <WorkspaceSidebar title="Engineering" icon={LayersIcon} items={ITEMS} activeKey={tab} onChange={setTab}>
      {tab === 'structure' && <BomStructureTab projects={projects} />}
      {tab === 'where_used' && <WhereUsedTab />}
      {tab === 'common_uncommon' && <CommonUncommonTab partUsage={partUsage} />}
      {tab === 'ecn' && <EcnTab projects={projects} changeNotes={changeNotes} canApprove={canApproveEcn} />}
    </WorkspaceSidebar>
  );
}
