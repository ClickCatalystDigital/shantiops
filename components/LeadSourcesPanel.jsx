'use client';

// Marketing → Lead sources. One card per source (IndiaMART, TradeIndia, JustDial, Website), per company.
// Pull sources take credentials (stored encrypted, never shown again); push sources get a secret
// address to hand to the provider. Leads land straight in Sales → Enquiries (lib/lead-ingest.js).
import { useEffect, useState } from 'react';
import { CopyIcon, RefreshCwIcon, PauseIcon, PlayIcon, UnplugIcon, CheckIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TILE = { indiamart: 'IM', tradeindia: 'TI', justdial: 'Jd', webform: 'www' };

function StatusPill({ acc }) {
  const [text, tone] = !acc?.connected ? ['Not connected', 'bg-muted text-muted-foreground']
    : !acc.enabled ? ['Paused', 'bg-warning/10 text-warning']
    : acc.last_error ? ['Needs attention', 'bg-danger/10 text-danger']
    : ['Connected', 'bg-success/10 text-success'];
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', tone)}>{text}</span>;
}

function SourceCard({ source, company, acc, reload }) {
  const [creds, setCreds] = useState({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const pull = source.kind === 'pull';
  const showForm = pull && (!acc?.connected || editing);

  async function call(method, body, okMsg, key) {
    setBusy(key);
    try {
      const r = await api('/api/lead-sources', { method, body: { company, source: source.key, ...body } });
      if (okMsg) showToast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      setEditing(false); setCreds({});
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(null); reload();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-xs font-semibold text-primary ring-1 ring-primary/10">{TILE[source.key]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{source.label}</p>
          <p className="text-xs text-muted-foreground">{pull ? `Checked every ${source.everyMin} min while SB Ops is open` : 'Sends leads to SB Ops instantly'}</p>
        </div>
        <StatusPill acc={acc} />
      </div>

      {showForm && (
        <div className="flex flex-col gap-2">
          {source.fields.map(f => (
            <div key={f.key} className="grid gap-1">
              <Label className="text-xs">{f.label}</Label>
              <Input type="password" autoComplete="new-password" value={creds[f.key] || ''} onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))} />
              {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => call('PUT', { credentials: creds }, 'Connected — use Sync now to check the key', 'save')}>{busy === 'save' ? 'Saving…' : 'Connect'}</Button>
            {editing && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      )}

      {!pull && !acc?.connected && (
        <>
          <p className="text-xs text-muted-foreground">{source.howTo}</p>
          <div><Button size="sm" disabled={!!busy} onClick={() => call('PUT', {}, 'Address created', 'save')}>Create address</Button></div>
        </>
      )}

      {!pull && acc?.connected && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Input readOnly value={acc.hook_url} className="h-8 font-mono text-xs" onFocus={e => e.target.select()} />
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(acc.hook_url); showToast('Address copied'); }}><CopyIcon data-icon="inline-start" />Copy</Button>
          </div>
          <p className="text-xs text-muted-foreground">{source.howTo}</p>
        </div>
      )}

      {acc?.connected && (
        <>
          <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
            <div><dt className="text-muted-foreground">{pull ? 'Last checked' : 'Last lead'}</dt><dd className="font-medium">{acc.last_sync_at ? formatDate(acc.last_sync_at) : 'Never'}</dd></div>
            <div><dt className="text-muted-foreground">Last time</dt><dd className="font-medium tnum">{acc.last_added} lead{acc.last_added === 1 ? '' : 's'}</dd></div>
            <div><dt className="text-muted-foreground">Total</dt><dd className="font-medium tnum">{acc.total_added}</dd></div>
          </dl>
          {acc.last_error && <p className="rounded-md bg-danger/5 px-2.5 py-1.5 text-xs text-danger">{acc.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            {pull && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('POST', {}, r => `${r.added} new, ${r.merged} added to existing enquiries`, 'sync')}>
              <RefreshCwIcon data-icon="inline-start" className={cn(busy === 'sync' && 'animate-spin')} />{busy === 'sync' ? 'Checking…' : 'Sync now'}</Button>}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => call('PUT', { enabled: !acc.enabled }, acc.enabled ? 'Paused' : 'Resumed', 'pause')}>
              {acc.enabled ? <><PauseIcon data-icon="inline-start" />Pause</> : <><PlayIcon data-icon="inline-start" />Resume</>}</Button>
            {pull && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Change key</Button>}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!!busy}
              onClick={() => window.confirm(`Disconnect ${source.label}? Leads already received stay.`) && call('DELETE', {}, 'Disconnected', 'del')}>
              <UnplugIcon data-icon="inline-start" />Disconnect</Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function LeadSourcesPanel() {
  const [data, setData] = useState(null);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState(null);
  function load() {
    api('/api/lead-sources').then(d => { setData(d); setCompany(c => c || d.companies[0]?.company || null); }).catch(e => setError(e.message));
  }
  useEffect(load, []);
  if (error) return <Card><CardContent className="py-6 text-sm text-muted-foreground">{error}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading lead sources…</CardContent></Card>;
  const co = data.companies.find(c => c.company === company);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead sources</CardTitle>
        <CardDescription className="flex items-center gap-1.5"><CheckIcon className="size-3.5 text-success" />Every lead becomes a Sales enquiry, assigned in turn, with an alert. A repeat from the same phone number is added to the open enquiry instead.</CardDescription>
        {data.companies.length > 1 && (
          <CardAction>
            <Select value={company || ''} onValueChange={setCompany}>
              <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{data.companies.map(c => <SelectItem key={c.company} value={c.company}>{c.company}</SelectItem>)}</SelectContent>
            </Select>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {co && data.sources.map(s => <SourceCard key={`${co.company}:${s.key}`} source={s} company={co.company} acc={co.accounts[s.key]} reload={load} />)}
      </CardContent>
    </Card>
  );
}
