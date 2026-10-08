'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

const SHOW = 100; // rows drawn at once — search narrows the rest

// Add-products overlay: search the Product Master, tick any number of rows (or Select all for the
// current search), then Add. The caller turns each picked product into its own line.
export default function ProductPickerDialog({ onClose, onAdd }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Map());

  useEffect(() => {
    api('/api/sales-products').then(r => setRows(r.filter(p => p.active !== 0))).catch(err => { showToast(err.message, 'error'); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!rows) return [];
    if (!n) return rows;
    return rows.filter(p => [p.product_code, p.product_name, p.product_type, p.description].some(v => (v || '').toLowerCase().includes(n)));
  }, [rows, q]);
  const shown = filtered.slice(0, SHOW);
  const allPicked = filtered.length > 0 && filtered.every(p => picked.has(p.id));

  function toggle(p, on) {
    setPicked(prev => { const m = new Map(prev); if (on) m.set(p.id, p); else m.delete(p.id); return m; });
  }
  function toggleAll(on) {
    setPicked(prev => { const m = new Map(prev); filtered.forEach(p => (on ? m.set(p.id, p) : m.delete(p.id))); return m; });
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-6xl">
        <DialogHeader><DialogTitle>Add products</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Search by code, name, type or description…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {!rows ? <p className="p-4 text-sm text-muted-foreground">Loading products…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox aria-label="Select all" checked={allPicked} onCheckedChange={v => toggleAll(!!v)} /></TableHead>
                  <TableHead>Product Code</TableHead><TableHead>Product Name</TableHead><TableHead>Product Type</TableHead>
                  <TableHead>Description</TableHead><TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(p => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => toggle(p, !picked.has(p.id))}>
                    <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${p.product_name}`} checked={picked.has(p.id)} onCheckedChange={v => toggle(p, !!v)} /></TableCell>
                    <TableCell className="whitespace-nowrap">{p.product_code || '—'}</TableCell>
                    <TableCell className="font-medium">{p.product_name}</TableCell>
                    <TableCell>{p.product_type || '—'}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground" title={p.description || ''}>{p.description || '—'}</TableCell>
                    <TableCell className="text-right tnum">{p.price != null ? formatMoney(p.price) : '—'}</TableCell>
                  </TableRow>
                ))}
                {!shown.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No products match.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length > SHOW ? `Showing the first ${SHOW} of ${filtered.length} — search to narrow. ` : `${filtered.length} products. `}
          Select all ticks every product in this search.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked.size} onClick={() => { onAdd([...picked.values()]); onClose(); }}>Add {picked.size || ''} {picked.size === 1 ? 'product' : 'products'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
