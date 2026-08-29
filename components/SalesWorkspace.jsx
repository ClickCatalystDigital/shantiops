'use client';

// components/SalesWorkspace.jsx — V3_CHANGES.md §12 Phase 2c. Leads | Customers | Quotations |
// Sale Orders | Campaigns, same multi-tab-in-one-file precedent as ProcurementWorkspace.jsx.
// Customer detail (contacts/addresses/notes) opens in a right-side Sheet, same drawer pattern
// HrWorkspace.jsx's employee detail uses.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import {
  PlusIcon, TrashIcon, UserPlusIcon, UsersIcon, FileTextIcon, ShoppingCartIcon,
  MegaphoneIcon, CheckSquareIcon, ContactIcon, MessageCircleIcon, MailIcon, TagIcon,
  InboxIcon, UndoIcon, IndianRupeeIcon, ReceiptIcon, DownloadIcon,
} from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

// ponytail: fixed 24h first-response SLA, not a configurable business-hours calendar like Frappe
// CRM's own SLA doctype (holiday list, service windows). Add a settings row for this if a real
// need for a different threshold or per-department SLA shows up.
const SLA_HOURS = 24;
function isSlaBreached(lead) {
  if (lead.status !== 'new') return false;
  return (Date.now() - new Date(lead.created_at).getTime()) / 36e5 > SLA_HOURS;
}

// WhatsApp/Email quick-links — wa.me and mailto: only. A real WhatsApp Business/email-sending
// integration (Frappe CRM's own Twilio/Exotel/WhatsApp integrations) is explicitly out of scope
// for now; this just opens WhatsApp Web / the user's mail client with the number/address
// pre-filled, same "link out, don't send from inside the app" scope as everywhere else in CRM.
function ContactLinks({ phone, email }) {
  if (!phone && !email) return null;
  const waNumber = phone ? phone.replace(/[^\d+]/g, '') : null;
  return (
    <div className="flex items-center gap-2">
      {waNumber && (
        <a href={`https://wa.me/${waNumber.replace(/^\+/, '')}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-success hover:underline" onClick={e => e.stopPropagation()}>
          <MessageCircleIcon className="size-3.5" />WhatsApp
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="inline-flex items-center gap-1 text-xs text-info hover:underline" onClick={e => e.stopPropagation()}>
          <MailIcon className="size-3.5" />Email
        </a>
      )}
    </div>
  );
}

// --- Notes / Call Log (shared across Lead/Opportunity/Customer detail views) ------------------

function NotesPanel({ leadId, opportunityId, customerId }) {
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState('');
  const [logCall, setLogCall] = useState(false);
  const [callType, setCallType] = useState('outgoing');
  const [durationMin, setDurationMin] = useState('');

  function load() {
    const q = leadId ? `lead_id=${leadId}` : opportunityId ? `opportunity_id=${opportunityId}` : `customer_id=${customerId}`;
    api(`/api/crm-notes?${q}`).then(setNotes).catch(() => {});
  }
  useEffect(load, [leadId, opportunityId, customerId]);

  async function addNote() {
    if (!note.trim()) return;
    try {
      await api('/api/crm-notes', { method: 'POST', body: {
        lead_id: leadId || null, opportunity_id: opportunityId || null, customer_id: customerId || null,
        content: note.trim(), note_type: logCall ? 'call' : 'note',
        call_type: logCall ? callType : undefined,
        duration_seconds: logCall && durationMin ? Number(durationMin) * 60 : undefined,
      } });
      setNote(''); setLogCall(false); setDurationMin(''); load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold">Notes / activity</div>
      <div className="flex flex-col gap-1.5">
        {notes.map(n => (
          <div key={n.id} className="rounded border px-2 py-1.5 text-sm">
            <span className="text-muted-foreground">
              {n.note_type}{n.note_type === 'call' && n.call_type ? ` (${n.call_type}${n.duration_seconds ? `, ${Math.round(n.duration_seconds / 60)}m` : ''})` : ''}:
            </span> {n.content}
          </div>
        ))}
        {notes.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Input placeholder={logCall ? 'What was discussed?' : 'Add a note'} value={note} onChange={e => setNote(e.target.value)} />
          <Button size="sm" onClick={addNote}><PlusIcon /></Button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={logCall} onChange={e => setLogCall(e.target.checked)} />
          Log as a call
        </label>
        {logCall && (
          <div className="flex gap-2">
            <Select value={callType} onValueChange={setCallType}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">Outgoing</SelectItem>
                <SelectItem value="incoming">Incoming</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Minutes" value={durationMin} onChange={e => setDurationMin(e.target.value)} className="w-28" />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tasks (shared across Lead/Opportunity detail views + its own sidebar panel) ---------------

// Exported so PipelineWorkspace.jsx's OpportunityDetailSheet can reuse it — same widget, just a
// different link column (opportunity_id instead of lead_id).
export function TasksPanel({ leadId, opportunityId, customerId, users = [] }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  function load() {
    const q = leadId ? `lead_id=${leadId}` : opportunityId ? `opportunity_id=${opportunityId}` : `customer_id=${customerId}`;
    api(`/api/crm-tasks?${q}`).then(setTasks).catch(() => {});
  }
  useEffect(load, [leadId, opportunityId, customerId]);

  async function addTask() {
    if (!title.trim() || !dueDate) return showToast('Task title and due date are required', 'error');
    try {
      await api('/api/crm-tasks', { method: 'POST', body: {
        lead_id: leadId || null, opportunity_id: opportunityId || null, customer_id: customerId || null,
        title: title.trim(), due_date: dueDate, assigned_to: assignedTo || null,
      } });
      setTitle(''); setDueDate(''); setAssignedTo(''); load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function toggleDone(task) {
    try {
      await api(`/api/crm-tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'open' : 'done' } });
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold">Tasks</div>
      <div className="flex flex-col gap-1.5">
        {tasks.map(t => (
          <label key={t.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
            <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleDone(t)} />
            <span className={t.status === 'done' ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>{t.title}</span>
            <span className="text-xs text-muted-foreground">{t.due_date}{t.assigned_to ? ` · ${t.assigned_to}` : ''}</span>
          </label>
        ))}
        {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input placeholder="Task" value={title} onChange={e => setTitle(e.target.value)} className="min-w-32 flex-1" />
        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-36" />
        {users.length > 0 && (
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Assign to…" /></SelectTrigger>
            <SelectContent>{users.map(u => <SelectItem key={u.username} value={u.username}>{u.display_name || u.username}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Button size="sm" onClick={addTask}><PlusIcon /></Button>
      </div>
    </div>
  );
}

// --- Leads --------------------------------------------------------------------------------------

function AddLeadDialog({ onClose, router }) {
  const [leadName, setLeadName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [territory, setTerritory] = useState('');
  const [industry, setIndustry] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!leadName.trim()) return showToast('Lead name is required', 'error');
    setSaving(true);
    try {
      await api('/api/leads', { method: 'POST', body: {
        lead_name: leadName.trim(), company_name: companyName || null, phone: phone || null,
        source: source || null, territory: territory || null, industry: industry || null,
      } });
      showToast('Lead added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Lead</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Lead / contact name</Label><Input value={leadName} onChange={e => setLeadName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Company (optional)</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Phone (optional)</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Source (optional)</Label><Input value={source} onChange={e => setSource(e.target.value)} placeholder="Website, referral, event…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Territory (optional)</Label><Input value={territory} onChange={e => setTerritory(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Industry (optional)</Label><Input value={industry} onChange={e => setIndustry(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Lead'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadDetailSheet({ lead, users, onClose, router }) {
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{lead.lead_name}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.company_name && <span>Company: {lead.company_name}</span>}
            {lead.source && <span>Source: {lead.source}</span>}
            {lead.territory && <span>Territory: {lead.territory}</span>}
            {lead.industry && <span>Industry: {lead.industry}</span>}
            {lead.assigned_to && <span>Assigned: {lead.assigned_to}</span>}
            <ContactLinks phone={lead.phone} email={lead.email} />
          </div>
          <TasksPanel leadId={lead.id} users={users} />
          <NotesPanel leadId={lead.id} />
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const LEAD_FILTER_DEFAULT = { status: 'all', source: 'all', search: '' };

// STERP "Sales Enquiry" (SYSTEM.md §5e) — a raw enquiry already IS a status='new' lead
// (isSlaBreached already special-cases it as the unactioned bucket); reuses this exact component
// under the Enquiry nav entry with initialStatus='new' rather than a second table/entity.
function LeadsTab({ leads, users, savedViews, router, initialStatus = 'all' }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ ...LEAD_FILTER_DEFAULT, status: initialStatus });
  const [views, setViews] = useState(savedViews);
  const [viewName, setViewName] = useState('');

  const sources = [...new Set(leads.map(l => l.source).filter(Boolean))];
  const filtered = leads.filter(l =>
    (filters.status === 'all' || l.status === filters.status) &&
    (filters.source === 'all' || l.source === filters.source) &&
    (!filters.search || l.lead_name.toLowerCase().includes(filters.search.toLowerCase()) || (l.company_name || '').toLowerCase().includes(filters.search.toLowerCase()))
  );

  async function convert(lead) {
    setBusyId(lead.id);
    try {
      await api(`/api/leads/${lead.id}/convert`, { method: 'POST', body: {} });
      showToast('Converted to Customer + Opportunity');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  async function saveView() {
    if (!viewName.trim()) return;
    try {
      const { id } = await api('/api/crm-saved-views', { method: 'POST', body: { entity: 'leads', name: viewName.trim(), filters, pinned: true } });
      setViews(prev => [{ id, name: viewName.trim(), filters, pinned: 1 }, ...prev]);
      setViewName('');
      showToast('View saved');
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Lead</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {views.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {views.map(v => (
              <Badge key={v.id} variant="secondary" className="cursor-pointer" onClick={() => setFilters({ ...LEAD_FILTER_DEFAULT, ...v.filters })}>{v.name}</Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search leads…" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} className="w-48" />
          <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {['new', 'contacted', 'qualified', 'converted', 'lost'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {sources.length > 0 && (
            <Select value={filters.source} onValueChange={v => setFilters(f => ({ ...f, source: v }))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Input placeholder="Save current filters as…" value={viewName} onChange={e => setViewName(e.target.value)} className="w-44" />
            <Button size="sm" variant="outline" onClick={saveView}>Save view</Button>
          </div>
        </div>
        {filtered.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No leads match.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead><TableHead>Assigned</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {filtered.map(l => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelected(l)}>
                  <TableCell className="font-medium">{l.lead_name}</TableCell>
                  <TableCell className="text-muted-foreground">{l.company_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{l.source || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={l.status === 'converted' ? 'default' : 'outline'}>{l.status}</Badge>
                      {isSlaBreached(l) && <Badge variant="destructive">SLA overdue</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.owner_dept}</TableCell>
                  <TableCell className="text-muted-foreground">{l.assigned_to || '—'}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {l.status !== 'converted' && (
                      <Button size="sm" variant="outline" disabled={busyId === l.id} onClick={() => convert(l)}>Convert</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddLeadDialog router={router} onClose={() => setDialogOpen(false)} />}
      {selected && <LeadDetailSheet lead={selected} users={users} router={router} onClose={() => setSelected(null)} />}
    </Card>
  );
}

// --- Customers ------------------------------------------------------------------------------------

function AddCustomerDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [gst, setGst] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/customers', { method: 'POST', body: { name: name.trim(), gst_no: gst || null, phone: phone || null } });
      showToast('Customer added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>GST No (optional)</Label><Input value={gst} onChange={e => setGst(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Phone (optional)</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Customer'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailSheet({ customerId, onClose, router }) {
  const [detail, setDetail] = useState(null);
  const [contactName, setContactName] = useState('');
  const [addrLine1, setAddrLine1] = useState('');
  const [note, setNote] = useState('');
  const [portalBusy, setPortalBusy] = useState(false);

  function load() {
    api(`/api/customers/${customerId}`).then(setDetail).catch(err => showToast(err.message, 'error'));
  }
  useEffect(load, [customerId]);

  async function togglePortal(enabled) {
    setPortalBusy(true);
    try {
      await api(`/api/customers/${customerId}/portal`, { method: 'POST', body: { enabled } });
      showToast(enabled ? 'Portal login created — credentials email sent' : 'Portal email turned off');
      load(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setPortalBusy(false); }
  }

  async function addContact() {
    if (!contactName.trim()) return;
    try {
      await api('/api/contacts', { method: 'POST', body: { customer_id: customerId, name: contactName.trim() } });
      setContactName(''); load(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function addAddress() {
    if (!addrLine1.trim()) return;
    try {
      await api('/api/addresses', { method: 'POST', body: { customer_id: customerId, line1: addrLine1.trim() } });
      setAddrLine1(''); load(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function addNote() {
    if (!note.trim()) return;
    try {
      await api('/api/crm-notes', { method: 'POST', body: { customer_id: customerId, content: note.trim() } });
      setNote(''); load(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader><SheetTitle>{detail ? detail.name : 'Loading…'}</SheetTitle></SheetHeader>
        {detail && (
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{detail.gst_no || 'No GST on file'}</span>
              <ContactLinks phone={detail.phone} email={detail.email} />
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Customer Portal</div>
              <div className="flex items-center gap-2">
                <Checkbox id={`portal-${detail.id}`} checked={!!detail.portal_enabled} disabled={portalBusy}
                  onCheckedChange={(v) => togglePortal(!!v)} />
                <Label htmlFor={`portal-${detail.id}`} className="font-normal text-xs">
                  {detail.portal_enabled
                    ? `Portal email on${detail.initial_email_sent_at ? ` — invited ${detail.initial_email_sent_at.slice(0, 10)}` : ''}`
                    : detail.portal_user_id
                      ? 'Portal login exists — email off'
                      : 'Not on the portal yet — enabling creates a login and emails setup instructions'}
                </Label>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Contacts</div>
              <div className="flex flex-col gap-1.5">
                {detail.contacts.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                    <span>{c.name}{c.phone ? ` · ${c.phone}` : ''}</span>
                    <ContactLinks phone={c.phone} email={c.email} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2"><Input placeholder="Contact name" value={contactName} onChange={e => setContactName(e.target.value)} /><Button size="sm" onClick={addContact}><PlusIcon /></Button></div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Addresses</div>
              <div className="flex flex-col gap-1.5">
                {detail.addresses.map(a => <div key={a.id} className="rounded border px-2 py-1.5 text-sm">{a.address_type}: {a.line1}</div>)}
              </div>
              <div className="mt-2 flex gap-2"><Input placeholder="Address line" value={addrLine1} onChange={e => setAddrLine1(e.target.value)} /><Button size="sm" onClick={addAddress}><PlusIcon /></Button></div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Notes</div>
              <div className="flex flex-col gap-1.5">
                {detail.notes.map(n => <div key={n.id} className="rounded border px-2 py-1.5 text-sm"><span className="text-muted-foreground">{n.note_type}:</span> {n.content}</div>)}
              </div>
              <div className="mt-2 flex gap-2"><Input placeholder="Add a note" value={note} onChange={e => setNote(e.target.value)} /><Button size="sm" onClick={addNote}><PlusIcon /></Button></div>
            </div>
          </div>
        )}
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function CustomersTab({ customers, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customers</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Customer</Button></CardAction>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No customers yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>GST No</TableHead><TableHead>Phone</TableHead></TableRow></TableHeader>
            <TableBody>
              {customers.map(c => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedId(c.id)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.gst_no || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddCustomerDialog router={router} onClose={() => setDialogOpen(false)} />}
      {selectedId && <CustomerDetailSheet customerId={selectedId} router={router} onClose={() => setSelectedId(null)} />}
    </Card>
  );
}

// --- Quotations -----------------------------------------------------------------------------------

// Exported so PipelineWorkspace.jsx's OpportunityDetailSheet can reuse it — a quotation created
// from an opportunity's own "Create Quotation" button carries opportunity_id, which is what lets
// the auto-advance-to-Quoted in app/api/quotations/route.js actually fire (it never did before:
// no UI path set opportunity_id, only a direct API call could).
// STERP "Price Lists" (SYSTEM.md §5e) — search-as-you-type over the Item Master catalog, same
// /api/items?search= idiom PrWorkspace/StoresWorkspace already each have their own copy of (not
// worth force-sharing across three different line shapes). Picking an item also looks up the
// matching price_lists rate (customer-specific first, else the default row) and auto-fills it —
// still a plain editable number afterward, never locked. Re-runs the lookup when the customer
// changes after an item is already picked, so picking item-then-customer works the same as
// customer-then-item.
function QuotationItemField({ item, customerId, onChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [priceHint, setPriceHint] = useState(null);

  async function lookupPrice(itemId, custId) {
    if (!itemId) { setPriceHint(null); return; }
    try {
      const match = await api(`/api/price-lists?item_id=${itemId}${custId ? `&customer_id=${custId}` : ''}`);
      if (match) { onChange({ rate: match.rate }); setPriceHint(match.customer_id ? 'the customer price list' : 'the default price list'); }
      else setPriceHint(null);
    } catch { /* best-effort — a quote can always be priced by hand */ }
  }

  async function onType(v) {
    onChange({ item_description: v, item_id: null });
    setPriceHint(null);
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setResults(rows);
      setOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }

  function pick(it) {
    onChange({ item_description: it.item_name, uom: it.uom || item.uom, item_id: it.id });
    setOpen(false);
    lookupPrice(it.id, customerId);
  }

  useEffect(() => { if (item.item_id) lookupPrice(item.item_id, customerId); }, [customerId]);

  return (
    <div className="relative flex-1">
      <Input placeholder="Description" value={item.item_description}
        onChange={e => onType(e.target.value)}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {priceHint && <p className="mt-1 text-xs text-success">Rate from {priceHint}</p>}
      {open && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.map(it => (
            <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">{it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewQuotationDialog({ customers, opportunityId = null, initialCustomerId = '', onClose, router }) {
  const [customerId, setCustomerId] = useState(initialCustomerId ? String(initialCustomerId) : '');
  const [taxPct, setTaxPct] = useState('18');
  const [items, setItems] = useState([{ item_description: '', qty: 1, uom: 'Nos', rate: 0, item_id: null }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, patch) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
  function addRow() { setItems(prev => [...prev, { item_description: '', qty: 1, uom: 'Nos', rate: 0, item_id: null }]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!customerId) return showToast('Customer is required', 'error');
    const cleanItems = items.filter(it => it.item_description.trim());
    if (!cleanItems.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      const res = await api('/api/quotations', {
        method: 'POST',
        body: { customer_id: customerId, opportunity_id: opportunityId, tax_pct: Number(taxPct) || 0, items: cleanItems },
      });
      showToast(`Quotation ${res.quotation_no} created`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Quotation</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Choose customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Line items</Label>
            {items.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <QuotationItemField item={it} customerId={customerId} onChange={patch => updateItem(i, patch)} />
                <Input placeholder="Qty" type="number" value={it.qty} onChange={e => updateItem(i, { qty: e.target.value })} className="w-20" />
                <Input placeholder="Rate" type="number" value={it.rate} onChange={e => updateItem(i, { rate: e.target.value })} className="w-32" />
                <Button size="sm" variant="ghost" onClick={() => removeRow(i)}><TrashIcon className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}><PlusIcon />Add line</Button>
          </div>
          <div className="grid gap-1.5 sm:w-40"><Label>GST %</Label><Input type="number" value={taxPct} onChange={e => setTaxPct(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create Quotation'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotationsTab({ quotations, customers, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rcmQuotation, setRcmQuotation] = useState(null);
  const [isReverseCharge, setIsReverseCharge] = useState(false);

  async function setStatus(q, status) {
    setBusyId(q.id);
    try {
      await api(`/api/quotations/${q.id}`, { method: 'PATCH', body: { status } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }
  async function convert(q) {
    setBusyId(q.id);
    try {
      const res = await api(`/api/quotations/${q.id}/convert`, { method: 'POST', body: {} });
      showToast(`Sale Order ${res.so_no} created`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }
  async function convertToInvoice(q, isReverseCharge = false) {
    setBusyId(q.id);
    try {
      const res = await api(`/api/quotations/${q.id}/convert-to-invoice`, { method: 'POST', body: { is_reverse_charge: isReverseCharge } });
      showToast(`Sales Invoice ${res.invoice_no} created`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); setRcmQuotation(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quotations</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Quotation</Button></CardAction>
      </CardHeader>
      <CardContent>
        {quotations.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No quotations yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Quotation No.</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {quotations.map(q => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">
                    <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{q.quotation_no}</a>
                  </TableCell>
                  <TableCell>{q.customer_name}</TableCell>
                  <TableCell className="tnum">{formatMoney(q.total)}</TableCell>
                  <TableCell>
                    <Select value={q.status} onValueChange={v => setStatus(q, v)} disabled={busyId === q.id}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['draft', 'sent', 'accepted', 'rejected', 'expired'].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {q.status === 'accepted' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={busyId === q.id} onClick={() => convert(q)}>Convert to SO</Button>
                        <Button size="sm" variant="outline" disabled={busyId === q.id} onClick={() => { setIsReverseCharge(false); setRcmQuotation(q); }}>Convert to Invoice</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <NewQuotationDialog customers={customers} router={router} onClose={() => setDialogOpen(false)} />}
      {rcmQuotation && (
        <Dialog open onOpenChange={o => !o && setRcmQuotation(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Convert {rcmQuotation.quotation_no} to Invoice</DialogTitle></DialogHeader>
            <div className="flex items-center gap-2">
              <Checkbox id="inv-rcm" checked={isReverseCharge} onCheckedChange={v => setIsReverseCharge(!!v)} />
              <Label htmlFor="inv-rcm" className="font-normal">Reverse charge (RCM) — customer self-assesses GST, we charge taxable value only</Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRcmQuotation(null)}>Cancel</Button>
              <Button onClick={() => convertToInvoice(rcmQuotation, isReverseCharge)} disabled={busyId === rcmQuotation.id}>
                {busyId === rcmQuotation.id ? 'Creating…' : 'Create Invoice'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// --- Sales Invoices + Credit Notes (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2) ---------------------

const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'];

function CreditNoteDialog({ invoice, onClose, router }) {
  const [reason, setReason] = useState('');
  const [items, setItems] = useState([{ item_description: '', amount: '' }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, patch) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function addRow() { setItems(prev => [...prev, { item_description: '', amount: '' }]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    const cleanItems = items.filter(it => it.item_description.trim() && it.amount !== '').map(it => ({ ...it, amount: Number(it.amount) }));
    if (!cleanItems.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      const res = await api(`/api/sales-invoices/${invoice.id}/credit-note`, { method: 'POST', body: { reason, items: cleanItems } });
      showToast(`Credit Note ${res.credit_note_no} created`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Credit Note against {invoice.invoice_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Reason</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <Label>Line items</Label>
            {items.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <Input placeholder="Description" value={it.item_description} onChange={e => updateItem(i, { item_description: e.target.value })} />
                <Input placeholder="Amount" type="number" value={it.amount} onChange={e => updateItem(i, { amount: e.target.value })} className="w-32" />
                <Button size="sm" variant="ghost" onClick={() => removeRow(i)}><TrashIcon className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}><PlusIcon />Add line</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create Credit Note'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoicesTab({ invoices, creditNotes, router }) {
  const [busyId, setBusyId] = useState(null);
  const [creditNoteFor, setCreditNoteFor] = useState(null);

  async function setStatus(inv, status) {
    setBusyId(inv.id);
    try {
      await api(`/api/sales-invoices/${inv.id}`, { method: 'PATCH', body: { status } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Sales Invoices</CardTitle></CardHeader>
        <CardContent>
          {invoices.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No invoices yet — convert an accepted Quotation from the Quotations tab.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice No.</TableHead><TableHead>Customer</TableHead><TableHead>Company</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {invoices.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoice_no}</TableCell>
                    <TableCell>{inv.customer_name}</TableCell>
                    <TableCell>{inv.company}</TableCell>
                    <TableCell className="tnum">{formatMoney(inv.total)}</TableCell>
                    <TableCell>
                      <Select value={inv.status} onValueChange={v => setStatus(inv, v)} disabled={busyId === inv.id}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{INVOICE_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/sales-invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />PDF</a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCreditNoteFor(inv)}>Credit Note</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Credit Notes</CardTitle></CardHeader>
        <CardContent>
          {creditNotes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No credit notes yet.</p> : (
            <div className="flex flex-col divide-y">
              {creditNotes.map(cn => (
                <div key={cn.id} className="flex justify-between py-2 text-sm">
                  <span>{cn.credit_note_no} — against {cn.invoice_no}{cn.reason ? ` (${cn.reason})` : ''}</span>
                  <span className="tnum font-medium">{formatMoney(cn.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {creditNoteFor && <CreditNoteDialog invoice={creditNoteFor} router={router} onClose={() => setCreditNoteFor(null)} />}
    </div>
  );
}

// --- Price Lists (STERP, SYSTEM.md §5e) ------------------------------------------------------------

// Same catalog search-as-you-type as QuotationItemField, minus the price lookup — this dialog IS
// where a rate gets entered, so there's nothing to auto-fill from.
function PriceListItemField({ value, onChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  async function onType(v) {
    onChange({ item_name: v, item_id: null });
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setResults(rows);
      setOpen(rows.length > 0);
    } catch { /* catalog search is best-effort */ }
  }
  function pick(it) {
    onChange({ item_name: it.item_name, item_id: it.id, uom: it.uom || '' });
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input placeholder="Search the item catalog" value={value.item_name}
        onChange={e => onType(e.target.value)}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.map(it => (
            <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">{it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPriceListDialog({ customers, onClose, router }) {
  const [item, setItem] = useState({ item_name: '', item_id: null, uom: '' });
  const [customerId, setCustomerId] = useState('__all__');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!item.item_id) return showToast('Pick an item from the catalog', 'error');
    if (!(Number(rate) > 0)) return showToast('Rate must be a positive number', 'error');
    setSaving(true);
    try {
      await api('/api/price-lists', {
        method: 'POST',
        body: {
          item_id: item.item_id, customer_id: customerId === '__all__' ? null : customerId,
          rate: Number(rate), uom: item.uom || null, valid_from: validFrom || null, valid_until: validUntil || null,
          notes: notes.trim() || null,
        },
      });
      showToast('Price added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Price</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Item</Label>
            <PriceListItemField value={item} onChange={patch => setItem(prev => ({ ...prev, ...patch }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All customers (default rate)</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Rate</Label><Input type="number" value={rate} onChange={e => setRate(e.target.value)} autoFocus={!!item.item_id} /></div>
            <div className="grid gap-1.5"><Label>UoM</Label><Input value={item.uom} onChange={e => setItem(prev => ({ ...prev, uom: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Valid from (optional)</Label><Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Valid until (optional)</Label><Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Notes (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Price'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceListRow({ pl, router }) {
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const expired = pl.valid_until && pl.valid_until < today;

  async function remove() {
    if (!window.confirm(`Remove this price for ${pl.item_name}?`)) return;
    setBusy(true);
    try {
      await api(`/api/price-lists/${pl.id}`, { method: 'DELETE' });
      showToast('Price removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {pl.item_name}
        {pl.item_code && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{pl.item_code}</span>}
      </TableCell>
      <TableCell>{pl.customer_name || <Badge variant="outline">All customers</Badge>}</TableCell>
      <TableCell className="tnum">{formatMoney(pl.rate)}{pl.uom ? `/${pl.uom}` : ''}</TableCell>
      <TableCell className="text-muted-foreground">
        {pl.valid_from || '—'} – {pl.valid_until || 'open'}
        {expired && <Badge variant="destructive" className="ml-1.5">Expired</Badge>}
      </TableCell>
      <TableCell><Button size="icon-sm" variant="ghost" disabled={busy} onClick={remove}><TrashIcon className="size-4" /></Button></TableCell>
    </TableRow>
  );
}

function PriceListsTab({ priceLists, customers, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Price Lists</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Price</Button></CardAction>
      </CardHeader>
      <CardContent>
        {priceLists.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No prices set yet — quotations fall back to a manually typed rate.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Customer</TableHead><TableHead>Rate</TableHead><TableHead>Validity</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{priceLists.map(pl => <PriceListRow key={pl.id} pl={pl} router={router} />)}</TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddPriceListDialog customers={customers} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// --- Sale Orders (existing, extended with status) --------------------------------------------------

function AddSaleOrderDialog({ onClose, router }) {
  const [customerName, setCustomerName] = useState('');
  const [description, setDescription] = useState('');
  const [company, setCompany] = useState('Shanti Boilers');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api('/api/sale-orders', { method: 'POST', body: { customer_name: customerName.trim() || null, description: description.trim() || null, company } });
      showToast('Sale Order added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Sale Order</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Customer (optional)</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Description (optional)</Label><Input value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label>Company — which entity is contracting this order</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Shanti Boilers">Shanti Boilers</SelectItem>
                <SelectItem value="Shanti Techno Fab">Shanti Techno Fab</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Sale Order'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A quotation-converted Sale Order always defaults to Shanti Boilers (the convert endpoint has no
// UI passing a choice) — this is what fixes a wrongly-defaulted one after the fact.
function SoCompanyCell({ so, router }) {
  const [saving, setSaving] = useState(false);
  async function change(company) {
    setSaving(true);
    try {
      await api(`/api/sale-orders/${so.id}`, { method: 'PATCH', body: { company } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }
  return (
    <Select value={so.company || 'Shanti Boilers'} onValueChange={change} disabled={saving}>
      <SelectTrigger className="h-7 w-40 border-transparent bg-transparent text-muted-foreground hover:border-input">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="Shanti Boilers">Shanti Boilers</SelectItem>
        <SelectItem value="Shanti Techno Fab">Shanti Techno Fab</SelectItem>
      </SelectContent>
    </Select>
  );
}

// STORES-SALES-CHANGES.md §2b/§4 — the SAS "push to Stores" Sales was missing: same source='sas'
// PR line Stores already raises against a Sale Order (app/api/purchase-requisitions/route.js),
// just initiated from Sales' own side instead.
function RequestFromStoresDialog({ so, onClose, router }) {
  const [description, setDescription] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!description.trim() || !qtyText.trim()) return showToast('Description and quantity are required', 'error');
    setSaving(true);
    try {
      await api('/api/purchase-requisitions', {
        method: 'POST',
        body: { raised_by_dept: 'Sales', lines: [{ source: 'sas', material_description: description.trim(), sale_order_no: so.so_no, qty_text: qtyText.trim() }] },
      });
      showToast('Request sent to Stores');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request material from Stores for {so.so_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Item description *</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="MS Plate 6mm" autoFocus /></div>
          <div className="grid gap-1.5"><Label>Quantity *</Label><Input value={qtyText} onChange={e => setQtyText(e.target.value)} placeholder="4 Nos" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Sending…' : 'Send to Stores'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// STERP "Sales Costing" (SYSTEM.md §5e) — post-sale only, real numbers: actual issued-PO spend +
// actual labor cost against the Project vs. the Sale Order's quoted total. Only ever shown once a
// Project exists (the button below is gated on so.project_id) — there's no honest cost data before
// that point, see lib/data.js's getProjectCosting comment.
function CostingSheet({ so, onClose }) {
  const [costing, setCosting] = useState(null);
  useEffect(() => { api(`/api/projects/${so.project_id}/costing`).then(setCosting).catch(() => {}); }, [so.project_id]);

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>Costing — {so.so_no}</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {!costing ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Quoted value</span><span className="tnum font-medium">{formatMoney(costing.sellingValue)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Material cost (issued POs)</span><span className="tnum">{formatMoney(costing.materialCost)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Labor cost (job-card time logs)</span><span className="tnum">{formatMoney(costing.laborCost)}</span></div>
              <div className="flex justify-between border-t pt-2 text-sm font-medium"><span>Total actual cost</span><span className="tnum">{formatMoney(costing.totalCost)}</span></div>
              <div className={`flex justify-between text-sm font-semibold ${costing.margin < 0 ? 'text-destructive' : 'text-success'}`}>
                <span>Margin</span><span className="tnum">{formatMoney(costing.margin)}{costing.marginPct != null ? ` (${costing.marginPct}%)` : ''}</span>
              </div>
              <p className="text-xs text-muted-foreground">Actual cost only — draft/cancelled POs and un-logged labor aren't counted. Updates live as Procurement issues POs and Production logs time.</p>
            </>
          )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button asChild variant="outline">
            <a href={`/api/projects/${so.project_id}/costing-pdf`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Convert-to-Project used to live here (STORES-SALES-CHANGES.md §2b/§4) but was only reachable by
// a Design head who also held Sales/Marketing access — /sales itself is gated on those departments,
// so a Design-only head (the common case) could never reach it despite the button/API both being
// gated on isDesignHead. Moved to Design's own Projects tab (ConvertSaleOrderButton.jsx), the
// surface every Design head can actually reach; not duplicated here.
function SaleOrdersTab({ saleOrders, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sasSo, setSasSo] = useState(null);
  const [costingSo, setCostingSo] = useState(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sale Orders</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Sale Order</Button></CardAction>
      </CardHeader>
      <CardContent>
        {saleOrders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No Sale Orders yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>SO No.</TableHead><TableHead>Customer</TableHead><TableHead>Company</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {saleOrders.map(so => (
                <TableRow key={so.id}>
                  <TableCell className="font-medium">{so.so_no}</TableCell>
                  <TableCell>{so.customer_name || '—'}</TableCell>
                  <TableCell><SoCompanyCell so={so} router={router} /></TableCell>
                  <TableCell className="tnum">{so.total ? formatMoney(so.total) : '—'}</TableCell>
                  <TableCell><Badge variant={so.status === 'open' ? 'outline' : 'default'}>{so.status || 'open'}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(so.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    {so.project_id && <Button size="sm" variant="outline" onClick={() => setCostingSo(so)}><IndianRupeeIcon />Costing</Button>}
                    <Button size="sm" variant="outline" onClick={() => setSasSo(so)}>Request from Stores</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddSaleOrderDialog router={router} onClose={() => setDialogOpen(false)} />}
      {sasSo && <RequestFromStoresDialog so={sasSo} router={router} onClose={() => setSasSo(null)} />}
      {costingSo && <CostingSheet so={costingSo} onClose={() => setCostingSo(null)} />}
    </Card>
  );
}

// --- Returns (STERP, SYSTEM.md §5e) ----------------------------------------------------------------

function AddReturnDialog({ saleOrders, onClose, router }) {
  const [soId, setSoId] = useState('');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!soId) return showToast('Sale Order is required', 'error');
    if (!description.trim()) return showToast('Item description is required', 'error');
    if (!(Number(qty) > 0)) return showToast('Quantity must be a positive number', 'error');
    setSaving(true);
    try {
      await api('/api/sales-returns', {
        method: 'POST',
        body: { sale_order_id: soId, item_description: description.trim(), qty: Number(qty), reason: reason.trim() || null },
      });
      showToast('Return raised');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a Return</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Sale Order</Label>
            <Select value={soId} onValueChange={setSoId}>
              <SelectTrigger><SelectValue placeholder="Choose Sale Order" /></SelectTrigger>
              <SelectContent>{saleOrders.map(so => <SelectItem key={so.id} value={String(so.id)}>{so.so_no}{so.customer_name ? ` · ${so.customer_name}` : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Item description</Label><Input value={description} onChange={e => setDescription(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5 sm:w-32"><Label>Quantity</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Damaged in transit, wrong item, customer changed spec…" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Raise Return'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOME_TONE = { pending: 'outline', accepted: 'default', rejected: 'destructive' };

function ReturnRow({ ret, inventoryItems, router }) {
  const [busy, setBusy] = useState(false);
  const [invPick, setInvPick] = useState(ret.inventory_item_id ? String(ret.inventory_item_id) : '');
  const [creditRef, setCreditRef] = useState(ret.credit_note_ref || '');

  async function patch(body) {
    setBusy(true);
    try {
      await api(`/api/sales-returns/${ret.id}`, { method: 'PATCH', body });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{ret.so_no}<div className="text-xs font-normal text-muted-foreground">{ret.customer_name}</div></TableCell>
      <TableCell>{ret.item_description}<div className="text-xs text-muted-foreground">{ret.reason || '—'}</div></TableCell>
      <TableCell className="tnum">{ret.qty}</TableCell>
      <TableCell>
        <Select value={ret.inspection_outcome} onValueChange={v => patch({ inspection_outcome: v })} disabled={busy}>
          <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['pending', 'accepted', 'rejected'].map(s => <SelectItem key={s} value={s}><Badge variant={OUTCOME_TONE[s]}>{s}</Badge></SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {ret.inspection_outcome === 'accepted' ? (
          ret.stock_action === 'returned_to_stock' ? (
            <span className="text-xs text-success">Restocked — {ret.inventory_description || '—'}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={invPick} onValueChange={setInvPick} disabled={busy}>
                <SelectTrigger className="h-7 w-40"><SelectValue placeholder="Inventory item…" /></SelectTrigger>
                <SelectContent>{inventoryItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={busy || !invPick} onClick={() => patch({ stock_action: 'returned_to_stock', inventory_item_id: invPick })}>Restock</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ stock_action: 'scrapped' })}>Scrap</Button>
            </div>
          )
        ) : <span className="text-xs text-muted-foreground">{ret.stock_action === 'scrapped' ? 'Scrapped' : '—'}</span>}
      </TableCell>
      <TableCell>
        <Input value={creditRef} onChange={e => setCreditRef(e.target.value)} onBlur={() => creditRef !== (ret.credit_note_ref || '') && patch({ credit_note_ref: creditRef })}
          placeholder="Credit note #" className="h-7 w-32" disabled={busy} />
      </TableCell>
    </TableRow>
  );
}

function ReturnsTab({ returns, saleOrders, inventoryItems, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Returns</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />Raise Return</Button></CardAction>
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No returns raised yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Sale Order</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Inspection</TableHead><TableHead>Stock action</TableHead><TableHead>Credit note</TableHead></TableRow></TableHeader>
            <TableBody>{returns.map(r => <ReturnRow key={r.id} ret={r} inventoryItems={inventoryItems} router={router} />)}</TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddReturnDialog saleOrders={saleOrders} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// --- Campaigns -------------------------------------------------------------------------------------

function AddCampaignDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/campaigns', { method: 'POST', body: { name: name.trim() } });
      showToast('Campaign added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
        <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Campaign'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignsTab({ campaigns, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Campaign</Button></CardAction>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No campaigns yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{c.owner_dept}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddCampaignDialog router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// --- Tasks (sidebar panel — every CRM task across leads/opportunities/customers) ---------------

function AllTasksTab({ users }) {
  const [tasks, setTasks] = useState([]);
  const [showDone, setShowDone] = useState(false);

  function load() { api('/api/crm-tasks').then(setTasks).catch(() => {}); }
  useEffect(load, []);

  async function toggleDone(task) {
    try {
      await api(`/api/crm-tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'open' : 'done' } });
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const visible = tasks.filter(t => showDone || t.status !== 'done');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardAction>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            Show done
          </label>
        </CardAction>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No tasks.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead /><TableHead>Task</TableHead><TableHead>On</TableHead><TableHead>Due</TableHead><TableHead>Assigned</TableHead></TableRow></TableHeader>
            <TableBody>
              {visible.map(t => (
                <TableRow key={t.id}>
                  <TableCell><input type="checkbox" checked={t.status === 'done'} onChange={() => toggleDone(t)} /></TableCell>
                  <TableCell className={t.status === 'done' ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</TableCell>
                  <TableCell className="text-muted-foreground">{t.lead_name || t.opportunity_title || t.customer_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{t.due_date}</TableCell>
                  <TableCell className="text-muted-foreground">{t.assigned_to || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Team (Assignment Rule config — round-robin usernames per department, dept-scoped edit) ----

function TeamTab({ users, departments }) {
  const [rules, setRules] = useState({});
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);

  function load() {
    api('/api/assignment-rules').then(rows => {
      const byDept = Object.fromEntries(rows.map(r => [r.owner_dept, r]));
      setRules(byDept);
      setDrafts(Object.fromEntries(CRM_DEPARTMENTS.map(d => [d, (byDept[d]?.usernames || []).join(', ')])));
    }).catch(() => {});
  }
  useEffect(load, []);

  async function save(dept) {
    setSaving(dept);
    try {
      const usernames = drafts[dept].split(',').map(s => s.trim()).filter(Boolean);
      await api('/api/assignment-rules', { method: 'PUT', body: { owner_dept: dept, usernames } });
      showToast('Assignment rule saved');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(null); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Team</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-5">
        {CRM_DEPARTMENTS.filter(d => departments.includes(d)).map(dept => (
          <div key={dept} className="flex flex-col gap-1.5">
            <Label>{dept} — new leads round-robin to (usernames, comma-separated)</Label>
            <div className="flex gap-2">
              <Input value={drafts[dept] ?? ''} onChange={e => setDrafts(prev => ({ ...prev, [dept]: e.target.value }))} placeholder="e.g. jdoe, asmith" />
              <Button size="sm" variant="outline" onClick={() => save(dept)} disabled={saving === dept}>{saving === dept ? 'Saving…' : 'Save'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {users.filter(u => u.departments.includes(dept)).length} {dept} head{users.filter(u => u.departments.includes(dept)).length === 1 ? '' : 's'} available. Leave blank to stop auto-assigning.
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

// -----------------------------------------------------------------------------------------------

// Same sidebar-workspace pattern as components/CalcWorkspace.jsx — a flat PANELS array (no
// groups needed here, unlike Calc's Engineering/Governance/Drawings sections) filtered by
// department instead of grouped, same shadcn Sidebar primitives, same local-state active-panel
// mechanism as the Tabs it replaces.
const PANELS = [
  { key: 'enquiry', label: 'Enquiry', icon: InboxIcon, description: 'New, not-yet-qualified enquiries', salesOnly: false },
  { key: 'leads', label: 'Leads', icon: UserPlusIcon, description: 'Prospects not yet qualified', salesOnly: false },
  { key: 'customers', label: 'Customers', icon: UsersIcon, description: 'Accounts, contacts and addresses', salesOnly: true },
  { key: 'quotations', label: 'Quotations', icon: FileTextIcon, description: 'Proposals sent to customers', salesOnly: true },
  { key: 'price_lists', label: 'Price Lists', icon: TagIcon, description: 'Customer/product rates and validity', salesOnly: true },
  { key: 'sale_orders', label: 'Sale Orders', icon: ShoppingCartIcon, description: 'Accepted orders', salesOnly: true },
  { key: 'invoices', label: 'Invoices', icon: ReceiptIcon, description: 'Sales Invoices and Credit Notes', salesOnly: true },
  { key: 'returns', label: 'Returns', icon: UndoIcon, description: 'Returned material against a Sale Order', salesOnly: true },
  { key: 'campaigns', label: 'Campaigns', icon: MegaphoneIcon, description: 'Marketing initiatives', salesOnly: false },
  { key: 'tasks', label: 'Tasks', icon: CheckSquareIcon, description: 'Every to-do across leads, deals and customers', salesOnly: false },
  { key: 'team', label: 'Team', icon: ContactIcon, description: 'Auto-assign new leads round-robin', salesOnly: false },
];

export default function SalesWorkspace({ saleOrders, leads, customers, quotations, campaigns, priceLists = [], returns = [], inventoryItems = [], invoices = [], creditNotes = [], departments = ['Sales', 'Marketing'], users = [], savedViews = [] }) {
  const router = useRouter();
  const [panel, setPanel] = useState('leads');
  // Customers/Quotations/Sale Orders are the commercial fulfilment chain — Sales-owned. Marketing
  // shares Leads/Campaigns/Reports (both departments feed the pipeline) but doesn't manage orders.
  const inSales = departments.includes('Sales');
  const items = PANELS.filter(p => !p.salesOnly || inSales);
  const activePanel = items.find(p => p.key === panel) || items[0];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-2 px-3 py-3.5 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <MegaphoneIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              {inSales ? 'Sales' : 'Marketing'}
            </div>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:hidden" />
          </div>
          <div className="hidden justify-center group-data-[collapsible=icon]:flex">
            <SidebarTrigger aria-label="Expand Sales or Marketing sidebar" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map(p => (
                  <SidebarMenuItem key={p.key}>
                    <SidebarMenuButton isActive={activePanel.key === p.key} tooltip={p.label} onClick={() => setPanel(p.key)}>
                      <p.icon />
                      <span>{p.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-3.5">
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-5 md:hidden" />
          <activePanel.icon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">{activePanel.label}</h1>
            <p className="text-xs text-muted-foreground">{activePanel.description}</p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {activePanel.key === 'enquiry' && <LeadsTab leads={leads} users={users} savedViews={savedViews} router={router} initialStatus="new" />}
          {activePanel.key === 'leads' && <LeadsTab leads={leads} users={users} savedViews={savedViews} router={router} />}
          {activePanel.key === 'customers' && <CustomersTab customers={customers} router={router} />}
          {activePanel.key === 'quotations' && <QuotationsTab quotations={quotations} customers={customers} router={router} />}
          {activePanel.key === 'price_lists' && <PriceListsTab priceLists={priceLists} customers={customers} router={router} />}
          {activePanel.key === 'sale_orders' && <SaleOrdersTab saleOrders={saleOrders} router={router} />}
          {activePanel.key === 'invoices' && <InvoicesTab invoices={invoices} creditNotes={creditNotes} router={router} />}
          {activePanel.key === 'returns' && <ReturnsTab returns={returns} saleOrders={saleOrders} inventoryItems={inventoryItems} router={router} />}
          {activePanel.key === 'campaigns' && <CampaignsTab campaigns={campaigns} router={router} />}
          {activePanel.key === 'tasks' && <AllTasksTab users={users} />}
          {activePanel.key === 'team' && <TeamTab users={users} departments={departments} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
