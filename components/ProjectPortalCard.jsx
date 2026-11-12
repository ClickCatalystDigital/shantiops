'use client';

// Customer portal from the project page (PM only): switch it on, copy the set-password link to send by
// hand (WhatsApp / own email), preview what the customer sees. Same routes Sales uses, so a deployment
// without Sales (lib/manager-scope.mjs) still has a way in.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ProjectPortalCard({ customer }) {
  const router = useRouter();
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(path, body) {
    setBusy(true);
    try {
      const r = await api(path, { method: 'POST', body });
      if (r.setup_url) setLink(r.setup_url);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); showToast('Link copied'); } catch { showToast('Copy failed — select the link instead', 'error'); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Customer portal</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!customer ? (
          <p className="text-muted-foreground">Link a customer to this project (Edit project) to give them a portal login.</p>
        ) : !customer.portal_enabled ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">{customer.name} has no portal access yet.</span>
            <Button size="sm" disabled={busy} onClick={() => run(`/api/customers/${customer.id}/portal`, { enabled: true })}>Turn on portal</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span>{customer.name} · login <span className="font-mono">{customer.username || '—'}</span></span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/customers/${customer.id}/portal/resend`)}>New setup link</Button>
            <Button size="sm" variant="outline" asChild><a href={`/portal?customer=${customer.id}`} target="_blank" rel="noreferrer">View as customer ↗</a></Button>
          </div>
        )}
        {link && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
            <Button size="sm" variant="outline" onClick={copy}>Copy</Button>
            <span className="w-full text-xs text-muted-foreground">Send this to the customer; they set their own password with it (valid 30 days).</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
