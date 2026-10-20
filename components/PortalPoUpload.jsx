'use client';
// Customer Portal: the customer attaches their own PO to an open Sale Order (optional). Lands in the
// order's Attach Files, named "Customer PO - …", and Sales is notified.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/client';
import { UploadIcon } from 'lucide-react';

export default function PortalPoUpload({ saleOrderId, uploaded }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/sale-orders/${saleOrderId}/attachments`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      showToast('PO uploaded');
      router.refresh();
    } catch (e) { showToast(e.message, 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <>
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={e => upload(e.target.files?.[0])} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <UploadIcon className="size-3.5" data-icon="inline-start" />{busy ? 'Uploading…' : uploaded ? 'Upload a new PO' : 'Upload your PO'}
      </Button>
    </>
  );
}
