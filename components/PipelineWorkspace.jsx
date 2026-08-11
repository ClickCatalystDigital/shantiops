'use client';

// V3_CHANGES.md §12 Phase 1 — the Sales+Marketing pipeline, extended from the original A4 build:
// customer_id picker (wires the previously-dead FK), DB-configurable stages (sales_stages, not a
// hardcoded array — decision 5), and a detail Sheet for line items + the shared CRM notes
// timeline (decision 4). Kanban drag-and-drop unchanged from A4 — same native-HTML5 pattern as
// StagesPanel.jsx's Kanban.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

function AddOpportunityDialog({ departments, customers, onClose, router }) {
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [valueNum, setValueNum] = useState('');
  const [ownerDept, setOwnerDept] = useState(departments[0] || 'Sales');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return showToast('Title is required', 'error');
    setSaving(true);
    try {
      const customer = customers.find(c => String(c.id) === customerId);
      await api('/api/opportunities', {
        method: 'POST',
        body: {
          title: title.trim(),
          customer_id: customerId || null,
          customer_name: customer?.name || null,
          value_num: valueNum ? Number(valueNum) : null,
          owner_dept: ownerDept,
        },
      });
      showToast('Opportunity added');
      router.refresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Opportunity</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="8T boiler upgrade" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label>Customer (optional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Choose customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Value ₹ (optional)</Label>
            <Input type="number" value={valueNum} onChange={e => setValueNum(e.target.value)} />
          </div>
          {departments.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Owner department</Label>
              <Select value={ownerDept} onValueChange={setOwnerDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Opportunity'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityDetailSheet({ opportunity, onClose, router }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api(`/api/opportunities/${opportunity.id}/items`).then(setItems).catch(() => {});
    api(`/api/crm-notes?opportunity_id=${opportunity.id}`).then(setNotes).catch(() => {});
  }
  useEffect(load, [opportunity.id]);

  function updateItem(i, key, val) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: val } : it));
  }
  function addRow() { setItems(prev => [...prev, { item_description: '', qty: 1, uom: 'Nos', rate: 0 }]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function saveItems() {
    setSaving(true);
    try {
      await api(`/api/opportunities/${opportunity.id}/items`, { method: 'PUT', body: { items } });
      showToast('Line items saved');
      router.refresh();
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      await api('/api/crm-notes', { method: 'POST', body: { opportunity_id: opportunity.id, content: note.trim() } });
      setNote(''); load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader><SheetTitle>{opportunity.title}</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>Line items</span>
              <Button size="sm" variant="outline" onClick={saveItems} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder="Description" value={it.item_description} onChange={e => updateItem(i, 'item_description', e.target.value)} className="flex-1" />
                  <Input placeholder="Qty" type="number" value={it.qty ?? ''} onChange={e => updateItem(i, 'qty', e.target.value)} className="w-16" />
                  <Input placeholder="Rate" type="number" value={it.rate ?? ''} onChange={e => updateItem(i, 'rate', e.target.value)} className="w-28" />
                  <Button size="sm" variant="ghost" onClick={() => removeRow(i)}><TrashIcon className="size-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addRow}><PlusIcon />Add line</Button>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Notes / activity</div>
            <div className="flex flex-col gap-1.5">
              {notes.map(n => <div key={n.id} className="rounded border px-2 py-1.5 text-sm"><span className="text-muted-foreground">{n.note_type}:</span> {n.content}</div>)}
            </div>
            <div className="mt-2 flex gap-2"><Input placeholder="Add a note" value={note} onChange={e => setNote(e.target.value)} /><Button size="sm" onClick={addNote}><PlusIcon /></Button></div>
          </div>
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function PipelineWorkspace({ opportunities, departments, customers, stages }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const stageNames = stages.map(s => s.name);

  async function move(opp, stage) {
    if (opp.stage === stage) return;
    setBusyId(opp.id);
    try {
      await api(`/api/opportunities/${opp.id}`, { method: 'PATCH', body: { stage } });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Opportunity Pipeline</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Opportunity</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No opportunities yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-5">
            {stageNames.map(stage => (
              <div
                key={stage}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  const id = Number(e.dataTransfer.getData('text/plain'));
                  const opp = opportunities.find(o => o.id === id);
                  if (opp) move(opp, stage);
                }}
                className="flex min-h-[10rem] flex-col gap-2 rounded-lg border bg-muted/30 p-2"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage}</div>
                {opportunities.filter(o => o.stage === stage).map(o => (
                  <div
                    key={o.id}
                    draggable={busyId !== o.id}
                    onDragStart={e => e.dataTransfer.setData('text/plain', String(o.id))}
                    onClick={() => setSelected(o)}
                    className="cursor-grab rounded-md border bg-background px-2.5 py-2 text-sm shadow-sm hover:bg-muted/40 active:cursor-grabbing"
                  >
                    <div className="font-medium">{o.title}</div>
                    {o.customer_name && <div className="text-xs text-muted-foreground">{o.customer_name}</div>}
                    <div className="mt-1 flex items-center justify-between">
                      <Badge variant="outline">{o.owner_dept}</Badge>
                      {o.value_num != null && <span className="text-xs font-semibold tnum">{formatMoney(o.value_num)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {dialogOpen && <AddOpportunityDialog departments={departments} customers={customers} router={router} onClose={() => setDialogOpen(false)} />}
      {selected && <OpportunityDetailSheet opportunity={selected} router={router} onClose={() => setSelected(null)} />}
    </Card>
  );
}
