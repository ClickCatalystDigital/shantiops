'use client';

// components/SalesSetupPanels.jsx — Sales → Setup → Email and Portal Access.
// Email: company mailboxes (Sales Head), the user's own mailbox, the test/live safety switch and the
// recent-email log. Portal Access: who has a customer-portal login, resend an invite, copy the link.
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';

function MailboxForm({ scope, company, account, title, hint, onSaved }) {
  const [email, setEmail] = useState(account?.email || '');
  const [host, setHost] = useState(account?.smtp_host || 'smtp.zoho.in');
  const [port, setPort] = useState(String(account?.smtp_port || 465));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);

  async function save() {
    setBusy('save');
    try {
      await api('/api/mail-accounts', { method: 'PUT', body: { scope, company, email, smtp_host: host, smtp_port: Number(port), password } });
      setPassword('');
      showToast('Mailbox saved');
      onSaved();
    } catch (e) { showToast(e.message, 'error'); } finally { setBusy(null); }
  }
  async function test() {
    setBusy('test');
    try {
      const r = await api('/api/mail-accounts/test', { method: 'POST', body: { scope, company } });
      showToast(`Test email sent to ${r.sentTo}`);
      onSaved();
    } catch (e) { showToast(e.message, 'error'); onSaved(); } finally { setBusy(null); }
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {account
          ? account.last_test_ok === 1 ? <Badge variant="default">Tested OK</Badge>
            : account.last_test_ok === 0 ? <Badge variant="destructive">Test failed</Badge>
            : <Badge variant="outline">Saved, not tested</Badge>
          : <Badge variant="outline">Not set up</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Email address</Label><Input value={email} onChange={e => setEmail(e.target.value)} placeholder="sales@company.com" /></div>
        <div className="grid gap-1.5"><Label>Zoho app password</Label><Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={account ? 'Leave blank to keep the saved one' : 'Generated in Zoho → Security → App Passwords'} /></div>
        <div className="grid gap-1.5"><Label>SMTP server</Label><Input value={host} onChange={e => setHost(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Port</Label><Input value={port} onChange={e => setPort(e.target.value)} /></div>
      </div>
      {account?.last_test_error && <p className="text-xs text-destructive">{account.last_test_error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="outline" onClick={test} disabled={busy || !account}>{busy === 'test' ? 'Sending…' : 'Send test email'}</Button>
      </div>
    </div>
  );
}

export function EmailSetupTab() {
  const [data, setData] = useState(null);
  const [testTo, setTestTo] = useState('');
  function load() { api('/api/mail-accounts').then(d => { setData(d); setTestTo(d.mode?.testTo || ''); }).catch(e => showToast(e.message, 'error')); }
  useEffect(load, []);
  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  async function setMode(mode) {
    try {
      await api('/api/mail-accounts/mode', { method: 'PUT', body: { mode, test_to: testTo } });
      showToast(mode === 'live' ? 'Email is LIVE — customers will receive mail' : 'Email is in test mode');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      {data.isAdmin && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Test / Live switch</CardTitle>
              <CardDescription>In test mode nothing reaches a real customer: mail goes to the test address below, or is only logged if it is blank.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Badge variant={data.mode.mode === 'live' ? 'destructive' : 'outline'}>{data.mode.mode === 'live' ? 'LIVE' : 'TEST'}</Badge>
              <div className="grid gap-1.5"><Label>Test address</Label><Input className="w-64" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@company.com" /></div>
              <Button size="sm" variant="outline" onClick={() => setMode('test')}>{data.mode.mode === 'test' ? 'Save test address' : 'Switch to test'}</Button>
              {data.mode.mode !== 'live' && (
                <Button size="sm" variant="destructive" onClick={() => window.confirm('Go live? Quotations, portal invites and status updates will be emailed to real customers.') && setMode('live')}>Go live</Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Company mailboxes</CardTitle>
              <CardDescription>The address customer and system emails are sent from, one per company. Zoho needs two-step verification on the mailbox before it can create an app password.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.companies.map(c => (
                <MailboxForm key={c.company} scope="company" company={c.company} account={c.account} title={c.legal_name || c.company} onSaved={load} />
              ))}
            </CardContent>
          </Card>
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle>My email</CardTitle>
          <CardDescription>Optional. If you save your own mailbox, quotations you send go out from your address; otherwise the company mailbox is used.</CardDescription>
        </CardHeader>
        <CardContent><MailboxForm scope="user" account={data.mine} title="My mailbox" onSaved={load} /></CardContent>
      </Card>
      {data.isAdmin && (
        <Card>
          <CardHeader><CardTitle>Recent emails</CardTitle><CardDescription>Every send attempt, including failures.</CardDescription></CardHeader>
          <CardContent>
            {data.log.length === 0 ? <p className="text-sm text-muted-foreground">Nothing sent yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.log.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(l.at)}</TableCell>
                      <TableCell>{l.to_addr}{l.redirected_to ? <span className="block text-xs text-muted-foreground">test → {l.redirected_to}</span> : null}</TableCell>
                      <TableCell>{l.subject}</TableCell>
                      <TableCell>{l.ok ? <Badge variant="outline">{l.error || 'Sent'}</Badge> : <span className="text-xs text-destructive">{l.error}</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const STATUS = { not_enabled: ['Not enabled', 'outline'], invited: ['Invited', 'secondary'], active: ['Active', 'default'] };

export function PortalAccessTab() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  function load() { api(`/api/portal-access?q=${encodeURIComponent(q)}`).then(setRows).catch(e => showToast(e.message, 'error')); }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]);

  async function act(r, kind) {
    setBusyId(r.id);
    try {
      if (kind === 'enable') {
        const res = await api(`/api/customers/${r.id}/portal`, { method: 'POST', body: { enabled: true } });
        if (res.mail?.live && res.mail.sent) showToast('Login created — invite emailed');
        else { showToast(`Login created. Not emailed: ${res.mail?.error || 'email is in test mode'}`, 'error'); await copy(res.setup_url); }
      } else if (kind === 'resend' || kind === 'link') {
        const res = await api(`/api/customers/${r.id}/portal/resend`, { method: 'POST', body: { link_only: kind === 'link' } });
        if (kind === 'link') await copy(res.setup_url);
        else if (res.mail?.live && res.mail.sent) showToast('Invite emailed');
        else { showToast(`Not emailed: ${res.mail?.error || 'email is in test mode'}. Link copied instead.`, 'error'); await copy(res.setup_url); }
      } else {
        await api(`/api/customers/${r.id}/portal`, { method: 'POST', body: { enabled: false } });
        showToast('Portal status emails turned off');
      }
      load();
    } catch (e) { showToast(e.message, 'error'); } finally { setBusyId(null); }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); showToast('Setup link copied — valid for 7 days'); }
    catch { window.prompt('Copy this setup link (valid for 7 days):', url); }
  }

  const shown = (rows || []).filter(r => filter === 'all' || r.status === filter);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal Access</CardTitle>
        <CardDescription>Customers with a project. Enabling creates their login; they get a link to set their own password (passwords are never emailed).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Input className="w-64" placeholder="Search customer or username…" value={q} onChange={e => setQ(e.target.value)} />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="not_enabled">Not enabled</SelectItem>
              <SelectItem value="invited">Invited</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No customers match.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Username</TableHead><TableHead>Invite sent</TableHead><TableHead>Last login</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}<span className="block text-xs text-muted-foreground">{r.project_count} project(s)</span></TableCell>
                  <TableCell>{r.email || <span className="text-xs text-destructive">No email</span>}</TableCell>
                  <TableCell><Badge variant={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.username || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.initial_email_sent_at ? formatDate(r.initial_email_sent_at) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.last_login ? formatDate(r.last_login) : '—'}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    {r.status === 'not_enabled'
                      ? <Button size="sm" disabled={busyId === r.id} onClick={() => act(r, 'enable')}>Enable</Button>
                      : <>
                          <Button size="sm" variant="outline" disabled={busyId === r.id || !r.email} onClick={() => act(r, 'resend')}>Resend invite</Button>
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r, 'link')}>Copy link</Button>
                          {!!r.portal_enabled && <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act(r, 'disable')}>Turn off emails</Button>}
                        </>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
