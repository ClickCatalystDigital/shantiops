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
import { Loader2Icon, UserPlusIcon, FileCheck2Icon, LayersIcon, QrCodeIcon, LandmarkIcon, BellIcon, UsersIcon, RecycleIcon, GaugeIcon, MessageCircleIcon, ShieldCheckIcon } from 'lucide-react';

// Left panel of the sign-in page: only things the product does today.
const FEATURES = [
  [FileCheck2Icon, 'IBR folder in one click', 'Form II, III, III A and IV A built from the certificates already linked to each part.'],
  [LayersIcon, 'Excel PMB to a structured BOM', 'Upload the workbook; the tree, categories and catalog links are filled in for review.'],
  [RecycleIcon, 'Plate-to-part traceability', 'Heat numbers follow every cut, and usable remnants return to stock for the next order.'],
  [QrCodeIcon, 'Customer portal and nameplate QR', 'Customers follow their order, download documents and see service visits.'],
  [LandmarkIcon, 'Accounts built in', 'GST, TDS, ledger, bank reconciliation and financial statements for each company.'],
  [BellIcon, 'Alerts that reach the right person', 'Each person chooses bell or email per alert; the owner gets a morning brief.'],
  [MessageCircleIcon, 'WhatsApp for quotations and RFQs', 'Send offers to customers and enquiries to suppliers on WhatsApp in one click.'],
  [GaugeIcon, 'Owner view', 'On-track status, cash outstanding and approvals waiting on one page.'],
  [ShieldCheckIcon, 'Device and data security', 'USB drives, phones and websites stay locked on office PCs until a manager approves.'],
  [UsersIcon, 'CRM to cash', 'Leads from IndiaMART, TradeIndia, JustDial and your website become enquiries, quotations, orders and payments.'],
];
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
      const { home } = await api('/api/login', { method: 'POST', body: form });
      // ?next= is set by middleware.js; only same-site paths are followed (no open redirect).
      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next && /^\/(?![\/\\])/.test(next) ? next : home || '/');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between border-r bg-muted/40 p-12 lg:flex">
        <p><span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">ERP 360</span></p>
        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">One system, from enquiry to commissioning.</h1>
          <p className="mt-4 text-sm text-muted-foreground">CRM, Design, Procurement, Stores, Production, QC, Dispatch, Service, Accounts and HR on one set of records.</p>
          <ul className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
            {FEATURES.map(([Icon, title, text, tag]) => (
              <li key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{title}{tag && <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">An ahromlabs.com product</p>
      </aside>
      <div className="flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="items-center text-center">
          <div className="flex items-center justify-center gap-2">

            {/* Logo hidden until the new SB Ops mark exists; drop `hidden` to show it (animation: .logo in globals.css). */}
            <img src="/logo.svg" alt="" aria-hidden className="logo hidden size-9 md:size-10" onError={(e) => { e.currentTarget.style.display = "none"; }} />
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
