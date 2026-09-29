'use client';

// components/SalesRetentionPanel.jsx — Sales → Setup → Masters → Data retention (Sales Head / PM).
// A retention window for Sales history (follow-up notes + enquiry stage history), OFF by default.
// Turning it on or changing it deletes nothing: it only decides what the Sales Head is offered to
// clean up, and a cleanup needs a backup download + an explicit confirm (lib/sales-retention.js).
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { RETENTION_OPTIONS, retentionLabel, retentionShort } from '@/lib/sales-retention.mjs';
import { DownloadIcon, Trash2Icon, ShieldCheckIcon, LoaderIcon } from 'lucide-react';

const total = p => (p?.sources || []).reduce((s, x) => s + x.count, 0);

export default function SalesRetentionPanel() {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const load = () => api('/api/sales-retention/preview').then(setP).catch(err => showToast(err.message, 'error'));
  useEffect(() => { load(); }, []);
  if (!p) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  async function save(next) {
    setBusy('save');
    try { await api('/api/settings/sales-retention', { method: 'PATCH', body: { enabled: p.enabled, months: p.months, ...next } }); await load(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(null); }
  }
  async function backup() {
    setBusy('backup');
    try {
      const res = await fetch('/api/sales-retention/backup');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Backup failed');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `sales-history-backup-${new Date().toISOString().slice(0, 10)}.xlsx` });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showToast('Backup downloaded'); await load();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(null); }
  }
  async function run() {
    setBusy('run');
    try {
      const r = await api('/api/sales-retention/run', { method: 'POST', body: { confirm: true } });
      setConfirm(false);
      showToast(`Deleted ${Object.values(r.deleted).reduce((a, b) => a + b, 0).toLocaleString('en-IN')} records`);
      await load();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(null); }
  }

  const n = total(p);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data retention</CardTitle>
        <CardDescription>Keep Sales follow-up history for a fixed time, then clean it up on your say-so. Off by default.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <div className="text-sm font-medium">{p.enabled ? 'Retention window is on' : 'Retention window is off'}</div>
            <div className="text-xs text-muted-foreground">{p.enabled ? 'Records past the window are offered for cleanup below.' : 'All history is kept. Nothing is offered for cleanup.'}</div>
          </div>
          <button type="button" role="switch" aria-checked={p.enabled} disabled={busy === 'save'} onClick={() => save({ enabled: !p.enabled, months: p.months || 12 })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${p.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
            <span className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${p.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className={p.enabled ? '' : 'opacity-50'}>
          <div className="mb-2 text-sm font-medium">Keep history for</div>
          <div className="flex flex-wrap gap-1.5">
            {RETENTION_OPTIONS.map(m => (
              <button key={m} type="button" title={retentionLabel(m)} disabled={!p.enabled || busy === 'save'} onClick={() => save({ months: m })}
                className={`min-w-12 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${p.months === m ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {retentionShort(m)}
              </button>
            ))}
          </div>
          {p.enabled && p.months && <p className="mt-2 text-sm text-muted-foreground">Follow-ups and stage history from before <span className="font-medium text-foreground">{formatDate(p.cutoff)}</span> ({retentionLabel(p.months)} ago) can be cleaned up.</p>}
        </div>

        {p.months && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {p.sources.map(s => (
              <div key={s.key} className="rounded-xl border p-4">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="mt-1 text-2xl font-semibold tnum">{s.count.toLocaleString('en-IN')}</div>
                <div className="text-xs text-muted-foreground">{s.count ? `past the window, oldest ${formatDate(s.oldest)}` : 'nothing past the window'}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
          <span>Always kept: each enquiry's and customer's latest follow-up, each enquiry's current stage record, follow-ups still planned for today or later, and every quotation, order, invoice and payment. Marketing records are not touched. Removing history also removes its detail from reports for the periods before the cutoff (days-in-stage, sales-call counts).</span>
        </div>

        {p.enabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={!n || busy} onClick={backup}>{busy === 'backup' ? <LoaderIcon className="animate-spin" /> : <DownloadIcon />} Download backup</Button>
            <Button variant="destructive" disabled={!n || !p.backupReady || busy} onClick={() => setConfirm(true)}><Trash2Icon /> Delete {n.toLocaleString('en-IN')} records</Button>
            <span className="text-xs text-muted-foreground">{!n ? 'Nothing to clean up.' : p.backupReady ? 'Backup ready — valid for one hour.' : 'Download the backup first; it unlocks the delete.'}</span>
          </div>
        )}
        {p.last && <p className="text-xs text-muted-foreground">Last cleanup {formatDate(p.last.at)} by {p.last.by}: {Object.values(p.last.deleted).reduce((a, b) => a + b, 0).toLocaleString('en-IN')} records ({retentionLabel(p.last.months)} window).</p>}
      </CardContent>

      <Dialog open={confirm} onOpenChange={o => !busy && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {n.toLocaleString('en-IN')} records?</DialogTitle>
            <DialogDescription>These are older than {retentionLabel(p.months || 0)}. The backup you downloaded is the only copy afterwards — deleted records do not come back, even if you extend the window later.</DialogDescription>
          </DialogHeader>
          <ul className="text-sm">{p.sources.map(s => <li key={s.key} className="flex justify-between border-b py-1"><span>{s.label}</span><span className="tnum font-medium">{s.count.toLocaleString('en-IN')}</span></li>)}</ul>
          <DialogFooter className="m-0">
            <Button variant="outline" disabled={busy === 'run'} onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy === 'run'} onClick={run}>{busy === 'run' ? <LoaderIcon className="animate-spin" /> : <Trash2Icon />} Delete now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
