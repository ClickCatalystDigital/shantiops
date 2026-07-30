// app/login/page.js — production sign-in page. No demo picker here; see
// app/d-login/page.js for the internal demo-account picker.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2Icon, UserPlusIcon } from 'lucide-react';
import { DEPARTMENTS } from '@/lib/milestones';

export default function Login() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { method: 'POST', body: form });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/40 to-background p-4">
      <Card className="w-full max-w-sm shadow-lg">
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
