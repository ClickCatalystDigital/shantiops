'use client';

// Service expense requests waiting on someone: managers/executives (Approvals page) or Accounts.
// mode 'approvals': PMs approve/reject at their step. mode 'accounts': Accounts settles.
import { useCallback, useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SheetFooter } from '@/components/ui/sheet';
import { RequestList, RequestSheet } from '@/components/ServiceExpenses';

export default function ServiceExpenseInbox({ mode, user }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [acct, setAcct] = useState({ settled_on: todayISO(), accounted_by: user.display_name || user.username, checked_by: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/service-expenses?scope=${mode}`).then(setRows).catch(err => showToast(err.message, 'error')), [mode]);
  useEffect(() => { load(); }, [load]);

  // The statuses this viewer can act on.
  const role = user.role;
  const actionable = r => (mode === 'accounts' ? r.status === 'with_accounts'
    : (r.status === 'pending_manager' && ['manager', 'admin'].includes(role)) || (r.status === 'pending_executive' && ['executive', 'admin'].includes(role)));
  const todo = (rows || []).filter(actionable);
  const done = (rows || []).filter(r => !actionable(r));

  async function act(action, extra = {}) {
    setBusy(true);
    try { await api(`/api/service-expenses/${open.id}`, { method: 'PATCH', body: { action, note, ...extra } }); showToast('Done'); setOpen(null); setNote(''); load(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }
  const prefix = open?.status === 'pending_manager' ? 'manager' : 'executive';

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Waiting for you {rows && `(${todo.length})`}</CardTitle></CardHeader>
        <CardContent><RequestList rows={rows && todo} onOpen={setOpen} showWho empty="Nothing waiting for you." /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{mode === 'accounts' ? 'Settled' : 'Everything else'}</CardTitle></CardHeader>
        <CardContent><RequestList rows={rows && done} onOpen={setOpen} showWho empty="Nothing yet." /></CardContent>
      </Card>
      {open && (
        <RequestSheet r={open} onClose={() => setOpen(null)} footer={actionable(open) && (
          <SheetFooter className="border-t">
            {mode === 'accounts' ? (
              <div className="grid w-full gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5"><Label>Accounts settled on</Label><Input type="date" value={acct.settled_on} onChange={e => setAcct(a => ({ ...a, settled_on: e.target.value }))} /></div>
                  <div className="grid gap-1.5"><Label>Accounted by</Label><Input value={acct.accounted_by} onChange={e => setAcct(a => ({ ...a, accounted_by: e.target.value }))} /></div>
                  <div className="grid gap-1.5"><Label>Checked</Label><Input value={acct.checked_by} onChange={e => setAcct(a => ({ ...a, checked_by: e.target.value }))} /></div>
                </div>
                <Button disabled={busy} onClick={() => act('settle', acct)}>Mark as settled</Button>
              </div>
            ) : (
              <div className="grid w-full gap-3">
                <Textarea rows={2} placeholder="Note (required to reject)" value={note} onChange={e => setNote(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => act(`${prefix}_reject`)}>Reject</Button>
                  <Button disabled={busy} onClick={() => act(`${prefix}_approve`)}>{prefix === 'manager' ? 'Approve → Executive' : 'Approve → Accounts'}</Button>
                </div>
              </div>
            )}
          </SheetFooter>
        )} />
      )}
    </div>
  );
}
