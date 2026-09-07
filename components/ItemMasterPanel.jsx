'use client';

// components/ItemMasterPanel.jsx — Engineering's Item Master maintenance surface (2026-09-07,
// SYSTEM.md's Item Master audit round). A real CRUD UI onto the `items` catalog table, which until
// now had no in-app creation/edit path at all (confirmed by grep before building this — see the
// session's own audit record) — free-typed BOM lines simply stayed free text, or got linked to one
// of the 2,773 rows this table already carried from the original ERP import. This closes that gap.
//
// No Delete action — deliberately, per direct instruction: this is shared master data referenced
// from bom_items/inventory_items across every project, and this app has no soft-delete/active
// flag on `items` to build one against (confirmed by reading the schema, not assumed) — same
// "don't invent a mechanism that doesn't exist" boundary the rest of this round has followed.
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusIcon, PencilIcon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import SearchableSelect from '@/components/SearchableSelect';

const COLUMNS = [
  { key: 'item_code', label: 'Item Code', sortable: true },
  { key: 'item_name', label: 'Item Name', sortable: true },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'bom_category', label: 'BOM Category', sortable: true },
  { key: 'uom', label: 'UOM', sortable: true },
  { key: 'material_process_type', label: 'Process Type', sortable: true },
  { key: 'item_type', label: 'Item Type', sortable: true },
];

// Fields that must only ever be a number — matches the server-side check in
// app/api/item-master/route.js exactly, so a typo is caught before the round-trip, not just after.
const NUMERIC_FIELDS = ['cqty', 'cfactor', 'min_qty', 'max_qty', 'lead_time', 'tolerance_plus', 'tolerance_minus', 'hsn_item_pct'];

function optList(values) {
  return (values || []).filter(Boolean).map(v => ({ value: v, label: v }));
}

// ---------- Add/Edit form ----------

function ItemMasterForm({ id, facets, onClose, onSaved }) {
  const isEdit = !!id;
  const [form, setForm] = useState({});
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState(null); // null = not checked yet, [] = checked clean, [...] = needs confirm

  useEffect(() => {
    if (!isEdit) return;
    api(`/api/item-master/${id}`).then(data => {
      const { usage: u, id: _id, created_at, ...rest } = data;
      setForm(rest);
      setUsage(u);
      setLoading(false);
    }).catch(err => { showToast(err.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (field === 'item_name') setDuplicates(null); // name changed, any prior duplicate check is stale
  }

  async function save(confirm = false) {
    if (!String(form.item_name || '').trim()) return showToast('Item Name is required', 'error');
    if (!String(form.uom || '').trim()) return showToast('UOM is required', 'error');
    for (const f of NUMERIC_FIELDS) {
      const v = form[f];
      if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
        return showToast(`${f.replace(/_/g, ' ')} must be a number`, 'error');
      }
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api(`/api/item-master/${id}`, { method: 'PATCH', body: form });
        showToast('Item updated');
        onSaved();
        onClose();
      } else {
        // Raw fetch, not the shared api() helper — a 409 here carries a real `duplicates` payload
        // the caller needs to show, which api() discards (it only ever keeps `error`).
        const res = await fetch('/api/item-master', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, confirm }),
        });
        const data = await res.json();
        if (res.status === 409 && data.duplicates) {
          setDuplicates(data.duplicates);
          setSaving(false);
          return;
        }
        if (!res.ok) throw new Error(data.error || 'Something went wrong');
        showToast(`Created ${data.item_code}`);
        onSaved();
        onClose();
      }
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  if (loading) return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent><p className="py-8 text-center text-sm text-muted-foreground">Loading…</p></DialogContent>
    </Dialog>
  );

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Item — ${form.item_code}` : 'Add Item Master Record'}</DialogTitle>
        </DialogHeader>

        {isEdit && usage && (usage.bom_lines > 0 || usage.inventory_lines > 0) && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
            Shared master data — used on <strong>{usage.bom_lines}</strong> BOM line{usage.bom_lines === 1 ? '' : 's'} across{' '}
            <strong>{usage.bom_projects}</strong> project{usage.bom_projects === 1 ? '' : 's'}
            {usage.inventory_lines > 0 && <> and <strong>{usage.inventory_lines}</strong> Stores inventory line{usage.inventory_lines === 1 ? '' : 's'}</>}.
            Edit carefully — every one of them reads this record live.
          </div>
        )}

        {duplicates && duplicates.length > 0 && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
            <p className="font-medium text-danger">Possible duplicate{duplicates.length === 1 ? '' : 's'} already in the catalog:</p>
            <ul className="mt-1 list-disc pl-4">
              {duplicates.map(d => <li key={d.id}>{d.item_code} — {d.item_name}</li>)}
            </ul>
            <p className="mt-2 text-muted-foreground">If this is genuinely a different item, confirm below to create it anyway.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label>Item Name *</Label>
            <Input value={form.item_name || ''} onChange={e => set('item_name', e.target.value)} placeholder="e.g. STAY TUBE 63.5 OD X 3.66 THK" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <SearchableSelect value={form.category || ''} onChange={v => set('category', v)}
                displayValue={form.category || ''} onTextChange={v => set('category', v)}
                options={optList(facets.category)} placeholder="e.g. BOI, RAW MATERIALS…" />
            </div>
            <div className="grid gap-1.5">
              <Label>BOM Category</Label>
              <SearchableSelect value={form.bom_category || ''} onChange={v => set('bom_category', v)}
                displayValue={facets.bom_category.find(o => o.value === form.bom_category)?.label || ''}
                options={facets.bom_category} placeholder="Pick a shape/type…" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>UOM *</Label>
              <SearchableSelect value={form.uom || ''} onChange={v => set('uom', v)}
                displayValue={form.uom || ''} onTextChange={v => set('uom', v)}
                options={optList(facets.uom)} placeholder="Nos, Mtrs…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Process Type</Label>
              <SearchableSelect value={form.material_process_type || ''} onChange={v => set('material_process_type', v)}
                displayValue={form.material_process_type || ''} onTextChange={v => set('material_process_type', v)}
                options={optList(facets.material_process_type)} placeholder="Procured, Manufactured…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Item Type</Label>
              <SearchableSelect value={form.item_type || ''} onChange={v => set('item_type', v)}
                displayValue={form.item_type || ''} onTextChange={v => set('item_type', v)}
                options={optList(facets.item_type)} placeholder="Purchase, Make…" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Group Name</Label>
            <Input value={form.group_name || ''} onChange={e => set('group_name', e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input value={form.detail_desc || ''} onChange={e => set('detail_desc', e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>HSN Code</Label><Input value={form.hsn_code || ''} onChange={e => set('hsn_code', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>HSN Description</Label><Input value={form.hsn_desc || ''} onChange={e => set('hsn_desc', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>GST %</Label><Input type="number" value={form.hsn_item_pct ?? ''} onChange={e => set('hsn_item_pct', e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="grid gap-1.5"><Label>Min Qty</Label><Input type="number" value={form.min_qty ?? ''} onChange={e => set('min_qty', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Max Qty</Label><Input type="number" value={form.max_qty ?? ''} onChange={e => set('max_qty', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Lead Time (days)</Label><Input type="number" value={form.lead_time ?? ''} onChange={e => set('lead_time', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Store Location</Label><Input value={form.store_location || ''} onChange={e => set('store_location', e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Tolerance + (mm)</Label><Input type="number" value={form.tolerance_plus ?? ''} onChange={e => set('tolerance_plus', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Tolerance − (mm)</Label><Input type="number" value={form.tolerance_minus ?? ''} onChange={e => set('tolerance_minus', e.target.value)} /></div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Traceability requirements this item defaults a BOM line to</Label>
            <div className="flex flex-wrap gap-4">
              {[['default_requires_heat_no', 'Heat No.'], ['default_requires_mtc', 'MTC'], ['default_requires_supplier_batch', 'Supplier Batch'], ['default_requires_serial_no', 'Serial No.']].map(([f, label]) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!form[f]} onCheckedChange={v => set(f, v ? 1 : 0)} /> {label}
                </label>
              ))}
            </div>
          </div>

          {isEdit && <p className="text-xs text-muted-foreground">Item Code: <span className="font-mono">{form.item_code}</span> — assigned at creation, cannot be changed.</p>}
        </div>

        <DialogFooter>
          {duplicates && duplicates.length > 0 ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button variant="destructive" onClick={() => save(true)} disabled={saving}>{saving ? 'Creating…' : 'Create anyway'}</Button>
            </>
          ) : (
            <Button onClick={() => save(false)} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create item'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- List ----------

export default function ItemMasterPanel() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'item_name', dir: 'asc' });
  const [data, setData] = useState(null);
  const [formId, setFormId] = useState(undefined); // undefined = closed, null = add, number = edit

  function load() {
    const params = new URLSearchParams({ page: String(page), sort: sort.key, dir: sort.dir });
    if (q.trim()) params.set('search', q.trim());
    api(`/api/item-master?${params}`).then(setData).catch(err => showToast(err.message, 'error'));
  }
  useEffect(() => { load(); }, [page, sort, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [q]);

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Item Master</CardTitle>
        <CardAction><Button size="sm" onClick={() => setFormId(null)}><PlusIcon /> Add Item</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item name, code, category, HSN…" className="max-w-sm" />

        {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map(c => (
                      <TableHead key={c.key}>
                        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>
                          {c.label}
                          {sort.key === c.key && (sort.dir === 'asc' ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
                        </button>
                      </TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={COLUMNS.length + 1} className="text-center text-sm text-muted-foreground py-6">No items match.</TableCell></TableRow>
                  ) : data.rows.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setFormId(r.id)}>
                      <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
                      <TableCell className="max-w-80 truncate font-medium" title={r.item_name}>{r.item_name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.category || '—'}</TableCell>
                      <TableCell>{r.bom_category ? <Badge variant="secondary">{r.bom_category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{r.uom || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.material_process_type || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.item_type || '—'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setFormId(r.id); }}><PencilIcon className="size-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{data.total} item{data.total === 1 ? '' : 's'}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <span>Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {formId !== undefined && data && (
        <ItemMasterForm id={formId} facets={data.facets} onClose={() => setFormId(undefined)} onSaved={load} />
      )}
    </Card>
  );
}
