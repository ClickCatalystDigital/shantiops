'use client';

// "Your orders" on the supplier's private RFQ link: once they are chosen and a PO is issued, they get
// a copy of it here and record the delivery (what is on the truck, carrier, tracking, invoice).
// Posts to the public /api/rfq/[token]/dispatch.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { carrierSummary } from '@/lib/carrier.mjs';
import { Button } from '@/components/ui/button';
import { compressImage } from '@/lib/image-compress';
import { DISPATCH_FILE_MAX } from '@/lib/po-dispatch.mjs';
import PoDispatchForm from '@/components/PoDispatchForm';
import { FileTextIcon, TruckIcon, PaperclipIcon, XIcon } from 'lucide-react';

function Order({ token, order }) {
  const router = useRouter();
  const [form, setForm] = useState(null); // null | 'new' | dispatch being edited
  const [busy, setBusy] = useState(false);
  const allSent = order.items.every(i => i.remaining <= 0);
  const [uploading, setUploading] = useState(null); // dispatch id being uploaded to

  // Up to 3 photos / files per dispatch. Phone photos are shrunk first; PDFs go as they are.
  async function upload(d, file) {
    if (!file) return;
    setUploading(d.id);
    try {
      const f = file.type.startsWith('image/') ? await compressImage(file) : file;
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`/api/rfq/${token}/dispatch/${d.id}/files`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      showToast('File added');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setUploading(null);
  }
  async function removeFile(f) {
    try { await api(`/api/rfq/${token}/dispatch-files/${f.id}`, { method: 'DELETE' }); router.refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  async function save(body) {
    setBusy(true);
    try {
      await api(`/api/rfq/${token}/dispatch`, { method: form === 'new' ? 'POST' : 'PUT', body: { ...body, po_id: order.id, dispatch_id: form === 'new' ? undefined : form.id } });
      showToast('Delivery details saved');
      setForm(null);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-semibold">Purchase order {order.po_no}</span>
        {order.issued_at && <span className="text-xs text-muted-foreground">issued {formatDate(order.issued_at)}</span>}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/rfq/${token}/po/${order.id}/pdf`} target="_blank" rel="noreferrer"><FileTextIcon className="size-3.5" /> Download PO</a></Button>
          {!allSent && !form && <Button size="sm" onClick={() => setForm('new')}><TruckIcon className="size-3.5" /> Add delivery details</Button>}
        </div>
      </div>
      <div className="divide-y border-t text-sm">
        {order.items.map(i => (
          <div key={i.id} className="flex flex-wrap items-center gap-x-3 px-4 py-1.5">
            <span className="min-w-0 flex-1">{i.description}</span>
            <span className="text-xs text-muted-foreground tnum">{i.qty}{i.uom ? ` ${i.uom}` : ''} ordered · {i.sent} sent · {i.remaining > 0 ? `${i.remaining} to go` : 'all sent'}</span>
          </div>
        ))}
      </div>
      {order.dispatches.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-2.5">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Dispatches you have recorded</div>
          {order.dispatches.map(d => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
              <span className="tnum">{formatDate(d.dispatched_on)}</span>
              <span className="text-xs text-muted-foreground">{d.items.map(i => `${i.qty} × ${i.description}`).join(', ')}</span>
              <span className="text-xs text-muted-foreground">{carrierSummary(d, formatDate)}</span>
              {d.tracking_url && <a href={d.tracking_url} target="_blank" rel="noreferrer noopener" className="text-xs underline underline-offset-2">Tracking</a>}
              {d.locked
                ? <span className="ml-auto text-xs text-muted-foreground">Received by Stores, locked</span>
                : <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setForm(d)}>Edit</Button>}
              <div className="flex w-full flex-wrap items-center gap-2 pb-1 text-xs">
                {d.files.map(f => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5">
                    <a href={`/api/rfq/${token}/dispatch-files/${f.id}`} target="_blank" rel="noreferrer" className="max-w-40 truncate underline-offset-2 hover:underline">{f.filename}</a>
                    {!d.locked && <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => removeFile(f)} className="text-muted-foreground hover:text-danger"><XIcon className="size-3" /></button>}
                  </span>
                ))}
                {!d.locked && d.files.length < DISPATCH_FILE_MAX && (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-muted-foreground hover:bg-muted">
                    <PaperclipIcon className="size-3" />{uploading === d.id ? 'Uploading…' : `Add photo or file (${d.files.length}/${DISPATCH_FILE_MAX})`}
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" disabled={uploading !== null}
                      onChange={e => { upload(d, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className="border-t px-4 py-4">
          <h3 className="mb-3 text-sm font-semibold">{form === 'new' ? 'Add delivery details' : 'Edit delivery details'}</h3>
          <PoDispatchForm items={order.items} initial={form === 'new' ? null : form} busy={busy} onSubmit={save} onCancel={() => setForm(null)} />
        </div>
      )}
    </section>
  );
}

export default function SupplierOrders({ token, orders }) {
  if (!orders.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Your orders</h2>
        <p className="text-sm text-muted-foreground">You have been chosen. Download your purchase order here, and tell us when the goods are dispatched.</p>
      </div>
      {orders.map(o => <Order key={o.id} token={token} order={o} />)}
    </div>
  );
}
