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
import {
  LayersIcon, SearchIcon, Repeat2Icon, FileEditIcon, PlusIcon, LayoutTemplateIcon,
  ClipboardListIcon, CheckIcon, FileStackIcon,
} from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import BomTemplateManager from '@/components/BomTemplateManager';
import BomStructureWorkspace from '@/components/bom-structure/BomStructureWorkspace';
import { RaisePrTab, ReleaseBomTab } from '@/components/PrWorkspace';

// Same labeling convention as ProcurementWorkspace.jsx's projectLabel — a stock/sas BOM row's
// project_id points at the sentinel system project, not a real one; "Stock"/"SO #..." reads better
// than the sentinel's literal placeholder project_no.
function projectLabel(r) {
  if (!r.project_is_system) return r.project_no;
  if (r.source === 'sas') return `SO #${r.sale_order_no || '—'}`;
  if (r.source === 'stock') return 'Stock';
  return r.project_no;
}

// Phase 1 nav reorg (SYSTEM.md): "BOM Structure" -> "BOMs" (label only, key kept as 'structure' so
// BomPanel.jsx's existing ?tab=structure deep link keeps working), and "BOM Templates" moved in
// from Requests/PrWorkspace.jsx (still also rendered there for Stores heads — see PrWorkspace.jsx).
// Requests' own three tabs (Purchase Requests/Release BOM/PR Templates) added at the end — same
// RaisePrTab/ReleaseBomTab/BomTemplateManager(kind="pr") components /pr already renders, imported
// directly rather than duplicated, so nothing is duplicated at the data layer, only the entry point
// (same precedent Release BOM's own button already established). "PR Templates" deliberately does
// NOT reuse BOM Templates' icon (LayoutTemplateIcon) — harmless on two separate pages, a real
// ambiguity once both sit in one sidebar.
const ITEMS = [
  { key: 'structure', label: 'BOMs', icon: LayersIcon },
  { key: 'bom_templates', label: 'BOM Templates', icon: LayoutTemplateIcon },
  { key: 'where_used', label: 'Where-Used', icon: SearchIcon },
  { key: 'common_uncommon', label: 'Common / Uncommon', icon: Repeat2Icon },
  { key: 'ecn', label: 'Change Notes', icon: FileEditIcon },
  { key: 'pr_raise', label: 'Purchase Requests', icon: ClipboardListIcon },
  { key: 'pr_templates', label: 'PR Templates', icon: FileStackIcon },
  { key: 'pr_divider', divider: true },
  { key: 'pr_release', label: 'Release BOM', icon: CheckIcon },
];

// ---------- BOM Structure ----------
// Phase 2 (SYSTEM.md): the flat create-only assembly form/table above was replaced by a real
// two-pane tree+detail workspace — see components/bom-structure/BomStructureWorkspace.jsx.

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

export default function EngineeringWorkspace({ projects, changeNotes, partUsage, canApproveEcn = false, initialTab, departments = [] }) {
  const [tab, setTab] = useState(ITEMS.some(i => i.key === initialTab) ? initialTab : 'structure');
  // Same small cross-tab handoff PrWorkspace.jsx owns internally for its own "PR Templates" tab —
  // reusing this workspace's existing setTab instead of a second tab-state.
  const [prTemplatePrefill, setPrTemplatePrefill] = useState(null);
  function useInRaisePr(items) {
    setPrTemplatePrefill(items);
    setTab('pr_raise');
  }

  return (
    <WorkspaceSidebar title="Engineering" icon={LayersIcon} items={ITEMS} activeKey={tab} onChange={setTab}>
      {tab === 'structure' && <BomStructureWorkspace projects={projects} />}
      {tab === 'bom_templates' && <BomTemplateManager kind="bom" title="BOM Templates" projects={projects} />}
      {tab === 'where_used' && <WhereUsedTab />}
      {tab === 'common_uncommon' && <CommonUncommonTab partUsage={partUsage} />}
      {tab === 'ecn' && <EcnTab projects={projects} changeNotes={changeNotes} canApprove={canApproveEcn} />}
      {tab === 'pr_raise' && (
        <RaisePrTab departments={departments} projects={projects}
          prTemplatePrefill={prTemplatePrefill} onPrefillConsumed={() => setPrTemplatePrefill(null)} />
      )}
      {tab === 'pr_templates' && (
        <BomTemplateManager kind="pr" title="PR Templates" projects={projects} onUseInRaisePr={useInRaisePr} />
      )}
      {tab === 'pr_release' && <ReleaseBomTab projects={projects} departments={departments} />}
    </WorkspaceSidebar>
  );
}
