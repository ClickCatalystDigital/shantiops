'use client';

// /procurement/terms — the optional Terms and Conditions page printed after every Purchase Order of a
// company. Heading text, its font and size, body font and size, the text itself, and an on/off switch.
// Fonts are the same three as Accounts' document headers (lib/doc-headers.mjs DOC_FONTS).
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftIcon, ScrollTextIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { DOC_FONTS } from '@/lib/doc-headers.mjs';
import { PO_TERMS_DEFAULT_HEADING } from '@/lib/po-terms.mjs';

const FONT_OPTIONS = Object.entries(DOC_FONTS).map(([k, f]) => [k, f.label]);

function Segmented({ value, onChange, disabled }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
      {FONT_OPTIONS.map(([v, label]) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
          style={{ fontFamily: DOC_FONTS[v].css }}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${value === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SizeInput({ value, onChange, min, max, disabled }) {
  return (
    <Input type="number" className="w-20" min={min} max={max} step={0.5} value={value} disabled={disabled}
      onChange={e => onChange(e.target.value)} />
  );
}

// Page 2 as it prints, 1 px = 1 pt.
function Preview({ t, company }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
      <div className="mx-auto flex min-h-[420px] flex-col bg-white p-7 text-black shadow-sm ring-1 ring-black/5" style={{ width: 595 }}>
        <div className="text-center text-[13px] font-bold">{company?.legal_name?.toUpperCase() || company?.company}</div>
        <div className="mt-2 h-px bg-black" />
        {t.heading && <div className="py-[3px] text-center tracking-[1px]" style={{ fontFamily: DOC_FONTS[t.headingFont].css, fontWeight: 700, fontSize: Number(t.headingSize) || 12 }}>{t.heading}</div>}
        <div className="h-px bg-black" />
        <div className="mt-2 mb-2 text-[7px] text-[#555]">Forms part of Purchase Order 000/XX/2026-27</div>
        {(t.body || 'Your terms will appear here.').split('\n\n').map((p, i) => (
          <p key={i} className={`whitespace-pre-wrap ${t.body ? '' : 'text-[#999]'}`}
            style={{ fontFamily: DOC_FONTS[t.bodyFont].css, fontSize: Number(t.bodySize) || 8, lineHeight: 1.4, marginBottom: 6 }}>{p}</p>
        ))}
      </div>
    </div>
  );
}

export default function PoTermsEditor({ companies, canEdit }) {
  const [list, setList] = useState(companies);
  const [id, setId] = useState(companies[0]?.id ?? null);
  const current = list.find(c => c.id === id);
  const [t, setT] = useState(current?.terms);
  const [saving, setSaving] = useState(false);
  const set = patch => setT(prev => ({ ...prev, ...patch }));
  const dirty = current && JSON.stringify(t) !== JSON.stringify(current.terms);

  function pick(v) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const c = list.find(x => x.id === Number(v));
    setId(c.id); setT(c.terms);
  }
  async function save() {
    setSaving(true);
    try {
      const res = await api('/api/po-terms', { method: 'PUT', body: { id, terms: t } });
      setList(list.map(c => c.id === id ? { ...c, terms: res.terms } : c));
      setT(res.terms);
      showToast('Terms and conditions saved');
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  if (!current) return <main className="container py-6 text-sm text-muted-foreground">No company set up yet.</main>;
  const off = !canEdit;
  return (
    <main className="container flex flex-col gap-4 py-6">
      <div>
        <Button size="sm" variant="ghost" className="-ml-2 mb-1 text-muted-foreground" asChild>
          <Link href="/procurement/orders"><ArrowLeftIcon className="size-3.5" />Purchase Orders</Link>
        </Button>
        <h1 className="text-xl font-semibold">Purchase Order terms and conditions</h1>
        <p className="text-sm text-muted-foreground">Printed as page 2 of every Purchase Order of the chosen company, when switched on.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScrollTextIcon className="size-4" />Terms page</CardTitle>
          <CardDescription>{off ? 'You can view these terms; ask your Head to change them.' : 'A blank line starts a new paragraph.'}</CardDescription>
          <CardAction className="flex items-center gap-2">
            {list.length > 1 && (
              <Select value={String(id)} onValueChange={pick}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{list.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.company}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {canEdit && <Button size="sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>}
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={t.enabled} disabled={off} onCheckedChange={v => set({ enabled: !!v })} />
              Print the terms page on Purchase Orders
            </label>
            <div className="grid gap-1.5">
              <Label>Heading</Label>
              <Input value={t.heading} disabled={off} maxLength={120} placeholder={PO_TERMS_DEFAULT_HEADING} onChange={e => set({ heading: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5"><Label>Heading font</Label><Segmented value={t.headingFont} disabled={off} onChange={v => set({ headingFont: v })} /></div>
              <div className="grid gap-1.5"><Label>Size (pt)</Label><SizeInput value={t.headingSize} min={8} max={24} disabled={off} onChange={v => set({ headingSize: v })} /></div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5"><Label>Text font</Label><Segmented value={t.bodyFont} disabled={off} onChange={v => set({ bodyFont: v })} /></div>
              <div className="grid gap-1.5"><Label>Size (pt)</Label><SizeInput value={t.bodySize} min={6} max={14} disabled={off} onChange={v => set({ bodySize: v })} /></div>
            </div>
            <div className="grid gap-1.5">
              <Label>Terms and conditions</Label>
              <Textarea rows={16} value={t.body} disabled={off} maxLength={20000}
                placeholder={'1. Prices are firm until delivery.\n\n2. Material must carry the test certificate…'}
                onChange={e => set({ body: e.target.value })} />
              {t.enabled && !t.body.trim() && <p className="text-xs text-muted-foreground">Nothing prints until there is some text.</p>}
            </div>
          </div>
          <Preview t={t} company={current} />
        </CardContent>
      </Card>
    </main>
  );
}
