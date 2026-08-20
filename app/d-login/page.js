// app/d-login/page.js — demo login picker. Hidden from production; see app/login/page.js
// for the plain sign-in page shown to real users.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2Icon, Users, Factory, UserCircle, KeyRound, CheckIcon, UserPlusIcon, Cloud } from 'lucide-react';
import { DEPARTMENTS } from '@/lib/milestones';

const DEMO_GROUPS = [
  {
    label: 'Demo Accounts',
    icon: Users,
    accounts: ['manager', 'executive'],
  },
  {
    label: 'Department Heads',
    icon: Factory,
    accounts: [
      'design_head',
      'engg_head',
      'procurement_head',
      'stores_head',
      'production_head',
      'qc_head',
      'dispatch_head',
      'installation_head',
      'sales_head',
      'marketing_head',
      'hr_head',
      'accounts_head',
    ],
  },
  {
    label: 'Customers',
    icon: UserCircle,
    accounts: ['asian_brown', 'hkm_charitable', 'virchow_biotech'],
  },
];

function labelize(username) {
  return username
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ponytail: speed bump, not real security — just keeps this off department heads' radar if
// they notice the URL. Anyone reading the bundle can find "dem" anyway.
function DemoGate({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem('d-login-ok') === '1');
    setChecked(true);
  }, []);

  function submit(e) {
    e.preventDefault();
    if (pw === 'dem') {
      sessionStorage.setItem('d-login-ok', '1');
      setUnlocked(true);
    } else {
      setWrong(true);
    }
  }

  if (!checked) return null;
  if (unlocked) return children;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/40 to-background p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="items-center text-center"><h1 className="text-lg font-semibold">Password required</h1></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input type="password" autoFocus value={pw}
              onChange={e => { setPw(e.target.value); setWrong(false); }} />
            {wrong && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Incorrect password</p>}
            <Button type="submit" className="w-full">Continue</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function LoginContent() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { home } = await api('/api/login', { method: 'POST', body: form });
      router.push(home || '/');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function fillDemo(username) {
    setForm({ username, password: `${username}123` });
    setSelected(username);
    setError('');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/40 to-background p-4">
      <div className="flex w-full max-w-4xl flex-col items-stretch justify-center gap-6 lg:flex-row">
        {/* LOGIN CARD — unchanged */}
        <Card className="w-full max-w-sm shadow-lg lg:mx-auto">
          <CardHeader className="items-center text-center">
            <div className="flex items-center justify-center gap-2">
              <img
                src="/logo.svg"
                alt=""
                aria-hidden
                className="size-9 md:size-10"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />

              <h1 className="text-2xl font-bold tracking-tight">
                <span className="text-muted-foreground">SB</span><span className="text-primary">OPS</span>
              </h1>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" autoFocus value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
                {busy ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
          <RequestAccess />
        </Card>

        {/* DEMO ACCOUNTS PANEL */}
        <Card className="w-full max-w-sm shadow-lg lg:mx-auto">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold tracking-tight">Demo Logins</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Tap a name to auto-fill the form on the left.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {DEMO_GROUPS.map(({ label, icon: Icon, accounts }) => (
              <div key={label} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {accounts.map((username) => {
                    const isSelected = selected === username;
                    return (
                      <button
                        key={username}
                        type="button"
                        onClick={() => fillDemo(username)}
                        className={`flex items-center justify-between gap-1 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors
                          ${isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background hover:bg-muted'
                          }`}
                      >
                        <span className="truncate">{labelize(username)}</span>
                        {isSelected && <CheckIcon className="size-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                  {label === 'Demo Accounts' && (
                    <a
                      href="/cloud-storage-pricing.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted"
                    >
                      <span className="truncate">Cloud Storage</span>
                      <Cloud className="size-3.5 shrink-0" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RequestAccess() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ display_name: '', username: '', password: '', departments: [] });

  function toggleDept(d) {
    setF(prev => ({
      ...prev,
      departments: prev.departments.includes(d) ? prev.departments.filter(x => x !== d) : [...prev.departments, d],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/register', { method: 'POST', body: f });
      setDone(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  if (!open) {
    return (
      <CardContent className="pt-0">
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setOpen(true)}>
          <UserPlusIcon data-icon="inline-start" />Request access
        </Button>
      </CardContent>
    );
  }

  if (done) {
    return (
      <CardContent className="pt-0">
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          Request sent — a manager will approve your account.
        </p>
      </CardContent>
    );
  }

  return (
    <CardContent className="flex flex-col gap-3 border-t pt-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ra-name">Full name</Label>
          <Input id="ra-name" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ra-username">Choose a username</Label>
          <Input id="ra-username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ra-password">Choose a password</Label>
          <Input id="ra-password" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Department(s)</Label>
          <div className="flex flex-wrap gap-3">
            {DEPARTMENTS.map(d => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={f.departments.includes(d)} onCheckedChange={() => toggleDept(d)} />
                {d}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">
            {busy ? 'Sending…' : 'Send request'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </CardContent>
  );
}

export default function Login() {
  return <DemoGate><LoginContent /></DemoGate>;
}