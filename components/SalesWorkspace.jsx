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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import {
  PlusIcon, TrashIcon, UserPlusIcon, UsersIcon, FileTextIcon, ShoppingCartIcon,
  MegaphoneIcon, CheckSquareIcon, ContactIcon, MessageCircleIcon, MailIcon,
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

function LeadsTab({ leads, users, savedViews, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(LEAD_FILTER_DEFAULT);
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

  function load() {
    api(`/api/customers/${customerId}`).then(setDetail).catch(err => showToast(err.message, 'error'));
  }
  useEffect(load, [customerId]);

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

function NewQuotationDialog({ customers, onClose, router }) {
  const [customerId, setCustomerId] = useState('');
  const [taxPct, setTaxPct] = useState('18');
  const [items, setItems] = useState([{ item_description: '', qty: 1, uom: 'Nos', rate: 0 }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, key, val) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: val } : it));
  }
  function addRow() { setItems(prev => [...prev, { item_description: '', qty: 1, uom: 'Nos', rate: 0 }]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!customerId) return showToast('Customer is required', 'error');
    const cleanItems = items.filter(it => it.item_description.trim());
    if (!cleanItems.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      const res = await api('/api/quotations', { method: 'POST', body: { customer_id: customerId, tax_pct: Number(taxPct) || 0, items: cleanItems } });
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
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Description" value={it.item_description} onChange={e => updateItem(i, 'item_description', e.target.value)} className="flex-1" />
                <Input placeholder="Qty" type="number" value={it.qty} onChange={e => updateItem(i, 'qty', e.target.value)} className="w-20" />
                <Input placeholder="Rate" type="number" value={it.rate} onChange={e => updateItem(i, 'rate', e.target.value)} className="w-32" />
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
                    {q.status === 'accepted' && <Button size="sm" variant="outline" disabled={busyId === q.id} onClick={() => convert(q)}>Convert to SO</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <NewQuotationDialog customers={customers} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// --- Sale Orders (existing, extended with status) --------------------------------------------------

function AddSaleOrderDialog({ onClose, router }) {
  const [soNo, setSoNo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!soNo.trim()) return showToast('Sale Order number is required', 'error');
    setSaving(true);
    try {
      await api('/api/sale-orders', { method: 'POST', body: { so_no: soNo.trim(), customer_name: customerName.trim() || null, description: description.trim() || null } });
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
          <div className="grid gap-1.5"><Label>Sale Order number</Label><Input value={soNo} onChange={e => setSoNo(e.target.value)} placeholder="SO-1042" autoFocus /></div>
          <div className="grid gap-1.5"><Label>Customer (optional)</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Description (optional)</Label><Input value={description} onChange={e => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Sale Order'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaleOrdersTab({ saleOrders, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sale Orders</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Sale Order</Button></CardAction>
      </CardHeader>
      <CardContent>
        {saleOrders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No Sale Orders yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>SO No.</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {saleOrders.map(so => (
                <TableRow key={so.id}>
                  <TableCell className="font-medium">{so.so_no}</TableCell>
                  <TableCell>{so.customer_name || '—'}</TableCell>
                  <TableCell className="tnum">{so.total ? formatMoney(so.total) : '—'}</TableCell>
                  <TableCell><Badge variant={so.status === 'open' ? 'outline' : 'default'}>{so.status || 'open'}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(so.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddSaleOrderDialog router={router} onClose={() => setDialogOpen(false)} />}
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
  { key: 'leads', label: 'Leads', icon: UserPlusIcon, description: 'Prospects not yet qualified', salesOnly: false },
  { key: 'customers', label: 'Customers', icon: UsersIcon, description: 'Accounts, contacts and addresses', salesOnly: true },
  { key: 'quotations', label: 'Quotations', icon: FileTextIcon, description: 'Proposals sent to customers', salesOnly: true },
  { key: 'sale_orders', label: 'Sale Orders', icon: ShoppingCartIcon, description: 'Accepted orders', salesOnly: true },
  { key: 'campaigns', label: 'Campaigns', icon: MegaphoneIcon, description: 'Marketing initiatives', salesOnly: false },
  { key: 'tasks', label: 'Tasks', icon: CheckSquareIcon, description: 'Every to-do across leads, deals and customers', salesOnly: false },
  { key: 'team', label: 'Team', icon: ContactIcon, description: 'Auto-assign new leads round-robin', salesOnly: false },
];

export default function SalesWorkspace({ saleOrders, leads, customers, quotations, campaigns, departments = ['Sales', 'Marketing'], users = [], savedViews = [] }) {
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
          {activePanel.key === 'leads' && <LeadsTab leads={leads} users={users} savedViews={savedViews} router={router} />}
          {activePanel.key === 'customers' && <CustomersTab customers={customers} router={router} />}
          {activePanel.key === 'quotations' && <QuotationsTab quotations={quotations} customers={customers} router={router} />}
          {activePanel.key === 'sale_orders' && <SaleOrdersTab saleOrders={saleOrders} router={router} />}
          {activePanel.key === 'campaigns' && <CampaignsTab campaigns={campaigns} router={router} />}
          {activePanel.key === 'tasks' && <AllTasksTab users={users} />}
          {activePanel.key === 'team' && <TeamTab users={users} departments={departments} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
