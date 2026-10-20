'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { PM_GUIDE } from '@/components/help-content';
import InfoPopover from '@/components/InfoPopover';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { UsbIcon, CopyIcon, ShieldCheckIcon } from 'lucide-react';

const OTP_GUIDE = PM_GUIDE.find(g => g.title.startsWith('Approving with your OTP'));

const STATUS_STYLE = {
  pending: 'text-warning bg-warning/10 ring-warning/20',
  approved: 'text-success bg-success/10 ring-success/20',
  rejected: 'text-danger bg-danger/10 ring-danger/20',
  revoked: 'text-muted-foreground bg-muted ring-border',
  expired: 'text-muted-foreground bg-muted ring-border',
  idle: 'text-muted-foreground bg-muted ring-border',
};

function Pill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.idle}`}>
      {status}
    </span>
  );
}

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expiring…';
  const mins = Math.ceil(ms / 60000);
  return `${mins} min left`;
}

const KIND_ICON = { cd: '💿 ', phone: '📱 ' };

function deviceLine(r) {
  const prefix = KIND_ICON[r.kind] || '';
  const ids = r.kind === 'cd' ? '' : ` · ${r.vendor_id}:${r.product_id}`;
  return `${prefix}${r.label || 'Unknown device'}${ids}${r.serial ? ` · SN ${r.serial}` : ''}`;
}

// last_seen is a SQLite UTC 'YYYY-MM-DD HH:MM:SS' string — same conversion lib/usb.js uses server-side.
function relativeTime(sqliteUtc) {
  if (!sqliteUtc) return null;
  const ms = Date.now() - Date.parse(sqliteUtc.replace(' ', 'T') + 'Z');
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function isOnline(sqliteUtc) {
  if (!sqliteUtc) return false;
  return Date.now() - Date.parse(sqliteUtc.replace(' ', 'T') + 'Z') < 30_000;
}

// ponytail: request-level 5s poll + router.refresh() — no realtime infra exists in this app yet.
export default function DevicesPanel({ user, initial, employees }) {
  const router = useRouter();
  const isPM = ['admin', 'manager', 'executive'].includes(user.role);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, 5000);
    return () => clearInterval(t);
  }, [router]);

  const { machines, requests, devices } = initial;

  const deviceRequestCount = useMemo(() => {
    const m = {};
    for (const r of requests) m[r.device_id] = (m[r.device_id] || 0) + 1;
    return m;
  }, [requests]);

  function risk(r) {
    if (r.whitelisted) return '🟢';
    return (deviceRequestCount[r.device_id] || 0) <= 1 ? '🔴' : '🟡';
  }

  if (!isPM) return <OperatorView machines={machines} requests={requests} router={router} />;

  const pending = requests.filter(r => r.status === 'pending');
  const active = requests.filter(r => r.status === 'approved');

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Pending Approvals</CardTitle>
          {isPM && OTP_GUIDE && <CardAction><InfoPopover guide={OTP_GUIDE} /></CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>}
          {pending.map(r => <PendingCard key={r.id} r={r} riskIcon={risk(r)} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active Approvals</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {active.length === 0 && <p className="text-sm text-muted-foreground">No devices currently unlocked.</p>}
          {active.map(r => <ActiveCard key={r.id} r={r} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Devices</CardTitle></CardHeader>
        <CardContent className="flex flex-col divide-y">
          {devices.length === 0 && <p className="text-sm text-muted-foreground">No devices seen yet.</p>}
          {devices.map(d => <DeviceRow key={d.id} d={d} router={router} />)}
        </CardContent>
      </Card>

      {['admin', 'executive'].includes(user.role) && <MachinesCard machines={machines} employees={employees} router={router} />}
    </div>
  );
}

function PendingCard({ r, riskIcon, router }) {
  const [totp, setTotp] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/usb/requests/${r.id}`, { method: 'PATCH', body: { action: 'approve', totp, minutes: Number(minutes) } });
      showToast('Device approved');
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function reject() {
    setBusy(true);
    try {
      await api(`/api/usb/requests/${r.id}`, { method: 'PATCH', body: { action: 'reject' } });
      showToast('Request rejected');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span>{riskIcon}</span>
        <span className="font-medium">{deviceLine(r)}</span>
        <Pill status="pending" />
      </div>
      <div className="text-sm text-muted-foreground">
        {r.owner_display_name || r.machine_name} on {r.machine_name}
        {r.reason && <span> · “{r.reason}”</span>}
      </div>
      {r.timeline?.length > 0 && <Timeline entries={r.timeline} />}
      <div className="flex gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm">Approve</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Approve {r.label || 'device'}</DialogTitle></DialogHeader>
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
              <Button disabled={busy || totp.length !== 6} onClick={approve}>{busy ? 'Approving…' : 'Approve'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button size="sm" variant="outline" disabled={busy} onClick={reject}>Reject</Button>
      </div>
    </div>
  );
}

function ActiveCard({ r, router }) {
  const [busy, setBusy] = useState(false);
  async function revoke() {
    setBusy(true);
    try {
      await api(`/api/usb/requests/${r.id}`, { method: 'PATCH', body: { action: 'revoke' } });
      showToast('Approval revoked');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span className="font-medium">{deviceLine(r)}</span>
      <span className="text-sm text-muted-foreground">{r.owner_display_name || r.machine_name} on {r.machine_name}</span>
      <span className="text-xs text-muted-foreground tnum">{timeLeft(r.expires_at)}</span>
      <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={revoke}>Revoke</Button>
    </div>
  );
}

function DeviceRow({ d, router }) {
  const [totp, setTotp] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setWhitelist(on, code) {
    setBusy(true);
    try {
      await api(`/api/usb/devices/${d.id}`, { method: 'PATCH', body: { whitelisted: on, totp: code } });
      showToast(on ? 'Device whitelisted' : 'Whitelist removed');
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="font-medium">{KIND_ICON[d.kind] || ''}{d.label || 'Unknown device'}</span>
      <span className="text-xs text-muted-foreground tnum">
        {d.kind === 'cd' ? `SN ${d.serial}` : `${d.vendor_id}:${d.product_id}${d.serial ? ` · ${d.serial}` : ''}`}
      </span>
      {d.whitelisted ? (
        <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => setWhitelist(false)}>
          <ShieldCheckIcon data-icon="inline-start" />Whitelisted — remove
        </Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" className="ml-auto">Whitelist</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Whitelist {d.label || 'device'}</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>Authenticator code</Label>
              <Input value={totp} onChange={e => setTotp(e.target.value)} maxLength={6} inputMode="numeric" placeholder="000000" />
            </div>
            <DialogFooter>
              <Button disabled={busy || totp.length !== 6} onClick={() => setWhitelist(true, totp)}>
                {busy ? 'Saving…' : 'Whitelist'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MachinesCard({ machines, employees, router }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [enroll, setEnroll] = useState(null);   // {code, token, name}
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const data = await api('/api/usb/machines', { method: 'POST', body: { name, username } });
      setEnroll({ code: data.code, token: data.token, id: data.id, name });
      setName('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function toggle(id, active) {
    try {
      await api('/api/usb/machines', { method: 'PATCH', body: { id, active } });
      showToast(active ? 'Machine reactivated' : 'Machine disabled — agent will be blocked');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Machines</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Machine name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="RAVI-PC" className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Employee</Label>
            <Select value={username} onValueChange={setUsername}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {(employees || []).map(e => <SelectItem key={e.username} value={e.username}>{e.display_name || e.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={busy || !name || !username} onClick={create}>
            <UsbIcon data-icon="inline-start" />{busy ? 'Creating…' : 'Register machine'}
          </Button>
        </div>

        {enroll && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Enrollment code for <b>{enroll.name}</b>:</span>
              <code className="rounded bg-background px-2 py-0.5 text-base font-bold tracking-widest">{enroll.code}</code>
              <Button size="icon-sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(enroll.code); showToast('Copied'); }}>
                <CopyIcon />
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/usb/machines/${enroll.id}/enroll-file`} download>Download enroll file</a>
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Drop the downloaded file in the employee's Drive folder, or give them the code — the installer needs one of them (valid 24h).
            </span>
          </div>
        )}

        <div className="flex flex-col divide-y">
          {machines.map(m => {
            const online = m.active && isOnline(m.last_seen);
            return (
              <div key={m.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`size-1.5 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`} aria-hidden />
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{m.owner_display_name || m.owner_username}</span>
                <span className="text-xs text-muted-foreground tnum">
                  {m.last_seen ? relativeTime(m.last_seen) : 'never seen'}
                </span>
                <span className="text-xs text-muted-foreground tnum">{m.agent_version ? `v${m.agent_version}` : '—'}</span>
                <span className={`text-xs ${m.active ? 'text-success' : 'text-danger'}`}>{m.active ? 'Active' : 'Disabled'}</span>
                <Button size="sm" variant="ghost" className="ml-auto" asChild>
                  <a href={`/api/usb/machines/${m.id}/enroll-file`} download>Enroll file</a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggle(m.id, !m.active)}>
                  {m.active ? 'Disable' : 'Reactivate'}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Timeline({ entries }) {
  return (
    <ul className="flex flex-col gap-0.5 border-l pl-3 text-xs text-muted-foreground">
      {entries.map(e => (
        <li key={e.id}>
          {new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString()} — {e.action} {e.detail ? `(${e.detail})` : ''}
        </li>
      ))}
    </ul>
  );
}

function OperatorView({ machines, requests, router }) {
  if (machines.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">No machine registered for you yet — contact your admin.</CardContent></Card>;
  }
  // Latest request per machine.
  const latestByMachine = {};
  for (const r of requests) if (!latestByMachine[r.machine_id]) latestByMachine[r.machine_id] = r;

  return (
    <div className="flex flex-col gap-4">
      {machines.map(m => (
        <MachineStatusCard key={m.id} machine={m} r={latestByMachine[m.id]} router={router} />
      ))}
    </div>
  );
}

function MachineStatusCard({ machine, r, router }) {
  const [reason, setReason] = useState(r?.reason || '');
  const [busy, setBusy] = useState(false);

  async function saveReason() {
    setBusy(true);
    try {
      await api(`/api/usb/requests/${r.id}`, { method: 'PATCH', body: { reason } });
      showToast('Reason sent to your manager');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>{machine.name}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!r ? (
          <p className="text-sm text-muted-foreground">No device activity yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{deviceLine(r)}</span>
              <Pill status={r.status} />
              {r.status === 'approved' && <span className="text-xs text-muted-foreground tnum">{timeLeft(r.expires_at)}</span>}
            </div>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why do you need this device?" maxLength={200} />
                <Button size="sm" disabled={busy} onClick={saveReason}>Send</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
