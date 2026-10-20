'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { TrashIcon } from 'lucide-react';

const STATUS_STYLE = {
  pending: 'text-warning bg-warning/10 ring-warning/20',
  approved: 'text-success bg-success/10 ring-success/20',
  rejected: 'text-danger bg-danger/10 ring-danger/20',
  revoked: 'text-muted-foreground bg-muted ring-border',
  expired: 'text-muted-foreground bg-muted ring-border',
};
const ACTION_STYLE = {
  block: 'text-danger bg-danger/10 ring-danger/20',
  approval: 'text-warning bg-warning/10 ring-warning/20',
  allow: 'text-success bg-success/10 ring-success/20',
};

function Pill({ label, className }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expiring…';
  return `${Math.ceil(ms / 60000)} min left`;
}

// ponytail: 5s poll + router.refresh() — matches the DevicesPanel pattern.
export default function BrowserPanel({ user, initial }) {
  const router = useRouter();
  const isPM = ['admin', 'manager', 'executive'].includes(user.role);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, 5000);
    return () => clearInterval(t);
  }, [router]);

  const { requests, policies } = initial;
  if (!isPM) return <OperatorView requests={requests} router={router} />;

  const pending = requests.filter(r => r.status === 'pending');
  const active = requests.filter(r => r.status === 'approved');

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>Pending Website Requests</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>}
          {pending.map(r => <PendingCard key={r.id} r={r} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active Sessions</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {active.length === 0 && <p className="text-sm text-muted-foreground">No websites currently unlocked.</p>}
          {active.map(r => <ActiveCard key={r.id} r={r} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Blocked Websites</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddPolicy router={router} />
          <div className="flex flex-col divide-y">
            {policies.length === 0 && <p className="text-sm text-muted-foreground">No website policies yet.</p>}
            {policies.map(p => <PolicyRow key={p.id} p={p} router={router} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PendingCard({ r, router }) {
  const [totp, setTotp] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function decide(action, body) {
    setBusy(true);
    try {
      await api(`/api/browser/requests/${r.id}`, { method: 'PATCH', body: { action, ...body } });
      showToast(action === 'approve' ? 'Website approved' : 'Request rejected');
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">🌐 {r.domain}</span>
        <Pill label="pending" className={STATUS_STYLE.pending} />
      </div>
      <div className="text-sm text-muted-foreground">
        {r.machine_name}{r.reason && <span> · “{r.reason}”</span>}
      </div>
      <div className="flex gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm">Approve</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Approve {r.domain}</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Authenticator code</Label>
                <Input value={totp} onChange={e => setTotp(e.target.value)} maxLength={6} inputMode="numeric" placeholder="000000" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Minutes</Label>
                <Input type="number" min={5} max={60} value={minutes} onChange={e => setMinutes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={busy || totp.length !== 6} onClick={() => decide('approve', { totp, minutes: Number(minutes) })}>
                {busy ? 'Approving…' : 'Approve'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('reject')}>Reject</Button>
      </div>
    </div>
  );
}

function ActiveCard({ r, router }) {
  const [busy, setBusy] = useState(false);
  async function revoke() {
    setBusy(true);
    try {
      await api(`/api/browser/requests/${r.id}`, { method: 'PATCH', body: { action: 'revoke' } });
      showToast('Access revoked');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span className="font-medium">🌐 {r.domain}</span>
      <span className="text-sm text-muted-foreground">{r.machine_name}</span>
      <span className="text-xs text-muted-foreground tnum">{timeLeft(r.expires_at)}</span>
      <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={revoke}>Revoke</Button>
    </div>
  );
}

function AddPolicy({ router }) {
  const [target, setTarget] = useState('');
  const [action, setAction] = useState('block');
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      await api('/api/browser/policies', { method: 'POST', body: { target, action } });
      showToast('Policy saved');
      setTarget('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label>Website</Label>
        <Input value={target} onChange={e => setTarget(e.target.value)} placeholder="dropbox.com" className="w-48" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Policy</Label>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="allow">Allow</SelectItem>
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="approval">Approval required</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button disabled={busy || !target} onClick={add}>{busy ? 'Saving…' : 'Add'}</Button>
    </div>
  );
}

function PolicyRow({ p, router }) {
  async function change(action) {
    try {
      await api('/api/browser/policies', { method: 'POST', body: { target: p.target, action } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function remove() {
    try {
      await api('/api/browser/policies', { method: 'DELETE', body: { target: p.target } });
      showToast('Policy removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="font-medium">{p.target}</span>
      <Pill label={p.action === 'approval' ? 'approval' : p.action} className={ACTION_STYLE[p.action]} />
      <div className="ml-auto flex items-center gap-2">
        <Select value={p.action} onValueChange={change}>
          <SelectTrigger className="w-36" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="allow">Allow</SelectItem>
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="approval">Approval required</SelectItem>
          </SelectContent>
        </Select>
        <Button size="icon-sm" variant="ghost" onClick={remove} aria-label="Remove"><TrashIcon /></Button>
      </div>
    </div>
  );
}

function OperatorView({ requests, router }) {
  const live = requests.filter(r => r.status === 'pending' || r.status === 'approved');
  if (live.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">No website requests right now.</CardContent></Card>;
  }
  return (
    <div className="flex flex-col gap-3">
      {live.map(r => (
        <Card key={r.id}>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <span className="font-medium">🌐 {r.domain}</span>
            <Pill label={r.status} className={STATUS_STYLE[r.status]} />
            {r.status === 'approved' && <span className="text-xs text-muted-foreground tnum">{timeLeft(r.expires_at)}</span>}
            {r.status === 'pending' && <span className="text-sm text-muted-foreground">Waiting for manager approval…</span>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
