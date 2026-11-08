'use client';

// A task Ember AI prepared (lib/assistant-actions.js): every field shown and editable, nothing saved until Save.
// Save sends the fields to /api/assistant/act, which checks them again and runs the app's own route as this person.
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, Trash2Icon } from 'lucide-react';
import { EmberMark } from '@/components/EmberMark';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function AssistantActionCard({ card, onNavigate }) {
  const [values, setValues] = useState(card.values);
  const [display, setDisplay] = useState(Object.fromEntries(card.fields.filter(f => f.type === 'ref').map(f => [f.name, f.display || ''])));
  const [state, setState] = useState('draft'); // draft | saving | saved | cancelled
  const [error, setError] = useState(card.errors?.join('. ') || null);
  const [done, setDone] = useState(null);
  const del = card.risk === 'delete';
  const missing = card.fields.filter(f => f.required && (values[f.name] == null || values[f.name] === ''));

  async function save() {
    setState('saving'); setError(null);
    try {
      const res = await fetch('/api/assistant/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: card.action, fields: values }) });
      const out = await res.json().catch(() => ({}));
      if (!out.ok) throw new Error(out.error || 'Could not save');
      setDone(out); setState('saved');
    } catch (e) { setError(e.message); setState('draft'); }
  }

  if (state === 'saved') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 rounded-2xl bg-muted px-3 py-2 text-sm">
        Done: {done.summary}.
        {done.link && <Link href={done.link} onClick={onNavigate} className="inline-flex items-center gap-0.5 font-medium text-primary">Open <ArrowUpRightIcon className="size-3" /></Link>}
      </p>
    );
  }
  if (state === 'cancelled') return <p className="text-xs text-muted-foreground">Not saved.</p>;

  return (
    <div className={cn('rounded-2xl border bg-card p-3 text-sm shadow-sm', del && 'border-destructive/60')}>
      <p className={cn('mb-2 flex items-center gap-1.5 font-medium', del && 'text-destructive')}>
        {del ? <Trash2Icon className="size-4 shrink-0" /> : <EmberMark className="size-4 text-ember" />} {card.summary}
      </p>
      {del && <p className="mb-2 text-xs text-destructive">This deletes or cancels it. Check it is the right one.</p>}
      <div className="flex flex-col gap-2">
        {card.fields.map(f => (
          <label key={f.name} className="flex flex-col gap-1 text-xs">
            <span className={cn('text-muted-foreground', f.required && (values[f.name] == null || values[f.name] === '') && 'font-medium text-destructive')}>{f.label}{f.required ? '' : ' (optional)'}</span>
            <Field f={f} value={values[f.name]} display={display[f.name]}
              onChange={(v, d) => { setValues(x => ({ ...x, [f.name]: v })); if (d !== undefined) setDisplay(x => ({ ...x, [f.name]: d })); }} />
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => setState('cancelled')} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        <button type="button" onClick={save} disabled={state === 'saving' || missing.length > 0}
          className={cn('rounded-md px-3 py-1.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-50', del ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground')}>
          {state === 'saving' ? 'Saving…' : missing.length ? `Add ${missing[0].label.toLowerCase()}` : del ? 'Confirm' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const box = 'h-9 text-base md:text-sm';
const pill = on => cn('rounded-full border px-2.5 py-1 text-xs transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted');

function Field({ f, value, display, onChange }) {
  if (f.type === 'longtext') return <Textarea value={value ?? ''} rows={2} maxLength={2000} onChange={e => onChange(e.target.value)} className="text-base md:text-sm" />;
  if (f.type === 'date') return <Input type="date" value={value || ''} onChange={e => onChange(e.target.value || null)} className={cn(box, 'w-44')} />;
  if (f.options && f.type !== 'ref') {
    if (f.options.length > 6) {
      return (
        <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className={cn(box, 'rounded-md border bg-background px-2')}>
          <option value="">Choose…</option>
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    return <div className="flex flex-wrap gap-1.5">{f.options.map(o => <button key={o.value} type="button" onClick={() => onChange(o.value)} className={pill(value === o.value)}>{o.label}</button>)}</div>;
  }
  if (f.type === 'ref') {
    // Picked: its name, with a way to change it. Not sure: the closest matches. Nothing found: type a name or number.
    if (value != null && typeof value === 'number') {
      return (
        <span className="flex items-center gap-2">
          <span className="rounded-full border px-2.5 py-1 text-xs">{display || `#${value}`}</span>
          <button type="button" onClick={() => onChange(null, '')} className="text-xs underline underline-offset-2 text-muted-foreground">change</button>
        </span>
      );
    }
    return (
      <span className="flex flex-col gap-1.5">
        {f.options?.length > 0 && <span className="flex flex-wrap gap-1.5">{f.options.map(o => <button key={o.value} type="button" onClick={() => onChange(o.value, o.label)} className={pill(false)}>{o.label}</button>)}</span>}
        <Input value={value ?? ''} placeholder="Type a name or number" onChange={e => onChange(e.target.value || null)} className={box} />
      </span>
    );
  }
  const numeric = f.type === 'money' || f.type === 'number';
  return <Input value={value ?? ''} inputMode={numeric ? 'decimal' : f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : undefined}
    onChange={e => onChange(e.target.value === '' ? null : e.target.value)} className={box} />;
}
