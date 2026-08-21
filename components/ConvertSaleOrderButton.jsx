'use client';

// Design head's own entry point for the SO→Project handoff (SYSTEM.md §5e's STORES-SALES-CHANGES.md
// §2b/§4 flow) — previously reachable only from /sales, which is gated on Sales/Marketing department
// access. A Design-only head (the common demo case, no Sales grant) could never reach it there even
// though the button/API are both gated on isDesignHead. This replaces SalesWorkspace.jsx's old
// ConvertToProjectDialog (removed) — same POST /api/projects + sale_order_id call, now on the one
// surface every Design head can actually reach.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileCheckIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';

export default function ConvertSaleOrderButton({ saleOrders = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [soId, setSoId] = useState('');
  const [description, setDescription] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [saving, setSaving] = useState(false);

  const so = saleOrders.find(s => String(s.id) === soId);

  function reset() {
    setSoId(''); setDescription(''); setOrderDate(''); setSaving(false);
  }

  async function save() {
    if (!so) return;
    setSaving(true);
    try {
      const { id } = await api('/api/projects', {
        method: 'POST',
        body: { customer_name: so.customer_name || '', description: description.trim() || null, order_date: orderDate || null, sale_order_id: so.id },
      });
      showToast('Project created');
      setOpen(false);
      router.push(`/projects/${id}`);
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><FileCheckIcon data-icon="inline-start" />Convert Sale Order</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Convert a Sale Order to a Project</DialogTitle></DialogHeader>
        {saleOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Sale Orders awaiting conversion — every open Sale Order already has a project.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label>Sale Order *</Label>
              <Select value={soId} onValueChange={setSoId}>
                <SelectTrigger><SelectValue placeholder="Choose a Sale Order" /></SelectTrigger>
                <SelectContent>
                  {saleOrders.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.so_no}{s.customer_name ? ` · ${s.customer_name}` : ''}{s.total ? ` · ${formatMoney(s.total)}` : ''} · {s.item_count} item{s.item_count === 1 ? '' : 's'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Customer</Label><Input value={so?.customer_name || ''} disabled /></div>
            <div className="grid gap-1.5"><Label>Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="3 TPH Solid Fuel Boiler" /></div>
            <div className="grid gap-1.5"><Label>Order Date</Label><Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          {saleOrders.length > 0 && <Button onClick={save} disabled={!so || saving}>{saving ? 'Creating…' : 'Create Project'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
