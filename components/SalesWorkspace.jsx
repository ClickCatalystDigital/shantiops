'use client';

// components/SalesWorkspace.jsx — V3_CHANGES.md §12 Phase 2c. Leads | Customers | Quotations |
// Sale Orders | Campaigns, same multi-tab-in-one-file precedent as ProcurementWorkspace.jsx.
// Customer detail (contacts/addresses/notes) opens in a right-side Sheet, same drawer pattern
// HrWorkspace.jsx's employee detail uses.
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import SearchableSelect from '@/components/SearchableSelect';
import { PRODUCT_TYPES } from '@/lib/sales-product-types';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import {
  PlusIcon, TrashIcon, UserPlusIcon, UsersIcon, FileTextIcon, ShoppingCartIcon,
  CheckSquareIcon, ContactIcon, MessageCircleIcon, MailIcon, TagIcon,
  InboxIcon, UndoIcon, IndianRupeeIcon, ReceiptIcon, DownloadIcon, UploadIcon, FileCheckIcon,
  WalletIcon, ClipboardListIcon, BanknoteIcon, Building2Icon, PackageIcon, TargetIcon, StarIcon,
  PencilIcon,
} from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/format';
import { quotationFollowupReason, REMINDER_LABELS } from '@/lib/quotation-reminders.mjs';
import ScopeOfSupplySection from '@/components/ScopeOfSupplySection';
import { PaymentOrdersTab, PaymentLogTab, Pager, SIZES } from '@/components/SalesPaymentTracker';
import { CreatePoFlow } from '@/components/SaleOrderWizard';
import ProductSearchField from '@/components/ProductSearchField';
import CustomerPicker from '@/components/CustomerPicker';
import { defaultCompanyClient } from '@/lib/company-filter.mjs';
import { useLeadConvert, SimilarCustomersHint, useSimilarCustomers } from '@/components/ConvertLeadChoice';
import { renderTemplate } from '@/lib/email-template.mjs';
import { DEFAULT_STAGE, isEnquiryStage, isSlaBreached } from '@/lib/lead-stage.mjs';
import { QTY_UNITS } from '@/lib/qty-units.mjs';
import { lineAmount, quotationTotals } from '@/lib/sales-lines.mjs';

// First-response SLA (24h, untouched since creation) lives in lib/lead-stage.mjs with the rest of
// the stage rules, so this list and the reports can never disagree. ponytail: fixed 24h, not a
// configurable business-hours calendar — add a settings row if a real need shows up.

// The funnel stage is the only status a user sees or sets (docs/sales-crm-plan.md 1a).
function StageBadge({ lead, stages }) {
  const s = stages.find(x => x.name === lead.sales_call_status);
  const variant = s?.is_won ? 'default' : s?.is_lost ? 'destructive' : 'outline';
  return <Badge variant={variant}>{lead.sales_call_status || DEFAULT_STAGE}</Badge>;
}

// Moves an enquiry through the funnel. Order Received / Order Lost stay on their own actions
// (Create PO / Order Lost), which also record the order or the reason.
function StageSelect({ lead, stages, router }) {
  const [saving, setSaving] = useState(false);
  const choosable = stages.filter(s => !s.is_won && s.name !== 'Order Lost');
  async function change(v) {
    if (v === lead.sales_call_status) return;
    setSaving(true);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { sales_call_status: v } });
      showToast(`Stage: ${v}`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  const current = lead.sales_call_status || DEFAULT_STAGE;
  const inList = choosable.some(s => s.name === current);
  return (
    <Select value={current} onValueChange={change} disabled={saving}>
      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
      <SelectContent>
        {!inList && <SelectItem value={current} disabled>{current}</SelectItem>}
        {choosable.map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
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

function NotesPanel({ leadId, lead, opportunityId, customerId, users = [], salesProducts = [], router, autoOpenDiary = false }) {
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState('');
  const [logCall, setLogCall] = useState(false);
  const [callType, setCallType] = useState('outgoing');
  const [durationMin, setDurationMin] = useState('');
  // Home calendar's Update Now/Advanced Update (Phase 4) land here already asking for the diary
  // form open — same deep-link intent as ?highlight, just for an action instead of a scroll target.
  const [diaryOpen, setDiaryOpen] = useState(autoOpenDiary);

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
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Notes / activity</div>
        {lead && <Button size="sm" variant="outline" onClick={() => setDiaryOpen(true)}>Add to Diary</Button>}
      </div>
      <div className="flex flex-col gap-1.5">
        {notes.map(n => (
          <div key={n.id} className="rounded border px-2 py-1.5 text-sm">
            <span className="text-muted-foreground">
              {n.note_type}{n.note_type === 'call' && n.call_type ? ` (${n.call_type}${n.duration_seconds ? `, ${Math.round(n.duration_seconds / 60)}m` : ''})` : ''}:
            </span> {n.content}
            <DiarySummaryTooltip note={n} />
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
      {diaryOpen && lead && (
        <AddToDiaryDialog lead={lead} users={users} salesProducts={salesProducts} router={router}
          onClose={() => setDiaryOpen(false)} onSaved={load} />
      )}
    </div>
  );
}

// Compact follow-up summary — reused wherever the checklist calls for it: NotesPanel (here), the
// Funnel Report drill-down, and the Home calendar overlay (Phase 4/5).
export function DiarySummaryTooltip({ note }) {
  if (!note.next_plan_date && !note.plan_of_action) return null;
  return (
    <div className="mt-1 rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      {note.next_plan_date && <span>Next follow-up: {note.next_plan_date}{note.plan_time ? ` ${note.plan_time}` : ''}. </span>}
      {note.plan_for && <span>For: {note.plan_for}. </span>}
      {note.plan_of_action && <span>{note.plan_of_action}</span>}
    </div>
  );
}

// Diary (Phase 1) — the legacy "Update Sales Call Section" form, 3 fieldsets, reusing crm_notes
// (not a new entity). Lead-only (a Diary entry logs field-sales activity against a Lead/Enquiry).
export function AddToDiaryDialog({ lead, users, salesProducts, onClose, onSaved, router }) {
  const [f, setF] = useState({
    visit_date: todayISO(), note_type: 'call', is_value_addition: false, action_taken: '',
    in_time: '', out_time: '', alert_mode: 'Not Required', plan_date: '', plan_time: '',
    plan_for: '', plan_of_action: '', plan_note_type: '', send_alert_sms: 'No Alert', contact_id: '', product: '', product_id: null,
    location: '', alert_users: [],
  });
  const [contacts, setContacts] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));
  const setText = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));

  useEffect(() => {
    if (!lead.converted_customer_id) return;
    api(`/api/contacts?customer_id=${lead.converted_customer_id}`).then(setContacts).catch(() => {});
  }, [lead.converted_customer_id]);

  async function save() {
    if (!f.action_taken.trim()) return showToast('Action Taken is required', 'error');
    setSaving(true);
    try {
      const { id: noteId } = await api('/api/crm-notes', { method: 'POST', body: {
        lead_id: lead.id, content: f.action_taken.trim(), note_type: f.note_type,
        visit_date: f.visit_date, action_taken: f.action_taken.trim(),
        is_value_addition: f.is_value_addition, in_time: f.in_time || null, out_time: f.out_time || null,
        alert_mode: f.alert_mode, alert_users: f.alert_mode === 'Selected seniors' ? f.alert_users : [], plan_date: f.plan_date || null, plan_time: f.plan_time || null,
        plan_for: f.plan_for || null, plan_of_action: f.plan_of_action || null, plan_note_type: f.plan_note_type || null,
        next_plan_date: f.plan_date || null, send_alert_sms: f.send_alert_sms,
        contact_id: f.contact_id || null, product_id: f.product_id || null, location: f.location || null,
      } });
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        await api(`/api/crm-notes/${noteId}/upload`, { method: 'POST', body: form });
      }
      showToast('Diary entry logged');
      router.refresh();
      onSaved?.();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add to Diary — {lead.lead_name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <div className="mb-2 text-sm font-semibold">Update Sales Call Section</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={f.visit_date} onChange={setText('visit_date')} /></div>
              <div className="grid gap-1.5"><RequiredLabel>Action Type</RequiredLabel>
                <Select value={f.note_type} onValueChange={set('note_type')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="note">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox id="dv-value-add" checked={f.is_value_addition} onCheckedChange={v => set('is_value_addition')(!!v)} />
                <Label htmlFor="dv-value-add" className="font-normal">Is Value Addition</Label>
              </div>
              <div className="grid gap-1.5 sm:col-span-2"><RequiredLabel>Action Taken</RequiredLabel><Textarea rows={2} value={f.action_taken} onChange={setText('action_taken')} /></div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Employee Work Done on Client Meetings</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label>In time</Label><Input type="time" value={f.in_time} onChange={setText('in_time')} /></div>
              <div className="grid gap-1.5"><Label>Out time</Label><Input type="time" value={f.out_time} onChange={setText('out_time')} /></div>
              <div className="grid gap-1.5"><Label>Alert</Label>
                <Select value={f.alert_mode} onValueChange={set('alert_mode')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Not Required">Not Required</SelectItem>
                    <SelectItem value="All seniors">All seniors</SelectItem>
                    <SelectItem value="Selected seniors">Selected seniors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.alert_mode === 'Selected seniors' && (
                <div className="grid gap-1.5 sm:col-span-3"><Label>Alert these people</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border px-3 py-2">
                    {users.map(u => (
                      <label key={u.username} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={f.alert_users.includes(u.username)}
                          onCheckedChange={c => setF(prev => ({ ...prev, alert_users: c ? [...prev.alert_users, u.username] : prev.alert_users.filter(x => x !== u.username) }))} />
                        {u.display_name || u.username}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-1.5 sm:col-span-3"><Label>Attach files</Label>
                <Input type="file" multiple onChange={e => setFiles(Array.from(e.target.files || []))} />
                {files.length > 0 && <p className="text-xs text-muted-foreground">{files.length} file(s) selected — uploaded once this entry is saved.</p>}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Diary Section</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Plan date</Label><Input type="date" value={f.plan_date} onChange={setText('plan_date')} /></div>
              <div className="grid gap-1.5"><Label>Plan time</Label><Input type="time" value={f.plan_time} onChange={setText('plan_time')} /></div>
              <div className="grid gap-1.5"><Label>Plan of Action for</Label>
                <SearchableSelect value={f.plan_for} onChange={set('plan_for')} options={users.map(u => ({ value: u.username, label: u.display_name || u.username }))} placeholder="Select a person…" />
              </div>
              <div className="grid gap-1.5"><Label>Plan Action Type</Label>
                <Select value={f.plan_note_type} onValueChange={set('plan_note_type')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="note">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5"><Label>Send Alert SMS</Label>
                <Select value={f.send_alert_sms} onValueChange={set('send_alert_sms')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="No Alert">No Alert</SelectItem>
                    <SelectItem value="SMS" disabled>SMS — coming later</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Plan of action</Label><Textarea rows={2} value={f.plan_of_action} onChange={setText('plan_of_action')} /></div>
              <div className="grid gap-1.5"><Label>Contact</Label>
                {lead.converted_customer_id
                  ? <Select value={f.contact_id} onValueChange={set('contact_id')}>
                      <SelectTrigger><SelectValue placeholder="Select a contact…" /></SelectTrigger>
                      <SelectContent>{contacts.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  : <p className="text-xs text-muted-foreground pt-2">Convert this lead to a customer first to pick a contact.</p>}
              </div>
              <div className="grid gap-1.5"><Label>Product</Label>
                <ProductSearchField products={salesProducts} value={f.product}
                  onChange={v => setF(prev => ({ ...prev, product: v, product_id: null }))}
                  onPick={p => setF(prev => ({ ...prev, product: p.product_name, product_id: p.id }))} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Location</Label><Input value={f.location} onChange={setText('location')} /></div>
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Diary Entry'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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

// Enquiry detail fields not already covered by the summary line above — only shown when at least
// one is actually set, so a plain Lead created through the simpler AddLeadDialog renders nothing
// extra here.
const ENQUIRY_DETAIL_FIELDS = [
  ['address', 'Address'], ['website', 'Web address'], ['reference', 'Reference'],
  ['short_name', 'Short name'], ['district', 'District'], ['sub_location', 'Sub location'],
  ['telephone', 'Telephone'], ['order_expected_in', 'Order expected in'], ['week_number', 'Week number'],
  ['account_manager', 'A/C Manager'], ['initiated_by', 'Initiated by'], ['district_code', 'District code'],
  ['pin_code', 'Pin code'],
];

// The enquiry's own deal value (docs/sales-crm-plan.md 1b) — feeds the Board totals, the funnel
// report and the Executive pipeline tile. Saved on blur.
function ExpectedValueField({ lead, router }) {
  const [value, setValue] = useState(lead.expected_value ?? '');
  useEffect(() => { setValue(lead.expected_value ?? ''); }, [lead.expected_value]);
  async function save() {
    const next = value === '' ? null : Number(value);
    if (next === (lead.expected_value ?? null)) return;
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { expected_value: next } });
      showToast('Expected value saved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="flex items-center gap-2">
      <Label className="text-sm text-muted-foreground">Expected value (₹)</Label>
      <Input type="number" min="0" className="w-40" value={value} onChange={e => setValue(e.target.value)} onBlur={save} />
    </div>
  );
}

function LeadDetailSheet({ lead, users, customers, salesProducts = [], branches = [], stages = [], onClose, router }) {
  const extra = ENQUIRY_DETAIL_FIELDS.filter(([k]) => lead[k]);
  // Home calendar's ?diary=now|advanced deep-link (Phase 4) — opens straight into the diary form
  // instead of the plain detail sheet.
  const autoOpenDiary = ['now', 'advanced'].includes(useSearchParams().get('diary'));
  const [action, setAction] = useState(null); // null | 'offer' | 'po' | 'lost'
  const [newQuotationId, setNewQuotationId] = useState(null);
  const [offerCustomerId, setOfferCustomerId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [closing, setClosing] = useState(false);
  const { convert: convertLead, dialog: convertDialog } = useLeadConvert();

  // Create Commercial Offer's own customer-resolution prerequisite (Gap #12) — silently run the
  // same Lead -> Customer conversion "Create PO" already runs, before ever opening
  // NewQuotationDialog, so a not-yet-converted lead never forces a manual customer pick instead.
  async function startCommercialOffer() {
    if (lead.converted_customer_id) { setOfferCustomerId(lead.converted_customer_id); setAction('offer'); return; }
    setResolving(true);
    try {
      const customerId = await convertLead(lead);
      if (!customerId) return;
      router.refresh();
      setOfferCustomerId(customerId);
      setAction('offer');
    } catch (err) { showToast(err.message, 'error'); } finally { setResolving(false); }
  }

  async function closeSalesCall() {
    setClosing(true);
    try {
      await api(`/api/leads/${lead.id}/close-sales-call`, { method: 'POST', body: {} });
      showToast('Sales Call closed');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setClosing(false); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{lead.lead_name}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          {lead.sales_call_closed_at && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Closed on {lead.sales_call_closed_at.slice(0, 10)}{lead.sales_call_closed_by ? ` by ${lead.sales_call_closed_by}` : ''}
              {lead.lost_reason && <> — {lead.lost_reason}</>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm text-muted-foreground">Stage</Label>
            <StageSelect lead={lead} stages={stages} router={router} />
            {lead.converted_customer_id && <Badge variant="secondary">Customer linked</Badge>}
          </div>
          <ExpectedValueField lead={lead} router={router} />
          <LeadProductsCard lead={lead} salesProducts={salesProducts} router={router} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.company_name && <span>Company: {lead.company_name}</span>}
            {lead.source && <span>Source: {lead.source}</span>}
            {lead.territory && <span>State: {lead.territory}</span>}
            {lead.industry && <span>Segment: {lead.industry}</span>}
            {lead.assigned_to && <span>Team: {lead.assigned_to}</span>}
            {lead.enquiry_date && <span>Enquiry date: {lead.enquiry_date}</span>}
            <ContactLinks phone={lead.phone} email={lead.email} />
          </div>
          {extra.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border p-3 text-sm">
              {extra.map(([k, label]) => (
                <div key={k}><span className="text-muted-foreground">{label}: </span>{lead[k]}</div>
              ))}
            </div>
          )}
          {lead.notes && <p className="text-sm"><span className="text-muted-foreground">Remarks: </span>{lead.notes}</p>}

          <div>
            <div className="mb-2 text-sm font-semibold">Actions</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={resolving} onClick={startCommercialOffer}>{resolving ? 'Preparing…' : 'Create Commercial Offer'}</Button>
              <Button size="sm" variant="outline" onClick={() => setAction('po')}>Create PO</Button>
              <Button size="sm" variant="outline" disabled={closing} onClick={closeSalesCall}>Close Sales Call</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setAction('lost')}>Order Lost</Button>
            </div>
          </div>

          <TasksPanel leadId={lead.id} users={users} />
          <NotesPanel leadId={lead.id} lead={lead} users={users} salesProducts={salesProducts} router={router} autoOpenDiary={autoOpenDiary} />
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>

      {action === 'offer' && !newQuotationId && (
        <NewQuotationDialog customers={customers} initialCustomerId={offerCustomerId || ''} leadId={lead.id} router={router}
          salesProducts={salesProducts} initialItems={quoteLinesFromLead(lead, salesProducts)}
          initialCustomerName={lead.company_name || lead.lead_name}
          onCreated={setNewQuotationId} onClose={() => setAction(null)} />
      )}
      {action === 'offer' && newQuotationId && (
        <SendCommercialOfferDialog quotationId={newQuotationId} router={router} onClose={() => { setAction(null); setNewQuotationId(null); }} />
      )}
      {convertDialog}
      {action === 'po' && <CreatePoFlow lead={lead} branches={branches} salesProducts={salesProducts} users={users} stages={stages} router={router} onClose={() => setAction(null)} />}
      {action === 'lost' && <OrderLostDialog lead={lead} router={router} onClose={() => setAction(null)} />}
    </Sheet>
  );
}

// Phase 3.1 — Order Lost, a terminal action distinct from Close Sales Call (real business outcome:
// no order ever happened, vs. sale_orders.status='cancelled' — a genuine order that fell through —
// which this dialog deliberately never touches, Gap #26).
function OrderLostDialog({ lead, onClose, router }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!reason.trim()) return showToast('A reason is required', 'error');
    setSaving(true);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: {
        sales_call_status: 'Order Lost', lost_reason: reason.trim(), sales_call_closed_at: new Date().toISOString(),
      } });
      showToast('Marked as Order Lost');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Order Lost — {lead.lead_name}</DialogTitle></DialogHeader>
        <div className="grid gap-1.5"><RequiredLabel>Reason</RequiredLabel><Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Mark as Order Lost'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LEAD_FILTER_DEFAULT = { stage: 'all', source: 'all', branch: 'all', search: '' };

const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
].map(s => ({ value: s, label: s }));


const SOURCE_SEED = ['Website', 'Referral', 'Exhibition', 'Cold Call', 'Tender', 'Existing Customer'];

// Options grown from whatever's already been typed into this field across existing rows (District/
// Sub Location have no fixed real-world list) — same "grows with usage" idiom as this app's other
// free-typed-with-suggestions fields (MOC, UoM), via SearchableSelect's own onTextChange hybrid mode.
function distinctOptions(leads, field, seed = []) {
  const values = new Set(seed);
  for (const l of leads) if (l[field]) values.add(l[field]);
  return [...values].sort().map(v => ({ value: v, label: v }));
}

function RequiredLabel({ children }) {
  return <Label>{children} <span className="text-destructive">*</span></Label>;
}

// Sales CRM plan 1e — an enquiry's product lines. Picking a product fills its unit, price and GST %
// (all still editable); free text works while the Product Master is empty. Amount = qty × rate
// (qty blank counts as 1) — the same rule the server uses for the enquiry's expected value.
const UNIT_OPTIONS = QTY_UNITS.map(u => ({ value: u, label: u }));
export const blankProductLine = () => ({ product_id: null, description: '', qty: '', unit: '', rate: '', gst_pct: '' });

export function productLinesFromLead(lead) {
  return (lead?.products || []).map(p => ({
    product_id: p.product_id || null, description: p.description || '',
    qty: p.qty ?? '', unit: p.unit || '', rate: p.rate ?? '', gst_pct: p.gst_pct ?? '',
  }));
}

function productLinesTotal(lines) {
  return lines.reduce((a, l) => (l.rate === '' || l.rate == null ? a : a + (Number(l.qty) || 1) * Number(l.rate)), 0);
}

function ProductLinesEditor({ products = [], lines, onChange }) {
  const patch = (i, p) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const pick = (i, p) => patch(i, {
    product_id: p.id, description: p.product_name,
    unit: p.unit || lines[i].unit, rate: p.price ?? lines[i].rate, gst_pct: p.gst_pct ?? lines[i].gst_pct,
  });
  const total = productLinesTotal(lines);
  return (
    <div className="flex flex-col gap-2">
      {lines.length > 0 && (
        <div className="hidden gap-2 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem_5rem_6rem_2rem]">
          <span>Product</span><span>Qty</span><span>Unit</span><span>Rate (₹)</span><span>GST %</span><span className="text-right">Amount</span><span />
        </div>
      )}
      {lines.map((l, i) => {
        const amount = l.rate === '' || l.rate == null ? null : (Number(l.qty) || 1) * Number(l.rate);
        return (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem_5rem_6rem_2rem] md:items-center md:border-0 md:p-0">
            <div className="col-span-2 md:col-span-1">
              <ProductSearchField products={products} value={l.description}
                onChange={v => patch(i, { description: v, product_id: null })} onPick={p => pick(i, p)} />
              {l.product_id && <div className="mt-0.5 text-xs text-muted-foreground">From Product Master</div>}
            </div>
            <Input type="number" min="0" aria-label="Qty" placeholder="Qty" value={l.qty} onChange={e => patch(i, { qty: e.target.value })} />
            <SearchableSelect value={l.unit} onChange={v => patch(i, { unit: v })} options={UNIT_OPTIONS} displayValue={l.unit} onTextChange={v => patch(i, { unit: v })} placeholder="Unit" />
            <Input type="number" min="0" aria-label="Rate" placeholder="Rate" value={l.rate} onChange={e => patch(i, { rate: e.target.value })} />
            <Input type="number" min="0" max="100" aria-label="GST %" placeholder="GST %" value={l.gst_pct} onChange={e => patch(i, { gst_pct: e.target.value })} />
            <div className="text-right text-sm tnum">{amount == null ? '—' : formatMoney(amount)}</div>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove product" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, blankProductLine()])}>
          <PlusIcon className="size-4" /> Add product
        </Button>
        {total > 0 && <div className="text-sm"><span className="text-muted-foreground">Total (before GST): </span><span className="font-semibold tnum">{formatMoney(total)}</span></div>}
      </div>
    </div>
  );
}

// Read-only list on the enquiry sheet, with Edit → the same editor.
function LeadProductsCard({ lead, salesProducts, router }) {
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState(() => productLinesFromLead(lead));
  const [saving, setSaving] = useState(false);
  const saved = lead.products || [];

  async function save() {
    setSaving(true);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { products: lines } });
      showToast('Products saved');
      setEditing(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Products</div>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => { setLines(productLinesFromLead(lead)); setEditing(true); }}>
            <PencilIcon className="size-3.5" /> {saved.length ? 'Edit' : 'Add'}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <ProductLinesEditor products={salesProducts} lines={lines} onChange={setLines} />
          <p className="text-xs text-muted-foreground">Saving sets the expected value to the products' total (when rates are given).</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save products'}</Button>
          </div>
        </div>
      ) : saved.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products yet.</p>
      ) : (
        <ul className="flex flex-col divide-y text-sm">
          {saved.map(p => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="font-medium">{p.description}</span>
                <span className="text-muted-foreground">{p.qty != null ? ` · ${p.qty}${p.unit ? ` ${p.unit}` : ''}` : ''}{p.gst_pct != null ? ` · GST ${p.gst_pct}%` : ''}</span>
              </span>
              <span className="shrink-0 tnum">{p.rate != null ? formatMoney((p.qty || 1) * p.rate) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddEnquiryDialog({ leads = [], users, salesProducts, stages = [], onClose, router }) {
  const [f, setF] = useState({
    enquiry_date: todayISO(), organization: '', address: '', website: '', email: '',
    assigned_to: '', reference: '', short_name: '', territory: '', district: '', sub_location: '',
    phone: '', order_expected_in: '', week_number: '', notes: '', industry: '',
    account_manager: '', initiated_by: '', district_code: '', pin_code: '', sales_call_status: DEFAULT_STAGE, expected_value: '',
    telephone: '', source: '',
  });
  const similarOrgs = useSimilarCustomers({ name: f.organization, phone: f.phone });
  const [products, setProducts] = useState([blankProductLine()]);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));
  const setText = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const productsTotal = productLinesTotal(products);

  const districtOpts = distinctOptions(leads, 'district');
  const subLocationOpts = distinctOptions(leads, 'sub_location');
  const sourceOpts = distinctOptions(leads, 'source', SOURCE_SEED);
  const teamOpts = users.map(u => ({ value: u.username, label: u.display_name || u.username }));

  async function save() {
    if (!f.organization.trim()) return showToast('Organization is required', 'error');
    if (!f.address.trim()) return showToast('Address is required', 'error');
    setSaving(true);
    try {
      await api('/api/leads', { method: 'POST', body: { ...f, products } });
      showToast('Enquiry added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>New Enquiry</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid gap-1.5 max-w-56">
            <Label>Enquiry date</Label>
            <Input type="date" value={f.enquiry_date} onChange={setText('enquiry_date')} />
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-3">
            {/* column 1 */}
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5"><RequiredLabel>Organization</RequiredLabel><Input value={f.organization} onChange={setText('organization')} autoFocus />
                <SimilarCustomersHint matches={similarOrgs} /></div>
              <div className="grid gap-1.5"><RequiredLabel>Address</RequiredLabel><Textarea rows={2} value={f.address} onChange={setText('address')} /></div>
              <div className="grid gap-1.5"><Label>Web address</Label><Input value={f.website} onChange={setText('website')} placeholder="https://…" /></div>
              <div className="grid gap-1.5"><Label>Email id</Label><Input type="email" value={f.email} onChange={setText('email')} /></div>
              <div className="grid gap-1.5"><Label>Team</Label><SearchableSelect value={f.assigned_to} onChange={set('assigned_to')} options={teamOpts} placeholder="Select a person…" /></div>
              <div className="grid gap-1.5"><Label>Reference</Label><Input value={f.reference} onChange={setText('reference')} /></div>
            </div>

            {/* column 2 */}
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5"><Label>Organization short name</Label><Input value={f.short_name} onChange={setText('short_name')} /></div>
              <div className="grid gap-1.5"><Label>State</Label><SearchableSelect value={f.territory} onChange={set('territory')} options={INDIA_STATES} displayValue={f.territory} onTextChange={set('territory')} placeholder="Select or type…" /></div>
              <div className="grid gap-1.5"><Label>District</Label><SearchableSelect value={f.district} onChange={set('district')} options={districtOpts} displayValue={f.district} onTextChange={set('district')} placeholder="Select or type…" /></div>
              <div className="grid gap-1.5"><Label>Sub location</Label><SearchableSelect value={f.sub_location} onChange={set('sub_location')} options={subLocationOpts} displayValue={f.sub_location} onTextChange={set('sub_location')} placeholder="Select or type…" /></div>
              <div className="grid gap-1.5"><Label>Telephone no</Label><Input value={f.telephone} onChange={setText('telephone')} /></div>
              <div className="grid gap-1.5"><Label>Order expected in</Label><Input value={f.order_expected_in} onChange={setText('order_expected_in')} placeholder="e.g. Q2 2027" /></div>
              <div className="grid gap-1.5"><Label>Week number</Label><Input value={f.week_number} onChange={setText('week_number')} /></div>
              <div className="grid gap-1.5"><Label>Remarks</Label><Textarea rows={2} value={f.notes} onChange={setText('notes')} /></div>
              <div className="grid gap-1.5"><Label>Segment</Label><Input value={f.industry} onChange={setText('industry')} /></div>
            </div>

            {/* column 3 */}
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5"><Label>A/C Manager</Label><SearchableSelect value={f.account_manager} onChange={set('account_manager')} options={teamOpts} placeholder="Select a person…" /></div>
              <div className="grid gap-1.5"><Label>Initiated by</Label><SearchableSelect value={f.initiated_by} onChange={set('initiated_by')} options={teamOpts} placeholder="Select a person…" /></div>
              <div className="grid gap-1.5"><Label>District code</Label><Input value={f.district_code} onChange={setText('district_code')} /></div>
              <div className="grid gap-1.5"><Label>Pin code</Label><Input value={f.pin_code} onChange={setText('pin_code')} /></div>
              <div className="grid gap-1.5"><Label>Expected value (₹)</Label><Input type="number" min="0" value={f.expected_value} onChange={setText('expected_value')} placeholder={productsTotal > 0 ? `${productsTotal} (from products)` : ''} /></div>
              <div className="grid gap-1.5"><Label>Stage</Label><SearchableSelect value={f.sales_call_status} onChange={set('sales_call_status')} options={stages.filter(s => !s.is_won && !s.is_lost).map(s => ({ value: s.name, label: s.name }))} placeholder="Select…" /></div>
              <div className="grid gap-1.5"><Label>Mobile number</Label><Input value={f.phone} onChange={setText('phone')} /></div>
              <div className="grid gap-1.5"><Label>Source</Label><SearchableSelect value={f.source} onChange={set('source')} options={sourceOpts} displayValue={f.source} onTextChange={set('source')} placeholder="Select or type…" /></div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Products</Label>
            <ProductLinesEditor products={salesProducts} lines={products} onChange={setProducts} />
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Board view (docs/sales-crm-plan.md 1b) — the enquiry is the deal, so the old /pipeline Kanban
// lives here now, over enquiries instead of opportunities. Same native HTML5 drag pattern as
// PipelineWorkspace.jsx. Dropping on a won stage points to Create PO (which records the order);
// dropping on Order Lost opens the reason dialog; every other stage changes directly.
function LeadBoard({ leads, stages, onOpen, onLost, router }) {
  const [busyId, setBusyId] = useState(null);
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const wonNames = new Set(stages.filter(s => s.is_won).map(s => s.name));
  const lostNames = new Set(stages.filter(s => s.is_lost).map(s => s.name));
  const stageOf = l => l.sales_call_status || DEFAULT_STAGE;
  const openValue = leads.filter(l => !wonNames.has(stageOf(l)) && !lostNames.has(stageOf(l))).reduce((a, l) => a + (l.expected_value || 0), 0);
  const wonCount = leads.filter(l => wonNames.has(stageOf(l))).length;
  const lostCount = leads.filter(l => lostNames.has(stageOf(l))).length;
  const winRate = (wonCount + lostCount) > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

  async function move(lead, stage) {
    if (stageOf(lead) === stage) return;
    if (wonNames.has(stage)) { showToast('Use Create PO on the enquiry to record the order', 'error'); onOpen(lead); return; }
    if (stage === 'Order Lost') { onLost(lead); return; }
    setBusyId(lead.id);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { sales_call_status: stage } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-muted-foreground">Open pipeline value: </span><span className="font-semibold tnum">{formatMoney(openValue)}</span></div>
        <div><span className="text-muted-foreground">Win rate: </span><span className="font-semibold tnum">{winRate == null ? '—' : `${winRate}%`}</span><span className="text-muted-foreground"> ({wonCount} won / {lostCount} lost)</span></div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ordered.map(stage => {
          const cards = leads.filter(l => stageOf(l) === stage.name);
          const total = cards.reduce((a, l) => a + (l.expected_value || 0), 0);
          return (
            <div key={stage.name}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                const id = Number(e.dataTransfer.getData('text/plain'));
                const lead = leads.find(l => l.id === id);
                if (lead) move(lead, stage.name);
              }}
              className={`flex min-h-[12rem] w-60 shrink-0 flex-col gap-2 rounded-lg border p-2 ${stage.is_won ? 'bg-success/5' : stage.is_lost ? 'bg-destructive/5' : 'bg-muted/30'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.name}</div>
                <div className="text-xs text-muted-foreground tnum">{cards.length}{total > 0 ? ` · ${formatMoney(total)}` : ''}</div>
              </div>
              {cards.map(l => (
                <div key={l.id}
                  draggable={busyId !== l.id}
                  onDragStart={e => e.dataTransfer.setData('text/plain', String(l.id))}
                  onClick={() => onOpen(l)}
                  className="cursor-grab rounded-md border bg-background px-2.5 py-2 text-sm shadow-sm hover:bg-muted/40 active:cursor-grabbing">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="min-w-0 truncate">{l.company_name || l.lead_name}</span>
                    {!!l.is_vip && <StarIcon className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="VIP" />}
                  </div>
                  {l.company_name && l.lead_name !== l.company_name && <div className="text-xs text-muted-foreground">{l.lead_name}</div>}
                  {lostNames.has(stage.name) && l.lost_reason && <div className="text-xs text-muted-foreground">Lost: {l.lost_reason}</div>}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{l.account_manager || l.assigned_to || '—'}</span>
                    {l.expected_value != null && <span className="text-xs font-semibold tnum">{formatMoney(l.expected_value)}</span>}
                  </div>
                  {isSlaBreached(l) && <Badge variant="destructive" className="mt-1">SLA overdue</Badge>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// STERP "Sales Enquiry" (SYSTEM.md §5e) — the Enquiry nav entry reuses this exact list/table,
// narrowed to open, not-closed leads still before the "Proposals" stage (lib/lead-stage.mjs
// isEnquiryStage) — only the creation dialog differs (isEnquiry picks AddEnquiryDialog's fuller
// form over AddLeadDialog's).
function LeadsTab({ leads, users, customers = [], salesProducts, branches = [], stages = [], savedViews, router, isEnquiry = false }) {
  const { convert: convertLeadRow, dialog: convertRowDialog } = useLeadConvert();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Home calendar's "Update Now"/"Advanced Update" deep-link (Phase 4) — same click-to-open
  // pattern JobCardBoard.jsx already uses for ?highlight=, not just scroll-and-flash.
  const searchParams = useSearchParams();
  const highlightCode = searchParams.get('highlight');
  const [selected, setSelected] = useState(() => leads.find(l => `LD-${l.id}` === highlightCode) || null);
  const [filters, setFilters] = useState(LEAD_FILTER_DEFAULT);
  const [view, setView] = useState(!isEnquiry && searchParams.get('view') === 'board' ? 'board' : 'list');
  const [lostLead, setLostLead] = useState(null);
  const [views, setViews] = useState(savedViews);
  const [viewName, setViewName] = useState('');

  const sources = [...new Set(leads.map(l => l.source).filter(Boolean))];
  const filtered = leads.filter(l =>
    (!isEnquiry || (!l.sales_call_closed_at && isEnquiryStage(stages, l.sales_call_status))) &&
    (filters.stage === 'all' || (l.sales_call_status || DEFAULT_STAGE) === filters.stage) &&
    (filters.source === 'all' || l.source === filters.source) &&
    (filters.branch === 'all' || String(l.branch_id) === filters.branch) &&
    (!filters.search || l.lead_name.toLowerCase().includes(filters.search.toLowerCase()) || (l.company_name || '').toLowerCase().includes(filters.search.toLowerCase()))
  );

  async function convert(lead) {
    setBusyId(lead.id);
    try {
      const customerId = await convertLeadRow(lead);
      if (!customerId) return;
      showToast('Linked to a customer');
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
        <CardTitle>{isEnquiry ? 'Enquiry' : 'Leads'}</CardTitle>
        <CardAction className="flex items-center gap-2">
          {!isEnquiry && (
            <div className="flex rounded-md border p-0.5" role="group" aria-label="View">
              {['list', 'board'].map(v => (
                <Button key={v} size="sm" variant={view === v ? 'secondary' : 'ghost'} className="h-7 capitalize" onClick={() => setView(v)}>{v}</Button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />{isEnquiry ? 'New Enquiry' : 'New Lead'}</Button>
        </CardAction>
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
          <Select value={filters.stage} onValueChange={v => setFilters(f => ({ ...f, stage: v }))}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {stages.filter(s => !isEnquiry || isEnquiryStage(stages, s.name)).map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
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
          {branches.length > 0 && (
            <Select value={filters.branch} onValueChange={v => setFilters(f => ({ ...f, branch: v }))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Input placeholder="Save current filters as…" value={viewName} onChange={e => setViewName(e.target.value)} className="w-44" />
            <Button size="sm" variant="outline" onClick={saveView}>Save view</Button>
          </div>
        </div>
        {view === 'board' ? (
          <LeadBoard leads={filtered} stages={stages} onOpen={setSelected} onLost={setLostLead} router={router} />
        ) : filtered.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No leads match.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Source</TableHead><TableHead>Stage</TableHead><TableHead>Owner</TableHead><TableHead>Assigned</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {filtered.map(l => (
                <TableRow key={l.id} data-entity-code={`LD-${l.id}`} className="cursor-pointer" onClick={() => setSelected(l)}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {l.lead_name}
                      {!!l.is_vip && <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-label="VIP" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.company_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{l.source || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StageBadge lead={l} stages={stages} />
                      {isSlaBreached(l) && <Badge variant="destructive">SLA overdue</Badge>}
                      {l.sales_call_closed_at && <Badge variant="secondary">Closed</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.owner_dept}</TableCell>
                  <TableCell className="text-muted-foreground">{l.assigned_to || '—'}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {!l.converted_customer_id && (
                      <Button size="sm" variant="outline" disabled={busyId === l.id} onClick={() => convert(l)}>Convert</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && (isEnquiry
        ? <AddEnquiryDialog leads={leads} users={users} salesProducts={salesProducts} stages={stages} router={router} onClose={() => setDialogOpen(false)} />
        : <AddLeadDialog router={router} onClose={() => setDialogOpen(false)} />)}
      {lostLead && <OrderLostDialog lead={lostLead} router={router} onClose={() => setLostLead(null)} />}
      {convertRowDialog}
      {selected && <LeadDetailSheet lead={leads.find(l => l.id === selected.id) || selected} users={users} customers={customers} salesProducts={salesProducts} branches={branches} stages={stages} router={router} onClose={() => setSelected(null)} />}
    </Card>
  );
}

// --- Customers ------------------------------------------------------------------------------------

function AddCustomerDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [gst, setGst] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const similar = useSimilarCustomers({ name, gst_no: gst, phone });

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
          <SimilarCustomersHint matches={similar} />
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

            <OldCrmSummary detail={detail} />

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

// Old-CRM import (2026-09-25): what the previous CRM knew about this party, read only.
function OldCrmSummary({ detail }) {
  let s = null;
  try { s = detail.legacy_crm_json ? JSON.parse(detail.legacy_crm_json) : null; } catch { s = null; }
  if (!s && !detail.account_manager && !detail.products_of_interest && !detail.party_code) return null;
  const stages = s ? Object.entries(s.stages || {}) : [];
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="text-sm font-semibold">From the old CRM</div>
      {detail.party_code && <div><span className="text-muted-foreground">Organization code:</span> {detail.party_code}</div>}
      {detail.account_manager && <div><span className="text-muted-foreground">A/C Manager:</span> {detail.account_manager}</div>}
      {detail.city && <div><span className="text-muted-foreground">District:</span> {detail.city}</div>}
      {detail.products_of_interest && <div><span className="text-muted-foreground">Products:</span> {detail.products_of_interest}</div>}
      {s && (
        <>
          <div><span className="text-muted-foreground">Sales calls:</span> {s.open_calls} open, {s.closed_calls} closed{stages.length ? ` — ${stages.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}</div>
          <div><span className="text-muted-foreground">Quoted:</span> {formatMoney(s.quote_total)} · <span className="text-muted-foreground">Orders:</span> {s.orders} ({formatMoney(s.order_value)}) · <span className="text-muted-foreground">Collected:</span> {formatMoney(s.collection)}</div>
          {s.other_names?.length > 0 && <div className="text-xs text-muted-foreground">Also recorded as: {s.other_names.join('; ')}</div>}
        </>
      )}
    </div>
  );
}

function CustomersTab({ router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const [data, setData] = useState({ rows: [], total: 0, loading: true });
  // Server-side search + paging (9k+ customers since the old-CRM import).
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ paged: '1', q: search.trim(), offset: String(page * size), limit: String(size) });
      api(`/api/customers?${qs}`).then(d => setData({ ...d, loading: false })).catch(err => { showToast(err.message, 'error'); setData(x => ({ ...x, loading: false })); });
    }, 250);
    return () => clearTimeout(t);
  }, [search, page, size]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customers</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Customer</Button></CardAction>
      </CardHeader>
      <CardContent>
        <Input className="mb-3 max-w-sm" placeholder="Search name, code, GST, phone, district, A/C manager"
          value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        {data.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{data.loading ? 'Loading…' : search ? 'No customers match.' : 'No customers yet.'}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Code</TableHead><TableHead className="hidden md:table-cell">District</TableHead><TableHead className="hidden md:table-cell">A/C Manager</TableHead><TableHead>GST No</TableHead><TableHead>Phone</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map(c => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedId(c.id)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{c.party_code || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{c.city || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{c.account_manager || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.gst_no || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={data.total} />
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
              title={it.hsn_code ? `HSN ${it.hsn_code}` : undefined} onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">
                {it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}
                {(it.category || it.material_process_type) && ` · ${[it.category, it.material_process_type].filter(Boolean).join(' · ')}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const QUOTATION_TYPE_SEED = ['Sales', 'Service', 'Spares', 'AMC'];

// Phase 3.2 — company/type/dates surfaced as real inputs (were dead columns before), per-line
// discount %. onCreated (optional) lets a caller (the Commercial Offer flow) chain straight into
// SendCommercialOfferDialog instead of just closing.
// Sales CRM plan 1f/1g — lines pick from the Product Master (unit, price, HSN and GST % fill in,
// all editable); each line carries its own GST %, the "Default GST %" covers lines left blank.
// CGST+SGST vs IGST is decided on save from the company's and customer's states. Callers that
// don't pass salesProducts (Marketing's Pipeline) keep the older Item Master search.
const blankQuoteLine = () => ({ item_description: '', qty: 1, uom: 'Nos', rate: 0, discount_pct: 0, gst_pct: '', product_id: null, hsn_code: '', item_id: null });

export function quoteLinesFromLead(lead, salesProducts = []) {
  const byId = new Map(salesProducts.map(p => [p.id, p]));
  return (lead?.products || []).map(p => ({
    ...blankQuoteLine(),
    item_description: p.description, qty: p.qty ?? 1, uom: p.unit || 'Nos', rate: p.rate ?? 0,
    gst_pct: p.gst_pct ?? '', product_id: p.product_id || null, hsn_code: byId.get(p.product_id)?.hsn_code || '',
  }));
}

export function NewQuotationDialog({ customers, opportunityId = null, leadId = null, initialCustomerId = '', initialCustomerName = '', initialItems = null, salesProducts = null, onClose, onCreated, router }) {
  const [customerId, setCustomerId] = useState(initialCustomerId ? String(initialCustomerId) : '');
  const [company, setCompany] = useState(defaultCompanyClient);
  const [quotationType, setQuotationType] = useState('Sales');
  const [quotationDate, setQuotationDate] = useState(todayISO());
  const [validUntil, setValidUntil] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); });
  const [taxPct, setTaxPct] = useState('18');
  const [items, setItems] = useState(() => (initialItems?.length ? initialItems : [blankQuoteLine()]));
  const [saving, setSaving] = useState(false);
  const useProducts = Array.isArray(salesProducts);
  // Customers are searched through the API (CustomerPicker), not passed in as a full list.
  const [customerName, setCustomerName] = useState(initialCustomerName || (customers || []).find(c => String(c.id) === String(initialCustomerId))?.name || '');
  useEffect(() => {
    if (customerId && !customerName) api(`/api/customers/${customerId}`).then(c => setCustomerName(c.name)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateItem(i, patch) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
  function addRow() { setItems(prev => [...prev, blankQuoteLine()]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function pickProduct(i, p) {
    updateItem(i, {
      item_description: p.product_name, product_id: p.id, uom: p.unit || items[i].uom,
      rate: p.price ?? items[i].rate, gst_pct: p.gst_pct ?? items[i].gst_pct, hsn_code: p.hsn_code || '',
    });
  }

  const preview = quotationTotals(items.filter(it => it.item_description.trim()), { fallbackGstPct: taxPct === '' ? 18 : Number(taxPct) });

  async function save() {
    if (!customerId) return showToast('Customer is required', 'error');
    const cleanItems = items.filter(it => it.item_description.trim());
    if (!cleanItems.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      const res = await api('/api/quotations', {
        method: 'POST',
        body: {
          customer_id: customerId, opportunity_id: opportunityId, lead_id: leadId, tax_pct: taxPct === '' ? 18 : Number(taxPct), items: cleanItems,
          company, quotation_type: quotationType, quotation_date: quotationDate, valid_until: validUntil,
        },
      });
      showToast(`Quotation ${res.quotation_no} created`);
      router.refresh();
      if (onCreated) onCreated(res.id);
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  const GRID = 'md:grid-cols-[minmax(0,1fr)_4rem_5.5rem_6.5rem_4.5rem_4.5rem_6rem_2rem]';
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader><DialogTitle>New Quotation</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Customer</Label>
              <CustomerPicker value={customerId} name={customerName} onChange={(id, n) => { setCustomerId(id); setCustomerName(n); }} placeholder="Choose customer" />
            </div>
            <div className="grid gap-1.5">
              <Label>Company</Label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Quotation type</Label>
              <SearchableSelect value={quotationType} onChange={setQuotationType} options={QUOTATION_TYPE_SEED.map(t => ({ value: t, label: t }))} displayValue={quotationType} onTextChange={setQuotationType} placeholder="Select or type…" />
            </div>
            <div className="grid gap-1.5"><Label>Quotation date</Label><Input type="date" value={quotationDate} onChange={e => setQuotationDate(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Valid until</Label><Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Default GST %</Label><Input type="number" min="0" max="100" value={taxPct} onChange={e => setTaxPct(e.target.value)} /></div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Line items</Label>
            <div className={`hidden gap-2 text-xs text-muted-foreground md:grid ${GRID}`}>
              <span>{useProducts ? 'Product' : 'Description'}</span><span>Qty</span><span>Unit</span><span>Rate (₹)</span><span>Disc %</span><span>GST %</span><span className="text-right">Amount</span><span />
            </div>
            {items.map((it, i) => (
              <div key={i} className={`grid grid-cols-2 gap-2 rounded-md border p-2 md:items-start md:border-0 md:p-0 ${GRID}`}>
                <div className="col-span-2 md:col-span-1">
                  {useProducts ? (
                    <>
                      <ProductSearchField products={salesProducts} value={it.item_description}
                        onChange={v => updateItem(i, { item_description: v, product_id: null })} onPick={p => pickProduct(i, p)} />
                      {it.product_id && <div className="mt-0.5 text-xs text-muted-foreground">From Product Master{it.hsn_code ? ` · HSN ${it.hsn_code}` : ''}</div>}
                    </>
                  ) : (
                    <QuotationItemField item={it} customerId={customerId} onChange={patch => updateItem(i, patch)} />
                  )}
                </div>
                <Input aria-label="Qty" placeholder="Qty" type="number" min="0" value={it.qty} onChange={e => updateItem(i, { qty: e.target.value })} />
                <SearchableSelect value={it.uom} onChange={v => updateItem(i, { uom: v })} options={UNIT_OPTIONS} displayValue={it.uom} onTextChange={v => updateItem(i, { uom: v })} placeholder="Unit" />
                <Input aria-label="Rate" placeholder="Rate" type="number" min="0" value={it.rate} onChange={e => updateItem(i, { rate: e.target.value })} />
                <Input aria-label="Discount %" placeholder="Disc %" type="number" min="0" max="100" value={it.discount_pct} onChange={e => updateItem(i, { discount_pct: e.target.value })} />
                <Input aria-label="GST %" placeholder={taxPct || '18'} type="number" min="0" max="100" value={it.gst_pct} onChange={e => updateItem(i, { gst_pct: e.target.value })} />
                <div className="self-center text-right text-sm tnum">{formatMoney(lineAmount(it))}</div>
                <Button size="icon" variant="ghost" aria-label="Remove line" onClick={() => removeRow(i)}><TrashIcon className="size-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Button size="sm" variant="outline" onClick={addRow}><PlusIcon />Add line</Button>
              <div className="min-w-56 text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Sub total</span><span className="tnum">{formatMoney(preview.subtotal)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">GST</span><span className="tnum">{formatMoney(preview.taxAmount)}</span></div>
                <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><span>Total</span><span className="tnum">{formatMoney(preview.total)}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">Split into CGST + SGST or IGST from the customer's state on save.</p>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create Quotation'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Phase 3.2 — Commercial Offer. Operates on an EXISTING quotation (created via NewQuotationDialog
// just before this opens). Company/template picker, editable subject+body, Preview PDF, Send Email.
export function SendCommercialOfferDialog({ quotationId, onClose, router }) {
  const [quotation, setQuotation] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api(`/api/quotations/${quotationId}`).then(setQuotation).catch(err => showToast(err.message, 'error'));
  }, [quotationId]);

  useEffect(() => {
    if (!quotation) return;
    api(`/api/email-templates?company=${encodeURIComponent(quotation.company)}&active=1`).then(rows => {
      setTemplates(rows);
      if (rows.length) applyTemplate(rows[0]);
    }).catch(() => {});
  }, [quotation?.company]);

  function applyTemplate(t) {
    if (!quotation) return;
    setTemplateId(String(t.id));
    const vars = { customer_name: quotation.customer_name, quotation_no: quotation.quotation_no, total: formatMoney(quotation.total), valid_until: quotation.valid_until };
    const rendered = renderTemplate(t.body, vars);
    const regards = t.regards ? `\n\n${renderTemplate(t.regards, vars)}` : '';
    setSubject(renderTemplate(t.subject || '', vars));
    setBody(rendered + regards);
  }

  async function send() {
    if (!subject.trim() || !body.trim()) return showToast('Subject and body are required', 'error');
    setSending(true);
    try {
      await api(`/api/quotations/${quotationId}/send-email`, { method: 'POST', body: { subject: subject.trim(), body: body.trim(), email_template_id: templateId || null } });
      showToast('Commercial Offer emailed');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSending(false); }
  }

  if (!quotation) return null;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Send Commercial Offer — {quotation.quotation_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Company</Label><Input value={quotation.company} disabled /></div>
            {templates.length > 0 && (
              <div className="grid gap-1.5"><Label>Template</Label>
                <Select value={templateId} onValueChange={v => applyTemplate(templates.find(t => String(t.id) === v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid gap-1.5"><Label>Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Body</Label><Textarea rows={8} value={body} onChange={e => setBody(e.target.value)} /></div>
          <a href={`/api/quotations/${quotationId}/pdf`} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline">Preview Commercial Offer PDF ↗</a>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send Email'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotationStatusSelect({ q, busy, onChange }) {
  return (
    <Select value={q.status} onValueChange={v => onChange(q, v)} disabled={busy}>
      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        {['draft', 'sent', 'accepted', 'rejected', 'expired'].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function QuotationConvertButtons({ q, busy, onConvert, onInvoice }) {
  if (q.status !== 'accepted') return null;
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onConvert(q)}>Convert to SO</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onInvoice(q)}>Convert to Invoice</Button>
    </div>
  );
}

function QuotationsTab({ quotations, customers, salesProducts = [], router }) {
  useEntityHighlight(useSearchParams().get('highlight'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rcmQuotation, setRcmQuotation] = useState(null);
  const [isReverseCharge, setIsReverseCharge] = useState(false);
  // Plan 2d — same rule the reminder sweep uses, so the filter matches the notifications.
  const [followupOnly, setFollowupOnly] = useState(false);
  const withReason = useMemo(() => {
    const today = todayISO();
    return quotations.map(q => ({ ...q, followup: quotationFollowupReason(q, today) }));
  }, [quotations]);
  const followupCount = withReason.filter(q => q.followup).length;
  const shown = followupOnly ? withReason.filter(q => q.followup) : withReason;

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
        <CardAction className="flex gap-2">
          <Button size="sm" variant={followupOnly ? 'default' : 'outline'} onClick={() => setFollowupOnly(v => !v)}>
            Needs follow-up{followupCount ? ` (${followupCount})` : ''}
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Quotation</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{followupOnly ? 'Nothing needs a follow-up.' : 'No quotations yet.'}</p> : (<>
          <Table className="hidden md:table">
            <TableHeader><TableRow><TableHead>Quotation No.</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.map(q => (
                <TableRow key={q.id} data-entity-code={`QT-${q.id}`}>
                  <TableCell className="font-medium">
                    <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{q.quotation_no}</a>
                    {q.followup && <div><Badge variant="outline" className="mt-1 border-amber-500/50 text-amber-700 dark:text-amber-400">{REMINDER_LABELS[q.followup]}</Badge></div>}
                  </TableCell>
                  <TableCell>{q.customer_name}</TableCell>
                  <TableCell className="tnum">{formatMoney(q.total)}</TableCell>
                  <TableCell><QuotationStatusSelect q={q} busy={busyId === q.id} onChange={setStatus} /></TableCell>
                  <TableCell><QuotationConvertButtons q={q} busy={busyId === q.id} onConvert={convert} onInvoice={q => { setIsReverseCharge(false); setRcmQuotation(q); }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 md:hidden">
            {shown.map(q => (
              <div key={q.id} data-entity-code={`QT-${q.id}`} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{q.quotation_no}</a>
                  <span className="tnum">{formatMoney(q.total)}</span>
                </div>
                <div className="text-muted-foreground">{q.customer_name}</div>
                {q.followup && <Badge variant="outline" className="w-fit border-amber-500/50 text-amber-700 dark:text-amber-400">{REMINDER_LABELS[q.followup]}</Badge>}
                <QuotationStatusSelect q={q} busy={busyId === q.id} onChange={setStatus} />
                <QuotationConvertButtons q={q} busy={busyId === q.id} onConvert={convert} onInvoice={q => { setIsReverseCharge(false); setRcmQuotation(q); }} />
              </div>
            ))}
          </div>
        </>        )}
      </CardContent>
      {dialogOpen && <NewQuotationDialog customers={customers} salesProducts={salesProducts} router={router} onClose={() => setDialogOpen(false)} />}
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
  useEntityHighlight(useSearchParams().get('highlight'));
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
                  <TableRow key={inv.id} data-entity-code={`SI-${inv.id}`}>
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
                <div key={cn.id} data-entity-code={`CN-${cn.id}`} className="flex justify-between py-2 text-sm">
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
              title={it.hsn_code ? `HSN ${it.hsn_code}` : undefined} onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">
                {it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}
                {(it.category || it.material_process_type) && ` · ${[it.category, it.material_process_type].filter(Boolean).join(' · ')}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPriceListDialog({ customers, onClose, router }) {
  const [item, setItem] = useState({ item_name: '', item_id: null, uom: '' });
  const [plCustomerName, setPlCustomerName] = useState('');
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
            <CustomerPicker value={customerId} name={customerId === '__all__' ? 'All customers (default rate)' : plCustomerName}
              extraOptions={[{ value: '__all__', label: 'All customers (default rate)' }]}
              onChange={(id, n) => { setCustomerId(id); setPlCustomerName(n); }} />
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
      const res = await api('/api/sale-orders', { method: 'POST', body: { customer_name: customerName.trim() || null, description: description.trim() || null, company } });
      showToast(`Sale Order ${res.so_no} created`);
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

// Line-item editing + Order Acknowledgement/Scope-of-Supply PDF attachment for an existing Sale
// Order — the two missing pieces found wiring up a real order (SB-1109-01-50/SO-22) that predates
// a project it was later linked to. sale_order_items was previously only ever written once, at
// Quotation->Convert time (POST /api/sale-orders/[id]/items is new, whole-list replace). The PDF
// attachment mirrors test_certificates.pdf_key/pdf_url exactly (same R2 single-file pattern), per
// direct instruction.
function SaleOrderItemsSheet({ so, onClose, onSaved, canEditTax }) {
  const [detail, setDetail] = useState(null);
  const [items, setItems] = useState([]);
  const [taxPct, setTaxPct] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    api(`/api/sale-orders/${so.id}`).then(d => {
      setDetail(d);
      setItems(d.items.length ? d.items : [{ item_description: '', qty: '', uom: '', rate: '' }]);
      setTaxPct(d.tax_pct || 0);
    }).catch(err => showToast(err.message, 'error'));
  }, [so.id]);

  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const taxAmount = Math.round(subtotal * Number(taxPct)) / 100;

  function updateRow(i, patch) { setItems(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)); }
  function addRow() { setItems(rows => [...rows, { item_description: '', qty: '', uom: '', rate: '' }]); }
  function removeRow(i) { setItems(rows => rows.filter((_, idx) => idx !== i)); }

  async function save() {
    const rows = items.filter(it => String(it.item_description || '').trim());
    if (!rows.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      await api(`/api/sale-orders/${so.id}/items`, { method: 'PUT', body: { items: rows, tax_pct: Number(taxPct) || 0 } });
      showToast('Line items saved');
      onSaved();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function uploadPdf(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/sale-orders/${so.id}/pdf`, { method: 'POST', body: fd }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      setDetail(d => ({ ...d, pdf_key: 'set', pdf_url: res.pdf_url }));
      showToast('PDF attached');
    } catch (err) { showToast(err.message, 'error'); } finally { setPdfBusy(false); }
  }

  async function removePdf() {
    setPdfBusy(true);
    try {
      await api(`/api/sale-orders/${so.id}/pdf`, { method: 'DELETE' });
      setDetail(d => ({ ...d, pdf_key: null, pdf_url: null }));
      showToast('PDF removed');
    } catch (err) { showToast(err.message, 'error'); } finally { setPdfBusy(false); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader><SheetTitle>Line items — {so.so_no}</SheetTitle></SheetHeader>
        {!detail ? <p className="px-4 text-sm text-muted-foreground">Loading…</p> : (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex flex-col gap-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <Input placeholder="Description" className="flex-1" value={it.item_description || ''}
                    onChange={e => updateRow(i, { item_description: e.target.value })} />
                  <Input placeholder="Qty" className="w-16" value={it.qty ?? ''} onChange={e => updateRow(i, { qty: e.target.value })} />
                  <Input placeholder="UoM" className="w-16" value={it.uom || ''} onChange={e => updateRow(i, { uom: e.target.value })} />
                  <Input placeholder="Rate" className="w-20" value={it.rate ?? ''} onChange={e => updateRow(i, { rate: e.target.value })} />
                  <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><TrashIcon className="size-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="w-fit" onClick={addRow}><PlusIcon />Add line</Button>
            </div>
            <div className="flex items-center gap-2 border-t pt-2">
              <Label className="text-xs text-muted-foreground">Tax %</Label>
              {canEditTax ? (
                <Input className="w-20" value={taxPct} onChange={e => setTaxPct(e.target.value)} />
              ) : (
                <span className="tnum text-sm">{taxPct}%</span>
              )}
              <div className="ml-auto flex flex-col items-end text-sm">
                <span className="text-muted-foreground">Subtotal {formatMoney(subtotal)} + tax {formatMoney(taxAmount)}</span>
                <span className="font-semibold">Total {formatMoney(subtotal + taxAmount)}</span>
              </div>
            </div>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save line items'}</Button>

            <div className="flex flex-col gap-2 border-t pt-3">
              <Label className="text-xs text-muted-foreground">Order Acknowledgement / Scope of Supply PDF</Label>
              {detail.pdf_key ? (
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/sale-orders/${so.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />View</a>
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pdfBusy} onClick={removePdf}><TrashIcon data-icon="inline-start" />Remove</Button>
                </div>
              ) : (
                <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                  <UploadIcon className="size-3.5" />{pdfBusy ? 'Uploading…' : 'Attach PDF'}
                  <input type="file" accept="application/pdf" className="hidden" disabled={pdfBusy} onChange={uploadPdf} />
                </label>
              )}
            </div>
          </div>
        )}
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Convert-to-Project used to live here (STORES-SALES-CHANGES.md §2b/§4) but was only reachable by
// a Design head who also held Sales/Marketing access — /sales itself is gated on those departments,
// so a Design-only head (the common case) could never reach it despite the button/API both being
// gated on isDesignHead. Moved to Design's own Projects tab (a standalone ConvertSaleOrderButton
// at first, 2026-09-18 folded into NewProjectForm's own Sale Order picker instead — same
// POST /api/projects + sale_order_id call, one dialog instead of two); not duplicated here.
function SaleOrdersTab({ saleOrders, router, canEditSoTax }) {
  useEntityHighlight(useSearchParams().get('highlight'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sasSo, setSasSo] = useState(null);
  const [costingSo, setCostingSo] = useState(null);
  const [itemsSo, setItemsSo] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const shown = saleOrders.filter(so => !q.trim() || [so.so_no, so.customer_name, so.company].join(' ').toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sale Orders</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Sale Order</Button></CardAction>
      </CardHeader>
      <CardContent>
        <Input className="mb-3 max-w-sm" placeholder="Search order ID, customer, company…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
        {saleOrders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No Sale Orders yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>SO No.</TableHead><TableHead>Customer</TableHead><TableHead>Company</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.slice(page * size, (page + 1) * size).map(so => (
                <TableRow key={so.id} data-entity-code={`SO-${so.id}`}>
                  <TableCell className="font-medium">{so.so_no}</TableCell>
                  <TableCell>{so.customer_name || '—'}</TableCell>
                  <TableCell><SoCompanyCell so={so} router={router} /></TableCell>
                  <TableCell className="tnum">{so.total ? formatMoney(so.total) : '—'}</TableCell>
                  <TableCell><Badge variant={so.status === 'open' ? 'outline' : 'default'}>{so.status || 'open'}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{so.created_at ? new Date(so.created_at).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setItemsSo(so)}><FileTextIcon />Items & PDF</Button>
                    {so.project_id && <Button size="sm" variant="outline" onClick={() => setCostingSo(so)}><IndianRupeeIcon />Costing</Button>}
                    <Button size="sm" variant="outline" onClick={() => setSasSo(so)}>Request from Stores</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={shown.length} />
      </CardContent>
      {dialogOpen && <AddSaleOrderDialog router={router} onClose={() => setDialogOpen(false)} />}
      {sasSo && <RequestFromStoresDialog so={sasSo} router={router} onClose={() => setSasSo(null)} />}
      {costingSo && <CostingSheet so={costingSo} onClose={() => setCostingSo(null)} />}
      {itemsSo && <SaleOrderItemsSheet so={itemsSo} onClose={() => setItemsSo(null)} onSaved={() => router.refresh()} canEditTax={canEditSoTax} />}
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

// Campaigns/AddCampaignDialog moved to components/MarketingWorkspace.jsx (2026-09-24) — Marketing
// has its own tab/URL now (/market), split from Sales.

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

// --- Branches (Phase 0a) — Sales/CRM-scoped only, no delete (deactivate-don't-delete, same as
// sales_stages), rename/toggle via inline click-to-edit cells. ------------------------------------

function AddBranchDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/branches', { method: 'POST', body: { name: name.trim(), region: region.trim() || null } });
      showToast('Branch added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Branch</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Region (optional)</Label><Input value={region} onChange={e => setRegion(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Branch'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchesTab({ branches, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function toggleActive(b) {
    setBusyId(b.id);
    try {
      await api(`/api/branches/${b.id}`, { method: 'PATCH', body: { active: b.active ? 0 : 1 } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Branch</Button></CardAction>
      </CardHeader>
      <CardContent>
        {branches.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No branches yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Region</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {branches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-muted-foreground">{b.region || '—'}</TableCell>
                  <TableCell><Badge variant={b.active ? 'default' : 'outline'}>{b.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="outline" disabled={busyId === b.id} onClick={() => toggleActive(b)}>{b.active ? 'Deactivate' : 'Activate'}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddBranchDialog router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

// --- Product Master (Phase 0b) — SN/Code/Name/Type/Description/Price, "add data later per
// product" (every field but the name is optional). No delete — a product may already be
// referenced from real leads/quotation/sale-order lines. ------------------------------------------

function ProductDialog({ product, onClose, router }) {
  const isEdit = !!product;
  const [f, setF] = useState({
    product_code: product?.product_code || '', product_name: product?.product_name || '',
    product_type: product?.product_type || '', description: product?.description || '',
    price: product?.price ?? '', unit: product?.unit || '', hsn_code: product?.hsn_code || '',
    gst_pct: product?.gst_pct ?? '', category: product?.category || '', cost_price: product?.cost_price ?? '',
    warranty_days: product?.warranty_days ?? '', serviceable: product?.serviceable ?? null,
  });
  let attrs = {};
  try { attrs = product?.attributes_json ? JSON.parse(product.attributes_json) : {}; } catch { attrs = {}; }
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));
  const typeOpts = distinctOptions([], 'x', PRODUCT_TYPES);

  async function save() {
    if (!f.product_name.trim()) return showToast('Product name is required', 'error');
    setSaving(true);
    try {
      const n = v => (v === '' || v == null ? null : Number(v));
      const body = { ...f, product_name: f.product_name.trim(), price: n(f.price), gst_pct: n(f.gst_pct), cost_price: n(f.cost_price), warranty_days: n(f.warranty_days) };
      if (isEdit) await api(`/api/sales-products/${product.id}`, { method: 'PATCH', body });
      else await api('/api/sales-products', { method: 'POST', body });
      showToast(isEdit ? 'Product updated' : 'Product added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Product' : 'New Product'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Product code (leave blank to auto-generate)</Label><Input value={f.product_code} onChange={e => set('product_code')(e.target.value)} /></div>
          <div className="grid gap-1.5"><RequiredLabel>Product name</RequiredLabel><Input value={f.product_name} onChange={e => set('product_name')(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Product type</Label><SearchableSelect value={f.product_type} onChange={set('product_type')} options={typeOpts} displayValue={f.product_type} onTextChange={set('product_type')} placeholder="Select or type…" /></div>
          <div className="grid gap-1.5"><Label>Description</Label><Textarea rows={2} value={f.description} onChange={e => set('description')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Price (optional — can add later)</Label><Input type="number" value={f.price} onChange={e => set('price')(e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>Unit</Label><SearchableSelect value={f.unit} onChange={set('unit')} options={QTY_UNITS.map(u => ({ value: u, label: u }))} displayValue={f.unit} onTextChange={set('unit')} placeholder="Nos…" /></div>
            <div className="grid gap-1.5"><Label>HSN code</Label><Input value={f.hsn_code} onChange={e => set('hsn_code')(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>GST %</Label><Input type="number" min="0" value={f.gst_pct} onChange={e => set('gst_pct')(e.target.value)} placeholder="18" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>Category</Label>
              <Select value={f.category || ''} onValueChange={set('category')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="Standard Product">Standard Product</SelectItem><SelectItem value="Premium Product">Premium Product</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Cost price</Label><Input type="number" min="0" value={f.cost_price} onChange={e => set('cost_price')(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Warranty (days)</Label><Input type="number" min="0" value={f.warranty_days} onChange={e => set('warranty_days')(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!f.serviceable} onCheckedChange={v => set('serviceable')(v ? 1 : 0)} />Serviceable product</label>
          {(product?.legacy_code || Object.keys(attrs).length > 0) && (
            <p className="text-xs text-muted-foreground">
              From the old CRM:{product?.legacy_code && product.legacy_code !== product.product_code ? ` code ${product.legacy_code};` : ''}
              {' '}{Object.entries(attrs).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === true ? 'Yes' : v === false ? 'No' : v}`).join(' · ')}
            </p>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save' : 'Add Product'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductsTab({ salesProducts, router }) {
  const [dialogState, setDialogState] = useState(null); // null | true (new) | product (edit)
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const q = search.trim().toLowerCase();
  const filtered = !q ? salesProducts : salesProducts.filter(p =>
    [p.product_code, p.product_name, p.product_type, p.hsn_code, p.category].some(v => v && String(v).toLowerCase().includes(q)));
  const shown = filtered.slice(page * size, (page + 1) * size);
  // The list leaves out description/attributes; load the full product before editing.
  function openProduct(p) { api(`/api/sales-products/${p.id}`).then(setDialogState).catch(err => showToast(err.message, 'error')); }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Master</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogState(true)}><PlusIcon />New Product</Button></CardAction>
      </CardHeader>
      <CardContent>
        <Input className="mb-3 max-w-sm" placeholder={`Search ${salesProducts.length} products — code, name, type, HSN`}
          value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        {filtered.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{salesProducts.length ? 'No products match.' : 'No products yet — add data as it becomes available.'}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Price</TableHead><TableHead>Unit</TableHead><TableHead>GST %</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.map(p => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => openProduct(p)}>
                  <TableCell className="text-muted-foreground">{p.product_code || '—'}</TableCell>
                  <TableCell className="font-medium">{p.product_name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.product_type || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{p.price != null ? formatMoney(p.price) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{p.unit || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{p.gst_pct != null ? `${p.gst_pct}%` : '—'}</TableCell>
                  <TableCell><Badge variant={p.active ? 'default' : 'outline'}>{p.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={e => { e.stopPropagation(); openProduct(p); }}><PencilIcon className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardContent className="pt-0"><Pager page={page} setPage={setPage} size={size} setSize={setSize} total={filtered.length} /></CardContent>
      {dialogState && <ProductDialog product={dialogState === true ? null : dialogState} router={router} onClose={() => setDialogState(null)} />}
    </Card>
  );
}

// --- Email Templates (Phase 3.2) — one per company, feeds Commercial Offer's own picker. ---------

function EmailTemplateDialog({ template, onClose, router }) {
  const isEdit = !!template;
  const [f, setF] = useState({
    name: template?.name || '', company: template?.company || COMPANY_NAMES[0],
    subject: template?.subject || '', body: template?.body || '', regards: template?.regards || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));

  async function save() {
    if (!f.name.trim()) return showToast('Name is required', 'error');
    if (!f.body.trim()) return showToast('Body is required', 'error');
    setSaving(true);
    try {
      if (isEdit) await api(`/api/email-templates/${template.id}`, { method: 'PATCH', body: f });
      else await api('/api/email-templates', { method: 'POST', body: f });
      showToast(isEdit ? 'Template updated' : 'Template added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Email Template' : 'New Email Template'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><RequiredLabel>Name</RequiredLabel><Input value={f.name} onChange={e => set('name')(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Company</Label>
            <Select value={f.company} onValueChange={set('company')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Subject (tokens: customer_name, quotation_no, total, valid_until)</Label><Input value={f.subject} onChange={e => set('subject')(e.target.value)} /></div>
          <div className="grid gap-1.5"><RequiredLabel>Body</RequiredLabel><Textarea rows={6} value={f.body} onChange={e => set('body')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Regards (signature block)</Label><Textarea rows={2} value={f.regards} onChange={e => set('regards')(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save' : 'Add Template'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailTemplatesTab({ router }) {
  const [templates, setTemplates] = useState([]);
  const [dialogState, setDialogState] = useState(null);

  function load() { api('/api/email-templates').then(setTemplates).catch(() => {}); }
  useEffect(load, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Templates</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogState(true)}><PlusIcon />New Template</Button></CardAction>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No templates yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {templates.map(t => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setDialogState(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.company}</TableCell>
                  <TableCell><Badge variant={t.active ? 'default' : 'outline'}>{t.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={e => { e.stopPropagation(); setDialogState(t); }}><PencilIcon className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogState && <EmailTemplateDialog template={dialogState === true ? null : dialogState} router={router}
        onClose={() => { setDialogState(null); load(); }} />}
    </Card>
  );
}

// --- Sales Targets (Phase 0e) — Branch + A/C Manager + period ('YYYY-MM'), Head-gated server-side
// (sales.target.write is seeded requires_head=1) — any 403 just surfaces via the toast. ------------

function TargetDialog({ branches, onClose, router }) {
  const [branchId, setBranchId] = useState('');
  const [accountManager, setAccountManager] = useState('');
  const [period, setPeriod] = useState(todayISO().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!/^\d{4}-\d{2}$/.test(period)) return showToast("Period must be 'YYYY-MM'", 'error');
    const targetAmount = Number(amount);
    if (!Number.isFinite(targetAmount) || targetAmount < 0) return showToast('Target amount must be a non-negative number', 'error');
    setSaving(true);
    try {
      await api('/api/sales-targets', { method: 'POST', body: { branch_id: branchId || null, account_manager: accountManager || null, period, target_amount: targetAmount } });
      showToast('Target saved');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Set Sales Target</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Branch (optional)</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>A/C Manager (username, optional)</Label><Input value={accountManager} onChange={e => setAccountManager(e.target.value)} /></div>
          <div className="grid gap-1.5"><RequiredLabel>Period</RequiredLabel><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
          <div className="grid gap-1.5"><RequiredLabel>Target amount</RequiredLabel><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Target'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetsTab({ salesTargets, branches, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function remove(t) {
    setBusyId(t.id);
    try {
      await api(`/api/sales-targets/${t.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Targets</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />Set Target</Button></CardAction>
      </CardHeader>
      <CardContent>
        {salesTargets.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No targets set yet. Reports' Targets/T/A columns read zero until one exists for the period.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Branch</TableHead><TableHead>A/C Manager</TableHead><TableHead>Target</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {salesTargets.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.period}</TableCell>
                  <TableCell className="text-muted-foreground">{t.branch_name || 'All branches'}</TableCell>
                  <TableCell className="text-muted-foreground">{t.account_manager || '—'}</TableCell>
                  <TableCell>{formatMoney(t.target_amount)}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" disabled={busyId === t.id} onClick={() => remove(t)}><TrashIcon className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <TargetDialog branches={branches} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

// -----------------------------------------------------------------------------------------------

// Sidebar IA reorg (2026-09-23) — was a single flat PANELS array (17 entries, 2 nested), which
// components/WorkspaceSidebar.jsx's own `groups` mode renders as labeled, collapsible sections
// instead (real accordion — a closed group's items aren't in the DOM at all, not just visually
// dimmed; see WorkspaceSidebar.jsx). Grouped by the sales journey, not by which panels happened to
// ship in the same round — "Pipeline" is deliberately NOT used as a group label here: that name
// already belongs to the separate top-nav Opportunities tab (/pipeline), and reusing it for
// Enquiry/Leads would recreate the exact conceptual duplication a design review flagged.
//
// Marketing split off (2026-09-24) into its own tab/URL/component (/market,
// components/MarketingWorkspace.jsx) — this workspace is Sales-exclusive now, so the old
// per-item `salesOnly` flag (used to filter this same array down for a Marketing viewer) is gone;
// every item below always renders for whoever reaches /sales.
const PANEL_GROUPS = [
  { label: 'Leads & Enquiries', items: [
    { key: 'enquiry', label: 'Enquiry', icon: InboxIcon, description: 'New, not-yet-qualified enquiries' },
    { key: 'leads', label: 'Leads', icon: UserPlusIcon, description: 'Every enquiry through the funnel — list or board' },
  ] },
  { label: 'Commercial', items: [
    { key: 'customers', label: 'Customers', icon: UsersIcon, description: 'Accounts, contacts and addresses' },
    { key: 'quotations', label: 'Quotations', icon: FileTextIcon, description: 'Proposals sent to customers' },
    { key: 'price_lists', label: 'Price Lists', icon: TagIcon, description: 'Customer/product rates and validity' },
    { key: 'sale_orders', label: 'Sale Orders', icon: ShoppingCartIcon, description: 'Accepted orders' },
    { key: 'scope_of_supply', label: 'Scope of Supply', icon: FileCheckIcon, description: 'Priced deliverables for a converted project' },
  ] },
  { label: 'Billing & Payments', items: [
    { key: 'invoices', label: 'Invoices', icon: ReceiptIcon, description: 'Sales Invoices and Credit Notes' },
    // Nested group, same shape as QcWorkspace's Approvals (Inward / Pre-Dispatch).
    {
      key: 'payment_tracker', label: 'Payment Tracker', icon: WalletIcon, group: true,
      children: [
        { key: 'payment_orders', label: 'Orders', icon: ClipboardListIcon, description: 'Order stages, value and payment position' },
        { key: 'payment_log', label: 'Payments', icon: BanknoteIcon, description: 'Log of payments received against orders' },
      ],
    },
    { key: 'returns', label: 'Returns', icon: UndoIcon, description: 'Returned material against a Sale Order' },
  ] },
  { label: 'Activity', items: [
    { key: 'tasks', label: 'Tasks', icon: CheckSquareIcon, description: 'Every to-do across leads, deals and customers' },
    { key: 'team', label: 'Team', icon: ContactIcon, description: 'Auto-assign new leads round-robin' },
  ] },
  { label: 'Setup', items: [
    // Branches/Product Master/Sales Targets/Email Templates — Sales-operational masters, same
    // nested-group shape as Payment Tracker above.
    {
      key: 'masters', label: 'Masters', icon: PackageIcon, group: true,
      children: [
        { key: 'branches', label: 'Branches', icon: Building2Icon, description: 'Office/location list for Enquiry and Sale Orders' },
        { key: 'products', label: 'Products', icon: PackageIcon, description: 'The sellable-SKU catalog' },
        { key: 'targets', label: 'Targets', icon: TargetIcon, description: 'Monthly Sales Targets per branch/manager' },
        { key: 'email_templates', label: 'Email Templates', icon: MailIcon, description: 'Commercial Offer wording, per company' },
      ],
    },
  ] },
];

export default function SalesWorkspace({ saleOrders, leads, customers, quotations, priceLists = [], returns = [], inventoryItems = [], invoices = [], creditNotes = [], departments = ['Sales'], users = [], savedViews = [], initialTab, canEditSoTax = false, projects = [], scopeOfSupply = [], initialScopeProject, salePayments = [], branches = [], salesProducts = [], salesTargets = [], stages = [] }) {
  const router = useRouter();
  // Sales-only now — Marketing has its own tab/URL (/market, MarketingWorkspace.jsx). No more
  // per-viewer group filtering; every group in PANEL_GROUPS always renders here.
  const groups = PANEL_GROUPS;
  // Deep-link tab selection (Part B) — same server-prop pattern as QcWorkspace.jsx.
  const flat = groups.flatMap(g => g.items.flatMap(p => (p.group ? p.children : [p])));
  const [panel, setPanel] = useState(flat.some(p => p.key === initialTab) ? initialTab : 'leads');
  const activePanel = flat.find(p => p.key === panel) || flat[0];

  return (
    <WorkspaceSidebar title="Sales" icon={TagIcon} groups={groups}
      activeKey={panel} onChange={setPanel} searchPlaceholder="Search…" searchNoun="sections"
      header={
        <>
          <activePanel.icon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">{activePanel.label}</h1>
            <p className="text-xs text-muted-foreground">{activePanel.description}</p>
          </div>
        </>
      }>
          {activePanel.key === 'enquiry' && <LeadsTab leads={leads} users={users} customers={customers} salesProducts={salesProducts} branches={branches} savedViews={savedViews} stages={stages} router={router} isEnquiry />}
          {activePanel.key === 'leads' && <LeadsTab leads={leads} users={users} customers={customers} salesProducts={salesProducts} branches={branches} stages={stages} savedViews={savedViews} router={router} />}
          {activePanel.key === 'customers' && <CustomersTab customers={customers} router={router} />}
          {activePanel.key === 'quotations' && <QuotationsTab quotations={quotations} customers={customers} salesProducts={salesProducts} router={router} />}
          {activePanel.key === 'price_lists' && <PriceListsTab priceLists={priceLists} customers={customers} router={router} />}
          {activePanel.key === 'sale_orders' && <SaleOrdersTab saleOrders={saleOrders} router={router} canEditSoTax={canEditSoTax} />}
          {activePanel.key === 'scope_of_supply' && (
            <ScopeOfSupplySection projects={projects} scopeOfSupply={scopeOfSupply} canEdit canSeeMoney
              initialProject={initialScopeProject} />
          )}
          {activePanel.key === 'invoices' && <InvoicesTab invoices={invoices} creditNotes={creditNotes} router={router} />}
          {activePanel.key === 'payment_orders' && <PaymentOrdersTab saleOrders={saleOrders} payments={salePayments} invoices={invoices} customers={customers} users={users} />}
          {activePanel.key === 'payment_log' && <PaymentLogTab saleOrders={saleOrders} payments={salePayments} invoices={invoices} />}
          {activePanel.key === 'returns' && <ReturnsTab returns={returns} saleOrders={saleOrders} inventoryItems={inventoryItems} router={router} />}
          {activePanel.key === 'tasks' && <AllTasksTab users={users} />}
          {activePanel.key === 'team' && <TeamTab users={users} departments={departments} />}
          {activePanel.key === 'branches' && <BranchesTab branches={branches} router={router} />}
          {activePanel.key === 'products' && <ProductsTab salesProducts={salesProducts} router={router} />}
          {activePanel.key === 'targets' && <TargetsTab salesTargets={salesTargets} branches={branches} router={router} />}
          {activePanel.key === 'email_templates' && <EmailTemplatesTab router={router} />}
    </WorkspaceSidebar>
  );
}
