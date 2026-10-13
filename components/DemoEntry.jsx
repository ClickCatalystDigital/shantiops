'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Loader2Icon, ArrowRightIcon, GlobeIcon } from 'lucide-react';
import { FEATURES, INTEGRATIONS } from '@/lib/product-features';
import { track } from '@/components/DemoAnalytics';

const FIELDS = [
  ['name', 'Your name', 'text', true], ['company', 'Company', 'text', true], ['email', 'Work email', 'email', true],
  ['phone', 'Phone (optional)', 'tel', false], ['manufactures', 'What do you manufacture? (optional)', 'text', false],
];

export default function DemoEntry({ roles, hasLead }) {
  const [step, setStep] = useState(hasLead ? 'roles' : 'form');
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy('form'); setError('');
    try {
      await api('/api/demo/lead', { method: 'POST', body: form });
      track('generate_lead', { form: 'demo' });
      setStep('roles');
    }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }
  async function enter(username) {
    setBusy(username); setError('');
    try {
      const r = await api('/api/demo/enter', { method: 'POST', body: { username } });
      track('demo_role_selected', { role: username });
      window.location.assign(r.home || '/');
    } catch (err) { setError(err.message); setBusy(null); }
  }

  return (
    <main className="container grid min-h-screen gap-10 py-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <section className="order-2 space-y-6 lg:order-none">
        <div>
          <p className="text-sm font-medium text-muted-foreground">SB Ops · live demo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The ERP built for boiler manufacturers</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Walk through a working copy with sample data for Acme Boilers, a made-up company: four orders at design,
            procurement, production and dispatch. Click anything; changes reset every night.
          </p>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            One system, from enquiry to commissioning: CRM, Design, Procurement, Stores, Production, QC, Dispatch,
            Service, Accounts and HR on one set of records.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map(([Icon, title, text]) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{text}</p></div>
            </li>
          ))}
        </ul>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connects with</p>
          {/* Two copies side by side scroll left by half their width, so the loop is seamless. The copy is
              hidden from screen readers. Pauses on hover; reduced-motion users get a static wrapped row. */}
          <div className="logo-marquee mt-2">
            {[0, 1].map(copy => (
              <ul key={copy} aria-hidden={copy === 1 || undefined} className="logo-marquee-track">
                {INTEGRATIONS.map(([name, logo]) => (
                  <li key={name} className="flex shrink-0 items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                    {logo ? <img src={logo} alt="" className="h-4 w-auto" loading="lazy" /> : <GlobeIcon className="size-4" />}
                    {name}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          How it was built for a real boiler maker:{' '}
          <a href="https://ahromlabs.com/industries/boiler-pressure-vessel-manufacturing" className="font-medium text-foreground underline-offset-2 hover:underline">ERP for boiler and pressure-vessel manufacturers</a>
        </p>
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{step === 'form' ? 'Open the demo' : 'Choose a department'}</h2>
          <p className="text-sm text-muted-foreground">
            {step === 'form' ? 'Tell us who you are. No password, no card.' : 'Each role sees the screens that department works in. Switch any time from the banner.'}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'form' ? (
            <form onSubmit={submit} className="space-y-4">
              {FIELDS.map(([key, label, type, required]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key}>{label}</Label>
                  <Input id={key} type={type} required={required} value={form[key] || ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy === 'form'}>
                {busy === 'form' ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />} Continue
              </Button>
              <p className="text-xs text-muted-foreground">We use these details only to follow up about SB Ops.</p>
            </form>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map(r => (
                <button key={r.username} type="button" disabled={!!busy} onClick={() => enter(r.username)}
                  className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-muted/50 disabled:opacity-60">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {r.label}{busy === r.username && <Loader2Icon className="size-3.5 animate-spin" />}
                  </span>
                  <span className="text-xs text-muted-foreground">{r.blurb}</span>
                </button>
              ))}
              {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
