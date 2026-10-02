'use client';

// components/SalesTeamManager.jsx — Sales Head's team management: add a member (from HR employees in
// Sales), change Head/Member, reset a system password (shown once), deactivate. Backed by
// /api/sales-team. Only mounted for a Sales Head / PM.
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { UserPlusIcon, KeyRoundIcon, CopyIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

function AddMemberDialog({ available, onClose, onDone }) {
  const [f, setF] = useState({ employeeId: '', username: '', password: '' });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await api('/api/sales-team', { method: 'POST', body: f }); showToast('Team member added'); onDone(); onClose(); }
    catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>Pick someone HR has already added to the Sales department, then give them a login.</DialogDescription>
        </DialogHeader>
        {available.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No one is waiting for a login. Ask HR to add the person to the Sales department first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5"><Label>Employee</Label>
              <Select value={f.employeeId} onValueChange={v => setF({ ...f, employeeId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{available.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Username</Label><Input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} placeholder="e.g. priya.s" /></div>
            <div className="grid gap-1.5"><Label>Password</Label><Input type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder="At least 6 characters" /></div>
            <p className="text-xs text-muted-foreground">New people start as Members. Their computer still has to be set up before first login.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {available.length > 0 && <Button onClick={save} disabled={saving || !f.employeeId || !f.username || f.password.length < 6}>{saving ? 'Adding…' : 'Add member'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ member, onClose }) {
  const [custom, setCustom] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try { setResult(await api(`/api/sales-team/${member.id}/reset-password`, { method: 'POST', body: custom ? { password: custom } : {} })); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password — {member.name}</DialogTitle>
          <DialogDescription>Sets a new system password for {member.username}. The old one stops working immediately.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div>Username: <span className="font-medium">{result.username}</span></div>
            <div className="flex items-center gap-2">Password: <code className="rounded bg-background px-2 py-1 font-mono">{result.password}</code>
              <Button size="icon-sm" variant="ghost" aria-label="Copy password" onClick={() => { navigator.clipboard?.writeText(result.password); showToast('Copied'); }}><CopyIcon className="size-3.5" /></Button></div>
            <p className="text-xs text-muted-foreground">Shown once — share it with them now.</p>
          </div>
        ) : (
          <div className="grid gap-1.5"><Label>New password (leave empty to generate one)</Label><Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Auto-generate" /></div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
          {!result && <Button onClick={reset} disabled={busy || (custom && custom.length < 6)}><KeyRoundIcon className="size-3.5" />{busy ? 'Resetting…' : 'Reset password'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesTeamManager({ meUsername }) {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => { api('/api/sales-team').then(setData).catch(err => showToast(err.message, 'error')); }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(m, body, ok) {
    setBusy(m.id);
    try { await api(`/api/sales-team/${m.id}`, { method: 'PATCH', body }); showToast(ok); load(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members</CardTitle>
        <CardDescription>Add people, make them Head or Member, reset their system password, or switch them off. Only Sales-only people can be managed here.</CardDescription>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><UserPlusIcon className="size-3.5" />Add member</Button></CardAction>
      </CardHeader>
      <CardContent>
        {!data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[640px]">
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead className="w-36">Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.members.map(m => {
                  const me = m.username === meUsername;
                  return (
                    <TableRow key={m.id} className={m.active ? '' : 'opacity-60'}>
                      <TableCell className="font-medium">{m.name}{m.designation && <span className="block text-xs font-normal text-muted-foreground">{m.designation}</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{m.username}</TableCell>
                      <TableCell>
                        {me ? <Badge>{m.role === 'head' ? 'Head (you)' : 'Member (you)'}</Badge> : (
                          <Select value={m.role} onValueChange={v => patch(m, { role: v }, v === 'head' ? `${m.name} is now a Head` : `${m.name} is now a Member`)} disabled={busy === m.id}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="head">Head</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>{m.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Off</Badge>}{!m.salesOnly && <span className="ml-1 text-xs text-muted-foreground" title={m.otherDepartments.join(', ')}>+ other depts</span>}</TableCell>
                      <TableCell className="text-right">
                        {!me && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" disabled={!m.salesOnly} title={m.salesOnly ? '' : 'Has other departments — ask a PM'} onClick={() => setResetting(m)}><KeyRoundIcon className="size-3.5" />Reset password</Button>
                            <Button size="sm" variant="ghost" disabled={busy === m.id || !m.salesOnly} onClick={() => patch(m, { active: !m.active }, m.active ? `${m.name} switched off` : `${m.name} switched on`)}>{m.active ? 'Switch off' : 'Switch on'}</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {adding && data && <AddMemberDialog available={data.available} onClose={() => setAdding(false)} onDone={load} />}
      {resetting && <ResetPasswordDialog member={resetting} onClose={() => setResetting(null)} />}
    </Card>
  );
}
