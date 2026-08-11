'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// V3_CHANGES.md §12 Phase 2f — customer picker wires the new nullable projects.customer_id.
// customer_name stays required/free-text exactly as before (backward-compat with the 6
// pre-existing projects); picking a customer here just autofills it and sets the id alongside.
export default function NewProjectForm({ customers = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ project_no: '', customer_name: '', customer_id: '', description: '', order_date: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api('/api/projects', { method: 'POST', body: f });
      showToast('Project created');
      setOpen(false);
      router.push(`/projects/${id}`);
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><PlusIcon data-icon="inline-start" />New Project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project No <span className="text-muted-foreground">(blank = auto)</span></Label>
              <Input value={f.project_no} onChange={e => setF({ ...f, project_no: e.target.value })} placeholder="SB-1019" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Order Date</Label>
              <Input type="date" value={f.order_date} onChange={e => setF({ ...f, order_date: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Customer *</Label>
            {customers.length > 0 && (
              <Select value={f.customer_id} onValueChange={id => {
                const c = customers.find(x => String(x.id) === id);
                setF({ ...f, customer_id: id, customer_name: c?.name || f.customer_name });
              }}>
                <SelectTrigger><SelectValue placeholder="Pick an existing customer (optional)" /></SelectTrigger>
                <SelectContent>{customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Input required value={f.customer_name} onChange={e => setF({ ...f, customer_name: e.target.value, customer_id: '' })} placeholder="Or type a customer name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="3 TPH Solid Fuel Boiler" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
