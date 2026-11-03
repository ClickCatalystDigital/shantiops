'use client';
// QuickBooks status on an invoice row (US build, when connected): "In QuickBooks #1042", "Failed · Retry" with the
// reason on hover, or "Send". Renders nothing when QuickBooks is off. One shared /api/quickbooks/sync load per
// page, refreshed after a send. lib/quickbooks-sync.js.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, showToast, formatMoney } from '@/lib/client';

let shared = null;
const listeners = new Set();
function load(force) {
  if (!shared || force) {
    shared = api('/api/quickbooks/sync').catch(() => ({ enabled: false }));
    shared.then(s => listeners.forEach(l => l(s)));
  }
  return shared;
}
export function useQuickBooksSync() {
  const [s, setS] = useState(null);
  useEffect(() => { listeners.add(setS); load().then(setS); return () => listeners.delete(setS); }, []);
  return [s, () => load(true)];
}

export async function sendToQuickBooks(kind, id) {
  try {
    const r = await api('/api/quickbooks/send', { method: 'POST', body: { kind, id } });
    showToast(r.qbo_doc ? `Sent to QuickBooks as invoice ${r.qbo_doc}` : 'Sent to QuickBooks');
  } catch (err) { showToast(err.message, 'error'); }
  load(true);
}

export default function QuickBooksStatus({ invoiceId }) {
  const [s] = useQuickBooksSync();
  const [busy, setBusy] = useState(false);
  const e = s?.enabled && s.invoices?.[invoiceId];
  if (!e) return null;
  const send = async () => { setBusy(true); await sendToQuickBooks('invoice', invoiceId); setBusy(false); };
  if (e.status === 'sent') {
    const taxNote = e.theirs != null && Math.abs(e.theirs - e.ours) > 0.01
      ? `QuickBooks total ${formatMoney(e.theirs)} (it works out the sales tax) vs ${formatMoney(e.ours)} here` : 'Totals match';
    return <span className="whitespace-nowrap text-[11px] text-emerald-700 dark:text-emerald-400" title={taxNote}>In QuickBooks{e.qbo_doc && e.qbo_doc !== e.no ? ` · #${e.qbo_doc}` : ''}</span>;
  }
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-[11px]">
      {e.status === 'failed'
        ? <span className="text-destructive" title={e.error}>QuickBooks failed</span>
        : <span className="text-muted-foreground">Not in QuickBooks</span>}
      <Button size="sm" variant="link" className="h-auto p-0 text-[11px]" disabled={busy} onClick={send}>{e.status === 'failed' ? 'Retry' : 'Send'}</Button>
    </span>
  );
}
