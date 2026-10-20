'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, INSTALLER_URL } from '@/lib/client';
import { DEPARTMENTS } from '@/lib/milestones';
import { PM_GUIDE } from '@/components/help-content';
import InfoPopover from '@/components/InfoPopover';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { UsbIcon, CopyIcon, DownloadIcon } from 'lucide-react';

const ONBOARDING_GUIDE = PM_GUIDE.find(g => g.title.startsWith('Onboarding a new employee'));

const STATUS_LABEL = {
  online: 'Online',
  enrolled: 'Enrolled — offline',
  enroll_sent: 'Enroll file sent — not yet run',
  no_machine: 'No machine yet',
};
const STATUS_DOT = {
  online: 'bg-success', enrolled: 'bg-muted-foreground',
  enroll_sent: 'bg-warning', no_machine: 'bg-muted-foreground',
};

// ponytail: same 5s poll + router.refresh() pattern as DevicesPanel/BrowserPanel — no realtime infra yet.
export default function PeoplePanel({ user, initial }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, 5000);
    return () => clearInterval(t);
  }, [router]);

  const { pending, roster } = initial;
  const canRegisterMachine = ['admin', 'executive'].includes(user.role);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>Pending Registrations</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>}
          {pending.map(p => <PendingCard key={p.id} p={p} router={router} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Onboarding Roster</CardTitle>
          {ONBOARDING_GUIDE && <CardAction><InfoPopover guide={ONBOARDING_GUIDE} /></CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {roster.length === 0 && <p className="text-sm text-muted-foreground">No one onboarded yet.</p>}
          {roster.map(r => (
            <RosterRow key={r.id} r={r} router={router} canRegisterMachine={canRegisterMachine} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PendingCard({ p, router }) {
  const requested = new Set(p.departments || []);
  const [depts, setDepts] = useState(requested);
  const [busy, setBusy] = useState(false);
  const isHead = p.role === 'operator';

  function toggle(d) {
    setDepts(prev => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  }

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/users/${p.id}`, {
        method: 'PATCH',
        body: { approve: 1, ...(isHead ? { departments: [...depts] } : {}) },
      });
      showToast(`${p.display_name || p.username} approved`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function reject() {
    setBusy(true);
    try {
      await api(`/api/users/${p.id}`, { method: 'DELETE' });
      showToast('Registration rejected');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.display_name || p.username}</span>
        <span className="text-sm text-muted-foreground">@{p.username}</span>
        <span className="text-xs capitalize text-muted-foreground">
          requested {p.role === 'manager' ? 'Project Manager' : 'Department Head'}
        </span>
      </div>
      {isHead && (
        <div className="flex flex-wrap gap-3">
          {DEPARTMENTS.map(d => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={depts.has(d)} onCheckedChange={() => toggle(d)} />
              {d}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || (isHead && depts.size === 0)} onClick={approve}>Approve</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={reject}>Reject</Button>
      </div>
    </div>
  );
}

function relativeTime(sqliteUtc) {
  if (!sqliteUtc) return null;
  const ms = Date.now() - Date.parse(sqliteUtc.replace(' ', 'T') + 'Z');
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function RosterRow({ r, router, canRegisterMachine }) {
  const [name, setName] = useState('');
  const [enroll, setEnroll] = useState(null);
  const [busy, setBusy] = useState(false);
  const machine = r.machines[0];

  async function register() {
    setBusy(true);
    try {
      const data = await api('/api/usb/machines', { method: 'POST', body: { name, username: r.username } });
      setEnroll({ code: data.code, id: data.id });
      setName('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`size-1.5 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden />
        <span className="font-medium">{r.display_name || r.username}</span>
        <span className="text-muted-foreground">@{r.username}</span>
        <span className="text-xs capitalize text-muted-foreground">{r.role}{r.departments.length ? ` · ${r.departments.join(', ')}` : ''}</span>
        <span className="ml-auto text-xs text-muted-foreground">{STATUS_LABEL[r.status]}</span>
      </div>
      {machine && (
        <div className="pl-4 text-xs text-muted-foreground">
          {machine.name} · {machine.last_seen ? relativeTime(machine.last_seen) : 'never seen'} · {machine.agent_version ? `v${machine.agent_version}` : '—'}
        </div>
      )}
      {canRegisterMachine && (!machine || enroll) && (
        <div className="flex flex-wrap items-end gap-2 pl-4">
          {!machine && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Machine name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder={`${r.username.toUpperCase()}-PC`} className="h-8 w-40" />
              </div>
              <Button size="sm" disabled={busy || !name} onClick={register}>
                <UsbIcon data-icon="inline-start" />{busy ? 'Registering…' : 'Register machine'}
              </Button>
            </>
          )}
          {enroll && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <code className="rounded bg-muted px-2 py-0.5 font-bold tracking-widest">{enroll.code}</code>
                <Button size="icon-sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(enroll.code); showToast('Copied'); }}>
                  <CopyIcon />
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/usb/machines/${enroll.id}/enroll-file`} download>Enroll file</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={INSTALLER_URL}><DownloadIcon data-icon="inline-start" />Installer</a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Same folder, run the installer — it self-enrolls.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
