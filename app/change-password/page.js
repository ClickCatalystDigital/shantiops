// app/change-password/page.js — first sign-in for a portal customer whose password was set for them.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Loader2Icon } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (f.password !== f.confirm) { setError('Passwords do not match'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/change-password', { method: 'POST', body: { current: f.current, password: f.password } });
      router.push('/portal'); router.refresh();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/40 to-background p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="items-center text-center">
          <div className="text-base font-bold tracking-tight">SHANTI<span className="text-primary">BOILERS</span></div>
          <p className="text-sm text-muted-foreground">Choose your own password to continue</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="current">Current password</Label><Input id="current" type="password" value={f.current} onChange={set('current')} required autoComplete="current-password" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="password">New password (8+ characters)</Label><Input id="password" type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="confirm">Confirm new password</Label><Input id="confirm" type="password" value={f.confirm} onChange={set('confirm')} required minLength={8} autoComplete="new-password" /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-1">{busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}Save &amp; continue</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
