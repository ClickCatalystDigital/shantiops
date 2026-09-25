'use client';

// components/ConvertLeadChoice.jsx — Sales CRM plan 1k. useLeadConvert() wraps
// POST /api/leads/[id]/convert: if the server answers 409 with likely duplicate customers, it shows
// a small dialog to link one of them or create a new customer, then retries with that choice.
// Resolves to the customer id, or null if the person cancels. Render `dialog` somewhere.
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/client';

export function useLeadConvert() {
  const [pending, setPending] = useState(null); // { lead, duplicates, resolve, reject }

  async function post(lead, body) {
    const res = await api(`/api/leads/${lead.id}/convert`, { method: 'POST', body });
    return res.customer_id;
  }

  async function convert(lead) {
    try {
      return await post(lead, {});
    } catch (err) {
      if (err.status !== 409 || !err.data?.duplicates) throw err;
      return new Promise((resolve, reject) => setPending({ lead, duplicates: err.data.duplicates, resolve, reject }));
    }
  }

  async function choose(body) {
    const p = pending;
    setPending(null);
    if (!body) return p.resolve(null);
    try { p.resolve(await post(p.lead, body)); } catch (err) { p.reject(err); }
  }

  const dialog = pending && (
    <Dialog open onOpenChange={o => !o && choose(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Is this an existing customer?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          “{pending.lead.company_name || pending.lead.lead_name}” looks like these customers. Link the enquiry to one of them, or create a new customer.
        </p>
        <div className="flex flex-col gap-2">
          {pending.duplicates.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">{[d.gst_no, d.phone].filter(Boolean).join(' · ') || '—'} · {d.reasons.join(', ')}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => choose({ customer_id: d.id })}>Use this</Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => choose(null)}>Cancel</Button>
          <Button onClick={() => choose({ create_new: true })}>Create new customer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { convert, dialog };
}

// Non-blocking warning for Add Customer / Add Enquiry: lists likely existing matches.
export function SimilarCustomersHint({ matches }) {
  if (!matches?.length) return null;
  return (
    <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs">
      <div className="font-medium">Possible existing customer{matches.length > 1 ? 's' : ''}:</div>
      {matches.map(m => <div key={m.id}>{m.name} <span className="text-muted-foreground">({m.reasons.join(', ')})</span></div>)}
    </div>
  );
}

// Debounced lookup behind SimilarCustomersHint (GET /api/customers/similar).
export function useSimilarCustomers({ name = '', gst_no = '', phone = '' }) {
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    if (name.trim().length < 3 && !gst_no.trim() && phone.replace(/\D/g, '').length < 10) { setMatches([]); return; }
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ name, gst_no, phone });
      api(`/api/customers/similar?${qs}`).then(setMatches).catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(t);
  }, [name, gst_no, phone]);
  return matches;
}
