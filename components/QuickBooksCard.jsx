'use client';
// QuickBooks Online connection card (Accounts → Company Entities). Renders nothing unless the server
// has QuickBooks switched on (QBO keys + US build). Connect/Disconnect/mapping: Accounts Head; in the
// public demo only the owner pass. Everyone else in Accounts sees the live state read-only.
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LinkIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { accountFits, suggestAccountMap } from '@/lib/quickbooks.mjs';
import { sendToQuickBooks } from '@/components/QuickBooksStatus';

const when = v => (v ? new Date(v).toLocaleString() : '—');

export default function QuickBooksCard({ entity }) {
  const [s, setS] = useState(null);
  const [qbAccounts, setQbAccounts] = useState(null);
  const [qbError, setQbError] = useState(null);
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState(null);

  const load = useCallback(() => {
    api(`/api/quickbooks/status?company_id=${entity.id}`).then(r => {
      setS(r);
      setMap(r.connection?.account_map || {});
      if (r.connection?.status === 'connected') {
        setQbError(null);
        api(`/api/quickbooks/sync?company_id=${entity.id}`).then(setSync).catch(() => {});
        api(`/api/quickbooks/accounts?company_id=${entity.id}`).then(a => {
          setQbAccounts(a.accounts);
          // Nothing mapped yet: start from suggested matches; the Head reviews and saves.
          if (!Object.keys(r.connection.account_map || {}).length) setMap(suggestAccountMap(r.localAccounts, a.accounts));
        }).catch(err => setQbError(err.message));
      }
    }).catch(err => showToast(err.message, 'error'));
  }, [entity.id]);
  useEffect(() => { load(); }, [load]);

  // Result of the Intuit round trip comes back as ?qbo=connected or ?qbo_error=...
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get('qbo');
    const err = url.searchParams.get('qbo_error');
    if (!ok && !err) return;
    if (ok) showToast('QuickBooks connected'); else showToast(err, 'error');
    url.searchParams.delete('qbo'); url.searchParams.delete('qbo_error');
    window.history.replaceState(null, '', url);
  }, []);

  if (!s?.enabled) return null;
  const c = s.connection || {};
  const connected = c.status === 'connected';
  const saved = c.account_map || {};
  const dirty = JSON.stringify(map) !== JSON.stringify(saved);

  async function disconnect() {
    if (!window.confirm('Disconnect QuickBooks? SB Ops will stop sending to it until you connect again.')) return;
    setBusy(true);
    try { await api('/api/quickbooks/disconnect', { method: 'POST', body: { company_id: entity.id } }); showToast('Disconnected'); setQbAccounts(null); load(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }
  async function saveMap() {
    setBusy(true);
    try {
      const full = Object.fromEntries(s.localAccounts.map(a => [a.code, map[a.code] || '']));
      const r = await api('/api/quickbooks/account-map', { method: 'PUT', body: { company_id: entity.id, map: full } });
      setS(prev => ({ ...prev, connection: { ...prev.connection, account_map: r.account_map } }));
      setMap(r.account_map);
      showToast('Account mapping saved');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  const connectBtn = (label) => s.canManage
    ? <Button size="sm" asChild><a href={`/api/quickbooks/connect?company_id=${entity.id}`}>{label}</a></Button>
    : <Button size="sm" disabled title={s.manageNote || ''}>{label}</Button>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LinkIcon className="size-4" />QuickBooks Online</CardTitle>
        <CardAction className="flex items-center gap-2">
          {s.environment === 'sandbox' && <Badge variant="outline">Sandbox</Badge>}
          <Badge variant={connected ? 'default' : 'secondary'}>{connected ? 'Connected' : c.status === 'disconnected' ? 'Disconnected' : 'Not connected'}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!connected && (
          <>
            <p className="text-xs text-muted-foreground">
              SB Ops keeps the books and sends customers, invoices, payments and bills to QuickBooks for your accountant.
              {c.status === 'disconnected' && c.last_error ? ` ${c.last_error}` : ''}
            </p>
            <div className="flex items-center gap-3">
              {connectBtn(c.status === 'disconnected' ? 'Reconnect QuickBooks' : 'Connect to QuickBooks')}
              {!s.canManage && s.manageNote && <span className="text-xs text-muted-foreground">{s.manageNote}</span>}
            </div>
          </>
        )}
        {connected && (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">QuickBooks company ID: </dt><dd className="inline">{c.realm_id}</dd></div>
              <div><dt className="inline text-muted-foreground">Connected by: </dt><dd className="inline">{c.connected_by} · {when(c.connected_at)}</dd></div>
              {c.refresh_expires_at && <div><dt className="inline text-muted-foreground">Sign-in valid until: </dt><dd className="inline">{when(c.refresh_expires_at)} (renews with use)</dd></div>}
            </dl>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Account mapping</h3>
              <p className="text-xs text-muted-foreground">Pick the QuickBooks account each SB Ops account posts to. Unmapped accounts are not sent. Sales tax is worked out by QuickBooks, so leave Sales Tax Payable unmapped.</p>
              {dirty && !Object.keys(saved).length && <p className="text-xs text-primary">Suggested matches are filled in. Review them and save.</p>}
              {qbError && <p className="text-xs text-destructive">{qbError}</p>}
              {!qbAccounts && !qbError && <p className="text-xs text-muted-foreground">Loading QuickBooks accounts…</p>}
              {qbAccounts && (
                <div className="flex flex-col divide-y rounded-md border">
                  {s.localAccounts.map(a => {
                    const picked = qbAccounts.find(q => q.id === map[a.code]);
                    const options = [...qbAccounts].sort((x, y) => accountFits(a.account_type, y.type) - accountFits(a.account_type, x.type));
                    return (
                      <div key={a.code} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_1.2fr]">
                        <div className="text-xs"><span className="text-muted-foreground">{a.code}</span> {a.name}</div>
                        <div className="flex flex-col gap-1">
                          <select
                            className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-60"
                            value={map[a.code] || ''}
                            disabled={!s.canManage}
                            onChange={e => setMap(m => ({ ...m, [a.code]: e.target.value }))}
                            aria-label={`QuickBooks account for ${a.name}`}
                          >
                            <option value="">— not sent —</option>
                            {options.map(q => <option key={q.id} value={q.id}>{q.name} ({q.type})</option>)}
                          </select>
                          {picked && !accountFits(a.account_type, picked.type) && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">Unusual: a {a.account_type} account mapped to a {picked.type} account.</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {sync?.enabled && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Sending</h3>
                <p className="text-xs text-muted-foreground">
                  Issued invoices and recorded payments go to QuickBooks automatically. {sync.sentToday} sent today
                  {sync.failures.length ? `, ${sync.failures.length} need attention.` : ', nothing needs attention.'}
                </p>
                {sync.failures.map(f => (
                  <div key={`${f.kind}-${f.id}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs">
                    <span className="font-medium">{f.kind === 'invoice' ? 'Invoice' : 'Payment'} {f.no}</span>
                    <span className="flex-1 text-destructive">{f.error}</span>
                    <Button size="sm" variant="outline" onClick={async () => { await sendToQuickBooks(f.kind, f.id); load(); }}>Retry</Button>
                  </div>
                ))}
              </div>
            )}

            {s.canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !dirty || !qbAccounts} onClick={saveMap}>Save mapping</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={disconnect}>Disconnect</Button>
              </div>
            ) : s.manageNote && <p className="text-xs text-muted-foreground">{s.manageNote}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
