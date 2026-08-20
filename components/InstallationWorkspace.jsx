'use client';

// components/InstallationWorkspace.jsx — Installation's own workspace tab (STERP items 36/37/38).
// Before this, Installation had no workspace at all — just the "Mark complete" button on a
// project's milestone tab (InstallationMilestoneActions.jsx, still owns that). Service Calls and
// Service Contracts are new tables (lib/db.js); Reports is read-only, computed client-side from
// what's already fetched, same idiom as CrmReportsWorkspace/ReportKit rather than a chart library.
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
  PlusIcon, HeadsetIcon, FileSignatureIcon, BarChart3Icon, MapPinIcon,
} from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { BarList, StatRow, ReportShell } from '@/components/ReportKit';

const ITEMS = [
  { key: 'service_calls', label: 'Service Calls', icon: HeadsetIcon },
  { key: 'contracts', label: 'Service Contracts', icon: FileSignatureIcon },
  { key: 'reports', label: 'Reports', icon: BarChart3Icon },
];

const PRIORITY_CLS = {
  low: '', medium: 'bg-info/10 text-info ring-info/20',
  high: 'bg-warning/10 text-warning ring-warning/20', critical: 'bg-destructive/10 text-destructive ring-destructive/20',
};
const STATUS_LABEL = { open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
const STATUS_CLS = {
  open: '', assigned: 'bg-info/10 text-info ring-info/20', in_progress: 'bg-warning/10 text-warning ring-warning/20',
  resolved: 'bg-success/10 text-success ring-success/20', closed: 'bg-muted text-muted-foreground ring-border',
};
const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

function agingHours(call) {
  const end = call.resolved_at || call.closed_at || Date.now();
  return Math.round((new Date(end) - new Date(call.created_at)) / 36e5);
}

// ---------- Service Calls ----------

function ServiceCallFormDialog({ projects, onClose, router }) {
  const [form, setForm] = useState({ project_id: '', customer_name: '', contact_person: '', contact_phone: '', subject: '', description: '', priority: 'medium', sla_hours: '' });
  const [saving, setSaving] = useState(false);

  function pickProject(id) {
    const p = projects.find(pr => String(pr.id) === id);
    setForm({ ...form, project_id: id, customer_name: p?.customer_name || form.customer_name });
  }

  async function save() {
    if (!form.subject.trim()) return showToast('Subject is required', 'error');
    setSaving(true);
    try {
      const result = await api('/api/service-calls', {
        method: 'POST',
        body: { ...form, project_id: form.project_id || null, sla_hours: form.sla_hours ? Number(form.sla_hours) : null },
      });
      showToast(`SC-${result.call_no} logged`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New Service Call</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5">
            <Label>Project / equipment</Label>
            <Select value={form.project_id || undefined} onValueChange={pickProject}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a project (optional)" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            <Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Contact person</Label>
            <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Contact phone</Label>
            <Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low', 'medium', 'high', 'critical'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Subject</Label>
            <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} autoFocus />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>SLA target (hours)</Label>
            <Input type="number" min="0" value={form.sla_hours} onChange={e => setForm({ ...form, sla_hours: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Logging…' : 'Log call'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServiceCallDetailDialog({ call, onClose, router }) {
  const [form, setForm] = useState({
    status: call.status, assigned_to: call.assigned_to || '', priority: call.priority,
    diagnosis: call.diagnosis || '', resolution: call.resolution || '', closure_evidence: call.closure_evidence || '',
  });
  const [visitTech, setVisitTech] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingVisit, setLoggingVisit] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/service-calls/${call.id}`, { method: 'PATCH', body: form });
      showToast(`SC-${call.call_no} updated`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  async function logVisit() {
    setLoggingVisit(true);
    try {
      await api(`/api/service-calls/${call.id}/visits`, { method: 'POST', body: { technician: visitTech, notes: visitNotes } });
      showToast('Visit logged');
      router.refresh();
      setVisitTech(''); setVisitNotes('');
    } catch (err) { showToast(err.message, 'error'); }
    setLoggingVisit(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>SC-{call.call_no} · {call.subject}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{['low', 'medium', 'high', 'critical'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Assigned to (technician)</Label>
            <Input value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Diagnosis</Label>
            <Textarea value={form.diagnosis} onChange={e => setForm({ ...form, diagnosis: e.target.value })} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Resolution</Label>
            <Textarea value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Closure evidence</Label>
            <Input value={form.closure_evidence} onChange={e => setForm({ ...form, closure_evidence: e.target.value })} placeholder="Photo ref, sign-off note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>

        <div className="border-t pt-3">
          <Label className="mb-2 block">Visit history</Label>
          <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
            {(call.visits || []).length === 0
              ? <p className="text-sm text-muted-foreground">No visits logged yet.</p>
              : call.visits.map(v => (
                <div key={v.id} className="text-sm">
                  <span className="text-muted-foreground">{formatDate(v.visit_date)}</span>
                  {v.technician ? ` · ${v.technician}` : ''}{v.notes ? ` — ${v.notes}` : ''}
                </div>
              ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input placeholder="Technician" className="w-40" value={visitTech} onChange={e => setVisitTech(e.target.value)} />
            <Input placeholder="Notes" value={visitNotes} onChange={e => setVisitNotes(e.target.value)} />
            <Button size="sm" variant="outline" disabled={loggingVisit} onClick={logVisit}><PlusIcon />Log visit</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ServiceCallsCard({ serviceCalls, projects, router }) {
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service Calls</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />New call</Button></CardAction>
      </CardHeader>
      <CardContent>
        {serviceCalls.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No service calls logged yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Call #</TableHead><TableHead>Project</TableHead><TableHead>Subject</TableHead>
                <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Assigned</TableHead>
                <TableHead>Aging</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceCalls.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">SC-{c.call_no}</TableCell>
                  <TableCell className="text-muted-foreground">{c.project_no || '—'}</TableCell>
                  <TableCell>{c.subject}</TableCell>
                  <TableCell><Badge className={PRIORITY_CLS[c.priority]}>{c.priority}</Badge></TableCell>
                  <TableCell><Badge className={STATUS_CLS[c.status]}>{STATUS_LABEL[c.status]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{c.assigned_to || '—'}</TableCell>
                  <TableCell className="tnum text-muted-foreground">
                    {agingHours(c)}h
                    {c.sla_hours && agingHours(c) > c.sla_hours && !['resolved', 'closed'].includes(c.status)
                      ? <Badge variant="destructive" className="ml-2">SLA breach</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setDetail(c)}>Manage</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && <ServiceCallFormDialog projects={projects} router={router} onClose={() => setAdding(false)} />}
      {detail && <ServiceCallDetailDialog call={detail} router={router} onClose={() => setDetail(null)} />}
    </Card>
  );
}

// ---------- Service Contracts ----------

const CONTRACT_STATUS_CLS = {
  active: 'bg-success/10 text-success ring-success/20', expired: 'bg-warning/10 text-warning ring-warning/20',
  renewed: 'bg-info/10 text-info ring-info/20', cancelled: 'bg-muted text-muted-foreground ring-border',
};

function ServiceContractFormDialog({ projects, onClose, router }) {
  const [form, setForm] = useState({ project_id: '', customer_name: '', start_date: '', end_date: '', visit_frequency: '', entitlement: '' });
  const [saving, setSaving] = useState(false);

  function pickProject(id) {
    const p = projects.find(pr => String(pr.id) === id);
    setForm({ ...form, project_id: id, customer_name: p?.customer_name || form.customer_name });
  }

  async function save() {
    setSaving(true);
    try {
      const result = await api('/api/service-contracts', { method: 'POST', body: { ...form, project_id: form.project_id || null } });
      showToast(`SVC-${result.contract_no} created`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New Service Contract</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5">
            <Label>Project / equipment</Label>
            <Select value={form.project_id || undefined} onValueChange={pickProject}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a project (optional)" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            <Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Visit frequency</Label>
            <Input value={form.visit_frequency} onChange={e => setForm({ ...form, visit_frequency: e.target.value })} placeholder="e.g. Quarterly" />
          </div>
          <div className="grid gap-1.5">
            <Label>Start date</Label>
            <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>End date</Label>
            <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>Entitlement</Label>
            <Textarea value={form.entitlement} onChange={e => setForm({ ...form, entitlement: e.target.value })} placeholder="What's covered — visits included, parts, response time…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create contract'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServiceContractsCard({ serviceContracts, projects, router }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api(`/api/service-contracts/${id}`, { method: 'PATCH', body: { action } });
      showToast(`Contract ${action}d`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service Contracts</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />New contract</Button></CardAction>
      </CardHeader>
      <CardContent>
        {serviceContracts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No service contracts yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract #</TableHead><TableHead>Project</TableHead><TableHead>Customer</TableHead>
                <TableHead>Frequency</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceContracts.map(c => {
                const expiringSoon = c.status === 'active' && c.end_date &&
                  (new Date(c.end_date) - Date.now()) / 864e5 <= 30 && (new Date(c.end_date) - Date.now()) >= 0;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">SVC-{c.contract_no}</TableCell>
                    <TableCell className="text-muted-foreground">{c.project_no || '—'}</TableCell>
                    <TableCell>{c.customer_name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.visit_frequency || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.start_date ? formatDate(c.start_date) : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.end_date ? formatDate(c.end_date) : '—'}</TableCell>
                    <TableCell>
                      <Badge className={CONTRACT_STATUS_CLS[c.status]}>{c.status}</Badge>
                      {expiringSoon ? <Badge variant="destructive" className="ml-2">Expiring soon</Badge> : null}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      {(c.status === 'active' || c.status === 'expired') && (
                        <Button size="sm" disabled={busyId === c.id} onClick={() => act(c.id, 'renew')}>Renew</Button>
                      )}
                      {c.status === 'active' && (
                        <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => act(c.id, 'cancel')}>Cancel</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && <ServiceContractFormDialog projects={projects} router={router} onClose={() => setAdding(false)} />}
    </Card>
  );
}

// ---------- Reports (items 7 + 38) ----------

function countBy(rows, key) {
  const counts = {};
  for (const r of rows) { const k = r[key] || '—'; counts[k] = (counts[k] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function MilestonesReport({ milestones }) {
  const siteInstall = milestones.filter(m => m.milestone_key === 'site_installation');
  const commissioning = milestones.filter(m => m.milestone_key === 'commissioning');
  const delayed = milestones.filter(m => m.delay_reason);
  const commissionDone = commissioning.filter(m => m.status === 'done').length;
  const commissionRate = commissioning.length ? Math.round((commissionDone / commissioning.length) * 100) : null;
  const items = countBy(milestones, 'status').map(([label, value]) => ({ label, value }));

  return (
    <ReportShell title="Installation Milestones" description="Site Installation and Commissioning milestones across every project, and where delays came from.">
      <StatRow stats={[
        { label: 'Site Installation', value: siteInstall.length },
        { label: 'Commissioning', value: commissioning.length },
        { label: 'Commissioning completion', value: commissionRate == null ? '—' : `${commissionRate}%` },
        { label: 'Delayed', value: delayed.length, warn: delayed.length > 0 },
      ]} />
      <BarList items={items} colorFor={i => i.label === 'done' ? 'bg-success' : 'bg-chart-1'} />
      {delayed.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Milestone</TableHead><TableHead>Delay reason</TableHead></TableRow></TableHeader>
          <TableBody>
            {delayed.map(m => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.project_no}</TableCell>
                <TableCell>{m.milestone_label}</TableCell>
                <TableCell className="text-muted-foreground">{m.delay_reason}{m.delay_category ? ` (${m.delay_category})` : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportShell>
  );
}

function ServiceCallsReport({ serviceCalls }) {
  const open = serviceCalls.filter(c => !['resolved', 'closed'].includes(c.status));
  const withSla = serviceCalls.filter(c => c.sla_hours != null && (c.resolved_at || c.closed_at));
  const withinSla = withSla.filter(c => agingHours(c) <= c.sla_hours);
  const slaRate = withSla.length ? Math.round((withinSla.length / withSla.length) * 100) : null;
  const repeatCustomers = countBy(serviceCalls.filter(c => c.customer_name), 'customer_name').filter(([, n]) => n > 1);
  const items = countBy(open, 'priority').map(([label, value]) => ({ label, value }));

  return (
    <ReportShell title="Service Call Aging & SLA Compliance" description="Open call load, resolution SLA compliance, and customers with more than one call.">
      <StatRow stats={[
        { label: 'Open calls', value: open.length, warn: open.length > 0 },
        { label: 'SLA compliance', value: slaRate == null ? '—' : `${slaRate}%`, warn: slaRate != null && slaRate < 80 },
        { label: 'Repeat customers', value: repeatCustomers.length },
      ]} />
      <BarList items={items} colorFor={i => PRIORITY_CLS[i.label]?.includes('destructive') ? 'bg-destructive' : 'bg-chart-1'} />
    </ReportShell>
  );
}

function TechnicianReport({ serviceCalls }) {
  const assigned = serviceCalls.filter(c => c.assigned_to);
  const byTech = {};
  for (const c of assigned) {
    byTech[c.assigned_to] ||= { name: c.assigned_to, total: 0, resolved: 0, hoursSum: 0, hoursCount: 0 };
    const row = byTech[c.assigned_to];
    row.total += 1;
    if (['resolved', 'closed'].includes(c.status)) {
      row.resolved += 1;
      row.hoursSum += agingHours(c);
      row.hoursCount += 1;
    }
  }
  const rows = Object.values(byTech).sort((a, b) => b.total - a.total);

  return (
    <ReportShell title="Technician Performance" description="Calls assigned and resolved per technician, with average resolution time.">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No calls assigned to a technician yet.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Technician</TableHead><TableHead>Assigned</TableHead><TableHead>Resolved</TableHead><TableHead>Avg resolution</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tnum">{r.total}</TableCell>
                <TableCell className="tnum">{r.resolved}</TableCell>
                <TableCell className="tnum">{r.hoursCount ? `${Math.round(r.hoursSum / r.hoursCount)}h` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportShell>
  );
}

function ContractsReport({ serviceContracts }) {
  const active = serviceContracts.filter(c => c.status === 'active');
  const expiringSoon = active.filter(c => c.end_date && (new Date(c.end_date) - Date.now()) / 864e5 <= 30 && (new Date(c.end_date) - Date.now()) >= 0);
  const renewed = serviceContracts.filter(c => c.status === 'renewed').length;
  const renewable = serviceContracts.filter(c => ['renewed', 'expired', 'active'].includes(c.status)).length;
  const renewalRate = renewable ? Math.round((renewed / renewable) * 100) : null;

  return (
    <ReportShell title="Service Contracts & Renewals" description="Active coverage, what's expiring soon, and the renewal rate.">
      <StatRow stats={[
        { label: 'Active contracts', value: active.length },
        { label: 'Expiring within 30 days', value: expiringSoon.length, warn: expiringSoon.length > 0 },
        { label: 'Renewal rate', value: renewalRate == null ? '—' : `${renewalRate}%` },
      ]} />
    </ReportShell>
  );
}

function ReportsPanel({ serviceCalls, serviceContracts, installationMilestones }) {
  return (
    <div className="flex flex-col gap-4">
      <MilestonesReport milestones={installationMilestones} />
      <ServiceCallsReport serviceCalls={serviceCalls} />
      <TechnicianReport serviceCalls={serviceCalls} />
      <ContractsReport serviceContracts={serviceContracts} />
    </div>
  );
}

// ---------- Workspace shell ----------

export default function InstallationWorkspace({ projects = [], serviceCalls = [], serviceContracts = [], installationMilestones = [], initialTab }) {
  const router = useRouter();
  const [tab, setTab] = useState(ITEMS.some(i => i.key === initialTab) ? initialTab : 'service_calls');

  return (
    <WorkspaceSidebar title="Installation" icon={MapPinIcon} items={ITEMS} activeKey={tab} onChange={setTab}>
      {tab === 'service_calls' && <ServiceCallsCard serviceCalls={serviceCalls} projects={projects} router={router} />}
      {tab === 'contracts' && <ServiceContractsCard serviceContracts={serviceContracts} projects={projects} router={router} />}
      {tab === 'reports' && <ReportsPanel serviceCalls={serviceCalls} serviceContracts={serviceContracts} installationMilestones={installationMilestones} />}
    </WorkspaceSidebar>
  );
}
