'use client';

// Cue Cards: what you can say to Ember AI, by area, with the capability ladder on top (lib/cue-cards.js).
// "Ask" opens Ember AI with that prompt (the 'assistant:ask' event, components/AssistantWidget.jsx).
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRightIcon, SearchIcon } from 'lucide-react';
import { EmberMark } from '@/components/EmberMark';
import PageHeader from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const TONE = { know: 'bg-sky-500', diagnose: 'bg-amber-500', predict: 'bg-violet-400/70', optimize: 'bg-emerald-400/70', execute: 'bg-primary' };
const ask = q => window.dispatchEvent(new CustomEvent('assistant:ask', { detail: { q } }));

export default function CueCards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(null);
  const [area, setArea] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('/api/assistant/cue-cards').then(r => r.json()).then(d => (d.error ? setError(d.error) : setData(d))).catch(e => setError(e.message));
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.cards || []).filter(c => (!level || c.level === level) && (!area || c.area === area) && (!s || c.q.toLowerCase().includes(s)));
  }, [data, level, area, q]);
  const byLevel = Object.fromEntries((data?.levels || []).map(l => [l.key, l]));
  const count = k => (data?.cards || []).filter(c => c.level === k).length;

  return (
    <>
      <PageHeader title="Cue Cards" description="Things you can say to Ember AI (the button at the bottom right). Pick a card and press Ask, or say it in your own words. Cards for your own departments only." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(data?.levels || []).map(l => {
          const live = l.status === 'live', on = level === l.key;
          return (
            <button key={l.key} type="button" disabled={!live} onClick={() => setLevel(on ? null : l.key)} aria-pressed={on}
              className={cn('flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left transition-all', live ? 'hover:-translate-y-0.5 hover:shadow-sm' : 'cursor-default opacity-60', on && 'ring-2 ring-primary')}>
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={cn('grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white', TONE[l.key])}>L{l.n}</span>{l.label}
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10.5px]', live ? 'bg-success/15 text-success' : 'border border-dashed text-muted-foreground')}>{live ? `${count(l.key)} cards` : 'Coming'}</span>
              </span>
              <span className="text-xs leading-snug text-muted-foreground">{l.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search prompts: quotation, NCR, leave…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[{ key: null, label: 'All' }, ...(data?.areas || [])].filter(a => !a.key || data?.cards.some(c => c.area === a.key)).map(a => (
            <button key={a.key || 'all'} type="button" onClick={() => setArea(a.key)}
              className={cn('shrink-0 rounded-full border px-3 py-1 text-xs transition-colors', area === a.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{a.label}</button>
          ))}
        </div>
      </div>
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && !shown.length && <p className="my-8 text-center text-sm text-muted-foreground">No prompts match. Try another word, or just ask Ember AI in your own words.</p>}
      <div className="flex flex-col gap-7">
        {(data?.areas || []).map(a => {
          const cards = shown.filter(c => c.area === a.key);
          if (!cards.length) return null;
          return (
            <section key={a.key} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{a.label}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map(c => {
                  const doing = c.level === 'execute', lv = byLevel[c.level];
                  return (
                    <div key={c.q} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                      <p className="flex-1 text-[15px] italic leading-snug">“{c.q}”</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn('size-2 rounded-full', TONE[c.level])} />L{lv?.n} {lv?.label}{doing ? ' · confirms first' : ''}</span>
                        <button type="button" onClick={() => ask(c.q)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-muted">
                          {doing ? <EmberMark className="size-3.5" /> : <ArrowUpRightIcon className="size-3.5" />} Ask
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
