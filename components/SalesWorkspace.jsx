'use client';

// components/SalesWorkspace.jsx — V3_CHANGES.md §12 Phase 2c. Leads | Customers | Quotations |
// Sale Orders | Campaigns, same multi-tab-in-one-file precedent as ProcurementWorkspace.jsx.
// Customer detail (contacts/addresses/notes) opens in a right-side Sheet, same drawer pattern
// HrWorkspace.jsx's employee detail uses.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

// --- Leads --------------------------------------------------------------------------------------

function AddLeadDialog({ onClose, router }) {
  const [leadName, setLeadName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!leadName.trim()) return showToast('Lead name is required', 'error');
    setSaving(true);
    try {
      await api('/api/leads', { method: 'POST', body: { lead_name: leadName.trim(), company_name: companyName || null, phone: phone || null } });
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
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Lead'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadsTab({ leads, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function convert(lead) {
    setBusyId(lead.id);
    try {
      await api(`/api/leads/${lead.id}/convert`, { method: 'POST', body: {} });
      showToast('Converted to Customer + Opportunity');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Lead</Button></CardAction>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No leads yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {leads.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.lead_name}</TableCell>
                  <TableCell className="text-muted-foreground">{l.company_name || '—'}</TableCell>
                  <TableCell><Badge variant={l.status === 'converted' ? 'default' : 'outline'}>{l.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{l.owner_dept}</TableCell>
                  <TableCell>
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
            <div className="text-sm text-muted-foreground">{detail.gst_no || 'No GST on file'}</div>

            <div>
              <div className="mb-2 text-sm font-semibold">Contacts</div>
              <div className="flex flex-col gap-1.5">
                {detail.contacts.map(c => <div key={c.id} className="rounded border px-2 py-1.5 text-sm">{c.name}{c.phone ? ` · ${c.phone}` : ''}</div>)}
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

// -----------------------------------------------------------------------------------------------

export default function SalesWorkspace({ saleOrders, leads, customers, quotations, campaigns }) {
  const router = useRouter();
  const [tab, setTab] = useState('leads');

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex-col gap-4">
      <TabsList variant="line" className="w-full justify-start px-0">
        <TabsTrigger value="leads" className="flex-none">Leads</TabsTrigger>
        <TabsTrigger value="customers" className="flex-none">Customers</TabsTrigger>
        <TabsTrigger value="quotations" className="flex-none">Quotations</TabsTrigger>
        <TabsTrigger value="sale_orders" className="flex-none">Sale Orders</TabsTrigger>
        <TabsTrigger value="campaigns" className="flex-none">Campaigns</TabsTrigger>
      </TabsList>
      <TabsContent value="leads"><LeadsTab leads={leads} router={router} /></TabsContent>
      <TabsContent value="customers"><CustomersTab customers={customers} router={router} /></TabsContent>
      <TabsContent value="quotations"><QuotationsTab quotations={quotations} customers={customers} router={router} /></TabsContent>
      <TabsContent value="sale_orders"><SaleOrdersTab saleOrders={saleOrders} router={router} /></TabsContent>
      <TabsContent value="campaigns"><CampaignsTab campaigns={campaigns} router={router} /></TabsContent>
    </Tabs>
  );
}
