'use client';

// Settings → Sales → WhatsApp. Connect one WhatsApp Business number per company, straight to Meta
// (no reseller, no monthly fee). Shows what to copy from Meta, the address Meta must call, and this
// month's spend. Secrets are write-only: they are saved encrypted and never shown again.
import { useEffect, useState } from 'react';
import { CopyIcon, RefreshCwIcon, PauseIcon, PlayIcon, UnplugIcon, ExternalLinkIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CATEGORY = { MARKETING: 'Marketing', UTILITY: 'Utility (order updates)', AUTHENTICATION: 'Authentication', SERVICE: 'Replies to customers', AUTHENTICATION_INTERNATIONAL: 'Authentication (international)' };
const money = (n, currency) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

function Step({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n}</span>
      <div className="min-w-0 flex-1 text-sm"><p className="font-medium">{title}</p><div className="text-muted-foreground">{children}</div></div>
    </li>
  );
}

function CopyRow({ label, value }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={e => e.target.select()} />
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(value); showToast(`${label} copied`); }}><CopyIcon data-icon="inline-start" />Copy</Button>
      </div>
    </div>
  );
}

function Spend({ company }) {
  const [u, setU] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setU(null); setErr(null); api(`/api/whatsapp/usage?company=${encodeURIComponent(company)}`).then(setU).catch(e => setErr(e.message)); }, [company]);
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Spent this month</p>
      {err ? <p className="mt-1 text-sm text-muted-foreground">Could not read it from Meta: {err}</p>
        : !u ? <p className="mt-1 text-sm text-muted-foreground">Reading from Meta…</p> : (
        <>
          <p className="mt-1 text-2xl font-semibold tnum">{money(u.cost, u.currency)}</p>
          <p className="text-xs text-muted-foreground tnum">{u.messages} message{u.messages === 1 ? '' : 's'} · {u.free} free</p>
          {u.byCategory.length > 0 && (
            <dl className="mt-3 grid gap-1 border-t pt-3 text-xs">
              {u.byCategory.map(c => (
                <div key={c.category} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{CATEGORY[c.category] || c.category}</dt>
                  <dd className="tnum">{c.messages} · {money(c.cost, u.currency)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">WhatsApp has no prepaid balance. Meta charges the card on your WhatsApp account after the month, so this is the bill so far. Replies within 24 hours of a customer&apos;s message are free.</p>
    </div>
  );
}

function CompanySetup({ company, account, webhookUrl, reload }) {
  const [f, setF] = useState({ phone_number_id: account?.phone_number_id || '', waba_id: account?.waba_id || '', token: '', app_secret: '' });
  const [editing, setEditing] = useState(!account);
  const [busy, setBusy] = useState(null);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));

  async function call(method, body, okMsg, key) {
    setBusy(key);
    try {
      const r = await api('/api/whatsapp/account', { method, body: { company, ...body } });
      showToast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      if (key === 'save') { setEditing(false); setF(v => ({ ...v, token: '', app_secret: '' })); }
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(null); reload();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-5">
        {account && !editing && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{account.display_phone || account.phone_number_id}</p>
              <p className="text-xs text-muted-foreground">{account.verified_name || 'WhatsApp Business number'}</p>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
              !account.enabled ? 'bg-warning/10 text-warning' : account.last_error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>
              {!account.enabled ? 'Paused' : account.last_error ? 'Needs attention' : 'Connected'}</span>
            {account.last_error && <p className="w-full rounded-md bg-danger/5 px-2.5 py-1.5 text-xs text-danger">{account.last_error}</p>}
            <div className="flex w-full flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('POST', {}, r => `Working — ${r.display_phone}${r.quality ? ` · quality ${r.quality.toLowerCase()}` : ''}`, 'test')}>
                <RefreshCwIcon data-icon="inline-start" className={cn(busy === 'test' && 'animate-spin')} />Check connection</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => call('PUT', { enabled: !account.enabled }, account.enabled ? 'Paused' : 'Resumed', 'pause')}>
                {account.enabled ? <><PauseIcon data-icon="inline-start" />Pause</> : <><PlayIcon data-icon="inline-start" />Resume</>}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Change details</Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!!busy}
                onClick={() => window.confirm('Disconnect this WhatsApp number?') && call('DELETE', {}, 'Disconnected', 'del')}><UnplugIcon data-icon="inline-start" />Disconnect</Button>
            </div>
          </div>
        )}

        <ol className="flex flex-col gap-4">
          <Step n={1} title="Create the WhatsApp app at Meta">
            Open <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps <ExternalLinkIcon className="inline size-3" /></a>,
            choose Create app → Business, then add the WhatsApp product. Add your phone number there. It must be a number that is not in use on the WhatsApp phone app.
          </Step>
          <Step n={2} title="Make a permanent access token">
            In Meta Business Settings → Users → System users, add a system user (Admin), give it the app and the WhatsApp account, then Generate token with
            <span className="font-mono text-xs"> whatsapp_business_messaging</span> and <span className="font-mono text-xs">whatsapp_business_management</span>, expiry Never.
          </Step>
          <Step n={3} title="Paste four things here">
            The two IDs are on WhatsApp → API Setup. The app secret is on App settings → Basic.
            {editing && (
              <div className="mt-3 grid gap-3 text-foreground sm:grid-cols-2">
                <div className="grid gap-1"><Label className="text-xs">Phone number ID</Label><Input value={f.phone_number_id} onChange={set('phone_number_id')} inputMode="numeric" /></div>
                <div className="grid gap-1"><Label className="text-xs">WhatsApp Business Account ID</Label><Input value={f.waba_id} onChange={set('waba_id')} inputMode="numeric" /></div>
                <div className="grid gap-1"><Label className="text-xs">Access token</Label><Input type="password" autoComplete="new-password" value={f.token} onChange={set('token')} placeholder={account ? 'Leave blank to keep the saved one' : ''} /></div>
                <div className="grid gap-1"><Label className="text-xs">App secret</Label><Input type="password" autoComplete="new-password" value={f.app_secret} onChange={set('app_secret')} placeholder={account?.has_app_secret ? 'Leave blank to keep the saved one' : ''} /></div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button size="sm" disabled={!!busy} onClick={() => call('PUT', f, r => `Connected ${r.display_phone || ''}`, 'save')}>{busy === 'save' ? 'Checking with Meta…' : account ? 'Save' : 'Connect'}</Button>
                  {account && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
                </div>
              </div>
            )}
          </Step>
          <Step n={4} title="Tell Meta where to send messages">
            In the app, open WhatsApp → Configuration → Webhook → Edit. Paste these two values, click Verify and save, then switch on the <span className="font-medium text-foreground">messages</span> field.
            {account ? (
              <div className="mt-3 grid gap-3 text-foreground"><CopyRow label="Callback URL" value={webhookUrl} /><CopyRow label="Verify token" value={account.verify_token} /></div>
            ) : <p className="mt-1 text-xs">They appear here once step 3 is saved.</p>}
          </Step>
          <Step n={5} title="Add a card and your message templates">
            In WhatsApp Manager, add a payment method (Meta bills it monthly) and create message templates for the first message to a customer. Approved templates show up in the inbox by themselves.
          </Step>
        </ol>
      </div>
      {account ? <Spend company={company} /> : (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What it costs</p>
          <p className="mt-1">No monthly fee. Replying to a customer within 24 hours of their message is free. A message you start (a template) is charged per message by Meta, roughly ₹0.12 for an order update and ₹0.80 to ₹0.90 for marketing in India.</p>
        </div>
      )}
    </div>
  );
}

export default function WhatsAppSetup() {
  const [data, setData] = useState(null);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState(null);
  function load() { api('/api/whatsapp/account').then(d => { setData(d); setCompany(c => c || d.companies[0]?.company || null); }).catch(e => setError(e.message)); }
  useEffect(load, []);
  if (error) return <Card><CardContent className="py-6 text-sm text-muted-foreground">{error}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  const co = data.companies.find(c => c.company === company);
  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp</CardTitle>
        <CardDescription>One business number. Customers write to it; each conversation goes to the Sales person who owns that enquiry, and the Sales Head sees them all in Sales → WhatsApp.</CardDescription>
        {data.companies.length > 1 && (
          <CardAction>
            <Select value={company || ''} onValueChange={setCompany}>
              <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{data.companies.map(c => <SelectItem key={c.company} value={c.company}>{c.company}</SelectItem>)}</SelectContent>
            </Select>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{co && <CompanySetup key={co.company} company={co.company} account={co.account} webhookUrl={data.webhook_url} reload={load} />}</CardContent>
    </Card>
  );
}
